import fs from 'node:fs';
import { Request, Response } from 'express';
import { decryptFileAsync } from './crypto';
import { resolveFileViewerSpec } from './documentEngine';

export const ACTIVE_SCRIPT_EXTS = new Set(['html', 'htm', 'xhtml', 'xml', 'js', 'mjs', 'svg']);

/**
 * Parses an HTTP `Range: bytes=...` header according to RFC 9110.
 * Supports explicit ranges (`start-end`), open-ended ranges (`start-`),
 * and suffix ranges (`-suffixLength`).
 */
export function parseHttpByteRange(
  rangeHeader: string | undefined,
  totalLength: number
): { status: 'none' } | { status: 'invalid' } | { status: 'ok'; start: number; end: number } {
  if (!rangeHeader || !rangeHeader.startsWith('bytes=')) {
    return { status: 'none' };
  }
  if (totalLength <= 0) {
    return { status: 'invalid' };
  }
  const spec = rangeHeader.slice('bytes='.length).split(',')[0].trim();
  const dashIdx = spec.indexOf('-');
  if (dashIdx === -1) {
    return { status: 'invalid' };
  }
  const startStr = spec.slice(0, dashIdx).trim();
  const endStr = spec.slice(dashIdx + 1).trim();

  if (startStr === '') {
    // Suffix byte-range-spec: bytes=-N (last N bytes)
    if (!/^[0-9]+$/.test(endStr)) return { status: 'invalid' };
    const suffixLength = parseInt(endStr, 10);
    if (Number.isNaN(suffixLength) || suffixLength <= 0) {
      return { status: 'invalid' };
    }
    const start = Math.max(0, totalLength - suffixLength);
    const end = totalLength - 1;
    return { status: 'ok', start, end };
  }

  if (!/^[0-9]+$/.test(startStr)) return { status: 'invalid' };
  const start = parseInt(startStr, 10);
  if (Number.isNaN(start) || start < 0 || start >= totalLength) {
    return { status: 'invalid' };
  }

  let end = totalLength - 1;
  if (endStr !== '') {
    if (!/^[0-9]+$/.test(endStr)) return { status: 'invalid' };
    const parsedEnd = parseInt(endStr, 10);
    if (Number.isNaN(parsedEnd) || parsedEnd < start) {
      return { status: 'invalid' };
    }
    end = Math.min(totalLength - 1, parsedEnd);
  }

  return { status: 'ok', start, end };
}

export async function readAndDecryptVaultFile(filePath: string, apiKey: string): Promise<Buffer> {
  const encrypted = await fs.promises.readFile(filePath);
  return decryptFileAsync(encrypted, apiKey);
}

export interface StreamVaultFileOptions {
  filePath: string;
  filename: string;
  apiKey: string;
  isExplicitDownload?: boolean;
  allowInlineSvgForImageFetch?: boolean;
  onBeforeSend?: () => void;
}

export async function streamDecryptedVaultFile(
  req: Request,
  res: Response,
  options: StreamVaultFileOptions
): Promise<void> {
  const {
    filePath,
    filename,
    apiKey,
    isExplicitDownload = false,
    allowInlineSvgForImageFetch = false,
    onBeforeSend,
  } = options;

  try {
    const decrypted = await readAndDecryptVaultFile(filePath, apiKey);
    const spec = resolveFileViewerSpec(filename);
    const isDangerousExt = ACTIVE_SCRIPT_EXTS.has(spec.extension);

    // Sandbox responses so active scripts can NEVER execute in the origin context
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader(
      'Content-Security-Policy',
      "default-src 'none'; img-src 'self' data:; media-src 'self'; style-src 'unsafe-inline'; sandbox"
    );
    res.setHeader('Accept-Ranges', 'bytes');

    if (isExplicitDownload || isDangerousExt) {
      const safeMime =
        allowInlineSvgForImageFetch &&
        spec.extension === 'svg' &&
        req.headers['sec-fetch-dest'] === 'image'
          ? 'image/svg+xml'
          : isDangerousExt && !isExplicitDownload
          ? 'text/plain; charset=utf-8'
          : spec.mimeType;
      res.setHeader('Content-Type', safeMime);
      res.setHeader(
        'Content-Disposition',
        `attachment; filename="${encodeURIComponent(filename)}"`
      );
    } else {
      res.setHeader('Content-Type', spec.mimeType);
      res.setHeader(
        'Content-Disposition',
        `inline; filename="${encodeURIComponent(filename)}"`
      );
    }

    const parsedRange = parseHttpByteRange(req.headers.range, decrypted.length);
    if (parsedRange.status === 'invalid') {
      res.status(416);
      res.setHeader('Content-Range', `bytes */${decrypted.length}`);
      res.end();
      return;
    }

    if (onBeforeSend) {
      onBeforeSend();
    }
    if (parsedRange.status === 'ok') {
      const chunk = decrypted.subarray(parsedRange.start, parsedRange.end + 1);
      res.status(206);
      res.setHeader('Content-Range', `bytes ${parsedRange.start}-${parsedRange.end}/${decrypted.length}`);
      res.setHeader('Content-Length', String(chunk.length));
      res.send(chunk);
      return;
    }

    res.setHeader('Content-Length', String(decrypted.length));
    res.send(decrypted);
  } catch {
    res.status(500).send('Errore durante la decrittografia.');
  }
}
