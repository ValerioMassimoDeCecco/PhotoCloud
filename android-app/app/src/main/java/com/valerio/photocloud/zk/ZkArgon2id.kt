package com.valerio.photocloud.zk

import java.nio.ByteBuffer
import java.nio.ByteOrder
import java.util.Arrays
import kotlin.math.ceil

/**
 * RFC 9106 Argon2id v1.3 (0x13) & RFC 7693 BLAKE2b implementation in pure Kotlin
 * so unit tests run directly on standard JVM (`./gradlew testDebugUnitTest`) without
 * requiring an Android device/emulator or native NDK `.so` linkage.
 */
object ZkArgon2id {

    data class Params(
        val memoryKiB: Int = 65536,
        val iterations: Int = 3,
        val parallelism: Int = 1,
        val hashLength: Int = 32
    )

    data class Progress(
        val percent: Int,
        val pass: Int,
        val totalPasses: Int,
        val slice: Int
    )

    fun interface Argon2idProvider {
        fun derive(
            password: ByteArray,
            salt: ByteArray,
            params: Params,
            secret: ByteArray,
            associatedData: ByteArray,
            onProgress: ((Progress) -> Unit)?
        ): ByteArray
    }

    val DefaultProvider: Argon2idProvider = Argon2idProvider { password, salt, params, secret, ad, onProgress ->
        deriveRfc9106(password, salt, params, secret, ad, onProgress)
    }

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

    fun blake2b(input: ByteArray, outLen: Int = 64): ByteArray {
        if (outLen !in 1..64) {
            throw ZkCryptoException(ZkErrorCode.INVALID_PARAMETER, "BLAKE2b outLen must be 1..64.")
        }
        val h = BLAKE2B_IV.clone()
        h[0] = h[0] xor (0x01010000L or outLen.toLong())

        val v = LongArray(16)
        val m = LongArray(16)
        var t0 = 0L
        var t1 = 0L

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
            v[13] = v[13] xor t1
            if (isLast) v[14] = v[14].inv()

            val bb = ByteBuffer.wrap(block, offset, 128).order(ByteOrder.LITTLE_ENDIAN)
            for (i in 0 until 16) {
                m[i] = bb.long
            }
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
            for (i in 0 until 8) {
                h[i] = h[i] xor v[i] xor v[i + 8]
            }
        }

        var offset = 0
        val total = input.size
        while (total - offset > 128) {
            val prev = t0.toULong()
            val next = prev + 128UL
            if (next < prev) t1++
            t0 = next.toLong()
            compress(input, offset, false)
            offset += 128
        }

        val rem = total - offset
        val prev = t0.toULong()
        val next = prev + rem.toULong()
        if (next < prev) t1++
        t0 = next.toLong()

        val lastBlock = ByteArray(128)
        if (rem > 0) {
            System.arraycopy(input, offset, lastBlock, 0, rem)
        }
        compress(lastBlock, 0, true)

