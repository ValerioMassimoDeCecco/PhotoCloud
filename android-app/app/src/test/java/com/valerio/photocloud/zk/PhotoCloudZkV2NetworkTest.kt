package com.valerio.photocloud.zk

import kotlinx.coroutines.test.runTest
import okhttp3.Cookie
import okhttp3.HttpUrl.Companion.toHttpUrl
import okhttp3.Interceptor
import okhttp3.Response
import okhttp3.mockwebserver.Dispatcher
import okhttp3.mockwebserver.MockResponse
import okhttp3.mockwebserver.MockWebServer
import okhttp3.mockwebserver.RecordedRequest
import okhttp3.tls.HandshakeCertificates
import okhttp3.tls.HeldCertificate
import org.json.JSONObject
import org.junit.Assert.assertArrayEquals
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Assert.fail
import org.junit.Test
import java.security.cert.X509Certificate
import java.util.UUID
import javax.net.ssl.SSLPeerUnverifiedException

/** Test-only policy mutation: accepts weak KDF parameters without enforcing floor. */
private object MutatedAcceptWeakKdfPolicyForTest : KdfFloorPolicy {
    override fun enforce(kdfParams: V2KdfParamsDto, saltBytes: ByteArray) {
        // Intentional no-op mutation strictly isolated to src/test
    }
}

/** Test-only OkHttp interceptor mutation: leaks VK in an HTTP header. */
private class MutatedLeakVkHeaderInterceptorForTest(
    private val headerName: String,
    private val headerValue: String
) : Interceptor {
    override fun intercept(chain: Interceptor.Chain): Response {
        val mutatedReq = chain.request().newBuilder()
            .header(headerName, headerValue)
            .build()
        return chain.proceed(mutatedReq)
    }
}

class PhotoCloudZkV2NetworkTest {

    @Test
    fun `endpoint guard rejects non-v2 paths and HTTPS guard rejects non-loopback HTTP`() {
        val lanClient = PhotoCloudZkApiClientV2(
            initialBaseUrl = "http://192.168.1.50:3000",
            allowLocalhostHttpForTests = true
        )
        try {
            lanClient.validateBaseUrl()
            fail("Expected InsecureTransportException for non-loopback HTTP URL")
        } catch (expected: InsecureTransportException) {
            assertTrue(expected.message!!.contains("HTTPS", ignoreCase = true))
        }

        val strictLoopbackClient = PhotoCloudZkApiClientV2(
            initialBaseUrl = "http://127.0.0.1:3000",
            allowLocalhostHttpForTests = false
        )
        try {
            strictLoopbackClient.validateBaseUrl()
            fail("Expected InsecureTransportException when allowLocalhostHttpForTests=false")
        } catch (expected: InsecureTransportException) {
            assertTrue(expected.message!!.contains("HTTPS", ignoreCase = true))
        }

        val httpsClient = PhotoCloudZkApiClientV2(
            initialBaseUrl = "https://vault.example.com",
            allowLocalhostHttpForTests = false
        )
        assertEquals("https://vault.example.com/api/v2/login", httpsClient.buildV2EndpointUrl("/api/v2/login").toString())

        for (forbidden in listOf("/api/login", "/api/files", "/v1/items", "/login")) {
            try {
                httpsClient.buildV2EndpointUrl(forbidden)
                fail("Expected V2EndpointViolationException for $forbidden")
            } catch (_: V2EndpointViolationException) {
                // expected
            }
        }
    }

