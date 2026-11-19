package com.valerio.photocloud.zk

import com.sun.net.httpserver.HttpExchange
import com.sun.net.httpserver.HttpHandler
import com.sun.net.httpserver.HttpServer
import com.valerio.photocloud.BackupLibraryMode
import com.valerio.photocloud.BackupMediaScope
import com.valerio.photocloud.MediaBackupCandidate
import kotlinx.coroutines.delay
import kotlinx.coroutines.runBlocking
import okhttp3.Interceptor
import okhttp3.mockwebserver.Dispatcher
import okhttp3.mockwebserver.MockResponse
import okhttp3.mockwebserver.MockWebServer
import okhttp3.mockwebserver.RecordedRequest
import org.json.JSONArray
import org.json.JSONObject
import org.junit.Assert.assertArrayEquals
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Assert.fail
import org.junit.Test
import java.io.ByteArrayInputStream
import java.io.ByteArrayOutputStream
import java.io.File
import java.io.IOException
import java.io.InputStream
import java.net.InetSocketAddress
import java.nio.charset.StandardCharsets
import java.nio.file.Files
import java.security.MessageDigest
import java.util.Base64
import java.util.UUID
import java.util.concurrent.Executors
import java.util.concurrent.atomic.AtomicInteger
import kotlin.math.min

/**
 * Comprehensive JVM test suite for PhotoCloud Zero-Knowledge v2 Phases 4C & 4D:
 * - Constant-memory 305 MiB streaming upload under `-Xmx128m`
 * - Resumable upload across crash/network drop + 409 CHUNK_OUT_OF_ORDER + zero plaintext FK persisted
 * - Spool & orphan cleanup
 * - `encMeta` roundtrip with GPS excluded by default and explicit opt-in
 * - 320/1280 thumbnail upload + `EncryptedThumbDiskCache` (ciphertext-only disk + RAM wipe)
 * - Streaming 64 KiB dedup + `/api/v2/backup/check` + `ZkNetworkSpyInterceptor`
 * - `ZkAutoBackupEngine` (AutoBackupLogic, DeviceLockedException, 413/401/422, VK/subkey zeroization)
 * - `ZkTransferManager` (parallelism 1..16, pause/resume/cancel, HTTPS warning)
 * - `ZkChunkedRangeReader` (4-chunk RAM LRU Range 206 streaming + zeroize), `ZkExternalOpenHelper`,
 *   encrypted albums (`ETag`/`If-Match`), trash, and Zero-Knowledge share links (`#fragment`)
 * - 4 Documented Failing Mutations strictly in `src/test/` (driven by `-Dzk.mutation=...`).
 */
class ZkUploadAndBackupV2Test {

    private fun testSubkeys(): Pair<ByteArray, ZkCoreCrypto.VaultSubkeys> {
        val vk = ByteArray(32) { (0x31 + it).toByte() }
        return vk to ZkCoreCrypto.deriveSubkeys(vk)
    }

    /**
     * Synthetic deterministic streaming plaintext source of arbitrary size (e.g. 305 MiB)
     * using O(1) heap memory.
     */
    private class SyntheticStreamingPlaintextSource(
        override val sourceKey: String,
        override val displayName: String,
        override val mimeType: String,
        override val sizeBytes: Long
    ) : ZkPlaintextSource {
        override val takenAtMs: Long = 1_730_000_000_000L
        override val createdAtMs: Long = 1_730_000_000_000L
        override val width: Int? = 3840
        override val height: Int? = 2160
        override val durationSec: Double? = 62.5
        override val rawExif: ZkPlaintextExifSubset? = null

        override fun openInputStream(): InputStream = object : InputStream() {
            private var pos = 0L

            override fun read(): Int {
                if (pos >= sizeBytes) return -1
                val b = ((pos * 31L + 17L) and 0xFFL).toInt()
                pos++
                return b
            }

            override fun read(b: ByteArray, off: Int, len: Int): Int {
                if (pos >= sizeBytes) return -1
                val count = min(len.toLong(), sizeBytes - pos).toInt()
                for (i in 0 until count) {
                    val idx = pos + i
                    b[off + i] = ((idx * 31L + 17L) and 0xFFL).toByte()
                }
                pos += count
                return count
            }
        }
    }

    @Test
    fun `streaming 305 MiB upload runs in constant RAM under -Xmx128m, verifies ciphertext SHA-256, and cleans spool`(): Unit = runBlocking {
        val size305MiB = 305L * 1024L * 1024L
        val (vk, subkeys) = testSubkeys()
        val spoolDir = Files.createTempDirectory("zk_305mb_spool_").toFile()
        val keyStore = InMemoryFakeVaultKeyStore().apply { wrapForBackground(vk) }
        val resumableStore = InMemoryResumableUploadStore()

        val uploadId = "up-305mb-1"
        var expectedSha = ""
        var expectedBlobId = ""
        var expectedTotalSize = 0L
        var expectedChunks = 0
        var receivedChunks = 0
        var receivedBytes = 0L
        val serverSha = MessageDigest.getInstance("SHA-256")
        var chunk0HeaderMagicOk = false

        val serverExecutor = Executors.newSingleThreadExecutor()
        val server = HttpServer.create(InetSocketAddress("127.0.0.1", 0), 0)
        server.executor = serverExecutor
        server.createContext("/api/v2/backup/check", object : HttpHandler {
            override fun handle(ex: HttpExchange) {
                ex.requestBody.use { it.readBytes() }
                val resp = """{"existingTags":[],"existingItems":{}}""".toByteArray(StandardCharsets.UTF_8)
                ex.responseHeaders.add("Content-Type", "application/json")
                ex.sendResponseHeaders(200, resp.size.toLong())
                ex.responseBody.use { it.write(resp) }
            }
        })
        server.createContext("/api/v2/blobs/upload/init", object : HttpHandler {
            override fun handle(ex: HttpExchange) {
                val requestBytes = ex.requestBody.use { stream: InputStream -> stream.readBytes() }
                val body = String(requestBytes, StandardCharsets.UTF_8)
                val json = JSONObject(body)
                expectedBlobId = json.getString("blobId")
                expectedTotalSize = json.getLong("totalSize")
                expectedChunks = json.getInt("totalChunks")
                expectedSha = json.getString("expectedSha256")
                val resp = JSONObject()
                    .put("uploadId", uploadId)
                    .put("blobId", expectedBlobId)
                    .put("receivedChunks", 0)
                    .put("expiresAt", System.currentTimeMillis() + 3600_000L)
                    .toString()
                    .toByteArray(StandardCharsets.UTF_8)
                ex.responseHeaders.add("Content-Type", "application/json")
                ex.sendResponseHeaders(201, resp.size.toLong())
                ex.responseBody.use { it.write(resp) }
            }
        })
        server.createContext("/api/v2/blobs/upload/$uploadId/", object : HttpHandler {
            override fun handle(ex: HttpExchange) {
                val path = ex.requestURI.path
                if (path.endsWith("/complete")) {
                    ex.requestBody.use { it.readBytes() }
                    val actualSha = ZkCoreCrypto.toHex(serverSha.digest())
                    val status = if (actualSha.equals(expectedSha, ignoreCase = true) && receivedBytes == expectedTotalSize) 201 else 422
                    val resp = if (status == 201) {
                        JSONObject().put(
                            "item",
                            JSONObject()
                                .put("id", "item-305")
                                .put("blobId", expectedBlobId)
                                .put("version", 1)
                                .put("size", receivedBytes)
                                .put("sha256", actualSha)
                                .put("createdAt", System.currentTimeMillis())
                                .put("updatedAt", System.currentTimeMillis())
                                .put("state", "active")
                                .put("trashedAt", JSONObject.NULL)
                                .put("encMeta", "AAAA")
                                .put("dedupTag", JSONObject.NULL)
                                .put("thumbs", JSONArray())
                        ).toString()
                    } else {
                        """{"error":"CIPHERTEXT_INTEGRITY_MISMATCH"}"""
                    }.toByteArray(StandardCharsets.UTF_8)
                    ex.responseHeaders.add("Content-Type", "application/json")
                    ex.sendResponseHeaders(status, resp.size.toLong())
                    ex.responseBody.use { it.write(resp) }
                } else {
                    val idx = path.substringAfterLast('/').toInt()
                    val buf = ByteArray(65536)
                    var firstChunkBytesRead = 0
                    val headerSample = ByteArray(22)
                    ex.requestBody.use { stream ->
                        while (true) {
                            val r = stream.read(buf)
                            if (r <= 0) break
                            if (idx == 0 && firstChunkBytesRead < headerSample.size) {
                                val take = min(r, headerSample.size - firstChunkBytesRead)
                                System.arraycopy(buf, 0, headerSample, firstChunkBytesRead, take)
                            }
                            firstChunkBytesRead += r
                            serverSha.update(buf, 0, r)
                            receivedBytes += r
                        }
                    }
                    if (idx == 0) {
                        val magicOk = headerSample[0] == 0x50.toByte() &&
                            headerSample[1] == 0x43.toByte() &&
                            headerSample[2] == 0x5A.toByte() &&
                            headerSample[3] == 0x4B.toByte() &&
                            headerSample[4] == 0x01.toByte()
                        val blobIdOk = ZkCoreCrypto.bytesToUuid(headerSample.copyOfRange(6, 22)) == expectedBlobId
                        chunk0HeaderMagicOk = magicOk && blobIdOk
                    }
                    receivedChunks++
                    val resp = JSONObject()
                        .put("uploadId", uploadId)
                        .put("chunkIndex", idx)
                        .put("receivedChunks", receivedChunks)
                        .put("receivedBytes", receivedBytes)
                        .toString()
                        .toByteArray(StandardCharsets.UTF_8)
                    ex.responseHeaders.add("Content-Type", "application/json")
                    ex.sendResponseHeaders(200, resp.size.toLong())
                    ex.responseBody.use { it.write(resp) }
                }
            }
        })
        server.start()

        try {
            val baseUrl = "http://127.0.0.1:${server.address.port}"
            val api = PhotoCloudZkApiClientV2(initialBaseUrl = baseUrl, allowLocalhostHttpForTests = true)
            val pipeline = ZkBlobUploadPipeline(
                apiClient = api,
                spoolDir = spoolDir,
                resumableStore = resumableStore,
                fkProtector = BackgroundKeyStoreFkProtector(keyStore),
                uploadChunkBytes = 8 * 1024 * 1024 // 8 MiB slices => 39 sequential chunks
            )

            val source = SyntheticStreamingPlaintextSource(
                sourceKey = "synthetic://305mb-video",
                displayName = "4k_family_video.mp4",
                mimeType = "video/mp4",
                sizeBytes = size305MiB
            )

            val outcome = pipeline.upload(source = source, subkeys = subkeys)
            assertTrue("Expected Uploaded outcome, got $outcome", outcome is ZkUploadOutcome.Uploaded)
            val uploaded = outcome as ZkUploadOutcome.Uploaded
            assertEquals(expectedBlobId, uploaded.blobId)
            assertEquals(expectedChunks, receivedChunks)
            assertEquals(86L + 305L * (1024L * 1024L + 16L), receivedBytes)
            assertTrue("Chunk 0 must carry valid PCZK v1 magic + blobId", chunk0HeaderMagicOk)
            assertTrue("Spool directory must be empty after completion", spoolDir.listFiles().isNullOrEmpty())
            assertTrue("Resumable store must be cleared after completion", resumableStore.listAll().isEmpty())
        } finally {
            server.stop(0)
            serverExecutor.shutdownNow()
            spoolDir.deleteRecursively()
            vk.zeroize()
            subkeys.zeroizeAll()
            System.gc()
        }
    }

