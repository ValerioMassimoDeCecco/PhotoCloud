import path from 'node:path';
import JSZip from 'jszip';

export type DocumentViewerMode =
  | 'pdf'
  | 'word'
  | 'spreadsheet'
  | 'presentation'
  | 'text'
  | 'image'
  | 'video'
  | 'audio'
  | 'external';

export interface FileViewerSpec {
  filename: string;
  extension: string;
  mimeType: string;
  viewerMode: DocumentViewerMode;
  viewerType: DocumentViewerMode;
  canPreviewInApp: boolean;
  canOpenInApp: boolean;
  formatLabel: string;
}

export interface DocumentBlock {
  type: 'heading' | 'paragraph' | 'list-item' | 'table';
  text?: string;
  level?: number;
  rows?: string[][];
}

export interface SpreadsheetSheet {
  name: string;
  headers: string[];
  rows: string[][];
  allRows: string[][];
  totalRows: number;
}

export interface PresentationSlide {
  slideNumber: number;
  index: number;
  title: string;
  bullets: string[];
  notes?: string;
}

export interface ParsedDocumentPreview {
  filename: string;
  extension: string;
  mimeType: string;
  viewerMode: DocumentViewerMode;
  viewerType: DocumentViewerMode;
  canPreviewInApp: boolean;
  canOpenInApp: boolean;
  formatLabel: string;
  sizeBytes: number;
  mediaUrl: string;
  downloadUrl: string;
  pageCount?: number;
  wordCount?: number;
  lineCount?: number;
  blocks: DocumentBlock[];
  sheets: SpreadsheetSheet[];
  slides: PresentationSlide[];
  textContent?: string;
  rawText?: string;
  warning?: string;
}

const MIME_BY_EXT: Record<string, string> = {
  // Documents & Office
  pdf: 'application/pdf',
  doc: 'application/msword',
  docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  odt: 'application/vnd.oasis.opendocument.text',
  rtf: 'application/rtf',
  xls: 'application/vnd.ms-excel',
  xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  ods: 'application/vnd.oasis.opendocument.spreadsheet',
  csv: 'text/csv; charset=utf-8',
  tsv: 'text/tab-separated-values; charset=utf-8',
  ppt: 'application/vnd.ms-powerpoint',
  pptx: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  odp: 'application/vnd.oasis.opendocument.presentation',
  // Text & Code
  txt: 'text/plain; charset=utf-8',
  md: 'text/markdown; charset=utf-8',
  json: 'application/json; charset=utf-8',
  xml: 'application/xml; charset=utf-8',
  yaml: 'text/yaml; charset=utf-8',
  yml: 'text/yaml; charset=utf-8',
  html: 'text/html; charset=utf-8',
  htm: 'text/html; charset=utf-8',
  css: 'text/css; charset=utf-8',
  js: 'text/javascript; charset=utf-8',
  ts: 'text/plain; charset=utf-8',
  tsx: 'text/plain; charset=utf-8',
  jsx: 'text/plain; charset=utf-8',
  py: 'text/plain; charset=utf-8',
  kt: 'text/plain; charset=utf-8',
  java: 'text/plain; charset=utf-8',
  c: 'text/plain; charset=utf-8',
  cpp: 'text/plain; charset=utf-8',
  h: 'text/plain; charset=utf-8',
  sh: 'text/plain; charset=utf-8',
  sql: 'text/plain; charset=utf-8',
  ini: 'text/plain; charset=utf-8',
  conf: 'text/plain; charset=utf-8',
  log: 'text/plain; charset=utf-8',
  // Images
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  png: 'image/png',
  gif: 'image/gif',
  webp: 'image/webp',
  bmp: 'image/bmp',
  svg: 'image/svg+xml',
  heic: 'image/heic',
  heif: 'image/heif',
  avif: 'image/avif',
  // Video
  mp4: 'video/mp4',
  mov: 'video/mp4',
  webm: 'video/webm',
  mkv: 'video/x-matroska',
  avi: 'video/x-msvideo',
  // Audio
  mp3: 'audio/mpeg',
  wav: 'audio/wav',
  ogg: 'audio/ogg',
  flac: 'audio/flac',
  aac: 'audio/aac',
  m4a: 'audio/mp4',
  opus: 'audio/opus',
  // Archives & Binaries
  zip: 'application/zip',
  rar: 'application/vnd.rar',
  '7z': 'application/x-7z-compressed',
  tar: 'application/x-tar',
  gz: 'application/gzip',
  apk: 'application/vnd.android.package-archive',
  iso: 'application/x-iso9660-image',
};