    @Test
    fun `cookie jar isolates photocloud_v2_sid strictly to api v2 paths and HTTPS or test loopback`() {
        val jar = ZkV2CookieJar(allowLocalhostHttpForTests = true)
        val v2LoginUrl = "http://127.0.0.1:3000/api/v2/login".toHttpUrl()
        val v1LoginUrl = "http://127.0.0.1:3000/api/login".toHttpUrl()
        val v2ItemsUrl = "http://127.0.0.1:3000/api/v2/items".toHttpUrl()
        val v1FilesUrl = "http://127.0.0.1:3000/api/files".toHttpUrl()
        val lanV2Url = "http://192.168.1.50:3000/api/v2/items".toHttpUrl()

        val v2Cookie = Cookie.Builder()
            .name("photocloud_v2_sid")
            .value("secret-session-token-v2")
            .domain("127.0.0.1")
            .path("/")
            .httpOnly()
            .secure()
            .build()

        // Cookies received from non-/api/v2 path must be ignored
        jar.saveFromResponse(v1LoginUrl, listOf(v2Cookie))
        assertTrue(jar.loadForRequest(v2ItemsUrl).isEmpty())

        // Cookies received from /api/v2/login are stored and sent ONLY to /api/v2/*
        jar.saveFromResponse(v2LoginUrl, listOf(v2Cookie))
        assertEquals(1, jar.loadForRequest(v2ItemsUrl).size)
        assertTrue("Cookie must NOT be sent to legacy /api/files", jar.loadForRequest(v1FilesUrl).isEmpty())
        assertTrue("Cookie must NOT be sent over non-loopback HTTP", jar.loadForRequest(lanV2Url).isEmpty())

        jar.clear()
        assertTrue(jar.loadForRequest(v2ItemsUrl).isEmpty())
    }

