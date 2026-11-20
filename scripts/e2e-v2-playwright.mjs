import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

async function loadPlaywright() {
  try {
    return await import('playwright');
  } catch {
    const globalFallback = '/usr/local/share/bun-global/node_modules/playwright/index.mjs';
    if (fs.existsSync(globalFallback)) {
      return await import(globalFallback);
    }
    throw new Error('Playwright module not found (run npm install --no-save playwright or use CI).');
  }
}

const { chromium } = await loadPlaywright();

const BASE_URL = process.env.E2E_BASE_URL;
const SETUP_TOKEN = process.env.E2E_SETUP_TOKEN;
const FIXTURES_DIR = process.env.E2E_FIXTURES_DIR;
const ARTIFACTS_DIR = path.resolve(process.env.E2E_ARTIFACTS_DIR || '.playwright-e2e-artifacts');

if (!BASE_URL || !SETUP_TOKEN || !FIXTURES_DIR) {
  console.error(
    'Missing required env vars: E2E_BASE_URL, E2E_SETUP_TOKEN, E2E_FIXTURES_DIR must all be set.'
  );
  process.exit(2);
}

fs.mkdirSync(ARTIFACTS_DIR, { recursive: true });

async function readStreamToBuffer(stream) {
  const chunks = [];
  for await (const chunk of stream) {
    chunks.push(Buffer.from(chunk));
  }
  return Buffer.concat(chunks);
}

