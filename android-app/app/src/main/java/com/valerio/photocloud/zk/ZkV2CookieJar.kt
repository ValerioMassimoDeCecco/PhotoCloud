package com.valerio.photocloud.zk

import okhttp3.Cookie
import okhttp3.CookieJar
import okhttp3.HttpUrl
import java.util.concurrent.ConcurrentHashMap

/**
 * Dedicated, strictly isolated [CookieJar] for `/api/v2/*` requests only (FASE 4B).
 *
 * Security rules:
 * - Never accepts or sends cookies for non-`/api/v2` paths (prevents leaking v2 `photocloud_v2_sid`
 *   to legacy `/api/*` endpoints).
 * - Only sends `Secure` cookies over HTTPS, except on explicit loopback test hosts
 *   (`localhost`, `127.0.0.1`, `::1`, `10.0.2.2`) when [allowLocalhostHttpForTests] is enabled,
 *   because `zkServerV2.ts` emits `; Secure` for `isSecureOrLocalhostRequest(req)`.
 * - Keeps session cookies exclusively in memory and clears them immediately on logout/reset.
 */
class ZkV2CookieJar(
    private val allowLocalhostHttpForTests: Boolean = false
) : CookieJar {

    companion object {
        private val ALLOWED_SESSION_COOKIE_NAMES = setOf(
            "photocloud_v2_sid",
            "__Host-photocloud_v2_sid",
            "__Host-pczk_sid",
            "pczk_sid"
        )

        fun isLoopbackHost(host: String): Boolean {
            val normalized = host.trim().lowercase().trim('[', ']')
            return normalized == "localhost" ||
                normalized == "127.0.0.1" ||
                normalized == "::1" ||
                normalized == "10.0.2.2"
        }

        fun isV2ApiPath(url: HttpUrl): Boolean {
            val path = url.encodedPath
            return path == "/api/v2" || path.startsWith("/api/v2/")
        }

        private fun pathMatches(requestPath: String, cookiePath: String): Boolean {
            if (cookiePath == "/") return true
            if (requestPath == cookiePath) return true
            val normalizedPrefix = if (cookiePath.endsWith("/")) cookiePath else "$cookiePath/"
            return requestPath.startsWith(normalizedPrefix)
        }
    }

    private val cookiesByKey = ConcurrentHashMap<String, Cookie>()

    private fun isTransportPermitted(url: HttpUrl): Boolean {
        if (url.isHttps) return true
        return allowLocalhostHttpForTests && isLoopbackHost(url.host)
    }

    override fun saveFromResponse(url: HttpUrl, cookies: List<Cookie>) {
        if (!isV2ApiPath(url)) return
        if (!isTransportPermitted(url)) return

        val now = System.currentTimeMillis()
        for (cookie in cookies) {
            if (!ALLOWED_SESSION_COOKIE_NAMES.contains(cookie.name)) continue
            val key = "${url.host.lowercase()}:${cookie.name}"
            if (cookie.expiresAt <= now || cookie.value.isBlank()) {
                cookiesByKey.remove(key)
            } else {
                cookiesByKey[key] = cookie
            }
        }
    }

    override fun loadForRequest(url: HttpUrl): List<Cookie> {
        if (!isV2ApiPath(url)) return emptyList()
        if (!isTransportPermitted(url)) return emptyList()

        val now = System.currentTimeMillis()
        val matched = mutableListOf<Cookie>()
        val iterator = cookiesByKey.entries.iterator()
        while (iterator.hasNext()) {
            val entry = iterator.next()
            val cookie = entry.value
            if (cookie.expiresAt <= now) {
                iterator.remove()
                continue
            }
            if (!cookie.domain.equals(url.host, ignoreCase = true) &&
                !url.host.lowercase().endsWith(".${cookie.domain.lowercase()}")
            ) {
                continue
            }
            if (!pathMatches(url.encodedPath, cookie.path)) {
                continue
            }
            if (cookie.secure && !url.isHttps && !(allowLocalhostHttpForTests && isLoopbackHost(url.host))) {
                continue
            }
            matched.add(cookie)
        }
        return matched
    }

    fun hasActiveSessionCookie(baseUrl: HttpUrl): Boolean {
        return loadForRequest(
            baseUrl.newBuilder().encodedPath("/api/v2/items").build()
        ).isNotEmpty()
    }

    fun clear() {
        cookiesByKey.clear()
    }
}
