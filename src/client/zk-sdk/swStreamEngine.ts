import {
  computeBlobRangePlan,
  decryptBlobRange,
  parsePczkHeader,
  PCZK_HEADER_LENGTH,
  zeroize,
} from '../../lib/zk/index.ts';

export const DEFAULT_SW_TICKET_TTL_MS = 5 * 60 * 1000; // 5 minuti

export interface SwVideoTicketEntry {
  blobId: string;
  clientId: string;
  fileKey: Uint8Array;
  headerBytes: Uint8Array;
  totalCiphertextBytes: number;
  totalPlaintextBytes: number;
  chunkSizeLog2: number;
  mime: string;
  expiresAt: number;
}

export interface RegisterSwVideoTicketInput {
  clientId: string;
  clientUrl: string;
  swOrigin: string;
  blobId: string;
  fileKey: Uint8Array;
  headerBytes: Uint8Array;
  totalCiphertextBytes: number;
  mime?: string;
  ttlMs?: number;
}

export interface HandleSwStreamRequestInput {
  blobId: string;
  clientId: string;
  clientUrl?: string;
  swOrigin: string;
  rangeHeader?: string | null;
  fetchCiphertextRange: (blobId: string, startByte: number, endByteInclusive: number) => Promise<Uint8Array>;
}

export interface SwStreamResponseResult {
  status: number;
  headers: Record<string, string>;
  body: Uint8Array;
  errorText?: string;
}

const UUID_V4_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export function isClientUrlInV2Scope(clientUrlRaw: string, swOrigin: string): boolean {
  try {
    const u = new URL(clientUrlRaw);
    const originUrl = new URL(swOrigin);
    if (u.origin !== originUrl.origin) return false;
    return u.pathname === '/v2' || u.pathname.startsWith('/v2/');
  } catch {
    return false;
  }
}

/**
 * Motore di gestione dei ticket video per il Service Worker `/v2/sw-stream.js`.
 *
 * Invarianti di sicurezza (Requisito 4.0.3):
 * 1. Ogni ticket è vincolato alla coppia `(blobId, clientId)`.
 * 2. È accettato esclusivamente da client appartenenti alla scope `/v2/`.
 * 3. Vale per tutte le richieste `Range` su quel `blobId` dallo stesso `clientId`
 *    finché non scade (`ttlMs`) o non arriva `LOCK_ALL_KEYS`.
 * 4. Non riceve mai `vaultKey` né `fkWrapKey`, ma solo la `fileKey` (32 B) del singolo blob.
 * 5. Ogni risposta include `Cache-Control: no-store` e non usa mai la Cache API sul plaintext.
 */
export class ZkSwStreamEngine {
  private readonly tickets = new Map<string, SwVideoTicketEntry>();
  private readonly nowFn: () => number;

  public constructor(nowFn: () => number = () => Date.now()) {
    this.nowFn = nowFn;
  }

  private static makeKey(clientId: string, blobId: string): string {
    return `${clientId.trim()}|${blobId.trim().toLowerCase()}`;
  }

  public purgeExpired(): void {
    const now = this.nowFn();
    for (const [k, entry] of this.tickets.entries()) {
      if (now >= entry.expiresAt) {
        zeroize(entry.fileKey);
        this.tickets.delete(k);
      }
    }
  }