const WORD_EXTS = new Set(['doc', 'docx', 'odt', 'rtf']);
const SPREADSHEET_EXTS = new Set(['xls', 'xlsx', 'ods', 'csv', 'tsv']);
const PRESENTATION_EXTS = new Set(['ppt', 'pptx', 'odp']);
const TEXT_EXTS = new Set([
  'txt',
  'md',
  'json',
  'xml',
  'yaml',
  'yml',
  'html',
  'htm',
  'css',
  'js',
  'ts',
  'tsx',
  'jsx',
  'py',
  'kt',
  'java',
  'c',
  'cpp',
  'h',
  'sh',
  'sql',
  'ini',
  'conf',
  'log',
]);
const IMAGE_EXTS = new Set(['jpg', 'jpeg', 'png', 'gif', 'webp', 'bmp', 'svg', 'heic', 'heif', 'avif']);
const VIDEO_EXTS = new Set(['mp4', 'mov', 'webm', 'mkv', 'avi']);
const AUDIO_EXTS = new Set(['mp3', 'wav', 'ogg', 'flac', 'aac', 'm4a', 'opus']);

export function resolveFileViewerSpec(filename: string): FileViewerSpec {
  const ext = path.extname(filename).replace(/^\./, '').toLowerCase();
  const mimeType = MIME_BY_EXT[ext] || 'application/octet-stream';

  const makeSpec = (viewerMode: DocumentViewerMode, canPreviewInApp: boolean, formatLabel: string): FileViewerSpec => ({
    filename,
    extension: ext || 'bin',
    mimeType,
    viewerMode,
    viewerType: viewerMode,
    canPreviewInApp,
    canOpenInApp: canPreviewInApp,
    formatLabel,
  });

  if (ext === 'pdf') {
    return makeSpec('pdf', true, 'Documento PDF');
  }
  if (WORD_EXTS.has(ext)) {
    return makeSpec('word', true, `Documento Word (.${ext.toUpperCase()})`);
  }
  if (SPREADSHEET_EXTS.has(ext)) {
    return makeSpec('spreadsheet', true, `Foglio di Calcolo (.${ext.toUpperCase()})`);
  }
  if (PRESENTATION_EXTS.has(ext)) {
    return makeSpec('presentation', true, `Presentazione (.${ext.toUpperCase()})`);
  }
  if (TEXT_EXTS.has(ext)) {
    return makeSpec('text', true, `Testo / Codice (.${ext.toUpperCase()})`);
  }
  if (IMAGE_EXTS.has(ext)) {
    return makeSpec('image', true, `Immagine (.${ext.toUpperCase()})`);
  }
  if (VIDEO_EXTS.has(ext)) {
    return makeSpec('video', true, `Video (.${ext.toUpperCase()})`);
  }
  if (AUDIO_EXTS.has(ext)) {
    return makeSpec('audio', true, `Audio (.${ext.toUpperCase()})`);
  }

  return makeSpec('external', false, ext ? `File .${ext.toUpperCase()}` : 'File Binario');
}

