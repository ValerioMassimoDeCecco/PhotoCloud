package com.valerio.photocloud.zk

import android.app.KeyguardManager
import android.content.Context
import android.content.SharedPreferences
import android.os.Build
import android.security.keystore.KeyGenParameterSpec
import android.security.keystore.KeyInfo
import android.security.keystore.KeyPermanentlyInvalidatedException
import android.security.keystore.KeyProperties
import android.security.keystore.StrongBoxUnavailableException
import android.util.Base64
import java.security.GeneralSecurityException
import java.security.KeyStore
import java.security.ProviderException
import javax.crypto.Cipher
import javax.crypto.KeyGenerator
import javax.crypto.SecretKey
import javax.crypto.SecretKeyFactory
import javax.crypto.spec.GCMParameterSpec

/**
 * Abstract hardware-backed Vault Key (`VK`, 32 bytes) storage contract (FASE 4B).
 *
 * Isolates Android KeyStore APIs (`AndroidHardwareVaultKeyStore`) from pure JVM unit tests
 * (`InMemoryFakeVaultKeyStore`) using two strictly separated key aliases:
 * 1. Interactive biometric key (`photocloud_vk_bio_v2`): requires `BiometricPrompt.CryptoObject`
 *    with `AUTH_BIOMETRIC_STRONG` and `setInvalidatedByBiometricEnrollment(true)`.
 * 2. Background backup key (`photocloud_vk_bg_v2`): requires `setUnlockedDeviceRequired(true)`
 *    on API 28+ so WorkManager can run only while the device is unlocked after boot.
 *
 * Plaintext `VK` is NEVER written to disk or `SharedPreferences`; only Keystore-encrypted
 * `IV(12) || CT(32) || Tag(16)` envelopes are persisted.
 */
interface VaultKeyStore {

    sealed interface BiometricCryptoSession {
        val cipherOrNull: Cipher?
    }

    data class KeyProtectionStatus(
        val biometricEnrolled: Boolean,
        val backgroundEnrolled: Boolean,
        val strongBoxBacked: Boolean,
        val hardwareBacked: Boolean,
        val unlockedDeviceRequiredEnforced: Boolean
    )

    class KeyInvalidatedException(message: String, cause: Throwable? = null) :
        Exception(message, cause)

    class DeviceLockedException(message: String, cause: Throwable? = null) :
        Exception(message, cause)

    fun prepareBiometricEncryptSession(): BiometricCryptoSession
    fun finishBiometricWrap(vaultKey: ByteArray, unlockedSession: BiometricCryptoSession): KeyProtectionStatus

    fun prepareBiometricDecryptSession(): BiometricCryptoSession
    fun finishBiometricUnwrap(unlockedSession: BiometricCryptoSession): ByteArray

    fun wrapForBackground(vaultKey: ByteArray): KeyProtectionStatus
    fun unwrapForBackground(): ByteArray

    fun hasBiometricWrappedVk(): Boolean
    fun hasBackgroundWrappedVk(): Boolean
    fun getStatus(): KeyProtectionStatus

    fun clearBiometricWrappedVk()
    fun clearBackgroundWrappedVk()
    fun deleteAllKeys()
}

class AndroidBiometricCryptoSession(
    val cipher: Cipher
) : VaultKeyStore.BiometricCryptoSession {
    override val cipherOrNull: Cipher = cipher
}

/**
 * Pure JVM fake implementation for deterministic unit tests without Android OS.
 * Exercises full AES-256-GCM wrapping, memory wiping, StrongBox fallback simulation,
 * background device-lock simulation, and biometric-enrollment invalidation simulation.
 */
