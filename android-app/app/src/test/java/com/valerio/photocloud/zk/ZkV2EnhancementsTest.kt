package com.valerio.photocloud.zk

import kotlinx.coroutines.test.runTest
import okhttp3.mockwebserver.Dispatcher
import okhttp3.mockwebserver.MockResponse
import okhttp3.mockwebserver.MockWebServer
import okhttp3.mockwebserver.RecordedRequest
import org.json.JSONObject
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertTrue
import org.junit.Assert.fail
import org.junit.Test
import java.util.UUID

/**
 * Unit tests covering the V1-simple Zero-Knowledge UX, owner-encrypted share metadata,
 * and cold-restart biometric HTTP session renewal on Android V2.
 */
class ZkV2EnhancementsTest {

    @Test
    fun `encryptOwnerShareMeta and decryptOwnerShareMeta enforce AAD binding on shareId`() {
        val vk = JvmCryptoProvider.randomBytes(32)
        val subkeys = ZkCoreCrypto.deriveSubkeys(vk, JvmCryptoProvider)
        val payload = JSONObject()
            .put("v", 1)
            .put("title", "Vacanze Estive")
            .put("itemCount", 4)
            .put("shareKeyB64u", ZkCoreCrypto.toBase64Url(JvmCryptoProvider.randomBytes(32)))
            .put("hasPassword", false)
            .put("createdAt", 1700000000000L)
            .toString()

        val shareId = UUID.randomUUID().toString()
        val encrypted = ZkCoreCrypto.encryptOwnerShareMeta(
            metaKey = subkeys.metaKey,
            shareId = shareId,
            plaintextJson = payload,
            cryptoProvider = JvmCryptoProvider
        )
        val decrypted = ZkCoreCrypto.decryptOwnerShareMeta(
            metaKey = subkeys.metaKey,
            shareId = shareId.uppercase(),
            encryptedOwnerMeta = encrypted,
            cryptoProvider = JvmCryptoProvider
        )
        val parsed = JSONObject(decrypted)
        assertEquals("Vacanze Estive", parsed.getString("title"))
        assertEquals(4, parsed.getInt("itemCount"))

        // Tampering or wrong shareId AAD must fail GCM authentication
        try {
            ZkCoreCrypto.decryptOwnerShareMeta(
                metaKey = subkeys.metaKey,
                shareId = UUID.randomUUID().toString(),
                encryptedOwnerMeta = encrypted,
                cryptoProvider = JvmCryptoProvider
            )
            fail("Expected ZkCryptoException for mismatched shareId AAD")
        } catch (expected: ZkCryptoException) {
            assertEquals(ZkErrorCode.AUTH_TAG_MISMATCH, expected.code)
        } finally {
            vk.zeroize()
            subkeys.zeroizeAll()
        }
    }

    @Test
    fun `encryptBiometricSessionEnvelope and decryptBiometricSessionEnvelope bind to VK and userId`() {
        val vk = JvmCryptoProvider.randomBytes(32)
        val otherVk = JvmCryptoProvider.randomBytes(32)
        val userId = UUID.randomUUID().toString()
        val payload = JSONObject()
            .put("v", 1)
            .put("userId", userId)
            .put("username", "valerio")
            .put("authSecretB64u", ZkCoreCrypto.toBase64Url(JvmCryptoProvider.randomBytes(32)))
            .put("hasPassphrase", false)
            .toString()

        val encrypted = ZkCoreCrypto.encryptBiometricSessionEnvelope(
            vaultKey = vk,
            userId = userId,
            plaintextJson = payload,
            cryptoProvider = JvmCryptoProvider
        )
        assertFalse(String(encrypted, Charsets.ISO_8859_1).contains("valerio"))

        val decrypted = ZkCoreCrypto.decryptBiometricSessionEnvelope(
            vaultKey = vk,
            userId = userId,
            encryptedEnvelope = encrypted,
            cryptoProvider = JvmCryptoProvider
        )
        assertEquals("valerio", JSONObject(decrypted).getString("username"))

        // Wrong VK must fail
        try {
            ZkCoreCrypto.decryptBiometricSessionEnvelope(
                vaultKey = otherVk,
                userId = userId,
                encryptedEnvelope = encrypted,
                cryptoProvider = JvmCryptoProvider
            )
            fail("Expected failure with wrong VK")
        } catch (expected: ZkCryptoException) {
            assertEquals(ZkErrorCode.AUTH_TAG_MISMATCH, expected.code)
        }

        // Wrong userId AAD must fail
        try {
            ZkCoreCrypto.decryptBiometricSessionEnvelope(
                vaultKey = vk,
                userId = UUID.randomUUID().toString(),
                encryptedEnvelope = encrypted,
                cryptoProvider = JvmCryptoProvider
            )
            fail("Expected failure with wrong userId AAD")
        } catch (expected: ZkCryptoException) {
            assertEquals(ZkErrorCode.AUTH_TAG_MISMATCH, expected.code)
        } finally {
            vk.zeroize()
            otherVk.zeroize()
        }
    }

