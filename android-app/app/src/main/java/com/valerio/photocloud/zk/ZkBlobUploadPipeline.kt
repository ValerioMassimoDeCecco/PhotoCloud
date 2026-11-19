package com.valerio.photocloud.zk

import android.content.Context
import android.content.SharedPreferences
import android.media.MediaMetadataRetriever
import android.net.Uri
import android.provider.OpenableColumns
import androidx.exifinterface.media.ExifInterface
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.delay
import kotlinx.coroutines.withContext
import okhttp3.MediaType
import okhttp3.RequestBody
import okio.BufferedSink
import org.json.JSONObject
import java.io.BufferedOutputStream
import java.io.ByteArrayInputStream
import java.io.File
import java.io.FileInputStream
import java.io.FileOutputStream
import java.io.IOException
import java.io.InputStream
import java.io.RandomAccessFile
import java.nio.charset.StandardCharsets
import java.util.UUID
import java.util.concurrent.atomic.AtomicBoolean
import kotlin.math.min

/**
 * Pure streaming plaintext source abstraction (allows constant-memory uploads from Android SAF/MediaStore
 * `Uri`, `File`, or synthetic JVM streams in tests without loading the entire file into RAM).
 */
interface ZkPlaintextSource {
    val sourceKey: String
    val displayName: String
    val mimeType: String
    val sizeBytes: Long
    val takenAtMs: Long?
    val createdAtMs: Long
    val width: Int?
    val height: Int?
    val durationSec: Double?
    val rawExif: ZkPlaintextExifSubset?
    fun openInputStream(): InputStream
}

class ByteArrayPlaintextSource(
    override val sourceKey: String,
    override val displayName: String,
    override val mimeType: String,
    private val data: ByteArray,
    override val takenAtMs: Long? = null,
    override val createdAtMs: Long = System.currentTimeMillis(),
    override val width: Int? = null,
    override val height: Int? = null,
    override val durationSec: Double? = null,
    override val rawExif: ZkPlaintextExifSubset? = null
) : ZkPlaintextSource {
    override val sizeBytes: Long = data.size.toLong()
    override fun openInputStream(): InputStream = ByteArrayInputStream(data)
}

class FilePlaintextSource(
    private val file: File,
    override val sourceKey: String = file.absolutePath,
    override val displayName: String = file.name,
    override val mimeType: String = "application/octet-stream",
    override val takenAtMs: Long? = file.lastModified(),
    override val createdAtMs: Long = file.lastModified(),
    override val width: Int? = null,
    override val height: Int? = null,
    override val durationSec: Double? = null,
    override val rawExif: ZkPlaintextExifSubset? = null
) : ZkPlaintextSource {
    override val sizeBytes: Long = file.length()
    override fun openInputStream(): InputStream = FileInputStream(file)
}

/**
 * Android SAF / MediaStore `Uri` streaming source. Never copies plaintext to disk.
 */
