import test from 'node:test';
import assert from 'node:assert/strict';
import {
  parseExifFromJpeg,
  parseExifDateTimeMs,
  isExifParseableFilename,
  emptyExifMetadata,
} from './exif';

// ---------------------------------------------------------------------------
// Costruttore di JPEG EXIF sintetici (solo APP1/TIFF, senza compressione reale)
// ---------------------------------------------------------------------------

interface Entry {
  tag: number;
  type: number; // 2 ASCII, 3 SHORT, 4 LONG, 5 RATIONAL
  values?: number[][]; // RATIONAL: coppie [num, den]
  ascii?: string;
  inlineNum?: number; // SHORT/LONG inline
}

function le16(v: number): Buffer {
  const b = Buffer.allocUnsafe(2);
  b.writeUInt16LE(v);
  return b;
}
function le32(v: number): Buffer {
  const b = Buffer.allocUnsafe(4);
  b.writeUInt32LE(v);
  return b;
}
function be16(v: number): Buffer {
  const b = Buffer.allocUnsafe(2);
  b.writeUInt16BE(v);
  return b;
}
function be32(v: number): Buffer {
  const b = Buffer.allocUnsafe(4);
  b.writeUInt32BE(v);
  return b;
}

interface Ifd {
  entries: Entry[];
}

