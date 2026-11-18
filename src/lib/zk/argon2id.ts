import { argon2id as hashWasmArgon2id } from 'hash-wasm';
import { ZkCryptoError, ZkErrorCode } from './errors.ts';
import type { Argon2idOptions, Argon2idParams, Argon2idProvider } from './provider.ts';
import { concatBytes, zeroize } from './zeroize.ts';

/**
 * RFC 9106 Argon2id v1.3 (0x13) implementation using 32-bit TypedArrays
 * (`Uint32Array`) for high throughput in both browser Web Workers and Node.js,
 * with progress callback support (`onProgress`) and full memory zeroization
 * of the Argon2 block matrix in `finally`.
 */

const BLAKE2B_IV32 = new Uint32Array([
  0xf3bcc908, 0x6a09e667, 0x84caa73b, 0xbb67ae85,
  0xfe94f82b, 0x3c6ef372, 0x5f1d36f1, 0xa54ff53a,
  0xade682d1, 0x510e527f, 0x2b3e6c1f, 0x9b05688c,
  0xfb41bd6b, 0x1f83d9ab, 0x137e2179, 0x5be0cd19,
]);

const SIGMA = [
  [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15],
  [14, 10, 4, 8, 9, 15, 13, 6, 1, 12, 0, 2, 11, 7, 5, 3],
  [11, 8, 12, 0, 5, 2, 15, 13, 10, 14, 3, 6, 7, 1, 9, 4],
  [7, 9, 3, 1, 13, 12, 11, 14, 2, 6, 5, 10, 4, 0, 15, 8],
  [9, 0, 5, 7, 2, 4, 10, 15, 14, 1, 11, 12, 6, 8, 3, 13],
  [2, 12, 6, 10, 0, 11, 8, 3, 4, 13, 7, 5, 15, 14, 1, 9],
  [12, 5, 1, 15, 14, 13, 4, 10, 0, 7, 6, 3, 9, 2, 8, 11],
  [13, 11, 7, 14, 12, 1, 3, 9, 5, 0, 15, 4, 8, 6, 2, 10],
  [6, 15, 14, 9, 11, 3, 0, 8, 12, 2, 13, 7, 1, 4, 10, 5],
  [10, 2, 8, 4, 7, 6, 1, 5, 15, 11, 9, 14, 3, 12, 13, 0],
  [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15],
  [14, 10, 4, 8, 9, 15, 13, 6, 1, 12, 0, 2, 11, 7, 5, 3],
];

function u32le(n: number): Uint8Array {
  const b = new Uint8Array(4);
  new DataView(b.buffer).setUint32(0, n >>> 0, true);
  return b;
}

