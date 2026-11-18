import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { ZkVaultClient } from '../src/client/zk-sdk/index.ts';

function maskCiSecret(value: string): void {
  if (process.env.GITHUB_ACTIONS === 'true' && value) {
    process.stdout.write(`::add-mask::${value}\n`);
  }
}

async function main(): Promise<void> {
  const baseUrl = (process.env.ZK_INT_BASE_URL ?? '').trim().replace(/\/+$/, '');
  const setupToken = (process.env.ZK_INT_SETUP_TOKEN ?? '').trim();
  const configPath = path.resolve(
    process.env.ZK_INT_CONFIG_PATH ?? path.join(os.tmpdir(), 'photocloud-android-int-config.json')
  );
  const outPath = path.resolve(
    process.env.ZK_INT_OUT_PATH ?? path.join(os.tmpdir(), 'photocloud-android-int-out.json')
  );

  if (!baseUrl) {
    throw new Error('ZK_INT_BASE_URL is required');
  }
  if (!setupToken) {
    throw new Error('ZK_INT_SETUP_TOKEN is required');
  }

  const username = `android_int_${crypto.randomBytes(4).toString('hex')}`;
  const passphrase = `P4B-Init-${crypto.randomBytes(12).toString('hex')}!`;
  const newPassphrase = `P4B-Rot-${crypto.randomBytes(12).toString('hex')}!`;
  const seedName = 'ts-seed-4b.txt';
  const seedPlaintext = Buffer.from(
    'Seed Zero-Knowledge FASE 4B cifrato da TypeScript SDK per verifica Android Kotlin.',
    'utf8'
  );

  maskCiSecret(setupToken);
  maskCiSecret(passphrase);
  maskCiSecret(newPassphrase);

  const client = new ZkVaultClient({ baseUrl });
  const prepared = client.prepareRegistration(username, passphrase);

  maskCiSecret(prepared.recoveryCode);
  maskCiSecret(Buffer.from(prepared.accountKey).toString('hex'));
  maskCiSecret(Buffer.from(prepared.accountKey).toString('base64url'));

  const reg = await client.register(prepared, passphrase, prepared.recoveryCode, {
    setupToken,
  });
  maskCiSecret(reg.keyFile.accountKey);

  const uploaded = await client.uploadFile({
    name: seedName,
    mimeType: 'text/plain',
    size: seedPlaintext.byteLength,
    source: new Uint8Array(seedPlaintext),
  });

  await client.logout();
  prepared.accountKey.fill(0);
  prepared.userSalt.fill(0);

  const cfg = {
    baseUrl,
    username: reg.keyFile.username,
    userId: reg.userId,
    keyFile: reg.keyFile,
    recoveryCode: prepared.recoveryCode,
    passphrase,
    newPassphrase,
    seedBlobId: uploaded.blobId,
    expectedSeedName: seedName,
    expectedSeedPlaintextB64: seedPlaintext.toString('base64'),
    outputPath: outPath,
  };

  fs.mkdirSync(path.dirname(configPath), { recursive: true });
  fs.writeFileSync(configPath, JSON.stringify(cfg, null, 2) + '\n', { mode: 0o600 });

  console.log(`[android-integration-seed] OK user=${cfg.username} seedBlobId=${cfg.seedBlobId}`);
}

main().catch((err) => {
  console.error('[android-integration-seed] FAILED:', err);
  process.exit(1);
});
