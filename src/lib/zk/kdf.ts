import { defaultArgon2idProvider } from './argon2id.ts';
import { ZkCryptoError, ZkErrorCode } from './errors.ts';
import {
  type Argon2idParams,
  type Argon2idProgressCallback,
  type Argon2idProvider,
  defaultCryptoProvider,
  type ZkCryptoProvider,
} from './provider.ts';
import { concatBytes, normalizePassphraseNfc, utf8Encode, uuidToBytes, zeroize } from './zeroize.ts';

export const DEFAULT_ARGON2ID_PARAMS: Argon2idParams = {
  memoryKiB: 65536,
  iterations: 3,
  parallelism: 1,
  hashLength: 32,
};

export interface DeriveRootOptions {
  accountKey: Uint8Array;
  userSalt: Uint8Array;
  passphrase?: string | Uint8Array | null;
  argon2Params?: Argon2idParams;
  onProgress?: Argon2idProgressCallback;
  cryptoProvider?: ZkCryptoProvider;
  argon2Provider?: Argon2idProvider;
}

export interface KekAndAuthSecret {
  kek: Uint8Array;
  authSecret: Uint8Array;
  zeroizeAll(): void;
}

export interface VaultSubkeys {
  metaKey: Uint8Array;
  thumbKey: Uint8Array;
  dedupKey: Uint8Array;
  fkWrapKey: Uint8Array;
  zeroizeAll(): void;
}

/**
 * Spec §3.3 (1-3):
 * root = HKDF-SHA256(
 *   ikm = (passphrase ? Argon2id(NFC(passphrase), userSalt, m=64MiB, t=3, p=1, 32B) : 0x00*32) || accountKey,
 *   salt = userSalt,
 *   info = "photocloud/v2/root",
 *   L = 32
 * )
 */
export async function deriveRoot(options: DeriveRootOptions): Promise<Uint8Array> {
  const {
    accountKey,
    userSalt,
    passphrase,
    argon2Params = DEFAULT_ARGON2ID_PARAMS,
    onProgress,
    cryptoProvider = defaultCryptoProvider,
    argon2Provider = defaultArgon2idProvider,
  } = options;

  if (accountKey.byteLength !== 32) {
    throw new ZkCryptoError(ZkErrorCode.INVALID_PARAMETER, 'accountKey must be exactly 32 bytes.');
  }
  if (userSalt.byteLength !== 16) {
    throw new ZkCryptoError(ZkErrorCode.INVALID_PARAMETER, 'userSalt must be exactly 16 bytes.');
  }

  let passphraseBytes: Uint8Array | null = null;
  let passphrasePart: Uint8Array | null = null;
  let ikm: Uint8Array | null = null;

  try {
    const hasPassphrase =
      passphrase !== undefined &&
      passphrase !== null &&
      (typeof passphrase === 'string' ? passphrase.length > 0 : passphrase.byteLength > 0);

    if (hasPassphrase) {
      if (typeof passphrase === 'string') {
        passphraseBytes = normalizePassphraseNfc(passphrase);
      } else {
        passphraseBytes = new Uint8Array(passphrase);
      }
      passphrasePart = await argon2Provider.derive(passphraseBytes, userSalt, argon2Params, {
        onProgress,
      });
    } else {
      passphrasePart = new Uint8Array(32);
    }

    if (passphrasePart.byteLength !== 32) {
      throw new ZkCryptoError(ZkErrorCode.INVALID_PARAMETER, 'Argon2id output must be 32 bytes.');
    }

    ikm = concatBytes(passphrasePart, accountKey);
    return await cryptoProvider.hkdfSha256(
      ikm,
      userSalt,
      utf8Encode('photocloud/v2/root'),
      32
    );
  } finally {
    zeroize(passphraseBytes, passphrasePart, ikm);
  }
}

/**
 * Spec §3.3 (4-5):
 * kek = HKDF-SHA256(root, empty, "photocloud/v2/kek", 32)
 * authSecret = HKDF-SHA256(root, empty, "photocloud/v2/auth", 32)
 */