export function blake2b(input: Uint8Array, outLen = 64): Uint8Array {
  if (outLen < 1 || outLen > 64) {
    throw new ZkCryptoError(ZkErrorCode.INVALID_PARAMETER, 'BLAKE2b outLen must be 1..64.');
  }
  const h = new Uint32Array(BLAKE2B_IV32);
  h[0] ^= 0x01010000 ^ outLen;

  const v = new Uint32Array(32);
  const m = new Uint32Array(32);
  let t0 = 0;
  let t1 = 0;

  function gBlake(a: number, b: number, c: number, d: number, ix: number, iy: number): void {
    const a2 = a * 2;
    const b2 = b * 2;
    const c2 = c * 2;
    const d2 = d * 2;
    const x2 = ix * 2;
    const y2 = iy * 2;

    // v[a] = v[a] + v[b] + x
    let lo = (v[a2] + v[b2]) >>> 0;
    let hi = (v[a2 + 1] + v[b2 + 1] + (lo < v[a2] ? 1 : 0)) >>> 0;
    const lo2 = (lo + m[x2]) >>> 0;
    hi = (hi + m[x2 + 1] + (lo2 < lo ? 1 : 0)) >>> 0;
    v[a2] = lo2;
    v[a2 + 1] = hi;

    // v[d] = rotr64(v[d] ^ v[a], 32)
    let dLo = v[d2] ^ v[a2];
    let dHi = v[d2 + 1] ^ v[a2 + 1];
    v[d2] = dHi;
    v[d2 + 1] = dLo;

    // v[c] = v[c] + v[d]
    lo = (v[c2] + v[d2]) >>> 0;
    hi = (v[c2 + 1] + v[d2 + 1] + (lo < v[c2] ? 1 : 0)) >>> 0;
    v[c2] = lo;
    v[c2 + 1] = hi;

    // v[b] = rotr64(v[b] ^ v[c], 24)
    let bLo = v[b2] ^ v[c2];
    let bHi = v[b2 + 1] ^ v[c2 + 1];
    v[b2] = ((bLo >>> 24) | (bHi << 8)) >>> 0;
    v[b2 + 1] = ((bHi >>> 24) | (bLo << 8)) >>> 0;

    // v[a] = v[a] + v[b] + y
    lo = (v[a2] + v[b2]) >>> 0;
    hi = (v[a2 + 1] + v[b2 + 1] + (lo < v[a2] ? 1 : 0)) >>> 0;
    const lo3 = (lo + m[y2]) >>> 0;
    hi = (hi + m[y2 + 1] + (lo3 < lo ? 1 : 0)) >>> 0;
    v[a2] = lo3;
    v[a2 + 1] = hi;

    // v[d] = rotr64(v[d] ^ v[a], 16)
    dLo = v[d2] ^ v[a2];
    dHi = v[d2 + 1] ^ v[a2 + 1];
    v[d2] = ((dLo >>> 16) | (dHi << 16)) >>> 0;
    v[d2 + 1] = ((dHi >>> 16) | (dLo << 16)) >>> 0;

    // v[c] = v[c] + v[d]
    lo = (v[c2] + v[d2]) >>> 0;
    hi = (v[c2 + 1] + v[d2 + 1] + (lo < v[c2] ? 1 : 0)) >>> 0;
    v[c2] = lo;
    v[c2 + 1] = hi;

    // v[b] = rotr64(v[b] ^ v[c], 63) -> rotl64 by 1
    bLo = v[b2] ^ v[c2];
    bHi = v[b2 + 1] ^ v[c2 + 1];
    v[b2] = ((bLo << 1) | (bHi >>> 31)) >>> 0;
    v[b2 + 1] = ((bHi << 1) | (bLo >>> 31)) >>> 0;
  }

  function compress(block: Uint8Array, offset: number, isLast: boolean): void {
    v.set(h, 0);
    v.set(BLAKE2B_IV32, 16);
    v[24] ^= t0;
    v[25] ^= t1;
    if (isLast) {
      v[28] = ~v[28] >>> 0;
      v[29] = ~v[29] >>> 0;
    }
    const dv = new DataView(block.buffer, block.byteOffset + offset, 128);
    for (let i = 0; i < 32; i++) {
      m[i] = dv.getUint32(i * 4, true);
    }
    for (let r = 0; r < 12; r++) {
      const s = SIGMA[r];
      gBlake(0, 4, 8, 12, s[0], s[1]);
      gBlake(1, 5, 9, 13, s[2], s[3]);
      gBlake(2, 6, 10, 14, s[4], s[5]);
      gBlake(3, 7, 11, 15, s[6], s[7]);
      gBlake(0, 5, 10, 15, s[8], s[9]);
      gBlake(1, 6, 11, 12, s[10], s[11]);
      gBlake(2, 7, 8, 13, s[12], s[13]);
      gBlake(3, 4, 9, 14, s[14], s[15]);
    }
    for (let i = 0; i < 16; i++) {
      h[i] ^= v[i] ^ v[i + 16];
    }
  }

  let offset = 0;
  const total = input.byteLength;
  while (total - offset > 128) {
    const nextT0 = (t0 + 128) >>> 0;
    if (nextT0 < t0) t1 = (t1 + 1) >>> 0;
    t0 = nextT0;
    compress(input, offset, false);
    offset += 128;
  }

  const rem = total - offset;
  const nextT0 = (t0 + rem) >>> 0;
  if (nextT0 < t0) t1 = (t1 + 1) >>> 0;
  t0 = nextT0;

  const lastBlock = new Uint8Array(128);
  if (rem > 0) {
    lastBlock.set(input.subarray(offset, total), 0);
  }
  compress(lastBlock, 0, true);

  const out = new Uint8Array(64);
  const outDv = new DataView(out.buffer);
  for (let i = 0; i < 16; i++) {
    outDv.setUint32(i * 4, h[i], true);
  }
  zeroize(h, v, m, lastBlock);
  return out.subarray(0, outLen);
}

