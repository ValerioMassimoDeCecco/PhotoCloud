import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { describe, it } from 'node:test';
import express from 'express';
import {
  ZkVaultClient,
  decryptOwnerShareMeta,
  encryptOwnerShareMeta,
} from '../client/zk-sdk/index.ts';
import {
  clusterGeoItems,
  computeInitialMapViewport,
  formatCoordinates,
  isValidGpsCoord,
  latLonToWorldPixel,
  worldPixelToLatLon,
  type GeoPointItem,
} from './gpsMapClustering.ts';
import { createZkV2Router } from './zkServerV2.ts';
import { deriveSubkeys, toBase64Url } from './zk/index.ts';

interface EphemeralV2Server {
  baseUrl: string;
  tmpRoot: string;
  setupToken: string | null;
  close: () => Promise<void>;
}

async function startServer(opts?: {
  registrationEnabled?: boolean | 'open' | 'setup_token_or_invite' | 'first_user_only';
  registrationInviteToken?: string;
}): Promise<EphemeralV2Server> {
  const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'photocloud-v2-features-'));
  const vaultV2Dir = path.join(tmpRoot, 'vault_v2');
  const tempUploadDir = path.join(tmpRoot, 'temp_uploads');
  let setupToken: string | null = null;

  const app = express();
  app.use(express.json({ limit: '25mb' }));

  const zkV2 = createZkV2Router({
    vaultV2Dir,
    tempUploadDir,
    serverSecret: crypto.randomBytes(32),
    loginRateLimitMax: 500,
    shareRateLimitMaxPerIp: 500,
    shareRateLimitMaxPerShare: 500,
    registrationEnabled: opts?.registrationEnabled ?? 'open',
    registrationInviteToken: opts?.registrationInviteToken,
    onSetupTokenGenerated: (tok) => {
      setupToken = tok;
    },
  });

  app.use('/api/v2', zkV2.router);

  const httpServer = http.createServer(app);
  await new Promise<void>((resolve) => {
    httpServer.listen(0, '127.0.0.1', () => resolve());
  });
  const addr = httpServer.address();
  if (!addr || typeof addr === 'string') {
    throw new Error('Failed to bind ephemeral port');
  }
  return {
    baseUrl: `http://127.0.0.1:${addr.port}`,
    tmpRoot,
    get setupToken() {
      return setupToken;
    },
    close: async () => {
      httpServer.closeAllConnections();
      await new Promise<void>((resolve, reject) => {
        httpServer.close((err) => (err ? reject(err) : resolve()));
      });
      zkV2.close();
      fs.rmSync(tmpRoot, { recursive: true, force: true });
    },
  };
}

/**
 * Node fetch cookie-jar wrapper for ZkVaultClient so HttpOnly session cookies work in Node tests.
 */
function createCookieFetch(): typeof fetch {
  const cookies = new Map<string, string>();
  return async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const headers = new Headers(init?.headers || {});
    if (cookies.size > 0 && !headers.has('cookie')) {
      const cookieHeader = Array.from(cookies.entries())
        .map(([k, v]) => `${k}=${v}`)
        .join('; ');
      headers.set('cookie', cookieHeader);
    }
    const res = await fetch(input, { ...init, headers });
    const setCookies =
      typeof res.headers.getSetCookie === 'function'
        ? res.headers.getSetCookie()
        : res.headers.get('set-cookie')
          ? [res.headers.get('set-cookie')!]
          : [];
    for (const sc of setCookies) {
      const pair = sc.split(';', 1)[0];
      const eq = pair.indexOf('=');
      if (eq > 0) {
        const k = pair.slice(0, eq).trim();
        const v = pair.slice(eq + 1).trim();
        if (v === '' || /Max-Age=0/i.test(sc)) {
          cookies.delete(k);
        } else {
          cookies.set(k, v);
        }
      }
    }
    return res;
  };
}

