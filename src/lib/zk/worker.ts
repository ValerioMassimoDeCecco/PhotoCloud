import { defaultArgon2idProvider } from './argon2id.ts';
import { ZkCryptoError, ZkErrorCode } from './errors.ts';
import { deriveKekAndAuthSecret, deriveRoot } from './kdf.ts';
import {
  decryptBlobToBytes,
  encryptBlobToBytes,
  type EncryptBlobStreamResult,
} from './pczkStream.ts';
import type { Argon2idParams, Argon2idProgress } from './provider.ts';
import { zeroize } from './zeroize.ts';

/**
 * Web Worker / Worker Thread Message Protocol for off-main-thread Argon2id KDF
 * and large-file PCZK v1 encryption/decryption with progress callbacks.
 *
 * Works both in a browser `Worker` (`self.onmessage` / `self.postMessage`)
 * and in Node.js `worker_threads` (`parentPort`), or via `ZkWorkerClient`
 * with automatic in-process fallback when Web Workers are not spawned.
 */

export type ZkWorkerRequest =
  | {
      type: 'deriveRootAndKeys';
      requestId: string;
      accountKey: Uint8Array;
      userSalt: Uint8Array;
      passphrase?: string | null;
      argon2Params?: Argon2idParams;
    }
  | {
      type: 'argon2id';
      requestId: string;
      password: Uint8Array;
      salt: Uint8Array;
      params: Argon2idParams;
    }
  | {
      type: 'encryptBlob';
      requestId: string;
      plaintext: Uint8Array;
      fkWrapKey: Uint8Array;
      blobId: string;
      chunkSizeLog2?: number;
      dedupKey?: Uint8Array;
    }
  | {
      type: 'decryptBlob';
      requestId: string;
      ciphertext: Uint8Array;
      fkWrapKey: Uint8Array;
      expectedBlobId?: string;
    };

export type ZkWorkerResponse =
  | {
      type: 'progress';
      requestId: string;
      progress: Argon2idProgress;
    }
  | {
      type: 'blobProgress';
      requestId: string;
      chunkIndex: number;
      plaintextBytesProcessed: number;
    }
  | {
      type: 'deriveRootAndKeysResult';
      requestId: string;
      root: Uint8Array;
      kek: Uint8Array;
      authSecret: Uint8Array;
    }
  | {
      type: 'argon2idResult';
      requestId: string;
      tag: Uint8Array;
    }
  | {
      type: 'encryptBlobResult';
      requestId: string;
      ciphertext: Uint8Array;
      result: EncryptBlobStreamResult;
    }
  | {
      type: 'decryptBlobResult';
      requestId: string;
      plaintext: Uint8Array;
    }
  | {
      type: 'error';
      requestId: string;
      code: ZkErrorCode;
      message: string;
    };

export async function handleZkWorkerRequest(
  req: ZkWorkerRequest,
  emit: (msg: ZkWorkerResponse) => void
): Promise<void> {
  try {
    switch (req.type) {
      case 'argon2id': {
        const pw = new Uint8Array(req.password);
        const salt = new Uint8Array(req.salt);
        try {
          const tag = await defaultArgon2idProvider.derive(pw, salt, req.params, {
            onProgress: (progress) => {
              emit({ type: 'progress', requestId: req.requestId, progress });
            },
          });
          emit({ type: 'argon2idResult', requestId: req.requestId, tag });
        } finally {
          zeroize(pw);
        }
        return;
      }

      case 'deriveRootAndKeys': {
        const accountKey = new Uint8Array(req.accountKey);
        const userSalt = new Uint8Array(req.userSalt);
        try {
          const root = await deriveRoot({
            accountKey,
            userSalt,
            passphrase: req.passphrase,
            argon2Params: req.argon2Params,
            onProgress: (progress) => {
              emit({ type: 'progress', requestId: req.requestId, progress });
            },
          });
          const { kek, authSecret } = await deriveKekAndAuthSecret(root);
          emit({
            type: 'deriveRootAndKeysResult',
            requestId: req.requestId,
            root,
            kek,
            authSecret,
          });
        } finally {
          zeroize(accountKey);
        }
        return;
      }

      case 'encryptBlob': {
        const fkWrapKey = new Uint8Array(req.fkWrapKey);
        const dedupKey = req.dedupKey ? new Uint8Array(req.dedupKey) : undefined;
        try {
          const { ciphertext, result } = await encryptBlobToBytes(req.plaintext, {
            fkWrapKey,
            blobId: req.blobId,
            chunkSizeLog2: req.chunkSizeLog2,
            dedupKey,
            onProgress: ({ chunkIndex, plaintextBytesProcessed }) => {
              emit({
                type: 'blobProgress',
                requestId: req.requestId,
                chunkIndex,
                plaintextBytesProcessed,
              });
            },
          });
          emit({
            type: 'encryptBlobResult',
            requestId: req.requestId,
            ciphertext,
            result,
          });
        } finally {
          zeroize(fkWrapKey, dedupKey);
        }
        return;
      }

      case 'decryptBlob': {
        const fkWrapKey = new Uint8Array(req.fkWrapKey);
        try {
          const { plaintext } = await decryptBlobToBytes(req.ciphertext, {
            fkWrapKey,
            expectedBlobId: req.expectedBlobId,
          });
          emit({
            type: 'decryptBlobResult',
            requestId: req.requestId,
            plaintext,
          });
        } finally {
          zeroize(fkWrapKey);
        }
        return;
      }
    }
  } catch (err) {
    if (err instanceof ZkCryptoError) {
      emit({
        type: 'error',
        requestId: req.requestId,
        code: err.code,
        message: err.message,
      });
    } else {
      emit({
        type: 'error',
        requestId: req.requestId,
        code: ZkErrorCode.INVALID_PARAMETER,
        message: 'Unexpected cryptographic worker error.',
      });
    }
  }
}