export async function deriveKekAndAuthSecret(
  root: Uint8Array,
  cryptoProvider: ZkCryptoProvider = defaultCryptoProvider
): Promise<KekAndAuthSecret> {
  if (root.byteLength !== 32) {
    throw new ZkCryptoError(ZkErrorCode.INVALID_PARAMETER, 'root key must be exactly 32 bytes.');
  }
  const emptySalt = new Uint8Array(0);
  const kek = await cryptoProvider.hkdfSha256(
    root,
    emptySalt,
    utf8Encode('photocloud/v2/kek'),
    32
  );
  const authSecret = await cryptoProvider.hkdfSha256(
    root,
    emptySalt,
    utf8Encode('photocloud/v2/auth'),
    32
  );
  return {
    kek,
    authSecret,
    zeroizeAll() {
      zeroize(kek, authSecret);
    },
  };
}

/**
 * Spec §3.4:
 * wrappedVk = nonce(12B) || AES-256-GCM(key=kek, nonce=12B, plaintext=VK(32B), AAD="vk|" + userId)
 * Total length: 60 bytes.
 */
export async function wrapVaultKey(
  kek: Uint8Array,
  vaultKey: Uint8Array,
  userId: string,
  nonce?: Uint8Array,
  cryptoProvider: ZkCryptoProvider = defaultCryptoProvider
): Promise<Uint8Array> {
  if (kek.byteLength !== 32) {
    throw new ZkCryptoError(ZkErrorCode.INVALID_PARAMETER, 'kek must be 32 bytes.');
  }
  if (vaultKey.byteLength !== 32) {
    throw new ZkCryptoError(ZkErrorCode.INVALID_PARAMETER, 'vaultKey must be 32 bytes.');
  }
  if (!userId || userId.trim().length === 0) {
    throw new ZkCryptoError(ZkErrorCode.INVALID_PARAMETER, 'userId must be non-empty.');
  }
  const iv = nonce ?? cryptoProvider.randomBytes(12);
  if (iv.byteLength !== 12) {
    throw new ZkCryptoError(ZkErrorCode.INVALID_PARAMETER, 'VK wrap nonce must be 12 bytes.');
  }
  const aad = utf8Encode(`vk|${userId}`);
  const ctWithTag = await cryptoProvider.aes256GcmEncrypt(kek, iv, vaultKey, aad);
  return concatBytes(iv, ctWithTag);
}

/**
 * Spec §3.4:
 * Unwraps the 60-byte `wrappedVk` using `kek` and `AAD = "vk|" + userId`.
 * Throws `ZkErrorCode.WRONG_KEY_OR_PASSPHRASE` on failure.
 */
export async function unwrapVaultKey(
  kek: Uint8Array,
  wrappedVk: Uint8Array,
  userId: string,
  cryptoProvider: ZkCryptoProvider = defaultCryptoProvider
): Promise<Uint8Array> {
  if (kek.byteLength !== 32) {
    throw new ZkCryptoError(ZkErrorCode.INVALID_PARAMETER, 'kek must be 32 bytes.');
  }
  if (wrappedVk.byteLength !== 60) {
    throw new ZkCryptoError(
      ZkErrorCode.WRONG_KEY_OR_PASSPHRASE,
      'Invalid wrappedVk length (expected 60 bytes).'
    );
  }
  if (!userId || userId.trim().length === 0) {
    throw new ZkCryptoError(ZkErrorCode.INVALID_PARAMETER, 'userId must be non-empty.');
  }
  const iv = wrappedVk.subarray(0, 12);
  const ctWithTag = wrappedVk.subarray(12, 60);
  const aad = utf8Encode(`vk|${userId}`);
  return await cryptoProvider.aes256GcmDecrypt(
    kek,
    iv,
    ctWithTag,
    aad,
    ZkErrorCode.WRONG_KEY_OR_PASSPHRASE
  );
}

