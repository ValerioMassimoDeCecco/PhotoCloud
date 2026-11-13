import { Router, Request, Response, NextFunction } from 'express';
import multer from 'multer';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { encryptFileAsync } from '../lib/crypto';
import { computeCloudStorageStats } from '../lib/templateRenderer';
import { parseDocumentBuffer } from '../lib/documentEngine';
import { readAndDecryptVaultFile, streamDecryptedVaultFile } from '../lib/mediaStreamer';
import {
  UPLOAD_FOLDER,
  isValidVaultFilename,
  isValidAlbumName,
  requireAuth,
  getSession,
  classifyFileExtension,
  loadUserAlbums,
  saveUserAlbums,
  listMediaFiles,
  notifyUserAsync,
  upload,
  readUploadedFileBuffer,
  cleanupUploadedFiles,
} from '../lib/serverContext';

async function handleMediaRequest(
  req: Request,
  res: Response,
  forceTrash = false,
  forceDownload = false
): Promise<void> {
  const sess = getSession(req);
  if (!sess) {
    res.status(403).send('Accesso negato');
    return;
  }

  const filename = String(req.params.filename);
  if (!isValidVaultFilename(filename)) {
    res.status(403).send('Accesso non autorizzato.');
    return;
  }

  const userFolder = path.join(UPLOAD_FOLDER, sess.username);
  const fromTrash = forceTrash || req.query.from_trash === 'true';
  const basePath = fromTrash ? path.join(userFolder, 'trash') : userFolder;

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

  const isExplicitDownload = forceDownload || req.query.download === '1' || req.query.download === 'true';
  await streamDecryptedVaultFile(req, res, {
    filePath: safeFilepath,
    filename,
    apiKey: sess.apiKey,
    isExplicitDownload,
    allowInlineSvgForImageFetch: true,
  });
}

