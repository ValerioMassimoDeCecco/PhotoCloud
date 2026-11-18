package com.valerio.photocloud.zk

import kotlinx.coroutines.test.runTest
import org.json.JSONObject
import org.junit.Assert.assertArrayEquals
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertTrue
import org.junit.Assert.fail
import org.junit.Assume
import org.junit.Test
import java.io.ByteArrayInputStream
import java.io.ByteArrayOutputStream
import java.io.File
import java.nio.charset.StandardCharsets
import java.util.Base64
import java.util.UUID

/**
 * Live Android JVM <-> Express/Node Server Integration Test (FASE 4B):
 *
 * 1. Connects to live Node `/api/v2/` endpoints seeded by TypeScript `ZkVaultClient`.
 * 2. Logs in with TS-generated KeyFile JSON + passphrase (real BouncyCastle 64 MiB Argon2id).
 * 3. Lists `/api/v2/items`, downloads & decrypts TS-uploaded `encMeta` and `PCZK v1` blob.
 * 4. Logs out, verifies memory wipe (`fill(0)`), logs back in using Recovery Code + passphrase.
 * 5. Rotates passphrase via `POST /api/v2/account/rewrap`, confirms old passphrase fails
 *    with uniform auth error and new passphrase succeeds.
 * 6. Encrypts & uploads a fresh Kotlin `PCZK v1` blob + `encMeta` via chunked upload and
 *    writes `ZK_INTEGRATION_OUT` for downstream TypeScript decryption verification.
 * 7. Runs [ZkNetworkSpyInterceptor] across every single live HTTP request (`raw`, `hex`, `base64`, `base64url`).
 *
 * When `ZK_INTEGRATION_CONFIG` is absent locally, skips cleanly with `[PENDING]` message unless
 * `REQUIRE_ANDROID_INTEGRATION=1` (enforced in CI so silent skips are impossible).
 */
class AndroidLiveIntegrationTest {