    @Test
    fun `self-signed HTTPS enforces explicit TOFU SPKI confirmation, checks hostname strictly, and aborts on key change`() = runTest {
        val heldCert1 = HeldCertificate.Builder()
            .commonName("localhost")
            .addSubjectAlternativeName("localhost")
            .addSubjectAlternativeName("127.0.0.1")
            .build()
        val certs1 = HandshakeCertificates.Builder()
            .heldCertificate(heldCert1)
            .build()

        val server = MockWebServer()
        server.useHttps(certs1.sslSocketFactory(), false)
        server.enqueue(
            MockResponse()
                .setResponseCode(200)
                .setBody(
                    """{"salt":"AAAAAAAAAAAAAAAAAAAAAA","kdfParams":{"algorithm":"Argon2id","memoryKiB":65536,"iterations":3,"parallelism":1}}"""
                )
        )
        server.start()

        try {
            val baseUrl = server.url("/").toString().removeSuffix("/")
            val pinStore = InMemoryTofuSpkiPinStore()
            val client = PhotoCloudZkApiClientV2(
                initialBaseUrl = baseUrl,
                pinStore = pinStore,
                allowLocalhostHttpForTests = false
            )

            // 1. First connection must fail BEFORE sending HTTP request and demand TOFU confirmation
            val challenge = try {
                client.fetchLoginParams("alice")
                fail("Expected TofuConfirmationRequiredException on unpinned self-signed certificate")
                null
            } catch (e: TofuConfirmationRequiredException) {
                e.challenge
            }!!
            assertEquals(0, server.requestCount)
            assertEquals(TofuSpkiPinning.computeSpkiPin(heldCert1.certificate as X509Certificate), challenge.spkiPin)

            // 2. Confirm TOFU pin -> request succeeds over HTTPS
            client.confirmTofuServer(challenge)
            val resp = client.fetchLoginParams("alice")
            assertEquals(65536, resp.kdfParams.memoryKiB)
            assertEquals(1, server.requestCount)

            // 3. Key rotation / MITM on same host:port with different SPKI must abort immediately
            val heldCert2 = HeldCertificate.Builder()
                .commonName("localhost")
                .addSubjectAlternativeName("localhost")
                .addSubjectAlternativeName("127.0.0.1")
                .build()
            val certs2 = HandshakeCertificates.Builder().heldCertificate(heldCert2).build()
            val rotatedServer = MockWebServer()
            rotatedServer.useHttps(certs2.sslSocketFactory(), false)
            rotatedServer.start()
            try {
                // Simulate a previously pinned certificate for this endpoint: save cert1's SPKI
                // under rotatedServer's host:port, then connect to the server presenting cert2.
                val rotatedHostPort = "${rotatedServer.url("/").host}:${rotatedServer.port}"
                pinStore.savePin(
                    TofuPinRecord(
                        hostPort = rotatedHostPort,
                        spkiPin = challenge.spkiPin,
                        certSha256Hex = challenge.certSha256Hex,
                        subject = challenge.subject,
                        issuer = challenge.issuer,
                        trustedAtMs = System.currentTimeMillis()
                    )
                )
                val baseUrl2 = rotatedServer.url("/").toString().removeSuffix("/")
                client.baseUrl = baseUrl2
                try {
                    client.fetchLoginParams("alice")
                    fail("Expected TofuPinMismatchException when server SPKI fingerprint changes")
                } catch (expected: TofuPinMismatchException) {
                    assertEquals(challenge.spkiPin, expected.mismatch.expectedSpkiPin)
                    assertEquals(0, rotatedServer.requestCount)
                }
            } finally {
                rotatedServer.shutdown()
            }

            // 4. HostnameVerifier MUST remain strictly enabled even for TOFU-pinned wrong-hostname cert
            val wrongHostCert = HeldCertificate.Builder()
                .commonName("evil.internal")
                .addSubjectAlternativeName("evil.internal")
                .build()
            val wrongHostServer = MockWebServer()
            wrongHostServer.useHttps(
                HandshakeCertificates.Builder().heldCertificate(wrongHostCert).build().sslSocketFactory(),
                false
            )
            wrongHostServer.start()
            try {
                val url3 = wrongHostServer.url("/").toString().removeSuffix("/")
                val wrongPinStore = InMemoryTofuSpkiPinStore()
                val wrongClient = PhotoCloudZkApiClientV2(url3, pinStore = wrongPinStore)
                wrongPinStore.savePin(
                    TofuPinRecord(
                        hostPort = "${java.net.URI(url3).host}:${wrongHostServer.port}",
                        spkiPin = TofuSpkiPinning.computeSpkiPin(wrongHostCert.certificate as X509Certificate),
                        certSha256Hex = "00".repeat(32),
                        subject = "CN=evil.internal",
                        issuer = "CN=evil.internal",
                        trustedAtMs = 1L
                    )
                )
                try {
                    wrongClient.fetchLoginParams("alice")
                    fail("Expected SSLPeerUnverifiedException because HostnameVerifier must not be disabled")
                } catch (_: SSLPeerUnverifiedException) {
                    assertEquals(0, wrongHostServer.requestCount)
                }
            } finally {
                wrongHostServer.shutdown()
            }
        } finally {
            try {
                server.shutdown()
            } catch (_: Throwable) {
            }
        }
    }

    @Test
    fun `KDF floor rejects weak memory, iterations, short salt, and non-Argon2id BEFORE Argon2id execution`() = runTest {
        val weakPayloads = listOf(
            """{"salt":"AAAAAAAAAAAAAAAAAAAAAA","kdfParams":{"algorithm":"Argon2id","memoryKiB":32768,"iterations":3,"parallelism":1}}""",
            """{"salt":"AAAAAAAAAAAAAAAAAAAAAA","kdfParams":{"algorithm":"Argon2id","memoryKiB":65536,"iterations":2,"parallelism":1}}""",
            """{"salt":"AAAAAAAAAA","kdfParams":{"algorithm":"Argon2id","memoryKiB":65536,"iterations":3,"parallelism":1}}""",
            """{"salt":"AAAAAAAAAAAAAAAAAAAAAA","kdfParams":{"algorithm":"pbkdf2","memoryKiB":65536,"iterations":3,"parallelism":1}}"""
        )

        var argon2Calls = 0
        val sentinelProvider = ZkArgon2id.Argon2idProvider { _, _, _, _, _, _ ->
            argon2Calls++
            throw AssertionError("Argon2id MUST NOT execute when server parameters violate KDF floor.")
        }

        val server = MockWebServer()
        weakPayloads.forEach { json ->
            server.enqueue(MockResponse().setResponseCode(200).setBody(json))
        }
        server.start()
        try {
            val api = PhotoCloudZkApiClientV2(
                initialBaseUrl = server.url("/").toString().removeSuffix("/"),
                allowLocalhostHttpForTests = true
            )
            val session = ZkSessionManager(
                apiClient = api,
                vaultKeyStore = InMemoryFakeVaultKeyStore(),
                argon2Provider = sentinelProvider
            )
            val recCode = ZkAccountCredentialsCodec.formatRecoveryCode(ByteArray(32) { 0x11 })

            for (i in weakPayloads.indices) {
                try {
                    session.loginWithRecoveryCode("alice", recCode, "CorrectHorseBattery!123")
                    fail("Expected ZkCryptoException(INVALID_PARAMETER) for weak payload #$i")
                } catch (e: ZkCryptoException) {
                    assertEquals(ZkErrorCode.INVALID_PARAMETER, e.code)
                }
            }
            assertEquals(0, argon2Calls)
        } finally {
            server.shutdown()
        }
    }

