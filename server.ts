import express, { Request, Response } from 'express';
import multer from 'multer';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import JSZip from 'jszip';
import { createServer as createViteServer } from 'vite';
import {
  generateApiKey,
  hashKey,
  verifyKey,
  encryptFile,
  decryptFile,
  calculateBufferHash,
  findDuplicateGroups,
} from './src/lib/crypto';
import {
  validateAndroidConfig,
  createAndroidReleasePackage,
} from './src/lib/androidBuilder';
import { AndroidBuildConfig, AndroidReleaseArtifact } from './src/types';

const UPLOAD_FOLDER = path.resolve(process.cwd(), 'user_media');
const TEMP_ZIP_FOLDER = path.resolve(process.cwd(), 'temp_zips');
const RELEASE_FOLDER = path.resolve(process.cwd(), 'release_builds');
const USERS_FILE = path.resolve(process.cwd(), 'users.txt');

fs.mkdirSync(UPLOAD_FOLDER, { recursive: true });
fs.mkdirSync(TEMP_ZIP_FOLDER, { recursive: true });
fs.mkdirSync(RELEASE_FOLDER, { recursive: true });
if (!fs.existsSync(USERS_FILE)) {
  fs.writeFileSync(USERS_FILE, '', 'utf-8');
}

// Copy static wallpapers to public/static if they exist
const staticDir = path.resolve(process.cwd(), 'static');
const publicStaticDir = path.resolve(process.cwd(), 'public', 'static');
fs.mkdirSync(publicStaticDir, { recursive: true });
for (const wp of ['wp1.jpg', 'wp2.jpg', 'wp3.jpg']) {
  const src = path.join(staticDir, wp);
  const dest = path.join(publicStaticDir, wp);
  if (fs.existsSync(src) && !fs.existsSync(dest)) {
    fs.copyFileSync(src, dest);
  }
}

interface SessionData {
  username: string;
  apiKey: string;
}

const SESSIONS = new Map<string, SessionData>();
const ZIP_TASKS = new Map<
  string,
  { status: 'starting' | 'processing' | 'complete' | 'error'; progress: number; filename: string | null; error?: string }
>();

const ANDROID_RELEASES = new Map<
  string,
  {
    artifact: AndroidReleaseArtifact;
    apkPath: string;
    projectZipPath: string;
  }
>();

function parseCookies(cookieHeader?: string): Record<string, string> {
  const list: Record<string, string> = {};
  if (!cookieHeader) return list;
  cookieHeader.split(';').forEach((cookie) => {
    const parts = cookie.split('=');
    const key = parts.shift()?.trim();
    if (key) {
      list[key] = decodeURIComponent(parts.join('='));
    }
  });
  return list;
}

function getSession(req: Request): SessionData | null {
  const cookies = parseCookies(req.headers.cookie);
  const sid = cookies['photocloud_sid'] || (req.headers['x-session-id'] as string);
  if (!sid) return null;
  return SESSIONS.get(sid) ?? null;
}

function findUser(username: string): string | null {
  if (!fs.existsSync(USERS_FILE)) return null;
  const lines = fs.readFileSync(USERS_FILE, 'utf-8').split('\n');
  for (const line of lines) {
    if (line.startsWith(username + ':')) {
      return line.split(':')[1]?.trim() ?? null;
    }
  }
  return null;
}

function saveUser(username: string, keyHash: string): void {
  fs.appendFileSync(USERS_FILE, `${username}:${keyHash}\n`, 'utf-8');
}