    @Test
    fun `V1-simple registration without passphrase, instant keyfile login, and cold biometric unlock renews HTTP session cookie`() = runTest {
        var registeredUserId: String? = null
        var registeredUsername: String? = null
        var registeredSalt: String? = null
        var registeredAuthSecret: String? = null
        var registeredWrappedVk: String? = null
        var registeredKdfJson: JSONObject? = null
        var loginCallsCount = 0

        val server = MockWebServer()
        server.dispatcher = object : Dispatcher() {
            override fun dispatch(request: RecordedRequest): MockResponse {
                val path = request.path ?: ""
                return when {
                    path == "/api/v2/auth/config" -> {
                        MockResponse()
                            .setResponseCode(200)
                            .setBody("""{"registrationOpen":true,"policy":"open","requiresInviteToken":false,"firstUserSetupAvailable":true}""")
                    }
                    path == "/api/v2/register" -> {
                        val body = JSONObject(request.body.readUtf8())
                        registeredUserId = body.optString("userId", UUID.randomUUID().toString())
                        registeredUsername = body.getString("username")
                        registeredSalt = body.getString("salt")
                        registeredAuthSecret = body.getString("authSecret")
                        registeredWrappedVk = body.getString("wrappedVaultKey")
                        registeredKdfJson = body.getJSONObject("kdfParams")
                        val resp = JSONObject()
                            .put("userId", registeredUserId)
                            .put("username", registeredUsername)
                            .put("salt", registeredSalt)
                            .put("kdfParams", registeredKdfJson)
                            .put("wrappedVaultKey", registeredWrappedVk)
                            .put("csrfToken", "csrf-reg-1")
                        MockResponse()
                            .setResponseCode(201)
                            .addHeader("Set-Cookie", "photocloud_v2_sid=sid_reg_1; Path=/; HttpOnly")
                            .setBody(resp.toString())
                    }
                    path == "/api/v2/login/params" -> {
                        val resp = JSONObject()
                            .put("salt", registeredSalt)
                            .put("kdfParams", registeredKdfJson)
                        MockResponse().setResponseCode(200).setBody(resp.toString())
                    }
                    path == "/api/v2/login" -> {
                        loginCallsCount += 1
                        val body = JSONObject(request.body.readUtf8())
                        if (body.getString("authSecret") != registeredAuthSecret) {
                            MockResponse().setResponseCode(401).setBody("""{"error":"INVALID"}""")
                        } else {
                            val resp = JSONObject()
                                .put("userId", registeredUserId)
                                .put("username", registeredUsername)
                                .put("salt", registeredSalt)
                                .put("kdfParams", registeredKdfJson)
                                .put("wrappedVaultKey", registeredWrappedVk)
                                .put("csrfToken", "csrf-login-$loginCallsCount")
                            MockResponse()
                                .setResponseCode(200)
                                .addHeader("Set-Cookie", "photocloud_v2_sid=sid_login_$loginCallsCount; Path=/; HttpOnly")
                                .setBody(resp.toString())
                        }
                    }
                    path == "/api/v2/logout" -> {
                        MockResponse().setResponseCode(200).setBody("""{"ok":true}""")
                    }
                    else -> MockResponse().setResponseCode(404)
                }
            }
        }
        server.start()

        try {
            val baseUrl = server.url("/").toString().removeSuffix("/")
            val apiClient = PhotoCloudZkApiClientV2(
                initialBaseUrl = baseUrl,
                allowLocalhostHttpForTests = true
            )
            val keyStore = InMemoryFakeVaultKeyStore(strongBoxAvailable = true, deviceUnlocked = true)
            val metadataStore = InMemoryZkAccountMetadataStore()
            val sessionManager = ZkSessionManager(
                apiClient = apiClient,
                vaultKeyStore = keyStore,
                metadataStore = metadataStore
            )

            // 1. Verify /api/v2/auth/config
            val config = apiClient.fetchAuthConfig()
            assertTrue(config.registrationOpen)
            assertEquals("open", config.policy)
            assertFalse(config.requiresInviteToken)

            // 2. Direct registration with null passphrase (V1-simple mode)
            val keyFile = sessionManager.registerAccount(
                username = "android_valerio",
                passphrase = null,
                setupOrInviteToken = null
            )
            assertEquals("android_valerio", keyFile.username)
            assertFalse(keyFile.hasPassphrase)
            assertTrue(sessionManager.isUnlocked())
            assertFalse(sessionManager.isPassphraseProtected())
            assertNotNull(sessionManager.getCurrentRecoveryCodeOrNull())

            // 3. Enroll biometrics -> saves VK-encrypted bio session envelope (never plaintext authSecret)
            val bioEncSession = sessionManager.prepareBiometricEnrollmentSession()
            sessionManager.completeBiometricEnrollment(bioEncSession)
            val rawBioEnv = metadataStore.getEncryptedBioSession()
            assertNotNull(rawBioEnv)
            assertFalse(rawBioEnv!!.contains(registeredAuthSecret!!))

            // 4. Simulate cold app restart: lock in-memory vault AND clear in-memory HTTP cookie jar
            sessionManager.lock("cold_restart_test")
            apiClient.cookieJar.clear()
            assertFalse(sessionManager.isUnlocked())
            assertFalse(apiClient.hasActiveSessionCookie())

            // 5. Biometric unlock + ensureHttpSessionAfterBiometricUnlock() transparently renews HTTP cookie!
            val bioDecSession = sessionManager.prepareBiometricUnlockSession()
            sessionManager.completeBiometricUnlock(bioDecSession)
            assertTrue(sessionManager.isUnlocked())
            assertFalse(apiClient.hasActiveSessionCookie())

            val renewed = sessionManager.ensureHttpSessionAfterBiometricUnlock()
            assertTrue("Expected biometric cold unlock to transparently renew HTTP session", renewed)
            assertTrue(apiClient.hasActiveSessionCookie())
            assertEquals(1, loginCallsCount)

            // 6. Full logout + 1-click keyfile login without passphrase
            sessionManager.logout()
            assertFalse(sessionManager.isUnlocked())

            val keyFileJson = ZkAccountCredentialsCodec.serializeKeyFileJson(keyFile)
            sessionManager.loginWithKeyFileJson(keyFileJson, "")
            assertTrue(sessionManager.isUnlocked())
            assertEquals("android_valerio", sessionManager.getUsername())
            assertEquals(2, loginCallsCount)
        } finally {
            server.shutdown()
        }
    }

