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
  encryptedPlaintextSize,
  calculateBufferHash,
  findDuplicateGroups,
} from './src/lib/crypto';
import {
  renderLoginTemplate,
  renderGalleryTemplate,
  renderTrashTemplate,
} from './src/lib/templateRenderer';
import { FileCategory, MediaItem } from './src/types';

const UPLOAD_FOLDER = path.resolve(process.cwd(), 'user_media');
const RELEASE_DIR = path.resolve(process.cwd(), 'release');
const USERS_FILE = path.resolve(process.cwd(), 'users.txt');
const STATIC_DIR = path.resolve(process.cwd(), 'static');

fs.mkdirSync(UPLOAD_FOLDER, { recursive: true });
fs.mkdirSync(RELEASE_DIR, { recursive: true });
if (!fs.existsSync(USERS_FILE)) {
  fs.writeFileSync(USERS_FILE, '', 'utf-8');
}

interface SessionData {
  username: string;
  apiKey: string;
  expiresAt: number;
}

interface UserAlbumsData {
  albums: string[];
  fileAlbums: Record<string, string>;
}

const SESSIONS = new Map<string, SessionData>();
const ZIP_TASKS = new Map<
  string,
  {
    owner: string;
    buffer?: Buffer;
    status: 'starting' | 'processing' | 'complete' | 'error';
    progress: number;
    filename: string | null;
    totalBytes?: number;
    processedBytes?: number;
    error?: string;
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
  const session = SESSIONS.get(sid);
  if (session && session.expiresAt <= Date.now()) { SESSIONS.delete(sid); return null; }
  return session ?? null;
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

const MEDIA_EXTENSIONS = new Set(['.jpg', '.jpeg', '.png', '.gif', '.webp', '.bmp', '.heic', '.mp4', '.mov', '.webm', '.mkv']);
const DOC_EXTENSIONS = new Set(['.pdf', '.doc', '.docx', '.xls', '.xlsx', '.ppt', '.pptx', '.odt', '.ods', '.rtf', '.txt', '.md', '.csv']);
const ARCHIVE_EXTENSIONS = new Set(['.zip', '.rar', '.7z', '.tar', '.gz', '.bz2', '.apk', '.iso', '.dmg', '.exe']);
const AUDIO_EXTENSIONS = new Set(['.mp3', '.wav', '.flac', '.aac', '.ogg', '.m4a', '.opus']);
const CODE_EXTENSIONS = new Set(['.json', '.xml', '.yaml', '.yml', '.js', '.ts', '.py', '.kt', '.java', '.html', '.css', '.sql', '.sh']);

export function classifyFileExtension(filename: string): { isMedia: boolean; category: FileCategory } {
  const ext = path.extname(filename).toLowerCase();
  if (MEDIA_EXTENSIONS.has(ext)) return { isMedia: true, category: 'media' };
  if (DOC_EXTENSIONS.has(ext)) return { isMedia: false, category: 'document' };
  if (ARCHIVE_EXTENSIONS.has(ext)) return { isMedia: false, category: 'archive' };
  if (AUDIO_EXTENSIONS.has(ext)) return { isMedia: false, category: 'audio' };
  if (CODE_EXTENSIONS.has(ext)) return { isMedia: false, category: 'code' };
  return { isMedia: false, category: 'other' };
}

function getAlbumsFilePath(username: string): string {
  return path.join(UPLOAD_FOLDER, username, '.albums.json');
}

function loadUserAlbums(username: string): UserAlbumsData {
  const p = getAlbumsFilePath(username);
  if (!fs.existsSync(p)) {
    return { albums: [], fileAlbums: {} };
  }
  try {
    const raw = JSON.parse(fs.readFileSync(p, 'utf-8')) as Partial<UserAlbumsData>;
    return {
      albums: Array.isArray(raw.albums) ? raw.albums : [],
      fileAlbums: raw.fileAlbums && typeof raw.fileAlbums === 'object' ? raw.fileAlbums : {},
    };
  } catch {
    return { albums: [], fileAlbums: {} };
  }
}

function saveUserAlbums(username: string, data: UserAlbumsData): void {
  const userFolder = path.join(UPLOAD_FOLDER, username);
  fs.mkdirSync(userFolder, { recursive: true });
  fs.writeFileSync(getAlbumsFilePath(username), JSON.stringify(data, null, 2), 'utf-8');
}

function listMediaFiles(folderPath: string, username?: string): MediaItem[] {
  if (!fs.existsSync(folderPath)) return [];
  const files = fs.readdirSync(folderPath);
  const albumsData = username ? loadUserAlbums(username) : { albums: [], fileAlbums: {} };
  const details: MediaItem[] = [];
  for (const f of files) {
    if (f.startsWith('.')) continue; // skip .albums.json and hidden files
    const full = path.join(folderPath, f);
    let stat: fs.Stats;
    try {
      stat = fs.statSync(full);
    } catch {
      continue;
    }
    if (stat.isFile()) {
      const { isMedia, category } = classifyFileExtension(f);
      const fd = fs.openSync(full, 'r');
      const header = Buffer.alloc(Math.min(stat.size, 18));
      try { fs.readSync(fd, header, 0, header.length, 0); } finally { fs.closeSync(fd); }
      const overhead = header.equals(Buffer.from('PhotoCloud-GCM-v1\0')) ? 62 : 32;
      const originalApproxSize = Math.max(0, stat.size - overhead);
      details.push({
        filename: f,
        timestamp: stat.mtimeMs / 1000,
        size: originalApproxSize,
        isMedia,
        category,
        album: albumsData.fileAlbums[f] || '',
      });
    }
  }
  details.sort((a, b) => b.timestamp - a.timestamp);
  return details;
}

const upload = multer({ storage: multer.memoryStorage() });

async function startServer() {
  const app = express();
  app.use(express.json({ limit: '50mb' }));
  app.use(express.urlencoded({ extended: true, limit: '50mb' }));
  app.use('/static', express.static(STATIC_DIR));
  app.use(express.static(path.resolve(process.cwd(), 'public'), { index: false }));
  app.use('/release', express.static(RELEASE_DIR));

  // --- ORIGINAL WEB APP ROUTES + CLOUD FILE MANAGER & ALBUMS ---
  app.get('/', (req: Request, res: Response) => {
    const sess = getSession(req);
    if (!sess) {
      res.setHeader('Content-Type', 'text/html; charset=utf-8');
      res.send(renderLoginTemplate());
      return;
    }
    const userFolder = path.join(UPLOAD_FOLDER, sess.username);
    fs.mkdirSync(userFolder, { recursive: true });
    const allFiles = listMediaFiles(userFolder, sess.username);
    const albumsData = loadUserAlbums(sess.username);
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    res.send(renderGalleryTemplate(allFiles, albumsData.albums));
  });

  app.get('/trash', (req: Request, res: Response) => {
    const sess = getSession(req);
    if (!sess) {
      res.redirect('/');
      return;
    }
    const trashFolder = path.join(UPLOAD_FOLDER, sess.username, 'trash');
    fs.mkdirSync(trashFolder, { recursive: true });
    const trashedFiles = listMediaFiles(trashFolder, sess.username);
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    res.send(renderTrashTemplate(trashedFiles));
  });

  // --- SESSION & ALBUMS API (Used by Web & Native Android APK Client) ---
  app.get('/api/session', (req: Request, res: Response) => {
    const sess = getSession(req);
    if (!sess) {
      res.json({ authenticated: false });
      return;
    }
    const userFolder = path.join(UPLOAD_FOLDER, sess.username);
    const trashFolder = path.join(userFolder, 'trash');
    const albumsData = loadUserAlbums(sess.username);
    res.json({
      authenticated: true,
      username: sess.username,
      mediaFiles: listMediaFiles(userFolder, sess.username),
      trashedFiles: listMediaFiles(trashFolder, sess.username),
      albums: albumsData.albums,
      fileAlbums: albumsData.fileAlbums,
    });
  });

  app.get('/api/albums', (req: Request, res: Response) => {
    const sess = getSession(req);
    if (!sess) {
      res.status(403).json({ error: 'Accesso negato' });
      return;
    }
    res.json(loadUserAlbums(sess.username));
  });

  app.post('/api/albums/create', (req: Request, res: Response) => {
    const sess = getSession(req);
    if (!sess) {
      res.status(403).json({ error: 'Accesso negato' });
      return;
    }
    const rawName = String(req.body?.name || '').trim();
    if (!rawName) {
      res.status(400).json({ error: 'Nome album non valido' });
      return;
    }
    const data = loadUserAlbums(sess.username);
    if (!data.albums.includes(rawName)) {
      data.albums.push(rawName);
      data.albums.sort((a, b) => a.localeCompare(b, 'it'));
      saveUserAlbums(sess.username, data);
    }
    res.json({ success: true, ...data });
  });

  app.post('/api/albums/assign', (req: Request, res: Response) => {
    const sess = getSession(req);
    if (!sess) {
      res.status(403).json({ error: 'Accesso negato' });
      return;
    }
    const filenames: string[] = Array.isArray(req.body?.filenames) ? req.body.filenames : [];
    const albumName = String(req.body?.album || '').trim();
    const data = loadUserAlbums(sess.username);

    if (albumName && !data.albums.includes(albumName)) {
      data.albums.push(albumName);
      data.albums.sort((a, b) => a.localeCompare(b, 'it'));
    }

    for (const fn of filenames) {
      if (albumName) {
        data.fileAlbums[fn] = albumName;
      } else {
        delete data.fileAlbums[fn];
      }
    }
    saveUserAlbums(sess.username, data);
    res.json({ success: true, ...data });
  });

  app.post('/api/albums/delete', (req: Request, res: Response) => {
    const sess = getSession(req);
    if (!sess) {
      res.status(403).json({ error: 'Accesso negato' });
      return;
    }
    const albumName = String(req.body?.name || '').trim();
    const data = loadUserAlbums(sess.username);
    data.albums = data.albums.filter((a) => a !== albumName);
    for (const [fn, alb] of Object.entries(data.fileAlbums)) {
      if (alb === albumName) {
        delete data.fileAlbums[fn];
      }
    }
    saveUserAlbums(sess.username, data);
    res.json({ success: true, ...data });
  });

  // --- APK & GITHUB ACTIONS / RELEASE ENDPOINTS ---
  // Release publishing is deliberately not exposed over HTTP. Use the CLI/workflow.
  app.all(['/api/release/status', '/api/github-actions/status', '/api/github-actions/trigger', '/api/release/publish'], (_req, res) => {
    res.status(410).json({ error: 'Gestione release disponibile solo tramite CLI o GitHub Actions.' });
  });

  // --- REGISTRATION ---
  app.post('/register', upload.none(), (req: Request, res: Response) => {
    const rawUsername = typeof req.body?.username === 'string' ? req.body.username.trim() : '';
    if (!/^[a-zA-Z0-9_-]{1,64}$/.test(rawUsername)) {
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

    const username = typeof authData?.username === 'string' ? authData.username.trim() : '';
    const apiKey = authData?.api_key;
    if (!username || username === '.' || username === '..' || /[\/\\:\x00-\x1f\x7f]/.test(username) || typeof apiKey !== 'string' || !apiKey) {
      res.status(400).send('File di autenticazione non valido.');
      return;
    }

    const storedHash = findUser(username);
    if (storedHash && verifyKey(apiKey, storedHash)) {
      const sid = crypto.randomUUID();
      SESSIONS.set(sid, { username, apiKey, expiresAt: Date.now() + 86400000 });
      res.setHeader(
        'Set-Cookie',
        `photocloud_sid=${sid}; Path=/; HttpOnly; SameSite=Lax; Max-Age=86400${req.secure ? "; Secure" : ""}`
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
    const sid = cookies['photocloud_sid'] || (req.headers['x-session-id'] as string);
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

  // --- UPLOAD (Supports Both Media & Non-Media Cloud Files + Optional Album) ---
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

    const targetAlbum = String(req.body?.album || '').trim();
    const albumsData = loadUserAlbums(sess.username);
    if (targetAlbum && !albumsData.albums.includes(targetAlbum)) {
      albumsData.albums.push(targetAlbum);
      albumsData.albums.sort((a, b) => a.localeCompare(b, 'it'));
    }

    try {
      files.forEach((file, i) => {
        const rawOrig = path.basename(file.originalname || `file_${Date.now()}`);
        const ext = path.extname(rawOrig) || '.bin';
        const baseClean = path
          .basename(rawOrig, ext)
          .replace(/[^a-zA-Z0-9._-]/g, '_')
          .slice(0, 64).replace(/^\.+/, '') || 'file';

        const { isMedia } = classifyFileExtension(rawOrig);
        let filename = '';
        let filepath = '';

        if (!isMedia) {
          // For Cloud File Manager non-media files, preserve readable filename
          const candidate = `${baseClean}${ext}`;
          if (!fs.existsSync(path.join(userFolder, candidate))) {
            filename = candidate;
            filepath = path.join(userFolder, candidate);
          }
        }

        if (!filename) {
          while (true) {
            const suffix = crypto.randomBytes(4).toString('hex');
            filename = isMedia ? `${crypto.randomBytes(8).toString('hex')}${ext}` : `${baseClean}_${suffix}${ext}`;
            filepath = path.join(userFolder, filename);
            if (!fs.existsSync(filepath)) break;
          }
        }

        const encrypted = encryptFile(file.buffer, sess.apiKey);
        fs.writeFileSync(filepath, encrypted);

        if (targetAlbum) {
          albumsData.fileAlbums[filename] = targetAlbum;
        }

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

      if (targetAlbum) {
        saveUserAlbums(sess.username, albumsData);
      }

      res.json({
        success: true,
        message: `${files.length} file caricati.`,
        mediaFiles: listMediaFiles(userFolder, sess.username),
      });
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      res.status(500).json({ error: `Errore durante il caricamento: ${msg}` });
    }
  });

  // --- PHOTO EDITOR SAVE ENDPOINT (Supports "copy" and "overwrite" modes) ---
  app.post('/api/media/edit', upload.single('file'), (req: Request, res: Response) => {
    const sess = getSession(req);
    if (!sess) {
      res.status(403).json({ error: 'Accesso negato' });
      return;
    }

    const originalFilename = path.basename(String(req.body?.originalFilename || '').trim());
    const mode = String(req.body?.mode || 'copy').toLowerCase() === 'overwrite' ? 'overwrite' : 'copy';

    let imageBuffer: Buffer | null = null;
    if (req.file && req.file.buffer && req.file.buffer.length > 0) {
      imageBuffer = req.file.buffer;
    } else if (typeof req.body?.imageBase64 === 'string' && req.body.imageBase64.length > 0) {
      const rawB64 = req.body.imageBase64.replace(/^data:image\/[a-zA-Z0-9+.-]+;base64,/, '');
      imageBuffer = Buffer.from(rawB64, 'base64');
    }

    if (!imageBuffer || imageBuffer.length === 0) {
      res.status(400).json({ error: 'Immagine modificata non valida o vuota.' });
      return;
    }

    const userFolder = path.join(UPLOAD_FOLDER, sess.username);
    fs.mkdirSync(userFolder, { recursive: true });
    const safeUserFolder = path.resolve(userFolder);

    try {
      let targetFilename = '';
      let targetFilepath = '';

      if (mode === 'overwrite' && originalFilename) {
        const candidatePath = path.resolve(safeUserFolder, originalFilename);
        if (candidatePath.startsWith(safeUserFolder + path.sep) && fs.existsSync(candidatePath)) {
          targetFilename = originalFilename;
          targetFilepath = candidatePath;
        }
      }

      if (!targetFilename) {
        const ext = path.extname(originalFilename || '.jpg') || '.jpg';
        const safeExt = ['.jpg', '.jpeg', '.png', '.webp'].includes(ext.toLowerCase()) ? ext : '.jpg';
        while (true) {
          targetFilename = `${crypto.randomBytes(8).toString('hex')}${safeExt}`;
          targetFilepath = path.join(safeUserFolder, targetFilename);
          if (!fs.existsSync(targetFilepath)) break;
        }
      }

      const encrypted = encryptFile(imageBuffer, sess.apiKey);
      fs.writeFileSync(targetFilepath, encrypted);

      // Preserve album assignment if original photo belonged to an album
      const albumsData = loadUserAlbums(sess.username);
      if (originalFilename && albumsData.fileAlbums[originalFilename] && targetFilename !== originalFilename) {
        albumsData.fileAlbums[targetFilename] = albumsData.fileAlbums[originalFilename];
        saveUserAlbums(sess.username, albumsData);
      }

      res.json({
        success: true,
        mode,
        filename: targetFilename,
        message:
          mode === 'overwrite'
            ? 'Foto originale aggiornata con successo.'
            : 'Foto modificata salvata come nuova copia.',
        mediaFiles: listMediaFiles(userFolder, sess.username),
      });
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      res.status(500).json({ error: `Errore salvataggio foto modificata: ${msg}` });
    }
  });

  // --- MEDIA & CLOUD FILE DECRYPTION ---
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
        bmp: 'image/bmp',
        mp4: 'video/mp4',
        mov: 'video/mp4',
        webm: 'video/webm',
        mkv: 'video/x-matroska',
        pdf: 'application/pdf',
        txt: 'text/plain; charset=utf-8',
        md: 'text/markdown; charset=utf-8',
        csv: 'text/csv; charset=utf-8',
        json: 'application/json; charset=utf-8',
        xml: 'application/xml; charset=utf-8',
        zip: 'application/zip',
        rar: 'application/vnd.rar',
        '7z': 'application/x-7z-compressed',
        apk: 'application/vnd.android.package-archive',
        mp3: 'audio/mpeg',
        wav: 'audio/wav',
        ogg: 'audio/ogg',
        flac: 'audio/flac',
        doc: 'application/msword',
        docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
        xls: 'application/vnd.ms-excel',
        xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        ppt: 'application/vnd.ms-powerpoint',
        pptx: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
      };
      res.setHeader('Content-Type', mimeMap[ext] || 'application/octet-stream');
      res.setHeader('Content-Length', String(decrypted.length));
      if (req.query.download === '1' || req.query.download === 'true') {
        res.setHeader(
          'Content-Disposition',
          `attachment; filename="${encodeURIComponent(filename)}"`
        );
      }
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
          if (fs.existsSync(dest)) throw new Error('Un file con questo nome è già nel cestino');
          fs.renameSync(safePath, dest);
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
      if (fs.existsSync(dest)) { res.status(409).json({ success: false, error: 'Un file con questo nome è già nel cestino' }); return; }
      fs.renameSync(safeFilepath, dest);
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
      if (fs.existsSync(dest)) { res.status(409).json({ success: false, error: 'Un file con questo nome esiste già nell’archivio' }); return; }
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
      const data = loadUserAlbums(sess.username);
      if (data.fileAlbums[filename]) {
        delete data.fileAlbums[filename];
        saveUserAlbums(sess.username, data);
      }
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
    const files = listMediaFiles(userFolder, sess.username);
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
    ZIP_TASKS.set(taskId, {
      owner: sess.username,
      status: 'starting',
      progress: 0,
      filename: null,
      totalBytes: 0,
      processedBytes: 0,
    });

    const expiry = setTimeout(() => {
      ZIP_TASKS.delete(taskId);
    }, 60 * 60 * 1000);
    expiry.unref();

    (async () => {
      try {
        const zip = new JSZip();
        const total = filenames.length;
        let processedBytes = 0;
        let totalBytes = 0;
        for (const fname of filenames) {
          const sp = path.resolve(userFolder, fname);
          if (sp.startsWith(userFolder + path.sep) && fs.existsSync(sp)) {
            totalBytes += encryptedPlaintextSize(fs.readFileSync(sp));
          }
        }
        for (let i = 0; i < total; i++) {
          const fname = filenames[i];
          const progress = Math.round(((i + 1) / total) * 100);
          const safePath = path.resolve(userFolder, fname);
          if (safePath.startsWith(userFolder + path.sep) && fs.existsSync(safePath)) {
            const enc = fs.readFileSync(safePath);
            const dec = decryptFile(enc, sess.apiKey);
            processedBytes += dec.length;
            zip.file(path.basename(fname), dec);
          }
          ZIP_TASKS.set(taskId, {
            owner: sess.username,
            status: 'processing',
            progress,
            filename: null,
            totalBytes,
            processedBytes,
          });
        }
        const zipFilename = `${taskId}.zip`;
        const buf = await zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE' });
        ZIP_TASKS.set(taskId, {
          owner: sess.username,
          buffer: buf,
          status: 'complete',
          progress: 100,
          filename: zipFilename,
          totalBytes: buf.length,
          processedBytes: buf.length,
        });
      } catch (err: unknown) {
        ZIP_TASKS.set(taskId, {
          owner: sess.username,
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
    const info = ZIP_TASKS.get(String(req.params.taskId));
    if (!info || info.owner !== sess.username) { res.status(404).json({ status: 'not_found', progress: 0 }); return; }
    const { owner, buffer, ...publicInfo } = info;
    res.json(publicInfo);
  });

  app.get('/download-zip/:filename', (req: Request, res: Response) => {
    const sess = getSession(req);
    if (!sess) {
      res.status(403).send('Accesso negato');
      return;
    }
    const filename = String(req.params.filename);
    const taskId = path.parse(filename).name;
    const task = ZIP_TASKS.get(taskId);
    if (!task || task.owner !== sess.username || task.filename !== filename || task.status !== 'complete') {
      res.status(404).send('File non trovato'); return;
    }
    const zipBytes = task.buffer;
    if (!zipBytes) { res.status(404).send('File non trovato'); return; }
    ZIP_TASKS.delete(taskId);

    res.setHeader('Content-Type', 'application/zip');
    res.setHeader('Content-Length', String(zipBytes.length));
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.send(zipBytes);
  });

  const port = Number(process.env.PORT) || 3000;
  app.listen(port, '0.0.0.0', () => {
    console.log(`PhotoCloud server listening on http://0.0.0.0:${port}`);
  });
}

startServer();