class AndroidUriPlaintextSource(
    private val context: Context,
    val uri: Uri,
    override val sourceKey: String = uri.toString(),
    fallbackName: String? = null,
    fallbackMime: String? = null,
    fallbackSizeBytes: Long? = null,
    fallbackTakenAtMs: Long? = null
) : ZkPlaintextSource {

    override val displayName: String
    override val mimeType: String
    override val sizeBytes: Long
    override val takenAtMs: Long?
    override val createdAtMs: Long
    override val width: Int?
    override val height: Int?
    override val durationSec: Double?
    override val rawExif: ZkPlaintextExifSubset?

    init {
        val resolver = context.applicationContext.contentResolver
        var resolvedName = fallbackName
        var resolvedSize = fallbackSizeBytes ?: 0L
        try {
            resolver.query(uri, arrayOf(OpenableColumns.DISPLAY_NAME, OpenableColumns.SIZE), null, null, null)?.use { c ->
                if (c.moveToFirst()) {
                    val nameIdx = c.getColumnIndex(OpenableColumns.DISPLAY_NAME)
                    val sizeIdx = c.getColumnIndex(OpenableColumns.SIZE)
                    if (nameIdx >= 0 && resolvedName.isNullOrBlank()) {
                        resolvedName = c.getString(nameIdx)
                    }
                    if (sizeIdx >= 0 && !c.isNull(sizeIdx)) {
                        resolvedSize = c.getLong(sizeIdx)
                    }
                }
            }
        } catch (_: Throwable) {
        }

        val resolvedMime = fallbackMime
            ?: resolver.getType(uri)
            ?: "application/octet-stream"

        this.displayName = resolvedName?.takeIf { it.isNotBlank() }
            ?: uri.lastPathSegment?.substringAfterLast('/')
            ?: "media_item"
        this.mimeType = resolvedMime
        this.sizeBytes = resolvedSize.coerceAtLeast(0L)
        this.createdAtMs = fallbackTakenAtMs ?: System.currentTimeMillis()
        this.takenAtMs = fallbackTakenAtMs

        var extractedWidth: Int? = null
        var extractedHeight: Int? = null
        var extractedDuration: Double? = null
        var extractedExif: ZkPlaintextExifSubset? = null

        if (resolvedMime.startsWith("image/", ignoreCase = true)) {
            try {
                openInputStream().use { input ->
                    val exif = ExifInterface(input)
                    val w = exif.getAttributeInt(ExifInterface.TAG_IMAGE_WIDTH, 0)
                    val h = exif.getAttributeInt(ExifInterface.TAG_IMAGE_LENGTH, 0)
                    if (w > 0) extractedWidth = w
                    if (h > 0) extractedHeight = h
                    val latLong = exif.latLong
                    val alt = exif.getAltitude(Double.NaN)
                    val fNum = exif.getAttributeDouble(ExifInterface.TAG_F_NUMBER, Double.NaN)
                    val focal = exif.getAttributeDouble(ExifInterface.TAG_FOCAL_LENGTH, Double.NaN)
                    val isoStr = exif.getAttribute(ExifInterface.TAG_PHOTOGRAPHIC_SENSITIVITY)
                    extractedExif = ZkPlaintextExifSubset(
                        make = exif.getAttribute(ExifInterface.TAG_MAKE),
                        model = exif.getAttribute(ExifInterface.TAG_MODEL),
                        lensModel = exif.getAttribute(ExifInterface.TAG_LENS_MODEL),
                        fNumber = if (fNum.isNaN()) null else fNum,
                        exposureTime = exif.getAttribute(ExifInterface.TAG_EXPOSURE_TIME),
                        iso = isoStr?.toIntOrNull(),
                        focalLength = if (focal.isNaN()) null else focal,
                        lat = latLong?.getOrNull(0),
                        lon = latLong?.getOrNull(1),
                        altitude = if (alt.isNaN()) null else alt
                    )
                }
            } catch (_: Throwable) {
            }
        } else if (resolvedMime.startsWith("video/", ignoreCase = true)) {
            val retriever = MediaMetadataRetriever()
            try {
                retriever.setDataSource(context.applicationContext, uri)
                extractedWidth = retriever.extractMetadata(MediaMetadataRetriever.METADATA_KEY_VIDEO_WIDTH)?.toIntOrNull()
                extractedHeight = retriever.extractMetadata(MediaMetadataRetriever.METADATA_KEY_VIDEO_HEIGHT)?.toIntOrNull()
                val durMs = retriever.extractMetadata(MediaMetadataRetriever.METADATA_KEY_DURATION)?.toLongOrNull()
                if (durMs != null && durMs > 0L) {
                    extractedDuration = durMs.toDouble() / 1000.0
                }
            } catch (_: Throwable) {
            } finally {
                try {
                    retriever.release()
                } catch (_: Throwable) {
                }
            }
        }

        this.width = extractedWidth
        this.height = extractedHeight
        this.durationSec = extractedDuration
        this.rawExif = extractedExif
    }

    override fun openInputStream(): InputStream {
        return context.applicationContext.contentResolver.openInputStream(uri)
            ?: throw IOException("Impossibile aprire stream sorgente: $uri")
    }
}

/**
 * Resumable upload checkpoint persisted across app kill / network drop.
 *
 * Security invariant: NEVER contains plaintext `FK`, `VK`, or plaintext media bytes.
 * `wrappedFkKeystoreB64u` is wrapped with the AndroidKeyStore background key (`photocloud_vk_bg_v2`).
 */
