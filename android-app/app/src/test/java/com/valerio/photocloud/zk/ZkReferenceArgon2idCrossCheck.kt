package com.valerio.photocloud.zk

import java.nio.ByteBuffer
import java.nio.ByteOrder
import java.util.Arrays
import kotlin.math.ceil

/**
 * TEST-ONLY CROSS-CHECK IMPLEMENTATION (DO NOT SHIP IN src/main).
 *
 * Independent pure-Kotlin RFC 9106 Argon2id v1.3 (0x13) reference retained exclusively inside
 * `src/test/` as a secondary cross-check against BouncyCastle's [org.bouncycastle.crypto.generators.Argon2BytesGenerator]
 * used in production (`ZkArgon2id.kt`).
 */
internal object ZkReferenceArgon2idCrossCheck {

    private val BLAKE2B_IV = longArrayOf(
        0x6a09e667f3bcc908UL.toLong(),
        0xbb67ae8584caa73bUL.toLong(),
        0x3c6ef372fe94f82bUL.toLong(),
        0xa54ff53a5f1d36f1UL.toLong(),
        0x510e527fade682d1UL.toLong(),
        0x9b05688c2b3e6c1fUL.toLong(),
        0x1f83d9abfb41bd6bUL.toLong(),
        0x5be0cd19137e2179UL.toLong()
    )

    private val SIGMA = arrayOf(
        intArrayOf(0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15),
        intArrayOf(14, 10, 4, 8, 9, 15, 13, 6, 1, 12, 0, 2, 11, 7, 5, 3),
        intArrayOf(11, 8, 12, 0, 5, 2, 15, 13, 10, 14, 3, 6, 7, 1, 9, 4),
        intArrayOf(7, 9, 3, 1, 13, 12, 11, 14, 2, 6, 5, 10, 4, 0, 15, 8),
        intArrayOf(9, 0, 5, 7, 2, 4, 10, 15, 14, 1, 11, 12, 6, 8, 3, 13),
        intArrayOf(2, 12, 6, 10, 0, 11, 8, 3, 4, 13, 7, 5, 15, 14, 1, 9),
        intArrayOf(12, 5, 1, 15, 14, 13, 4, 10, 0, 7, 6, 3, 9, 2, 8, 11),
        intArrayOf(13, 11, 7, 14, 12, 1, 3, 9, 5, 0, 15, 4, 8, 6, 2, 10),
        intArrayOf(6, 15, 14, 9, 11, 3, 0, 8, 12, 2, 13, 7, 1, 4, 10, 5),
        intArrayOf(10, 2, 8, 4, 7, 6, 1, 5, 15, 11, 9, 14, 3, 12, 13, 0),
        intArrayOf(0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15),
        intArrayOf(14, 10, 4, 8, 9, 15, 13, 6, 1, 12, 0, 2, 11, 7, 5, 3)
    )

    private fun blake2b(input: ByteArray, outLen: Int = 64): ByteArray {
        val h = BLAKE2B_IV.clone()
        h[0] = h[0] xor (0x01010000L or outLen.toLong())
        val v = LongArray(16)
        val m = LongArray(16)
        var t0 = 0L

        fun g(a: Int, b: Int, c: Int, d: Int, x: Long, y: Long) {
            v[a] = v[a] + v[b] + x
            v[d] = java.lang.Long.rotateRight(v[d] xor v[a], 32)
            v[c] = v[c] + v[d]
            v[b] = java.lang.Long.rotateRight(v[b] xor v[c], 24)
            v[a] = v[a] + v[b] + y
            v[d] = java.lang.Long.rotateRight(v[d] xor v[a], 16)
            v[c] = v[c] + v[d]
            v[b] = java.lang.Long.rotateRight(v[b] xor v[c], 63)
        }

        fun compress(block: ByteArray, offset: Int, isLast: Boolean) {
            System.arraycopy(h, 0, v, 0, 8)
            System.arraycopy(BLAKE2B_IV, 0, v, 8, 8)
            v[12] = v[12] xor t0
            if (isLast) v[14] = v[14].inv()
            val bb = ByteBuffer.wrap(block, offset, 128).order(ByteOrder.LITTLE_ENDIAN)
            for (i in 0 until 16) m[i] = bb.long
            for (r in 0 until 12) {
                val s = SIGMA[r]
                g(0, 4, 8, 12, m[s[0]], m[s[1]])
                g(1, 5, 9, 13, m[s[2]], m[s[3]])
                g(2, 6, 10, 14, m[s[4]], m[s[5]])
                g(3, 7, 11, 15, m[s[6]], m[s[7]])
                g(0, 5, 10, 15, m[s[8]], m[s[9]])
                g(1, 6, 11, 12, m[s[10]], m[s[11]])
                g(2, 7, 8, 13, m[s[12]], m[s[13]])
                g(3, 4, 9, 14, m[s[14]], m[s[15]])
            }
            for (i in 0 until 8) h[i] = h[i] xor v[i] xor v[i + 8]
        }

        val block = ByteArray(128)
        if (input.isEmpty()) {
            compress(block, 0, true)
        } else {
            var offset = 0
            while (input.size - offset > 128) {
                t0 += 128L
                compress(input, offset, false)
                offset += 128
            }
            val rem = input.size - offset
            t0 += rem.toLong()
            Arrays.fill(block, 0.toByte())
            System.arraycopy(input, offset, block, 0, rem)
            compress(block, 0, true)
        }

        val full = ByteBuffer.allocate(64).order(ByteOrder.LITTLE_ENDIAN)
        for (i in 0 until 8) full.putLong(h[i])
        return full.array().copyOfRange(0, outLen)
    }

