package com.valerio.photocloud.zk

import android.media.MediaDataSource
import com.valerio.photocloud.AutoBackupLogic
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.runBlocking
import kotlinx.coroutines.withContext
import org.json.JSONArray
import org.json.JSONObject
import java.io.ByteArrayOutputStream
import java.io.Closeable
import java.io.File
import java.io.FileOutputStream
import java.io.IOException
import java.io.OutputStream
import java.io.RandomAccessFile
import java.nio.charset.StandardCharsets
import java.util.UUID
import kotlin.math.min

data class DecryptedZkItem(
    val serverItem: V2ServerItem,
    val meta: ZkBlobPlaintextMeta
) {
    val id: String get() = serverItem.id
    val blobId: String get() = serverItem.blobId
    val isVideo: Boolean get() = meta.mime.startsWith("video/", ignoreCase = true)
    val isImage: Boolean get() = meta.mime.startsWith("image/", ignoreCase = true)
}

data class ZkAlbumRecord(
    val id: String,
    val name: String,
    val itemIds: List<String> = emptyList(),
    val coverItemId: String? = null,
    val createdAt: Long = System.currentTimeMillis(),
    val updatedAt: Long = System.currentTimeMillis()
) {
    fun toJson(): JSONObject {
        val arr = JSONArray()
        for (id in itemIds) arr.put(id)
        return JSONObject()
            .put("id", id)
            .put("name", name)
            .put("itemIds", arr)
            .apply { if (!coverItemId.isNullOrBlank()) put("coverItemId", coverItemId) }
            .put("createdAt", createdAt)
            .put("updatedAt", updatedAt)
    }

    companion object {
        fun fromJson(obj: JSONObject): ZkAlbumRecord {
            val arr = obj.optJSONArray("itemIds") ?: JSONArray()
            val list = ArrayList<String>(arr.length())
            for (i in 0 until arr.length()) list.add(arr.getString(i))
            return ZkAlbumRecord(
                id = obj.getString("id"),
                name = obj.optString("name", "Album"),
                itemIds = list,
                coverItemId = if (obj.has("coverItemId") && !obj.isNull("coverItemId")) obj.optString("coverItemId") else null,
                createdAt = obj.optLong("createdAt", 0L),
                updatedAt = obj.optLong("updatedAt", 0L)
            )
        }
    }
}

data class ZkAlbumsDocument(
    val v: Int = 1,
    val albums: List<ZkAlbumRecord> = emptyList()
) {
    fun toJsonString(): String {
        val arr = JSONArray()
        for (a in albums) arr.put(a.toJson())
        return JSONObject()
            .put("v", v)
            .put("albums", arr)
            .toString()
    }

    companion object {
        fun fromJsonString(jsonText: String): ZkAlbumsDocument {
            val obj = JSONObject(jsonText)
            val arr = obj.optJSONArray("albums") ?: JSONArray()
            val list = ArrayList<ZkAlbumRecord>(arr.length())
            for (i in 0 until arr.length()) {
                list.add(ZkAlbumRecord.fromJson(arr.getJSONObject(i)))
            }
            return ZkAlbumsDocument(v = obj.optInt("v", 1), albums = list)
        }
    }
}

data class ZkAlbumsState(
    val document: ZkAlbumsDocument,
    val revision: Int,
    val etag: String?
)

data class ZkShareCreationResult(
    val shareId: String,
    val shareUrlWithFragment: String,
    val expiresAt: Long?,
    val maxDownloads: Int?
)

/**
 * Zero-Knowledge thumbnail cache (FASE 4D):
 * - Disk stores EXCLUSIVELY encrypted ciphertext blobs (`<blobId>_<variant>.enc`) with LRU eviction.
 * - Decrypted plaintext thumbnails live ONLY in a bounded RAM LRU map and are zeroized (`fill(0)`)
 *   on eviction, lock, background (`onStop`), and logout.
 */
