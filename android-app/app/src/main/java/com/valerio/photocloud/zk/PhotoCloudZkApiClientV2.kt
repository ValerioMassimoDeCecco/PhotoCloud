package com.valerio.photocloud.zk

import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import okhttp3.HttpUrl
import okhttp3.HttpUrl.Companion.toHttpUrlOrNull
import okhttp3.Interceptor
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.RequestBody.Companion.toRequestBody
import org.json.JSONArray
import org.json.JSONObject
import java.io.IOException
import java.util.concurrent.TimeUnit
import javax.net.ssl.X509TrustManager
import kotlin.math.min

class InsecureTransportException(message: String) : IOException(message)

class V2EndpointViolationException(message: String) : IllegalArgumentException(message)

class V2ApiHttpException(
    val statusCode: Int,
    val errorCode: String,
    message: String
) : IOException(message)

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

/**
 * Isolated OkHttp network client strictly bound to PhotoCloud `/api/v2/*` endpoints (FASE 4B).
 *
 * Security guarantees:
 * - Enforces HTTPS everywhere except explicit loopback hosts (`localhost`, `127.0.0.1`, `::1`, `10.0.2.2`)
 *   when [allowLocalhostHttpForTests] is enabled.
 * - Rejects any path outside `/api/v2/*` before issuing any network call.
 * - Uses [TofuSpkiTrustManager] for self-signed servers (no TrustAll, default strict HostnameVerifier intact).
 * - Uses [ZkV2CookieJar] isolated to `/api/v2/*` in memory.
 * - Never sends or logs `passphrase`, `accountKey`, `root`, `kek`, `VK`, or `FK`.
 */
