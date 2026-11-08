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
import okhttp3.MediaType.Companion.toMediaTypeOrNull
import okhttp3.MultipartBody
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.RequestBody.Companion.toRequestBody
import org.json.JSONArray
import org.json.JSONObject
import java.io.File
import java.io.FileOutputStream
import java.net.URLDecoder
import java.net.URLEncoder
import java.util.concurrent.TimeUnit

data class MediaItemModel(
    val filename: String,
    val timestamp: Double
) {
    val isVideo: Boolean
        get() {
            val lower = filename.lowercase()
            return lower.endsWith(".mp4") || lower.endsWith(".mov")
        }
}

data class RegisterResult(
    val success: Boolean,
    val filename: String = "",
    val jsonContent: String = "",
    val errorMessage: String = ""
)

class PhotoCloudApiClient(
    private val context: Context,
    @Volatile var baseUrl: String
) {
    private val cookiePrefs = context.getSharedPreferences("photocloud_cookie_store", Context.MODE_PRIVATE)

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
        bitmapCache.evictAll()
    }

    val httpClient: OkHttpClient = OkHttpClient.Builder()
        .cookieJar(cookieJar)
        .followRedirects(true)
        .followSslRedirects(true)
        .connectTimeout(15, TimeUnit.SECONDS)
        .readTimeout(90, TimeUnit.SECONDS)
        .writeTimeout(90, TimeUnit.SECONDS)
        .build()

    private val noRedirectClient: OkHttpClient = httpClient.newBuilder()
        .followRedirects(false)
        .followSslRedirects(false)
        .build()

    private val maxCacheKb = (Runtime.getRuntime().maxMemory() / 1024 / 6).toInt().coerceAtLeast(16 * 1024)
    private val bitmapCache = object : LruCache<String, Bitmap>(maxCacheKb) {
        override fun sizeOf(key: String, value: Bitmap): Int {
            return value.byteCount / 1024
        }
    }

    fun getCachedBitmap(filename: String, fromTrash: Boolean = false): Bitmap? {
        return bitmapCache.get("$fromTrash:$filename")
    }

    private fun cleanBaseUrl(): String = baseUrl.trim().removeSuffix("/")

    fun getMediaUrl(filename: String, fromTrash: Boolean = false): String {
        val encoded = URLEncoder.encode(filename, "UTF-8").replace("+", "%20")
        return if (fromTrash) {
            "${cleanBaseUrl()}/media/$encoded?from_trash=true"
        } else {
            "${cleanBaseUrl()}/media/$encoded"
        }
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
        val cacheKey = "$fromTrash:$filename"
        bitmapCache.get(cacheKey)?.let { return@withContext it }

        try {
            val request = Request.Builder()
                .url(getMediaUrl(filename, fromTrash))
                .get()
                .build()

            httpClient.newCall(request).execute().use { response ->
                if (!response.isSuccessful) return@withContext null
                val bytes = response.body?.bytes() ?: return@withContext null
                if (bytes.isEmpty()) return@withContext null

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
     * Checks session and fetches Gallery media items from either main.py (HTML) or server.ts.
     * Returns null if not logged in, or the list of MediaItemModel if authenticated.
     */
    suspend fun fetchGalleryIfAuthenticated(): List<MediaItemModel>? = withContext(Dispatchers.IO) {
        try {
            val request = Request.Builder()
                .url("${cleanBaseUrl()}/")
                .header("Accept", "text/html")
                .get()
                .build()

            httpClient.newCall(request).execute().use { response ->
                if (!response.isSuccessful) return@withContext null
                val html = response.body?.string() ?: return@withContext null

                // If login page is returned, user is not authenticated
                if (html.contains("id=\"actual-login-form\"") ||
                    (html.contains("class=\"auth-container\"") && !html.contains("gallery-grid"))
                ) {
                    return@withContext null
                }

                parseMediaItemsFromHtml(html)
            }
        } catch (_: Exception) {
            null
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
                if (!response.isSuccessful) return@withContext emptyList()
                val html = response.body?.string() ?: return@withContext emptyList()
                if (html.contains("id=\"actual-login-form\"")) return@withContext emptyList()
                parseMediaItemsFromHtml(html)
            }
        } catch (_: Exception) {
            emptyList()
        }
    }

    private fun parseMediaItemsFromHtml(html: String): List<MediaItemModel> {
        val results = mutableListOf<MediaItemModel>()
        val seen = mutableSetOf<String>()

        val chunks = html.split("media-card-wrapper")
        val tsRegex = Regex("data-timestamp=\"([0-9.]+)\"")
        val fnAttrRegex = Regex("data-filename=\"([^\"]+)\"")
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
                results.add(MediaItemModel(filename = fname, timestamp = ts))
            }
        }
        return results
    }

    suspend fun uploadMediaUris(
        uris: List<Uri>,
        onProgress: (Int, Int) -> Unit
    ): Pair<Boolean, String> = withContext(Dispatchers.IO) {
        if (uris.isEmpty()) return@withContext Pair(false, "Nessun file selezionato")

        val validExtensions = setOf("jpg", "jpeg", "png", "gif", "webp", "mp4", "mov")
        var uploaded = 0

        try {
            val batchSize = 10
            val batches = uris.chunked(batchSize)
            for (batch in batches) {
                val multipart = MultipartBody.Builder().setType(MultipartBody.FORM)
                var addedInBatch = 0

                for (uri in batch) {
                    val bytes = context.contentResolver.openInputStream(uri)?.use { it.readBytes() }
                        ?: continue
                    val mime = context.contentResolver.getType(uri) ?: "image/jpeg"
                    val rawName = resolveDisplayName(uri) ?: "photo_${System.currentTimeMillis()}.jpg"
                    val ext = rawName.substringAfterLast('.', "").lowercase()

                    val finalName = if (ext in validExtensions) {
                        rawName
                    } else {
                        val guessedExt = MimeTypeMap.getSingleton().getExtensionFromMimeType(mime)?.lowercase()
                        val safeExt = when {
                            guessedExt != null && guessedExt in validExtensions -> guessedExt
                            mime.startsWith("video/") -> "mp4"
                            else -> "jpg"
                        }
                        "${rawName.substringBeforeLast('.')}.$safeExt"
                    }

                    multipart.addFormDataPart(
                        "file[]",
                        finalName,
                        bytes.toRequestBody(mime.toMediaTypeOrNull())
                    )
                    multipart.addFormDataPart("timestamp[]", System.currentTimeMillis().toString())
                    addedInBatch++
                }

                if (addedInBatch > 0) {
                    val request = Request.Builder()
                        .url("${cleanBaseUrl()}/upload")
                        .post(multipart.build())
                        .build()

                    httpClient.newCall(request).execute().use { response ->
                        if (!response.isSuccessful) {
                            val errBody = response.body?.string() ?: "Errore upload (${response.code})"
                            return@withContext Pair(false, errBody)
                        }
                    }
                    uploaded += addedInBatch
                    onProgress(uploaded, uris.size)
                }
            }
            Pair(true, "$uploaded file caricati con successo")
        } catch (e: Exception) {
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
                    filenames.forEach { bitmapCache.remove("false:$it") }
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
            httpClient.newCall(request).execute().use { it.isSuccessful }
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

    suspend fun downloadZipToDevice(filenames: List<String>): Pair<Boolean, String> = withContext(Dispatchers.IO) {
        try {
            val arr = JSONArray()
            filenames.forEach { arr.put(it) }
            val payload = JSONObject().put("filenames", arr).toString()

            val prepReq = Request.Builder()
                .url("${cleanBaseUrl()}/prepare-zip")
                .post(payload.toRequestBody("application/json".toMediaTypeOrNull()))
                .build()

            val taskId = httpClient.newCall(prepReq).execute().use { resp ->
                if (!resp.isSuccessful) return@withContext Pair(false, "Errore preparazione ZIP")
                val obj = JSONObject(resp.body?.string() ?: "{}")
                obj.optString("task_id", "")
            }
            if (taskId.isBlank()) return@withContext Pair(false, "Task ID ZIP non valido")

            var zipFilename: String? = null
            repeat(60) {
                delay(1000)
                val progReq = Request.Builder()
                    .url("${cleanBaseUrl()}/zip-progress/$taskId")
                    .get()
                    .build()
                httpClient.newCall(progReq).execute().use { resp ->
                    if (resp.isSuccessful) {
                        val obj = JSONObject(resp.body?.string() ?: "{}")
                        val status = obj.optString("status")
                        if (status == "complete") {
                            zipFilename = obj.optString("filename")
                        } else if (status == "error") {
                            return@withContext Pair(false, obj.optString("error", "Errore ZIP"))
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

            httpClient.newCall(dlReq).execute().use { resp ->
                if (!resp.isSuccessful) return@withContext Pair(false, "Errore download ZIP")
                val bytes = resp.body?.bytes() ?: return@withContext Pair(false, "ZIP vuoto")
                val savedName = "PhotoCloud_${System.currentTimeMillis()}.zip"
                val ok = saveBytesToDownloads(context, savedName, bytes, "application/zip")
                if (ok) Pair(true, "Salvato in Download: $savedName")
                else Pair(false, "Impossibile salvare lo ZIP in Download")
            }
        } catch (e: Exception) {
            Pair(false, "Errore esportazione ZIP: ${e.localizedMessage}")
        }
    }

    suspend fun saveSingleMediaToDownloads(filename: String, fromTrash: Boolean = false): Pair<Boolean, String> =
        withContext(Dispatchers.IO) {
            try {
                val request = Request.Builder()
                    .url(getMediaUrl(filename, fromTrash))
                    .get()
                    .build()
                httpClient.newCall(request).execute().use { resp ->
                    if (!resp.isSuccessful) return@withContext Pair(false, "Errore download file")
                    val bytes = resp.body?.bytes() ?: return@withContext Pair(false, "File vuoto")
                    val mime = resp.header("Content-Type") ?: "image/jpeg"
                    val ok = saveBytesToDownloads(context, filename, bytes, mime)
                    if (ok) Pair(true, "Salvato in Download: $filename")
                    else Pair(false, "Errore salvataggio in Download")
                }
            } catch (e: Exception) {
                Pair(false, "Errore: ${e.localizedMessage}")
            }
        }

    companion object {
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