class EncryptedThumbDiskCache(
    private val diskDir: File,
    private val maxDiskBytes: Long = 50L * 1024L * 1024L,
    private val maxRamBytes: Long = 16L * 1024L * 1024L
) {
    private val ramLock = Any()
    private val ramLru = LinkedHashMap<String, ByteArray>(32, 0.75f, true)
    private var currentRamBytes: Long = 0L

    private fun cacheKey(blobId: String, variant: String): String = "${blobId.lowercase()}_$variant"

    private fun diskFile(blobId: String, variant: String): File {
        return File(diskDir, "${cacheKey(blobId, variant)}.enc")
    }

    fun getDecryptedFromRam(blobId: String, variant: String): ByteArray? {
        val key = cacheKey(blobId, variant)
        synchronized(ramLock) {
            return ramLru[key]?.copyOf()
        }
    }

    fun putDecryptedInRam(blobId: String, variant: String, plaintextBytes: ByteArray) {
        if (plaintextBytes.size.toLong() > maxRamBytes) return
        val key = cacheKey(blobId, variant)
        synchronized(ramLock) {
            ramLru.remove(key)?.let { old ->
                currentRamBytes -= old.size
                old.zeroize()
            }
            ramLru[key] = plaintextBytes.copyOf()
            currentRamBytes += plaintextBytes.size
            val iter = ramLru.entries.iterator()
            while (currentRamBytes > maxRamBytes && iter.hasNext()) {
                val eldest = iter.next()
                currentRamBytes -= eldest.value.size
                eldest.value.zeroize()
                iter.remove()
            }
        }
    }

    fun getEncryptedFromDisk(blobId: String, variant: String): ByteArray? {
        val f = diskFile(blobId, variant)
        if (!f.exists() || !f.isFile) return null
        f.setLastModified(System.currentTimeMillis())
        return try {
            f.readBytes()
        } catch (_: Throwable) {
            null
        }
    }

    fun putEncryptedOnDisk(blobId: String, variant: String, encryptedBytes: ByteArray) {
        if (!diskDir.exists()) diskDir.mkdirs()
        val f = diskFile(blobId, variant)
        val tmp = File(diskDir, "${f.name}.tmp")
        try {
            FileOutputStream(tmp).use { it.write(encryptedBytes) }
            if (!tmp.renameTo(f)) {
                tmp.copyTo(f, overwrite = true)
                tmp.delete()
            }
            evictDiskLruIfNeeded()
        } catch (_: Throwable) {
            tmp.delete()
        }
    }

    private fun evictDiskLruIfNeeded() {
        val files = diskDir.listFiles()?.filter { it.isFile && it.name.endsWith(".enc") } ?: return
        val entries = files.map { Triple(it.name, it.length(), it.lastModified()) }
        val toDelete = AutoBackupLogic.planLruEvictions(entries, maxDiskBytes)
        for (name in toDelete) {
            File(diskDir, name).delete()
        }
    }

    fun clearRamCache() {
        synchronized(ramLock) {
            for (buf in ramLru.values) {
                buf.zeroize()
            }
            ramLru.clear()
            currentRamBytes = 0L
        }
    }

    fun clearAll() {
        clearRamCache()
        if (diskDir.exists() && diskDir.isDirectory) {
            diskDir.listFiles()?.forEach { it.delete() }
        }
    }
}

/**
 * Pure Kotlin random-access encrypted video/media reader (FASE 4D):
 * - Fetches the 86-byte `PCZK v1` header via HTTP Range `bytes=0-85`.
 * - Fetches ONLY the encrypted chunks covering the requested plaintext offset using Range 206.
 * - Caches at most [maxCachedChunks] (default 4) decrypted chunks in RAM LRU; evicted chunks are zeroized.
 * - Zero temp files ever written to disk.
 */