export function blake2bLong(input: Uint8Array, outLen: number): Uint8Array {
  const msg = concatBytes(u32le(outLen), input);
  try {
    if (outLen <= 64) {
      return blake2b(msg, outLen);
    }
    const r = Math.ceil(outLen / 32) - 2;
    const out = new Uint8Array(outLen);
    let V = blake2b(msg, 64);
    out.set(V.subarray(0, 32), 0);
    for (let i = 1; i < r; i++) {
      const nextV = blake2b(V, 64);
      zeroize(V);
      V = nextV;
      out.set(V.subarray(0, 32), i * 32);
    }
    const lastLen = outLen - 32 * r;
    const lastV = blake2b(V, lastLen);
    zeroize(V);
    out.set(lastV, r * 32);
    zeroize(lastV);
    return out;
  } finally {
    zeroize(msg);
  }
}

/**
 * High-speed zero-allocation 32-bit implementation of Argon2's fBlaMka and GB
 * compression function using `Math.imul`.
 * Each 1024-byte Argon2 block is stored as 256 uint32 words (little-endian pairs [lo, hi]).
 */
function mul32Hi(x: number, y: number): number {
  const xL = x & 0xffff;
  const xH = x >>> 16;
  const yL = y & 0xffff;
  const yH = y >>> 16;
  const pLL = Math.imul(xL, yL) >>> 0;
  const pHL = Math.imul(xH, yL) >>> 0;
  const pLH = Math.imul(xL, yH) >>> 0;
  const pHH = Math.imul(xH, yH) >>> 0;
  const mid = ((pLL >>> 16) + (pHL & 0xffff) + (pLH & 0xffff)) >>> 0;
  return (pHH + (pHL >>> 16) + (pLH >>> 16) + (mid >>> 16)) >>> 0;
}

