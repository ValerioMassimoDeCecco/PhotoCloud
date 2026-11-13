import { Router, Request, Response } from 'express';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import JSZip from 'jszip';
import {
  decryptFileAsync,
  calculateBufferHash,
  findDuplicateGroups,
} from '../lib/crypto';
import {
  UPLOAD_FOLDER,
  TEMP_UPLOAD_DIR,
  ZIP_TASKS,
  UUID_REGEX,
  isValidVaultFilename,
  requireAuth,
  getSession,
  loadUserAlbums,
  saveUserAlbums,
  getEncryptedFilePlaintextSize,
  listMediaFiles,
  notifyUserAsync,
} from '../lib/serverContext';

type VaultFileOpMode = 'trash' | 'restore' | 'permanent';

interface VaultFileOpItemResult {
  filename: string;
  ok: boolean;
  statusCode: number;
  error?: string;
  batchError?: string;
}

function removeVaultMetadataForDeletedFiles(username: string, deletedFilenames: string[]): void {
  if (deletedFilenames.length === 0) return;

  const albumsData = loadUserAlbums(username);
  let albumsModified = false;
  for (const fn of deletedFilenames) {
    if (albumsData.fileAlbums[fn]) {
      delete albumsData.fileAlbums[fn];
      albumsModified = true;
    }
  }
  if (albumsModified) {
    saveUserAlbums(username, albumsData);
  }
}

function executeTrashStrategy(userFolder: string, trashFolder: string, filename: string): VaultFileOpItemResult {
  if (!isValidVaultFilename(filename)) {
    return {
      filename,
      ok: false,
      statusCode: 403,
      error: 'Accesso non autorizzato',
      batchError: `File '${filename}' non trovato o non valido`,
    };
  }
  const safeFilepath = path.resolve(userFolder, filename);
  if (!safeFilepath.startsWith(userFolder + path.sep)) {
    return {
      filename,
      ok: false,
      statusCode: 403,
      error: 'Accesso non autorizzato',
      batchError: `File '${filename}' non trovato o non valido`,
    };
  }
  if (!fs.existsSync(safeFilepath)) {
    return {
      filename,
      ok: false,
      statusCode: 404,
      error: 'File non trovato',
      batchError: `File '${filename}' non trovato o non valido`,
    };
  }
  try {
    fs.mkdirSync(trashFolder, { recursive: true });
    const dest = path.join(trashFolder, path.basename(filename));
    if (fs.existsSync(dest)) {
      return {
        filename,
        ok: false,
        statusCode: 409,
        error: 'Un file con questo nome è già nel cestino',
        batchError: `Errore su ${filename}: Un file con questo nome è già nel cestino`,
      };
    }
    fs.renameSync(safeFilepath, dest);
    return { filename, ok: true, statusCode: 200 };
  } catch (err: unknown) {
    return {
      filename,
      ok: false,
      statusCode: 500,
      error: 'Impossibile spostare il file nel cestino.',
      batchError: `Errore su ${filename}: ${err instanceof Error ? err.message : String(err)}`,
    };
  }
}

function executeRestoreStrategy(userFolder: string, trashFolder: string, filename: string): VaultFileOpItemResult {
  if (!isValidVaultFilename(filename)) {
    return { filename, ok: false, statusCode: 403, error: 'File non trovato o accesso negato' };
  }
  const safeFilepath = path.resolve(trashFolder, filename);
  if (!safeFilepath.startsWith(trashFolder + path.sep) || !fs.existsSync(safeFilepath)) {
    return { filename, ok: false, statusCode: 404, error: 'File non trovato o accesso negato' };
  }
  try {
    const dest = path.join(userFolder, path.basename(filename));
    if (fs.existsSync(dest)) {
      return { filename, ok: false, statusCode: 409, error: 'Un file con questo nome esiste già nell’archivio' };
    }
    fs.renameSync(safeFilepath, dest);
    return { filename, ok: true, statusCode: 200 };
  } catch {
    return { filename, ok: false, statusCode: 500, error: 'Impossibile ripristinare il file.' };
  }
}

function executePermanentDeleteStrategy(
  username: string,
  trashFolder: string,
  filename: string
): VaultFileOpItemResult {
  if (!isValidVaultFilename(filename)) {
    return { filename, ok: false, statusCode: 403, error: 'File non trovato o accesso negato' };
  }
  const safeFilepath = path.resolve(trashFolder, filename);
  if (!safeFilepath.startsWith(trashFolder + path.sep) || !fs.existsSync(safeFilepath)) {
    return { filename, ok: false, statusCode: 404, error: 'File non trovato o accesso negato' };
  }
  try {
    fs.unlinkSync(safeFilepath);
    removeVaultMetadataForDeletedFiles(username, [filename]);
    return { filename, ok: true, statusCode: 200 };
  } catch {
    return { filename, ok: false, statusCode: 500, error: 'Impossibile eliminare definitivamente il file.' };
  }
}