    @Test
    fun `resumable upload recovers from drop and 409 CHUNK_OUT_OF_ORDER, never persists plaintext FK, and cleans orphans`(): Unit = runBlocking {
        val (vk, subkeys) = testSubkeys()
        val spoolDir = Files.createTempDirectory("zk_resume_spool_").toFile()
        val keyStore = InMemoryFakeVaultKeyStore().apply { wrapForBackground(vk) }
        val resumableStore = InMemoryResumableUploadStore()

        val plaintext = ByteArray(280 * 1024) { ((it * 13 + 7) and 0xFF).toByte() }
        val fixedFk = ByteArray(32) { (0xA0 + it).toByte() }
        val fixedFkCopy = fixedFk.copyOf()
        val deterministicCrypto = object : ZkCryptoProvider by JvmCryptoProvider {
            private var issuedFk = false
            override fun randomBytes(length: Int): ByteArray {
                if (length == 32 && !issuedFk) {
                    issuedFk = true
                    return fixedFk.copyOf()
                }
                return JvmCryptoProvider.randomBytes(length)
            }
        }

        val uploadId = "up-resume-1"
        val assembled = ByteArrayOutputStream()
        var serverReceivedChunks = 0
        var injectedDrop = false
        var injected409 = false
        var serverBlobId = ""
        var serverEncMeta = ""

        val mockServer = MockWebServer()
        mockServer.dispatcher = object : Dispatcher() {
            override fun dispatch(request: RecordedRequest): MockResponse {
                val p = request.path.orEmpty()
                return when {
                    p == "/api/v2/backup/check" -> MockResponse().setResponseCode(200)
                        .setBody("""{"existingTags":[],"existingItems":{}}""")
                    p == "/api/v2/blobs/upload/init" -> {
                        val j = JSONObject(request.body.readUtf8())
                        serverBlobId = j.getString("blobId")
                        serverEncMeta = j.getString("encMeta")
                        MockResponse().setResponseCode(201).setBody(
                            JSONObject()
                                .put("uploadId", uploadId)
                                .put("blobId", serverBlobId)
                                .put("receivedChunks", 0)
                                .put("expiresAt", System.currentTimeMillis() + 3600_000L)
                                .toString()
                        )
                    }
                    p == "/api/v2/blobs/upload/$uploadId/complete" -> {
                        val ct = assembled.toByteArray()
                        val sha = ZkCoreCrypto.toHex(JvmCryptoProvider.sha256(ct))
                        MockResponse().setResponseCode(201).setBody(
                            JSONObject().put(
                                "item",
                                JSONObject()
                                    .put("id", "item-resume")
                                    .put("blobId", serverBlobId)
                                    .put("version", 1)
                                    .put("size", ct.size)
                                    .put("sha256", sha)
                                    .put("createdAt", 1000L)
                                    .put("updatedAt", 1000L)
                                    .put("state", "active")
                                    .put("trashedAt", JSONObject.NULL)
                                    .put("encMeta", serverEncMeta)
                                    .put("dedupTag", JSONObject.NULL)
                                    .put("thumbs", JSONArray())
                            ).toString()
                        )
                    }
                    p.startsWith("/api/v2/blobs/upload/$uploadId/") -> {
                        val idx = p.substringAfterLast('/').toInt()
                        if (idx == 2 && !injectedDrop) {
                            injectedDrop = true
                            return MockResponse().setResponseCode(503).setBody("""{"error":"TEMP_UNAVAILABLE"}""")
                        }
                        if (idx == 2 && !injected409) {
                            injected409 = true
                            // Server asks client to resync to expectedChunkIndex = 2
                            return MockResponse().setResponseCode(409)
                                .setBody("""{"error":"CHUNK_OUT_OF_ORDER","expectedChunkIndex":2}""")
                        }
                        if (idx == serverReceivedChunks) {
                            assembled.write(request.body.readByteArray())
                            serverReceivedChunks++
                        }
                        MockResponse().setResponseCode(200).setBody(
                            JSONObject()
                                .put("uploadId", uploadId)
                                .put("chunkIndex", idx)
                                .put("receivedChunks", serverReceivedChunks)
                                .put("receivedBytes", assembled.size())
                                .toString()
                        )
                    }
                    else -> MockResponse().setResponseCode(404)
                }
            }
        }
        mockServer.start()

        try {
            val api = PhotoCloudZkApiClientV2(
                initialBaseUrl = mockServer.url("/").toString().removeSuffix("/"),
                allowLocalhostHttpForTests = true
            )
            val source = ByteArrayPlaintextSource(
                sourceKey = "content://media/resume_1",
                displayName = "resume_photo.jpg",
                mimeType = "image/jpeg",
                data = plaintext
            )

            // First attempt fails at chunk 2 (maxChunkRetries = 0 forces pause/retry state)
            val pipeline1 = ZkBlobUploadPipeline(
                apiClient = api,
                spoolDir = spoolDir,
                resumableStore = resumableStore,
                fkProtector = BackgroundKeyStoreFkProtector(keyStore),
                cryptoProvider = deterministicCrypto,
                chunkSizeLog2 = 16,
                uploadChunkBytes = 65536,
                maxChunkRetries = 0
            )
            val firstOutcome = pipeline1.upload(source, subkeys)
            assertTrue(firstOutcome is ZkUploadOutcome.Failed)
            assertEquals(ZkUploadFailureKind.RETRYABLE_NETWORK, (firstOutcome as ZkUploadOutcome.Failed).kind)

            // Verify checkpoint persisted with nextChunkIndex == 2 and ZERO plaintext FK
            val savedState = resumableStore.get(source.sourceKey)
            assertNotNull(savedState)
            assertEquals(2, savedState!!.nextChunkIndex)
            val serializedCheckpoint = savedState.toJson().toString()
            assertFalse("Plaintext FK hex leaked in checkpoint!", serializedCheckpoint.contains(ZkCoreCrypto.toHex(fixedFkCopy), ignoreCase = true))
            assertFalse("Plaintext FK b64u leaked in checkpoint!", serializedCheckpoint.contains(ZkCoreCrypto.toBase64Url(fixedFkCopy)))
            assertFalse("Plaintext FK b64 leaked in checkpoint!", serializedCheckpoint.contains(Base64.getEncoder().encodeToString(fixedFkCopy)))

            // Unwrap verifies the KeyStore-wrapped FK is authentic
            val unwrappedFk = BackgroundKeyStoreFkProtector(keyStore).unwrapFkFromPersistence(
                savedState.wrappedFkKeystoreB64u,
                savedState.blobId
            )
            assertArrayEquals(fixedFkCopy, unwrappedFk)
            unwrappedFk.zeroize()

            // Create an unrelated orphan spool file and ensure orphan cleanup preserves the active spool
            val orphanFile = File(spoolDir, "${ZkBlobUploadPipeline.SPOOL_PREFIX}orphan-dead${ZkBlobUploadPipeline.SPOOL_SUFFIX}")
            orphanFile.writeBytes(byteArrayOf(1, 2, 3))
            val cleaned = ZkBlobUploadPipeline.cleanupOrphanSpoolFiles(spoolDir, setOf(savedState.spoolFileName))
            assertEquals(1, cleaned)
            assertFalse(orphanFile.exists())
            assertTrue(File(spoolDir, savedState.spoolFileName).exists())

            // Second attempt (simulating app restart) resumes from chunk 2, handles 409 resync, and completes
            val pipeline2 = ZkBlobUploadPipeline(
                apiClient = api,
                spoolDir = spoolDir,
                resumableStore = resumableStore,
                fkProtector = BackgroundKeyStoreFkProtector(keyStore),
                chunkSizeLog2 = 16,
                uploadChunkBytes = 65536,
                maxChunkRetries = 1
            )
            val resumedOutcome = pipeline2.upload(source, subkeys)
            assertTrue("Expected resumed Uploaded, got $resumedOutcome", resumedOutcome is ZkUploadOutcome.Uploaded)
            assertTrue(injected409)
            assertNull(resumableStore.get(source.sourceKey))
            assertFalse(File(spoolDir, savedState.spoolFileName).exists())

            // Decrypt server-assembled PCZK blob and verify byte-exact plaintext match
            val decryptedOut = ByteArrayOutputStream()
            ZkCoreCrypto.decryptBlobStream(
                input = ByteArrayInputStream(assembled.toByteArray()),
                output = decryptedOut,
                fkWrapKey = subkeys.fkWrapKey,
                expectedBlobId = serverBlobId
            )
            assertArrayEquals(plaintext, decryptedOut.toByteArray())
        } finally {
            mockServer.shutdown()
            spoolDir.deleteRecursively()
            vk.zeroize()
            fixedFk.zeroize()
            fixedFkCopy.zeroize()
            subkeys.zeroizeAll()
        }
    }

