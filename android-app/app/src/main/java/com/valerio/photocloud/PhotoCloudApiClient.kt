package com.valerio.photocloud

import android.content.ContentValues
import android.content.Context
import android.content.Intent
import android.graphics.Bitmap
import android.graphics.BitmapFactory
import android.media.MediaMetadataRetriever
import android.net.Uri
import android.os.Build
import android.os.Environment
import android.provider.DocumentsContract
import android.provider.MediaStore
import android.provider.OpenableColumns
import android.util.LruCache
import android.webkit.MimeTypeMap
import androidx.core.content.FileProvider
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.async
import kotlinx.coroutines.awaitAll
import kotlinx.coroutines.coroutineScope
import kotlinx.coroutines.delay
import kotlinx.coroutines.sync.Semaphore
import kotlinx.coroutines.sync.withPermit
import kotlinx.coroutines.withContext
import okhttp3.Call
import okhttp3.Cookie
import okhttp3.CookieJar
import okhttp3.Dispatcher
import okhttp3.FormBody
import okhttp3.HttpUrl
import okhttp3.MediaType
import okhttp3.MediaType.Companion.toMediaTypeOrNull
import okhttp3.MultipartBody
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.RequestBody
import okhttp3.RequestBody.Companion.toRequestBody
import okio.Buffer
import okio.BufferedSink
import okio.ForwardingSink
import okio.buffer
import org.json.JSONArray
import org.json.JSONObject
import java.io.BufferedOutputStream
import java.io.ByteArrayInputStream
import java.io.File
import java.io.FileInputStream
import java.io.FileOutputStream
import java.io.IOException
import java.io.InputStream
import java.net.URLDecoder
import java.net.URLEncoder
import java.util.Collections
import java.util.Locale
import java.util.concurrent.ConcurrentHashMap
import java.util.concurrent.TimeUnit
import java.util.concurrent.atomic.AtomicBoolean
import java.util.concurrent.atomic.AtomicInteger
import java.util.concurrent.atomic.AtomicLong
import java.util.concurrent.atomic.AtomicReference
import java.util.zip.ZipEntry
import java.util.zip.ZipInputStream
import java.util.zip.ZipOutputStream
import kotlin.math.max

enum class TransferStatus {
    RUNNING,
    PAUSED,
    COMPLETED,
    ERROR,
    CANCELLED
}

enum class TransferPackagingMode(val storageKey: String, val label: String, val description: String) {
    ASK_ALWAYS(
        "ask_always",
        "Chiedi all'inizio di ogni trasferimento",
        "Mostra una finestra di scelta rapida tra file diretti in memoria o archivio unico .zip"
    ),
    DIRECT_FILES(
        "direct_files",
        "Direttamente nella memoria (File singoli)",
        "Trasferisce ogni foto, video o file singolarmente nella rispettiva cartella"
    ),
    ZIP_ARCHIVE(
        "zip_archive",
        "Archiviandoli in un pacchetto (.zip)",
        "Raggruppa tutti gli elementi selezionati in un singolo archivio compresso .zip"
    );

    companion object {
        fun fromKey(key: String?): TransferPackagingMode {
            return entries.firstOrNull { it.storageKey.equals(key, ignoreCase = true) } ?: ASK_ALWAYS
        }
    }
}

enum class DownloadDirectoryMode(
    val storageKey: String,
    val label: String,
    val defaultRelPath: String,
    val description: String = defaultRelPath
) {
    AUTO_BY_TYPE(
        "auto_by_type",
        "Default automatico in base al tipo",
        "Auto (Foto → Immagini, Video → Film, Audio → Musica, File → Download)",
        "Foto in Immagini, Video in Film, Audio in Musica e File in Download"
    ),
    PICTURES(
        "pictures",
        "Immagini (Pictures/PhotoCloud)",
        "Pictures/PhotoCloud",
        "Salva nella cartella Immagini del dispositivo (Pictures/PhotoCloud)"
    ),
    MOVIES(
        "movies",
        "Video (Movies/PhotoCloud)",
        "Movies/PhotoCloud",
        "Salva nella cartella Video del dispositivo (Movies/PhotoCloud)"
    ),
    MUSIC(
        "music",
        "Musica (Music/PhotoCloud)",
        "Music/PhotoCloud",
        "Salva nella cartella Musica del dispositivo (Music/PhotoCloud)"
    ),
    DOCUMENTS(
        "documents",
        "Documenti (Documents/PhotoCloud)",
        "Documents/PhotoCloud",
        "Salva nella cartella Documenti del dispositivo (Documents/PhotoCloud)"
    ),
    DOWNLOADS(
        "downloads",
        "Download (Download/PhotoCloud)",
        "Download/PhotoCloud",
        "Salva nella cartella Download del dispositivo (Download/PhotoCloud)"
    ),
    CUSTOM_FOLDER(
        "custom_folder",
        "Cartella personalizzata",
        "Download/PhotoCloud",
        "Usa la cartella o sottocartella personalizzata scelta dall'utente"
    );

    companion object {
        fun fromKey(key: String?): DownloadDirectoryMode {
            return entries.firstOrNull { it.storageKey.equals(key, ignoreCase = true) } ?: AUTO_BY_TYPE
        }
    }
}

class TransferControlHandle(val opId: String) {
    val isPaused = AtomicBoolean(false)
    val isCancelled = AtomicBoolean(false)
    private val activeCalls = Collections.synchronizedSet(HashSet<Call>())

    fun registerCall(call: Call) {
        if (isCancelled.get()) {
            try {
                call.cancel()
            } catch (_: Exception) {
            }
        } else {
            activeCalls.add(call)
        }
    }

    fun unregisterCall(call: Call) {
        activeCalls.remove(call)
    }

    fun cancelAll() {
        isCancelled.set(true)
        isPaused.set(false)
        val snapshot = synchronized(activeCalls) { activeCalls.toList() }
        activeCalls.clear()
        for (c in snapshot) {
            try {
                c.cancel()
            } catch (_: Exception) {
            }
        }
    }

    fun awaitIfPausedBlocking() {
        while (isPaused.get() && !isCancelled.get()) {
            try {
                Thread.sleep(100L)
            } catch (_: InterruptedException) {
                break
            }
        }
        if (isCancelled.get()) {
            throw IOException("Trasferimento annullato")
        }
    }

    suspend fun awaitIfPausedSuspend() {
        while (isPaused.get() && !isCancelled.get()) {
            delay(120L)
        }
        if (isCancelled.get()) {
            throw IOException("Trasferimento annullato")
        }
    }
}

data class FileViewerSpecModel(
    val extension: String,
    val mimeType: String,
    val viewerType: String,
    val canOpenInApp: Boolean,
    val label: String
)

data class DocBlockModel(
    val type: String,
    val text: String,
    val level: Int = 1
)

data class DocSheetModel(
    val name: String,
    val headers: List<String>,
    val rows: List<List<String>>,
    val totalRows: Int
)

data class DocSlideModel(
    val index: Int,
    val title: String,
    val bullets: List<String>,
    val notes: String = ""
)

data class DocumentPreviewModel(
    val filename: String,
    val extension: String,
    val mimeType: String,
    val viewerType: String,
    val canOpenInApp: Boolean,
    val sizeBytes: Long,
    val title: String,
    val pageCount: Int = 1,
    val blocks: List<DocBlockModel> = emptyList(),
    val sheets: List<DocSheetModel> = emptyList(),
    val slides: List<DocSlideModel> = emptyList(),
    val rawText: String = "",
    val warnings: List<String> = emptyList()
)

data class TransferOperation(
    val id: String,
    val title: String,
    val isUpload: Boolean,
    val transferredBytes: Long,
    val totalBytes: Long,
    val speedBytesPerSec: Long,
    val status: TransferStatus,
    val detail: String = "",
    val updatedAtMs: Long = System.currentTimeMillis()
) {
    val progressFraction: Float
        get() = if (totalBytes > 0L) {
            (transferredBytes.toFloat() / totalBytes.toFloat()).coerceIn(0f, 1f)
        } else {
            if (status == TransferStatus.COMPLETED) 1f else 0f
        }

    val percentInt: Int
        get() = (progressFraction * 100f).toInt().coerceIn(0, 100)
}

data class MediaItemModel(
    val filename: String,
    val timestamp: Double,
    val size: Long = 0L,
    val isMedia: Boolean = detectIsMediaFilename(filename),
    val category: String = detectFileCategory(filename),
    val album: String = ""
) {
    val isVideo: Boolean
        get() = detectIsVideoFilename(filename)

    val extensionBadge: String
        get() {
            val ext = filename.substringAfterLast('.', "").uppercase(Locale.ROOT)
            return if (ext.isNotBlank() && ext.length <= 6) ext else "FILE"
        }

    companion object {
        private val MEDIA_EXTENSIONS = setOf(
            "jpg", "jpeg", "png", "gif", "webp", "bmp", "heic", "heif", "avif",
            "mp4", "mov", "webm", "mkv", "avi"
        )
        private val DOCUMENT_EXTENSIONS = setOf(
            "pdf", "doc", "docx", "xls", "xlsx", "ppt", "pptx", "odt", "ods", "odp", "txt", "rtf", "csv", "md", "epub"
        )
        private val ARCHIVE_EXTENSIONS = setOf(
            "zip", "rar", "7z", "tar", "gz", "bz2", "xz", "apk", "aab", "iso", "dmg", "exe", "msi", "deb", "rpm"
        )
        private val AUDIO_EXTENSIONS = setOf(
            "mp3", "wav", "flac", "aac", "ogg", "m4a", "opus", "wma"
        )
        private val CODE_EXTENSIONS = setOf(
            "json", "xml", "yaml", "yml", "html", "css", "js", "ts", "tsx", "jsx", "py", "kt", "java", "c", "cpp", "h", "sh", "sql", "ini", "conf", "log"
        )

        fun detectIsMediaFilename(name: String): Boolean {
            val ext = name.substringAfterLast('.', "").lowercase(Locale.ROOT)
            return ext in MEDIA_EXTENSIONS
        }

        fun detectIsVideoFilename(name: String): Boolean {
            val lower = name.lowercase(Locale.ROOT)
            return lower.endsWith(".mp4") || lower.endsWith(".mov") || lower.endsWith(".webm") ||
                lower.endsWith(".mkv") || lower.endsWith(".avi")
        }

        fun detectIsImageFilename(name: String): Boolean {
            val ext = name.substringAfterLast('.', "").lowercase(Locale.ROOT)
            return ext in setOf("jpg", "jpeg", "png", "gif", "webp", "bmp", "heic", "heif", "avif", "svg")
        }

        fun detectIsAudioFilename(name: String): Boolean {
            val ext = name.substringAfterLast('.', "").lowercase(Locale.ROOT)
            return ext in AUDIO_EXTENSIONS
        }

        fun detectFileCategory(name: String): String {
            val ext = name.substringAfterLast('.', "").lowercase(Locale.ROOT)
            return when {
                ext in MEDIA_EXTENSIONS -> "media"
                ext in DOCUMENT_EXTENSIONS -> "document"
                ext in ARCHIVE_EXTENSIONS -> "archive"
                ext in AUDIO_EXTENSIONS -> "audio"
                ext in CODE_EXTENSIONS -> "code"
                else -> "other"
            }
        }
    }
}

/**
 * Zero-allocation streaming RequestBody wrapper that reports live upload progress and bytes written
 * directly over the underlying BufferedSink without buffering files in RAM, while honoring pause/cancel.
 */
class ProgressRequestBody(
    private val delegate: RequestBody,
    private val controlHandle: TransferControlHandle? = null,
    private val onBytesWritten: (written: Long, total: Long) -> Unit
) : RequestBody() {
    override fun contentType(): MediaType? = delegate.contentType()

    override fun contentLength(): Long = try {
        delegate.contentLength()
    } catch (_: Exception) {
        -1L
    }

    override fun writeTo(sink: BufferedSink) {
        val total = contentLength()
        var uploaded = 0L
        val countingSink = object : ForwardingSink(sink) {
            override fun write(source: Buffer, byteCount: Long) {
                controlHandle?.awaitIfPausedBlocking()
                super.write(source, byteCount)
                uploaded += byteCount
                onBytesWritten(uploaded, if (total > 0L) total else uploaded)
            }
        }
        val bufferedCountingSink = countingSink.buffer()
        delegate.writeTo(bufferedCountingSink)
        bufferedCountingSink.flush()
    }
}

/**
 * Streams a content:// or file:// Uri directly from ContentResolver in 32 KB chunks on demand.
 * Never loads the entire photo/video into a heap ByteArray, eliminating OutOfMemoryError
 * even when selecting 250, 500, or 1,000+ photos at once.
 */
class UriStreamingRequestBody(
    private val context: Context,
    private val uri: Uri,
    private val mediaType: MediaType?,
    private val knownByteSize: Long,
    private val controlHandle: TransferControlHandle? = null
) : RequestBody() {
    override fun contentType(): MediaType? = mediaType

    override fun contentLength(): Long = if (knownByteSize > 0L) knownByteSize else -1L

    override fun writeTo(sink: BufferedSink) {
        val outStream = sink.outputStream()
        val buffer = ByteArray(32 * 1024)
        context.contentResolver.openInputStream(uri)?.use { input ->
            var read: Int
            while (input.read(buffer).also { read = it } != -1) {
                controlHandle?.awaitIfPausedBlocking()
                outStream.write(buffer, 0, read)
            }
        }
        sink.flush()
    }
}

/**
 * Streams a local File (e.g. temporary archive .zip) in 32 KB chunks without loading it into RAM.
 */
class FileStreamingRequestBody(
    private val file: File,
    private val mediaType: MediaType?,
    private val controlHandle: TransferControlHandle? = null
) : RequestBody() {
    override fun contentType(): MediaType? = mediaType

    override fun contentLength(): Long = file.length().coerceAtLeast(0L)

    override fun writeTo(sink: BufferedSink) {
        val outStream = sink.outputStream()
        val buffer = ByteArray(32 * 1024)
        FileInputStream(file).use { input ->
            var read: Int
            while (input.read(buffer).also { read = it } != -1) {
                controlHandle?.awaitIfPausedBlocking()
                outStream.write(buffer, 0, read)
            }
        }
        sink.flush()
    }
}

data class RegisterResult(
    val success: Boolean,
    val filename: String = "",
    val jsonContent: String = "",
    val errorMessage: String = ""
)

sealed class GallerySyncResult {
    data class Authenticated(val items: List<MediaItemModel>) : GallerySyncResult()
    object Unauthenticated : GallerySyncResult()
    object NetworkError : GallerySyncResult()
}

