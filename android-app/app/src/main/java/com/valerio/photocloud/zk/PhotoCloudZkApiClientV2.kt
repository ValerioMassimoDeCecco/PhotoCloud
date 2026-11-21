package com.valerio.photocloud.zk

import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import okhttp3.HttpUrl
import okhttp3.HttpUrl.Companion.toHttpUrlOrNull
import okhttp3.Interceptor
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.RequestBody
import okhttp3.RequestBody.Companion.toRequestBody
import org.json.JSONArray
import org.json.JSONObject
import java.io.IOException
import java.io.OutputStream
import java.util.concurrent.TimeUnit
import javax.net.ssl.X509TrustManager
import kotlin.math.min

class InsecureTransportException(message: String) : IOException(message)

class V2EndpointViolationException(message: String) : IllegalArgumentException(message)

open class V2ApiHttpException(
    val statusCode: Int,
    val errorCode: String,
    message: String
) : IOException(message)

class V2ChunkOutOfOrderException(
    val expectedChunkIndex: Int,
    message: String
) : V2ApiHttpException(409, "CHUNK_OUT_OF_ORDER", message)

data class V2KdfParamsDto(
    val algorithm: String,
    val memoryKiB: Int,
    val iterations: Int,
    val parallelism: Int
) {
    fun toArgon2Params(): ZkArgon2id.Params {
        return ZkArgon2id.Params(
            memoryKiB = memoryKiB,
            iterations = iterations,
            parallelism = parallelism,
            hashLength = ZkArgon2id.EXPECTED_HASH_BYTES
        )
    }

    fun toJson(): JSONObject {
        return JSONObject()
            .put("algorithm", algorithm)
            .put("memoryKiB", memoryKiB)
            .put("iterations", iterations)
            .put("parallelism", parallelism)
    }

    companion object {
        fun fromJson(obj: JSONObject): V2KdfParamsDto {
            return V2KdfParamsDto(
                algorithm = obj.optString("algorithm", "Argon2id"),
                memoryKiB = obj.getInt("memoryKiB"),
                iterations = obj.getInt("iterations"),
                parallelism = obj.getInt("parallelism")
            )
        }
    }
}

data class V2AuthConfigResponse(
    val registrationOpen: Boolean,
    val requiresInviteToken: Boolean,
    val policy: String
)

data class V2LoginParamsResponse(
    val saltB64u: String,
    val kdfParams: V2KdfParamsDto
)

data class V2LoginResponse(
    val userId: String,
    val username: String,
    val saltB64u: String,
    val kdfParams: V2KdfParamsDto,
    val wrappedVaultKeyB64u: String,
    val csrfToken: String
)

data class V2RegisterResponse(
    val userId: String,
    val username: String,
    val saltB64u: String,
    val kdfParams: V2KdfParamsDto,
    val wrappedVaultKeyB64u: String,
    val csrfToken: String
)

data class V2RewrapResponse(
    val ok: Boolean,
    val saltB64u: String,
    val kdfParams: V2KdfParamsDto,
    val wrappedVaultKeyB64u: String
)

data class V2ServerItem(
    val id: String,
    val blobId: String,
    val version: Int,
    val size: Long,
    val sha256: String,
    val createdAt: Long,
    val updatedAt: Long,
    val state: String,
    val trashedAt: Long?,
    val encMetaB64u: String,
    val dedupTag: String?,
    val thumbs: List<Int>
)

data class V2UploadInitResponse(
    val uploadId: String,
    val blobId: String,
    val receivedChunks: Int,
    val expiresAt: Long
)

data class V2ChunkUploadResponse(
    val uploadId: String,
    val chunkIndex: Int,
    val receivedChunks: Int,
    val receivedBytes: Long
)

data class V2BackupCheckMatch(
    val itemId: String,
    val blobId: String
)

data class V2BackupCheckResponse(
    val existingTags: Set<String>,
    val existingItems: Map<String, V2BackupCheckMatch>
)

data class V2RangeDownloadResult(
    val bytes: ByteArray,
    val startByte: Long,
    val endByteInclusive: Long,
    val totalBytes: Long
)

data class V2EncryptedAlbumsResponse(
    val bytes: ByteArray,
    val etag: String
)

data class V2PutAlbumsResponse(
    val etag: String,
    val size: Long,
    val updatedAt: Long
)

data class V2StatsResponse(
    val activeBytes: Long,
    val trashedBytes: Long,
    val activeCount: Int,
    val trashedCount: Int,
    val quotaBytes: Long
)

data class V2ShareItemInput(
    val blobId: String,
    val wrappedFkB64u: String,
    val encItemMetaB64u: String? = null
)

data class V2CreateShareResponse(
    val shareId: String,
    val expiresAt: Long?,
    val maxDownloads: Int?,
    val createdAt: Long
)

data class V2OwnerShareDto(
    val shareId: String,
    val encShareMetaB64u: String?,
    val hasPassword: Boolean,
    val itemCount: Int,
    val expiresAt: Long?,
    val maxDownloads: Int?,
    val downloadsCount: Int,
    val createdAt: Long
)

/**
 * Isolated OkHttp network client strictly bound to PhotoCloud `/api/v2/` endpoints (FASE 4B/4C/4D).
 *
 * Security guarantees:
 * - Enforces HTTPS everywhere except explicit loopback hosts (`localhost`, `127.0.0.1`, `::1`, `10.0.2.2`)
 *   when [allowLocalhostHttpForTests] is enabled.
 * - Rejects any path outside the `/api/v2/` prefix before issuing any network call.
 * - Uses [TofuSpkiTrustManager] for self-signed servers (no TrustAll, default strict HostnameVerifier intact).
 * - Uses [ZkV2CookieJar] isolated to `/api/v2/` in memory.
 * - Never sends or logs `passphrase`, `accountKey`, `root`, `kek`, `VK`, `FK`, or `shareKey`.
 */