describe('Zero-Knowledge V2 Features — Auth Config, V1-Simple UX, Shares, Editor Replace & GPS Map', () => {
  it('GET /api/v2/auth/config accurately reflects open, setup_token_or_invite, and disabled policies', async () => {
    const openSrv = await startServer({ registrationEnabled: 'open' });
    try {
      const r = await fetch(`${openSrv.baseUrl}/api/v2/auth/config`);
      assert.equal(r.status, 200);
      const data = await r.json();
      assert.equal(data.registrationOpen, true);
      assert.equal(data.policy, 'open');
      assert.equal(data.requiresInviteToken, false);
    } finally {
      await openSrv.close();
    }

    const inviteSrv = await startServer({
      registrationEnabled: 'setup_token_or_invite',
      registrationInviteToken: 'secret-invite-123',
    });
    try {
      const r = await fetch(`${inviteSrv.baseUrl}/api/v2/auth/config`);
      assert.equal(r.status, 200);
      const data = await r.json();
      assert.equal(data.registrationOpen, true);
      assert.equal(data.policy, 'setup_token_or_invite');
      assert.equal(data.requiresInviteToken, true);
    } finally {
      await inviteSrv.close();
    }

    const disabledSrv = await startServer({ registrationEnabled: false });
    try {
      const r = await fetch(`${disabledSrv.baseUrl}/api/v2/auth/config`);
      assert.equal(r.status, 200);
      const data = await r.json();
      assert.equal(data.registrationOpen, false);
      assert.equal(data.policy, 'disabled');
    } finally {
      await disabledSrv.close();
    }
  });

  it('V1-simple Zero-Knowledge registration (hasPassphrase: false), instant 1-click keyfile login, and passphrase add/remove rewrap', async () => {
    const srv = await startServer({ registrationEnabled: 'open' });
    try {
      const client = new ZkVaultClient({
        baseUrl: srv.baseUrl,
        fetchFn: createCookieFetch(),
      });

      // Register directly without passphrase and without setupToken (open self-hosted policy)
      const prepared = client.prepareRegistration('simple_alice', '');
      assert.equal(prepared.hasPassphrase, false);
      assert.ok(prepared.recoveryCode.length >= 64);

      const reg = await client.register(prepared, '', undefined, {
        skipRecoveryConfirmation: true,
      });

      assert.equal(reg.keyFile.username, 'simple_alice');
      assert.equal(reg.keyFile.hasPassphrase, false);
      assert.ok(reg.keyFile.accountKey.length >= 43);
      assert.equal(client.isUnlocked(), true);

      // Logout and re-login with ONLY the keyfile (empty passphrase -> instant HKDF, 0 Argon2id)
      await client.logout();
      assert.equal(client.isUnlocked(), false);

      const t0 = Date.now();
      const loginRes = await client.login(reg.keyFile, '');
      const elapsedMs = Date.now() - t0;
      assert.equal(loginRes.username, 'simple_alice');
      assert.equal(client.isUnlocked(), true);
      assert.ok(elapsedMs < 3000, `Expected fast keyfile-only login, took ${elapsedMs}ms`);

      // Add a passphrase via changePassphrase (rewrap without re-encrypting blobs)
      const upgradedKeyFile = await client.changePassphrase('', 'correct-horse-battery-staple-99');
      assert.equal(upgradedKeyFile.hasPassphrase, true);
      await client.logout();

      // Now login without passphrase must fail, and with new passphrase must succeed
      await assert.rejects(
        () => client.login({ ...upgradedKeyFile, hasPassphrase: false }, ''),
        /Credenziali/
      );
      const reLogin = await client.login(upgradedKeyFile, 'correct-horse-battery-staple-99');
      assert.equal(reLogin.username, 'simple_alice');

      // Remove passphrase via empty newPassphrase
      const simplifiedKeyFile = await client.changePassphrase('correct-horse-battery-staple-99', '');
      assert.equal(simplifiedKeyFile.hasPassphrase, false);
      await client.logout();

      const backToSimple = await client.login(simplifiedKeyFile, '');
      assert.equal(backToSimple.username, 'simple_alice');
    } finally {
      await srv.close();
    }
  });

  it('Owner share management (GET /api/v2/shares, encrypted encShareMeta, multi-user isolation, and zero leak on public GET)', async () => {
    const srv = await startServer({ registrationEnabled: 'open' });
    try {
      const alice = new ZkVaultClient({
        baseUrl: srv.baseUrl,
        fetchFn: createCookieFetch(),
      });
      const prepAlice = alice.prepareRegistration('share_alice', '');
      await alice.register(prepAlice, '', undefined, { skipRecoveryConfirmation: true });

      const bob = new ZkVaultClient({
        baseUrl: srv.baseUrl,
        fetchFn: createCookieFetch(),
      });
      const prepBob = bob.prepareRegistration('share_bob', '');
      await bob.register(prepBob, '', undefined, { skipRecoveryConfirmation: true });

      // Upload a test photo as Alice
      const samplePhoto = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3, 4, 5, 6, 7, 8]);
      const uploaded = await alice.uploadFile({
        name: 'tramonto-costiera.jpg',
        mimeType: 'image/jpeg',
        size: samplePhoto.byteLength,
        source: samplePhoto,
        takenAt: Date.now(),
      });
      assert.ok(uploaded.itemId);

      // Create an E2EE share with owner-encrypted metadata
      const createdShare = await alice.createShare(
        {
          itemIds: [uploaded.itemId],
          title: 'Vacanze Costiera 2026',
          expiresAt: Date.now() + 3600_000,
          maxDownloads: 5,
        },
        srv.baseUrl
      );
      assert.ok(createdShare.shareId);
      assert.ok(createdShare.shareUrl.includes(`/v2/share/${createdShare.shareId}#`));

      // Alice lists her shares and decrypts encShareMeta in RAM
      const aliceShares = await alice.listOwnerShares(srv.baseUrl);
      assert.equal(aliceShares.length, 1);
      assert.equal(aliceShares[0].shareId, createdShare.shareId);
      assert.equal(aliceShares[0].title, 'Vacanze Costiera 2026');
      assert.equal(aliceShares[0].itemCount, 1);
      assert.equal(aliceShares[0].maxDownloads, 5);
      assert.equal(aliceShares[0].downloadCount, 0);
      assert.equal(aliceShares[0].shareUrl, createdShare.shareUrl);
      assert.equal(aliceShares[0].status, 'active');

      // Bob sees zero shares and cannot revoke Alice's share
      const bobShares = await bob.listOwnerShares(srv.baseUrl);
      assert.equal(bobShares.length, 0);
      await assert.rejects(() => bob.revokeShare(createdShare.shareId));

      // CRITICAL SECURITY INVARIANT: Public GET /api/v2/shares/:shareId MUST NEVER expose encShareMeta
      const pubRes = await fetch(`${srv.baseUrl}/api/v2/shares/${createdShare.shareId}`);
      assert.equal(pubRes.status, 200);
      const pubBody = await pubRes.json();
      assert.equal('encShareMeta' in pubBody, false, 'Public share response must NEVER leak encShareMeta');
      assert.equal(pubBody.maxDownloads, 5);
      assert.equal(pubBody.downloadsCount, 0);

      // Verify AAD binding on encryptOwnerShareMeta / decryptOwnerShareMeta directly
      const fakeVk = crypto.randomBytes(32);
      const { metaKey } = await deriveSubkeys(fakeVk);
      const enc = await encryptOwnerShareMeta(metaKey, 'share-aaa', {
        v: 1,
        title: 'Segreto',
        itemCount: 2,
        shareKeyB64u: toBase64Url(crypto.randomBytes(32)),
        hasPassword: false,
      });
      const dec = await decryptOwnerShareMeta(metaKey, 'share-aaa', enc);
      assert.equal(dec.title, 'Segreto');
      await assert.rejects(
        () => decryptOwnerShareMeta(metaKey, 'share-bbb', enc),
        'Wrong shareId AAD must fail GCM tag verification'
      );

      // Alice revokes the share -> public GET returns 410/404 and owner list removes it
      await alice.revokeShare(createdShare.shareId);
      const pubAfter = await fetch(`${srv.baseUrl}/api/v2/shares/${createdShare.shareId}`);
      assert.ok(pubAfter.status === 410 || pubAfter.status === 404);
      const aliceAfter = await alice.listOwnerShares(srv.baseUrl);
      assert.equal(aliceAfter.length, 0);
    } finally {
      await srv.close();
    }
  });

  it('replaceItemWithEditedBlob updates blob, regenerates encrypted thumbs, increments version, and rejects stale expectedVersion (409)', async () => {
    const srv = await startServer({ registrationEnabled: 'open' });
    try {
      const client = new ZkVaultClient({
        baseUrl: srv.baseUrl,
        fetchFn: createCookieFetch(),
      });
      const prep = client.prepareRegistration('editor_alice', '');
      await client.register(prep, '', undefined, { skipRecoveryConfirmation: true });

      const originalBytes = new Uint8Array(256).fill(0x11);
      const uploaded = await client.uploadFile({
        name: 'portrait.jpg',
        mimeType: 'image/jpeg',
        size: originalBytes.byteLength,
        source: originalBytes,
        takenAt: Date.now(),
        width: 800,
        height: 600,
      });
      assert.ok(uploaded.itemId);
      const syncedItems = await client.syncItems('active');
      const initialItem = syncedItems.find((x) => x.id === uploaded.itemId);
      assert.ok(initialItem);
      assert.equal(initialItem.version, 1);

      const editedBytes = new Uint8Array(320).fill(0x42);
      const thumb320 = new Uint8Array(48).fill(0x22);
      const thumb1280 = new Uint8Array(64).fill(0x33);

      const replaced = await client.replaceItemWithEditedBlob(
        initialItem.id,
        editedBytes,
        {
          width: 600,
          height: 800,
        },
        1,
        {
          thumb320,
          thumb1280,
        }
      );

      assert.equal(replaced.id, initialItem.id);
      assert.equal(replaced.version, 2);
      assert.notEqual(replaced.blobId, initialItem.blobId);
      assert.equal(replaced.meta.width, 600);
      assert.equal(replaced.meta.height, 800);

      // Download and decrypt replaced blob + thumbs to verify byte-exact content
      const decryptedBlob = await client.downloadBlobToBytes(replaced.blobId);
      assert.deepEqual(decryptedBlob, editedBytes);
      const decThumb320 = await client.downloadThumbnail(replaced.blobId, 320);
      assert.deepEqual(decThumb320, thumb320);
      const decThumb1280 = await client.downloadThumbnail(replaced.blobId, 1280);
      assert.deepEqual(decThumb1280, thumb1280);

      // Stale expectedVersion (still passing version=1) must fail with 409 Conflict / VERSION_MISMATCH
      await assert.rejects(
        () =>
          client.replaceItemWithEditedBlob(
            initialItem.id,
            new Uint8Array(128).fill(0x99),
            {},
            1
          ),
        /VERSION_MISMATCH|409|conflict/i
      );
    } finally {
      await srv.close();
    }
  });

  it('gpsMapClustering pure math: Web Mercator roundtrip, invalid coord filtering, clustering, and viewport fit', () => {
    assert.equal(isValidGpsCoord(41.9028, 12.4964), true);
    assert.equal(isValidGpsCoord(0, 0), false); // null island excluded
    assert.equal(isValidGpsCoord(95, 12), false);
    assert.equal(isValidGpsCoord(NaN, 12), false);

    // Web Mercator roundtrip precision (< 1e-6 deg)
    const pt = latLonToWorldPixel(45.4642, 9.19, 10);
    const back = worldPixelToLatLon(pt.x, pt.y, 10);
    assert.ok(Math.abs(back.lat - 45.4642) < 1e-6);
    assert.ok(Math.abs(back.lon - 9.19) < 1e-6);
    assert.equal(formatCoordinates(45.4642, 9.19), '45.4642° N · 9.1900° E');

    const points: GeoPointItem<string>[] = [
      { id: '1', lat: 41.9028, lon: 12.4964, takenAt: 1000, payload: 'Roma 1' },
      { id: '2', lat: 41.9032, lon: 12.497, takenAt: 2000, payload: 'Roma 2' },
      { id: '3', lat: 45.4642, lon: 9.19, takenAt: 3000, payload: 'Milano' },
      { id: '4', lat: 0, lon: 0, takenAt: 4000, payload: 'Invalid' },
    ];

    // Low zoom merges nearby Rome points into 1 cluster while keeping Milan separate
    const lowZoomClusters = clusterGeoItems(points, 5, 64);
    assert.equal(lowZoomClusters.length, 2);
    const romeCluster = lowZoomClusters.find((c) => c.count === 2);
    assert.ok(romeCluster, 'Nearby Rome points should cluster together at zoom 5');
    assert.equal(romeCluster.representative.id, '2'); // most recent takenAt

    // High zoom splits all 3 valid points into 3 distinct clusters
    const highZoomClusters = clusterGeoItems(points, 17, 48);
    assert.equal(highZoomClusters.length, 3);

    // Viewport fit centers between Rome and Milan with sensible zoom
    const fit = computeInitialMapViewport(points, 800, 600);
    assert.ok(fit.lat > 42 && fit.lat < 45);
    assert.ok(fit.lon > 9.5 && fit.lon < 12.2);
    assert.ok(fit.zoom >= 4 && fit.zoom <= 12);
  });
});