function decodeXmlEntities(raw: string): string {
  return raw
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&#(\d+);/g, (_m, dec) => String.fromCodePoint(Number(dec)))
    .replace(/&#x([0-9a-fA-F]+);/g, (_m, hex) => String.fromCodePoint(parseInt(hex, 16)))
    .replace(/&amp;/g, '&');
}

function countWords(text: string): number {
  const trimmed = text.trim();
  if (!trimmed) return 0;
  return trimmed.split(/\s+/).length;
}

function extractWordXmlBlocks(xml: string): DocumentBlock[] {
  const blocks: DocumentBlock[] = [];
  // Match tables or paragraphs in document order
  const tokenRegex = /<w:tbl\b[\s\S]*?<\/w:tbl>|<w:p\b[\s\S]*?<\/w:p>/g;
  let match: RegExpExecArray | null;

  while ((match = tokenRegex.exec(xml)) !== null) {
    const token = match[0];
    if (token.startsWith('<w:tbl')) {
      const rows: string[][] = [];
      const rowRegex = /<w:tr\b[\s\S]*?<\/w:tr>/g;
      let rowMatch: RegExpExecArray | null;
      while ((rowMatch = rowRegex.exec(token)) !== null) {
        const cells: string[] = [];
        const cellRegex = /<w:tc\b[\s\S]*?<\/w:tc>/g;
        let cellMatch: RegExpExecArray | null;
        while ((cellMatch = cellRegex.exec(rowMatch[0])) !== null) {
          const texts: string[] = [];
          const tRegex = /<w:t(?:\s[^>]*)?>([\s\S]*?)<\/w:t>/g;
          let tMatch: RegExpExecArray | null;
          while ((tMatch = tRegex.exec(cellMatch[0])) !== null) {
            texts.push(decodeXmlEntities(tMatch[1]));
          }
          cells.push(texts.join(' ').trim());
        }
        if (cells.some((c) => c.length > 0)) {
          rows.push(cells);
        }
      }
      if (rows.length > 0) {
        blocks.push({ type: 'table', rows });
      }
    } else {
      const styleMatch = token.match(/<w:pStyle\s+w:val="([^"]+)"/i);
      const styleVal = styleMatch?.[1] || '';
      const isList = /<w:numPr\b/.test(token);

      const texts: string[] = [];
      const tRegex = /<w:t(?:\s[^>]*)?>([\s\S]*?)<\/w:t>|<w:tab\/>|<w:br\/>/g;
      let tMatch: RegExpExecArray | null;
      while ((tMatch = tRegex.exec(token)) !== null) {
        if (tMatch[0] === '<w:tab/>') texts.push('\t');
        else if (tMatch[0] === '<w:br/>') texts.push('\n');
        else if (tMatch[1] !== undefined) texts.push(decodeXmlEntities(tMatch[1]));
      }
      const line = texts.join('').trim();
      if (!line) continue;

      if (/^(Heading|Titolo|Title|Subtitle)/i.test(styleVal)) {
        const lvlMatch = styleVal.match(/(\d+)/);
        const level = lvlMatch ? Math.min(3, Math.max(1, Number(lvlMatch[1]))) : 1;
        blocks.push({ type: 'heading', level, text: line });
      } else if (isList) {
        blocks.push({ type: 'list-item', text: line });
      } else {
        blocks.push({ type: 'paragraph', text: line });
      }
    }
  }

  return blocks;
}

function extractOdtXmlBlocks(xml: string): DocumentBlock[] {
  const blocks: DocumentBlock[] = [];
  const pRegex = /<text:(h|p)\b[^>]*>([\s\S]*?)<\/text:\1>/g;
  let match: RegExpExecArray | null;
  while ((match = pRegex.exec(xml)) !== null) {
    const tag = match[1];
    const inner = decodeXmlEntities(match[2].replace(/<[^>]+>/g, ' ')).replace(/\s+/g, ' ').trim();
    if (!inner) continue;
    if (tag === 'h') {
      blocks.push({ type: 'heading', level: 2, text: inner });
    } else {
      blocks.push({ type: 'paragraph', text: inner });
    }
  }
  return blocks;
}

function parseRtfToBlocks(rtfText: string): DocumentBlock[] {
  const cleaned = rtfText
    .replace(/\\par\b/g, '\n')
    .replace(/\\line\b/g, '\n')
    .replace(/\\tab\b/g, '\t')
    .replace(/\\'([0-9a-fA-F]{2})/g, (_m, hex) => String.fromCharCode(parseInt(hex, 16)))
    .replace(/\{\\(?:fonttbl|colortbl|stylesheet|info|pict)[\s\S]*?\}/g, '')
    .replace(/\\[a-zA-Z]+-?\d*\s?/g, '')
    .replace(/[{}]/g, '');

  return cleaned
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => l.length > 0)
    .map((line) => ({ type: 'paragraph' as const, text: line }));
}

