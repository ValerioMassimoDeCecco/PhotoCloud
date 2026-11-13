import test from 'node:test';
import assert from 'node:assert/strict';
import { Jimp } from 'jimp';
import {
  computePHashHex,
  dctPHashFromGrayPixels,
  groupSimilarByHash,
  hammingDistanceHex,
  hexToPHash,
  isPHashSupportedFilename,
  pHashToHex,
} from './phash';

// Genera un'immagine 64x64: metà sinistra nera, metà destra bianca (pattern verticale)
async function makeSplitImage(swap = false): Promise<Buffer> {
  const img = new Jimp({ width: 64, height: 64, color: 0x000000ff });
  for (let y = 0; y < 64; y++) {
    for (let x = 0; x < 64; x++) {
      const right = swap ? x < 32 : x >= 32;
      img.setPixelColor(right ? 0xffffffff : 0x000000ff, x, y);
    }
  }
  return Buffer.from(await img.getBuffer('image/png'));
}

// Righe orizzontali alternate (pattern completamente diverso dal verticale)
async function makeStripesImage(): Promise<Buffer> {
  const img = new Jimp({ width: 64, height: 64, color: 0x000000ff });
  for (let y = 0; y < 64; y++) {
    for (let x = 0; x < 64; x++) {
      img.setPixelColor(y % 2 === 0 ? 0xffffffff : 0x000000ff, x, y);
    }
  }
  return Buffer.from(await img.getBuffer('image/png'));
}

test('pHash: isPHashSupportedFilename filtra le estensioni giuste', () => {
  assert.ok(isPHashSupportedFilename('foto.jpg'));
  assert.ok(isPHashSupportedFilename('foto.PNG'));
  assert.ok(isPHashSupportedFilename('scan.png'));
  assert.ok(!isPHashSupportedFilename('video.mp4'));
  assert.ok(!isPHashSupportedFilename('doc.pdf'));
});

test('pHash: hex <-> bigint roundtrip e distanza di Hamming nota', () => {
  assert.equal(hexToPHash('ff'), 255n);
  assert.equal(pHashToHex(255n), '00000000000000ff');
  assert.equal(hammingDistanceHex('0000000000000000', 'ffffffffffffffff'), 64);
  assert.equal(hammingDistanceHex('0000000000000000', '000000000000000f'), 4);
  assert.equal(hammingDistanceHex('abcdef01abcdef01', 'abcdef01abcdef01'), 0);
});

test('pHash: dctPHashFromGrayPixels produce hash stabili e deterministici', () => {
  const uniform = new Uint8Array(32 * 32).fill(128);
  const h1 = dctPHashFromGrayPixels(uniform);
  const h2 = dctPHashFromGrayPixels(uniform);
  assert.equal(h1, h2);

  // Gradienti diversi devono produrre hash diversi
  const gradient = new Uint8Array(32 * 32);
  for (let y = 0; y < 32; y++) for (let x = 0; x < 32; x++) gradient[y * 32 + x] = x * 8;
  const h3 = dctPHashFromGrayPixels(gradient);
  assert.notEqual(h1, h3);
});

test('pHash: immagini simili hanno distanza piccola, immagini diverse distanza grande', async () => {
  const a = await makeSplitImage(false);
  const aCopy = await makeSplitImage(false); // identica
  const b = await makeStripesImage(); // molto diversa

  const hashA = await computePHashHex(a);
  const hashACopy = await computePHashHex(aCopy);
  const hashB = await computePHashHex(b);

  assert.equal(hammingDistanceHex(hashA, hashACopy), 0, 'immagini identiche devono avere distanza 0');
  const dist = hammingDistanceHex(hashA, hashB);
  assert.ok(dist >= 20, `pattern diverso atteso distanza >= 20, trovata ${dist}`);
});

test('pHash: groupSimilarByHash unisce solo le immagini simili (union-find)', async () => {
  const a = await computePHashHex(await makeSplitImage(false));
  const b = a; // seconda copia identica
  const c = await computePHashHex(await makeStripesImage());

  const groups = groupSimilarByHash(
    [
      { filename: 'same1.png', phash: a },
      { filename: 'same2.png', phash: b },
      { filename: 'different.png', phash: c },
    ],
    8
  );

  assert.equal(groups.length, 1);
  const names = groups[0].map((g) => g.filename).sort();
  assert.deepEqual(names, ['same1.png', 'same2.png']);
});

test('pHash: catena transitiva A≈B e B≈C nello stesso gruppo', () => {
  // A→B distanza 2, B→C distanza 2: devono finire insieme per union-find
  const [b0, b1, b2] = ['0000000000000000', '0000000000000003', '000000000000000f'];
  const groups = groupSimilarByHash(
    [
      { filename: 'a', phash: b0 },
      { filename: 'b', phash: b1 },
      { filename: 'c', phash: b2 },
    ],
    2
  );
  assert.equal(groups.length, 1);
  assert.equal(groups[0].length, 3);
});