    private fun blake2bLong(input: ByteArray, outLen: Int): ByteArray {
        val lenBytes = ByteBuffer.allocate(4).order(ByteOrder.LITTLE_ENDIAN).putInt(outLen).array()
        val seeded = ByteArray(4 + input.size)
        System.arraycopy(lenBytes, 0, seeded, 0, 4)
        System.arraycopy(input, 0, seeded, 4, input.size)
        if (outLen <= 64) return blake2b(seeded, outLen)
        val r = ceil(outLen.toDouble() / 32.0).toInt() - 2
        val out = ByteArray(outLen)
        var vPrev = blake2b(seeded, 64)
        System.arraycopy(vPrev, 0, out, 0, 32)
        for (i in 1 until r) {
            vPrev = blake2b(vPrev, 64)
            System.arraycopy(vPrev, 0, out, i * 32, 32)
        }
        val rem = outLen - 32 * r
        val vLast = blake2b(vPrev, rem)
        System.arraycopy(vLast, 0, out, 32 * r, rem)
        return out
    }

    private fun fBlaMka(x: Long, y: Long): Long = x + y + 2L * ((x and 0xffffffffL) * (y and 0xffffffffL))

    private fun gArgon(v: LongArray, a: Int, b: Int, c: Int, d: Int) {
        v[a] = fBlaMka(v[a], v[b]); v[d] = java.lang.Long.rotateRight(v[d] xor v[a], 32)
        v[c] = fBlaMka(v[c], v[d]); v[b] = java.lang.Long.rotateRight(v[b] xor v[c], 24)
        v[a] = fBlaMka(v[a], v[b]); v[d] = java.lang.Long.rotateRight(v[d] xor v[a], 16)
        v[c] = fBlaMka(v[c], v[d]); v[b] = java.lang.Long.rotateRight(v[b] xor v[c], 63)
    }

    private fun pArgon(v: LongArray, i0: Int, i1: Int, i2: Int, i3: Int, i4: Int, i5: Int, i6: Int, i7: Int, i8: Int, i9: Int, i10: Int, i11: Int, i12: Int, i13: Int, i14: Int, i15: Int) {
        gArgon(v, i0, i4, i8, i12); gArgon(v, i1, i5, i9, i13); gArgon(v, i2, i6, i10, i14); gArgon(v, i3, i7, i11, i15)
        gArgon(v, i0, i5, i10, i15); gArgon(v, i1, i6, i11, i12); gArgon(v, i2, i7, i8, i13); gArgon(v, i3, i4, i9, i14)
    }

    private fun compressBlockFlat(mem: LongArray, xIdx: Int, yIdx: Int, outIdx: Int, r: LongArray, z: LongArray, xorOut: Boolean) {
        val xb = xIdx * 128; val yb = yIdx * 128; val ob = outIdx * 128
        for (i in 0 until 128) { val v = mem[xb + i] xor mem[yb + i]; r[i] = v; z[i] = v }
        for (row in 0 until 8) {
            val o = row * 16
            pArgon(z, o, o + 1, o + 2, o + 3, o + 4, o + 5, o + 6, o + 7, o + 8, o + 9, o + 10, o + 11, o + 12, o + 13, o + 14, o + 15)
        }
        for (col in 0 until 8) {
            val o = col * 2
            pArgon(z, o, o + 1, o + 16, o + 17, o + 32, o + 33, o + 48, o + 49, o + 64, o + 65, o + 80, o + 81, o + 96, o + 97, o + 112, o + 113)
        }
        if (xorOut) { for (i in 0 until 128) mem[ob + i] = mem[ob + i] xor z[i] xor r[i] }
        else { for (i in 0 until 128) mem[ob + i] = z[i] xor r[i] }
    }

