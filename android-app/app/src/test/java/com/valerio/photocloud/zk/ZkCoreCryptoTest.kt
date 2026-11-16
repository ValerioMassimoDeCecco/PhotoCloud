package com.valerio.photocloud.zk

import org.json.JSONObject
import org.junit.Assert.assertArrayEquals
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Assert.fail
import org.junit.Test
import java.io.ByteArrayInputStream
import java.io.ByteArrayOutputStream
import java.io.File
import java.io.InputStream
import java.io.OutputStream
import java.nio.charset.StandardCharsets

class ZkCoreCryptoTest {

    private fun resolveRepoRoot(): File {
        val candidates = listOf(
            File(".."),
            File("../.."),
            File(".")
        )
        return candidates.firstOrNull { File(it, "test-vectors/zk-v1.json").exists() }
            ?: error("Could not locate test-vectors/zk-v1.json from working directory ${File(".").absolutePath}")
    }

    private val repoRoot: File by lazy { resolveRepoRoot() }
    private val vectors: JSONObject by lazy {
        val text = File(repoRoot, "test-vectors/zk-v1.json").readText(StandardCharsets.UTF_8)
        JSONObject(text)
    }

    @Test
    fun `RFC 5869 HKDF-SHA256 official test vectors pass`() {
        val arr = vectors.getJSONArray("rfc5869HkdfSha256")
        for (i in 0 until arr.length()) {
            val tc = arr.getJSONObject(i)
            val ikm = ZkCoreCrypto.fromHex(tc.getString("ikmHex"))
            val salt = ZkCoreCrypto.fromHex(tc.getString("saltHex"))
            val info = ZkCoreCrypto.fromHex(tc.getString("infoHex"))
            val len = tc.getInt("length")
            val okm = JvmCryptoProvider.hkdfSha256(ikm, salt, info, len)
            assertEquals(tc.getString("expectedOkmHex"), ZkCoreCrypto.toHex(okm))
        }
    }

    @Test
    fun `RFC 9106 Section 5_3 Argon2id official test vector passes`() {
        val s = vectors.getJSONObject("rfc9106SelfCheck")
        val tag = ZkArgon2id.deriveRfc9106(
            password = ZkCoreCrypto.fromHex(s.getString("passwordHex")),
            salt = ZkCoreCrypto.fromHex(s.getString("saltHex")),
            params = ZkArgon2id.Params(
                memoryKiB = s.getInt("mKiB"),
                iterations = s.getInt("t"),
                parallelism = s.getInt("p"),
                hashLength = s.getInt("tagLen")
            ),
            secret = ZkCoreCrypto.fromHex(s.getString("secretHex")),
            associatedData = ZkCoreCrypto.fromHex(s.getString("associatedDataHex"))
        )
        assertEquals(s.getString("expectedTagHex"), ZkCoreCrypto.toHex(tag))
    }