function ensureDemoVault(): SessionData {
  const demoUser = 'demo_mobile';
  const demoKey = 'PhotoCloud_Android_Vault_Key_2026!';
  let storedHash = findUser(demoUser);
  const userFolder = path.join(UPLOAD_FOLDER, demoUser);
  const trashFolder = path.join(userFolder, 'trash');
  fs.mkdirSync(userFolder, { recursive: true });
  fs.mkdirSync(trashFolder, { recursive: true });

  if (!storedHash) {
    saveUser(demoUser, hashKey(demoKey));
    // Seed initial encrypted photos from static/wp1.jpg, wp2.jpg, wp3.jpg so gallery works immediately
    const samples = [
      { src: 'wp1.jpg', mtimeOffsetSec: 0 },
      { src: 'wp2.jpg', mtimeOffsetSec: -86400 * 3 },
      { src: 'wp3.jpg', mtimeOffsetSec: -86400 * 35 },
    ];
    for (const sample of samples) {
      const srcPath = path.join(staticDir, sample.src);
      if (fs.existsSync(srcPath)) {
        const rawBytes = fs.readFileSync(srcPath);
        const enc = encryptFile(rawBytes, demoKey);
        const randName = `${crypto.randomBytes(8).toString('hex')}.jpg`;
        const destPath = path.join(userFolder, randName);
        fs.writeFileSync(destPath, enc);
        const mtime = Date.now() / 1000 + sample.mtimeOffsetSec;
        fs.utimesSync(destPath, mtime, mtime);
      }
    }
  }
  return { username: demoUser, apiKey: demoKey };
}

// Pre-build initial default Release v1.0.0 so the Android Release Studio immediately shows a ready release build and allows rebuilding custom releases
async function ensureInitialAndroidRelease() {
  const defaultConfig: AndroidBuildConfig = {
    appName: 'PhotoCloud',
    packageName: 'com.valerio.photocloud',
    versionName: '1.0.0',
    versionCode: 1,
    serverUrl: 'http://10.0.2.2:3000',
    minSdk: 26,
    targetSdk: 35,
    enableBiometricLock: true,
    enableOfflineCache: true,
    enableAutoBackup: false,
    signingMode: 'release',
    keystoreAlias: 'photocloud-release-key',
  };
  const { artifact, apkBuffer, projectZipBuffer } = await createAndroidReleasePackage(defaultConfig);
  const apkPath = path.join(RELEASE_FOLDER, artifact.apkFilename);
  const projectZipPath = path.join(RELEASE_FOLDER, artifact.projectZipFilename);
  fs.writeFileSync(apkPath, apkBuffer);
  fs.writeFileSync(projectZipPath, projectZipBuffer);
  ANDROID_RELEASES.set(artifact.buildId, {
    artifact,
    apkPath,
    projectZipPath,
  });
}

const VALID_EXTENSIONS = ['.jpg', '.jpeg', '.png', '.gif', '.webp', '.mp4', '.mov'];

function listMediaFiles(folderPath: string) {
  if (!fs.existsSync(folderPath)) return [];
  const files = fs.readdirSync(folderPath);
  const details: Array<{ filename: string; timestamp: number; size: number }> = [];
  for (const f of files) {
    const full = path.join(folderPath, f);
    const stat = fs.statSync(full);
    const ext = path.extname(f).toLowerCase();
    if (stat.isFile() && VALID_EXTENSIONS.includes(ext)) {
      details.push({
        filename: f,
        timestamp: stat.mtimeMs / 1000,
        size: stat.size,
      });
    }
  }
  details.sort((a, b) => b.timestamp - a.timestamp);
  return details;
}

const upload = multer({ storage: multer.memoryStorage() });

