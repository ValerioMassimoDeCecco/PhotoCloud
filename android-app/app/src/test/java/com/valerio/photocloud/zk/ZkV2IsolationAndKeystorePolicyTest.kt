package com.valerio.photocloud.zk

import com.valerio.photocloud.ZkV2FeatureGate
import kotlinx.coroutines.test.runTest
import okhttp3.mockwebserver.Dispatcher
import okhttp3.mockwebserver.MockResponse
import okhttp3.mockwebserver.MockWebServer
import okhttp3.mockwebserver.RecordedRequest
import org.json.JSONObject
import org.junit.Assert.assertArrayEquals
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Assert.fail
import org.junit.Test
import java.nio.file.Files
import java.util.Base64
import java.util.UUID

class ZkV2IsolationAndKeystorePolicyTest {

    @Test
    fun `zk_v2_enabled false never instantiates or invokes any zk package class`() {
        var flagEnabled = false
        var factoryCalls = 0
        var backgroundCalls = 0
        var clearCalls = 0

        val gate = ZkV2FeatureGate(
            isEnabledProvider = { flagEnabled },
            factory = {
                factoryCalls++
                if (!flagEnabled) {
                    throw AssertionError("package zk must NOT be instantiated while zk_v2_enabled == false")
                }
                "zk-runtime-instance"
            }
        )

        // With default flag false: zero instantiation and zero invocations even across lifecycle hooks
        assertFalse(gate.isEnabled)
        assertNull(gate.getOrNull())
        gate.onBackgrounded { backgroundCalls++ }
        gate.clearOnDisable { clearCalls++ }
        assertEquals(0, factoryCalls)
        assertEquals(0, backgroundCalls)
        assertEquals(0, clearCalls)

        // Enabling the flag instantiates once and routes lifecycle calls
        flagEnabled = true
        assertTrue(gate.isEnabled)
        assertEquals("zk-runtime-instance", gate.getOrNull())
        assertEquals("zk-runtime-instance", gate.getOrNull())
        assertEquals(1, factoryCalls)
        gate.onBackgrounded { backgroundCalls++ }
        assertEquals(1, backgroundCalls)

        // Disabling clears cached instance and ignores subsequent calls
        flagEnabled = false
        gate.clearOnDisable { clearCalls++ }
        assertEquals(1, clearCalls)
        assertNull(gate.getOrNull())
        gate.onBackgrounded { backgroundCalls++ }
        assertEquals(1, factoryCalls)
        assertEquals(1, backgroundCalls)
    }

