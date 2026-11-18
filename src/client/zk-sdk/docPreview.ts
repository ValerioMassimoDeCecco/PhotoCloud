import JSZip from 'jszip';
import { utf8Decode } from '../../lib/zk/index.ts';
import type { ZkItemCategory } from './types.ts';

// ============================================================================
// Allowlist MIME & Anti-Zip-Bomb Document Preview (Fase 3.3 & 3.4)
// ============================================================================

export const MAX_PREVIEW_ZIP_ENTRIES = 500;
export const MAX_PREVIEW_SINGLE_ENTRY_BYTES = 8 * 1024 * 1024; // 8 MiB
export const MAX_PREVIEW_TOTAL_UNCOMPRESSED_BYTES = 24 * 1024 * 1024; // 24 MiB

const SAFE_RASTER_IMAGE_MIMES = new Set([
  'image/jpeg',
  'image/png',
  'image/webp',
  'image/gif',
  'image/bmp',
  'image/avif',
]);

const SAFE_VIDEO_MIMES = new Set([
  'video/mp4',
  'video/webm',
  'video/ogg',
  'video/quicktime',
  'video/x-matroska',
]);

const SAFE_AUDIO_MIMES = new Set([
  'audio/mpeg',
  'audio/mp4',
  'audio/wav',
  'audio/ogg',
  'audio/flac',
  'audio/aac',
  'audio/opus',
]);

/**
 * Restituisce true solo per formati immagine raster sicuri per `<img src="blob:...">`.
 */
export function isSafeRasterImageMime(mime: string): boolean {
  const clean = (mime || '').split(';')[0].trim().toLowerCase();
  return SAFE_RASTER_IMAGE_MIMES.has(clean);
}

/**
 * SVG è trattato separatamente: può essere mostrato SOLO dentro un elemento `<img>`
 * isolato (mai inline `<svg>`, `<iframe src>`, `<object>` o `<embed>`) oppure scaricato.
 */
export function isSvgMime(mime: string, filename = ''): boolean {
  const clean = (mime || '').split(';')[0].trim().toLowerCase();
  return clean === 'image/svg+xml' || filename.toLowerCase().endsWith('.svg');
}

/**
 * HTML, XHTML e script non vengono MAI renderizzati come documento attivo:
 * possono essere visualizzati solo come codice sorgente via `textContent` o scaricati.
 */
export function isUntrustedActiveMime(mime: string, filename = ''): boolean {
  const clean = (mime || '').split(';')[0].trim().toLowerCase();
  const lower = filename.toLowerCase();
  return (
    clean === 'text/html' ||
    clean === 'application/xhtml+xml' ||
    clean === 'text/javascript' ||
    clean === 'application/javascript' ||
    lower.endsWith('.html') ||
    lower.endsWith('.htm') ||
    lower.endsWith('.xhtml') ||
    lower.endsWith('.js') ||
    lower.endsWith('.mjs')
  );
}

export function isSafeVideoMime(mime: string): boolean {
  const clean = (mime || '').split(';')[0].trim().toLowerCase();
  return SAFE_VIDEO_MIMES.has(clean);
}

export function isSafeAudioMime(mime: string): boolean {
  const clean = (mime || '').split(';')[0].trim().toLowerCase();
  return SAFE_AUDIO_MIMES.has(clean);
}

export function classifyItemCategory(mime: string, filename = ''): ZkItemCategory {
  const clean = (mime || '').split(';')[0].trim().toLowerCase();
  const ext = (filename.split('.').pop() || '').toLowerCase();

  if (clean.startsWith('image/') || ['jpg', 'jpeg', 'png', 'webp', 'gif', 'bmp', 'avif', 'svg', 'heic'].includes(ext)) {
    return 'photo';
  }
  if (clean.startsWith('video/') || ['mp4', 'webm', 'mov', 'mkv', 'avi'].includes(ext)) {
    return 'video';
  }
  if (clean.startsWith('audio/') || ['mp3', 'wav', 'ogg', 'flac', 'm4a', 'aac', 'opus'].includes(ext)) {
    return 'audio';
  }
  if (
    clean === 'application/pdf' ||
    clean.includes('word') ||
    clean.includes('spreadsheet') ||
    clean.includes('presentation') ||
    clean.includes('opendocument') ||
    clean.startsWith('text/') ||
    ['pdf', 'doc', 'docx', 'odt', 'rtf', 'xls', 'xlsx', 'ods', 'csv', 'tsv', 'ppt', 'pptx', 'odp', 'txt', 'md', 'json', 'xml', 'yaml', 'yml', 'log'].includes(ext)
  ) {
    return 'document';
  }
  if (
    clean.includes('zip') ||
    clean.includes('tar') ||
    clean.includes('rar') ||
    clean.includes('7z') ||
    ['zip', 'rar', '7z', 'tar', 'gz', 'apk', 'iso'].includes(ext)
  ) {
    return 'archive';
  }
  return 'other';
}

export interface ClientDocumentPreviewResult {
  kind: 'pdf' | 'office' | 'text' | 'unsupported';
  title: string;
  paragraphs: string[];
  warning?: string;
}

