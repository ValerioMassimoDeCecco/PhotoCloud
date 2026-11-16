import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import {
  createZkV2App,
  createRedactingLogger,
  PCZK_MAGIC,
  PCZK_VERSION_V1,
  V2_SESSION_COOKIE_NAME,
} from './zkServerV2';
import {
  encryptBlobStream,
  decryptBlobStream,
  encryptMeta,
  computeDedupTag,
  deriveSubkeys,
  wrapVaultKey,
  wrapFileKeyForShare,
} from './zk';

// ============================================================================
// Test Helpers
// ============================================================================

interface TestServerHandle {
  baseUrl: string;
  vaultV2Dir: string;
  tempUploadDir: string;
  serverSecret: Buffer;
  logLines: string[];
  setNow: (ms: number) => void;
  advanceTime: (deltaMs: number) => void;
  close: () => Promise<void>;
}

async function startTestV2Server(opts?: {
  vaultV2Dir?: string;
  tempUploadDir?: string;
  serverSecret?: Buffer;
  defaultQuotaBytes?: number;
  maxUploadBytes?: number;
  sessionTtlMs?: number;
  trashTtlMs?: number;
  loginRateLimitMax?: number;
  shareRateLimitMaxPerIp?: number;
  shareRateLimitMaxPerShare?: number;
  trustProxy?: string | boolean;
  initialNow?: number;
}): Promise<TestServerHandle> {
  const rootTmp = fs.mkdtempSync(path.join(os.tmpdir(), 'photocloud-v2-test-'));
  const vaultV2Dir = opts?.vaultV2Dir ?? path.join(rootTmp, 'vault_v2');
  const tempUploadDir = opts?.tempUploadDir ?? path.join(rootTmp, 'temp_uploads');
  const serverSecret = opts?.serverSecret ?? crypto.randomBytes(32);
  const logLines: string[] = [];
  let currentNow = opts?.initialNow ?? Date.now();

  const logger = createRedactingLogger((line) => {
    logLines.push(line);
  });

  const { app, close: closeStore } = createZkV2App({
    vaultV2Dir,
    tempUploadDir,
    serverSecret,
    defaultQuotaBytes: opts?.defaultQuotaBytes,
    maxUploadBytes: opts?.maxUploadBytes,
    sessionTtlMs: opts?.sessionTtlMs,
    trashTtlMs: opts?.trashTtlMs,
    loginRateLimitMax: opts?.loginRateLimitMax,
    shareRateLimitMaxPerIp: opts?.shareRateLimitMaxPerIp,
    shareRateLimitMaxPerShare: opts?.shareRateLimitMaxPerShare,
    trustProxy: opts?.trustProxy,
    logger,
    nowFn: () => currentNow,
  });

  const httpServer = http.createServer(app);
  await new Promise<void>((resolve) => {
    httpServer.listen(0, '127.0.0.1', () => resolve());
  });
  const addr = httpServer.address();
  if (!addr || typeof addr === 'string') {
    throw new Error('Impossibile ottenere porta server test');
  }
  const baseUrl = `http://127.0.0.1:${addr.port}`;

  return {
    baseUrl,
    vaultV2Dir,
    tempUploadDir,
    serverSecret,
    logLines,
    setNow: (ms: number) => {
      currentNow = ms;
    },
    advanceTime: (deltaMs: number) => {
      currentNow += deltaMs;
    },
    close: async () => {
      httpServer.closeAllConnections();
      await new Promise<void>((resolve, reject) => {
        httpServer.close((err) => (err ? reject(err) : resolve()));
      });
      closeStore();
    },
  };
}

function extractSessionCookie(res: Response): string {
  const setCookie = res.headers.get('set-cookie') || '';
  const match = new RegExp(`${V2_SESSION_COOKIE_NAME}=([^;]+)`).exec(setCookie);
  return match ? `${V2_SESSION_COOKIE_NAME}=${match[1]}` : '';
}

async function generateValidPczkBlob(
  vaultKey: Uint8Array,
  blobId: string,
  plaintext: Uint8Array,
  chunkSizeLog2 = 20
): Promise<{
  ciphertext: Buffer;
  sha256Hex: string;
  encMetaB64: string;
  dedupTagHex: string;
  fileKey: Uint8Array;
}> {
  const fileKey = crypto.randomBytes(32);
  const subkeys = await deriveSubkeys(vaultKey);
  const chunks: Buffer[] = [];
  for await (const c of encryptBlobStream(plaintext, {
    fkWrapKey: subkeys.fkWrapKey,
    blobId,
    fileKey,
    chunkSizeLog2,
  })) {
    chunks.push(Buffer.from(c));
  }
  const ciphertext = Buffer.concat(chunks);
  const sha256Hex = crypto.createHash('sha256').update(ciphertext).digest('hex');

  const metaBytes = await encryptMeta(subkeys.metaKey, blobId, {
    v: 1,
    name: `secret-photo-${blobId.slice(0, 6)}.jpg`,
    mime: 'image/jpeg',
    size: plaintext.byteLength,
    takenAt: 1700000000000,
    createdAt: 1700000000000,
  });
  const encMetaB64 = Buffer.from(metaBytes).toString('base64url');

  const dedup = await computeDedupTag(subkeys.dedupKey, plaintext);
  const dedupTagHex = dedup.tagHex;

  return {
    ciphertext,
    sha256Hex,
    encMetaB64,
    dedupTagHex,
    fileKey,
  };
}