class ZkChunkedRangeReader(
    private val apiClient: PhotoCloudZkApiClientV2,
    private val blobId: String,
    fkWrapKey: ByteArray,
    private val maxCachedChunks: Int = 4,
    private val cryptoProvider: ZkCryptoProvider = JvmCryptoProvider
) : Closeable {

    private val fkWrapKeyCopy: ByteArray = fkWrapKey.copyOf()
    private val chunkCache = LinkedHashMap<Int, ByteArray>(maxCachedChunks + 1, 0.75f, true)

    @Volatile
    private var initialized: Boolean = false

    @Volatile
    private var closed: Boolean = false

    private var header: ZkCoreCrypto.ParsedPczkHeader? = null
    private var totalCiphertextBytes: Long = 0L
    private var totalPlaintextBytes: Long = 0L
    private var fileKey: ByteArray? = null

    suspend fun ensureInitialized() {
        if (initialized) return
        synchronized(this) {
            if (initialized) return
        }
        val headerResp = apiClient.downloadBlobRange(blobId, 0L, (ZkCoreCrypto.PCZK_HEADER_LENGTH - 1).toLong())
        val parsed = ZkCoreCrypto.parsePczkHeader(headerResp.bytes)
        if (!parsed.blobId.equals(blobId, ignoreCase = true)) {
            throw ZkCryptoException(ZkErrorCode.WRONG_KEY_OR_PASSPHRASE, "Header blobId mismatch in Range reader.")
        }
        val fk = ZkCoreCrypto.unwrapFileKeyBytes(fkWrapKeyCopy, parsed.wrappedFk, parsed.blobIdBytes, cryptoProvider)
        val totalCt = headerResp.totalBytes
        val ptTotal = if (totalCt <= ZkCoreCrypto.PCZK_MIN_BLOB_LENGTH.toLong()) {
            0L
        } else {
            ZkCoreCrypto.computeBlobRangePlan(totalCt, parsed.chunkSizeLog2, 0L, 0L).totalPlaintextBytes
        }
        synchronized(this) {
            if (!closed) {
                header = parsed
                totalCiphertextBytes = totalCt
                totalPlaintextBytes = ptTotal
                fileKey = fk
                initialized = true
            } else {
                fk.zeroize()
            }
        }
    }

    suspend fun getTotalPlaintextSize(): Long {
        ensureInitialized()
        return totalPlaintextBytes
    }

    suspend fun readAt(position: Long, buffer: ByteArray, offset: Int, size: Int): Int {
        if (closed) throw IOException("ZkChunkedRangeReader closed.")
        ensureInitialized()
        if (size <= 0) return 0
        if (position >= totalPlaintextBytes) return -1

        val hdr = header!!
        val fk = fileKey!!
        val available = min(size.toLong(), totalPlaintextBytes - position).toInt()
        var copied = 0
        var curPos = position

        while (copied < available) {
            val chunkIdx = (curPos / hdr.chunkPlaintextSize).toInt()
            val offsetInChunk = (curPos % hdr.chunkPlaintextSize).toInt()
            val chunkPt = loadOrFetchChunk(hdr, fk, chunkIdx)
            val take = min(available - copied, chunkPt.size - offsetInChunk)
            if (take <= 0) break
            System.arraycopy(chunkPt, offsetInChunk, buffer, offset + copied, take)
            copied += take
            curPos += take
        }
        return if (copied == 0) -1 else copied
    }

    private suspend fun loadOrFetchChunk(
        hdr: ZkCoreCrypto.ParsedPczkHeader,
        fk: ByteArray,
        chunkIdx: Int
    ): ByteArray {
        synchronized(chunkCache) {
            chunkCache[chunkIdx]?.let { return it }
        }

        val chunkPtStart = chunkIdx.toLong() * hdr.chunkPlaintextSize.toLong()
        val chunkPtEnd = min(totalPlaintextBytes - 1L, chunkPtStart + hdr.chunkPlaintextSize.toLong() - 1L)
        val plan = ZkCoreCrypto.computeBlobRangePlan(
            totalCiphertextBytes = totalCiphertextBytes,
            chunkSizeLog2 = hdr.chunkSizeLog2,
            startPlaintextByte = chunkPtStart,
            endPlaintextByteInclusive = chunkPtEnd
        )
        val rangeResp = apiClient.downloadBlobRange(
            blobId = blobId,
            startByte = plan.ciphertextStartByte,
            endByteInclusive = plan.ciphertextEndByteInclusive
        )
        val decryptedChunk = ZkCoreCrypto.decryptBlobRange(
            headerBytes = hdr.rawHeader,
            totalCiphertextBytes = totalCiphertextBytes,
            startPlaintextByte = chunkPtStart,
            endPlaintextByteInclusive = chunkPtEnd,
            ciphertextSlice = rangeResp.bytes,
            unwrappedFileKey = fk,
            expectedBlobId = blobId,
            cryptoProvider = cryptoProvider
        )

        synchronized(chunkCache) {
            if (closed) {
                decryptedChunk.zeroize()
                throw IOException("ZkChunkedRangeReader closed during read.")
            }
            chunkCache[chunkIdx] = decryptedChunk
            val iter = chunkCache.entries.iterator()
            while (chunkCache.size > maxCachedChunks && iter.hasNext()) {
                val eldest = iter.next()
                eldest.value.zeroize()
                iter.remove()
            }
        }
        return decryptedChunk
    }

    override fun close() {
        closed = true
        synchronized(chunkCache) {
            for (buf in chunkCache.values) {
                buf.zeroize()
            }
            chunkCache.clear()
        }
        fileKey?.zeroize()
        fileKey = null
        fkWrapKeyCopy.zeroize()
    }
}

