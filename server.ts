import express, { Request, Response } from 'express';
import multer from 'multer';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import JSZip from 'jszip';
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
  renderLoginTemplate,
  renderGalleryTemplate,
  renderTrashTemplate,
} from './src/lib/templateRenderer';
import {
  compileSignedAndroidApk,
  triggerGitHubActionsBuild,
  publishApkToGitHubRelease,
  GitHubReleaseStatus,
  GitHubActionsRunStatus,
} from './src/lib/githubReleasePublisher';

const UPLOAD_FOLDER = path.resolve(process.cwd(), 'user_media');
const TEMP_ZIP_FOLDER = path.resolve(process.cwd(), 'temp_zips');
const RELEASE_DIR = path.resolve(process.cwd(), 'release');
const USERS_FILE = path.resolve(process.cwd(), 'users.txt');
const STATIC_DIR = path.resolve(process.cwd(), 'static');

fs.mkdirSync(UPLOAD_FOLDER, { recursive: true });
fs.mkdirSync(TEMP_ZIP_FOLDER, { recursive: true });
fs.mkdirSync(RELEASE_DIR, { recursive: true });
if (!fs.existsSync(USERS_FILE)) {
  fs.writeFileSync(USERS_FILE, '', 'utf-8');
}

interface SessionData {
  username: string;
  apiKey: string;
}

const SESSIONS = new Map<string, SessionData>();
const ZIP_TASKS = new Map<
  string,
  {
    status: 'starting' | 'processing' | 'complete' | 'error';
    progress: number;
    filename: string | null;
    error?: string;
  }
>();

let latestReleaseStatus: GitHubReleaseStatus | null = null;

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
  // Compile the native Android APK from /android-app into /release/photocloud-release-v1.0.0-signed.apk
  // and automatically publish to GitHub Releases if GITHUB_TOKEN is configured
  try {
    const compiled = await compileSignedAndroidApk(RELEASE_DIR);
    latestReleaseStatus = await publishApkToGitHubRelease({
      apkPath: compiled.apkPath,
      sha256: compiled.sha256,
    });
  } catch (err) {
    console.error('Errore durante la compilazione/pubblicazione APK:', err);
  }

  const app = express();
  app.use(express.json());
  app.use(express.urlencoded({ extended: true }));
  app.use('/static', express.static(STATIC_DIR));
  app.use('/release', express.static(RELEASE_DIR));

  // --- ORIGINAL WEB APP ROUTES (1:1 with main.py) ---
  app.get('/', (req: Request, res: Response) => {
    const sess = getSession(req);
    if (!sess) {
      res.setHeader('Content-Type', 'text/html; charset=utf-8');
      res.send(renderLoginTemplate());
      return;
    }
    const userFolder = path.join(UPLOAD_FOLDER, sess.username);
    fs.mkdirSync(userFolder, { recursive: true });
    const mediaFiles = listMediaFiles(userFolder);
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    res.send(renderGalleryTemplate(mediaFiles));
  });

  app.get('/trash', (req: Request, res: Response) => {
    const sess = getSession(req);
    if (!sess) {
      res.redirect('/');
      return;
    }
    const trashFolder = path.join(UPLOAD_FOLDER, sess.username, 'trash');
    fs.mkdirSync(trashFolder, { recursive: true });
    const trashedFiles = listMediaFiles(trashFolder);
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    res.send(renderTrashTemplate(trashedFiles));
  });

  // --- SESSION API (Used by Native Android APK Client) ---
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

  // --- APK & GITHUB ACTIONS / RELEASE ENDPOINTS ---
  app.get('/api/release/status', (_req: Request, res: Response) => {
    res.json({
      release: latestReleaseStatus,
    });
  });

  app.get('/api/github-actions/status', async (_req: Request, res: Response) => {
    try {
      const status: GitHubActionsRunStatus = await triggerGitHubActionsBuild({
        githubToken: process.env.GITHUB_TOKEN,
      });
      res.json(status);
    } catch (e: unknown) {
      res.status(500).json({
        triggered: false,
        error: e instanceof Error ? e.message : String(e),
      });
    }
  });

  app.post('/api/github-actions/trigger', async (req: Request, res: Response) => {
    try {
      const status: GitHubActionsRunStatus = await triggerGitHubActionsBuild({
        githubToken: process.env.GITHUB_TOKEN,
        branch: req.body?.branch,
        releaseTag: req.body?.release_tag || 'v1.0.3',
      });
      res.json(status);
    } catch (e: unknown) {
      res.status(500).json({
        triggered: false,
        error: e instanceof Error ? e.message : String(e),
      });
    }
  });

  app.post('/api/release/publish', async (req: Request, res: Response) => {
    try {
      const compiled = await compileSignedAndroidApk(RELEASE_DIR);
      const token = process.env.GITHUB_TOKEN;
      const tagName = req.body?.tag_name || 'v1.0.3';
      const status = await publishApkToGitHubRelease({
        githubToken: token,
        tagName,
        apkPath: compiled.apkPath,
        sha256: compiled.sha256,
      });
      latestReleaseStatus = status;
      res.json(status);
    } catch (e: unknown) {
      res.status(500).json({
        published: false,
        error: e instanceof Error ? e.message : String(e),
      });
    }
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

    const authData = {
      username: rawUsername,
      api_key: apiKey,
      session_id: crypto.randomUUID(),
      created_at: Date.now() / 1000,
      hash_of_key: hashKey(apiKey),
    };

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

  const port = Number(process.env.PORT) || 3000;
  app.listen(port, '0.0.0.0', () => {
    console.log(`PhotoCloud server listening on http://0.0.0.0:${port}`);
  });
}

startServer();
