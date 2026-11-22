import assert from 'node:assert/strict';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { after, before, describe, it } from 'node:test';
import express from 'express';
import {
  ZkSwStreamEngine,
  ZkVaultClient,
  buildShareUrl,
  decryptShareManifest,
  encryptShareManifest,
  parseClientDocumentPreview,
  parseShareUrlFragment,
  validateKdfParamsFloor,
  type ShareManifestPayloadV2,
} from '../client/zk-sdk/index.ts';
import { V2_STRICT_CSP, createZkV2WebRouter } from '../client/v2-app/router.ts';
import {
  ZkCryptoError,
  ZkErrorCode,
  ZkWorkerClient,
  decryptAlbums,
  decryptBlobRange,
  decryptBlobToBytes,
  decryptMeta,
  deriveKekAndAuthSecret,
  deriveRoot,
  deriveSubkeys,
  encryptAlbums,
  encryptBlobToBytes,
  encryptMeta,
  fromBase64Url,
  fromHex,
  parsePczkHeader,
  toBase64Url,
  toHex,
  unwrapVaultKey,
  wrapFileKeyForShare,
  wrapVaultKey,
  type AlbumCatalogPlaintext,
  type Argon2idParams,
  type BlobPlaintextMeta,
} from './zk/index.ts';
import { createZkV2Router } from './zkServerV2.ts';

// Parametri KDF al floor di sicurezza 4.0.1 (64 MiB = 65536 KiB, t=3, p=1, salt >= 16B)
const TEST_FLOOR_KDF_PARAMS: Argon2idParams = {
  memoryKiB: 65536,
  iterations: 3,
  parallelism: 1,
  hashLength: 32,
};

function findAllFilesRecursive(dir: string): string[] {
  if (!fs.existsSync(dir)) return [];
  const results: string[] = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      results.push(...findAllFilesRecursive(full));
    } else if (entry.isFile()) {
      results.push(full);
    }
  }
  return results;
}

/**
 * Costruisce tutte le forme di codifica (raw UTF-8/latin1, base64 standard, base64url, hex)
 * per ciascun segreto (4.0.4: accountKey, passphrase, kek, VK, FK, shareKey).
 */
function buildSecretEncodings(secretBytes: Uint8Array, rawString?: string): string[] {
  const encodings = new Set<string>();
  if (rawString && rawString.length >= 6) {
    encodings.add(rawString);
    const utf8Buf = Buffer.from(rawString, 'utf8');
    encodings.add(utf8Buf.toString('hex'));
    encodings.add(utf8Buf.toString('base64'));
    encodings.add(utf8Buf.toString('base64url'));
  }
  if (secretBytes.byteLength >= 8) {
    const buf = Buffer.from(secretBytes);
    encodings.add(buf.toString('latin1'));
    encodings.add(buf.toString('hex'));
    encodings.add(buf.toString('base64'));
    encodings.add(buf.toString('base64url'));
  }
  return Array.from(encodings);
}