async function startServer() {
  ensureDemoVault();
  await ensureInitialAndroidRelease();

  const app = express();
  app.use(express.json());
  app.use(express.urlencoded({ extended: true }));
  app.use('/static', express.static(staticDir));

  // --- SESSION & DEMO API ---
  app.get('/api/session', (req: Request, res: Response) => {
    const sess = getSession(req);
    if (!sess) {
      res.json({ authenticated: false });
      return;
    }
    const userFolder = path.join(UPLOAD_FOLDER, sess.username);
    const trashFolder = path.join(userFolder, 'trash');
    res.json({
      authenticated: true,
      username: sess.username,
      mediaFiles: listMediaFiles(userFolder),
      trashedFiles: listMediaFiles(trashFolder),
    });
  });

  app.post('/api/demo-login', (_req: Request, res: Response) => {
    const demoSess = ensureDemoVault();
    const sid = crypto.randomUUID();
    SESSIONS.set(sid, demoSess);
    res.setHeader(
      'Set-Cookie',
      `photocloud_sid=${sid}; Path=/; HttpOnly; SameSite=Lax; Max-Age=86400`
    );
    const userFolder = path.join(UPLOAD_FOLDER, demoSess.username);
    const trashFolder = path.join(userFolder, 'trash');
    res.json({
      success: true,
      username: demoSess.username,
      apiKey: demoSess.apiKey,
      mediaFiles: listMediaFiles(userFolder),
      trashedFiles: listMediaFiles(trashFolder),
    });
  });

  // --- REGISTER ---
  app.post('/register', upload.none(), (req: Request, res: Response) => {
    const rawUsername = (req.body?.username || '').trim();
    if (!rawUsername) {
      res.status(400).send('Username non valido!');
      return;
    }
    if (findUser(rawUsername)) {
      res.status(409).send('Username già esistente!');
      return;
    }

    const keyType = req.body?.key_type || 'generate';
    let apiKey = '';
    if (keyType === 'custom') {
      apiKey = req.body?.custom_key || '';
      if (!apiKey || apiKey.length < 8) {
        res.status(400).send('La chiave personalizzata deve avere almeno 8 caratteri.');
        return;
      }
    } else {
      apiKey = generateApiKey(32);
    }

    saveUser(rawUsername, hashKey(apiKey));
    const userFolder = path.join(UPLOAD_FOLDER, rawUsername);
    fs.mkdirSync(userFolder, { recursive: true });
    fs.mkdirSync(path.join(userFolder, 'trash'), { recursive: true });

    // Seed sample photos for newly registered user if requested or leave clean
    const authData = {
      username: rawUsername,
      api_key: apiKey,
      session_id: crypto.randomUUID(),
      created_at: Date.now() / 1000,
      hash_of_key: hashKey(apiKey),
    };

    // Also log the user in automatically so mobile UX is seamless
    const sid = crypto.randomUUID();
    SESSIONS.set(sid, { username: rawUsername, apiKey });
    res.setHeader(
      'Set-Cookie',
      `photocloud_sid=${sid}; Path=/; HttpOnly; SameSite=Lax; Max-Age=86400`
    );

    const safeName = rawUsername.replace(/[^a-zA-Z0-9_-]/g, '_');
    const downloadName = `photocloud_auth_${safeName}.json`;
    res.setHeader('Content-Type', 'application/json');
    res.setHeader('Content-Disposition', `attachment; filename="${downloadName}"`);
    res.status(200).send(JSON.stringify(authData, null, 2));
  });

  // --- LOGIN ---
  app.post('/login', upload.single('auth_file'), (req: Request, res: Response) => {
    let authData: { username?: string; api_key?: string } | null = null;

    if (req.file) {
      try {
        authData = JSON.parse(req.file.buffer.toString('utf-8'));
      } catch {
        res.status(400).send('File di autenticazione non valido.');
        return;
      }
    } else if (req.body?.username && req.body?.api_key) {
      authData = { username: req.body.username, api_key: req.body.api_key };
    } else {
      res.status(400).send('File di autenticazione non trovato.');
      return;
    }

    const username = authData?.username?.trim();
    const apiKey = authData?.api_key;
    if (!username || !apiKey) {
      res.status(400).send('File di autenticazione non valido.');
      return;
    }

    const storedHash = findUser(username);
    if (storedHash && verifyKey(apiKey, storedHash)) {
      const sid = crypto.randomUUID();
      SESSIONS.set(sid, { username, apiKey });
      res.setHeader(
        'Set-Cookie',
        `photocloud_sid=${sid}; Path=/; HttpOnly; SameSite=Lax; Max-Age=86400`
      );
      if (req.headers.accept?.includes('application/json')) {
        res.json({ success: true, username });
        return;
      }
      res.redirect('/');
    } else {
      res.status(401).send('Credenziali non valide.');
    }
  });

  // --- LOGOUT ---
  app.post('/logout', (req: Request, res: Response) => {
    const cookies = parseCookies(req.headers.cookie);
    const sid = cookies['photocloud_sid'];
    if (sid) {
      SESSIONS.delete(sid);
    }
    res.setHeader('Set-Cookie', 'photocloud_sid=; Path=/; Max-Age=0');
    if (req.headers.accept?.includes('application/json')) {
      res.json({ success: true });
      return;
    }
    res.redirect('/');
  });

  // --- UPLOAD ---
  app.post('/upload', upload.array('file[]'), (req: Request, res: Response) => {
    const sess = getSession(req);
    if (!sess) {
      res.status(403).json({ error: 'Accesso negato' });
      return;
    }
    const files = req.files as Express.Multer.File[] | undefined;
    if (!files || files.length === 0) {
      res.status(400).json({ error: 'Nessun file' });
      return;
    }

    const userFolder = path.join(UPLOAD_FOLDER, sess.username);
    fs.mkdirSync(userFolder, { recursive: true });

    const rawTimestamps = req.body?.['timestamp[]'] || req.body?.timestamp;
    const timestamps = Array.isArray(rawTimestamps)
      ? rawTimestamps
      : rawTimestamps
      ? [rawTimestamps]
      : [];

    try {
      files.forEach((file, i) => {
        const ext = path.extname(file.originalname) || '.jpg';
        let filename = '';
        let filepath = '';
        while (true) {
          filename = `${crypto.randomBytes(8).toString('hex')}${ext}`;
          filepath = path.join(userFolder, filename);
          if (!fs.existsSync(filepath)) break;
        }
        const encrypted = encryptFile(file.buffer, sess.apiKey);
        fs.writeFileSync(filepath, encrypted);

        if (timestamps[i]) {
          const mtime = parseFloat(timestamps[i]) / 1000;
          if (!Number.isNaN(mtime) && mtime > 0) {
            try {
              fs.utimesSync(filepath, mtime, mtime);
            } catch {
              // ignore utime errors
            }
          }
        }
      });

      res.json({
        success: true,
        message: `${files.length} file caricati.`,
        mediaFiles: listMediaFiles(userFolder),
      });
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      res.status(500).json({ error: `Errore durante il caricamento: ${msg}` });
    }
  });

  // --- MEDIA DECRYPTION ---
  app.get('/media/:filename', (req: Request, res: Response) => {
    const sess = getSession(req);
    if (!sess) {
      res.status(403).send('Accesso negato');
      return;
    }

    const filename = String(req.params.filename);
    const userFolder = path.join(UPLOAD_FOLDER, sess.username);
    const basePath =
      req.query.from_trash === 'true' ? path.join(userFolder, 'trash') : userFolder;

    const safeBasePath = path.resolve(basePath);
    const safeFilepath = path.resolve(safeBasePath, filename);

    if (!safeFilepath.startsWith(safeBasePath + path.sep)) {
      res.status(403).send('Accesso non autorizzato.');
      return;
    }

    if (!fs.existsSync(safeFilepath)) {
      res.status(404).send('File non trovato');
      return;
    }

    try {
      const encrypted = fs.readFileSync(safeFilepath);
      const decrypted = decryptFile(encrypted, sess.apiKey);
      const ext = path.extname(filename).replace('.', '').toLowerCase();
      const mimeMap: Record<string, string> = {
        jpg: 'image/jpeg',
        jpeg: 'image/jpeg',
        png: 'image/png',
        gif: 'image/gif',
        webp: 'image/webp',
        mp4: 'video/mp4',
        mov: 'video/mp4',
      };
      res.setHeader('Content-Type', mimeMap[ext] || 'application/octet-stream');
      res.send(decrypted);
    } catch {
      res.status(500).send('Errore durante la decrittografia.');
    }
  });

  // --- TRASH OPERATIONS ---
  app.post('/trash/batch', (req: Request, res: Response) => {
    const sess = getSession(req);
    if (!sess) {
      res.status(403).json({ error: 'Accesso negato', success: false });
      return;
    }
    const filenames = req.body?.filenames;
    if (!Array.isArray(filenames)) {
      res.status(400).json({ error: 'Input non valido', success: false });
      return;
    }

    const userFolder = path.resolve(UPLOAD_FOLDER, sess.username);
    const trashFolder = path.resolve(userFolder, 'trash');
    fs.mkdirSync(trashFolder, { recursive: true });

    const validFilenames: string[] = [];
    const errors: string[] = [];

    for (const f of filenames) {
      const safePath = path.resolve(userFolder, String(f));
      if (safePath.startsWith(userFolder + path.sep) && fs.existsSync(safePath)) {
        try {
          const dest = path.join(trashFolder, path.basename(safePath));
          fs.renameSync(safePath, dest);
          const now = Date.now() / 1000;
          fs.utimesSync(dest, now, now);
          validFilenames.push(f);
        } catch (err: unknown) {
          errors.push(`Errore su ${f}: ${err instanceof Error ? err.message : String(err)}`);
        }
      } else {
        errors.push(`File '${f}' non trovato o non valido`);
      }
    }

    if (errors.length > 0) {
      res.status(validFilenames.length > 0 ? 207 : 500).json({
        success: validFilenames.length > 0,
        error: errors.join('. '),
      });
      return;
    }
    res.json({ success: true });
  });

  app.post('/trash/:filename', (req: Request, res: Response) => {
    const sess = getSession(req);
    if (!sess) {
      res.status(403).json({ error: 'Accesso negato', success: false });
      return;
    }
    const filename = String(req.params.filename);
    const userFolder = path.resolve(UPLOAD_FOLDER, sess.username);
    const safeFilepath = path.resolve(userFolder, filename);

    if (!safeFilepath.startsWith(userFolder + path.sep)) {
      res.status(403).json({ error: 'Accesso non autorizzato', success: false });
      return;
    }
    if (!fs.existsSync(safeFilepath)) {
      res.status(404).json({ error: 'File non trovato', success: false });
      return;
    }

    try {
      const trashFolder = path.join(userFolder, 'trash');
      fs.mkdirSync(trashFolder, { recursive: true });
      const dest = path.join(trashFolder, path.basename(filename));
      fs.renameSync(safeFilepath, dest);
      const now = Date.now() / 1000;
      fs.utimesSync(dest, now, now);
      res.json({ success: true, message: `File ${filename} spostato nel cestino` });
    } catch (e: unknown) {
      res.status(500).json({
        success: false,
        error: e instanceof Error ? e.message : String(e),
      });
    }
  });

  app.post('/restore/:filename', (req: Request, res: Response) => {
    const sess = getSession(req);
    if (!sess) {
      res.status(403).json({ error: 'Accesso negato' });
      return;
    }
    const filename = String(req.params.filename);
    const userFolder = path.resolve(UPLOAD_FOLDER, sess.username);
    const trashFolder = path.resolve(userFolder, 'trash');
    const safeFilepath = path.resolve(trashFolder, filename);

    if (!safeFilepath.startsWith(trashFolder + path.sep) || !fs.existsSync(safeFilepath)) {
      res.status(404).json({ success: false, error: 'File non trovato o accesso negato' });
      return;
    }

    try {
      const dest = path.join(userFolder, path.basename(filename));
      fs.renameSync(safeFilepath, dest);
      res.json({ success: true });
    } catch (e: unknown) {
      res.status(500).json({
        success: false,
        error: e instanceof Error ? e.message : String(e),
      });
    }
  });

  app.post('/delete_permanent/:filename', (req: Request, res: Response) => {
    const sess = getSession(req);
    if (!sess) {
      res.status(403).json({ error: 'Accesso negato' });
      return;
    }
    const filename = String(req.params.filename);
    const userFolder = path.resolve(UPLOAD_FOLDER, sess.username);
    const trashFolder = path.resolve(userFolder, 'trash');
    const safeFilepath = path.resolve(trashFolder, filename);

    if (!safeFilepath.startsWith(trashFolder + path.sep) || !fs.existsSync(safeFilepath)) {
      res.status(404).json({ success: false, error: 'File non trovato o accesso negato' });
      return;
    }

    try {
      fs.unlinkSync(safeFilepath);
      res.json({ success: true });
    } catch (e: unknown) {
      res.status(500).json({
        success: false,
        error: e instanceof Error ? e.message : String(e),
      });
    }
  });

  app.post('/empty_trash', (req: Request, res: Response) => {
    const sess = getSession(req);
    if (!sess) {
      res.status(403).json({ error: 'Accesso negato' });
      return;
    }
    const trashFolder = path.resolve(UPLOAD_FOLDER, sess.username, 'trash');
    try {
      if (fs.existsSync(trashFolder)) {
        fs.rmSync(trashFolder, { recursive: true, force: true });
        fs.mkdirSync(trashFolder, { recursive: true });
      }
      res.json({ success: true });
    } catch (e: unknown) {
      res.status(500).json({
        success: false,
        error: e instanceof Error ? e.message : String(e),
      });
    }
  });

  // --- DUPLICATES ---
  app.post('/find_duplicates_server', (req: Request, res: Response) => {
    const sess = getSession(req);
    if (!sess) {
      res.status(403).json({ error: 'Accesso negato' });
      return;
    }
    const userFolder = path.resolve(UPLOAD_FOLDER, sess.username);
    if (!fs.existsSync(userFolder)) {
      res.json({ duplicates: [] });
      return;
    }
    const files = listMediaFiles(userFolder);
    if (files.length < 2) {
      res.json({ duplicates: [] });
      return;
    }

    const hashedItems = files.map((f) => {
      try {
        const enc = fs.readFileSync(path.join(userFolder, f.filename));
        const dec = decryptFile(enc, sess.apiKey);
        return { filename: f.filename, hash: calculateBufferHash(dec) };
      } catch {
        return { filename: f.filename, hash: null };
      }
    });

    const duplicates = findDuplicateGroups(hashedItems);
    res.json({ duplicates });
  });

  // --- ZIP EXPORT ---
  app.post('/prepare-zip', async (req: Request, res: Response) => {
    const sess = getSession(req);
    if (!sess) {
      res.status(403).json({ error: 'Accesso negato' });
      return;
    }
    const filenames: string[] = req.body?.filenames;
    if (!Array.isArray(filenames) || filenames.length === 0) {
      res.status(400).json({ error: 'Nessun file selezionato' });
      return;
    }

    const taskId = crypto.randomUUID();
    const userFolder = path.resolve(UPLOAD_FOLDER, sess.username);
    ZIP_TASKS.set(taskId, { status: 'starting', progress: 0, filename: null });

    // Process zip asynchronously
    (async () => {
      try {
        const zip = new JSZip();
        const total = filenames.length;
        for (let i = 0; i < total; i++) {
          const fname = filenames[i];
          const progress = Math.round(((i + 1) / total) * 100);
          ZIP_TASKS.set(taskId, { status: 'processing', progress, filename: null });

          const safePath = path.resolve(userFolder, fname);
          if (safePath.startsWith(userFolder + path.sep) && fs.existsSync(safePath)) {
            const enc = fs.readFileSync(safePath);
            const dec = decryptFile(enc, sess.apiKey);
            zip.file(path.basename(fname), dec);
          }
        }
        const zipFilename = `${taskId}.zip`;
        const zipFilepath = path.join(TEMP_ZIP_FOLDER, zipFilename);
        const buf = await zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE' });
        fs.writeFileSync(zipFilepath, buf);
        ZIP_TASKS.set(taskId, { status: 'complete', progress: 100, filename: zipFilename });
      } catch (err: unknown) {
        ZIP_TASKS.set(taskId, {
          status: 'error',
          progress: 0,
          filename: null,
          error: err instanceof Error ? err.message : String(err),
        });
      }
    })();

    res.json({ task_id: taskId });
  });

  app.get('/zip-progress/:taskId', (req: Request, res: Response) => {
    const sess = getSession(req);
    if (!sess) {
      res.status(403).json({ error: 'Accesso negato' });
      return;
    }
    const info = ZIP_TASKS.get(String(req.params.taskId)) || { status: 'not_found', progress: 0 };
    res.json(info);
  });

  app.get('/download-zip/:filename', (req: Request, res: Response) => {
    const sess = getSession(req);
    if (!sess) {
      res.status(403).send('Accesso negato');
      return;
    }
    const filename = String(req.params.filename);
    const directory = path.resolve(TEMP_ZIP_FOLDER);
    const filepath = path.resolve(directory, filename);

    if (!filepath.startsWith(directory + path.sep)) {
      res.status(403).send('Accesso non autorizzato al file');
      return;
    }
    if (!fs.existsSync(filepath)) {
      res.status(404).send('File non trovato');
      return;
    }

    const zipBytes = fs.readFileSync(filepath);
    try {
      fs.unlinkSync(filepath);
    } catch {
      // ignore
    }
    const taskId = path.parse(filename).name;
    ZIP_TASKS.delete(taskId);

    res.setHeader('Content-Type', 'application/zip');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.send(zipBytes);
  });

  // --- ANDROID RELEASE STUDIO API ---
  app.get('/api/android/releases', (_req: Request, res: Response) => {
    const list = Array.from(ANDROID_RELEASES.values())
      .map((r) => r.artifact)
      .sort((a, b) => b.timestamp - a.timestamp);
    res.json({ releases: list });
  });

  app.post('/api/android/build-release', async (req: Request, res: Response) => {
    const config: AndroidBuildConfig = {
      appName: String(req.body?.appName ?? 'PhotoCloud'),
      packageName: String(req.body?.packageName ?? 'com.valerio.photocloud'),
      versionName: String(req.body?.versionName ?? '1.0.0'),
      versionCode: Number(req.body?.versionCode ?? 1),
      serverUrl: String(req.body?.serverUrl ?? 'http://10.0.2.2:3000'),
      minSdk: Number(req.body?.minSdk ?? 26),
      targetSdk: Number(req.body?.targetSdk ?? 35),
      enableBiometricLock: Boolean(req.body?.enableBiometricLock ?? true),
      enableOfflineCache: Boolean(req.body?.enableOfflineCache ?? true),
      enableAutoBackup: Boolean(req.body?.enableAutoBackup ?? false),
      signingMode: req.body?.signingMode === 'debug' ? 'debug' : 'release',
      keystoreAlias: String(req.body?.keystoreAlias ?? 'photocloud-release-key'),
    };

    const validationError = validateAndroidConfig(config);
    if (validationError) {
      res.status(400).json({ error: validationError });
      return;
    }

    try {
      const { artifact, apkBuffer, projectZipBuffer } = await createAndroidReleasePackage(config);
      const apkPath = path.join(RELEASE_FOLDER, `${artifact.buildId}_${artifact.apkFilename}`);
      const projectZipPath = path.join(RELEASE_FOLDER, `${artifact.buildId}_${artifact.projectZipFilename}`);
      fs.writeFileSync(apkPath, apkBuffer);
      fs.writeFileSync(projectZipPath, projectZipBuffer);

      ANDROID_RELEASES.set(artifact.buildId, {
        artifact,
        apkPath,
        projectZipPath,
      });

      res.json({
        success: true,
        artifact,
      });
    } catch (e: unknown) {
      res.status(500).json({
        error: e instanceof Error ? e.message : 'Errore durante la build Android Release',
      });
    }
  });

  app.get('/api/android/download/:buildId/:type', (req: Request, res: Response) => {
    const entry = ANDROID_RELEASES.get(String(req.params.buildId));
    if (!entry) {
      res.status(404).send('Build non trovata');
      return;
    }
    const type = String(req.params.type);
    if (type === 'apk') {
      res.setHeader('Content-Type', 'application/vnd.android.package-archive');
      res.setHeader('Content-Disposition', `attachment; filename="${entry.artifact.apkFilename}"`);
      res.send(fs.readFileSync(entry.apkPath));
      return;
    }
    if (type === 'project') {
      res.setHeader('Content-Type', 'application/zip');
      res.setHeader('Content-Disposition', `attachment; filename="${entry.artifact.projectZipFilename}"`);
      res.send(fs.readFileSync(entry.projectZipPath));
      return;
    }
    res.status(400).send('Tipo di artefatto non valido');
  });

  // --- VITE MIDDLEWARE OR STATIC PROD ---
  if (process.env.NODE_ENV !== 'production') {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.resolve(process.cwd(), 'dist');
    app.use(express.static(distPath));
    app.get('*', (_req: Request, res: Response) => {
      res.sendFile(path.join(distPath, 'index.html'));
    });
  }

  const port = Number(process.env.PORT) || 3000;
  app.listen(port, '0.0.0.0', () => {
    console.log(`PhotoCloud Mobile & Android Studio server listening on http://0.0.0.0:${port}`);
  });
}

startServer();