function stripXmlTagsToPlainText(xml: string): string[] {
  return xml
    .replace(/<\/(w:p|text:p|a:p|row|tr)>/gi, '\n')
    .replace(/<[^>]+>/g, ' ')
    .split('\n')
    .map((line) => line.replace(/\s+/g, ' ').trim())
    .filter((line) => line.length > 0)
    .slice(0, 500);
}

/**
 * Estrae un'anteprima testuale sicura da file Office (`.docx`, `.odt`, `.xlsx`, `.pptx`) o testo
 * sul client, imponendo limiti rigorosi anti-zip-bomb (`MAX_PREVIEW_ZIP_ENTRIES`,
 * `MAX_PREVIEW_SINGLE_ENTRY_BYTES`, `MAX_PREVIEW_TOTAL_UNCOMPRESSED_BYTES`).
 */
export async function parseClientDocumentPreview(
  bytes: Uint8Array,
  filename: string,
  mimeType: string
): Promise<ClientDocumentPreviewResult> {
  const ext = (filename.split('.').pop() || '').toLowerCase();
  const cleanMime = (mimeType || '').split(';')[0].trim().toLowerCase();

  if (cleanMime === 'application/pdf' || ext === 'pdf') {
    const headerAscii = utf8Decode(bytes.subarray(0, Math.min(bytes.byteLength, 64 * 1024)));
    const versionMatch = /^%PDF-(\d+\.\d+)/.exec(headerAscii);
    const pdfVersion = versionMatch ? versionMatch[1] : '1.x';
    const pageMatches = headerAscii.match(/\/Type\s*\/Page\b/g);
    const pageCount = pageMatches ? pageMatches.length : 1;
    const textSnippets: string[] = [
      `Documento PDF verificato (PDF v${pdfVersion}, ~${pageCount} pag., ${bytes.byteLength} byte)`,
    ];
    const literalRegex = /\(([^()\\]{2,160})\)\s*Tj/g;
    let m: RegExpExecArray | null;
    while ((m = literalRegex.exec(headerAscii)) !== null) {
      const cleaned = m[1].replace(/[^\x20-\x7EÀ-ÿ]/g, '').trim();
      if (cleaned.length > 0) {
        textSnippets.push(cleaned);
      }
      if (textSnippets.length >= 50) break;
    }
    return {
      kind: 'pdf',
      title: filename,
      paragraphs: textSnippets,
    };
  }

  if (['docx', 'odt', 'xlsx', 'ods', 'pptx', 'odp'].includes(ext)) {
    if (bytes.byteLength > MAX_PREVIEW_TOTAL_UNCOMPRESSED_BYTES) {
      throw new Error('ZIP_BOMB_LIMIT_EXCEEDED: Archivio documento troppo grande per anteprima.');
    }
    const zip = await JSZip.loadAsync(bytes);
    const fileEntries = Object.values(zip.files).filter((f) => !f.dir);
    if (fileEntries.length > MAX_PREVIEW_ZIP_ENTRIES) {
      throw new Error(
        `ZIP_BOMB_LIMIT_EXCEEDED: Numero di voci (${fileEntries.length}) superiore al limite (${MAX_PREVIEW_ZIP_ENTRIES}).`
      );
    }

    let totalUncompressed = 0;
    const paragraphs: string[] = [];

    for (const entry of fileEntries) {
      const targetXml =
        entry.name === 'word/document.xml' ||
        entry.name === 'content.xml' ||
        entry.name === 'xl/sharedStrings.xml' ||
        /^xl\/worksheets\/sheet\d+\.xml$/i.test(entry.name) ||
        /^ppt\/slides\/slide\d+\.xml$/i.test(entry.name);

      if (!targetXml) continue;

      const rawData = await entry.async('uint8array');
      if (rawData.byteLength > MAX_PREVIEW_SINGLE_ENTRY_BYTES) {
        throw new Error('ZIP_BOMB_LIMIT_EXCEEDED: Voce interna supera il limite di 8 MiB.');
      }
      totalUncompressed += rawData.byteLength;
      if (totalUncompressed > MAX_PREVIEW_TOTAL_UNCOMPRESSED_BYTES) {
        throw new Error('ZIP_BOMB_LIMIT_EXCEEDED: Dimensione decompressa totale supera 24 MiB.');
      }

      const xmlText = utf8Decode(rawData);
      paragraphs.push(...stripXmlTagsToPlainText(xmlText));
      if (paragraphs.length >= 500) break;
    }

    return {
      kind: 'office',
      title: filename,
      paragraphs: paragraphs.slice(0, 500),
    };
  }

  if (
    cleanMime.startsWith('text/') ||
    ['txt', 'md', 'csv', 'tsv', 'json', 'xml', 'yaml', 'yml', 'log', 'html', 'htm', 'js', 'ts', 'py', 'kt'].includes(ext)
  ) {
    const sliced = bytes.subarray(0, Math.min(bytes.byteLength, 256 * 1024));
    const lines = utf8Decode(sliced).split(/\r?\n/).slice(0, 1000);
    return {
      kind: 'text',
      title: filename,
      paragraphs: lines,
    };
  }

  return {
    kind: 'unsupported',
    title: filename,
    paragraphs: [],
    warning: 'Formato binario: usa il pulsante Scarica per aprirlo con un applicazione esterna.',
  };
}