export function createVaultMediaRouter(): Router {
  const router = Router();

  // --- UPLOAD (Supports Both Media & Non-Media Cloud Files + Optional Album + High-Volume Parallel Batches) ---
  router.post(
    '/upload',
    requireAuth,
    (req: Request, res: Response, next: NextFunction) => {
      upload.array('file[]')(req, res, (err: unknown) => {
        if (err) {
          cleanupUploadedFiles(req);
          const msg =
            err instanceof multer.MulterError
              ? `Limite upload raggiunto (${err.code}): riduci la dimensione del singolo blocco.`
              : err instanceof Error
              ? err.message
              : 'Errore lettura multipart upload';
          res.status(400).json({ error: msg });
          return;
        }
        next();
      });
    },
    async (req: Request, res: Response) => {
      try {
        const { session: sess, userFolder, trashFolder } = req.auth!;
        const files = req.files as Express.Multer.File[] | undefined;
        if (!files || files.length === 0) {
          res.status(400).json({ error: 'Nessun file' });
          return;
        }

        fs.mkdirSync(userFolder, { recursive: true });
        fs.mkdirSync(trashFolder, { recursive: true });

        const rawTimestamps = req.body?.['timestamp[]'] || req.body?.timestamp;
        const timestamps = Array.isArray(rawTimestamps)
          ? rawTimestamps
          : rawTimestamps
          ? [rawTimestamps]
          : [];

        const rawAlbum = String(req.body?.album || '').trim();
        const targetAlbum = rawAlbum && isValidAlbumName(rawAlbum) ? rawAlbum : '';
        const skipList = req.body?.skipList === '1' || req.query?.skipList === '1';
        const uploadedFilenames: string[] = [];

        for (let i = 0; i < files.length; i++) {
          const file = files[i];
          const rawOrig = path.basename(file.originalname || `file_${Date.now()}`);
          const ext = path.extname(rawOrig) || '.bin';
          const baseClean =
            path
              .basename(rawOrig, ext)
              .replace(/[^a-zA-Z0-9._-]/g, '_')
              .slice(0, 64)
              .replace(/^\.+/, '') || 'file';

          const { isMedia } = classifyFileExtension(rawOrig);
          let filename = '';
          let filepath = '';

          if (!isMedia) {
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

          const rawBuf = readUploadedFileBuffer(file);
          const encrypted = await encryptFileAsync(rawBuf, sess.apiKey);
          await fs.promises.writeFile(filepath, encrypted);
          if (file.path && fs.existsSync(file.path)) {
            try {
              await fs.promises.unlink(file.path);
            } catch {
              // ignore
            }
          }
          uploadedFilenames.push(filename);

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
        }

        if (targetAlbum && uploadedFilenames.length > 0) {
          const albumsData = loadUserAlbums(sess.username);
          if (!albumsData.albums.includes(targetAlbum)) {
            albumsData.albums.push(targetAlbum);
            albumsData.albums.sort((a, b) => a.localeCompare(b, 'it'));
          }
          for (const fn of uploadedFilenames) {
            albumsData.fileAlbums[fn] = targetAlbum;
          }
          saveUserAlbums(sess.username, albumsData);
        }

        const activeMediaFiles = skipList ? undefined : listMediaFiles(userFolder, sess.username);
        const storageStats = skipList
          ? undefined
          : computeCloudStorageStats(
              activeMediaFiles ?? listMediaFiles(userFolder, sess.username),
              listMediaFiles(trashFolder, sess.username)
            );

        res.json({
          success: true,
          uploadedCount: uploadedFilenames.length,
          uploadedFilenames,
          message: `${files.length} file caricati.`,
          mediaFiles: activeMediaFiles,
          storageStats,
        });

        if (uploadedFilenames.length > 0) {
          notifyUserAsync(
            sess.username,
            '☁️ PhotoCloud — Upload completato',
            `${uploadedFilenames.length} file caricati nel tuo archivio crittografato.`,
            'photocloud-upload'
          );
        }
      } catch (e: unknown) {
        const msg = e instanceof Error ? e.message : String(e);
        res.status(500).json({ error: `Errore durante il caricamento: ${msg}` });
      } finally {
        cleanupUploadedFiles(req);
      }
    }
  );

  // --- MEDIA EDITOR SAVE ENDPOINT (Supports Photos & Videos in "copy" and "overwrite" modes) ---
  router.post(
    '/api/media/edit',
    requireAuth,
    (req: Request, res: Response, next: NextFunction) => {
      upload.single('file')(req, res, (err: unknown) => {
        if (err) {
          cleanupUploadedFiles(req);
          res.status(400).json({ error: 'File media non valido o troppo grande.' });
          return;
        }
        next();
      });
    },
    async (req: Request, res: Response) => {
      try {
        const { session: sess, userFolder, trashFolder } = req.auth!;

        const rawOriginal = String(req.body?.originalFilename || '').trim();
        const originalFilename = isValidVaultFilename(rawOriginal) ? rawOriginal : '';
        const mode = String(req.body?.mode || 'copy').toLowerCase() === 'overwrite' ? 'overwrite' : 'copy';

        let mediaBuffer: Buffer | null = null;
        if (req.file) {
          const uploadedBuf = readUploadedFileBuffer(req.file);
          if (uploadedBuf.length > 0) {
            mediaBuffer = uploadedBuf;
          }
        } else {
          const rawB64Input =
            typeof req.body?.mediaBase64 === 'string' && req.body.mediaBase64.length > 0
              ? req.body.mediaBase64
              : typeof req.body?.imageBase64 === 'string' && req.body.imageBase64.length > 0
              ? req.body.imageBase64
              : '';
          if (rawB64Input) {
            const rawB64 = rawB64Input.replace(/^data:(image|video)\/[a-zA-Z0-9+.-]+;base64,/, '');
            mediaBuffer = Buffer.from(rawB64, 'base64');
          }
        }

        if (!mediaBuffer || mediaBuffer.length === 0) {
          res.status(400).json({ error: 'File media modificato non valido o vuoto.' });
          return;
        }

        const ALLOWED_EDIT_EXTS = new Set(['.jpg', '.jpeg', '.png', '.webp', '.mp4', '.webm', '.mov', '.mkv']);
        const VIDEO_EDIT_EXTS = new Set(['.mp4', '.webm', '.mov', '.mkv']);

        const uploadedExt = req.file?.originalname ? path.extname(req.file.originalname).toLowerCase() : '';
        const requestedExt = typeof req.body?.targetExtension === 'string'
          ? (req.body.targetExtension.startsWith('.') ? req.body.targetExtension.toLowerCase() : `.${req.body.targetExtension.toLowerCase()}`)
          : '';
        const origExt = originalFilename ? path.extname(originalFilename).toLowerCase() : '';

        const chosenExt = ALLOWED_EDIT_EXTS.has(requestedExt)
          ? requestedExt
          : ALLOWED_EDIT_EXTS.has(uploadedExt)
          ? uploadedExt
          : ALLOWED_EDIT_EXTS.has(origExt)
          ? origExt
          : '.jpg';

        const isVideo = VIDEO_EDIT_EXTS.has(chosenExt) || VIDEO_EDIT_EXTS.has(origExt);

        fs.mkdirSync(userFolder, { recursive: true });
        fs.mkdirSync(trashFolder, { recursive: true });
        const safeUserFolder = path.resolve(userFolder);

        let targetFilename = '';
        let targetFilepath = '';
        let replacedOldFilename = '';

        if (mode === 'overwrite' && originalFilename) {
          const candidatePath = path.resolve(safeUserFolder, originalFilename);
          if (candidatePath.startsWith(safeUserFolder + path.sep) && fs.existsSync(candidatePath)) {
            if (origExt && origExt !== chosenExt && VIDEO_EDIT_EXTS.has(chosenExt)) {
              // Container changed (e.g. .mp4 -> .webm from browser recorder): write with accurate extension so MIME matches
              const baseStem = path.basename(originalFilename, origExt).replace(/[^a-zA-Z0-9._-]/g, '_') || 'video';
              targetFilename = `${baseStem}${chosenExt}`;
              if (!isValidVaultFilename(targetFilename)) {
                targetFilename = `${crypto.randomBytes(8).toString('hex')}${chosenExt}`;
              }
              targetFilepath = path.resolve(safeUserFolder, targetFilename);
              replacedOldFilename = originalFilename;
            } else {
              targetFilename = originalFilename;
              targetFilepath = candidatePath;
            }
          }
        }

        if (!targetFilename) {
          while (true) {
            targetFilename = `${crypto.randomBytes(8).toString('hex')}${chosenExt}`;
            targetFilepath = path.join(safeUserFolder, targetFilename);
            if (!fs.existsSync(targetFilepath)) break;
          }
        }

        const encrypted = await encryptFileAsync(mediaBuffer, sess.apiKey);
        await fs.promises.writeFile(targetFilepath, encrypted);

        if (replacedOldFilename && replacedOldFilename !== targetFilename) {
          const oldPath = path.resolve(safeUserFolder, replacedOldFilename);
          if (oldPath.startsWith(safeUserFolder + path.sep) && fs.existsSync(oldPath)) {
            try {
              await fs.promises.unlink(oldPath);
            } catch {
              // ignore cleanup errors
            }
          }
        }

        // Preserve album assignment if original media belonged to an album
        const albumsData = loadUserAlbums(sess.username);
        if (originalFilename && albumsData.fileAlbums[originalFilename] && targetFilename !== originalFilename) {
          albumsData.fileAlbums[targetFilename] = albumsData.fileAlbums[originalFilename];
          if (replacedOldFilename && albumsData.fileAlbums[replacedOldFilename]) {
            delete albumsData.fileAlbums[replacedOldFilename];
          }
          saveUserAlbums(sess.username, albumsData);
        }

        const activeMediaFiles = listMediaFiles(userFolder, sess.username);
        const trashedMediaFiles = listMediaFiles(trashFolder, sess.username);

        res.json({
          success: true,
          mode,
          isVideo,
          filename: targetFilename,
          previousFilename: originalFilename || undefined,
          message:
            mode === 'overwrite'
              ? isVideo
                ? 'Video originale aggiornato con successo.'
                : 'Foto originale aggiornata con successo.'
              : isVideo
              ? 'Video modificato salvato come nuova copia.'
              : 'Foto modificata salvata come nuova copia.',
          mediaFiles: activeMediaFiles,
          storageStats: computeCloudStorageStats(activeMediaFiles, trashedMediaFiles),
        });
      } catch {
        res.status(500).json({ error: 'Errore salvataggio media modificato.' });
      } finally {
        cleanupUploadedFiles(req);
      }
    }
  );

  // --- DOCUMENT PREVIEW ENGINE API (PDF, Word, Excel, PowerPoint, Text/Code) ---
  router.get('/api/document-preview/:filename', requireAuth, async (req: Request, res: Response) => {
    const { session: sess, userFolder, trashFolder } = req.auth!;

    const filename = String(req.params.filename);
    if (!isValidVaultFilename(filename)) {
      res.status(403).json({ error: 'Accesso non autorizzato.' });
      return;
    }

    const fromTrash = req.query.from_trash === 'true';
    const basePath = fromTrash ? trashFolder : userFolder;

    const safeBasePath = path.resolve(basePath);
    const safeFilepath = path.resolve(safeBasePath, filename);

    if (!safeFilepath.startsWith(safeBasePath + path.sep)) {
      res.status(403).json({ error: 'Accesso non autorizzato.' });
      return;
    }

    if (!fs.existsSync(safeFilepath)) {
      res.status(404).json({ error: 'File non trovato.' });
      return;
    }

    try {
      const decrypted = await readAndDecryptVaultFile(safeFilepath, sess.apiKey);
      const preview = await parseDocumentBuffer(filename, decrypted, fromTrash);
      res.json(preview);
    } catch {
      res.status(500).json({ error: "Errore durante l'apertura del documento." });
    }
  });

  // --- MEDIA & CLOUD FILE DECRYPTION ---
  router.get('/media/:filename', (req: Request, res: Response) => {
    void handleMediaRequest(req, res, false, false);
  });

  router.get('/trash/media/:filename', (req: Request, res: Response) => {
    void handleMediaRequest(req, res, true, true);
  });

  return router;
}