  public registerTicket(input: RegisterSwVideoTicketInput): { ok: boolean; error?: string } {
    this.purgeExpired();

    const clientId = String(input.clientId || '').trim();
    if (!clientId) {
      return { ok: false, error: 'MISSING_CLIENT_ID' };
    }
    if (!isClientUrlInV2Scope(input.clientUrl, input.swOrigin)) {
      return { ok: false, error: 'CLIENT_OUTSIDE_V2_SCOPE' };
    }

    const blobId = String(input.blobId || '').trim().toLowerCase();
    if (!UUID_V4_RE.test(blobId)) {
      return { ok: false, error: 'INVALID_BLOB_ID' };
    }
    if (!(input.fileKey instanceof Uint8Array) || input.fileKey.byteLength !== 32) {
      return { ok: false, error: 'INVALID_FILE_KEY' };
    }
    if (!(input.headerBytes instanceof Uint8Array) || input.headerBytes.byteLength < PCZK_HEADER_LENGTH) {
      return { ok: false, error: 'INVALID_HEADER_BYTES' };
    }

    let parsedHeader;
    try {
      parsedHeader = parsePczkHeader(input.headerBytes);
    } catch {
      return { ok: false, error: 'MALFORMED_PCZK_HEADER' };
    }
    if (parsedHeader.blobId !== blobId) {
      return { ok: false, error: 'HEADER_BLOB_ID_MISMATCH' };
    }

    let totalPlaintextBytes = 0;
    try {
      const plan = computeBlobRangePlan({
        totalCiphertextBytes: input.totalCiphertextBytes,
        chunkSizeLog2: parsedHeader.chunkSizeLog2,
        startPlaintextByte: 0,
        endPlaintextByteInclusive: 0,
      });
      totalPlaintextBytes = plan.totalPlaintextBytes;
    } catch {
      totalPlaintextBytes = 0;
    }

    const mapKey = ZkSwStreamEngine.makeKey(clientId, blobId);
    const existing = this.tickets.get(mapKey);
    if (existing) {
      zeroize(existing.fileKey);
    }

    const ttlMs =
      typeof input.ttlMs === 'number' && input.ttlMs > 0 ? input.ttlMs : DEFAULT_SW_TICKET_TTL_MS;

    this.tickets.set(mapKey, {
      blobId,
      clientId,
      fileKey: new Uint8Array(input.fileKey),
      headerBytes: new Uint8Array(input.headerBytes.subarray(0, PCZK_HEADER_LENGTH)),
      totalCiphertextBytes: input.totalCiphertextBytes,
      totalPlaintextBytes,
      chunkSizeLog2: parsedHeader.chunkSizeLog2,
      mime: input.mime || 'video/mp4',
      expiresAt: this.nowFn() + ttlMs,
    });

    return { ok: true };
  }

  public lockAllKeys(): void {
    for (const entry of this.tickets.values()) {
      zeroize(entry.fileKey);
    }
    this.tickets.clear();
  }

  public getActiveTicketCount(): number {
    this.purgeExpired();
    return this.tickets.size;
  }