    @Test
    fun userSelectedHttpAndHttpsTransportModeTogglesValidationAndUrlScheme() {
        assertEquals(
            "http://192.168.1.50:3000",
            PhotoCloudZkApiClientV2.applyProtocolModeToUrl("https://192.168.1.50:3000/", useHttps = false)
        )
        assertEquals(
            "https://vault.example.com",
            PhotoCloudZkApiClientV2.applyProtocolModeToUrl("http://vault.example.com", useHttps = true)
        )
        assertEquals(
            "http://192.168.1.50:3000",
            PhotoCloudZkApiClientV2.applyProtocolModeToUrl("192.168.1.50:3000", useHttps = false)
        )

        val apiClient = PhotoCloudZkApiClientV2(
            initialBaseUrl = "http://192.168.1.50:3000",
            allowLocalhostHttpForTests = false
        )

        // Default is strict HTTPS-only: LAN HTTP must throw InsecureTransportException
        var threwDefault = false
        try {
            apiClient.validateBaseUrl()
        } catch (_: InsecureTransportException) {
            threwDefault = true
        }
        assertTrue("Default client must reject non-HTTPS URL", threwDefault)
        assertFalse(apiClient.cookieJar.allowUserSelectedHttp)

        // Enabling HTTP mode via top-left toggle permits LAN HTTP and syncs cookieJar
        apiClient.setTransportProtocolMode(useHttps = false)
        assertTrue(apiClient.allowUserSelectedHttp)
        assertTrue(apiClient.cookieJar.allowUserSelectedHttp)
        val validatedHttp = apiClient.validateBaseUrl()
        assertEquals("http", validatedHttp.scheme)
        assertEquals("192.168.1.50", validatedHttp.host)

        // Switching back to HTTPS mode immediately re-enforces HTTPS-only
        apiClient.setTransportProtocolMode(useHttps = true)
        assertFalse(apiClient.allowUserSelectedHttp)
        assertFalse(apiClient.cookieJar.allowUserSelectedHttp)
        var threwAfterHttps = false
        try {
            apiClient.validateBaseUrl()
        } catch (_: InsecureTransportException) {
            threwAfterHttps = true
        }
        assertTrue("Switching back to HTTPS must reject plain HTTP URL", threwAfterHttps)
    }
}