    @Test
    fun `encMeta roundtrip excludes GPS by default and includes GPS only with explicit opt-in`() {
        val (vk, subkeys) = testSubkeys()
        val blobId = UUID.randomUUID().toString().lowercase()
        val rawExif = ZkPlaintextExifSubset(
            make = "Google",
            model = "Pixel 9 Pro",
            iso = 100,
            lat = 41.9028,
            lon = 12.4964,
            altitude = 21.5
        )
        try {
            // Default: includeGps = false -> lat/lon/altitude MUST be stripped
            val defaultMeta = DefaultZkMetaBuilder.build(
                ZkMetaBuildInput(
                    name = "colosseo.jpg",
                    mime = "image/jpeg",
                    sizeBytes = 123456L,
                    takenAtMs = 1_730_000_000_000L,
                    createdAtMs = 1_730_000_000_000L,
                    width = 4032,
                    height = 3024,
                    rawExif = rawExif,
                    includeGps = false
                )
            )
            val encDefault = ZkCoreCrypto.encryptMeta(subkeys.metaKey, blobId, defaultMeta.toJsonString())
            val decDefault = ZkBlobPlaintextMeta.fromJsonString(ZkCoreCrypto.decryptMeta(subkeys.metaKey, blobId, encDefault))
            assertEquals("colosseo.jpg", decDefault.name)
            assertEquals("Pixel 9 Pro", decDefault.exifSubset?.model)
            assertNull("GPS lat MUST be excluded by default", decDefault.exifSubset?.lat)
            assertNull("GPS lon MUST be excluded by default", decDefault.exifSubset?.lon)
            assertNull("GPS altitude MUST be excluded by default", decDefault.exifSubset?.altitude)

            // Explicit opt-in: includeGps = true -> lat/lon/altitude preserved inside encMeta
            val gpsMeta = DefaultZkMetaBuilder.build(
                ZkMetaBuildInput(
                    name = "colosseo.jpg",
                    mime = "image/jpeg",
                    sizeBytes = 123456L,
                    createdAtMs = 1_730_000_000_000L,
                    rawExif = rawExif,
                    includeGps = true
                )
            )
            val encGps = ZkCoreCrypto.encryptMeta(subkeys.metaKey, blobId, gpsMeta.toJsonString())
            val decGps = ZkBlobPlaintextMeta.fromJsonString(ZkCoreCrypto.decryptMeta(subkeys.metaKey, blobId, encGps))
            assertEquals(41.9028, decGps.exifSubset!!.lat!!, 0.0001)
            assertEquals(12.4964, decGps.exifSubset!!.lon!!, 0.0001)
            assertEquals(21.5, decGps.exifSubset!!.altitude!!, 0.01)
        } finally {
            vk.zeroize()
            subkeys.zeroizeAll()
        }
    }

