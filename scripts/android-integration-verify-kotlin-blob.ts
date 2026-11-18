import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { UNIFORM_AUTH_ERROR_MESSAGE, ZkVaultClient } from '../src/client/zk-sdk/index.ts';
import type { ZkKeyFileV2 } from '../src/client/zk-sdk/types.ts';

interface SeedConfig {
  baseUrl: string;
  username: string;
  userId: string;
  keyFile: ZkKeyFileV2;
  recoveryCode: string;
  passphrase: string;
  newPassphrase: string;
}

interface KotlinHandoff {
  kotlinBlobId: string;
  kotlinMetaName: string;
  kotlinPlaintextB64: string;
  updatedKeyFile: ZkKeyFileV2;
}

async function main(): Promise<void> {
  const configPath = path.resolve(process.env.ZK_INT_CONFIG_PATH ?? 'android-int-config.json');
  const outPath = path.resolve(process.env.ZK_INT_OUT_PATH ?? 'android-int-out.json');

  if (!fs.existsSync(configPath)) {
    throw new Error(`Missing ZK_INT_CONFIG_PATH: ${configPath}`);
  }
  if (!fs.existsSync(outPath)) {
    throw new Error(`Missing Kotlin handoff ZK_INT_OUT_PATH: ${outPath}`);
  }

  const cfg = JSON.parse(fs.readFileSync(configPath, 'utf8')) as SeedConfig;
  const handoff = JSON.parse(fs.readFileSync(outPath, 'utf8')) as KotlinHandoff;

  const client = new ZkVaultClient({ baseUrl: cfg.baseUrl });

  // 1. Old passphrase MUST fail cross-platform after Kotlin /api/v2/account/rewrap
  let oldPassRejected = false;
  try {
    await client.login(handoff.updatedKeyFile, cfg.passphrase);
  } catch (err) {
    assert.equal((err as Error).message, UNIFORM_AUTH_ERROR_MESSAGE);
    oldPassRejected = true;
  }
  assert.equal(oldPassRejected, true, 'Old passphrase MUST be rejected after Kotlin rewrap');

  // 2. New passphrase MUST unlock the vault using updatedKeyFile (or Recovery Code)
  const loggedIn = await client.login(handoff.updatedKeyFile, cfg.newPassphrase);
  assert.equal(loggedIn.username, cfg.username);
  assert.equal(loggedIn.userId, cfg.userId);

  // 3. Sync items and verify Kotlin-uploaded item metadata + encrypted PCZK v1 blob
  const items = await client.syncItems('active');
  const kotlinItem = items.find(
    (item) => item.blobId.toLowerCase() === handoff.kotlinBlobId.toLowerCase()
  );
  assert.ok(kotlinItem, `Kotlin uploaded blobId ${handoff.kotlinBlobId} not found in /api/v2/items`);
  assert.equal(kotlinItem.meta.name, handoff.kotlinMetaName);

  const decryptedBytes = await client.downloadBlobToBytes(kotlinItem.blobId);
  const expectedBytes = Buffer.from(handoff.kotlinPlaintextB64, 'base64');
  assert.equal(
    Buffer.compare(Buffer.from(decryptedBytes), expectedBytes),
    0,
    'Decrypted Kotlin PCZK blob bytes MUST match original plaintext'
  );

  await client.logout();
  console.log(
    `[android-integration-verify-kotlin-blob] OK user=${cfg.username} kotlinBlobId=${kotlinItem.blobId} name=${kotlinItem.meta.name} bytes=${expectedBytes.byteLength}`
  );
}

main().catch((err) => {
  console.error('[android-integration-verify-kotlin-blob] FAILED:', err);
  process.exit(1);
});