describe('FASE 3 & 4.0 — Zero-Knowledge Web SDK (src/client/zk-sdk) & /v2 E2EE Integration', () => {
  let tmpRoot: string;
  let vaultV2Dir: string;
  let tempUploadDir: string;
  let server: http.Server;
  let baseUrl: string;
  let setupToken: string | null = null;
  let closeV2: () => void;
  const capturedServerLogs: string[] = [];

  before(async () => {
    tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'photocloud-zk-websdk-test-'));
    vaultV2Dir = path.join(tmpRoot, 'vault_v2');
    tempUploadDir = path.join(tmpRoot, 'temp_uploads');

    const app = express();
    app.use(express.json({ limit: '25mb' }));

    const zkV2 = createZkV2Router({
      vaultV2Dir,
      tempUploadDir,
      serverSecret: Buffer.from('0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef', 'hex'),
      loginRateLimitMax: 500,
      shareRateLimitMaxPerIp: 500,
      shareRateLimitMaxPerShare: 500,
      registrationInviteToken: 'test-invite-token-phase3',
      onSetupTokenGenerated: (tok) => {
        setupToken = tok;
      },
      logger: {
        info(ev, meta) {
          capturedServerLogs.push(JSON.stringify({ level: 'info', ev, meta }));
        },
        warn(ev, meta) {
          capturedServerLogs.push(JSON.stringify({ level: 'warn', ev, meta }));
        },
        error(ev, meta) {
          capturedServerLogs.push(JSON.stringify({ level: 'error', ev, meta }));
        },
      },
    });
    closeV2 = zkV2.close;

    app.use('/api/v2', zkV2.router);
    app.use('/v2', createZkV2WebRouter(process.cwd()));

    server = http.createServer(app);
    await new Promise<void>((resolve) => {
      server.listen(0, '127.0.0.1', () => resolve());
    });
    const addr = server.address() as { port: number };
    baseUrl = `http://127.0.0.1:${addr.port}`;
  });

  after(async () => {
    if (closeV2) closeV2();
    if (server) {
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
    if (tmpRoot && fs.existsSync(tmpRoot)) {
      fs.rmSync(tmpRoot, { recursive: true, force: true });
    }
  });

  it('1. Spy di rete (raw/base64/base64url/hex per accountKey, passphrase, kek, VK, FK, shareKey) + Ciclo completo E2EE', async () => {
    assert.ok(setupToken && setupToken.length >= 16, 'Il server deve generare un setupToken al primo avvio');

    const networkLog: Array<{ url: string; method: string; headers: Record<string, string>; bodyText: string }> = [];
    const spyFetch: typeof fetch = async (input, init) => {
      const urlStr = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url;
      const method = init?.method ?? 'GET';
      const headersObj: Record<string, string> = {};
      if (init?.headers) {
        const h = new Headers(init.headers);
        h.forEach((v, k) => {
          headersObj[k.toLowerCase()] = v;
        });
      }
      let bodyText = '';
      if (typeof init?.body === 'string') {
        bodyText = init.body;
      } else if (init?.body instanceof Uint8Array) {
        bodyText = Buffer.from(init.body).toString('latin1');
      }
      networkLog.push({ url: urlStr, method, headers: headersObj, bodyText });
      return fetch(input, init);
    };

    const client = new ZkVaultClient({
      baseUrl,
      fetchFn: spyFetch,
      workerClient: new ZkWorkerClient(),
    });

    const passphrase = 'Correct-Horse-Battery-Staple-99!';
    const prepared = client.prepareRegistration('alice_zk', passphrase, TEST_FLOOR_KDF_PARAMS);

    // Gate di conferma Recovery Code: se l'utente sbaglia la conferma, register() rifiuta prima di chiamare la rete
    await assert.rejects(
      () => client.register(prepared, passphrase, '00000000-00000000-wrong', { setupToken: setupToken! }),
      (err: unknown) => err instanceof ZkCryptoError && err.code === ZkErrorCode.INVALID_PARAMETER
    );

    // Tentativo senza setupToken -> 403 REGISTRATION_DISABLED
    await assert.rejects(
      () => client.register(prepared, passphrase, prepared.recoveryCode, {}),
      /REGISTRATION_DISABLED/
    );

    // Registrazione valida con setupToken e conferma Recovery Code corretta
    const regResult = await client.register(prepared, passphrase, prepared.recoveryCode, {
      setupToken: setupToken!,
    });
    assert.equal(regResult.keyFile.formatVersion, 2);
    assert.equal(regResult.keyFile.username, 'alice_zk');
    assert.equal(regResult.keyFileFileName, 'photocloud_v2_key_alice_zk.json');
    assert.equal(client.isUnlocked(), true);

    // Ricaviamo in modo indipendente kek e VK (Vault Key) dalla richiesta di registrazione effettiva (con regResult.userId)
    const regReqEntry = networkLog.find(
      (r) => r.url.endsWith('/api/v2/register') && r.method === 'POST' && r.bodyText.includes(regResult.userId)
    )!;
    assert.ok(regReqEntry, 'Deve esistere la richiesta POST /api/v2/register');
    const regReqBody = JSON.parse(regReqEntry.bodyText) as {
      userId: string;
      salt: string;
      wrappedVaultKey: string;
    };
    const rootInitial = await deriveRoot({
      accountKey: prepared.accountKey,
      userSalt: fromBase64Url(regReqBody.salt),
      passphrase,
      argon2Params: TEST_FLOOR_KDF_PARAMS,
    });
    const { kek: kekInitial } = await deriveKekAndAuthSecret(rootInitial);
    const vkBytes = await unwrapVaultKey(
      kekInitial,
      fromBase64Url(regReqBody.wrappedVaultKey),
      regReqBody.userId
    );

    // Verifica che il setupToken monouso sia stato consumato
    const secondClient = new ZkVaultClient({ baseUrl, fetchFn: spyFetch });
    const prep2 = secondClient.prepareRegistration('bob_zk', passphrase, TEST_FLOOR_KDF_PARAMS);
    await assert.rejects(
      () => secondClient.register(prep2, passphrase, prep2.recoveryCode, { setupToken: setupToken! }),
      /REGISTRATION_DISABLED/
    );

    // Lock e re-login tramite Recovery Code ricostruito
    client.lock();
    assert.equal(client.isUnlocked(), false);
    const recoveredKeyFile = client.recoverKeyFileFromRecoveryCode('alice_zk', prepared.recoveryCode);
    const loginRes = await client.login(recoveredKeyFile, passphrase);
    assert.equal(loginRes.username, 'alice_zk');
    assert.equal(client.isUnlocked(), true);

    // Test upload multi-chunk (2.3 MiB -> 3 chunk PCZK da 1 MiB) con pausa e ripresa
    const multiChunkSize = 2 * 1024 * 1024 + 321_000;
    const multiChunkPlain = new Uint8Array(multiChunkSize);
    for (let i = 0; i < multiChunkSize; i++) {
      multiChunkPlain[i] = (i * 73 + 19) & 0xff;
    }
    const thumb320Plain = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3, 4, 0xff, 0xd9]);

    const uploadCtrl = client.startUploadFile({
      name: 'vacanze_dolomiti_2026.jpg',
      mimeType: 'image/jpeg',
      size: multiChunkPlain.byteLength,
      source: multiChunkPlain,
      favorite: true,
      thumb320Plaintext: thumb320Plain,
    });

    uploadCtrl.pause();
    assert.equal(uploadCtrl.status, 'paused');
    setTimeout(() => uploadCtrl.resume(), 15);

    const upResult = await uploadCtrl.promise;
    assert.equal(upResult.skippedDuplicate, false);
    assert.ok(upResult.itemId);

    // Verifica dedup opzionale (`skipIfDuplicate: true`)
    const dupResult = await client.uploadFile(
      {
        name: 'vacanze_dolomiti_2026_copia.jpg',
        mimeType: 'image/jpeg',
        size: multiChunkPlain.byteLength,
        source: multiChunkPlain,
      },
      { skipIfDuplicate: true }
    );
    assert.equal(dupResult.skippedDuplicate, true);

    // Verifica sync, ricerca naturale e statistiche
    const synced = await client.syncItems('all');
    assert.equal(synced.length, 1);
    assert.equal(synced[0].meta.name, 'vacanze_dolomiti_2026.jpg');
    assert.equal(synced[0].meta.isFavorite, true);

    const favSearch = client.searchItems('foto preferite');
    assert.equal(favSearch.length, 1);
    assert.equal(favSearch[0].id, upResult.itemId);

    const stats = await client.getStats();
    assert.equal(stats.activeCount, 1);
    assert.equal(stats.photosCount, 1);
    assert.equal(stats.photosBytes, multiChunkPlain.byteLength);

    // Verifica download miniatura 320
    const decThumb = await client.downloadThumbnail(upResult.blobId, 320);
    assert.deepEqual(decThumb, thumb320Plain);

    // Verifica Range download a cavallo del confine tra chunk 0 e chunk 1 (1 MiB = 1_048_576)
    const rangeStart = 1_048_500;
    const rangeEnd = 1_048_700;
    const { plaintextSlice } = await client.downloadBlobRange(upResult.blobId, rangeStart, rangeEnd);
    assert.deepEqual(plaintextSlice, multiChunkPlain.subarray(rangeStart, rangeEnd + 1));

    // Verifica ticket video per Service Worker: contiene solo fileKey (32B) e header, MAI vaultKey
    const ticket = await client.getVideoStreamTicket(upResult.blobId);
    assert.equal(ticket.fileKey.byteLength, 32);
    assert.equal(ticket.header.blobId, upResult.blobId);
    assert.ok(ticket.totalCiphertextBytes > multiChunkPlain.byteLength);

    // Creiamo una condivisione nello spy di rete per verificare che shareKey e #fragment non vengano mai inviati
    const spyShare = await client.createShare(
      {
        itemIds: [upResult.itemId!],
        title: 'Share sotto Spy di Rete',
      },
      baseUrl
    );
    const spyShareKeyBytes = fromBase64Url(spyShare.shareKeyBase64Url);
    const anonSpyClient = new ZkVaultClient({ baseUrl, fetchFn: spyFetch });
    const openedSpyShare = await anonSpyClient.openPublicShare(spyShare.shareId, spyShare.shareUrl);
    assert.equal(openedSpyShare.items.length, 1);

    // Verifica Photo Editor replace con expectedVersion
    const editedPlain = new Uint8Array([10, 20, 30, 40, 50, 60, 70, 80]);
    const replacedItem = await client.replaceItemWithEditedBlob(
      upResult.itemId!,
      editedPlain,
      { name: 'vacanze_dolomiti_2026_edit.jpg' },
      1
    );
    assert.equal(replacedItem.version, 2);
    assert.equal(replacedItem.meta.size, editedPlain.byteLength);

    // Conflitto se si riusa expectedVersion = 1
    await assert.rejects(
      () => client.replaceItemWithEditedBlob(upResult.itemId!, editedPlain, {}, 1),
      /VERSION_MISMATCH|VERSION_CONFLICT|412|409/
    );

    // Verifica export ZIP in streaming
    const zipStream = client.exportZipStream([upResult.itemId!]);
    const zipChunks: Uint8Array[] = [];
    const reader = zipStream.getReader();
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      if (value) zipChunks.push(value);
    }
    const zipBytes = Buffer.concat(zipChunks.map((c) => Buffer.from(c)));
    assert.equal(zipBytes.readUInt32LE(0), 0x04034b50, 'Deve iniziare con la firma ZIP Local File Header');
    assert.ok(zipBytes.includes(Buffer.from('vacanze_dolomiti_2026_edit.jpg', 'utf8')));

    // Verifica Cestino e Ripristino
    await client.trashItems([upResult.itemId!]);
    assert.equal(client.getItems('active').length, 0);
    assert.equal(client.getItems('trashed').length, 1);
    await client.restoreItems([upResult.itemId!]);
    assert.equal(client.getItems('active').length, 1);

    // Verifica Cambio Passphrase (Rewrap) senza ricifrare i blob
    const newPassphrase = 'New-Passphrase-Ultra-Strong-2026!';
    const updatedKeyFile = await client.changePassphrase(passphrase, newPassphrase, TEST_FLOOR_KDF_PARAMS);
    client.lock();

    // La vecchia passphrase deve fallire con errore uniforme
    await assert.rejects(() => client.login(updatedKeyFile, passphrase), /Credenziali o keyfile non validi/);

    // La nuova passphrase sblocca il vault e decifra i file esistenti
    await client.login(updatedKeyFile, newPassphrase);
    const downloadedAfterRewrap = await client.downloadBlobToBytes(replacedItem.blobId);
    assert.deepEqual(downloadedAfterRewrap, editedPlain);

    // 4.0.4 Verifica Spy di Rete completa:
    // Cercare le forme raw, base64, base64url e hex di accountKey, passphrase, kek, VK, FK, shareKey
    // in URL (path, query, fragment), header e body di OGNI richiesta HTTP.
    const forbiddenSecrets: Array<{ name: string; encodings: string[] }> = [
      { name: 'accountKey', encodings: buildSecretEncodings(prepared.accountKey) },
      { name: 'passphrase', encodings: buildSecretEncodings(new TextEncoder().encode(passphrase), passphrase) },
      {
        name: 'newPassphrase',
        encodings: buildSecretEncodings(new TextEncoder().encode(newPassphrase), newPassphrase),
      },
      { name: 'kek', encodings: buildSecretEncodings(kekInitial) },
      { name: 'VK (vaultKey)', encodings: buildSecretEncodings(vkBytes) },
      { name: 'FK (fileKey)', encodings: buildSecretEncodings(ticket.fileKey) },
      { name: 'shareKey', encodings: buildSecretEncodings(spyShareKeyBytes) },
    ];

    for (const reqEntry of networkLog) {
      assert.equal(
        reqEntry.url.includes('#'),
        false,
        `Il fragment # non deve mai essere inviato nelle richieste HTTP: ${reqEntry.url}`
      );
      const serializedHeaders = JSON.stringify(reqEntry.headers);
      for (const secretGroup of forbiddenSecrets) {
        for (const secretStr of secretGroup.encodings) {
          assert.equal(
            reqEntry.url.includes(secretStr),
            false,
            `Segreto [${secretGroup.name}] trapelato nell'URL di ${reqEntry.method} ${reqEntry.url}`
          );
          assert.equal(
            serializedHeaders.includes(secretStr),
            false,
            `Segreto [${secretGroup.name}] trapelato negli header di ${reqEntry.method} ${reqEntry.url}`
          );
          assert.equal(
            reqEntry.bodyText.includes(secretStr),
            false,
            `Segreto [${secretGroup.name}] trapelato nel body di ${reqEntry.method} ${reqEntry.url}`
          );
        }
      }
    }
  });

  it('2. Concorrenza ottimistica Album: gestione automatica di 412 Precondition Failed con reload + merge insiemistico', async () => {
    const clientA = new ZkVaultClient({ baseUrl });
    const clientB = new ZkVaultClient({ baseUrl });

    const inviteToken = process.env.REGISTRATION_INVITE_TOKEN;
    process.env.REGISTRATION_INVITE_TOKEN = 'test-invite-token-phase3';

    try {
      const pass = 'Album-Concurrency-Passphrase-2026!';
      const prep = clientA.prepareRegistration('album_user', pass, TEST_FLOOR_KDF_PARAMS);
      const { keyFile } = await clientA.register(prep, pass, prep.recoveryCode, {
        inviteToken: 'test-invite-token-phase3',
      });
      await clientB.login(keyFile, pass);

      await clientA.getAlbums();
      await clientB.getAlbums();

      const blob1 = '11111111-1111-4111-8111-111111111111';
      const blob2 = '22222222-2222-4222-8222-222222222222';
      const blob3 = '33333333-3333-4333-8333-333333333333';

      await clientA.saveAlbums((cat) => ({
        ...cat,
        albums: [
          {
            id: 'alb-shared',
            title: 'Montagna',
            blobIds: [blob1, blob2],
            createdAt: 1000,
            updatedAt: 2000,
          },
        ],
      }));

      const merged = await clientB.saveAlbums((cat) => ({
        ...cat,
        albums: [
          ...cat.albums.filter((a) => a.id !== 'alb-shared'),
          {
            id: 'alb-shared',
            title: 'Montagna Estate',
            blobIds: [blob2, blob3],
            createdAt: 1000,
            updatedAt: 3000,
          },
          {
            id: 'alb-mare',
            title: 'Mare 2026',
            blobIds: [blob3],
            createdAt: 1500,
            updatedAt: 3000,
          },
        ],
      }));

      assert.equal(merged.albums.length, 2);
      const sharedAlb = merged.albums.find((a) => a.id === 'alb-shared')!;
      assert.ok(sharedAlb);
      assert.deepEqual(sharedAlb.blobIds.sort(), [blob1, blob2, blob3].sort());
    } finally {
      if (inviteToken === undefined) delete process.env.REGISTRATION_INVITE_TOKEN;
      else process.env.REGISTRATION_INVITE_TOKEN = inviteToken;
    }
  });

  it('3. Condivisione pubblica E2EE (/v2/share/<shareId>#<shareKey>): shareManifest cifrato, chiave solo nel fragment # e passwordWrap opzionale', async () => {
    const ownerClient = new ZkVaultClient({ baseUrl });
    const anonClient = new ZkVaultClient({ baseUrl });

    process.env.REGISTRATION_INVITE_TOKEN = 'share-invite-token';
    try {
      const pass = 'Share-Owner-Passphrase-2026!';
      const prep = ownerClient.prepareRegistration('share_owner', pass, TEST_FLOOR_KDF_PARAMS);
      await ownerClient.register(prep, pass, prep.recoveryCode, { inviteToken: 'test-invite-token-phase3' });

      const secretDocBytes = new TextEncoder().encode('Contenuto riservato condiviso End-to-End via #fragment');
      const up = await ownerClient.uploadFile({
        name: 'contratto_riservato.txt',
        mimeType: 'text/plain',
        size: secretDocBytes.byteLength,
        source: secretDocBytes,
      });

      const shareRes = await ownerClient.createShare(
        {
          itemIds: [up.itemId!],
          title: 'Documenti Progetto Alfa',
        },
        baseUrl
      );

      const parsedUrl = new URL(shareRes.shareUrl);
      assert.equal(parsedUrl.search, '', "La query string dell'URL di share deve essere vuota");
      assert.ok(parsedUrl.hash.startsWith('#') && parsedUrl.hash.length > 20, 'Il fragment # deve contenere shareKey');

      assert.throws(
        () =>
          parseShareUrlFragment(
            `${baseUrl}/v2/share/${shareRes.shareId}?key=${shareRes.shareKeyBase64Url}#${shareRes.shareKeyBase64Url}`
          ),
        (err: unknown) => err instanceof ZkCryptoError && err.code === ZkErrorCode.INVALID_PARAMETER
      );

      const opened = await anonClient.openPublicShare(shareRes.shareId, shareRes.shareUrl);
      assert.equal(opened.title, 'Documenti Progetto Alfa');
      assert.equal(opened.items.length, 1);
      assert.equal(opened.items[0].meta.name, 'contratto_riservato.txt');

      const downloadedFull = await anonClient.downloadSharedBlobToBytes(opened, up.blobId);
      assert.deepEqual(downloadedFull, secretDocBytes);

      const { plaintextSlice } = await anonClient.downloadSharedBlobRange(opened, up.blobId, 0, 18);
      assert.deepEqual(plaintextSlice, secretDocBytes.subarray(0, 19));

      // Condivisione con password opzionale (passwordWrap Argon2id >= 64 MiB, t >= 3)
      const pwShareRes = await ownerClient.createShare(
        {
          itemIds: [up.itemId!],
          title: 'Share Protetta',
          password: 'Password-Condivisione-123!',
        },
        baseUrl
      );

      await assert.rejects(
        () => anonClient.openPublicShare(pwShareRes.shareId, pwShareRes.shareUrl, 'Password-Sbagliata'),
        (err: unknown) => err instanceof ZkCryptoError && err.code === ZkErrorCode.AUTH_TAG_MISMATCH
      );

      const openedPw = await anonClient.openPublicShare(
        pwShareRes.shareId,
        pwShareRes.shareUrl,
        'Password-Condivisione-123!'
      );
      assert.equal(openedPw.title, 'Share Protetta');

      // Revoca della share (DELETE /api/v2/shares/:shareId) -> successiva apertura fallisce con 404
      await ownerClient.revokeShare(pwShareRes.shareId);
      await assert.rejects(
        () => anonClient.openPublicShare(pwShareRes.shareId, pwShareRes.shareUrl, 'Password-Condivisione-123!'),
        /404|SHARE_NOT_FOUND/
      );
    } finally {
      delete process.env.REGISTRATION_INVITE_TOKEN;
    }
  });

  it('4. Canary Test: nessuna stringa canary (nome file, contenuto plaintext, titolo album) appare in vault_v2/, SQLite o log del server', async () => {
    const client = new ZkVaultClient({ baseUrl });
    process.env.REGISTRATION_INVITE_TOKEN = 'canary-invite-token';
    const canaryFilename = 'CANARY_FILENAME_ZX9941_SECRET.jpg';
    const canaryPlaintextStr = 'CANARY_PLAINTEXT_CONTENT_QV8821_SECRET_PAYLOAD';
    const canaryAlbumTitle = 'CANARY_ALBUM_TITLE_LM7732_SECRET';

    try {
      const pass = 'Canary-Vault-Passphrase-2026!';
      const prep = client.prepareRegistration('canary_user', pass, TEST_FLOOR_KDF_PARAMS);
      await client.register(prep, pass, prep.recoveryCode, { inviteToken: 'test-invite-token-phase3' });

      const plainBytes = new TextEncoder().encode(canaryPlaintextStr);
      const up = await client.uploadFile({
        name: canaryFilename,
        mimeType: 'image/jpeg',
        size: plainBytes.byteLength,
        source: plainBytes,
      });

      await client.saveAlbums(() => ({
        v: 1,
        revision: 1,
        albums: [
          {
            id: 'alb-canary',
            title: canaryAlbumTitle,
            blobIds: [up.blobId],
            createdAt: Date.now(),
            updatedAt: Date.now(),
          },
        ],
      }));

      const canaryPatterns = [
        ...buildSecretEncodings(new TextEncoder().encode(canaryFilename), canaryFilename),
        ...buildSecretEncodings(plainBytes, canaryPlaintextStr),
        ...buildSecretEncodings(new TextEncoder().encode(canaryAlbumTitle), canaryAlbumTitle),
      ];

      const allFiles = [
        ...findAllFilesRecursive(vaultV2Dir),
        ...findAllFilesRecursive(tempUploadDir),
      ];
      assert.ok(allFiles.length > 0, 'Devono esistere file su disco in vault_v2');

      for (const filePath of allFiles) {
        const rawBuf = fs.readFileSync(filePath);
        const rawLatin1 = rawBuf.toString('latin1');
        const rawHex = rawBuf.toString('hex');
        for (const pattern of canaryPatterns) {
          assert.equal(
            rawLatin1.includes(pattern) || rawHex.includes(pattern),
            false,
            `Canary pattern "${pattern}" trovato in chiaro su disco nel file ${filePath}`
          );
        }
      }

      const combinedLogs = capturedServerLogs.join('\n');
      for (const pattern of canaryPatterns) {
        assert.equal(
          combinedLogs.includes(pattern),
          false,
          `Canary pattern "${pattern}" trovato nei log del server`
        );
      }
    } finally {
      delete process.env.REGISTRATION_INVITE_TOKEN;
    }
  });

  it('5. KDF Floor & Parameter Pinning (4.0.1): rifiuto di parametri KDF deboli (< 64 MiB = 65536 KiB, t < 3, salt < 16B) prima di Argon2id', async () => {
    // 1. Verifica diretta del validatore floor (65536 KiB, t >= 3, p >= 1, salt >= 16B)
    assert.throws(
      () => validateKdfParamsFloor({ memoryKiB: 32768, iterations: 3, parallelism: 1 }, new Uint8Array(16)),
      (err: unknown) => err instanceof ZkCryptoError && err.code === ZkErrorCode.INVALID_PARAMETER
    );
    assert.throws(
      () => validateKdfParamsFloor({ memoryKiB: 65536, iterations: 2, parallelism: 1 }, new Uint8Array(16)),
      (err: unknown) => err instanceof ZkCryptoError && err.code === ZkErrorCode.INVALID_PARAMETER
    );
    assert.throws(
      () => validateKdfParamsFloor({ memoryKiB: 65536, iterations: 3, parallelism: 1 }, new Uint8Array(8)),
      (err: unknown) => err instanceof ZkCryptoError && err.code === ZkErrorCode.INVALID_PARAMETER
    );
    assert.doesNotThrow(() =>
      validateKdfParamsFloor({ memoryKiB: 65536, iterations: 3, parallelism: 1 }, new Uint8Array(16))
    );

    // 2. Verifica che ZkVaultClient.login() rifiuti una risposta malevola da /api/v2/login/params (es. 32 MiB o t=2) PRIMA di eseguire Argon2id
    let argon2Called = false;
    const fakeWorkerClient = {
      async deriveRootAndKeys() {
        argon2Called = true;
        throw new Error('Argon2id non doveva essere invocato su parametri sotto il floor!');
      },
    } as unknown as ZkWorkerClient;

    const maliciousFetch: typeof fetch = async () =>
      new Response(
        JSON.stringify({
          salt: toBase64Url(new Uint8Array(16)),
          kdfParams: {
            algorithm: 'Argon2id',
            memoryKiB: 32768, // Sotto il nuovo floor di 65536 KiB!
            iterations: 3,
            parallelism: 1,
          },
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } }
      );

    const victimClient = new ZkVaultClient({
      baseUrl: 'https://vault.example',
      fetchFn: maliciousFetch,
      workerClient: fakeWorkerClient,
    });

    await assert.rejects(
      () =>
        victimClient.login(
          {
            formatVersion: 2,
            username: 'alice_zk',
            accountKey: toBase64Url(new Uint8Array(32).fill(7)),
            createdAt: new Date().toISOString(),
          },
          'Passphrase-Valida-1234!'
        ),
      (err: unknown) => err instanceof ZkCryptoError && err.code === ZkErrorCode.INVALID_PARAMETER
    );
    assert.equal(argon2Called, false, 'Argon2id non deve mai partire se i parametri sono sotto il floor');
  });

  it('6. Sicurezza Web /v2: header CSP rigoroso, Referrer-Policy: no-referrer, zero script/style inline e anteprima documenti (CSV, PDF)', async () => {
    const htmlResp = await fetch(`${baseUrl}/v2`);
    assert.equal(htmlResp.status, 200);
    assert.equal(htmlResp.headers.get('content-security-policy'), V2_STRICT_CSP);
    assert.equal(htmlResp.headers.get('referrer-policy'), 'no-referrer');
    const html = await htmlResp.text();
    assert.equal(/<style\b/i.test(html), false, 'Nessun tag <style> inline ammesso');
    assert.equal(/style\s*=/i.test(html), false, 'Nessun attributo style= inline ammesso');

    // Anteprima documenti testo/CSV lato client
    const csvBytes = new TextEncoder().encode('Nome,Importo\nAlice,120\nBob,250');
    const preview = await parseClientDocumentPreview(csvBytes, 'report.csv', 'text/csv');
    assert.equal(preview.kind, 'text');
    assert.equal(preview.paragraphs.length, 3);
    assert.equal(preview.paragraphs[1], 'Alice,120');

    // Anteprima PDF lato client
    const pdfBytes = new TextEncoder().encode(
      '%PDF-1.7\n1 0 obj << /Type /Catalog /Pages 2 0 R >> endobj\n2 0 obj << /Type /Page >> endobj\nstream\nBT (Documento PDF Riservato Zero-Knowledge) Tj ET\nendstream\n%%EOF'
    );
    const pdfPreview = await parseClientDocumentPreview(pdfBytes, 'fattura.pdf', 'application/pdf');
    assert.equal(pdfPreview.kind, 'pdf');
    assert.ok(pdfPreview.paragraphs.some((p) => p.includes('Documento PDF Riservato Zero-Knowledge')));
  });

  it('7. Service Worker Video Ticket Semantics (4.0.3): legame (blobId, clientId), scope /v2/, multi-Range 206 con Cache-Control: no-store, e zeroizzazione su LOCK_ALL_KEYS', async () => {
    const fkWrapKey = new Uint8Array(32).fill(0x42);
    const blobIdA = 'aaaaaaaa-1111-4111-8111-aaaaaaaaaaaa';
    const blobIdB = 'bbbbbbbb-2222-4222-8222-bbbbbbbbbbbb';
    const videoPlain = new Uint8Array(150_000);
    for (let i = 0; i < videoPlain.byteLength; i++) {
      videoPlain[i] = (i * 31 + 7) & 0xff;
    }

    const { ciphertext: pczkVideoA } = await encryptBlobToBytes(videoPlain, {
      fkWrapKey,
      blobId: blobIdA,
      chunkSizeLog2: 16, // 64 KiB chunks -> 3 chunks
    });
    const parsedHeaderA = parsePczkHeader(pczkVideoA.subarray(0, 86));
    const { unwrapFileKey } = await import('./zk/index.ts');
    const fkA = await unwrapFileKey(fkWrapKey, parsedHeaderA.wrappedFk, blobIdA);

    const engine = new ZkSwStreamEngine();
    const swOrigin = 'http://127.0.0.1:3000';
    const clientIdV2 = 'client-window-v2-1';
    const clientUrlV2 = 'http://127.0.0.1:3000/v2/';

    const fetchCiphertextRange = async (bId: string, startByte: number, endByteInclusive: number) => {
      assert.equal(bId, blobIdA);
      return pczkVideoA.subarray(startByte, endByteInclusive + 1);
    };

    // 7a. Nessun ticket -> 403 STREAM_TICKET_NOT_REGISTERED
    const noTicketRes = await engine.handleStreamRequest({
      blobId: blobIdA,
      clientId: clientIdV2,
      clientUrl: clientUrlV2,
      swOrigin,
      rangeHeader: 'bytes=0-1023',
      fetchCiphertextRange,
    });
    assert.equal(noTicketRes.status, 403);
    assert.equal(noTicketRes.headers['Cache-Control'], 'no-store');

    // 7b. Registrazione ticket da un client fuori dallo scope /v2/ -> rifiutato
    const outOfScopeReg = engine.registerTicket({
      clientId: 'client-v1',
      clientUrl: 'http://127.0.0.1:3000/gallery',
      swOrigin,
      blobId: blobIdA,
      fileKey: new Uint8Array(fkA),
      headerBytes: pczkVideoA.subarray(0, 86),
      totalCiphertextBytes: pczkVideoA.byteLength,
      mime: 'video/mp4',
    });
    assert.equal(outOfScopeReg.ok, false);
    assert.equal(outOfScopeReg.error, 'CLIENT_OUTSIDE_V2_SCOPE');

    // 7c. Registrazione valida nello scope /v2/ per (blobIdA, clientIdV2)
    const validReg = engine.registerTicket({
      clientId: clientIdV2,
      clientUrl: clientUrlV2,
      swOrigin,
      blobId: blobIdA,
      fileKey: new Uint8Array(fkA),
      headerBytes: pczkVideoA.subarray(0, 86),
      totalCiphertextBytes: pczkVideoA.byteLength,
      mime: 'video/mp4',
    });
    assert.equal(validReg.ok, true);

    // 7d. Ticket del blob A usato per richiedere il blob B -> 403
    const crossBlobRes = await engine.handleStreamRequest({
      blobId: blobIdB,
      clientId: clientIdV2,
      clientUrl: clientUrlV2,
      swOrigin,
      rangeHeader: 'bytes=0-1023',
      fetchCiphertextRange,
    });
    assert.equal(crossBlobRes.status, 403);

    // 7e. Ticket del blob A usato da un clientId diverso -> 403
    const crossClientRes = await engine.handleStreamRequest({
      blobId: blobIdA,
      clientId: 'other-client-id',
      clientUrl: clientUrlV2,
      swOrigin,
      rangeHeader: 'bytes=0-1023',
      fetchCiphertextRange,
    });
    assert.equal(crossClientRes.status, 403);

    // 7f. Richieste Range multiple sullo stesso ticket (seek avanti e indietro tra chunk 0, 1 e 2)
    const r1 = await engine.handleStreamRequest({
      blobId: blobIdA,
      clientId: clientIdV2,
      clientUrl: clientUrlV2,
      swOrigin,
      rangeHeader: 'bytes=0-99',
      fetchCiphertextRange,
    });
    assert.equal(r1.status, 206);
    assert.equal(r1.headers['Cache-Control'], 'no-store');
    assert.equal(r1.headers['Content-Range'], `bytes 0-99/${videoPlain.byteLength}`);
    assert.deepEqual(r1.body, videoPlain.subarray(0, 100));

    // Seek a cavallo tra chunk 0 e chunk 1 (65500..65600)
    const r2 = await engine.handleStreamRequest({
      blobId: blobIdA,
      clientId: clientIdV2,
      clientUrl: clientUrlV2,
      swOrigin,
      rangeHeader: 'bytes=65500-65600',
      fetchCiphertextRange,
    });
    assert.equal(r2.status, 206);
    assert.equal(r2.headers['Cache-Control'], 'no-store');
    assert.equal(r2.headers['Content-Range'], `bytes 65500-65600/${videoPlain.byteLength}`);
    assert.deepEqual(r2.body, videoPlain.subarray(65500, 65601));

    // 7g. Dopo LOCK_ALL_KEYS -> 403 e tutti i ticket rimossi
    engine.lockAllKeys();
    assert.equal(engine.getActiveTicketCount(), 0);
    const afterLockRes = await engine.handleStreamRequest({
      blobId: blobIdA,
      clientId: clientIdV2,
      clientUrl: clientUrlV2,
      swOrigin,
      rangeHeader: 'bytes=0-99',
      fetchCiphertextRange,
    });
    assert.equal(afterLockRes.status, 403);
  });

  it('8. Generazione e verifica delle fixture di interoperabilità Web -> Android/Python in test-vectors/interop/ (4A.2)', async () => {
    const interopDir = path.resolve(process.cwd(), 'test-vectors', 'interop');
    fs.mkdirSync(interopDir, { recursive: true });

    const accountKey = new Uint8Array(32);
    for (let i = 0; i < 32; i++) accountKey[i] = (i + 1) & 0xff;
    const userSalt = new Uint8Array(16);
    for (let i = 0; i < 16; i++) userSalt[i] = (0xa0 + i) & 0xff;
    const passphrase = 'Interop-Phase3-Phase4-Passphrase!';
    const userId = '99999999-8888-4777-8666-555555555555';
    const blobId = '12345678-1234-4123-8123-123456789abc';
    const shareId = 'abcdef01-2345-4678-89ab-cdef01234567';

    const root = await deriveRoot({
      accountKey,
      userSalt,
      passphrase,
      argon2Params: TEST_FLOOR_KDF_PARAMS,
    });
    const { kek, authSecret } = await deriveKekAndAuthSecret(root);

    const vaultKey = new Uint8Array(32);
    for (let i = 0; i < 32; i++) vaultKey[i] = (0x50 + i) & 0xff;
    const wrappedVk = await wrapVaultKey(kek, vaultKey, userId);
    const subkeys = await deriveSubkeys(vaultKey);

    const plaintext = new TextEncoder().encode(
      'PhotoCloud Zero-Knowledge v2 Interop Payload between Web TypeScript SDK and Android Kotlin Client.'
    );
    const { ciphertext: pczkBlob, result: blobResult } = await encryptBlobToBytes(plaintext, {
      fkWrapKey: subkeys.fkWrapKey,
      blobId,
      dedupKey: subkeys.dedupKey,
    });

    const metaPayload: BlobPlaintextMeta = {
      v: 1,
      name: 'interop_photo_2026.jpg',
      mime: 'image/jpeg',
      size: plaintext.byteLength,
      takenAt: 1760000000000,
      createdAt: 1760000000000,
      width: 1920,
      height: 1080,
      isFavorite: true,
    };
    const encMetaBytes = await encryptMeta(subkeys.metaKey, blobId, metaPayload);

    const shareKey = new Uint8Array(32);
    for (let i = 0; i < 32; i++) shareKey[i] = (0xc0 + i) & 0xff;
    const header = parsePczkHeader(pczkBlob.subarray(0, 86));
    const { plaintext: decryptedBlobCheck } = await decryptBlobToBytes(pczkBlob, {
      fkWrapKey: subkeys.fkWrapKey,
      expectedBlobId: blobId,
    });
    assert.deepEqual(decryptedBlobCheck, plaintext);

    const shareManifestPayload: ShareManifestPayloadV2 = {
      v: 1,
      shareId,
      title: 'Interop Shared Collection',
      createdAt: 1760000000000,
      items: [
        {
          blobId,
          wrappedFk: toBase64Url(
            await wrapFileKeyForShare(shareKey, new Uint8Array(32).fill(0x33), shareId, blobId)
          ),
          encMeta: toBase64Url(encMetaBytes),
        },
      ],
    };
    const shareManifestB64 = await encryptShareManifest(shareManifestPayload, shareKey, shareId);
    const shareManifestBytes = fromBase64Url(shareManifestB64);

    // Catalogo Album cifrato (`albums.bin`)
    const albumCatalogPayload: AlbumCatalogPlaintext = {
      v: 1,
      revision: 1,
      updatedAt: 1760000005000,
      albums: [
        {
          id: 'alb-interop-1',
          name: 'Interop Album 2026',
          blobIds: [blobId],
          coverBlobId: blobId,
          createdAt: 1760000000000,
        },
      ],
    };
    const albumsBinBytes = await encryptAlbums(subkeys.metaKey, userId, albumCatalogPayload, 1);
    const decAlbumCheck = await decryptAlbums(subkeys.metaKey, userId, albumsBinBytes);
    assert.equal(decAlbumCheck.catalog.albums[0].name, 'Interop Album 2026');

    fs.writeFileSync(path.join(interopDir, 'blob.pczk'), pczkBlob);
    fs.writeFileSync(path.join(interopDir, 'encMeta.bin'), encMetaBytes);
    fs.writeFileSync(path.join(interopDir, 'wrappedVk.bin'), wrappedVk);
    fs.writeFileSync(path.join(interopDir, 'shareManifest.bin'), shareManifestBytes);
    fs.writeFileSync(path.join(interopDir, 'albums.bin'), albumsBinBytes);

    const manifestJson = {
      version: 1,
      description: 'PhotoCloud Zero-Knowledge v2 Web-Android Interop Fixtures',
      userId,
      blobId,
      shareId,
      passphrase,
      kdfParams: TEST_FLOOR_KDF_PARAMS,
      accountKeyHex: toHex(accountKey),
      userSaltHex: toHex(userSalt),
      rootHex: toHex(root),
      kekHex: toHex(kek),
      authSecretHex: toHex(authSecret),
      vaultKeyHex: toHex(vaultKey),
      shareKeyHex: toHex(shareKey),
      plaintextUtf8: new TextDecoder().decode(plaintext),
      ciphertextSha256Hex: blobResult.ciphertextSha256Hex,
      dedupTagHex: blobResult.dedupTagHex ?? null,
      headerChunkSizeLog2: header.chunkSizeLog2,
      expectedMetaName: 'interop_photo_2026.jpg',
      files: {
        blob: 'blob.pczk',
        encMeta: 'encMeta.bin',
        wrappedVk: 'wrappedVk.bin',
        shareManifest: 'shareManifest.bin',
        albums: 'albums.bin',
      },
    };
    fs.writeFileSync(path.join(interopDir, 'manifest.json'), JSON.stringify(manifestJson, null, 2) + '\n');

    // Verifica round-trip immediata delle fixture scritte su disco
    const diskWrappedVk = new Uint8Array(fs.readFileSync(path.join(interopDir, 'wrappedVk.bin')));
    const unwrappedVk = await unwrapVaultKey(kek, diskWrappedVk, userId);
    assert.deepEqual(unwrappedVk, vaultKey);

    const diskEncMeta = new Uint8Array(fs.readFileSync(path.join(interopDir, 'encMeta.bin')));
    const decMeta = await decryptMeta<BlobPlaintextMeta>(subkeys.metaKey, blobId, diskEncMeta);
    assert.equal(decMeta.name, 'interop_photo_2026.jpg');

    const diskShareManifestB64 = toBase64Url(
      new Uint8Array(fs.readFileSync(path.join(interopDir, 'shareManifest.bin')))
    );
    const decManifest = await decryptShareManifest(diskShareManifestB64, shareKey, shareId);
    assert.equal(decManifest.title, 'Interop Shared Collection');

    const diskBlob = new Uint8Array(fs.readFileSync(path.join(interopDir, 'blob.pczk')));
    const rangePlain = await decryptBlobRange({
      headerBytes: diskBlob.subarray(0, 86),
      totalCiphertextBytes: diskBlob.byteLength,
      startPlaintextByte: 0,
      endPlaintextByteInclusive: 19,
      fkWrapKey: subkeys.fkWrapKey,
      expectedBlobId: blobId,
      ciphertextSlice: diskBlob.subarray(86),
    });
    assert.equal(new TextDecoder().decode(rangePlain), 'PhotoCloud Zero-Know');

    // Verifica manomissione 1 byte nel tag GCM di decryptBlobRange -> AUTH_TAG_MISMATCH
    const tamperedChunk = new Uint8Array(diskBlob.subarray(86));
    tamperedChunk[tamperedChunk.byteLength - 1] ^= 0xff;
    await assert.rejects(
      () =>
        decryptBlobRange({
          headerBytes: diskBlob.subarray(0, 86),
          totalCiphertextBytes: diskBlob.byteLength,
          startPlaintextByte: 0,
          endPlaintextByteInclusive: 19,
          fkWrapKey: subkeys.fkWrapKey,
          expectedBlobId: blobId,
          ciphertextSlice: tamperedChunk,
        }),
      (err: unknown) => err instanceof ZkCryptoError && err.code === ZkErrorCode.AUTH_TAG_MISMATCH
    );

    const builtUrl = buildShareUrl('https://photocloud.local', shareId, shareKey);
    assert.equal(builtUrl.includes('?'), false);
    assert.equal(builtUrl.includes(`#${toBase64Url(shareKey)}`), true);
  });

  it('9. Reverse Interop (Kotlin -> TypeScript): decifra artifact reali generati da testDebugUnitTest (PENDING se assenti in locale)', async (t) => {
    const ktInteropDir = process.env.INTEROP_KOTLIN_DIR
      ? path.resolve(process.env.INTEROP_KOTLIN_DIR)
      : path.resolve(process.cwd(), 'android-app', 'app', 'build', 'interop-kotlin');
    const manifestPath = path.join(ktInteropDir, 'manifest.json');
    const requireArtifacts = process.env.REQUIRE_KOTLIN_ARTIFACTS === '1';

    if (!fs.existsSync(manifestPath)) {
      const msg = `PENDING: artifact Kotlin -> TypeScript assenti in ${ktInteropDir} (eseguire 'cd android-app && gradle testDebugUnitTest').`;
      if (requireArtifacts) {
        assert.fail(msg);
      }
      t.skip(msg);
      return;
    }

    const ktManifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8')) as {
      userId: string;
      blobId: string;
      passphrase: string;
      kdfParams: Argon2idParams;
      accountKeyHex: string;
      userSaltHex: string;
      vaultKeyHex: string;
      plaintextUtf8: string;
      expectedMetaName: string;
    };
    const ktRoot = await deriveRoot({
      accountKey: fromHex(ktManifest.accountKeyHex),
      userSalt: fromHex(ktManifest.userSaltHex),
      passphrase: ktManifest.passphrase,
      argon2Params: ktManifest.kdfParams,
    });
    const { kek: ktKek } = await deriveKekAndAuthSecret(ktRoot);
    const ktWrappedVk = new Uint8Array(fs.readFileSync(path.join(ktInteropDir, 'wrappedVk.bin')));
    const ktVk = await unwrapVaultKey(ktKek, ktWrappedVk, ktManifest.userId);
    assert.equal(toHex(ktVk), ktManifest.vaultKeyHex);

    const ktSubkeys = await deriveSubkeys(ktVk);
    const ktBlob = new Uint8Array(fs.readFileSync(path.join(ktInteropDir, 'blob.pczk')));
    const { plaintext: ktDecPlain } = await decryptBlobToBytes(ktBlob, {
      fkWrapKey: ktSubkeys.fkWrapKey,
      expectedBlobId: ktManifest.blobId,
    });
    assert.equal(new TextDecoder().decode(ktDecPlain), ktManifest.plaintextUtf8);

    const ktEncMeta = new Uint8Array(fs.readFileSync(path.join(ktInteropDir, 'encMeta.bin')));
    const ktMeta = await decryptMeta<BlobPlaintextMeta>(
      ktSubkeys.metaKey,
      ktManifest.blobId,
      ktEncMeta
    );
    assert.equal(ktMeta.name, ktManifest.expectedMetaName);
  });

  it('10. Upload & File Picker Auto-Lock Guard: la sessione resta sbloccata durante selezione file e upload e si riblocca dopo inattività reale', async () => {
    let autoLockCount = 0;
    const client = new ZkVaultClient({
      baseUrl,
      autoLockTimeoutMs: 60,
      onAutoLock: () => {
        autoLockCount += 1;
      },
    });
    const prep = client.prepareRegistration('upload_guard_user', '', TEST_FLOOR_KDF_PARAMS);
    await client.register(prep, '', undefined, {
      inviteToken: 'test-invite-token-phase3',
      skipRecoveryConfirmation: true,
    });
    assert.equal(client.isUnlocked(), true);

    // 1. Apertura selettore file (transient external activity): non deve scattare auto-lock
    client.beginTransientExternalActivity(1500);
    await new Promise((r) => setTimeout(r, 120));
    assert.equal(client.isUnlocked(), true, 'Il vault deve restare sbloccato mentre il selettore file è aperto');
    assert.equal(autoLockCount, 0);

    // 2. Chiusura selettore + upload file: resta sbloccato durante e subito dopo l'upload
    client.endTransientExternalActivity();
    const payload = new TextEncoder().encode('PhotoCloud Upload Guard Payload v1.5.2');
    const up = await client.uploadFile({
      name: 'guard-test.txt',
      mimeType: 'text/plain',
      size: payload.byteLength,
      source: payload,
    });
    assert.ok(up.itemId, 'Upload deve completarsi con itemId valido');
    assert.equal(client.isUnlocked(), true, 'Il vault deve restare sbloccato dopo il caricamento file');

    // 3. Dopo la fine dell'upload e il superamento del timeout di inattività reale, auto-lock si riattiva
    await new Promise((r) => setTimeout(r, 130));
    assert.equal(client.isUnlocked(), false, 'Dopo inattività reale post-upload il vault deve bloccarsi');
    assert.equal(autoLockCount, 1);
  });

  it('11. Download & Streaming ZIP Export Auto-Lock Guard: il vault non si blocca durante download o export ZIP in corso', async () => {
    let autoLockCount = 0;
    const delayedFetch: typeof fetch = async (input, init) => {
      const url = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url;
      if (url.includes('/api/v2/blobs/') && (!init?.method || init.method.toUpperCase() === 'GET')) {
        await new Promise((r) => setTimeout(r, 90));
      }
      return globalThis.fetch(input, init);
    };

    const client = new ZkVaultClient({
      baseUrl,
      fetchFn: delayedFetch,
      autoLockTimeoutMs: 55,
      onAutoLock: () => {
        autoLockCount += 1;
      },
    });
    const prep = client.prepareRegistration('download_guard_user', '', TEST_FLOOR_KDF_PARAMS);
    await client.register(prep, '', undefined, {
      inviteToken: 'test-invite-token-phase3',
      skipRecoveryConfirmation: true,
    });

    const payload = new TextEncoder().encode('PhotoCloud Download & ZIP Auto-Lock Guard v1.5.3');
    const up = await client.uploadFile({
      name: 'dl-guard.txt',
      mimeType: 'text/plain',
      size: payload.byteLength,
      source: payload,
    });
    assert.ok(up.itemId);
    await client.syncItems('active');

    // Download lento (> autoLockTimeoutMs): il vault deve restare sbloccato!
    const decrypted = await client.downloadBlobToBytes(up.blobId);
    assert.deepEqual(decrypted, payload);
    assert.equal(client.isUnlocked(), true);
    assert.equal(autoLockCount, 0);

    // Export ZIP streaming lento (> autoLockTimeoutMs): il vault resta sbloccato fino al termine
    const zipStream = client.exportZipStream([up.itemId!]);
    const reader = zipStream.getReader();
    let totalZipBytes = 0;
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      if (value) totalZipBytes += value.byteLength;
    }
    assert.ok(totalZipBytes > payload.byteLength);
    assert.equal(client.isUnlocked(), true);
    assert.equal(autoLockCount, 0);

    // Dopo la fine dei trasferimenti, l'inattività reale riblocca il vault
    await new Promise((r) => setTimeout(r, 120));
    assert.equal(client.isUnlocked(), false);
    assert.equal(autoLockCount, 1);
  });
});