    @Test
    fun `uniform auth errors mask malformed credentials, HTTP 401, and wrappedVk tag mismatch`() = runTest {
        val server = MockWebServer()
        val salt = ZkCoreCrypto.toBase64Url(ByteArray(16) { 0x22 })
        // 1. Server 401 on /login
        server.enqueue(
            MockResponse().setResponseCode(200).setBody(
                """{"salt":"$salt","kdfParams":{"algorithm":"Argon2id","memoryKiB":65536,"iterations":3,"parallelism":1}}"""
            )
        )
        server.enqueue(MockResponse().setResponseCode(401).setBody("""{"error":"INVALID_CREDENTIALS"}"""))
        // 2. Server returns tampered wrappedVaultKey on /login
        server.enqueue(
            MockResponse().setResponseCode(200).setBody(
                """{"salt":"$salt","kdfParams":{"algorithm":"Argon2id","memoryKiB":65536,"iterations":3,"parallelism":1}}"""
            )
        )
        val tamperedWrapped = ZkCoreCrypto.toBase64Url(ByteArray(60) { 0x5A })
        server.enqueue(
            MockResponse().setResponseCode(200).setBody(
                """{"userId":"550e8400-e29b-41d4-a716-446655440000","username":"alice","salt":"$salt","kdfParams":{"algorithm":"Argon2id","memoryKiB":65536,"iterations":3,"parallelism":1},"wrappedVaultKey":"$tamperedWrapped","csrfToken":"tok"}"""
            )
        )
        server.start()

        try {
            val api = PhotoCloudZkApiClientV2(
                initialBaseUrl = server.url("/").toString().removeSuffix("/"),
                allowLocalhostHttpForTests = true
            )
            // Use fast mock derivation for this negative oracle test (real Argon2id verified in full flow test)
            val fastTestProvider = ZkArgon2id.Argon2idProvider { _, _, _, _, _, _ -> ByteArray(32) { 0x33 } }
            val session = ZkSessionManager(
                apiClient = api,
                vaultKeyStore = InMemoryFakeVaultKeyStore(),
                argon2Provider = fastTestProvider
            )

            // Malformed KeyFile JSON -> uniform message
            try {
                session.loginWithKeyFileJson("{not-json", "ValidPassphrase!234")
                fail("Expected uniform auth exception")
            } catch (e: ZkUniformAuthException) {
                assertEquals(UNIFORM_AUTH_ERROR_MESSAGE, e.message)
            }

            // Malformed recovery code -> uniform message
            try {
                session.loginWithRecoveryCode("alice", "NOT-HEX", "ValidPassphrase!234")
                fail("Expected uniform auth exception")
            } catch (e: ZkUniformAuthException) {
                assertEquals(UNIFORM_AUTH_ERROR_MESSAGE, e.message)
            }

            // HTTP 401 -> uniform message
            val validRec = ZkAccountCredentialsCodec.formatRecoveryCode(ByteArray(32) { 0x44 })
            try {
                session.loginWithRecoveryCode("alice", validRec, "ValidPassphrase!234")
                fail("Expected uniform auth exception on HTTP 401")
            } catch (e: ZkUniformAuthException) {
                assertEquals(UNIFORM_AUTH_ERROR_MESSAGE, e.message)
            }

            // Tampered wrappedVaultKey tag mismatch -> uniform message
            try {
                session.loginWithRecoveryCode("alice", validRec, "ValidPassphrase!234")
                fail("Expected uniform auth exception on GCM tag mismatch")
            } catch (e: ZkUniformAuthException) {
                assertEquals(UNIFORM_AUTH_ERROR_MESSAGE, e.message)
            }
        } finally {
            server.shutdown()
        }
    }