function buildExifJpeg(littleEndian: boolean, withGps = true): Buffer {
  // IFD0: Make, Model, ExifIFD ptr, [GPS ptr]
  const exifIfd: Ifd = {
    entries: [
      { tag: 0x829a, type: 5, values: [[1, 125]] }, // ExposureTime 1/125
      { tag: 0x829d, type: 5, values: [[28, 10]] }, // FNumber 2.8
      { tag: 0x8827, type: 3, inlineNum: 200 }, // ISO 200
      { tag: 0x9003, type: 2, ascii: '2023:08:15T14:22:10'.replace('T', ' ') }, // DateTimeOriginal
      { tag: 0x920a, type: 5, values: [[50, 1]] }, // FocalLength 50mm
    ],
  };
  const gpsIfd: Ifd = {
    entries: [
      { tag: 0x0001, type: 2, ascii: 'N' },
      { tag: 0x0002, type: 5, values: [[41, 1], [53, 1], [36, 1]] }, // 41.893333° N
      { tag: 0x0003, type: 2, ascii: 'E' },
      { tag: 0x0004, type: 5, values: [[12, 1], [29, 1], [33, 1]] }, // 12.492500° E
      { tag: 0x0005, type: 1, inlineNum: 0 },
      { tag: 0x0006, type: 5, values: [[52, 1]] }, // Altitudine 52 m
    ],
  };
  // Per calcolare gli offset: IFD0 = 8; poi blob; poi ExifIFD; poi eventuali blob; poi GpsIFD
  // Costruiamo dichiarando entry ptr come LONG con offset fittizi, calcolati in seguito.
  const ifd0entryCount = withGps ? 4 : 3;
  const ifd0Size = 2 + ifd0entryCount * 12 + 4;
  // blob IFD0: Make "Canon", Model "Canon EOS R6"
  const make = Buffer.from('Canon', 'latin1');
  const model = Buffer.from('Canon EOS R6', 'latin1');
  let cursor = 8 + ifd0Size;
  const makeOff = cursor;
  cursor += make.length;
  const modelOff = cursor;
  cursor += model.length;
  const exifIfdOffset = cursor;
  const exifIfdSize = 2 + exifIfd.entries.length * 12 + 4;
  // blob ExifIFD: exposure(8) fnumber(8) dtof ascii(20) focal(8)
  let ecursor = exifIfdOffset + exifIfdSize;
  const expOff = ecursor;
  ecursor += 8;
  const fnumOff = ecursor;
  ecursor += 8;
  const dtoAscii = Buffer.from('2023:08:15 14:22:10', 'latin1');
  const dtoOff = ecursor;
  ecursor += dtoAscii.length;
  const focalOff = ecursor;
  ecursor += 8;
  const gpsIfdOffset = withGps ? ecursor : 0;
  const gpsIfdSize = withGps ? 2 + gpsIfd.entries.length * 12 + 4 : 0;
  let gcursor = gpsIfdOffset + gpsIfdSize;
  const latOff = gcursor;
  gcursor += 24;
  const lonOff = gcursor;
  gcursor += 24;
  const altOff = gcursor;
  gcursor += 8;

  const w16 = littleEndian ? le16 : be16;
  const w32 = littleEndian ? le32 : be32;
  function entry(tag: number, type: number, count: number, valueOrOffset: number): Buffer {
    const b = Buffer.alloc(12);
    const w2 = w16(tag);
    const w2b = w16(type);
    const w4 = w32(count);
    const w4b = w32(valueOrOffset);
    w2.copy(b, 0);
    w2b.copy(b, 2);
    w4.copy(b, 4);
    w4b.copy(b, 8);
    return b;
  }
  function rational(num: number, den: number): Buffer {
    return Buffer.concat([w32(num), w32(den)]);
  }
  function shortInline(tag: number, v: number): Buffer {
    const b = Buffer.alloc(12);
    w16(tag).copy(b, 0);
    w16(3).copy(b, 2);
    w32(1).copy(b, 4);
    w16(v).copy(b, 8);
    return b;
  }
  function asciiInline(tag: number, s: string): Buffer {
    const b = Buffer.alloc(12);
    w16(tag).copy(b, 0);
    w16(2).copy(b, 2);
    w32(s.length + 1).copy(b, 4);
    Buffer.from(s + '', 'latin1').copy(b, 8);
    return b;
  }

  const parts: Buffer[] = [];
  parts.push(Buffer.from(littleEndian ? 'II' : 'MM', 'latin1'));
  parts.push(w16(42));
  parts.push(w32(8));
  // IFD0
  parts.push(w16(ifd0entryCount));
  parts.push(entry(0x010f, 2, make.length, makeOff));
  parts.push(entry(0x0110, 2, model.length, modelOff));
  parts.push(entry(0x8769, 4, 1, exifIfdOffset));
  if (withGps) parts.push(entry(0x8825, 4, 1, gpsIfdOffset));
  parts.push(w32(0));
  parts.push(make);
  parts.push(model);
  // ExifIFD
  parts.push(w16(exifIfd.entries.length));
  parts.push(entry(0x829a, 5, 1, expOff));
  parts.push(entry(0x829d, 5, 1, fnumOff));
  parts.push(shortInline(0x8827, 200));
  parts.push(entry(0x9003, 2, dtoAscii.length, dtoOff));
  parts.push(entry(0x920a, 5, 1, focalOff));
  parts.push(w32(0));
  parts.push(rational(1, 125));
  parts.push(rational(28, 10));
  parts.push(dtoAscii);
  parts.push(rational(50, 1));
  if (withGps) {
    parts.push(w16(gpsIfd.entries.length));
    parts.push(asciiInline(0x0001, 'N'));
    parts.push(entry(0x0002, 5, 3, latOff));
    parts.push(asciiInline(0x0003, 'E'));
    parts.push(entry(0x0004, 5, 3, lonOff));
    // AltRef BYTE inline
    const altRef = Buffer.alloc(12);
    w16(0x0005).copy(altRef, 0);
    w16(1).copy(altRef, 2);
    w32(1).copy(altRef, 4);
    altRef[8] = 0;
    parts.push(altRef);
    parts.push(entry(0x0006, 5, 1, altOff));
    parts.push(w32(0));
    parts.push(Buffer.concat([rational(41, 1), rational(53, 1), rational(36, 1)]));
    parts.push(Buffer.concat([rational(12, 1), rational(29, 1), rational(33, 1)]));
    parts.push(rational(52, 1));
  }
  const tiff = Buffer.concat(parts);

  const app1Payload = Buffer.concat([Buffer.from('Exif\0\0', 'latin1'), tiff]);
  const app1 = Buffer.concat([Buffer.from([0xff, 0xe1]), be16(app1Payload.length + 2), app1Payload]);
  // JPEG minimale: SOI + APP1 + un finto segmento SOS per terminare
  const sos = Buffer.from([0xff, 0xda, 0x00, 0x08, 0x01, 0x01, 0x00, 0x00, 0x3f, 0x00]);
  return Buffer.concat([Buffer.from([0xff, 0xd8]), app1, sos]);
}

