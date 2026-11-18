import express from 'express';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import JSZip from 'jszip';
import { createZkV2Router } from '../src/lib/zkServerV2.ts';
import { createZkV2WebRouter } from '../src/client/v2-app/router.ts';

async function prepareFixtures(dir: string): Promise<void> {
  fs.mkdirSync(dir, { recursive: true });

  // 1. Minimal valid 1x1 PNG (photo_e2e.png)
  const pngBase64 =
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';
  fs.writeFileSync(path.join(dir, 'photo_e2e.png'), Buffer.from(pngBase64, 'base64'));

  // 2. Deterministic binary payload for video_e2e.mp4 (256 bytes)
  const videoBytes = Buffer.alloc(256);
  for (let i = 0; i < 256; i++) {
    videoBytes[i] = (i * 37 + 11) & 0xff;
  }
  fs.writeFileSync(path.join(dir, 'video_e2e.mp4'), videoBytes);

  // 3. Valid minimal .docx ZIP with word/document.xml
  const zip = new JSZip();
  zip.file(
    '[Content_Types].xml',
    '<?xml version="1.0" encoding="UTF-8"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"></Types>'
  );
  zip.file(
    'word/document.xml',
    '<?xml version="1.0" encoding="UTF-8"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body><w:p><w:r><w:t>Contratto E2EE riservato</w:t></w:r></w:p></w:body></w:document>'
  );
  const docxBuf = await zip.generateAsync({ type: 'nodebuffer' });
  fs.writeFileSync(path.join(dir, 'contratto.docx'), docxBuf);

  // 4. Valid minimal .pdf with text stream
  const pdfContent = [
    '%PDF-1.4',
    '1 0 obj << /Type /Catalog /Pages 2 0 R >> endobj',
    '2 0 obj << /Type /Pages /Kids [3 0 R] /Count 1 >> endobj',
    '3 0 obj << /Type /Page /Parent 2 0 R /Contents 4 0 R >> endobj',
    '4 0 obj << /Length 58 >> stream',
    'BT /F1 12 Tf 72 720 Td (Rapporto Finanziario Zero Knowledge) Tj ET',
    'endstream endobj',
    'xref',
    '0 5',
    'trailer << /Root 1 0 R /Size 5 >>',
    '%%EOF',
  ].join('\n');
  fs.writeFileSync(path.join(dir, 'rapporto.pdf'), Buffer.from(pdfContent, 'utf8'));
}

async function main(): Promise<void> {
  const appRoot = process.cwd();
  const ownsTmpBase = !process.env.E2E_DATA_DIR;
  const dataDir = process.env.E2E_DATA_DIR
    ? path.resolve(process.env.E2E_DATA_DIR)
    : fs.mkdtempSync(path.join(os.tmpdir(), 'pc-v2-e2e-'));
  const vaultV2Dir = path.join(dataDir, 'vault_v2');
  const tempUploadDir = path.join(dataDir, 'temp_uploads');
  const fixturesDir = process.env.E2E_FIXTURES_DIR
    ? path.resolve(process.env.E2E_FIXTURES_DIR)
    : path.join(dataDir, 'fixtures');
  await prepareFixtures(fixturesDir);

  const app = express();
  app.use(express.json({ limit: '50mb' }));

  const zkV2 = createZkV2Router({
    vaultV2Dir,
    tempUploadDir,
    serverSecret: crypto.randomBytes(32),
    // Generate dynamic CSPRNG single-use setupToken and print once on stdout (just like server.ts)
    onSetupTokenGenerated: (token) => {
      console.log(
        `[PhotoCloud v2 Setup] First-registration single-use setup token (printed once): ${token}`
      );
    },
  });

  app.use('/api/v2', zkV2.router);
  app.use('/v2', createZkV2WebRouter(appRoot));
  app.use(express.static(path.join(appRoot, 'public'), { index: false }));

  const requestedPort = process.env.E2E_PORT !== undefined ? Number(process.env.E2E_PORT) : 0;
  const server = app.listen(requestedPort, '127.0.0.1', () => {
    const addr = server.address();
    const actualPort = typeof addr === 'object' && addr ? addr.port : requestedPort;
    console.log(`E2E_FIXTURES_DIR=${fixturesDir}`);
    console.log(`E2E_SERVER_READY=http://127.0.0.1:${actualPort}`);
  });

  const cleanup = () => {
    server.close();
    zkV2.store.close();
    if (ownsTmpBase) {
      fs.rmSync(dataDir, { recursive: true, force: true });
    }
    process.exit(0);
  };
  process.on('SIGTERM', cleanup);
  process.on('SIGINT', cleanup);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
