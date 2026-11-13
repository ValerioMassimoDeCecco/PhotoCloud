import express, { Request, Response } from 'express';
import path from 'node:path';
import { initPushService } from './src/lib/pushService';
import {
  UPLOAD_FOLDER,
  RELEASE_DIR,
  STATIC_DIR,
} from './src/lib/serverContext';
import { createPageAndAuthRouter } from './src/routes/pageAndAuthRoutes';
import { createAlbumsAndFavoritesRouter } from './src/routes/albumsAndFavoritesRoutes';
import { createIntelligenceRouter } from './src/routes/intelligenceRoutes';
import { createSharingRouter } from './src/routes/sharingRoutes';
import { createVaultMediaRouter } from './src/routes/vaultMediaRoutes';
import { createTrashAndExportRouter } from './src/routes/trashAndExportRoutes';
import { createAndroidRouter } from './src/routes/androidRoutes';



async function startServer() {
  const app = express();
  app.disable('x-powered-by');
  if (process.env.TRUST_PROXY === '1' || process.env.TRUST_PROXY === 'true') {
    app.set('trust proxy', 1);
  }

  // Global Security Headers & CSRF Origin Defense Middleware
  app.use((req: Request, res: Response, next) => {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('X-Frame-Options', 'SAMEORIGIN');
    res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
    res.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=()');
    res.setHeader('Cross-Origin-Opener-Policy', 'same-origin');
    res.setHeader(
      'Content-Security-Policy',
      "default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; font-src 'self' https://fonts.gstatic.com data:; img-src 'self' data: blob:; media-src 'self' blob:; connect-src 'self'; object-src 'none'; base-uri 'self'; frame-ancestors 'self'"
    );

    if (['POST', 'PUT', 'DELETE', 'PATCH'].includes(req.method)) {
      const origin = req.headers.origin;
      if (typeof origin === 'string' && origin.length > 0 && origin !== 'null') {
        try {
          const originHost = new URL(origin).host.toLowerCase();
          const targetHost = String(req.headers['x-forwarded-host'] || req.headers.host || '')
            .split(',')[0]
            .trim()
            .toLowerCase();
          if (targetHost && originHost !== targetHost) {
            res.status(403).json({ error: 'Richiesta cross-origin bloccata (CSRF protection).' });
            return;
          }
        } catch {
          res.status(403).json({ error: 'Header Origin non valido.' });
          return;
        }
      }
    }
    next();
  });

  app.use(express.json({ limit: '50mb' }));
  app.use(express.urlencoded({ extended: true, limit: '50mb' }));
  app.use('/static', express.static(STATIC_DIR));
  app.use(express.static(path.resolve(process.cwd(), 'public'), { index: false }));
  app.use('/release', express.static(RELEASE_DIR));

  app.use('/', createPageAndAuthRouter());
  app.use('/', createAlbumsAndFavoritesRouter());
  app.use('/', createIntelligenceRouter());
  app.use('/', createSharingRouter());
  app.use('/', createVaultMediaRouter());
  app.use('/', createTrashAndExportRouter());
  app.use('/', createAndroidRouter());

  const port = Number(process.env.PORT) || 3000;
  app.listen(port, '0.0.0.0', () => {
    console.log(`PhotoCloud server listening on http://0.0.0.0:${port}`);
  });

  // Inizializza il servizio Web Push (chiavi VAPID persistenti) in background.
  void initPushService(UPLOAD_FOLDER).then((res) => {
    if (res) {
      console.log('PhotoCloud Web Push attivo (endpoint /api/push/* disponibili)');
    }
  });
}

startServer();