    @Test
    fun `live Node server integration - TS seed decrypt, rewrap, Kotlin upload for TS, and Network Spy`() = runTest {
        val configPath = System.getenv("ZK_INTEGRATION_CONFIG")
            ?: System.getProperty("zk.integration.config")
        val requireLive = System.getenv("REQUIRE_ANDROID_INTEGRATION") == "1"

        if (configPath.isNullOrBlank() || !File(configPath).exists()) {
            if (requireLive) {
                fail("REQUIRE_ANDROID_INTEGRATION=1 ma ZK_INTEGRATION_CONFIG mancante: $configPath")
            }
            Assume.assumeTrue(
                "PENDING: live Android-Node integration richiede ZK_INTEGRATION_CONFIG (eseguito in CI job android-integration).",
                false
            )
            return@runTest
        }

        System.gc()
        val cfg = JSONObject(File(configPath).readText(StandardCharsets.UTF_8))
        val baseUrl = cfg.getString("baseUrl")
        val username = cfg.getString("username")
        val passphrase = cfg.getString("passphrase")
        val newPassphrase = cfg.getString("newPassphrase")
        val recoveryCode = cfg.getString("recoveryCode")
        val keyFileJson = cfg.getJSONObject("keyFile").toString()
        val seedBlobId = cfg.getString("seedBlobId")
        val expectedSeedName = cfg.getString("expectedSeedName")
        val expectedSeedPlaintext = Base64.getDecoder().decode(cfg.getString("expectedSeedPlaintextB64"))
        val outPath = System.getenv("ZK_INTEGRATION_OUT") ?: cfg.optString("outputPath", "")

        val parsedKeyFile = ZkAccountCredentialsCodec.parseKeyFileJson(keyFileJson)
        val accountKeyBytes = ZkCoreCrypto.fromBase64Url(parsedKeyFile.accountKeyB64u)

        val spy = ZkNetworkSpyInterceptor()
        val api = PhotoCloudZkApiClientV2(
            initialBaseUrl = baseUrl,
            allowLocalhostHttpForTests = true,
            extraInterceptors = listOf(spy)
        )
        val fakeKeyStore = InMemoryFakeVaultKeyStore()
        val kdfPinStore = InMemoryKdfPinningStore()
        val session = ZkSessionManager(
            apiClient = api,
            vaultKeyStore = fakeKeyStore,
            kdfPinningStore = kdfPinStore
        )

        // 1. Login via KeyFile JSON + initial passphrase
        session.loginWithKeyFileJson(keyFileJson, passphrase)
        assertTrue(session.isUnlocked())
        assertTrue(api.hasActiveSessionCookie())

        val subkeys1 = session.getSubkeysOrNull()!!
        val vkCopyForSpy = session.copyVaultKeyForAuthorizedWrap()

        // 2. Fetch TS-seeded item from live Node server and decrypt metadata + PCZK blob in Kotlin
        val items = api.listItems(state = "active", limit = 50)
        val seedItem = items.firstOrNull { it.blobId.equals(seedBlobId, ignoreCase = true) }
            ?: throw AssertionError("Seed blob $seedBlobId non trovato su /api/v2/items")

        val encMetaBytes = ZkCoreCrypto.fromBase64Url(seedItem.encMetaB64u)
        val decryptedMetaJson = JSONObject(ZkCoreCrypto.decryptMeta(subkeys1.metaKey, seedItem.blobId, encMetaBytes))
        assertEquals(expectedSeedName, decryptedMetaJson.getString("name"))

        val downloadedCiphertext = api.downloadBlobBytes(seedItem.blobId)
        val decryptedPlaintextOut = ByteArrayOutputStream()
        ZkCoreCrypto.decryptBlobStream(
            input = ByteArrayInputStream(downloadedCiphertext),
            output = decryptedPlaintextOut,
            fkWrapKey = subkeys1.fkWrapKey,
            expectedBlobId = seedItem.blobId
        )
        assertArrayEquals(expectedSeedPlaintext, decryptedPlaintextOut.toByteArray())

        // 3. Logout and confirm memory wipe (`fill(0)`)
        session.logout()
        assertFalse(session.isUnlocked())
        assertFalse(api.hasActiveSessionCookie())
        assertTrue("metaKey non azzerata al logout", subkeys1.metaKey.all { it == 0.toByte() })

        // 4. Re-login with Recovery Code + initial passphrase, then execute real /api/v2/account/rewrap
        System.gc()
        session.loginWithRecoveryCode(username, recoveryCode, passphrase)
        assertTrue(session.isUnlocked())

        System.gc()
        session.changePassphrase(passphrase, newPassphrase)
        session.logout()

        // 5. Confirm old passphrase fails uniformly and new passphrase succeeds
        System.gc()
        try {
            session.loginWithRecoveryCode(username, recoveryCode, passphrase)
            fail("Old passphrase MUST fail after /account/rewrap")
        } catch (expected: ZkUniformAuthException) {
            assertEquals(UNIFORM_AUTH_ERROR_MESSAGE, expected.message)
        }

        System.gc()
        session.loginWithRecoveryCode(username, recoveryCode, newPassphrase)
        assertTrue(session.isUnlocked())
        val subkeys2 = session.getSubkeysOrNull()!!

        // 6. Encrypt & upload a brand-new Kotlin PCZK v1 blob for downstream TypeScript verification
        val kotlinBlobId = UUID.randomUUID().toString().lowercase()
        val kotlinFileKey = JvmCryptoProvider.randomBytes(32)
        val kotlinPlaintext = "Messaggio cifrato da Android Kotlin FASE 4B per verifica TypeScript SDK!".toByteArray(StandardCharsets.UTF_8)
        val kotlinMetaName = "android-live-4b.txt"
        val kotlinMetaJson = JSONObject()
            .put("v", 1)
            .put("name", kotlinMetaName)
            .put("mime", "text/plain")
            .put("size", kotlinPlaintext.size)
            .put("createdAt", System.currentTimeMillis())
            .toString()

        val encMetaB64u = ZkCoreCrypto.toBase64Url(
            ZkCoreCrypto.encryptMeta(subkeys2.metaKey, kotlinBlobId, kotlinMetaJson)
        )
        val pczkOut = ByteArrayOutputStream()
        val encRes = ZkCoreCrypto.encryptBlobStream(
            input = ByteArrayInputStream(kotlinPlaintext),
            output = pczkOut,
            fkWrapKey = subkeys2.fkWrapKey,
            blobId = kotlinBlobId,
            fileKey = kotlinFileKey.copyOf(),
            dedupKey = subkeys2.dedupKey
        )
        val pczkBytes = pczkOut.toByteArray()
        val uploadedItem = api.uploadEncryptedBlobChunked(
            blobId = kotlinBlobId,
            pczkCiphertext = pczkBytes,
            expectedSha256Hex = encRes.ciphertextSha256Hex,
            encMetaB64u = encMetaB64u,
            chunkSize = 65536,
            dedupTagB64u = encRes.dedupTagB64u
        )
        assertEquals(kotlinBlobId, uploadedItem.blobId)

        // 7. Write handoff artifact for TypeScript verification script
        if (outPath.isNotBlank()) {
            val updatedKf = session.getCurrentUpdatedKeyFileOrNull()
            assertNotNull(updatedKf)
            val handoff = JSONObject()
                .put("kotlinBlobId", kotlinBlobId)
                .put("kotlinMetaName", kotlinMetaName)
                .put("kotlinPlaintextB64", Base64.getEncoder().encodeToString(kotlinPlaintext))
                .put("updatedKeyFile", JSONObject(ZkAccountCredentialsCodec.serializeKeyFileJson(updatedKf!!)))
            File(outPath).writeText(handoff.toString(2), StandardCharsets.UTF_8)
        }

        // 8. Run Network Spy across all live exchanges
        spy.assertZeroSecretLeaks(
            listOf(
                TrackedSecret("accountKey", bytes = accountKeyBytes),
                TrackedSecret("passphrase", rawString = passphrase),
                TrackedSecret("newPassphrase", rawString = newPassphrase),
                TrackedSecret("vaultKey", bytes = vkCopyForSpy),
                TrackedSecret("kotlinFileKey", bytes = kotlinFileKey)
            )
        )

        session.logout()
        vkCopyForSpy.zeroize()
        accountKeyBytes.zeroize()
        kotlinFileKey.zeroize()
    }
}
