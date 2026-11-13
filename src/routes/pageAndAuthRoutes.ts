import { Router, Request, Response, NextFunction } from 'express';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { generateApiKey, hashKey, verifyKey } from '../lib/crypto';
import {
  renderLoginTemplate,
  renderGalleryTemplate,
  renderTrashTemplate,
  computeCloudStorageStats,
} from '../lib/templateRenderer';
import { renderMapPage } from '../lib/mapPage';
import {
  UPLOAD_FOLDER,
  SESSIONS,
  LOGIN_ATTEMPTS,
  REGISTER_ATTEMPTS,
  DUMMY_KEY_HASH,
  parseCookies,
  getSession,
  findUser,
  saveUser,
  loadUserAlbums,
  loadUserFavorites,
  listMediaFiles,
  upload,
  readUploadedFileBuffer,
  cleanupUploadedFiles,
} from '../lib/serverContext';

export function createPageAndAuthRouter(): Router {
  const router = Router();

  // --- ORIGINAL WEB APP ROUTES + CLOUD FILE MANAGER & ALBUMS ---
  router.get('/', (req: Request, res: Response) => {
    const sess = getSession(req);
    if (!sess) {
      res.setHeader('Content-Type', 'text/html; charset=utf-8');
      res.send(renderLoginTemplate());
      return;
    }
    const userFolder = path.join(UPLOAD_FOLDER, sess.username);
    const trashFolder = path.join(userFolder, 'trash');
    fs.mkdirSync(userFolder, { recursive: true });
    fs.mkdirSync(trashFolder, { recursive: true });
    const allFiles = listMediaFiles(userFolder, sess.username);
    const trashedFiles = listMediaFiles(trashFolder, sess.username);
    const albumsData = loadUserAlbums(sess.username);
    const favorites = [...loadUserFavorites(sess.username)];
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    res.send(renderGalleryTemplate(allFiles, albumsData.albums, trashedFiles, favorites));
  });

  router.get('/login', (_req: Request, res: Response) => {
    res.redirect('/');
  });

  router.get('/trash', (req: Request, res: Response) => {
    const sess = getSession(req);
    if (!sess) {
      res.redirect('/');
      return;
    }
    const userFolder = path.join(UPLOAD_FOLDER, sess.username);
    const trashFolder = path.join(userFolder, 'trash');
    fs.mkdirSync(userFolder, { recursive: true });
    fs.mkdirSync(trashFolder, { recursive: true });
    const activeFiles = listMediaFiles(userFolder, sess.username);
    const trashedFiles = listMediaFiles(trashFolder, sess.username);
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    res.send(renderTrashTemplate(trashedFiles, activeFiles));
  });

  // --- SESSION API (Used by Web & Native Android APK Client) ---
  router.get('/api/session', (req: Request, res: Response) => {
    const sess = getSession(req);
    if (!sess) {
      res.json({ authenticated: false });
      return;
    }
    const userFolder = path.join(UPLOAD_FOLDER, sess.username);
    const trashFolder = path.join(userFolder, 'trash');
    const albumsData = loadUserAlbums(sess.username);
    const activeMediaFiles = listMediaFiles(userFolder, sess.username);
    const trashedMediaFiles = listMediaFiles(trashFolder, sess.username);
    const favorites = [...loadUserFavorites(sess.username)].filter(
      (f) =>
        activeMediaFiles.some((m) => m.filename === f) || trashedMediaFiles.some((m) => m.filename === f)
    );
    res.json({
      authenticated: true,
      username: sess.username,
      media: activeMediaFiles,
      mediaFiles: activeMediaFiles,
      trashedFiles: trashedMediaFiles,
      albums: albumsData.albums,
      fileAlbums: albumsData.fileAlbums,
      favorites,
      storageStats: computeCloudStorageStats(activeMediaFiles, trashedMediaFiles),
    });
  });

  // Pagina dedicata: mappa interattiva (tile pubbliche OpenStreetMap)
  router.get('/map', (req: Request, res: Response) => {
    const sess = getSession(req);
    if (!sess) {
      res.redirect('/');
      return;
    }
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    res.send(renderMapPage(sess.username));
  });

  // --- REGISTRATION ---
  router.post(
    '/register',
    (req: Request, res: Response, next: NextFunction) => {
      upload.none()(req, res, (err: unknown) => {
        if (err) {
          res.status(400).send('Richiesta di registrazione non valida.');
          return;
        }
        next();
      });
    },
    (req: Request, res: Response) => {
      const clientIp = String(req.ip || req.socket.remoteAddress || 'unknown');
      const now = Date.now();
      const regAttempt = REGISTER_ATTEMPTS.get(clientIp);
      if (regAttempt && regAttempt.resetAt > now && regAttempt.count >= 25) {
        res.status(429).send('Troppe registrazioni da questo indirizzo. Riprova più tardi.');
        return;
      }

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

      const nextRegCount = regAttempt && regAttempt.resetAt > now ? regAttempt.count + 1 : 1;
      REGISTER_ATTEMPTS.set(clientIp, { count: nextRegCount, resetAt: now + 15 * 60 * 1000 });

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
    }
  );

  // --- LOGIN ---
  const sendLoginError = (req: Request, res: Response, statusCode: number, message: string) => {
    const accept = String(req.headers.accept || '');
    if (accept.includes('text/html') && !accept.includes('application/json')) {
      res.status(statusCode).setHeader('Content-Type', 'text/html; charset=utf-8');
      res.send(renderLoginTemplate(message));
      return;
    }
    res.status(statusCode).send(message);
  };

  router.post(
    '/login',
    (req: Request, res: Response, next: NextFunction) => {
      upload.single('auth_file')(req, res, (err: unknown) => {
        if (err) {
          cleanupUploadedFiles(req);
          sendLoginError(req, res, 400, 'File di autenticazione non valido o troppo grande.');
          return;
        }
        next();
      });
    },
    (req: Request, res: Response) => {
      try {
        let authData: { username?: string; api_key?: string } | null = null;

        if (req.file) {
          try {
            const buf = readUploadedFileBuffer(req.file);
            authData = JSON.parse(buf.toString('utf-8'));
          } catch {
            sendLoginError(req, res, 400, 'File di autenticazione non valido.');
            return;
          }
        } else if (req.body?.username && req.body?.api_key) {
          authData = { username: req.body.username, api_key: req.body.api_key };
        } else {
          sendLoginError(req, res, 400, 'File di autenticazione non trovato.');
          return;
        }

        const username = typeof authData?.username === 'string' ? authData.username.trim() : '';
        const apiKey = authData?.api_key;
        if (
          !username ||
          username === '.' ||
          username === '..' ||
          /[\/\\:\x00-\x1f\x7f]/.test(username) ||
          typeof apiKey !== 'string' ||
          !apiKey
        ) {
          sendLoginError(req, res, 400, 'File di autenticazione non valido.');
          return;
        }

        const clientIp = String(req.ip || req.socket.remoteAddress || 'unknown');
        const rateKey = `${clientIp}:${username}`;
        const now = Date.now();
        const attemptEntry = LOGIN_ATTEMPTS.get(rateKey);
        if (attemptEntry && attemptEntry.resetAt > now && attemptEntry.count >= 20) {
          sendLoginError(req, res, 429, 'Troppi tentativi di accesso falliti. Riprova più tardi.');
          return;
        }

        const storedHash = findUser(username);
        const isValid = storedHash ? verifyKey(apiKey, storedHash) : verifyKey(apiKey, DUMMY_KEY_HASH) && false;

        if (isValid) {
          LOGIN_ATTEMPTS.delete(rateKey);
          const sid = crypto.randomUUID();
          SESSIONS.set(sid, { username, apiKey, expiresAt: Date.now() + 86400000 });
          res.setHeader(
            'Set-Cookie',
            `photocloud_sid=${sid}; Path=/; HttpOnly; SameSite=Lax; Max-Age=86400${req.secure ? '; Secure' : ''}`
          );
          if (req.headers.accept?.includes('application/json')) {
            res.json({ success: true, username });
            return;
          }
          res.redirect('/');
        } else {
          const currentCount = attemptEntry && attemptEntry.resetAt > now ? attemptEntry.count + 1 : 1;
          LOGIN_ATTEMPTS.set(rateKey, { count: currentCount, resetAt: now + 15 * 60 * 1000 });
          sendLoginError(req, res, 401, 'Credenziali non valide.');
        }
      } finally {
        cleanupUploadedFiles(req);
      }
    }
  );

  // --- LOGOUT ---
  router.post('/logout', (req: Request, res: Response) => {
    const cookies = parseCookies(req.headers.cookie);
    const sid = cookies['photocloud_sid'] || (req.headers['x-session-id'] as string);
    if (sid) {
      SESSIONS.delete(sid);
    }
    res.setHeader(
      'Set-Cookie',
      `photocloud_sid=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0${req.secure ? '; Secure' : ''}`
    );
    if (req.headers.accept?.includes('application/json')) {
      res.json({ success: true });
      return;
    }
    res.redirect('/');
  });

  return router;
}