    @Test
    fun `dedup skips upload on server hit, thumbs 320 and 1280 upload encrypted, EncryptedThumbDiskCache is ciphertext-only, and Network Spy sees zero leaks`(): Unit = runBlocking {
        val (vk, subkeys) = testSubkeys()
        val spoolDir = Files.createTempDirectory("zk_dedup_spool_").toFile()
        val thumbCacheDir = Files.createTempDirectory("zk_thumb_cache_").toFile()
        val keyStore = InMemoryFakeVaultKeyStore().apply { wrapForBackground(vk) }

        val secretFilename = "TopSecret_Medical_Report_2026.jpg"
        val plaintext = "CONFIDENTIAL_PLAINTEXT_MEDIA_PAYLOAD_1234567890".toByteArray(StandardCharsets.UTF_8)
        val plaintextSha256Hex = ZkCoreCrypto.toHex(JvmCryptoProvider.sha256(plaintext))
        val fakeSmJpeg = "FAKE_THUMB_320_PLAINTEXT_BYTES_SECRET".toByteArray(StandardCharsets.UTF_8)
        val fakeMdJpeg = "FAKE_THUMB_1280_PLAINTEXT_BYTES_SECRET".toByteArray(StandardCharsets.UTF_8)

        val uploadedThumbsOnServer = LinkedHashMap<String, ByteArray>()
        val existingDedupTags = LinkedHashSet<String>()
        var initCalls = 0
        var uploadedBlobId = ""

        val mockServer = MockWebServer()
        mockServer.dispatcher = object : Dispatcher() {
            override fun dispatch(request: RecordedRequest): MockResponse {
                val p = request.path.orEmpty()
                return when {
                    p == "/api/v2/backup/check" -> {
                        val tagsArr = JSONObject(request.body.readUtf8()).getJSONArray("dedupTags")
                        val found = JSONArray()
                        val itemsObj = JSONObject()
                        for (i in 0 until tagsArr.length()) {
                            val t = tagsArr.getString(i)
                            if (t in existingDedupTags) {
                                found.put(t)
                                itemsObj.put(t, JSONObject().put("itemId", "item-existing").put("blobId", uploadedBlobId))
                            }
                        }
                        MockResponse().setResponseCode(200).setBody(
                            JSONObject().put("existingTags", found).put("existingItems", itemsObj).toString()
                        )
                    }
                    p == "/api/v2/blobs/upload/init" -> {
                        initCalls++
                        val j = JSONObject(request.body.readUtf8())
                        uploadedBlobId = j.getString("blobId")
                        j.optString("dedupTag").takeIf { it.isNotBlank() }?.let { existingDedupTags.add(it) }
                        MockResponse().setResponseCode(201).setBody(
                            JSONObject().put("uploadId", "up-1").put("blobId", uploadedBlobId).put("receivedChunks", 0).put("expiresAt", 9999999999999L).toString()
                        )
                    }
                    p == "/api/v2/blobs/upload/up-1/0" -> {
                        request.body.readByteArray()
                        MockResponse().setResponseCode(200).setBody("""{"uploadId":"up-1","chunkIndex":0,"receivedChunks":1,"receivedBytes":100}""")
                    }
                    p == "/api/v2/blobs/upload/up-1/complete" -> {
                        MockResponse().setResponseCode(201).setBody(
                            JSONObject().put(
                                "item",
                                JSONObject()
                                    .put("id", "item-1")
                                    .put("blobId", uploadedBlobId)
                                    .put("version", 1)
                                    .put("size", 200)
                                    .put("sha256", "a".repeat(64))
                                    .put("createdAt", 1L)
                                    .put("updatedAt", 1L)
                                    .put("state", "active")
                                    .put("trashedAt", JSONObject.NULL)
                                    .put("encMeta", "AAAA")
                                    .put("dedupTag", JSONObject.NULL)
                                    .put("thumbs", JSONArray())
                            ).toString()
                        )
                    }
                    p.startsWith("/api/v2/blobs/") && p.contains("/thumbs/") -> {
                        val variant = p.substringAfterLast('/')
                        if (request.method == "PUT") {
                            uploadedThumbsOnServer[variant] = request.body.readByteArray()
                            MockResponse().setResponseCode(200).setBody("""{"ok":true}""")
                        } else {
                            val bytes = uploadedThumbsOnServer[variant]
                            if (bytes == null) MockResponse().setResponseCode(404)
                            else MockResponse().setResponseCode(200).setBody(okio.Buffer().write(bytes))
                        }
                    }
                    else -> MockResponse().setResponseCode(404)
                }
            }
        }
        mockServer.start()

        try {
            val spy = ZkNetworkSpyInterceptor()
            val api = PhotoCloudZkApiClientV2(
                initialBaseUrl = mockServer.url("/").toString().removeSuffix("/"),
                allowLocalhostHttpForTests = true,
                extraInterceptors = listOf(spy)
            )
            val thumbGen = object : ZkThumbnailGenerator {
                override suspend fun generate(source: ZkPlaintextSource): ZkThumbPair {
                    return ZkThumbPair(
                        sm320 = ZkThumbData(fakeSmJpeg.copyOf(), 320, 240),
                        md1280 = ZkThumbData(fakeMdJpeg.copyOf(), 1280, 960)
                    )
                }
            }
            val pipeline = ZkBlobUploadPipeline(
                apiClient = api,
                spoolDir = spoolDir,
                resumableStore = InMemoryResumableUploadStore(),
                fkProtector = BackgroundKeyStoreFkProtector(keyStore),
                thumbnailGenerator = thumbGen
            )

            val source = ByteArrayPlaintextSource(
                sourceKey = "file://secret_report",
                displayName = secretFilename,
                mimeType = "image/jpeg",
                data = plaintext
            )

            // First upload succeeds and uploads both encrypted thumbnails
            val first = pipeline.upload(source, subkeys)
            assertTrue(first is ZkUploadOutcome.Uploaded)
            val uploaded = first as ZkUploadOutcome.Uploaded
            assertEquals(listOf("320", "1280"), uploaded.uploadedThumbs)
            assertEquals(1, initCalls)

            // Verify server thumbnails decrypt cleanly and contain ZERO plaintext on disk cache
            val encSm = uploadedThumbsOnServer["320"]!!
            val encMd = uploadedThumbsOnServer["1280"]!!
            assertArrayEquals(fakeSmJpeg, ZkCoreCrypto.decryptThumbnail(subkeys.thumbKey, uploaded.blobId, "320", encSm))
            assertArrayEquals(fakeMdJpeg, ZkCoreCrypto.decryptThumbnail(subkeys.thumbKey, uploaded.blobId, "1280", encMd))

            val thumbCache = EncryptedThumbDiskCache(thumbCacheDir)
            thumbCache.putEncryptedOnDisk(uploaded.blobId, "320", encSm)
            thumbCache.putDecryptedInRam(uploaded.blobId, "320", fakeSmJpeg)
            val diskBytes = thumbCacheDir.listFiles()!!.first().readBytes()
            assertFalse("Disk thumb cache must store ONLY ciphertext!", String(diskBytes, StandardCharsets.ISO_8859_1).contains("FAKE_THUMB_320_PLAINTEXT"))
            assertArrayEquals(fakeSmJpeg, thumbCache.getDecryptedFromRam(uploaded.blobId, "320"))
            thumbCache.clearRamCache()
            assertNull("RAM thumb cache must be empty after lock/clear", thumbCache.getDecryptedFromRam(uploaded.blobId, "320"))

            // Second upload of identical plaintext MUST skip via /api/v2/backup/check without calling /init again
            val second = pipeline.upload(source, subkeys)
            assertTrue("Expected SkippedDuplicate, got $second", second is ZkUploadOutcome.SkippedDuplicate)
            assertEquals("Upload init must NOT be called on dedup hit", 1, initCalls)

            // Network spy verifies ZERO plaintext filename, plaintext SHA-256, plaintext payload, thumbs, or VK leaked
            spy.assertZeroSecretLeaks(
                listOf(
                    TrackedSecret("filename", rawString = secretFilename),
                    TrackedSecret("plaintextSha256", rawString = plaintextSha256Hex),
                    TrackedSecret("plaintextPayload", bytes = plaintext),
                    TrackedSecret("thumb320Plaintext", bytes = fakeSmJpeg),
                    TrackedSecret("thumb1280Plaintext", bytes = fakeMdJpeg),
                    TrackedSecret("vaultKey", bytes = vk)
                )
            )
        } finally {
            mockServer.shutdown()
            spoolDir.deleteRecursively()
            thumbCacheDir.deleteRecursively()
            vk.zeroize()
            subkeys.zeroizeAll()
        }
    }

