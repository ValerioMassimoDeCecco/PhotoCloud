import type {
  AlbumCatalogPlaintext,
  AlbumEntry,
  Argon2idParams,
  BlobExifSubset,
  BlobPlaintextMeta,
} from '../../lib/zk/index.ts';

export type {
  AlbumCatalogPlaintext,
  AlbumEntry,
  Argon2idParams,
  BlobExifSubset,
  BlobPlaintextMeta,
};

export interface KdfParamsV2 {
  algorithm: 'Argon2id';
  memoryKiB: number;
  iterations: number;
  parallelism: number;
}

export interface ZkKeyFileV2 {
  formatVersion: 2;
  username: string;
  userId?: string;
  accountKey: string; // base64url 32B
  salt?: string; // base64url 16B
  kdfParams?: KdfParamsV2;
  createdAt: string;
}

export interface PreparedRegistrationV2 {
  username: string;
  accountKey: Uint8Array;
  userSalt: Uint8Array;
  kdfParams: Argon2idParams;
  recoveryCode: string;
}

export interface PinnedKdfRecord {
  username: string;
  salt: string;
  kdfParams: KdfParamsV2;
  pinnedAt: number;
}

export interface KdfPinningStore {
  get(username: string): PinnedKdfRecord | null;
  set(record: PinnedKdfRecord): void;
}

export type ZkItemCategory = 'photo' | 'video' | 'document' | 'audio' | 'archive' | 'other' | 'file';

export interface ServerItemV2 {
  id: string;
  blobId: string;
  version: number;
  size: number;
  sha256: string;
  createdAt: number;
  updatedAt: number;
  state: 'active' | 'trashed';
  trashedAt: number | null;
  encMeta: string;
  dedupTag: string | null;
  thumbs: number[];
}

export interface DecryptedItemV2 {
  id: string;
  blobId: string;
  version: number;
  cipherSize: number;
  sha256: string;
  createdAt: number;
  updatedAt: number;
  state: 'active' | 'trashed';
  trashedAt: number | null;
  dedupTag: string | null;
  thumbs: number[];
  meta: BlobPlaintextMeta;
  category: ZkItemCategory;
}

export type TimelineGroupModeV2 = 'day' | 'month' | 'year' | 'album';

export interface TimelineGroupV2 {
  key: string;
  label: string;
  items: DecryptedItemV2[];
}

export interface ServerStatsResponseV2 {
  activeBytes: number;
  trashedBytes: number;
  activeCount: number;
  trashedCount: number;
  quotaBytes: number;
}

export interface VaultDetailedStatsV2 extends ServerStatsResponseV2 {
  photosCount: number;
  videosCount: number;
  documentsCount: number;
  filesCount: number;
  photosBytes: number;
  videosBytes: number;
  documentsBytes: number;
  filesBytes: number;
}

export interface DecryptedAlbumV2 {
  id: string;
  title: string;
  coverBlobId?: string | null;
  blobIds: string[];
  createdAt: number;
  updatedAt: number;
}

export interface DecryptedAlbumCatalogV2 {
  v: 1;
  revision: number;
  albums: DecryptedAlbumV2[];
}

export interface ServerAlbumResponseV2 {
  etag: string | null;
  updatedAt: number | null;
  encryptedBlob: string | null;
}

export interface ShareManifestItemEntryV2 {
  blobId: string;
  wrappedFk: string; // base64url 60B
  encMeta: string; // base64url encrypted with shareMetaKey
}

export type ShareManifestEntryV2 = ShareManifestItemEntryV2;

export interface ShareManifestPlaintextV2 {
  v: 1;
  shareId: string;
  title?: string;
  createdAt: number;
  items: ShareManifestItemEntryV2[];
}

export type ShareManifestPayloadV2 = ShareManifestPlaintextV2;

export interface PasswordWrapEnvelopeV2 {
  v: 1;
  salt: string; // base64url 16B
  kdfParams: KdfParamsV2;
  wrappedShareKey: string; // base64url 60B
}

export type PasswordWrappedShareKeyV2 = string;

export interface CreateShareOptionsV2 {
  itemIds: string[];
  title?: string;
  expiresAt?: number | null;
  maxDownloads?: number | null;
  password?: string;
}

export interface CreateShareResultV2 {
  shareId: string;
  shareKeyBase64Url: string;
  shareUrl: string;
  expiresAt: number | null;
  maxDownloads: number | null;
}

export interface ServerSharePublicResponseV2 {
  shareId: string;
  createdAt: number;
  expiresAt: number | null;
  maxDownloads: number | null;
  downloadsCount: number;
  passwordWrap: string | null;
  shareManifest: string | null;
  items: ShareManifestItemEntryV2[];
}

export interface OpenedShareV2 {
  shareId: string;
  title?: string;
  createdAt: number;
  expiresAt: number | null;
  maxDownloads: number | null;
  downloadsCount: number;
  shareKey: Uint8Array;
  items: Array<{
    blobId: string;
    fileKey: Uint8Array;
    meta: BlobPlaintextMeta;
    category: ZkItemCategory;
  }>;
}

export type TransferStatusV2 =
  | 'queued'
  | 'running'
  | 'paused'
  | 'completed'
  | 'cancelled'
  | 'error';

export interface TransferProgressV2 {
  transferId: string;
  fileName: string;
  status: TransferStatusV2;
  chunksCompleted: number;
  totalChunks: number;
  bytesProcessed: number;
  totalBytes: number;
}

export interface TransferControllerV2<T = unknown> {
  readonly transferId: string;
  readonly status: TransferStatusV2;
  pause(): void;
  resume(): void;
  cancel(): Promise<void>;
  readonly promise: Promise<T>;
}

export interface UploadFileInputV2 {
  name: string;
  mimeType: string;
  size: number;
  source: Uint8Array | Blob | ReadableStream<Uint8Array>;
  lastModified?: number;
  takenAt?: number;
  width?: number;
  height?: number;
  durationMs?: number;
  favorite?: boolean;
  phash?: string;
  thumb320Plaintext?: Uint8Array;
  thumb1280Plaintext?: Uint8Array;
}

export interface UploadFileOptionsV2 {
  skipIfDuplicate?: boolean;
  includeGps?: boolean;
  createItem?: boolean;
  onProgress?: (progress: TransferProgressV2) => void;
}