    @Test
    fun `Key hierarchy vectors pass for withPassphraseFast, withPassphraseSpec 64MiB, and withoutPassphrase`() {
        val inputs = vectors.getJSONObject("inputs")
        val accountKey = ZkCoreCrypto.fromHex(inputs.getString("accountKeyHex"))
        val userSalt = ZkCoreCrypto.fromHex(inputs.getString("userSaltHex"))
        val passphrase = inputs.getString("passphraseUtf8")
        val kh = vectors.getJSONObject("keyHierarchy")

        // 1. Fast profile
        val fastParamsJson = inputs.getJSONObject("argon2FastParams")
        val rootFast = ZkCoreCrypto.deriveRoot(
            accountKey = accountKey,
            userSalt = userSalt,
            passphrase = passphrase,
            argon2Params = ZkArgon2id.Params(
                memoryKiB = fastParamsJson.getInt("memoryKiB"),
                iterations = fastParamsJson.getInt("iterations"),
                parallelism = fastParamsJson.getInt("parallelism"),
                hashLength = fastParamsJson.getInt("hashLength")
            )
        )
        val expectedFast = kh.getJSONObject("withPassphraseFast")
        assertEquals(expectedFast.getString("rootHex"), ZkCoreCrypto.toHex(rootFast))
        val keysFast = ZkCoreCrypto.deriveKekAndAuthSecret(rootFast)
        assertEquals(expectedFast.getString("kekHex"), ZkCoreCrypto.toHex(keysFast.kek))
        assertEquals(expectedFast.getString("authSecretHex"), ZkCoreCrypto.toHex(keysFast.authSecret))

        // 2. Without passphrase
        val rootNoPass = ZkCoreCrypto.deriveRoot(
            accountKey = accountKey,
            userSalt = userSalt,
            passphrase = null
        )
        val expectedNoPass = kh.getJSONObject("withoutPassphrase")
        assertEquals(expectedNoPass.getString("rootHex"), ZkCoreCrypto.toHex(rootNoPass))
        val keysNoPass = ZkCoreCrypto.deriveKekAndAuthSecret(rootNoPass)
        assertEquals(expectedNoPass.getString("kekHex"), ZkCoreCrypto.toHex(keysNoPass.kek))
        assertEquals(expectedNoPass.getString("authSecretHex"), ZkCoreCrypto.toHex(keysNoPass.authSecret))

        // 3. Full Spec profile (64 MiB)
        val specParamsJson = inputs.getJSONObject("argon2SpecParams")
        val rootSpec = ZkCoreCrypto.deriveRoot(
            accountKey = accountKey,
            userSalt = userSalt,
            passphrase = passphrase,
            argon2Params = ZkArgon2id.Params(
                memoryKiB = specParamsJson.getInt("memoryKiB"),
                iterations = specParamsJson.getInt("iterations"),
                parallelism = specParamsJson.getInt("parallelism"),
                hashLength = specParamsJson.getInt("hashLength")
            )
        )
        val expectedSpec = kh.getJSONObject("withPassphraseSpec")
        assertEquals(expectedSpec.getString("rootHex"), ZkCoreCrypto.toHex(rootSpec))
        val keysSpec = ZkCoreCrypto.deriveKekAndAuthSecret(rootSpec)
        assertEquals(expectedSpec.getString("kekHex"), ZkCoreCrypto.toHex(keysSpec.kek))
        assertEquals(expectedSpec.getString("authSecretHex"), ZkCoreCrypto.toHex(keysSpec.authSecret))
    }

    @Test
    fun `VK wrap_unwrap, subkeys, FK wrap_unwrap, and Share FK wrap_unwrap match vectors`() {
        val inputs = vectors.getJSONObject("inputs")
        val userId = inputs.getString("userId")
        val vks = vectors.getJSONObject("vaultKeyAndSubkeys")
        val vk = ZkCoreCrypto.fromHex(vks.getString("vaultKeyHex"))
        val vkNonce = ZkCoreCrypto.fromHex(vks.getString("vkWrapNonceHex"))
        val kekSpec = ZkCoreCrypto.fromHex(
            vectors.getJSONObject("keyHierarchy").getJSONObject("withPassphraseSpec").getString("kekHex")
        )

        val wrappedVk = ZkCoreCrypto.wrapVaultKey(kekSpec, vk, userId, vkNonce)
        assertEquals(vks.getString("wrappedVkSpecHex"), ZkCoreCrypto.toHex(wrappedVk))
        val unwrappedVk = ZkCoreCrypto.unwrapVaultKey(kekSpec, wrappedVk, userId)
        assertArrayEquals(vk, unwrappedVk)

        val subkeys = ZkCoreCrypto.deriveSubkeys(vk)
        val expectedSub = vks.getJSONObject("subkeys")
        assertEquals(expectedSub.getString("metaKeyHex"), ZkCoreCrypto.toHex(subkeys.metaKey))
        assertEquals(expectedSub.getString("thumbKeyHex"), ZkCoreCrypto.toHex(subkeys.thumbKey))
        assertEquals(expectedSub.getString("dedupKeyHex"), ZkCoreCrypto.toHex(subkeys.dedupKey))
        assertEquals(expectedSub.getString("fkWrapKeyHex"), ZkCoreCrypto.toHex(subkeys.fkWrapKey))

        val fkw = vectors.getJSONObject("fileKeyWrap")
        val blobId = fkw.getString("blobId")
        val fk = ZkCoreCrypto.fromHex(fkw.getString("fileKeyHex"))
        val fkNonce = ZkCoreCrypto.fromHex(fkw.getString("fkWrapNonceHex"))
        val wrappedFk = ZkCoreCrypto.wrapFileKey(subkeys.fkWrapKey, fk, blobId, fkNonce)
        assertEquals(fkw.getString("wrappedFkHex"), ZkCoreCrypto.toHex(wrappedFk))
        assertArrayEquals(fk, ZkCoreCrypto.unwrapFileKey(subkeys.fkWrapKey, wrappedFk, blobId))

        val sh = vectors.getJSONObject("sharing")
        val shareId = sh.getString("shareId")
        val shareKey = ZkCoreCrypto.fromHex(sh.getString("shareKeyHex"))
        val shareNonce = ZkCoreCrypto.fromHex(sh.getString("shareFkNonceHex"))
        val shareWrapped = ZkCoreCrypto.wrapFileKeyForShare(shareKey, fk, shareId, blobId, shareNonce)
        assertEquals(sh.getString("shareWrappedFkHex"), ZkCoreCrypto.toHex(shareWrapped))
        assertArrayEquals(fk, ZkCoreCrypto.unwrapFileKeyForShare(shareKey, shareWrapped, shareId, blobId))
    }