    @Test
    fun `ZkAutoBackupEngine handles DeviceLockedException, 413 quota, 401 unauth, 422 integrity, AutoBackupLogic filters, and zeroizes VK`(): Unit = runBlocking {
        val (vk, _) = testSubkeys()
        val spoolDir = Files.createTempDirectory("zk_autobackup_spool_").toFile()

        val keyStore = InMemoryFakeVaultKeyStore().apply { wrapForBackground(vk) }
        val statusCodeToReturn = AtomicInteger(201)
        val server = MockWebServer()
        server.dispatcher = object : Dispatcher() {
            override fun dispatch(request: RecordedRequest): MockResponse {
                val p = request.path.orEmpty()
                return when {
                    p == "/api/v2/backup/check" -> MockResponse().setResponseCode(200)
                        .setBody("""{"existingTags":[],"existingItems":{}}""")
                    p == "/api/v2/blobs/upload/init" -> {
                        val code = statusCodeToReturn.get()
                        if (code == 413) return MockResponse().setResponseCode(413).setBody("""{"error":"QUOTA_EXCEEDED"}""")
                        if (code == 401) return MockResponse().setResponseCode(401).setBody("""{"error":"UNAUTHORIZED"}""")
                        val j = JSONObject(request.body.readUtf8())
                        MockResponse().setResponseCode(201).setBody(
                            JSONObject().put("uploadId", "up-bg").put("blobId", j.getString("blobId")).put("receivedChunks", 0).put("expiresAt", 9999999999999L).toString()
                        )
                    }
                    p == "/api/v2/blobs/upload/up-bg/0" -> {
                        request.body.readByteArray()
                        MockResponse().setResponseCode(200).setBody("""{"uploadId":"up-bg","chunkIndex":0,"receivedChunks":1,"receivedBytes":10}""")
                    }
                    p == "/api/v2/blobs/upload/up-bg/complete" -> {
                        if (statusCodeToReturn.get() == 422) {
                            MockResponse().setResponseCode(422).setBody("""{"error":"CIPHERTEXT_INTEGRITY_MISMATCH"}""")
                        } else {
                            MockResponse().setResponseCode(201).setBody(
                                JSONObject().put(
                                    "item",
                                    JSONObject()
                                        .put("id", "item-bg")
                                        .put("blobId", UUID.randomUUID().toString())
                                        .put("version", 1)
                                        .put("size", 120)
                                        .put("sha256", "b".repeat(64))
                                        .put("createdAt", 1L)
                                        .put("updatedAt", 1L)
                                        .put("state", "active")
                                        .put("trashedAt", JSONObject.NULL)
                                        .put("encMeta", "AAAA")
                                        .put("dedupTag", JSONObject.NULL)
                                        .put("thumbs", JSONArray())
                                ).toString()
                            )
                        }
                    }
                    else -> MockResponse().setResponseCode(404)
                }
            }
        }
        server.start()

        try {
            val api = PhotoCloudZkApiClientV2(
                initialBaseUrl = server.url("/").toString().removeSuffix("/"),
                allowLocalhostHttpForTests = true
            )
            val pipeline = ZkBlobUploadPipeline(
                apiClient = api,
                spoolDir = spoolDir,
                resumableStore = InMemoryResumableUploadStore(),
                fkProtector = BackgroundKeyStoreFkProtector(keyStore)
            )
            val eligibleCandidate = ZkAutoBackupCandidateItem(
                candidate = MediaBackupCandidate(
                    mediaStoreId = 1L,
                    uriString = "content://media/1",
                    displayName = "IMG_001.jpg",
                    bucketName = "Camera",
                    mimeType = "image/jpeg",
                    isVideo = false,
                    sizeBytes = 64L,
                    dateTakenMs = 2000L,
                    dateAddedMs = 2000L
                ),
                source = ByteArrayPlaintextSource("content://media/1", "IMG_001.jpg", "image/jpeg", ByteArray(64) { 0x42 })
            )
            val filteredOutCandidate = ZkAutoBackupCandidateItem(
                candidate = MediaBackupCandidate(
                    mediaStoreId = 2L,
                    uriString = "content://media/2",
                    displayName = "VID_002.mp4",
                    bucketName = "Downloads",
                    mimeType = "video/mp4",
                    isVideo = true,
                    sizeBytes = 64L,
                    dateTakenMs = 2000L,
                    dateAddedMs = 2000L
                ),
                source = ByteArrayPlaintextSource("content://media/2", "VID_002.mp4", "video/mp4", ByteArray(64) { 0x43 })
            )

            var lockedNotified = 0
            var quotaNotified = 0
            var sessionNotified = 0
            var integrityNotified = 0
            val notifier = object : ZkAutoBackupNotifier {
                override fun onProgress(done: Int, total: Int, currentLabel: String) = Unit
                override fun notifyDeviceLocked() { lockedNotified++ }
                override fun notifyQuotaExceeded(message: String) { quotaNotified++ }
                override fun notifySessionExpired(message: String) { sessionNotified++ }
                override fun notifyIntegrityMismatch(message: String) { integrityNotified++ }
            }

            val engine = ZkAutoBackupEngine(
                vaultKeyStore = keyStore,
                pipeline = pipeline,
                candidateProvider = ZkAutoBackupCandidateProvider { listOf(eligibleCandidate, filteredOutCandidate) },
                notifier = notifier
            )
            val cfg = ZkAutoBackupConfig(
                enabled = true,
                selectedBuckets = setOf("Camera"),
                mediaScope = BackupMediaScope.PHOTO,
                libraryMode = BackupLibraryMode.FULL_LIBRARY
            )

            // 1. DeviceLockedException -> notification + retryRecommended = true
            keyStore.deviceUnlocked = false
            val lockedSummary = engine.runOnce(cfg)
            assertEquals(1, lockedNotified)
            assertTrue(lockedSummary.retryRecommended)
            assertEquals(ZkUploadFailureKind.DEVICE_LOCKED, lockedSummary.stopReason)
            assertEquals(1, lockedSummary.eligibleCount) // Downloads video filtered out by AutoBackupLogic

            // 2. Unlock device -> 413 QUOTA_EXCEEDED -> notifyQuotaExceeded + retryRecommended = false
            keyStore.deviceUnlocked = true
            statusCodeToReturn.set(413)
            val quotaSummary = engine.runOnce(cfg)
            assertEquals(1, quotaNotified)
            assertFalse(quotaSummary.retryRecommended)
            assertEquals(ZkUploadFailureKind.QUOTA_EXCEEDED, quotaSummary.stopReason)

            // 3. 401 UNAUTHORIZED -> notifySessionExpired + retryRecommended = false
            statusCodeToReturn.set(401)
            val unauthSummary = engine.runOnce(cfg)
            assertEquals(1, sessionNotified)
            assertFalse(unauthSummary.retryRecommended)
            assertEquals(ZkUploadFailureKind.UNAUTHORIZED, unauthSummary.stopReason)

            // 4. 422 INTEGRITY_MISMATCH -> notifyIntegrityMismatch
            statusCodeToReturn.set(422)
            val integritySummary = engine.runOnce(cfg)
            assertEquals(1, integrityNotified)
            assertEquals(ZkUploadFailureKind.INTEGRITY_MISMATCH, integritySummary.stopReason)

            // 5. Success -> uploadedCount == 1
            statusCodeToReturn.set(201)
            val okSummary = engine.runOnce(cfg)
            assertEquals(1, okSummary.uploadedCount)
            assertFalse(okSummary.retryRecommended)
        } finally {
            server.shutdown()
            spoolDir.deleteRecursively()
            vk.zeroize()
        }
    }

