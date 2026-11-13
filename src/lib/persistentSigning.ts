import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';

export interface PersistentSigningConfig {
  storeFile: string;
  storePassword: string;
  keyAlias: string;
  keyPassword: string;
  storeType: 'PKCS12' | 'JKS';
  certSha256?: string;
  createdAt?: string;
}

const DEFAULT_ALIAS = 'photocloud-release-key';

export function getProtectedSigningDir(homeDir = os.homedir()): string {
  return path.join(homeDir, '.photocloud');
}

export function getProtectedSigningPropertiesPath(
  env: NodeJS.ProcessEnv = process.env,
  homeDir = os.homedir()
): string {
  const customPath = (env.PHOTOCLOUD_SIGNING_PROPERTIES || '').trim();
  if (customPath) {
    return path.resolve(customPath);
  }
  return path.join(getProtectedSigningDir(homeDir), 'signing.properties');
}

export function parseSigningProperties(content: string): Record<string, string> {
  const result: Record<string, string> = {};
  for (const rawLine of content.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#') || line.startsWith('!')) continue;
    const eqIdx = line.indexOf('=');
    const colonIdx = line.indexOf(':');
    let sepIdx = -1;
    if (eqIdx >= 0 && colonIdx >= 0) {
      sepIdx = Math.min(eqIdx, colonIdx);
    } else {
      sepIdx = Math.max(eqIdx, colonIdx);
    }
    if (sepIdx <= 0) continue;

    const key = line.slice(0, sepIdx).trim();
    let val = line.slice(sepIdx + 1).trim();
    // Unescape Java .properties escape sequences
    val = val
      .replace(/\\:/g, ':')
      .replace(/\\=/g, '=')
      .replace(/\\\\/g, '\\');
    result[key] = val;
  }
  return result;
}

export function serializeSigningProperties(cfg: PersistentSigningConfig): string {
  const normalizedPath = cfg.storeFile.replace(/\\/g, '/');
  const lines = [
    '# PhotoCloud Protected Persistent Release Signing (Auto-loaded by Gradle & CLI; NEVER commit)',
    `storeFile=${normalizedPath}`,
    `storePassword=${cfg.storePassword}`,
    `keyAlias=${cfg.keyAlias}`,
    `keyPassword=${cfg.keyPassword}`,
    `storeType=${cfg.storeType || 'PKCS12'}`,
  ];
  if (cfg.certSha256) {
    lines.push(`certSha256=${cfg.certSha256}`);
  }
  if (cfg.createdAt) {
    lines.push(`createdAt=${cfg.createdAt}`);
  }
  return lines.join('\n') + '\n';
}

export function enforceProtectedPermissions(targetPath: string, isDirectory: boolean): void {
  if (process.platform === 'win32') return;
  try {
    fs.chmodSync(targetPath, isDirectory ? 0o700 : 0o600);
  } catch {
    // Ignore permission errors on read-only or synthetic filesystems
  }
}

export function readSigningPropertiesFile(filePath: string): Partial<PersistentSigningConfig> | null {
  if (!fs.existsSync(filePath)) return null;
  try {
    const parsed = parseSigningProperties(fs.readFileSync(filePath, 'utf8'));
    const storeFile = (parsed.storeFile || parsed.PHOTOCLOUD_KEYSTORE_PATH || '').trim();
    const storePassword = (parsed.storePassword || parsed.PHOTOCLOUD_KEYSTORE_PASSWORD || '').trim();
    const keyAlias = (parsed.keyAlias || parsed.PHOTOCLOUD_KEY_ALIAS || '').trim();
    const keyPassword = (parsed.keyPassword || parsed.PHOTOCLOUD_KEY_PASSWORD || '').trim();
    const rawType = (parsed.storeType || parsed.PHOTOCLOUD_KEYSTORE_TYPE || 'PKCS12').trim().toUpperCase();
    const storeType: 'PKCS12' | 'JKS' = rawType === 'JKS' ? 'JKS' : 'PKCS12';
    const certSha256 = (parsed.certSha256 || '').trim().toLowerCase() || undefined;
    const createdAt = (parsed.createdAt || '').trim() || undefined;
    if (!storeFile && !storePassword && !keyAlias && !keyPassword) return null;
    return {
      storeFile,
      storePassword,
      keyAlias,
      keyPassword,
      storeType,
      certSha256,
      createdAt,
    };
  } catch {
    return null;
  }
}

