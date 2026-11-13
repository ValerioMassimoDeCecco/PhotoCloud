/**
 * PhotoCloud v1.4.1 — Parser EXIF minimale, zero-dipendenze.
 *
 * Estrae dai JPEG (APP1 "Exif\0\0" + TIFF) i metadati principali:
 * fotocamera (Make/Model), data originale di scatto, apertura (FNumber),
 * ISO, tempo di esposizione, focale e coordinate GPS.
 *
 * I file del vault PhotoCloud sono cifrati a riposo: il parser lavora sul
 * buffer in chiaro che il server ottiene tramite `decryptFileAsync`, quindi
 * è una funzione pura e deterministica (facilmente testabile).
 */

export interface ExifMetadata {
  make: string | null;
  model: string | null;
  /** Fotocamera "Make Model" pronta per la UI, deduplicata. */
  camera: string | null;
  /** Data originale di scatto nel formato EXIF "YYYY:MM:DD HH:MM:SS". */
  dateTimeOriginal: string | null;
  /** Data originale convertita in epoch ms (interpretata come UTC — EXIF non ha fuso). */
  dateTimeOriginalMs: number | null;
  /** Apertura diaframma, es. 2.8. */
  apertureFNumber: number | null;
  iso: number | null;
  /** Tempo di esposizione in secondi (es. 0.008). */
  exposureTimeSec: number | null;
  /** Tempo di esposizione leggibile: "1/125" oppure "0.5 s". */
  exposureTimeLabel: string | null;
  /** Lunghezza focale in mm (equivalente dichiarato, non 35mm). */
  focalLengthMm: number | null;
  latitude: number | null;
  longitude: number | null;
  altitudeM: number | null;
  hasGps: boolean;
}

export function emptyExifMetadata(): ExifMetadata {
  return {
    make: null,
    model: null,
    camera: null,
    dateTimeOriginal: null,
    dateTimeOriginalMs: null,
    apertureFNumber: null,
    iso: null,
    exposureTimeSec: null,
    exposureTimeLabel: null,
    focalLengthMm: null,
    latitude: null,
    longitude: null,
    altitudeM: null,
    hasGps: false,
  };
}

/** EXIF TIFF è definito solo nel segmento APP1 dei JPEG. HEIC/MP4 usano altri container. */
export function isExifParseableFilename(filename: string): boolean {
  const lower = filename.toLowerCase();
  return lower.endsWith('.jpg') || lower.endsWith('.jpeg') || lower.endsWith('.jpe');
}

// Identificatori dei tag TIFF/EXIF rilevanti.
const TAG_MAKE = 0x010f;
const TAG_MODEL = 0x0110;
const TAG_DATETIME = 0x0132; // fallback generico
const TAG_EXIF_IFD_PTR = 0x8769;
const TAG_GPS_IFD_PTR = 0x8825;

const TAG_EXPOSURE_TIME = 0x829a;
const TAG_FNUMBER = 0x829d;
const TAG_ISO = 0x8827;
const TAG_DATETIME_ORIGINAL = 0x9003;
const TAG_FOCAL_LENGTH = 0x920a;

const TAG_GPS_LAT_REF = 0x0001;
const TAG_GPS_LAT = 0x0002;
const TAG_GPS_LON_REF = 0x0003;
const TAG_GPS_LON = 0x0004;
const TAG_GPS_ALT_REF = 0x0005;
const TAG_GPS_ALT = 0x0006;

/** Dimensione in byte di ciascun tipo TIFF (indice = tipo). */
const TYPE_SIZES: Record<number, number> = {
  1: 1, // BYTE
  2: 1, // ASCII
  3: 2, // SHORT
  4: 4, // LONG
  5: 8, // RATIONAL
  7: 1, // UNDEFINED
  9: 4, // SLONG
  10: 8, // SRATIONAL
};

