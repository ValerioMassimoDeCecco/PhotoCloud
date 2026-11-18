import { concatBytes, utf8Encode } from '../../lib/zk/index.ts';

// ============================================================================
// Generatore ZIP Streaming (Store Method 0 con Data Descriptor CRC-32)
// Memoria costante: cifra/decifra e impacchetta un chunk alla volta senza
// caricare tutti i file in RAM.
// ============================================================================

const CRC32_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let i = 0; i < 256; i++) {
    let c = i;
    for (let k = 0; k < 8; k++) {
      c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    }
    table[i] = c >>> 0;
  }
  return table;
})();

export function updateCrc32(crc: number, chunk: Uint8Array): number {
  let c = (crc ^ 0xffffffff) >>> 0;
  for (let i = 0; i < chunk.byteLength; i++) {
    c = CRC32_TABLE[(c ^ chunk[i]) & 0xff] ^ (c >>> 8);
  }
  return (c ^ 0xffffffff) >>> 0;
}

export interface StreamingZipEntrySource {
  name: string;
  modifiedAt?: number;
  stream: () => AsyncIterable<Uint8Array> | Iterable<Uint8Array>;
}

function sanitizeZipEntryName(rawName: string, usedNames: Set<string>): string {
  const base = rawName
    .replace(/[\\/:*?"<>|\x00-\x1f]/g, '_')
    .replace(/^\.+/, '_')
    .trim() || 'file.bin';

  let candidate = base;
  let counter = 1;
  while (usedNames.has(candidate.toLowerCase())) {
    const dotIdx = base.lastIndexOf('.');
    if (dotIdx > 0) {
      candidate = `${base.slice(0, dotIdx)}_${counter}${base.slice(dotIdx)}`;
    } else {
      candidate = `${base}_${counter}`;
    }
    counter += 1;
  }
  usedNames.add(candidate.toLowerCase());
  return candidate;
}

function writeUint16LE(buf: Uint8Array, offset: number, val: number): void {
  buf[offset] = val & 0xff;
  buf[offset + 1] = (val >>> 8) & 0xff;
}

function writeUint32LE(buf: Uint8Array, offset: number, val: number): void {
  buf[offset] = val & 0xff;
  buf[offset + 1] = (val >>> 8) & 0xff;
  buf[offset + 2] = (val >>> 16) & 0xff;
  buf[offset + 3] = (val >>> 24) & 0xff;
}

/**
 * Emette uno stream ZIP standard (Store + Data Descriptor bit 3 + UTF-8 bit 11)
 * leggendo un file alla volta in streaming senza accumulare i file in memoria.
 */
export async function* generateZipStream(
  entries: Iterable<StreamingZipEntrySource> | AsyncIterable<StreamingZipEntrySource>
): AsyncGenerator<Uint8Array, void, void> {
  const centralDirectoryRecords: Uint8Array[] = [];
  const usedNames = new Set<string>();
  let offset = 0;
  let totalEntries = 0;

  for await (const entry of entries) {
    const safeName = sanitizeZipEntryName(entry.name, usedNames);
    const nameBytes = utf8Encode(safeName);
    const localHeaderOffset = offset;

    // Local File Header (30 byte + filename)
    // Bit 3 (0x0008): CRC-32 e size nel Data Descriptor dopo i dati
    // Bit 11 (0x0800): filename UTF-8
    const flags = 0x0008 | 0x0800;
    const localHeader = new Uint8Array(30 + nameBytes.byteLength);
    writeUint32LE(localHeader, 0, 0x04034b50); // signature PK\x03\x04
    writeUint16LE(localHeader, 4, 20); // version needed to extract (2.0)
    writeUint16LE(localHeader, 6, flags);
    writeUint16LE(localHeader, 8, 0); // compression method: 0 (Store)
    writeUint16LE(localHeader, 10, 0); // mod time
    writeUint16LE(localHeader, 12, 0x2100); // mod date
    writeUint32LE(localHeader, 14, 0); // crc32 (in data descriptor)
    writeUint32LE(localHeader, 18, 0); // compressed size (in data descriptor)
    writeUint32LE(localHeader, 22, 0); // uncompressed size (in data descriptor)
    writeUint16LE(localHeader, 26, nameBytes.byteLength);
    writeUint16LE(localHeader, 28, 0); // extra field length
    localHeader.set(nameBytes, 30);

    yield localHeader;
    offset += localHeader.byteLength;

    let crc = 0;
    let fileSize = 0;
    for await (const chunk of entry.stream()) {
      if (chunk.byteLength === 0) continue;
      crc = updateCrc32(crc, chunk);
      fileSize += chunk.byteLength;
      offset += chunk.byteLength;
      yield chunk;
    }

    // Data Descriptor (16 byte)
    const dataDesc = new Uint8Array(16);
    writeUint32LE(dataDesc, 0, 0x08074b50); // signature PK\x07\x08
    writeUint32LE(dataDesc, 4, crc);
    writeUint32LE(dataDesc, 8, fileSize);
    writeUint32LE(dataDesc, 12, fileSize);
    yield dataDesc;
    offset += dataDesc.byteLength;

    // Central Directory File Header (46 byte + filename)
    const cdHeader = new Uint8Array(46 + nameBytes.byteLength);
    writeUint32LE(cdHeader, 0, 0x02014b50); // signature PK\x01\x02
    writeUint16LE(cdHeader, 4, 20); // version made by
    writeUint16LE(cdHeader, 6, 20); // version needed
    writeUint16LE(cdHeader, 8, flags);
    writeUint16LE(cdHeader, 10, 0); // method: Store
    writeUint16LE(cdHeader, 12, 0);
    writeUint16LE(cdHeader, 14, 0x2100);
    writeUint32LE(cdHeader, 16, crc);
    writeUint32LE(cdHeader, 20, fileSize);
    writeUint32LE(cdHeader, 24, fileSize);
    writeUint16LE(cdHeader, 28, nameBytes.byteLength);
    writeUint16LE(cdHeader, 30, 0); // extra len
    writeUint16LE(cdHeader, 32, 0); // comment len
    writeUint16LE(cdHeader, 34, 0); // disk number
    writeUint16LE(cdHeader, 36, 0); // internal attr
    writeUint32LE(cdHeader, 38, 0); // external attr
    writeUint32LE(cdHeader, 42, localHeaderOffset);
    cdHeader.set(nameBytes, 46);

    centralDirectoryRecords.push(cdHeader);
    totalEntries += 1;
  }

  const cdStartOffset = offset;
  const cdBlob = concatBytes(...centralDirectoryRecords);
  if (cdBlob.byteLength > 0) {
    yield cdBlob;
    offset += cdBlob.byteLength;
  }

  // End of Central Directory Record (22 byte)
  const eocd = new Uint8Array(22);
  writeUint32LE(eocd, 0, 0x06054b50); // signature PK\x05\x06
  writeUint16LE(eocd, 4, 0);
  writeUint16LE(eocd, 6, 0);
  writeUint16LE(eocd, 8, totalEntries);
  writeUint16LE(eocd, 10, totalEntries);
  writeUint32LE(eocd, 12, cdBlob.byteLength);
  writeUint32LE(eocd, 16, cdStartOffset);
  writeUint16LE(eocd, 20, 0);
  yield eocd;
}