export function writeProtectedSigningProperties(
  filePath: string,
  cfg: PersistentSigningConfig
): void {
  const dir = path.dirname(filePath);
  fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
  enforceProtectedPermissions(dir, true);
  fs.writeFileSync(filePath, serializeSigningProperties(cfg), { encoding: 'utf8', mode: 0o600 });
  enforceProtectedPermissions(filePath, false);
}

function commandExists(cmd: string): boolean {
  try {
    execFileSync(process.platform === 'win32' ? 'where' : 'which', [cmd], { stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
}

export function computePkcs12CertSha256WithOpenSsl(p12Path: string, password: string): string {
  const pemCert = execFileSync(
    'openssl',
    ['pkcs12', '-in', p12Path, '-passin', `pass:${password}`, '-clcerts', '-nokeys'],
    { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }
  );
  const derCert = execFileSync(
    'openssl',
    ['x509', '-outform', 'DER'],
    { input: pemCert, stdio: ['pipe', 'pipe', 'pipe'] }
  );
  return crypto.createHash('sha256').update(derCert).digest('hex').toLowerCase();
}

export function createPersistentPkcs12Keystore(
  targetPath: string,
  password: string,
  alias = DEFAULT_ALIAS
): PersistentSigningConfig {
  const dir = path.dirname(targetPath);
  fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
  enforceProtectedPermissions(dir, true);

  if (commandExists('keytool')) {
    execFileSync(
      'keytool',
      [
        '-genkeypair',
        '-v',
        '-keystore',
        targetPath,
        '-storetype',
        'PKCS12',
        '-alias',
        alias,
        '-keyalg',
        'RSA',
        '-keysize',
        '2048',
        '-validity',
        '10000',
        '-storepass',
        password,
        '-keypass',
        password,
        '-dname',
        'CN=PhotoCloud Persistent Release, OU=Mobile, O=ValerioMassimoDeCecco, L=Rome, ST=RM, C=IT',
      ],
      { stdio: 'pipe' }
    );
    const derCert = execFileSync(
      'keytool',
      ['-exportcert', '-keystore', targetPath, '-alias', alias, '-storepass', password],
      { stdio: ['ignore', 'pipe', 'pipe'] }
    );
    const certSha256 = crypto.createHash('sha256').update(derCert).digest('hex').toLowerCase();
    enforceProtectedPermissions(targetPath, false);
    return {
      storeFile: targetPath,
      storePassword: password,
      keyAlias: alias,
      keyPassword: password,
      storeType: 'PKCS12',
      certSha256,
      createdAt: new Date().toISOString(),
    };
  }

  if (!commandExists('openssl')) {
    throw new Error('Né keytool (JDK) né openssl trovati nel sistema: impossibile generare il keystore.');
  }

  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'photocloud-keystore-'));
  const keyFile = path.join(tmpDir, 'release.key');
  const certFile = path.join(tmpDir, 'release.crt');
  try {
    execFileSync('openssl', ['genrsa', '-out', keyFile, '2048'], { stdio: 'pipe' });
    execFileSync(
      'openssl',
      [
        'req',
        '-new',
        '-x509',
        '-sha256',
        '-key',
        keyFile,
        '-out',
        certFile,
        '-days',
        '10000',
        '-subj',
        '/CN=PhotoCloud Persistent Release/OU=Mobile/O=ValerioMassimoDeCecco/L=Rome/ST=RM/C=IT',
      ],
      { stdio: 'pipe' }
    );
    execFileSync(
      'openssl',
      [
        'pkcs12',
        '-export',
        '-in',
        certFile,
        '-inkey',
        keyFile,
        '-out',
        targetPath,
        '-name',
        alias,
        '-passout',
        `pass:${password}`,
      ],
      { stdio: 'pipe' }
    );
    enforceProtectedPermissions(targetPath, false);
    const certSha256 = computePkcs12CertSha256WithOpenSsl(targetPath, password);
    return {
      storeFile: targetPath,
      storePassword: password,
      keyAlias: alias,
      keyPassword: password,
      storeType: 'PKCS12',
      certSha256,
      createdAt: new Date().toISOString(),
    };
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
}

export interface SigningEnvResolution {
  source: 'env' | 'user-protected-file' | 'project-file' | 'auto-generated' | 'none';
  propertiesPath: string;
  config: PersistentSigningConfig | null;
}

/**
 * Resolves signing credentials by unifying environment variables and `~/.photocloud/signing.properties`.
 * - Missing env vars are automatically populated from `~/.photocloud/signing.properties` (and optional project `signing.properties`).
 * - Complete env vars provided on a local (non-CI) machine are persisted automatically to `~/.photocloud/signing.properties`
 *   if not already stored, ensuring subsequent builds reuse the exact same signature without manual re-entry.
 */
export function applySigningEnvFromProtectedConfig(options?: {
  env?: NodeJS.ProcessEnv;
  homeDir?: string;
  projectDir?: string;
  persistEnvToProtectedFile?: boolean;
}): SigningEnvResolution {
  const env = options?.env ?? process.env;
  const homeDir = options?.homeDir ?? os.homedir();
  const projectDir = options?.projectDir ?? path.resolve(process.cwd(), 'android-app');
  const protectedPropsPath = getProtectedSigningPropertiesPath(env, homeDir);
  const projectPropsPath = path.join(projectDir, 'signing.properties');

  const envPath = (env.PHOTOCLOUD_KEYSTORE_PATH || env.KEYSTORE_PATH || '').trim();
  const envStorePass = (env.PHOTOCLOUD_KEYSTORE_PASSWORD || env.KEYSTORE_PASSWORD || '').trim();
  const envAlias = (env.PHOTOCLOUD_KEY_ALIAS || env.KEY_ALIAS || '').trim();
  const envKeyPass = (env.PHOTOCLOUD_KEY_PASSWORD || env.KEY_PASSWORD || '').trim();
  const envType = ((env.PHOTOCLOUD_KEYSTORE_TYPE || env.KEYSTORE_TYPE || '').trim().toUpperCase() === 'JKS'
    ? 'JKS'
    : 'PKCS12') as 'PKCS12' | 'JKS';

  const hasCompleteEnv = Boolean(envPath && envStorePass && envAlias && envKeyPass && fs.existsSync(envPath));
  const userCfg = readSigningPropertiesFile(protectedPropsPath);
  const projectCfg = readSigningPropertiesFile(projectPropsPath);
  const chosenFileCfg =
    userCfg?.storeFile && userCfg.storePassword && userCfg.keyAlias && userCfg.keyPassword
      ? { cfg: userCfg, source: 'user-protected-file' as const }
      : projectCfg?.storeFile && projectCfg.storePassword && projectCfg.keyAlias && projectCfg.keyPassword
      ? { cfg: projectCfg, source: 'project-file' as const }
      : null;

  const isCi = env.CI === 'true' || env.GITHUB_ACTIONS === 'true';
  const shouldPersist = options?.persistEnvToProtectedFile ?? !isCi;

  if (hasCompleteEnv) {
    const resolvedCfg: PersistentSigningConfig = {
      storeFile: path.resolve(envPath),
      storePassword: envStorePass,
      keyAlias: envAlias,
      keyPassword: envKeyPass,
      storeType: envType,
      certSha256: userCfg?.certSha256,
    };

    if (shouldPersist && !fs.existsSync(protectedPropsPath)) {
      const targetKeystore = path.join(path.dirname(protectedPropsPath), path.basename(envPath) || 'release-signing.p12');
      fs.mkdirSync(path.dirname(protectedPropsPath), { recursive: true, mode: 0o700 });
      enforceProtectedPermissions(path.dirname(protectedPropsPath), true);
      const absEnvPath = path.resolve(envPath);
      const savedKeystorePath =
        path.resolve(targetKeystore) === absEnvPath
          ? absEnvPath
          : (() => {
              fs.copyFileSync(absEnvPath, targetKeystore);
              enforceProtectedPermissions(targetKeystore, false);
              return targetKeystore;
            })();
      writeProtectedSigningProperties(protectedPropsPath, {
        ...resolvedCfg,
        storeFile: savedKeystorePath,
        createdAt: new Date().toISOString(),
      });
    }

    return { source: 'env', propertiesPath: protectedPropsPath, config: resolvedCfg };
  }

  if (chosenFileCfg?.cfg.storeFile && chosenFileCfg.cfg.storePassword && chosenFileCfg.cfg.keyAlias && chosenFileCfg.cfg.keyPassword) {
    const fileCfg = chosenFileCfg.cfg;
    const rawFile = fileCfg.storeFile!;
    const resolvedStorePath = path.isAbsolute(rawFile)
      ? rawFile
      : fs.existsSync(path.join(path.dirname(protectedPropsPath), rawFile))
      ? path.join(path.dirname(protectedPropsPath), rawFile)
      : path.resolve(projectDir, rawFile);

    const resolvedCfg: PersistentSigningConfig = {
      storeFile: resolvedStorePath,
      storePassword: fileCfg.storePassword!,
      keyAlias: fileCfg.keyAlias!,
      keyPassword: fileCfg.keyPassword!,
      storeType: fileCfg.storeType || 'PKCS12',
      certSha256: fileCfg.certSha256,
      createdAt: fileCfg.createdAt,
    };

    if (!env.PHOTOCLOUD_KEYSTORE_PATH) env.PHOTOCLOUD_KEYSTORE_PATH = resolvedCfg.storeFile;
    if (!env.PHOTOCLOUD_KEYSTORE_PASSWORD) env.PHOTOCLOUD_KEYSTORE_PASSWORD = resolvedCfg.storePassword;
    if (!env.PHOTOCLOUD_KEY_ALIAS) env.PHOTOCLOUD_KEY_ALIAS = resolvedCfg.keyAlias;
    if (!env.PHOTOCLOUD_KEY_PASSWORD) env.PHOTOCLOUD_KEY_PASSWORD = resolvedCfg.keyPassword;
    if (!env.PHOTOCLOUD_KEYSTORE_TYPE) env.PHOTOCLOUD_KEYSTORE_TYPE = resolvedCfg.storeType;

    // Backfill ~/.photocloud/signing.properties if loaded only from project file
    if (shouldPersist && chosenFileCfg.source === 'project-file' && !fs.existsSync(protectedPropsPath)) {
      writeProtectedSigningProperties(protectedPropsPath, resolvedCfg);
    }

    return { source: chosenFileCfg.source, propertiesPath: protectedPropsPath, config: resolvedCfg };
  }

  return { source: 'none', propertiesPath: protectedPropsPath, config: null };
}

/**
 * Ensures a persistent local keystore exists in `~/.photocloud/signing.properties`
 * and exports `PHOTOCLOUD_KEYSTORE_*` environment variables for Gradle/scripts.
 */
export function ensurePersistentLocalSigning(options?: {
  env?: NodeJS.ProcessEnv;
  homeDir?: string;
  projectDir?: string;
  autoCreateIfMissing?: boolean;
}): SigningEnvResolution {
  const env = options?.env ?? process.env;
  const homeDir = options?.homeDir ?? os.homedir();
  const projectDir = options?.projectDir ?? path.resolve(process.cwd(), 'android-app');
  const existing = applySigningEnvFromProtectedConfig({ env, homeDir, projectDir });
  if (existing.config && fs.existsSync(existing.config.storeFile)) {
    return existing;
  }

  const isCi = env.CI === 'true' || env.GITHUB_ACTIONS === 'true';
  const shouldCreate = options?.autoCreateIfMissing ?? !isCi;
  if (!shouldCreate) {
    return existing;
  }

  const protectedPropsPath = getProtectedSigningPropertiesPath(env, homeDir);
  const vaultDir = path.dirname(protectedPropsPath);
  const keystorePath = path.join(vaultDir, 'release-signing.p12');
  const password = crypto.randomBytes(24).toString('hex');
  const createdCfg = createPersistentPkcs12Keystore(keystorePath, password, DEFAULT_ALIAS);
  writeProtectedSigningProperties(protectedPropsPath, createdCfg);

  const projectPropsPath = path.join(projectDir, 'signing.properties');
  if (fs.existsSync(projectDir) && !fs.existsSync(projectPropsPath)) {
    writeProtectedSigningProperties(projectPropsPath, createdCfg);
  }

  env.PHOTOCLOUD_KEYSTORE_PATH = createdCfg.storeFile;
  env.PHOTOCLOUD_KEYSTORE_PASSWORD = createdCfg.storePassword;
  env.PHOTOCLOUD_KEY_ALIAS = createdCfg.keyAlias;
  env.PHOTOCLOUD_KEY_PASSWORD = createdCfg.keyPassword;
  env.PHOTOCLOUD_KEYSTORE_TYPE = createdCfg.storeType;

  return {
    source: 'auto-generated',
    propertiesPath: protectedPropsPath,
    config: createdCfg,
  };
}