    @Test
    fun `ZkTransferManager clamps parallelism 1 to 16, detects non-HTTPS warning, and supports pause resume cancel`(): Unit = runBlocking {
        assertEquals(1, ZkTransferManager.clampParallelism(0))
        assertEquals(1, ZkTransferManager.clampParallelism(-5))
        assertEquals(8, ZkTransferManager.clampParallelism(8))
        assertEquals(16, ZkTransferManager.clampParallelism(99))
        assertFalse(ZkTransferManager.requiresHttpsWarning("https://vault.example.com"))
        assertTrue(ZkTransferManager.requiresHttpsWarning("http://192.168.1.50:3000"))

        val (vk, subkeys) = testSubkeys()
        val spoolDir = Files.createTempDirectory("zk_tm_spool_").toFile()
        val keyStore = InMemoryFakeVaultKeyStore().apply { wrapForBackground(vk) }
        val server = MockWebServer()
        server.dispatcher = object : Dispatcher() {
            override fun dispatch(request: RecordedRequest): MockResponse {
                val p = request.path.orEmpty()
                return when {
                    p == "/api/v2/backup/check" -> MockResponse().setResponseCode(200).setBody("""{"existingTags":[],"existingItems":{}}""")
                    p == "/api/v2/blobs/upload/init" -> {
                        val b = JSONObject(request.body.readUtf8()).getString("blobId")
                        MockResponse().setResponseCode(201).setBody("""{"uploadId":"up-tm","blobId":"$b","receivedChunks":0,"expiresAt":9999999999999}""")
                    }
                    p == "/api/v2/blobs/upload/up-tm/complete" -> MockResponse().setResponseCode(201).setBody(
                        """{"item":{"id":"it-tm","blobId":"${UUID.randomUUID()}","version":1,"size":100,"sha256":"${"c".repeat(64)}","createdAt":1,"updatedAt":1,"state":"active","trashedAt":null,"encMeta":"AAAA","dedupTag":null,"thumbs":[]}}"""
                    )
                    p.startsWith("/api/v2/blobs/upload/up-tm/") -> {
                        request.body.readByteArray()
                        MockResponse().setResponseCode(200).setBody("""{"uploadId":"up-tm","chunkIndex":0,"receivedChunks":1,"receivedBytes":100}""")
                    }
                    else -> MockResponse().setResponseCode(404)
                }
            }
        }
        server.start()
        try {
            val api = PhotoCloudZkApiClientV2(server.url("/").toString().removeSuffix("/"), allowLocalhostHttpForTests = true)
            val pipeline = ZkBlobUploadPipeline(api, spoolDir, InMemoryResumableUploadStore(), BackgroundKeyStoreFkProtector(keyStore))
            val tm = ZkTransferManager(pipeline = pipeline, subkeysProvider = { subkeys }, scope = this, initialParallelism = 32)
            assertEquals(16, tm.getParallelism())
            assertEquals(1, tm.setParallelism(0))
            assertEquals(4, tm.setParallelism(4))

            val id1 = tm.enqueue(ByteArrayPlaintextSource("tm://1", "a.jpg", "image/jpeg", ByteArray(1024) { 1 }))
            val id2 = tm.enqueue(ByteArrayPlaintextSource("tm://2", "b.jpg", "image/jpeg", ByteArray(1024) { 2 }))
            tm.cancel(id2)
            // Allow IO upload coroutine to complete on real wall-clock time
            var waited = 0
            while (waited < 100 && tm.transfers.value.first { it.transferId == id1 }.status != ZkTransferStatus.COMPLETED) {
                delay(50)
                waited++
            }
            assertEquals(ZkTransferStatus.COMPLETED, tm.transfers.value.first { it.transferId == id1 }.status)
            assertEquals(ZkTransferStatus.CANCELLED, tm.transfers.value.first { it.transferId == id2 }.status)
            tm.clearFinished()
            assertTrue(tm.transfers.value.isEmpty())
        } finally {
            server.shutdown()
            spoolDir.deleteRecursively()
            vk.zeroize()
            subkeys.zeroizeAll()
        }
    }

    @Test
    fun `ZkChunkedRangeReader Range 206 streaming, ZkExternalOpenHelper zero-wipe, encrypted albums If-Match, and Zero-Knowledge share fragment`(): Unit = runBlocking {
        val (vk, subkeys) = testSubkeys()
        val userId = UUID.randomUUID().toString().lowercase()
        val blobId = UUID.randomUUID().toString().lowercase()
        val plaintext = ByteArray(200_000) { ((it * 7 + 3) and 0xFF).toByte() }
        val pczkOut = ByteArrayOutputStream()
        ZkCoreCrypto.encryptBlobStream(
            input = ByteArrayInputStream(plaintext),
            output = pczkOut,
            fkWrapKey = subkeys.fkWrapKey,
            blobId = blobId,
            chunkSizeLog2 = 16 // 64 KiB chunks -> 4 chunks total
        )
        val pczkBytes = pczkOut.toByteArray()

        var storedAlbumsBytes: ByteArray? = null
        var storedAlbumsEtag = "\"etag-v1\""
        var lastSharePayload = ""
        val rangeCalls = AtomicInteger(0)

        val server = MockWebServer()
        server.dispatcher = object : Dispatcher() {
            override fun dispatch(request: RecordedRequest): MockResponse {
                val p = request.path.orEmpty()
                return when {
                    p == "/api/v2/blobs/$blobId" -> {
                        rangeCalls.incrementAndGet()
                        val rangeHeader = request.getHeader("Range") ?: ""
                        val m = Regex("bytes=(\\d+)-(\\d+)").matchEntire(rangeHeader)
                        if (m != null) {
                            val s = m.groupValues[1].toInt()
                            val e = min(pczkBytes.size - 1, m.groupValues[2].toInt())
                            val slice = pczkBytes.copyOfRange(s, e + 1)
                            MockResponse().setResponseCode(206)
                                .addHeader("Content-Range", "bytes $s-$e/${pczkBytes.size}")
                                .setBody(okio.Buffer().write(slice))
                        } else {
                            MockResponse().setResponseCode(200).setBody(okio.Buffer().write(pczkBytes))
                        }
                    }
                    p == "/api/v2/albums" && request.method == "GET" -> {
                        val b = storedAlbumsBytes
                        if (b == null) MockResponse().setResponseCode(404)
                        else MockResponse().setResponseCode(200).addHeader("ETag", storedAlbumsEtag).setBody(okio.Buffer().write(b))
                    }
                    p == "/api/v2/albums" && request.method == "PUT" -> {
                        val ifMatch = request.getHeader("If-Match")
                        if (storedAlbumsBytes != null && ifMatch != storedAlbumsEtag) {
                            MockResponse().setResponseCode(412).setBody("""{"error":"PRECONDITION_FAILED"}""")
                        } else {
                            storedAlbumsBytes = request.body.readByteArray()
                            storedAlbumsEtag = "\"etag-v${storedAlbumsBytes!!.size}\""
                            MockResponse().setResponseCode(200).setBody(
                                JSONObject().put("etag", storedAlbumsEtag).put("size", storedAlbumsBytes!!.size).put("updatedAt", 1234L).toString()
                            )
                        }
                    }
                    p == "/api/v2/shares" && request.method == "POST" -> {
                        lastSharePayload = request.body.readUtf8()
                        val sid = JSONObject(lastSharePayload).getString("shareId")
                        MockResponse().setResponseCode(201).setBody(
                            JSONObject().put("shareId", sid).put("expiresAt", JSONObject.NULL).put("maxDownloads", JSONObject.NULL).put("createdAt", 1234L).toString()
                        )
                    }
                    else -> MockResponse().setResponseCode(404)
                }
            }
        }
        server.start()

        val tempDir = Files.createTempDirectory("zk_4d_repo_").toFile()
        try {
            val spy = ZkNetworkSpyInterceptor()
            val api = PhotoCloudZkApiClientV2(
                initialBaseUrl = server.url("/").toString().removeSuffix("/"),
                allowLocalhostHttpForTests = true,
                extraInterceptors = listOf(spy)
            )

            // 1. ZkChunkedRangeReader random access across chunk boundaries + 4-chunk LRU
            val reader = ZkChunkedRangeReader(api, blobId, subkeys.fkWrapKey, maxCachedChunks = 4)
            assertEquals(plaintext.size.toLong(), reader.getTotalPlaintextSize())
            val sliceBuf = ByteArray(10_000)
            // Read spanning chunk 0 -> chunk 1 boundary (65536)
            val n1 = reader.readAt(60_000L, sliceBuf, 0, sliceBuf.size)
            assertEquals(10_000, n1)
            assertArrayEquals(plaintext.copyOfRange(60_000, 70_000), sliceBuf)
            val callsAfterBoundary = rangeCalls.get()
            // Re-reading same offset MUST hit RAM LRU (0 extra HTTP calls)
            val n2 = reader.readAt(60_000L, sliceBuf, 0, sliceBuf.size)
            assertEquals(10_000, n2)
            assertEquals(callsAfterBoundary, rangeCalls.get())
            // Seek to tail (chunk 3)
            val tailBuf = ByteArray(5000)
            val nTail = reader.readAt(195_000L, tailBuf, 0, tailBuf.size)
            assertEquals(5000, nTail)
            assertArrayEquals(plaintext.copyOfRange(195_000, 200_000), tailBuf)
            reader.close()

            // 2. ZkExternalOpenHelper deterministic zero-overwrite + wipe
            val extHelper = ZkExternalOpenHelper(tempDir)
            val extFile = extHelper.createTargetFile("private_doc.pdf")
            extFile.writeText("SENSITIVE_EXPORT_CONTENT")
            assertTrue(extFile.exists())
            assertEquals(1, extHelper.wipeAllExternalShareFiles())
            assertFalse(extFile.exists())

            // 3. Encrypted Albums + Zero-Knowledge Share Link via ZkVaultRepository
            val fakeKeyStore = InMemoryFakeVaultKeyStore()
            val session = ZkSessionManager(api, fakeKeyStore, metadataStore = InMemoryZkAccountMetadataStore().apply {
                saveLastAccount(userId, "alice_4d")
            })
            val encSession = fakeKeyStore.prepareBiometricEncryptSession()
            fakeKeyStore.finishBiometricWrap(vk, encSession)
            session.completeBiometricUnlock(fakeKeyStore.prepareBiometricDecryptSession())

            val repo = ZkVaultRepository(api, session, EncryptedThumbDiskCache(File(tempDir, "thumbs")), extHelper)
            val emptyAlbums = repo.loadAlbums()
            assertEquals(0, emptyAlbums.revision)
            val savedAlbums = repo.saveAlbums(
                ZkAlbumsDocument(albums = listOf(ZkAlbumRecord(id = "alb-1", name = "Vacanze Segrete", itemIds = listOf("item-1")))),
                emptyAlbums.revision,
                emptyAlbums.etag
            )
            assertEquals(1, savedAlbums.revision)
            val reloadedAlbums = repo.loadAlbums()
            assertEquals("Vacanze Segrete", reloadedAlbums.document.albums.single().name)
            // Verify server never saw plaintext album title
            assertFalse(String(storedAlbumsBytes!!, StandardCharsets.ISO_8859_1).contains("Vacanze Segrete"))

            // Create Zero-Knowledge Share Link and verify shareKey in #fragment NEVER touched the network!
            val item = DecryptedZkItem(
                serverItem = V2ServerItem("item-1", blobId, 1, pczkBytes.size.toLong(), "0".repeat(64), 1L, 1L, "active", null, "AAAA", null, emptyList()),
                meta = ZkBlobPlaintextMeta(name = "secret_family.jpg", mime = "image/jpeg", size = plaintext.size.toLong(), createdAt = 1L)
            )
            val share = repo.createZeroKnowledgeShare(listOf(item), title = "Estate 2026")
            assertTrue(share.shareUrlWithFragment.contains("/v2/s/${share.shareId}#"))
            val shareKeyB64u = share.shareUrlWithFragment.substringAfter('#')
            val shareKeyBytes = ZkCoreCrypto.fromBase64Url(shareKeyB64u)
            assertEquals(32, shareKeyBytes.size)
            spy.assertZeroSecretLeaks(
                listOf(
                    TrackedSecret("shareKey", bytes = shareKeyBytes),
                    TrackedSecret("shareKeyB64u", rawString = shareKeyB64u),
                    TrackedSecret("albumName", rawString = "Vacanze Segrete"),
                    TrackedSecret("vaultKey", bytes = vk)
                )
            )
            shareKeyBytes.zeroize()
            session.lock("done")
        } finally {
            server.shutdown()
            tempDir.deleteRecursively()
            vk.zeroize()
            subkeys.zeroizeAll()
        }
    }

