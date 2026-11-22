import {
  DEFAULT_CHUNK_SIZE_LOG2,
  PCZK_GCM_TAG_LENGTH,
  PCZK_HEADER_LENGTH,
  ZkCryptoError,
  ZkErrorCode,
  ZkWorkerClient,
  computeBlobRangePlan,
  computeDedupTag,
  decryptAlbums,
  decryptBlobRange,
  decryptBlobStream,
  decryptBlobToBytes,
  decryptMeta,
  decryptThumbnail,
  defaultCryptoProvider,
  deriveSubkeys,
  encryptAlbums,
  encryptBlobStream,
  encryptMeta,
  encryptThumbnail,
  fromBase64Url,
  parsePczkHeader,
  toBase64Url,
  toHex,
  unwrapFileKey,
  unwrapFileKeyForShare,
  unwrapVaultKey,
  wrapFileKeyForShare,
  wrapVaultKey,
  zeroize,
  type AlbumCatalogPlaintext,
  type Argon2idParams,
  type BlobPlaintextMeta,
  type ParsedPczkHeader,
  type VaultSubkeys,
} from '../../lib/zk/index.ts';
import { parseNaturalQuery } from '../../lib/nlSearch.ts';
import { classifyItemCategory } from './docPreview.ts';
import {
  DEFAULT_CLIENT_KDF_PARAMS,
  InMemoryKdfPinningStore,
  checkAndPinKdfParameters,
  evaluatePassphraseStrength,
  formatRecoveryCode,
  parseRecoveryCodeToAccountKey,
  validateKdfParamsFloor,
  verifyRecoveryCodeConfirmation,
  type KdfPinningStore,
} from './kdfPolicy.ts';
import {
  buildShareUrl,
  decryptOwnerShareMeta,
  decryptShareItemMeta,
  decryptShareManifest,
  encryptOwnerShareMeta,
  encryptShareItemMeta,
  encryptShareManifest,
  parseShareUrlFragment,
  unwrapShareKeyWithPassword,
  wrapShareKeyWithPassword,
} from './shareCrypto.ts';
import { generateZipStream } from './zipStream.ts';
import type {
  AuthConfigV2,
  CreateShareOptionsV2,
  CreateShareResultV2,
  DecryptedAlbumCatalogV2,
  DecryptedAlbumV2,
  DecryptedItemV2,
  OpenedShareV2,
  OwnerShareSummaryV2,
  PasswordWrappedShareKeyV2,
  PreparedRegistrationV2,
  ServerItemV2,
  ServerStatsResponseV2,
  ShareManifestEntryV2,
  ShareManifestPayloadV2,
  TimelineGroupModeV2,
  TimelineGroupV2,
  TransferControllerV2,
  TransferProgressV2,
  TransferStatusV2,
  UploadFileInputV2,
  UploadFileOptionsV2,
  VaultDetailedStatsV2,
  ZkKeyFileV2,
} from './types.ts';
import {
  applyTransportModeToUrl,
  normalizeTransportMode,
  resolveOriginForTransportMode,
  TRANSPORT_MODE_HEADER,
  type TransportProtocolMode,
} from './transportMode.ts';

export const UNIFORM_AUTH_ERROR_MESSAGE = 'Credenziali o keyfile non validi.';

export interface ZkVaultClientOptions {
  baseUrl?: string;
  transportMode?: TransportProtocolMode;
  fetchFn?: typeof fetch;
  workerClient?: ZkWorkerClient;
  pinningStore?: KdfPinningStore;
  autoLockTimeoutMs?: number;
  onAutoLock?: () => void;
  onKdfParamsChangedWarning?: (details: {
    username: string;
    previousSalt: string;
    newSalt: string;
    previousParams: { memoryKiB: number; iterations: number; parallelism: number };
    newParams: { memoryKiB: number; iterations: number; parallelism: number };
  }) => void;
}

export function parseClientJpegExif(
  bytes: Uint8Array,
  includeGps = false
): {
  takenAtMs: number | null;
  make: string | null;
  model: string | null;
  camera: string | null;
  iso: number | null;
  focalLengthMm: number | null;
  apertureFNumber: number | null;
  exposureTimeSec: number | null;
  gps: { lat: number; lon: number; alt?: number } | null;
} {
  const empty = {
    takenAtMs: null,
    make: null,
    model: null,
    camera: null,
    iso: null,
    focalLengthMm: null,
    apertureFNumber: null,
    exposureTimeSec: null,
    gps: null,
  };
  if (bytes.byteLength < 12 || bytes[0] !== 0xff || bytes[1] !== 0xd8) {
    return empty;
  }
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let offset = 2;
  let tiffBase = -1;
  let tiffEnd = -1;

  while (offset + 4 <= bytes.byteLength) {
    if (bytes[offset] !== 0xff) break;
    const marker = bytes[offset + 1];
    if (marker === 0xda || marker === 0xd9) break;
    const segLen = view.getUint16(offset + 2, false);
    if (segLen < 2 || offset + 2 + segLen > bytes.byteLength) break;
    if (
      marker === 0xe1 &&
      segLen >= 8 &&
      bytes[offset + 4] === 0x45 &&
      bytes[offset + 5] === 0x78 &&
      bytes[offset + 6] === 0x69 &&
      bytes[offset + 7] === 0x66 &&
      bytes[offset + 8] === 0x00 &&
      bytes[offset + 9] === 0x00
    ) {
      tiffBase = offset + 10;
      tiffEnd = offset + 2 + segLen;
      break;
    }
    offset += 2 + segLen;
  }

  if (tiffBase < 0 || tiffBase + 8 > tiffEnd) return empty;
  const byteOrder = view.getUint16(tiffBase, false);
  const le = byteOrder === 0x4949;
  if (!le && byteOrder !== 0x4d4d) return empty;
  if (view.getUint16(tiffBase + 2, le) !== 0x002a) return empty;
  const ifd0Rel = view.getUint32(tiffBase + 4, le);
  if (ifd0Rel < 8 || tiffBase + ifd0Rel >= tiffEnd) return empty;

  const readAscii = (relOffset: number, count: number): string => {
    const abs = tiffBase + relOffset;
    if (abs < tiffBase || abs + count > tiffEnd) return '';
    let s = '';
    for (let i = 0; i < count; i++) {
      const ch = bytes[abs + i];
      if (ch === 0) break;
      s += String.fromCharCode(ch);
    }
    return s.trim();
  };

  const readRational = (relOffset: number): number | null => {
    const abs = tiffBase + relOffset;
    if (abs < tiffBase || abs + 8 > tiffEnd) return null;
    const num = view.getUint32(abs, le);
    const den = view.getUint32(abs + 4, le);
    if (den === 0) return null;
    return num / den;
  };

  let make = '';
  let model = '';
  let dateTimeStr = '';
  let iso: number | null = null;
  let focalLengthMm: number | null = null;
  let apertureFNumber: number | null = null;
  let exposureTimeSec: number | null = null;
  let exifIfdRel = 0;
  let gpsIfdRel = 0;

  const parseIfd = (ifdRel: number, mode: 'ifd0' | 'exif') => {
    const abs = tiffBase + ifdRel;
    if (abs + 2 > tiffEnd) return;
    const entries = view.getUint16(abs, le);
    for (let i = 0; i < entries; i++) {
      const entryOff = abs + 2 + i * 12;
      if (entryOff + 12 > tiffEnd) break;
      const tag = view.getUint16(entryOff, le);
      const type = view.getUint16(entryOff + 2, le);
      const count = view.getUint32(entryOff + 4, le);
      const byteSize = count * (type === 5 || type === 10 ? 8 : type === 3 ? 2 : type === 4 ? 4 : 1);
      const valRel = byteSize <= 4 ? entryOff + 8 - tiffBase : view.getUint32(entryOff + 8, le);

      if (mode === 'ifd0') {
        if (tag === 0x010f && type === 2) make = readAscii(valRel, count);
        else if (tag === 0x0110 && type === 2) model = readAscii(valRel, count);
        else if (tag === 0x0132 && type === 2 && !dateTimeStr) dateTimeStr = readAscii(valRel, count);
        else if (tag === 0x8769 && (type === 4 || type === 3)) exifIfdRel = view.getUint32(entryOff + 8, le);
        else if (tag === 0x8825 && (type === 4 || type === 3)) gpsIfdRel = view.getUint32(entryOff + 8, le);
      } else if (mode === 'exif') {
        if (tag === 0x9003 && type === 2) dateTimeStr = readAscii(valRel, count);
        else if (tag === 0x8827) {
          iso = type === 3 ? view.getUint16(entryOff + 8, le) : view.getUint32(entryOff + 8, le);
        } else if (tag === 0x920a && type === 5) focalLengthMm = readRational(valRel);
        else if (tag === 0x829d && type === 5) apertureFNumber = readRational(valRel);
        else if (tag === 0x829a && type === 5) exposureTimeSec = readRational(valRel);
      }
    }
  };

  parseIfd(ifd0Rel, 'ifd0');
  if (exifIfdRel > 0) parseIfd(exifIfdRel, 'exif');

  let gps: { lat: number; lon: number; alt?: number } | null = null;
  if (includeGps && gpsIfdRel > 0) {
    const abs = tiffBase + gpsIfdRel;
    if (abs + 2 <= tiffEnd) {
      const entries = view.getUint16(abs, le);
      let latRef = 'N';
      let lonRef = 'E';
      let latVals: number[] | null = null;
      let lonVals: number[] | null = null;
      for (let i = 0; i < entries; i++) {
        const entryOff = abs + 2 + i * 12;
        if (entryOff + 12 > tiffEnd) break;
        const tag = view.getUint16(entryOff, le);
        const type = view.getUint16(entryOff + 2, le);
        const count = view.getUint32(entryOff + 4, le);
        const valRel = view.getUint32(entryOff + 8, le);
        if (tag === 0x0001 && type === 2) latRef = readAscii(entryOff + 8 - tiffBase, 2) || 'N';
        else if (tag === 0x0003 && type === 2) lonRef = readAscii(entryOff + 8 - tiffBase, 2) || 'E';
        else if (tag === 0x0002 && type === 5 && count === 3) {
          const d = readRational(valRel);
          const m = readRational(valRel + 8);
          const s = readRational(valRel + 16);
          if (d !== null && m !== null && s !== null) latVals = [d, m, s];
        } else if (tag === 0x0004 && type === 5 && count === 3) {
          const d = readRational(valRel);
          const m = readRational(valRel + 8);
          const s = readRational(valRel + 16);
          if (d !== null && m !== null && s !== null) lonVals = [d, m, s];
        }
      }
      if (latVals && lonVals) {
        let lat = latVals[0] + latVals[1] / 60 + latVals[2] / 3600;
        let lon = lonVals[0] + lonVals[1] / 60 + lonVals[2] / 3600;
        if (latRef.toUpperCase() === 'S') lat = -lat;
        if (lonRef.toUpperCase() === 'W') lon = -lon;
        if (Number.isFinite(lat) && Number.isFinite(lon)) {
          gps = { lat: Number(lat.toFixed(6)), lon: Number(lon.toFixed(6)) };
        }
      }
    }
  }

  let takenAtMs: number | null = null;
  if (dateTimeStr) {
    const m = /^(\d{4}):(\d{2}):(\d{2})\s+(\d{2}):(\d{2}):(\d{2})$/.exec(dateTimeStr);
    if (m) {
      const ts = Date.UTC(
        Number(m[1]),
        Number(m[2]) - 1,
        Number(m[3]),
        Number(m[4]),
        Number(m[5]),
        Number(m[6])
      );
      if (Number.isFinite(ts)) takenAtMs = ts;
    }
  }

  const camera =
    make && model
      ? model.toLowerCase().startsWith(make.toLowerCase())
        ? model
        : `${make} ${model}`
      : model || make || null;

  return {
    takenAtMs,
    make: make || null,
    model: model || null,
    camera,
    iso,
    focalLengthMm,
    apertureFNumber,
    exposureTimeSec,
    gps,
  };
}

