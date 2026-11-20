/**
 * PhotoCloud — Pure Zero-Knowledge End-to-End Encrypted Server (v2 Only)
 *
 * Architettura 100% Zero-Knowledge:
 * - Tutta la crittografia (Argon2id, HKDF-SHA256, AES-256-GCM PCZK v1) avviene ESCLUSIVAMENTE sul client.
 * - Questo server non importa né esegue alcuna cifra/decifra simmetrica su dati utente e non riceve mai
 *   passphrase, chiavi o contenuti in chiaro.
 * - Tutte le rotte legacy v1 con cifratura lato server sono state rimosse definitivamente (HTTP 410 Gone).
 */
import express, { type NextFunction, type Request, type Response } from 'express';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import JSZip from 'jszip';
import { getOrCreateServerSecret } from './src/lib/vaultStorage';
import { parseTrustProxyConfig } from './src/lib/trustProxy';
import {
  addUserSubscription,
  getVapidPublicKey,
  initPushService,
  removeUserSubscription,
} from './src/lib/pushService';
import type { AndroidBuildConfig, AndroidReleaseArtifact } from './src/types';
import {
  validateAndroidConfig,
  generateAndroidManifestXml,
  generateAppBuildGradleKts,
  generateMainActivityKt,
} from './src/lib/androidBuilder';
import {
  V2_SESSION_COOKIE_NAME,
  createZkV2Router,
  parseHttpRangeHeader,
} from './src/lib/zkServerV2';
import { createZkV2WebRouter } from './src/client/v2-app/router';

type ZkV2RouterHandle = ReturnType<typeof createZkV2Router>;

const APP_ROOT = process.cwd();
const DEFAULT_VAULT_V2_FOLDER = path.resolve(APP_ROOT, process.env.VAULT_V2_DIR || 'vault_v2');
const DEFAULT_TEMP_UPLOAD_DIR = path.resolve(APP_ROOT, process.env.TEMP_UPLOAD_DIR || 'temp_uploads');
const RELEASE_DIR = path.resolve(APP_ROOT, 'release');
const STATIC_DIR = path.resolve(APP_ROOT, 'static');
const RELEASE_BUILDS_DIR = path.resolve(APP_ROOT, 'release_builds');

const MAX_UPLOAD_MB_ENV = Number(process.env.MAX_UPLOAD_MB);
const MAX_UPLOAD_MB =
  Number.isFinite(MAX_UPLOAD_MB_ENV) && MAX_UPLOAD_MB_ENV >= 50 && MAX_UPLOAD_MB_ENV <= 16384
    ? Math.floor(MAX_UPLOAD_MB_ENV)
    : 2048;
const MAX_UPLOAD_BYTES = MAX_UPLOAD_MB * 1024 * 1024;

function readAndroidAppVersion(): { versionName: string; versionCode: number } {
  const fallback = { versionName: '1.5.1', versionCode: 33 };
  try {
    const gradlePath = path.resolve(APP_ROOT, 'android-app/app/build.gradle.kts');
    if (!fs.existsSync(gradlePath)) return fallback;
    const gradle = fs.readFileSync(gradlePath, 'utf-8');
    const nameMatch = gradle.match(/versionName\s*=\s*"([^"]+)"/);
    const codeMatch = gradle.match(/versionCode\s*=\s*([0-9]+)/);
    const versionName = nameMatch ? nameMatch[1].trim() : fallback.versionName;
    const versionCode = codeMatch ? Number(codeMatch[1]) : fallback.versionCode;
    return { versionName, versionCode };
  } catch {
    return fallback;
  }
}

function versionNameFromApkFilename(filename: string): string {
  const match = filename.match(/^photocloud-release-v([0-9]+(?:\.[0-9]+)*)-signed\.apk$/i);
  return match ? match[1] : '';
}

function compareVersionStrings(a: string, b: string): number {
  const pa = a.split('.').map((n) => parseInt(n, 10) || 0);
  const pb = b.split('.').map((n) => parseInt(n, 10) || 0);
  const len = Math.max(pa.length, pb.length);
  for (let i = 0; i < len; i++) {
    const diff = (pa[i] ?? 0) - (pb[i] ?? 0);
    if (diff !== 0) return diff;
  }
  return 0;
}