data class ZkResumableUploadState(
    val sourceKey: String,
    val uploadId: String,
    val blobId: String,
    val chunkSizeLog2: Int,
    val uploadChunkBytes: Int,
    val totalCiphertextBytes: Long,
    val totalChunks: Int,
    val nextChunkIndex: Int,
    val expectedSha256Hex: String,
    val encMetaB64u: String,
    val dedupTag: String?,
    val noncePrefixB64u: String,
    val wrappedFkKeystoreB64u: String,
    val spoolFileName: String,
    val updatedAtMs: Long
) {
    fun toJson(): JSONObject {
        return JSONObject()
            .put("sourceKey", sourceKey)
            .put("uploadId", uploadId)
            .put("blobId", blobId)
            .put("chunkSizeLog2", chunkSizeLog2)
            .put("uploadChunkBytes", uploadChunkBytes)
            .put("totalCiphertextBytes", totalCiphertextBytes)
            .put("totalChunks", totalChunks)
            .put("nextChunkIndex", nextChunkIndex)
            .put("expectedSha256Hex", expectedSha256Hex)
            .put("encMetaB64u", encMetaB64u)
            .apply { if (dedupTag != null) put("dedupTag", dedupTag) }
            .put("noncePrefixB64u", noncePrefixB64u)
            .put("wrappedFkKeystoreB64u", wrappedFkKeystoreB64u)
            .put("spoolFileName", spoolFileName)
            .put("updatedAtMs", updatedAtMs)
    }

    companion object {
        fun fromJson(obj: JSONObject): ZkResumableUploadState {
            return ZkResumableUploadState(
                sourceKey = obj.getString("sourceKey"),
                uploadId = obj.getString("uploadId"),
                blobId = obj.getString("blobId"),
                chunkSizeLog2 = obj.getInt("chunkSizeLog2"),
                uploadChunkBytes = obj.getInt("uploadChunkBytes"),
                totalCiphertextBytes = obj.getLong("totalCiphertextBytes"),
                totalChunks = obj.getInt("totalChunks"),
                nextChunkIndex = obj.getInt("nextChunkIndex"),
                expectedSha256Hex = obj.getString("expectedSha256Hex"),
                encMetaB64u = obj.getString("encMetaB64u"),
                dedupTag = if (obj.has("dedupTag") && !obj.isNull("dedupTag")) obj.getString("dedupTag") else null,
                noncePrefixB64u = obj.getString("noncePrefixB64u"),
                wrappedFkKeystoreB64u = obj.getString("wrappedFkKeystoreB64u"),
                spoolFileName = obj.getString("spoolFileName"),
                updatedAtMs = obj.optLong("updatedAtMs", 0L)
            )
        }
    }
}

interface ZkResumableUploadStore {
    fun get(sourceKey: String): ZkResumableUploadState?
    fun save(state: ZkResumableUploadState)
    fun remove(sourceKey: String)
    fun listAll(): List<ZkResumableUploadState>
    fun clearAll()
}

class InMemoryResumableUploadStore : ZkResumableUploadStore {
    private val map = LinkedHashMap<String, ZkResumableUploadState>()

    @Synchronized
    override fun get(sourceKey: String): ZkResumableUploadState? = map[sourceKey]

    @Synchronized
    override fun save(state: ZkResumableUploadState) {
        map[state.sourceKey] = state
    }

    @Synchronized
    override fun remove(sourceKey: String) {
        map.remove(sourceKey)
    }

    @Synchronized
    override fun listAll(): List<ZkResumableUploadState> = map.values.toList()

    @Synchronized
    override fun clearAll() {
        map.clear()
    }
}

class PrefsResumableUploadStore(context: Context) : ZkResumableUploadStore {
    companion object {
        private const val PREFS_NAME = "photocloud_v2_resumable_uploads"
    }

    private val prefs: SharedPreferences =
        context.applicationContext.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE)

    override fun get(sourceKey: String): ZkResumableUploadState? {
        val raw = prefs.getString(sourceKey, null) ?: return null
        return try {
            ZkResumableUploadState.fromJson(JSONObject(raw))
        } catch (_: Throwable) {
            null
        }
    }

    override fun save(state: ZkResumableUploadState) {
        prefs.edit().putString(state.sourceKey, state.toJson().toString()).apply()
    }

    override fun remove(sourceKey: String) {
        prefs.edit().remove(sourceKey).apply()
    }

    override fun listAll(): List<ZkResumableUploadState> {
        val out = ArrayList<ZkResumableUploadState>()
        for ((_, value) in prefs.all) {
            val raw = value as? String ?: continue
            try {
                out.add(ZkResumableUploadState.fromJson(JSONObject(raw)))
            } catch (_: Throwable) {
            }
        }
        return out
    }

    override fun clearAll() {
        prefs.edit().clear().apply()
    }
}

/**
 * Wraps the ephemeral 32-byte `FK` before persisting resumable upload checkpoints.
 * Plaintext `FK` MUST never be persisted to disk.
 */
interface ZkFkPersistenceProtector {
    fun wrapFkForPersistence(fileKey: ByteArray, blobId: String): String
    fun unwrapFkFromPersistence(wrappedFkB64u: String, blobId: String): ByteArray
}