        val out = ByteArray(64)
        val outBb = ByteBuffer.wrap(out).order(ByteOrder.LITTLE_ENDIAN)
        for (i in 0 until 8) outBb.putLong(h[i])
        Arrays.fill(h, 0L)
        Arrays.fill(v, 0L)
        Arrays.fill(m, 0L)
        Arrays.fill(lastBlock, 0.toByte())
        return out.copyOfRange(0, outLen)
    }

    fun blake2bLong(input: ByteArray, outLen: Int): ByteArray {
        val msg = ByteBuffer.allocate(4 + input.size).order(ByteOrder.LITTLE_ENDIAN)
            .putInt(outLen)
            .put(input)
            .array()
        try {
            if (outLen <= 64) {
                return blake2b(msg, outLen)
            }
            val r = ceil(outLen.toDouble() / 32.0).toInt() - 2
            val out = ByteArray(outLen)
            var v = blake2b(msg, 64)
            System.arraycopy(v, 0, out, 0, 32)
            for (i in 1 until r) {
                val nextV = blake2b(v, 64)
                Arrays.fill(v, 0.toByte())
                v = nextV
                System.arraycopy(v, 0, out, i * 32, 32)
            }
            val lastLen = outLen - 32 * r
            val lastV = blake2b(v, lastLen)
            Arrays.fill(v, 0.toByte())
            System.arraycopy(lastV, 0, out, r * 32, lastLen)
            Arrays.fill(lastV, 0.toByte())
            return out
        } finally {
            Arrays.fill(msg, 0.toByte())
        }
    }

    private fun fBlaMka(x: Long, y: Long): Long {
        val m = 0xffffffffL
        val xy = ((x and m).toULong() * (y and m).toULong()).toLong()
        return x + y + (xy shl 1)
    }

    private fun gArgon(v: LongArray, a: Int, b: Int, c: Int, d: Int) {
        v[a] = fBlaMka(v[a], v[b])
        v[d] = java.lang.Long.rotateRight(v[d] xor v[a], 32)
        v[c] = fBlaMka(v[c], v[d])
        v[b] = java.lang.Long.rotateRight(v[b] xor v[c], 24)
        v[a] = fBlaMka(v[a], v[b])
        v[d] = java.lang.Long.rotateRight(v[d] xor v[a], 16)
        v[c] = fBlaMka(v[c], v[d])
        v[b] = java.lang.Long.rotateRight(v[b] xor v[c], 63)
    }

    private fun pArgon(
        v: LongArray,
        i0: Int, i1: Int, i2: Int, i3: Int,
        i4: Int, i5: Int, i6: Int, i7: Int,
        i8: Int, i9: Int, i10: Int, i11: Int,
        i12: Int, i13: Int, i14: Int, i15: Int
    ) {
        gArgon(v, i0, i4, i8, i12)
        gArgon(v, i1, i5, i9, i13)
        gArgon(v, i2, i6, i10, i14)
        gArgon(v, i3, i7, i11, i15)
        gArgon(v, i0, i5, i10, i15)
        gArgon(v, i1, i6, i11, i12)
        gArgon(v, i2, i7, i8, i13)
        gArgon(v, i3, i4, i9, i14)
    }

    private fun compressBlock(
        x: LongArray,
        y: LongArray,
        out: LongArray,
        rScratch: LongArray,
        zScratch: LongArray,
        xorWithOut: Boolean
    ) {
        for (i in 0 until 128) {
            val v = x[i] xor y[i]
            rScratch[i] = v
            zScratch[i] = v
        }
        for (row in 0 until 8) {
            val o = row * 16
            pArgon(
                zScratch,
                o + 0, o + 1, o + 2, o + 3,
                o + 4, o + 5, o + 6, o + 7,
                o + 8, o + 9, o + 10, o + 11,
                o + 12, o + 13, o + 14, o + 15
            )
        }
        for (col in 0 until 8) {
            val o = col * 2
            pArgon(
                zScratch,
                o, o + 1, o + 16, o + 17,
                o + 32, o + 33, o + 48, o + 49,
                o + 64, o + 65, o + 80, o + 81,
                o + 96, o + 97, o + 112, o + 113
            )
        }
        if (xorWithOut) {
            for (i in 0 until 128) {
                out[i] = out[i] xor zScratch[i] xor rScratch[i]
            }
        } else {
            for (i in 0 until 128) {
                out[i] = zScratch[i] xor rScratch[i]
            }
        }
    }

    fun deriveRfc9106(
        password: ByteArray,
        salt: ByteArray,
        params: Params,
        secret: ByteArray = ByteArray(0),
        associatedData: ByteArray = ByteArray(0),
        onProgress: ((Progress) -> Unit)? = null
    ): ByteArray {
        val m = params.memoryKiB
        val t = params.iterations
        val p = params.parallelism
        val tagLen = params.hashLength
        if (salt.size < 8 || t < 1 || p < 1 || m < 8 * p || tagLen < 4) {
            throw ZkCryptoException(ZkErrorCode.INVALID_PARAMETER, "Invalid Argon2id parameters.")
        }

        val h0Buf = ByteBuffer.allocate(24 + 4 + password.size + 4 + salt.size + 4 + secret.size + 4 + associatedData.size)
            .order(ByteOrder.LITTLE_ENDIAN)
        h0Buf.putInt(p)
        h0Buf.putInt(tagLen)
        h0Buf.putInt(m)
        h0Buf.putInt(t)
        h0Buf.putInt(0x13)
        h0Buf.putInt(2) // Argon2id
        h0Buf.putInt(password.size)
        h0Buf.put(password)
        h0Buf.putInt(salt.size)
        h0Buf.put(salt)
        h0Buf.putInt(secret.size)
        h0Buf.put(secret)
        h0Buf.putInt(associatedData.size)
        h0Buf.put(associatedData)

        val h0Input = h0Buf.array()
        val h0 = blake2b(h0Input, 64)
        Arrays.fill(h0Input, 0.toByte())

        val mPrime = 4 * p * (m / (4 * p))
        val q = mPrime / p
        val segmentLength = q / 4

        val blocks = Array(mPrime) { LongArray(128) }
        val rScratch = LongArray(128)
        val zScratch = LongArray(128)
        val zeroBlock = LongArray(128)
        val inputBlock = LongArray(128)
        val addrBlock = LongArray(128)
        val tmpBlock = LongArray(128)

        fun bytesToBlock(bytes: ByteArray, target: LongArray) {
            val bb = ByteBuffer.wrap(bytes).order(ByteOrder.LITTLE_ENDIAN)
            for (i in 0 until 128) target[i] = bb.long
        }

        try {
            for (l in 0 until p) {
                val seed0 = ByteBuffer.allocate(72).order(ByteOrder.LITTLE_ENDIAN).put(h0).putInt(0).putInt(l).array()
                val seed1 = ByteBuffer.allocate(72).order(ByteOrder.LITTLE_ENDIAN).put(h0).putInt(1).putInt(l).array()
                val b0 = blake2bLong(seed0, 1024)
                val b1 = blake2bLong(seed1, 1024)
                bytesToBlock(b0, blocks[l * q + 0])
                bytesToBlock(b1, blocks[l * q + 1])
                Arrays.fill(b0, 0.toByte())
                Arrays.fill(b1, 0.toByte())
            }

            val totalSteps = t * 4
            var completedSteps = 0

            for (pass in 0 until t) {
                for (slice in 0 until 4) {
                    val dataIndependent = pass == 0 && slice < 2
                    for (l in 0 until p) {
                        var addrCounter = 0L
                        if (dataIndependent) {
                            Arrays.fill(inputBlock, 0L)
                            inputBlock[0] = pass.toLong()
                            inputBlock[1] = l.toLong()
                            inputBlock[2] = slice.toLong()
                            inputBlock[3] = mPrime.toLong()
                            inputBlock[4] = t.toLong()
                            inputBlock[5] = 2L
                        }
                        val startIdx = if (pass == 0 && slice == 0) 2 else 0
                        for (idx in startIdx until segmentLength) {
                            val currOffset = l * q + slice * segmentLength + idx
                            val prevOffset = if (slice == 0 && idx == 0) l * q + q - 1 else currOffset - 1

                            val pseudoRand: Long = if (dataIndependent) {
                                if (idx % 128 == 0 || idx == startIdx) {
                                    addrCounter++
                                    inputBlock[6] = addrCounter
                                    compressBlock(zeroBlock, inputBlock, tmpBlock, rScratch, zScratch, false)
                                    compressBlock(zeroBlock, tmpBlock, addrBlock, rScratch, zScratch, false)
                                }
                                addrBlock[idx % 128]
                            } else {
                                blocks[prevOffset][0]
                            }

                            val j1 = (pseudoRand.toULong() and 0xffffffffUL)
                            val j2 = ((pseudoRand.toULong() shr 32) and 0xffffffffUL).toInt()

                            val refLane = if (pass == 0 && slice == 0) l else (j2 % p)
                            val refAreaSize = if (pass == 0) {
                                if (slice == 0) {
                                    idx - 1
                                } else if (refLane == l) {
                                    slice * segmentLength + idx - 1
                                } else {
                                    slice * segmentLength - if (idx == 0) 1 else 0
                                }
                            } else {
                                if (refLane == l) {
                                    q - segmentLength + idx - 1
                                } else {
                                    q - segmentLength - if (idx == 0) 1 else 0
                                }
                            }

                            val relPos = (j1 * j1) shr 32
                            val mapPos = refAreaSize - 1 - ((refAreaSize.toULong() * relPos) shr 32).toInt()
                            val startPos = if (pass == 0) 0 else (((slice + 1) % 4) * segmentLength)
                            val refIdx = (startPos + mapPos) % q
                            val refOffset = refLane * q + refIdx

                            compressBlock(blocks[prevOffset], blocks[refOffset], blocks[currOffset], rScratch, zScratch, pass > 0)
                        }
                    }

                    completedSteps++
                    onProgress?.invoke(
                        Progress(
                            percent = (completedSteps * 100) / totalSteps,
                            pass = pass + 1,
                            totalPasses = t,
                            slice = slice + 1
                        )
                    )
                }
            }

            val cBlock = blocks[q - 1].clone()
            for (l in 1 until p) {
                val laneLast = blocks[l * q + q - 1]
                for (i in 0 until 128) {
                    cBlock[i] = cBlock[i] xor laneLast[i]
                }
            }
            val finalBytes = ByteArray(1024)
            val fb = ByteBuffer.wrap(finalBytes).order(ByteOrder.LITTLE_ENDIAN)
            for (i in 0 until 128) fb.putLong(cBlock[i])
            Arrays.fill(cBlock, 0L)

            val out = blake2bLong(finalBytes, tagLen)
            Arrays.fill(finalBytes, 0.toByte())
            return out
        } finally {
            Arrays.fill(h0, 0.toByte())
            Arrays.fill(rScratch, 0L)
            Arrays.fill(zScratch, 0L)
            Arrays.fill(inputBlock, 0L)
            Arrays.fill(addrBlock, 0L)
            Arrays.fill(tmpBlock, 0L)
            for (blk in blocks) Arrays.fill(blk, 0L)
        }
    }
}
