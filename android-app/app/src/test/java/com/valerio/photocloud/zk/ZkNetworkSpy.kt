package com.valerio.photocloud.zk

import okhttp3.Interceptor
import okhttp3.Response
import okio.Buffer
import java.net.URLEncoder
import java.nio.charset.StandardCharsets
import java.util.Base64

data class CapturedHttpExchange(
    val method: String,
    val url: String,
    val path: String,
    val headersText: String,
    val bodyBytes: ByteArray,
    val bodyUtf8: String
)

data class TrackedSecret(
    val label: String,
    val rawString: String? = null,
    val bytes: ByteArray? = null
) {
    fun buildEncodings(): Set<String> {
        val out = LinkedHashSet<String>()
        if (!rawString.isNullOrEmpty() && rawString.length >= 6) {
            out.add(rawString)
            out.add(URLEncoder.encode(rawString, StandardCharsets.UTF_8.name()))
            val utf8 = rawString.toByteArray(StandardCharsets.UTF_8)
            addByteEncodings(out, utf8)
        }
        if (bytes != null && bytes.size >= 8) {
            addByteEncodings(out, bytes)
        }
        return out
    }

    private fun addByteEncodings(out: MutableSet<String>, raw: ByteArray) {
        val hexLower = ZkCoreCrypto.toHex(raw)
        out.add(hexLower)
        out.add(hexLower.uppercase())
        out.add(Base64.getEncoder().encodeToString(raw))
        out.add(ZkCoreCrypto.toBase64Url(raw))
        out.add(String(raw, StandardCharsets.ISO_8859_1))
    }
}

/**
 * OkHttp Interceptor verifying that NO secret material (`raw`, `hex`, `base64`, `base64url`, URL-encoded)
 * ever leaves the Android client in URL, headers, or request body (FASE 4B Network Spy).
 */
class ZkNetworkSpyInterceptor : Interceptor {
    private val exchanges = mutableListOf<CapturedHttpExchange>()

    @Synchronized
    fun snapshot(): List<CapturedHttpExchange> = exchanges.toList()

    @Synchronized
    fun clear() {
        exchanges.clear()
    }

    override fun intercept(chain: Interceptor.Chain): Response {
        val request = chain.request()
        val headersBuilder = StringBuilder()
        for (i in 0 until request.headers.size) {
            headersBuilder.append(request.headers.name(i))
                .append(": ")
                .append(request.headers.value(i))
                .append('\n')
        }
        val buf = Buffer()
        request.body?.writeTo(buf)
        val bodyBytes = buf.readByteArray()
        val bodyUtf8 = String(bodyBytes, StandardCharsets.UTF_8)

        synchronized(this) {
            exchanges.add(
                CapturedHttpExchange(
                    method = request.method,
                    url = request.url.toString(),
                    path = request.url.encodedPath,
                    headersText = headersBuilder.toString(),
                    bodyBytes = bodyBytes,
                    bodyUtf8 = bodyUtf8
                )
            )
        }
        return chain.proceed(request)
    }

    fun assertZeroSecretLeaks(secrets: List<TrackedSecret>) {
        val captured = snapshot()
        require(captured.isNotEmpty()) { "Network spy expected at least 1 HTTP exchange." }

        for (secret in secrets) {
            val encodings = secret.buildEncodings()
            for (ex in captured) {
                if (!ex.path.startsWith("/api/v2/")) {
                    throw AssertionError("Non-/api/v2/* request observed by spy: ${ex.method} ${ex.url}")
                }
                val bodyLatin1 = String(ex.bodyBytes, StandardCharsets.ISO_8859_1)
                for (enc in encodings) {
                    if (enc.isEmpty()) continue
                    if (ex.url.contains(enc)) {
                        throw AssertionError("SECRET LEAK in URL for '${secret.label}' (${ex.method} ${ex.url})")
                    }
                    if (ex.headersText.contains(enc)) {
                        throw AssertionError("SECRET LEAK in HTTP headers for '${secret.label}' (${ex.method} ${ex.url})")
                    }
                    if (ex.bodyUtf8.contains(enc) || bodyLatin1.contains(enc)) {
                        throw AssertionError("SECRET LEAK in HTTP body for '${secret.label}' (${ex.method} ${ex.url})")
                    }
                }
            }
        }
    }
}
