package com.valerio.photocloud.zk

import android.content.Context
import android.os.Build
import android.security.keystore.KeyInfo
import android.security.keystore.KeyProperties
import android.util.Base64
import androidx.biometric.BiometricManager
import androidx.test.core.app.ApplicationProvider
import androidx.test.ext.junit.runners.AndroidJUnit4
import org.junit.After
import org.junit.Assert.assertArrayEquals
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertTrue
import org.junit.Assume
import org.junit.Before
import org.junit.Test
import org.junit.runner.RunWith
import java.security.KeyStore
import javax.crypto.SecretKey
import javax.crypto.SecretKeyFactory

/**
 * Instrumented AndroidKeyStore tests for [AndroidHardwareVaultKeyStore] (FASE 4B).
 *
 * Verifies real KeyStore key generation (StrongBox with TEE fallback), `KeyInfo` metadata,
 * absence of plaintext `VK` in `SharedPreferences`, cleanup (`deleteAllKeys`), and biometric
 * strong key preparation when strong biometrics are enrolled on the target device/emulator.
 */
@RunWith(AndroidJUnit4::class)
class AndroidKeyStoreInstrumentedTest {

    private lateinit var context: Context
    private lateinit var keyStore: AndroidHardwareVaultKeyStore

    @Before
    fun setUp() {
        context = ApplicationProvider.getApplicationContext()
        keyStore = AndroidHardwareVaultKeyStore(context)
        keyStore.deleteAllKeys()
    }

    @After
    fun tearDown() {
        keyStore.deleteAllKeys()
    }

    @Test
    fun backgroundKey_wraps_and_unwraps_VK_in_AndroidKeyStore_without_plaintext_in_prefs() {
        val vk = JvmCryptoProvider.randomBytes(32)
        val expectedVk = vk.copyOf()

        val status = keyStore.wrapForBackground(vk)
        assertTrue(status.backgroundEnrolled)
        assertFalse(status.biometricEnrolled)
        assertEquals(Build.VERSION.SDK_INT >= Build.VERSION_CODES.P, status.unlockedDeviceRequiredEnforced)

        // Verify AndroidKeyStore actually holds photocloud_vk_bg_v2 with expected AES-GCM parameters
        val ks = KeyStore.getInstance("AndroidKeyStore").apply { load(null) }
        assertTrue(ks.containsAlias(AndroidHardwareVaultKeyStore.ALIAS_BACKGROUND_VK))
        val entry = ks.getEntry(AndroidHardwareVaultKeyStore.ALIAS_BACKGROUND_VK, null) as? KeyStore.SecretKeyEntry
        assertNotNull(entry)
        val secretKey: SecretKey = entry!!.secretKey
        val factory = SecretKeyFactory.getInstance(secretKey.algorithm, "AndroidKeyStore")
        val info = factory.getKeySpec(secretKey, KeyInfo::class.java) as KeyInfo
        assertEquals(256, info.keySize)
        assertTrue(info.blockModes.contains(KeyProperties.BLOCK_MODE_GCM))
        assertFalse(info.isUserAuthenticationRequired)

        // Verify SharedPreferences stores ONLY encrypted ciphertext envelope, never plaintext VK
        val rawPrefs = context.getSharedPreferences("photocloud_v2_keystore", Context.MODE_PRIVATE)
        val rawBlobString = rawPrefs.getString("wrapped_vk_bg_v2", null)
        assertNotNull(rawBlobString)
        val decodedBlob = Base64.decode(rawBlobString, Base64.NO_WRAP)
        // IV(12) + CT(32) + Tag(16) = 60 bytes
        assertEquals(60, decodedBlob.size)
        assertFalse(decodedBlob.contentEquals(expectedVk))
        val allPrefsText = rawPrefs.all.values.joinToString("\n") { it?.toString().orEmpty() }
        assertFalse(allPrefsText.contains(ZkCoreCrypto.toHex(expectedVk), ignoreCase = true))
        assertFalse(allPrefsText.contains(ZkCoreCrypto.toBase64Url(expectedVk)))
        assertFalse(allPrefsText.contains(Base64.encodeToString(expectedVk, Base64.NO_WRAP)))

        // Unwrap returns exact 32-byte VK
        val unwrapped = keyStore.unwrapForBackground()
        assertArrayEquals(expectedVk, unwrapped)

        // deleteAllKeys removes KeyStore entry and wrapped prefs cleanly
        keyStore.deleteAllKeys()
        assertFalse(keyStore.hasBackgroundWrappedVk())
        assertFalse(ks.containsAlias(AndroidHardwareVaultKeyStore.ALIAS_BACKGROUND_VK))

        vk.zeroize()
        expectedVk.zeroize()
        unwrapped.zeroize()
    }

    @Test
    fun biometricKey_initializes_CryptoObject_cipher_with_AUTH_BIOMETRIC_STRONG_when_enrolled() {
        val bioStatus = BiometricManager.from(context)
            .canAuthenticate(BiometricManager.Authenticators.BIOMETRIC_STRONG)
        Assume.assumeTrue(
            "PENDING/SKIP: emulatore/device senza BIOMETRIC_STRONG configurata (status=$bioStatus).",
            bioStatus == BiometricManager.BIOMETRIC_SUCCESS
        )

        val encSession = keyStore.prepareBiometricEncryptSession() as AndroidBiometricCryptoSession
        assertNotNull(encSession.cipher)
        encSession.cipher.iv?.let { assertEquals(12, it.size) }

        val ks = KeyStore.getInstance("AndroidKeyStore").apply { load(null) }
        assertTrue(ks.containsAlias(AndroidHardwareVaultKeyStore.ALIAS_BIOMETRIC_VK))
        val entry = ks.getEntry(AndroidHardwareVaultKeyStore.ALIAS_BIOMETRIC_VK, null) as KeyStore.SecretKeyEntry
        val factory = SecretKeyFactory.getInstance(entry.secretKey.algorithm, "AndroidKeyStore")
        val info = factory.getKeySpec(entry.secretKey, KeyInfo::class.java) as KeyInfo
        assertEquals(256, info.keySize)
        assertTrue(info.isUserAuthenticationRequired)
        assertTrue(info.isInvalidatedByBiometricEnrollment)
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R) {
            assertTrue(
                (info.userAuthenticationType and KeyProperties.AUTH_BIOMETRIC_STRONG) != 0
            )
        }
    }
}