    @Test
    fun `full login, KDF pinning warning, rewrap, auto-lock wipe, biometric unlock, and Network Spy with real BouncyCastle 64MiB`() = runTest {
        System.gc()

        val userId = UUID.randomUUID().toString().lowercase()
        val username = "alice_android_4b"
        val passphrase1 = "SuperSecure-Passphrase#2026"
        val passphrase2 = "Rotated-Passphrase#2026-Strong"
        val accountKey = ByteArray(32) { (it + 0x10).toByte() }
        val vaultKey = ByteArray(32) { (it + 0x70).toByte() }
        var serverSalt = ByteArray(16) { (it + 0x30).toByte() }
        var serverKdf = V2KdfParamsDto("Argon2id", 65536, 3, 1)

        // Precompute initial server state using real production BouncyCastle 64 MiB
        val initRoot = ZkCoreCrypto.deriveRoot(accountKey, serverSalt, passphrase1, serverKdf.toArgon2Params())
        val initKeys = ZkCoreCrypto.deriveKekAndAuthSecret(initRoot)
        var serverAuthSecretB64u = ZkCoreCrypto.toBase64Url(initKeys.authSecret)
        var serverWrappedVkB64u = ZkCoreCrypto.toBase64Url(ZkCoreCrypto.wrapVaultKey(initKeys.kek, vaultKey, userId))
        val initialKekSnapshot = initKeys.kek.copyOf()
        initRoot.zeroize()
        initKeys.zeroizeAll()
        System.gc()

        val server = MockWebServer()
        var currentSid = "sid-initial-123456"
        server.dispatcher = object : Dispatcher() {
            override fun dispatch(request: RecordedRequest): MockResponse {
                val bodyStr = request.body.readUtf8()
                return when (request.path) {
                    "/api/v2/login/params" -> MockResponse().setResponseCode(200).setBody(
                        JSONObject()
                            .put("salt", ZkCoreCrypto.toBase64Url(serverSalt))
                            .put("kdfParams", serverKdf.toJson())
                            .toString()
                    )
                    "/api/v2/login" -> {
                        val req = JSONObject(bodyStr)
                        if (req.getString("username") == username && req.getString("authSecret") == serverAuthSecretB64u) {
                            MockResponse()
                                .setResponseCode(200)
                                .addHeader("Set-Cookie", "photocloud_v2_sid=$currentSid; Path=/; HttpOnly; Secure; SameSite=Strict")
                                .setBody(
                                    JSONObject()
                                        .put("userId", userId)
                                        .put("username", username)
                                        .put("salt", ZkCoreCrypto.toBase64Url(serverSalt))
                                        .put("kdfParams", serverKdf.toJson())
                                        .put("wrappedVaultKey", serverWrappedVkB64u)
                                        .put("csrfToken", "csrf-123")
                                        .toString()
                                )
                        } else {
                            MockResponse().setResponseCode(401).setBody("""{"error":"INVALID_CREDENTIALS"}""")
                        }
                    }
                    "/api/v2/account/rewrap" -> {
                        val cookie = request.getHeader("Cookie").orEmpty()
                        if (!cookie.contains("photocloud_v2_sid=$currentSid")) {
                            return MockResponse().setResponseCode(401).setBody("""{"error":"UNAUTHENTICATED"}""")
                        }
                        val req = JSONObject(bodyStr)
                        if (req.getString("oldAuthSecret") != serverAuthSecretB64u) {
                            return MockResponse().setResponseCode(401).setBody("""{"error":"INVALID_OLD_AUTH_SECRET"}""")
                        }
                        serverSalt = ZkCoreCrypto.fromBase64Url(req.getString("newSalt"))
                        serverKdf = V2KdfParamsDto.fromJson(req.getJSONObject("newKdfParams"))
                        serverAuthSecretB64u = req.getString("newAuthSecret")
                        serverWrappedVkB64u = req.getString("newWrappedVaultKey")
                        MockResponse().setResponseCode(200).setBody(
                            JSONObject()
                                .put("ok", true)
                                .put("salt", ZkCoreCrypto.toBase64Url(serverSalt))
                                .put("kdfParams", serverKdf.toJson())
                                .put("wrappedVaultKey", serverWrappedVkB64u)
                                .toString()
                        )
                    }
                    "/api/v2/logout" -> MockResponse().setResponseCode(200).setBody("""{"ok":true}""")
                    else -> MockResponse().setResponseCode(404).setBody("""{"error":"NOT_FOUND"}""")
                }
            }
        }
        server.start()

        try {
            val spy = ZkNetworkSpyInterceptor()
            val fakeKeyStore = InMemoryFakeVaultKeyStore()
            val kdfPinStore = InMemoryKdfPinningStore()
            val warnings = mutableListOf<KdfChangeWarning>()
            var fakeNow = 1_000_000L

            val api = PhotoCloudZkApiClientV2(
                initialBaseUrl = server.url("/").toString().removeSuffix("/"),
                allowLocalhostHttpForTests = true,
                extraInterceptors = listOf(spy)
            )
            val session = ZkSessionManager(
                apiClient = api,
                vaultKeyStore = fakeKeyStore,
                kdfPinningStore = kdfPinStore,
                clockMs = { fakeNow },
                onKdfParamsChangedWarning = { warnings.add(it) }
            )

            val keyFileJson = ZkAccountCredentialsCodec.serializeKeyFileJson(
                ZkKeyFileV2(
                    formatVersion = 2,
                    username = username,
                    userId = userId,
                    accountKeyB64u = ZkCoreCrypto.toBase64Url(accountKey),
                    saltB64u = ZkCoreCrypto.toBase64Url(serverSalt),
                    kdfParams = serverKdf,
                    hasPassphrase = true,
                    createdAt = "2026-11-18T00:00:00Z"
                )
            )

            // 1. Login via Key File JSON
            val warn1 = session.loginWithKeyFileJson(keyFileJson, passphrase1)
            assertNull(warn1)
            assertTrue(session.isUnlocked())
            assertTrue(api.hasActiveSessionCookie())

            val subkeysRef = session.getSubkeysOrNull()!!
            val expectedSubkeys = ZkCoreCrypto.deriveSubkeys(vaultKey)
            assertArrayEquals(expectedSubkeys.metaKey, subkeysRef.metaKey)
            assertArrayEquals(expectedSubkeys.fkWrapKey, subkeysRef.fkWrapKey)

            // Enroll biometrics with fake VaultKeyStore while unlocked
            val encBio = session.prepareBiometricEnrollmentSession()
            session.completeBiometricEnrollment(encBio)
            assertTrue(fakeKeyStore.hasBiometricWrappedVk())

            // 2. Test auto-lock inactivity & zeroization in-place
            session.setAutoLockConfig(timeoutMs = 5 * 60 * 1000L, lockOnBackground = false)
            fakeNow += 5 * 60 * 1000L + 1L
            assertTrue(session.checkInactivityTimeout())
            assertFalse(session.isUnlocked())
            assertNull(session.getSubkeysOrNull())
            assertTrue("metaKey must be zeroized in RAM", subkeysRef.metaKey.all { it == 0.toByte() })
            assertTrue("fkWrapKey must be zeroized in RAM", subkeysRef.fkWrapKey.all { it == 0.toByte() })

            // 3. Biometric unlock recovers exact same subkeys without Argon2id
            val decBio = session.prepareBiometricUnlockSession()
            session.completeBiometricUnlock(decBio)
            assertTrue(session.isUnlocked())
            assertArrayEquals(expectedSubkeys.metaKey, session.getSubkeysOrNull()!!.metaKey)

            // 4. Test background lock when lockOnBackground = true
            val subkeysRef2 = session.getSubkeysOrNull()!!
            session.setAutoLockConfig(timeoutMs = 15 * 60 * 1000L, lockOnBackground = true)
            session.onAppBackgrounded()
            assertFalse(session.isUnlocked())
            assertTrue(subkeysRef2.dedupKey.all { it == 0.toByte() })

            // 5. Re-login via Recovery Code + Change Passphrase (/account/rewrap)
            System.gc()
            val recCode = ZkAccountCredentialsCodec.formatRecoveryCode(accountKey)
            session.loginWithRecoveryCode(username, recCode, passphrase1)
            assertTrue(session.isUnlocked())
            System.gc()
            session.changePassphrase(passphrase1, passphrase2)

            // 6. Simulate external KDF change warning (if pinned store had older salt before next login)
            session.logout()
            assertFalse(api.hasActiveSessionCookie())
            assertFalse(fakeKeyStore.hasBiometricWrappedVk())

            // Inject stale pin to trigger KdfChangeWarning on login with passphrase2
            kdfPinStore.set(PinnedKdfRecord(username, ZkCoreCrypto.toBase64Url(ByteArray(16) { 0x7F }), 65536, 3, 1, 1L))
            System.gc()
            val warn2 = session.loginWithRecoveryCode(username, recCode, passphrase2)
            assertNotNull("Expected KdfChangeWarning when pinned salt changed", warn2)
            assertEquals(1, warnings.size)

            // 7. Network Spy must confirm ZERO leaks of any secret across all HTTP exchanges
            spy.assertZeroSecretLeaks(
                listOf(
                    TrackedSecret("accountKey", bytes = accountKey),
                    TrackedSecret("passphrase1", rawString = passphrase1),
                    TrackedSecret("passphrase2", rawString = passphrase2),
                    TrackedSecret("initialKek", bytes = initialKekSnapshot),
                    TrackedSecret("vaultKey", bytes = vaultKey)
                )
            )
        } finally {
            server.shutdown()
        }
    }

