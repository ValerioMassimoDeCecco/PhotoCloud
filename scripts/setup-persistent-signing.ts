import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';

const DEFAULT_REPO = 'ValerioMassimoDeCecco/PhotoCloud';
const VAULT_TAG = 'photocloud-signing-vault';
const VAULT_ASSET_NAME = 'photocloud-signing-vault.tar.gz';
const DEFAULT_ALIAS = 'photocloud-release-key';

interface SigningMetadata {
  version: number;
  keyAlias: string;
  storePassword: string;
  keyPassword: string;
  storeType: 'PKCS12' | 'JKS';
  certSha256: string;
  createdAt: string;
}

function commandExists(cmd: string): boolean {
  try {
    execFileSync(process.platform === 'win32' ? 'where' : 'which', [cmd], { stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
}

function computePkcs12CertSha256WithOpenSsl(p12Path: string, password: string): string {
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
  return crypto.createHash('sha256').update(derCert).digest('hex');
}

function createPersistentPkcs12Keystore(targetPath: string, password: string, alias: string): SigningMetadata {
  fs.mkdirSync(path.dirname(targetPath), { recursive: true, mode: 0o700 });

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
      { stdio: 'inherit' }
    );
    const derCert = execFileSync(
      'keytool',
      ['-exportcert', '-keystore', targetPath, '-alias', alias, '-storepass', password],
      { stdio: ['ignore', 'pipe', 'pipe'] }
    );
    const certSha256 = crypto.createHash('sha256').update(derCert).digest('hex');
    fs.chmodSync(targetPath, 0o600);
    return {
      version: 1,
      keyAlias: alias,
      storePassword: password,
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
    fs.chmodSync(targetPath, 0o600);
    const certSha256 = computePkcs12CertSha256WithOpenSsl(targetPath, password);
    return {
      version: 1,
      keyAlias: alias,
      storePassword: password,
      keyPassword: password,
      storeType: 'PKCS12',
      certSha256,
      createdAt: new Date().toISOString(),
    };
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
}

async function syncFromOrToGitHubDraftVault(
  token: string,
  repo: string,
  localKeystorePath: string,
  localMetaPath: string
): Promise<SigningMetadata | null> {
  const headers: Record<string, string> = {
    Authorization: `Bearer ${token}`,
    Accept: 'application/vnd.github+json',
    'X-GitHub-Api-Version': '2022-11-28',
    'User-Agent': 'PhotoCloud-Signing-Setup',
  };

  const listResp = await fetch(`https://api.github.com/repos/${repo}/releases?per_page=100`, { headers });
  if (!listResp.ok) {
    throw new Error(`Impossibile leggere le release GitHub (${listResp.status})`);
  }
  const releases = (await listResp.json()) as Array<{
    id: number;
    draft: boolean;
    tag_name: string;
    upload_url: string;
    assets?: Array<{ id: number; name: string; url: string }>;
  }>;

  const existingVault = releases.find(
    (r) => r.draft && r.tag_name === VAULT_TAG && Array.isArray(r.assets) && r.assets.some((a) => a.name === VAULT_ASSET_NAME)
  );

  if (existingVault) {
    const asset = existingVault.assets!.find((a) => a.name === VAULT_ASSET_NAME)!;
    const dlResp = await fetch(asset.url, {
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: 'application/octet-stream',
        'User-Agent': 'PhotoCloud-Signing-Setup',
      },
    });
    if (!dlResp.ok) {
      throw new Error(`Impossibile scaricare il vault di firma (${dlResp.status})`);
    }
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'photocloud-vault-dl-'));
    try {
      const tarPath = path.join(tmpDir, VAULT_ASSET_NAME);
      fs.writeFileSync(tarPath, Buffer.from(await dlResp.arrayBuffer()));
      execFileSync('tar', ['-xzf', tarPath, '-C', tmpDir], { stdio: 'pipe' });
      const extractedJks = path.join(tmpDir, 'release-signing.jks');
      const extractedMeta = path.join(tmpDir, 'signing-meta.json');
      const meta = JSON.parse(fs.readFileSync(extractedMeta, 'utf8')) as SigningMetadata;
      fs.mkdirSync(path.dirname(localKeystorePath), { recursive: true, mode: 0o700 });
      fs.copyFileSync(extractedJks, localKeystorePath);
      fs.chmodSync(localKeystorePath, 0o600);
      fs.writeFileSync(localMetaPath, JSON.stringify(meta, null, 2), { mode: 0o600 });
      console.log(`✅ Keystore persistente scaricato dal Draft Vault GitHub (${repo})!`);
      return meta;
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  }

  return null;
}

function writeSigningProperties(targetFile: string, keystorePath: string, meta: SigningMetadata): void {
  fs.mkdirSync(path.dirname(targetFile), { recursive: true });
  const content = [
    '# PhotoCloud Persistent Release Signing (NON committare su Git)',
    `storeFile=${keystorePath.replace(/\\/g, '/')}`,
    `storePassword=${meta.storePassword}`,
    `keyAlias=${meta.keyAlias}`,
    `keyPassword=${meta.keyPassword}`,
    `storeType=${meta.storeType}`,
    `certSha256=${meta.certSha256}`,
    '',
  ].join('\n');
  fs.writeFileSync(targetFile, content, { mode: 0o600 });
}

async function main() {
  const homeVaultDir = path.join(os.homedir(), '.photocloud');
  const homeKeystore = path.join(homeVaultDir, 'release-signing.p12');
  const homeMeta = path.join(homeVaultDir, 'signing-meta.json');
  const homeProps = path.join(homeVaultDir, 'signing.properties');
  const projectProps = path.resolve(process.cwd(), 'android-app', 'signing.properties');
  const repo = process.env.GITHUB_REPOSITORY || DEFAULT_REPO;
  const ghToken = (process.env.GITHUB_TOKEN || '').trim();

  let meta: SigningMetadata | null = null;

  if (ghToken) {
    try {
      meta = await syncFromOrToGitHubDraftVault(ghToken, repo, homeKeystore, homeMeta);
    } catch (err) {
      console.warn('⚠️ Sync dal Draft Vault GitHub non riuscito:', err instanceof Error ? err.message : err);
    }
  }

  if (!meta && fs.existsSync(homeKeystore) && fs.existsSync(homeMeta)) {
    meta = JSON.parse(fs.readFileSync(homeMeta, 'utf8')) as SigningMetadata;
    console.log(`✅ Keystore persistente locale già presente: ${homeKeystore}`);
  }

  if (!meta) {
    const password = crypto.randomBytes(24).toString('hex');
    meta = createPersistentPkcs12Keystore(homeKeystore, password, DEFAULT_ALIAS);
    fs.writeFileSync(homeMeta, JSON.stringify(meta, null, 2), { mode: 0o600 });
    console.log(`✅ Nuovo keystore persistente generato in ${homeKeystore}`);
  }

  writeSigningProperties(homeProps, homeKeystore, meta);
  if (fs.existsSync(path.resolve(process.cwd(), 'android-app'))) {
    writeSigningProperties(projectProps, homeKeystore, meta);
  }

  console.log('\n=== Riepilogo Firma Persistente Android ===');
  console.log(`Key Alias       : ${meta.keyAlias}`);
  console.log(`Formato         : ${meta.storeType}`);
  console.log(`Cert SHA-256    : ${meta.certSha256}`);
  console.log(`File Keystore   : ${homeKeystore}`);
  console.log(`File Properties : ${projectProps}`);
  console.log('\nTutte le build locali `gradle assembleRelease` useranno questa firma.');
  console.log('Su GitHub Actions, `android-release.yml` gestisce automaticamente il Draft Vault privato');
  console.log('oppure usa i Secret PHOTOCLOUD_KEYSTORE_* se preferisci caricare manualmente questo keystore:');
  console.log(`  base64 -w 0 "${homeKeystore}"   # -> PHOTOCLOUD_KEYSTORE_BASE64`);
}

main().catch((err) => {
  console.error('❌ Errore configurazione firma persistente:', err);
  process.exit(1);
});
