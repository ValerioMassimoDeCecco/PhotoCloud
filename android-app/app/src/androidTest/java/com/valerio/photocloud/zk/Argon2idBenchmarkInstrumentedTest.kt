package com.valerio.photocloud.zk

import android.os.Build
import android.os.Debug
import android.util.Log
import androidx.test.ext.junit.runners.AndroidJUnit4
import org.junit.Assert.assertArrayEquals
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test
import org.junit.runner.RunWith
import java.util.Locale
import kotlin.system.measureNanoTime

/**
 * Instrumented Android benchmark for production BouncyCastle Argon2id (`bcprov-jdk18on:1.82`)
 * at FASE 4A-bis / 4B spec floor (`memoryKiB = 65536`, `t = 3`, `p = 1`).
 *
 * Measures wall-clock latency, ART managed heap (`Runtime`), and native heap (`Debug`) on
 * real devices / Android emulators without introducing `argon2kt`.
 */
@RunWith(AndroidJUnit4::class)
class Argon2idBenchmarkInstrumentedTest {

    companion object {
        private const val TAG = "Argon2idBenchmark"

        // Matches test-vectors/zk-v1.json `keyHierarchy.withPassphraseSpec`
        private const val ACCOUNT_KEY_HEX =
            "000102030405060708090a0b0c0d0e0f101112131415161718191a1b1c1d1e1f"
        private const val USER_SALT_HEX =
            "a0a1a2a3a4a5a6a7a8a9aaabacadaeaf"
        private const val PASSPHRASE_UTF8 =
            "correct-horse-battery-staple-2026!"
        private const val EXPECTED_ROOT_HEX =
            "2ea5889c71984d378b4b75684003578cc082b71bb9fe54a97d7d96f00f39e8d2"
    }

    @Test
    fun benchmark_bouncycastle_argon2id_64MiB_t3_p1() {
        val accountKey = ZkCoreCrypto.fromHex(ACCOUNT_KEY_HEX)
        val userSalt = ZkCoreCrypto.fromHex(USER_SALT_HEX)
        val params = ZkArgon2id.Params(
            memoryKiB = 65536,
            iterations = 3,
            parallelism = 1,
            hashLength = 32
        )
        ZkArgon2id.validateKdfParamsFloor(params, userSalt)

        val runtime = Runtime.getRuntime()
        val maxHeapMiB = runtime.maxMemory() / (1024.0 * 1024.0)
        var warmupOut: ByteArray? = null

        try {
            // Warmup JIT/ART once
            val warmup = ZkCoreCrypto.deriveRoot(
                accountKey = accountKey,
                userSalt = userSalt,
                passphrase = PASSPHRASE_UTF8,
                argon2Params = params
            )
            warmupOut = warmup
            assertEquals(EXPECTED_ROOT_HEX, ZkCoreCrypto.toHex(warmup))
            System.gc()

            val durationsMs = mutableListOf<Double>()
            var peakHeapUsedMiB = 0.0

            for (iter in 1..3) {
                System.gc()
                val heapBeforeBytes = runtime.totalMemory() - runtime.freeMemory()
                val nativeBeforeBytes = Debug.getNativeHeapAllocatedSize()

                lateinit var rootOut: ByteArray
                val elapsedNs = measureNanoTime {
                    rootOut = ZkCoreCrypto.deriveRoot(
                        accountKey = accountKey,
                        userSalt = userSalt,
                        passphrase = PASSPHRASE_UTF8,
                        argon2Params = params
                    )
                }
                assertArrayEquals(warmup, rootOut)
                assertEquals(32, rootOut.size)

                val elapsedMs = elapsedNs / 1_000_000.0
                durationsMs.add(elapsedMs)

                val heapAfterBytes = runtime.totalMemory() - runtime.freeMemory()
                val heapUsedMiB = heapAfterBytes / (1024.0 * 1024.0)
                if (heapUsedMiB > peakHeapUsedMiB) {
                    peakHeapUsedMiB = heapUsedMiB
                }
                val nativeDeltaMiB =
                    (Debug.getNativeHeapAllocatedSize() - nativeBeforeBytes) / (1024.0 * 1024.0)

                Log.i(
                    TAG,
                    "BENCHMARK_ITER=$iter device=${Build.MANUFACTURER}/${Build.MODEL} " +
                        "sdk=${Build.VERSION.SDK_INT} abi=${Build.SUPPORTED_ABIS.firstOrNull()} " +
                        "mKiB=65536 t=3 p=1 elapsedMs=${String.format(Locale.US, "%.1f", elapsedMs)} " +
                        "heapBeforeMiB=${String.format(Locale.US, "%.1f", heapBeforeBytes / (1024.0 * 1024.0))} " +
                        "heapAfterMiB=${String.format(Locale.US, "%.1f", heapUsedMiB)} " +
                        "maxHeapMiB=${String.format(Locale.US, "%.1f", maxHeapMiB)} " +
                        "nativeDeltaMiB=${String.format(Locale.US, "%.2f", nativeDeltaMiB)}"
                )
                rootOut.zeroize()
            }

            val minMs = durationsMs.min()
            val avgMs = durationsMs.average()
            val maxMs = durationsMs.max()

            val summaryLine =
                "BENCHMARK_SUMMARY provider=BouncyCastle-1.82 mKiB=65536 t=3 p=1 " +
                    "minMs=${String.format(Locale.US, "%.1f", minMs)} " +
                    "avgMs=${String.format(Locale.US, "%.1f", avgMs)} " +
                    "maxMs=${String.format(Locale.US, "%.1f", maxMs)} " +
                    "peakHeapMiB=${String.format(Locale.US, "%.1f", peakHeapUsedMiB)} " +
                    "maxHeapMiB=${String.format(Locale.US, "%.1f", maxHeapMiB)}"
            Log.i(TAG, summaryLine)
            println(summaryLine)

            assertTrue("Expected positive execution duration", avgMs > 0.0)
            assertTrue("Expected non-zero max JVM heap", maxHeapMiB > 0.0)
        } finally {
            accountKey.zeroize()
            userSalt.zeroize()
            warmupOut.zeroize()
        }
    }
}