function extractLegacyBinaryReadableLines(buffer: Buffer): string[] {
  const results: string[] = [];
  // 1. Extract ASCII/UTF-8 runs of >= 5 printable characters
  const latin = buffer.toString('latin1');
  const asciiMatches = latin.match(/[\x20-\x7E\xC0-\xFF]{6,}/g) || [];
  for (const m of asciiMatches) {
    const trimmed = m.trim();
    if (
      trimmed.length >= 6 &&
      !/^(Root Entry|WordDocument|SummaryInformation|DocumentSummaryInformation|CompObj|Microsoft|Normal\.dotm|Times New Roman|Calibri|Arial)/i.test(
        trimmed
      )
    ) {
      results.push(trimmed);
    }
  }

  // 2. Also check UTF-16LE printable sequences common in MS Office binary streams
  const utf16 = buffer.toString('utf16le');
  const u16Matches = utf16.match(/[\x20-\x7E\u00A0-\u00FF]{6,}/g) || [];
  for (const m of u16Matches) {
    const trimmed = m.trim();
    if (
      trimmed.length >= 6 &&
      !/^(Root Entry|WordDocument|SummaryInformation|DocumentSummaryInformation|CompObj|Microsoft|Normal\.dotm|Times New Roman|Calibri|Arial)/i.test(
        trimmed
      ) &&
      !results.includes(trimmed)
    ) {
      results.push(trimmed);
    }
  }

  return results.slice(0, 600);
}

function colLettersToIndex(letters: string): number {
  let idx = 0;
  for (let i = 0; i < letters.length; i++) {
    idx = idx * 26 + (letters.charCodeAt(i) - 64);
  }
  return Math.max(0, idx - 1);
}

const MAX_ZIP_ENTRIES = 1000;
const MAX_ZIP_ENTRY_BYTES = 10 * 1024 * 1024; // 10 MB per XML entry

async function loadSafeZip(buffer: Buffer): Promise<JSZip> {
  const zip = await JSZip.loadAsync(buffer);
  const entryKeys = Object.keys(zip.files);
  if (entryKeys.length > MAX_ZIP_ENTRIES) {
    throw new Error('Archivio documento contiene troppi elementi interni.');
  }
  return zip;
}

async function readZipEntryTextLimited(file: JSZip.JSZipObject, maxBytes = MAX_ZIP_ENTRY_BYTES): Promise<string> {
  const rawData = (file as unknown as { _data?: { uncompressedSize?: number } })._data;
  if (rawData && typeof rawData.uncompressedSize === 'number' && rawData.uncompressedSize > maxBytes) {
    throw new Error('Contenuto XML interno supera il limite massimo consentito.');
  }
  const bytes = await file.async('uint8array');
  if (bytes.byteLength > maxBytes) {
    throw new Error('Contenuto XML interno supera il limite massimo consentito.');
  }
  return Buffer.from(bytes).toString('utf-8');
}

async function parseXlsxBuffer(buffer: Buffer): Promise<SpreadsheetSheet[]> {
  const zip = await loadSafeZip(buffer);
  const sharedStrings: string[] = [];

  const sharedFile = zip.file('xl/sharedStrings.xml');
  if (sharedFile) {
    const sharedXml = await readZipEntryTextLimited(sharedFile);
    const siRegex = /<si\b[\s\S]*?<\/si>/g;
    let siMatch: RegExpExecArray | null;
    while ((siMatch = siRegex.exec(sharedXml)) !== null) {
      const parts: string[] = [];
      const tRegex = /<t(?:\s[^>]*)?>([\s\S]*?)<\/t>/g;
      let tMatch: RegExpExecArray | null;
      while ((tMatch = tRegex.exec(siMatch[0])) !== null) {
        parts.push(decodeXmlEntities(tMatch[1]));
      }
      sharedStrings.push(parts.join(''));
    }
  }

  const sheetNames: string[] = [];
  const wbFile = zip.file('xl/workbook.xml');
  if (wbFile) {
    const wbXml = await readZipEntryTextLimited(wbFile);
    const sRegex = /<sheet\b[^>]*name="([^"]+)"/g;
    let sMatch: RegExpExecArray | null;
    while ((sMatch = sRegex.exec(wbXml)) !== null) {
      sheetNames.push(decodeXmlEntities(sMatch[1]));
    }
  }

  const sheetFiles = Object.keys(zip.files)
    .filter((p) => /^xl\/worksheets\/sheet\d+\.xml$/i.test(p))
    .sort((a, b) => {
      const na = Number(a.match(/sheet(\d+)\.xml/i)?.[1] || 0);
      const nb = Number(b.match(/sheet(\d+)\.xml/i)?.[1] || 0);
      return na - nb;
    });

  const sheets: SpreadsheetSheet[] = [];

  for (let i = 0; i < sheetFiles.length; i++) {
    const sf = zip.file(sheetFiles[i]);
    if (!sf) continue;
    const xml = await readZipEntryTextLimited(sf);
    const rows: string[][] = [];

    const rowRegex = /<row\b[\s\S]*?<\/row>/g;
    let rMatch: RegExpExecArray | null;
    while ((rMatch = rowRegex.exec(xml)) !== null) {
      const rowCells: string[] = [];
      const cellRegex = /<c\b([^>]*)>([\s\S]*?)<\/c>/g;
      let cMatch: RegExpExecArray | null;
      while ((cMatch = cellRegex.exec(rMatch[0])) !== null) {
        const attrs = cMatch[1];
        const inner = cMatch[2];
        const refMatch = attrs.match(/\br="([A-Z]+)\d+"/);
        const typeMatch = attrs.match(/\bt="([^"]+)"/);
        const colIdx = refMatch ? Math.min(256, colLettersToIndex(refMatch[1])) : rowCells.length;
        const cellType = typeMatch?.[1] || '';

        let val = '';
        if (cellType === 's') {
          const vMatch = inner.match(/<v>(\d+)<\/v>/);
          if (vMatch) {
            val = sharedStrings[Number(vMatch[1])] ?? '';
          }
        } else if (cellType === 'inlineStr') {
          const tMatch = inner.match(/<t(?:\s[^>]*)?>([\s\S]*?)<\/t>/);
          val = tMatch ? decodeXmlEntities(tMatch[1]) : '';
        } else {
          const vMatch = inner.match(/<v>([\s\S]*?)<\/v>/);
          val = vMatch ? decodeXmlEntities(vMatch[1]) : '';
        }

        while (rowCells.length < colIdx) {
          rowCells.push('');
        }
        rowCells[colIdx] = val;
      }

      if (rowCells.some((c) => c.trim().length > 0)) {
        rows.push(rowCells);
      }
      if (rows.length >= 500) break;
    }

    sheets.push(buildSpreadsheetSheet(sheetNames[i] || `Foglio ${i + 1}`, rows));
  }

  return sheets;
}