class InMemoryFakeVaultKeyStore(
    private val cryptoProvider: ZkCryptoProvider = JvmCryptoProvider,
    var strongBoxAvailable: Boolean = true,
    var deviceUnlocked: Boolean = true
) : VaultKeyStore {

    private object FakeEncryptSession : VaultKeyStore.BiometricCryptoSession {
        override val cipherOrNull: Cipher? = null
    }

    private object FakeDecryptSession : VaultKeyStore.BiometricCryptoSession {
        override val cipherOrNull: Cipher? = null
    }

    private var bioKek: ByteArray? = null
    private var bgKek: ByteArray? = null
    private var bioWrappedVk: ByteArray? = null
    private var bgWrappedVk: ByteArray? = null
    private var bioInvalidated: Boolean = false
    private var lastStrongBoxUsed: Boolean = false

    fun simulateBiometricEnrollmentChanged() {
        bioInvalidated = true
    }

    fun getRawBiometricWrappedBlobForTest(): ByteArray? = bioWrappedVk?.copyOf()
    fun getRawBackgroundWrappedBlobForTest(): ByteArray? = bgWrappedVk?.copyOf()

    private fun ensureBioKey(): ByteArray {
        if (bioInvalidated) {
            throw VaultKeyStore.KeyInvalidatedException(
                "Biometric key permanently invalidated by new biometric enrollment."
            )
        }
        val current = bioKek
        if (current != null) return current
        lastStrongBoxUsed = strongBoxAvailable
        return cryptoProvider.randomBytes(32).also { bioKek = it }
    }

    private fun ensureBgKey(): ByteArray {
        val current = bgKek
        if (current != null) return current
        lastStrongBoxUsed = strongBoxAvailable
        return cryptoProvider.randomBytes(32).also { bgKek = it }
    }

    override fun prepareBiometricEncryptSession(): VaultKeyStore.BiometricCryptoSession {
        if (bioInvalidated) {
            // Re-enrolling generates a fresh key just like deleting & recreating in AndroidKeyStore
            bioKek?.zeroize()
            bioKek = null
            bioInvalidated = false
        }
        ensureBioKey()
        return FakeEncryptSession
    }

    override fun finishBiometricWrap(
        vaultKey: ByteArray,
        unlockedSession: VaultKeyStore.BiometricCryptoSession
    ): VaultKeyStore.KeyProtectionStatus {
        require(vaultKey.size == 32) { "vaultKey must be 32 bytes." }
        if (unlockedSession !== FakeEncryptSession) {
            throw IllegalArgumentException("Invalid fake biometric encrypt session.")
        }
        val key = ensureBioKey()
        val iv = cryptoProvider.randomBytes(12)
        val ct = cryptoProvider.aes256GcmEncrypt(
            key,
            iv,
            vaultKey,
            "vk-bio-v2".toByteArray(Charsets.UTF_8)
        )
        bioWrappedVk = iv + ct
        return getStatus()
    }

    override fun prepareBiometricDecryptSession(): VaultKeyStore.BiometricCryptoSession {
        if (bioWrappedVk == null) {
            throw IllegalStateException("No biometric-wrapped VK stored.")
        }
        ensureBioKey()
        return FakeDecryptSession
    }

    override fun finishBiometricUnwrap(
        unlockedSession: VaultKeyStore.BiometricCryptoSession
    ): ByteArray {
        if (unlockedSession !== FakeDecryptSession) {
            throw IllegalArgumentException("Invalid fake biometric decrypt session.")
        }
        val blob = bioWrappedVk ?: throw IllegalStateException("No biometric-wrapped VK stored.")
        if (blob.size < 28) {
            throw ZkCryptoException(ZkErrorCode.TRUNCATED_BLOB, "Corrupted biometric wrapped VK.")
        }
        val key = ensureBioKey()
        val iv = blob.copyOfRange(0, 12)
        val ct = blob.copyOfRange(12, blob.size)
        return cryptoProvider.aes256GcmDecrypt(
            key,
            iv,
            ct,
            "vk-bio-v2".toByteArray(Charsets.UTF_8),
            ZkErrorCode.WRONG_KEY_OR_PASSPHRASE
        )
    }

    override fun wrapForBackground(vaultKey: ByteArray): VaultKeyStore.KeyProtectionStatus {
        require(vaultKey.size == 32) { "vaultKey must be 32 bytes." }
        if (!deviceUnlocked) {
            throw VaultKeyStore.DeviceLockedException("Device is locked; cannot wrap background VK.")
        }
        val key = ensureBgKey()
        val iv = cryptoProvider.randomBytes(12)
        val ct = cryptoProvider.aes256GcmEncrypt(
            key,
            iv,
            vaultKey,
            "vk-bg-v2".toByteArray(Charsets.UTF_8)
        )
        bgWrappedVk = iv + ct
        return getStatus()
    }

    override fun unwrapForBackground(): ByteArray {
        if (!deviceUnlocked) {
            throw VaultKeyStore.DeviceLockedException(
                "Device is locked (setUnlockedDeviceRequired simulation)."
            )
        }
        val blob = bgWrappedVk ?: throw IllegalStateException("No background-wrapped VK stored.")
        if (blob.size < 28) {
            throw ZkCryptoException(ZkErrorCode.TRUNCATED_BLOB, "Corrupted background wrapped VK.")
        }
        val key = ensureBgKey()
        val iv = blob.copyOfRange(0, 12)
        val ct = blob.copyOfRange(12, blob.size)
        return cryptoProvider.aes256GcmDecrypt(
            key,
            iv,
            ct,
            "vk-bg-v2".toByteArray(Charsets.UTF_8),
            ZkErrorCode.WRONG_KEY_OR_PASSPHRASE
        )
    }

    override fun hasBiometricWrappedVk(): Boolean = bioWrappedVk != null

    override fun hasBackgroundWrappedVk(): Boolean = bgWrappedVk != null

    override fun getStatus(): VaultKeyStore.KeyProtectionStatus {
        return VaultKeyStore.KeyProtectionStatus(
            biometricEnrolled = hasBiometricWrappedVk(),
            backgroundEnrolled = hasBackgroundWrappedVk(),
            strongBoxBacked = lastStrongBoxUsed,
            hardwareBacked = lastStrongBoxUsed,
            unlockedDeviceRequiredEnforced = true
        )
    }

    override fun clearBiometricWrappedVk() {
        bioWrappedVk?.zeroize()
        bioWrappedVk = null
        bioKek?.zeroize()
        bioKek = null
        bioInvalidated = false
    }

    override fun clearBackgroundWrappedVk() {
        bgWrappedVk?.zeroize()
        bgWrappedVk = null
        bgKek?.zeroize()
        bgKek = null
    }

    override fun deleteAllKeys() {
        clearBiometricWrappedVk()
        clearBackgroundWrappedVk()
        lastStrongBoxUsed = false
    }
}

