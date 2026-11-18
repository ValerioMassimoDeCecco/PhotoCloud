package com.valerio.photocloud.zk

import android.content.Context
import android.content.SharedPreferences
import okhttp3.HttpUrl
import org.json.JSONObject
import java.net.Socket
import java.security.KeyStore
import java.security.MessageDigest
import java.security.cert.CertificateException
import java.security.cert.X509Certificate
import java.util.Base64
import java.util.concurrent.ConcurrentHashMap
import javax.net.ssl.SSLContext
import javax.net.ssl.SSLEngine
import javax.net.ssl.SSLSocketFactory
import javax.net.ssl.TrustManagerFactory
import javax.net.ssl.X509ExtendedTrustManager
import javax.net.ssl.X509TrustManager

/**
 * Trust-On-First-Use (TOFU) SPKI SHA-256 Pinning for self-hosted HTTPS servers (FASE 4B).
 *
 * Security invariants:
 * - Never trusts all certificates (`TrustAll`) and never disables `HostnameVerifier`.
 * - Rejects expired / not-yet-valid certificates before pin checks.
 * - First checks standard system CA trust store. If trusted by a system CA and no conflicting pin
 *   is stored, succeeds immediately. If a pin IS stored for that host:port, enforces pin match.
 * - If the server presents a self-signed or private-CA certificate (not in system trust store):
 *   - No pin stored yet -> rejects TLS handshake immediately with [TofuConfirmationRequiredException]
 *     carrying the SPKI SHA-256 fingerprint so UI can ask the user for explicit confirmation.
 *   - Pin stored and matches -> allows handshake (subject to OkHttp strict `HostnameVerifier`).
 *   - Pin stored and changed -> aborts TLS handshake immediately with [TofuPinMismatchException].
 */
object TofuSpkiPinning {

    fun canonicalHostPort(url: HttpUrl): String {
        return "${url.host.lowercase()}:${url.port}"
    }

    fun canonicalHostPort(host: String, port: Int): String {
        val h = host.trim().lowercase()
        val p = if (port > 0) port else 443
        return "$h:$p"
    }

    fun computeSpkiPin(cert: X509Certificate): String {
        val spkiBytes = cert.publicKey.encoded
            ?: throw CertificateException("Certificate has null SPKI encoding.")
        val digest = MessageDigest.getInstance("SHA-256").digest(spkiBytes)
        return "sha256/" + Base64.getEncoder().encodeToString(digest)
    }

    fun computeCertSha256Hex(cert: X509Certificate): String {
        val digest = MessageDigest.getInstance("SHA-256").digest(cert.encoded)
        return digest.joinToString("") { "%02x".format(it.toInt() and 0xff) }
    }

    fun constantTimePinEquals(expected: String, actual: String): Boolean {
        return MessageDigest.isEqual(
            expected.toByteArray(Charsets.UTF_8),
            actual.toByteArray(Charsets.UTF_8)
        )
    }

    fun findTofuConfirmationChallenge(t: Throwable): TofuPinChallenge? {
        var cur: Throwable? = t
        while (cur != null) {
            if (cur is TofuConfirmationRequiredException) return cur.challenge
            cur = cur.cause
        }
        return null
    }

    fun findTofuPinMismatch(t: Throwable): TofuPinMismatch? {
        var cur: Throwable? = t
        while (cur != null) {
            if (cur is TofuPinMismatchException) return cur.mismatch
            cur = cur.cause
        }
        return null
    }

    fun defaultSystemTrustManager(): X509TrustManager {
        val tmf = TrustManagerFactory.getInstance(TrustManagerFactory.getDefaultAlgorithm())
        tmf.init(null as KeyStore?)
        return tmf.trustManagers.filterIsInstance<X509TrustManager>().firstOrNull()
            ?: throw IllegalStateException("No default X509TrustManager available.")
    }

    fun createSslSocketFactory(trustManager: X509TrustManager): SSLSocketFactory {
        val ctx = SSLContext.getInstance("TLS")
        ctx.init(null, arrayOf(trustManager), null)
        return ctx.socketFactory
    }
}

