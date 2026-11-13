import { Router, Request, Response } from 'express';
import fs from 'node:fs';
import path from 'node:path';
import { deleteAlbumSharesForAlbum } from '../lib/sharing';
import {
  UPLOAD_FOLDER,
  requireAuth,
  isValidVaultFilename,
  isValidAlbumName,
  loadUserAlbums,
  saveUserAlbums,
  loadUserFavorites,
  saveUserFavorites,
} from '../lib/serverContext';

export function createAlbumsAndFavoritesRouter(): Router {
  const router = Router();

  router.get('/api/albums', requireAuth, (req: Request, res: Response) => {
    const { session: sess } = req.auth!;
    res.json(loadUserAlbums(sess.username));
  });

  router.post('/api/albums/create', requireAuth, (req: Request, res: Response) => {
    const { session: sess } = req.auth!;
    const rawName = String(req.body?.name || '').trim();
    if (!isValidAlbumName(rawName)) {
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

  router.post('/api/albums/assign', requireAuth, (req: Request, res: Response) => {
    const { session: sess } = req.auth!;
    const filenames: unknown[] = Array.isArray(req.body?.filenames) ? req.body.filenames : [];
    const albumName = String(req.body?.album || '').trim();
    if (albumName && !isValidAlbumName(albumName)) {
      res.status(400).json({ error: 'Nome album non valido' });
      return;
    }
    const data = loadUserAlbums(sess.username);

    if (albumName && !data.albums.includes(albumName)) {
      data.albums.push(albumName);
      data.albums.sort((a, b) => a.localeCompare(b, 'it'));
    }

    for (const fn of filenames) {
      if (!isValidVaultFilename(fn)) continue;
      if (albumName) {
        data.fileAlbums[fn] = albumName;
      } else {
        delete data.fileAlbums[fn];
      }
    }
    saveUserAlbums(sess.username, data);
    res.json({ success: true, ...data });
  });

  router.post('/api/albums/delete', requireAuth, (req: Request, res: Response) => {
    const { session: sess } = req.auth!;
    const albumName = String(req.body?.name || '').trim();
    if (!isValidAlbumName(albumName)) {
      res.status(400).json({ error: 'Nome album non valido' });
      return;
    }
    const data = loadUserAlbums(sess.username);
    data.albums = data.albums.filter((a) => a !== albumName);
    for (const [fn, alb] of Object.entries(data.fileAlbums)) {
      if (alb === albumName) {
        delete data.fileAlbums[fn];
      }
    }
    saveUserAlbums(sess.username, data);
    deleteAlbumSharesForAlbum(UPLOAD_FOLDER, sess.username, albumName);
    res.json({ success: true, ...data });
  });

  // ==========================================================================
  // v1.4.0 — FAVORITI (⭐) persistenti per utente
  // ==========================================================================
  router.get('/api/favorites', requireAuth, (req: Request, res: Response) => {
    const { session: sess } = req.auth!;
    res.json({ favorites: [...loadUserFavorites(sess.username)] });
  });

  router.post('/api/favorites/toggle', requireAuth, (req: Request, res: Response) => {
    const { session: sess, userFolder, trashFolder } = req.auth!;
    const filename = String(req.body?.filename || '');
    if (!isValidVaultFilename(filename)) {
      res.status(400).json({ error: 'Nome file non valido' });
      return;
    }
    const existsActive = fs.existsSync(path.join(userFolder, filename));
    const existsTrash = fs.existsSync(path.join(trashFolder, filename));
    if (!existsActive && !existsTrash) {
      res.status(404).json({ error: 'File non trovato' });
      return;
    }
    const favorites = loadUserFavorites(sess.username);
    let isFavorite: boolean;
    if (favorites.has(filename)) {
      favorites.delete(filename);
      isFavorite = false;
    } else {
      favorites.add(filename);
      isFavorite = true;
    }
    saveUserFavorites(sess.username, favorites);
    res.json({ success: true, isFavorite, favorites: [...favorites] });
  });

  router.post('/api/favorites/set-many', requireAuth, (req: Request, res: Response) => {
    const { session: sess, userFolder } = req.auth!;
    const filenames: unknown[] = Array.isArray(req.body?.filenames) ? req.body.filenames : [];
    const makeFavorite = req.body?.favorite === true;
    const favorites = loadUserFavorites(sess.username);
    for (const fn of filenames) {
      if (!isValidVaultFilename(fn)) continue;
      if (!fs.existsSync(path.join(userFolder, fn))) continue;
      if (makeFavorite) favorites.add(fn);
      else favorites.delete(fn);
    }
    saveUserFavorites(sess.username, favorites);
    res.json({ success: true, favorites: [...favorites] });
  });

  return router;
}