class PhotoCloudZkApiClientV2(
    initialBaseUrl: String,
    private val pinStore: TofuSpkiPinStore = InMemoryTofuSpkiPinStore(),
    private val allowLocalhostHttpForTests: Boolean = false,
    @Volatile var allowUserSelectedHttp: Boolean = false,
    val cookieJar: ZkV2CookieJar = ZkV2CookieJar(
        allowLocalhostHttpForTests = allowLocalhostHttpForTests,
        allowUserSelectedHttp = allowUserSelectedHttp
    ),
    systemTrustManager: X509TrustManager = TofuSpkiPinning.defaultSystemTrustManager(),
    extraInterceptors: List<Interceptor> = emptyList()
) {
    companion object {
        private val JSON_MEDIA_TYPE = "application/json; charset=utf-8".toMediaType()
        val OCTET_MEDIA_TYPE = "application/octet-stream".toMediaType()
        private val CONTENT_RANGE_REGEX = Regex("^bytes\\s+(\\d+)-(\\d+)/(\\d+|\\*)$", RegexOption.IGNORE_CASE)

        fun applyProtocolModeToUrl(rawUrl: String, useHttps: Boolean): String {
            val trimmed = rawUrl.trim().removeSuffix("/")
            if (trimmed.isBlank()) return ""
            val scheme = if (useHttps) "https" else "http"
            return when {
                trimmed.startsWith("https://", ignoreCase = true) -> "$scheme://${trimmed.substring(8)}"
                trimmed.startsWith("http://", ignoreCase = true) -> "$scheme://${trimmed.substring(7)}"
                else -> "$scheme://$trimmed"
            }
        }
    }

    fun setTransportProtocolMode(useHttps: Boolean) {
        allowUserSelectedHttp = !useHttps
        cookieJar.allowUserSelectedHttp = !useHttps
    }

    @Volatile
    var baseUrl: String = initialBaseUrl.trim().removeSuffix("/")
        set(value) {
            field = value.trim().removeSuffix("/")
        }

    private val trustManager = TofuSpkiTrustManager(
        pinStore = pinStore,
        systemTrustManager = systemTrustManager,
        fallbackHostPortProvider = {
            val parsed = baseUrl.toHttpUrlOrNull()
            if (parsed != null) {
                TofuSpkiPinning.canonicalHostPort(parsed)
            } else {
                "unknown:443"
            }
        }
    )

    private val httpClient: OkHttpClient = OkHttpClient.Builder()
        .cookieJar(cookieJar)
        .sslSocketFactory(TofuSpkiPinning.createSslSocketFactory(trustManager), trustManager)
        // Strict default OkHostnameVerifier is preserved (never replaced with permissive verifier).
        .followRedirects(false)
        .followSslRedirects(false)
        .connectTimeout(20, TimeUnit.SECONDS)
        .readTimeout(60, TimeUnit.SECONDS)
        .writeTimeout(60, TimeUnit.SECONDS)
        .addInterceptor { chain ->
            val original = chain.request()
            val transportModeHeader = if (allowUserSelectedHttp && !original.url.isHttps) "http" else "https"
            val reqBuilder = original.newBuilder()
                .header("X-PhotoCloud-Request", "1")
                .header("X-PhotoCloud-Transport-Mode", transportModeHeader)
                .header("Accept", "application/json, application/octet-stream")
            chain.proceed(reqBuilder.build())
        }
        .apply {
            for (interceptor in extraInterceptors) {
                addInterceptor(interceptor)
            }
        }
        .build()

    fun validateBaseUrl(rawUrl: String = baseUrl): HttpUrl {
        val cleaned = rawUrl.trim().removeSuffix("/")
        val parsed = cleaned.toHttpUrlOrNull()
            ?: throw InsecureTransportException("URL server v2 non valido.")

        val permitted = when {
            parsed.isHttps -> true
            allowUserSelectedHttp && parsed.scheme.equals("http", ignoreCase = true) -> true
            allowLocalhostHttpForTests && parsed.scheme.equals("http", ignoreCase = true) ->
                ZkV2CookieJar.isLoopbackHost(parsed.host)
            else -> false
        }
        if (!permitted) {
            throw InsecureTransportException(
                "HTTPS obbligatorio per PhotoCloud Zero-Knowledge v2 (attiva la modalità HTTP nel toggle in alto a sinistra oppure usa HTTPS)."
            )
        }
        return parsed
    }

    fun buildV2EndpointUrl(relativeApiPath: String): HttpUrl {
        val trimmedPath = relativeApiPath.trim()
        if (!trimmedPath.startsWith("/api/v2/")) {
            throw V2EndpointViolationException(
                "PhotoCloudZkApiClientV2 accetta esclusivamente endpoint /api/v2/* (ricevuto: $trimmedPath)."
            )
        }
        val base = validateBaseUrl(baseUrl)
        val combined = "${base.scheme}://${base.host}:${base.port}$trimmedPath"
        val resolved = combined.toHttpUrlOrNull()
            ?: throw V2EndpointViolationException("Impossibile risolvere URL /api/v2 valido.")
        if (!ZkV2CookieJar.isV2ApiPath(resolved)) {
            throw V2EndpointViolationException("Path al di fuori di /api/v2/* bloccato.")
        }
        return resolved
    }

    fun confirmTofuServer(challenge: TofuPinChallenge): TofuPinRecord {
        val record = TofuPinRecord(
            hostPort = challenge.hostPort.lowercase(),
            spkiPin = challenge.spkiPin,
            certSha256Hex = challenge.certSha256Hex,
            subject = challenge.subject,
            issuer = challenge.issuer,
            trustedAtMs = System.currentTimeMillis()
        )
        pinStore.savePin(record)
        return record
    }

    fun getPinnedServer(): TofuPinRecord? {
        val parsed = baseUrl.toHttpUrlOrNull() ?: return null
        return pinStore.getPin(TofuSpkiPinning.canonicalHostPort(parsed))
    }

    fun clearCurrentServerPin() {
        val parsed = baseUrl.toHttpUrlOrNull() ?: return
        pinStore.removePin(TofuSpkiPinning.canonicalHostPort(parsed))
    }

    fun hasActiveSessionCookie(): Boolean {
        val parsed = baseUrl.toHttpUrlOrNull() ?: return false
        return cookieJar.hasActiveSessionCookie(parsed)
    }

    private fun unwrapTofuOrRethrow(t: Throwable): Nothing {
        TofuSpkiPinning.findTofuConfirmationChallenge(t)?.let { challenge ->
            throw TofuConfirmationRequiredException(challenge)
        }
        TofuSpkiPinning.findTofuPinMismatch(t)?.let { mismatch ->
            throw TofuPinMismatchException(mismatch)
        }
        throw t
    }

    private suspend fun executeJsonRequest(
        request: Request
    ): Pair<Int, String> = withContext(Dispatchers.IO) {
        try {
            httpClient.newCall(request).execute().use { resp ->
                val body = resp.body?.string().orEmpty()
                resp.code to body
            }
        } catch (t: Throwable) {
            unwrapTofuOrRethrow(t)
        }
    }

    private suspend fun executeBytesRequest(
        request: Request
    ): Pair<Int, ByteArray> = withContext(Dispatchers.IO) {
        try {
            httpClient.newCall(request).execute().use { resp ->
                val bytes = resp.body?.bytes() ?: ByteArray(0)
                resp.code to bytes
            }
        } catch (t: Throwable) {
            unwrapTofuOrRethrow(t)
        }
    }

    private fun parseErrorCode(body: String, fallback: String): String {
        if (body.isBlank()) return fallback
        return try {
            JSONObject(body).optString("error", fallback).ifBlank { fallback }
        } catch (_: Throwable) {
            fallback
        }
    }

    private fun parseServerItem(obj: JSONObject): V2ServerItem {
        val thumbsArr = obj.optJSONArray("thumbs") ?: JSONArray()
        val thumbs = ArrayList<Int>(thumbsArr.length())
        for (t in 0 until thumbsArr.length()) {
            thumbs.add(thumbsArr.getInt(t))
        }
        return V2ServerItem(
            id = obj.getString("id"),
            blobId = obj.getString("blobId"),
            version = obj.getInt("version"),
            size = obj.getLong("size"),
            sha256 = obj.getString("sha256"),
            createdAt = obj.getLong("createdAt"),
            updatedAt = obj.getLong("updatedAt"),
            state = obj.getString("state"),
            trashedAt = if (obj.isNull("trashedAt")) null else obj.getLong("trashedAt"),
            encMetaB64u = obj.getString("encMeta"),
            dedupTag = if (obj.isNull("dedupTag")) null else obj.getString("dedupTag"),
            thumbs = thumbs
        )
    }

    suspend fun fetchAuthConfig(): V2AuthConfigResponse {
        val url = buildV2EndpointUrl("/api/v2/auth/config")
        val req = Request.Builder()
            .url(url)
            .get()
            .build()
        val (status, body) = executeJsonRequest(req)
        if (status !in 200..299) {
            return V2AuthConfigResponse(
                registrationOpen = true,
                requiresInviteToken = false,
                policy = "open"
            )
        }
        val json = JSONObject(body)
        return V2AuthConfigResponse(
            registrationOpen = json.optBoolean("registrationOpen", true),
            requiresInviteToken = json.optBoolean("requiresInviteToken", false),
            policy = json.optString("policy", "open")
        )
    }

    suspend fun register(
        username: String,
        userId: String,
        saltB64u: String,
        kdfParams: V2KdfParamsDto,
        authSecretB64u: String,
        wrappedVaultKeyB64u: String,
        setupTokenOrNull: String? = null,
        inviteTokenOrNull: String? = null
    ): V2RegisterResponse {
        val url = buildV2EndpointUrl("/api/v2/register")
        val payloadObj = JSONObject()
            .put("username", username.trim())
            .put("userId", userId.lowercase())
            .put("salt", saltB64u)
            .put("kdfParams", kdfParams.toJson())
            .put("authSecret", authSecretB64u)
            .put("wrappedVaultKey", wrappedVaultKeyB64u)
        if (!setupTokenOrNull.isNullOrBlank()) {
            payloadObj.put("setupToken", setupTokenOrNull.trim())
        }
        if (!inviteTokenOrNull.isNullOrBlank()) {
            payloadObj.put("inviteToken", inviteTokenOrNull.trim())
        }
        val req = Request.Builder()
            .url(url)
            .post(payloadObj.toString().toRequestBody(JSON_MEDIA_TYPE))
            .build()

        val (status, body) = executeJsonRequest(req)
        if (status !in 200..299) {
            val code = parseErrorCode(body, "REGISTRATION_FAILED")
            throw V2ApiHttpException(status, code, "Registrazione fallita ($status: $code).")
        }
        val json = JSONObject(body)
        return V2RegisterResponse(
            userId = json.getString("userId"),
            username = json.getString("username"),
            saltB64u = json.getString("salt"),
            kdfParams = V2KdfParamsDto.fromJson(json.getJSONObject("kdfParams")),
            wrappedVaultKeyB64u = json.getString("wrappedVaultKey"),
            csrfToken = json.optString("csrfToken", "")
        )
    }

    suspend fun fetchLoginParams(username: String): V2LoginParamsResponse {
        val url = buildV2EndpointUrl("/api/v2/login/params")
        val payload = JSONObject().put("username", username.trim()).toString()
        val req = Request.Builder()
            .url(url)
            .post(payload.toRequestBody(JSON_MEDIA_TYPE))
            .build()

        val (status, body) = executeJsonRequest(req)
        if (status !in 200..299) {
            val code = parseErrorCode(body, "HTTP_$status")
            throw V2ApiHttpException(status, code, "Errore recupero parametri KDF ($status: $code).")
        }
        val json = JSONObject(body)
        return V2LoginParamsResponse(
            saltB64u = json.getString("salt"),
            kdfParams = V2KdfParamsDto.fromJson(json.getJSONObject("kdfParams"))
        )
    }

    suspend fun login(username: String, authSecretB64u: String): V2LoginResponse {
        val url = buildV2EndpointUrl("/api/v2/login")
        val payload = JSONObject()
            .put("username", username.trim())
            .put("authSecret", authSecretB64u)
            .toString()
        val req = Request.Builder()
            .url(url)
            .post(payload.toRequestBody(JSON_MEDIA_TYPE))
            .build()

        val (status, body) = executeJsonRequest(req)
        if (status !in 200..299) {
            val code = parseErrorCode(body, "INVALID_CREDENTIALS")
            throw V2ApiHttpException(status, code, "Autenticazione rifiutata ($status: $code).")
        }
        val json = JSONObject(body)
        return V2LoginResponse(
            userId = json.getString("userId"),
            username = json.getString("username"),
            saltB64u = json.getString("salt"),
            kdfParams = V2KdfParamsDto.fromJson(json.getJSONObject("kdfParams")),
            wrappedVaultKeyB64u = json.getString("wrappedVaultKey"),
            csrfToken = json.optString("csrfToken", "")
        )
    }

    suspend fun logout(): Boolean {
        return try {
            val url = buildV2EndpointUrl("/api/v2/logout")
            val req = Request.Builder()
                .url(url)
                .post("{}".toRequestBody(JSON_MEDIA_TYPE))
                .build()
            val (status, _) = executeJsonRequest(req)
            status in 200..299
        } finally {
            cookieJar.clear()
        }
    }

    suspend fun rewrapAccount(
        oldAuthSecretB64u: String,
        newSaltB64u: String,
        newKdfParams: V2KdfParamsDto,
        newAuthSecretB64u: String,
        newWrappedVaultKeyB64u: String
    ): V2RewrapResponse {
        val url = buildV2EndpointUrl("/api/v2/account/rewrap")
        val payload = JSONObject()
            .put("oldAuthSecret", oldAuthSecretB64u)
            .put("newSalt", newSaltB64u)
            .put("newKdfParams", newKdfParams.toJson())
            .put("newAuthSecret", newAuthSecretB64u)
            .put("newWrappedVaultKey", newWrappedVaultKeyB64u)
            .toString()

        val req = Request.Builder()
            .url(url)
            .post(payload.toRequestBody(JSON_MEDIA_TYPE))
            .build()

        val (status, body) = executeJsonRequest(req)
        if (status !in 200..299) {
            val code = parseErrorCode(body, "REWRAP_FAILED")
            throw V2ApiHttpException(status, code, "Errore cambio passphrase ($status: $code).")
        }
        val json = JSONObject(body)
        return V2RewrapResponse(
            ok = json.optBoolean("ok", true),
            saltB64u = json.getString("salt"),
            kdfParams = V2KdfParamsDto.fromJson(json.getJSONObject("kdfParams")),
            wrappedVaultKeyB64u = json.getString("wrappedVaultKey")
        )
    }

    suspend fun listItems(state: String = "active", limit: Int = 100, cursor: String? = null): List<V2ServerItem> {
        val query = buildString {
            append("/api/v2/items?state=").append(state).append("&limit=").append(limit)
            if (!cursor.isNullOrBlank()) {
                append("&cursor=").append(cursor)
            }
        }
        val url = buildV2EndpointUrl(query)
        val req = Request.Builder()
            .url(url)
            .get()
            .build()
        val (status, body) = executeJsonRequest(req)
        if (status !in 200..299) {
            val code = parseErrorCode(body, "HTTP_$status")
            throw V2ApiHttpException(status, code, "Errore caricamento lista item ($status: $code).")
        }
        val json = JSONObject(body)
        val arr = json.optJSONArray("items") ?: JSONArray()
        val items = ArrayList<V2ServerItem>(arr.length())
        for (i in 0 until arr.length()) {
            items.add(parseServerItem(arr.getJSONObject(i)))
        }
        return items
    }

    suspend fun initBlobUpload(
        blobId: String,
        totalSize: Long,
        chunkSize: Int,
        totalChunks: Int,
        expectedSha256Hex: String,
        encMetaB64u: String,
        dedupTag: String? = null,
        itemId: String? = null
    ): V2UploadInitResponse {
        val url = buildV2EndpointUrl("/api/v2/blobs/upload/init")
        val payload = JSONObject()
            .put("blobId", blobId.lowercase())
            .put("totalSize", totalSize)
            .put("chunkSize", chunkSize)
            .put("totalChunks", totalChunks)
            .put("expectedSha256", expectedSha256Hex.lowercase())
            .put("encMeta", encMetaB64u)
            .apply {
                if (!dedupTag.isNullOrBlank()) put("dedupTag", dedupTag)
                if (!itemId.isNullOrBlank()) put("itemId", itemId)
            }
            .toString()
        val req = Request.Builder()
            .url(url)
            .post(payload.toRequestBody(JSON_MEDIA_TYPE))
            .build()
        val (status, body) = executeJsonRequest(req)
        if (status !in 200..299) {
            val code = parseErrorCode(body, "UPLOAD_INIT_FAILED")
            throw V2ApiHttpException(status, code, "Init upload fallito ($status: $code).")
        }
        val json = JSONObject(body)
        return V2UploadInitResponse(
            uploadId = json.getString("uploadId"),
            blobId = json.optString("blobId", blobId.lowercase()),
            receivedChunks = json.optInt("receivedChunks", 0),
            expiresAt = json.optLong("expiresAt", 0L)
        )
    }

    suspend fun uploadBlobChunk(
        uploadId: String,
        chunkIndex: Int,
        body: RequestBody
    ): V2ChunkUploadResponse {
        val url = buildV2EndpointUrl("/api/v2/blobs/upload/$uploadId/$chunkIndex")
        val req = Request.Builder()
            .url(url)
            .put(body)
            .build()
        val (status, respBody) = executeJsonRequest(req)
        if (status == 409) {
            val code = parseErrorCode(respBody, "CHUNK_OUT_OF_ORDER")
            if (code == "CHUNK_OUT_OF_ORDER") {
                val expected = try {
                    JSONObject(respBody).optInt("expectedChunkIndex", 0)
                } catch (_: Throwable) {
                    0
                }
                throw V2ChunkOutOfOrderException(
                    expectedChunkIndex = expected,
                    message = "Chunk fuori ordine: atteso $expected (inviato $chunkIndex)."
                )
            }
            throw V2ApiHttpException(status, code, "Conflitto upload chunk $chunkIndex ($status: $code).")
        }
        if (status !in 200..299) {
            val code = parseErrorCode(respBody, "CHUNK_UPLOAD_FAILED")
            throw V2ApiHttpException(status, code, "Upload chunk $chunkIndex fallito ($status: $code).")
        }
        val json = JSONObject(respBody)
        return V2ChunkUploadResponse(
            uploadId = json.optString("uploadId", uploadId),
            chunkIndex = json.optInt("chunkIndex", chunkIndex),
            receivedChunks = json.optInt("receivedChunks", chunkIndex + 1),
            receivedBytes = json.optLong("receivedBytes", 0L)
        )
    }

    suspend fun completeBlobUpload(
        uploadId: String,
        createItem: Boolean = true
    ): V2ServerItem? {
        val url = buildV2EndpointUrl("/api/v2/blobs/upload/$uploadId/complete")
        val payload = if (createItem) "{}" else JSONObject().put("createItem", false).toString()
        val req = Request.Builder()
            .url(url)
            .post(payload.toRequestBody(JSON_MEDIA_TYPE))
            .build()
        val (status, respBody) = executeJsonRequest(req)
        if (status !in 200..299) {
            val code = parseErrorCode(respBody, "UPLOAD_COMPLETE_FAILED")
            throw V2ApiHttpException(status, code, "Complete upload fallito ($status: $code).")
        }
        val json = JSONObject(respBody)
        return if (json.has("item") && !json.isNull("item")) {
            parseServerItem(json.getJSONObject("item"))
        } else {
            null
        }
    }

    suspend fun abortBlobUpload(uploadId: String): Boolean {
        val url = buildV2EndpointUrl("/api/v2/blobs/upload/$uploadId")
        val req = Request.Builder()
            .url(url)
            .delete()
            .build()
        val (status, _) = executeJsonRequest(req)
        return status in 200..299
    }

    suspend fun uploadEncryptedThumbnail(
        blobId: String,
        variant: String,
        encryptedBytes: ByteArray
    ) {
        if (variant != "320" && variant != "1280") {
            throw IllegalArgumentException("Variante miniatura non supportata: $variant")
        }
        val url = buildV2EndpointUrl("/api/v2/blobs/${blobId.lowercase()}/thumbs/$variant")
        val req = Request.Builder()
            .url(url)
            .put(encryptedBytes.toRequestBody(OCTET_MEDIA_TYPE))
            .build()
        val (status, respBody) = executeJsonRequest(req)
        if (status !in 200..299) {
            val code = parseErrorCode(respBody, "THUMB_UPLOAD_FAILED")
            throw V2ApiHttpException(status, code, "Upload miniatura $variant fallito ($status: $code).")
        }
    }

    suspend fun downloadEncryptedThumbnail(
        blobId: String,
        variant: String
    ): ByteArray? {
        if (variant != "320" && variant != "1280") {
            throw IllegalArgumentException("Variante miniatura non supportata: $variant")
        }
        val url = buildV2EndpointUrl("/api/v2/blobs/${blobId.lowercase()}/thumbs/$variant")
        val req = Request.Builder()
            .url(url)
            .get()
            .build()
        val (status, bytes) = executeBytesRequest(req)
        if (status == 404) return null
        if (status !in 200..299) {
            throw V2ApiHttpException(status, "THUMB_DOWNLOAD_FAILED", "Download miniatura $variant fallito ($status).")
        }
        return bytes
    }

    suspend fun downloadBlobBytes(blobId: String): ByteArray {
        val url = buildV2EndpointUrl("/api/v2/blobs/${blobId.lowercase()}")
        val req = Request.Builder()
            .url(url)
            .get()
            .build()
        val (status, bytes) = executeBytesRequest(req)
        if (status !in 200..299) {
            throw V2ApiHttpException(status, "BLOB_DOWNLOAD_FAILED", "Download blob fallito ($status).")
        }
        return bytes
    }

    suspend fun downloadBlobRange(
        blobId: String,
        startByte: Long,
        endByteInclusive: Long
    ): V2RangeDownloadResult = withContext(Dispatchers.IO) {
        require(startByte >= 0L && endByteInclusive >= startByte) {
            "Range non valido: $startByte..$endByteInclusive"
        }
        val url = buildV2EndpointUrl("/api/v2/blobs/${blobId.lowercase()}")
        val req = Request.Builder()
            .url(url)
            .header("Range", "bytes=$startByte-$endByteInclusive")
            .get()
            .build()
        try {
            httpClient.newCall(req).execute().use { resp ->
                if (resp.code != 206 && resp.code != 200) {
                    throw V2ApiHttpException(resp.code, "RANGE_DOWNLOAD_FAILED", "Download Range fallito (${resp.code}).")
                }
                val bytes = resp.body?.bytes() ?: ByteArray(0)
                val crHeader = resp.header("Content-Range")
                if (crHeader != null) {
                    val m = CONTENT_RANGE_REGEX.matchEntire(crHeader.trim())
                    if (m != null) {
                        val s = m.groupValues[1].toLong()
                        val e = m.groupValues[2].toLong()
                        val total = m.groupValues[3].toLongOrNull() ?: (e + 1L)
                        return@withContext V2RangeDownloadResult(bytes, s, e, total)
                    }
                }
                val contentLength = resp.header("Content-Length")?.toLongOrNull() ?: bytes.size.toLong()
                V2RangeDownloadResult(
                    bytes = bytes,
                    startByte = if (resp.code == 200) 0L else startByte,
                    endByteInclusive = if (resp.code == 200) (bytes.size - 1).coerceAtLeast(0).toLong() else endByteInclusive,
                    totalBytes = contentLength
                )
            }
        } catch (t: Throwable) {
            unwrapTofuOrRethrow(t)
        }
    }

    suspend fun downloadBlobToStream(
        blobId: String,
        output: OutputStream
    ): Long = withContext(Dispatchers.IO) {
        val url = buildV2EndpointUrl("/api/v2/blobs/${blobId.lowercase()}")
        val req = Request.Builder()
            .url(url)
            .get()
            .build()
        try {
            httpClient.newCall(req).execute().use { resp ->
                if (resp.code !in 200..299) {
                    throw V2ApiHttpException(resp.code, "BLOB_DOWNLOAD_FAILED", "Download stream blob fallito (${resp.code}).")
                }
                val stream = resp.body?.byteStream()
                    ?: throw IOException("Corpo risposta vuoto per blob $blobId.")
                val buf = ByteArray(65536)
                var total = 0L
                stream.use { input ->
                    while (true) {
                        val r = input.read(buf)
                        if (r <= 0) break
                        output.write(buf, 0, r)
                        total += r
                    }
                }
                total
            }
        } catch (t: Throwable) {
            unwrapTofuOrRethrow(t)
        }
    }

    suspend fun checkBackupDedupTags(dedupTags: List<String>): V2BackupCheckResponse {
        if (dedupTags.isEmpty()) {
            return V2BackupCheckResponse(emptySet(), emptyMap())
        }
        val url = buildV2EndpointUrl("/api/v2/backup/check")
        val arr = JSONArray()
        for (tag in dedupTags) {
            arr.put(tag)
        }
        val payload = JSONObject().put("dedupTags", arr).toString()
        val req = Request.Builder()
            .url(url)
            .post(payload.toRequestBody(JSON_MEDIA_TYPE))
            .build()
        val (status, respBody) = executeJsonRequest(req)
        if (status !in 200..299) {
            val code = parseErrorCode(respBody, "BACKUP_CHECK_FAILED")
            throw V2ApiHttpException(status, code, "Verifica dedup fallita ($status: $code).")
        }
        val json = JSONObject(respBody)
        val existingArr = json.optJSONArray("existingTags") ?: JSONArray()
        val tagsSet = LinkedHashSet<String>(existingArr.length())
        for (i in 0 until existingArr.length()) {
            tagsSet.add(existingArr.getString(i))
        }
        val itemsMap = LinkedHashMap<String, V2BackupCheckMatch>()
        val itemsObj = json.optJSONObject("existingItems")
        if (itemsObj != null) {
            val keys = itemsObj.keys()
            while (keys.hasNext()) {
                val tag = keys.next()
                val m = itemsObj.optJSONObject(tag)
                if (m != null) {
                    itemsMap[tag] = V2BackupCheckMatch(
                        itemId = m.getString("itemId"),
                        blobId = m.getString("blobId")
                    )
                }
            }
        }
        return V2BackupCheckResponse(existingTags = tagsSet, existingItems = itemsMap)
    }

    suspend fun updateItemMeta(
        itemId: String,
        encMetaB64u: String,
        expectedVersion: Int? = null
    ): V2ServerItem {
        val url = buildV2EndpointUrl("/api/v2/items/$itemId/meta")
        val payload = JSONObject()
            .put("encMeta", encMetaB64u)
            .apply { if (expectedVersion != null) put("expectedVersion", expectedVersion) }
            .toString()
        val req = Request.Builder()
            .url(url)
            .patch(payload.toRequestBody(JSON_MEDIA_TYPE))
            .build()
        val (status, respBody) = executeJsonRequest(req)
        if (status !in 200..299) {
            val code = parseErrorCode(respBody, "META_UPDATE_FAILED")
            throw V2ApiHttpException(status, code, "Aggiornamento metadati fallito ($status: $code).")
        }
        return parseServerItem(JSONObject(respBody).getJSONObject("item"))
    }

    suspend fun replaceItemBlob(
        itemId: String,
        expectedVersion: Int,
        newBlobId: String,
        encMetaB64u: String,
        dedupTag: String? = null
    ): V2ServerItem {
        val url = buildV2EndpointUrl("/api/v2/items/$itemId/replace")
        val payload = JSONObject()
            .put("expectedVersion", expectedVersion)
            .put("newBlobId", newBlobId.lowercase())
            .put("encMeta", encMetaB64u)
            .apply { if (!dedupTag.isNullOrBlank()) put("dedupTag", dedupTag) }
            .toString()
        val req = Request.Builder()
            .url(url)
            .post(payload.toRequestBody(JSON_MEDIA_TYPE))
            .build()
        val (status, respBody) = executeJsonRequest(req)
        if (status !in 200..299) {
            val code = parseErrorCode(respBody, "REPLACE_FAILED")
            throw V2ApiHttpException(status, code, "Sostituzione blob fallita ($status: $code).")
        }
        return parseServerItem(JSONObject(respBody).getJSONObject("item"))
    }

    suspend fun moveToTrash(itemIds: List<String>) {
        if (itemIds.isEmpty()) return
        val url = buildV2EndpointUrl("/api/v2/trash")
        val arr = JSONArray().apply { itemIds.forEach { put(it) } }
        val payload = JSONObject().put("itemIds", arr).toString()
        val req = Request.Builder()
            .url(url)
            .post(payload.toRequestBody(JSON_MEDIA_TYPE))
            .build()
        val (status, respBody) = executeJsonRequest(req)
        if (status !in 200..299) {
            val code = parseErrorCode(respBody, "TRASH_FAILED")
            throw V2ApiHttpException(status, code, "Spostamento nel cestino fallito ($status: $code).")
        }
    }

    suspend fun restoreFromTrash(itemIds: List<String>) {
        if (itemIds.isEmpty()) return
        val url = buildV2EndpointUrl("/api/v2/trash/restore")
        val arr = JSONArray().apply { itemIds.forEach { put(it) } }
        val payload = JSONObject().put("itemIds", arr).toString()
        val req = Request.Builder()
            .url(url)
            .post(payload.toRequestBody(JSON_MEDIA_TYPE))
            .build()
        val (status, respBody) = executeJsonRequest(req)
        if (status !in 200..299) {
            val code = parseErrorCode(respBody, "RESTORE_FAILED")
            throw V2ApiHttpException(status, code, "Ripristino dal cestino fallito ($status: $code).")
        }
    }

    suspend fun deleteItemPermanently(itemId: String) {
        val url = buildV2EndpointUrl("/api/v2/items/$itemId")
        val req = Request.Builder()
            .url(url)
            .delete()
            .build()
        val (status, respBody) = executeJsonRequest(req)
        if (status !in 200..299) {
            val code = parseErrorCode(respBody, "DELETE_FAILED")
            throw V2ApiHttpException(status, code, "Eliminazione definitiva fallita ($status: $code).")
        }
    }

    suspend fun emptyTrash() {
        val url = buildV2EndpointUrl("/api/v2/trash")
        val req = Request.Builder()
            .url(url)
            .delete()
            .build()
        val (status, respBody) = executeJsonRequest(req)
        if (status !in 200..299) {
            val code = parseErrorCode(respBody, "EMPTY_TRASH_FAILED")
            throw V2ApiHttpException(status, code, "Svuotamento cestino fallito ($status: $code).")
        }
    }

    suspend fun fetchStats(): V2StatsResponse {
        val url = buildV2EndpointUrl("/api/v2/stats")
        val req = Request.Builder()
            .url(url)
            .get()
            .build()
        val (status, respBody) = executeJsonRequest(req)
        if (status !in 200..299) {
            val code = parseErrorCode(respBody, "STATS_FAILED")
            throw V2ApiHttpException(status, code, "Caricamento statistiche fallito ($status: $code).")
        }
        val json = JSONObject(respBody)
        return V2StatsResponse(
            activeBytes = json.optLong("activeBytes", 0L),
            trashedBytes = json.optLong("trashedBytes", 0L),
            activeCount = json.optInt("activeCount", 0),
            trashedCount = json.optInt("trashedCount", 0),
            quotaBytes = json.optLong("quotaBytes", 0L)
        )
    }

    suspend fun fetchEncryptedAlbums(): V2EncryptedAlbumsResponse? = withContext(Dispatchers.IO) {
        val url = buildV2EndpointUrl("/api/v2/albums")
        val req = Request.Builder()
            .url(url)
            .get()
            .build()
        try {
            httpClient.newCall(req).execute().use { resp ->
                if (resp.code == 404) return@withContext null
                if (resp.code !in 200..299) {
                    throw V2ApiHttpException(resp.code, "ALBUMS_FETCH_FAILED", "Caricamento album cifrati fallito (${resp.code}).")
                }
                val bytes = resp.body?.bytes() ?: ByteArray(0)
                val etag = resp.header("ETag").orEmpty()
                V2EncryptedAlbumsResponse(bytes = bytes, etag = etag)
            }
        } catch (t: Throwable) {
            unwrapTofuOrRethrow(t)
        }
    }

    suspend fun putEncryptedAlbums(
        encryptedBytes: ByteArray,
        ifMatchEtag: String? = null
    ): V2PutAlbumsResponse {
        val url = buildV2EndpointUrl("/api/v2/albums")
        val reqBuilder = Request.Builder()
            .url(url)
            .put(encryptedBytes.toRequestBody(OCTET_MEDIA_TYPE))
        if (!ifMatchEtag.isNullOrBlank()) {
            reqBuilder.header("If-Match", ifMatchEtag)
        }
        val (status, respBody) = executeJsonRequest(reqBuilder.build())
        if (status !in 200..299) {
            val code = parseErrorCode(respBody, if (status == 412) "PRECONDITION_FAILED" else "ALBUMS_PUT_FAILED")
            throw V2ApiHttpException(status, code, "Salvataggio album cifrati fallito ($status: $code).")
        }
        val json = JSONObject(respBody)
        return V2PutAlbumsResponse(
            etag = json.optString("etag", ""),
            size = json.optLong("size", encryptedBytes.size.toLong()),
            updatedAt = json.optLong("updatedAt", System.currentTimeMillis())
        )
    }

    suspend fun createShare(
        shareId: String,
        items: List<V2ShareItemInput>,
        shareManifestB64u: String? = null,
        encShareMetaB64u: String? = null,
        expiresAt: Long? = null,
        maxDownloads: Int? = null
    ): V2CreateShareResponse {
        val url = buildV2EndpointUrl("/api/v2/shares")
        val itemsArr = JSONArray()
        for (it in items) {
            val o = JSONObject()
                .put("blobId", it.blobId.lowercase())
                .put("wrappedFk", it.wrappedFkB64u)
            if (!it.encItemMetaB64u.isNullOrBlank()) {
                o.put("encItemMeta", it.encItemMetaB64u)
            }
            itemsArr.put(o)
        }
        val payload = JSONObject()
            .put("shareId", shareId.lowercase())
            .put("items", itemsArr)
            .apply {
                if (!shareManifestB64u.isNullOrBlank()) put("shareManifest", shareManifestB64u)
                if (!encShareMetaB64u.isNullOrBlank()) put("encShareMeta", encShareMetaB64u)
                if (expiresAt != null) put("expiresAt", expiresAt)
                if (maxDownloads != null) put("maxDownloads", maxDownloads)
            }
            .toString()
        val req = Request.Builder()
            .url(url)
            .post(payload.toRequestBody(JSON_MEDIA_TYPE))
            .build()
        val (status, respBody) = executeJsonRequest(req)
        if (status !in 200..299) {
            val code = parseErrorCode(respBody, "SHARE_CREATE_FAILED")
            throw V2ApiHttpException(status, code, "Creazione link condiviso fallita ($status: $code).")
        }
        val json = JSONObject(respBody)
        return V2CreateShareResponse(
            shareId = json.getString("shareId"),
            expiresAt = if (json.isNull("expiresAt")) null else json.optLong("expiresAt"),
            maxDownloads = if (json.isNull("maxDownloads")) null else json.optInt("maxDownloads"),
            createdAt = json.optLong("createdAt", System.currentTimeMillis())
        )
    }

    suspend fun listOwnerShares(): List<V2OwnerShareDto> {
        val url = buildV2EndpointUrl("/api/v2/shares")
        val req = Request.Builder()
            .url(url)
            .get()
            .build()
        val (status, respBody) = executeJsonRequest(req)
        if (status !in 200..299) {
            val code = parseErrorCode(respBody, "SHARES_LIST_FAILED")
            throw V2ApiHttpException(status, code, "Caricamento condivisioni fallito ($status: $code).")
        }
        val json = JSONObject(respBody)
        val arr = json.optJSONArray("shares") ?: JSONArray()
        val result = ArrayList<V2OwnerShareDto>(arr.length())
        for (i in 0 until arr.length()) {
            val o = arr.getJSONObject(i)
            result.add(
                V2OwnerShareDto(
                    shareId = o.getString("shareId"),
                    encShareMetaB64u = if (o.has("encShareMeta") && !o.isNull("encShareMeta")) o.optString("encShareMeta") else null,
                    hasPassword = o.optBoolean("hasPassword", false),
                    itemCount = o.optInt("itemCount", 0),
                    expiresAt = if (o.has("expiresAt") && !o.isNull("expiresAt")) o.optLong("expiresAt") else null,
                    maxDownloads = if (o.has("maxDownloads") && !o.isNull("maxDownloads")) o.optInt("maxDownloads") else null,
                    downloadsCount = o.optInt("downloadsCount", o.optInt("downloadCount", 0)),
                    createdAt = o.optLong("createdAt", 0L)
                )
            )
        }
        return result
    }

    suspend fun revokeShare(shareId: String) {
        val url = buildV2EndpointUrl("/api/v2/shares/${shareId.lowercase()}")
        val req = Request.Builder()
            .url(url)
            .delete()
            .build()
        val (status, respBody) = executeJsonRequest(req)
        if (status !in 200..299) {
            val code = parseErrorCode(respBody, "SHARE_REVOKE_FAILED")
            throw V2ApiHttpException(status, code, "Revoca link condiviso fallita ($status: $code).")
        }
    }

    /**
     * Convenience helper for small in-memory ciphertext blobs (used by live integration tests).
     * Large uploads MUST use [ZkBlobUploadPipeline] for constant-memory streaming.
     */
    suspend fun uploadEncryptedBlobChunked(
        blobId: String,
        pczkCiphertext: ByteArray,
        expectedSha256Hex: String,
        encMetaB64u: String,
        chunkSize: Int = 65536,
        dedupTagB64u: String? = null
    ): V2ServerItem {
        val effectiveChunkSize = chunkSize.coerceAtLeast(1024)
        val totalSize = pczkCiphertext.size
        val totalChunks = ((totalSize + effectiveChunkSize - 1) / effectiveChunkSize).coerceAtLeast(1)

        val initResp = initBlobUpload(
            blobId = blobId,
            totalSize = totalSize.toLong(),
            chunkSize = effectiveChunkSize,
            totalChunks = totalChunks,
            expectedSha256Hex = expectedSha256Hex,
            encMetaB64u = encMetaB64u,
            dedupTag = dedupTagB64u
        )

        for (chunkIndex in 0 until totalChunks) {
            val start = chunkIndex * effectiveChunkSize
            val endExcl = min(totalSize, start + effectiveChunkSize)
            val sliceLen = endExcl - start
            val chunkBody = pczkCiphertext.toRequestBody(OCTET_MEDIA_TYPE, start, sliceLen)
            uploadBlobChunk(initResp.uploadId, chunkIndex, chunkBody)
        }

        return completeBlobUpload(initResp.uploadId, createItem = true)
            ?: throw IOException("Risposta /complete priva di item.")
    }
}
