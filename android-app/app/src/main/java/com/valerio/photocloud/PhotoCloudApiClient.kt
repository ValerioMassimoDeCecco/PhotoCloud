package com.valerio.photocloud

import android.content.ContentValues
import android.content.Context
import android.graphics.Bitmap
import android.graphics.BitmapFactory
import android.net.Uri
import android.os.Build
import android.os.Environment
import android.provider.MediaStore
import android.provider.OpenableColumns
import android.util.LruCache
import android.webkit.MimeTypeMap
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.delay
import kotlinx.coroutines.withContext
import okhttp3.Cookie
import okhttp3.CookieJar
import okhttp3.FormBody
import okhttp3.HttpUrl
import okhttp3.MediaType
import okhttp3.MediaType.Companion.toMediaTypeOrNull
import okhttp3.MultipartBody
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.RequestBody
import okhttp3.RequestBody.Companion.toRequestBody
import okio.BufferedSink
import org.json.JSONArray
import org.json.JSONObject
import java.io.File
import java.io.FileOutputStream
import java.net.URLDecoder
import java.net.URLEncoder
import java.util.Locale
import java.util.concurrent.TimeUnit
import kotlin.math.max

enum class TransferStatus {
    RUNNING,
    COMPLETED,
    ERROR
}

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
        get() {
            val lower = filename.lowercase(Locale.ROOT)
            return lower.endsWith(".mp4") || lower.endsWith(".mov") || lower.endsWith(".webm") || lower.endsWith(".mkv")
        }

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
 * RequestBody wrapper that reports live upload progress and bytes written.
 */