interface TiffReader {
  buf: Buffer;
  base: number; // offset del header TIFF nel buffer (dopo "Exif\0\0")
  littleEndian: boolean;
}

function u16At(r: TiffReader, off: number): number {
  return r.littleEndian ? r.buf.readUInt16LE(r.base + off) : r.buf.readUInt16BE(r.base + off);
}

function u32At(r: TiffReader, off: number): number {
  return r.littleEndian ? r.buf.readUInt32LE(r.base + off) : r.buf.readUInt32BE(r.base + off);
}

function i32At(r: TiffReader, off: number): number {
  return r.littleEndian ? r.buf.readInt32LE(r.base + off) : r.buf.readInt32BE(r.base + off);
}

function rationalAt(r: TiffReader, off: number): number | null {
  const num = u32At(r, off);
  const den = u32At(r, off + 4);
  if (!Number.isFinite(num) || !Number.isFinite(den) || den === 0) return null;
  return num / den;
}

function signedRationalAt(r: TiffReader, off: number): number | null {
  const num = i32At(r, off);
  const den = i32At(r, off + 4);
  if (!Number.isFinite(num) || !Number.isFinite(den) || den === 0) return null;
  return num / den;
}

function readAscii(r: TiffReader, valueOff: number, count: number): string {
  const end = Math.min(valueOff + count, r.buf.length - r.base);
  if (end <= valueOff) return '';
  let raw = r.buf.toString('latin1', r.base + valueOff, r.base + end);
  const nulIdx = raw.indexOf(String.fromCharCode(0));
  if (nulIdx >= 0) raw = raw.slice(0, nulIdx);
  return raw.trim();
}

interface IfdEntry {
  tag: number;
  type: number;
  count: number;
  /** Offset (relativo al base TIFF) dove risiede il valore. */
  valueOffset: number;
}

function readIfdEntries(r: TiffReader, ifdOffset: number): IfdEntry[] {
  const entries: IfdEntry[] = [];
  if (ifdOffset <= 0 || r.base + ifdOffset + 2 > r.buf.length) return entries;
  const count = u16At(r, ifdOffset);
  if (count <= 0 || count > 512) return entries;
  const tableOff = ifdOffset + 2;
  for (let i = 0; i < count; i++) {
    const entryOff = tableOff + i * 12;
    if (r.base + entryOff + 12 > r.buf.length) break;
    const tag = u16At(r, entryOff);
    const type = u16At(r, entryOff + 2);
    const valueCount = u32At(r, entryOff + 4);
    const size = (TYPE_SIZES[type] || 1) * valueCount;
    if (size <= 0 || valueCount > 4096) continue;
    // Se il valore sta nei 4 byte del campo, è inline all'offset+8.
    const valueOffset = size <= 4 ? entryOff + 8 : u32At(r, entryOff + 8);
    if (r.base + valueOffset + size > r.buf.length) continue;
    entries.push({ tag, type, count: valueCount, valueOffset });
  }
  return entries;
}

function findEntry(entries: IfdEntry[], tag: number): IfdEntry | undefined {
  return entries.find((e) => e.tag === tag);
}

function readNumericTag(r: TiffReader, entry: IfdEntry | undefined): number | null {
  if (!entry) return null;
  if (entry.type === 3 && entry.count >= 1) return u16At(r, entry.valueOffset); // SHORT
  if (entry.type === 4 && entry.count >= 1) return u32At(r, entry.valueOffset); // LONG
  if (entry.type === 5 && entry.count >= 1) return rationalAt(r, entry.valueOffset); // RATIONAL
  if (entry.type === 9 && entry.count >= 1) return i32At(r, entry.valueOffset); // SLONG (rarissimo)
  return null;
}

function readAsciiTag(r: TiffReader, entry: IfdEntry | undefined): string | null {
  if (!entry || entry.type !== 2) return null;
  const value = readAscii(r, entry.valueOffset, entry.count);
  return value.length > 0 ? value : null;
}

