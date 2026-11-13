import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import {
  applySigningEnvFromProtectedConfig,
  createPersistentPkcs12Keystore,
  enforceProtectedPermissions,
  getProtectedSigningDir,
  getProtectedSigningPropertiesPath,
  PersistentSigningConfig,
  readSigningPropertiesFile,
  writeProtectedSigningProperties,
} from '../src/lib/persistentSigning';

const DEFAULT_REPO = 'ValerioMassimoDeCecco/PhotoCloud';
const VAULT_TAG = 'photocloud-signing-vault';
const VAULT_ASSET_NAME = 'photocloud-signing-vault.tar.gz';
const DEFAULT_ALIAS = 'photocloud-release-key';

async function syncFromGitHubDraftVault(
  token: string,
  repo: string,
  localKeystorePath: string,
  protectedPropsPath: string
): Promise<PersistentSigningConfig | null> {
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
    assets?: Array<{ id: number; name: string; url: string }>;
  }>;

  const existingVault = releases.find(
    (r) =>
      r.draft &&
      r.tag_name === VAULT_TAG &&
      Array.isArray(r.assets) &&
      r.assets.some((a) => a.name === VAULT_ASSET_NAME)
  );
  if (!existingVault) return null;

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
    const meta = JSON.parse(fs.readFileSync(extractedMeta, 'utf8')) as {
      keyAlias: string;
      storePassword: string;
      keyPassword: string;
      storeType?: 'PKCS12' | 'JKS';
      certSha256?: string;
      createdAt?: string;
    };

    const dir = path.dirname(localKeystorePath);
    fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
    enforceProtectedPermissions(dir, true);
    fs.copyFileSync(extractedJks, localKeystorePath);
    enforceProtectedPermissions(localKeystorePath, false);

    const cfg: PersistentSigningConfig = {
      storeFile: localKeystorePath,
      storePassword: meta.storePassword,
      keyAlias: meta.keyAlias,
      keyPassword: meta.keyPassword,
      storeType: meta.storeType || 'PKCS12',
      certSha256: meta.certSha256,
      createdAt: meta.createdAt || new Date().toISOString(),
    };
    writeProtectedSigningProperties(protectedPropsPath, cfg);
    console.log(`✅ Keystore persistente scaricato dal Draft Vault GitHub (${repo}) in ${protectedPropsPath}!`);
    return cfg;
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
}

async function main() {
  const vaultDir = getProtectedSigningDir();
  const protectedPropsPath = getProtectedSigningPropertiesPath();
  const homeKeystore = path.join(vaultDir, 'release-signing.p12');
  const projectProps = path.resolve(process.cwd(), 'android-app', 'signing.properties');
  const repo = process.env.GITHUB_REPOSITORY || DEFAULT_REPO;
  const ghToken = (process.env.GITHUB_TOKEN || '').trim();

  let cfg: PersistentSigningConfig | null = null;

  if (ghToken) {
    try {
      cfg = await syncFromGitHubDraftVault(ghToken, repo, homeKeystore, protectedPropsPath);
    } catch (err) {
      console.warn('⚠️ Sync dal Draft Vault GitHub non riuscito:', err instanceof Error ? err.message : err);
    }
  }

  if (!cfg) {
    const resolved = applySigningEnvFromProtectedConfig();
    if (resolved.config && fs.existsSync(resolved.config.storeFile)) {
      cfg = resolved.config;
      console.log(`✅ Configurazione firma persistente già attiva (${resolved.source}): ${protectedPropsPath}`);
    }
  }

  if (!cfg) {
    const existingProps = readSigningPropertiesFile(protectedPropsPath);
    if (existingProps?.storeFile && fs.existsSync(existingProps.storeFile) && existingProps.storePassword && existingProps.keyAlias && existingProps.keyPassword) {
      cfg = {
        storeFile: existingProps.storeFile,
        storePassword: existingProps.storePassword,
        keyAlias: existingProps.keyAlias,
        keyPassword: existingProps.keyPassword,
        storeType: existingProps.storeType || 'PKCS12',
        certSha256: existingProps.certSha256,
        createdAt: existingProps.createdAt,
      };
    }
  }

  if (!cfg) {
    const password = crypto.randomBytes(24).toString('hex');
    cfg = createPersistentPkcs12Keystore(homeKeystore, password, DEFAULT_ALIAS);
    writeProtectedSigningProperties(protectedPropsPath, cfg);
    console.log(`✅ Nuovo keystore persistente protetto creato in ${protectedPropsPath} (permessi 0600)`);
  }

  if (fs.existsSync(path.resolve(process.cwd(), 'android-app'))) {
    writeProtectedSigningProperties(projectProps, cfg);
  }

  console.log('\n=== Riepilogo Firma Persistente Protetta Android ===');
  console.log(`Config Protetta : ${protectedPropsPath}`);
  console.log(`File Keystore   : ${cfg.storeFile}`);
  console.log(`Key Alias       : ${cfg.keyAlias}`);
  console.log(`Formato         : ${cfg.storeType}`);
  if (cfg.certSha256) {
    console.log(`Cert SHA-256    : ${cfg.certSha256}`);
  }
  console.log('\nTutte le build Gradle/Node future caricheranno automaticamente ~/.photocloud/signing.properties');
  console.log('senza alcun reinserimento manuale delle credenziali.');
}

main().catch((err) => {
  console.error('❌ Errore configurazione firma persistente:', err);
  process.exit(1);
});