function buildSpreadsheetSheet(name: string, allRows: string[][]): SpreadsheetSheet {
  const headers = allRows.length > 0 ? allRows[0] : [];
  const dataRows = allRows.length > 1 ? allRows.slice(1) : [];
  return {
    name,
    headers,
    rows: dataRows,
    allRows,
    totalRows: dataRows.length,
  };
}

export function parseDelimitedTextToSheet(text: string, delimiter = ',', sheetName = 'Dati'): SpreadsheetSheet {
  const lines = text.split(/\r?\n/).filter((l) => l.trim().length > 0);
  const allRows: string[][] = [];

  for (const line of lines.slice(0, 1000)) {
    const row: string[] = [];
    let current = '';
    let inQuotes = false;
    for (let i = 0; i < line.length; i++) {
      const ch = line[i];
      if (ch === '"') {
        if (inQuotes && line[i + 1] === '"') {
          current += '"';
          i++;
        } else {
          inQuotes = !inQuotes;
        }
      } else if (ch === delimiter && !inQuotes) {
        row.push(current.trim());
        current = '';
      } else {
        current += ch;
      }
    }
    row.push(current.trim());
    allRows.push(row);
  }

  return buildSpreadsheetSheet(sheetName, allRows);
}

async function parsePptxBuffer(buffer: Buffer): Promise<PresentationSlide[]> {
  const zip = await loadSafeZip(buffer);
  const slidePaths = Object.keys(zip.files)
    .filter((p) => /^ppt\/slides\/slide\d+\.xml$/i.test(p))
    .sort((a, b) => {
      const na = Number(a.match(/slide(\d+)\.xml/i)?.[1] || 0);
      const nb = Number(b.match(/slide(\d+)\.xml/i)?.[1] || 0);
      return na - nb;
    });

  const slides: PresentationSlide[] = [];

  for (let i = 0; i < slidePaths.length; i++) {
    const slideFile = zip.file(slidePaths[i]);
    if (!slideFile) continue;
    const slideXml = await readZipEntryTextLimited(slideFile);
    const slideNum = Number(slidePaths[i].match(/slide(\d+)\.xml/i)?.[1] || i + 1);

    const paragraphs: string[] = [];
    const pRegex = /<a:p\b[\s\S]*?<\/a:p>/g;
    let pMatch: RegExpExecArray | null;
    while ((pMatch = pRegex.exec(slideXml)) !== null) {
      const texts: string[] = [];
      const tRegex = /<a:t\b[^>]*>([\s\S]*?)<\/a:t>/g;
      let tMatch: RegExpExecArray | null;
      while ((tMatch = tRegex.exec(pMatch[0])) !== null) {
        texts.push(decodeXmlEntities(tMatch[1]));
      }
      const combined = texts.join('').trim();
      if (combined) paragraphs.push(combined);
    }

    let notes = '';
    const notesFile = zip.file(`ppt/notesSlides/notesSlide${slideNum}.xml`);
    if (notesFile) {
      const notesXml = await readZipEntryTextLimited(notesFile);
      const noteTexts: string[] = [];
      const ntRegex = /<a:t\b[^>]*>([\s\S]*?)<\/a:t>/g;
      let ntMatch: RegExpExecArray | null;
      while ((ntMatch = ntRegex.exec(notesXml)) !== null) {
        const val = decodeXmlEntities(ntMatch[1]).trim();
        if (val && val !== String(slideNum)) noteTexts.push(val);
      }
      notes = noteTexts.join(' ').trim();
    }

    const title = paragraphs[0] || `Slide ${slideNum}`;
    const bullets = paragraphs.slice(1);

    slides.push({
      slideNumber: slideNum,
      index: slideNum,
      title,
      bullets,
      ...(notes ? { notes } : {}),
    });
  }

  return slides;
}