/**
 * Android `MediaDataSource` adapter streaming encrypted `PCZK v1` video directly to `MediaPlayer`
 * without ever writing plaintext video bytes to disk.
 */
class ZkAndroidMediaDataSource(
    private val reader: ZkChunkedRangeReader
) : MediaDataSource() {

    override fun getSize(): Long = runBlocking(Dispatchers.IO) {
        reader.getTotalPlaintextSize()
    }

    override fun readAt(position: Long, buffer: ByteArray, offset: Int, size: Int): Int {
        return runBlocking(Dispatchers.IO) {
            reader.readAt(position, buffer, offset, size)
        }
    }

    override fun close() {
        reader.close()
    }
}

/**
 * Secure "Apri con..." temporary file helper (FASE 4D):
 * - Stores decrypted export files strictly inside `cacheDir/zk_external_share/`.
 * - Deterministically overwrites every file with zero bytes (`0x00`) and syncs before deleting.
 * - Swept on app startup, lock, background (`onStop`), and logout.
 */
class ZkExternalOpenHelper(cacheDir: File) {
    val shareDir: File = File(cacheDir, "zk_external_share")

    fun createTargetFile(displayName: String): File {
        if (!shareDir.exists()) shareDir.mkdirs()
        val safeName = displayName.replace(Regex("[^a-zA-Z0-9._-]"), "_").take(80).ifBlank { "item" }
        return File(shareDir, "${UUID.randomUUID().toString().take(8)}_$safeName")
    }

    fun secureWipeFile(file: File): Boolean {
        if (!file.exists() || !file.isFile) return false
        try {
            val len = file.length()
            if (len > 0L) {
                RandomAccessFile(file, "rw").use { raf ->
                    val zeros = ByteArray(min(65536L, len).toInt())
                    var remaining = len
                    raf.seek(0L)
                    while (remaining > 0L) {
                        val step = min(zeros.size.toLong(), remaining).toInt()
                        raf.write(zeros, 0, step)
                        remaining -= step
                    }
                    raf.fd.sync()
                }
            }
        } catch (_: Throwable) {
        }
        return file.delete()
    }

    fun wipeAllExternalShareFiles(): Int {
        if (!shareDir.exists() || !shareDir.isDirectory) return 0
        var wiped = 0
        val children = shareDir.listFiles() ?: return 0
        for (child in children) {
            if (child.isFile) {
                if (secureWipeFile(child)) wiped++
            } else if (child.isDirectory) {
                child.walkBottomUp().forEach { f ->
                    if (f.isFile) {
                        if (secureWipeFile(f)) wiped++
                    } else {
                        f.delete()
                    }
                }
            }
        }
        return wiped
    }
}

/**
 * Complete Phase 4D Zero-Knowledge Vault Repository:
 * - E2EE Gallery items + RAM-only decrypted thumbnails (`EncryptedThumbDiskCache`)
 * - Full-resolution streaming decryption & zero-disk-temp Range video reader
 * - Encrypted Albums CRUD with optimistic concurrency (`ETag` / `If-Match`)
 * - Trash / Restore / Permanent Delete / Empty Trash / Stats
 * - Zero-Knowledge Share Link generation (`/v2/s/<shareId>#<base64url(shareKey)>`) where `shareKey`
 *   never leaves the client
 */
