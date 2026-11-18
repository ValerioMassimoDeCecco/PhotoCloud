import fs from 'node:fs';
import path from 'node:path';
import express, { type Request, type Response, type Router } from 'express';

export const V2_STRICT_CSP =
  "default-src 'self'; script-src 'self' 'wasm-unsafe-eval'; style-src 'self'; img-src 'self' blob: data:; media-src 'self' blob:; worker-src 'self'; connect-src 'self'; object-src 'none'; base-uri 'self'; frame-ancestors 'none'";

export function renderZkV2HtmlShell(): string {
  return `<!DOCTYPE html>
<html lang="it">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <meta name="referrer" content="no-referrer" />
  <title>PhotoCloud v2 — Zero-Knowledge E2EE Vault</title>
  <link rel="stylesheet" href="/v2/app.css" />
</head>
<body>
  <div id="zk-app-root"></div>
  <script type="module" src="/v2/app.js"></script>
</body>
</html>`;
}

export function createZkV2WebRouter(rootDir: string = process.cwd()): Router {
  const router = express.Router();
  const publicV2Dir = path.resolve(rootDir, 'public', 'v2');

  router.use((_req: Request, res: Response, next) => {
    res.setHeader('Content-Security-Policy', V2_STRICT_CSP);
    res.setHeader('Referrer-Policy', 'no-referrer');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('X-Frame-Options', 'DENY');
    next();
  });

  const serveHtmlShell = (_req: Request, res: Response) => {
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    res.setHeader('Cache-Control', 'no-store');
    res.status(200).send(renderZkV2HtmlShell());
  };

  router.get('/', serveHtmlShell);
  router.get('/share/:shareId', serveHtmlShell);

  router.get('/app.css', (_req: Request, res: Response) => {
    const cssPath = path.join(publicV2Dir, 'app.css');
    res.setHeader('Content-Type', 'text/css; charset=utf-8');
    res.sendFile(cssPath);
  });

  router.get('/sw-stream.js', (_req: Request, res: Response) => {
    const swPath = path.join(publicV2Dir, 'sw-stream.js');
    res.setHeader('Content-Type', 'application/javascript; charset=utf-8');
    res.setHeader('Service-Worker-Allowed', '/v2');
    res.setHeader('Cache-Control', 'no-store');
    res.sendFile(swPath);
  });

  router.get('/app.js', async (_req: Request, res: Response) => {
    const prebuiltPath = path.join(publicV2Dir, 'app.js');
    res.setHeader('Content-Type', 'application/javascript; charset=utf-8');
    res.setHeader('Cache-Control', 'no-store');
    if (fs.existsSync(prebuiltPath)) {
      res.sendFile(prebuiltPath);
      return;
    }
    try {
      const esbuild = await import('esbuild');
      const entryPoint = path.resolve(rootDir, 'src', 'client', 'v2-app', 'main.ts');
      const result = await esbuild.build({
        entryPoints: [entryPoint],
        bundle: true,
        format: 'esm',
        platform: 'browser',
        target: ['es2022'],
        write: false,
      });
      const code = result.outputFiles[0]?.text ?? '';
      res.status(200).send(code);
    } catch {
      res.status(500).send('// Failed to bundle v2 app');
    }
  });

  return router;
}