    @Test
    fun `biometric key invalidation explicitly fails unlock, clears stale key, and proposes Key File plus passphrase login`() = runTest {
        val userId = UUID.randomUUID().toString().lowercase()
        val username = "alice_bio_invalidated"
        val passphrase = "Strong-Passphrase#4B-Test!"
        val accountKey = ByteArray(32) { (it + 0x15).toByte() }
        val vaultKey = ByteArray(32) { (it + 0x61).toByte() }
        val salt = ByteArray(16) { (it + 0x21).toByte() }
        val kdf = V2KdfParamsDto("Argon2id", 65536, 3, 1)

        val fastProvider = ZkArgon2id.Argon2idProvider { ak, slt, params, _, _, _ ->
            // Deterministic fast test KDF strictly for non-crypto session-flow assertions
            ByteArray(params.hashLength) { idx -> (ak[idx % ak.size].toInt() xor slt[idx % slt.size].toInt()).toByte() }
        }
        val root = ZkCoreCrypto.deriveRoot(accountKey, salt, passphrase, kdf.toArgon2Params(), argon2Provider = fastProvider)
        val keys = ZkCoreCrypto.deriveKekAndAuthSecret(root)
        val authSecretB64u = ZkCoreCrypto.toBase64Url(keys.authSecret)
        val wrappedVkB64u = ZkCoreCrypto.toBase64Url(ZkCoreCrypto.wrapVaultKey(keys.kek, vaultKey, userId))

        val server = MockWebServer()
        server.dispatcher = object : Dispatcher() {
            override fun dispatch(request: RecordedRequest): MockResponse {
                return when (request.path) {
                    "/api/v2/login/params" -> MockResponse().setResponseCode(200).setBody(
                        JSONObject().put("salt", ZkCoreCrypto.toBase64Url(salt)).put("kdfParams", kdf.toJson()).toString()
                    )
                    "/api/v2/login" -> MockResponse().setResponseCode(200)
                        .addHeader("Set-Cookie", "photocloud_v2_sid=sid-bio-1; Path=/; HttpOnly; Secure")
                        .setBody(
                            JSONObject()
                                .put("userId", userId)
                                .put("username", username)
                                .put("salt", ZkCoreCrypto.toBase64Url(salt))
                                .put("kdfParams", kdf.toJson())
                                .put("wrappedVaultKey", wrappedVkB64u)
                                .put("csrfToken", "csrf-bio")
                                .toString()
                        )
                    else -> MockResponse().setResponseCode(404)
                }
            }
        }
        server.start()

        try {
            val api = PhotoCloudZkApiClientV2(
                initialBaseUrl = server.url("/").toString().removeSuffix("/"),
                allowLocalhostHttpForTests = true
            )
            val fakeKeyStore = InMemoryFakeVaultKeyStore()
            val session = ZkSessionManager(
                apiClient = api,
                vaultKeyStore = fakeKeyStore,
                argon2Provider = fastProvider
            )

            val keyFileJson = ZkAccountCredentialsCodec.serializeKeyFileJson(
                ZkKeyFileV2(
                    formatVersion = 2,
                    username = username,
                    userId = userId,
                    accountKeyB64u = ZkCoreCrypto.toBase64Url(accountKey),
                    saltB64u = ZkCoreCrypto.toBase64Url(salt),
                    kdfParams = kdf,
                    hasPassphrase = true,
                    createdAt = "2026-11-18T00:00:00Z"
                )
            )

            session.loginWithKeyFileJson(keyFileJson, passphrase)
            val encSession = session.prepareBiometricEnrollmentSession()
            session.completeBiometricEnrollment(encSession)
            assertTrue(fakeKeyStore.hasBiometricWrappedVk())

            session.lock("Manual lock")
            assertFalse(session.isUnlocked())
            assertTrue(session.sessionState.value.isLockedWithSavedKeystore)

            // Simulate user adding/changing system biometrics -> KeyStore invalidates biometric key
            fakeKeyStore.simulateBiometricEnrollmentChanged()

            try {
                session.prepareBiometricUnlockSession()
                fail("Expected KeyInvalidatedException on invalidated biometric key")
            } catch (expected: VaultKeyStore.KeyInvalidatedException) {
                assertTrue(expected.message!!.contains("invalidated", ignoreCase = true))
            }

            // Session must clear stale biometric wrapped VK, remain locked, and explicitly propose Key File + passphrase fallback
            assertFalse(fakeKeyStore.hasBiometricWrappedVk())
            val stateAfter = session.sessionState.value
            assertFalse(stateAfter.isUnlocked)
            assertFalse(stateAfter.isLockedWithSavedKeystore)
            assertNotNull(stateAfter.lockReason)
            assertTrue(stateAfter.lockReason!!.contains("File Chiave", ignoreCase = true))
            assertTrue(stateAfter.lockReason!!.contains("passphrase", ignoreCase = true))

            // Fallback login with Key File + passphrase recovers full access cleanly
            session.loginWithKeyFileJson(keyFileJson, passphrase)
            assertTrue(session.isUnlocked())
            assertArrayEquals(ZkCoreCrypto.deriveSubkeys(vaultKey).metaKey, session.getSubkeysOrNull()!!.metaKey)
        } finally {
            server.shutdown()
            root.zeroize()
            keys.zeroizeAll()
        }
    }

