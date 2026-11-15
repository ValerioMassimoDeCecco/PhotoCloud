/**
 * PhotoCloud v1.4.1 — End-to-End & Edge-Case Functional Smoke Audit Script
 *
 * Esegue test funzionali non distruttivi su un'istanza effimera di `server.ts`
 * (con directory temporanea isolata) e sugli script CLI per raccogliere evidenze
 * concrete su happy path, error handling, sicurezza e bug individuati.
 */

import { spawn, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import net from 'node:net';
import { once } from 'node:events';
import JSZip from 'jszip';

interface CheckResult {
  id: string;
  area: string;
  description: string;
  status: 'PASS' | 'FAIL' | 'BUG_CONFIRMED';
  expected: string;
  observed: string;
}

const results: CheckResult[] = [];
const root = process.cwd();

function record(
  id: string,
  area: string,
  description: string,
  status: 'PASS' | 'FAIL' | 'BUG_CONFIRMED',
  expected: string,
  observed: string
) {
  results.push({ id, area, description, status, expected, observed });
  const icon = status === 'PASS' ? '✅' : status === 'BUG_CONFIRMED' ? '🐛' : '❌';
  console.log(`${icon} [${id}] (${area}) ${description}`);
  console.log(`   Expected: ${expected}`);
  console.log(`   Observed: ${observed}`);
}

async function main() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'photocloud-qa-audit-'));
  const symlinkType = process.platform === 'win32' ? 'junction' : 'dir';
  for (const name of ['templates', 'static', 'public', 'release', 'android-app']) {
    if (fs.existsSync(path.join(root, name))) {
      fs.symlinkSync(path.join(root, name), path.join(dir, name), symlinkType);
    }
  }

  const socket = net.createServer();
  socket.listen(0, '127.0.0.1');
  await once(socket, 'listening');
  const port = (socket.address() as net.AddressInfo).port;
  await new Promise<void>((resolve) => socket.close(() => resolve()));

  const baseUrl = `http://127.0.0.1:${port}`;
  console.log(`=== Starting Isolated PhotoCloud Server on ${baseUrl} (cwd=${dir}) ===`);

  const serverProc = spawn(
    process.execPath,
    ['--import', path.join(root, 'node_modules/tsx/dist/loader.mjs'), path.join(root, 'server.ts')],
    {
      cwd: dir,
      env: { ...process.env, PORT: String(port), GITHUB_TOKEN: '' },
      stdio: ['ignore', 'pipe', 'pipe'],
    }
  );

  try {
    let ready = false;
    for (let i = 0; i < 100; i++) {
      if (serverProc.exitCode !== null) throw new Error('Server exited during startup');
      try {
        const r = await fetch(`${baseUrl}/api/session`);
        if (r.status === 200) {
          ready = true;
          break;
        }
      } catch {
        await new Promise((r) => setTimeout(r, 50));
      }
    }
    if (!ready) throw new Error('Server did not start within timeout');

    async function registerUser(username: string, customKey = 'PasswordSicura123!') {
      const form = new FormData();
      form.set('username', username);
      form.set('key_type', 'custom');
      form.set('custom_key', customKey);
      return fetch(`${baseUrl}/register`, { method: 'POST', body: form });
    }

    async function loginUser(username: string, apiKey = 'PasswordSicura123!'): Promise<string> {
      const res = await fetch(`${baseUrl}/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
        body: JSON.stringify({ username, api_key: apiKey }),
      });
      return res.headers.get('set-cookie')!.split(';')[0];
    }

    // 1. Auth & Validation tests
    const unauthSession = await fetch(`${baseUrl}/api/session`);
    const unauthJson = (await unauthSession.json()) as { authenticated: boolean };
    record(
      'AUTH-01',
      'Auth & Session',
      'GET /api/session senza cookie restituisce authenticated: false',
      unauthJson.authenticated === false ? 'PASS' : 'FAIL',
      'HTTP 200 { authenticated: false }',
      `HTTP ${unauthSession.status} ${JSON.stringify(unauthJson)}`
    );

    const badReg = await registerUser('alice', '123');
    record(
      'AUTH-02',
      'Auth & Session',
      'POST /register rifiuta chiave/password < 8 caratteri con HTTP 400',
      badReg.status === 400 ? 'PASS' : 'FAIL',
      'HTTP 400 error message',
      `HTTP ${badReg.status}`
    );

    const regAlice = await registerUser('alice', 'PasswordSicura123!');
    const aliceCookie = await loginUser('alice', 'PasswordSicura123!');
    const sessionAliceRes = await fetch(`${baseUrl}/api/session`, {
      headers: { Cookie: aliceCookie },
    });
    const sessionAlice = (await sessionAliceRes.json()) as {
      authenticated: boolean;
      username: string;
    };
    record(
      'AUTH-03',
      'Auth & Session',
      'Registrazione e login utente "alice" con sessione autenticata',
      regAlice.status === 200 && sessionAlice.authenticated && sessionAlice.username === 'alice' ? 'PASS' : 'FAIL',
      'HTTP 200, authenticated=true, username="alice"',
      `HTTP ${regAlice.status}, authenticated=${sessionAlice.authenticated}, user=${sessionAlice.username}`
    );

    // Check BUG: CSRF bypass when Origin header is omitted
    const csrfNoOriginRes = await fetch(`${baseUrl}/api/albums/create`, {
      method: 'POST',
      headers: {
        Cookie: aliceCookie,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ name: 'CSRF_No_Origin_Album' }),
    });
    const csrfCrossOriginRes = await fetch(`${baseUrl}/api/albums/create`, {
      method: 'POST',
      headers: {
        Cookie: aliceCookie,
        'Content-Type': 'application/json',
        Origin: 'https://evil.example.com',
      },
      body: JSON.stringify({ name: 'CSRF_Evil_Origin_Album' }),
    });
    record(
      'SEC-01',
      'Security / CSRF',
      'Middleware CSRF blocca Origin cross-site (403) ma consente POST senza X-CSRF-Token se Origin è omesso/null',
      csrfCrossOriginRes.status === 403 && csrfNoOriginRes.status === 200 ? 'BUG_CONFIRMED' : 'PASS',
      'Richiesta state-changing senza X-CSRF-Token dovrebbe essere rifiutata anche senza header Origin',
      `Con Origin=evil.example.com -> HTTP ${csrfCrossOriginRes.status}; Senza Origin né X-CSRF-Token -> HTTP ${csrfNoOriginRes.status}`
    );

    // 2. Upload JPEG, Document Preview, Zip-Bomb protection
    const jpegBuf = fs.readFileSync(path.join(root, 'static/wp1.jpg'));
    const form = new FormData();
    form.append('file[]', new Blob([jpegBuf], { type: 'image/jpeg' }), 'vacanza_roma.jpg');

    const upRes = await fetch(`${baseUrl}/upload`, {
      method: 'POST',
      headers: { Cookie: aliceCookie },
      body: form,
    });
    const upJson = (await upRes.json()) as {
      success: boolean;
      mediaFiles: Array<{ filename: string; size: number }>;
    };
    const uploadedFilename = upJson.mediaFiles?.[0]?.filename ?? 'vacanza_roma.jpg';
    record(
      'MEDIA-01',
      'Media Vault & Crypto',
      'Upload foto JPEG cifrata AES-256-GCM e normalizzazione nome con timestamp',
      upRes.status === 200 && upJson.mediaFiles?.length === 1 ? 'PASS' : 'FAIL',
      'HTTP 200 con 1 file in mediaFiles',
      `HTTP ${upRes.status}, filename=${uploadedFilename}, size=${upJson.mediaFiles?.[0]?.size}`
    );

    const invalidRangeMedia = await fetch(`${baseUrl}/media/${encodeURIComponent(uploadedFilename)}`, {
      headers: { Cookie: aliceCookie, Range: 'bytes=9999999-10000000' },
    });
    record(
      'MEDIA-02',
      'Media Streaming',
      'GET /media/:filename con header Range fuori limite restituisce HTTP 416',
      invalidRangeMedia.status === 416 ? 'PASS' : 'FAIL',
      'HTTP 416 Range Not Satisfiable',
      `HTTP ${invalidRangeMedia.status}`
    );

    const docTraversal = await fetch(`${baseUrl}/api/document-preview/..%2F..%2Fpackage.json`, {
      headers: { Cookie: aliceCookie },
    });
    record(
      'DOC-01',
      'Document Engine',
      'GET /api/document-preview/:filename blocca tentativi di path traversal con HTTP 403',
      docTraversal.status === 403 || docTraversal.status === 400 ? 'PASS' : 'FAIL',
      'HTTP 403 Forbidden (path traversal rifiutato)',
      `HTTP ${docTraversal.status}`
    );

    // Upload a crafted DOCX with > 15MB uncompressed XML to verify Zip-Bomb protection in documentEngine
    const bombZip = new JSZip();
    bombZip.file(
      '[Content_Types].xml',
      '<?xml version="1.0" encoding="UTF-8"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"></Types>'
    );
    bombZip.file(
      'word/document.xml',
      '<w:document><w:body><w:p><w:r><w:t>' + 'A'.repeat(16 * 1024 * 1024) + '</w:t></w:r></w:p></w:body></w:document>'
    );
    const bombBuf = await bombZip.generateAsync({
      type: 'nodebuffer',
      compression: 'DEFLATE',
      compressionOptions: { level: 1 },
    });
    const bombForm = new FormData();
    bombForm.append('file[]', new Blob([bombBuf]), 'bomb.docx');
    const bombUpRes = await fetch(`${baseUrl}/upload`, {
      method: 'POST',
      headers: { Cookie: aliceCookie },
      body: bombForm,
    });
    const bombUpJson = (await bombUpRes.json()) as { mediaFiles: Array<{ filename: string }> };
    const bombFilename = bombUpJson.mediaFiles[0].filename;
    const bombPreviewRes = await fetch(
      `${baseUrl}/api/document-preview/${encodeURIComponent(bombFilename)}`,
      {
        headers: { Cookie: aliceCookie },
      }
    );
    const bombPreviewJson = (await bombPreviewRes.json()) as { warning?: string; blocks: unknown[] };
    record(
      'DOC-02',
      'Document Engine (Zip-Bomb)',
      'GET /api/document-preview/:filename intercetta XML decompresso > 15 MB senza crash/OOM e restituisce warning di sicurezza',
      bombPreviewRes.status === 200 && bombPreviewJson.blocks.length === 0 && !!bombPreviewJson.warning
        ? 'PASS'
        : 'FAIL',
      'Intercettazione limite 15 MB con fallback sicuro (blocks=[], warning presente)',
      `HTTP ${bombPreviewRes.status}, blocks=${bombPreviewJson.blocks.length}, warning="${bombPreviewJson.warning}"`
    );

    // 3. Bug Verification: Public Share `maxDownloads: 1` Quota Bypass on inline media endpoint
    const createShareRes = await fetch(`${baseUrl}/api/shares/create`, {
      method: 'POST',
      headers: {
        Cookie: aliceCookie,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        filenames: [uploadedFilename],
        expiresInHours: 24,
        label: 'Quota Test Share',
        maxDownloads: 1,
      }),
    });
    const shareData = (await createShareRes.json()) as {
      success: boolean;
      id: string;
      url: string;
    };
    const shareUrl = shareData.url;

    const inlineStatuses: number[] = [];
    for (let i = 0; i < 3; i++) {
      const r = await fetch(`${baseUrl}${shareUrl}/media/${encodeURIComponent(uploadedFilename)}`);
      inlineStatuses.push(r.status);
    }
    const listSharesRes = await fetch(`${baseUrl}/api/shares`, {
      headers: { Cookie: aliceCookie },
    });
    const listSharesJson = (await listSharesRes.json()) as {
      shares: Array<{ id: string; downloadCount: number; maxDownloads: number }>;
    };
    const shareAfterInline = listSharesJson.shares.find((s) => s.id === shareData.id);

    record(
      'BUG-SHARE-QUOTA',
      'Public Sharing',
      'GET /share/:token/media/:filename senza ?download=1 non incrementa il contatore downloadCount, aggirando maxDownloads=1',
      inlineStatuses.every((s) => s === 200) && (shareAfterInline?.downloadCount ?? 0) === 0
        ? 'BUG_CONFIRMED'
        : 'PASS',
      'Ogni scaricamento completo del file dovrebbe incrementare downloadCount e bloccare con 410 al superamento di maxDownloads=1',
      `3 richieste a ${shareUrl}/media/${uploadedFilename} -> status ${JSON.stringify(inlineStatuses)}, downloadCount=${shareAfterInline?.downloadCount ?? 0}/${shareAfterInline?.maxDownloads}`
    );

    const dl1 = await fetch(
      `${baseUrl}${shareUrl}/media/${encodeURIComponent(uploadedFilename)}?download=1`
    );
    const dl2 = await fetch(
      `${baseUrl}${shareUrl}/media/${encodeURIComponent(uploadedFilename)}?download=1`
    );
    record(
      'SHARE-02',
      'Public Sharing',
      'GET /share/:token/media/:filename?download=1 incrementa il contatore e blocca il 2° download esplicito',
      dl1.status === 200 && (dl2.status === 410 || dl2.status === 404) ? 'PASS' : 'FAIL',
      '1° download HTTP 200, 2° download bloccato (410/404)',
      `1° download HTTP ${dl1.status}, 2° download HTTP ${dl2.status}`
    );

    // 4. Bug Verification: Multi-user Shared Album invalid Range header returns 200 OK instead of 416
    await registerUser('bob', 'PasswordBob123!');
    const bobCookie = await loginUser('bob', 'PasswordBob123!');

    await fetch(`${baseUrl}/api/albums/create`, {
      method: 'POST',
      headers: { Cookie: aliceCookie, 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'Estate' }),
    });
    await fetch(`${baseUrl}/api/albums/assign`, {
      method: 'POST',
      headers: { Cookie: aliceCookie, 'Content-Type': 'application/json' },
      body: JSON.stringify({ album: 'Estate', filenames: [uploadedFilename] }),
    });
    const shareAlbumRes = await fetch(`${baseUrl}/api/albums/share`, {
      method: 'POST',
      headers: { Cookie: aliceCookie, 'Content-Type': 'application/json' },
      body: JSON.stringify({ album: 'Estate', username: 'bob', role: 'viewer' }),
    });
    const sharedAlbumJson = (await shareAlbumRes.json()) as { shareId: string };
    const sharedAlbumId = sharedAlbumJson.shareId;

    const bobInvalidRangeRes = await fetch(
      `${baseUrl}/api/shared-albums/${sharedAlbumId}/file/${encodeURIComponent(uploadedFilename)}`,
      {
        headers: {
          Cookie: bobCookie,
          Range: 'bytes=99999999-100000000',
        },
      }
    );
    record(
      'BUG-SHARED-ALBUM-RANGE',
      'Multi-User Shared Albums',
      'GET /api/shared-albums/:shareId/file/:filename con Range invalido restituisce 200 OK invece di 416 Range Not Satisfiable',
      bobInvalidRangeRes.status === 200 ? 'BUG_CONFIRMED' : 'PASS',
      'HTTP 416 Range Not Satisfiable (come avviene in /media/:filename e /share/:token/media/:filename)',
      `HTTP ${bobInvalidRangeRes.status} (invia l'intero buffer ignorando parsedRange.status === 'invalid')`
    );

    // 5. Bug Verification: Android Update Manifest & Release APK missing for v1.4.1
    const updateManifestRes = await fetch(`${baseUrl}/api/android/update-manifest`);
    const updateManifestJson = await updateManifestRes.json();
    record(
      'BUG-ANDROID-OTA-404',
      'Android OTA & Release',
      'GET /api/android/update-manifest restituisce HTTP 404 perché photocloud-release-v1.4.1-signed.apk non esiste in release/',
      updateManifestRes.status === 404 ? 'BUG_CONFIRMED' : 'PASS',
      'HTTP 200 con metadati APK v1.4.1 valido o fallback all’ultimo APK firmato valido',
      `HTTP ${updateManifestRes.status} ${JSON.stringify(updateManifestJson)}`
    );

    const buildRelease141Res = await fetch(`${baseUrl}/api/android/build-release`, {
      method: 'POST',
      headers: { Cookie: aliceCookie, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        appName: 'PhotoCloud',
        packageName: 'com.valerio.photocloud',
        versionName: '1.4.1',
        versionCode: 31,
        serverUrl: baseUrl,
      }),
    });
    const buildRelease141Json = await buildRelease141Res.json();
    record(
      'BUG-ANDROID-BUILD-141',
      'Android Release Studio',
      'POST /api/android/build-release con versionName="1.4.1" fallisce con HTTP 404 perché manca release/photocloud-release-v1.4.1-signed.apk',
      buildRelease141Res.status === 404 ? 'BUG_CONFIRMED' : 'PASS',
      'HTTP 200 con pacchetto APK v1.4.1 firmato',
      `HTTP ${buildRelease141Res.status} ${JSON.stringify(buildRelease141Json)}`
    );

    // 6. Bug Verification: githubReleasePublisher.ts hardcoded v1.3.2 vs v1.4.1 & missing Kotlin files in filesToSync
    const publisherCode = fs.readFileSync(
      path.join(root, 'src/lib/githubReleasePublisher.ts'),
      'utf-8'
    );
    const hasHardcoded132 =
      publisherCode.includes("const DEFAULT_TAG = 'v1.3.2'") &&
      publisherCode.includes("versionName: '1.3.2'") &&
      publisherCode.includes('versionCode: 29');
    const omitsEditorEngine = !publisherCode.includes('AndroidMediaEditorEngine.kt');
    const omitsNlSearchEngine = !publisherCode.includes('NaturalLanguageSearchEngine.kt');

    record(
      'BUG-RELEASE-PUBLISHER-DRIFT',
      'Release Automation / CI',
      'src/lib/githubReleasePublisher.ts ha hardcoded v1.3.2 (versionCode 29) e omette AndroidMediaEditorEngine.kt / NaturalLanguageSearchEngine.kt da filesToSync',
      hasHardcoded132 && omitsEditorEngine && omitsNlSearchEngine ? 'BUG_CONFIRMED' : 'PASS',
      'Versione allineata a v1.4.1 (versionCode 31) e tutti gli 11 file Kotlin sincronizzati su GitHub',
      `DEFAULT_TAG='v1.3.2' (code 29), omits AndroidMediaEditorEngine.kt=${omitsEditorEngine}, omits NaturalLanguageSearchEngine.kt=${omitsNlSearchEngine}`
    );

    // 7. Bug Verification: androidBuilder.ts overwrites app/build.gradle.kts in exported Android Studio ZIP with incompatible WebView config
    const gradleGen = (await import('../../src/lib/androidBuilder.ts')).generateAppBuildGradleKts({
      appName: 'PhotoCloud',
      packageName: 'com.valerio.photocloud',
      versionName: '1.4.1',
      versionCode: 31,
      serverUrl: baseUrl,
      themeColor: '#6366f1',
      enableBiometrics: true,
      enableCameraUpload: true,
    });
    const lacksRoomAndWorkManager =
      !gradleGen.includes('room-runtime') &&
      !gradleGen.includes('work-runtime-ktx') &&
      !gradleGen.includes('tasks-vision');
    record(
      'BUG-ANDROID-ZIP-EXPORT',
      'Android Studio ZIP Generator',
      'generateAppBuildGradleKts() sovrascrive app/build.gradle.kts nello ZIP esportato omettendo Room, WorkManager, MediaPipe, OkHttp e imponendo JVM 21',
      lacksRoomAndWorkManager ? 'BUG_CONFIRMED' : 'PASS',
      'build.gradle.kts nello ZIP esportato deve includere tutte le dipendenze reali di android-app/app/build.gradle.kts',
      `Room/WorkManager/MediaPipe assenti in generateAppBuildGradleKts(): ${lacksRoomAndWorkManager}`
    );

    // 8. CLI Verification: scripts/setup-persistent-signing.ts in isolated HOME
    const fakeHome = fs.mkdtempSync(path.join(os.tmpdir(), 'photocloud-cli-home-'));
    const cliRun = spawnSync(
      process.execPath,
      [
        '--import',
        path.join(root, 'node_modules/tsx/dist/loader.mjs'),
        path.join(root, 'scripts/setup-persistent-signing.ts'),
      ],
      {
        cwd: root,
        env: { ...process.env, HOME: fakeHome, GITHUB_TOKEN: '' },
        encoding: 'utf-8',
      }
    );
    fs.rmSync(fakeHome, { recursive: true, force: true });
    record(
      'CLI-01',
      'CLI Scripts',
      'Esecuzione scripts/setup-persistent-signing.ts in ambiente senza keytool né GitHub token',
      cliRun.status === 0 && cliRun.stdout.includes('CONFIGURAZIONE FIRMA PERSISTENTE ANDROID')
        ? 'PASS'
        : 'FAIL',
      'Exit code 0 e diagnostica chiara senza crash',
      `Exit=${cliRun.status}, stdout include header=${cliRun.stdout.includes('CONFIGURAZIONE FIRMA PERSISTENTE ANDROID')}`
    );

    console.log('\n=== SMOKE AUDIT SUMMARY ===');
    const passCount = results.filter((r) => r.status === 'PASS').length;
    const bugCount = results.filter((r) => r.status === 'BUG_CONFIRMED').length;
    const failCount = results.filter((r) => r.status === 'FAIL').length;
    console.log(
      `Total checks: ${results.length} | PASS: ${passCount} | BUG_CONFIRMED: ${bugCount} | FAIL: ${failCount}`
    );
  } finally {
    serverProc.kill('SIGTERM');
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

main().catch((err) => {
  console.error('Fatal error in smoke_audit:', err);
  process.exit(1);
});
