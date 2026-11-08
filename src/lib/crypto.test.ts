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
  compileSignedAndroidApk,
  triggerGitHubActionsBuild,
} from './githubReleasePublisher';

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

test('encryptFile and decryptFile round-trip binary media data accurately', () => {
  const key = generateApiKey(32);
  const original = Buffer.from('Immagine JPEG cifrata di test 1234567890', 'utf-8');
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

test('Original templates (login.html, gallery.html, trash.html) render faithfully', () => {
  const loginHtml = renderLoginTemplate();
  assert.ok(loginHtml.includes('Il tuo archivio foto/video sicuro'));
  assert.ok(loginHtml.includes('/static/styles/login.css'));

  const galleryHtml = renderGalleryTemplate([
    { filename: 'abc12345.jpg', timestamp: 1700000000, size: 1024 },
  ]);
  assert.ok(galleryHtml.includes('Il tuo archivio'));
  assert.ok(galleryHtml.includes('1 elementi'));
  assert.ok(galleryHtml.includes('/media/abc12345.jpg'));

  const trashHtml = renderTrashTemplate([]);
  assert.ok(trashHtml.includes('Il cestino è vuoto'));
});

test('GitHub Actions workflow (.github/workflows/android-release.yml) and Android project are configured', async () => {
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

  const outDir = path.resolve(process.cwd(), 'release');
  const res = await compileSignedAndroidApk(outDir);
  assert.ok(fs.existsSync(res.apkPath));
  assert.equal(res.sha256.length, 64);

  const actionsStatus = await triggerGitHubActionsBuild();
  assert.equal(actionsStatus.repo, 'ValerioMassimoDeCecco/PhotoCloud');
  assert.equal(actionsStatus.workflowFile, '.github/workflows/android-release.yml');
});