function resolveReleaseApk(preferredVersionName: string, manifestApkFilename?: string): string | null {
  if (!fs.existsSync(RELEASE_DIR)) return null;
  const exact = `photocloud-release-v${preferredVersionName}-signed.apk`;
  if (fs.existsSync(path.join(RELEASE_DIR, exact))) return exact;
  if (
    manifestApkFilename &&
    isValidSafeFilename(manifestApkFilename) &&
    fs.existsSync(path.join(RELEASE_DIR, manifestApkFilename))
  ) {
    return manifestApkFilename;
  }
  const apks = fs
    .readdirSync(RELEASE_DIR)
    .filter((f) => /^photocloud-release-v[0-9]+(?:\.[0-9]+)*-signed\.apk$/i.test(f));
  if (apks.length === 0) return null;
  apks.sort((x, y) => compareVersionStrings(versionNameFromApkFilename(y), versionNameFromApkFilename(x)));
  return apks[0];
}

function isValidSafeFilename(name: string): boolean {
  if (!name || typeof name !== 'string' || name.length > 255) return false;
  if (name.includes('/') || name.includes('\\') || name.includes('..') || name.includes('\0')) return false;
  if (name.startsWith('.')) return false;
  return true;
}

function parseCookieValue(req: Request, cookieName: string): string | null {
  const raw = req.headers.cookie;
  if (!raw) return null;
  for (const part of raw.split(';')) {
    const idx = part.indexOf('=');
    if (idx <= 0) continue;
    const k = part.slice(0, idx).trim();
    if (k === cookieName) {
      return decodeURIComponent(part.slice(idx + 1).trim());
    }
  }
  return null;
}

function getAuthenticatedV2User(
  req: Request,
  zkV2: ZkV2RouterHandle
): { userId: string; username: string } | null {
  const rawSid = parseCookieValue(req, V2_SESSION_COOKIE_NAME);
  if (!rawSid || rawSid.length < 32) return null;
  const sidHash = crypto.createHash('sha256').update(rawSid, 'utf8').digest();
  const row = zkV2.store.db
    .prepare(
      `SELECT s.user_id, s.expires_at, u.username
       FROM sessions_v2 s
       JOIN users_v2 u ON u.id = s.user_id
       WHERE s.sid_hash = ?`
    )
    .get(sidHash) as { user_id: string; expires_at: number; username: string } | undefined;
  if (!row || Date.now() >= row.expires_at) return null;
  return { userId: row.user_id, username: row.username };
}

export interface PhotoCloudServerOptions {
  vaultV2Dir?: string;
  tempUploadDir?: string;
  onSetupTokenGenerated?: (token: string) => void;
}