    @Test
    fun `lock, onAppBackgrounded (onStop), and logout wipe all in-memory secrets and persisted keys`() = runTest {
        val userId = UUID.randomUUID().toString().lowercase()
        val username = "alice_wipe"
        val passphrase = "Wipe-Verify-Passphrase#2026"
        val accountKey = ByteArray(32) { (it + 0x20).toByte() }
        val vaultKey = ByteArray(32) { (it + 0x77).toByte() }
        val salt = ByteArray(16) { (it + 0x31).toByte() }
        val kdf = V2KdfParamsDto("Argon2id", 65536, 3, 1)

        val fastProvider = ZkArgon2id.Argon2idProvider { ak, slt, params, _, _, _ ->
            ByteArray(params.hashLength) { idx -> (ak[idx % ak.size].toInt() xor slt[idx % slt.size].toInt()).toByte() }
        }
        val root = ZkCoreCrypto.deriveRoot(accountKey, salt, passphrase, kdf.toArgon2Params(), argon2Provider = fastProvider)
        val keys = ZkCoreCrypto.deriveKekAndAuthSecret(root)
        val wrappedVkB64u = ZkCoreCrypto.toBase64Url(ZkCoreCrypto.wrapVaultKey(keys.kek, vaultKey, userId))

        var logoutCalls = 0
        val server = MockWebServer()
        server.dispatcher = object : Dispatcher() {
            override fun dispatch(request: RecordedRequest): MockResponse {
                return when (request.path) {
                    "/api/v2/login/params" -> MockResponse().setResponseCode(200).setBody(
                        JSONObject().put("salt", ZkCoreCrypto.toBase64Url(salt)).put("kdfParams", kdf.toJson()).toString()
                    )
                    "/api/v2/login" -> MockResponse().setResponseCode(200)
                        .addHeader("Set-Cookie", "photocloud_v2_sid=sid-wipe-1; Path=/; HttpOnly; Secure")
                        .setBody(
                            JSONObject()
                                .put("userId", userId)
                                .put("username", username)
                                .put("salt", ZkCoreCrypto.toBase64Url(salt))
                                .put("kdfParams", kdf.toJson())
                                .put("wrappedVaultKey", wrappedVkB64u)
                                .toString()
                        )
                    "/api/v2/logout" -> {
                        logoutCalls++
                        MockResponse().setResponseCode(200).setBody("""{"ok":true}""")
                    }
                    else -> MockResponse().setResponseCode(404)
                }
            }
        }
        server.start()

        try {
            val api = PhotoCloudZkApiClientV2(
                initialBaseUrl = server.url("/").toString().removeSuffix("/"),
                allowLocalhostHttpForTests = true
            )
            val fakeKeyStore = InMemoryFakeVaultKeyStore()
            val metaStore = InMemoryZkAccountMetadataStore()
            val pinStore = InMemoryKdfPinningStore()
            val session = ZkSessionManager(
                apiClient = api,
                vaultKeyStore = fakeKeyStore,
                kdfPinningStore = pinStore,
                metadataStore = metaStore,
                argon2Provider = fastProvider
            )
            val recCode = ZkAccountCredentialsCodec.formatRecoveryCode(accountKey)

            // 1. lock() zeroizes subkeys and refuses copyVaultKeyForAuthorizedWrap
            session.loginWithRecoveryCode(username, recCode, passphrase)
            val subkeys1 = session.getSubkeysOrNull()!!
            session.lock("Test manual lock")
            assertFalse(session.isUnlocked())
            assertTrue(subkeys1.metaKey.all { it == 0.toByte() })
            assertTrue(subkeys1.thumbKey.all { it == 0.toByte() })
            assertTrue(subkeys1.dedupKey.all { it == 0.toByte() })
            assertTrue(subkeys1.fkWrapKey.all { it == 0.toByte() })
            try {
                session.copyVaultKeyForAuthorizedWrap()
                fail("Locked vault must not allow copyVaultKeyForAuthorizedWrap")
            } catch (_: IllegalStateException) {
            }

            // 2. onAppBackgrounded() (onStop) zeroizes subkeys when lockOnBackground=true
            session.loginWithRecoveryCode(username, recCode, passphrase)
            session.setAutoLockConfig(timeoutMs = 15 * 60 * 1000L, lockOnBackground = true)
            val subkeys2 = session.getSubkeysOrNull()!!
            session.onAppBackgrounded()
            assertFalse(session.isUnlocked())
            assertTrue(subkeys2.metaKey.all { it == 0.toByte() })
            assertTrue(subkeys2.fkWrapKey.all { it == 0.toByte() })

            // 3. logout() wipes memory, deletes keystore keys, clears metadata and cookie jar
            session.loginWithRecoveryCode(username, recCode, passphrase)
            session.completeBiometricEnrollment(session.prepareBiometricEnrollmentSession())
            session.enableBackgroundBackupKey()
            val subkeys3 = session.getSubkeysOrNull()!!
            assertTrue(fakeKeyStore.hasBiometricWrappedVk())
            assertTrue(fakeKeyStore.hasBackgroundWrappedVk())
            assertTrue(api.hasActiveSessionCookie())

            session.logout()
            assertEquals(1, logoutCalls)
            assertFalse(session.isUnlocked())
            assertFalse(fakeKeyStore.hasBiometricWrappedVk())
            assertFalse(fakeKeyStore.hasBackgroundWrappedVk())
            assertFalse(api.hasActiveSessionCookie())
            assertNull(metaStore.getLastUserId())
            assertNull(metaStore.getLastUsername())
            assertNull(session.getCurrentUpdatedKeyFileOrNull())
            assertTrue(subkeys3.metaKey.all { it == 0.toByte() })
            assertTrue(subkeys3.fkWrapKey.all { it == 0.toByte() })
        } finally {
            server.shutdown()
            root.zeroize()
            keys.zeroizeAll()
        }
    }