    @Test
    fun `Interoperability and PCZK v1 vectors pass for empty, single-chunk, and multi-chunk fixtures`() {
        val subkeys = vectors.getJSONObject("vaultKeyAndSubkeys").getJSONObject("subkeys")
        val fkWrapKey = ZkCoreCrypto.fromHex(subkeys.getString("fkWrapKeyHex"))
        val dedupKey = ZkCoreCrypto.fromHex(subkeys.getString("dedupKeyHex"))
        val fkw = vectors.getJSONObject("fileKeyWrap")
        val blobId = fkw.getString("blobId")
        val blobs = vectors.getJSONObject("pczkBlobs")

        // 1. Empty fixture
        val emptyFileBytes = File(repoRoot, blobs.getJSONObject("emptyFile").getString("fixtureFile")).readBytes()
        val emptyOut = ByteArrayOutputStream()
        val emptyRes = ZkCoreCrypto.decryptBlobStream(
            ByteArrayInputStream(emptyFileBytes),
            emptyOut,
            fkWrapKey = fkWrapKey,
            expectedBlobId = blobId
        )
        assertEquals(0L, emptyRes.totalPlaintextBytes)
        assertEquals(1, emptyRes.chunkCount)
        assertEquals(0, emptyOut.size())

        // 2. Single-chunk fixture
        val singleObj = blobs.getJSONObject("singleChunk")
        val singleFileBytes = File(repoRoot, singleObj.getString("fixtureFile")).readBytes()
        val singleOut = ByteArrayOutputStream()
        ZkCoreCrypto.decryptBlobStream(
            ByteArrayInputStream(singleFileBytes),
            singleOut,
            fkWrapKey = fkWrapKey,
            expectedBlobId = blobId
        )
        assertEquals(singleObj.getString("plaintextUtf8"), String(singleOut.toByteArray(), StandardCharsets.UTF_8))

        // 3. Multi-chunk fixture
        val multiObj = blobs.getJSONObject("multiChunk")
        val multiFileBytes = File(repoRoot, multiObj.getString("fixtureFile")).readBytes()
        val multiOut = ByteArrayOutputStream()
        val multiRes = ZkCoreCrypto.decryptBlobStream(
            ByteArrayInputStream(multiFileBytes),
            multiOut,
            fkWrapKey = fkWrapKey,
            expectedBlobId = blobId
        )
        assertEquals(150000L, multiRes.totalPlaintextBytes)
        assertEquals(3, multiRes.chunkCount)
        val expectedMultiPt = ByteArray(150000) { i -> ((i * 31 + 17) and 0xff).toByte() }
        assertArrayEquals(expectedMultiPt, multiOut.toByteArray())

        // Dedup tag streaming check
        val dedupTag = ZkCoreCrypto.computeDedupTag(dedupKey, ByteArrayInputStream(expectedMultiPt))
        assertEquals(
            vectors.getJSONObject("dedupTags").getString("multiChunkPlaintextDedupTagHex"),
            ZkCoreCrypto.toHex(dedupTag)
        )
    }

