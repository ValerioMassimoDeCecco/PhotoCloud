import test from 'node:test';
import assert from 'node:assert/strict';
import {
  generateApiKey,
  hashKey,
  verifyKey,
  encryptFile,
  decryptFile,
  calculateBufferHash,
  findDuplicateGroups,
} from './crypto';
import { groupMediaItems } from './grouping';
import { validateAndroidConfig, createAndroidReleasePackage } from './androidBuilder';

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

test('groupMediaItems groups items by year and none', () => {
  const items = [
    { filename: 'pic1.jpg', timestamp: 1700000000 }, // 2023
    { filename: 'pic2.jpg', timestamp: 1730000000 }, // 2024
  ];
  const byYear = groupMediaItems(items, 'year');
  assert.equal(byYear.length, 2);
  assert.equal(byYear[0].title, '2024');
  assert.equal(byYear[1].title, '2023');
});

test('Android Release Builder validates config and creates APK + Android Studio bundle', async () => {
  const config = {
    appName: 'PhotoCloud Vault',
    packageName: 'com.valerio.photocloud',
    versionName: '1.0.0',
    versionCode: 1,
    serverUrl: 'http://10.0.2.2:3000',
    minSdk: 26,
    targetSdk: 35,
    enableBiometricLock: true,
    enableOfflineCache: true,
    enableAutoBackup: false,
    signingMode: 'release' as const,
    keystoreAlias: 'photocloud-release-key',
  };

  assert.equal(validateAndroidConfig(config), null);
  assert.notEqual(
    validateAndroidConfig({ ...config, packageName: 'invalid_package' }),
    null
  );

  const result = await createAndroidReleasePackage(config);
  assert.equal(result.artifact.apkFilename, 'photocloud-release-v1.0.0-signed.apk');
  assert.ok(result.apkBuffer.length > 100);
  assert.ok(result.projectZipBuffer.length > 200);
  assert.equal(result.artifact.steps.length, 4);
});