function readGpsCoordinate(
  r: TiffReader,
  dmsEntry: IfdEntry | undefined,
  refEntry: IfdEntry | undefined
): number | null {
  if (!dmsEntry || dmsEntry.type !== 5 || dmsEntry.count < 3) return null;
  const deg = rationalAt(r, dmsEntry.valueOffset);
  const min = rationalAt(r, dmsEntry.valueOffset + 8);
  const sec = rationalAt(r, dmsEntry.valueOffset + 16);
  if (deg === null || min === null || sec === null) return null;
  if (!Number.isFinite(deg) || !Number.isFinite(min) || !Number.isFinite(sec)) return null;
  if (deg < 0 || deg > 180 || min < 0 || min >= 60 || sec < 0 || sec >= 60) return null;
  let value = deg + min / 60 + sec / 3600;
  const ref = (readAsciiTag(r, refEntry) || '').toUpperCase();
  if (ref === 'S' || ref === 'W') value = -value;
  return Math.round(value * 1e6) / 1e6;
}

/** Interpreta "YYYY:MM:DD HH:MM:SS" come istante UTC (EXIF non porta fuso orario). */
export function parseExifDateTimeMs(raw: string | null): number | null {
  if (!raw) return null;
  const m = /^(\d{4}):(\d{2}):(\d{2})[ T](\d{2}):(\d{2}):(\d{2})$/.exec(raw.trim());
  if (!m) return null;
  const [, y, mo, d, h, mi, s] = m;
  const year = Number(y);
  const month = Number(mo);
  const day = Number(d);
  if (year < 1970 || month < 1 || month > 12 || day < 1 || day > 31) return null;
  const ms = Date.UTC(year, month - 1, day, Number(h), Number(mi), Number(s));
  return Number.isNaN(ms) ? null : ms;
}

function formatExposureLabel(seconds: number): string {
  if (seconds >= 0.3) {
    const rounded = Math.round(seconds * 10) / 10;
    return `${rounded} s`;
  }
  const denom = Math.round(1 / seconds);
  return `1/${denom}`;
}

/**
 * Estrae i metadati EXIF da un buffer JPEG. Mai lancia eccezioni:
 * in caso di file non JPEG o EXIF corrotto ritorna tutti campi null.
 */
