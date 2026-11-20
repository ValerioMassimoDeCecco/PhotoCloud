import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import type http from 'node:http';
import { createPhotoCloudApp } from '../../server';
import { ZkVaultClient } from '../client/zk-sdk/client';
import { generateMainActivityKt } from './androidBuilder';

const REPO_ROOT = path.resolve(process.cwd());

function walkFiles(dir: string): string[] {
  if (!fs.existsSync(dir)) return [];
  const out: string[] = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      out.push(...walkFiles(full));
    } else if (entry.isFile()) {
      out.push(full);
    }
  }
  return out;
}

function bufferContainsAsciiOrUtf8(buf: Buffer, needle: string): boolean {
  if (buf.includes(Buffer.from(needle, 'utf-8'))) return true;
  if (buf.includes(Buffer.from(needle, 'utf-8').toString('base64'))) return true;
  if (buf.includes(Buffer.from(needle, 'utf-8').toString('hex'))) return true;
  return false;
}

describe('Zero-Knowledge Only Repository Audit & E2EE Wire/Disk Proof', () => {
  it('Node & Rust servers contain ZERO symmetric encryption primitives or legacy v1 server-side options', () => {
    const forbiddenCryptoPattern =
      /\b(createCipheriv|createDecipheriv|aes-256-gcm|aes-256-cfb|pbkdf2Sync|PhotoCloud-GCM-v1|aes_gcm|cfb_mode)\b/i;

    const serverFiles = [
      path.join(REPO_ROOT, 'server.ts'),
      path.join(REPO_ROOT, 'src/lib/zkServerV2.ts'),
      path.join(REPO_ROOT, 'src/lib/vaultStorage.ts'),
      path.join(REPO_ROOT, 'rust/app/Cargo.toml'),
      ...walkFiles(path.join(REPO_ROOT, 'rust/app/src')).filter((f) => f.endsWith('.rs')),
    ];

    assert.ok(serverFiles.length >= 6, 'Expected Node & Rust server files to exist');

    for (const file of serverFiles) {
      const content = fs.readFileSync(file, 'utf-8');
      const strippedComments = content
        .replace(/\/\*[\s\S]*?\*\//g, '')
        .replace(/\/\/[^\n]*/g, '');
      assert.equal(
        forbiddenCryptoPattern.test(strippedComments),
        false,
        `Forbidden server-side encryption primitive found in ${path.relative(REPO_ROOT, file)}`
      );
      assert.equal(
        /PHOTOCLOUD_ZK_ONLY/.test(strippedComments),
        false,
        `Legacy PHOTOCLOUD_ZK_ONLY toggle should be removed from ${path.relative(REPO_ROOT, file)}`
      );
    }

    // Rust Cargo.toml must NOT depend on any symmetric cipher or image-decoding crates
    const cargoToml = fs.readFileSync(path.join(REPO_ROOT, 'rust/app/Cargo.toml'), 'utf-8');
    for (const bannedCrate of ['aes =', 'aes-gcm', 'cfb-mode', 'pbkdf2', 'hkdf', 'image =']) {
      assert.equal(
        cargoToml.includes(bannedCrate),
        false,
        `Rust Cargo.toml must not depend on ${bannedCrate}`
      );
    }

    // Legacy v1 server crypto modules must not exist
    assert.equal(fs.existsSync(path.join(REPO_ROOT, 'src/lib/crypto.ts')), false);
    assert.equal(fs.existsSync(path.join(REPO_ROOT, 'rust/app/src/crypto.rs')), false);
    assert.equal(fs.existsSync(path.join(REPO_ROOT, 'rust/app/src/units/auth.rs')), false);
    assert.equal(fs.existsSync(path.join(REPO_ROOT, 'rust/app/src/units/media.rs')), false);

    // Web /v2 and Android must NOT offer any toggle back to legacy v1
    const v2Ui = fs.readFileSync(path.join(REPO_ROOT, 'src/client/v2-app/main.ts'), 'utf-8');
    assert.equal(v2Ui.includes('PhotoCloud Classico'), false);
    assert.equal(v2Ui.includes('btn-back-v1'), false);

    const androidAuth = fs.readFileSync(
      path.join(REPO_ROOT, 'android-app/app/src/main/java/com/valerio/photocloud/zk/ZkV2AuthScreen.kt'),
      'utf-8'
    );
    assert.equal(androidAuth.includes('Torna a v1'), false);
    assert.equal(androidAuth.includes('ExitV2BetaToLegacy'), false);

    const androidMain = fs.readFileSync(
      path.join(REPO_ROOT, 'android-app/app/src/main/java/com/valerio/photocloud/MainActivity.kt'),
      'utf-8'
    );
    assert.equal(androidMain.includes('setZkV2Mode(false)'), false);

    // Generated Android studio template uses AES/GCM/NoPadding & /v2 only
    const generatedKt = generateMainActivityKt({
      appName: 'PhotoCloud',
      packageName: 'com.valerio.photocloud',
      versionName: '1.5.1',
      versionCode: 33,
      serverUrl: 'https://vault.example.test',
      signingMode: 'release',
      keystoreAlias: 'photocloud-release-key',
      enableBiometricLock: true,
      enableOfflineCache: true,
      enableAutoBackup: true,
      minSdk: 26,
      targetSdk: 35,
    });
    assert.equal(generatedKt.includes('AES/GCM/NoPadding'), true);
    assert.equal(generatedKt.includes('AES/CFB'), false);
    assert.equal(generatedKt.includes('gallery_legacy'), false);
    assert.equal(generatedKt.includes('/v2'), true);
  });

  it('Live server.ts rejects all removed v1 routes with 410 Gone, redirects / to /v2, and NEVER sees plaintext on wire or disk', async () => {
    const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'photocloud-zk-audit-'));
    const vaultV2Dir = path.join(tmpRoot, 'vault_v2');
    const tempUploadDir = path.join(tmpRoot, 'temp_uploads');

    let setupToken = '';
    const { app, zkV2 } = createPhotoCloudApp({
      vaultV2Dir,
      tempUploadDir,
      onSetupTokenGenerated: (tok) => {
        setupToken = tok;
      },
    });
    assert.ok(setupToken.length >= 16, 'Expected single-use setup token');

    const server: http.Server = await new Promise((resolve) => {
      const s = app.listen(0, '127.0.0.1', () => resolve(s));
    });
    const addr = server.address();
    assert.ok(addr && typeof addr === 'object');
    const baseUrl = `http://127.0.0.1:${addr.port}`;

    try {
      // 1. Legacy entry pages unconditionally redirect to /v2
      for (const p of ['/', '/login', '/trash', '/map']) {
        const res = await fetch(`${baseUrl}${p}`, { redirect: 'manual' });
        assert.equal(res.status, 302, `Expected 302 on ${p}`);
        assert.equal(res.headers.get('location'), '/v2', `Expected redirect to /v2 on ${p}`);
      }

      // 2. Removed legacy v1 server-side encryption routes fail closed with 410 Gone
      for (const [method, p] of [
        ['POST', '/register'],
        ['POST', '/login'],
        ['POST', '/upload'],
        ['GET', '/api/session'],
        ['GET', '/media/secret.jpg'],
        ['POST', '/api/upload/chunked/init'],
      ] as const) {
        const res = await fetch(`${baseUrl}${p}`, { method });
        assert.equal(res.status, 410, `Expected 410 Gone on ${method} ${p}`);
        const json = (await res.json()) as { error?: string };
        assert.equal(json.error, 'SERVER_SIDE_ENCRYPTION_REMOVED');
      }

      // 3. Full client-side E2EE flow with wire spy & disk canary scan
      const canaryPassphrase = 'CANARY_PASSPHRASE_CLIENT_ONLY_99482716!';
      const canaryFilename = 'CANARY_SECRET_CONTRACT_2026.txt';
      const canaryPlaintextBody = 'CANARY_PLAINTEXT_PAYLOAD_NEVER_VISIBLE_TO_SERVER_7726154';
      const canaryAlbumName = 'CANARY_PRIVATE_ALBUM_NAME_8812';

      const canaries = [
        canaryPassphrase,
        canaryFilename,
        canaryPlaintextBody,
        canaryAlbumName,
      ];

      // Spy fetch that captures EVERY byte sent from client to server
      const capturedWirePayloads: Buffer[] = [];

      const spyFetch: typeof fetch = async (input, init) => {
        const urlStr = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
        capturedWirePayloads.push(Buffer.from(urlStr, 'utf-8'));

        const headers = new Headers(init?.headers);
        headers.forEach((val, key) => {
          capturedWirePayloads.push(Buffer.from(`${key}: ${val}`, 'utf-8'));
        });

        let bodyToSend = init?.body;
        if (typeof bodyToSend === 'string') {
          capturedWirePayloads.push(Buffer.from(bodyToSend, 'utf-8'));
        } else if (bodyToSend instanceof Uint8Array) {
          capturedWirePayloads.push(Buffer.from(bodyToSend));
        } else if (bodyToSend instanceof ArrayBuffer) {
          capturedWirePayloads.push(Buffer.from(new Uint8Array(bodyToSend)));
        } else if (bodyToSend instanceof Blob) {
          const ab = await bodyToSend.arrayBuffer();
          capturedWirePayloads.push(Buffer.from(new Uint8Array(ab)));
          bodyToSend = new Uint8Array(ab);
        }

        return fetch(input, { ...init, headers, body: bodyToSend });
      };

      const client = new ZkVaultClient({ baseUrl, fetchFn: spyFetch });

      // Client registers (Argon2id + HKDF + wrappedVaultKey locally on client)
      const prepared = client.prepareRegistration('zk_audit_alice', canaryPassphrase, {
        memoryKiB: 65536,
        iterations: 3,
        parallelism: 1,
        hashLength: 32,
      });
      await client.register(prepared, canaryPassphrase, prepared.recoveryCode, {
        setupToken,
      });

      // Client encrypts & uploads file (PCZK v1 chunked AES-256-GCM + encrypted meta)
      const plainBytes = new TextEncoder().encode(canaryPlaintextBody);
      const uploaded = await client.uploadFile({
        name: canaryFilename,
        mimeType: 'text/plain',
        size: plainBytes.byteLength,
        source: plainBytes,
      });
      assert.ok(uploaded.blobId);

      // Client creates encrypted album catalog
      await client.saveAlbums((cat) => ({
        ...cat,
        albums: [
          ...cat.albums,
          {
            id: 'alb-1',
            title: canaryAlbumName,
            blobIds: [uploaded.blobId],
            createdAt: Date.now(),
            updatedAt: Date.now(),
          },
        ],
      }));

      // Client downloads & decrypts file and verifies exact bit-for-bit integrity
      const decryptedBytes = await client.downloadBlobToBytes(uploaded.blobId);
      assert.equal(new TextDecoder().decode(decryptedBytes), canaryPlaintextBody);

      // Client reloads items & albums and verifies decrypted metadata matches
      const items = await client.syncItems('all');
      assert.equal(items.length, 1);
      assert.equal(items[0].meta.name, canaryFilename);
      const loadedAlbums = await client.getAlbums();
      assert.equal(loadedAlbums.albums.length, 1);
      assert.equal(loadedAlbums.albums[0].title, canaryAlbumName);

      // PROOF 1: ZERO canary strings ever crossed the HTTP wire
      assert.ok(capturedWirePayloads.length >= 4, 'Expected captured wire requests');
      for (const wireBuf of capturedWirePayloads) {
        for (const canary of canaries) {
          assert.equal(
            bufferContainsAsciiOrUtf8(wireBuf, canary),
            false,
            `WIRE LEAK DETECTED: "${canary}" appeared in HTTP payload sent to server!`
          );
        }
      }

      // PROOF 2: ZERO canary strings exist anywhere on disk inside vault_v2/ or temp_uploads/
      const diskFiles = [...walkFiles(vaultV2Dir), ...walkFiles(tempUploadDir)];
      assert.ok(diskFiles.length >= 2, 'Expected vault_v2.db and encrypted blob files on disk');
      for (const file of diskFiles) {
        const raw = fs.readFileSync(file);
        for (const canary of canaries) {
          assert.equal(
            bufferContainsAsciiOrUtf8(raw, canary),
            false,
            `DISK LEAK DETECTED: "${canary}" found in server file ${path.relative(tmpRoot, file)}!`
          );
        }
      }

      // Verify uploaded blob file starts with PCZK v1 magic bytes (ciphertext envelope)
      const blobFiles = diskFiles.filter((f) => f.includes(uploaded.blobId));
      assert.ok(blobFiles.length >= 1, 'Expected encrypted blob file on disk');
      const header4 = fs.readFileSync(blobFiles[0]).subarray(0, 4).toString('ascii');
      assert.equal(header4, 'PCZK', 'On-disk blob must be PCZK v1 ciphertext envelope');

      await client.logout();
    } finally {
      await new Promise<void>((resolve) => server.close(() => resolve()));
      zkV2.close();
      fs.rmSync(tmpRoot, { recursive: true, force: true });
    }
  });
});