    @Test
    fun `documented mutation proofs fail assertions when KDF floor bypassed or VK leaked in header`() = runTest {
        val forcedMutation = System.getProperty("zk.mutation")?.trim().orEmpty()

        // Mutation 1: Client accepts weak KDF (< 64 MiB) via test-only KdfFloorPolicy wrapper
        suspend fun runWeakKdfFloorCheck(kdfFloorPolicy: KdfFloorPolicy) {
            val server = MockWebServer()
            val weakSalt = ZkCoreCrypto.toBase64Url(ByteArray(16) { 0x11 })
            server.enqueue(
                MockResponse().setResponseCode(200).setBody(
                    """{"salt":"$weakSalt","kdfParams":{"algorithm":"Argon2id","memoryKiB":1024,"iterations":1,"parallelism":1}}"""
                )
            )
            server.enqueue(MockResponse().setResponseCode(401).setBody("""{"error":"INVALID_CREDENTIALS"}"""))
            server.start()
            try {
                val api = PhotoCloudZkApiClientV2(
                    initialBaseUrl = server.url("/").toString().removeSuffix("/"),
                    allowLocalhostHttpForTests = true
                )
                val session = ZkSessionManager(
                    apiClient = api,
                    vaultKeyStore = InMemoryFakeVaultKeyStore(),
                    argon2Provider = ZkArgon2id.Argon2idProvider { _, _, _, _, _, _ -> ByteArray(32) },
                    kdfFloorPolicy = kdfFloorPolicy
                )
                val rec = ZkAccountCredentialsCodec.formatRecoveryCode(ByteArray(32) { 0x55 })
                try {
                    session.loginWithRecoveryCode("alice", rec, "PassphraseCheck!123")
                    fail("KDF floor MUST reject memoryKiB=1024 with ZkCryptoException(INVALID_PARAMETER)")
                } catch (e: ZkCryptoException) {
                    assertEquals(ZkErrorCode.INVALID_PARAMETER, e.code)
                }
            } finally {
                server.shutdown()
            }
        }

        // Mutation 2: Secret VK sent in HTTP header via test-only OkHttp Interceptor -> caught by Network Spy
        suspend fun runNetworkSpyCheck(mutatedInterceptors: List<Interceptor>, vk: ByteArray) {
            val server = MockWebServer()
            val salt = ZkCoreCrypto.toBase64Url(ByteArray(16) { 0x11 })
            server.enqueue(
                MockResponse().setResponseCode(200).setBody(
                    """{"salt":"$salt","kdfParams":{"algorithm":"Argon2id","memoryKiB":65536,"iterations":3,"parallelism":1}}"""
                )
            )
            server.start()
            try {
                val spy = ZkNetworkSpyInterceptor()
                val api = PhotoCloudZkApiClientV2(
                    initialBaseUrl = server.url("/").toString().removeSuffix("/"),
                    allowLocalhostHttpForTests = true,
                    extraInterceptors = mutatedInterceptors + listOf(spy)
                )
                api.fetchLoginParams("alice")
                spy.assertZeroSecretLeaks(listOf(TrackedSecret("VK", bytes = vk)))
            } finally {
                server.shutdown()
            }
        }

        val sampleVk = ByteArray(32) { (it + 0x41).toByte() }
        when (forcedMutation) {
            "accept_weak_kdf" -> {
                // Intentionally uncaught so Gradle fails RED when mutation CLI flag is passed in CI
                runWeakKdfFloorCheck(MutatedAcceptWeakKdfPolicyForTest)
                return@runTest
            }
            "leak_vk_header" -> {
                // Intentionally uncaught so Gradle fails RED when mutation CLI flag is passed in CI
                runNetworkSpyCheck(
                    listOf(
                        MutatedLeakVkHeaderInterceptorForTest(
                            headerName = "X-Debug-Leaked-VK",
                            headerValue = ZkCoreCrypto.toBase64Url(sampleVk)
                        )
                    ),
                    sampleVk
                )
                return@runTest
            }
        }

        // Normal run: verify BOTH normal policy passes AND mutated policies cause failure
        runWeakKdfFloorCheck(StrictArgon2idKdfPolicy)
        var mut1Failed = false
        try {
            runWeakKdfFloorCheck(MutatedAcceptWeakKdfPolicyForTest)
        } catch (_: AssertionError) {
            mut1Failed = true
        } catch (_: ZkUniformAuthException) {
            // Weak KDF bypassed floor and hit /login 401 -> also proves floor check did NOT reject!
            mut1Failed = true
        }
        assertTrue("Documented mutation 1 (accept_weak_kdf) must fail KDF floor enforcement", mut1Failed)

        runNetworkSpyCheck(emptyList(), sampleVk)
        var mut2Failed = false
        try {
            runNetworkSpyCheck(
                listOf(
                    MutatedLeakVkHeaderInterceptorForTest(
                        headerName = "X-Debug-Leaked-VK",
                        headerValue = ZkCoreCrypto.toBase64Url(sampleVk)
                    )
                ),
                sampleVk
            )
        } catch (_: AssertionError) {
            mut2Failed = true
        }
        assertTrue("Documented mutation 2 (leak_vk_header) must fail Network Spy assertion", mut2Failed)
    }
}

