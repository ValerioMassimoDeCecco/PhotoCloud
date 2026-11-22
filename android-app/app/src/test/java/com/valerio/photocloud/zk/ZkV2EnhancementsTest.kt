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
            assertTrue(sessionManager.sessionState.value.isHttpSessionReady)
            val genAfterReg = sessionManager.sessionState.value.httpSessionGeneration
            assertTrue("Expected positive httpSessionGeneration after register", genAfterReg >= 1L)
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
            assertFalse(sessionManager.sessionState.value.isHttpSessionReady)
            assertFalse(apiClient.hasActiveSessionCookie())

            // 5. Biometric unlock + ensureHttpSessionAfterBiometricUnlock() transparently renews HTTP cookie!
            // Before HTTP cookie renewal, isHttpSessionReady MUST be false so gallery does not fire a premature 401.
            val bioDecSession = sessionManager.prepareBiometricUnlockSession()
            sessionManager.completeBiometricUnlock(bioDecSession)
            assertTrue(sessionManager.isUnlocked())
            assertFalse(apiClient.hasActiveSessionCookie())
            assertFalse(
                "Gallery must not treat cold biometric unlock as HTTP-ready before session cookie is renewed",
                sessionManager.sessionState.value.isHttpSessionReady
            )

            val renewed = sessionManager.ensureHttpSessionAfterBiometricUnlock()
            assertTrue("Expected biometric cold unlock to transparently renew HTTP session", renewed)
            assertTrue(apiClient.hasActiveSessionCookie())
            assertTrue(sessionManager.sessionState.value.isHttpSessionReady)
            val genAfterBio = sessionManager.sessionState.value.httpSessionGeneration
            assertTrue("Expected httpSessionGeneration to advance after biometric cookie renewal", genAfterBio > genAfterReg)
            assertEquals("android_valerio", sessionManager.sessionState.value.username)
            assertEquals(1, loginCallsCount)

            // 5b. Simulate mid-session server cookie expiry + automatic forced renewal from in-RAM authSecret
            apiClient.cookieJar.clear()
            val forcedRenewed = sessionManager.ensureHttpSessionAfterBiometricUnlock(forceRenew = true)
            assertTrue("Expected forced renewal to restore HTTP session cookie seamlessly", forcedRenewed)
            assertTrue(apiClient.hasActiveSessionCookie())
            assertTrue(sessionManager.sessionState.value.isHttpSessionReady)
            assertTrue(sessionManager.sessionState.value.httpSessionGeneration > genAfterBio)
            assertEquals(2, loginCallsCount)

            // 6. Full logout + 1-click keyfile login without passphrase
            sessionManager.logout()
            assertFalse(sessionManager.isUnlocked())
            assertFalse(sessionManager.sessionState.value.isHttpSessionReady)

            val keyFileJson = ZkAccountCredentialsCodec.serializeKeyFileJson(keyFile)
            sessionManager.loginWithKeyFileJson(keyFileJson, "")
            assertTrue(sessionManager.isUnlocked())
            assertTrue(sessionManager.sessionState.value.isHttpSessionReady)
            assertEquals("android_valerio", sessionManager.getUsername())
            assertEquals(3, loginCallsCount)
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

    @Test
    fun `transient file picker activity suppresses background lock and re-arms on return or expiry`() = runTest {
        var nowMs = 1_700_000_000_000L
        val server = MockWebServer()
        server.dispatcher = object : Dispatcher() {
            override fun dispatch(request: RecordedRequest): MockResponse {
                val path = request.path ?: ""
                return when (path) {
                    "/api/v2/register" -> {
                        val body = JSONObject(request.body.readUtf8())
                        val resp = JSONObject()
                            .put("userId", body.optString("userId", UUID.randomUUID().toString()))
                            .put("username", body.getString("username"))
                            .put("salt", body.getString("salt"))
                            .put("kdfParams", body.getJSONObject("kdfParams"))
                            .put("wrappedVaultKey", body.getString("wrappedVaultKey"))
                            .put("csrfToken", "csrf-picker-test")
                        MockResponse()
                            .setResponseCode(201)
                            .addHeader("Set-Cookie", "photocloud_v2_sid=picker-sid; HttpOnly; SameSite=Strict; Path=/api/v2")
                            .setBody(resp.toString())
                    }
                    else -> MockResponse().setResponseCode(404).setBody("""{"error":"not found"}""")
                }
            }
        }
        server.start()
        try {
            val apiClient = PhotoCloudZkApiClientV2(
                initialBaseUrl = server.url("/").toString().removeSuffix("/"),
                allowLocalhostHttpForTests = true
            )
            val session = ZkSessionManager(
                apiClient = apiClient,
                vaultKeyStore = InMemoryFakeVaultKeyStore(),
                clockMs = { nowMs }
            )
            session.registerAccount(username = "picker_user", passphrase = null)
            session.setAutoLockConfig(timeoutMs = 15 * 60 * 1000L, lockOnBackground = true)
            assertTrue(session.isUnlocked())

            // 1. Opening Android Document Picker triggers onStop -> onAppBackgrounded():
            // vault MUST remain unlocked so returning with files does not show login screen.
            session.beginTransientExternalActivity(maxDurationMs = 60_000L)
            assertTrue(session.isTransientExternalActivityActive())
            session.onAppBackgrounded()
            assertTrue("Vault must stay unlocked during active system file picker", session.isUnlocked())
            assertNotNull("Subkeys must remain available to enqueue picked files", session.getSubkeysOrNull())

            // 2. Returning from the picker (ActivityResult / onResume) re-arms background lock.
            session.endTransientExternalActivity()
            assertFalse(session.isTransientExternalActivityActive())
            session.onAppBackgrounded()
            assertFalse("Real app backgrounding must still lock the vault when lockOnBackground=true", session.isUnlocked())

            // 3. Re-register and verify safety expiry re-arms lock even if endTransientExternalActivity is never called.
            session.registerAccount(username = "picker_user_2", passphrase = null)
            session.setAutoLockConfig(timeoutMs = 15 * 60 * 1000L, lockOnBackground = true)
            session.beginTransientExternalActivity(maxDurationMs = 30_000L)
            nowMs += 31_000L
            assertFalse("Expired transient suppression must auto-clear", session.isTransientExternalActivityActive())
            session.onAppBackgrounded()
            assertFalse("Vault must lock on background once transient safety window expires", session.isUnlocked())
        } finally {
            server.shutdown()
        }
    }

    @Test
    fun `ZkZoomPanMath handles focal pinch zoom, bounded pan, and double-tap toggle cleanly`() {
        val initial = ZkZoomPanState()
        val zoomed = ZkZoomPanMath.toggleDoubleTap(
            current = initial,
            tapX = 700f,
            tapY = 300f,
            viewportWidth = 1000f,
            viewportHeight = 800f,
            mediaWidth = 2000f,
            mediaHeight = 1600f
        )
        assertEquals(ZkZoomPanMath.DOUBLE_TAP_SCALE, zoomed.scale, 0.001f)
        assertTrue("Double-tap right of center should shift image left", zoomed.offsetX < 0f)
        assertTrue("Double-tap above center should shift image down", zoomed.offsetY > 0f)

        val reset = ZkZoomPanMath.toggleDoubleTap(
            current = zoomed,
            tapX = 500f,
            tapY = 400f,
            viewportWidth = 1000f,
            viewportHeight = 800f,
            mediaWidth = 2000f,
            mediaHeight = 1600f
        )
        assertEquals(1f, reset.scale, 0.001f)
        assertEquals(0f, reset.offsetX, 0.001f)
        assertEquals(0f, reset.offsetY, 0.001f)

        val clamped = ZkZoomPanMath.applyPinchAndPan(
            current = ZkZoomPanState(scale = 2f, offsetX = 0f, offsetY = 0f),
            zoomChange = 4f,
            panChangeX = 9999f,
            panChangeY = -9999f,
            centroidX = 500f,
            centroidY = 400f,
            viewportWidth = 1000f,
            viewportHeight = 800f,
            mediaWidth = 2000f,
            mediaHeight = 1600f
        )
        assertEquals(ZkZoomPanMath.MAX_SCALE, clamped.scale, 0.001f)
        assertEquals(2000f, clamped.offsetX, 0.5f)
        assertEquals(-1600f, clamped.offsetY, 0.5f)
    }

    @Test
    fun `ZkCropBoxMath fits aspect ratios, hit-tests corners, and clamps drag bounds`() {
        val squareBox = ZkCropBoxMath.fitAspect(2000, 1000, ZkCropAspect.SQUARE)
        assertEquals(0.25f, squareBox.left, 0.01f)
        assertEquals(0.75f, squareBox.right, 0.01f)
        assertEquals(0f, squareBox.top, 0.01f)
        assertEquals(1f, squareBox.bottom, 0.01f)

        assertEquals(ZkCropHandle.NW, ZkCropBoxMath.hitTestHandle(0.26f, 0.02f, squareBox))
        assertEquals(ZkCropHandle.SE, ZkCropBoxMath.hitTestHandle(0.74f, 0.98f, squareBox))
        assertEquals(ZkCropHandle.MOVE, ZkCropBoxMath.hitTestHandle(0.5f, 0.5f, squareBox))

        val moved = ZkCropBoxMath.dragHandle(
            start = squareBox,
            handle = ZkCropHandle.MOVE,
            dxNorm = 0.5f,
            dyNorm = 0f,
            aspect = ZkCropAspect.SQUARE,
            srcWidth = 2000,
            srcHeight = 1000
        )
        assertEquals(0.5f, moved.left, 0.01f)
        assertEquals(1.0f, moved.right, 0.01f)

        val resized = ZkCropBoxMath.dragHandle(
            start = ZkNormalizedCropBox(0.1f, 0.1f, 0.9f, 0.9f),
            handle = ZkCropHandle.SE,
            dxNorm = -0.2f,
            dyNorm = -0.2f,
            aspect = ZkCropAspect.FREE,
            srcWidth = 1000,
            srcHeight = 1000
        )
        assertEquals(0.7f, resized.right, 0.01f)
        assertEquals(0.7f, resized.bottom, 0.01f)
    }
}