data class TofuPinRecord(
    val hostPort: String,
    val spkiPin: String,
    val certSha256Hex: String,
    val subject: String,
    val issuer: String,
    val trustedAtMs: Long
)

data class TofuPinChallenge(
    val hostPort: String,
    val spkiPin: String,
    val certSha256Hex: String,
    val subject: String,
    val issuer: String
)

data class TofuPinMismatch(
    val hostPort: String,
    val expectedSpkiPin: String,
    val actualSpkiPin: String,
    val actualCertSha256Hex: String,
    val subject: String,
    val issuer: String
)

class TofuConfirmationRequiredException(
    val challenge: TofuPinChallenge
) : CertificateException(
    "Certificato HTTPS non riconosciuto per ${challenge.hostPort}: richiesta conferma esplicita TOFU SPKI (${challenge.spkiPin})."
)

class TofuPinMismatchException(
    val mismatch: TofuPinMismatch
) : CertificateException(
    "ATTENZIONE: Il fingerprint SPKI del server ${mismatch.hostPort} è cambiato (${mismatch.expectedSpkiPin} -> ${mismatch.actualSpkiPin}). Possibile attacco MITM o rotazione certificato non autorizzata."
)

interface TofuSpkiPinStore {
    fun getPin(hostPort: String): TofuPinRecord?
    fun savePin(record: TofuPinRecord)
    fun removePin(hostPort: String)
    fun listPins(): List<TofuPinRecord>
    fun clearAll()
}

class InMemoryTofuSpkiPinStore : TofuSpkiPinStore {
    private val map = ConcurrentHashMap<String, TofuPinRecord>()

    override fun getPin(hostPort: String): TofuPinRecord? = map[hostPort.lowercase()]

    override fun savePin(record: TofuPinRecord) {
        map[record.hostPort.lowercase()] = record
    }

    override fun removePin(hostPort: String) {
        map.remove(hostPort.lowercase())
    }

    override fun listPins(): List<TofuPinRecord> = map.values.toList()

    override fun clearAll() {
        map.clear()
    }
}

class PrefsTofuSpkiPinStore(
    context: Context
) : TofuSpkiPinStore {

    companion object {
        private const val PREFS_NAME = "photocloud_v2_tofu_pins"
    }

    private val prefs: SharedPreferences =
        context.applicationContext.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE)

    override fun getPin(hostPort: String): TofuPinRecord? {
        val raw = prefs.getString(hostPort.lowercase(), null) ?: return null
        return try {
            val obj = JSONObject(raw)
            TofuPinRecord(
                hostPort = obj.getString("hostPort"),
                spkiPin = obj.getString("spkiPin"),
                certSha256Hex = obj.getString("certSha256Hex"),
                subject = obj.optString("subject", ""),
                issuer = obj.optString("issuer", ""),
                trustedAtMs = obj.optLong("trustedAtMs", 0L)
            )
        } catch (_: Throwable) {
            null
        }
    }

    override fun savePin(record: TofuPinRecord) {
        val obj = JSONObject()
            .put("hostPort", record.hostPort.lowercase())
            .put("spkiPin", record.spkiPin)
            .put("certSha256Hex", record.certSha256Hex)
            .put("subject", record.subject)
            .put("issuer", record.issuer)
            .put("trustedAtMs", record.trustedAtMs)
        prefs.edit().putString(record.hostPort.lowercase(), obj.toString()).apply()
    }

    override fun removePin(hostPort: String) {
        prefs.edit().remove(hostPort.lowercase()).apply()
    }

    override fun listPins(): List<TofuPinRecord> {
        return prefs.all.keys.mapNotNull { getPin(it) }
    }

    override fun clearAll() {
        prefs.edit().clear().apply()
    }
}