async function registerTestUser(
  baseUrl: string,
  username: string
): Promise<{
  userId: string;
  cookie: string;
  setCookieRaw: string;
  authSecretB64: string;
  wrappedVkB64: string;
  saltB64: string;
  vaultKey: Uint8Array;
}> {
  const salt = crypto.randomBytes(16);
  const authSecret = crypto.randomBytes(32);
  const kek = crypto.randomBytes(32);
  const vaultKey = crypto.randomBytes(32);
  const wrappedVk = await wrapVaultKey(vaultKey, kek, username);

  const saltB64 = salt.toString('base64url');
  const authSecretB64 = authSecret.toString('base64url');
  const wrappedVkB64 = Buffer.from(wrappedVk).toString('base64url');

  const res = await fetch(`${baseUrl}/api/v2/register`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      username,
      salt: saltB64,
      kdfParams: {
        algorithm: 'Argon2id',
        memoryKiB: 65536,
        iterations: 3,
        parallelism: 1,
      },
      authSecret: authSecretB64,
      wrappedVaultKey: wrappedVkB64,
    }),
  });

  assert.equal(res.status, 201);
  const body = (await res.json()) as { userId: string };
  const setCookieRaw = res.headers.get('set-cookie') || '';
  const cookie = extractSessionCookie(res);
  return {
    userId: body.userId,
    cookie,
    setCookieRaw,
    authSecretB64,
    wrappedVkB64,
    saltB64,
    vaultKey,
  };
}

// ============================================================================
// Suite di Test FASE 2 — Server API v2
// ============================================================================