export interface ZkWorkerLike {
  postMessage(message: ZkWorkerRequest): void;
  onmessage: ((event: { data: ZkWorkerResponse }) => void) | null;
  terminate?: () => void;
}

/**
 * Create an in-memory Web Worker adapter (or wrap a real browser `Worker`)
 * exposing the exact `postMessage`/`onmessage` Web Worker contract.
 */
export function createInProcessZkWorker(): ZkWorkerLike {
  const worker: ZkWorkerLike = {
    onmessage: null,
    postMessage(message: ZkWorkerRequest) {
      void handleZkWorkerRequest(message, (resp) => {
        if (worker.onmessage) {
          worker.onmessage({ data: resp });
        }
      });
    },
  };
  return worker;
}

export class ZkWorkerClient {
  private readonly worker: ZkWorkerLike;
  private nextId = 1;
  private readonly pending = new Map<
    string,
    {
      resolve: (resp: ZkWorkerResponse) => void;
      reject: (err: ZkCryptoError) => void;
      onProgress?: (progress: Argon2idProgress) => void;
      onBlobProgress?: (info: { chunkIndex: number; plaintextBytesProcessed: number }) => void;
    }
  >();

  constructor(worker?: ZkWorkerLike) {
    this.worker = worker ?? createInProcessZkWorker();
    this.worker.onmessage = (event: { data: ZkWorkerResponse }) => {
      const msg = event.data;
      const entry = this.pending.get(msg.requestId);
      if (!entry) return;

      if (msg.type === 'progress') {
        entry.onProgress?.(msg.progress);
        return;
      }
      if (msg.type === 'blobProgress') {
        entry.onBlobProgress?.({
          chunkIndex: msg.chunkIndex,
          plaintextBytesProcessed: msg.plaintextBytesProcessed,
        });
        return;
      }

      this.pending.delete(msg.requestId);
      if (msg.type === 'error') {
        entry.reject(new ZkCryptoError(msg.code, msg.message));
      } else {
        entry.resolve(msg);
      }
    };
  }

  public async deriveArgon2id(
    password: Uint8Array,
    salt: Uint8Array,
    params: Argon2idParams,
    onProgress?: (progress: Argon2idProgress) => void
  ): Promise<Uint8Array> {
    const requestId = `req_${this.nextId++}`;
    const resp = await new Promise<ZkWorkerResponse>((resolve, reject) => {
      this.pending.set(requestId, { resolve, reject, onProgress });
      this.worker.postMessage({
        type: 'argon2id',
        requestId,
        password,
        salt,
        params,
      });
    });
    if (resp.type !== 'argon2idResult') {
      throw new ZkCryptoError(ZkErrorCode.INVALID_PARAMETER, 'Unexpected worker response.');
    }
    return resp.tag;
  }

  public async deriveRootAndKeys(params: {
    accountKey: Uint8Array;
    userSalt: Uint8Array;
    passphrase?: string | null;
    argon2Params?: Argon2idParams;
    onProgress?: (progress: Argon2idProgress) => void;
  }): Promise<{ root: Uint8Array; kek: Uint8Array; authSecret: Uint8Array }> {
    const requestId = `req_${this.nextId++}`;
    const resp = await new Promise<ZkWorkerResponse>((resolve, reject) => {
      this.pending.set(requestId, { resolve, reject, onProgress: params.onProgress });
      this.worker.postMessage({
        type: 'deriveRootAndKeys',
        requestId,
        accountKey: params.accountKey,
        userSalt: params.userSalt,
        passphrase: params.passphrase,
        argon2Params: params.argon2Params,
      });
    });
    if (resp.type !== 'deriveRootAndKeysResult') {
      throw new ZkCryptoError(ZkErrorCode.INVALID_PARAMETER, 'Unexpected worker response.');
    }
    return {
      root: resp.root,
      kek: resp.kek,
      authSecret: resp.authSecret,
    };
  }

  public async encryptBlob(params: {
    plaintext: Uint8Array;
    fkWrapKey: Uint8Array;
    blobId: string;
    chunkSizeLog2?: number;
    dedupKey?: Uint8Array;
    onProgress?: (info: { chunkIndex: number; plaintextBytesProcessed: number }) => void;
  }): Promise<{ ciphertext: Uint8Array; result: EncryptBlobStreamResult }> {
    const requestId = `req_${this.nextId++}`;
    const resp = await new Promise<ZkWorkerResponse>((resolve, reject) => {
      this.pending.set(requestId, {
        resolve,
        reject,
        onBlobProgress: params.onProgress,
      });
      this.worker.postMessage({
        type: 'encryptBlob',
        requestId,
        plaintext: params.plaintext,
        fkWrapKey: params.fkWrapKey,
        blobId: params.blobId,
        chunkSizeLog2: params.chunkSizeLog2,
        dedupKey: params.dedupKey,
      });
    });
    if (resp.type !== 'encryptBlobResult') {
      throw new ZkCryptoError(ZkErrorCode.INVALID_PARAMETER, 'Unexpected worker response.');
    }
    return { ciphertext: resp.ciphertext, result: resp.result };
  }

  public terminate(): void {
    this.worker.terminate?.();
    this.pending.clear();
  }
}