function moveOrDeleteVaultFiles(
  username: string,
  filenames: string[],
  mode: VaultFileOpMode
): { succeeded: string[]; results: VaultFileOpItemResult[] } {
  const userFolder = path.resolve(UPLOAD_FOLDER, username);
  const trashFolder = path.resolve(userFolder, 'trash');
  const results: VaultFileOpItemResult[] = [];
  const succeeded: string[] = [];

  if (mode === 'trash') {
    fs.mkdirSync(trashFolder, { recursive: true });
  }

  for (const filename of filenames) {
    const result =
      mode === 'trash'
        ? executeTrashStrategy(userFolder, trashFolder, filename)
        : mode === 'restore'
        ? executeRestoreStrategy(userFolder, trashFolder, filename)
        : executePermanentDeleteStrategy(username, trashFolder, filename);
    results.push(result);
    if (result.ok) succeeded.push(filename);
  }

  return { succeeded, results };
}

export function createTrashAndExportRouter(): Router {
  const router = Router();

  // --- TRASH OPERATIONS ---
  // IMPORTANT: /trash/batch must stay registered before /trash/:filename
  router.post('/trash/batch', (req: Request, res: Response) => {
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

    const { succeeded, results } = moveOrDeleteVaultFiles(
      sess.username,
      filenames.map((f) => String(f)),
      'trash'
    );
    const errors = results.filter((r) => !r.ok).map((r) => r.batchError || r.error || 'Errore sconosciuto');

    if (errors.length > 0) {
      res.status(succeeded.length > 0 ? 207 : 500).json({
        success: succeeded.length > 0,
        error: errors.join('. '),
      });
      return;
    }
    res.json({ success: true });
  });

  router.post('/trash/:filename', (req: Request, res: Response) => {
    const sess = getSession(req);
    if (!sess) {
      res.status(403).json({ error: 'Accesso negato', success: false });
      return;
    }
    const filename = String(req.params.filename);
    const { results } = moveOrDeleteVaultFiles(sess.username, [filename], 'trash');
    const result = results[0];
    if (!result.ok) {
      res.status(result.statusCode).json({ error: result.error, success: false });
      return;
    }
    res.json({ success: true, message: `File ${filename} spostato nel cestino` });
  });

  router.post('/restore/:filename', requireAuth, (req: Request, res: Response) => {
    const { session: sess } = req.auth!;
    const filename = String(req.params.filename);
    const { results } = moveOrDeleteVaultFiles(sess.username, [filename], 'restore');
    const result = results[0];
    if (!result.ok) {
      res.status(result.statusCode).json({ success: false, error: result.error });
      return;
    }
    res.json({ success: true });
  });

  router.post('/delete_permanent/:filename', requireAuth, (req: Request, res: Response) => {
    const { session: sess } = req.auth!;
    const filename = String(req.params.filename);
    const { results } = moveOrDeleteVaultFiles(sess.username, [filename], 'permanent');
    const result = results[0];
    if (!result.ok) {
      res.status(result.statusCode).json({ success: false, error: result.error });
      return;
    }
    res.json({ success: true });
  });

  router.post('/empty_trash', requireAuth, (req: Request, res: Response) => {
    const { session: sess, userFolder: rawUserFolder, trashFolder: rawTrashFolder } = req.auth!;
    const userFolder = path.resolve(rawUserFolder);
    const trashFolder = path.resolve(rawTrashFolder);
    try {
      if (fs.existsSync(trashFolder)) {
        fs.rmSync(trashFolder, { recursive: true, force: true });
        fs.mkdirSync(trashFolder, { recursive: true });
      }
      // Clean up orphaned album references for deleted trash files
      const data = loadUserAlbums(sess.username);
      let modified = false;
      for (const fn of Object.keys(data.fileAlbums)) {
        const activeFile = path.join(userFolder, fn);
        if (!fs.existsSync(activeFile)) {
          delete data.fileAlbums[fn];
          modified = true;
        }
      }
      if (modified) {
        saveUserAlbums(sess.username, data);
      }
      res.json({ success: true });
    } catch {
      res.status(500).json({
        success: false,
        error: 'Impossibile svuotare il cestino.',
      });
    }
  });

  // --- DUPLICATES ---
  router.post('/find_duplicates_server', requireAuth, async (req: Request, res: Response) => {
    const { session: sess, userFolder: rawUserFolder } = req.auth!;
    const userFolder = path.resolve(rawUserFolder);
    if (!fs.existsSync(userFolder)) {
      res.json({ duplicates: [] });
      return;
    }
    const files = listMediaFiles(userFolder, sess.username);
    if (files.length < 2) {
      res.json({ duplicates: [] });
      return;
    }

    const hashedItems: Array<{ filename: string; hash: string | null }> = [];
    for (const f of files) {
      try {
        const enc = await fs.promises.readFile(path.join(userFolder, f.filename));
        const dec = await decryptFileAsync(enc, sess.apiKey);
        hashedItems.push({ filename: f.filename, hash: calculateBufferHash(dec) });
      } catch {
        hashedItems.push({ filename: f.filename, hash: null });
      }
    }

    const duplicates = findDuplicateGroups(hashedItems);
    res.json({ duplicates });
  });

  // --- ZIP EXPORT ---
  router.post('/prepare-zip', requireAuth, async (req: Request, res: Response) => {
    const { session: sess, userFolder: rawUserFolder } = req.auth!;
    const rawFilenames: unknown[] = Array.isArray(req.body?.filenames) ? req.body.filenames : [];
    const filenames = rawFilenames.filter((f): f is string => isValidVaultFilename(f)).slice(0, 500);
    if (filenames.length === 0) {
      res.status(400).json({ error: 'Nessun file selezionato' });
      return;
    }

    const taskId = crypto.randomUUID();
    const userFolder = path.resolve(rawUserFolder);
    ZIP_TASKS.set(taskId, {
      owner: sess.username,
      status: 'starting',
      progress: 0,
      filename: null,
      totalBytes: 0,
      processedBytes: 0,
    });

    const expiry = setTimeout(() => {
      const existing = ZIP_TASKS.get(taskId);
      if (existing?.zipPath && fs.existsSync(existing.zipPath)) {
        try {
          fs.unlinkSync(existing.zipPath);
        } catch {
          // ignore
        }
      }
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
            totalBytes += getEncryptedFilePlaintextSize(sp);
          }
        }
        for (let i = 0; i < total; i++) {
          const fname = filenames[i];
          const progress = Math.round(((i + 1) / total) * 100);
          const safePath = path.resolve(userFolder, fname);
          if (safePath.startsWith(userFolder + path.sep) && fs.existsSync(safePath)) {
            const enc = await fs.promises.readFile(safePath);
            const dec = await decryptFileAsync(enc, sess.apiKey);
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
        const zipPath = path.join(TEMP_UPLOAD_DIR, zipFilename);
        const buf = await zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE' });
        await fs.promises.writeFile(zipPath, buf);
        ZIP_TASKS.set(taskId, {
          owner: sess.username,
          zipPath,
          status: 'complete',
          progress: 100,
          filename: zipFilename,
          totalBytes: buf.length,
          processedBytes: buf.length,
        });
        notifyUserAsync(
          sess.username,
          '📦 PhotoCloud — Archivio ZIP pronto',
          `L'esportazione di ${total} file è pronta per il download.`,
          'photocloud-zip'
        );
      } catch {
        ZIP_TASKS.set(taskId, {
          owner: sess.username,
          status: 'error',
          progress: 0,
          filename: null,
          error: 'Errore durante la creazione del file ZIP.',
        });
      }
    })();

    res.json({ task_id: taskId });
  });

  router.get('/zip-progress/:taskId', requireAuth, (req: Request, res: Response) => {
    const { session: sess } = req.auth!;
    const taskId = String(req.params.taskId);
    if (!UUID_REGEX.test(taskId)) {
      res.status(404).json({ status: 'not_found', progress: 0 });
      return;
    }
    const info = ZIP_TASKS.get(taskId);
    if (!info || info.owner !== sess.username) {
      res.status(404).json({ status: 'not_found', progress: 0 });
      return;
    }
    const { owner, buffer, zipPath, ...publicInfo } = info;
    res.json(publicInfo);
  });

  router.get('/download-zip/:filename', (req: Request, res: Response) => {
    const sess = getSession(req);
    if (!sess) {
      res.status(403).send('Accesso negato');
      return;
    }
    const filename = String(req.params.filename);
    if (!isValidVaultFilename(filename)) {
      res.status(404).send('File non trovato');
      return;
    }
    const taskId = path.parse(filename).name;
    const task = ZIP_TASKS.get(taskId);
    if (!task || task.owner !== sess.username || task.filename !== filename || task.status !== 'complete') {
      res.status(404).send('File non trovato');
      return;
    }
    ZIP_TASKS.delete(taskId);

    if (task.zipPath && fs.existsSync(task.zipPath)) {
      const zipPath = task.zipPath;
      const stat = fs.statSync(zipPath);
      res.setHeader('Content-Type', 'application/zip');
      res.setHeader('Content-Length', String(stat.size));
      res.setHeader('Content-Disposition', `attachment; filename="${encodeURIComponent(filename)}"`);
      const stream = fs.createReadStream(zipPath);
      stream.on('close', () => {
        try {
          if (fs.existsSync(zipPath)) fs.unlinkSync(zipPath);
        } catch {
          // ignore
        }
      });
      stream.pipe(res);
      return;
    }

    const zipBytes = task.buffer;
    if (!zipBytes) {
      res.status(404).send('File non trovato');
      return;
    }
    res.setHeader('Content-Type', 'application/zip');
    res.setHeader('Content-Length', String(zipBytes.length));
    res.setHeader('Content-Disposition', `attachment; filename="${encodeURIComponent(filename)}"`);
    res.send(zipBytes);
  });

  return router;
}