describe('FASE 2 — PhotoCloud Zero-Knowledge Server API v2 (/api/v2/*)', () => {
  it('1. Verifica statica di cecità del server: zkServerV2.ts non importa né contiene primitive di decifratura contenuto', () => {
    const serverV2Source = fs.readFileSync(path.resolve(process.cwd(), 'src/lib/zkServerV2.ts'), 'utf8');
    // Il codice server v2 non deve mai importare ./crypto o ./zk
    assert.equal(/from\s+['"]\.\/crypto['"]/.test(serverV2Source), false);
    assert.equal(/from\s+['"]\.\/zk/.test(serverV2Source), false);
    // Non deve contenere createCipheriv / createDecipheriv / aes-256-gcm / aes-256-cfb
    assert.equal(/createCipheriv|createDecipheriv|aes-256-gcm|aes-256-cfb/i.test(serverV2Source), false);
  });

  it('2. Ciclo completo: register, login, upload chunked multi-parte, GET con Range (prefisso, mezzo, suffisso, multi-chunk), identità byte-a-byte e rewrap', async () => {
    const srv = await startTestV2Server();
    try {
      const alice = await registerTestUser(srv.baseUrl, 'alice');
      // Verifica attributi di sicurezza del cookie di sessione
      assert.match(alice.setCookieRaw, /HttpOnly/i);
      assert.match(alice.setCookieRaw, /Secure/i);
      assert.match(alice.setCookieRaw, /SameSite=Strict/i);

      // Logout e successivo Login con authSecret
      const logoutRes = await fetch(`${srv.baseUrl}/api/v2/logout`, {
        method: 'POST',
        headers: { Cookie: alice.cookie },
      });
      assert.equal(logoutRes.status, 200);

      // Sessione revocata -> 401
      const afterLogoutRes = await fetch(`${srv.baseUrl}/api/v2/stats`, {
        headers: { Cookie: alice.cookie },
      });
      assert.equal(afterLogoutRes.status, 401);

      // Login valido
      const loginRes = await fetch(`${srv.baseUrl}/api/v2/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          username: 'alice',
          authSecret: alice.authSecretB64,
        }),
      });
      assert.equal(loginRes.status, 200);
      const loginData = (await loginRes.json()) as {
        userId: string;
        wrappedVaultKey: string;
        salt: string;
      };
      assert.equal(loginData.userId, alice.userId);
      assert.equal(loginData.wrappedVaultKey, alice.wrappedVkB64);
      assert.equal(loginData.salt, alice.saltB64);
      const sessionCookie = extractSessionCookie(loginRes);
      assert.ok(sessionCookie.length > 20);

      // Prepariamo un blob PCZK multi-chunk (3 chunk di plaintext da 64 KiB -> ~150 KiB)
      const blobId = crypto.randomUUID();
      const plaintext = crypto.randomBytes(150_000);
      const pczk = await generateValidPczkBlob(alice.vaultKey, blobId, plaintext, 16);

      // Dividiamo il trasporto HTTP in 3 parti (upload chunked/resumable)
      const part0 = pczk.ciphertext.subarray(0, 50_000);
      const part1 = pczk.ciphertext.subarray(50_000, 100_000);
      const part2 = pczk.ciphertext.subarray(100_000);

      const initRes = await fetch(`${srv.baseUrl}/api/v2/blobs/upload/init`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Cookie: sessionCookie,
        },
        body: JSON.stringify({
          blobId,
          totalSize: pczk.ciphertext.byteLength,
          chunkSize: 50_000,
          totalChunks: 3,
          expectedSha256: pczk.sha256Hex,
          encMeta: pczk.encMetaB64,
          dedupTag: pczk.dedupTagHex,
        }),
      });
      assert.equal(initRes.status, 201);
      const { uploadId } = (await initRes.json()) as { uploadId: string };

      for (const [idx, buf] of [part0, part1, part2].entries()) {
        const putRes = await fetch(`${srv.baseUrl}/api/v2/blobs/upload/${uploadId}/${idx}`, {
          method: 'PUT',
          headers: {
            'Content-Type': 'application/octet-stream',
            Cookie: sessionCookie,
          },
          body: new Uint8Array(buf),
        });
        assert.equal(putRes.status, 200);
      }

      const completeRes = await fetch(`${srv.baseUrl}/api/v2/blobs/upload/${uploadId}/complete`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Cookie: sessionCookie,
        },
        body: JSON.stringify({}),
      });
      assert.equal(completeRes.status, 201);

      // Verifica sul filesystem: il blob è in vault_v2/<userId>/<blobId[0..1]>/<blobId> ed è byte-identico
      const expectedDiskPath = path.join(srv.vaultV2Dir, alice.userId, blobId.slice(0, 2), blobId);
      assert.equal(fs.existsSync(expectedDiskPath), true);
      const onDiskBytes = fs.readFileSync(expectedDiskPath);
      assert.equal(Buffer.compare(onDiskBytes, pczk.ciphertext), 0);

      // GET intero -> 200 OK con header obbligatori e identità byte-a-byte
      const fullGet = await fetch(`${srv.baseUrl}/api/v2/blobs/${blobId}`, {
        headers: { Cookie: sessionCookie },
      });
      assert.equal(fullGet.status, 200);
      assert.equal(fullGet.headers.get('content-type'), 'application/octet-stream');
      assert.equal(fullGet.headers.get('x-content-type-options'), 'nosniff');
      assert.equal(fullGet.headers.get('cache-control'), 'private, max-age=31536000, immutable');
      assert.equal(fullGet.headers.get('etag'), `"${pczk.sha256Hex}"`);
      const fullBody = Buffer.from(await fullGet.arrayBuffer());
      assert.equal(Buffer.compare(fullBody, pczk.ciphertext), 0);

      // Verifica decifratura client-side del blob scaricato dal server
      const aliceSubkeys = await deriveSubkeys(alice.vaultKey);
      const decChunks: Buffer[] = [];
      for await (const dec of decryptBlobStream(new Uint8Array(fullBody), {
        fkWrapKey: aliceSubkeys.fkWrapKey,
        expectedBlobId: blobId,
      })) {
        decChunks.push(Buffer.from(dec));
      }
      assert.equal(Buffer.compare(Buffer.concat(decChunks), plaintext), 0);

      // Range 1: Prefisso (header 70 byte: bytes=0-69)
      const rangePrefix = await fetch(`${srv.baseUrl}/api/v2/blobs/${blobId}`, {
        headers: { Cookie: sessionCookie, Range: 'bytes=0-69' },
      });
      assert.equal(rangePrefix.status, 206);
      assert.equal(
        rangePrefix.headers.get('content-range'),
        `bytes 0-69/${pczk.ciphertext.byteLength}`
      );
      const prefixBytes = Buffer.from(await rangePrefix.arrayBuffer());
      assert.equal(Buffer.compare(prefixBytes, pczk.ciphertext.subarray(0, 70)), 0);

      // Range 2: Mezzo (bytes=70-500)
      const rangeMid = await fetch(`${srv.baseUrl}/api/v2/blobs/${blobId}`, {
        headers: { Cookie: sessionCookie, Range: 'bytes=70-500' },
      });
      assert.equal(rangeMid.status, 206);
      assert.equal(
        rangeMid.headers.get('content-range'),
        `bytes 70-500/${pczk.ciphertext.byteLength}`
      );
      const midBytes = Buffer.from(await rangeMid.arrayBuffer());
      assert.equal(Buffer.compare(midBytes, pczk.ciphertext.subarray(70, 501)), 0);

      // Range 3: Suffisso RFC 9110 (ultimi 32 byte EOF frame: bytes=-32)
      const rangeSuffix = await fetch(`${srv.baseUrl}/api/v2/blobs/${blobId}`, {
        headers: { Cookie: sessionCookie, Range: 'bytes=-32' },
      });
      assert.equal(rangeSuffix.status, 206);
      const expectedStart = pczk.ciphertext.byteLength - 32;
      const expectedEnd = pczk.ciphertext.byteLength - 1;
      assert.equal(
        rangeSuffix.headers.get('content-range'),
        `bytes ${expectedStart}-${expectedEnd}/${pczk.ciphertext.byteLength}`
      );
      const suffixBytes = Buffer.from(await rangeSuffix.arrayBuffer());
      assert.equal(Buffer.compare(suffixBytes, pczk.ciphertext.subarray(expectedStart)), 0);

      // Range 4: Multi-chunk aperto (bytes=65606-)
      const rangeOpen = await fetch(`${srv.baseUrl}/api/v2/blobs/${blobId}`, {
        headers: { Cookie: sessionCookie, Range: 'bytes=65606-' },
      });
      assert.equal(rangeOpen.status, 206);
      const openBytes = Buffer.from(await rangeOpen.arrayBuffer());
      assert.equal(Buffer.compare(openBytes, pczk.ciphertext.subarray(65606)), 0);

      // Range 5: 416 Range Not Satisfiable (oltre la fine del blob)
      const rangeInvalid = await fetch(`${srv.baseUrl}/api/v2/blobs/${blobId}`, {
        headers: { Cookie: sessionCookie, Range: `bytes=${pczk.ciphertext.byteLength + 100}-${pczk.ciphertext.byteLength + 200}` },
      });
      assert.equal(rangeInvalid.status, 416);
      assert.equal(
        rangeInvalid.headers.get('content-range'),
        `bytes */${pczk.ciphertext.byteLength}`
      );

      // Account Rewrap (cambio passphrase / rotazione KEK + authSecret atomica)
      const newAuthSecretB64 = crypto.randomBytes(32).toString('base64url');
      const newSaltB64 = crypto.randomBytes(16).toString('base64url');
      const newWrappedVk = await wrapVaultKey(alice.vaultKey, crypto.randomBytes(32), alice.userId);
      const newWrappedVkB64 = Buffer.from(newWrappedVk).toString('base64url');

      // Tentativo di rewrap con oldAuthSecret errato -> 401
      const badRewrap = await fetch(`${srv.baseUrl}/api/v2/account/rewrap`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Cookie: sessionCookie,
        },
        body: JSON.stringify({
          oldAuthSecret: crypto.randomBytes(32).toString('base64url'),
          newAuthSecret: newAuthSecretB64,
          newWrappedVaultKey: newWrappedVkB64,
          newSalt: newSaltB64,
        }),
      });
      assert.equal(badRewrap.status, 401);

      // Rewrap con oldAuthSecret corretto -> 200
      const okRewrap = await fetch(`${srv.baseUrl}/api/v2/account/rewrap`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Cookie: sessionCookie,
        },
        body: JSON.stringify({
          oldAuthSecret: alice.authSecretB64,
          newAuthSecret: newAuthSecretB64,
          newWrappedVaultKey: newWrappedVkB64,
          newSalt: newSaltB64,
        }),
      });
      assert.equal(okRewrap.status, 200);

      // Il vecchio authSecret non funziona più al login
      const oldLogin = await fetch(`${srv.baseUrl}/api/v2/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          username: 'alice',
          authSecret: alice.authSecretB64,
        }),
      });
      assert.equal(oldLogin.status, 401);

      // Il nuovo authSecret funziona e restituisce la nuova wrappedVaultKey
      const newLogin = await fetch(`${srv.baseUrl}/api/v2/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          username: 'alice',
          authSecret: newAuthSecretB64,
        }),
      });
      assert.equal(newLogin.status, 200);
      const newLoginBody = (await newLogin.json()) as { wrappedVaultKey: string; salt: string };
      assert.equal(newLoginBody.wrappedVaultKey, newWrappedVkB64);
      assert.equal(newLoginBody.salt, newSaltB64);
    } finally {
      await srv.close();
    }
  });

  it('3. Rifiuti di sicurezza su upload e parametri: SHA-256 errato, chunk fuori ordine, oltre quota, blobId non-UUID e path traversal', async () => {
    const srv = await startTestV2Server({
      defaultQuotaBytes: 5_000, // Quota piccola per testare il superamento quota
    });
    try {
      const user = await registerTestUser(srv.baseUrl, 'bob');

      // 3a. blobId non-UUID e tentativo di path traversal -> 400
      for (const badId of ['not-a-uuid', '../etc/passwd', '../../secret.sqlite', '12345678-1234-1234-1234-1234567890ab']) {
        const res = await fetch(`${srv.baseUrl}/api/v2/blobs/upload/init`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Cookie: user.cookie },
          body: JSON.stringify({
            blobId: badId,
            totalSize: 200,
            chunkSize: 200,
            totalChunks: 1,
            expectedSha256: 'a'.repeat(64),
            encMeta: Buffer.alloc(40, 1).toString('base64url'),
          }),
        });
        assert.equal(res.status, 400);
      }

      // Path traversal su GET /api/v2/blobs/:id -> 404
      const travGet = await fetch(`${srv.baseUrl}/api/v2/blobs/..%2f..%2findex.sqlite`, {
        headers: { Cookie: user.cookie },
      });
      assert.equal(travGet.status, 404);

      // 3b. Upload che supera la quota utente (5_000 byte) -> 413 QUOTA_EXCEEDED
      const overQuotaRes = await fetch(`${srv.baseUrl}/api/v2/blobs/upload/init`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Cookie: user.cookie },
        body: JSON.stringify({
          blobId: crypto.randomUUID(),
          totalSize: 6_000,
          chunkSize: 6_000,
          totalChunks: 1,
          expectedSha256: 'b'.repeat(64),
          encMeta: Buffer.alloc(40, 1).toString('base64url'),
        }),
      });
      assert.equal(overQuotaRes.status, 413);

      // 3c. Chunk fuori ordine (invio chunk 1 prima di chunk 0) -> 409 CHUNK_OUT_OF_ORDER
      const blobIdOrder = crypto.randomUUID();
      const pczkOrder = await generateValidPczkBlob(
        user.vaultKey,
        blobIdOrder,
        crypto.randomBytes(500)
      );
      const initOrderRes = await fetch(`${srv.baseUrl}/api/v2/blobs/upload/init`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Cookie: user.cookie },
        body: JSON.stringify({
          blobId: blobIdOrder,
          totalSize: pczkOrder.ciphertext.byteLength,
          chunkSize: 300,
          totalChunks: 2,
          expectedSha256: pczkOrder.sha256Hex,
          encMeta: pczkOrder.encMetaB64,
        }),
      });
      assert.equal(initOrderRes.status, 201);
      const { uploadId: orderUploadId } = (await initOrderRes.json()) as { uploadId: string };

      const outOfOrderPut = await fetch(`${srv.baseUrl}/api/v2/blobs/upload/${orderUploadId}/1`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/octet-stream', Cookie: user.cookie },
        body: new Uint8Array(pczkOrder.ciphertext.subarray(300)),
      });
      assert.equal(outOfOrderPut.status, 409);

      // 3d. SHA-256 del ciphertext errato -> 422 CIPHERTEXT_INTEGRITY_MISMATCH e nessun file creato nel vault
      const blobIdBadHash = crypto.randomUUID();
      const pczkBadHash = await generateValidPczkBlob(
        user.vaultKey,
        blobIdBadHash,
        crypto.randomBytes(400)
      );
      const wrongSha256 = 'f'.repeat(64);

      const initBadHashRes = await fetch(`${srv.baseUrl}/api/v2/blobs/upload/init`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Cookie: user.cookie },
        body: JSON.stringify({
          blobId: blobIdBadHash,
          totalSize: pczkBadHash.ciphertext.byteLength,
          chunkSize: pczkBadHash.ciphertext.byteLength,
          totalChunks: 1,
          expectedSha256: wrongSha256,
          encMeta: pczkBadHash.encMetaB64,
        }),
      });
      assert.equal(initBadHashRes.status, 201);
      const { uploadId: badHashUploadId } = (await initBadHashRes.json()) as { uploadId: string };

      const putBadHash = await fetch(`${srv.baseUrl}/api/v2/blobs/upload/${badHashUploadId}/0`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/octet-stream', Cookie: user.cookie },
        body: new Uint8Array(pczkBadHash.ciphertext),
      });
      assert.equal(putBadHash.status, 200);

      const completeBadHash = await fetch(
        `${srv.baseUrl}/api/v2/blobs/upload/${badHashUploadId}/complete`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Cookie: user.cookie },
          body: JSON.stringify({}),
        }
      );
      assert.equal(completeBadHash.status, 422);
      const targetBadPath = path.join(
        srv.vaultV2Dir,
        user.userId,
        blobIdBadHash.slice(0, 2),
        blobIdBadHash
      );
      assert.equal(fs.existsSync(targetBadPath), false);
    } finally {
      await srv.close();
    }
  });

  it('4. Isolamento cross-user: tentare di accedere o modificare risorse di un altro utente restituisce sempre 404 (mai 403)', async () => {
    const srv = await startTestV2Server();
    try {
      const userA = await registerTestUser(srv.baseUrl, 'user_a');
      const userB = await registerTestUser(srv.baseUrl, 'user_b');

      const blobIdA = crypto.randomUUID();
      const pczkA = await generateValidPczkBlob(userA.vaultKey, blobIdA, crypto.randomBytes(1024));

      const initRes = await fetch(`${srv.baseUrl}/api/v2/blobs/upload/init`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Cookie: userA.cookie },
        body: JSON.stringify({
          blobId: blobIdA,
          totalSize: pczkA.ciphertext.byteLength,
          chunkSize: pczkA.ciphertext.byteLength,
          totalChunks: 1,
          expectedSha256: pczkA.sha256Hex,
          encMeta: pczkA.encMetaB64,
          dedupTag: pczkA.dedupTagHex,
        }),
      });
      const { uploadId } = (await initRes.json()) as { uploadId: string };

      // User B tenta di caricare un chunk sull'uploadId di User A -> 404
      const crossChunk = await fetch(`${srv.baseUrl}/api/v2/blobs/upload/${uploadId}/0`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/octet-stream', Cookie: userB.cookie },
        body: new Uint8Array(pczkA.ciphertext),
      });
      assert.equal(crossChunk.status, 404);

      // User A completa l'upload
      await fetch(`${srv.baseUrl}/api/v2/blobs/upload/${uploadId}/0`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/octet-stream', Cookie: userA.cookie },
        body: new Uint8Array(pczkA.ciphertext),
      });
      await fetch(`${srv.baseUrl}/api/v2/blobs/upload/${uploadId}/complete`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Cookie: userA.cookie },
        body: JSON.stringify({}),
      });

      // User B tenta GET blob di User A -> 404
      const crossGetBlob = await fetch(`${srv.baseUrl}/api/v2/blobs/${blobIdA}`, {
        headers: { Cookie: userB.cookie },
      });
      assert.equal(crossGetBlob.status, 404);

      // User B tenta GET item di User A -> 404
      const crossGetItem = await fetch(`${srv.baseUrl}/api/v2/items/${blobIdA}`, {
        headers: { Cookie: userB.cookie },
      });
      assert.equal(crossGetItem.status, 404);

      // User B tenta PATCH meta di User A -> 404
      const crossPatchMeta = await fetch(`${srv.baseUrl}/api/v2/items/${blobIdA}/meta`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json', Cookie: userB.cookie },
        body: JSON.stringify({ encMeta: pczkA.encMetaB64 }),
      });
      assert.equal(crossPatchMeta.status, 404);

      // User B tenta di spostare nel cestino o eliminare l'item di User A -> 404
      const crossTrash = await fetch(`${srv.baseUrl}/api/v2/trash`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Cookie: userB.cookie },
        body: JSON.stringify({ itemIds: [blobIdA] }),
      });
      assert.equal(crossTrash.status, 404);

      const crossDelete = await fetch(`${srv.baseUrl}/api/v2/items/${blobIdA}`, {
        method: 'DELETE',
        headers: { Cookie: userB.cookie },
      });
      assert.equal(crossDelete.status, 404);

      // User B tenta di creare uno share con il blobId di User A -> 404
      const crossShare = await fetch(`${srv.baseUrl}/api/v2/shares`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Cookie: userB.cookie },
        body: JSON.stringify({
          items: [
            {
              blobId: blobIdA,
              wrappedFk: crypto.randomBytes(60).toString('base64url'),
            },
          ],
        }),
      });
      assert.equal(crossShare.status, 404);

      // User B tenta backup/check con il dedupTag di User A -> non deve trovarlo
      const crossDedup = await fetch(`${srv.baseUrl}/api/v2/backup/check`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Cookie: userB.cookie },
        body: JSON.stringify({ dedupTags: [pczkA.dedupTagHex] }),
      });
      assert.equal(crossDedup.status, 200);
      const dedupBody = (await crossDedup.json()) as { existingTags: string[] };
      assert.deepEqual(dedupBody.existingTags, []);
    } finally {
      await srv.close();
    }
  });

  it('5. Resistenza ad enumerazione utenti su /api/v2/login/params: stessa struttura e output deterministico per utenti inesistenti', async () => {
    const srv = await startTestV2Server();
    try {
      const existing = await registerTestUser(srv.baseUrl, 'real_user');

      const resReal = await fetch(`${srv.baseUrl}/api/v2/login/params`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username: 'real_user' }),
      });
      assert.equal(resReal.status, 200);
      const bodyReal = (await resReal.json()) as {
        salt: string;
        kdfParams: { algorithm: string; memoryKiB: number; iterations: number; parallelism: number };
      };
      assert.equal(bodyReal.salt, existing.saltB64);

      const resGhost1 = await fetch(`${srv.baseUrl}/api/v2/login/params`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username: 'non_existent_user' }),
      });
      assert.equal(resGhost1.status, 200);
      const bodyGhost1 = (await resGhost1.json()) as typeof bodyReal;

      const resGhost2 = await fetch(`${srv.baseUrl}/api/v2/login/params`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username: 'non_existent_user' }),
      });
      assert.equal(resGhost2.status, 200);
      const bodyGhost2 = (await resGhost2.json()) as typeof bodyReal;

      // Stesse identiche chiavi top-level e su kdfParams
      assert.deepEqual(Object.keys(bodyGhost1).sort(), Object.keys(bodyReal).sort());
      assert.deepEqual(
        Object.keys(bodyGhost1.kdfParams).sort(),
        Object.keys(bodyReal.kdfParams).sort()
      );
      assert.equal(Buffer.from(bodyGhost1.salt, 'base64url').byteLength, 16);
      // Deterministico per lo stesso username inesistente
      assert.deepEqual(bodyGhost1, bodyGhost2);

      // Diverso per un altro username inesistente
      const resGhostOther = await fetch(`${srv.baseUrl}/api/v2/login/params`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username: 'another_ghost_user' }),
      });
      const bodyGhostOther = (await resGhostOther.json()) as typeof bodyReal;
      assert.notEqual(bodyGhost1.salt, bodyGhostOther.salt);
    } finally {
      await srv.close();
    }
  });

  it('6. Album cifrati (/api/v2/albums con ETag/If-Match e 412), Dedup solo su active, Cestino (trash/restore/purge TTL), Stats senza categorie, Sostituzione Blob (replace) e Condivisione (Shares)', async () => {
    const srv = await startTestV2Server({
      trashTtlMs: 60_000, // 60s TTL per testare la purga automatica
    });
    try {
      const user = await registerTestUser(srv.baseUrl, 'carol');

      // --- Album con concorrenza ottimistica ETag / If-Match ---
      const getEmptyAlbums = await fetch(`${srv.baseUrl}/api/v2/albums`, {
        headers: { Cookie: user.cookie },
      });
      assert.equal(getEmptyAlbums.status, 404);

      const albumBlobV1 = Buffer.concat([PCZK_MAGIC, Buffer.from([PCZK_VERSION_V1]), crypto.randomBytes(120)]);
      const putAlbumV1 = await fetch(`${srv.baseUrl}/api/v2/albums`, {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/octet-stream',
          Cookie: user.cookie,
          'If-None-Match': '*',
        },
        body: albumBlobV1,
      });
      assert.equal(putAlbumV1.status, 200);
      const { etag: etagV1 } = (await putAlbumV1.json()) as { etag: string };
      assert.ok(etagV1.startsWith('"') && etagV1.endsWith('"'));

      // Tentativo di sovrascrittura con If-Match obsoleto -> 412 Precondition Failed
      const albumBlobV2 = Buffer.concat([PCZK_MAGIC, Buffer.from([PCZK_VERSION_V1]), crypto.randomBytes(140)]);
      const putStaleAlbum = await fetch(`${srv.baseUrl}/api/v2/albums`, {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/octet-stream',
          Cookie: user.cookie,
          'If-Match': '"0000000000000000000000000000000000000000000000000000000000000000"',
        },
        body: albumBlobV2,
      });
      assert.equal(putStaleAlbum.status, 412);

      // Aggiornamento con If-Match corretto -> 200 OK
      const putAlbumV2 = await fetch(`${srv.baseUrl}/api/v2/albums`, {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/octet-stream',
          Cookie: user.cookie,
          'If-Match': etagV1,
        },
        body: albumBlobV2,
      });
      assert.equal(putAlbumV2.status, 200);

      // GET /api/v2/albums restituisce i byte esatti di albumBlobV2
      const getAlbumV2 = await fetch(`${srv.baseUrl}/api/v2/albums`, {
        headers: { Cookie: user.cookie },
      });
      assert.equal(getAlbumV2.status, 200);
      assert.equal(Buffer.compare(Buffer.from(await getAlbumV2.arrayBuffer()), albumBlobV2), 0);

      // --- Upload item, Dedup, Cestino e Stats ---
      const blobId1 = crypto.randomUUID();
      const pczk1 = await generateValidPczkBlob(user.vaultKey, blobId1, crypto.randomBytes(2048));

      const init1 = await fetch(`${srv.baseUrl}/api/v2/blobs/upload/init`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Cookie: user.cookie },
        body: JSON.stringify({
          blobId: blobId1,
          totalSize: pczk1.ciphertext.byteLength,
          chunkSize: pczk1.ciphertext.byteLength,
          totalChunks: 1,
          expectedSha256: pczk1.sha256Hex,
          encMeta: pczk1.encMetaB64,
          dedupTag: pczk1.dedupTagHex,
        }),
      });
      const { uploadId: up1 } = (await init1.json()) as { uploadId: string };
      await fetch(`${srv.baseUrl}/api/v2/blobs/upload/${up1}/0`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/octet-stream', Cookie: user.cookie },
        body: new Uint8Array(pczk1.ciphertext),
      });
      await fetch(`${srv.baseUrl}/api/v2/blobs/upload/${up1}/complete`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Cookie: user.cookie },
        body: JSON.stringify({}),
      });

      // Dedup check su item attivo -> trovato
      const dedupActive = await fetch(`${srv.baseUrl}/api/v2/backup/check`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Cookie: user.cookie },
        body: JSON.stringify({ dedupTags: [pczk1.dedupTagHex] }),
      });
      const dedupActiveBody = (await dedupActive.json()) as { existingTags: string[] };
      assert.deepEqual(dedupActiveBody.existingTags, [pczk1.dedupTagHex]);

      // Sposta nel cestino
      const trashRes = await fetch(`${srv.baseUrl}/api/v2/trash`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Cookie: user.cookie },
        body: JSON.stringify({ itemIds: [blobId1] }),
      });
      assert.equal(trashRes.status, 200);

      // Dedup check su item nel cestino -> NON deve essere considerato attivo
      const dedupTrashed = await fetch(`${srv.baseUrl}/api/v2/backup/check`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Cookie: user.cookie },
        body: JSON.stringify({ dedupTags: [pczk1.dedupTagHex] }),
      });
      const dedupTrashedBody = (await dedupTrashed.json()) as { existingTags: string[] };
      assert.deepEqual(dedupTrashedBody.existingTags, []);

      // Verifica /api/v2/stats: solo byte attivi, cestino, conteggi e quota, zero categorie
      const statsRes = await fetch(`${srv.baseUrl}/api/v2/stats`, {
        headers: { Cookie: user.cookie },
      });
      assert.equal(statsRes.status, 200);
      const statsBody = (await statsRes.json()) as Record<string, unknown>;
      assert.deepEqual(Object.keys(statsBody).sort(), [
        'activeBytes',
        'activeCount',
        'quotaBytes',
        'trashedBytes',
        'trashedCount',
      ]);
      assert.equal(statsBody.activeBytes, 0);
      assert.equal(statsBody.trashedBytes, pczk1.ciphertext.byteLength);
      assert.equal(statsBody.trashedCount, 1);

      // Restore dal cestino
      const restoreRes = await fetch(`${srv.baseUrl}/api/v2/trash/restore`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Cookie: user.cookie },
        body: JSON.stringify({ itemIds: [blobId1] }),
      });
      assert.equal(restoreRes.status, 200);

      // --- Sostituzione blob (editing foto client-side) con controllo di versione ---
      const blobIdEdited = crypto.randomUUID();
      const pczkEdited = await generateValidPczkBlob(
        user.vaultKey,
        blobIdEdited,
        crypto.randomBytes(3000)
      );
      const initEdit = await fetch(`${srv.baseUrl}/api/v2/blobs/upload/init`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Cookie: user.cookie },
        body: JSON.stringify({
          blobId: blobIdEdited,
          totalSize: pczkEdited.ciphertext.byteLength,
          chunkSize: pczkEdited.ciphertext.byteLength,
          totalChunks: 1,
          expectedSha256: pczkEdited.sha256Hex,
          encMeta: pczkEdited.encMetaB64,
        }),
      });
      const { uploadId: upEdit } = (await initEdit.json()) as { uploadId: string };
      await fetch(`${srv.baseUrl}/api/v2/blobs/upload/${upEdit}/0`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/octet-stream', Cookie: user.cookie },
        body: new Uint8Array(pczkEdited.ciphertext),
      });
      await fetch(`${srv.baseUrl}/api/v2/blobs/upload/${upEdit}/complete`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Cookie: user.cookie },
        body: JSON.stringify({ createItem: false }),
      });

      // Tentativo di replace con expectedVersion errata -> 412
      const badReplace = await fetch(`${srv.baseUrl}/api/v2/items/${blobId1}/replace`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Cookie: user.cookie },
        body: JSON.stringify({
          expectedVersion: 99,
          newBlobId: blobIdEdited,
          encMeta: pczkEdited.encMetaB64,
        }),
      });
      assert.equal(badReplace.status, 412);

      // Replace con expectedVersion = 1 -> 200 e version passa a 2
      const okReplace = await fetch(`${srv.baseUrl}/api/v2/items/${blobId1}/replace`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Cookie: user.cookie },
        body: JSON.stringify({
          expectedVersion: 1,
          newBlobId: blobIdEdited,
          encMeta: pczkEdited.encMetaB64,
        }),
      });
      assert.equal(okReplace.status, 200);
      const replacedItem = (await okReplace.json()) as {
        item: { id: string; blobId: string; version: number };
      };
      assert.equal(replacedItem.item.id, blobId1);
      assert.equal(replacedItem.item.blobId, blobIdEdited);
      assert.equal(replacedItem.item.version, 2);

      // --- Creazione Share pubblico, GET con Range e revoca ---
      const shareKey = crypto.randomBytes(32);
      const clientShareId = crypto.randomUUID();
      const wrappedFk = await wrapFileKeyForShare(
        shareKey,
        pczkEdited.fileKey,
        clientShareId,
        blobIdEdited
      );
      const wrappedFkB64 = Buffer.from(wrappedFk).toString('base64url');

      const createShareRes = await fetch(`${srv.baseUrl}/api/v2/shares`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Cookie: user.cookie },
        body: JSON.stringify({
          shareId: clientShareId,
          items: [
            {
              blobId: blobIdEdited,
              wrappedFk: wrappedFkB64,
              encItemMeta: pczkEdited.encMetaB64,
            },
          ],
        }),
      });
      assert.equal(createShareRes.status, 201);
      const { shareId } = (await createShareRes.json()) as { shareId: string };

      // GET metadati pubblici dello share (senza cookie)
      const publicShareMeta = await fetch(`${srv.baseUrl}/api/v2/shares/${shareId}`);
      assert.equal(publicShareMeta.status, 200);
      const shareMetaBody = (await publicShareMeta.json()) as {
        items: Array<{ blobId: string; wrappedFk: string }>;
      };
      assert.equal(shareMetaBody.items.length, 1);
      assert.equal(shareMetaBody.items[0].blobId, blobIdEdited);
      assert.equal(shareMetaBody.items[0].wrappedFk, wrappedFkB64);

      // GET pubblico con Range del blob condiviso
      const publicBlobRange = await fetch(
        `${srv.baseUrl}/api/v2/shares/${shareId}/blobs/${blobIdEdited}`,
        {
          headers: { Range: 'bytes=0-101' },
        }
      );
      assert.equal(publicBlobRange.status, 206);
      const sharedSlice = Buffer.from(await publicBlobRange.arrayBuffer());
      assert.equal(Buffer.compare(sharedSlice, pczkEdited.ciphertext.subarray(0, 102)), 0);

      // Revoca dello share da parte del proprietario
      const revokeRes = await fetch(`${srv.baseUrl}/api/v2/shares/${shareId}`, {
        method: 'DELETE',
        headers: { Cookie: user.cookie },
      });
      assert.equal(revokeRes.status, 200);

      // Dopo la revoca -> 404
      const afterRevoke = await fetch(`${srv.baseUrl}/api/v2/shares/${shareId}`);
      assert.equal(afterRevoke.status, 404);

      // --- Purga automatica TTL cestino ---
      await fetch(`${srv.baseUrl}/api/v2/trash`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Cookie: user.cookie },
        body: JSON.stringify({ itemIds: [blobId1] }),
      });
      // Avanza l'orologio oltre il TTL di 60s
      srv.advanceTime(65_000);

      const listTrashedAfterTtl = await fetch(`${srv.baseUrl}/api/v2/items?state=trashed`, {
        headers: { Cookie: user.cookie },
      });
      const trashedAfterTtlBody = (await listTrashedAfterTtl.json()) as { items: unknown[] };
      assert.equal(trashedAfterTtlBody.items.length, 0);
    } finally {
      await srv.close();
    }
  });

  it('7. Difesa CSRF Origin, TRUST_PROXY e Rate Limiting su login e share pubblici', async () => {
    const srv = await startTestV2Server({
      trustProxy: true,
      shareRateLimitMaxPerShare: 3,
    });
    try {
      const user = await registerTestUser(srv.baseUrl, 'dave');

      // CSRF 1: Header Origin cross-site -> 403
      const csrfCrossOrigin = await fetch(`${srv.baseUrl}/api/v2/logout`, {
        method: 'POST',
        headers: {
          Cookie: user.cookie,
          Origin: 'https://evil.example.com',
        },
      });
      assert.equal(csrfCrossOrigin.status, 403);

      // CSRF 2: Header Origin null -> 403
      const csrfNullOrigin = await fetch(`${srv.baseUrl}/api/v2/logout`, {
        method: 'POST',
        headers: {
          Cookie: user.cookie,
          Origin: 'null',
        },
      });
      assert.equal(csrfNullOrigin.status, 403);

      // CSRF 3: Sec-Fetch-Site: cross-site -> 403
      const csrfSecFetch = await fetch(`${srv.baseUrl}/api/v2/logout`, {
        method: 'POST',
        headers: {
          Cookie: user.cookie,
          'Sec-Fetch-Site': 'cross-site',
        },
      });
      assert.equal(csrfSecFetch.status, 403);

      // CSRF 4: Dietro reverse proxy (TRUST_PROXY=true) con X-Forwarded-Proto/Host corrispondenti -> 200
      const validProxyOrigin = await fetch(`${srv.baseUrl}/api/v2/backup/check`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Cookie: user.cookie,
          Origin: 'https://vault.example.org',
          'X-Forwarded-Proto': 'https',
          'X-Forwarded-Host': 'vault.example.org',
        },
        body: JSON.stringify({ dedupTags: [] }),
      });
      assert.equal(validProxyOrigin.status, 200);

      // Rate limiting per shareId (max 3 richieste per finestra)
      const fakeShareId = 'A'.repeat(32);
      for (let i = 0; i < 3; i++) {
        const r = await fetch(`${srv.baseUrl}/api/v2/shares/${fakeShareId}`);
        assert.equal(r.status, 404);
      }
      const fourthShareReq = await fetch(`${srv.baseUrl}/api/v2/shares/${fakeShareId}`);
      assert.equal(fourthShareReq.status, 429);
    } finally {
      await srv.close();
    }
  });

  it('8. Persistenza al riavvio del server/DB e rifiuto delle sessioni scadute + Redazione totale dei segreti nei log', async () => {
    const sharedTmp = fs.mkdtempSync(path.join(os.tmpdir(), 'photocloud-v2-persist-'));
    const vaultV2Dir = path.join(sharedTmp, 'vault_v2');
    const tempUploadDir = path.join(sharedTmp, 'temp_uploads');
    const serverSecret = crypto.randomBytes(32);
    const startTime = 1_700_000_000_000;

    // 1. Avvia la prima istanza del server
    const srv1 = await startTestV2Server({
      vaultV2Dir,
      tempUploadDir,
      serverSecret,
      sessionTtlMs: 10_000, // 10 secondi
      initialNow: startTime,
    });

    let eve!: Awaited<ReturnType<typeof registerTestUser>>;
    let blobId!: string;
    let pczk!: Awaited<ReturnType<typeof generateValidPczkBlob>>;

    try {
      eve = await registerTestUser(srv1.baseUrl, 'eve');
      blobId = crypto.randomUUID();
      pczk = await generateValidPczkBlob(eve.vaultKey, blobId, crypto.randomBytes(1500));

      const initRes = await fetch(`${srv1.baseUrl}/api/v2/blobs/upload/init`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Cookie: eve.cookie },
        body: JSON.stringify({
          blobId,
          totalSize: pczk.ciphertext.byteLength,
          chunkSize: pczk.ciphertext.byteLength,
          totalChunks: 1,
          expectedSha256: pczk.sha256Hex,
          encMeta: pczk.encMetaB64,
          dedupTag: pczk.dedupTagHex,
        }),
      });
      const { uploadId } = (await initRes.json()) as { uploadId: string };
      await fetch(`${srv1.baseUrl}/api/v2/blobs/upload/${uploadId}/0`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/octet-stream', Cookie: eve.cookie },
        body: new Uint8Array(pczk.ciphertext),
      });
      await fetch(`${srv1.baseUrl}/api/v2/blobs/upload/${uploadId}/complete`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Cookie: eve.cookie },
        body: JSON.stringify({}),
      });

      // Verifica che nei log catturati non compaia mai alcun segreto
      const joinedLogs = srv1.logLines.join('\n');
      assert.ok(srv1.logLines.length > 0);
      assert.equal(joinedLogs.includes(eve.authSecretB64), false, 'authSecret non deve mai apparire nei log');
      assert.equal(joinedLogs.includes(eve.wrappedVkB64), false, 'wrappedVaultKey non deve mai apparire nei log');
      assert.equal(joinedLogs.includes(pczk.encMetaB64), false, 'encMeta non deve mai apparire nei log');
      const rawCookieToken = eve.cookie.split('=')[1];
      assert.equal(joinedLogs.includes(rawCookieToken), false, 'Il cookie di sessione non deve mai apparire nei log');
    } finally {
      // Chiudi completamente la prima istanza (server HTTP + SQLite WAL)
      await srv1.close();
    }

    // 2. Riapri una nuova istanza sulla stessa directory a t = startTime + 5s (sessione ancora valida)
    const srv2 = await startTestV2Server({
      vaultV2Dir,
      tempUploadDir,
      serverSecret,
      sessionTtlMs: 10_000,
      initialNow: startTime + 5_000,
    });
    try {
      const itemsRes = await fetch(`${srv2.baseUrl}/api/v2/items`, {
        headers: { Cookie: eve.cookie },
      });
      assert.equal(itemsRes.status, 200);
      const itemsBody = (await itemsRes.json()) as { items: Array<{ blobId: string; encMeta: string }> };
      assert.equal(itemsBody.items.length, 1);
      assert.equal(itemsBody.items[0].blobId, blobId);
      assert.equal(itemsBody.items[0].encMeta, pczk.encMetaB64);

      const blobRes = await fetch(`${srv2.baseUrl}/api/v2/blobs/${blobId}`, {
        headers: { Cookie: eve.cookie },
      });
      assert.equal(blobRes.status, 200);
      assert.equal(Buffer.compare(Buffer.from(await blobRes.arrayBuffer()), pczk.ciphertext), 0);

      // Avanza il tempo oltre la scadenza della sessione (t = startTime + 15s) -> 401
      srv2.setNow(startTime + 15_000);
      const expiredRes = await fetch(`${srv2.baseUrl}/api/v2/items`, {
        headers: { Cookie: eve.cookie },
      });
      assert.equal(expiredRes.status, 401);
    } finally {
      await srv2.close();
    }
  });
});