class BackgroundKeyStoreFkProtector(
    private val vaultKeyStore: VaultKeyStore
) : ZkFkPersistenceProtector {
    override fun wrapFkForPersistence(fileKey: ByteArray, blobId: String): String {
        val aad = "upload-fk|${blobId.lowercase()}".toByteArray(StandardCharsets.UTF_8)
        val wrapped = vaultKeyStore.wrapSecretWithBackgroundKey(fileKey, aad)
        return ZkCoreCrypto.toBase64Url(wrapped)
    }

    override fun unwrapFkFromPersistence(wrappedFkB64u: String, blobId: String): ByteArray {
        val aad = "upload-fk|${blobId.lowercase()}".toByteArray(StandardCharsets.UTF_8)
        val envelope = ZkCoreCrypto.fromBase64Url(wrappedFkB64u)
        return vaultKeyStore.unwrapSecretWithBackgroundKey(envelope, aad)
    }
}

/**
 * Policy controlling pre-upload opaque deduplication via `POST /api/v2/backup/check`.
 */
interface ZkDedupCheckPolicy {
    suspend fun findExistingOnServer(
        apiClient: PhotoCloudZkApiClientV2,
        dedupTagHex: String
    ): V2BackupCheckMatch?
}

object DefaultZkDedupCheckPolicy : ZkDedupCheckPolicy {
    override suspend fun findExistingOnServer(
        apiClient: PhotoCloudZkApiClientV2,
        dedupTagHex: String
    ): V2BackupCheckMatch? {
        val resp = apiClient.checkBackupDedupTags(listOf(dedupTagHex))
        return if (dedupTagHex in resp.existingTags) {
            resp.existingItems[dedupTagHex] ?: V2BackupCheckMatch(itemId = "", blobId = "")
        } else {
            null
        }
    }
}

class ZkUploadControl {
    private val pausedFlag = AtomicBoolean(false)
    private val cancelledFlag = AtomicBoolean(false)

    val isPaused: Boolean get() = pausedFlag.get()
    val isCancelled: Boolean get() = cancelledFlag.get()

    fun pause() {
        pausedFlag.set(true)
    }

    fun resume() {
        pausedFlag.set(false)
    }

    fun cancel() {
        cancelledFlag.set(true)
        pausedFlag.set(false)
    }

    suspend fun checkOrWait(returnImmediatelyOnPause: Boolean = false): Boolean {
        if (cancelledFlag.get()) throw CancellationException("Upload annullato dall'utente.")
        if (pausedFlag.get()) {
            if (returnImmediatelyOnPause) return false
            while (pausedFlag.get() && !cancelledFlag.get()) {
                delay(150L)
            }
            if (cancelledFlag.get()) throw CancellationException("Upload annullato dall'utente.")
        }
        return true
    }
}

data class ZkUploadProgress(
    val sourceKey: String,
    val blobId: String,
    val bytesUploaded: Long,
    val totalCiphertextBytes: Long,
    val uploadedChunks: Int,
    val totalChunks: Int
)

enum class ZkUploadFailureKind {
    QUOTA_EXCEEDED,
    UNAUTHORIZED,
    INTEGRITY_MISMATCH,
    DEVICE_LOCKED,
    RETRYABLE_NETWORK,
    PERMANENT_ERROR
}

sealed interface ZkUploadOutcome {
    data class Uploaded(
        val item: V2ServerItem,
        val blobId: String,
        val dedupTagHex: String,
        val uploadedThumbs: List<String>
    ) : ZkUploadOutcome

    data class SkippedDuplicate(
        val dedupTagHex: String,
        val existingItemId: String,
        val existingBlobId: String
    ) : ZkUploadOutcome

    data class Paused(
        val state: ZkResumableUploadState
    ) : ZkUploadOutcome

    data object Cancelled : ZkUploadOutcome

    data class Failed(
        val kind: ZkUploadFailureKind,
        val message: String,
        val httpStatus: Int? = null
    ) : ZkUploadOutcome
}

/**
 * Constant-memory streaming `RequestBody` that sends a `[offset, offset + length)` slice
 * of a ciphertext spool file in 64 KiB chunks without ever loading the slice into heap memory.
 */
class FileSliceRequestBody(
    private val file: File,
    private val offset: Long,
    private val length: Long,
    private val mediaType: MediaType = PhotoCloudZkApiClientV2.OCTET_MEDIA_TYPE
) : RequestBody() {

    companion object {
        private const val STREAM_BUF_SIZE = 64 * 1024
    }

    override fun contentType(): MediaType = mediaType

    override fun contentLength(): Long = length

    override fun writeTo(sink: BufferedSink) {
        RandomAccessFile(file, "r").use { raf ->
            raf.seek(offset)
            val buf = ByteArray(STREAM_BUF_SIZE)
            var remaining = length
            while (remaining > 0L) {
                val toRead = min(buf.size.toLong(), remaining).toInt()
                val read = raf.read(buf, 0, toRead)
                if (read <= 0) {
                    throw IOException("Fine file inattesa nello spool ciphertext (mancanti $remaining byte).")
                }
                sink.write(buf, 0, read)
                remaining -= read
            }
        }
    }
}

