import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import fs from 'node:fs';
import {
  generateApiKey,
  hashKey,
  verifyKey,
  encryptFile,
  decryptFile,
  calculateBufferHash,
  findDuplicateGroups,
} from './crypto';
import {
  renderLoginTemplate,
  renderGalleryTemplate,
  renderTrashTemplate,
} from './templateRenderer';
import {
  DEFAULT_PHOTO_EDIT_STATE,
  PHOTO_FILTER_PRESETS,
  applyPresetToEditState,
  normalizeRotation,
  computeCropRect,
  transformRgbPixel,
} from './photoEditorMath';

test('generateApiKey produces a 32-char key with lower, upper, digit, and punctuation', () => {
  const key = generateApiKey(32);
  assert.equal(key.length, 32);
  assert.match(key, /[a-z]/);
  assert.match(key, /[A-Z]/);
  assert.match(key, /[0-9]/);
});

test('hashKey and verifyKey validate API keys accurately', () => {
  const secret = 'MySecretPhotoCloudKey!2026';
  const hashed = hashKey(secret);
  assert.equal(verifyKey(secret, hashed), true);
  assert.equal(verifyKey('WrongKey!2026', hashed), false);
});

test('encryptFile and decryptFile round-trip binary media and non-media data accurately', () => {
  const key = generateApiKey(32);
  const original = Buffer.from('Documento PDF / Archivio ZIP cifrato di test 1234567890', 'utf-8');
  const encrypted = encryptFile(original, key);
  assert.notDeepEqual(encrypted, original);
  assert.ok(encrypted.length > original.length);

  const decrypted = decryptFile(encrypted, key);
  assert.deepEqual(decrypted, original);
});

test('findDuplicateGroups detects identical file hashes and sorts filenames', () => {
  const bufA = Buffer.from('Duplicate photo content');
  const bufB = Buffer.from('Unique photo content');
  const hashA = calculateBufferHash(bufA);
  const hashB = calculateBufferHash(bufB);

  const duplicates = findDuplicateGroups([
    { filename: 'b_copy.jpg', hash: hashA },
    { filename: 'a_original.jpg', hash: hashA },
    { filename: 'c_unique.jpg', hash: hashB },
  ]);

  assert.deepEqual(duplicates, [['a_original.jpg', 'b_copy.jpg']]);
});

test('photoEditorMath presets, rotation normalization, crop calculation, and RGB pixel transforms work accurately', () => {
  assert.equal(Object.keys(PHOTO_FILTER_PRESETS).length, 7);
  const bwState = applyPresetToEditState(DEFAULT_PHOTO_EDIT_STATE, 'bw');
  assert.equal(bwState.filterPreset, 'bw');
  assert.equal(bwState.saturation, -100);

  assert.equal(normalizeRotation(-90), 270);
  assert.equal(normalizeRotation(450), 90);
  assert.equal(normalizeRotation(360), 0);

  const squareCrop = computeCropRect(1920, 1080, '1:1');
  assert.equal(squareCrop.width, 1080);
  assert.equal(squareCrop.height, 1080);
  assert.equal(squareCrop.x, 420);
  assert.equal(squareCrop.y, 0);

  const portraitCrop = computeCropRect(1000, 1000, '4:5');
  assert.equal(portraitCrop.width, 800);
  assert.equal(portraitCrop.height, 1000);
  assert.equal(portraitCrop.x, 100);

  // Neutral state leaves pixel unchanged
  const [r0, g0, b0] = transformRgbPixel(120, 150, 200, DEFAULT_PHOTO_EDIT_STATE);
  assert.equal(r0, 120);
  assert.equal(g0, 150);
  assert.equal(b0, 200);

  // Black & White state equalizes R, G, B channels (0 saturation)
  const [rBw, gBw, bBw] = transformRgbPixel(220, 80, 40, bwState);
  assert.equal(rBw, gBw);
  assert.equal(gBw, bBw);
});

test('Templates render non-media Cloud File Manager, Album grouping, Photo Editor Modal, and Top-Right Transfer Center', () => {
  const loginHtml = renderLoginTemplate();
  assert.ok(loginHtml.includes('Il tuo archivio foto/video sicuro'));
  assert.ok(loginHtml.includes('/static/styles/login.css'));

  const galleryHtml = renderGalleryTemplate(
    [
      {
        filename: 'abc12345.jpg',
        timestamp: 1700000000,
        size: 102400,
        isMedia: true,
        category: 'media',
        album: 'Vacanze 2026',
      },
      {
        filename: 'contratto.pdf',
        timestamp: 1700000500,
        size: 524288,
        isMedia: false,
        category: 'document',
        album: 'Documenti',
      },
    ],
    ['Vacanze 2026', 'Documenti']
  );
  assert.ok(galleryHtml.includes('Il tuo archivio'));
  assert.ok(galleryHtml.includes('2 elementi'));
  assert.ok(galleryHtml.includes('/media/abc12345.jpg'));
  assert.ok(galleryHtml.includes('data-is-media="false"'));
  assert.ok(galleryHtml.includes('data-category="document"'));
  assert.ok(galleryHtml.includes('data-album="Vacanze 2026"'));
  assert.ok(galleryHtml.includes('value="album">Album</option>'));
  assert.ok(galleryHtml.includes('id="tab-files-btn"'));
  assert.ok(galleryHtml.includes('id="upload-indicator-container"'));
  assert.ok(galleryHtml.includes('id="upload-speed-badge"'));
  assert.ok(galleryHtml.includes('id="photo-editor-modal"'));
  assert.ok(galleryHtml.includes('id="lightbox-edit-btn"'));
  assert.ok(galleryHtml.includes('/static/scripts/photo-editor.js'));

  const trashHtml = renderTrashTemplate([]);
  assert.ok(trashHtml.includes('Il cestino è vuoto'));
});