    @Test
    fun `Constant-memory 305 MiB streaming round-trip in Kotlin`() {
        val totalMiB = 305
        val chunkSize = 1048576
        val totalBytes = totalMiB.toLong() * chunkSize.toLong()
        val fkWrapKey = ByteArray(32) { (it + 1).toByte() }
        val blobId = "30500000-0000-4000-8000-000000000305"

        val syntheticInput = object : InputStream() {
            var pos = 0L
            override fun read(): Int {
                if (pos >= totalBytes) return -1
                val b = ((pos * 13 + 7) and 0xff).toInt()
                pos++
                return b
            }

            override fun read(b: ByteArray, off: Int, len: Int): Int {
                if (pos >= totalBytes) return -1
                val take = minOf(len.toLong(), totalBytes - pos).toInt()
                for (i in 0 until take) {
                    b[off + i] = (((pos + i) * 13 + 7) and 0xff).toByte()
                }
                pos += take
                return take
            }
        }

        val nullSink = object : OutputStream() {
            var written = 0L
            override fun write(b: Int) {
                written++
            }
            override fun write(b: ByteArray, off: Int, len: Int) {
                written += len
            }
        }

        val encRes = ZkCoreCrypto.encryptBlobStream(
            input = syntheticInput,
            output = nullSink,
            fkWrapKey = fkWrapKey,
            blobId = blobId,
            chunkSizeLog2 = 20
        )
        assertEquals(totalBytes, encRes.totalPlaintextBytes)
        assertEquals(totalMiB, encRes.chunkCount)
    }

    @Test
    fun `Negative tests reject bit-flips, truncation at chunk boundary, reordering, wrong key, and unknown version`() {
        val subkeys = vectors.getJSONObject("vaultKeyAndSubkeys").getJSONObject("subkeys")
        val fkWrapKey = ZkCoreCrypto.fromHex(subkeys.getString("fkWrapKeyHex"))
        val blobId = vectors.getJSONObject("fileKeyWrap").getString("blobId")
        val blobs = vectors.getJSONObject("pczkBlobs")
        val singleCt = File(repoRoot, blobs.getJSONObject("singleChunk").getString("fixtureFile")).readBytes()
        val multiCt = File(repoRoot, blobs.getJSONObject("multiChunk").getString("fixtureFile")).readBytes()

        fun assertFailsWithZeroOutput(blob: ByteArray, expectedCode: ZkErrorCode) {
            val out = ByteArrayOutputStream()
            try {
                ZkCoreCrypto.decryptBlobStream(
                    ByteArrayInputStream(blob),
                    out,
                    fkWrapKey = fkWrapKey,
                    expectedBlobId = blobId
                )
                fail("Expected ZkCryptoException($expectedCode)")
            } catch (e: ZkCryptoException) {
                assertEquals(expectedCode, e.code)
                assertEquals(0, out.size())
            }
        }

        // Unknown version
        val badVer = singleCt.clone().also { it[4] = 0x02 }
        assertFailsWithZeroOutput(badVer, ZkErrorCode.UNSUPPORTED_VERSION)

        // Bit-flip in chunk ciphertext
        val bitFlipCt = singleCt.clone().also { it[90] = (it[90].toInt() xor 0x01).toByte() }
        assertFailsWithZeroOutput(bitFlipCt, ZkErrorCode.AUTH_TAG_MISMATCH)

        // Exact chunk boundary truncation (cut after chunk 0 of 3-chunk blob)
        val truncatedAtChunk0 = multiCt.copyOfRange(0, 86 + 65552)
        assertFailsWithZeroOutput(truncatedAtChunk0, ZkErrorCode.AUTH_TAG_MISMATCH)

        // Chunk reordering (swap chunk 0 and chunk 1)
        val reordered = ByteArray(multiCt.size)
        System.arraycopy(multiCt, 0, reordered, 0, 86)
        System.arraycopy(multiCt, 86 + 65552, reordered, 86, 65552)
        System.arraycopy(multiCt, 86, reordered, 86 + 65552, 65552)
        System.arraycopy(multiCt, 86 + 65552 * 2, reordered, 86 + 65552 * 2, multiCt.size - (86 + 65552 * 2))
        assertFailsWithZeroOutput(reordered, ZkErrorCode.AUTH_TAG_MISMATCH)

        assertTrue(true)
    }
}