/**
 * Constant-memory streaming Zero-Knowledge upload pipeline (FASE 4C):
 * 1. Computes opaque `dedupTag = HMAC-SHA256(dedupKey, plaintext)` in 64 KiB blocks and queries
 *    `POST /api/v2/backup/check` before encrypting/uploading.
 * 2. Encrypts plaintext to `PCZK v1` in streaming (`ZkCoreCrypto.encryptBlobStream`), spooling
 *    ONLY ciphertext to private app cache (`spoolDir/zk_spool_<blobId>.pczk.tmp`). Plaintext NEVER
 *    touches disk.
 * 3. Persists resumable checkpoint (`uploadId`, `nextChunkIndex`, `blobId`, `noncePrefix`, and
 *    KeyStore-wrapped `FK` — never plaintext `FK`).
 * 4. Uploads chunks sequentially via [FileSliceRequestBody] (`PUT /api/v2/blobs/upload/:id/:idx`),
 *    recovering automatically from process kill, network drops, `409 CHUNK_OUT_OF_ORDER`, and
 *    `404 UPLOAD_EXPIRED`.
 * 5. Calls `POST /api/v2/blobs/upload/:id/complete`, uploads encrypted 320/1280 thumbnails
 *    (`PUT /api/v2/blobs/:id/thumbs/:variant`), and deletes the ciphertext spool file immediately.
 */
