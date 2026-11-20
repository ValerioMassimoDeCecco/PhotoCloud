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
  store: ReturnType<typeof createZkV2App>['store'];
  getSetupToken: () => string | null;
  printedSetupTokens: string[];
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
  uploadTtlMs?: number;
  registrationEnabled?: boolean | 'setup_token_or_invite' | 'first_user_only';
  registrationInviteToken?: string;
  initialSetupToken?: string;
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
  const printedSetupTokens: string[] = [];
  let currentNow = opts?.initialNow ?? Date.now();

  const logger = createRedactingLogger((line) => {
    logLines.push(line);
  });

  const { app, store, getSetupToken, close: closeStore } = createZkV2App({
    vaultV2Dir,
    tempUploadDir,
    serverSecret,
    defaultQuotaBytes: opts?.defaultQuotaBytes,
    maxUploadBytes: opts?.maxUploadBytes,
    sessionTtlMs: opts?.sessionTtlMs,
    trashTtlMs: opts?.trashTtlMs,
    uploadTtlMs: opts?.uploadTtlMs,
    registrationEnabled: opts?.registrationEnabled ?? true,
    registrationInviteToken: opts?.registrationInviteToken,
    initialSetupToken: opts?.initialSetupToken,
    onSetupTokenGenerated: (t) => printedSetupTokens.push(t),
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
    store,
    getSetupToken,
    printedSetupTokens,
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
  username: string,
  extra?: { inviteToken?: string; setupToken?: string; headers?: Record<string, string> }
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
    headers: { 'Content-Type': 'application/json', ...(extra?.headers ?? {}) },
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
      ...(extra?.inviteToken ? { inviteToken: extra.inviteToken } : {}),
      ...(extra?.setupToken ? { setupToken: extra.setupToken } : {}),
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
// Suite di Test FASE 2 & 2b — Server API v2
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

  it('4. Isolamento cross-user table-driven: per OGNI rotta v2 con ID o risorsa utente, User B riceve 404 e lo stato di User A resta invariato', async () => {
    const srv = await startTestV2Server();
    try {
      const userA = await registerTestUser(srv.baseUrl, 'user_a');
      const userB = await registerTestUser(srv.baseUrl, 'user_b');

      // Helper per caricare un blob completo per un utente
      const uploadBlobFor = async (
        owner: Awaited<ReturnType<typeof registerTestUser>>,
        createItem = true
      ) => {
        const blobId = crypto.randomUUID();
        const pczk = await generateValidPczkBlob(owner.vaultKey, blobId, crypto.randomBytes(1024));
        const initR = await fetch(`${srv.baseUrl}/api/v2/blobs/upload/init`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Cookie: owner.cookie },
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
        assert.equal(initR.status, 201);
        const { uploadId } = (await initR.json()) as { uploadId: string };
        const putR = await fetch(`${srv.baseUrl}/api/v2/blobs/upload/${uploadId}/0`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/octet-stream', Cookie: owner.cookie },
          body: new Uint8Array(pczk.ciphertext),
        });
        assert.equal(putR.status, 200);
        const compR = await fetch(`${srv.baseUrl}/api/v2/blobs/upload/${uploadId}/complete`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Cookie: owner.cookie },
          body: JSON.stringify({ createItem }),
        });
        assert.equal(compR.status, 201);
        return { blobId, pczk };
      };

      // 1) Item attivo di User A con thumb 320 e 1280
      const activeA = await uploadBlobFor(userA, true);
      const thumb320A = Buffer.concat([PCZK_MAGIC, Buffer.from([PCZK_VERSION_V1]), crypto.randomBytes(150)]);
      const thumb1280A = Buffer.concat([PCZK_MAGIC, Buffer.from([PCZK_VERSION_V1]), crypto.randomBytes(250)]);

      const putT320 = await fetch(`${srv.baseUrl}/api/v2/blobs/${activeA.blobId}/thumbs/320`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/octet-stream', Cookie: userA.cookie },
        body: thumb320A,
      });
      assert.equal(putT320.status, 200);

      const putT1280 = await fetch(`${srv.baseUrl}/api/v2/blobs/${activeA.blobId}/thumbs/1280`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/octet-stream', Cookie: userA.cookie },
        body: thumb1280A,
      });
      assert.equal(putT1280.status, 200);

      // 2) Blob sostitutivo di User A e di User B (per testare replace cross-user)
      const replacementBlobA = await uploadBlobFor(userA, false);
      const replacementBlobB = await uploadBlobFor(userB, false);

      // 3) Item nel cestino di User A (per testare /trash/restore cross-user)
      const trashedA = await uploadBlobFor(userA, true);
      const trashResA = await fetch(`${srv.baseUrl}/api/v2/trash`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Cookie: userA.cookie },
        body: JSON.stringify({ itemIds: [trashedA.blobId] }),
      });
      assert.equal(trashResA.status, 200);

      // 4) Due sessioni upload in-flight di User A:
      //    - uploadChunkA (0/1 chunk ricevuti, per testare PUT chunk altrui)
      //    - uploadCompleteA (1/1 chunk ricevuti, pronto per complete, per testare POST complete altrui)
      const blobChunkA = crypto.randomUUID();
      const pczkChunkA = await generateValidPczkBlob(userA.vaultKey, blobChunkA, crypto.randomBytes(600));
      const initChunkA = await fetch(`${srv.baseUrl}/api/v2/blobs/upload/init`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Cookie: userA.cookie },
        body: JSON.stringify({
          blobId: blobChunkA,
          totalSize: pczkChunkA.ciphertext.byteLength,
          chunkSize: pczkChunkA.ciphertext.byteLength,
          totalChunks: 1,
          expectedSha256: pczkChunkA.sha256Hex,
          encMeta: pczkChunkA.encMetaB64,
        }),
      });
      const { uploadId: uploadIdChunkA } = (await initChunkA.json()) as { uploadId: string };

      const blobCompleteA = crypto.randomUUID();
      const pczkCompleteA = await generateValidPczkBlob(userA.vaultKey, blobCompleteA, crypto.randomBytes(600));
      const initCompleteA = await fetch(`${srv.baseUrl}/api/v2/blobs/upload/init`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Cookie: userA.cookie },
        body: JSON.stringify({
          blobId: blobCompleteA,
          totalSize: pczkCompleteA.ciphertext.byteLength,
          chunkSize: pczkCompleteA.ciphertext.byteLength,
          totalChunks: 1,
          expectedSha256: pczkCompleteA.sha256Hex,
          encMeta: pczkCompleteA.encMetaB64,
        }),
      });
      const { uploadId: uploadIdCompleteA } = (await initCompleteA.json()) as { uploadId: string };
      await fetch(`${srv.baseUrl}/api/v2/blobs/upload/${uploadIdCompleteA}/0`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/octet-stream', Cookie: userA.cookie },
        body: new Uint8Array(pczkCompleteA.ciphertext),
      });

      // 5) Share creato da User A
      const shareIdA = crypto.randomUUID();
      const createShareA = await fetch(`${srv.baseUrl}/api/v2/shares`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Cookie: userA.cookie },
        body: JSON.stringify({
          shareId: shareIdA,
          items: [
            {
              blobId: activeA.blobId,
              wrappedFk: crypto.randomBytes(60).toString('base64url'),
            },
          ],
        }),
      });
      assert.equal(createShareA.status, 201);

      // 6) Catalogo Album cifrato di User A
      const albumBlobA = Buffer.concat([PCZK_MAGIC, Buffer.from([PCZK_VERSION_V1]), crypto.randomBytes(180)]);
      const putAlbumA = await fetch(`${srv.baseUrl}/api/v2/albums`, {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/octet-stream',
          Cookie: userA.cookie,
          'If-None-Match': '*',
        },
        body: albumBlobA,
      });
      assert.equal(putAlbumA.status, 200);
      const { etag: albumEtagA } = (await putAlbumA.json()) as { etag: string };

      const forgedMetaB64 = Buffer.alloc(48, 0xaa).toString('base64url');
      const forgedThumb = Buffer.concat([PCZK_MAGIC, Buffer.from([PCZK_VERSION_V1]), crypto.randomBytes(160)]);

      // Funzione che verifica che TUTTO lo stato di User A sia rimasto identico
      const assertUserAStateUnchanged = async (stepName: string) => {
        // Active item A: stato active, version 1, encMeta originale, thumbs [320, 1280]
        const itemRes = await fetch(`${srv.baseUrl}/api/v2/items/${activeA.blobId}`, {
          headers: { Cookie: userA.cookie },
        });
        assert.equal(itemRes.status, 200, `[${stepName}] activeA item deve esistere`);
        const { item } = (await itemRes.json()) as {
          item: {
            id: string;
            blobId: string;
            version: number;
            state: string;
            encMeta: string;
            thumbs: number[];
          };
        };
        assert.equal(item.blobId, activeA.blobId, `[${stepName}] blobId invariato`);
        assert.equal(item.version, 1, `[${stepName}] version invariata`);
        assert.equal(item.state, 'active', `[${stepName}] state active invariato`);
        assert.equal(item.encMeta, activeA.pczk.encMetaB64, `[${stepName}] encMeta invariato`);
        assert.deepEqual(item.thumbs, [320, 1280], `[${stepName}] thumbs invariati`);

        // Thumb 320 e 1280 di User A intatte su disco
        const t320Res = await fetch(`${srv.baseUrl}/api/v2/blobs/${activeA.blobId}/thumbs/320`, {
          headers: { Cookie: userA.cookie },
        });
        assert.equal(t320Res.status, 200);
        assert.equal(
          Buffer.compare(Buffer.from(await t320Res.arrayBuffer()), thumb320A),
          0,
          `[${stepName}] thumb 320 bytes invariati`
        );

        const t1280Res = await fetch(`${srv.baseUrl}/api/v2/blobs/${activeA.blobId}/thumbs/1280`, {
          headers: { Cookie: userA.cookie },
        });
        assert.equal(t1280Res.status, 200);
        assert.equal(
          Buffer.compare(Buffer.from(await t1280Res.arrayBuffer()), thumb1280A),
          0,
          `[${stepName}] thumb 1280 bytes invariati`
        );

        // Item trashedA ancora nel cestino
        const trashedRes = await fetch(`${srv.baseUrl}/api/v2/items/${trashedA.blobId}`, {
          headers: { Cookie: userA.cookie },
        });
        assert.equal(trashedRes.status, 200);
        const trashedBody = (await trashedRes.json()) as { item: { state: string } };
        assert.equal(trashedBody.item.state, 'trashed', `[${stepName}] trashedA deve restare trashed`);

        // Upload in-flight di User A intatti nel DB
        const chunkRow = srv.store.db
          .prepare(`SELECT received_chunks, received_bytes FROM uploads_v2 WHERE upload_id = ?`)
          .get(uploadIdChunkA) as { received_chunks: number; received_bytes: number } | undefined;
        assert.ok(chunkRow, `[${stepName}] uploadIdChunkA deve esistere`);
        assert.equal(Number(chunkRow.received_chunks), 0, `[${stepName}] uploadIdChunkA received_chunks === 0`);

        const completeRow = srv.store.db
          .prepare(`SELECT received_chunks FROM uploads_v2 WHERE upload_id = ?`)
          .get(uploadIdCompleteA) as { received_chunks: number } | undefined;
        assert.ok(completeRow, `[${stepName}] uploadIdCompleteA non deve essere stato completato da User B`);
        assert.equal(Number(completeRow.received_chunks), 1);

        // Share di User A ancora attivo
        const shareCheck = await fetch(`${srv.baseUrl}/api/v2/shares/${shareIdA}`);
        assert.equal(shareCheck.status, 200, `[${stepName}] shareIdA deve restare attivo`);

        // Album di User A intatto
        const albumCheck = await fetch(`${srv.baseUrl}/api/v2/albums`, {
          headers: { Cookie: userA.cookie },
        });
        assert.equal(albumCheck.status, 200, `[${stepName}] album di User A deve esistere`);
        assert.equal(albumCheck.headers.get('etag'), albumEtagA, `[${stepName}] album ETag invariato`);
        assert.equal(
          Buffer.compare(Buffer.from(await albumCheck.arrayBuffer()), albumBlobA),
          0,
          `[${stepName}] album bytes invariati`
        );
      };

      // Tabella completa di tutte le rotte v2 con ID o risorsa utente
      const crossUserTable: Array<{
        group: string;
        name: string;
        method: string;
        path: string;
        headers?: Record<string, string>;
        body?: BodyInit;
        expectedStatus: number;
      }> = [
        {
          group: 'blobs',
          name: 'GET /api/v2/blobs/:id (blob altrui)',
          method: 'GET',
          path: `/api/v2/blobs/${activeA.blobId}`,
          expectedStatus: 404,
        },
        {
          group: 'thumbs',
          name: 'PUT /api/v2/blobs/:id/thumbs/320 (sovrascrittura thumb 320 altrui)',
          method: 'PUT',
          path: `/api/v2/blobs/${activeA.blobId}/thumbs/320`,
          headers: { 'Content-Type': 'application/octet-stream' },
          body: forgedThumb,
          expectedStatus: 404,
        },
        {
          group: 'thumbs',
          name: 'GET /api/v2/blobs/:id/thumbs/320 (lettura thumb 320 altrui)',
          method: 'GET',
          path: `/api/v2/blobs/${activeA.blobId}/thumbs/320`,
          expectedStatus: 404,
        },
        {
          group: 'thumbs',
          name: 'PUT /api/v2/blobs/:id/thumbs/1280 (sovrascrittura thumb 1280 altrui)',
          method: 'PUT',
          path: `/api/v2/blobs/${activeA.blobId}/thumbs/1280`,
          headers: { 'Content-Type': 'application/octet-stream' },
          body: forgedThumb,
          expectedStatus: 404,
        },
        {
          group: 'thumbs',
          name: 'GET /api/v2/blobs/:id/thumbs/1280 (lettura thumb 1280 altrui)',
          method: 'GET',
          path: `/api/v2/blobs/${activeA.blobId}/thumbs/1280`,
          expectedStatus: 404,
        },
        {
          group: 'items',
          name: 'GET /api/v2/items/:id (item altrui)',
          method: 'GET',
          path: `/api/v2/items/${activeA.blobId}`,
          expectedStatus: 404,
        },
        {
          group: 'items',
          name: 'PATCH /api/v2/items/:id/meta (modifica encMeta altrui)',
          method: 'PATCH',
          path: `/api/v2/items/${activeA.blobId}/meta`,
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ encMeta: forgedMetaB64 }),
          expectedStatus: 404,
        },
        {
          group: 'items',
          name: 'PUT /api/v2/items/:id/meta (modifica encMeta altrui via PUT)',
          method: 'PUT',
          path: `/api/v2/items/${activeA.blobId}/meta`,
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ encMeta: forgedMetaB64 }),
          expectedStatus: 404,
        },
        {
          group: 'items',
          name: 'POST /api/v2/items/:id/replace (sostituzione blob su item altrui)',
          method: 'POST',
          path: `/api/v2/items/${activeA.blobId}/replace`,
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            expectedVersion: 1,
            newBlobId: replacementBlobB.blobId,
            encMeta: forgedMetaB64,
          }),
          expectedStatus: 404,
        },
        {
          group: 'items',
          name: 'POST /api/v2/items/:id/replace (uso di newBlobId appartenente a User A su proprio item)',
          method: 'POST',
          path: `/api/v2/items/${activeA.blobId}/replace`,
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            expectedVersion: 1,
            newBlobId: replacementBlobA.blobId,
            encMeta: forgedMetaB64,
          }),
          expectedStatus: 404,
        },
        {
          group: 'trash',
          name: 'POST /api/v2/trash (cestinamento item altrui)',
          method: 'POST',
          path: `/api/v2/trash`,
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ itemIds: [activeA.blobId] }),
          expectedStatus: 404,
        },
        {
          group: 'trash',
          name: 'POST /api/v2/trash/restore (ripristino item altrui dal cestino)',
          method: 'POST',
          path: `/api/v2/trash/restore`,
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ itemIds: [trashedA.blobId] }),
          expectedStatus: 404,
        },
        {
          group: 'trash',
          name: 'DELETE /api/v2/items/:id (eliminazione definitiva item altrui)',
          method: 'DELETE',
          path: `/api/v2/items/${activeA.blobId}`,
          expectedStatus: 404,
        },
        {
          group: 'shares',
          name: 'POST /api/v2/shares (creazione share con blobId altrui)',
          method: 'POST',
          path: `/api/v2/shares`,
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            items: [
              {
                blobId: activeA.blobId,
                wrappedFk: crypto.randomBytes(60).toString('base64url'),
              },
            ],
          }),
          expectedStatus: 404,
        },
        {
          group: 'shares',
          name: 'DELETE /api/v2/shares/:shareId (revoca share altrui)',
          method: 'DELETE',
          path: `/api/v2/shares/${shareIdA}`,
          expectedStatus: 404,
        },
        {
          group: 'uploads',
          name: 'PUT /api/v2/blobs/upload/:uploadId/0 (invio chunk su uploadId altrui)',
          method: 'PUT',
          path: `/api/v2/blobs/upload/${uploadIdChunkA}/0`,
          headers: { 'Content-Type': 'application/octet-stream' },
          body: new Uint8Array(pczkChunkA.ciphertext),
          expectedStatus: 404,
        },
        {
          group: 'uploads',
          name: 'POST /api/v2/blobs/upload/:uploadId/complete (completamento uploadId altrui)',
          method: 'POST',
          path: `/api/v2/blobs/upload/${uploadIdCompleteA}/complete`,
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({}),
          expectedStatus: 404,
        },
        {
          group: 'albums',
          name: 'GET /api/v2/albums (User B non vede il catalogo album di User A -> 404)',
          method: 'GET',
          path: `/api/v2/albums`,
          expectedStatus: 404,
        },
      ];

      for (const tc of crossUserTable) {
        const res = await fetch(`${srv.baseUrl}${tc.path}`, {
          method: tc.method,
          headers: {
            Cookie: userB.cookie,
            ...(tc.headers ?? {}),
          },
          body: tc.body,
        });
        assert.equal(
          res.status,
          tc.expectedStatus,
          `Fallito isolamento cross-user per [${tc.group}] ${tc.name}: atteso ${tc.expectedStatus}, ottenuto ${res.status}`
        );
        await assertUserAStateUnchanged(tc.name);
      }

      // Verifica aggiuntiva su /backup/check: User B non rileva i dedupTag di User A
      const crossDedup = await fetch(`${srv.baseUrl}/api/v2/backup/check`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Cookie: userB.cookie },
        body: JSON.stringify({ dedupTags: [activeA.pczk.dedupTagHex] }),
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

  it('7. Difesa CSRF Origin, TRUST_PROXY e Rate Limiting su /login, /login/params e share pubblici', async () => {
    const srv = await startTestV2Server({
      trustProxy: true,
      loginRateLimitMax: 4,
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

      // Rate limiting su /api/v2/login e /api/v2/login/params (loginRateLimitMax = 4, 1 già consumata da register)
      const params1 = await fetch(`${srv.baseUrl}/api/v2/login/params`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username: 'dave' }),
      });
      assert.equal(params1.status, 200);

      const login1 = await fetch(`${srv.baseUrl}/api/v2/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          username: 'dave',
          authSecret: crypto.randomBytes(32).toString('base64url'),
        }),
      });
      assert.equal(login1.status, 401);

      const params2 = await fetch(`${srv.baseUrl}/api/v2/login/params`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username: 'dave' }),
      });
      assert.equal(params2.status, 200);

      // La 5a richiesta auth nella finestra supera loginRateLimitMax=4 -> 429 su /login/params e su /login
      const rateLimitedParams = await fetch(`${srv.baseUrl}/api/v2/login/params`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username: 'dave' }),
      });
      assert.equal(rateLimitedParams.status, 429);
      assert.ok(Number(rateLimitedParams.headers.get('retry-after')) >= 1);

      const rateLimitedLogin = await fetch(`${srv.baseUrl}/api/v2/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          username: 'dave',
          authSecret: user.authSecretB64,
        }),
      });
      assert.equal(rateLimitedLogin.status, 429);
      assert.ok(Number(rateLimitedLogin.headers.get('retry-after')) >= 1);
    } finally {
      await srv.close();
    }
  });

  it('8. Persistenza al riavvio del server/DB, rifiuto sessioni scadute e assenza totale di segreti/ciphertext nei log', async () => {
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

      // Verifica che nei log catturati non compaia mai alcun segreto né porzioni di ciphertext
      const joinedLogs = srv1.logLines.join('\n');
      assert.ok(srv1.logLines.length > 0);
      assert.equal(joinedLogs.includes(eve.authSecretB64), false, 'authSecret non deve mai apparire nei log');
      assert.equal(joinedLogs.includes(eve.wrappedVkB64), false, 'wrappedVaultKey non deve mai apparire nei log');
      assert.equal(joinedLogs.includes(pczk.encMetaB64), false, 'encMeta non deve mai apparire nei log');
      const rawCookieToken = eve.cookie.split('=')[1];
      assert.equal(joinedLogs.includes(rawCookieToken), false, 'Il cookie di sessione non deve mai apparire nei log');
      const ciphertextPayloadSliceB64 = pczk.ciphertext.subarray(70, 134).toString('base64url');
      const ciphertextPayloadSliceHex = pczk.ciphertext.subarray(70, 134).toString('hex');
      assert.equal(joinedLogs.includes(ciphertextPayloadSliceB64), false, 'Il ciphertext b64 non deve mai apparire nei log');
      assert.equal(joinedLogs.includes(ciphertextPayloadSliceHex), false, 'Il ciphertext hex non deve mai apparire nei log');
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

  it('9. Verifiche FASE 2b & 3.0: setupToken monouso obbligatorio alla prima registrazione (senza token 403, con token 201, riuso 403), session token SHA-256, cleanup upload, purga cestino incluse thumb, shareManifest/scadenza/passwordWrap e quota per utente', async () => {
    const inviteSecret = 'pc-invite-2026-secret-token';
    const srv = await startTestV2Server({
      registrationEnabled: 'setup_token_or_invite',
      registrationInviteToken: inviteSecret,
      defaultQuotaBytes: 50_000,
      uploadTtlMs: 30_000,
      trashTtlMs: 30_000,
      initialNow: 1_700_000_000_000,
    });
    try {
      // 9a. Nessun "primo che arriva": all'avvio viene stampato una sola volta un setupToken casuale
      assert.equal(srv.printedSetupTokens.length, 1);
      const startupSetupToken = srv.getSetupToken();
      assert.ok(startupSetupToken && startupSetupToken.length >= 24);
      assert.equal(srv.printedSetupTokens[0], startupSetupToken);

      // Tentativo di prima registrazione SENZA setupToken -> 403 REGISTRATION_DISABLED
      const noTokenFirstReg = await fetch(`${srv.baseUrl}/api/v2/register`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          username: 'unauthenticated_first',
          salt: crypto.randomBytes(16).toString('base64url'),
          kdfParams: { algorithm: 'Argon2id', memoryKiB: 65536, iterations: 3, parallelism: 1 },
          authSecret: crypto.randomBytes(32).toString('base64url'),
          wrappedVaultKey: crypto.randomBytes(60).toString('base64url'),
        }),
      });
      assert.equal(noTokenFirstReg.status, 403);
      assert.equal(((await noTokenFirstReg.json()) as { error: string }).error, 'REGISTRATION_DISABLED');

      // Prima registrazione CON setupToken valido -> 201 Created
      const firstUser = await registerTestUser(srv.baseUrl, 'first_owner', {
        setupToken: startupSetupToken,
      });
      assert.ok(firstUser.userId);
      // Il setupToken monouso viene immediatamente azzerato in memoria
      assert.equal(srv.getSetupToken(), null);

      // Tentativo di riusare lo STESSO setupToken monouso per una seconda registrazione -> 403 REGISTRATION_DISABLED
      const reusedSetupTokenReg = await fetch(`${srv.baseUrl}/api/v2/register`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          username: 'reused_setup_token_user',
          salt: crypto.randomBytes(16).toString('base64url'),
          kdfParams: { algorithm: 'Argon2id', memoryKiB: 65536, iterations: 3, parallelism: 1 },
          authSecret: crypto.randomBytes(32).toString('base64url'),
          wrappedVaultKey: crypto.randomBytes(60).toString('base64url'),
          setupToken: startupSetupToken,
        }),
      });
      assert.equal(reusedSetupTokenReg.status, 403);
      assert.equal(((await reusedSetupTokenReg.json()) as { error: string }).error, 'REGISTRATION_DISABLED');

      // Il secondo utente senza inviteToken viene rifiutato con 403 REGISTRATION_DISABLED
      const blockedRegRes = await fetch(`${srv.baseUrl}/api/v2/register`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          username: 'uninvited_user',
          salt: crypto.randomBytes(16).toString('base64url'),
          kdfParams: { algorithm: 'Argon2id', memoryKiB: 65536, iterations: 3, parallelism: 1 },
          authSecret: crypto.randomBytes(32).toString('base64url'),
          wrappedVaultKey: crypto.randomBytes(60).toString('base64url'),
        }),
      });
      assert.equal(blockedRegRes.status, 403);
      const blockedBody = (await blockedRegRes.json()) as { error: string };
      assert.equal(blockedBody.error, 'REGISTRATION_DISABLED');

      // Il secondo utente con inviteToken valido si registra con successo -> 201
      const invitedUser = await registerTestUser(srv.baseUrl, 'invited_user', {
        inviteToken: inviteSecret,
      });
      assert.ok(invitedUser.userId);

      // 9a-bis (4.0.1 & 4.0.6): KDF floor (>= 64 MiB, t >= 3), validazione userId UUIDv4, 409 REGISTRATION_CONFLICT uniforme e assenza setupToken in log/SQLite
      const weakKdfReg = await fetch(`${srv.baseUrl}/api/v2/register`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          username: 'weak_kdf_user',
          salt: crypto.randomBytes(16).toString('base64url'),
          kdfParams: { algorithm: 'Argon2id', memoryKiB: 32768, iterations: 2, parallelism: 1 },
          authSecret: crypto.randomBytes(32).toString('base64url'),
          wrappedVaultKey: crypto.randomBytes(60).toString('base64url'),
          inviteToken: inviteSecret,
        }),
      });
      assert.equal(weakKdfReg.status, 400);
      assert.equal(((await weakKdfReg.json()) as { error: string }).error, 'INVALID_KDF_PARAMS');

      const badUserIdReg = await fetch(`${srv.baseUrl}/api/v2/register`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          userId: 'not-a-valid-uuid-v4',
          username: 'bad_userid_user',
          salt: crypto.randomBytes(16).toString('base64url'),
          kdfParams: { algorithm: 'Argon2id', memoryKiB: 65536, iterations: 3, parallelism: 1 },
          authSecret: crypto.randomBytes(32).toString('base64url'),
          wrappedVaultKey: crypto.randomBytes(60).toString('base64url'),
          inviteToken: inviteSecret,
        }),
      });
      assert.equal(badUserIdReg.status, 400);
      assert.equal(((await badUserIdReg.json()) as { error: string }).error, 'INVALID_USER_ID');

      // Conflitto su username esistente vs conflitto su userId esistente: stessa identica risposta 409 REGISTRATION_CONFLICT
      const dupUsernameRes = await fetch(`${srv.baseUrl}/api/v2/register`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          userId: crypto.randomUUID(),
          username: 'invited_user',
          salt: crypto.randomBytes(16).toString('base64url'),
          kdfParams: { algorithm: 'Argon2id', memoryKiB: 65536, iterations: 3, parallelism: 1 },
          authSecret: crypto.randomBytes(32).toString('base64url'),
          wrappedVaultKey: crypto.randomBytes(60).toString('base64url'),
          inviteToken: inviteSecret,
        }),
      });
      assert.equal(dupUsernameRes.status, 409);
      const dupUsernameBody = (await dupUsernameRes.json()) as Record<string, unknown>;

      const dupUserIdRes = await fetch(`${srv.baseUrl}/api/v2/register`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          userId: invitedUser.userId,
          username: 'brand_new_unique_username',
          salt: crypto.randomBytes(16).toString('base64url'),
          kdfParams: { algorithm: 'Argon2id', memoryKiB: 65536, iterations: 3, parallelism: 1 },
          authSecret: crypto.randomBytes(32).toString('base64url'),
          wrappedVaultKey: crypto.randomBytes(60).toString('base64url'),
          inviteToken: inviteSecret,
        }),
      });
      assert.equal(dupUserIdRes.status, 409);
      const dupUserIdBody = (await dupUserIdRes.json()) as Record<string, unknown>;
      assert.deepEqual(dupUsernameBody, { error: 'REGISTRATION_CONFLICT' });
      assert.deepEqual(dupUserIdBody, dupUsernameBody);

      // Verifica che setupToken non compaia mai nei log né in SQLite index.db
      for (const line of srv.logLines) {
        assert.equal(line.includes(startupSetupToken), false, 'setupToken non deve mai apparire nei log');
      }
      const sqliteRawBytes = fs.readFileSync(path.join(srv.vaultV2Dir, 'index.sqlite'));
      assert.equal(
        sqliteRawBytes.includes(Buffer.from(startupSetupToken, 'utf8')),
        false,
        'setupToken non deve mai essere salvato in chiaro in SQLite'
      );

      // 9b. Verifica in SQLite che il session token sia salvato SOLO come hash SHA-256 (mai in chiaro)
      const rawSid = firstUser.cookie.split('=')[1];
      const expectedSidHash = crypto.createHash('sha256').update(rawSid, 'utf8').digest();
      const sessionRows = srv.store.db
        .prepare(`SELECT sid_hash, user_id FROM sessions_v2 WHERE user_id = ?`)
        .all(firstUser.userId) as Array<{ sid_hash: Uint8Array; user_id: string }>;
      assert.equal(sessionRows.length, 1);
      assert.equal(Buffer.compare(Buffer.from(sessionRows[0].sid_hash), expectedSidHash), 0);
      assert.notEqual(Buffer.from(sessionRows[0].sid_hash).toString('utf8'), rawSid);

      // 9c. Quota personalizzata per utente (store.setUserQuota)
      srv.store.setUserQuota(invitedUser.userId, 123_456);
      const statsInvited = await fetch(`${srv.baseUrl}/api/v2/stats`, {
        headers: { Cookie: invitedUser.cookie },
      });
      const statsInvitedBody = (await statsInvited.json()) as { quotaBytes: number };
      assert.equal(statsInvitedBody.quotaBytes, 123_456);

      // 9d. Cleanup automatico degli upload abbandonati (uploads_v2 + file .part + file orfani)
      const abandonedBlobId = crypto.randomUUID();
      const abandonedPczk = await generateValidPczkBlob(
        firstUser.vaultKey,
        abandonedBlobId,
        crypto.randomBytes(500)
      );
      const initAbandoned = await fetch(`${srv.baseUrl}/api/v2/blobs/upload/init`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Cookie: firstUser.cookie },
        body: JSON.stringify({
          blobId: abandonedBlobId,
          totalSize: abandonedPczk.ciphertext.byteLength,
          chunkSize: abandonedPczk.ciphertext.byteLength,
          totalChunks: 2,
          expectedSha256: abandonedPczk.sha256Hex,
          encMeta: abandonedPczk.encMetaB64,
        }),
      });
      assert.equal(initAbandoned.status, 201);
      const { uploadId: abandonedUploadId } = (await initAbandoned.json()) as { uploadId: string };
      const abandonedPartPath = path.join(srv.tempUploadDir, `v2_upload_${abandonedUploadId}.part`);
      assert.equal(fs.existsSync(abandonedPartPath), true);

      // Creiamo anche un file .part orfano non referenziato in SQLite
      const orphanPartPath = path.join(srv.tempUploadDir, `v2_upload_${crypto.randomUUID()}.part`);
      fs.writeFileSync(orphanPartPath, Buffer.from('orphan-ciphertext'));
      assert.equal(fs.existsSync(orphanPartPath), true);

      // Avanziamo il tempo oltre uploadTtlMs (24h+) e inneschiamo un nuovo init (o cleanupExpiredUploads)
      srv.advanceTime(25 * 60 * 60 * 1000);
      srv.store.cleanupExpiredUploads(Date.now() + 25 * 60 * 60 * 1000, 1000);

      assert.equal(fs.existsSync(abandonedPartPath), false, 'Il file .part scaduto deve essere rimosso');
      assert.equal(fs.existsSync(orphanPartPath), false, 'Il file .part orfano deve essere rimosso');
      const remainingUploads = srv.store.db
        .prepare(`SELECT COUNT(*) as cnt FROM uploads_v2 WHERE upload_id = ?`)
        .get(abandonedUploadId) as { cnt: number };
      assert.equal(Number(remainingUploads.cnt), 0);

      // 9e. Purga del cestino elimina sia il blob principale sia le miniature .thumb320.pczk e .thumb1280.pczk su disco
      const mediaBlobId = crypto.randomUUID();
      const mediaPczk = await generateValidPczkBlob(firstUser.vaultKey, mediaBlobId, crypto.randomBytes(900));
      const initMedia = await fetch(`${srv.baseUrl}/api/v2/blobs/upload/init`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Cookie: firstUser.cookie },
        body: JSON.stringify({
          blobId: mediaBlobId,
          totalSize: mediaPczk.ciphertext.byteLength,
          chunkSize: mediaPczk.ciphertext.byteLength,
          totalChunks: 1,
          expectedSha256: mediaPczk.sha256Hex,
          encMeta: mediaPczk.encMetaB64,
        }),
      });
      const { uploadId: mediaUpId } = (await initMedia.json()) as { uploadId: string };
      await fetch(`${srv.baseUrl}/api/v2/blobs/upload/${mediaUpId}/0`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/octet-stream', Cookie: firstUser.cookie },
        body: new Uint8Array(mediaPczk.ciphertext),
      });
      await fetch(`${srv.baseUrl}/api/v2/blobs/upload/${mediaUpId}/complete`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Cookie: firstUser.cookie },
        body: JSON.stringify({}),
      });

      const validThumb = Buffer.concat([PCZK_MAGIC, Buffer.from([PCZK_VERSION_V1]), crypto.randomBytes(140)]);
      await fetch(`${srv.baseUrl}/api/v2/blobs/${mediaBlobId}/thumbs/320`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/octet-stream', Cookie: firstUser.cookie },
        body: validThumb,
      });
      await fetch(`${srv.baseUrl}/api/v2/blobs/${mediaBlobId}/thumbs/1280`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/octet-stream', Cookie: firstUser.cookie },
        body: validThumb,
      });

      const mainBlobDisk = srv.store.resolveBlobPath(firstUser.userId, mediaBlobId, '');
      const thumb320Disk = srv.store.resolveBlobPath(firstUser.userId, mediaBlobId, '.thumb320.pczk');
      const thumb1280Disk = srv.store.resolveBlobPath(firstUser.userId, mediaBlobId, '.thumb1280.pczk');
      assert.equal(fs.existsSync(mainBlobDisk), true);
      assert.equal(fs.existsSync(thumb320Disk), true);
      assert.equal(fs.existsSync(thumb1280Disk), true);

      // 9f. Share con shareManifest opaco cifrato, scadenza (expiresAt), maxDownloads e passwordWrap
      const passwordWrapB64 = crypto.randomBytes(64).toString('base64url');
      const shareManifestB64 = crypto.randomBytes(128).toString('base64url');
      const shareExpTime = 1_700_000_000_000 + 25 * 60 * 60 * 1000 + 10_000;
      const createSharePw = await fetch(`${srv.baseUrl}/api/v2/shares`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Cookie: firstUser.cookie },
        body: JSON.stringify({
          shareManifest: shareManifestB64,
          passwordWrap: passwordWrapB64,
          expiresAt: shareExpTime,
          maxDownloads: 1,
          items: [
            {
              blobId: mediaBlobId,
              wrappedFk: crypto.randomBytes(60).toString('base64url'),
            },
          ],
        }),
      });
      assert.equal(createSharePw.status, 201);
      const { shareId: pwShareId } = (await createSharePw.json()) as { shareId: string };

      const getSharePw = await fetch(`${srv.baseUrl}/api/v2/shares/${pwShareId}`);
      assert.equal(getSharePw.status, 200);
      const getSharePwBody = (await getSharePw.json()) as {
        shareManifest: string;
        passwordWrap: string;
        expiresAt: number;
      };
      assert.equal(getSharePwBody.shareManifest, shareManifestB64);
      assert.equal(getSharePwBody.passwordWrap, passwordWrapB64);
      assert.equal(getSharePwBody.expiresAt, shareExpTime);

      // Avanziamo oltre shareExpTime -> lo share scaduto risponde 404 sia su metadati sia su blob
      srv.advanceTime(15_000);
      const expiredShareMeta = await fetch(`${srv.baseUrl}/api/v2/shares/${pwShareId}`);
      assert.equal(expiredShareMeta.status, 404);
      const expiredShareBlob = await fetch(
        `${srv.baseUrl}/api/v2/shares/${pwShareId}/blobs/${mediaBlobId}`
      );
      assert.equal(expiredShareBlob.status, 404);

      // Spostiamo mediaBlobId nel cestino e avanziamo oltre trashTtlMs (30s) -> purga automatica rimuove blob e thumb dal disco
      await fetch(`${srv.baseUrl}/api/v2/trash`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Cookie: firstUser.cookie },
        body: JSON.stringify({ itemIds: [mediaBlobId] }),
      });
      srv.advanceTime(35_000);
      await fetch(`${srv.baseUrl}/api/v2/items?state=trashed`, {
        headers: { Cookie: firstUser.cookie },
      });

      assert.equal(fs.existsSync(mainBlobDisk), false, 'Il blob principale deve essere rimosso dal disco');
      assert.equal(fs.existsSync(thumb320Disk), false, 'La thumb 320 deve essere rimossa dal disco');
      assert.equal(fs.existsSync(thumb1280Disk), false, 'La thumb 1280 deve essere rimossa dal disco');
    } finally {
      await srv.close();
    }
  });

  it('10. Requisito HTTPS obbligatorio su /register, /login/params, /login e /account/rewrap per host non-localhost', async () => {
    const srv = await startTestV2Server({
      trustProxy: true,
    });
    try {
      // 10a. Richiesta HTTP non-secure verso IP LAN o dominio remoto (senza X-Forwarded-Proto: https) -> 403 HTTPS_REQUIRED
      const lanRegister = await fetch(`${srv.baseUrl}/api/v2/register`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Forwarded-Host': '192.168.1.50:3000',
          'X-Forwarded-Proto': 'http',
        },
        body: JSON.stringify({
          username: 'lan_user',
          salt: crypto.randomBytes(16).toString('base64url'),
          kdfParams: { algorithm: 'Argon2id', memoryKiB: 65536, iterations: 3, parallelism: 1 },
          authSecret: crypto.randomBytes(32).toString('base64url'),
          wrappedVaultKey: crypto.randomBytes(60).toString('base64url'),
        }),
      });
      assert.equal(lanRegister.status, 403);
      const lanRegBody = (await lanRegister.json()) as { error: string };
      assert.equal(lanRegBody.error, 'HTTPS_REQUIRED');

      const lanParams = await fetch(`${srv.baseUrl}/api/v2/login/params`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Forwarded-Host': 'cloud.example.com',
          'X-Forwarded-Proto': 'http',
        },
        body: JSON.stringify({ username: 'lan_user' }),
      });
      assert.equal(lanParams.status, 403);
      assert.equal(((await lanParams.json()) as { error: string }).error, 'HTTPS_REQUIRED');

      const lanLogin = await fetch(`${srv.baseUrl}/api/v2/login`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Forwarded-Host': 'cloud.example.com',
          'X-Forwarded-Proto': 'http',
        },
        body: JSON.stringify({
          username: 'lan_user',
          authSecret: crypto.randomBytes(32).toString('base64url'),
        }),
      });
      assert.equal(lanLogin.status, 403);
      assert.equal(((await lanLogin.json()) as { error: string }).error, 'HTTPS_REQUIRED');

      // 10b. Richiesta dietro reverse proxy HTTPS (TRUST_PROXY=true + X-Forwarded-Proto: https) -> 201 Created + Cookie Secure
      const httpsUser = await registerTestUser(srv.baseUrl, 'https_user', {
        headers: {
          'X-Forwarded-Host': 'cloud.example.com',
          'X-Forwarded-Proto': 'https',
          Origin: 'https://cloud.example.com',
        },
      });
      assert.match(httpsUser.setCookieRaw, /Secure/i);
      assert.match(httpsUser.setCookieRaw, /HttpOnly/i);
      assert.match(httpsUser.setCookieRaw, /SameSite=Strict/i);

      // 10c. /account/rewrap su HTTP non-secure viene rifiutato con 403 HTTPS_REQUIRED
      const insecureRewrap = await fetch(`${srv.baseUrl}/api/v2/account/rewrap`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Cookie: httpsUser.cookie,
          'X-Forwarded-Host': 'cloud.example.com',
          'X-Forwarded-Proto': 'http',
          Origin: 'http://cloud.example.com',
        },
        body: JSON.stringify({
          oldAuthSecret: httpsUser.authSecretB64,
          newAuthSecret: crypto.randomBytes(32).toString('base64url'),
          newWrappedVaultKey: httpsUser.wrappedVkB64,
        }),
      });
      assert.equal(insecureRewrap.status, 403);
      assert.equal(((await insecureRewrap.json()) as { error: string }).error, 'HTTPS_REQUIRED');
    } finally {
      await srv.close();
    }
  });

  it('11. DELETE /api/v2/blobs/upload/:uploadId annulla upload cifrato, rimuove file temporaneo e blocca abusi cross-user', async () => {
    const srv = await startTestV2Server();
    try {
      const userA = await registerTestUser(srv.baseUrl, 'abort_owner');
      const userB = await registerTestUser(srv.baseUrl, 'abort_other');

      const blobId = crypto.randomUUID();
      const pczk = await generateValidPczkBlob(userA.vaultKey, blobId, crypto.randomBytes(1024));

      const initRes = await fetch(`${srv.baseUrl}/api/v2/blobs/upload/init`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Cookie: userA.cookie },
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
      assert.equal(initRes.status, 201);
      const { uploadId } = (await initRes.json()) as { uploadId: string };

      const tempPart = path.join(srv.tempUploadDir, `v2_upload_${uploadId}.part`);
      assert.equal(fs.existsSync(tempPart), true);

      // Cross-user abort MUST return 404 and leave temp file intact
      const crossAbort = await fetch(`${srv.baseUrl}/api/v2/blobs/upload/${uploadId}`, {
        method: 'DELETE',
        headers: { Cookie: userB.cookie },
      });
      assert.equal(crossAbort.status, 404);
      assert.equal(fs.existsSync(tempPart), true);

      // Owner abort returns 200 and removes temp file + session
      const ownerAbort = await fetch(`${srv.baseUrl}/api/v2/blobs/upload/${uploadId}`, {
        method: 'DELETE',
        headers: { Cookie: userA.cookie },
      });
      assert.equal(ownerAbort.status, 200);
      const abortBody = (await ownerAbort.json()) as { ok: boolean; uploadId: string };
      assert.equal(abortBody.ok, true);
      assert.equal(abortBody.uploadId, uploadId);
      assert.equal(fs.existsSync(tempPart), false);

      // Subsequent chunk upload or second abort MUST return 404
      const putAfterAbort = await fetch(`${srv.baseUrl}/api/v2/blobs/upload/${uploadId}/0`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/octet-stream', Cookie: userA.cookie },
        body: new Uint8Array(pczk.ciphertext),
      });
      assert.equal(putAfterAbort.status, 404);
    } finally {
      await srv.close();
    }
  });
});