class PhotoCloudZkApiClientV2(
    initialBaseUrl: String,
    private val pinStore: TofuSpkiPinStore = InMemoryTofuSpkiPinStore(),
    private val allowLocalhostHttpForTests: Boolean = false,
    val cookieJar: ZkV2CookieJar = ZkV2CookieJar(allowLocalhostHttpForTests = allowLocalhostHttpForTests),
    systemTrustManager: X509TrustManager = TofuSpkiPinning.defaultSystemTrustManager(),
    extraInterceptors: List<Interceptor> = emptyList()
) {
    companion object {
        private val JSON_MEDIA_TYPE = "application/json; charset=utf-8".toMediaType()
        private val OCTET_MEDIA_TYPE = "application/octet-stream".toMediaType()
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
            val reqBuilder = original.newBuilder()
                .header("X-PhotoCloud-Request", "1")
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
            allowLocalhostHttpForTests && parsed.scheme.equals("http", ignoreCase = true) ->
                ZkV2CookieJar.isLoopbackHost(parsed.host)
            else -> false
        }
        if (!permitted) {
            throw InsecureTransportException(
                "HTTPS obbligatorio per PhotoCloud Zero-Knowledge v2 (HTTP consentito solo su localhost/127.0.0.1/10.0.2.2 in test)."
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

    private suspend fun executeJsonRequest(
        request: Request
    ): Pair<Int, String> = withContext(Dispatchers.IO) {
        try {
            httpClient.newCall(request).execute().use { resp ->
                val body = resp.body?.string().orEmpty()
                resp.code to body
            }
        } catch (t: Throwable) {
            TofuSpkiPinning.findTofuConfirmationChallenge(t)?.let { challenge ->
                throw TofuConfirmationRequiredException(challenge)
            }
            TofuSpkiPinning.findTofuPinMismatch(t)?.let { mismatch ->
                throw TofuPinMismatchException(mismatch)
            }
            throw t
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
            TofuSpkiPinning.findTofuConfirmationChallenge(t)?.let { challenge ->
                throw TofuConfirmationRequiredException(challenge)
            }
            TofuSpkiPinning.findTofuPinMismatch(t)?.let { mismatch ->
                throw TofuPinMismatchException(mismatch)
            }
            throw t
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

    /**
     * Minimal `/api/v2/items` listing helper used by live integration tests (no 4C/4D UI).
     */
    suspend fun listItems(state: String = "active", limit: Int = 100): List<V2ServerItem> {
        val url = buildV2EndpointUrl("/api/v2/items?state=$state&limit=$limit")
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
            val obj = arr.getJSONObject(i)
            val thumbsArr = obj.optJSONArray("thumbs") ?: JSONArray()
            val thumbs = ArrayList<Int>(thumbsArr.length())
            for (t in 0 until thumbsArr.length()) {
                thumbs.add(thumbsArr.getInt(t))
            }
            items.add(
                V2ServerItem(
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
            )
        }
        return items
    }

    /**
     * Minimal `/api/v2/blobs/:id` ciphertext download helper used by live integration tests.
     */
    suspend fun downloadBlobBytes(blobId: String): ByteArray {
        val url = buildV2EndpointUrl("/api/v2/blobs/$blobId")
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

    /**
     * Minimal `/api/v2/blobs/upload/...` ciphertext upload helper used by bidirectional live
     * integration tests (Kotlin upload -> TypeScript decryption). Full AutoBackupWorker UI
     * & streaming queue remain scoped to FASE 4C.
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

        val initUrl = buildV2EndpointUrl("/api/v2/blobs/upload/init")
        val initPayload = JSONObject()
            .put("blobId", blobId)
            .put("totalSize", totalSize)
            .put("chunkSize", effectiveChunkSize)
            .put("totalChunks", totalChunks)
            .put("expectedSha256", expectedSha256Hex.lowercase())
            .put("encMeta", encMetaB64u)
            .apply {
                if (dedupTagB64u != null) put("dedupTag", dedupTagB64u)
            }
            .toString()

        val initReq = Request.Builder()
            .url(initUrl)
            .post(initPayload.toRequestBody(JSON_MEDIA_TYPE))
            .build()
        val (initStatus, initBody) = executeJsonRequest(initReq)
        if (initStatus !in 200..299) {
            val code = parseErrorCode(initBody, "UPLOAD_INIT_FAILED")
            throw V2ApiHttpException(initStatus, code, "Init upload fallito ($initStatus: $code).")
        }
        val uploadId = JSONObject(initBody).getString("uploadId")

        for (chunkIndex in 0 until totalChunks) {
            val start = chunkIndex * effectiveChunkSize
            val endExcl = min(totalSize, start + effectiveChunkSize)
            val sliceLen = endExcl - start
            val chunkUrl = buildV2EndpointUrl("/api/v2/blobs/upload/$uploadId/$chunkIndex")
            val chunkBody = pczkCiphertext.toRequestBody(OCTET_MEDIA_TYPE, start, sliceLen)
            val chunkReq = Request.Builder()
                .url(chunkUrl)
                .put(chunkBody)
                .build()
            val (chunkStatus, chunkResp) = executeJsonRequest(chunkReq)
            if (chunkStatus !in 200..299) {
                val code = parseErrorCode(chunkResp, "CHUNK_UPLOAD_FAILED")
                throw V2ApiHttpException(chunkStatus, code, "Upload chunk $chunkIndex fallito ($chunkStatus: $code).")
            }
        }

        val completeUrl = buildV2EndpointUrl("/api/v2/blobs/upload/$uploadId/complete")
        val completeReq = Request.Builder()
            .url(completeUrl)
            .post("{}".toRequestBody(JSON_MEDIA_TYPE))
            .build()
        val (completeStatus, completeBody) = executeJsonRequest(completeReq)
        if (completeStatus !in 200..299) {
            val code = parseErrorCode(completeBody, "UPLOAD_COMPLETE_FAILED")
            throw V2ApiHttpException(completeStatus, code, "Complete upload fallito ($completeStatus: $code).")
        }
        val itemObj = JSONObject(completeBody).getJSONObject("item")
        val thumbsArr = itemObj.optJSONArray("thumbs") ?: JSONArray()
        val thumbs = ArrayList<Int>(thumbsArr.length())
        for (i in 0 until thumbsArr.length()) {
            thumbs.add(thumbsArr.getInt(i))
        }
        return V2ServerItem(
            id = itemObj.getString("id"),
            blobId = itemObj.getString("blobId"),
            version = itemObj.getInt("version"),
            size = itemObj.getLong("size"),
            sha256 = itemObj.getString("sha256"),
            createdAt = itemObj.getLong("createdAt"),
            updatedAt = itemObj.getLong("updatedAt"),
            state = itemObj.getString("state"),
            trashedAt = if (itemObj.isNull("trashedAt")) null else itemObj.getLong("trashedAt"),
            encMetaB64u = itemObj.getString("encMeta"),
            dedupTag = if (itemObj.isNull("dedupTag")) null else itemObj.getString("dedupTag"),
            thumbs = thumbs
        )
    }
}