class ZkBlobUploadPipeline(
    private val apiClient: PhotoCloudZkApiClientV2,
    private val spoolDir: File,
    private val resumableStore: ZkResumableUploadStore,
    private val fkProtector: ZkFkPersistenceProtector,
    private val thumbnailGenerator: ZkThumbnailGenerator = NoOpZkThumbnailGenerator,
    private val metaBuilder: ZkMetaBuilder = DefaultZkMetaBuilder,
    private val dedupCheckPolicy: ZkDedupCheckPolicy = DefaultZkDedupCheckPolicy,
    private val cryptoProvider: ZkCryptoProvider = JvmCryptoProvider,
    private val chunkSizeLog2: Int = ZkCoreCrypto.DEFAULT_CHUNK_SIZE_LOG2,
    private val uploadChunkBytes: Int = DEFAULT_UPLOAD_CHUNK_BYTES,
    private val maxChunkRetries: Int = 2
) {
    companion object {
        const val SPOOL_PREFIX = "zk_spool_"
        const val SPOOL_SUFFIX = ".pczk.tmp"
        const val DEFAULT_UPLOAD_CHUNK_BYTES = 4 * 1024 * 1024 // 4 MiB (<= 16 MiB server cap)

        /**
         * Removes orphaned ciphertext spool files in [spoolDir] not referenced by any active checkpoint.
         * Safe to call on app startup and after logout.
         */
        fun cleanupOrphanSpoolFiles(
            spoolDir: File,
            activeSpoolFileNames: Set<String> = emptySet()
        ): Int {
            if (!spoolDir.exists() || !spoolDir.isDirectory) return 0
            val children = spoolDir.listFiles() ?: return 0
            var deleted = 0
            for (child in children) {
                if (child.isFile &&
                    child.name.startsWith(SPOOL_PREFIX) &&
                    child.name.endsWith(SPOOL_SUFFIX) &&
                    child.name !in activeSpoolFileNames
                ) {
                    if (child.delete()) deleted++
                }
            }
            return deleted
        }
    }

    suspend fun upload(
        source: ZkPlaintextSource,
        subkeys: ZkCoreCrypto.VaultSubkeys,
        includeGps: Boolean = false,
        checkDedupBeforeUpload: Boolean = true,
        control: ZkUploadControl = ZkUploadControl(),
        returnImmediatelyOnPause: Boolean = true,
        onProgress: ((ZkUploadProgress) -> Unit)? = null
    ): ZkUploadOutcome = withContext(Dispatchers.IO) {
        if (!spoolDir.exists()) {
            spoolDir.mkdirs()
        }

        var loadedState: ZkResumableUploadState? = resumableStore.get(source.sourceKey)
        var spoolFile: File? = loadedState?.let { File(spoolDir, it.spoolFileName) }
        var thumbPair: ZkThumbPair? = null

        try {
            // Validate existing checkpoint integrity; discard if spool disappeared or truncated
            val candidateExisting = loadedState
            if (candidateExisting != null) {
                val f = spoolFile
                if (f == null || !f.exists() || f.length() != candidateExisting.totalCiphertextBytes) {
                    f?.delete()
                    resumableStore.remove(source.sourceKey)
                    loadedState = null
                    spoolFile = null
                }
            }

            // 1. Streaming 64 KiB dedupTag computation + opaque server check (only when starting fresh)
            val validatedExisting: ZkResumableUploadState? = loadedState
            var state: ZkResumableUploadState = if (validatedExisting == null) {
                if (!control.checkOrWait(returnImmediatelyOnPause)) {
                    return@withContext ZkUploadOutcome.Cancelled
                }
                val dedupBytes = source.openInputStream().use { input ->
                    ZkCoreCrypto.computeDedupTag(subkeys.dedupKey, input)
                }
                val computedDedupTagHex = ZkCoreCrypto.toHex(dedupBytes)
                dedupBytes.zeroize()

                if (checkDedupBeforeUpload) {
                    val match = dedupCheckPolicy.findExistingOnServer(apiClient, computedDedupTagHex)
                    if (match != null) {
                        return@withContext ZkUploadOutcome.SkippedDuplicate(
                            dedupTagHex = computedDedupTagHex,
                            existingItemId = match.itemId,
                            existingBlobId = match.blobId
                        )
                    }
                }

                // 2. Generate thumbnails in RAM (optional, zero plaintext on disk)
                thumbPair = try {
                    thumbnailGenerator.generate(source)
                } catch (_: Throwable) {
                    null
                }

                // 3. Generate per-blob random keys and stream-encrypt plaintext directly into private ciphertext spool
                val blobId = UUID.randomUUID().toString().lowercase()
                val fileKey = cryptoProvider.randomBytes(32)
                val noncePrefix = cryptoProvider.randomBytes(4)
                val targetSpool = File(spoolDir, "$SPOOL_PREFIX$blobId$SPOOL_SUFFIX")
                spoolFile = targetSpool

                val wrappedFkForCheckpoint: String
                val encResult: ZkCoreCrypto.EncryptBlobStreamResult
                try {
                    wrappedFkForCheckpoint = fkProtector.wrapFkForPersistence(fileKey, blobId)
                    encResult = source.openInputStream().use { ptIn ->
                        BufferedOutputStream(FileOutputStream(targetSpool), 65536).use { ctOut ->
                            val res = ZkCoreCrypto.encryptBlobStream(
                                input = ptIn,
                                output = ctOut,
                                fkWrapKey = subkeys.fkWrapKey,
                                blobId = blobId,
                                fileKey = fileKey,
                                noncePrefix = noncePrefix,
                                chunkSizeLog2 = chunkSizeLog2,
                                dedupKey = null,
                                cryptoProvider = cryptoProvider
                            )
                            ctOut.flush()
                            res
                        }
                    }
                } finally {
                    fileKey.zeroize()
                }

                // 4. Build & encrypt encMeta (GPS stripped unless includeGps = true)
                val plaintextMeta = metaBuilder.build(
                    ZkMetaBuildInput(
                        name = source.displayName,
                        mime = source.mimeType,
                        sizeBytes = encResult.totalPlaintextBytes,
                        takenAtMs = source.takenAtMs,
                        createdAtMs = source.createdAtMs,
                        width = source.width,
                        height = source.height,
                        durationSec = source.durationSec,
                        rawExif = source.rawExif,
                        includeGps = includeGps,
                        dedupTag = computedDedupTagHex,
                        thumbs = thumbPair?.toThumbsMeta()
                    )
                )
                val encMetaBytes = ZkCoreCrypto.encryptMeta(
                    metaKey = subkeys.metaKey,
                    blobId = blobId,
                    plaintextJson = plaintextMeta.toJsonString(),
                    cryptoProvider = cryptoProvider
                )
                val encMetaB64u = ZkCoreCrypto.toBase64Url(encMetaBytes)

                val effectiveUploadChunkBytes = uploadChunkBytes.coerceIn(65536, 16 * 1024 * 1024)
                val totalCt = encResult.totalCiphertextBytes
                val totalUploadChunks = ((totalCt + effectiveUploadChunkBytes - 1L) / effectiveUploadChunkBytes)
                    .toInt()
                    .coerceAtLeast(1)

                val initResp = apiClient.initBlobUpload(
                    blobId = blobId,
                    totalSize = totalCt,
                    chunkSize = effectiveUploadChunkBytes,
                    totalChunks = totalUploadChunks,
                    expectedSha256Hex = encResult.ciphertextSha256Hex,
                    encMetaB64u = encMetaB64u,
                    dedupTag = computedDedupTagHex
                )

                val createdState = ZkResumableUploadState(
                    sourceKey = source.sourceKey,
                    uploadId = initResp.uploadId,
                    blobId = blobId,
                    chunkSizeLog2 = chunkSizeLog2,
                    uploadChunkBytes = effectiveUploadChunkBytes,
                    totalCiphertextBytes = totalCt,
                    totalChunks = totalUploadChunks,
                    nextChunkIndex = initResp.receivedChunks,
                    expectedSha256Hex = encResult.ciphertextSha256Hex,
                    encMetaB64u = encMetaB64u,
                    dedupTag = computedDedupTagHex,
                    noncePrefixB64u = ZkCoreCrypto.toBase64Url(noncePrefix),
                    wrappedFkKeystoreB64u = wrappedFkForCheckpoint,
                    spoolFileName = targetSpool.name,
                    updatedAtMs = System.currentTimeMillis()
                )
                noncePrefix.zeroize()
                resumableStore.save(createdState)
                createdState
            } else {
                if (thumbPair == null) {
                    thumbPair = try {
                        thumbnailGenerator.generate(source)
                    } catch (_: Throwable) {
                        null
                    }
                }
                validatedExisting
            }

            val dedupTagHex: String = state.dedupTag.orEmpty()
            val activeSpool: File = spoolFile ?: File(spoolDir, state.spoolFileName)
            spoolFile = activeSpool

            // 5. Sequential streaming chunk upload with resume, 409 resync, and 404 re-init
            var chunkIndex = state.nextChunkIndex
            var reinitializedOnce = false
            while (chunkIndex < state.totalChunks) {
                if (!control.checkOrWait(returnImmediatelyOnPause)) {
                    resumableStore.save(state.copy(nextChunkIndex = chunkIndex, updatedAtMs = System.currentTimeMillis()))
                    return@withContext ZkUploadOutcome.Paused(state.copy(nextChunkIndex = chunkIndex))
                }

                val offset = chunkIndex.toLong() * state.uploadChunkBytes.toLong()
                val sliceLen = min(state.uploadChunkBytes.toLong(), state.totalCiphertextBytes - offset)
                val sliceBody = FileSliceRequestBody(activeSpool, offset, sliceLen)

                var uploadedThisChunk = false
                var resynced = false
                var attempt = 0
                while (!uploadedThisChunk) {
                    try {
                        apiClient.uploadBlobChunk(state.uploadId, chunkIndex, sliceBody)
                        uploadedThisChunk = true
                    } catch (ooo: V2ChunkOutOfOrderException) {
                        chunkIndex = ooo.expectedChunkIndex.coerceIn(0, state.totalChunks)
                        state = state.copy(nextChunkIndex = chunkIndex, updatedAtMs = System.currentTimeMillis())
                        resumableStore.save(state)
                        resynced = true
                        uploadedThisChunk = true
                    } catch (http: V2ApiHttpException) {
                        if (http.statusCode == 404 && !reinitializedOnce) {
                            reinitializedOnce = true
                            val newInit = apiClient.initBlobUpload(
                                blobId = state.blobId,
                                totalSize = state.totalCiphertextBytes,
                                chunkSize = state.uploadChunkBytes,
                                totalChunks = state.totalChunks,
                                expectedSha256Hex = state.expectedSha256Hex,
                                encMetaB64u = state.encMetaB64u,
                                dedupTag = state.dedupTag
                            )
                            chunkIndex = newInit.receivedChunks
                            state = state.copy(
                                uploadId = newInit.uploadId,
                                nextChunkIndex = chunkIndex,
                                updatedAtMs = System.currentTimeMillis()
                            )
                            resumableStore.save(state)
                            resynced = true
                            uploadedThisChunk = true
                        } else if (attempt < maxChunkRetries && isRetryableStatus(http.statusCode)) {
                            attempt++
                            delay(250L * attempt)
                        } else {
                            throw http
                        }
                    } catch (io: IOException) {
                        if (attempt < maxChunkRetries) {
                            attempt++
                            delay(250L * attempt)
                        } else {
                            throw io
                        }
                    }
                }

                if (!resynced) {
                    chunkIndex++
                    state = state.copy(nextChunkIndex = chunkIndex, updatedAtMs = System.currentTimeMillis())
                    resumableStore.save(state)
                }

                val bytesSent = min(state.totalCiphertextBytes, chunkIndex.toLong() * state.uploadChunkBytes.toLong())
                onProgress?.invoke(
                    ZkUploadProgress(
                        sourceKey = source.sourceKey,
                        blobId = state.blobId,
                        bytesUploaded = bytesSent,
                        totalCiphertextBytes = state.totalCiphertextBytes,
                        uploadedChunks = chunkIndex,
                        totalChunks = state.totalChunks
                    )
                )
            }

            // 6. Complete upload on server (verifies SHA-256 of ciphertext)
            val completedItem = apiClient.completeBlobUpload(state.uploadId, createItem = true)
                ?: throw IOException("Server non ha restituito l'item su /complete.")

            // 7. Upload encrypted 320 / 1280 thumbnails (strictly encrypted with thumbKey)
            val uploadedThumbs = ArrayList<String>(2)
            thumbPair?.sm320?.let { sm ->
                val encSm = ZkCoreCrypto.encryptThumbnail(
                    thumbKey = subkeys.thumbKey,
                    blobId = state.blobId,
                    variant = "320",
                    thumbPlaintext = sm.jpegBytes,
                    cryptoProvider = cryptoProvider
                )
                try {
                    apiClient.uploadEncryptedThumbnail(state.blobId, "320", encSm)
                    uploadedThumbs.add("320")
                } catch (_: Throwable) {
                }
            }
            thumbPair?.md1280?.let { md ->
                val encMd = ZkCoreCrypto.encryptThumbnail(
                    thumbKey = subkeys.thumbKey,
                    blobId = state.blobId,
                    variant = "1280",
                    thumbPlaintext = md.jpegBytes,
                    cryptoProvider = cryptoProvider
                )
                try {
                    apiClient.uploadEncryptedThumbnail(state.blobId, "1280", encMd)
                    uploadedThumbs.add("1280")
                } catch (_: Throwable) {
                }
            }

            // 8. Delete ciphertext spool & clear checkpoint upon full success
            activeSpool.delete()
            resumableStore.remove(source.sourceKey)

            ZkUploadOutcome.Uploaded(
                item = completedItem,
                blobId = state.blobId,
                dedupTagHex = dedupTagHex,
                uploadedThumbs = uploadedThumbs
            )
        } catch (_: CancellationException) {
            spoolFile?.delete()
            resumableStore.remove(source.sourceKey)
            ZkUploadOutcome.Cancelled
        } catch (locked: VaultKeyStore.DeviceLockedException) {
            ZkUploadOutcome.Failed(
                kind = ZkUploadFailureKind.DEVICE_LOCKED,
                message = locked.message ?: "Dispositivo bloccato: sblocca il telefono per proseguire il backup."
            )
        } catch (http: V2ApiHttpException) {
            val kind = classifyHttpFailure(http.statusCode, http.errorCode)
            if (kind == ZkUploadFailureKind.INTEGRITY_MISMATCH || kind == ZkUploadFailureKind.PERMANENT_ERROR) {
                spoolFile?.delete()
                resumableStore.remove(source.sourceKey)
            }
            ZkUploadOutcome.Failed(
                kind = kind,
                message = http.message ?: "Errore HTTP ${http.statusCode}",
                httpStatus = http.statusCode
            )
        } catch (io: IOException) {
            // Keep resumable spool + state intact for automatic resume on next attempt!
            ZkUploadOutcome.Failed(
                kind = ZkUploadFailureKind.RETRYABLE_NETWORK,
                message = io.message ?: "Errore di rete durante l'upload."
            )
        } catch (t: Throwable) {
            spoolFile?.delete()
            resumableStore.remove(source.sourceKey)
            ZkUploadOutcome.Failed(
                kind = ZkUploadFailureKind.PERMANENT_ERROR,
                message = t.message ?: "Errore imprevisto durante l'upload cifrato."
            )
        } finally {
            thumbPair?.zeroizeAll()
        }
    }

    private fun isRetryableStatus(statusCode: Int): Boolean {
        return statusCode == 408 || statusCode == 429 || statusCode in 500..599
    }

    private fun classifyHttpFailure(statusCode: Int, errorCode: String): ZkUploadFailureKind {
        return when {
            statusCode == 413 || errorCode == "QUOTA_EXCEEDED" -> ZkUploadFailureKind.QUOTA_EXCEEDED
            statusCode == 401 || statusCode == 403 -> ZkUploadFailureKind.UNAUTHORIZED
            statusCode == 422 || errorCode == "CIPHERTEXT_INTEGRITY_MISMATCH" -> ZkUploadFailureKind.INTEGRITY_MISMATCH
            isRetryableStatus(statusCode) -> ZkUploadFailureKind.RETRYABLE_NETWORK
            else -> ZkUploadFailureKind.PERMANENT_ERROR
        }
    }
}