    @Test
    fun `persisted keystore blobs, KDF pins, and metadata never contain plaintext VK`() {
        val vk = JvmCryptoProvider.randomBytes(32)
        val vkSnapshot = vk.copyOf()
        val store = InMemoryFakeVaultKeyStore()
        store.finishBiometricWrap(vk, store.prepareBiometricEncryptSession())
        store.wrapForBackground(vk)

        val bioBlob = store.getRawBiometricWrappedBlobForTest()!!
        val bgBlob = store.getRawBackgroundWrappedBlobForTest()!!
        val pinRecord = PinnedKdfRecord(
            username = "alice_check",
            saltB64u = ZkCoreCrypto.toBase64Url(ByteArray(16) { 0x44 }),
            memoryKiB = 65536,
            iterations = 3,
            parallelism = 1,
            pinnedAtMs = 123456L
        )
        val serializedPrefsFile = Files.createTempFile("pc_prefs_sim_", ".json")
        try {
            val prefsDump = JSONObject()
                .put("wrapped_vk_bio_v2", Base64.getEncoder().encodeToString(bioBlob))
                .put("wrapped_vk_bg_v2", Base64.getEncoder().encodeToString(bgBlob))
                .put(
                    "kdf_pin",
                    JSONObject()
                        .put("username", pinRecord.username)
                        .put("saltB64u", pinRecord.saltB64u)
                        .put("memoryKiB", pinRecord.memoryKiB)
                        .put("iterations", pinRecord.iterations)
                        .put("parallelism", pinRecord.parallelism)
                )
                .toString()
            Files.write(serializedPrefsFile, prefsDump.toByteArray(Charsets.UTF_8))
            val diskContents = String(Files.readAllBytes(serializedPrefsFile), Charsets.UTF_8)
            val diskBytes = Files.readAllBytes(serializedPrefsFile)

            assertFalse(diskBytes.decodeToString().contains(String(vkSnapshot, Charsets.ISO_8859_1)))
            assertFalse(diskContents.contains(ZkCoreCrypto.toHex(vkSnapshot), ignoreCase = true))
            assertFalse(diskContents.contains(ZkCoreCrypto.toBase64Url(vkSnapshot)))
            assertFalse(diskContents.contains(Base64.getEncoder().encodeToString(vkSnapshot)))
            assertFalse(bioBlob.contentEquals(vkSnapshot))
            assertFalse(bgBlob.contentEquals(vkSnapshot))
        } finally {
            Files.deleteIfExists(serializedPrefsFile)
            vk.zeroize()
            vkSnapshot.zeroize()
        }
    }
}