class ZkVaultRepository(
    val apiClient: PhotoCloudZkApiClientV2,
    val sessionManager: ZkSessionManager,
    val thumbCache: EncryptedThumbDiskCache,
    val externalOpenHelper: ZkExternalOpenHelper? = null,
    private val cryptoProvider: ZkCryptoProvider = JvmCryptoProvider
) {
    private fun requireSubkeys(): ZkCoreCrypto.VaultSubkeys {
        return sessionManager.getSubkeysOrNull()
            ?: throw IllegalStateException("Vault bloccato: sblocca la sessione v2.")
    }

    private fun requireUserId(): String {
        return sessionManager.getUserId()
            ?: throw IllegalStateException("Identificativo utente non disponibile.")
    }

    suspend fun listDecryptedItems(
        state: String = "active",
        limit: Int = 200
    ): List<DecryptedZkItem> = withContext(Dispatchers.IO) {
        val subkeys = requireSubkeys()
        val serverItems = apiClient.listItems(state = state, limit = limit)
        val decrypted = ArrayList<DecryptedZkItem>(serverItems.size)
        for (srv in serverItems) {
            try {
                val encBytes = ZkCoreCrypto.fromBase64Url(srv.encMetaB64u)
                val jsonText = ZkCoreCrypto.decryptMeta(
                    metaKey = subkeys.metaKey,
                    blobId = srv.blobId,
                    encryptedMeta = encBytes,
                    cryptoProvider = cryptoProvider
                )
                val meta = ZkBlobPlaintextMeta.fromJsonString(jsonText)
                decrypted.add(DecryptedZkItem(serverItem = srv, meta = meta))
            } catch (_: Throwable) {
                // Skip corrupted/unauthenticated metadata without crashing the gallery
            }
        }
        decrypted.sortedByDescending { it.meta.takenAt ?: it.meta.createdAt }
    }

    suspend fun getDecryptedThumbnail(
        blobId: String,
        variant: String = "320"
    ): ByteArray? = withContext(Dispatchers.IO) {
        val subkeys = requireSubkeys()
        thumbCache.getDecryptedFromRam(blobId, variant)?.let { return@withContext it }

        val encrypted = thumbCache.getEncryptedFromDisk(blobId, variant)
            ?: apiClient.downloadEncryptedThumbnail(blobId, variant)?.also { fetched ->
                thumbCache.putEncryptedOnDisk(blobId, variant, fetched)
            }
            ?: return@withContext null

        val plaintext = ZkCoreCrypto.decryptThumbnail(
            thumbKey = subkeys.thumbKey,
            blobId = blobId,
            variant = variant,
            encryptedThumb = encrypted,
            cryptoProvider = cryptoProvider
        )
        thumbCache.putDecryptedInRam(blobId, variant, plaintext)
        plaintext
    }

    suspend fun decryptBlobToBytes(blobId: String): ByteArray = withContext(Dispatchers.IO) {
        val subkeys = requireSubkeys()
        val ciphertext = apiClient.downloadBlobBytes(blobId)
        val out = ByteArrayOutputStream()
        ZkCoreCrypto.decryptBlobStream(
            input = ciphertext.inputStream(),
            output = out,
            fkWrapKey = subkeys.fkWrapKey,
            expectedBlobId = blobId,
            cryptoProvider = cryptoProvider
        )
        out.toByteArray()
    }

    suspend fun decryptBlobToFile(
        blobId: String,
        targetFile: File
    ): Long = withContext(Dispatchers.IO) {
        val subkeys = requireSubkeys()
        val ctTmp = File(targetFile.parentFile, "${targetFile.name}.ct.tmp")
        try {
            FileOutputStream(ctTmp).use { ctOut ->
                apiClient.downloadBlobToStream(blobId, ctOut)
            }
            ctTmp.inputStream().use { ctIn ->
                FileOutputStream(targetFile).use { ptOut ->
                    ZkCoreCrypto.decryptBlobStream(
                        input = ctIn,
                        output = ptOut,
                        fkWrapKey = subkeys.fkWrapKey,
                        expectedBlobId = blobId,
                        cryptoProvider = cryptoProvider
                    ).totalPlaintextBytes
                }
            }
        } catch (t: Throwable) {
            externalOpenHelper?.secureWipeFile(targetFile) ?: targetFile.delete()
            throw t
        } finally {
            ctTmp.delete()
        }
    }

    fun openStreamingRangeReader(blobId: String, maxCachedChunks: Int = 4): ZkChunkedRangeReader {
        val subkeys = requireSubkeys()
        return ZkChunkedRangeReader(
            apiClient = apiClient,
            blobId = blobId,
            fkWrapKey = subkeys.fkWrapKey,
            maxCachedChunks = maxCachedChunks,
            cryptoProvider = cryptoProvider
        )
    }

    suspend fun updateItemMeta(
        item: DecryptedZkItem,
        updatedMeta: ZkBlobPlaintextMeta
    ): DecryptedZkItem = withContext(Dispatchers.IO) {
        val subkeys = requireSubkeys()
        val encBytes = ZkCoreCrypto.encryptMeta(
            metaKey = subkeys.metaKey,
            blobId = item.blobId,
            plaintextJson = updatedMeta.toJsonString(),
            cryptoProvider = cryptoProvider
        )
        val updatedServer = apiClient.updateItemMeta(
            itemId = item.id,
            encMetaB64u = ZkCoreCrypto.toBase64Url(encBytes),
            expectedVersion = item.serverItem.version
        )
        DecryptedZkItem(serverItem = updatedServer, meta = updatedMeta)
    }

    suspend fun toggleFavorite(item: DecryptedZkItem): DecryptedZkItem {
        return updateItemMeta(item, item.meta.copy(isFavorite = !item.meta.isFavorite))
    }

    suspend fun renameItem(item: DecryptedZkItem, newName: String): DecryptedZkItem {
        return updateItemMeta(item, item.meta.copy(name = newName.trim().ifBlank { item.meta.name }))
    }

    suspend fun moveToTrash(itemIds: List<String>) {
        apiClient.moveToTrash(itemIds)
    }

    suspend fun restoreFromTrash(itemIds: List<String>) {
        apiClient.restoreFromTrash(itemIds)
    }

    suspend fun deleteItemPermanently(itemId: String) {
        apiClient.deleteItemPermanently(itemId)
    }

    suspend fun emptyTrash() {
        apiClient.emptyTrash()
    }

    suspend fun fetchStats(): V2StatsResponse {
        return apiClient.fetchStats()
    }

    suspend fun loadAlbums(): ZkAlbumsState = withContext(Dispatchers.IO) {
        val subkeys = requireSubkeys()
        val userId = requireUserId()
        val raw = apiClient.fetchEncryptedAlbums()
            ?: return@withContext ZkAlbumsState(ZkAlbumsDocument(), revision = 0, etag = null)
        val (rev, jsonText) = ZkCoreCrypto.decryptAlbums(
            metaKey = subkeys.metaKey,
            userId = userId,
            encryptedPayload = raw.bytes,
            cryptoProvider = cryptoProvider
        )
        ZkAlbumsState(
            document = ZkAlbumsDocument.fromJsonString(jsonText),
            revision = rev,
            etag = raw.etag
        )
    }

    suspend fun saveAlbums(
        document: ZkAlbumsDocument,
        currentRevision: Int,
        ifMatchEtag: String?
    ): ZkAlbumsState = withContext(Dispatchers.IO) {
        val subkeys = requireSubkeys()
        val userId = requireUserId()
        val nextRev = (currentRevision + 1).coerceAtLeast(1)
        val encrypted = ZkCoreCrypto.encryptAlbums(
            metaKey = subkeys.metaKey,
            userId = userId,
            plaintextJson = document.toJsonString(),
            revision = nextRev,
            cryptoProvider = cryptoProvider
        )
        val putResp = apiClient.putEncryptedAlbums(encrypted, ifMatchEtag = ifMatchEtag)
        ZkAlbumsState(document = document, revision = nextRev, etag = putResp.etag)
    }

    /**
     * Creates a Zero-Knowledge public share link `/v2/s/<shareId>#<base64url(shareKey)>`.
     *
     * Security invariant:
     * - `shareKey` is generated locally (32 random bytes) and placed ONLY in the URL `#fragment`.
     * - `shareKey` is NEVER sent in any HTTP URL, header, or body.
     * - Each item's `FK` is unwrapped locally from the 86-byte `PCZK` header and re-wrapped for `shareKey`.
     */
    suspend fun createZeroKnowledgeShare(
        items: List<DecryptedZkItem>,
        title: String,
        expiresAtMs: Long? = null,
        maxDownloads: Int? = null
    ): ZkShareCreationResult = withContext(Dispatchers.IO) {
        require(items.isNotEmpty()) { "Seleziona almeno un elemento da condividere." }
        val subkeys = requireSubkeys()
        val shareId = UUID.randomUUID().toString().lowercase()
        val shareKey = cryptoProvider.randomBytes(32)
        try {
            val shareItems = ArrayList<V2ShareItemInput>(items.size)
            val manifestItemsArr = JSONArray()

            for (item in items) {
                val hdrResp = apiClient.downloadBlobRange(
                    blobId = item.blobId,
                    startByte = 0L,
                    endByteInclusive = (ZkCoreCrypto.PCZK_HEADER_LENGTH - 1).toLong()
                )
                val parsed = ZkCoreCrypto.parsePczkHeader(hdrResp.bytes)
                val fk = ZkCoreCrypto.unwrapFileKeyBytes(
                    fkWrapKey = subkeys.fkWrapKey,
                    wrappedFk = parsed.wrappedFk,
                    blobIdBytes = parsed.blobIdBytes,
                    cryptoProvider = cryptoProvider
                )
                try {
                    val shareWrappedFk = ZkCoreCrypto.wrapFileKeyForShare(
                        shareKey = shareKey,
                        fileKey = fk,
                        shareId = shareId,
                        blobId = item.blobId,
                        cryptoProvider = cryptoProvider
                    )
                    val encItemMeta = ZkCoreCrypto.encryptShareItemMeta(
                        shareKey = shareKey,
                        shareId = shareId,
                        blobId = item.blobId,
                        plaintextJson = item.meta.toJsonString(),
                        cryptoProvider = cryptoProvider
                    )
                    shareItems.add(
                        V2ShareItemInput(
                            blobId = item.blobId,
                            wrappedFkB64u = ZkCoreCrypto.toBase64Url(shareWrappedFk),
                            encItemMetaB64u = ZkCoreCrypto.toBase64Url(encItemMeta)
                        )
                    )
                    manifestItemsArr.put(item.blobId.lowercase())
                } finally {
                    fk.zeroize()
                }
            }

            val manifestJson = JSONObject()
                .put("v", 1)
                .put("title", title.ifBlank { "Condivisione PhotoCloud" })
                .put("createdAt", System.currentTimeMillis())
                .put("blobIds", manifestItemsArr)
                .toString()

            val encManifest = ZkCoreCrypto.encryptShareManifest(
                shareKey = shareKey,
                shareId = shareId,
                plaintextJson = manifestJson,
                cryptoProvider = cryptoProvider
            )

            val resp = apiClient.createShare(
                shareId = shareId,
                items = shareItems,
                shareManifestB64u = ZkCoreCrypto.toBase64Url(encManifest),
                expiresAt = expiresAtMs,
                maxDownloads = maxDownloads
            )

            val shareKeyB64u = ZkCoreCrypto.toBase64Url(shareKey)
            val base = apiClient.baseUrl.trim().removeSuffix("/")
            ZkShareCreationResult(
                shareId = resp.shareId,
                shareUrlWithFragment = "$base/v2/s/${resp.shareId}#$shareKeyB64u",
                expiresAt = resp.expiresAt,
                maxDownloads = resp.maxDownloads
            )
        } finally {
            shareKey.zeroize()
        }
    }

    fun onLockOrBackground() {
        thumbCache.clearRamCache()
        externalOpenHelper?.wipeAllExternalShareFiles()
    }

    fun onLogout() {
        thumbCache.clearAll()
        externalOpenHelper?.wipeAllExternalShareFiles()
    }
}