// ---------------------------------------------------------------------------

test('EXIF: estrazione completa da JPEG little-endian (fotocamera, data, apertura, ISO, GPS)', () => {
  const jpeg = buildExifJpeg(true, true);
  const exif = parseExifFromJpeg(jpeg);
  assert.equal(exif.make, 'Canon');
  assert.equal(exif.model, 'Canon EOS R6');
  assert.equal(exif.camera, 'Canon EOS R6');
  assert.equal(exif.dateTimeOriginal, '2023:08:15 14:22:10');
  assert.equal(exif.dateTimeOriginalMs, Date.UTC(2023, 7, 15, 14, 22, 10));
  assert.equal(exif.apertureFNumber, 2.8);
  assert.equal(exif.iso, 200);
  assert.equal(exif.exposureTimeLabel, '1/125');
  assert.ok(Math.abs((exif.exposureTimeSec || 0) - 0.008) < 0.0001);
  assert.equal(exif.focalLengthMm, 50);
  assert.equal(exif.hasGps, true);
  assert.ok(exif.latitude !== null && Math.abs(exif.latitude - 41.893333) < 0.00001, `lat=${exif.latitude}`);
  assert.ok(exif.longitude !== null && Math.abs(exif.longitude - 12.4925) < 0.00001, `lon=${exif.longitude}`);
  assert.equal(exif.altitudeM, 52);
});

test('EXIF: big-endian (MM) viene letto correttamente', () => {
  const jpeg = buildExifJpeg(false, true);
  const exif = parseExifFromJpeg(jpeg);
  assert.equal(exif.make, 'Canon');
  assert.equal(exif.iso, 200);
  assert.equal(exif.apertureFNumber, 2.8);
  assert.equal(exif.hasGps, true);
  assert.ok(exif.latitude !== null && Math.abs(exif.latitude - 41.893333) < 0.00001);
  assert.ok(exif.longitude !== null && Math.abs(exif.longitude - 12.4925) < 0.00001);
});

test('EXIF: JPEG senza GPS ha hasGps=false ma conserva gli altri metadati', () => {
  const jpeg = buildExifJpeg(true, false);
  const exif = parseExifFromJpeg(jpeg);
  assert.equal(exif.camera, 'Canon EOS R6');
  assert.equal(exif.dateTimeOriginal, '2023:08:15 14:22:10');
  assert.equal(exif.hasGps, false);
  assert.equal(exif.latitude, null);
  assert.equal(exif.longitude, null);
  assert.equal(exif.altitudeM, null);
});

test('EXIF: buffer corrotti o non-JPEG non lanciano e ritornano metadati vuoti', () => {
  const empty = emptyExifMetadata();
  assert.deepEqual(parseExifFromJpeg(Buffer.from('this is not a jpeg')), empty);
  assert.deepEqual(parseExifFromJpeg(Buffer.from([0xff, 0xd8])), empty);
  assert.deepEqual(parseExifFromJpeg(Buffer.alloc(0)), empty);
  // PNG (magic diverso)
  assert.deepEqual(parseExifFromJpeg(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])), empty);
  // JPEG senza APP1 EXIF
  const noExif = Buffer.concat([
    Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10]),
    Buffer.from('JFIF\0\0\0\0\0\0\0\0\0', 'latin1'),
  ]);
  assert.deepEqual(parseExifFromJpeg(noExif), empty);
});

test('EXIF: parseExifDateTimeMs valida il formato e rifiuta date impossibili', () => {
  assert.equal(parseExifDateTimeMs('2023:08:15 14:22:10'), Date.UTC(2023, 7, 15, 14, 22, 10));
  assert.equal(parseExifDateTimeMs('2023:08:15T14:22:10'), Date.UTC(2023, 7, 15, 14, 22, 10));
  assert.equal(parseExifDateTimeMs('1960:01:01 00:00:00'), null); // pre-1970 (epoch negativo ambiguo)
  assert.equal(parseExifDateTimeMs('not a date'), null);
  assert.equal(parseExifDateTimeMs(null), null);
  assert.equal(parseExifDateTimeMs('2023:13:40 99:99:99'), null); // mese/giorno impossibili
});