async function run() {
  const launchOptions = { headless: true };
  if (process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH) {
    launchOptions.executablePath = process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH;
  } else {
    const defaultExec = chromium.executablePath();
    if (!fs.existsSync(defaultExec)) {
      const headlessShell = '/ms-playwright/chrome-headless-shell-linux64/chrome-headless-shell';
      if (fs.existsSync(headlessShell)) {
        launchOptions.executablePath = headlessShell;
      }
    }
  }
  const browser = await chromium.launch(launchOptions);
  const ownerContext = await browser.newContext({ acceptDownloads: true });
  const anonContext = await browser.newContext({ acceptDownloads: true });

  await ownerContext.tracing.start({ screenshots: true, snapshots: true, sources: true });
  await anonContext.tracing.start({ screenshots: true, snapshots: true, sources: true });

  const ownerPage = await ownerContext.newPage();
  const anonPage = await anonContext.newPage();
  const consoleErrors = [];

  ownerPage.on('pageerror', (err) => consoleErrors.push(`owner pageerror: ${err.message}`));
  anonPage.on('pageerror', (err) => consoleErrors.push(`anon pageerror: ${err.message}`));

  const passphrase = 'Correct-Horse-Battery-Staple-99!';
  const username = 'alice_e2e';
  const savedKeyfilePath = path.join(ARTIFACTS_DIR, 'downloaded-keyfile.json');

  try {
    // -----------------------------------------------------------------------
    // Flow 1: Register (Argon2id passphrase mode) + auto keyfile download + Recovery Code
    // -----------------------------------------------------------------------
    console.log('[E2E Flow 1] Registration & Keyfile download...');
    await ownerPage.goto(`${BASE_URL}/v2`, { waitUntil: 'networkidle' });
    await ownerPage.locator('#tab-register').click();

    // Switch to custom passphrase mode (Argon2id 64 MiB) before filling inputs
    await ownerPage.locator('#reg-mode-passphrase').click();
    await ownerPage.locator('#reg-passphrase-input').waitFor({ state: 'visible', timeout: 5000 });

    await ownerPage.locator('#reg-username-input').fill(username);
    await ownerPage.locator('#reg-passphrase-input').fill(passphrase);
    const setupTokenInput = ownerPage.locator('#reg-setup-token-input');
    if ((await setupTokenInput.count()) > 0) {
      await setupTokenInput.fill(SETUP_TOKEN);
    }

    const [keyfileDownload] = await Promise.all([
      ownerPage.waitForEvent('download', { timeout: 25000 }),
      ownerPage.locator('#btn-reg-submit').click(),
    ]);

    await ownerPage
      .locator('#e2ee-status-badge', { hasText: `E2EE · ${username}` })
      .waitFor({ timeout: 25000 });

    await keyfileDownload.saveAs(savedKeyfilePath);
    const keyfileRaw = fs.readFileSync(savedKeyfilePath, 'utf8');
    assert.equal(keyfileRaw.includes(passphrase), false, 'Passphrase must NEVER appear in keyfile');
    const parsedKeyfile = JSON.parse(keyfileRaw);
    assert.equal(parsedKeyfile.username, username);
    assert.equal(parsedKeyfile.formatVersion, 2);
    assert.equal(parsedKeyfile.hasPassphrase, true);
    assert.ok(typeof parsedKeyfile.accountKey === 'string' && parsedKeyfile.accountKey.length >= 43);
    assert.ok(parsedKeyfile.kdfParams?.memoryKiB >= 65536);

    // Verify Recovery Code is available in the Security view
    await ownerPage.locator('#nav-security').click();
    const recoveryCode = (await ownerPage.locator('#security-recovery-code').textContent())?.trim() ?? '';
    assert.ok(recoveryCode.length >= 64, 'Expected valid Recovery Code hex in Security view');
    await ownerPage.locator('#nav-gallery').click();

    // -----------------------------------------------------------------------
    // Flow 2: Logout (RAM zeroization) & Login via Keyfile + Passphrase
    // -----------------------------------------------------------------------
    console.log('[E2E Flow 2] Logout & Keyfile Login...');
    await ownerPage.locator('#btn-logout').click();
    await ownerPage
      .locator('#e2ee-status-badge', { hasText: 'Zero-Knowledge E2EE' })
      .waitFor({ timeout: 5000 });

    await ownerPage.locator('#login-keyfile-input').setInputFiles(savedKeyfilePath);
    await ownerPage
      .locator('#login-keyfile-status', { hasText: `Account: ${username}` })
      .waitFor({ timeout: 5000 });
    await ownerPage.locator('#login-passphrase-input').fill(passphrase);
    await ownerPage.locator('#btn-login-submit').click();
    await ownerPage
      .locator('#e2ee-status-badge', { hasText: `E2EE · ${username}` })
      .waitFor({ timeout: 25000 });

    // Ensure Service Worker controls /v2/ before playing video stream
    await ownerPage.evaluate(async () => {
      if ('serviceWorker' in navigator) {
        await navigator.serviceWorker.ready;
      }
    });
    const hasController = await ownerPage.evaluate(() => Boolean(navigator.serviceWorker?.controller));
    if (!hasController) {
      await ownerPage.reload({ waitUntil: 'networkidle' });
      // Re-unlock vault after reload so session & SW controller are both active
      await ownerPage.locator('#login-keyfile-input').setInputFiles(savedKeyfilePath);
      await ownerPage
        .locator('#login-keyfile-status', { hasText: `Account: ${username}` })
        .waitFor({ timeout: 5000 });
      await ownerPage.locator('#login-passphrase-input').fill(passphrase);
      await ownerPage.locator('#btn-login-submit').click();
      await ownerPage
        .locator('#e2ee-status-badge', { hasText: `E2EE · ${username}` })
        .waitFor({ timeout: 25000 });
    }

    // -----------------------------------------------------------------------
    // Flow 3: Encrypted E2EE upload of Photo, Video, DOCX, PDF
    // -----------------------------------------------------------------------
    console.log('[E2E Flow 3] Uploading 4 E2EE fixtures...');
    await ownerPage.locator('#vault-upload-input').setInputFiles([
      path.join(FIXTURES_DIR, 'photo_e2e.png'),
      path.join(FIXTURES_DIR, 'video_e2e.mp4'),
      path.join(FIXTURES_DIR, 'contratto.docx'),
      path.join(FIXTURES_DIR, 'rapporto.pdf'),
    ]);
    await ownerPage
      .locator('#stats-active-count', { hasText: 'Attivi: 4' })
      .waitFor({ timeout: 20000 });

    // -----------------------------------------------------------------------
    // Flow 4: Video Streaming via Service Worker Range + Cache-Control: no-store
    // -----------------------------------------------------------------------
    console.log('[E2E Flow 4] Verifying Service Worker Range streaming & zero plaintext cache...');
    await ownerPage.locator('[data-item-name="video_e2e.mp4"]').click();
    const videoEl = ownerPage.locator('#lightbox-video-player');
    await videoEl.waitFor({ timeout: 10000 });
    const streamMode = await videoEl.getAttribute('data-stream-mode');
    assert.equal(streamMode, 'sw-range', `Expected SW range streaming, got ${streamMode}`);
    const videoSrc = await videoEl.getAttribute('src');
    assert.ok(videoSrc && videoSrc.startsWith('/v2/__stream/'), `Unexpected videoSrc: ${videoSrc}`);

    const rangeResult = await ownerPage.evaluate(async (src) => {
      const r1 = await fetch(src, { headers: { Range: 'bytes=10-59' } });
      const b1 = Array.from(new Uint8Array(await r1.arrayBuffer()));
      const r2 = await fetch(src, { headers: { Range: 'bytes=0-9' } });
      const b2 = Array.from(new Uint8Array(await r2.arrayBuffer()));
      const cacheKeys = await caches.keys();
      return {
        s1: r1.status,
        cr1: r1.headers.get('content-range'),
        cc1: r1.headers.get('cache-control'),
        b1,
        s2: r2.status,
        cr2: r2.headers.get('content-range'),
        cc2: r2.headers.get('cache-control'),
        b2,
        cacheKeys,
      };
    }, videoSrc);

    assert.equal(rangeResult.s1, 206);
    assert.equal(rangeResult.cr1, 'bytes 10-59/256');
    assert.equal(rangeResult.cc1, 'no-store');
    assert.equal(rangeResult.b1.length, 50);
    assert.equal(rangeResult.b1[0], (10 * 37 + 11) & 0xff);
    assert.equal(rangeResult.b1[49], (59 * 37 + 11) & 0xff);
    assert.equal(rangeResult.s2, 206);
    assert.equal(rangeResult.cr2, 'bytes 0-9/256');
    assert.equal(rangeResult.cc2, 'no-store');
    assert.equal(rangeResult.cacheKeys.length, 0, 'Service Worker must never use Cache API for plaintext');

    await ownerPage.screenshot({ path: path.join(ARTIFACTS_DIR, 'flow4-video-sw-range.png') });
    await ownerPage.locator('#btn-lightbox-close').click();

    // -----------------------------------------------------------------------
    // Flow 5 & 6: Photo Editor E2EE (Overwrite v2 + Save Copy) & ZIP Export
    // -----------------------------------------------------------------------
    console.log('[E2E Flow 5 & 6] Photo Editor E2EE + Encrypted Streaming ZIP export...');
    await ownerPage.locator('[data-item-name="photo_e2e.png"]').click();
    await ownerPage.locator('#lightbox-decrypted-image').waitFor({ timeout: 8000 });
    await ownerPage.locator('#btn-lightbox-edit').click();
    await ownerPage.locator('#editor-preview-canvas').waitFor({ state: 'visible', timeout: 10000 });
    await ownerPage.locator('#editor-tab-transform').click();
    await ownerPage.locator('#btn-editor-rotate-right').click();
    await ownerPage.locator('#btn-editor-save-overwrite').click();
    await ownerPage
      .locator('#lightbox-modal .exif-meta-bar', { hasText: 'v2' })
      .waitFor({ timeout: 15000 });

    await ownerPage.locator('#btn-lightbox-edit').click();
    await ownerPage.locator('#editor-preview-canvas').waitFor({ state: 'visible', timeout: 10000 });
    await ownerPage.locator('#btn-editor-save-copy').click();
    await ownerPage
      .locator('#stats-active-count', { hasText: 'Attivi: 5' })
      .waitFor({ timeout: 15000 });

    const [zipDownload] = await Promise.all([
      ownerPage.waitForEvent('download'),
      ownerPage.locator('#btn-export-zip').click(),
    ]);
    const zipBuffer = await readStreamToBuffer(await zipDownload.createReadStream());
    assert.ok(zipBuffer.byteLength > 100, 'Expected non-empty exported ZIP');
    assert.equal(zipBuffer.subarray(0, 4).toString('hex'), '504b0304', 'Expected valid PKZIP magic');

    // -----------------------------------------------------------------------
    // Flow 7: Trash -> Restore -> Trash -> Permanent Delete
    // -----------------------------------------------------------------------
    console.log('[E2E Flow 7] Trash, Restore & Permanent Delete...');
    await ownerPage.locator('[data-item-name="photo_e2e_modificata.png"]').click();
    await ownerPage.locator('#btn-lightbox-trash').click();
    await ownerPage
      .locator('#stats-trashed-count', { hasText: 'Cestino: 1' })
      .waitFor({ timeout: 8000 });

    await ownerPage.locator('#nav-trash').click();
    await ownerPage.locator('[data-item-name="photo_e2e_modificata.png"]').click();
    await ownerPage.locator('#btn-lightbox-restore').click();
    await ownerPage
      .locator('#stats-trashed-count', { hasText: 'Cestino: 0' })
      .waitFor({ timeout: 8000 });

    await ownerPage.locator('#nav-gallery').click();
    await ownerPage.locator('[data-item-name="photo_e2e_modificata.png"]').click();
    await ownerPage.locator('#btn-lightbox-trash').click();
    await ownerPage.locator('#nav-trash').click();
    await ownerPage.locator('[data-item-name="photo_e2e_modificata.png"]').click();
    await ownerPage.locator('#btn-lightbox-delete-permanent').click();
    await ownerPage.locator('#vault-empty-state').waitFor({ timeout: 8000 });
    await ownerPage.locator('#nav-gallery').click();
    await ownerPage
      .locator('#stats-active-count', { hasText: 'Attivi: 4' })
      .waitFor({ timeout: 8000 });

    // -----------------------------------------------------------------------
    // Flow 8: DOCX & PDF Document Preview + Zero External Network Requests
    // -----------------------------------------------------------------------
    console.log('[E2E Flow 8] DOCX & PDF Client-Side Decrypted Preview...');
    await ownerPage.locator('[data-item-name="contratto.docx"]').click();
    const docxPre = ownerPage.locator('#lightbox-doc-preview[data-doc-kind="office"]');
    await docxPre.waitFor({ timeout: 8000 });
    const docxText = await docxPre.textContent();
    assert.ok(docxText && docxText.includes('Contratto E2EE riservato'));
    await ownerPage.locator('#btn-lightbox-close').click();

    await ownerPage.locator('[data-item-name="rapporto.pdf"]').click();
    const pdfPre = ownerPage.locator('#lightbox-doc-preview[data-doc-kind="pdf"]');
    await pdfPre.waitFor({ timeout: 8000 });
    const pdfText = await pdfPre.textContent();
    assert.ok(pdfText && pdfText.includes('Rapporto Finanziario Zero Knowledge'));
    await ownerPage.locator('#btn-lightbox-close').click();

    const externalResources = await ownerPage.evaluate(() =>
      performance
        .getEntriesByType('resource')
        .map((r) => r.name)
        .filter((u) => !u.startsWith('http://127.0.0.1:') && !u.startsWith('blob:') && !u.startsWith('data:'))
    );
    assert.equal(externalResources.length, 0, `Unexpected external resources: ${externalResources}`);

    // -----------------------------------------------------------------------
    // Flow 9: Zero-Knowledge Share (#fragment) in Clean Context, Password & Revoke
    // -----------------------------------------------------------------------
    console.log('[E2E Flow 9] Zero-Cookie Public Share (#fragment), Argon2id Password & Revocation...');
    await ownerPage.locator('[data-item-name="photo_e2e.png"]').click();
    await ownerPage.locator('#btn-lightbox-share').click();
    await ownerPage.locator('#create-share-modal').waitFor({ state: 'visible', timeout: 8000 });
    await ownerPage.locator('#btn-share-modal-submit').click();
    await ownerPage.locator('#share-modal-url-display').waitFor({ state: 'visible', timeout: 15000 });
    const shareUrlNoPw = (await ownerPage.locator('#share-modal-url-display').textContent())?.trim() ?? '';
    assert.ok(shareUrlNoPw.includes('/v2/share/') && shareUrlNoPw.includes('#') && !shareUrlNoPw.includes('?'));
    await ownerPage.locator('#btn-share-modal-close').click();
    await ownerPage.locator('#create-share-modal').waitFor({ state: 'hidden', timeout: 8000 });

    await ownerPage.locator('[data-item-name="photo_e2e.png"]').click();
    await ownerPage.locator('#btn-lightbox-share').click();
    await ownerPage.locator('#create-share-modal').waitFor({ state: 'visible', timeout: 8000 });
    await ownerPage.locator('#share-modal-password').fill('SharePass-2026!');
    await ownerPage.locator('#btn-share-modal-submit').click();
    await ownerPage.locator('#share-modal-url-display').waitFor({ state: 'visible', timeout: 25000 });
    const shareUrlWithPw = (await ownerPage.locator('#share-modal-url-display').textContent())?.trim() ?? '';
    assert.ok(shareUrlWithPw.includes('/v2/share/') && shareUrlWithPw.includes('#'));
    assert.notEqual(shareUrlWithPw, shareUrlNoPw);
    await ownerPage.locator('#btn-share-modal-close').click();
    await ownerPage.locator('#create-share-modal').waitFor({ state: 'hidden', timeout: 8000 });

    // Anonymous zero-cookie context opens Share without password
    await anonPage.goto(shareUrlNoPw, { waitUntil: 'networkidle' });
    await anonPage.locator('#shared-items-list').waitFor({ timeout: 15000 });
    const hashAfter = await anonPage.evaluate(() => window.location.hash);
    assert.equal(hashAfter, '', 'Client must immediately strip #shareKey via history.replaceState');
    const anonCookies = await anonContext.cookies();
    assert.equal(anonCookies.length, 0, 'Anonymous share page must remain cookie-free');

    const [sharedDownload] = await Promise.all([
      anonPage.waitForEvent('download'),
      anonPage.locator('.btn-download-shared-item').click(),
    ]);
    const sharedBuf = await readStreamToBuffer(await sharedDownload.createReadStream());
    assert.ok(sharedBuf.byteLength > 0, 'Decrypted shared file must be non-empty');
    assert.equal(sharedBuf.subarray(0, 8).toString('hex'), '89504e470d0a1a0a', 'Expected PNG signature');

    // Anonymous context opens Password-protected share
    await anonPage.goto(shareUrlWithPw, { waitUntil: 'networkidle' });
    await anonPage.locator('#share-unlock-password-input').waitFor({ timeout: 10000 });
    await anonPage.locator('#share-unlock-password-input').fill('SharePass-2026!');
    await anonPage.locator('#btn-share-unlock-password').click();
    await anonPage.locator('#shared-items-list').waitFor({ timeout: 25000 });
    await anonPage.screenshot({ path: path.join(ARTIFACTS_DIR, 'flow9-share-unlocked.png') });

    // Owner revokes last share -> Anon gets 404 (open in fresh page so URL isn't treated as same-doc hash navigation)
    await ownerPage.locator('#btn-revoke-last-share').click();
    await ownerPage.locator('#last-share-banner').waitFor({ state: 'hidden', timeout: 10000 });
    const revokedPage = await anonContext.newPage();
    await revokedPage.goto(shareUrlWithPw, { waitUntil: 'networkidle' });
    const errBannerText = await revokedPage.locator('#share-error-banner').textContent({ timeout: 10000 });
    assert.ok(errBannerText && /404|revocato/i.test(errBannerText));

    await ownerPage.screenshot({ path: path.join(ARTIFACTS_DIR, 'flow9-final-owner.png') });
    await revokedPage.screenshot({ path: path.join(ARTIFACTS_DIR, 'flow9-revoked-404.png') });

    assert.equal(consoleErrors.length, 0, `Uncaught page errors: ${consoleErrors.join('; ')}`);
    console.log('[OK] All PhotoCloud v2 Playwright E2E Flows (1..9) passed cleanly.');
  } catch (err) {
    console.error('[FAIL] Playwright E2E failed:', err);
    try {
      await ownerPage.screenshot({ path: path.join(ARTIFACTS_DIR, 'failure-owner.png') });
      await anonPage.screenshot({ path: path.join(ARTIFACTS_DIR, 'failure-anon.png') });
    } catch {
      // ignore screenshot error on closed page
    }
    throw err;
  } finally {
    await ownerContext.tracing.stop({ path: path.join(ARTIFACTS_DIR, 'trace-owner.zip') }).catch(() => {});
    await anonContext.tracing.stop({ path: path.join(ARTIFACTS_DIR, 'trace-anon.zip') }).catch(() => {});
    await browser.close();
  }
}

run().catch(() => process.exit(1));