class ProgressRequestBody(
    private val delegate: RequestBody,
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
        val buffer = ByteArray(16 * 1024)
        val outStream = sink.outputStream()
        // Write delegate into an in-memory buffer or pipe so we can chunk-report
        val tempBuffer = okio.Buffer()
        delegate.writeTo(tempBuffer)
        val totalBytes = if (total > 0L) total else tempBuffer.size
        var uploaded = 0L
        val inputStream = tempBuffer.inputStream()
        var read: Int
        while (inputStream.read(buffer).also { read = it } != -1) {
            outStream.write(buffer, 0, read)
            uploaded += read
            onBytesWritten(uploaded, totalBytes)
        }
        outStream.flush()
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

    val httpClient: OkHttpClient = OkHttpClient.Builder()
        .cookieJar(cookieJar)
        .followRedirects(true)
        .followSslRedirects(true)
        .connectTimeout(5, TimeUnit.SECONDS)
        .readTimeout(90, TimeUnit.SECONDS)
        .writeTimeout(90, TimeUnit.SECONDS)
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

    private fun diskCacheFile(filename: String, fromTrash: Boolean): File {
        val safeName = filename.replace(Regex("[^a-zA-Z0-9._-]"), "_")
        val prefix = if (fromTrash) "trash" else "gal"
        return File(diskCacheDir, "${prefix}_${safeName}")
    }

    fun getCachedBitmap(filename: String, fromTrash: Boolean = false): Bitmap? {
        val cacheKey = "$fromTrash:$filename"
        bitmapCache.get(cacheKey)?.let { return it }
        val diskFile = diskCacheFile(filename, fromTrash)
        if (diskFile.exists() && diskFile.length() > 0L) {
            try {
                val options = BitmapFactory.Options().apply {
                    inPreferredConfig = Bitmap.Config.ARGB_8888
                }
                val diskBmp = BitmapFactory.decodeFile(diskFile.absolutePath, options)
                if (diskBmp != null) {
                    bitmapCache.put(cacheKey, diskBmp)
                    return diskBmp
                }
            } catch (_: Exception) {
            }
        }
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
     * Uploads any files (photos, videos, PDFs, ZIPs, APKs, docs, audio, etc.) with real-time
     * byte progress, speed (bytes/sec), and total size reporting.
     */
    suspend fun uploadMediaUris(
        uris: List<Uri>,
        targetAlbum: String = "",
        onProgress: (Int, Int) -> Unit = { _, _ -> },
        onTransferUpdate: (TransferOperation) -> Unit = {}
    ): Pair<Boolean, String> = withContext(Dispatchers.IO) {
        if (uris.isEmpty()) return@withContext Pair(false, "Nessun file selezionato")

        val opId = "up_${System.currentTimeMillis()}"
        data class PreparedUploadFile(
            val displayName: String,
            val mimeType: String,
            val bytes: ByteArray
        )

        val prepared = mutableListOf<PreparedUploadFile>()
        var grandTotalBytes = 0L

        for (uri in uris) {
            val bytes = try {
                context.contentResolver.openInputStream(uri)?.use { it.readBytes() }
            } catch (_: Exception) {
                null
            } ?: continue

            val mime = context.contentResolver.getType(uri) ?: "application/octet-stream"
            val rawName = resolveDisplayName(uri) ?: "file_${System.currentTimeMillis()}"
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

            prepared.add(PreparedUploadFile(finalName, mime, bytes))
            grandTotalBytes += bytes.size.toLong()
        }

        if (prepared.isEmpty()) {
            return@withContext Pair(false, "Impossibile leggere i file selezionati")
        }

        val opTitle = if (prepared.size == 1) {
            prepared.first().displayName
        } else {
            "Upload (${prepared.size} file)"
        }

        val startTimeMs = System.currentTimeMillis()
        var completedBytesBeforeBatch = 0L
        var uploadedCount = 0

        onTransferUpdate(
            TransferOperation(
                id = opId,
                title = opTitle,
                isUpload = true,
                transferredBytes = 0L,
                totalBytes = grandTotalBytes,
                speedBytesPerSec = 0L,
                status = TransferStatus.RUNNING,
                detail = "0 / ${prepared.size} file"
            )
        )

        try {
            val batchSize = 5
            val batches = prepared.chunked(batchSize)
            val uploadedFilenames = mutableListOf<String>()

            for (batch in batches) {
                val multipartBuilder = MultipartBody.Builder().setType(MultipartBody.FORM)
                var batchPayloadBytes = 0L

                for (item in batch) {
                    multipartBuilder.addFormDataPart(
                        "file[]",
                        item.displayName,
                        item.bytes.toRequestBody(item.mimeType.toMediaTypeOrNull())
                    )
                    multipartBuilder.addFormDataPart("timestamp[]", System.currentTimeMillis().toString())
                    batchPayloadBytes += item.bytes.size.toLong()
                    uploadedFilenames.add(item.displayName)
                }

                if (targetAlbum.isNotBlank()) {
                    multipartBuilder.addFormDataPart("album", targetAlbum.trim())
                }

                val rawBody = multipartBuilder.build()
                var lastEmitMs = 0L
                val progressBody = ProgressRequestBody(rawBody) { writtenInBatch, _ ->
                    val now = System.currentTimeMillis()
                    if (now - lastEmitMs >= 120L || writtenInBatch >= batchPayloadBytes) {
                        lastEmitMs = now
                        val currentTotalTransferred = (completedBytesBeforeBatch + writtenInBatch)
                            .coerceAtMost(grandTotalBytes)
                        val elapsedSec = max(0.15, (now - startTimeMs) / 1000.0)
                        val speed = (currentTotalTransferred / elapsedSec).toLong()
                        onTransferUpdate(
                            TransferOperation(
                                id = opId,
                                title = opTitle,
                                isUpload = true,
                                transferredBytes = currentTotalTransferred,
                                totalBytes = grandTotalBytes,
                                speedBytesPerSec = speed,
                                status = TransferStatus.RUNNING,
                                detail = "${uploadedCount + batch.size} / ${prepared.size} file"
                            )
                        )
                    }
                }

                val request = Request.Builder()
                    .url("${cleanBaseUrl()}/upload")
                    .post(progressBody)
                    .build()

                httpClient.newCall(request).execute().use { response ->
                    if (!response.isSuccessful) {
                        val errBody = response.body?.string() ?: "Errore upload (${response.code})"
                        onTransferUpdate(
                            TransferOperation(
                                id = opId,
                                title = opTitle,
                                isUpload = true,
                                transferredBytes = completedBytesBeforeBatch,
                                totalBytes = grandTotalBytes,
                                speedBytesPerSec = 0L,
                                status = TransferStatus.ERROR,
                                detail = errBody
                            )
                        )
                        return@withContext Pair(false, errBody)
                    }
                }

                completedBytesBeforeBatch += batchPayloadBytes
                uploadedCount += batch.size
                onProgress(uploadedCount, prepared.size)
            }

            if (targetAlbum.isNotBlank() && uploadedFilenames.isNotEmpty()) {
                assignFilesToAlbum(uploadedFilenames, targetAlbum.trim())
            }

            val totalElapsedSec = max(0.2, (System.currentTimeMillis() - startTimeMs) / 1000.0)
            val avgSpeed = (grandTotalBytes / totalElapsedSec).toLong()
            onTransferUpdate(
                TransferOperation(
                    id = opId,
                    title = opTitle,
                    isUpload = true,
                    transferredBytes = grandTotalBytes,
                    totalBytes = grandTotalBytes,
                    speedBytesPerSec = avgSpeed,
                    status = TransferStatus.COMPLETED,
                    detail = "$uploadedCount file caricati"
                )
            )

            Pair(true, "$uploadedCount file caricati con successo")
        } catch (e: Exception) {
            onTransferUpdate(
                TransferOperation(
                    id = opId,
                    title = opTitle,
                    isUpload = true,
                    transferredBytes = completedBytesBeforeBatch,
                    totalBytes = grandTotalBytes,
                    speedBytesPerSec = 0L,
                    status = TransferStatus.ERROR,
                    detail = e.localizedMessage ?: "Errore di rete"
                )
            )
            Pair(false, "Errore durante il caricamento: ${e.localizedMessage}")
        }
    }

    private fun resolveDisplayName(uri: Uri): String? {
        return try {
            context.contentResolver.query(uri, arrayOf(OpenableColumns.DISPLAY_NAME), null, null, null)?.use { cursor ->
                if (cursor.moveToFirst()) {
                    val idx = cursor.getColumnIndex(OpenableColumns.DISPLAY_NAME)
                    if (idx >= 0) cursor.getString(idx) else null
                } else null
            }
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
        onTransferUpdate: (TransferOperation) -> Unit = {}
    ): Pair<Boolean, String> = withContext(Dispatchers.IO) {
        val opId = "dl_zip_${System.currentTimeMillis()}"
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
            val arr = JSONArray()
            filenames.forEach { arr.put(it) }
            val payload = JSONObject().put("filenames", arr).toString()

            val prepReq = Request.Builder()
                .url("${cleanBaseUrl()}/prepare-zip")
                .post(payload.toRequestBody("application/json".toMediaTypeOrNull()))
                .build()

            val taskId = httpClient.newCall(prepReq).execute().use { resp ->
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
            if (taskId.isBlank()) return@withContext Pair(false, "Task ID ZIP non valido")

            var zipFilename: String? = null
            repeat(90) {
                delay(700)
                val progReq = Request.Builder()
                    .url("${cleanBaseUrl()}/zip-progress/$taskId")
                    .get()
                    .build()
                httpClient.newCall(progReq).execute().use { resp ->
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
                                speedBytesPerSec = speed,
                                status = TransferStatus.RUNNING,
                                detail = "Preparazione ZIP ($progressPct%)..."
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
                if (!zipFilename.isNullOrBlank()) return@repeat
            }

            val finalZip = zipFilename ?: return@withContext Pair(false, "Timeout creazione ZIP")
            val dlReq = Request.Builder()
                .url("${cleanBaseUrl()}/download-zip/$finalZip")
                .get()
                .build()

            val dlStartMs = System.currentTimeMillis()
            httpClient.newCall(dlReq).execute().use { resp ->
                if (!resp.isSuccessful) return@withContext Pair(false, "Errore download ZIP")
                val body = resp.body ?: return@withContext Pair(false, "ZIP vuoto")
                val contentLen = body.contentLength().coerceAtLeast(0L)
                val outBuffer = java.io.ByteArrayOutputStream()
                val buf = ByteArray(16 * 1024)
                var downloaded = 0L
                var lastEmit = 0L

                body.byteStream().use { input ->
                    var r: Int
                    while (input.read(buf).also { r = it } != -1) {
                        outBuffer.write(buf, 0, r)
                        downloaded += r
                        val now = System.currentTimeMillis()
                        if (now - lastEmit >= 120L) {
                            lastEmit = now
                            val elapsed = max(0.15, (now - dlStartMs) / 1000.0)
                            val speed = (downloaded / elapsed).toLong()
                            onTransferUpdate(
                                TransferOperation(
                                    id = opId,
                                    title = opTitle,
                                    isUpload = false,
                                    transferredBytes = downloaded,
                                    totalBytes = if (contentLen > 0L) contentLen else downloaded,
                                    speedBytesPerSec = speed,
                                    status = TransferStatus.RUNNING,
                                    detail = "Scaricamento pacchetto ZIP..."
                                )
                            )
                        }
                    }
                }

                val bytes = outBuffer.toByteArray()
                val savedName = "PhotoCloud_${System.currentTimeMillis()}.zip"
                val ok = saveBytesToDownloads(context, savedName, bytes, "application/zip")
                val elapsed = max(0.2, (System.currentTimeMillis() - dlStartMs) / 1000.0)
                val finalSpeed = (bytes.size / elapsed).toLong()

                onTransferUpdate(
                    TransferOperation(
                        id = opId,
                        title = opTitle,
                        isUpload = false,
                        transferredBytes = bytes.size.toLong(),
                        totalBytes = bytes.size.toLong(),
                        speedBytesPerSec = finalSpeed,
                        status = if (ok) TransferStatus.COMPLETED else TransferStatus.ERROR,
                        detail = if (ok) "Salvato in Download: $savedName" else "Errore salvataggio"
                    )
                )

                if (ok) Pair(true, "Salvato in Download: $savedName")
                else Pair(false, "Impossibile salvare lo ZIP in Download")
            }
        } catch (e: Exception) {
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
        }
    }

    suspend fun saveSingleMediaToDownloads(
        filename: String,
        fromTrash: Boolean = false,
        onTransferUpdate: (TransferOperation) -> Unit = {}
    ): Pair<Boolean, String> = withContext(Dispatchers.IO) {
        val opId = "dl_${System.currentTimeMillis()}_${filename.hashCode()}"
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
            val request = Request.Builder()
                .url(getMediaUrl(filename, fromTrash, download = true))
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
                    return@withContext Pair(false, "Errore download file")
                }
                val body = resp.body ?: return@withContext Pair(false, "File vuoto")
                val totalLen = body.contentLength().coerceAtLeast(0L)
                val outBuffer = java.io.ByteArrayOutputStream()
                val buf = ByteArray(16 * 1024)
                var downloaded = 0L
                var lastEmit = 0L

                body.byteStream().use { input ->
                    var r: Int
                    while (input.read(buf).also { r = it } != -1) {
                        outBuffer.write(buf, 0, r)
                        downloaded += r
                        val now = System.currentTimeMillis()
                        if (now - lastEmit >= 100L) {
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
                                    detail = "In scaricamento..."
                                )
                            )
                        }
                    }
                }

                val bytes = outBuffer.toByteArray()
                val mime = resp.header("Content-Type") ?: "application/octet-stream"
                val ok = saveBytesToDownloads(context, filename, bytes, mime)
                val elapsed = max(0.15, (System.currentTimeMillis() - startMs) / 1000.0)
                val speed = (bytes.size / elapsed).toLong()

                onTransferUpdate(
                    TransferOperation(
                        id = opId,
                        title = filename,
                        isUpload = false,
                        transferredBytes = bytes.size.toLong(),
                        totalBytes = bytes.size.toLong(),
                        speedBytesPerSec = speed,
                        status = if (ok) TransferStatus.COMPLETED else TransferStatus.ERROR,
                        detail = if (ok) "Salvato in Download" else "Errore salvataggio"
                    )
                )

                if (ok) Pair(true, "Salvato in Download: $filename")
                else Pair(false, "Errore salvataggio in Download")
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
            Pair(false, "Errore: ${e.localizedMessage}")
        }
    }

    companion object {
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

        fun saveBytesToDownloads(
            context: Context,
            filename: String,
            bytes: ByteArray,
            mimeType: String
        ): Boolean {
            return try {
                if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
                    val values = ContentValues().apply {
                        put(MediaStore.Downloads.DISPLAY_NAME, filename)
                        put(MediaStore.Downloads.MIME_TYPE, mimeType)
                        put(MediaStore.Downloads.RELATIVE_PATH, Environment.DIRECTORY_DOWNLOADS)
                        put(MediaStore.Downloads.IS_PENDING, 1)
                    }
                    val resolver = context.contentResolver
                    val uri = resolver.insert(MediaStore.Downloads.EXTERNAL_CONTENT_URI, values)
                        ?: return false
                    resolver.openOutputStream(uri)?.use { out ->
                        out.write(bytes)
                        out.flush()
                    }
                    values.clear()
                    values.put(MediaStore.Downloads.IS_PENDING, 0)
                    resolver.update(uri, values, null, null)
                    true
                } else {
                    @Suppress("DEPRECATION")
                    val dir = Environment.getExternalStoragePublicDirectory(Environment.DIRECTORY_DOWNLOADS)
                    if (!dir.exists()) dir.mkdirs()
                    val file = File(dir, filename)
                    FileOutputStream(file).use { out ->
                        out.write(bytes)
                        out.flush()
                    }
                    true
                }
            } catch (_: Exception) {
                false
            }
        }
    }
}