  public async handleStreamRequest(input: HandleSwStreamRequestInput): Promise<SwStreamResponseResult> {
    this.purgeExpired();

    const noStoreHeaders: Record<string, string> = {
      'Cache-Control': 'no-store',
      'X-Content-Type-Options': 'nosniff',
    };

    const clientId = String(input.clientId || '').trim();
    const blobId = String(input.blobId || '').trim().toLowerCase();
    if (!clientId || !UUID_V4_RE.test(blobId)) {
      const msg = new TextEncoder().encode('STREAM_TICKET_MISSING_OR_INVALID');
      return {
        status: 403,
        headers: { ...noStoreHeaders, 'Content-Type': 'text/plain; charset=utf-8' },
        body: msg,
        errorText: 'STREAM_TICKET_MISSING_OR_INVALID',
      };
    }

    if (input.clientUrl !== undefined && !isClientUrlInV2Scope(input.clientUrl, input.swOrigin)) {
      const msg = new TextEncoder().encode('CLIENT_OUTSIDE_V2_SCOPE');
      return {
        status: 403,
        headers: { ...noStoreHeaders, 'Content-Type': 'text/plain; charset=utf-8' },
        body: msg,
        errorText: 'CLIENT_OUTSIDE_V2_SCOPE',
      };
    }

    const mapKey = ZkSwStreamEngine.makeKey(clientId, blobId);
    const ticket = this.tickets.get(mapKey);
    if (!ticket) {
      const msg = new TextEncoder().encode('STREAM_TICKET_NOT_REGISTERED');
      return {
        status: 403,
        headers: { ...noStoreHeaders, 'Content-Type': 'text/plain; charset=utf-8' },
        body: msg,
        errorText: 'STREAM_TICKET_NOT_REGISTERED',
      };
    }

    const totalSize = ticket.totalPlaintextBytes;
    const rangeHeader = input.rangeHeader ? input.rangeHeader.trim() : '';
    let startByte = 0;
    let endByte = Math.max(0, totalSize - 1);
    let isRange = false;

    if (rangeHeader) {
      if (!/^bytes=\d*-\d*$/i.test(rangeHeader)) {
        return {
          status: 416,
          headers: {
            ...noStoreHeaders,
            'Content-Range': `bytes */${totalSize}`,
          },
          body: new Uint8Array(0),
          errorText: 'INVALID_RANGE',
        };
      }
      isRange = true;
      const [startStr, endStr] = rangeHeader.slice(6).split('-');
      if (startStr === '' && endStr === '') {
        return {
          status: 416,
          headers: { ...noStoreHeaders, 'Content-Range': `bytes */${totalSize}` },
          body: new Uint8Array(0),
          errorText: 'INVALID_RANGE',
        };
      }
      if (startStr === '') {
        const suffix = Number(endStr);
        if (!Number.isSafeInteger(suffix) || suffix <= 0) {
          return {
            status: 416,
            headers: { ...noStoreHeaders, 'Content-Range': `bytes */${totalSize}` },
            body: new Uint8Array(0),
            errorText: 'INVALID_RANGE',
          };
        }
        startByte = Math.max(0, totalSize - suffix);
        endByte = Math.max(0, totalSize - 1);
      } else {
        startByte = Number(startStr);
        endByte = endStr !== '' ? Math.min(Number(endStr), totalSize - 1) : totalSize - 1;
      }

      if (
        !Number.isSafeInteger(startByte) ||
        !Number.isSafeInteger(endByte) ||
        startByte < 0 ||
        startByte > endByte ||
        startByte >= totalSize
      ) {
        return {
          status: 416,
          headers: { ...noStoreHeaders, 'Content-Range': `bytes */${totalSize}` },
          body: new Uint8Array(0),
          errorText: 'RANGE_NOT_SATISFIABLE',
        };
      }
    }

    if (totalSize === 0) {
      return {
        status: isRange ? 206 : 200,
        headers: {
          ...noStoreHeaders,
          'Content-Type': ticket.mime,
          'Accept-Ranges': 'bytes',
          'Content-Length': '0',
        },
        body: new Uint8Array(0),
      };
    }

    try {
      const plaintextSlice = await decryptBlobRange({
        headerBytes: ticket.headerBytes,
        totalCiphertextBytes: ticket.totalCiphertextBytes,
        startPlaintextByte: startByte,
        endPlaintextByteInclusive: endByte,
        unwrappedFileKey: ticket.fileKey,
        expectedBlobId: ticket.blobId,
        fetchCiphertextRange: (cStart, cEndInclusive) =>
          input.fetchCiphertextRange(ticket.blobId, cStart, cEndInclusive),
      });

      const headers: Record<string, string> = {
        ...noStoreHeaders,
        'Content-Type': ticket.mime,
        'Accept-Ranges': 'bytes',
        'Content-Length': String(plaintextSlice.byteLength),
      };
      if (isRange) {
        headers['Content-Range'] = `bytes ${startByte}-${endByte}/${totalSize}`;
      }

      return {
        status: isRange ? 206 : 200,
        headers,
        body: plaintextSlice,
      };
    } catch {
      const msg = new TextEncoder().encode('STREAM_GCM_VERIFICATION_FAILED');
      return {
        status: 502,
        headers: { ...noStoreHeaders, 'Content-Type': 'text/plain; charset=utf-8' },
        body: msg,
        errorText: 'STREAM_GCM_VERIFICATION_FAILED',
      };
    }
  }
}
