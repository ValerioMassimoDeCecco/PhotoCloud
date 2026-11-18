package com.valerio.photocloud.zk

import org.bouncycastle.crypto.generators.Argon2BytesGenerator
import org.bouncycastle.crypto.params.Argon2Parameters
import java.util.Arrays

/**
 * Production Zero-Knowledge Argon2id (RFC 9106 v1.3 / 0x13) wrapper backed exclusively by
 * BouncyCastle (`org.bouncycastle:bcprov-jdk18on:1.82`, `Argon2BytesGenerator`, Bouncy Castle / MIT-style License).
 *
 * The exact same code path is executed in both the Android app (`src/main`) and JVM unit tests (`testDebugUnitTest`).
 * `argon2kt` (JNI/NDK) is deferred and remains optional only if real-device instrumented benchmarks show
 * unacceptable latency or heap pressure.
 */
object ZkArgon2id {

    const val MIN_ARGON2_MEMORY_KIB: Int = 65536 // 64 MiB floor (Spec §2.2 / 4.0.1)
    const val MIN_ARGON2_ITERATIONS: Int = 3
    const val MIN_ARGON2_PARALLELISM: Int = 1
    const val MIN_ARGON2_SALT_BYTES: Int = 16
    const val EXPECTED_HASH_BYTES: Int = 32

    data class Params(
        val memoryKiB: Int = MIN_ARGON2_MEMORY_KIB,
        val iterations: Int = MIN_ARGON2_ITERATIONS,
        val parallelism: Int = MIN_ARGON2_PARALLELISM,
        val hashLength: Int = EXPECTED_HASH_BYTES
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

    /**
     * Enforces the client-side KDF floor (Spec §13.4 / 4.0.1):
     * Argon2id `memoryKiB >= 65536` (64 MiB), `iterations >= 3`, `parallelism >= 1`, `salt >= 16` bytes.
     * Rejects any server-supplied downgrade before allocating KDF memory or executing Argon2id.
     */
    fun validateKdfParamsFloor(params: Params, salt: ByteArray? = null) {
        if (params.memoryKiB < MIN_ARGON2_MEMORY_KIB ||
            params.iterations < MIN_ARGON2_ITERATIONS ||
            params.parallelism < MIN_ARGON2_PARALLELISM ||
            params.hashLength != EXPECTED_HASH_BYTES
        ) {
            throw ZkCryptoException(
                ZkErrorCode.INVALID_PARAMETER,
                "KDF parameter floor violation: requires memoryKiB >= $MIN_ARGON2_MEMORY_KIB, " +
                    "iterations >= $MIN_ARGON2_ITERATIONS, parallelism >= $MIN_ARGON2_PARALLELISM, " +
                    "hashLength == $EXPECTED_HASH_BYTES."
            )
        }
        if (salt != null && salt.size < MIN_ARGON2_SALT_BYTES) {
            throw ZkCryptoException(
                ZkErrorCode.INVALID_PARAMETER,
                "KDF salt floor violation: requires at least $MIN_ARGON2_SALT_BYTES bytes."
            )
        }
    }

    /**
     * Derives an Argon2id v1.3 (0x13) output key using BouncyCastle's [Argon2BytesGenerator].
     * Secret/password copies are zeroized on exit.
     */
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

        val passwordCopy = password.copyOf()
        val saltCopy = salt.copyOf()
        val secretCopy = if (secret.isNotEmpty()) secret.copyOf() else null
        val adCopy = if (associatedData.isNotEmpty()) associatedData.copyOf() else null
        val out = ByteArray(tagLen)

        try {
            onProgress?.invoke(Progress(percent = 0, pass = 0, totalPasses = t, slice = 0))

            val builder = Argon2Parameters.Builder(Argon2Parameters.ARGON2_id)
                .withVersion(Argon2Parameters.ARGON2_VERSION_13)
                .withMemoryAsKB(m)
                .withIterations(t)
                .withParallelism(p)
                .withSalt(saltCopy)
            if (secretCopy != null) {
                builder.withSecret(secretCopy)
            }
            if (adCopy != null) {
                builder.withAdditional(adCopy)
            }

            val generator = Argon2BytesGenerator()
            generator.init(builder.build())
            generator.generateBytes(passwordCopy, out, 0, out.size)

            onProgress?.invoke(Progress(percent = 100, pass = t, totalPasses = t, slice = 4))
            return out
        } finally {
            Arrays.fill(passwordCopy, 0.toByte())
            Arrays.fill(saltCopy, 0.toByte())
            if (secretCopy != null) Arrays.fill(secretCopy, 0.toByte())
            if (adCopy != null) Arrays.fill(adCopy, 0.toByte())
        }
    }
}