function gArgon32(v: Uint32Array, a: number, b: number, c: number, d: number): void {
  const a2 = a * 2;
  const b2 = b * 2;
  const c2 = c * 2;
  const d2 = d * 2;

  let aLo = v[a2];
  let aHi = v[a2 + 1];
  let bLo = v[b2];
  let bHi = v[b2 + 1];
  let cLo = v[c2];
  let cHi = v[c2 + 1];
  let dLo = v[d2];
  let dHi = v[d2 + 1];

  // 1. a = fBlaMka(a, b) = a + b + 2 * (aLo * bLo)
  let mLo = Math.imul(aLo, bLo) >>> 0;
  let mHi = mul32Hi(aLo, bLo);
  let pLo = (mLo << 1) >>> 0;
  let pHi = ((mHi << 1) | (mLo >>> 31)) >>> 0;
  let sLo = (aLo + bLo) >>> 0;
  let sHi = (aHi + bHi + (sLo < aLo ? 1 : 0)) >>> 0;
  aLo = (sLo + pLo) >>> 0;
  aHi = (sHi + pHi + (aLo < sLo ? 1 : 0)) >>> 0;

  // d = rotr64(d ^ a, 32)
  const daLo = (dLo ^ aLo) >>> 0;
  const daHi = (dHi ^ aHi) >>> 0;
  dLo = daHi;
  dHi = daLo;

  // 2. c = fBlaMka(c, d)
  mLo = Math.imul(cLo, dLo) >>> 0;
  mHi = mul32Hi(cLo, dLo);
  pLo = (mLo << 1) >>> 0;
  pHi = ((mHi << 1) | (mLo >>> 31)) >>> 0;
  sLo = (cLo + dLo) >>> 0;
  sHi = (cHi + dHi + (sLo < cLo ? 1 : 0)) >>> 0;
  cLo = (sLo + pLo) >>> 0;
  cHi = (sHi + pHi + (cLo < sLo ? 1 : 0)) >>> 0;

  // b = rotr64(b ^ c, 24)
  const bcLo = (bLo ^ cLo) >>> 0;
  const bcHi = (bHi ^ cHi) >>> 0;
  bLo = ((bcLo >>> 24) | (bcHi << 8)) >>> 0;
  bHi = ((bcHi >>> 24) | (bcLo << 8)) >>> 0;

  // 3. a = fBlaMka(a, b)
  mLo = Math.imul(aLo, bLo) >>> 0;
  mHi = mul32Hi(aLo, bLo);
  pLo = (mLo << 1) >>> 0;
  pHi = ((mHi << 1) | (mLo >>> 31)) >>> 0;
  sLo = (aLo + bLo) >>> 0;
  sHi = (aHi + bHi + (sLo < aLo ? 1 : 0)) >>> 0;
  aLo = (sLo + pLo) >>> 0;
  aHi = (sHi + pHi + (aLo < sLo ? 1 : 0)) >>> 0;

  // d = rotr64(d ^ a, 16)
  const da2Lo = (dLo ^ aLo) >>> 0;
  const da2Hi = (dHi ^ aHi) >>> 0;
  dLo = ((da2Lo >>> 16) | (da2Hi << 16)) >>> 0;
  dHi = ((da2Hi >>> 16) | (da2Lo << 16)) >>> 0;

  // 4. c = fBlaMka(c, d)
  mLo = Math.imul(cLo, dLo) >>> 0;
  mHi = mul32Hi(cLo, dLo);
  pLo = (mLo << 1) >>> 0;
  pHi = ((mHi << 1) | (mLo >>> 31)) >>> 0;
  sLo = (cLo + dLo) >>> 0;
  sHi = (cHi + dHi + (sLo < cLo ? 1 : 0)) >>> 0;
  cLo = (sLo + pLo) >>> 0;
  cHi = (sHi + pHi + (cLo < sLo ? 1 : 0)) >>> 0;

  // b = rotr64(b ^ c, 63) -> rotl64 by 1
  const bc2Lo = (bLo ^ cLo) >>> 0;
  const bc2Hi = (bHi ^ cHi) >>> 0;
  bLo = ((bc2Lo << 1) | (bc2Hi >>> 31)) >>> 0;
  bHi = ((bc2Hi << 1) | (bc2Lo >>> 31)) >>> 0;

  v[a2] = aLo;
  v[a2 + 1] = aHi;
  v[b2] = bLo;
  v[b2 + 1] = bHi;
  v[c2] = cLo;
  v[c2 + 1] = cHi;
  v[d2] = dLo;
  v[d2 + 1] = dHi;
}

function pArgon32(
  v: Uint32Array,
  i0: number, i1: number, i2: number, i3: number,
  i4: number, i5: number, i6: number, i7: number,
  i8: number, i9: number, i10: number, i11: number,
  i12: number, i13: number, i14: number, i15: number
): void {
  gArgon32(v, i0, i4, i8, i12);
  gArgon32(v, i1, i5, i9, i13);
  gArgon32(v, i2, i6, i10, i14);
  gArgon32(v, i3, i7, i11, i15);
  gArgon32(v, i0, i5, i10, i15);
  gArgon32(v, i1, i6, i11, i12);
  gArgon32(v, i2, i7, i8, i13);
  gArgon32(v, i3, i4, i9, i14);
}

const SCRATCH_R = new Uint32Array(256);
const SCRATCH_Z = new Uint32Array(256);