export async function parseDocumentBuffer(
  arg1: string | Buffer,
  arg2: Buffer | string,
  fromTrash = false
): Promise<ParsedDocumentPreview> {
  const filename = typeof arg1 === 'string' ? arg1 : String(arg2);
  const buffer = Buffer.isBuffer(arg1) ? arg1 : Buffer.isBuffer(arg2) ? arg2 : Buffer.from(String(arg2));

  const spec = resolveFileViewerSpec(filename);
  const encoded = encodeURIComponent(filename);
  const trashQuery = fromTrash ? '&from_trash=true' : '';
  const mediaUrl = `/media/${encoded}?inline=1${trashQuery}`;
  const downloadUrl = `/media/${encoded}?download=1${trashQuery}`;

  const base: ParsedDocumentPreview = {
    ...spec,
    sizeBytes: buffer.length,
    mediaUrl,
    downloadUrl,
    blocks: [],
    sheets: [],
    slides: [],
  };

  try {
    if (spec.viewerMode === 'pdf') {
      const rawLatin = buffer.toString('latin1');
      const pageMatches = rawLatin.match(/\/Type\s*\/Page\b/g);
      const pageCount = pageMatches && pageMatches.length > 0 ? pageMatches.length : 1;
      return {
        ...base,
        pageCount,
      };
    }

    if (spec.viewerMode === 'word') {
      if (spec.extension === 'docx') {
        const zip = await loadSafeZip(buffer);
        const docFile = zip.file('word/document.xml');
        if (docFile) {
          const xml = await readZipEntryTextLimited(docFile);
          const blocks = extractWordXmlBlocks(xml);
          const allText = blocks
            .map((b) => (b.rows ? b.rows.map((r) => r.join(' ')).join(' ') : b.text || ''))
            .join(' ');
          return {
            ...base,
            blocks,
            wordCount: countWords(allText),
          };
        }
      } else if (spec.extension === 'odt') {
        const zip = await loadSafeZip(buffer);
        const contentFile = zip.file('content.xml');
        if (contentFile) {
          const xml = await readZipEntryTextLimited(contentFile);
          const blocks = extractOdtXmlBlocks(xml);
          const allText = blocks.map((b) => b.text || '').join(' ');
          return {
            ...base,
            blocks,
            wordCount: countWords(allText),
          };
        }
      } else if (spec.extension === 'rtf') {
        const blocks = parseRtfToBlocks(buffer.toString('utf-8'));
        const allText = blocks.map((b) => b.text || '').join(' ');
        return {
          ...base,
          blocks,
          wordCount: countWords(allText),
        };
      }

      // Legacy .doc fallback
      const lines = extractLegacyBinaryReadableLines(buffer);
      const blocks: DocumentBlock[] = lines.map((line) => ({ type: 'paragraph', text: line }));
      return {
        ...base,
        blocks,
        wordCount: countWords(lines.join(' ')),
      };
    }

    if (spec.viewerMode === 'spreadsheet') {
      if (spec.extension === 'xlsx') {
        const sheets = await parseXlsxBuffer(buffer);
        return {
          ...base,
          sheets,
        };
      }
      if (spec.extension === 'csv' || spec.extension === 'tsv') {
        const delim = spec.extension === 'tsv' ? '\t' : ',';
        const sheet = parseDelimitedTextToSheet(buffer.toString('utf-8'), delim, filename);
        return {
          ...base,
          sheets: [sheet],
        };
      }
      if (spec.extension === 'ods') {
        const zip = await loadSafeZip(buffer);
        const contentFile = zip.file('content.xml');
        if (contentFile) {
          const xml = await readZipEntryTextLimited(contentFile);
          const rows: string[][] = [];
          const trRegex = /<table:table-row\b[\s\S]*?<\/table:table-row>/g;
          let trMatch: RegExpExecArray | null;
          while ((trMatch = trRegex.exec(xml)) !== null) {
            const cells: string[] = [];
            const tcRegex = /<table:table-cell\b[\s\S]*?<\/table:table-cell>/g;
            let tcMatch: RegExpExecArray | null;
            while ((tcMatch = tcRegex.exec(trMatch[0])) !== null) {
              const txt = decodeXmlEntities(tcMatch[0].replace(/<[^>]+>/g, ' ')).trim();
              cells.push(txt);
            }
            if (cells.some((c) => c.length > 0)) rows.push(cells);
          }
          return {
            ...base,
            sheets: [buildSpreadsheetSheet('Foglio 1', rows)],
          };
        }
      }

      // Legacy .xls fallback
      const lines = extractLegacyBinaryReadableLines(buffer);
      const rows = lines.map((l) => [l]);
      return {
        ...base,
        sheets: [buildSpreadsheetSheet('Foglio 1', rows)],
      };
    }

    if (spec.viewerMode === 'presentation') {
      if (spec.extension === 'pptx') {
        const slides = await parsePptxBuffer(buffer);
        return {
          ...base,
          pageCount: slides.length,
          slides,
        };
      }
      if (spec.extension === 'odp') {
        const zip = await loadSafeZip(buffer);
        const contentFile = zip.file('content.xml');
        if (contentFile) {
          const xml = await readZipEntryTextLimited(contentFile);
          const slides: PresentationSlide[] = [];
          const pageRegex = /<draw:page\b[\s\S]*?<\/draw:page>/g;
          let pMatch: RegExpExecArray | null;
          let idx = 1;
          while ((pMatch = pageRegex.exec(xml)) !== null) {
            const texts = (pMatch[0].match(/<text:p\b[^>]*>([\s\S]*?)<\/text:p>/g) || [])
              .map((t) => decodeXmlEntities(t.replace(/<[^>]+>/g, '')).trim())
              .filter(Boolean);
            slides.push({
              slideNumber: idx,
              index: idx,
              title: texts[0] || `Slide ${idx}`,
              bullets: texts.slice(1),
            });
            idx++;
          }
          return {
            ...base,
            pageCount: slides.length,
            slides,
          };
        }
      }

      // Legacy .ppt fallback
      const lines = extractLegacyBinaryReadableLines(buffer);
      const slides: PresentationSlide[] = [];
      for (let i = 0; i < lines.length; i += 5) {
        const chunk = lines.slice(i, i + 5);
        const sNum = slides.length + 1;
        slides.push({
          slideNumber: sNum,
          index: sNum,
          title: chunk[0] || `Slide ${sNum}`,
          bullets: chunk.slice(1),
        });
      }
      return {
        ...base,
        pageCount: slides.length,
        slides,
      };
    }

    if (spec.viewerMode === 'text') {
      const rawText = buffer.subarray(0, 512 * 1024).toString('utf-8');
      let formattedText = rawText;
      if (spec.extension === 'json') {
        try {
          formattedText = JSON.stringify(JSON.parse(rawText), null, 2);
        } catch {
          // keep raw text if invalid JSON
        }
      }
      const lineCount = formattedText.split(/\r?\n/).length;
      return {
        ...base,
        textContent: formattedText,
        rawText: formattedText,
        lineCount,
        wordCount: countWords(formattedText),
      };
    }

    return base;
  } catch {
    return {
      ...base,
      warning:
        "Impossibile analizzare la struttura interna del documento. Puoi comunque aprirlo con un'applicazione esterna o scaricarlo.",
    };
  }
}