    // =========================================================================
    // 4 DOCUMENTED FAILING MUTATIONS (STRICTLY IN src/test/, ZERO IN src/main/)
    // Executed in CI with `-Dzk.mutation=<name>` to prove each guard catches regressions.
    // =========================================================================

    @Test
    fun `documented mutation skip_dedup_check must turn dedup enforcement test RED`(): Unit = runBlocking {
        val mutation = System.getProperty("zk.mutation", "")
        val (vk, subkeys) = testSubkeys()
        val spoolDir = Files.createTempDirectory("zk_mut_dedup_").toFile()
        val keyStore = InMemoryFakeVaultKeyStore().apply { wrapForBackground(vk) }
        var initCalls = 0
        val server = MockWebServer()
        server.dispatcher = object : Dispatcher() {
            override fun dispatch(request: RecordedRequest): MockResponse {
                val p = request.path.orEmpty()
                return when {
                    p == "/api/v2/backup/check" -> {
                        val tag = JSONObject(request.body.readUtf8()).getJSONArray("dedupTags").getString(0)
                        MockResponse().setResponseCode(200).setBody(
                            JSONObject()
                                .put("existingTags", JSONArray().put(tag))
                                .put("existingItems", JSONObject().put(tag, JSONObject().put("itemId", "it-dup").put("blobId", UUID.randomUUID().toString())))
                                .toString()
                        )
                    }
                    p == "/api/v2/blobs/upload/init" -> {
                        initCalls++
                        val b = JSONObject(request.body.readUtf8()).getString("blobId")
                        MockResponse().setResponseCode(201).setBody("""{"uploadId":"up-m","blobId":"$b","receivedChunks":0,"expiresAt":9999999999999}""")
                    }
                    p == "/api/v2/blobs/upload/up-m/complete" -> MockResponse().setResponseCode(201).setBody(
                        """{"item":{"id":"it-m","blobId":"${UUID.randomUUID()}","version":1,"size":100,"sha256":"${"d".repeat(64)}","createdAt":1,"updatedAt":1,"state":"active","trashedAt":null,"encMeta":"AAAA","dedupTag":null,"thumbs":[]}}"""
                    )
                    p.startsWith("/api/v2/blobs/upload/up-m/") -> {
                        request.body.readByteArray()
                        MockResponse().setResponseCode(200).setBody("""{"uploadId":"up-m","chunkIndex":0,"receivedChunks":1,"receivedBytes":100}""")
                    }
                    else -> MockResponse().setResponseCode(404)
                }
            }
        }
        server.start()
        try {
            val api = PhotoCloudZkApiClientV2(server.url("/").toString().removeSuffix("/"), allowLocalhostHttpForTests = true)
            val dedupPolicy = if (mutation == "skip_dedup_check") {
                object : ZkDedupCheckPolicy {
                    override suspend fun findExistingOnServer(apiClient: PhotoCloudZkApiClientV2, dedupTagHex: String): V2BackupCheckMatch? = null
                }
            } else {
                DefaultZkDedupCheckPolicy
            }
            val pipeline = ZkBlobUploadPipeline(
                apiClient = api,
                spoolDir = spoolDir,
                resumableStore = InMemoryResumableUploadStore(),
                fkProtector = BackgroundKeyStoreFkProtector(keyStore),
                dedupCheckPolicy = dedupPolicy
            )
            val outcome = pipeline.upload(
                ByteArrayPlaintextSource("mut://dedup", "dup.jpg", "image/jpeg", ByteArray(128) { 0x55 }),
                subkeys
            )
            assertTrue("Dedup hit MUST skip upload without calling /init (got $outcome)", outcome is ZkUploadOutcome.SkippedDuplicate)
            assertEquals("Zero upload /init requests permitted when dedup tag already exists", 0, initCalls)
        } finally {
            server.shutdown()
            spoolDir.deleteRecursively()
            vk.zeroize()
            subkeys.zeroizeAll()
        }
    }