function compressBlock32(
  mem: Uint32Array,
  xBlockIdx: number,
  yBlockIdx: number,
  outBlockIdx: number,
  xorWithOut: boolean
): void {
  const xOff = xBlockIdx * 256;
  const yOff = yBlockIdx * 256;
  const outOff = outBlockIdx * 256;
  for (let i = 0; i < 256; i++) {
    const val = (mem[xOff + i] ^ mem[yOff + i]) >>> 0;
    SCRATCH_R[i] = val;
    SCRATCH_Z[i] = val;
  }
  for (let r = 0; r < 8; r++) {
    const o = r * 16;
    pArgon32(
      SCRATCH_Z,
      o + 0, o + 1, o + 2, o + 3,
      o + 4, o + 5, o + 6, o + 7,
      o + 8, o + 9, o + 10, o + 11,
      o + 12, o + 13, o + 14, o + 15
    );
  }
  for (let c = 0; c < 8; c++) {
    const o = c * 2;
    pArgon32(
      SCRATCH_Z,
      o, o + 1, o + 16, o + 17,
      o + 32, o + 33, o + 48, o + 49,
      o + 64, o + 65, o + 80, o + 81,
      o + 96, o + 97, o + 112, o + 113
    );
  }
  if (xorWithOut) {
    for (let i = 0; i < 256; i++) {
      mem[outOff + i] = (mem[outOff + i] ^ SCRATCH_Z[i] ^ SCRATCH_R[i]) >>> 0;
    }
  } else {
    for (let i = 0; i < 256; i++) {
      mem[outOff + i] = (SCRATCH_Z[i] ^ SCRATCH_R[i]) >>> 0;
    }
  }
}