export function generateUuidV4(): string {
  if (typeof globalThis.crypto?.randomUUID === 'function') {
    return globalThis.crypto.randomUUID().toLowerCase();
  }
  const b = defaultCryptoProvider.randomBytes(16);
  b[6] = (b[6] & 0x0f) | 0x40;
  b[8] = (b[8] & 0x3f) | 0x80;
  const hex = toHex(b);
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20, 32)}`;
}

function toReadableByteStream(
  source: Uint8Array | Blob | ReadableStream<Uint8Array>,
  sliceSize = 64 * 1024
): ReadableStream<Uint8Array> {
  if (source instanceof Uint8Array) {
    let offset = 0;
    return new ReadableStream<Uint8Array>({
      pull(controller) {
        if (offset >= source.byteLength) {
          controller.close();
          return;
        }
        const end = Math.min(offset + sliceSize, source.byteLength);
        controller.enqueue(source.subarray(offset, end));
        offset = end;
      },
    });
  }
  if (typeof Blob !== 'undefined' && source instanceof Blob) {
    return source.stream() as ReadableStream<Uint8Array>;
  }
  return source as ReadableStream<Uint8Array>;
}

/**
 * SDK Zero-Knowledge v2 per il client web PhotoCloud.
 */
export class ZkVaultClient {
  private baseUrl: string;
  private transportMode: TransportProtocolMode | null;
  private readonly fetchFn: typeof fetch;
  private readonly workerClient: ZkWorkerClient;
  private readonly pinningStore: KdfPinningStore;
  private readonly onAutoLock?: () => void;
  private readonly onKdfParamsChangedWarning?: ZkVaultClientOptions['onKdfParamsChangedWarning'];

  private userId: string | null = null;
  private username: string | null = null;
  private csrfToken: string | null = null;
  private sessionCookieHeader: string | null = null;

  private accountKey: Uint8Array | null = null;
  private userSalt: Uint8Array | null = null;
  private kdfParams: Argon2idParams | null = null;
  private hasPassphrase = true;
  private wrappedVaultKeyBytes: Uint8Array | null = null;
  private vaultKey: Uint8Array | null = null;
  private subkeys: VaultSubkeys | null = null;

  private itemsById = new Map<string, DecryptedItemV2>();
  private albumCatalog: DecryptedAlbumCatalogV2 = { v: 1, revision: 0, albums: [] };
  private albumEtag: string | null = null;

  private autoLockTimeoutMs: number;
  private autoLockTimer: ReturnType<typeof setTimeout> | null = null;
  private activeTransfersCount = 0;
  private transientExternalActivityExpiresAtMs = 0;

  constructor(options: ZkVaultClientOptions = {}) {
    this.transportMode = options.transportMode ? normalizeTransportMode(options.transportMode) : null;
    const rawBase = (options.baseUrl ?? '').replace(/\/+$/, '');
    this.baseUrl =
      this.transportMode && rawBase ? applyTransportModeToUrl(rawBase, this.transportMode) : rawBase;
    this.fetchFn = options.fetchFn ?? globalThis.fetch.bind(globalThis);
    this.workerClient = options.workerClient ?? new ZkWorkerClient();
    this.pinningStore = options.pinningStore ?? new InMemoryKdfPinningStore();
    this.autoLockTimeoutMs = options.autoLockTimeoutMs ?? 15 * 60 * 1000;
    this.onAutoLock = options.onAutoLock;
    this.onKdfParamsChangedWarning = options.onKdfParamsChangedWarning;
  }

  public getTransportMode(): TransportProtocolMode {
    if (this.transportMode) return this.transportMode;
    if (/^http:\/\//i.test(this.baseUrl)) return 'http';
    return 'https';
  }

  public setTransportMode(mode: TransportProtocolMode): void {
    const normalized = normalizeTransportMode(mode);
    this.transportMode = normalized;
    if (this.baseUrl) {
      this.baseUrl = applyTransportModeToUrl(this.baseUrl, normalized);
    }
  }

  public getBaseUrl(): string {
    return this.baseUrl;
  }

  public isUnlocked(): boolean {
    return this.vaultKey !== null && this.subkeys !== null && this.userId !== null;
  }

  public getUserId(): string | null {
    return this.userId;
  }

  public getUsername(): string | null {
    return this.username;
  }

  public getCsrfToken(): string | null {
    return this.csrfToken;
  }

  public isPassphraseProtected(): boolean {
    return this.hasPassphrase;
  }

  public exportCurrentKeyFile(): ZkKeyFileV2 | null {
    if (!this.accountKey || !this.username || !this.userSalt || !this.kdfParams) return null;
    return {
      formatVersion: 2,
      username: this.username,
      userId: this.userId ?? undefined,
      accountKey: toBase64Url(this.accountKey),
      salt: toBase64Url(this.userSalt),
      kdfParams: {
        algorithm: 'Argon2id',
        memoryKiB: this.kdfParams.memoryKiB,
        iterations: this.kdfParams.iterations,
        parallelism: this.kdfParams.parallelism,
      },
      hasPassphrase: this.hasPassphrase,
      createdAt: new Date().toISOString(),
    };
  }

  public getCurrentRecoveryCode(): string | null {
    if (!this.accountKey) return null;
    return formatRecoveryCode(this.accountKey);
  }

  public setAutoLockTimeoutMs(timeoutMs: number): void {
    this.autoLockTimeoutMs = Math.max(0, timeoutMs);
    this.touchActivity();
  }

  public beginTransientExternalActivity(maxDurationMs = 5 * 60 * 1000): void {
    const safeDuration = Math.min(15 * 60 * 1000, Math.max(1000, maxDurationMs));
    this.transientExternalActivityExpiresAtMs = Date.now() + safeDuration;
    this.touchActivity();
  }

  public endTransientExternalActivity(): void {
    this.transientExternalActivityExpiresAtMs = 0;
    this.touchActivity();
  }

  public touchActivity(): void {
    if (this.autoLockTimer !== null) {
      clearTimeout(this.autoLockTimer);
      this.autoLockTimer = null;
    }
    if (this.isUnlocked() && this.autoLockTimeoutMs > 0) {
      this.autoLockTimer = setTimeout(() => {
        if (this.activeTransfersCount > 0 || Date.now() < this.transientExternalActivityExpiresAtMs) {
          this.touchActivity();
          return;
        }
        this.lock();
        if (this.onAutoLock) {
          this.onAutoLock();
        }
      }, this.autoLockTimeoutMs);
      if (typeof (this.autoLockTimer as { unref?: () => void }).unref === 'function') {
        (this.autoLockTimer as { unref: () => void }).unref();
      }
    }
  }

  public lock(): void {
    if (this.autoLockTimer !== null) {
      clearTimeout(this.autoLockTimer);
      this.autoLockTimer = null;
    }
    this.transientExternalActivityExpiresAtMs = 0;
    if (this.subkeys) {
      this.subkeys.zeroizeAll();
    }
    zeroize(this.vaultKey, this.accountKey, this.userSalt, this.wrappedVaultKeyBytes);
    this.vaultKey = null;
    this.subkeys = null;
    this.accountKey = null;
    this.userSalt = null;
    this.wrappedVaultKeyBytes = null;
    this.itemsById.clear();
    this.albumCatalog = { v: 1, revision: 0, albums: [] };
    this.albumEtag = null;
  }

  public async logout(): Promise<void> {
    try {
      await this.apiFetch('/api/v2/logout', { method: 'POST' });
    } catch {
      // best effort
    } finally {
      this.lock();
      this.userId = null;
      this.username = null;
      this.csrfToken = null;
      this.sessionCookieHeader = null;
    }
  }

  private requireUnlocked(): { userId: string; vaultKey: Uint8Array; subkeys: VaultSubkeys } {
    if (!this.userId || !this.vaultKey || !this.subkeys) {
      throw new ZkCryptoError(
        ZkErrorCode.INVALID_PARAMETER,
        'Il vault è bloccato. Effettua il login con keyfile e passphrase.'
      );
    }
    this.touchActivity();
    return {
      userId: this.userId,
      vaultKey: this.vaultKey,
      subkeys: this.subkeys,
    };
  }

  private async apiFetch(path: string, init: RequestInit = {}): Promise<Response> {
    const url = `${this.baseUrl}${path}`;
    const headers = new Headers(init.headers ?? {});
    if (this.transportMode && !headers.has(TRANSPORT_MODE_HEADER)) {
      headers.set(TRANSPORT_MODE_HEADER, this.transportMode);
    }
    if (this.sessionCookieHeader && !headers.has('cookie')) {
      headers.set('cookie', this.sessionCookieHeader);
    }
    const resp = await this.fetchFn(url, {
      ...init,
      headers,
      credentials: 'same-origin',
    });
    const setCookie = resp.headers.get('set-cookie');
    if (setCookie) {
      const m = /(photocloud_v2_sid=[^;]+)/.exec(setCookie);
      if (m) {
        if (m[1].endsWith('=')) {
          this.sessionCookieHeader = null;
        } else {
          this.sessionCookieHeader = m[1];
        }
      }
    }
    return resp;
  }

  // ==========================================================================
  // 1. REGISTRAZIONE, LOGIN E CAMBIO PASSPHRASE (REWRAP)
  // ==========================================================================

  public async getAuthConfig(): Promise<AuthConfigV2> {
    try {
      const resp = await this.apiFetch('/api/v2/auth/config', { method: 'GET' });
      if (!resp.ok) {
        return { registrationOpen: true, requiresInviteToken: false, policy: 'open' };
      }
      const data = (await resp.json()) as Partial<AuthConfigV2>;
      return {
        registrationOpen: data.registrationOpen !== false,
        requiresInviteToken: Boolean(data.requiresInviteToken),
        policy:
          data.policy === 'disabled' || data.policy === 'setup_token_or_invite' || data.policy === 'open'
            ? data.policy
            : 'open',
        transport: data.transport
          ? {
              currentProtocol: normalizeTransportMode(data.transport.currentProtocol),
              httpModeAllowed: data.transport.httpModeAllowed !== false,
              httpUrl: data.transport.httpUrl ?? null,
              httpsUrl: data.transport.httpsUrl ?? null,
            }
          : undefined,
      };
    } catch {
      return { registrationOpen: true, requiresInviteToken: false, policy: 'open' };
    }
  }

  public prepareRegistration(
    username: string,
    passphrase = '',
    kdfParams: Argon2idParams = DEFAULT_CLIENT_KDF_PARAMS
  ): PreparedRegistrationV2 {
    const trimmedUser = username.trim();
    if (!/^[a-zA-Z0-9_.-]{3,32}$/.test(trimmedUser)) {
      throw new ZkCryptoError(
        ZkErrorCode.INVALID_PARAMETER,
        'Username non valido (3-32 caratteri alfanumerici, punto, trattino o underscore).'
      );
    }
    const usesPassphrase = typeof passphrase === 'string' && passphrase.length > 0;
    if (usesPassphrase) {
      const strength = evaluatePassphraseStrength(passphrase);
      if (!strength.valid) {
        throw new ZkCryptoError(ZkErrorCode.INVALID_PARAMETER, strength.feedback);
      }
    }
    validateKdfParamsFloor(kdfParams);

    const accountKey = defaultCryptoProvider.randomBytes(32);
    const userSalt = defaultCryptoProvider.randomBytes(16);
    const recoveryCode = formatRecoveryCode(accountKey);

    return {
      username: trimmedUser,
      accountKey,
      userSalt,
      kdfParams: { ...kdfParams, hashLength: 32 },
      hasPassphrase: usesPassphrase,
      recoveryCode,
    };
  }

  public async register(
    prepared: PreparedRegistrationV2,
    passphrase = '',
    recoveryConfirmationInput?: string,
    options: { setupToken?: string; inviteToken?: string; skipRecoveryConfirmation?: boolean } = {}
  ): Promise<{ keyFile: ZkKeyFileV2; keyFileFileName: string; userId: string }> {
    if (!options.skipRecoveryConfirmation) {
      if (
        recoveryConfirmationInput === undefined ||
        !verifyRecoveryCodeConfirmation(prepared.recoveryCode, recoveryConfirmationInput)
      ) {
        throw new ZkCryptoError(
          ZkErrorCode.INVALID_PARAMETER,
          'Conferma del codice di recupero non corrispondente. Verifica di aver salvato il Recovery Code.'
        );
      }
    }

    const usesPassphrase = typeof passphrase === 'string' && passphrase.length > 0;
    if (usesPassphrase) {
      const strength = evaluatePassphraseStrength(passphrase);
      if (!strength.valid) {
        throw new ZkCryptoError(ZkErrorCode.INVALID_PARAMETER, strength.feedback);
      }
    } else if (prepared.hasPassphrase) {
      const strength = evaluatePassphraseStrength(passphrase);
      if (!strength.valid) {
        throw new ZkCryptoError(ZkErrorCode.INVALID_PARAMETER, strength.feedback);
      }
    }
    validateKdfParamsFloor(prepared.kdfParams, prepared.userSalt);

    const userId = generateUuidV4();
    const vaultKey = defaultCryptoProvider.randomBytes(32);

    const { root, kek, authSecret } = await this.workerClient.deriveRootAndKeys({
      accountKey: prepared.accountKey,
      userSalt: prepared.userSalt,
      passphrase: usesPassphrase ? passphrase : null,
      argon2Params: prepared.kdfParams,
    });

    try {
      const wrappedVkBytes = await wrapVaultKey(kek, vaultKey, userId);
      const wrappedVaultKeyB64 = toBase64Url(wrappedVkBytes);
      const saltB64 = toBase64Url(prepared.userSalt);
      const authSecretB64 = toBase64Url(authSecret);

      const body: Record<string, unknown> = {
        userId,
        username: prepared.username,
        salt: saltB64,
        kdfParams: {
          algorithm: 'Argon2id',
          memoryKiB: prepared.kdfParams.memoryKiB,
          iterations: prepared.kdfParams.iterations,
          parallelism: prepared.kdfParams.parallelism,
        },
        authSecret: authSecretB64,
        wrappedVaultKey: wrappedVaultKeyB64,
      };
      if (options.setupToken) body.setupToken = options.setupToken;
      if (options.inviteToken) body.inviteToken = options.inviteToken;

      const resp = await this.apiFetch('/api/v2/register', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });

      if (!resp.ok) {
        zeroize(vaultKey);
        const errData = (await resp.json().catch(() => ({}))) as { error?: string };
        throw new Error(errData.error || `REGISTRATION_FAILED_${resp.status}`);
      }

      const data = (await resp.json()) as {
        userId: string;
        username: string;
        salt: string;
        kdfParams: { memoryKiB: number; iterations: number; parallelism: number };
        wrappedVaultKey: string;
        csrfToken: string;
      };

      const subkeys = await deriveSubkeys(vaultKey);
      this.lock();
      this.userId = data.userId;
      this.username = data.username;
      this.csrfToken = data.csrfToken;
      this.accountKey = new Uint8Array(prepared.accountKey);
      this.userSalt = new Uint8Array(prepared.userSalt);
      this.kdfParams = { ...prepared.kdfParams, hashLength: 32 };
      this.hasPassphrase = usesPassphrase;
      this.wrappedVaultKeyBytes = wrappedVkBytes;
      this.vaultKey = vaultKey;
      this.subkeys = subkeys;
      this.touchActivity();

      checkAndPinKdfParameters(this.pinningStore, data.username, saltB64, prepared.kdfParams);

      const keyFile: ZkKeyFileV2 = {
        formatVersion: 2,
        username: data.username,
        userId: data.userId,
        accountKey: toBase64Url(prepared.accountKey),
        salt: saltB64,
        kdfParams: {
          algorithm: 'Argon2id',
          memoryKiB: prepared.kdfParams.memoryKiB,
          iterations: prepared.kdfParams.iterations,
          parallelism: prepared.kdfParams.parallelism,
        },
        hasPassphrase: usesPassphrase,
        createdAt: new Date().toISOString(),
      };

      return {
        keyFile,
        keyFileFileName: `photocloud_v2_key_${data.username}.json`,
        userId: data.userId,
      };
    } finally {
      zeroize(root, kek, authSecret);
    }
  }

  public recoverKeyFileFromRecoveryCode(
    username: string,
    recoveryCodeInput: string,
    hasPassphrase?: boolean
  ): ZkKeyFileV2 {
    const accountKey = parseRecoveryCodeToAccountKey(recoveryCodeInput);
    try {
      return {
        formatVersion: 2,
        username: username.trim(),
        accountKey: toBase64Url(accountKey),
        ...(hasPassphrase !== undefined ? { hasPassphrase } : {}),
        createdAt: new Date().toISOString(),
      };
    } finally {
      zeroize(accountKey);
    }
  }

  public async login(
    keyFile: ZkKeyFileV2,
    passphrase = '',
    onProgress?: (percent: number) => void
  ): Promise<{ userId: string; username: string }> {
    if (!keyFile || keyFile.formatVersion !== 2 || typeof keyFile.username !== 'string') {
      throw new Error(UNIFORM_AUTH_ERROR_MESSAGE);
    }
    const username = keyFile.username.trim();
    const usesPassphrase = keyFile.hasPassphrase === false ? passphrase.length > 0 : true;
    if (!username || (usesPassphrase && !passphrase)) {
      throw new Error(UNIFORM_AUTH_ERROR_MESSAGE);
    }

    let accountKeyBytes: Uint8Array;
    try {
      accountKeyBytes = fromBase64Url(keyFile.accountKey);
    } catch {
      throw new Error(UNIFORM_AUTH_ERROR_MESSAGE);
    }
    if (accountKeyBytes.byteLength !== 32) {
      zeroize(accountKeyBytes);
      throw new Error(UNIFORM_AUTH_ERROR_MESSAGE);
    }

    let root: Uint8Array | null = null;
    let kek: Uint8Array | null = null;
    let authSecret: Uint8Array | null = null;

    try {
      const paramsResp = await this.apiFetch('/api/v2/login/params', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username }),
      });
      if (!paramsResp.ok) {
        throw new Error(UNIFORM_AUTH_ERROR_MESSAGE);
      }

      const paramsData = (await paramsResp.json()) as {
        salt?: string;
        kdfParams?: {
          algorithm?: string;
          memoryKiB?: number;
          iterations?: number;
          parallelism?: number;
        };
      };

      const { saltBytes, kdfParams: validatedKdf, argon2Params } = validateKdfParamsFloor(
        paramsData.salt,
        paramsData.kdfParams
      );

      const pinCheck = checkAndPinKdfParameters(
        this.pinningStore,
        username,
        paramsData.salt!,
        validatedKdf
      );
      if (pinCheck.changed && pinCheck.previous && this.onKdfParamsChangedWarning) {
        this.onKdfParamsChangedWarning({
          username,
          previousSalt: pinCheck.previous.salt,
          newSalt: paramsData.salt!,
          previousParams: pinCheck.previous.kdfParams,
          newParams: validatedKdf,
        });
      } else if (
        !pinCheck.previous &&
        keyFile.salt &&
        (keyFile.salt !== paramsData.salt ||
          (keyFile.kdfParams &&
            (keyFile.kdfParams.memoryKiB !== validatedKdf.memoryKiB ||
              keyFile.kdfParams.iterations !== validatedKdf.iterations ||
              keyFile.kdfParams.parallelism !== validatedKdf.parallelism))) &&
        this.onKdfParamsChangedWarning
      ) {
        this.onKdfParamsChangedWarning({
          username,
          previousSalt: keyFile.salt,
          newSalt: paramsData.salt!,
          previousParams: keyFile.kdfParams ?? validatedKdf,
          newParams: validatedKdf,
        });
      }

      const derived = await this.workerClient.deriveRootAndKeys({
        accountKey: accountKeyBytes,
        userSalt: saltBytes,
        passphrase: usesPassphrase ? passphrase : null,
        argon2Params,
        onProgress: onProgress ? (p) => onProgress(p.percent) : undefined,
      });
      root = derived.root;
      kek = derived.kek;
      authSecret = derived.authSecret;

      const loginResp = await this.apiFetch('/api/v2/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          username,
          authSecret: toBase64Url(authSecret),
        }),
      });

      if (!loginResp.ok) {
        throw new Error(UNIFORM_AUTH_ERROR_MESSAGE);
      }

      const loginData = (await loginResp.json()) as {
        userId: string;
        username: string;
        salt: string;
        kdfParams: { memoryKiB: number; iterations: number; parallelism: number };
        wrappedVaultKey: string;
        csrfToken: string;
      };

      const wrappedVkBytes = fromBase64Url(loginData.wrappedVaultKey);
      let vaultKey: Uint8Array;
      try {
        vaultKey = await unwrapVaultKey(kek, wrappedVkBytes, loginData.userId);
      } catch {
        throw new Error(UNIFORM_AUTH_ERROR_MESSAGE);
      }

      const subkeys = await deriveSubkeys(vaultKey);
      this.lock();
      this.userId = loginData.userId;
      this.username = loginData.username;
      this.csrfToken = loginData.csrfToken;
      this.accountKey = new Uint8Array(accountKeyBytes);
      this.userSalt = saltBytes;
      this.kdfParams = argon2Params;
      this.hasPassphrase = usesPassphrase;
      this.wrappedVaultKeyBytes = wrappedVkBytes;
      this.vaultKey = vaultKey;
      this.subkeys = subkeys;
      this.touchActivity();

      return { userId: loginData.userId, username: loginData.username };
    } finally {
      zeroize(accountKeyBytes, root, kek, authSecret);
    }
  }

  public async changePassphrase(
    oldPassphrase: string,
    newPassphrase: string,
    newKdfParams: Argon2idParams = DEFAULT_CLIENT_KDF_PARAMS
  ): Promise<ZkKeyFileV2> {
    const { userId, vaultKey } = this.requireUnlocked();
    if (!this.accountKey || !this.userSalt || !this.kdfParams || !this.wrappedVaultKeyBytes || !this.username) {
      throw new ZkCryptoError(ZkErrorCode.INVALID_PARAMETER, 'Stato sessione incompleto per rewrap.');
    }

    const nextUsesPassphrase = typeof newPassphrase === 'string' && newPassphrase.length > 0;
    if (nextUsesPassphrase) {
      const strength = evaluatePassphraseStrength(newPassphrase);
      if (!strength.valid) {
        throw new ZkCryptoError(ZkErrorCode.INVALID_PARAMETER, strength.feedback);
      }
    }
    validateKdfParamsFloor(newKdfParams);

    const oldDerived = await this.workerClient.deriveRootAndKeys({
      accountKey: this.accountKey,
      userSalt: this.userSalt,
      passphrase: this.hasPassphrase ? oldPassphrase : null,
      argon2Params: this.kdfParams,
    });
    const oldAuthSecretB64 = toBase64Url(oldDerived.authSecret);
    try {
      const checkVk = await unwrapVaultKey(oldDerived.kek, this.wrappedVaultKeyBytes, userId);
      zeroize(checkVk);
    } catch {
      throw new ZkCryptoError(ZkErrorCode.WRONG_KEY_OR_PASSPHRASE, UNIFORM_AUTH_ERROR_MESSAGE);
    } finally {
      zeroize(oldDerived.root, oldDerived.kek, oldDerived.authSecret);
    }

    const newSalt = defaultCryptoProvider.randomBytes(16);
    const newDerived = await this.workerClient.deriveRootAndKeys({
      accountKey: this.accountKey,
      userSalt: newSalt,
      passphrase: nextUsesPassphrase ? newPassphrase : null,
      argon2Params: newKdfParams,
    });

    try {
      const newWrappedVk = await wrapVaultKey(newDerived.kek, vaultKey, userId);
      const newSaltB64 = toBase64Url(newSalt);
      const newWrappedVkB64 = toBase64Url(newWrappedVk);

      const resp = await this.apiFetch('/api/v2/account/rewrap', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          oldAuthSecret: oldAuthSecretB64,
          newAuthSecret: toBase64Url(newDerived.authSecret),
          newSalt: newSaltB64,
          newKdfParams: {
            algorithm: 'Argon2id',
            memoryKiB: newKdfParams.memoryKiB,
            iterations: newKdfParams.iterations,
            parallelism: newKdfParams.parallelism,
          },
          newWrappedVaultKey: newWrappedVkB64,
        }),
      });

      if (!resp.ok) {
        const err = (await resp.json().catch(() => ({}))) as { error?: string };
        throw new Error(err.error || `REWRAP_FAILED_${resp.status}`);
      }

      const data = (await resp.json()) as { csrfToken?: string };
      if (data.csrfToken) {
        this.csrfToken = data.csrfToken;
      }

      zeroize(this.userSalt, this.wrappedVaultKeyBytes);
      this.userSalt = newSalt;
      this.kdfParams = { ...newKdfParams, hashLength: 32 };
      this.hasPassphrase = nextUsesPassphrase;
      this.wrappedVaultKeyBytes = newWrappedVk;

      checkAndPinKdfParameters(this.pinningStore, this.username, newSaltB64, newKdfParams);

      return {
        formatVersion: 2,
        username: this.username,
        userId,
        accountKey: toBase64Url(this.accountKey),
        salt: newSaltB64,
        kdfParams: {
          algorithm: 'Argon2id',
          memoryKiB: newKdfParams.memoryKiB,
          iterations: newKdfParams.iterations,
          parallelism: newKdfParams.parallelism,
        },
        hasPassphrase: nextUsesPassphrase,
        createdAt: new Date().toISOString(),
      };
    } finally {
      zeroize(newDerived.root, newDerived.kek, newDerived.authSecret);
    }
  }

  // ==========================================================================
  // 2. UPLOAD STREAMING CON DEDUP OPZIONALE, PAUSA / RIPRESA / ANNULLA
  // ==========================================================================

  public async checkDuplicateDedupTags(dedupTagsHex: string[]): Promise<Set<string>> {
    this.requireUnlocked();
    if (dedupTagsHex.length === 0) return new Set();
    const resp = await this.apiFetch('/api/v2/backup/check', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ dedupTags: dedupTagsHex }),
    });
    if (!resp.ok) {
      throw new Error(`BACKUP_CHECK_FAILED_${resp.status}`);
    }
    const data = (await resp.json()) as { existingTags?: string[]; existing?: string[] };
    const list = data.existingTags ?? data.existing ?? [];
    return new Set(list.map((t) => t.toLowerCase()));
  }

  public startUploadFile(
    input: UploadFileInputV2,
    options: UploadFileOptionsV2 = {}
  ): TransferControllerV2<{ skippedDuplicate: boolean; itemId?: string; blobId: string }> {
    const { subkeys } = this.requireUnlocked();
    const transferId = generateUuidV4();
    const blobId = generateUuidV4();

    let status: TransferStatusV2 = 'queued';
    let paused = false;
    let cancelled = false;
    let resumeResolver: (() => void) | null = null;
    let activeUploadId: string | null = null;

    const waitIfPaused = async () => {
      while (paused && !cancelled) {
        await new Promise<void>((resolve) => {
          resumeResolver = resolve;
        });
      }
      if (cancelled) {
        throw new Error('UPLOAD_CANCELLED');
      }
    };

    const emitProgress = (chunksCompleted: number, totalChunks: number, bytesProcessed: number) => {
      if (options.onProgress) {
        const progress: TransferProgressV2 = {
          transferId,
          fileName: input.name,
          status,
          chunksCompleted,
          totalChunks,
          bytesProcessed,
          totalBytes: input.size,
        };
        options.onProgress(progress);
      }
    };

    const self = this;
    self.activeTransfersCount += 1;
    const promise = (async (): Promise<{ skippedDuplicate: boolean; itemId?: string; blobId: string }> => {
      status = 'running';
      self.touchActivity();
      emitProgress(0, 1, 0);

      // 1. Calcola dedupTag in streaming
      const dedupStream = toReadableByteStream(input.source);
      const { tagHex: dedupTagHex } = await computeDedupTag(subkeys.dedupKey, dedupStream);

      if (options.skipIfDuplicate) {
        const existing = await self.checkDuplicateDedupTags([dedupTagHex]);
        if (existing.has(dedupTagHex.toLowerCase())) {
          status = 'completed';
          emitProgress(1, 1, input.size);
          return { skippedDuplicate: true, blobId };
        }
      }

      await waitIfPaused();

      // 2. Se l'input è un Uint8Array JPEG, estrai EXIF client-side rimuovendo GPS di default
      let exifTakenAt: number | undefined;
      let exifSubset: BlobPlaintextMeta['exifSubset'] = null;

      if (
        input.source instanceof Uint8Array &&
        (input.mimeType.toLowerCase() === 'image/jpeg' || /\.(jpe?g)$/i.test(input.name))
      ) {
        const parsedExif = parseClientJpegExif(input.source, Boolean(options.includeGps));
        if (parsedExif.takenAtMs) exifTakenAt = parsedExif.takenAtMs;
        exifSubset = {
          make: parsedExif.make ?? undefined,
          model: parsedExif.model ?? undefined,
          iso: parsedExif.iso ?? undefined,
          focalLength: parsedExif.focalLengthMm ?? undefined,
          fNumber: parsedExif.apertureFNumber ?? undefined,
          exposureTime: parsedExif.exposureTimeSec ? `${parsedExif.exposureTimeSec}s` : undefined,
          lat: options.includeGps && parsedExif.gps ? parsedExif.gps.lat : undefined,
          lon: options.includeGps && parsedExif.gps ? parsedExif.gps.lon : undefined,
          phash: input.phash,
        };
      }

      const now = Date.now();
      const metaPayload: BlobPlaintextMeta = {
        v: 1,
        name: input.name,
        mime: input.mimeType || 'application/octet-stream',
        size: input.size,
        takenAt: input.takenAt ?? exifTakenAt ?? input.lastModified ?? now,
        createdAt: now,
        width: input.width ?? null,
        height: input.height ?? null,
        duration: input.durationMs ?? null,
        isFavorite: Boolean(input.favorite),
        exifSubset,
        dedupTag: dedupTagHex,
      };

      const encMetaBytes = await encryptMeta(subkeys.metaKey, blobId, metaPayload);
      const encMetaB64 = toBase64Url(encMetaBytes);

      // 3. Cifra lo stream in formato PCZK v1 raccogliendo i chunk emessi dal generator
      const emittedChunks: Uint8Array[] = [];
      let totalCipherSize = 0;

      const gen = encryptBlobStream(toReadableByteStream(input.source), {
        fkWrapKey: subkeys.fkWrapKey,
        blobId,
        chunkSizeLog2: DEFAULT_CHUNK_SIZE_LOG2,
        dedupKey: subkeys.dedupKey,
      });

      let encStreamResult;
      while (true) {
        const step = await gen.next();
        if (step.done) {
          encStreamResult = step.value;
          break;
        }
        const copy = new Uint8Array(step.value);
        emittedChunks.push(copy);
        totalCipherSize += copy.byteLength;
      }

      const fullCipher = new Uint8Array(totalCipherSize);
      let pos = 0;
      for (const piece of emittedChunks) {
        fullCipher.set(piece, pos);
        pos += piece.byteLength;
      }

      // Ogni richiesta PUT /api/v2/blobs/upload/:uploadId/:chunkIndex invia fino a 1 MiB + header/tag
      const uploadSliceSize =
        (1 << DEFAULT_CHUNK_SIZE_LOG2) + PCZK_GCM_TAG_LENGTH + PCZK_HEADER_LENGTH;
      const totalUploadChunks = Math.max(1, Math.ceil(fullCipher.byteLength / uploadSliceSize));

      await waitIfPaused();

      const initResp = await self.apiFetch('/api/v2/blobs/upload/init', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          blobId,
          totalSize: fullCipher.byteLength,
          chunkSize: uploadSliceSize,
          totalChunks: totalUploadChunks,
          expectedSha256: encStreamResult.ciphertextSha256Hex,
          encMeta: encMetaB64,
          dedupTag: dedupTagHex,
        }),
      });

      if (!initResp.ok) {
        const err = (await initResp.json().catch(() => ({}))) as { error?: string };
        throw new Error(err.error || `UPLOAD_INIT_FAILED_${initResp.status}`);
      }

      const initData = (await initResp.json()) as { uploadId: string };
      activeUploadId = initData.uploadId;

      for (let idx = 0; idx < totalUploadChunks; idx++) {
        await waitIfPaused();
        self.touchActivity();
        const start = idx * uploadSliceSize;
        const end = Math.min(start + uploadSliceSize, fullCipher.byteLength);
        const slice = fullCipher.subarray(start, end);

        const putResp = await self.apiFetch(`/api/v2/blobs/upload/${activeUploadId}/${idx}`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/octet-stream' },
          body: slice,
        });
        if (!putResp.ok) {
          throw new Error(`UPLOAD_CHUNK_FAILED_${putResp.status}`);
        }
        const plainDone = Math.min(
          input.size,
          Math.round(((idx + 1) / totalUploadChunks) * input.size)
        );
        emitProgress(idx + 1, totalUploadChunks, plainDone);
      }

      await waitIfPaused();

      const completeResp = await self.apiFetch(`/api/v2/blobs/upload/${activeUploadId}/complete`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          createItem: options.createItem !== false,
        }),
      });

      if (!completeResp.ok) {
        const err = (await completeResp.json().catch(() => ({}))) as { error?: string };
        throw new Error(err.error || `UPLOAD_COMPLETE_FAILED_${completeResp.status}`);
      }

      const completeData = (await completeResp.json()) as {
        item?: ServerItemV2;
        blobId?: string;
        size?: number;
        sha256?: string;
      };

      const createdItemId = completeData.item?.id;
      const finalSize = completeData.item?.size ?? completeData.size ?? fullCipher.byteLength;
      const finalSha256 =
        completeData.item?.sha256 ?? completeData.sha256 ?? encStreamResult.ciphertextSha256Hex;

      // 4. Carica miniature cifrate 320 / 1280 se presenti (solo quando esiste un item)
      if (createdItemId) {
        if (input.thumb320Plaintext && input.thumb320Plaintext.byteLength > 0) {
          const enc320 = await encryptThumbnail(
            subkeys.thumbKey,
            blobId,
            '320',
            input.thumb320Plaintext
          );
          await self.apiFetch(`/api/v2/blobs/${blobId}/thumbs/320`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/octet-stream' },
            body: enc320 as unknown as BodyInit,
          });
        }
        if (input.thumb1280Plaintext && input.thumb1280Plaintext.byteLength > 0) {
          const enc1280 = await encryptThumbnail(
            subkeys.thumbKey,
            blobId,
            '1280',
            input.thumb1280Plaintext
          );
          await self.apiFetch(`/api/v2/blobs/${blobId}/thumbs/1280`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/octet-stream' },
            body: enc1280 as unknown as BodyInit,
          });
        }

        const thumbs: number[] = [];
        if (input.thumb320Plaintext) thumbs.push(320);
        if (input.thumb1280Plaintext) thumbs.push(1280);
        self.itemsById.set(createdItemId, {
          id: createdItemId,
          blobId,
          version: 1,
          cipherSize: finalSize,
          sha256: finalSha256,
          createdAt: now,
          updatedAt: now,
          state: 'active',
          trashedAt: null,
          dedupTag: dedupTagHex,
          thumbs,
          meta: metaPayload,
          category: classifyItemCategory(metaPayload.mime, metaPayload.name),
        });
      }

      status = 'completed';
      emitProgress(totalUploadChunks, totalUploadChunks, input.size);
      return {
        skippedDuplicate: false,
        itemId: createdItemId,
        blobId,
      };
    })()
      .catch(async (err) => {
        if (cancelled && activeUploadId) {
          await self
            .apiFetch(`/api/v2/blobs/upload/${activeUploadId}`, {
              method: 'DELETE',
            })
            .catch(() => {});
        }
        status = cancelled ? 'cancelled' : 'error';
        throw err;
      })
      .finally(() => {
        self.activeTransfersCount = Math.max(0, self.activeTransfersCount - 1);
        if (self.isUnlocked()) {
          self.touchActivity();
        }
      });

    return {
      transferId,
      get status() {
        return status;
      },
      pause() {
        if (status === 'running') {
          paused = true;
          status = 'paused';
        }
      },
      resume() {
        if (status === 'paused') {
          paused = false;
          status = 'running';
          if (resumeResolver) {
            const r = resumeResolver;
            resumeResolver = null;
            r();
          }
        }
      },
      async cancel() {
        cancelled = true;
        paused = false;
        status = 'cancelled';
        if (resumeResolver) {
          const r = resumeResolver;
          resumeResolver = null;
          r();
        }
        if (activeUploadId) {
          await self
            .apiFetch(`/api/v2/blobs/upload/${activeUploadId}`, {
              method: 'DELETE',
            })
            .catch(() => {});
        }
      },
      promise,
    };
  }

  public async uploadFile(
    input: UploadFileInputV2,
    options: UploadFileOptionsV2 = {}
  ): Promise<{ skippedDuplicate: boolean; itemId?: string; blobId: string }> {
    return this.startUploadFile(input, options).promise;
  }

  public async uploadBatch(
    inputs: UploadFileInputV2[],
    concurrency = 2,
    options: UploadFileOptionsV2 = {}
  ): Promise<Array<{ skippedDuplicate: boolean; itemId?: string; blobId: string }>> {
    const limit = Math.max(1, Math.min(8, concurrency));
    const results: Array<{ skippedDuplicate: boolean; itemId?: string; blobId: string }> = new Array(
      inputs.length
    );
    let nextIdx = 0;

    const worker = async () => {
      while (nextIdx < inputs.length) {
        const current = nextIdx++;
        results[current] = await this.uploadFile(inputs[current], options);
      }
    };

    const workers = Array.from({ length: Math.min(limit, inputs.length) }, () => worker());
    await Promise.all(workers);
    return results;
  }

  // ==========================================================================
  // 3. GALLERIA, TIMELINE, RICERCA NATURALE E STATISTICHE
  // ==========================================================================

  public async syncItems(state: 'active' | 'trashed' | 'all' = 'all'): Promise<DecryptedItemV2[]> {
    const { subkeys } = this.requireUnlocked();

    if (state === 'all') {
      this.itemsById.clear();
    } else {
      for (const [id, item] of this.itemsById.entries()) {
        if (item.state === state) this.itemsById.delete(id);
      }
    }

    const statesToFetch: Array<'active' | 'trashed'> =
      state === 'all' ? ['active', 'trashed'] : [state];

    for (const st of statesToFetch) {
      let cursor: string | null = null;
      do {
        const qs = new URLSearchParams({ limit: '100', state: st });
        if (cursor) qs.set('cursor', cursor);
        const resp = await this.apiFetch(`/api/v2/items?${qs.toString()}`);
        if (!resp.ok) {
          throw new Error(`SYNC_ITEMS_FAILED_${resp.status}`);
        }
        const page = (await resp.json()) as {
          items: ServerItemV2[];
          nextCursor: string | null;
        };

        for (const srv of page.items) {
          const encMetaBytes = fromBase64Url(srv.encMeta);
          const meta = await decryptMeta<BlobPlaintextMeta>(
            subkeys.metaKey,
            srv.blobId,
            encMetaBytes
          );
          const dec: DecryptedItemV2 = {
            id: srv.id,
            blobId: srv.blobId,
            version: srv.version,
            cipherSize: srv.size,
            sha256: srv.sha256,
            createdAt: srv.createdAt,
            updatedAt: srv.updatedAt,
            state: srv.state,
            trashedAt: srv.trashedAt,
            dedupTag: srv.dedupTag,
            thumbs: srv.thumbs ?? [],
            meta,
            category: classifyItemCategory(meta.mime, meta.name),
          };
          this.itemsById.set(dec.id, dec);
        }

        cursor = page.nextCursor;
      } while (cursor);
    }

    return this.getItems(state);
  }

  public getItems(state: 'active' | 'trashed' | 'all' = 'active'): DecryptedItemV2[] {
    const list: DecryptedItemV2[] = [];
    for (const item of this.itemsById.values()) {
      if (state === 'all' || item.state === state) {
        list.push(item);
      }
    }
    list.sort((a, b) => (b.meta.takenAt ?? b.createdAt) - (a.meta.takenAt ?? a.createdAt));
    return list;
  }

  public groupItems(mode: TimelineGroupModeV2 = 'day'): TimelineGroupV2[] {
    const active = this.getItems('active');
    if (mode === 'album') {
      const byBlob = new Map<string, DecryptedItemV2>();
      for (const it of active) byBlob.set(it.blobId, it);
      return this.albumCatalog.albums.map((alb) => ({
        key: alb.id,
        label: alb.title,
        items: alb.blobIds
          .map((bId) => byBlob.get(bId))
          .filter((x): x is DecryptedItemV2 => Boolean(x)),
      }));
    }

    const groups = new Map<string, TimelineGroupV2>();
    for (const item of active) {
      const ts = item.meta.takenAt ?? item.createdAt;
      const d = new Date(ts);
      const yyyy = d.getUTCFullYear();
      const mm = String(d.getUTCMonth() + 1).padStart(2, '0');
      const dd = String(d.getUTCDate()).padStart(2, '0');
      let key: string;
      let label: string;
      if (mode === 'year') {
        key = `${yyyy}`;
        label = `${yyyy}`;
      } else if (mode === 'month') {
        key = `${yyyy}-${mm}`;
        label = `${mm}/${yyyy}`;
      } else {
        key = `${yyyy}-${mm}-${dd}`;
        label = `${dd}/${mm}/${yyyy}`;
      }
      let grp = groups.get(key);
      if (!grp) {
        grp = { key, label, items: [] };
        groups.set(key, grp);
      }
      grp.items.push(item);
    }

    return Array.from(groups.values()).sort((a, b) => b.key.localeCompare(a.key));
  }

  public searchItems(rawQuery: string, now: Date = new Date()): DecryptedItemV2[] {
    const active = this.getItems('active');
    const trimmed = rawQuery.trim();
    if (!trimmed) return active;

    const q = parseNaturalQuery(trimmed, now);
    const favAliases = new Set(['preferite', 'preferita', 'preferiti', 'preferito']);
    const filteredTokens: string[] = [];
    for (const tok of q.textTokens) {
      if (favAliases.has(tok.toLowerCase())) {
        q.favoritesOnly = true;
      } else {
        filteredTokens.push(tok);
      }
    }
    q.textTokens = filteredTokens;

    const blobAlbums = new Map<string, string[]>();
    for (const alb of this.albumCatalog.albums) {
      for (const bId of alb.blobIds) {
        const arr = blobAlbums.get(bId) ?? [];
        arr.push(alb.title.toLowerCase());
        blobAlbums.set(bId, arr);
      }
    }

    return active.filter((item) => {
      if (q.favoritesOnly && !item.meta.isFavorite) return false;
      if (q.mediaType === 'photo' && item.category !== 'photo') return false;
      if (q.mediaType === 'video' && item.category !== 'video') return false;
      if (
        q.mediaType === 'file' &&
        item.category !== 'document' &&
        item.category !== 'other' &&
        item.category !== 'archive'
      ) {
        return false;
      }

      const tsMs = item.meta.takenAt ?? item.createdAt;
      const tsSec = Math.floor(tsMs / 1000);
      const dt = new Date(tsMs);

      if (q.dateFrom !== null && tsSec < q.dateFrom) return false;
      if (q.dateTo !== null && tsSec > q.dateTo) return false;
      if (
        q.years.length > 0 &&
        !q.years.includes(dt.getFullYear()) &&
        !q.years.includes(dt.getUTCFullYear())
      ) {
        return false;
      }
      if (
        q.months.length > 0 &&
        !q.months.includes(dt.getMonth() + 1) &&
        !q.months.includes(dt.getUTCMonth() + 1)
      ) {
        return false;
      }
      if (
        q.days.length > 0 &&
        !q.days.includes(dt.getDate()) &&
        !q.days.includes(dt.getUTCDate())
      ) {
        return false;
      }

      const itemAlbums = blobAlbums.get(item.blobId) ?? [];
      if (q.albums.length > 0) {
        const matchAlb = q.albums.some((wanted) =>
          itemAlbums.some((title) => title.includes(wanted.toLowerCase()))
        );
        if (!matchAlb) return false;
      }

      if (q.textTokens.length > 0) {
        const haystack = [
          item.meta.name.toLowerCase(),
          item.meta.mime.toLowerCase(),
          item.meta.exifSubset?.make?.toLowerCase() ?? '',
          item.meta.exifSubset?.model?.toLowerCase() ?? '',
          ...itemAlbums,
        ].join(' ');
        for (const tok of q.textTokens) {
          if (!haystack.includes(tok.toLowerCase())) return false;
        }
      }

      return true;
    });
  }

  public async getStats(): Promise<VaultDetailedStatsV2> {
    this.requireUnlocked();
    const resp = await this.apiFetch('/api/v2/stats');
    if (!resp.ok) {
      throw new Error(`STATS_FAILED_${resp.status}`);
    }
    const srv = (await resp.json()) as ServerStatsResponseV2;

    let photosCount = 0;
    let videosCount = 0;
    let documentsCount = 0;
    let filesCount = 0;
    let photosBytes = 0;
    let videosBytes = 0;
    let documentsBytes = 0;
    let filesBytes = 0;

    for (const item of this.itemsById.values()) {
      if (item.state !== 'active') continue;
      const sz = item.meta.size || 0;
      if (item.category === 'photo') {
        photosCount++;
        photosBytes += sz;
      } else if (item.category === 'video') {
        videosCount++;
        videosBytes += sz;
      } else if (item.category === 'document') {
        documentsCount++;
        documentsBytes += sz;
      } else {
        filesCount++;
        filesBytes += sz;
      }
    }

    return {
      ...srv,
      photosCount,
      videosCount,
      documentsCount,
      filesCount,
      photosBytes,
      videosBytes,
      documentsBytes,
      filesBytes,
    };
  }

  // ==========================================================================
  // 4. DOWNLOAD STREAMING, RANGE RANDOM-ACCESS, MINIATURE E TICKET VIDEO SW
  // ==========================================================================

  public async downloadThumbnail(blobId: string, variant: 320 | 1280): Promise<Uint8Array> {
    const { subkeys } = this.requireUnlocked();
    const resp = await this.apiFetch(`/api/v2/blobs/${blobId}/thumbs/${variant}`);
    if (!resp.ok) {
      throw new Error(`THUMB_DOWNLOAD_FAILED_${resp.status}`);
    }
    const cipherBytes = new Uint8Array(await resp.arrayBuffer());
    return decryptThumbnail(
      subkeys.thumbKey,
      blobId,
      String(variant) as '320' | '1280',
      cipherBytes
    );
  }

  public async downloadBlobToBytes(blobId: string): Promise<Uint8Array> {
    const { subkeys } = this.requireUnlocked();
    this.activeTransfersCount += 1;
    this.touchActivity();
    try {
      const resp = await this.apiFetch(`/api/v2/blobs/${blobId}`);
      if (!resp.ok) {
        throw new Error(`BLOB_DOWNLOAD_FAILED_${resp.status}`);
      }
      const cipherBytes = new Uint8Array(await resp.arrayBuffer());
      this.touchActivity();
      const { plaintext } = await decryptBlobToBytes(cipherBytes, {
        fkWrapKey: subkeys.fkWrapKey,
        expectedBlobId: blobId,
      });
      return plaintext;
    } finally {
      this.activeTransfersCount = Math.max(0, this.activeTransfersCount - 1);
      if (this.isUnlocked()) {
        this.touchActivity();
      }
    }
  }

  public async downloadBlobRange(
    blobId: string,
    startByte: number,
    endByteInclusive: number
  ): Promise<{ plaintextSlice: Uint8Array; header: ParsedPczkHeader }> {
    const { subkeys } = this.requireUnlocked();
    this.activeTransfersCount += 1;
    this.touchActivity();
    try {
      const headerResp = await this.apiFetch(`/api/v2/blobs/${blobId}`, {
        headers: { Range: `bytes=0-${PCZK_HEADER_LENGTH - 1}` },
      });
      if (!headerResp.ok) {
        throw new Error(`BLOB_HEADER_FETCH_FAILED_${headerResp.status}`);
      }
      const headerBytes = new Uint8Array(await headerResp.arrayBuffer()).subarray(
        0,
        PCZK_HEADER_LENGTH
      );
      const header = parsePczkHeader(headerBytes);

      let totalCiphertextBytes = 0;
      const contentRange = headerResp.headers.get('content-range');
      if (contentRange) {
        const m = /\/(\d+)$/.exec(contentRange.trim());
        if (m) totalCiphertextBytes = Number(m[1]);
      }
      if (!totalCiphertextBytes) {
        for (const it of this.itemsById.values()) {
          if (it.blobId === blobId.toLowerCase()) {
            totalCiphertextBytes = it.cipherSize;
            break;
          }
        }
      }

      const plaintextSlice = await decryptBlobRange({
        headerBytes,
        totalCiphertextBytes,
        startPlaintextByte: startByte,
        endPlaintextByteInclusive: endByteInclusive,
        fkWrapKey: subkeys.fkWrapKey,
        expectedBlobId: blobId,
        fetchCiphertextRange: async (cStart, cEndInclusive) => {
          this.touchActivity();
          const rangeResp = await this.apiFetch(`/api/v2/blobs/${blobId}`, {
            headers: { Range: `bytes=${cStart}-${cEndInclusive}` },
          });
          if (!rangeResp.ok) {
            throw new Error(`BLOB_RANGE_FETCH_FAILED_${rangeResp.status}`);
          }
          return new Uint8Array(await rangeResp.arrayBuffer());
        },
      });

      return { plaintextSlice, header };
    } finally {
      this.activeTransfersCount = Math.max(0, this.activeTransfersCount - 1);
      if (this.isUnlocked()) {
        this.touchActivity();
      }
    }
  }

  public async getVideoStreamTicket(blobId: string): Promise<{
    blobId: string;
    fileKey: Uint8Array;
    header: ParsedPczkHeader;
    headerBytes: Uint8Array;
    totalCiphertextBytes: number;
    mime: string;
  }> {
    const { subkeys } = this.requireUnlocked();
    const headerResp = await this.apiFetch(`/api/v2/blobs/${blobId}`, {
      headers: { Range: `bytes=0-${PCZK_HEADER_LENGTH - 1}` },
    });
    if (!headerResp.ok) {
      throw new Error(`VIDEO_HEADER_FETCH_FAILED_${headerResp.status}`);
    }
    const raw = new Uint8Array(await headerResp.arrayBuffer());
    const headerBytes = raw.subarray(0, PCZK_HEADER_LENGTH);
    const header = parsePczkHeader(headerBytes);
    if (header.blobId !== blobId.toLowerCase()) {
      throw new ZkCryptoError(ZkErrorCode.WRONG_KEY_OR_PASSPHRASE, 'Header blobId mismatch');
    }

    let totalCiphertextBytes = 0;
    const contentRange = headerResp.headers.get('content-range');
    if (contentRange) {
      const m = /\/(\d+)$/.exec(contentRange.trim());
      if (m) totalCiphertextBytes = Number(m[1]);
    }
    let mime = 'video/mp4';
    for (const it of this.itemsById.values()) {
      if (it.blobId === blobId.toLowerCase()) {
        if (!totalCiphertextBytes) totalCiphertextBytes = it.cipherSize;
        if (it.meta.mime) mime = it.meta.mime;
        break;
      }
    }

    const fileKey = await unwrapFileKey(subkeys.fkWrapKey, header.wrappedFk, header.blobIdBytes);
    return {
      blobId,
      fileKey,
      header,
      headerBytes,
      totalCiphertextBytes,
      mime,
    };
  }

  // ==========================================================================
  // 5. AGGIORNAMENTO METADATI E PHOTO EDITOR (REPLACE CON EXPECTED VERSION)
  // ==========================================================================

  public async updateItemMeta(
    itemId: string,
    patch: Partial<Omit<BlobPlaintextMeta, 'v'>>,
    expectedVersion?: number
  ): Promise<DecryptedItemV2> {
    const { subkeys } = this.requireUnlocked();
    const current = this.itemsById.get(itemId);
    if (!current) {
      throw new Error('ITEM_NOT_FOUND_IN_LOCAL_INDEX');
    }

    const mergedMeta: BlobPlaintextMeta = {
      ...current.meta,
      ...patch,
      v: 1,
    };
    const encMetaBytes = await encryptMeta(subkeys.metaKey, current.blobId, mergedMeta);
    const encMetaB64 = toBase64Url(encMetaBytes);

    const resp = await this.apiFetch(`/api/v2/items/${itemId}/meta`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        expectedVersion: expectedVersion ?? current.version,
        encMeta: encMetaB64,
      }),
    });

    if (!resp.ok) {
      const err = (await resp.json().catch(() => ({}))) as { error?: string };
      throw new Error(err.error || `UPDATE_META_FAILED_${resp.status}`);
    }

    const bodyData = (await resp.json()) as { item?: ServerItemV2 } & ServerItemV2;
    const srv = bodyData.item ?? bodyData;
    const updated: DecryptedItemV2 = {
      ...current,
      version: srv.version,
      updatedAt: srv.updatedAt,
      meta: mergedMeta,
      category: classifyItemCategory(mergedMeta.mime, mergedMeta.name),
    };
    this.itemsById.set(itemId, updated);
    return updated;
  }

  public async replaceItemWithEditedBlob(
    itemId: string,
    editedPlaintext: Uint8Array,
    metaPatch: Partial<Omit<BlobPlaintextMeta, 'v'>> = {},
    expectedVersion?: number,
    thumbs?: { thumb320?: Uint8Array; thumb1280?: Uint8Array }
  ): Promise<DecryptedItemV2> {
    const { subkeys } = this.requireUnlocked();
    const current = this.itemsById.get(itemId);
    if (!current) {
      throw new Error('ITEM_NOT_FOUND_IN_LOCAL_INDEX');
    }

    const newMeta: BlobPlaintextMeta = {
      ...current.meta,
      ...metaPatch,
      size: editedPlaintext.byteLength,
      v: 1,
    };

    const uploadRes = await this.uploadFile(
      {
        name: newMeta.name,
        mimeType: newMeta.mime,
        size: editedPlaintext.byteLength,
        source: editedPlaintext,
        takenAt: newMeta.takenAt,
        width: newMeta.width ?? undefined,
        height: newMeta.height ?? undefined,
        favorite: newMeta.isFavorite,
        thumb320Plaintext: thumbs?.thumb320,
        thumb1280Plaintext: thumbs?.thumb1280,
      },
      { createItem: false, includeGps: Boolean(newMeta.exifSubset?.lat) }
    );

    const newBlobId = uploadRes.blobId;
    const encMetaBytes = await encryptMeta(subkeys.metaKey, newBlobId, newMeta);
    const encMetaB64 = toBase64Url(encMetaBytes);
    const { tagHex: dedupTagHex } = await computeDedupTag(subkeys.dedupKey, editedPlaintext);

    const resp = await this.apiFetch(`/api/v2/items/${itemId}/replace`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        expectedVersion: expectedVersion ?? current.version,
        newBlobId,
        encMeta: encMetaB64,
        dedupTag: dedupTagHex,
      }),
    });

    if (!resp.ok) {
      const err = (await resp.json().catch(() => ({}))) as { error?: string };
      throw new Error(err.error || `REPLACE_ITEM_FAILED_${resp.status}`);
    }

    const bodyData = (await resp.json()) as { item?: ServerItemV2 } & ServerItemV2;
    const srv = bodyData.item ?? bodyData;

    // Carica le nuove miniature cifrate 320 / 1280 dopo il replace (ora newBlobId appartiene all'item)
    const uploadedThumbs: number[] = Array.isArray(srv.thumbs) ? [...srv.thumbs] : [];
    if (thumbs?.thumb320 && thumbs.thumb320.byteLength > 0) {
      const enc320 = await encryptThumbnail(subkeys.thumbKey, newBlobId, '320', thumbs.thumb320);
      const tResp = await this.apiFetch(`/api/v2/blobs/${newBlobId}/thumbs/320`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/octet-stream' },
        body: enc320 as unknown as BodyInit,
      });
      if (tResp.ok && !uploadedThumbs.includes(320)) uploadedThumbs.push(320);
    }
    if (thumbs?.thumb1280 && thumbs.thumb1280.byteLength > 0) {
      const enc1280 = await encryptThumbnail(subkeys.thumbKey, newBlobId, '1280', thumbs.thumb1280);
      const tResp = await this.apiFetch(`/api/v2/blobs/${newBlobId}/thumbs/1280`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/octet-stream' },
        body: enc1280 as unknown as BodyInit,
      });
      if (tResp.ok && !uploadedThumbs.includes(1280)) uploadedThumbs.push(1280);
    }

    const updated: DecryptedItemV2 = {
      id: srv.id,
      blobId: srv.blobId,
      version: srv.version,
      cipherSize: srv.size,
      sha256: srv.sha256,
      createdAt: srv.createdAt,
      updatedAt: srv.updatedAt,
      state: srv.state,
      trashedAt: srv.trashedAt,
      dedupTag: srv.dedupTag,
      thumbs: uploadedThumbs,
      meta: newMeta,
      category: classifyItemCategory(newMeta.mime, newMeta.name),
    };
    this.itemsById.set(itemId, updated);
    return updated;
  }

  // ==========================================================================
  // 6. ALBUM CIFRATI CON MERGE AUTOMATICO SU 412 PRECONDITION FAILED
  // ==========================================================================

  public getCachedAlbums(): DecryptedAlbumCatalogV2 {
    return {
      v: this.albumCatalog.v,
      revision: this.albumCatalog.revision,
      albums: this.albumCatalog.albums.map((a) => ({ ...a, blobIds: [...a.blobIds] })),
    };
  }

  public async getAlbums(): Promise<DecryptedAlbumCatalogV2> {
    const { userId, subkeys } = this.requireUnlocked();
    const resp = await this.apiFetch('/api/v2/albums');
    if (resp.status === 404) {
      this.albumEtag = null;
      this.albumCatalog = { v: 1, revision: 0, albums: [] };
      return this.albumCatalog;
    }
    if (!resp.ok) {
      throw new Error(`GET_ALBUMS_FAILED_${resp.status}`);
    }
    const etagHeader = resp.headers.get('etag');
    this.albumEtag = etagHeader ?? null;

    const cipherBytes = new Uint8Array(await resp.arrayBuffer());
    if (cipherBytes.byteLength === 0) {
      this.albumCatalog = { v: 1, revision: 0, albums: [] };
      return this.albumCatalog;
    }

    const { revision, catalog } = await decryptAlbums(subkeys.metaKey, userId, cipherBytes);
    this.albumCatalog = {
      v: 1,
      revision,
      albums: (catalog.albums ?? []).map((a) => ({
        id: a.id,
        title: a.name,
        coverBlobId: a.coverBlobId,
        blobIds: [...a.blobIds],
        createdAt: a.createdAt,
        updatedAt: catalog.updatedAt ?? a.createdAt,
      })),
    };
    return this.albumCatalog;
  }

  public static mergeAlbumCatalogs(
    baseOrLocal: DecryptedAlbumCatalogV2,
    remote: DecryptedAlbumCatalogV2
  ): DecryptedAlbumCatalogV2 {
    const byId = new Map<string, DecryptedAlbumV2>();
    for (const alb of remote.albums) {
      byId.set(alb.id, {
        ...alb,
        blobIds: [...alb.blobIds],
      });
    }
    for (const localAlb of baseOrLocal.albums) {
      const existing = byId.get(localAlb.id);
      if (!existing) {
        byId.set(localAlb.id, {
          ...localAlb,
          blobIds: [...localAlb.blobIds],
        });
      } else {
        const mergedBlobIds = Array.from(new Set([...existing.blobIds, ...localAlb.blobIds]));
        const newer = localAlb.updatedAt >= existing.updatedAt ? localAlb : existing;
        byId.set(localAlb.id, {
          id: existing.id,
          title: newer.title,
          coverBlobId: newer.coverBlobId ?? existing.coverBlobId,
          blobIds: mergedBlobIds,
          createdAt: Math.min(existing.createdAt, localAlb.createdAt),
          updatedAt: Math.max(existing.updatedAt, localAlb.updatedAt),
        });
      }
    }

    return {
      v: 1,
      revision: Math.max(baseOrLocal.revision, remote.revision) + 1,
      albums: Array.from(byId.values()),
    };
  }

  public async saveAlbums(
    mutator: (current: DecryptedAlbumCatalogV2) => DecryptedAlbumCatalogV2
  ): Promise<DecryptedAlbumCatalogV2> {
    const { userId, subkeys } = this.requireUnlocked();

    let candidate = mutator({
      v: 1,
      revision: Math.max(1, this.albumCatalog.revision + 1),
      albums: this.albumCatalog.albums.map((a) => ({ ...a, blobIds: [...a.blobIds] })),
    });

    for (let attempt = 0; attempt < 4; attempt++) {
      const rev = Math.max(1, candidate.revision);
      const specCatalog: AlbumCatalogPlaintext = {
        v: 1,
        revision: rev,
        updatedAt: Date.now(),
        albums: candidate.albums.map((a) => ({
          id: a.id,
          name: a.title,
          createdAt: a.createdAt,
          coverBlobId: a.coverBlobId ?? null,
          blobIds: [...a.blobIds],
        })),
      };

      const encryptedBytes = await encryptAlbums(subkeys.metaKey, userId, specCatalog, rev);

      const headers: Record<string, string> = {
        'Content-Type': 'application/octet-stream',
      };
      if (this.albumEtag) {
        headers['If-Match'] = this.albumEtag;
      }

      const putResp = await this.apiFetch('/api/v2/albums', {
        method: 'PUT',
        headers,
        body: encryptedBytes as unknown as BodyInit,
      });

      if (putResp.status === 412 && attempt < 3) {
        const remoteCatalog = await this.getAlbums();
        candidate = ZkVaultClient.mergeAlbumCatalogs(candidate, remoteCatalog);
        this.albumCatalog = candidate;
        continue;
      }

      if (!putResp.ok) {
        const err = (await putResp.json().catch(() => ({}))) as { error?: string };
        throw new Error(err.error || `SAVE_ALBUMS_FAILED_${putResp.status}`);
      }

      const putData = (await putResp.json()) as { etag: string };
      this.albumEtag = putResp.headers.get('etag') ?? putData.etag;
      this.albumCatalog = {
        ...candidate,
        revision: rev,
      };
      return this.albumCatalog;
    }

    throw new Error('ALBUMS_CONFLICT_MAX_RETRIES_EXCEEDED');
  }

  // ==========================================================================
  // 7. CESTINO, RIPRISTINO, CANCELLAZIONE DEFINITIVA ED EXPORT ZIP STREAMING
  // ==========================================================================

  public async trashItems(itemIds: string[]): Promise<number> {
    this.requireUnlocked();
    const resp = await this.apiFetch('/api/v2/trash', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ itemIds }),
    });
    if (!resp.ok) {
      throw new Error(`TRASH_MOVE_FAILED_${resp.status}`);
    }
    const data = (await resp.json()) as { trashedIds?: string[]; trashedAt: number };
    for (const id of itemIds) {
      const it = this.itemsById.get(id);
      if (it) {
        it.state = 'trashed';
        it.trashedAt = data.trashedAt;
      }
    }
    return data.trashedIds?.length ?? itemIds.length;
  }

  public async restoreItems(itemIds: string[]): Promise<number> {
    this.requireUnlocked();
    const resp = await this.apiFetch('/api/v2/trash/restore', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ itemIds }),
    });
    if (!resp.ok) {
      throw new Error(`TRASH_RESTORE_FAILED_${resp.status}`);
    }
    const data = (await resp.json()) as { restoredIds?: string[] };
    for (const id of itemIds) {
      const it = this.itemsById.get(id);
      if (it) {
        it.state = 'active';
        it.trashedAt = null;
      }
    }
    return data.restoredIds?.length ?? itemIds.length;
  }

  public async deleteItemPermanently(itemId: string): Promise<void> {
    this.requireUnlocked();
    const resp = await this.apiFetch(`/api/v2/items/${itemId}`, {
      method: 'DELETE',
    });
    if (!resp.ok) {
      throw new Error(`DELETE_ITEM_FAILED_${resp.status}`);
    }
    this.itemsById.delete(itemId);
  }

  public async emptyTrash(): Promise<number> {
    this.requireUnlocked();
    const resp = await this.apiFetch('/api/v2/trash', {
      method: 'DELETE',
    });
    if (!resp.ok) {
      throw new Error(`EMPTY_TRASH_FAILED_${resp.status}`);
    }
    const data = (await resp.json()) as { deletedCount: number };
    for (const [id, it] of this.itemsById.entries()) {
      if (it.state === 'trashed') {
        this.itemsById.delete(id);
      }
    }
    return data.deletedCount;
  }

  public exportZipStream(itemIds: string[]): ReadableStream<Uint8Array> {
    const { subkeys } = this.requireUnlocked();
    const selected = itemIds
      .map((id) => this.itemsById.get(id))
      .filter((x): x is DecryptedItemV2 => Boolean(x));

    const self = this;
    self.activeTransfersCount += 1;
    self.touchActivity();
    let released = false;
    const releaseTransfer = () => {
      if (released) return;
      released = true;
      self.activeTransfersCount = Math.max(0, self.activeTransfersCount - 1);
      if (self.isUnlocked()) {
        self.touchActivity();
      }
    };

    async function* zipEntries() {
      for (const item of selected) {
        self.touchActivity();
        const resp = await self.apiFetch(`/api/v2/blobs/${item.blobId}`);
        if (!resp.ok || !resp.body) {
          throw new Error(`EXPORT_BLOB_FETCH_FAILED_${resp.status}`);
        }
        yield {
          name: item.meta.name,
          modifiedAt: item.meta.takenAt ?? item.createdAt,
          stream: () =>
            decryptBlobStream(resp.body as ReadableStream<Uint8Array>, {
              fkWrapKey: subkeys.fkWrapKey,
              expectedBlobId: item.blobId,
            }),
        };
      }
    }

    const gen = generateZipStream(zipEntries());
    return new ReadableStream<Uint8Array>({
      async pull(controller) {
        try {
          self.touchActivity();
          const step = await gen.next();
          if (step.done) {
            releaseTransfer();
            controller.close();
            return;
          }
          controller.enqueue(step.value);
        } catch (err) {
          releaseTransfer();
          throw err;
        }
      },
      async cancel() {
        releaseTransfer();
        try {
          await gen.return?.();
        } catch {
          // ignore generator close error
        }
      },
    });
  }

  // ==========================================================================
  // 8. CONDIVISIONI PUBBLICHE END-TO-END (/v2/share/<shareId>#<shareKey>)
  // ==========================================================================

  public async createShare(
    options: CreateShareOptionsV2,
    origin = 'https://localhost:3000'
  ): Promise<CreateShareResultV2> {
    const { subkeys } = this.requireUnlocked();
    if (!Array.isArray(options.itemIds) || options.itemIds.length === 0) {
      throw new ZkCryptoError(
        ZkErrorCode.INVALID_PARAMETER,
        'Seleziona almeno un elemento da condividere.'
      );
    }

    const shareId = generateUuidV4();
    const shareKey = defaultCryptoProvider.randomBytes(32);

    try {
      const apiItems: Array<{ blobId: string; wrappedFk: string; encItemMeta: string }> = [];
      const manifestItems: ShareManifestEntryV2[] = [];

      for (const itemId of options.itemIds) {
        let item = this.itemsById.get(itemId);
        if (!item) {
          await this.syncItems('active');
          item = this.itemsById.get(itemId);
        }
        if (!item) {
          throw new Error(`SHARE_ITEM_NOT_FOUND_${itemId}`);
        }

        const headerResp = await this.apiFetch(`/api/v2/blobs/${item.blobId}`, {
          headers: { Range: `bytes=0-${PCZK_HEADER_LENGTH - 1}` },
        });
        if (!headerResp.ok) {
          throw new Error(`SHARE_BLOB_HEADER_FAILED_${headerResp.status}`);
        }
        const headerBytes = new Uint8Array(await headerResp.arrayBuffer()).subarray(
          0,
          PCZK_HEADER_LENGTH
        );
        const header = parsePczkHeader(headerBytes);
        const fileKey = await unwrapFileKey(subkeys.fkWrapKey, header.wrappedFk, header.blobIdBytes);

        try {
          const wrappedFkBytes = await wrapFileKeyForShare(
            shareKey,
            fileKey,
            shareId,
            item.blobId
          );
          const wrappedFkB64 = toBase64Url(wrappedFkBytes);
          const shareEncMetaB64 = await encryptShareItemMeta(
            item.meta,
            shareKey,
            shareId,
            item.blobId
          );

          apiItems.push({
            blobId: item.blobId,
            wrappedFk: wrappedFkB64,
            encItemMeta: shareEncMetaB64,
          });
          manifestItems.push({
            blobId: item.blobId,
            wrappedFk: wrappedFkB64,
            encMeta: shareEncMetaB64,
          });
        } finally {
          zeroize(fileKey);
        }
      }

      let passwordWrap: PasswordWrappedShareKeyV2 | null = null;
      if (options.password && options.password.trim().length > 0) {
        passwordWrap = await wrapShareKeyWithPassword(shareKey, options.password, shareId);
      }

      const manifestPayload: ShareManifestPayloadV2 = {
        v: 1,
        shareId,
        title: options.title,
        createdAt: Date.now(),
        items: manifestItems,
      };
      const shareManifestB64 = await encryptShareManifest(manifestPayload, shareKey, shareId);
      const shareKeyB64 = toBase64Url(shareKey);
      const encShareMetaB64 = await encryptOwnerShareMeta(subkeys.metaKey, shareId, {
        v: 1,
        title: options.title,
        itemCount: apiItems.length,
        shareKeyB64u: shareKeyB64,
        hasPassword: Boolean(passwordWrap),
      });

      const resp = await this.apiFetch('/api/v2/shares', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          shareId,
          expiresAt: options.expiresAt ?? null,
          maxDownloads: options.maxDownloads ?? null,
          passwordWrap,
          encShareMeta: encShareMetaB64,
          shareManifest: shareManifestB64,
          items: apiItems,
        }),
      });

      if (!resp.ok) {
        const err = (await resp.json().catch(() => ({}))) as { error?: string };
        throw new Error(err.error || `CREATE_SHARE_FAILED_${resp.status}`);
      }

      const effectiveOrigin = this.transportMode
        ? resolveOriginForTransportMode(origin, this.transportMode)
        : origin;
      const shareUrl = buildShareUrl(effectiveOrigin, shareId, shareKey);

      return {
        shareId,
        shareKeyBase64Url: shareKeyB64,
        shareUrl,
        expiresAt: options.expiresAt ?? null,
        maxDownloads: options.maxDownloads ?? null,
      };
    } finally {
      zeroize(shareKey);
    }
  }

  public async listOwnerShares(origin = 'https://localhost:3000'): Promise<OwnerShareSummaryV2[]> {
    const { subkeys } = this.requireUnlocked();
    const resp = await this.apiFetch('/api/v2/shares', { method: 'GET' });
    if (!resp.ok) {
      throw new Error(`LIST_SHARES_FAILED_${resp.status}`);
    }
    const data = (await resp.json()) as {
      shares?: Array<{
        shareId: string;
        encShareMeta: string | null;
        hasPassword: boolean;
        itemCount: number;
        expiresAt: number | null;
        maxDownloads: number | null;
        downloadCount: number;
        createdAt: number;
      }>;
    };

    const now = Date.now();
    const results: OwnerShareSummaryV2[] = [];
    for (const row of data.shares ?? []) {
      let title = `Condivisione ${row.shareId.slice(0, 8)}`;
      let shareKeyBase64Url: string | null = null;
      let shareUrl: string | null = null;

      if (row.encShareMeta) {
        try {
          const decrypted = await decryptOwnerShareMeta(
            subkeys.metaKey,
            row.shareId,
            row.encShareMeta
          );
          if (decrypted.title && decrypted.title.trim().length > 0) {
            title = decrypted.title.trim();
          }
          if (decrypted.shareKeyB64u) {
            const keyBytes = fromBase64Url(decrypted.shareKeyB64u);
            try {
              if (keyBytes.byteLength === 32) {
                shareKeyBase64Url = decrypted.shareKeyB64u;
                const effectiveOrigin = this.transportMode
                  ? resolveOriginForTransportMode(origin, this.transportMode)
                  : origin;
                shareUrl = buildShareUrl(effectiveOrigin, row.shareId, keyBytes);
              }
            } finally {
              zeroize(keyBytes);
            }
          }
        } catch {
          // Legacy or unreadable encShareMeta: keep safe fallback label
        }
      }

      let status: OwnerShareSummaryV2['status'] = 'active';
      if (row.expiresAt !== null && now >= row.expiresAt) {
        status = 'expired';
      } else if (row.maxDownloads !== null && row.downloadCount >= row.maxDownloads) {
        status = 'limit_reached';
      }

      results.push({
        shareId: row.shareId,
        title,
        itemCount: row.itemCount,
        hasPassword: Boolean(row.hasPassword),
        expiresAt: row.expiresAt,
        maxDownloads: row.maxDownloads,
        downloadCount: row.downloadCount,
        createdAt: row.createdAt,
        shareKeyBase64Url,
        shareUrl,
        status,
      });
    }
    return results;
  }

  public async revokeShare(shareId: string): Promise<void> {
    this.requireUnlocked();
    const resp = await this.apiFetch(`/api/v2/shares/${encodeURIComponent(shareId)}`, {
      method: 'DELETE',
    });
    if (!resp.ok) {
      throw new Error(`REVOKE_SHARE_FAILED_${resp.status}`);
    }
  }

  public async openPublicShare(
    shareId: string,
    urlOrFragment: string,
    password?: string
  ): Promise<OpenedShareV2> {
    const resp = await this.apiFetch(`/api/v2/shares/${shareId}`);
    if (!resp.ok) {
      throw new Error(`OPEN_SHARE_FAILED_${resp.status}`);
    }
    const data = (await resp.json()) as {
      shareId: string;
      createdAt: number;
      expiresAt: number | null;
      maxDownloads?: number | null;
      downloadsCount?: number;
      passwordWrap: string | null;
      shareManifest: string | null;
      items: Array<{
        blobId: string;
        wrappedFk: string;
        encItemMeta?: string | null;
        encMeta?: string | null;
        size?: number;
      }>;
    };

    let shareKey: Uint8Array;
    if (data.passwordWrap) {
      if (!password) {
        throw new ZkCryptoError(
          ZkErrorCode.INVALID_PARAMETER,
          'Questa condivisione è protetta da password.'
        );
      }
      shareKey = await unwrapShareKeyWithPassword(data.passwordWrap, password, shareId);
    } else {
      shareKey = parseShareUrlFragment(urlOrFragment);
    }

    let title: string | undefined;
    let sourceEntries: ShareManifestEntryV2[] = data.items.map((it) => ({
      blobId: it.blobId,
      wrappedFk: it.wrappedFk,
      encMeta: (it.encMeta ?? it.encItemMeta ?? '') as string,
    }));

    if (data.shareManifest) {
      const manifest = await decryptShareManifest(data.shareManifest, shareKey, shareId);
      title = manifest.title;
      sourceEntries = manifest.items;
    }

    const decryptedEntries: OpenedShareV2['items'] = [];
    for (const entry of sourceEntries) {
      const wrappedFkBytes = fromBase64Url(entry.wrappedFk);
      const fileKey = await unwrapFileKeyForShare(
        shareKey,
        wrappedFkBytes,
        shareId,
        entry.blobId
      );
      const meta = await decryptShareItemMeta(entry.encMeta, shareKey, shareId, entry.blobId);
      decryptedEntries.push({
        blobId: entry.blobId,
        fileKey,
        meta,
        category: classifyItemCategory(meta.mime, meta.name),
      });
    }

    return {
      shareId: data.shareId,
      title,
      createdAt: data.createdAt,
      expiresAt: data.expiresAt,
      maxDownloads: data.maxDownloads ?? null,
      downloadsCount: data.downloadsCount ?? 0,
      shareKey,
      items: decryptedEntries,
    };
  }

  public async downloadSharedBlobToBytes(
    openedShare: OpenedShareV2,
    blobId: string
  ): Promise<Uint8Array> {
    const entry = openedShare.items.find((i) => i.blobId === blobId);
    if (!entry) {
      throw new Error('SHARED_BLOB_NOT_FOUND');
    }
    const resp = await this.apiFetch(`/api/v2/shares/${openedShare.shareId}/blobs/${blobId}`);
    if (!resp.ok) {
      throw new Error(`SHARED_BLOB_FETCH_FAILED_${resp.status}`);
    }
    const cipherBytes = new Uint8Array(await resp.arrayBuffer());
    const { plaintext } = await decryptBlobToBytes(cipherBytes, {
      unwrappedFileKey: entry.fileKey,
      expectedBlobId: blobId,
    });
    return plaintext;
  }

  public async downloadSharedBlobRange(
    openedShare: OpenedShareV2,
    blobId: string,
    startByte: number,
    endByteInclusive: number
  ): Promise<{ plaintextSlice: Uint8Array; header: ParsedPczkHeader }> {
    const entry = openedShare.items.find((i) => i.blobId === blobId);
    if (!entry) {
      throw new Error('SHARED_BLOB_NOT_FOUND');
    }

    const headerResp = await this.apiFetch(
      `/api/v2/shares/${openedShare.shareId}/blobs/${blobId}?headerOnly=1`,
      {
        headers: { Range: `bytes=0-${PCZK_HEADER_LENGTH - 1}` },
      }
    );
    if (!headerResp.ok) {
      throw new Error(`SHARED_HEADER_FETCH_FAILED_${headerResp.status}`);
    }
    const headerBytes = new Uint8Array(await headerResp.arrayBuffer()).subarray(
      0,
      PCZK_HEADER_LENGTH
    );
    const header = parsePczkHeader(headerBytes);

    let totalCiphertextBytes = 0;
    const contentRange = headerResp.headers.get('content-range');
    if (contentRange) {
      const m = /\/(\d+)$/.exec(contentRange.trim());
      if (m) totalCiphertextBytes = Number(m[1]);
    }
    if (!totalCiphertextBytes) {
      totalCiphertextBytes = PCZK_HEADER_LENGTH + entry.meta.size + PCZK_GCM_TAG_LENGTH;
    }

    const plaintextSlice = await decryptBlobRange({
      headerBytes,
      totalCiphertextBytes,
      startPlaintextByte: startByte,
      endPlaintextByteInclusive: endByteInclusive,
      unwrappedFileKey: entry.fileKey,
      expectedBlobId: blobId,
      fetchCiphertextRange: async (cStart, cEndInclusive) => {
        const rangeResp = await this.apiFetch(
          `/api/v2/shares/${openedShare.shareId}/blobs/${blobId}`,
          {
            headers: { Range: `bytes=${cStart}-${cEndInclusive}` },
          }
        );
        if (!rangeResp.ok) {
          throw new Error(`SHARED_RANGE_FETCH_FAILED_${rangeResp.status}`);
        }
        return new Uint8Array(await rangeResp.arrayBuffer());
      },
    });

    return { plaintextSlice, header };
  }
}

export { computeBlobRangePlan };