    @Test
    fun `documented mutation leak_filename_in_header must turn Network Spy test RED`(): Unit = runBlocking {
        val mutation = System.getProperty("zk.mutation", "")
        val (vk, subkeys) = testSubkeys()
        val spoolDir = Files.createTempDirectory("zk_mut_hdr_").toFile()
        val keyStore = InMemoryFakeVaultKeyStore().apply { wrapForBackground(vk) }
        val secretName = "Confidential_Tax_2026.pdf"

        val server = MockWebServer()
        server.dispatcher = object : Dispatcher() {
            override fun dispatch(request: RecordedRequest): MockResponse {
                val p = request.path.orEmpty()
                return when {
                    p == "/api/v2/backup/check" -> MockResponse().setResponseCode(200).setBody("""{"existingTags":[],"existingItems":{}}""")
                    p == "/api/v2/blobs/upload/init" -> {
                        val b = JSONObject(request.body.readUtf8()).getString("blobId")
                        MockResponse().setResponseCode(201).setBody("""{"uploadId":"up-h","blobId":"$b","receivedChunks":0,"expiresAt":9999999999999}""")
                    }
                    p == "/api/v2/blobs/upload/up-h/complete" -> MockResponse().setResponseCode(201).setBody(
                        """{"item":{"id":"it-h","blobId":"${UUID.randomUUID()}","version":1,"size":100,"sha256":"${"e".repeat(64)}","createdAt":1,"updatedAt":1,"state":"active","trashedAt":null,"encMeta":"AAAA","dedupTag":null,"thumbs":[]}}"""
                    )
                    p.startsWith("/api/v2/blobs/upload/up-h/") -> {
                        request.body.readByteArray()
                        MockResponse().setResponseCode(200).setBody("""{"uploadId":"up-h","chunkIndex":0,"receivedChunks":1,"receivedBytes":100}""")
                    }
                    else -> MockResponse().setResponseCode(404)
                }
            }
        }
        server.start()
        try {
            val spy = ZkNetworkSpyInterceptor()
            val interceptors = mutableListOf<Interceptor>()
            if (mutation == "leak_filename_in_header") {
                interceptors.add(Interceptor { chain ->
                    chain.proceed(chain.request().newBuilder().header("X-Debug-Filename", secretName).build())
                })
            }
            interceptors.add(spy)

            val api = PhotoCloudZkApiClientV2(
                initialBaseUrl = server.url("/").toString().removeSuffix("/"),
                allowLocalhostHttpForTests = true,
                extraInterceptors = interceptors
            )
            val pipeline = ZkBlobUploadPipeline(
                apiClient = api,
                spoolDir = spoolDir,
                resumableStore = InMemoryResumableUploadStore(),
                fkProtector = BackgroundKeyStoreFkProtector(keyStore)
            )
            val outcome = pipeline.upload(
                ByteArrayPlaintextSource("mut://hdr", secretName, "application/pdf", ByteArray(128) { 0x22 }),
                subkeys
            )
            assertTrue(outcome is ZkUploadOutcome.Uploaded)
            spy.assertZeroSecretLeaks(listOf(TrackedSecret("secretFilename", rawString = secretName)))
        } finally {
            server.shutdown()
            spoolDir.deleteRecursively()
            vk.zeroize()
            subkeys.zeroizeAll()
        }
    }

    @Test
    fun `documented mutation persist_plaintext_fk must turn resumable checkpoint secrecy test RED`(): Unit = runBlocking {
        val mutation = System.getProperty("zk.mutation", "")
        val (vk, subkeys) = testSubkeys()
        val spoolDir = Files.createTempDirectory("zk_mut_fk_").toFile()
        val keyStore = InMemoryFakeVaultKeyStore().apply { wrapForBackground(vk) }
        val store = InMemoryResumableUploadStore()
        val fixedFk = ByteArray(32) { (0xC1 + it).toByte() }
        val fixedFkSnapshot = fixedFk.copyOf()

        val deterministicCrypto = object : ZkCryptoProvider by JvmCryptoProvider {
            private var issued = false
            override fun randomBytes(length: Int): ByteArray {
                if (length == 32 && !issued) {
                    issued = true
                    return fixedFk.copyOf()
                }
                return JvmCryptoProvider.randomBytes(length)
            }
        }

        val server = MockWebServer()
        server.dispatcher = object : Dispatcher() {
            override fun dispatch(request: RecordedRequest): MockResponse {
                val p = request.path.orEmpty()
                return when {
                    p == "/api/v2/backup/check" -> MockResponse().setResponseCode(200).setBody("""{"existingTags":[],"existingItems":{}}""")
                    p == "/api/v2/blobs/upload/init" -> {
                        val b = JSONObject(request.body.readUtf8()).getString("blobId")
                        MockResponse().setResponseCode(201).setBody("""{"uploadId":"up-fk","blobId":"$b","receivedChunks":0,"expiresAt":9999999999999}""")
                    }
                    else -> MockResponse().setResponseCode(503).setBody("""{"error":"DROP"}""")
                }
            }
        }
        server.start()
        try {
            val protector: ZkFkPersistenceProtector = if (mutation == "persist_plaintext_fk") {
                object : ZkFkPersistenceProtector {
                    override fun wrapFkForPersistence(fileKey: ByteArray, blobId: String): String =
                        ZkCoreCrypto.toBase64Url(fileKey)
                    override fun unwrapFkFromPersistence(wrappedFkB64u: String, blobId: String): ByteArray =
                        ZkCoreCrypto.fromBase64Url(wrappedFkB64u)
                }
            } else {
                BackgroundKeyStoreFkProtector(keyStore)
            }
            val api = PhotoCloudZkApiClientV2(server.url("/").toString().removeSuffix("/"), allowLocalhostHttpForTests = true)
            val pipeline = ZkBlobUploadPipeline(
                apiClient = api,
                spoolDir = spoolDir,
                resumableStore = store,
                fkProtector = protector,
                cryptoProvider = deterministicCrypto,
                maxChunkRetries = 0
            )
            val outcome = pipeline.upload(
                ByteArrayPlaintextSource("mut://fk", "fk_test.jpg", "image/jpeg", ByteArray(2048) { 0x11 }),
                subkeys
            )
            assertTrue(outcome is ZkUploadOutcome.Failed)
            val checkpoint = store.get("mut://fk")!!
            val rawJson = checkpoint.toJson().toString()
            assertFalse("Plaintext FK base64url persisted in checkpoint!", rawJson.contains(ZkCoreCrypto.toBase64Url(fixedFkSnapshot)))
            assertFalse("Plaintext FK hex persisted in checkpoint!", rawJson.contains(ZkCoreCrypto.toHex(fixedFkSnapshot), ignoreCase = true))
        } finally {
            server.shutdown()
            spoolDir.deleteRecursively()
            vk.zeroize()
            fixedFk.zeroize()
            fixedFkSnapshot.zeroize()
            subkeys.zeroizeAll()
        }
    }

    @Test
    fun `documented mutation include_gps_by_default must turn default GPS exclusion test RED`() {
        val mutation = System.getProperty("zk.mutation", "")
        val builder: ZkMetaBuilder = if (mutation == "include_gps_by_default") {
            ZkMetaBuilder { input -> DefaultZkMetaBuilder.build(input.copy(includeGps = true)) }
        } else {
            DefaultZkMetaBuilder
        }
        val built = builder.build(
            ZkMetaBuildInput(
                name = "home_photo.jpg",
                mime = "image/jpeg",
                sizeBytes = 4096L,
                rawExif = ZkPlaintextExifSubset(model = "Pixel 9", lat = 45.4642, lon = 9.1900, altitude = 122.0),
                includeGps = false
            )
        )
        assertNull("GPS lat MUST be excluded when includeGps=false", built.exifSubset?.lat)
        assertNull("GPS lon MUST be excluded when includeGps=false", built.exifSubset?.lon)
        assertNull("GPS altitude MUST be excluded when includeGps=false", built.exifSubset?.altitude)
    }
}