export class Rfc9106Argon2idProvider implements Argon2idProvider {
  public async derive(
    password: Uint8Array,
    salt: Uint8Array,
    params: Argon2idParams,
    options?: Argon2idOptions
  ): Promise<Uint8Array> {
    const { memoryKiB: m, iterations: t, parallelism: p, hashLength: tagLen } = params;
    if (salt.byteLength < 8) {
      throw new ZkCryptoError(ZkErrorCode.INVALID_PARAMETER, 'Argon2id salt must be at least 8 bytes.');
    }
    if (t < 1 || p < 1 || m < 8 * p || tagLen < 4) {
      throw new ZkCryptoError(ZkErrorCode.INVALID_PARAMETER, 'Invalid Argon2id parameters.');
    }

    const secret = options?.secret ?? new Uint8Array(0);
    const ad = options?.associatedData ?? new Uint8Array(0);

    if (secret.byteLength === 0 && ad.byteLength === 0) {
      try {
        const wasmOut = await hashWasmArgon2id({
          password,
          salt,
          memorySize: m,
          iterations: t,
          parallelism: p,
          hashLength: tagLen,
          outputType: 'binary',
        });
        if (options?.onProgress) {
          for (let pass = 1; pass <= t; pass++) {
            for (let slice = 1; slice <= 4; slice++) {
              options.onProgress({
                percent: Math.round((((pass - 1) * 4 + slice) / (t * 4)) * 100),
                pass,
                totalPasses: t,
                slice,
              });
            }
          }
        }
        return new Uint8Array(wasmOut);
      } catch {
        // Fallback to pure-TS RFC 9106 engine (e.g. when CSP blocks WebAssembly without wasm-unsafe-eval)
      }
    }

    const h0Input = concatBytes(
      u32le(p),
      u32le(tagLen),
      u32le(m),
      u32le(t),
      u32le(0x13),
      u32le(2),
      u32le(password.byteLength),
      password,
      u32le(salt.byteLength),
      salt,
      u32le(secret.byteLength),
      secret,
      u32le(ad.byteLength),
      ad
    );
    const H0 = blake2b(h0Input, 64);
    zeroize(h0Input);

    const mPrime = 4 * p * Math.floor(m / (4 * p));
    const q = mPrime / p;
    const segmentLength = q / 4;

    // Allocate mPrime main blocks + 4 scratch blocks (zero, input, tmp, addr) in one contiguous Uint32Array
    const totalBlocks = mPrime + 4;
    const zeroBlkIdx = mPrime;
    const inputBlkIdx = mPrime + 1;
    const tmpBlkIdx = mPrime + 2;
    const addrBlkIdx = mPrime + 3;
    const mem = new Uint32Array(totalBlocks * 256);

    try {
      const writeBufToBlock = (buf: Uint8Array, blkIdx: number) => {
        const dv = new DataView(buf.buffer, buf.byteOffset, 1024);
        const base = blkIdx * 256;
        for (let i = 0; i < 256; i++) {
          mem[base + i] = dv.getUint32(i * 4, true);
        }
      };

      for (let l = 0; l < p; l++) {
        const b0 = blake2bLong(concatBytes(H0, u32le(0), u32le(l)), 1024);
        const b1 = blake2bLong(concatBytes(H0, u32le(1), u32le(l)), 1024);
        writeBufToBlock(b0, l * q + 0);
        writeBufToBlock(b1, l * q + 1);
        zeroize(b0, b1);
      }

      const totalSteps = t * 4;
      let completedSteps = 0;

      for (let pass = 0; pass < t; pass++) {
        for (let slice = 0; slice < 4; slice++) {
          const dataIndependent = pass === 0 && slice < 2;
          for (let l = 0; l < p; l++) {
            let addrCounter = 0;
            const inBase = inputBlkIdx * 256;
            if (dataIndependent) {
              mem.fill(0, inBase, inBase + 256);
              mem[inBase + 0] = pass >>> 0;
              mem[inBase + 2] = l >>> 0;
              mem[inBase + 4] = slice >>> 0;
              mem[inBase + 6] = mPrime >>> 0;
              mem[inBase + 8] = t >>> 0;
              mem[inBase + 10] = 2; // Argon2id
            }

            const startIdx = pass === 0 && slice === 0 ? 2 : 0;
            for (let idx = startIdx; idx < segmentLength; idx++) {
              const currOffset = l * q + slice * segmentLength + idx;
              const prevOffset = slice === 0 && idx === 0 ? l * q + q - 1 : currOffset - 1;

              let j1: number;
              let j2: number;
              if (dataIndependent) {
                if (idx % 128 === 0 || idx === startIdx) {
                  addrCounter++;
                  mem[inBase + 12] = addrCounter >>> 0;
                  compressBlock32(mem, zeroBlkIdx, inputBlkIdx, tmpBlkIdx, false);
                  compressBlock32(mem, zeroBlkIdx, tmpBlkIdx, addrBlkIdx, false);
                }
                const addrOff = addrBlkIdx * 256 + (idx % 128) * 2;
                j1 = mem[addrOff];
                j2 = mem[addrOff + 1];
              } else {
                const prevBase = prevOffset * 256;
                j1 = mem[prevBase];
                j2 = mem[prevBase + 1];
              }

              const refLane = pass === 0 && slice === 0 ? l : j2 % p;
              let refAreaSize: number;
              if (pass === 0) {
                if (slice === 0) {
                  refAreaSize = idx - 1;
                } else if (refLane === l) {
                  refAreaSize = slice * segmentLength + idx - 1;
                } else {
                  refAreaSize = slice * segmentLength - (idx === 0 ? 1 : 0);
                }
              } else {
                if (refLane === l) {
                  refAreaSize = q - segmentLength + idx - 1;
                } else {
                  refAreaSize = q - segmentLength - (idx === 0 ? 1 : 0);
                }
              }

              const relPos = Number((BigInt(j1) * BigInt(j1)) >> 32n);
              const mapPos = refAreaSize - 1 - Number((BigInt(refAreaSize) * BigInt(relPos)) >> 32n);
              const startPos = pass === 0 ? 0 : ((slice + 1) % 4) * segmentLength;
              const refIdx = (startPos + mapPos) % q;
              const refOffset = refLane * q + refIdx;

              compressBlock32(mem, prevOffset, refOffset, currOffset, pass > 0);
            }
          }

          completedSteps++;
          if (options?.onProgress) {
            options.onProgress({
              percent: Math.round((completedSteps / totalSteps) * 100),
              pass: pass + 1,
              totalPasses: t,
              slice: slice + 1,
            });
          }
        }
      }

      const finalBlockBytes = new Uint8Array(1024);
      const finalDv = new DataView(finalBlockBytes.buffer);
      for (let i = 0; i < 256; i++) {
        let word = mem[(0 * q + q - 1) * 256 + i];
        for (let l = 1; l < p; l++) {
          word = (word ^ mem[(l * q + q - 1) * 256 + i]) >>> 0;
        }
        finalDv.setUint32(i * 4, word, true);
      }

      const tag = blake2bLong(finalBlockBytes, tagLen);
      zeroize(finalBlockBytes);
      return tag;
    } finally {
      zeroize(H0, mem, SCRATCH_R, SCRATCH_Z);
    }
  }
}

export const defaultArgon2idProvider: Argon2idProvider = new Rfc9106Argon2idProvider();