test('EXIF: isExifParseableFilename riconosce solo i JPEG', () => {
  assert.ok(isExifParseableFilename('foto.jpg'));
  assert.ok(isExifParseableFilename('FOTO.JPEG'));
  assert.ok(isExifParseableFilename('x.jpe'));
  assert.equal(isExifParseableFilename('video.mp4'), false);
  assert.equal(isExifParseableFilename('img.png'), false);
  assert.equal(isExifParseableFilename('img.heic'), false);
});

test('EXIF: coordinate GPS — emisferi Sud/Ovest diventano negativi', () => {
  // Costruisci variante con S/W
  const w16 = le16, w32 = le32;
  const dtoAscii = Buffer.from('2020:01:01 10:00:00', 'latin1');
  const ifd0Count = 4;
  const ifd0Size = 2 + ifd0Count * 12 + 4;
  const make = Buffer.from('GoPro', 'latin1');
  const makeOff = 8 + ifd0Size;
  const exifIfdOffset = makeOff + make.length;
  const exifIfdSize = 2 + 1 * 12 + 4;
  const dtoOff = exifIfdOffset + exifIfdSize;
  const gpsIfdOffset = dtoOff + dtoAscii.length;
  const gpsIfdSize = 2 + 6 * 12 + 4;
  const latOff = gpsIfdOffset + gpsIfdSize;
  const lonOff = latOff + 24;
  function ent(tag: number, type: number, count: number, vo: number): Buffer {
    const b = Buffer.alloc(12);
    w16(tag).copy(b, 0); w16(type).copy(b, 2); w32(count).copy(b, 4); w32(vo).copy(b, 8);
    return b;
  }
  function asciiInline(tag: number, s: string): Buffer {
    const b = Buffer.alloc(12);
    w16(tag).copy(b, 0); w16(2).copy(b, 2); w32(2).copy(b, 4);
    Buffer.from(s + '', 'latin1').copy(b, 8);
    return b;
  }
  const tiff = Buffer.concat([
    Buffer.from('II', 'latin1'), w16(42), w32(8),
    w16(ifd0Count),
    ent(0x010f, 2, make.length, makeOff),
    ent(0x8769, 4, 1, exifIfdOffset),
    ent(0x8825, 4, 1, gpsIfdOffset),
    ent(0x0110, 2, 1, 8 + ifd0Size + make.length + 200), // punta fuori: ignorato dal parser (bounds check)
    w32(0),
    make,
    w16(1),
    ent(0x9003, 2, dtoAscii.length, dtoOff),
    w32(0),
    dtoAscii,
    w16(6),
    asciiInline(0x0001, 'S'),
    ent(0x0002, 5, 3, latOff),
    asciiInline(0x0003, 'W'),
    ent(0x0004, 5, 3, lonOff),
    ent(0x0005, 1, 1, 0),
    ent(0x0006, 5, 1, latOff), // riuso offset (valore non importante)
    w32(0),
    Buffer.concat([w32(33), w32(1), w32(52), w32(1), w32(30), w32(1)]), // 33.875° (DMS RATIONAL×3)
    Buffer.concat([w32(151), w32(1), w32(12), w32(1), w32(36), w32(1)]), // 151.21°
  ]);
  const app1Payload = Buffer.concat([Buffer.from('Exif\0\0', 'latin1'), tiff]);
  const jpeg = Buffer.concat([
    Buffer.from([0xff, 0xd8, 0xff, 0xe1]),
    be16(app1Payload.length + 2),
    app1Payload,
    Buffer.from([0xff, 0xda, 0x00, 0x08]),
  ]);
  const exif = parseExifFromJpeg(jpeg);
  assert.equal(exif.hasGps, true);
  assert.ok(exif.latitude !== null && exif.latitude < 0, `lat=${exif.latitude} deve essere negativa (S)`);
  assert.ok(exif.longitude !== null && exif.longitude < 0, `lon=${exif.longitude} deve essere negativa (W)`);
  assert.ok(Math.abs((exif.latitude || 0) + 33.875) < 0.001);
  assert.ok(Math.abs((exif.longitude || 0) + 151.21) < 0.001);
});