export function createPhotoCloudApp(options: PhotoCloudServerOptions = {}): {
  app: express.Express;
  zkV2: ZkV2RouterHandle;
  vaultV2Dir: string;
  tempUploadDir: string;
} {
  const vaultV2Dir = path.resolve(options.vaultV2Dir || DEFAULT_VAULT_V2_FOLDER);
  const tempUploadDir = path.resolve(options.tempUploadDir || DEFAULT_TEMP_UPLOAD_DIR);

  fs.mkdirSync(vaultV2Dir, { recursive: true });
  fs.mkdirSync(tempUploadDir, { recursive: true });
  fs.mkdirSync(RELEASE_BUILDS_DIR, { recursive: true });

  const app = express();
  app.disable('x-powered-by');

  const trustProxy = parseTrustProxyConfig(process.env.TRUST_PROXY);
  app.set('trust proxy', trustProxy);
  void initPushService(vaultV2Dir);

  // Global Security Headers & CSRF Origin Defense Middleware
  app.use((req: Request, res: Response, next: NextFunction) => {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('X-Frame-Options', 'SAMEORIGIN');
    res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
    res.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=()');
    res.setHeader('Cross-Origin-Opener-Policy', 'same-origin');
    res.setHeader(
      'Content-Security-Policy',
      "default-src 'self'; script-src 'self' 'wasm-unsafe-eval'; style-src 'self'; font-src 'self' data:; img-src 'self' data: blob:; media-src 'self' blob:; connect-src 'self'; object-src 'none'; base-uri 'self'; frame-ancestors 'self'"
    );

    if (['POST', 'PUT', 'DELETE', 'PATCH'].includes(req.method)) {
      const secFetchSite = String(req.headers['sec-fetch-site'] || '').trim().toLowerCase();
      if (secFetchSite === 'cross-site') {
        res.status(403).json({ error: 'Richiesta cross-site bloccata (CSRF protection).' });
        return;
      }
      const origin = req.headers.origin;
      if (typeof origin === 'string' && origin.trim().length > 0) {
        if (origin.trim().toLowerCase() === 'null') {
          res.status(403).json({ error: 'Header Origin null bloccato (CSRF protection).' });
          return;
        }
        try {
          const originUrl = new URL(origin);
          const originHost = originUrl.host.toLowerCase();
          const originProto = originUrl.protocol.replace(/:$/, '').toLowerCase();
          const trustProxyEnabled = Boolean(app.get('trust proxy'));

          const rawForwardedProto = trustProxyEnabled
            ? String(req.headers['x-forwarded-proto'] || '')
                .split(',')[0]
                .trim()
                .toLowerCase()
            : '';
          if ((rawForwardedProto === 'http' || rawForwardedProto === 'https') && originProto !== rawForwardedProto) {
            res.status(403).json({ error: 'Richiesta cross-origin bloccata (protocol mismatch CSRF protection).' });
            return;
          }

          let rawTargetHost = String(
            (trustProxyEnabled ? req.headers['x-forwarded-host'] : '') || req.headers.host || ''
          )
            .split(',')[0]
            .trim()
            .toLowerCase();
          const rawForwardedPort = trustProxyEnabled
            ? String(req.headers['x-forwarded-port'] || '')
                .split(',')[0]
                .trim()
            : '';
          if (rawTargetHost && !rawTargetHost.includes(':') && /^[0-9]{1,5}$/.test(rawForwardedPort)) {
            rawTargetHost = `${rawTargetHost}:${rawForwardedPort}`;
          }

          if (rawTargetHost) {
            const effectiveProto =
              rawForwardedProto === 'http' || rawForwardedProto === 'https' ? rawForwardedProto : originProto;
            const normalizedTargetHost = new URL(`${effectiveProto}://${rawTargetHost}`).host.toLowerCase();
            if (originHost !== normalizedTargetHost) {
              res.status(403).json({ error: 'Richiesta cross-origin bloccata (CSRF protection).' });
              return;
            }
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

  // 1. Mount Zero-Knowledge v2 API & Web App (ONLY encryption mode in PhotoCloud)
  const hasExplicitRegPolicy =
    typeof process.env.REGISTRATION_ENABLED === 'string' &&
    process.env.REGISTRATION_ENABLED.trim().length > 0;
  const hasInviteTokenEnv =
    typeof process.env.REGISTRATION_INVITE_TOKEN === 'string' &&
    process.env.REGISTRATION_INVITE_TOKEN.trim().length > 0;

  const zkV2 = createZkV2Router({
    vaultV2Dir,
    tempUploadDir,
    serverSecret: getOrCreateServerSecret(vaultV2Dir),
    maxUploadBytes: MAX_UPLOAD_BYTES,
    registrationEnabled: hasExplicitRegPolicy
      ? undefined
      : hasInviteTokenEnv
        ? 'setup_token_or_invite'
        : true,
    onSetupTokenGenerated:
      options.onSetupTokenGenerated ||
      ((token) => {
        console.log(
          `[PhotoCloud v2 Setup] First-registration single-use setup token (printed once): ${token}`
        );
      }),
  });
  app.use('/api/v2', zkV2.router);
  app.use('/v2', createZkV2WebRouter(APP_ROOT));

  // 2. Root & legacy UI entry points redirect permanently/directly to Zero-Knowledge v2
  for (const legacyPage of ['/', '/login', '/trash', '/map']) {
    app.get(legacyPage, (_req: Request, res: Response) => {
      res.redirect(302, '/v2');
    });
  }

  // 3. Static PWA & public release assets
  app.use('/static', express.static(STATIC_DIR));
  app.use(express.static(path.resolve(APP_ROOT, 'public'), { index: false }));
  app.use('/release', express.static(RELEASE_DIR));

  // 4. Web Push VAPID notifications (authenticated via V2 Zero-Knowledge session, never transmits user plaintext)
  app.get('/api/push/vapid-key', async (_req: Request, res: Response) => {
    let publicKey = getVapidPublicKey();
    if (!publicKey) {
      const initialized = await initPushService(vaultV2Dir);
      publicKey = initialized?.publicKey ?? null;
    }
    res.json({ publicKey });
  });

  app.post('/api/push/subscribe', (req: Request, res: Response) => {
    const sess = getAuthenticatedV2User(req, zkV2);
    if (!sess) {
      res.status(401).json({ error: 'UNAUTHENTICATED' });
      return;
    }
    const sub = req.body;
    if (!sub || typeof sub.endpoint !== 'string' || !sub.keys?.p256dh || !sub.keys?.auth) {
      res.status(400).json({ error: 'Sottoscrizione push non valida' });
      return;
    }
    const userPushDir = path.join(vaultV2Dir, 'push', sess.userId);
    fs.mkdirSync(userPushDir, { recursive: true });
    addUserSubscription(userPushDir, {
      endpoint: sub.endpoint,
      keys: { p256dh: String(sub.keys.p256dh), auth: String(sub.keys.auth) },
      userAgent: String(req.headers['user-agent'] || '').slice(0, 200),
      createdAt: Date.now(),
    });
    res.json({ success: true });
  });

  app.post('/api/push/unsubscribe', (req: Request, res: Response) => {
    const sess = getAuthenticatedV2User(req, zkV2);
    if (!sess) {
      res.status(401).json({ error: 'UNAUTHENTICATED' });
      return;
    }
    const endpoint = typeof req.body?.endpoint === 'string' ? req.body.endpoint : '';
    if (!endpoint) {
      res.status(400).json({ error: 'Endpoint mancante' });
      return;
    }
    const userPushDir = path.join(vaultV2Dir, 'push', sess.userId);
    removeUserSubscription(userPushDir, endpoint);
    res.json({ success: true });
  });

  // 5. Android Auto-Updater Manifest & On-Device AI TFLite Model (public read-only binaries, zero user data)
  app.get('/api/android/update-manifest', (_req: Request, res: Response) => {
    try {
      const appVersion = readAndroidAppVersion();
      const manifestPath = path.join(RELEASE_DIR, 'photocloud-release-build.json');
      let manifestData: Record<string, unknown> = {};
      if (fs.existsSync(manifestPath)) {
        manifestData = JSON.parse(fs.readFileSync(manifestPath, 'utf-8'));
      }

      const manifestVersionName =
        typeof manifestData.versionName === 'string'
          ? manifestData.versionName.trim().replace(/^v/, '')
          : '';
      const manifestVersionCode = Number(manifestData.versionCode || 0);
      const manifestAheadOfCode =
        manifestVersionCode > 0 && manifestVersionCode > appVersion.versionCode;

      const versionName = manifestAheadOfCode
        ? manifestVersionName || appVersion.versionName
        : appVersion.versionName;
      const versionCode = manifestAheadOfCode ? manifestVersionCode : appVersion.versionCode;

      const manifestApkFilename =
        typeof manifestData.apkFilename === 'string' ? manifestData.apkFilename : '';
      const resolvedApk = resolveReleaseApk(versionName, manifestApkFilename);
      if (!resolvedApk) {
        res.status(404).json({
          error: 'Nessun APK di release disponibile sul server',
          versionName,
          versionCode,
        });
        return;
      }

      const servedApkVersionName = versionNameFromApkFilename(resolvedApk);
      const apkMatchesAnnouncedVersion =
        servedApkVersionName !== '' && compareVersionStrings(servedApkVersionName, versionName) === 0;
      const servedVersionName = apkMatchesAnnouncedVersion ? versionName : servedApkVersionName || versionName;
      const servedVersionCode = apkMatchesAnnouncedVersion ? versionCode : 0;

      const apkPath = path.join(RELEASE_DIR, resolvedApk);
      const stat = fs.statSync(apkPath);
      const sha256 = crypto
        .createHash('sha256')
        .update(fs.readFileSync(apkPath))
        .digest('hex');

      const features = Array.isArray(manifestData.features) ? manifestData.features : [];
      const changelog =
        typeof manifestData.changelog === 'string' && manifestData.changelog.trim().length > 0
          ? manifestData.changelog
          : features.map((f) => `• ${String(f)}`).join('\n');

      res.json({
        applicationId: 'com.valerio.photocloud',
        versionName: servedVersionName,
        versionCode: servedVersionCode,
        apkFilename: resolvedApk,
        apkDownloadUrl: `/release/${resolvedApk}`,
        sizeBytes: stat.size,
        sha256,
        signingCertSha256:
          typeof manifestData.signingCertSha256 === 'string'
            ? manifestData.signingCertSha256.trim().toLowerCase()
            : undefined,
        changelog,
        features,
        publishedAt: String(manifestData.publishedAt || new Date().toISOString()),
      });
    } catch {
      res.status(500).json({ error: 'Impossibile leggere il manifest di aggiornamento' });
    }
  });

  app.get('/api/ai-model/efficientnet_lite4.tflite', (req: Request, res: Response) => {
    const modelPath = path.join(RELEASE_DIR, 'efficientnet_lite4.tflite');
    if (!fs.existsSync(modelPath)) {
      res.status(404).json({ error: 'Modello AI non presente sul server' });
      return;
    }

    try {
      const stat = fs.statSync(modelPath);
      const totalSize = stat.size;
      res.setHeader('Content-Type', 'application/octet-stream');
      res.setHeader('Accept-Ranges', 'bytes');
      res.setHeader('Content-Disposition', 'attachment; filename="efficientnet_lite4.tflite"');

      const parsedRange = parseHttpRangeHeader(req.headers.range, totalSize);
      if (parsedRange.kind === 'unsatisfiable') {
        res.status(416);
        res.setHeader('Content-Range', `bytes */${totalSize}`);
        res.end();
        return;
      }
      if (parsedRange.kind === 'satisfiable') {
        const chunkLength = parsedRange.end - parsedRange.start + 1;
        res.status(206);
        res.setHeader('Content-Range', `bytes ${parsedRange.start}-${parsedRange.end}/${totalSize}`);
        res.setHeader('Content-Length', String(chunkLength));
        fs.createReadStream(modelPath, { start: parsedRange.start, end: parsedRange.end }).pipe(res);
        return;
      }

      res.status(200);
      res.setHeader('Content-Length', String(totalSize));
      fs.createReadStream(modelPath).pipe(res);
    } catch {
      res.status(500).json({ error: 'Errore durante lo streaming del modello AI' });
    }
  });

  // 6. Android Release Studio API (authenticated via Zero-Knowledge v2 session)
  const BUILDS_INDEX_PATH = path.join(RELEASE_BUILDS_DIR, 'builds.json');

  function loadAndroidBuilds(): AndroidReleaseArtifact[] {
    try {
      if (fs.existsSync(BUILDS_INDEX_PATH)) {
        return JSON.parse(fs.readFileSync(BUILDS_INDEX_PATH, 'utf-8'));
      }
    } catch {
      // ignore
    }
    const appVersion = readAndroidAppVersion();
    const defaultApkFile =
      resolveReleaseApk(appVersion.versionName) ||
      `photocloud-release-v${appVersion.versionName}-signed.apk`;
    const defaultApkPath = path.join(RELEASE_DIR, defaultApkFile);
    const defaultSize = fs.existsSync(defaultApkPath) ? fs.statSync(defaultApkPath).size : 26214400;

    const initialBuild: AndroidReleaseArtifact = {
      buildId: `v${appVersion.versionName}-release`,
      timestamp: Date.now(),
      config: {
        appName: 'PhotoCloud',
        packageName: 'com.valerio.photocloud',
        versionName: appVersion.versionName,
        versionCode: appVersion.versionCode,
        serverUrl: 'http://10.0.2.2:3000',
        minSdk: 26,
        targetSdk: 35,
        enableBiometricLock: true,
        enableOfflineCache: true,
        enableAutoBackup: false,
        signingMode: 'release',
        keystoreAlias: 'photocloud-release-key',
      },
      apkFilename: defaultApkFile,
      aabFilename: `photocloud-release-v${appVersion.versionName}.aab`,
      projectZipFilename: `photocloud-android-studio-project-v${appVersion.versionName}.zip`,
      sha256Fingerprint: '1ec3cc2e2602d3ab4318cd9b23e297e2e795b91d05eceb6944d1ac1df860c90f',
      apkSizeBytes: defaultSize,
      steps: [],
    };
    fs.writeFileSync(BUILDS_INDEX_PATH, JSON.stringify([initialBuild], null, 2), 'utf-8');
    return [initialBuild];
  }

  app.get('/api/android/releases', (req: Request, res: Response) => {
    const sess = getAuthenticatedV2User(req, zkV2);
    if (!sess) {
      res.status(403).json({ error: 'Accesso negato (richiesta sessione Zero-Knowledge v2)' });
      return;
    }
    res.json({ releases: loadAndroidBuilds() });
  });

  app.post('/api/android/build-release', async (req: Request, res: Response) => {
    const sess = getAuthenticatedV2User(req, zkV2);
    if (!sess) {
      res.status(403).json({ success: false, error: 'Accesso negato (richiesta sessione Zero-Knowledge v2)' });
      return;
    }

    const config = req.body as AndroidBuildConfig;
    const validationError = validateAndroidConfig(config);
    if (validationError) {
      res.status(400).json({ success: false, error: validationError });
      return;
    }

    try {
      const buildId = crypto.randomBytes(4).toString('hex');
      const safeVer = config.versionName.trim();
      const apkFilename = `photocloud-release-v${safeVer}-signed.apk`;
      const projectZipFilename = `photocloud-android-studio-project-v${safeVer}.zip`;
      const sourceApkRel = resolveReleaseApk(safeVer) || apkFilename;
      const sourceApk = path.join(RELEASE_DIR, sourceApkRel);
      if (!fs.existsSync(sourceApk)) {
        res.status(404).json({
          success: false,
          error: "Nessun APK di release disponibile: compila prima l'APK con Gradle o GitHub Actions.",
        });
        return;
      }
      const apkBuffer = fs.readFileSync(sourceApk);
      fs.writeFileSync(path.join(RELEASE_BUILDS_DIR, `${buildId}_${apkFilename}`), apkBuffer);
      const sha256 = crypto.createHash('sha256').update(apkBuffer).digest('hex');

      const zip = new JSZip();
      const androidRoot = path.resolve(APP_ROOT, 'android-app');
      const addDirToZip = (dirPath: string, zipPrefix: string) => {
        if (!fs.existsSync(dirPath)) return;
        for (const entry of fs.readdirSync(dirPath, { withFileTypes: true })) {
          if (
            entry.name === '.gradle' ||
            entry.name === 'build' ||
            entry.name.endsWith('.jks') ||
            entry.name.endsWith('.keystore')
          ) {
            continue;
          }
          const fullEntry = path.join(dirPath, entry.name);
          const relZip = zipPrefix ? `${zipPrefix}/${entry.name}` : entry.name;
          if (entry.isDirectory()) {
            addDirToZip(fullEntry, relZip);
          } else if (entry.isFile()) {
            zip.file(relZip, fs.readFileSync(fullEntry));
          }
        }
      };
      addDirToZip(androidRoot, '');
      zip.file('app/build.gradle.kts', generateAppBuildGradleKts(config));
      zip.file('app/src/main/AndroidManifest.xml', generateAndroidManifestXml(config));
      const pkgPath = config.packageName.trim().replace(/\./g, '/');
      const realMainActivity = path.join(androidRoot, 'app/src/main/java/com/valerio/photocloud/MainActivity.kt');
      if (!fs.existsSync(realMainActivity) || pkgPath !== 'com/valerio/photocloud') {
        zip.file(`app/src/main/java/${pkgPath}/MainActivity.kt`, generateMainActivityKt(config));
      }

      const zipBuffer = await zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE' });
      fs.writeFileSync(path.join(RELEASE_BUILDS_DIR, `${buildId}_${projectZipFilename}`), zipBuffer);

      const artifact: AndroidReleaseArtifact = {
        buildId,
        timestamp: Date.now(),
        config,
        apkFilename,
        aabFilename: `photocloud-release-v${safeVer}.aab`,
        projectZipFilename,
        sha256Fingerprint: sha256,
        apkSizeBytes: apkBuffer.length,
        steps: [],
      };
      const existingBuilds = loadAndroidBuilds().slice(0, 49);
      fs.writeFileSync(BUILDS_INDEX_PATH, JSON.stringify([artifact, ...existingBuilds], null, 2), 'utf-8');
      res.json({ success: true, artifact });
    } catch {
      res.status(500).json({ success: false, error: 'Errore creazione release Android' });
    }
  });

  app.get('/api/android/download/:buildId/:type', (req: Request, res: Response) => {
    const sess = getAuthenticatedV2User(req, zkV2);
    if (!sess) {
      res.status(403).send('Accesso negato');
      return;
    }
    const buildId = String(req.params.buildId);
    const type = String(req.params.type);
    if (!/^[a-zA-Z0-9._-]{1,64}$/.test(buildId) || (type !== 'apk' && type !== 'project')) {
      res.status(400).send('Parametri richiesta non validi');
      return;
    }
    const builds = loadAndroidBuilds();
    const found = builds.find((b) => b.buildId === buildId) || builds[0];
    if (!found) {
      res.status(404).send('Release non trovata');
      return;
    }
    const fallbackVersionName = readAndroidAppVersion().versionName;
    const safeApkFilename = isValidSafeFilename(found.apkFilename)
      ? found.apkFilename
      : `photocloud-release-v${fallbackVersionName}-signed.apk`;
    const safeZipFilename = isValidSafeFilename(found.projectZipFilename)
      ? found.projectZipFilename
      : `photocloud-android-studio-project-v${fallbackVersionName}.zip`;

    if (type === 'apk') {
      const specificPath = path.resolve(RELEASE_BUILDS_DIR, `${buildId}_${safeApkFilename}`);
      const directPath = path.resolve(RELEASE_DIR, safeApkFilename);
      const targetPath =
        specificPath.startsWith(RELEASE_BUILDS_DIR + path.sep) && fs.existsSync(specificPath)
          ? specificPath
          : directPath;
      if (!fs.existsSync(targetPath)) {
        res.status(404).send('File APK non trovato');
        return;
      }
      res.setHeader('Content-Type', 'application/vnd.android.package-archive');
      res.setHeader('Content-Disposition', `attachment; filename="${encodeURIComponent(safeApkFilename)}"`);
      res.sendFile(targetPath);
    } else {
      const specificPath = path.resolve(RELEASE_BUILDS_DIR, `${buildId}_${safeZipFilename}`);
      if (!specificPath.startsWith(RELEASE_BUILDS_DIR + path.sep) || !fs.existsSync(specificPath)) {
        res.status(404).send('File ZIP progetto non trovato');
        return;
      }
      res.setHeader('Content-Type', 'application/zip');
      res.setHeader('Content-Disposition', `attachment; filename="${encodeURIComponent(safeZipFilename)}"`);
      res.sendFile(specificPath);
    }
  });

  // 7. All removed legacy server-side encryption (v1) routes fail closed with 410 Gone
  app.use((_req: Request, res: Response) => {
    res.status(410).json({
      error: 'SERVER_SIDE_ENCRYPTION_REMOVED',
      message:
        'La cifratura lato server (v1) è stata rimossa definitivamente. PhotoCloud utilizza esclusivamente crittografia Zero-Knowledge E2EE client-side su /v2 e /api/v2/*.',
      v2Url: '/v2',
    });
  });

  return { app, zkV2, vaultV2Dir, tempUploadDir };
}

async function startServer(): Promise<void> {
  const { app, vaultV2Dir } = createPhotoCloudApp();
  const port = Number(process.env.PORT) || 3000;
  app.listen(port, '0.0.0.0', () => {
    console.log(`PhotoCloud Zero-Knowledge E2EE server listening on http://0.0.0.0:${port} (vault: /v2)`);
  });

  void initPushService(vaultV2Dir).then((res) => {
    if (res) {
      console.log('PhotoCloud Web Push attivo (endpoint /api/push/* disponibili)');
    }
  });
}

const isMainEntry =
  typeof process.argv[1] === 'string' &&
  pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url;

if (isMainEntry) {
  void startServer();
}
