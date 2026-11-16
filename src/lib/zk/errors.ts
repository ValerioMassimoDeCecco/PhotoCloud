/**
 * Typed cryptographic errors for PhotoCloud Zero-Knowledge (v2).
 *
 * Security Invariant:
 * Error messages and properties NEVER include key material, passphrases,
 * nonces, authSecrets, or unauthenticated plaintext bytes.
 */

export enum ZkErrorCode {
  WRONG_KEY_OR_PASSPHRASE = 'WRONG_KEY_OR_PASSPHRASE',
  AUTH_TAG_MISMATCH = 'AUTH_TAG_MISMATCH',
  TRUNCATED_BLOB = 'TRUNCATED_BLOB',
  UNSUPPORTED_VERSION = 'UNSUPPORTED_VERSION',
  MALFORMED_HEADER = 'MALFORMED_HEADER',
  INVALID_PARAMETER = 'INVALID_PARAMETER',
}

export class ZkCryptoError extends Error {
  public readonly code: ZkErrorCode;

  constructor(code: ZkErrorCode, message: string) {
    super(message);
    this.name = 'ZkCryptoError';
    this.code = code;
    Object.setPrototypeOf(this, ZkCryptoError.prototype);
  }
}