    fun derive(password: ByteArray, salt: ByteArray, m: Int, t: Int, p: Int, tagLen: Int, secret: ByteArray = ByteArray(0), ad: ByteArray = ByteArray(0)): ByteArray {
        val h0Buf = ByteBuffer.allocate(40 + password.size + salt.size + secret.size + ad.size).order(ByteOrder.LITTLE_ENDIAN)
        h0Buf.putInt(p).putInt(tagLen).putInt(m).putInt(t).putInt(0x13).putInt(2)
        h0Buf.putInt(password.size).put(password).putInt(salt.size).put(salt).putInt(secret.size).put(secret).putInt(ad.size).put(ad)
        val h0 = blake2b(h0Buf.array(), 64)
        val mPrime = 4 * p * (m / (4 * p)); val q = mPrime / p; val seg = q / 4
        val zeroBlk = mPrime; val inBlk = mPrime + 1; val tmpBlk = mPrime + 2; val addrBlk = mPrime + 3
        val mem = LongArray((mPrime + 4) * 128); val r = LongArray(128); val z = LongArray(128)
        for (l in 0 until p) {
            val b0 = blake2bLong(ByteBuffer.allocate(72).order(ByteOrder.LITTLE_ENDIAN).put(h0).putInt(0).putInt(l).array(), 1024)
            val b1 = blake2bLong(ByteBuffer.allocate(72).order(ByteOrder.LITTLE_ENDIAN).put(h0).putInt(1).putInt(l).array(), 1024)
            val bb0 = ByteBuffer.wrap(b0).order(ByteOrder.LITTLE_ENDIAN)
            val bb1 = ByteBuffer.wrap(b1).order(ByteOrder.LITTLE_ENDIAN)
            for (i in 0 until 128) { mem[(l * q) * 128 + i] = bb0.long; mem[(l * q + 1) * 128 + i] = bb1.long }
        }
        val inBase = inBlk * 128; val addrBase = addrBlk * 128
        for (pass in 0 until t) {
            for (slice in 0 until 4) {
                val di = pass == 0 && slice < 2
                for (l in 0 until p) {
                    var ac = 0L
                    if (di) {
                        Arrays.fill(mem, inBase, inBase + 128, 0L)
                        mem[inBase] = pass.toLong(); mem[inBase + 1] = l.toLong(); mem[inBase + 2] = slice.toLong()
                        mem[inBase + 3] = mPrime.toLong(); mem[inBase + 4] = t.toLong(); mem[inBase + 5] = 2L
                    }
                    val start = if (pass == 0 && slice == 0) 2 else 0
                    for (idx in start until seg) {
                        val curr = l * q + slice * seg + idx
                        val prev = if (slice == 0 && idx == 0) l * q + q - 1 else curr - 1
                        val pr = if (di) {
                            if (idx % 128 == 0 || idx == start) {
                                ac++; mem[inBase + 6] = ac
                                compressBlockFlat(mem, zeroBlk, inBlk, tmpBlk, r, z, false)
                                compressBlockFlat(mem, zeroBlk, tmpBlk, addrBlk, r, z, false)
                            }
                            mem[addrBase + (idx % 128)]
                        } else mem[prev * 128]
                        // j1/j2 are the low/high 32 bits of pseudo_rand. Keep j2 unsigned (ULong):
                        // converting a value >= 2^31 to Int would make it negative and produce a
                        // negative lane index (e.g. -2048 indices), unlike the RFC 9106 reference.
                        val j1 = pr.toULong() and 0xffffffffUL
                        val j2 = (pr.toULong() shr 32) and 0xffffffffUL
                        val rl = if (pass == 0 && slice == 0) l else (j2 % p.toULong()).toInt()
                        val ra = if (pass == 0) (if (slice == 0) idx - 1 else if (rl == l) slice * seg + idx - 1 else slice * seg - if (idx == 0) 1 else 0)
                        else (if (rl == l) q - seg + idx - 1 else q - seg - if (idx == 0) 1 else 0)
                        val mp = ra - 1 - ((ra.toULong() * ((j1 * j1) shr 32)) shr 32).toInt()
                        val sp = if (pass == 0) 0 else (((slice + 1) % 4) * seg)
                        // Floor-modulo (reference_area_size can be 0 for 4*p = m): Kotlin's %
                        // preserves the sign, so normalize into [0, q).
                        val laneOffset = (((sp + mp) % q) + q) % q
                        compressBlockFlat(mem, prev, rl * q + laneOffset, curr, r, z, pass > 0)
                    }
                }
            }
        }
        val fb = ByteBuffer.allocate(1024).order(ByteOrder.LITTLE_ENDIAN)
        for (i in 0 until 128) {
            var w = mem[(q - 1) * 128 + i]
            for (l in 1 until p) w = w xor mem[(l * q + q - 1) * 128 + i]
            fb.putLong(w)
        }
        return blake2bLong(fb.array(), tagLen)
    }
}