class TofuSpkiTrustManager(
    private val pinStore: TofuSpkiPinStore,
    private val systemTrustManager: X509TrustManager = TofuSpkiPinning.defaultSystemTrustManager(),
    private val fallbackHostPortProvider: () -> String = { "unknown:443" }
) : X509ExtendedTrustManager() {

    override fun checkClientTrusted(chain: Array<out X509Certificate>?, authType: String?) {
        systemTrustManager.checkClientTrusted(chain, authType)
    }

    override fun checkClientTrusted(
        chain: Array<out X509Certificate>?,
        authType: String?,
        socket: Socket?
    ) {
        systemTrustManager.checkClientTrusted(chain, authType)
    }

    override fun checkClientTrusted(
        chain: Array<out X509Certificate>?,
        authType: String?,
        engine: SSLEngine?
    ) {
        systemTrustManager.checkClientTrusted(chain, authType)
    }

    override fun checkServerTrusted(chain: Array<out X509Certificate>?, authType: String?) {
        verifyWithTofu(chain, authType, fallbackHostPortProvider())
    }

    override fun checkServerTrusted(
        chain: Array<out X509Certificate>?,
        authType: String?,
        socket: Socket?
    ) {
        val host = socket?.inetAddress?.hostName ?: socket?.inetAddress?.hostAddress
        val port = socket?.port ?: -1
        val hostPort = if (!host.isNullOrBlank() && port > 0) {
            TofuSpkiPinning.canonicalHostPort(host, port)
        } else {
            fallbackHostPortProvider()
        }
        verifyWithTofu(chain, authType, hostPort)
    }

    override fun checkServerTrusted(
        chain: Array<out X509Certificate>?,
        authType: String?,
        engine: SSLEngine?
    ) {
        val host = engine?.peerHost
        val port = engine?.peerPort ?: -1
        val hostPort = if (!host.isNullOrBlank() && port > 0) {
            TofuSpkiPinning.canonicalHostPort(host, port)
        } else {
            fallbackHostPortProvider()
        }
        verifyWithTofu(chain, authType, hostPort)
    }

    override fun getAcceptedIssuers(): Array<X509Certificate> {
        return systemTrustManager.acceptedIssuers
    }

    private fun verifyWithTofu(
        chain: Array<out X509Certificate>?,
        authType: String?,
        hostPort: String
    ) {
        if (chain.isNullOrEmpty()) {
            throw CertificateException("Empty server certificate chain for $hostPort.")
        }
        if (authType.isNullOrBlank()) {
            throw CertificateException("Missing authType for $hostPort.")
        }

        val leaf = chain[0]
        // Always enforce certificate validity window (notBefore / notAfter).
        leaf.checkValidity()

        val spkiPin = TofuSpkiPinning.computeSpkiPin(leaf)
        val certSha256 = TofuSpkiPinning.computeCertSha256Hex(leaf)
        val subject = leaf.subjectX500Principal?.name.orEmpty()
        val issuer = leaf.issuerX500Principal?.name.orEmpty()
        val pinned = pinStore.getPin(hostPort)

        val systemTrusted = try {
            systemTrustManager.checkServerTrusted(chain, authType)
            true
        } catch (_: CertificateException) {
            false
        }

        if (systemTrusted) {
            if (pinned != null && !TofuSpkiPinning.constantTimePinEquals(pinned.spkiPin, spkiPin)) {
                throw TofuPinMismatchException(
                    TofuPinMismatch(
                        hostPort = hostPort,
                        expectedSpkiPin = pinned.spkiPin,
                        actualSpkiPin = spkiPin,
                        actualCertSha256Hex = certSha256,
                        subject = subject,
                        issuer = issuer
                    )
                )
            }
            return
        }

        if (pinned == null) {
            throw TofuConfirmationRequiredException(
                TofuPinChallenge(
                    hostPort = hostPort,
                    spkiPin = spkiPin,
                    certSha256Hex = certSha256,
                    subject = subject,
                    issuer = issuer
                )
            )
        }

        if (!TofuSpkiPinning.constantTimePinEquals(pinned.spkiPin, spkiPin)) {
            throw TofuPinMismatchException(
                TofuPinMismatch(
                    hostPort = hostPort,
                    expectedSpkiPin = pinned.spkiPin,
                    actualSpkiPin = spkiPin,
                    actualCertSha256Hex = certSha256,
                    subject = subject,
                    issuer = issuer
                )
            )
        }
    }
}