/**
 * Spec §3.5:
 * Derives `metaKey`, `thumbKey`, `dedupKey`, `fkWrapKey` from `vaultKey` (VK) via HKDF-SHA256.
 */
export async function deriveSubkeys(
  vaultKey: Uint8Array,
  cryptoProvider: ZkCryptoProvider = defaultCryptoProvider
): Promise<VaultSubkeys> {
  if (vaultKey.byteLength !== 32) {
    throw new ZkCryptoError(ZkErrorCode.INVALID_PARAMETER, 'vaultKey must be 32 bytes.');
  }
  const emptySalt = new Uint8Array(0);
  const [metaKey, thumbKey, dedupKey, fkWrapKey] = await Promise.all([
    cryptoProvider.hkdfSha256(vaultKey, emptySalt, utf8Encode('photocloud/v2/metaKey'), 32),
    cryptoProvider.hkdfSha256(vaultKey, emptySalt, utf8Encode('photocloud/v2/thumbKey'), 32),
    cryptoProvider.hkdfSha256(vaultKey, emptySalt, utf8Encode('photocloud/v2/dedupKey'), 32),
    cryptoProvider.hkdfSha256(vaultKey, emptySalt, utf8Encode('photocloud/v2/fkWrapKey'), 32),
  ]);
  return {
    metaKey,
    thumbKey,
    dedupKey,
    fkWrapKey,
    zeroizeAll() {
      zeroize(metaKey, thumbKey, dedupKey, fkWrapKey);
    },
  };
}

/**
 * Spec §3.6:
 * Wraps a 32-byte File Key (FK) with `fkWrapKey` and `AAD = 16-byte binary blobId`.
 * Returns 60-byte `wrappedFK`: `nonce(12B) || ciphertext(32B) || tag(16B)`.
 */
export async function wrapFileKey(
  fkWrapKey: Uint8Array,
  fileKey: Uint8Array,
  blobId: string | Uint8Array,
  nonce?: Uint8Array,
  cryptoProvider: ZkCryptoProvider = defaultCryptoProvider
): Promise<Uint8Array> {
  if (fkWrapKey.byteLength !== 32) {
    throw new ZkCryptoError(ZkErrorCode.INVALID_PARAMETER, 'fkWrapKey must be 32 bytes.');
  }
  if (fileKey.byteLength !== 32) {
    throw new ZkCryptoError(ZkErrorCode.INVALID_PARAMETER, 'fileKey must be 32 bytes.');
  }
  const blobIdBytes = typeof blobId === 'string' ? uuidToBytes(blobId) : blobId;
  if (blobIdBytes.byteLength !== 16) {
    throw new ZkCryptoError(ZkErrorCode.INVALID_PARAMETER, 'blobId binary AAD must be 16 bytes.');
  }
  const iv = nonce ?? cryptoProvider.randomBytes(12);
  if (iv.byteLength !== 12) {
    throw new ZkCryptoError(ZkErrorCode.INVALID_PARAMETER, 'FK wrap nonce must be 12 bytes.');
  }
  const ctWithTag = await cryptoProvider.aes256GcmEncrypt(fkWrapKey, iv, fileKey, blobIdBytes);
  return concatBytes(iv, ctWithTag);
}

/**
 * Spec §3.6:
 * Unwraps a 60-byte `wrappedFK` with `fkWrapKey` and `AAD = 16-byte binary blobId`.
 */
export async function unwrapFileKey(
  fkWrapKey: Uint8Array,
  wrappedFk: Uint8Array,
  blobId: string | Uint8Array,
  cryptoProvider: ZkCryptoProvider = defaultCryptoProvider
): Promise<Uint8Array> {
  if (fkWrapKey.byteLength !== 32) {
    throw new ZkCryptoError(ZkErrorCode.INVALID_PARAMETER, 'fkWrapKey must be 32 bytes.');
  }
  if (wrappedFk.byteLength !== 60) {
    throw new ZkCryptoError(ZkErrorCode.MALFORMED_HEADER, 'wrappedFK must be exactly 60 bytes.');
  }
  const blobIdBytes = typeof blobId === 'string' ? uuidToBytes(blobId) : blobId;
  if (blobIdBytes.byteLength !== 16) {
    throw new ZkCryptoError(ZkErrorCode.INVALID_PARAMETER, 'blobId binary AAD must be 16 bytes.');
  }
  const iv = wrappedFk.subarray(0, 12);
  const ctWithTag = wrappedFk.subarray(12, 60);
  return await cryptoProvider.aes256GcmDecrypt(
    fkWrapKey,
    iv,
    ctWithTag,
    blobIdBytes,
    ZkErrorCode.WRONG_KEY_OR_PASSPHRASE
  );
}