export function parseExifFromJpeg(buffer: Buffer): ExifMetadata {
  const out = emptyExifMetadata();
  try {
    if (!buffer || buffer.length < 4) return out;
    if (buffer[0] !== 0xff || buffer[1] !== 0xd8) return out; // magic SOI JPEG

    // Scansione marker fino a trovare APP1 (0xFFE1) con header "Exif\0\0".
    let tiffBase = -1;
    let offset = 2;
    while (offset + 4 <= buffer.length) {
      if (buffer[offset] !== 0xff) break;
      const marker = buffer[offset + 1];
      if (marker === 0xda) break; // SOS: inizia la scansione, fine metadati
      if (offset + 4 > buffer.length) break;
      const segLen = buffer.readUInt16BE(offset + 2);
      if (segLen < 2) break;
      if (marker === 0xe1 && offset + 4 + segLen <= buffer.length + 2) {
        if (
          buffer.length >= offset + 10 &&
          buffer.toString('latin1', offset + 4, offset + 10) === 'Exif\0\0'
        ) {
          tiffBase = offset + 10;
        }
        break;
      }
      offset += 2 + segLen;
    }
    if (tiffBase < 0 || tiffBase + 8 > buffer.length) return out;

    const order = buffer.toString('latin1', tiffBase, tiffBase + 2);
    const littleEndian = order === 'II';
    if (!littleEndian && order !== 'MM') return out;
    const r: TiffReader = { buf: buffer, base: tiffBase, littleEndian };
    if (u16At(r, 2) !== 42) return out;
    const ifd0Offset = u32At(r, 4);
    const ifd0 = readIfdEntries(r, ifd0Offset);

    out.make = readAsciiTag(r, findEntry(ifd0, TAG_MAKE));
    out.model = readAsciiTag(r, findEntry(ifd0, TAG_MODEL));
    if (out.make && out.model) {
      out.camera = out.model.toLowerCase().startsWith(out.make.toLowerCase())
        ? out.model
        : `${out.make} ${out.model}`;
    } else {
      out.camera = out.model || out.make;
    }
    const genericDate = readAsciiTag(r, findEntry(ifd0, TAG_DATETIME));

    // Exif sub-IFD
    const exifPtr = findEntry(ifd0, TAG_EXIF_IFD_PTR);
    const exifOffset = exifPtr ? u32At(r, exifPtr.valueOffset) : 0;
    const exifIfd = exifOffset > 0 ? readIfdEntries(r, exifOffset) : [];

    out.dateTimeOriginal =
      readAsciiTag(r, findEntry(exifIfd, TAG_DATETIME_ORIGINAL)) || genericDate;
    out.dateTimeOriginalMs = parseExifDateTimeMs(out.dateTimeOriginal);

    const fNumber = readNumericTag(r, findEntry(exifIfd, TAG_FNUMBER));
    if (fNumber !== null && Number.isFinite(fNumber) && fNumber > 0 && fNumber < 1000) {
      out.apertureFNumber = Math.round(fNumber * 10) / 10;
    }
    const iso = readNumericTag(r, findEntry(exifIfd, TAG_ISO));
    if (iso !== null && Number.isFinite(iso) && iso > 0 && iso < 10_000_000) {
      out.iso = Math.round(iso);
    }
    const exposure = readNumericTag(r, findEntry(exifIfd, TAG_EXPOSURE_TIME));
    if (exposure !== null && Number.isFinite(exposure) && exposure > 0 && exposure < 86400) {
      out.exposureTimeSec = exposure;
      out.exposureTimeLabel = formatExposureLabel(exposure);
    }
    const focal = readNumericTag(r, findEntry(exifIfd, TAG_FOCAL_LENGTH));
    if (focal !== null && Number.isFinite(focal) && focal > 0 && focal < 10000) {
      out.focalLengthMm = Math.round(focal * 10) / 10;
    }

    // GPS sub-IFD
    const gpsPtr = findEntry(ifd0, TAG_GPS_IFD_PTR);
    const gpsOffset = gpsPtr ? u32At(r, gpsPtr.valueOffset) : 0;
    if (gpsOffset > 0) {
      const gpsIfd = readIfdEntries(r, gpsOffset);
      const lat = readGpsCoordinate(r, findEntry(gpsIfd, TAG_GPS_LAT), findEntry(gpsIfd, TAG_GPS_LAT_REF));
      const lon = readGpsCoordinate(r, findEntry(gpsIfd, TAG_GPS_LON), findEntry(gpsIfd, TAG_GPS_LON_REF));
      if (lat !== null && Math.abs(lat) <= 90) out.latitude = lat;
      if (lon !== null && Math.abs(lon) <= 180) out.longitude = lon;
      const altEntry = findEntry(gpsIfd, TAG_GPS_ALT);
      const alt = altEntry ? rationalAt(r, altEntry.valueOffset) : null;
      if (alt !== null && Number.isFinite(alt) && Math.abs(alt) < 100000) {
        const refEntry = findEntry(gpsIfd, TAG_GPS_ALT_REF);
        let ref = 0;
        if (refEntry && refEntry.type === 1 && refEntry.count >= 1) {
          ref = buffer[r.base + refEntry.valueOffset] || 0;
        }
        out.altitudeM = Math.round((ref === 1 ? -alt : alt) * 10) / 10;
      }
    }
    out.hasGps = out.latitude !== null && out.longitude !== null;
    return out;
  } catch {
    return emptyExifMetadata();
  }
}