class PhotoCloudApiClient(
    private val context: Context,
    @Volatile var baseUrl: String
) {
    private val cookiePrefs = context.getSharedPreferences("photocloud_cookie_store", Context.MODE_PRIVATE)
    private val metaPrefs = context.getSharedPreferences("photocloud_metadata_cache", Context.MODE_PRIVATE)
    private val diskCacheDir = File(context.cacheDir, "media_cache").apply {
        if (!exists()) mkdirs()
    }

    private val cookieJar = object : CookieJar {
        override fun saveFromResponse(url: HttpUrl, cookies: List<Cookie>) {
            if (cookies.isEmpty()) return
            val hostKey = url.host
            val existing = loadCookieMap(hostKey).toMutableMap()
            for (c in cookies) {
                if (c.value.isBlank() || c.expiresAt < System.currentTimeMillis()) {
                    existing.remove(c.name)
                } else {
                    existing[c.name] = c.value
                }
            }
            saveCookieMap(hostKey, existing)
        }

        override fun loadForRequest(url: HttpUrl): List<Cookie> {
            val map = loadCookieMap(url.host)
            return map.map { (name, value) ->
                Cookie.Builder()
                    .name(name)
                    .value(value)
                    .domain(url.host)
                    .path("/")
                    .build()
            }
        }
    }

    private fun currentHostKey(): String {
        return try {
            Uri.parse(cleanBaseUrl()).host ?: "localhost"
        } catch (_: Exception) {
            "localhost"
        }
    }

    /**
     * Synchronously returns true (0ms) if a session cookie is stored for the current server.
     */
    fun hasActiveSessionCookie(): Boolean {
        val map = loadCookieMap(currentHostKey())
        return map.isNotEmpty()
    }

    fun getCachedGalleryItems(): List<MediaItemModel> {
        val raw = metaPrefs.getString("gallery_${currentHostKey()}", null) ?: return emptyList()
        val albumMap = getCachedFileAlbumsMap()
        return parseCachedJsonList(raw, albumMap)
    }

    fun saveCachedGalleryItems(items: List<MediaItemModel>) {
        metaPrefs.edit().putString("gallery_${currentHostKey()}", serializeJsonList(items)).apply()
    }

    fun getCachedTrashItems(): List<MediaItemModel> {
        val raw = metaPrefs.getString("trash_${currentHostKey()}", null) ?: return emptyList()
        val albumMap = getCachedFileAlbumsMap()
        return parseCachedJsonList(raw, albumMap)
    }

    fun saveCachedTrashItems(items: List<MediaItemModel>) {
        metaPrefs.edit().putString("trash_${currentHostKey()}", serializeJsonList(items)).apply()
    }

    fun getCachedAlbums(): List<String> {
        val raw = metaPrefs.getString("albums_list_${currentHostKey()}", null) ?: return emptyList()
        return try {
            val arr = JSONArray(raw)
            val list = mutableListOf<String>()
            for (i in 0 until arr.length()) {
                val name = arr.optString(i, "").trim()
                if (name.isNotBlank() && name !in list) list.add(name)
            }
            list.sorted()
        } catch (_: Exception) {
            emptyList()
        }
    }

    fun saveCachedAlbums(albums: List<String>) {
        val arr = JSONArray()
        albums.map { it.trim() }.filter { it.isNotBlank() }.distinct().sorted().forEach { arr.put(it) }
        metaPrefs.edit().putString("albums_list_${currentHostKey()}", arr.toString()).apply()
    }

    fun getCachedFileAlbumsMap(): Map<String, String> {
        val raw = metaPrefs.getString("file_albums_${currentHostKey()}", null) ?: return emptyMap()
        return try {
            val obj = JSONObject(raw)
            val map = mutableMapOf<String, String>()
            val keys = obj.keys()
            while (keys.hasNext()) {
                val k = keys.next()
                val v = obj.optString(k, "").trim()
                if (v.isNotBlank()) map[k] = v
            }
            map
        } catch (_: Exception) {
            emptyMap()
        }
    }

    private fun saveCachedFileAlbumsMap(map: Map<String, String>) {
        val obj = JSONObject()
        for ((k, v) in map) {
            if (v.isNotBlank()) obj.put(k, v)
        }
        metaPrefs.edit().putString("file_albums_${currentHostKey()}", obj.toString()).apply()
    }

    private fun serializeJsonList(items: List<MediaItemModel>): String {
        val arr = JSONArray()
        for (item in items) {
            val obj = JSONObject()
            obj.put("filename", item.filename)
            obj.put("timestamp", item.timestamp)
            obj.put("size", item.size)
            obj.put("isMedia", item.isMedia)
            obj.put("category", item.category)
            obj.put("album", item.album)
            arr.put(obj)
        }
        return arr.toString()
    }

    private fun parseCachedJsonList(raw: String, albumOverrides: Map<String, String>): List<MediaItemModel> {
        return try {
            val arr = JSONArray(raw)
            val list = ArrayList<MediaItemModel>(arr.length())
            for (i in 0 until arr.length()) {
                val obj = arr.optJSONObject(i) ?: continue
                val fn = obj.optString("filename", "")
                val ts = obj.optDouble("timestamp", 0.0)
                val sz = obj.optLong("size", 0L)
                val isMed = if (obj.has("isMedia")) obj.optBoolean("isMedia", true) else MediaItemModel.detectIsMediaFilename(fn)
                val cat = obj.optString("category", "").ifBlank { MediaItemModel.detectFileCategory(fn) }
                val alb = albumOverrides[fn] ?: obj.optString("album", "")
                if (fn.isNotBlank()) {
                    list.add(
                        MediaItemModel(
                            filename = fn,
                            timestamp = ts,
                            size = sz,
                            isMedia = isMed,
                            category = cat,
                            album = alb
                        )
                    )
                }
            }
            list
        } catch (_: Exception) {
            emptyList()
        }
    }

    private fun loadCookieMap(host: String): Map<String, String> {
        val raw = cookiePrefs.getString(host, null) ?: return emptyMap()
        return try {
            val obj = JSONObject(raw)
            val result = mutableMapOf<String, String>()
            val keys = obj.keys()
            while (keys.hasNext()) {
                val k = keys.next()
                result[k] = obj.optString(k, "")
            }
            result
        } catch (_: Exception) {
            emptyMap()
        }
    }

    private fun saveCookieMap(host: String, map: Map<String, String>) {
        val obj = JSONObject()
        for ((k, v) in map) {
            obj.put(k, v)
        }
        cookiePrefs.edit().putString(host, obj.toString()).apply()
    }

    fun clearCookies() {
        cookiePrefs.edit().clear().apply()
        metaPrefs.edit().clear().apply()
        clearMediaCache()
    }

    fun clearMediaCache() {
        bitmapCache.evictAll()
        thumbnailCache.evictAll()
        try {
            diskCacheDir.listFiles()?.forEach { it.delete() }
        } catch (_: Exception) {
        }
    }

    fun getDiskCacheStats(): Pair<Int, Long> {
        return try {
            val files = diskCacheDir.listFiles() ?: return Pair(0, 0L)
            var totalBytes = 0L
            for (f in files) {
                if (f.isFile) totalBytes += f.length()
            }
            Pair(files.size, totalBytes)
        } catch (_: Exception) {
            Pair(0, 0L)
        }
    }

    private val appPrefs = context.getSharedPreferences("photocloud_prefs", Context.MODE_PRIVATE)
    private val transferHandles = ConcurrentHashMap<String, TransferControlHandle>()

    fun registerTransferHandle(opId: String): TransferControlHandle {
        val handle = TransferControlHandle(opId)
        transferHandles[opId] = handle
        return handle
    }

    fun unregisterTransferHandle(opId: String) {
        transferHandles.remove(opId)
    }

    fun pauseTransfer(opId: String): Boolean {
        val handle = transferHandles[opId] ?: return false
        if (handle.isCancelled.get()) return false
        handle.isPaused.set(true)
        return true
    }

    fun resumeTransfer(opId: String): Boolean {
        val handle = transferHandles[opId] ?: return false
        if (handle.isCancelled.get()) return false
        handle.isPaused.set(false)
        return true
    }

    fun cancelTransfer(opId: String): Boolean {
        val handle = transferHandles.remove(opId) ?: return false
        handle.cancelAll()
        return true
    }

    fun isTransferPaused(opId: String): Boolean {
        return transferHandles[opId]?.isPaused?.get() == true
    }

    fun getMaxParallelTransfers(): Int {
        return appPrefs.getInt("max_parallel_transfers", 3).coerceIn(1, 16)
    }

    fun setMaxParallelTransfers(value: Int) {
        val clamped = value.coerceIn(1, 16)
        appPrefs.edit().putInt("max_parallel_transfers", clamped).apply()
    }

    fun getDefaultUploadPackagingMode(): TransferPackagingMode {
        return TransferPackagingMode.fromKey(appPrefs.getString("default_upload_packaging_mode", TransferPackagingMode.ASK_ALWAYS.storageKey))
    }

    fun setDefaultUploadPackagingMode(mode: TransferPackagingMode) {
        appPrefs.edit().putString("default_upload_packaging_mode", mode.storageKey).apply()
    }

    fun getDefaultDownloadPackagingMode(): TransferPackagingMode {
        return TransferPackagingMode.fromKey(appPrefs.getString("default_download_packaging_mode", TransferPackagingMode.ASK_ALWAYS.storageKey))
    }

    fun setDefaultDownloadPackagingMode(mode: TransferPackagingMode) {
        appPrefs.edit().putString("default_download_packaging_mode", mode.storageKey).apply()
    }

    fun getDownloadDirectoryMode(): DownloadDirectoryMode {
        return DownloadDirectoryMode.fromKey(appPrefs.getString("download_dir_mode", DownloadDirectoryMode.AUTO_BY_TYPE.storageKey))
    }

    fun setDownloadDirectoryMode(mode: DownloadDirectoryMode) {
        appPrefs.edit().putString("download_dir_mode", mode.storageKey).apply()
    }

    fun getPhotoDownloadDirMode(): DownloadDirectoryMode {
        return DownloadDirectoryMode.fromKey(appPrefs.getString("photo_download_dir_mode", DownloadDirectoryMode.PICTURES.storageKey))
    }

    fun setPhotoDownloadDirMode(mode: DownloadDirectoryMode) {
        appPrefs.edit().putString("photo_download_dir_mode", mode.storageKey).apply()
    }

    fun getVideoDownloadDirMode(): DownloadDirectoryMode {
        return DownloadDirectoryMode.fromKey(appPrefs.getString("video_download_dir_mode", DownloadDirectoryMode.MOVIES.storageKey))
    }

    fun setVideoDownloadDirMode(mode: DownloadDirectoryMode) {
        appPrefs.edit().putString("video_download_dir_mode", mode.storageKey).apply()
    }

    fun getFileDownloadDirMode(): DownloadDirectoryMode {
        return DownloadDirectoryMode.fromKey(appPrefs.getString("file_download_dir_mode", DownloadDirectoryMode.DOWNLOADS.storageKey))
    }

    fun setFileDownloadDirMode(mode: DownloadDirectoryMode) {
        appPrefs.edit().putString("file_download_dir_mode", mode.storageKey).apply()
    }

    fun getCustomDownloadSubfolder(): String {
        val raw = appPrefs.getString("custom_download_subfolder", "PhotoCloud") ?: "PhotoCloud"
        return sanitizeSubfolderName(raw)
    }

    fun setCustomDownloadSubfolder(subfolder: String) {
        appPrefs.edit().putString("custom_download_subfolder", sanitizeSubfolderName(subfolder)).apply()
    }

    fun getCustomSafTreeUri(): String {
        return appPrefs.getString("custom_saf_tree_uri", "") ?: ""
    }

    fun setCustomSafTreeUri(uriStr: String) {
        appPrefs.edit().putString("custom_saf_tree_uri", uriStr.trim()).apply()
    }

    val httpClient: OkHttpClient = OkHttpClient.Builder()
        .dispatcher(
            Dispatcher().apply {
                maxRequests = 64
                maxRequestsPerHost = 16
            }
        )
        .cookieJar(cookieJar)
        .followRedirects(true)
        .followSslRedirects(true)
        .connectTimeout(15, TimeUnit.SECONDS)
        .readTimeout(180, TimeUnit.SECONDS)
        .writeTimeout(180, TimeUnit.SECONDS)
        .build()

    private val noRedirectClient: OkHttpClient = httpClient.newBuilder()
        .followRedirects(false)
        .followSslRedirects(false)
        .build()

    private val maxCacheKb = (Runtime.getRuntime().maxMemory() / 1024 / 5).toInt().coerceAtLeast(24 * 1024)
    private val bitmapCache = object : LruCache<String, Bitmap>(maxCacheKb) {
        override fun sizeOf(key: String, value: Bitmap): Int {
            return value.byteCount / 1024
        }
    }

    // Dedicated RAM cache for compact 380px grid thumbnails (~300KB each -> holds 120+ thumbnails in RAM without eviction)
    private val maxThumbCacheKb = (Runtime.getRuntime().maxMemory() / 1024 / 6).toInt().coerceAtLeast(20 * 1024)
    private val thumbnailCache = object : LruCache<String, Bitmap>(maxThumbCacheKb) {
        override fun sizeOf(key: String, value: Bitmap): Int {
            return value.byteCount / 1024
        }
    }

    private fun diskCacheFile(filename: String, fromTrash: Boolean): File {
        val safeName = filename
            .replace("..", "_")
            .replace(Regex("[^a-zA-Z0-9._-]"), "_")
            .trimStart('.')
            .take(180)
            .ifBlank { "file" }
        val prefix = if (fromTrash) "trash" else "gal"
        return File(diskCacheDir, "${prefix}_${safeName}")
    }

    private fun computeInSampleSize(outWidth: Int, outHeight: Int, reqMaxEdge: Int): Int {
        var inSampleSize = 1
        if (outHeight > reqMaxEdge || outWidth > reqMaxEdge) {
            val halfHeight = outHeight / 2
            val halfWidth = outWidth / 2
            while ((halfHeight / inSampleSize) >= reqMaxEdge && (halfWidth / inSampleSize) >= reqMaxEdge) {
                inSampleSize *= 2
            }
        }
        return inSampleSize.coerceAtLeast(1)
    }

    private fun decodeThumbnailFromFile(file: File, maxEdge: Int = 380): Bitmap? {
        return try {
            val boundsOpts = BitmapFactory.Options().apply {
                inJustDecodeBounds = true
            }
            BitmapFactory.decodeFile(file.absolutePath, boundsOpts)
            val sampleSize = computeInSampleSize(boundsOpts.outWidth, boundsOpts.outHeight, maxEdge)
            val decodeOpts = BitmapFactory.Options().apply {
                inSampleSize = sampleSize
                inPreferredConfig = Bitmap.Config.ARGB_8888
            }
            BitmapFactory.decodeFile(file.absolutePath, decodeOpts)
        } catch (_: Exception) {
            null
        }
    }

    private fun scaleBitmapToMaxEdge(bmp: Bitmap, maxEdge: Int): Bitmap {
        val maxDim = maxOf(bmp.width, bmp.height)
        if (maxDim <= maxEdge || maxDim <= 0) return bmp
        val scale = maxEdge.toFloat() / maxDim
        val w = (bmp.width * scale).toInt().coerceAtLeast(1)
        val h = (bmp.height * scale).toInt().coerceAtLeast(1)
        return try {
            val scaled = Bitmap.createScaledBitmap(bmp, w, h, true)
            if (scaled != bmp) {
                try {
                    bmp.recycle()
                } catch (_: Exception) {
                }
            }
            scaled
        } catch (_: Exception) {
            bmp
        }
    }

    private fun decodeVideoThumbnailFromFile(file: File, maxEdge: Int = 380): Bitmap? {
        val retriever = MediaMetadataRetriever()
        return try {
            retriever.setDataSource(file.absolutePath)
            val frame = retriever.getFrameAtTime(0, MediaMetadataRetriever.OPTION_CLOSEST_SYNC)
                ?: retriever.getFrameAtTime()
            frame?.let { scaleBitmapToMaxEdge(it, maxEdge) }
        } catch (_: Exception) {
            null
        } finally {
            try {
                retriever.release()
            } catch (_: Exception) {
            }
        }
    }

    /**
     * Fast path for videos: the server supports HTTP Range, so MediaMetadataRetriever
     * only needs to stream the container metadata + an early frame instead of the whole file.
     * Falls back to a full download in the caller when this fails (e.g. self-signed HTTPS).
     */
    private fun decodeVideoThumbnailFromUrl(url: String, maxEdge: Int = 380): Bitmap? {
        val retriever = MediaMetadataRetriever()
        return try {
            val cookie = getCookieHeaderForCurrentServer()
            val headers = if (cookie.isNotBlank()) mapOf("Cookie" to cookie) else emptyMap()
            retriever.setDataSource(url, headers)
            val frame = retriever.getFrameAtTime(0, MediaMetadataRetriever.OPTION_CLOSEST_SYNC)
                ?: retriever.getFrameAtTime()
            frame?.let { scaleBitmapToMaxEdge(it, maxEdge) }
        } catch (_: Exception) {
            null
        } finally {
            try {
                retriever.release()
            } catch (_: Exception) {
            }
        }
    }

    private fun decodeMediaThumbnailFromFile(file: File, isVideo: Boolean, maxEdge: Int = 380): Bitmap? {
        return if (isVideo) decodeVideoThumbnailFromFile(file, maxEdge)
        else decodeThumbnailFromFile(file, maxEdge)
    }

    /**
     * Pure O(1) RAM-only thumbnail lookup (0.001ms). NEVER performs disk I/O on the Main UI Thread.
     */
    fun getRamThumbnailBitmap(filename: String, fromTrash: Boolean = false): Bitmap? {
        val cacheKey = "$fromTrash:$filename"
        thumbnailCache.get(cacheKey)?.let { return it }
        bitmapCache.get(cacheKey)?.let { return it }
        return null
    }

    /**
     * Pure O(1) RAM-only full-res bitmap lookup (0.001ms) for Lightbox / Photo Editor.
     * Never blocks the Main UI Thread with synchronous disk decoding.
     */
    fun getCachedBitmap(filename: String, fromTrash: Boolean = false): Bitmap? {
        val cacheKey = "$fromTrash:$filename"
        bitmapCache.get(cacheKey)?.let { return it }
        return null
    }

    private fun cleanBaseUrl(): String = baseUrl.trim().removeSuffix("/")

    fun getMediaUrl(filename: String, fromTrash: Boolean = false, download: Boolean = false): String {
        val encoded = URLEncoder.encode(filename, "UTF-8").replace("+", "%20")
        val params = mutableListOf<String>()
        if (fromTrash) params.add("from_trash=true")
        if (download) params.add("download=1")
        val query = if (params.isEmpty()) "" else "?${params.joinToString("&")}"
        return "${cleanBaseUrl()}/media/$encoded$query"
    }

    fun getCookieHeaderForCurrentServer(): String {
        return try {
            val httpUrl = HttpUrl.Builder()
                .scheme(if (cleanBaseUrl().startsWith("https")) "https" else "http")
                .host(Uri.parse(cleanBaseUrl()).host ?: "localhost")
                .build()
            cookieJar.loadForRequest(httpUrl).joinToString("; ") { "${it.name}=${it.value}" }
        } catch (_: Exception) {
            ""
        }
    }

    /**
     * Loads a compact 380px grid thumbnail on Dispatchers.IO and keeps it in thumbnailCache
     * so switching tabs to the Gallery is 0ms instantaneous.
     */
    suspend fun loadThumbnailBitmap(filename: String, fromTrash: Boolean = false): Bitmap? = withContext(Dispatchers.IO) {
        if (!MediaItemModel.detectIsMediaFilename(filename)) return@withContext null
        val cacheKey = "$fromTrash:$filename"
        thumbnailCache.get(cacheKey)?.let { return@withContext it }
        val isVideo = MediaItemModel.detectIsVideoFilename(filename)

        val diskFile = diskCacheFile(filename, fromTrash)
        if (diskFile.exists() && diskFile.length() > 0L) {
            val thumbBmp = decodeMediaThumbnailFromFile(diskFile, isVideo, 380)
            if (thumbBmp != null) {
                thumbnailCache.put(cacheKey, thumbBmp)
                return@withContext thumbBmp
            }
        }

        if (isVideo) {
            // Fast path: stream only container metadata + an early frame via HTTP Range
            decodeVideoThumbnailFromUrl(getMediaUrl(filename, fromTrash), 380)?.let { thumb ->
                thumbnailCache.put(cacheKey, thumb)
                return@withContext thumb
            }
        }

        try {
            val request = Request.Builder()
                .url(getMediaUrl(filename, fromTrash))
                .get()
                .build()

            httpClient.newCall(request).execute().use { response ->
                if (!response.isSuccessful) return@withContext null
                val bytes = response.body?.bytes() ?: return@withContext null
                if (bytes.isEmpty()) return@withContext null

                try {
                    FileOutputStream(diskFile).use { out ->
                        out.write(bytes)
                        out.flush()
                    }
                } catch (_: Exception) {
                }

                val thumbBmp = decodeMediaThumbnailFromFile(diskFile, isVideo, 380)
                    ?: if (!isVideo) BitmapFactory.decodeByteArray(bytes, 0, bytes.size) else null
                if (thumbBmp != null) {
                    thumbnailCache.put(cacheKey, thumbBmp)
                }
                thumbBmp
            }
        } catch (_: Exception) {
            null
        }
    }

    suspend fun loadMediaBitmap(filename: String, fromTrash: Boolean = false): Bitmap? = withContext(Dispatchers.IO) {
        if (!MediaItemModel.detectIsMediaFilename(filename)) return@withContext null
        val cacheKey = "$fromTrash:$filename"
        bitmapCache.get(cacheKey)?.let { return@withContext it }

        val diskFile = diskCacheFile(filename, fromTrash)
        if (diskFile.exists() && diskFile.length() > 0L) {
            try {
                val options = BitmapFactory.Options().apply {
                    inPreferredConfig = Bitmap.Config.ARGB_8888
                }
                val diskBmp = BitmapFactory.decodeFile(diskFile.absolutePath, options)
                if (diskBmp != null) {
                    bitmapCache.put(cacheKey, diskBmp)
                    if (thumbnailCache.get(cacheKey) == null) {
                        decodeMediaThumbnailFromFile(diskFile, MediaItemModel.detectIsVideoFilename(filename), 380)?.let { thumbnailCache.put(cacheKey, it) }
                    }
                    return@withContext diskBmp
                }
            } catch (_: Exception) {
            }
        }

        try {
            val request = Request.Builder()
                .url(getMediaUrl(filename, fromTrash))
                .get()
                .build()

            httpClient.newCall(request).execute().use { response ->
                if (!response.isSuccessful) return@withContext null
                val bytes = response.body?.bytes() ?: return@withContext null
                if (bytes.isEmpty()) return@withContext null

                try {
                    FileOutputStream(diskFile).use { out ->
                        out.write(bytes)
                        out.flush()
                    }
                } catch (_: Exception) {
                }

                val options = BitmapFactory.Options().apply {
                    inPreferredConfig = Bitmap.Config.ARGB_8888
                }
                val bmp = BitmapFactory.decodeByteArray(bytes, 0, bytes.size, options)
                if (bmp != null) {
                    bitmapCache.put(cacheKey, bmp)
                    if (thumbnailCache.get(cacheKey) == null) {
                        decodeMediaThumbnailFromFile(diskFile, MediaItemModel.detectIsVideoFilename(filename), 380)?.let { thumbnailCache.put(cacheKey, it) }
                    }
                }
                bmp
            }
        } catch (_: Exception) {
            null
        }
    }

    suspend fun registerUser(
        username: String,
        keyType: String,
        customKey: String
    ): RegisterResult = withContext(Dispatchers.IO) {
        try {
            val formBody = FormBody.Builder()
                .add("username", username.trim())
                .add("key_type", keyType)
                .add("custom_key", customKey)
                .build()

            val request = Request.Builder()
                .url("${cleanBaseUrl()}/register")
                .post(formBody)
                .build()

            httpClient.newCall(request).execute().use { response ->
                val bodyText = response.body?.string() ?: ""
                if (!response.isSuccessful) {
                    return@withContext RegisterResult(
                        success = false,
                        errorMessage = bodyText.ifBlank { "Errore registrazione (${response.code})" }
                    )
                }
                val disp = response.header("Content-Disposition") ?: ""
                val match = Regex("filename=\"?([^\";]+)\"?", RegexOption.IGNORE_CASE).find(disp)
                val safeUser = username.trim().replace(Regex("[^a-zA-Z0-9_-]"), "_").ifBlank { "user" }
                val filename = match?.groupValues?.getOrNull(1) ?: "photocloud_auth_$safeUser.json"

                RegisterResult(
                    success = true,
                    filename = filename,
                    jsonContent = bodyText
                )
            }
        } catch (e: Exception) {
            RegisterResult(
                success = false,
                errorMessage = "Impossibile contattare il server: ${e.localizedMessage}"
            )
        }
    }

    suspend fun loginWithAuthBytes(authJsonBytes: ByteArray): Pair<Boolean, String> = withContext(Dispatchers.IO) {
        try {
            val requestBody = MultipartBody.Builder()
                .setType(MultipartBody.FORM)
                .addFormDataPart(
                    "auth_file",
                    "photocloud_auth.json",
                    authJsonBytes.toRequestBody("application/json".toMediaTypeOrNull())
                )
                .build()

            val request = Request.Builder()
                .url("${cleanBaseUrl()}/login")
                .post(requestBody)
                .build()

            noRedirectClient.newCall(request).execute().use { response ->
                if (response.code in 200..399) {
                    return@withContext Pair(true, "")
                }
                val err = response.body?.string() ?: "Credenziali non valide"
                Pair(false, err)
            }
        } catch (e: Exception) {
            Pair(false, "Errore di connessione al server: ${e.localizedMessage}")
        }
    }

    suspend fun logout(): Boolean = withContext(Dispatchers.IO) {
        try {
            val request = Request.Builder()
                .url("${cleanBaseUrl()}/logout")
                .post("".toRequestBody(null))
                .build()
            noRedirectClient.newCall(request).execute().close()
        } catch (_: Exception) {
        }
        clearCookies()
        true
    }

    /**
     * Synchronizes gallery state (both media and cloud files + albums) in the background.
     */
    suspend fun syncGallerySession(): GallerySyncResult = withContext(Dispatchers.IO) {
        try {
            // Try /api/session first for rich metadata (file sizes, categories, albums)
            try {
                val apiReq = Request.Builder()
                    .url("${cleanBaseUrl()}/api/session")
                    .header("Accept", "application/json")
                    .get()
                    .build()
                httpClient.newCall(apiReq).execute().use { apiResp ->
                    if (apiResp.isSuccessful) {
                        val body = apiResp.body?.string() ?: ""
                        if (body.trim().startsWith("{")) {
                            val json = JSONObject(body)
                            if (json.has("authenticated") && !json.optBoolean("authenticated", false)) {
                                return@withContext GallerySyncResult.Unauthenticated
                            }
                            if (json.optBoolean("authenticated", false)) {
                                val localAlbums = getCachedAlbums().toMutableSet()
                                val albumsArr = json.optJSONArray("albums")
                                if (albumsArr != null) {
                                    for (i in 0 until albumsArr.length()) {
                                        val a = albumsArr.optString(i, "").trim()
                                        if (a.isNotBlank()) localAlbums.add(a)
                                    }
                                }
                                val localMap = getCachedFileAlbumsMap().toMutableMap()
                                val fileAlbumsObj = json.optJSONObject("fileAlbums")
                                if (fileAlbumsObj != null) {
                                    val keys = fileAlbumsObj.keys()
                                    while (keys.hasNext()) {
                                        val k = keys.next()
                                        val v = fileAlbumsObj.optString(k, "").trim()
                                        if (v.isNotBlank()) {
                                            localMap[k] = v
                                            localAlbums.add(v)
                                        }
                                    }
                                }
                                saveCachedAlbums(localAlbums.toList())
                                saveCachedFileAlbumsMap(localMap)

                                val mediaArr = json.optJSONArray("media")
                                if (mediaArr != null) {
                                    val items = ArrayList<MediaItemModel>(mediaArr.length())
                                    for (i in 0 until mediaArr.length()) {
                                        val m = mediaArr.optJSONObject(i) ?: continue
                                        val fn = m.optString("filename", "")
                                        if (fn.isBlank()) continue
                                        val ts = m.optDouble("timestamp", System.currentTimeMillis() / 1000.0)
                                        val sz = m.optLong("size", 0L)
                                        val isMed = if (m.has("isMedia")) m.optBoolean("isMedia", true) else MediaItemModel.detectIsMediaFilename(fn)
                                        val cat = m.optString("category", "").ifBlank { MediaItemModel.detectFileCategory(fn) }
                                        val alb = m.optString("album", "").ifBlank { localMap[fn] ?: "" }
                                        if (alb.isNotBlank() && localMap[fn] != alb) {
                                            localMap[fn] = alb
                                        }
                                        items.add(
                                            MediaItemModel(
                                                filename = fn,
                                                timestamp = ts,
                                                size = sz,
                                                isMedia = isMed,
                                                category = cat,
                                                album = alb
                                            )
                                        )
                                    }
                                    saveCachedFileAlbumsMap(localMap)
                                    saveCachedGalleryItems(items)
                                    return@withContext GallerySyncResult.Authenticated(items)
                                }
                            }
                        }
                    }
                }
            } catch (_: Exception) {
                // Fallback to HTML scraping if /api/session is not supported on older server
            }

            val request = Request.Builder()
                .url("${cleanBaseUrl()}/")
                .header("Accept", "text/html")
                .get()
                .build()

            httpClient.newCall(request).execute().use { response ->
                if (response.code == 401 || response.code == 403) {
                    return@withContext GallerySyncResult.Unauthenticated
                }
                if (!response.isSuccessful) {
                    return@withContext GallerySyncResult.NetworkError
                }
                val html = response.body?.string() ?: return@withContext GallerySyncResult.NetworkError

                if (html.contains("id=\"actual-login-form\"") ||
                    (html.contains("class=\"auth-container\"") && !html.contains("gallery-grid"))
                ) {
                    return@withContext GallerySyncResult.Unauthenticated
                }

                val parsed = parseMediaItemsFromHtml(html)
                saveCachedGalleryItems(parsed)
                GallerySyncResult.Authenticated(parsed)
            }
        } catch (_: Exception) {
            GallerySyncResult.NetworkError
        }
    }

    suspend fun fetchTrashItems(): List<MediaItemModel> = withContext(Dispatchers.IO) {
        try {
            val request = Request.Builder()
                .url("${cleanBaseUrl()}/trash")
                .header("Accept", "text/html")
                .get()
                .build()

            httpClient.newCall(request).execute().use { response ->
                if (!response.isSuccessful) return@withContext getCachedTrashItems()
                val html = response.body?.string() ?: return@withContext getCachedTrashItems()
                if (html.contains("id=\"actual-login-form\"")) return@withContext emptyList()
                val parsed = parseMediaItemsFromHtml(html)
                saveCachedTrashItems(parsed)
                parsed
            }
        } catch (_: Exception) {
            getCachedTrashItems()
        }
    }

    private fun parseMediaItemsFromHtml(html: String): List<MediaItemModel> {
        val results = mutableListOf<MediaItemModel>()
        val seen = mutableSetOf<String>()
        val albumMap = getCachedFileAlbumsMap().toMutableMap()
        val albumsSet = getCachedAlbums().toMutableSet()

        val chunks = html.split("media-card-wrapper")
        val tsRegex = Regex("data-timestamp=\"([0-9.]+)\"")
        val fnAttrRegex = Regex("data-filename=\"([^\"]+)\"")
        val sizeAttrRegex = Regex("data-size=\"([0-9]+)\"")
        val isMediaAttrRegex = Regex("data-is-media=\"(true|false)\"")
        val categoryAttrRegex = Regex("data-category=\"([^\"]+)\"")
        val albumAttrRegex = Regex("data-album=\"([^\"]*)\"")
        val mediaSrcRegex = Regex("/media/([^\"'?#\\s>]+)")

        for (i in 1 until chunks.size) {
            val chunk = chunks[i]
            val ts = tsRegex.find(chunk)?.groupValues?.getOrNull(1)?.toDoubleOrNull()
                ?: (System.currentTimeMillis() / 1000.0)

            var fname = fnAttrRegex.find(chunk)?.groupValues?.getOrNull(1)
            if (fname.isNullOrBlank()) {
                val rawEncoded = mediaSrcRegex.find(chunk)?.groupValues?.getOrNull(1)
                if (!rawEncoded.isNullOrBlank()) {
                    fname = try {
                        URLDecoder.decode(rawEncoded, "UTF-8")
                    } catch (_: Exception) {
                        rawEncoded
                    }
                }
            }

            if (!fname.isNullOrBlank() && seen.add(fname)) {
                val sizeVal = sizeAttrRegex.find(chunk)?.groupValues?.getOrNull(1)?.toLongOrNull() ?: 0L
                val isMediaVal = isMediaAttrRegex.find(chunk)?.groupValues?.getOrNull(1)?.let { it == "true" }
                    ?: MediaItemModel.detectIsMediaFilename(fname)
                val catVal = categoryAttrRegex.find(chunk)?.groupValues?.getOrNull(1)?.ifBlank { null }
                    ?: MediaItemModel.detectFileCategory(fname)
                val htmlAlbum = albumAttrRegex.find(chunk)?.groupValues?.getOrNull(1)?.trim() ?: ""
                val finalAlbum = if (htmlAlbum.isNotBlank()) {
                    albumMap[fname] = htmlAlbum
                    albumsSet.add(htmlAlbum)
                    htmlAlbum
                } else {
                    albumMap[fname] ?: ""
                }

                results.add(
                    MediaItemModel(
                        filename = fname,
                        timestamp = ts,
                        size = sizeVal,
                        isMedia = isMediaVal,
                        category = catVal,
                        album = finalAlbum
                    )
                )
            }
        }
        saveCachedFileAlbumsMap(albumMap)
        saveCachedAlbums(albumsSet.toList())
        return results
    }

    suspend fun createAlbum(albumName: String): Boolean = withContext(Dispatchers.IO) {
        val clean = albumName.trim()
        if (clean.isBlank()) return@withContext false

        val current = getCachedAlbums().toMutableSet()
        current.add(clean)
        saveCachedAlbums(current.toList())

        try {
            val payload = JSONObject().put("name", clean).toString()
            val req = Request.Builder()
                .url("${cleanBaseUrl()}/api/albums/create")
                .post(payload.toRequestBody("application/json".toMediaTypeOrNull()))
                .build()
            httpClient.newCall(req).execute().close()
        } catch (_: Exception) {
        }
        true
    }

    suspend fun assignFilesToAlbum(filenames: List<String>, albumName: String): Boolean = withContext(Dispatchers.IO) {
        val clean = albumName.trim()
        val map = getCachedFileAlbumsMap().toMutableMap()
        val albums = getCachedAlbums().toMutableSet()
        if (clean.isNotBlank()) albums.add(clean)

        for (fn in filenames) {
            if (clean.isBlank()) {
                map.remove(fn)
            } else {
                map[fn] = clean
            }
        }
        saveCachedFileAlbumsMap(map)
        saveCachedAlbums(albums.toList())

        // Update cached gallery items immediately for 0ms UI reactivity
        val updatedGallery = getCachedGalleryItems().map { item ->
            if (item.filename in filenames) item.copy(album = clean) else item
        }
        saveCachedGalleryItems(updatedGallery)

        try {
            val arr = JSONArray()
            filenames.forEach { arr.put(it) }
            val payload = JSONObject()
                .put("filenames", arr)
                .put("album", clean)
                .toString()
            val req = Request.Builder()
                .url("${cleanBaseUrl()}/api/albums/assign")
                .post(payload.toRequestBody("application/json".toMediaTypeOrNull()))
                .build()
            httpClient.newCall(req).execute().close()
        } catch (_: Exception) {
        }
        true
    }

    suspend fun deleteAlbum(albumName: String): Boolean = withContext(Dispatchers.IO) {
        val clean = albumName.trim()
        if (clean.isBlank()) return@withContext false

        val albums = getCachedAlbums().filter { it != clean }
        saveCachedAlbums(albums)

        val map = getCachedFileAlbumsMap().filterValues { it != clean }
        saveCachedFileAlbumsMap(map)

        val updatedGallery = getCachedGalleryItems().map { item ->
            if (item.album == clean) item.copy(album = "") else item
        }
        saveCachedGalleryItems(updatedGallery)

        try {
            val payload = JSONObject().put("name", clean).toString()
            val req = Request.Builder()
                .url("${cleanBaseUrl()}/api/albums/delete")
                .post(payload.toRequestBody("application/json".toMediaTypeOrNull()))
                .build()
            httpClient.newCall(req).execute().close()
        } catch (_: Exception) {
        }
        true
    }

    /**
     * Uploads an edited photo (JPEG bytes) to the server either as a new copy ("copy")
     * or overwriting the existing photo ("overwrite"), with live transfer speed tracking
     * and fallback to /upload for older servers.
     */
    suspend fun uploadEditedPhotoBytes(
        originalFilename: String,
        editedJpegBytes: ByteArray,
        overwrite: Boolean,
        onTransferUpdate: (TransferOperation) -> Unit = {}
    ): Pair<Boolean, String> = withContext(Dispatchers.IO) {
        if (editedJpegBytes.isEmpty()) {
            return@withContext Pair(false, "Immagine modificata vuota")
        }

        val opId = "edit_${System.currentTimeMillis()}"
        val opTitle = if (overwrite) "Sovrascrivi: $originalFilename" else "Nuova copia: $originalFilename"
        val totalBytes = editedJpegBytes.size.toLong()
        val startMs = System.currentTimeMillis()
        val modeStr = if (overwrite) "overwrite" else "copy"

        onTransferUpdate(
            TransferOperation(
                id = opId,
                title = opTitle,
                isUpload = true,
                transferredBytes = 0L,
                totalBytes = totalBytes,
                speedBytesPerSec = 0L,
                status = TransferStatus.RUNNING,
                detail = "Salvataggio modifiche foto..."
            )
        )

        try {
            val multipart = MultipartBody.Builder()
                .setType(MultipartBody.FORM)
                .addFormDataPart(
                    "file",
                    originalFilename,
                    editedJpegBytes.toRequestBody("image/jpeg".toMediaTypeOrNull())
                )
                .addFormDataPart("originalFilename", originalFilename)
                .addFormDataPart("mode", modeStr)
                .build()

            var lastEmit = 0L
            val progressBody = ProgressRequestBody(multipart) { written, _ ->
                val now = System.currentTimeMillis()
                if (now - lastEmit >= 100L || written >= totalBytes) {
                    lastEmit = now
                    val done = written.coerceAtMost(totalBytes)
                    val elapsed = max(0.15, (now - startMs) / 1000.0)
                    val speed = (done / elapsed).toLong()
                    onTransferUpdate(
                        TransferOperation(
                            id = opId,
                            title = opTitle,
                            isUpload = true,
                            transferredBytes = done,
                            totalBytes = totalBytes,
                            speedBytesPerSec = speed,
                            status = TransferStatus.RUNNING,
                            detail = "Crittografia e invio al server..."
                        )
                    )
                }
            }

            val editReq = Request.Builder()
                .url("${cleanBaseUrl()}/api/media/edit")
                .post(progressBody)
                .build()

            var handledByEditEndpoint = false
            httpClient.newCall(editReq).execute().use { resp ->
                if (resp.isSuccessful) {
                    handledByEditEndpoint = true
                } else if (resp.code != 404 && resp.code != 405) {
                    val err = resp.body?.string() ?: "Errore salvataggio (${resp.code})"
                    onTransferUpdate(
                        TransferOperation(
                            id = opId,
                            title = opTitle,
                            isUpload = true,
                            transferredBytes = 0L,
                            totalBytes = totalBytes,
                            speedBytesPerSec = 0L,
                            status = TransferStatus.ERROR,
                            detail = err
                        )
                    )
                    return@withContext Pair(false, err)
                }
            }

            if (!handledByEditEndpoint) {
                // Fallback for older Python backend: upload via /upload
                val fallbackMultipart = MultipartBody.Builder()
                    .setType(MultipartBody.FORM)
                    .addFormDataPart(
                        "file[]",
                        originalFilename,
                        editedJpegBytes.toRequestBody("image/jpeg".toMediaTypeOrNull())
                    )
                    .addFormDataPart("timestamp[]", System.currentTimeMillis().toString())
                    .build()

                val fallbackReq = Request.Builder()
                    .url("${cleanBaseUrl()}/upload")
                    .post(fallbackMultipart)
                    .build()

                httpClient.newCall(fallbackReq).execute().use { fbResp ->
                    if (!fbResp.isSuccessful) {
                        val err = fbResp.body?.string() ?: "Errore upload foto modificata"
                        onTransferUpdate(
                            TransferOperation(
                                id = opId,
                                title = opTitle,
                                isUpload = true,
                                transferredBytes = 0L,
                                totalBytes = totalBytes,
                                speedBytesPerSec = 0L,
                                status = TransferStatus.ERROR,
                                detail = err
                            )
                        )
                        return@withContext Pair(false, err)
                    }
                }
                if (overwrite) {
                    moveToTrash(originalFilename)
                }
            }

            if (overwrite) {
                val cacheKey = "false:$originalFilename"
                bitmapCache.remove(cacheKey)
                val diskFile = diskCacheFile(originalFilename, false)
                try {
                    FileOutputStream(diskFile).use { out ->
                        out.write(editedJpegBytes)
                        out.flush()
                    }
                    val updatedBmp = BitmapFactory.decodeByteArray(editedJpegBytes, 0, editedJpegBytes.size)
                    if (updatedBmp != null) {
                        bitmapCache.put(cacheKey, updatedBmp)
                    }
                } catch (_: Exception) {
                }
            }

            val elapsed = max(0.15, (System.currentTimeMillis() - startMs) / 1000.0)
            val speed = (totalBytes / elapsed).toLong()
            onTransferUpdate(
                TransferOperation(
                    id = opId,
                    title = opTitle,
                    isUpload = true,
                    transferredBytes = totalBytes,
                    totalBytes = totalBytes,
                    speedBytesPerSec = speed,
                    status = TransferStatus.COMPLETED,
                    detail = if (overwrite) "Originale aggiornato" else "Salvata nuova copia"
                )
            )

            Pair(
                true,
                if (overwrite) "Foto originale aggiornata con successo"
                else "Foto modificata salvata come nuova copia"
            )
        } catch (e: Exception) {
            onTransferUpdate(
                TransferOperation(
                    id = opId,
                    title = opTitle,
                    isUpload = true,
                    transferredBytes = 0L,
                    totalBytes = totalBytes,
                    speedBytesPerSec = 0L,
                    status = TransferStatus.ERROR,
                    detail = e.localizedMessage ?: "Errore di rete"
                )
            )
            Pair(false, "Errore salvataggio foto: ${e.localizedMessage}")
        }
    }

    private data class PreparedUploadUri(
        val uri: Uri,
        val displayName: String,
        val mimeType: String,
        val sizeBytes: Long,
        val timestampMs: Long
    )

    /**
     * Uploads any number of files (e.g., 1, 250, 500, or 1,000+ photos, videos, PDFs, ZIPs, APKs, docs, audio)
     * using zero-OOM streaming (UriStreamingRequestBody) and a bounded parallel coroutine worker pool
     * controlled by [maxParallelTransfers] (1..16 concurrent transfers), or packages them into a single
     * streaming .zip archive when [archiveAsZip] is true. Supports real-time pause, resume, and cancel.
     */
    suspend fun uploadMediaUris(
        uris: List<Uri>,
        targetAlbum: String = "",
        maxParallelTransfers: Int = getMaxParallelTransfers(),
        archiveAsZip: Boolean = false,
        archiveName: String = "",
        onProgress: (Int, Int) -> Unit = { _, _ -> },
        onTransferUpdate: (TransferOperation) -> Unit = {}
    ): Pair<Boolean, String> = withContext(Dispatchers.IO) {
        if (uris.isEmpty()) return@withContext Pair(false, "Nessun file selezionato")

        val parallelLimit = maxParallelTransfers.coerceIn(1, 16)
        val opId = "up_${System.currentTimeMillis()}"
        val controlHandle = registerTransferHandle(opId)
        val prepared = ArrayList<PreparedUploadUri>(uris.size)
        var grandTotalBytes = 0L
        val nowBaseMs = System.currentTimeMillis()

        try {
            // 1. Resolve ONLY lightweight metadata (name + byte length). Never read file bytes into RAM upfront!
            for ((idx, uri) in uris.withIndex()) {
                if (controlHandle.isCancelled.get()) {
                    return@withContext Pair(false, "Trasferimento annullato")
                }
                val meta = resolveUriMetadata(uri, nowBaseMs + idx) ?: continue
                prepared.add(meta)
                grandTotalBytes += meta.sizeBytes.coerceAtLeast(0L)
            }

            if (prepared.isEmpty()) {
                return@withContext Pair(false, "Impossibile leggere i file selezionati")
            }

            val totalFilesCount = prepared.size
            val safeGrandTotal = grandTotalBytes.coerceAtLeast(totalFilesCount * 1024L)

            if (archiveAsZip) {
                val cleanZipBase = archiveName.trim()
                    .replace(Regex("[^a-zA-Z0-9._-]"), "_")
                    .removeSuffix(".zip")
                    .ifBlank { "Archivio_PhotoCloud_${System.currentTimeMillis()}" }
                val finalZipName = "$cleanZipBase.zip"
                val opTitle = "Archivio Upload ($totalFilesCount file)"
                val startTimeMs = System.currentTimeMillis()
                val tempZipFile = File(context.cacheDir, "tmp_upload_${System.currentTimeMillis()}.zip")

                try {
                    onTransferUpdate(
                        TransferOperation(
                            id = opId,
                            title = opTitle,
                            isUpload = true,
                            transferredBytes = 0L,
                            totalBytes = safeGrandTotal,
                            speedBytesPerSec = 0L,
                            status = TransferStatus.RUNNING,
                            detail = "Creazione archivio ZIP (0 / $totalFilesCount file)..."
                        )
                    )

                    val usedEntryNames = HashSet<String>()
                    var compressedInputBytes = 0L
                    var lastZipEmitMs = 0L
                    val copyBuf = ByteArray(32 * 1024)

                    ZipOutputStream(BufferedOutputStream(FileOutputStream(tempZipFile))).use { zos ->
                        for ((idx, item) in prepared.withIndex()) {
                            controlHandle.awaitIfPausedSuspend()
                            var entryName = item.displayName.replace("/", "_").replace("\\", "_")
                            if (!usedEntryNames.add(entryName)) {
                                val dot = entryName.lastIndexOf('.')
                                entryName = if (dot > 0) {
                                    "${entryName.substring(0, dot)}_${idx + 1}${entryName.substring(dot)}"
                                } else {
                                    "${entryName}_${idx + 1}"
                                }
                                usedEntryNames.add(entryName)
                            }
                            val entry = ZipEntry(entryName).apply {
                                time = item.timestampMs
                            }
                            zos.putNextEntry(entry)
                            context.contentResolver.openInputStream(item.uri)?.use { input ->
                                var r: Int
                                while (input.read(copyBuf).also { r = it } != -1) {
                                    controlHandle.awaitIfPausedBlocking()
                                    zos.write(copyBuf, 0, r)
                                    compressedInputBytes += r
                                    val now = System.currentTimeMillis()
                                    if (now - lastZipEmitMs >= 120L) {
                                        lastZipEmitMs = now
                                        val elapsedSec = max(0.15, (now - startTimeMs) / 1000.0)
                                        val speed = ((compressedInputBytes / 2) / elapsedSec).toLong()
                                        onTransferUpdate(
                                            TransferOperation(
                                                id = opId,
                                                title = opTitle,
                                                isUpload = true,
                                                transferredBytes = (compressedInputBytes / 2).coerceAtMost(safeGrandTotal / 2),
                                                totalBytes = safeGrandTotal,
                                                speedBytesPerSec = speed,
                                                status = if (controlHandle.isPaused.get()) TransferStatus.PAUSED else TransferStatus.RUNNING,
                                                detail = if (controlHandle.isPaused.get()) "In pausa" else "Archiviazione (${idx + 1} / $totalFilesCount)..."
                                            )
                                        )
                                    }
                                }
                            }
                            zos.closeEntry()
                            onProgress((idx + 1) / 2, totalFilesCount)
                        }
                        zos.finish()
                    }

                    val zipTotalBytes = tempZipFile.length().coerceAtLeast(1024L)
                    val uploadStartMs = System.currentTimeMillis()
                    var lastUploadEmitMs = 0L

                    val fileBody = FileStreamingRequestBody(
                        file = tempZipFile,
                        mediaType = "application/zip".toMediaTypeOrNull(),
                        controlHandle = controlHandle
                    )
                    val multipartBuilder = MultipartBody.Builder().setType(MultipartBody.FORM)
                        .addFormDataPart("file[]", finalZipName, fileBody)
                        .addFormDataPart("timestamp[]", System.currentTimeMillis().toString())
                    if (targetAlbum.isNotBlank()) {
                        multipartBuilder.addFormDataPart("album", targetAlbum.trim())
                    }

                    val progressBody = ProgressRequestBody(
                        delegate = multipartBuilder.build(),
                        controlHandle = controlHandle
                    ) { written, _ ->
                        val now = System.currentTimeMillis()
                        if (now - lastUploadEmitMs >= 100L) {
                            lastUploadEmitMs = now
                            val elapsedSec = max(0.15, (now - uploadStartMs) / 1000.0)
                            val speed = (written / elapsedSec).toLong()
                            onTransferUpdate(
                                TransferOperation(
                                    id = opId,
                                    title = opTitle,
                                    isUpload = true,
                                    transferredBytes = written.coerceIn(0L, zipTotalBytes),
                                    totalBytes = zipTotalBytes,
                                    speedBytesPerSec = speed,
                                    status = if (controlHandle.isPaused.get()) TransferStatus.PAUSED else TransferStatus.RUNNING,
                                    detail = if (controlHandle.isPaused.get()) "In pausa" else "Invio archivio $finalZipName..."
                                )
                            )
                        }
                    }

                    val req = Request.Builder()
                        .url("${cleanBaseUrl()}/upload")
                        .post(progressBody)
                        .build()

                    val call = httpClient.newCall(req)
                    controlHandle.registerCall(call)
                    try {
                        call.execute().use { resp ->
                            if (!resp.isSuccessful) {
                                val errMsg = resp.body?.string() ?: "Errore HTTP ${resp.code}"
                                onTransferUpdate(
                                    TransferOperation(
                                        id = opId,
                                        title = opTitle,
                                        isUpload = true,
                                        transferredBytes = 0L,
                                        totalBytes = zipTotalBytes,
                                        speedBytesPerSec = 0L,
                                        status = TransferStatus.ERROR,
                                        detail = errMsg
                                    )
                                )
                                return@withContext Pair(false, errMsg)
                            }
                            val bodyStr = resp.body?.string() ?: ""
                            val uploadedNames = mutableListOf<String>()
                            if (bodyStr.trim().startsWith("{")) {
                                try {
                                    val json = JSONObject(bodyStr)
                                    val fnArr = json.optJSONArray("uploadedFilenames")
                                    if (fnArr != null) {
                                        for (i in 0 until fnArr.length()) {
                                            val fn = fnArr.optString(i, "")
                                            if (fn.isNotBlank()) uploadedNames.add(fn)
                                        }
                                    }
                                } catch (_: Exception) {
                                }
                            }
                            if (uploadedNames.isEmpty()) uploadedNames.add(finalZipName)
                            if (targetAlbum.isNotBlank()) {
                                assignFilesToAlbum(uploadedNames, targetAlbum.trim())
                            }
                        }
                    } finally {
                        controlHandle.unregisterCall(call)
                    }

                    onProgress(totalFilesCount, totalFilesCount)
                    val elapsedSec = max(0.15, (System.currentTimeMillis() - uploadStartMs) / 1000.0)
                    val finalSpeed = (zipTotalBytes / elapsedSec).toLong()
                    onTransferUpdate(
                        TransferOperation(
                            id = opId,
                            title = opTitle,
                            isUpload = true,
                            transferredBytes = zipTotalBytes,
                            totalBytes = zipTotalBytes,
                            speedBytesPerSec = finalSpeed,
                            status = TransferStatus.COMPLETED,
                            detail = "Archivio caricato: $finalZipName ($totalFilesCount file)"
                        )
                    )
                    return@withContext Pair(true, "Archivio $finalZipName ($totalFilesCount file) caricato con successo")
                } finally {
                    try {
                        if (tempZipFile.exists()) tempZipFile.delete()
                    } catch (_: Exception) {
                    }
                }
            }

            val opTitle = if (totalFilesCount == 1) {
                prepared.first().displayName
            } else {
                "Upload ($totalFilesCount file • ${parallelLimit}x)"
            }

            val startTimeMs = System.currentTimeMillis()
            val emitLock = Any()
            val lastEmitMs = AtomicLong(0L)
            val taskBytesMap = ConcurrentHashMap<Int, Long>()
            val completedFilesCounter = AtomicInteger(0)
            val failedFilesCounter = AtomicInteger(0)
            val uploadedFilenames = Collections.synchronizedList(ArrayList<String>(totalFilesCount))

            fun emitProgress(force: Boolean = false, status: TransferStatus? = null, customDetail: String? = null) {
                val now = System.currentTimeMillis()
                val prev = lastEmitMs.get()
                if (!force && now - prev < 100L) return
                if (!force && !lastEmitMs.compareAndSet(prev, now)) return
                if (force) lastEmitMs.set(now)

                val effectiveStatus = status ?: when {
                    controlHandle.isCancelled.get() -> TransferStatus.CANCELLED
                    controlHandle.isPaused.get() -> TransferStatus.PAUSED
                    else -> TransferStatus.RUNNING
                }

                var sumTransferred = 0L
                for (v in taskBytesMap.values) {
                    sumTransferred += v
                }
                val clampedTransferred = if (effectiveStatus == TransferStatus.COMPLETED) {
                    safeGrandTotal
                } else {
                    sumTransferred.coerceIn(0L, safeGrandTotal)
                }
                val elapsedSec = max(0.15, (now - startTimeMs) / 1000.0)
                val speed = if (effectiveStatus == TransferStatus.PAUSED) 0L else (clampedTransferred / elapsedSec).toLong()
                val doneCount = completedFilesCounter.get().coerceIn(0, totalFilesCount)
                val detailStr = customDetail ?: when (effectiveStatus) {
                    TransferStatus.PAUSED -> "In pausa ($doneCount / $totalFilesCount file)"
                    TransferStatus.CANCELLED -> "Annullato"
                    else -> "$doneCount / $totalFilesCount file (${parallelLimit}x paralleli)"
                }

                synchronized(emitLock) {
                    onTransferUpdate(
                        TransferOperation(
                            id = opId,
                            title = opTitle,
                            isUpload = true,
                            transferredBytes = clampedTransferred,
                            totalBytes = safeGrandTotal,
                            speedBytesPerSec = speed,
                            status = effectiveStatus,
                            detail = detailStr
                        )
                    )
                }
            }

            emitProgress(force = true, status = TransferStatus.RUNNING, customDetail = "0 / $totalFilesCount file (${parallelLimit}x paralleli)")

            // Partition into byte-bounded micro-batches:
            val tasks = ArrayList<List<PreparedUploadUri>>()
            var currentBatch = ArrayList<PreparedUploadUri>(2)
            var currentBatchBytes = 0L
            val maxFilesPerTask = if (totalFilesCount > 60) 2 else 1
            val maxBytesPerTask = 6L * 1024L * 1024L // 6 MB cap for multi-file micro-batch

            for (item in prepared) {
                val itemSize = item.sizeBytes.coerceAtLeast(1024L)
                if (currentBatch.isNotEmpty() &&
                    (currentBatch.size >= maxFilesPerTask || (currentBatchBytes + itemSize) > maxBytesPerTask)
                ) {
                    tasks.add(currentBatch)
                    currentBatch = ArrayList(2)
                    currentBatchBytes = 0L
                }
                currentBatch.add(item)
                currentBatchBytes += itemSize
            }
            if (currentBatch.isNotEmpty()) {
                tasks.add(currentBatch)
            }

            val semaphore = Semaphore(parallelLimit)
            val lastErrMessage = AtomicLong(0L)
            val firstErrorText = AtomicReference("")

            coroutineScope {
                tasks.mapIndexed { taskIndex, batch ->
                    async(Dispatchers.IO) {
                        semaphore.withPermit {
                            if (controlHandle.isCancelled.get()) return@withPermit
                            controlHandle.awaitIfPausedSuspend()

                            val batchExpectedBytes = batch.sumOf { it.sizeBytes.coerceAtLeast(1024L) }
                            var taskSuccess = false
                            var attempt = 0

                            while (attempt < 2 && !taskSuccess && !controlHandle.isCancelled.get()) {
                                attempt++
                                try {
                                    controlHandle.awaitIfPausedSuspend()
                                    val multipartBuilder = MultipartBody.Builder().setType(MultipartBody.FORM)
                                    for (item in batch) {
                                        val streamBody = UriStreamingRequestBody(
                                            context = context,
                                            uri = item.uri,
                                            mediaType = item.mimeType.toMediaTypeOrNull(),
                                            knownByteSize = item.sizeBytes,
                                            controlHandle = controlHandle
                                        )
                                        multipartBuilder.addFormDataPart(
                                            "file[]",
                                            item.displayName,
                                            streamBody
                                        )
                                        multipartBuilder.addFormDataPart("timestamp[]", item.timestampMs.toString())
                                    }

                                    if (targetAlbum.isNotBlank()) {
                                        multipartBuilder.addFormDataPart("album", targetAlbum.trim())
                                    }
                                    if (tasks.size > 1) {
                                        multipartBuilder.addFormDataPart("skipList", "1")
                                    }

                                    val rawBody = multipartBuilder.build()
                                    val progressBody = ProgressRequestBody(
                                        delegate = rawBody,
                                        controlHandle = controlHandle
                                    ) { writtenInBatch, _ ->
                                        taskBytesMap[taskIndex] = writtenInBatch.coerceAtMost(batchExpectedBytes)
                                        emitProgress(force = false)
                                    }

                                    val request = Request.Builder()
                                        .url("${cleanBaseUrl()}/upload")
                                        .post(progressBody)
                                        .build()

                                    val call = httpClient.newCall(request)
                                    controlHandle.registerCall(call)
                                    try {
                                        call.execute().use { response ->
                                            if (response.isSuccessful) {
                                                taskSuccess = true
                                                taskBytesMap[taskIndex] = batchExpectedBytes
                                                val bodyStr = response.body?.string() ?: ""
                                                var parsedServerNames = false
                                                if (bodyStr.trim().startsWith("{")) {
                                                    try {
                                                        val json = JSONObject(bodyStr)
                                                        val fnArr = json.optJSONArray("uploadedFilenames")
                                                        if (fnArr != null && fnArr.length() > 0) {
                                                            for (i in 0 until fnArr.length()) {
                                                                val fn = fnArr.optString(i, "")
                                                                if (fn.isNotBlank()) uploadedFilenames.add(fn)
                                                            }
                                                            parsedServerNames = true
                                                        }
                                                    } catch (_: Exception) {
                                                    }
                                                }
                                                if (!parsedServerNames) {
                                                    batch.forEach { uploadedFilenames.add(it.displayName) }
                                                }
                                            } else {
                                                val errBody = response.body?.string() ?: "Errore HTTP ${response.code}"
                                                firstErrorText.compareAndSet("", errBody)
                                                if (attempt < 2 && !controlHandle.isCancelled.get()) {
                                                    delay(250L)
                                                }
                                            }
                                        }
                                    } finally {
                                        controlHandle.unregisterCall(call)
                                    }
                                } catch (e: Throwable) {
                                    if (controlHandle.isCancelled.get()) break
                                    firstErrorText.compareAndSet("", e.localizedMessage ?: "Errore di connessione")
                                    if (attempt < 2) {
                                        delay(250L)
                                    }
                                }
                            }

                            if (controlHandle.isCancelled.get()) return@withPermit

                            if (taskSuccess) {
                                val doneNow = completedFilesCounter.addAndGet(batch.size)
                                synchronized(emitLock) {
                                    onProgress(doneNow, totalFilesCount)
                                }
                                emitProgress(force = true)
                            } else {
                                taskBytesMap[taskIndex] = 0L
                                failedFilesCounter.addAndGet(batch.size)
                                lastErrMessage.set(System.currentTimeMillis())
                                emitProgress(force = true)
                            }
                        }
                    }
                }.awaitAll()
            }

            if (controlHandle.isCancelled.get()) {
                emitProgress(force = true, status = TransferStatus.CANCELLED, customDetail = "Trasferimento annullato")
                return@withContext Pair(false, "Trasferimento annullato")
            }

            val succeededCount = completedFilesCounter.get()
            val failedCount = failedFilesCounter.get()

            if (succeededCount == 0) {
                val errDetail = firstErrorText.get().ifBlank { "Errore durante il caricamento dei file" }
                emitProgress(force = true, status = TransferStatus.ERROR, customDetail = errDetail)
                return@withContext Pair(false, errDetail)
            }

            if (targetAlbum.isNotBlank() && uploadedFilenames.isNotEmpty()) {
                assignFilesToAlbum(uploadedFilenames.toList(), targetAlbum.trim())
            }

            val finalSummary = if (failedCount > 0) {
                "$succeededCount / $totalFilesCount file caricati ($failedCount non riusciti)"
            } else {
                "$succeededCount file caricati con successo"
            }

            emitProgress(
                force = true,
                status = TransferStatus.COMPLETED,
                customDetail = "$succeededCount file caricati"
            )

            Pair(true, finalSummary)
        } catch (e: Throwable) {
            if (controlHandle.isCancelled.get()) {
                onTransferUpdate(
                    TransferOperation(
                        id = opId,
                        title = "Upload annullato",
                        isUpload = true,
                        transferredBytes = 0L,
                        totalBytes = grandTotalBytes,
                        speedBytesPerSec = 0L,
                        status = TransferStatus.CANCELLED,
                        detail = "Annullato dall'utente"
                    )
                )
                return@withContext Pair(false, "Trasferimento annullato")
            }
            val errDetail = e.localizedMessage ?: "Errore di rete"
            onTransferUpdate(
                TransferOperation(
                    id = opId,
                    title = "Upload",
                    isUpload = true,
                    transferredBytes = 0L,
                    totalBytes = grandTotalBytes,
                    speedBytesPerSec = 0L,
                    status = TransferStatus.ERROR,
                    detail = errDetail
                )
            )
            Pair(false, "Errore durante il caricamento: $errDetail")
        } finally {
            unregisterTransferHandle(opId)
        }
    }

    /**
     * Extracts display name and byte size from a Uri without reading file content into RAM.
     */
    private fun resolveUriMetadata(uri: Uri, fallbackTimestampMs: Long): PreparedUploadUri? {
        return try {
            var displayName: String? = null
            var byteSize = -1L

            context.contentResolver.query(
                uri,
                arrayOf(OpenableColumns.DISPLAY_NAME, OpenableColumns.SIZE),
                null,
                null,
                null
            )?.use { cursor ->
                if (cursor.moveToFirst()) {
                    val nameIdx = cursor.getColumnIndex(OpenableColumns.DISPLAY_NAME)
                    if (nameIdx >= 0 && !cursor.isNull(nameIdx)) {
                        displayName = cursor.getString(nameIdx)
                    }
                    val sizeIdx = cursor.getColumnIndex(OpenableColumns.SIZE)
                    if (sizeIdx >= 0 && !cursor.isNull(sizeIdx)) {
                        byteSize = cursor.getLong(sizeIdx)
                    }
                }
            }

            if (byteSize <= 0L) {
                try {
                    context.contentResolver.openAssetFileDescriptor(uri, "r")?.use { afd ->
                        if (afd.length > 0L) {
                            byteSize = afd.length
                        }
                    }
                } catch (_: Exception) {
                }
            }

            // Verify stream can be opened without reading bytes
            if (byteSize < 0L) {
                val canOpen = try {
                    context.contentResolver.openInputStream(uri)?.use { true } ?: false
                } catch (_: Exception) {
                    false
                }
                if (!canOpen) return null
                byteSize = 0L
            }

            val mime = context.contentResolver.getType(uri) ?: "application/octet-stream"
            val rawName = displayName?.takeIf { it.isNotBlank() }
                ?: uri.lastPathSegment?.substringAfterLast('/')?.takeIf { it.isNotBlank() }
                ?: "file_$fallbackTimestampMs"
            val hasExt = rawName.contains('.') && rawName.substringAfterLast('.', "").isNotBlank()

            val finalName = if (hasExt) {
                rawName
            } else {
                val guessedExt = MimeTypeMap.getSingleton().getExtensionFromMimeType(mime)?.lowercase(Locale.ROOT)
                val ext = when {
                    !guessedExt.isNullOrBlank() -> guessedExt
                    mime.startsWith("image/") -> "jpg"
                    mime.startsWith("video/") -> "mp4"
                    mime.startsWith("audio/") -> "mp3"
                    mime == "application/pdf" -> "pdf"
                    mime == "application/zip" -> "zip"
                    else -> "bin"
                }
                "$rawName.$ext"
            }

            PreparedUploadUri(
                uri = uri,
                displayName = finalName,
                mimeType = mime,
                sizeBytes = byteSize.coerceAtLeast(0L),
                timestampMs = fallbackTimestampMs
            )
        } catch (_: Exception) {
            null
        }
    }

    suspend fun moveToTrash(filename: String): Boolean = withContext(Dispatchers.IO) {
        try {
            val encoded = URLEncoder.encode(filename, "UTF-8").replace("+", "%20")
            val request = Request.Builder()
                .url("${cleanBaseUrl()}/trash/$encoded")
                .header("Accept", "application/json")
                .post("{}".toRequestBody("application/json".toMediaTypeOrNull()))
                .build()
            httpClient.newCall(request).execute().use { response ->
                if (response.isSuccessful) {
                    bitmapCache.remove("false:$filename")
                    diskCacheFile(filename, false).delete()
                    true
                } else false
            }
        } catch (_: Exception) {
            false
        }
    }

    suspend fun moveBatchToTrash(filenames: List<String>): Boolean = withContext(Dispatchers.IO) {
        try {
            val arr = JSONArray()
            filenames.forEach { arr.put(it) }
            val payload = JSONObject().put("filenames", arr).toString()

            val request = Request.Builder()
                .url("${cleanBaseUrl()}/trash/batch")
                .header("Accept", "application/json")
                .post(payload.toRequestBody("application/json".toMediaTypeOrNull()))
                .build()

            httpClient.newCall(request).execute().use { response ->
                if (response.isSuccessful) {
                    filenames.forEach {
                        bitmapCache.remove("false:$it")
                        diskCacheFile(it, false).delete()
                    }
                    true
                } else false
            }
        } catch (_: Exception) {
            false
        }
    }

    suspend fun restoreFromTrash(filename: String): Boolean = withContext(Dispatchers.IO) {
        try {
            val encoded = URLEncoder.encode(filename, "UTF-8").replace("+", "%20")
            val request = Request.Builder()
                .url("${cleanBaseUrl()}/restore/$encoded")
                .header("Accept", "application/json")
                .post("{}".toRequestBody("application/json".toMediaTypeOrNull()))
                .build()
            httpClient.newCall(request).execute().use { response ->
                if (response.isSuccessful) {
                    bitmapCache.remove("true:$filename")
                    diskCacheFile(filename, true).delete()
                    true
                } else false
            }
        } catch (_: Exception) {
            false
        }
    }

    suspend fun deletePermanent(filename: String): Boolean = withContext(Dispatchers.IO) {
        try {
            val encoded = URLEncoder.encode(filename, "UTF-8").replace("+", "%20")
            val request = Request.Builder()
                .url("${cleanBaseUrl()}/delete_permanent/$encoded")
                .header("Accept", "application/json")
                .post("{}".toRequestBody("application/json".toMediaTypeOrNull()))
                .build()
            httpClient.newCall(request).execute().use { response ->
                if (response.isSuccessful) {
                    bitmapCache.remove("true:$filename")
                    diskCacheFile(filename, true).delete()
                    true
                } else false
            }
        } catch (_: Exception) {
            false
        }
    }

    suspend fun emptyTrash(): Boolean = withContext(Dispatchers.IO) {
        try {
            val request = Request.Builder()
                .url("${cleanBaseUrl()}/empty_trash")
                .header("Accept", "application/json")
                .post("{}".toRequestBody("application/json".toMediaTypeOrNull()))
                .build()
            httpClient.newCall(request).execute().use { resp ->
                if (resp.isSuccessful) {
                    saveCachedTrashItems(emptyList())
                    true
                } else false
            }
        } catch (_: Exception) {
            false
        }
    }

    suspend fun findDuplicates(): List<List<String>> = withContext(Dispatchers.IO) {
        try {
            val request = Request.Builder()
                .url("${cleanBaseUrl()}/find_duplicates_server")
                .post("{}".toRequestBody("application/json".toMediaTypeOrNull()))
                .build()
            httpClient.newCall(request).execute().use { response ->
                if (!response.isSuccessful) return@withContext emptyList()
                val body = response.body?.string() ?: return@withContext emptyList()
                val json = JSONObject(body)
                val groupsArr = json.optJSONArray("duplicates") ?: return@withContext emptyList()
                val groups = mutableListOf<List<String>>()
                for (i in 0 until groupsArr.length()) {
                    val sub = groupsArr.optJSONArray(i) ?: continue
                    val list = mutableListOf<String>()
                    for (j in 0 until sub.length()) {
                        list.add(sub.optString(j))
                    }
                    if (list.size > 1) groups.add(list)
                }
                groups
            }
        } catch (_: Exception) {
            emptyList()
        }
    }

    suspend fun downloadZipToDevice(
        filenames: List<String>,
        directoryMode: DownloadDirectoryMode = getDownloadDirectoryMode(),
        customSubfolder: String = getCustomDownloadSubfolder(),
        customTreeUri: String = getCustomSafTreeUri(),
        onTransferUpdate: (TransferOperation) -> Unit = {}
    ): Pair<Boolean, String> = withContext(Dispatchers.IO) {
        val opId = "dl_zip_${System.currentTimeMillis()}"
        val controlHandle = registerTransferHandle(opId)
        val opTitle = "Archivio ZIP (${filenames.size} file)"
        val startTimeMs = System.currentTimeMillis()

        onTransferUpdate(
            TransferOperation(
                id = opId,
                title = opTitle,
                isUpload = false,
                transferredBytes = 0L,
                totalBytes = 0L,
                speedBytesPerSec = 0L,
                status = TransferStatus.RUNNING,
                detail = "Compressione cifrata sul server..."
            )
        )

        try {
            controlHandle.awaitIfPausedSuspend()
            val arr = JSONArray()
            filenames.forEach { arr.put(it) }
            val payload = JSONObject().put("filenames", arr).toString()

            val prepReq = Request.Builder()
                .url("${cleanBaseUrl()}/prepare-zip")
                .post(payload.toRequestBody("application/json".toMediaTypeOrNull()))
                .build()

            val prepCall = httpClient.newCall(prepReq)
            controlHandle.registerCall(prepCall)
            val taskId = try {
                prepCall.execute().use { resp ->
                    if (!resp.isSuccessful) {
                        onTransferUpdate(
                            TransferOperation(
                                id = opId,
                                title = opTitle,
                                isUpload = false,
                                transferredBytes = 0L,
                                totalBytes = 0L,
                                speedBytesPerSec = 0L,
                                status = TransferStatus.ERROR,
                                detail = "Errore preparazione ZIP"
                            )
                        )
                        return@withContext Pair(false, "Errore preparazione ZIP")
                    }
                    val obj = JSONObject(resp.body?.string() ?: "{}")
                    obj.optString("task_id", "")
                }
            } finally {
                controlHandle.unregisterCall(prepCall)
            }
            if (taskId.isBlank()) return@withContext Pair(false, "Task ID ZIP non valido")

            var zipFilename: String? = null
            var pollAttempts = 0
            while (pollAttempts < 120 && zipFilename.isNullOrBlank()) {
                if (controlHandle.isCancelled.get()) {
                    throw IOException("Trasferimento annullato")
                }
                if (controlHandle.isPaused.get()) {
                    onTransferUpdate(
                        TransferOperation(
                            id = opId,
                            title = opTitle,
                            isUpload = false,
                            transferredBytes = 0L,
                            totalBytes = 0L,
                            speedBytesPerSec = 0L,
                            status = TransferStatus.PAUSED,
                            detail = "In pausa"
                        )
                    )
                    controlHandle.awaitIfPausedSuspend()
                }
                pollAttempts++
                delay(700)
                val progReq = Request.Builder()
                    .url("${cleanBaseUrl()}/zip-progress/$taskId")
                    .get()
                    .build()
                val progCall = httpClient.newCall(progReq)
                controlHandle.registerCall(progCall)
                try {
                    progCall.execute().use { resp ->
                        if (resp.isSuccessful) {
                            val obj = JSONObject(resp.body?.string() ?: "{}")
                            val status = obj.optString("status")
                            val processedBytes = obj.optLong("processedBytes", 0L)
                            val totalBytes = obj.optLong("totalBytes", 0L)
                            val progressPct = obj.optInt("progress", 0)
                            val elapsedSec = max(0.2, (System.currentTimeMillis() - startTimeMs) / 1000.0)
                            val speed = if (processedBytes > 0L) (processedBytes / elapsedSec).toLong() else 0L

                            onTransferUpdate(
                                TransferOperation(
                                    id = opId,
                                    title = opTitle,
                                    isUpload = false,
                                    transferredBytes = processedBytes,
                                    totalBytes = totalBytes,
                                    speedBytesPerSec = if (controlHandle.isPaused.get()) 0L else speed,
                                    status = if (controlHandle.isPaused.get()) TransferStatus.PAUSED else TransferStatus.RUNNING,
                                    detail = if (controlHandle.isPaused.get()) "In pausa" else "Preparazione ZIP ($progressPct%)..."
                                )
                            )

                            if (status == "complete") {
                                zipFilename = obj.optString("filename")
                            } else if (status == "error") {
                                val errMsg = obj.optString("error", "Errore ZIP")
                                onTransferUpdate(
                                    TransferOperation(
                                        id = opId,
                                        title = opTitle,
                                        isUpload = false,
                                        transferredBytes = 0L,
                                        totalBytes = 0L,
                                        speedBytesPerSec = 0L,
                                        status = TransferStatus.ERROR,
                                        detail = errMsg
                                    )
                                )
                                return@withContext Pair(false, errMsg)
                            }
                        }
                    }
                } finally {
                    controlHandle.unregisterCall(progCall)
                }
            }

            val finalZip = zipFilename ?: return@withContext Pair(false, "Timeout creazione ZIP")
            controlHandle.awaitIfPausedSuspend()

            val dlReq = Request.Builder()
                .url("${cleanBaseUrl()}/download-zip/$finalZip")
                .get()
                .build()

            val dlStartMs = System.currentTimeMillis()
            val dlCall = httpClient.newCall(dlReq)
            controlHandle.registerCall(dlCall)
            try {
                dlCall.execute().use { resp ->
                    if (!resp.isSuccessful) return@withContext Pair(false, "Errore download ZIP")
                    val body = resp.body ?: return@withContext Pair(false, "ZIP vuoto")
                    val contentLen = body.contentLength().coerceAtLeast(0L)
                    val savedName = "PhotoCloud_${System.currentTimeMillis()}.zip"
                    var lastEmit = 0L

                    val effectiveMode = if (directoryMode == DownloadDirectoryMode.AUTO_BY_TYPE) {
                        getFileDownloadDirMode()
                    } else {
                        directoryMode
                    }

                    val (ok, writtenBytes, destDesc) = saveStreamToTargetDirectory(
                        context = context,
                        filename = savedName,
                        inputStream = body.byteStream(),
                        mimeType = "application/zip",
                        directoryMode = effectiveMode,
                        customSubfolder = customSubfolder,
                        customTreeUri = customTreeUri,
                        controlHandle = controlHandle
                    ) { downloaded ->
                        val now = System.currentTimeMillis()
                        if (now - lastEmit >= 120L) {
                            lastEmit = now
                            val elapsed = max(0.15, (now - dlStartMs) / 1000.0)
                            val speed = if (controlHandle.isPaused.get()) 0L else (downloaded / elapsed).toLong()
                            onTransferUpdate(
                                TransferOperation(
                                    id = opId,
                                    title = opTitle,
                                    isUpload = false,
                                    transferredBytes = downloaded,
                                    totalBytes = if (contentLen > 0L) contentLen else downloaded,
                                    speedBytesPerSec = speed,
                                    status = if (controlHandle.isPaused.get()) TransferStatus.PAUSED else TransferStatus.RUNNING,
                                    detail = if (controlHandle.isPaused.get()) "In pausa" else "Scaricamento pacchetto ZIP..."
                                )
                            )
                        }
                    }

                    val elapsed = max(0.2, (System.currentTimeMillis() - dlStartMs) / 1000.0)
                    val finalSpeed = (writtenBytes / elapsed).toLong()

                    onTransferUpdate(
                        TransferOperation(
                            id = opId,
                            title = opTitle,
                            isUpload = false,
                            transferredBytes = writtenBytes,
                            totalBytes = writtenBytes,
                            speedBytesPerSec = finalSpeed,
                            status = if (ok) TransferStatus.COMPLETED else TransferStatus.ERROR,
                            detail = if (ok) "Salvato in $destDesc: $savedName" else "Errore salvataggio"
                        )
                    )

                    if (ok) Pair(true, "Salvato in $destDesc: $savedName")
                    else Pair(false, "Impossibile salvare lo ZIP in $destDesc")
                }
            } finally {
                controlHandle.unregisterCall(dlCall)
            }
        } catch (e: Exception) {
            if (controlHandle.isCancelled.get()) {
                onTransferUpdate(
                    TransferOperation(
                        id = opId,
                        title = opTitle,
                        isUpload = false,
                        transferredBytes = 0L,
                        totalBytes = 0L,
                        speedBytesPerSec = 0L,
                        status = TransferStatus.CANCELLED,
                        detail = "Annullato dall'utente"
                    )
                )
                return@withContext Pair(false, "Download annullato")
            }
            onTransferUpdate(
                TransferOperation(
                    id = opId,
                    title = opTitle,
                    isUpload = false,
                    transferredBytes = 0L,
                    totalBytes = 0L,
                    speedBytesPerSec = 0L,
                    status = TransferStatus.ERROR,
                    detail = e.localizedMessage ?: "Errore"
                )
            )
            Pair(false, "Errore esportazione ZIP: ${e.localizedMessage}")
        } finally {
            unregisterTransferHandle(opId)
        }
    }

    /**
     * Downloads multiple selected photos, videos, or files directly into device storage as individual files
     * in parallel (bounded by [maxParallelTransfers]), routing each file to its configured or auto-by-type
     * target directory (Pictures/PhotoCloud, Movies/PhotoCloud, Music/PhotoCloud, Documents/PhotoCloud,
     * Download/PhotoCloud, or a user-selected SAF folder). Supports real-time pause, resume, and cancel.
     */
    suspend fun downloadMultipleDirectToDevice(
        filenames: List<String>,
        fromTrash: Boolean = false,
        directoryMode: DownloadDirectoryMode = getDownloadDirectoryMode(),
        photoDirMode: DownloadDirectoryMode = getPhotoDownloadDirMode(),
        videoDirMode: DownloadDirectoryMode = getVideoDownloadDirMode(),
        fileDirMode: DownloadDirectoryMode = getFileDownloadDirMode(),
        customSubfolder: String = getCustomDownloadSubfolder(),
        customTreeUri: String = getCustomSafTreeUri(),
        maxParallelTransfers: Int = getMaxParallelTransfers(),
        onTransferUpdate: (TransferOperation) -> Unit = {}
    ): Pair<Boolean, String> = withContext(Dispatchers.IO) {
        if (filenames.isEmpty()) return@withContext Pair(false, "Nessun file selezionato")
        if (filenames.size == 1) {
            return@withContext saveSingleMediaToDownloads(
                filename = filenames.first(),
                fromTrash = fromTrash,
                directoryMode = directoryMode,
                photoDirMode = photoDirMode,
                videoDirMode = videoDirMode,
                fileDirMode = fileDirMode,
                customSubfolder = customSubfolder,
                customTreeUri = customTreeUri,
                onTransferUpdate = onTransferUpdate
            )
        }

        val parallelLimit = maxParallelTransfers.coerceIn(1, 16)
        val totalFiles = filenames.size
        val opId = "dl_direct_${System.currentTimeMillis()}"
        val controlHandle = registerTransferHandle(opId)
        val opTitle = "Download diretto ($totalFiles file • ${parallelLimit}x)"
        val startMs = System.currentTimeMillis()

        val emitLock = Any()
        val lastEmitMs = AtomicLong(0L)
        val fileBytesMap = ConcurrentHashMap<Int, Long>()
        val fileTotalsMap = ConcurrentHashMap<Int, Long>()
        val completedCount = AtomicInteger(0)
        val failedCount = AtomicInteger(0)
        val lastSavedFolder = AtomicReference("Memoria dispositivo")

        fun emitDirectProgress(force: Boolean = false, status: TransferStatus? = null, customDetail: String? = null) {
            val now = System.currentTimeMillis()
            val prev = lastEmitMs.get()
            if (!force && now - prev < 100L) return
            if (!force && !lastEmitMs.compareAndSet(prev, now)) return
            if (force) lastEmitMs.set(now)

            val effectiveStatus = status ?: when {
                controlHandle.isCancelled.get() -> TransferStatus.CANCELLED
                controlHandle.isPaused.get() -> TransferStatus.PAUSED
                else -> TransferStatus.RUNNING
            }

            var sumTransferred = 0L
            for (v in fileBytesMap.values) sumTransferred += v
            var sumKnownTotals = 0L
            for (v in fileTotalsMap.values) sumKnownTotals += v
            val estimatedTotal = max(sumKnownTotals, sumTransferred.coerceAtLeast(totalFiles * 1024L))
            val elapsedSec = max(0.15, (now - startMs) / 1000.0)
            val speed = if (effectiveStatus == TransferStatus.PAUSED) 0L else (sumTransferred / elapsedSec).toLong()
            val done = completedCount.get().coerceIn(0, totalFiles)

            val detailStr = customDetail ?: when (effectiveStatus) {
                TransferStatus.PAUSED -> "In pausa ($done / $totalFiles file)"
                TransferStatus.CANCELLED -> "Annullato"
                else -> "$done / $totalFiles file salvati (${parallelLimit}x paralleli)"
            }

            synchronized(emitLock) {
                onTransferUpdate(
                    TransferOperation(
                        id = opId,
                        title = opTitle,
                        isUpload = false,
                        transferredBytes = sumTransferred,
                        totalBytes = if (effectiveStatus == TransferStatus.COMPLETED) sumTransferred else estimatedTotal,
                        speedBytesPerSec = speed,
                        status = effectiveStatus,
                        detail = detailStr
                    )
                )
            }
        }

        emitDirectProgress(force = true, status = TransferStatus.RUNNING, customDetail = "0 / $totalFiles file (${parallelLimit}x paralleli)")

        try {
            val semaphore = Semaphore(parallelLimit)

            coroutineScope {
                filenames.mapIndexed { idx, fname ->
                    async(Dispatchers.IO) {
                        semaphore.withPermit {
                            if (controlHandle.isCancelled.get()) return@withPermit
                            controlHandle.awaitIfPausedSuspend()

                            try {
                                val req = Request.Builder()
                                    .url(getMediaUrl(fname, fromTrash, download = true))
                                    .get()
                                    .build()
                                val call = httpClient.newCall(req)
                                controlHandle.registerCall(call)
                                try {
                                    call.execute().use { resp ->
                                        if (!resp.isSuccessful) {
                                            failedCount.incrementAndGet()
                                            emitDirectProgress(force = true)
                                            return@use
                                        }
                                        val body = resp.body
                                        if (body == null) {
                                            failedCount.incrementAndGet()
                                            emitDirectProgress(force = true)
                                            return@use
                                        }
                                        val contentLen = body.contentLength().coerceAtLeast(0L)
                                        if (contentLen > 0L) {
                                            fileTotalsMap[idx] = contentLen
                                        }
                                        val mime = resp.header("Content-Type") ?: resolveViewerSpec(fname).mimeType
                                        val effectiveDirMode = resolveEffectiveDirectoryMode(
                                            filename = fname,
                                            mimeType = mime,
                                            globalMode = directoryMode,
                                            photoDirMode = photoDirMode,
                                            videoDirMode = videoDirMode,
                                            fileDirMode = fileDirMode
                                        )

                                        val (ok, written, destLabel) = saveStreamToTargetDirectory(
                                            context = context,
                                            filename = fname,
                                            inputStream = body.byteStream(),
                                            mimeType = mime,
                                            directoryMode = effectiveDirMode,
                                            customSubfolder = customSubfolder,
                                            customTreeUri = customTreeUri,
                                            controlHandle = controlHandle
                                        ) { downloaded ->
                                            fileBytesMap[idx] = downloaded
                                            if (contentLen <= 0L) fileTotalsMap[idx] = downloaded
                                            emitDirectProgress(force = false)
                                        }

                                        if (ok) {
                                            fileBytesMap[idx] = written
                                            fileTotalsMap[idx] = written
                                            lastSavedFolder.set(destLabel)
                                            completedCount.incrementAndGet()
                                        } else {
                                            failedCount.incrementAndGet()
                                        }
                                        emitDirectProgress(force = true)
                                    }
                                } finally {
                                    controlHandle.unregisterCall(call)
                                }
                            } catch (e: Exception) {
                                if (!controlHandle.isCancelled.get()) {
                                    failedCount.incrementAndGet()
                                    emitDirectProgress(force = true)
                                }
                            }
                        }
                    }
                }.awaitAll()
            }

            if (controlHandle.isCancelled.get()) {
                emitDirectProgress(force = true, status = TransferStatus.CANCELLED, customDetail = "Download annullato")
                return@withContext Pair(false, "Download annullato")
            }

            val okFiles = completedCount.get()
            val errFiles = failedCount.get()
            if (okFiles == 0) {
                emitDirectProgress(force = true, status = TransferStatus.ERROR, customDetail = "Errore salvataggio file")
                return@withContext Pair(false, "Impossibile scaricare i file selezionati")
            }

            val destSummary = if (directoryMode == DownloadDirectoryMode.AUTO_BY_TYPE) {
                "nelle cartelle per tipo (${customSubfolder.ifBlank { "PhotoCloud" }})"
            } else {
                "in ${lastSavedFolder.get()}"
            }
            val msg = if (errFiles > 0) {
                "$okFiles / $totalFiles file salvati $destSummary ($errFiles errori)"
            } else {
                "$okFiles file salvati direttamente $destSummary"
            }

            emitDirectProgress(force = true, status = TransferStatus.COMPLETED, customDetail = msg)
            Pair(true, msg)
        } catch (e: Exception) {
            if (controlHandle.isCancelled.get()) {
                emitDirectProgress(force = true, status = TransferStatus.CANCELLED, customDetail = "Download annullato")
                return@withContext Pair(false, "Download annullato")
            }
            val err = e.localizedMessage ?: "Errore download multiplo"
            emitDirectProgress(force = true, status = TransferStatus.ERROR, customDetail = err)
            Pair(false, err)
        } finally {
            unregisterTransferHandle(opId)
        }
    }

    suspend fun saveSingleMediaToDownloads(
        filename: String,
        fromTrash: Boolean = false,
        directoryMode: DownloadDirectoryMode = getDownloadDirectoryMode(),
        photoDirMode: DownloadDirectoryMode = getPhotoDownloadDirMode(),
        videoDirMode: DownloadDirectoryMode = getVideoDownloadDirMode(),
        fileDirMode: DownloadDirectoryMode = getFileDownloadDirMode(),
        customSubfolder: String = getCustomDownloadSubfolder(),
        customTreeUri: String = getCustomSafTreeUri(),
        onTransferUpdate: (TransferOperation) -> Unit = {}
    ): Pair<Boolean, String> = withContext(Dispatchers.IO) {
        val opId = "dl_${System.currentTimeMillis()}_${filename.hashCode()}"
        val controlHandle = registerTransferHandle(opId)
        val startMs = System.currentTimeMillis()

        onTransferUpdate(
            TransferOperation(
                id = opId,
                title = filename,
                isUpload = false,
                transferredBytes = 0L,
                totalBytes = 0L,
                speedBytesPerSec = 0L,
                status = TransferStatus.RUNNING,
                detail = "Avvio download..."
            )
        )

        try {
            controlHandle.awaitIfPausedSuspend()
            val request = Request.Builder()
                .url(getMediaUrl(filename, fromTrash, download = true))
                .get()
                .build()
            val call = httpClient.newCall(request)
            controlHandle.registerCall(call)
            try {
                call.execute().use { resp ->
                    if (!resp.isSuccessful) {
                        onTransferUpdate(
                            TransferOperation(
                                id = opId,
                                title = filename,
                                isUpload = false,
                                transferredBytes = 0L,
                                totalBytes = 0L,
                                speedBytesPerSec = 0L,
                                status = TransferStatus.ERROR,
                                detail = "Errore HTTP ${resp.code}"
                            )
                        )
                        return@withContext Pair(false, "Errore download file")
                    }
                    val body = resp.body ?: return@withContext Pair(false, "File vuoto")
                    val totalLen = body.contentLength().coerceAtLeast(0L)
                    val mime = resp.header("Content-Type") ?: resolveViewerSpec(filename).mimeType
                    var lastEmit = 0L

                    val effectiveDirMode = resolveEffectiveDirectoryMode(
                        filename = filename,
                        mimeType = mime,
                        globalMode = directoryMode,
                        photoDirMode = photoDirMode,
                        videoDirMode = videoDirMode,
                        fileDirMode = fileDirMode
                    )

                    val (ok, writtenBytes, destDesc) = saveStreamToTargetDirectory(
                        context = context,
                        filename = filename,
                        inputStream = body.byteStream(),
                        mimeType = mime,
                        directoryMode = effectiveDirMode,
                        customSubfolder = customSubfolder,
                        customTreeUri = customTreeUri,
                        controlHandle = controlHandle
                    ) { downloaded ->
                        val now = System.currentTimeMillis()
                        if (now - lastEmit >= 100L) {
                            lastEmit = now
                            val elapsed = max(0.15, (now - startMs) / 1000.0)
                            val speed = if (controlHandle.isPaused.get()) 0L else (downloaded / elapsed).toLong()
                            onTransferUpdate(
                                TransferOperation(
                                    id = opId,
                                    title = filename,
                                    isUpload = false,
                                    transferredBytes = downloaded,
                                    totalBytes = if (totalLen > 0L) totalLen else downloaded,
                                    speedBytesPerSec = speed,
                                    status = if (controlHandle.isPaused.get()) TransferStatus.PAUSED else TransferStatus.RUNNING,
                                    detail = if (controlHandle.isPaused.get()) "In pausa" else "In scaricamento..."
                                )
                            )
                        }
                    }

                    val elapsed = max(0.15, (System.currentTimeMillis() - startMs) / 1000.0)
                    val speed = (writtenBytes / elapsed).toLong()

                    onTransferUpdate(
                        TransferOperation(
                            id = opId,
                            title = filename,
                            isUpload = false,
                            transferredBytes = writtenBytes,
                            totalBytes = writtenBytes,
                            speedBytesPerSec = speed,
                            status = if (ok) TransferStatus.COMPLETED else TransferStatus.ERROR,
                            detail = if (ok) "Salvato in $destDesc" else "Errore salvataggio"
                        )
                    )

                    if (ok) Pair(true, "Salvato in $destDesc: $filename")
                    else Pair(false, "Errore salvataggio in $destDesc")
                }
            } finally {
                controlHandle.unregisterCall(call)
            }
        } catch (e: Exception) {
            if (controlHandle.isCancelled.get()) {
                onTransferUpdate(
                    TransferOperation(
                        id = opId,
                        title = filename,
                        isUpload = false,
                        transferredBytes = 0L,
                        totalBytes = 0L,
                        speedBytesPerSec = 0L,
                        status = TransferStatus.CANCELLED,
                        detail = "Annullato dall'utente"
                    )
                )
                return@withContext Pair(false, "Download annullato")
            }
            onTransferUpdate(
                TransferOperation(
                    id = opId,
                    title = filename,
                    isUpload = false,
                    transferredBytes = 0L,
                    totalBytes = 0L,
                    speedBytesPerSec = 0L,
                    status = TransferStatus.ERROR,
                    detail = e.localizedMessage ?: "Errore"
                )
            )
            Pair(false, "Errore: ${e.localizedMessage}")
        } finally {
            unregisterTransferHandle(opId)
        }
    }

    /**
     * Downloads a file into the app's private cache directory (preserving its extension)
     * so it can be rendered by PdfRenderer, MediaPlayer, or shared via FileProvider content:// URI
     * without polluting the user's public Downloads folder.
     */
    suspend fun downloadFileToCache(
        filename: String,
        fromTrash: Boolean = false,
        onTransferUpdate: (TransferOperation) -> Unit = {}
    ): File? = withContext(Dispatchers.IO) {
        val targetFile = diskCacheFile(filename, fromTrash)
        if (targetFile.exists() && targetFile.length() > 0L) {
            return@withContext targetFile
        }

        val opId = "open_${System.currentTimeMillis()}_${filename.hashCode()}"
        val startMs = System.currentTimeMillis()

        onTransferUpdate(
            TransferOperation(
                id = opId,
                title = filename,
                isUpload = false,
                transferredBytes = 0L,
                totalBytes = 0L,
                speedBytesPerSec = 0L,
                status = TransferStatus.RUNNING,
                detail = "Apertura file..."
            )
        )

        try {
            val request = Request.Builder()
                .url(getMediaUrl(filename, fromTrash, download = false))
                .get()
                .build()

            httpClient.newCall(request).execute().use { resp ->
                if (!resp.isSuccessful) {
                    onTransferUpdate(
                        TransferOperation(
                            id = opId,
                            title = filename,
                            isUpload = false,
                            transferredBytes = 0L,
                            totalBytes = 0L,
                            speedBytesPerSec = 0L,
                            status = TransferStatus.ERROR,
                            detail = "Errore HTTP ${resp.code}"
                        )
                    )
                    return@withContext null
                }

                val body = resp.body ?: return@withContext null
                val totalLen = body.contentLength().coerceAtLeast(0L)
                val buf = ByteArray(16 * 1024)
                var downloaded = 0L
                var lastEmit = 0L

                FileOutputStream(targetFile).use { out ->
                    body.byteStream().use { input ->
                        var r: Int
                        while (input.read(buf).also { r = it } != -1) {
                            out.write(buf, 0, r)
                            downloaded += r
                            val now = System.currentTimeMillis()
                            if (now - lastEmit >= 120L) {
                                lastEmit = now
                                val elapsed = max(0.15, (now - startMs) / 1000.0)
                                val speed = (downloaded / elapsed).toLong()
                                onTransferUpdate(
                                    TransferOperation(
                                        id = opId,
                                        title = filename,
                                        isUpload = false,
                                        transferredBytes = downloaded,
                                        totalBytes = if (totalLen > 0L) totalLen else downloaded,
                                        speedBytesPerSec = speed,
                                        status = TransferStatus.RUNNING,
                                        detail = "Recupero documento..."
                                    )
                                )
                            }
                        }
                    }
                    out.flush()
                }

                val elapsed = max(0.15, (System.currentTimeMillis() - startMs) / 1000.0)
                val speed = (downloaded / elapsed).toLong()
                onTransferUpdate(
                    TransferOperation(
                        id = opId,
                        title = filename,
                        isUpload = false,
                        transferredBytes = downloaded,
                        totalBytes = downloaded,
                        speedBytesPerSec = speed,
                        status = TransferStatus.COMPLETED,
                        detail = "Pronto per la visualizzazione"
                    )
                )
                targetFile
            }
        } catch (e: Exception) {
            onTransferUpdate(
                TransferOperation(
                    id = opId,
                    title = filename,
                    isUpload = false,
                    transferredBytes = 0L,
                    totalBytes = 0L,
                    speedBytesPerSec = 0L,
                    status = TransferStatus.ERROR,
                    detail = e.localizedMessage ?: "Errore"
                )
            )
            null
        }
    }

    /**
     * Fetches the parsed document structure from /api/document-preview/:filename,
     * falling back to local cache extraction if the server endpoint is unavailable.
     */
    suspend fun fetchDocumentPreview(
        filename: String,
        fromTrash: Boolean = false,
        onTransferUpdate: (TransferOperation) -> Unit = {}
    ): DocumentPreviewModel? = withContext(Dispatchers.IO) {
        val spec = resolveViewerSpec(filename)
        try {
            val encoded = URLEncoder.encode(filename, "UTF-8").replace("+", "%20")
            val trashParam = if (fromTrash) "?from_trash=true" else ""
            val req = Request.Builder()
                .url("${cleanBaseUrl()}/api/document-preview/$encoded$trashParam")
                .header("Accept", "application/json")
                .get()
                .build()

            httpClient.newCall(req).execute().use { resp ->
                if (resp.isSuccessful) {
                    val bodyStr = resp.body?.string() ?: ""
                    if (bodyStr.trim().startsWith("{")) {
                        val json = JSONObject(bodyStr)
                        val blocks = mutableListOf<DocBlockModel>()
                        val blocksArr = json.optJSONArray("blocks")
                        if (blocksArr != null) {
                            for (i in 0 until blocksArr.length()) {
                                val b = blocksArr.optJSONObject(i) ?: continue
                                blocks.add(
                                    DocBlockModel(
                                        type = b.optString("type", "paragraph"),
                                        text = b.optString("text", ""),
                                        level = b.optInt("level", 1)
                                    )
                                )
                            }
                        }

                        val sheets = mutableListOf<DocSheetModel>()
                        val sheetsArr = json.optJSONArray("sheets")
                        if (sheetsArr != null) {
                            for (i in 0 until sheetsArr.length()) {
                                val s = sheetsArr.optJSONObject(i) ?: continue
                                val headers = mutableListOf<String>()
                                val hArr = s.optJSONArray("headers")
                                if (hArr != null) {
                                    for (j in 0 until hArr.length()) headers.add(hArr.optString(j, ""))
                                }
                                val rows = mutableListOf<List<String>>()
                                val rArr = s.optJSONArray("rows")
                                if (rArr != null) {
                                    for (rIdx in 0 until rArr.length()) {
                                        val rowJson = rArr.optJSONArray(rIdx) ?: continue
                                        val rowCells = mutableListOf<String>()
                                        for (cIdx in 0 until rowJson.length()) {
                                            rowCells.add(rowJson.optString(cIdx, ""))
                                        }
                                        rows.add(rowCells)
                                    }
                                }
                                sheets.add(
                                    DocSheetModel(
                                        name = s.optString("name", "Foglio ${i + 1}"),
                                        headers = headers,
                                        rows = rows,
                                        totalRows = s.optInt("totalRows", rows.size)
                                    )
                                )
                            }
                        }

                        val slides = mutableListOf<DocSlideModel>()
                        val slidesArr = json.optJSONArray("slides")
                        if (slidesArr != null) {
                            for (i in 0 until slidesArr.length()) {
                                val sl = slidesArr.optJSONObject(i) ?: continue
                                val bullets = mutableListOf<String>()
                                val bArr = sl.optJSONArray("bullets")
                                if (bArr != null) {
                                    for (j in 0 until bArr.length()) bullets.add(bArr.optString(j, ""))
                                }
                                slides.add(
                                    DocSlideModel(
                                        index = sl.optInt("index", i + 1),
                                        title = sl.optString("title", "Slide ${i + 1}"),
                                        bullets = bullets,
                                        notes = sl.optString("notes", "")
                                    )
                                )
                            }
                        }

                        val warnings = mutableListOf<String>()
                        val warnArr = json.optJSONArray("warnings")
                        if (warnArr != null) {
                            for (i in 0 until warnArr.length()) warnings.add(warnArr.optString(i, ""))
                        }

                        return@withContext DocumentPreviewModel(
                            filename = json.optString("filename", filename),
                            extension = json.optString("extension", spec.extension),
                            mimeType = json.optString("mimeType", spec.mimeType),
                            viewerType = json.optString("viewerType", spec.viewerType),
                            canOpenInApp = json.optBoolean("canOpenInApp", spec.canOpenInApp),
                            sizeBytes = json.optLong("sizeBytes", 0L),
                            title = json.optString("title", filename),
                            pageCount = json.optInt("pageCount", 1).coerceAtLeast(1),
                            blocks = blocks,
                            sheets = sheets,
                            slides = slides,
                            rawText = json.optString("rawText", ""),
                            warnings = warnings
                        )
                    }
                }
            }
        } catch (_: Exception) {
        }

        // Fallback: download file to cache and parse locally on Android
        val cachedFile = downloadFileToCache(filename, fromTrash, onTransferUpdate) ?: return@withContext null
        parseLocalFilePreview(cachedFile, filename, spec)
    }

    private fun parseLocalFilePreview(
        file: File,
        filename: String,
        spec: FileViewerSpecModel
    ): DocumentPreviewModel {
        val bytes = try {
            file.readBytes()
        } catch (_: Exception) {
            ByteArray(0)
        }

        val zipEntries = mutableMapOf<String, String>()
        if (bytes.size >= 4 && bytes[0] == 0x50.toByte() && bytes[1] == 0x4B.toByte()) {
            try {
                val maxEntryBytes = 5 * 1024 * 1024 // 5 MB max per XML entry (Zip Bomb defense)
                val maxEntries = 500
                var entryCount = 0
                ZipInputStream(ByteArrayInputStream(bytes)).use { zis ->
                    var entry = zis.nextEntry
                    while (entry != null && entryCount < maxEntries) {
                        entryCount++
                        val entryName = entry.name ?: ""
                        if (!entry.isDirectory && !entryName.contains("..") && (entryName.endsWith(".xml") || entryName.endsWith(".rels"))) {
                            val outBuf = java.io.ByteArrayOutputStream()
                            val chunk = ByteArray(8192)
                            var totalRead = 0
                            var r: Int
                            while (zis.read(chunk).also { r = it } != -1) {
                                totalRead += r
                                if (totalRead > maxEntryBytes) break
                                outBuf.write(chunk, 0, r)
                            }
                            if (totalRead <= maxEntryBytes) {
                                zipEntries[entryName] = outBuf.toByteArray().toString(Charsets.UTF_8)
                            }
                        }
                        entry = zis.nextEntry
                    }
                }
            } catch (_: Exception) {
            }
        }

        val blocks = mutableListOf<DocBlockModel>()
        val sheets = mutableListOf<DocSheetModel>()
        val slides = mutableListOf<DocSlideModel>()
        var rawText = ""

        when (spec.viewerType) {
            "word" -> {
                val docXml = zipEntries["word/document.xml"] ?: zipEntries["content.xml"] ?: ""
                if (docXml.isNotBlank()) {
                    val pMatches = Regex("<w:p[\\s>][\\s\\S]*?</w:p>|<text:p[^>]*>[\\s\\S]*?</text:p>").findAll(docXml)
                    for (m in pMatches) {
                        val stripped = m.value.replace(Regex("<[^>]+>"), "").trim()
                        if (stripped.isNotBlank()) {
                            blocks.add(DocBlockModel(type = "paragraph", text = stripped))
                        }
                    }
                } else {
                    val text = bytes.toString(Charsets.UTF_8)
                    text.lines().map { it.trim() }.filter { it.isNotBlank() }.take(500).forEach {
                        blocks.add(DocBlockModel(type = "paragraph", text = it))
                    }
                }
            }
            "spreadsheet" -> {
                val text = bytes.toString(Charsets.UTF_8)
                val lines = text.lines().filter { it.isNotBlank() }
                val rows = lines.map { it.split(if (spec.extension == "tsv") "\t" else ",") }
                val headers = rows.firstOrNull() ?: listOf("A")
                val dataRows = if (rows.size > 1) rows.drop(1) else emptyList()
                sheets.add(DocSheetModel("Foglio 1", headers, dataRows, dataRows.size))
            }
            "presentation" -> {
                val slideKeys = zipEntries.keys.filter { it.startsWith("ppt/slides/slide") && it.endsWith(".xml") }.sorted()
                slideKeys.forEachIndexed { idx, key ->
                    val xml = zipEntries[key] ?: ""
                    val texts = Regex("<a:t>([\\s\\S]*?)</a:t>").findAll(xml)
                        .map { it.groupValues[1].trim() }
                        .filter { it.isNotBlank() }
                        .toList()
                    slides.add(
                        DocSlideModel(
                            index = idx + 1,
                            title = texts.firstOrNull() ?: "Slide ${idx + 1}",
                            bullets = if (texts.size > 1) texts.drop(1) else emptyList()
                        )
                    )
                }
            }
            "text" -> {
                rawText = bytes.toString(Charsets.UTF_8)
            }
        }

        return DocumentPreviewModel(
            filename = filename,
            extension = spec.extension,
            mimeType = spec.mimeType,
            viewerType = spec.viewerType,
            canOpenInApp = spec.canOpenInApp,
            sizeBytes = file.length(),
            title = filename,
            pageCount = 1,
            blocks = blocks,
            sheets = sheets,
            slides = slides,
            rawText = rawText
        )
    }

    companion object {
        fun resolveViewerSpec(filename: String): FileViewerSpecModel {
            val ext = filename.substringAfterLast('.', "").lowercase(Locale.ROOT)
            return when (ext) {
                "pdf" -> FileViewerSpecModel(ext, "application/pdf", "pdf", true, "Documento PDF")
                "doc" -> FileViewerSpecModel(ext, "application/msword", "word", true, "Documento Word")
                "docx" -> FileViewerSpecModel(ext, "application/vnd.openxmlformats-officedocument.wordprocessingml.document", "word", true, "Documento Word")
                "odt" -> FileViewerSpecModel(ext, "application/vnd.oasis.opendocument.text", "word", true, "Documento OpenDocument")
                "rtf" -> FileViewerSpecModel(ext, "application/rtf", "word", true, "Documento RTF")
                "xls" -> FileViewerSpecModel(ext, "application/vnd.ms-excel", "spreadsheet", true, "Foglio Excel")
                "xlsx" -> FileViewerSpecModel(ext, "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", "spreadsheet", true, "Foglio Excel")
                "ods" -> FileViewerSpecModel(ext, "application/vnd.oasis.opendocument.spreadsheet", "spreadsheet", true, "Foglio OpenDocument")
                "csv" -> FileViewerSpecModel(ext, "text/csv", "spreadsheet", true, "Tabella CSV")
                "tsv" -> FileViewerSpecModel(ext, "text/tab-separated-values", "spreadsheet", true, "Tabella TSV")
                "ppt" -> FileViewerSpecModel(ext, "application/vnd.ms-powerpoint", "presentation", true, "Presentazione PowerPoint")
                "pptx" -> FileViewerSpecModel(ext, "application/vnd.openxmlformats-officedocument.presentationml.presentation", "presentation", true, "Presentazione PowerPoint")
                "odp" -> FileViewerSpecModel(ext, "application/vnd.oasis.opendocument.presentation", "presentation", true, "Presentazione OpenDocument")
                "txt", "md", "markdown", "log", "ini", "conf", "json", "xml", "yaml", "yml", "html", "css", "js", "ts", "tsx", "jsx", "py", "kt", "java", "c", "cpp", "h", "sh", "sql" ->
                    FileViewerSpecModel(ext, "text/plain", "text", true, "Documento di Testo / Codice")
                "jpg", "jpeg", "png", "gif", "webp", "bmp", "svg", "heic", "heif", "avif" ->
                    FileViewerSpecModel(ext, "image/*", "image", true, "Immagine")
                "mp4", "mov", "webm", "mkv", "avi" ->
                    FileViewerSpecModel(ext, "video/*", "video", true, "Video")
                "mp3", "wav", "ogg", "m4a", "flac", "aac", "opus" ->
                    FileViewerSpecModel(ext, "audio/*", "audio", true, "Audio")
                "apk" -> FileViewerSpecModel(ext, "application/vnd.android.package-archive", "external", false, "Pacchetto Android APK")
                "zip" -> FileViewerSpecModel(ext, "application/zip", "external", false, "Archivio ZIP")
                "rar" -> FileViewerSpecModel(ext, "application/vnd.rar", "external", false, "Archivio RAR")
                "7z" -> FileViewerSpecModel(ext, "application/x-7z-compressed", "external", false, "Archivio 7-Zip")
                else -> {
                    val sysMime = MimeTypeMap.getSingleton().getMimeTypeFromExtension(ext) ?: "application/octet-stream"
                    FileViewerSpecModel(ext, sysMime, "external", false, if (ext.isNotBlank()) "File .${ext.uppercase(Locale.ROOT)}" else "File Binario")
                }
            }
        }

        /**
         * Opens a cached file using Android's native application chooser via a secure FileProvider
         * content:// URI (never file://). Returns true if the chooser/intent was launched, or false
         * if no compatible activity is available on the device.
         */
        fun openFileWithExternalAppChooser(
            context: Context,
            file: File,
            filename: String,
            mimeType: String
        ): Boolean {
            return try {
                val authority = "${context.packageName}.fileprovider"
                val contentUri: Uri = FileProvider.getUriForFile(context, authority, file)
                val resolvedMime = if (mimeType.isBlank() || mimeType == "*/*") {
                    resolveViewerSpec(filename).mimeType
                } else {
                    mimeType
                }

                val viewIntent = Intent(Intent.ACTION_VIEW).apply {
                    setDataAndType(contentUri, resolvedMime)
                    addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION)
                    addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
                }

                val pm = context.packageManager
                val handlers = pm.queryIntentActivities(viewIntent, 0)
                if (handlers.isEmpty()) {
                    return false
                }

                val chooser = Intent.createChooser(viewIntent, "Apri $filename con...").apply {
                    addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
                    addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION)
                }
                context.startActivity(chooser)
                true
            } catch (_: Exception) {
                false
            }
        }

        fun formatBytesHuman(bytes: Long): String {
            if (bytes <= 0L) return "0 B"
            if (bytes < 1024L) return "$bytes B"
            val kb = bytes / 1024.0
            if (kb < 1024.0) return String.format(Locale.ITALIAN, "%.1f KB", kb)
            val mb = kb / 1024.0
            if (mb < 1024.0) return String.format(Locale.ITALIAN, "%.2f MB", mb)
            val gb = mb / 1024.0
            return String.format(Locale.ITALIAN, "%.2f GB", gb)
        }

        fun formatSpeedHuman(bytesPerSec: Long): String {
            if (bytesPerSec <= 0L) return "0 KB/s"
            return "${formatBytesHuman(bytesPerSec)}/s"
        }

        fun sanitizeSubfolderName(raw: String): String {
            val cleaned = raw.trim()
                .replace("..", "")
                .replace("\\", "/")
                .trim('/')
                .replace(Regex("[^a-zA-Z0-9._\\-/ ]"), "_")
                .take(64)
                .trim()
            return cleaned.ifBlank { "PhotoCloud" }
        }

        fun resolveEffectiveDirectoryMode(
            filename: String,
            mimeType: String,
            globalMode: DownloadDirectoryMode,
            photoDirMode: DownloadDirectoryMode = DownloadDirectoryMode.PICTURES,
            videoDirMode: DownloadDirectoryMode = DownloadDirectoryMode.MOVIES,
            fileDirMode: DownloadDirectoryMode = DownloadDirectoryMode.DOWNLOADS
        ): DownloadDirectoryMode {
            if (globalMode != DownloadDirectoryMode.AUTO_BY_TYPE) {
                return globalMode
            }
            val isImg = MediaItemModel.detectIsImageFilename(filename) || mimeType.startsWith("image/")
            val isVid = MediaItemModel.detectIsVideoFilename(filename) || mimeType.startsWith("video/")
            val isAud = MediaItemModel.detectIsAudioFilename(filename) || mimeType.startsWith("audio/")

            return when {
                isImg -> if (photoDirMode == DownloadDirectoryMode.AUTO_BY_TYPE) DownloadDirectoryMode.PICTURES else photoDirMode
                isVid -> if (videoDirMode == DownloadDirectoryMode.AUTO_BY_TYPE) DownloadDirectoryMode.MOVIES else videoDirMode
                isAud -> DownloadDirectoryMode.MUSIC
                else -> if (fileDirMode == DownloadDirectoryMode.AUTO_BY_TYPE) DownloadDirectoryMode.DOWNLOADS else fileDirMode
            }
        }

        fun saveBytesToDownloads(
            context: Context,
            filename: String,
            bytes: ByteArray,
            mimeType: String
        ): Boolean {
            return saveStreamToDownloads(
                context = context,
                filename = filename,
                inputStream = ByteArrayInputStream(bytes),
                mimeType = mimeType
            ).first
        }

        fun saveStreamToDownloads(
            context: Context,
            filename: String,
            inputStream: InputStream,
            mimeType: String,
            onProgressBytes: (Long) -> Unit = {}
        ): Pair<Boolean, Long> {
            val res = saveStreamToTargetDirectory(
                context = context,
                filename = filename,
                inputStream = inputStream,
                mimeType = mimeType,
                directoryMode = DownloadDirectoryMode.DOWNLOADS,
                customSubfolder = "PhotoCloud",
                customTreeUri = "",
                controlHandle = null,
                onProgressBytes = onProgressBytes
            )
            return Pair(res.first, res.second)
        }

        /**
         * Streams an InputStream directly into the user's chosen directory (or category-based MediaStore collection:
         * Pictures, Movies, Music, Documents, Downloads, or SAF DocumentTree URI) in 32 KB chunks without OOM,
         * while honoring pause and cancel controls via [controlHandle].
         * Returns Triple(success, writtenBytes, humanReadableLocationLabel).
         */
        fun saveStreamToTargetDirectory(
            context: Context,
            filename: String,
            inputStream: InputStream,
            mimeType: String,
            directoryMode: DownloadDirectoryMode = DownloadDirectoryMode.AUTO_BY_TYPE,
            customSubfolder: String = "PhotoCloud",
            customTreeUri: String = "",
            controlHandle: TransferControlHandle? = null,
            onProgressBytes: (Long) -> Unit = {}
        ): Triple<Boolean, Long, String> {
            var totalWritten = 0L
            val safeSubfolder = sanitizeSubfolderName(customSubfolder)
            val resolvedMime = if (mimeType.isBlank() || mimeType == "*/*" || mimeType == "application/octet-stream") {
                val specMime = resolveViewerSpec(filename).mimeType
                if (specMime.endsWith("/*")) {
                    val ext = filename.substringAfterLast('.', "").lowercase(Locale.ROOT)
                    MimeTypeMap.getSingleton().getMimeTypeFromExtension(ext) ?: mimeType.ifBlank { "application/octet-stream" }
                } else {
                    specMime
                }
            } else {
                mimeType
            }

            return try {
                val buf = ByteArray(32 * 1024)

                // 1. If user chose CUSTOM_FOLDER and selected a SAF tree URI via OpenDocumentTree:
                if (directoryMode == DownloadDirectoryMode.CUSTOM_FOLDER && customTreeUri.isNotBlank()) {
                    try {
                        val treeUri = Uri.parse(customTreeUri)
                        val docId = DocumentsContract.getTreeDocumentId(treeUri)
                        val parentDocUri = DocumentsContract.buildDocumentUriUsingTree(treeUri, docId)
                        val createdDocUri = DocumentsContract.createDocument(
                            context.contentResolver,
                            parentDocUri,
                            resolvedMime,
                            filename
                        )
                        if (createdDocUri != null) {
                            inputStream.use { input ->
                                context.contentResolver.openOutputStream(createdDocUri)?.use { out ->
                                    var r: Int
                                    while (input.read(buf).also { r = it } != -1) {
                                        controlHandle?.awaitIfPausedBlocking()
                                        out.write(buf, 0, r)
                                        totalWritten += r
                                        onProgressBytes(totalWritten)
                                    }
                                    out.flush()
                                } ?: return Triple(false, 0L, "Cartella personalizzata")
                            }
                            return Triple(true, totalWritten, "Cartella personalizzata")
                        }
                    } catch (e: IOException) {
                        if (controlHandle?.isCancelled?.get() == true) throw e
                        // Fallback to standard MediaStore subfolder below if SAF permission expired
                    } catch (_: Exception) {
                    }
                }

                val effectiveMode = if (directoryMode == DownloadDirectoryMode.AUTO_BY_TYPE) {
                    resolveEffectiveDirectoryMode(filename, resolvedMime, DownloadDirectoryMode.AUTO_BY_TYPE)
                } else {
                    directoryMode
                }

                val (baseEnvDir, humanLabel) = when (effectiveMode) {
                    DownloadDirectoryMode.PICTURES -> Pair(Environment.DIRECTORY_PICTURES, "Immagini/$safeSubfolder")
                    DownloadDirectoryMode.MOVIES -> Pair(Environment.DIRECTORY_MOVIES, "Video/$safeSubfolder")
                    DownloadDirectoryMode.MUSIC -> Pair(Environment.DIRECTORY_MUSIC, "Musica/$safeSubfolder")
                    DownloadDirectoryMode.DOCUMENTS -> Pair(Environment.DIRECTORY_DOCUMENTS, "Documenti/$safeSubfolder")
                    DownloadDirectoryMode.CUSTOM_FOLDER -> Pair(Environment.DIRECTORY_DOWNLOADS, "Download/$safeSubfolder")
                    else -> Pair(Environment.DIRECTORY_DOWNLOADS, "Download/$safeSubfolder")
                }

                if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
                    val resolver = context.contentResolver
                    val relativePath = "$baseEnvDir/$safeSubfolder"

                    val primaryCollectionUri: Uri = when (effectiveMode) {
                        DownloadDirectoryMode.PICTURES -> MediaStore.Images.Media.EXTERNAL_CONTENT_URI
                        DownloadDirectoryMode.MOVIES -> MediaStore.Video.Media.EXTERNAL_CONTENT_URI
                        DownloadDirectoryMode.MUSIC -> MediaStore.Audio.Media.EXTERNAL_CONTENT_URI
                        DownloadDirectoryMode.DOCUMENTS -> MediaStore.Files.getContentUri("external")
                        else -> MediaStore.Downloads.EXTERNAL_CONTENT_URI
                    }

                    val values = ContentValues().apply {
                        put(MediaStore.MediaColumns.DISPLAY_NAME, filename)
                        put(MediaStore.MediaColumns.MIME_TYPE, resolvedMime)
                        put(MediaStore.MediaColumns.RELATIVE_PATH, relativePath)
                        put(MediaStore.MediaColumns.IS_PENDING, 1)
                    }

                    var targetUri: Uri? = try {
                        resolver.insert(primaryCollectionUri, values)
                    } catch (_: Exception) {
                        null
                    }

                    var finalLabel = humanLabel
                    if (targetUri == null) {
                        // Fallback to MediaStore.Downloads so non-image/non-video MIME types never fail insertion
                        val fallbackValues = ContentValues().apply {
                            put(MediaStore.Downloads.DISPLAY_NAME, filename)
                            put(MediaStore.Downloads.MIME_TYPE, resolvedMime)
                            put(MediaStore.Downloads.RELATIVE_PATH, "${Environment.DIRECTORY_DOWNLOADS}/$safeSubfolder")
                            put(MediaStore.Downloads.IS_PENDING, 1)
                        }
                        targetUri = resolver.insert(MediaStore.Downloads.EXTERNAL_CONTENT_URI, fallbackValues)
                        finalLabel = "Download/$safeSubfolder"
                    }

                    val validUri = targetUri ?: return Triple(false, 0L, finalLabel)

                    try {
                        inputStream.use { input ->
                            resolver.openOutputStream(validUri)?.use { out ->
                                var r: Int
                                while (input.read(buf).also { r = it } != -1) {
                                    controlHandle?.awaitIfPausedBlocking()
                                    out.write(buf, 0, r)
                                    totalWritten += r
                                    onProgressBytes(totalWritten)
                                }
                                out.flush()
                            } ?: return Triple(false, 0L, finalLabel)
                        }
                        val completeValues = ContentValues().apply {
                            put(MediaStore.MediaColumns.IS_PENDING, 0)
                        }
                        resolver.update(validUri, completeValues, null, null)
                        Triple(true, totalWritten, finalLabel)
                    } catch (e: Exception) {
                        try {
                            resolver.delete(validUri, null, null)
                        } catch (_: Exception) {
                        }
                        throw e
                    }
                } else {
                    @Suppress("DEPRECATION")
                    val rootDir = Environment.getExternalStoragePublicDirectory(baseEnvDir)
                    val targetDir = File(rootDir, safeSubfolder)
                    if (!targetDir.exists()) targetDir.mkdirs()
                    val outFile = File(targetDir, filename)
                    try {
                        inputStream.use { input ->
                            FileOutputStream(outFile).use { out ->
                                var r: Int
                                while (input.read(buf).also { r = it } != -1) {
                                    controlHandle?.awaitIfPausedBlocking()
                                    out.write(buf, 0, r)
                                    totalWritten += r
                                    onProgressBytes(totalWritten)
                                }
                                out.flush()
                            }
                        }
                        Triple(true, totalWritten, humanLabel)
                    } catch (e: Exception) {
                        try {
                            if (outFile.exists()) outFile.delete()
                        } catch (_: Exception) {
                        }
                        throw e
                    }
                }
            } catch (e: IOException) {
                if (controlHandle?.isCancelled?.get() == true) throw e
                Triple(false, totalWritten, "Download/$safeSubfolder")
            } catch (_: Exception) {
                Triple(false, totalWritten, "Download/$safeSubfolder")
            }
        }
    }
}