/**
 * Production Android KeyStore implementation (`AndroidKeyStore`) with:
 * - Separate interactive (`photocloud_vk_bio_v2`) and background (`photocloud_vk_bg_v2`) keys
 * - StrongBox attempt on API 28+ with automatic graceful fallback to TEE when unavailable
 * - `AUTH_BIOMETRIC_STRONG` + `setInvalidatedByBiometricEnrollment(true)`
 * - `setUnlockedDeviceRequired(true)` on API 28+ for background key
 * - Wrapped-VK-only persistence in private `SharedPreferences` (excluded from backup)
 */
class AndroidHardwareVaultKeyStore(
    context: Context
) : VaultKeyStore {

    companion object {
        private const val ANDROID_KEYSTORE = "AndroidKeyStore"
        private const val PREFS_NAME = "photocloud_v2_keystore"
        private const val KEY_BIO_WRAPPED_VK = "wrapped_vk_bio_v2"
        private const val KEY_BG_WRAPPED_VK = "wrapped_vk_bg_v2"
        private const val KEY_STRONGBOX_ACTIVE = "strongbox_active"

        const val ALIAS_BIOMETRIC_VK = "photocloud_vk_bio_v2"
        const val ALIAS_BACKGROUND_VK = "photocloud_vk_bg_v2"
        private const val CIPHER_TRANSFORMATION = "AES/GCM/NoPadding"
    }

    private val appContext = context.applicationContext
    private val prefs: SharedPreferences =
        appContext.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE)

    private data class KeyCreationOutcome(
        val key: SecretKey,
        val strongBoxBacked: Boolean,
        val hardwareBacked: Boolean
    )

    private fun openKeyStore(): KeyStore {
        return KeyStore.getInstance(ANDROID_KEYSTORE).apply { load(null) }
    }

    private fun isDeviceLockScreenSecure(): Boolean {
        val km = appContext.getSystemService(Context.KEYGUARD_SERVICE) as? KeyguardManager
        return km?.isDeviceSecure == true
    }

    private fun buildKeySpec(
        alias: String,
        requireBiometricAuth: Boolean,
        useStrongBox: Boolean
    ): KeyGenParameterSpec {
        val builder = KeyGenParameterSpec.Builder(
            alias,
            KeyProperties.PURPOSE_ENCRYPT or KeyProperties.PURPOSE_DECRYPT
        )
            .setBlockModes(KeyProperties.BLOCK_MODE_GCM)
            .setEncryptionPaddings(KeyProperties.ENCRYPTION_PADDING_NONE)
            .setKeySize(256)

        if (requireBiometricAuth) {
            builder.setUserAuthenticationRequired(true)
            builder.setInvalidatedByBiometricEnrollment(true)
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R) {
                builder.setUserAuthenticationParameters(0, KeyProperties.AUTH_BIOMETRIC_STRONG)
            } else {
                @Suppress("DEPRECATION")
                builder.setUserAuthenticationValidityDurationSeconds(-1)
            }
        } else {
            builder.setUserAuthenticationRequired(false)
            // On Android 12-14 (KeyStore2), setUnlockedDeviceRequired(true) requires a secure
            // lock screen (PIN/pattern/password); setting it without a lock screen causes
            // KeyStore2 to reject key usage with UserNotAuthenticatedException / KeyStoreException.
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.P && isDeviceLockScreenSecure()) {
                builder.setUnlockedDeviceRequired(true)
            }
        }

        if (useStrongBox && Build.VERSION.SDK_INT >= Build.VERSION_CODES.P) {
            builder.setIsStrongBoxBacked(true)
        }

        return builder.build()
    }

    private fun inspectKeyBacking(key: SecretKey): Pair<Boolean, Boolean> {
        return try {
            val factory = SecretKeyFactory.getInstance(key.algorithm, ANDROID_KEYSTORE)
            val info = factory.getKeySpec(key, KeyInfo::class.java) as KeyInfo
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
                val secLevel = info.securityLevel
                val strongBox = secLevel == KeyProperties.SECURITY_LEVEL_STRONGBOX
                val hw = strongBox || secLevel == KeyProperties.SECURITY_LEVEL_TRUSTED_ENVIRONMENT
                strongBox to hw
            } else {
                @Suppress("DEPRECATION")
                val hw = info.isInsideSecureHardware
                false to hw
            }
        } catch (_: Throwable) {
            false to false
        }
    }

    private fun getOrCreateKey(alias: String, requireBiometricAuth: Boolean): KeyCreationOutcome {
        val ks = openKeyStore()
        val existing = ks.getEntry(alias, null) as? KeyStore.SecretKeyEntry
        if (existing != null) {
            val (sb, hw) = inspectKeyBacking(existing.secretKey)
            return KeyCreationOutcome(existing.secretKey, sb, hw)
        }

        // First attempt StrongBox on API 28+, gracefully falling back to TEE if StrongBox is absent
        // or rejects the key specification (e.g., API 34 emulators / KeyStore2 HARDWARE_TYPE_UNAVAILABLE).
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.P) {
            try {
                val keyGen = KeyGenerator.getInstance(KeyProperties.KEY_ALGORITHM_AES, ANDROID_KEYSTORE)
                keyGen.init(buildKeySpec(alias, requireBiometricAuth, useStrongBox = true))
                val key = keyGen.generateKey()
                val (sb, hw) = inspectKeyBacking(key)
                prefs.edit().putBoolean(KEY_STRONGBOX_ACTIVE, sb).apply()
                return KeyCreationOutcome(key, sb, hw)
            } catch (_: StrongBoxUnavailableException) {
                // Expected fallback when hardware does not ship a StrongBox SE/Keymaster4 module.
            } catch (_: ProviderException) {
                // KeyStore2 may wrap StrongBox unavailability in ProviderException without
                // "StrongBox" in the top-level message; fall back to TEE below.
            } catch (_: GeneralSecurityException) {
                // StrongBox may reject parameters supported by TEE; fall back to TEE below.
            }
        }

        val keyGen = KeyGenerator.getInstance(KeyProperties.KEY_ALGORITHM_AES, ANDROID_KEYSTORE)
        keyGen.init(buildKeySpec(alias, requireBiometricAuth, useStrongBox = false))
        val key = keyGen.generateKey()
        val (sb, hw) = inspectKeyBacking(key)
        prefs.edit().putBoolean(KEY_STRONGBOX_ACTIVE, sb).apply()
        return KeyCreationOutcome(key, sb, hw)
    }

    private fun deleteAlias(alias: String) {
        try {
            val ks = openKeyStore()
            if (ks.containsAlias(alias)) {
                ks.deleteEntry(alias)
            }
        } catch (_: Throwable) {
        }
    }

    private fun loadBlob(prefKey: String): ByteArray? {
        val raw = prefs.getString(prefKey, null) ?: return null
        return try {
            Base64.decode(raw, Base64.NO_WRAP)
        } catch (_: IllegalArgumentException) {
            null
        }
    }

    private fun saveBlob(prefKey: String, blob: ByteArray) {
        val encoded = Base64.encodeToString(blob, Base64.NO_WRAP)
        prefs.edit().putString(prefKey, encoded).apply()
    }

    private fun checkSecurityException(t: Throwable): Throwable {
        var cur: Throwable? = t
        while (cur != null) {
            if (cur is KeyPermanentlyInvalidatedException) {
                return VaultKeyStore.KeyInvalidatedException(
                    "Biometric key invalidated (new biometric enrolled or removed). Re-login with passphrase.",
                    t
                )
            }
            val className = cur::class.java.simpleName
            if (className == "UserNotAuthenticatedException") {
                return VaultKeyStore.DeviceLockedException(
                    "Device or user authentication required by AndroidKeyStore.",
                    t
                )
            }
            cur = cur.cause
        }
        return t
    }

    override fun prepareBiometricEncryptSession(): VaultKeyStore.BiometricCryptoSession {
        // Recreate biometric key cleanly if previous one was invalidated
        return try {
            val outcome = getOrCreateKey(ALIAS_BIOMETRIC_VK, requireBiometricAuth = true)
            val cipher = Cipher.getInstance(CIPHER_TRANSFORMATION)
            cipher.init(Cipher.ENCRYPT_MODE, outcome.key)
            AndroidBiometricCryptoSession(cipher)
        } catch (t: KeyPermanentlyInvalidatedException) {
            deleteAlias(ALIAS_BIOMETRIC_VK)
            val outcome = getOrCreateKey(ALIAS_BIOMETRIC_VK, requireBiometricAuth = true)
            val cipher = Cipher.getInstance(CIPHER_TRANSFORMATION)
            cipher.init(Cipher.ENCRYPT_MODE, outcome.key)
            AndroidBiometricCryptoSession(cipher)
        }
    }

    override fun finishBiometricWrap(
        vaultKey: ByteArray,
        unlockedSession: VaultKeyStore.BiometricCryptoSession
    ): VaultKeyStore.KeyProtectionStatus {
        require(vaultKey.size == 32) { "vaultKey must be 32 bytes." }
        val androidSession = unlockedSession as? AndroidBiometricCryptoSession
            ?: throw IllegalArgumentException("Expected AndroidBiometricCryptoSession.")
        val cipher = androidSession.cipher
        val iv = cipher.iv
        require(iv.size == 12) { "Unexpected KeyStore GCM IV length: ${iv.size}." }
        val ct = cipher.doFinal(vaultKey)
        val blob = ByteArray(12 + ct.size)
        System.arraycopy(iv, 0, blob, 0, 12)
        System.arraycopy(ct, 0, blob, 12, ct.size)
        try {
            saveBlob(KEY_BIO_WRAPPED_VK, blob)
        } finally {
            blob.zeroize()
            ct.zeroize()
        }
        return getStatus()
    }

    override fun prepareBiometricDecryptSession(): VaultKeyStore.BiometricCryptoSession {
        val blob = loadBlob(KEY_BIO_WRAPPED_VK)
            ?: throw IllegalStateException("No biometric-wrapped VK stored.")
        if (blob.size < 28) {
            throw ZkCryptoException(ZkErrorCode.TRUNCATED_BLOB, "Invalid biometric wrapped VK.")
        }
        return try {
            val iv = blob.copyOfRange(0, 12)
            val outcome = getOrCreateKey(ALIAS_BIOMETRIC_VK, requireBiometricAuth = true)
            val cipher = Cipher.getInstance(CIPHER_TRANSFORMATION)
            cipher.init(Cipher.DECRYPT_MODE, outcome.key, GCMParameterSpec(128, iv))
            AndroidBiometricCryptoSession(cipher)
        } catch (t: Throwable) {
            throw checkSecurityException(t)
        }
    }

    override fun finishBiometricUnwrap(
        unlockedSession: VaultKeyStore.BiometricCryptoSession
    ): ByteArray {
        val androidSession = unlockedSession as? AndroidBiometricCryptoSession
            ?: throw IllegalArgumentException("Expected AndroidBiometricCryptoSession.")
        val blob = loadBlob(KEY_BIO_WRAPPED_VK)
            ?: throw IllegalStateException("No biometric-wrapped VK stored.")
        if (blob.size < 28) {
            throw ZkCryptoException(ZkErrorCode.TRUNCATED_BLOB, "Invalid biometric wrapped VK.")
        }
        return try {
            val ct = blob.copyOfRange(12, blob.size)
            androidSession.cipher.doFinal(ct)
        } catch (t: Throwable) {
            throw checkSecurityException(t)
        }
    }

    override fun wrapForBackground(vaultKey: ByteArray): VaultKeyStore.KeyProtectionStatus {
        require(vaultKey.size == 32) { "vaultKey must be 32 bytes." }
        return try {
            val outcome = getOrCreateKey(ALIAS_BACKGROUND_VK, requireBiometricAuth = false)
            val cipher = Cipher.getInstance(CIPHER_TRANSFORMATION)
            cipher.init(Cipher.ENCRYPT_MODE, outcome.key)
            val iv = cipher.iv
            val ct = cipher.doFinal(vaultKey)
            val blob = ByteArray(12 + ct.size)
            System.arraycopy(iv, 0, blob, 0, 12)
            System.arraycopy(ct, 0, blob, 12, ct.size)
            try {
                saveBlob(KEY_BG_WRAPPED_VK, blob)
            } finally {
                blob.zeroize()
                ct.zeroize()
            }
            getStatus()
        } catch (t: Throwable) {
            throw checkSecurityException(t)
        }
    }

    override fun unwrapForBackground(): ByteArray {
        val blob = loadBlob(KEY_BG_WRAPPED_VK)
            ?: throw IllegalStateException("No background-wrapped VK stored.")
        if (blob.size < 28) {
            throw ZkCryptoException(ZkErrorCode.TRUNCATED_BLOB, "Invalid background wrapped VK.")
        }
        return try {
            val iv = blob.copyOfRange(0, 12)
            val ct = blob.copyOfRange(12, blob.size)
            val outcome = getOrCreateKey(ALIAS_BACKGROUND_VK, requireBiometricAuth = false)
            val cipher = Cipher.getInstance(CIPHER_TRANSFORMATION)
            cipher.init(Cipher.DECRYPT_MODE, outcome.key, GCMParameterSpec(128, iv))
            cipher.doFinal(ct)
        } catch (t: Throwable) {
            throw checkSecurityException(t)
        }
    }

    override fun hasBiometricWrappedVk(): Boolean = prefs.contains(KEY_BIO_WRAPPED_VK)

    override fun hasBackgroundWrappedVk(): Boolean = prefs.contains(KEY_BG_WRAPPED_VK)

    override fun getStatus(): VaultKeyStore.KeyProtectionStatus {
        var strongBox = prefs.getBoolean(KEY_STRONGBOX_ACTIVE, false)
        var hardwareBacked = strongBox
        try {
            val ks = openKeyStore()
            val entry = (ks.getEntry(ALIAS_BIOMETRIC_VK, null) as? KeyStore.SecretKeyEntry)
                ?: (ks.getEntry(ALIAS_BACKGROUND_VK, null) as? KeyStore.SecretKeyEntry)
            if (entry != null) {
                val (sb, hw) = inspectKeyBacking(entry.secretKey)
                strongBox = sb
                hardwareBacked = hw
            }
        } catch (_: Throwable) {
        }
        return VaultKeyStore.KeyProtectionStatus(
            biometricEnrolled = hasBiometricWrappedVk(),
            backgroundEnrolled = hasBackgroundWrappedVk(),
            strongBoxBacked = strongBox,
            hardwareBacked = hardwareBacked,
            unlockedDeviceRequiredEnforced = Build.VERSION.SDK_INT >= Build.VERSION_CODES.P &&
                isDeviceLockScreenSecure()
        )
    }

    override fun clearBiometricWrappedVk() {
        prefs.edit().remove(KEY_BIO_WRAPPED_VK).apply()
        deleteAlias(ALIAS_BIOMETRIC_VK)
    }

    override fun clearBackgroundWrappedVk() {
        prefs.edit().remove(KEY_BG_WRAPPED_VK).apply()
        deleteAlias(ALIAS_BACKGROUND_VK)
    }

    override fun deleteAllKeys() {
        prefs.edit()
            .remove(KEY_BIO_WRAPPED_VK)
            .remove(KEY_BG_WRAPPED_VK)
            .remove(KEY_STRONGBOX_ACTIVE)
            .apply()
        deleteAlias(ALIAS_BIOMETRIC_VK)
        deleteAlias(ALIAS_BACKGROUND_VK)
    }
}