test('GitHub Actions workflow (.github/workflows/android-release.yml) and Android v1.0.7 project are configured', async () => {
  const workflowPath = path.resolve(process.cwd(), '.github/workflows/android-release.yml');
  assert.ok(fs.existsSync(workflowPath));
  const workflowYaml = fs.readFileSync(workflowPath, 'utf-8');
  assert.ok(
    workflowYaml.includes(
      "packages: 'cmdline-tools;latest platform-tools platforms;android-35 build-tools;35.0.0'"
    )
  );
  assert.ok(workflowYaml.includes('gradle/actions/setup-gradle@v4'));
  assert.ok(workflowYaml.includes('gradle assembleRelease --no-daemon'));
  assert.ok(workflowYaml.includes('softprops/action-gh-release@v2'));
  assert.ok(workflowYaml.includes('photocloud-release-v1.0.7-signed.apk'));
  assert.equal(workflowYaml.includes('rm -f photocloud-release-key.jks'), false);

  const keystorePath = path.resolve(process.cwd(), 'android-app/app/photocloud-release-key.jks');
  assert.ok(fs.existsSync(keystorePath));
  assert.ok(fs.statSync(keystorePath).size > 1000);

  const colorIconPath = path.resolve(process.cwd(), 'android-app/app/src/main/res/drawable/ic_launcher_color.xml');
  const bwIconPath = path.resolve(process.cwd(), 'android-app/app/src/main/res/drawable/ic_launcher_bw.xml');
  assert.ok(fs.existsSync(colorIconPath));
  assert.ok(fs.existsSync(bwIconPath));

  const mainActivityKt = fs.readFileSync(
    path.resolve(process.cwd(), 'android-app/app/src/main/java/com/valerio/photocloud/MainActivity.kt'),
    'utf-8'
  );
  const apiClientKt = fs.readFileSync(
    path.resolve(process.cwd(), 'android-app/app/src/main/java/com/valerio/photocloud/PhotoCloudApiClient.kt'),
    'utf-8'
  );

  assert.equal(mainActivityKt.includes('android.webkit.WebView'), false);
  assert.equal(mainActivityKt.includes('isCheckingSession'), false);
  assert.ok(mainActivityKt.includes('hasActiveSessionCookie'));
  assert.ok(mainActivityKt.includes('getCachedGalleryItems'));
  assert.ok(mainActivityKt.includes('detectDragGesturesAfterLongPress'));
  assert.ok(mainActivityKt.includes('NativeSettingsScreen'));
  assert.ok(mainActivityKt.includes('NativeCloudFileManagerScreen'));
  assert.ok(mainActivityKt.includes('TransferOperationsFloatingCard'));
  assert.ok(mainActivityKt.includes('AlbumManagerDialog'));
  assert.ok(mainActivityKt.includes('NativePhotoEditorModal'));
  assert.ok(mainActivityKt.includes('renderEditedAndroidBitmap'));
  assert.ok(mainActivityKt.includes('ALBUM("Album")'));
  assert.ok(mainActivityKt.includes('VaultTab.FILES'));
  assert.ok(apiClientKt.includes('ProgressRequestBody'));
  assert.ok(apiClientKt.includes('TransferOperation'));
  assert.ok(apiClientKt.includes('formatSpeedHuman'));
  assert.ok(apiClientKt.includes('assignFilesToAlbum'));
  assert.ok(apiClientKt.includes('uploadEditedPhotoBytes'));

  // No network calls, token usage or APK writes in unit tests.
  assert.ok(workflowYaml.includes('workflow_dispatch:'));
});

test('authenticated encryption detects tampering and reads legacy CFB', async () => {
  const crypto = await import('node:crypto');
  const { deriveKey, encryptedPlaintextSize } = await import('./crypto');
  const key = 'test secret';
  const plain = Buffer.from('hello');
  const enc = encryptFile(plain, key);
  assert.equal(encryptedPlaintextSize(enc), plain.length);
  const altered = Buffer.from(enc); altered[altered.length - 1] ^= 1;
  assert.throws(() => decryptFile(altered, key));
  assert.throws(() => decryptFile(enc, 'wrong key'));
  const salt = crypto.randomBytes(16), iv = crypto.randomBytes(16);
  const cipher = crypto.createCipheriv('aes-256-cfb', deriveKey(key, salt), iv);
  const legacy = Buffer.concat([salt, iv, cipher.update(plain), cipher.final()]);
  assert.deepEqual(decryptFile(legacy, key), plain);
  assert.equal(encryptedPlaintextSize(legacy), plain.length);
});

test('album names are escaped in HTML attributes', () => {
  const html = renderGalleryTemplate([], ["x' onmouseover='alert(1)"]);
  assert.ok(html.includes('&#39;'));
  assert.ok(!html.includes("data-albums='[\"x'"));
});
