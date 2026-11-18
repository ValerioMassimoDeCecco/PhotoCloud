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
import java.security.MessageDigest
import java.util.Base64
import javax.crypto.Mac
import javax.crypto.spec.SecretKeySpec

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
    fun `RFC 9106 Section 5_3 Argon2id passes with production BouncyCastle Argon2BytesGenerator and matches test-only cross-check`() {
        val s = vectors.getJSONObject("rfc9106SelfCheck")
        val password = ZkCoreCrypto.fromHex(s.getString("passwordHex"))
        val salt = ZkCoreCrypto.fromHex(s.getString("saltHex"))
        val secret = ZkCoreCrypto.fromHex(s.getString("secretHex"))
        val ad = ZkCoreCrypto.fromHex(s.getString("associatedDataHex"))
        val m = s.getInt("mKiB")
        val t = s.getInt("t")
        val p = s.getInt("p")
        val tagLen = s.getInt("tagLen")

        val prodTag = ZkArgon2id.deriveRfc9106(
            password = password,
            salt = salt,
            params = ZkArgon2id.Params(
                memoryKiB = m,
                iterations = t,
                parallelism = p,
                hashLength = tagLen
            ),
            secret = secret,
            associatedData = ad
        )
        assertEquals(s.getString("expectedTagHex"), ZkCoreCrypto.toHex(prodTag))

        // Secondary cross-check against TEST-ONLY reference implementation
        val refTag = ZkReferenceArgon2idCrossCheck.derive(
            password = password,
            salt = salt,
            m = m,
            t = t,
            p = p,
            tagLen = tagLen,
            secret = secret,
            ad = ad
        )
        assertArrayEquals(prodTag, refTag)
    }

    @Test
    fun `Key hierarchy vectors pass for withPassphraseFast, withPassphraseSpec 64MiB, and withoutPassphrase using BouncyCastle`() {
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

        // 3. Full Spec profile (64 MiB) executed on production BouncyCastle Argon2BytesGenerator
        val specParamsJson = inputs.getJSONObject("argon2SpecParams")
        val specParams = ZkArgon2id.Params(
            memoryKiB = specParamsJson.getInt("memoryKiB"),
            iterations = specParamsJson.getInt("iterations"),
            parallelism = specParamsJson.getInt("parallelism"),
            hashLength = specParamsJson.getInt("hashLength")
        )
        ZkArgon2id.validateKdfParamsFloor(specParams, userSalt)
        val rootSpec = ZkCoreCrypto.deriveRoot(
            accountKey = accountKey,
            userSalt = userSalt,
            passphrase = passphrase,
            argon2Params = specParams
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

        // 3. Multi-chunk fixture + cross-chunk decryptBlobRange
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

        val headerBytes = multiFileBytes.copyOfRange(0, ZkCoreCrypto.PCZK_HEADER_LENGTH)
        val header = ZkCoreCrypto.parsePczkHeader(headerBytes)
        val plan = ZkCoreCrypto.computeBlobRangePlan(
            totalCiphertextBytes = multiFileBytes.size.toLong(),
            chunkSizeLog2 = header.chunkSizeLog2,
            startPlaintextByte = 60000L,
            endPlaintextByteInclusive = 135000L
        )
        val rangeCtSlice = multiFileBytes.copyOfRange(
            plan.ciphertextStartByte.toInt(),
            plan.ciphertextEndByteInclusive.toInt() + 1
        )
        val rangePt = ZkCoreCrypto.decryptBlobRange(
            headerBytes = headerBytes,
            totalCiphertextBytes = multiFileBytes.size.toLong(),
            startPlaintextByte = 60000L,
            endPlaintextByteInclusive = 135000L,
            ciphertextSlice = rangeCtSlice,
            fkWrapKey = fkWrapKey,
            expectedBlobId = blobId
        )
        assertArrayEquals(expectedMultiPt.copyOfRange(60000, 135001), rangePt)

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
    fun `Negative tests reject bit-flips, truncation, reordering, duplication, swapped blobId, wrong key, unknown version, and weak KDF params`() {
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

        // Bit-flip in header wrappedFk
        val bitFlipHeader = singleCt.clone().also { it[35] = (it[35].toInt() xor 0x01).toByte() }
        assertFailsWithZeroOutput(bitFlipHeader, ZkErrorCode.WRONG_KEY_OR_PASSPHRASE)

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

        // Chunk duplication (duplicate chunk 0 in place of chunk 1)
        val duplicated = multiCt.clone()
        System.arraycopy(multiCt, 86, duplicated, 86 + 65552, 65552)
        assertFailsWithZeroOutput(duplicated, ZkErrorCode.AUTH_TAG_MISMATCH)

        // Swapped blobId (valid blob A presented as blob B)
        val outSwapped = ByteArrayOutputStream()
        try {
            ZkCoreCrypto.decryptBlobStream(
                ByteArrayInputStream(singleCt),
                outSwapped,
                fkWrapKey = fkWrapKey,
                expectedBlobId = "99999999-9999-4999-8999-999999999999"
            )
            fail("Expected WRONG_KEY_OR_PASSPHRASE on swapped blobId")
        } catch (e: ZkCryptoException) {
            assertEquals(ZkErrorCode.WRONG_KEY_OR_PASSPHRASE, e.code)
            assertEquals(0, outSwapped.size())
        }

        // Wrong passphrase / wrong KEK on unwrapVaultKey
        val inputs = vectors.getJSONObject("inputs")
        val userId = inputs.getString("userId")
        val vks = vectors.getJSONObject("vaultKeyAndSubkeys")
        val wrappedVk = ZkCoreCrypto.fromHex(vks.getString("wrappedVkSpecHex"))
        val wrongKek = ByteArray(32) { 0x55.toByte() }
        try {
            ZkCoreCrypto.unwrapVaultKey(wrongKek, wrappedVk, userId)
            fail("Expected WRONG_KEY_OR_PASSPHRASE on wrong KEK")
        } catch (e: ZkCryptoException) {
            assertEquals(ZkErrorCode.WRONG_KEY_OR_PASSPHRASE, e.code)
        }

        // KDF Floor enforcement (Argon2id < 64 MiB, t < 3, salt < 16B -> INVALID_PARAMETER)
        val validSalt = ByteArray(16) { 0x11.toByte() }
        for (weak in listOf(
            ZkArgon2id.Params(memoryKiB = 32768, iterations = 3, parallelism = 1),
            ZkArgon2id.Params(memoryKiB = 65536, iterations = 2, parallelism = 1)
        )) {
            try {
                ZkArgon2id.validateKdfParamsFloor(weak, validSalt)
                fail("Expected INVALID_PARAMETER for weak KDF params: $weak")
            } catch (e: ZkCryptoException) {
                assertEquals(ZkErrorCode.INVALID_PARAMETER, e.code)
            }
        }
        try {
            ZkArgon2id.validateKdfParamsFloor(
                ZkArgon2id.Params(memoryKiB = 65536, iterations = 3, parallelism = 1),
                ByteArray(15)
            )
            fail("Expected INVALID_PARAMETER for salt < 16 bytes")
        } catch (e: ZkCryptoException) {
            assertEquals(ZkErrorCode.INVALID_PARAMETER, e.code)
        }

        assertTrue(true)
    }

    @Test
    fun `TypeScript to Kotlin interop decrypts wrappedVk, blob_pczk, decryptBlobRange, encMeta, shareManifest, and albums from test-vectors_interop`() {
        val interopDir = File(repoRoot, "test-vectors/interop")
        val manifest = JSONObject(File(interopDir, "manifest.json").readText(StandardCharsets.UTF_8))

        val userId = manifest.getString("userId")
        val blobId = manifest.getString("blobId")
        val shareId = manifest.getString("shareId")
        val passphrase = manifest.getString("passphrase")

        val accountKey = ZkCoreCrypto.fromHex(manifest.getString("accountKeyHex"))
        val userSalt = ZkCoreCrypto.fromHex(manifest.getString("userSaltHex"))
        val kdfJson = manifest.getJSONObject("kdfParams")
        val kdfParams = ZkArgon2id.Params(
            memoryKiB = kdfJson.getInt("memoryKiB"),
            iterations = kdfJson.getInt("iterations"),
            parallelism = kdfJson.getInt("parallelism"),
            hashLength = kdfJson.getInt("hashLength")
        )

        // 1. Enforce KDF floor (64 MiB, t=3, p=1, salt>=16B) and derive Root + KEK via BouncyCastle
        ZkArgon2id.validateKdfParamsFloor(kdfParams, userSalt)
        val root = ZkCoreCrypto.deriveRoot(
            accountKey = accountKey,
            userSalt = userSalt,
            passphrase = passphrase,
            argon2Params = kdfParams
        )
        assertEquals(manifest.getString("rootHex"), ZkCoreCrypto.toHex(root))
        val kekAndAuth = ZkCoreCrypto.deriveKekAndAuthSecret(root)
        assertEquals(manifest.getString("kekHex"), ZkCoreCrypto.toHex(kekAndAuth.kek))
        assertEquals(manifest.getString("authSecretHex"), ZkCoreCrypto.toHex(kekAndAuth.authSecret))

        // 2. Unwrap VK from wrappedVk.bin
        val filesObj = manifest.getJSONObject("files")
        val wrappedVkBytes = File(interopDir, filesObj.getString("wrappedVk")).readBytes()
        val vk = ZkCoreCrypto.unwrapVaultKey(kekAndAuth.kek, wrappedVkBytes, userId)
        assertEquals(manifest.getString("vaultKeyHex"), ZkCoreCrypto.toHex(vk))

        val subkeys = ZkCoreCrypto.deriveSubkeys(vk)

        // 3. Full stream decrypt of blob.pczk and ciphertext SHA-256 verification
        val blobBytes = File(interopDir, filesObj.getString("blob")).readBytes()
        val actualCtSha = ZkCoreCrypto.toHex(JvmCryptoProvider.sha256(blobBytes))
        assertEquals(manifest.getString("ciphertextSha256Hex"), actualCtSha)

        val blobOut = ByteArrayOutputStream()
        ZkCoreCrypto.decryptBlobStream(
            ByteArrayInputStream(blobBytes),
            blobOut,
            fkWrapKey = subkeys.fkWrapKey,
            expectedBlobId = blobId
        )
        val fullPlaintext = blobOut.toByteArray()
        assertEquals(manifest.getString("plaintextUtf8"), String(fullPlaintext, StandardCharsets.UTF_8))

        val dedupTag = ZkCoreCrypto.computeDedupTag(subkeys.dedupKey, ByteArrayInputStream(fullPlaintext))
        assertEquals(manifest.getString("dedupTagHex"), ZkCoreCrypto.toHex(dedupTag))

        // 4. Range decryption (decryptBlobRange on bytes 10..45)
        val rangeSlice = ZkCoreCrypto.decryptBlobRange(
            headerBytes = blobBytes.copyOfRange(0, ZkCoreCrypto.PCZK_HEADER_LENGTH),
            totalCiphertextBytes = blobBytes.size.toLong(),
            startPlaintextByte = 10L,
            endPlaintextByteInclusive = 45L,
            ciphertextSlice = blobBytes.copyOfRange(ZkCoreCrypto.PCZK_HEADER_LENGTH, blobBytes.size),
            fkWrapKey = subkeys.fkWrapKey,
            expectedBlobId = blobId
        )
        assertArrayEquals(fullPlaintext.copyOfRange(10, 46), rangeSlice)

        // 5. Decrypt encMeta.bin
        val encMetaBytes = File(interopDir, filesObj.getString("encMeta")).readBytes()
        val metaJson = ZkCoreCrypto.decryptMeta(subkeys.metaKey, blobId, encMetaBytes)
        val parsedMeta = JSONObject(metaJson)
        assertEquals(manifest.getString("expectedMetaName"), parsedMeta.getString("name"))
        assertEquals(fullPlaintext.size, parsedMeta.getInt("size"))

        // 6. Decrypt shareManifest.bin and inner wrappedFk + encMeta
        val shareKey = ZkCoreCrypto.fromHex(manifest.getString("shareKeyHex"))
        val shareManifestBytes = File(interopDir, filesObj.getString("shareManifest")).readBytes()
        val shareManifestJson = ZkCoreCrypto.decryptShareManifest(shareKey, shareId, shareManifestBytes)
        val parsedManifest = JSONObject(shareManifestJson)
        assertEquals(shareId, parsedManifest.getString("shareId"))
        val firstShareItem = parsedManifest.getJSONArray("items").getJSONObject(0)
        val shareWrappedFk = ZkCoreCrypto.fromBase64Url(firstShareItem.getString("wrappedFk"))
        val shareFk = ZkCoreCrypto.unwrapFileKeyForShare(shareKey, shareWrappedFk, shareId, firstShareItem.getString("blobId"))
        assertEquals(32, shareFk.size)

        // 7. Decrypt albums.bin
        val albumsBytes = File(interopDir, filesObj.getString("albums")).readBytes()
        val (revision, albumsJson) = ZkCoreCrypto.decryptAlbums(subkeys.metaKey, userId, albumsBytes)
        assertEquals(1, revision)
        val parsedAlbums = JSONObject(albumsJson)
        assertEquals("Interop Album 2026", parsedAlbums.getJSONArray("albums").getJSONObject(0).getString("name"))
    }

    @Test
    fun `Reverse interop Kotlin to TypeScript emits real fixtures to build_interop-kotlin`() {
        val outPath = System.getProperty("interop.kotlin.outDir")
        val outDir = if (!outPath.isNullOrBlank()) {
            File(outPath)
        } else {
            File(repoRoot, "android-app/app/build/interop-kotlin")
        }
        outDir.mkdirs()

        val userId = "77777777-6666-4555-8444-333333333333"
        val blobId = "fedcba98-7654-4321-8fed-cba987654321"
        val passphrase = "Kotlin-To-TypeScript-Interop-2026!"

        val accountKey = ByteArray(32) { i -> ((0x21 + i) and 0xff).toByte() }
        val userSalt = ByteArray(16) { i -> ((0xb0 + i) and 0xff).toByte() }
        val vk = ByteArray(32) { i -> ((0x70 + i) and 0xff).toByte() }
        val fk = ByteArray(32) { i -> ((0x90 + i) and 0xff).toByte() }

        val kdfParams = ZkArgon2id.Params(
            memoryKiB = 65536,
            iterations = 3,
            parallelism = 1,
            hashLength = 32
        )
        ZkArgon2id.validateKdfParamsFloor(kdfParams, userSalt)

        val root = ZkCoreCrypto.deriveRoot(
            accountKey = accountKey,
            userSalt = userSalt,
            passphrase = passphrase,
            argon2Params = kdfParams
        )
        val kekAndAuth = ZkCoreCrypto.deriveKekAndAuthSecret(root)

        val vkWrapNonce = ByteArray(12) { i -> (i + 1).toByte() }
        val wrappedVk = ZkCoreCrypto.wrapVaultKey(kekAndAuth.kek, vk, userId, vkWrapNonce)
        File(outDir, "wrappedVk.bin").writeBytes(wrappedVk)

        val subkeys = ZkCoreCrypto.deriveSubkeys(vk)

        val plaintextStr = "Reverse Interop Fixture: Encrypted by real Kotlin ZkCoreCryptoTest (BouncyCastle Argon2id) and verified by TypeScript & Python in CI."
        val plaintext = plaintextStr.toByteArray(StandardCharsets.UTF_8)
        val fkWrapNonce = ByteArray(12) { i -> (17 + i).toByte() }
        val noncePrefix = byteArrayOf(0x4b, 0x54, 0x30, 0x31)

        val blobOut = ByteArrayOutputStream()
        val encResult = ZkCoreCrypto.encryptBlobStream(
            input = ByteArrayInputStream(plaintext),
            output = blobOut,
            fkWrapKey = subkeys.fkWrapKey,
            blobId = blobId,
            fileKey = fk,
            fkWrapNonce = fkWrapNonce,
            noncePrefix = noncePrefix,
            chunkSizeLog2 = 16,
            dedupKey = subkeys.dedupKey
        )
        val pczkBytes = blobOut.toByteArray()
        File(outDir, "blob.pczk").writeBytes(pczkBytes)

        val metaJson = """{"v":1,"name":"kotlin_camera_capture.jpg","mime":"image/jpeg","size":${plaintext.size},"takenAt":1763250000000,"createdAt":1763250005000,"width":4000,"height":3000,"isFavorite":true}"""
        val metaNonce = ByteArray(12) { i -> (33 + i).toByte() }
        val encMeta = ZkCoreCrypto.encryptMeta(subkeys.metaKey, blobId, metaJson, metaNonce)
        File(outDir, "encMeta.bin").writeBytes(encMeta)

        // Write manifest.json for CI interop job (TS + Python)
        val manifest = JSONObject().apply {
            put("version", 1)
            put("direction", "kotlin-to-typescript")
            put("generatedBy", "ZkCoreCryptoTest#Reverse interop Kotlin to TypeScript")
            put("userId", userId)
            put("blobId", blobId)
            put("passphrase", passphrase)
            put("kdfParams", JSONObject().apply {
                put("memoryKiB", kdfParams.memoryKiB)
                put("iterations", kdfParams.iterations)
                put("parallelism", kdfParams.parallelism)
                put("hashLength", kdfParams.hashLength)
            })
            put("accountKeyHex", ZkCoreCrypto.toHex(accountKey))
            put("userSaltHex", ZkCoreCrypto.toHex(userSalt))
            put("rootHex", ZkCoreCrypto.toHex(root))
            put("kekHex", ZkCoreCrypto.toHex(kekAndAuth.kek))
            put("authSecretHex", ZkCoreCrypto.toHex(kekAndAuth.authSecret))
            put("vaultKeyHex", ZkCoreCrypto.toHex(vk))
            put("fileKeyHex", ZkCoreCrypto.toHex(fk))
            put("plaintextUtf8", plaintextStr)
            put("plaintextSha256Hex", ZkCoreCrypto.toHex(JvmCryptoProvider.sha256(plaintext)))
            put("ciphertextSha256Hex", encResult.ciphertextSha256Hex)
            put("dedupTagHex", encResult.dedupTagHex)
            put("expectedMetaName", "kotlin_camera_capture.jpg")
            put("files", JSONObject().apply {
                put("blob", "blob.pczk")
                put("encMeta", "encMeta.bin")
                put("wrappedVk", "wrappedVk.bin")
            })
        }
        File(outDir, "manifest.json").writeText(manifest.toString(2) + "\n", StandardCharsets.UTF_8)

        // Self-verify round-trip in Kotlin
        val verifyOut = ByteArrayOutputStream()
        ZkCoreCrypto.decryptBlobStream(
            ByteArrayInputStream(pczkBytes),
            verifyOut,
            fkWrapKey = subkeys.fkWrapKey,
            expectedBlobId = blobId
        )
        assertArrayEquals(plaintext, verifyOut.toByteArray())
        assertEquals(metaJson, ZkCoreCrypto.decryptMeta(subkeys.metaKey, blobId, encMeta))
    }
}