/**
 * Spec §6.1:
 * Wraps `fileKey` for a public share using `shareWrapKey = HKDF-SHA256(shareKey, empty, "photocloud/v2/share/wrap", 32)`
 * and `AAD = UTF8("share-fk|" + shareId + "|" + blobId)`.
 */
export async function wrapFileKeyForShare(
  shareKey: Uint8Array,
  fileKey: Uint8Array,
  shareId: string,
  blobId: string,
  nonce?: Uint8Array,
  cryptoProvider: ZkCryptoProvider = defaultCryptoProvider
): Promise<Uint8Array> {
  if (shareKey.byteLength !== 32) {
    throw new ZkCryptoError(ZkErrorCode.INVALID_PARAMETER, 'shareKey must be 32 bytes.');
  }
  if (fileKey.byteLength !== 32) {
    throw new ZkCryptoError(ZkErrorCode.INVALID_PARAMETER, 'fileKey must be 32 bytes.');
  }
  uuidToBytes(shareId);
  uuidToBytes(blobId);

  const shareWrapKey = await cryptoProvider.hkdfSha256(
    shareKey,
    new Uint8Array(0),
    utf8Encode('photocloud/v2/share/wrap'),
    32
  );
  try {
    const iv = nonce ?? cryptoProvider.randomBytes(12);
    if (iv.byteLength !== 12) {
      throw new ZkCryptoError(ZkErrorCode.INVALID_PARAMETER, 'share FK wrap nonce must be 12 bytes.');
    }
    const aad = utf8Encode(`share-fk|${shareId.toLowerCase()}|${blobId.toLowerCase()}`);
    const ctWithTag = await cryptoProvider.aes256GcmEncrypt(shareWrapKey, iv, fileKey, aad);
    return concatBytes(iv, ctWithTag);
  } finally {
    zeroize(shareWrapKey);
  }
}

export async function unwrapFileKeyForShare(
  shareKey: Uint8Array,
  shareWrappedFk: Uint8Array,
  shareId: string,
  blobId: string,
  cryptoProvider: ZkCryptoProvider = defaultCryptoProvider
): Promise<Uint8Array> {
  if (shareKey.byteLength !== 32) {
    throw new ZkCryptoError(ZkErrorCode.INVALID_PARAMETER, 'shareKey must be 32 bytes.');
  }
  if (shareWrappedFk.byteLength !== 60) {
    throw new ZkCryptoError(
      ZkErrorCode.WRONG_KEY_OR_PASSPHRASE,
      'shareWrappedFK must be 60 bytes.'
    );
  }
  uuidToBytes(shareId);
  uuidToBytes(blobId);

  const shareWrapKey = await cryptoProvider.hkdfSha256(
    shareKey,
    new Uint8Array(0),
    utf8Encode('photocloud/v2/share/wrap'),
    32
  );
  try {
    const iv = shareWrappedFk.subarray(0, 12);
    const ctWithTag = shareWrappedFk.subarray(12, 60);
    const aad = utf8Encode(`share-fk|${shareId.toLowerCase()}|${blobId.toLowerCase()}`);
    return await cryptoProvider.aes256GcmDecrypt(
      shareWrapKey,
      iv,
      ctWithTag,
      aad,
      ZkErrorCode.WRONG_KEY_OR_PASSPHRASE
    );
  } finally {
    zeroize(shareWrapKey);
  }
}
