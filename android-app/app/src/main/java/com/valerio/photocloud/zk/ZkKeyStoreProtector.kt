package com.valerio.photocloud.zk

import android.os.Build
import android.security.keystore.KeyGenParameterSpec
import android.security.keystore.KeyProperties
import java.security.KeyStore
import javax.crypto.Cipher
import javax.crypto.KeyGenerator
import javax.crypto.SecretKey
import javax.crypto.spec.GCMParameterSpec

/**
 * Platform-abstracted interface for wrapping and unwrapping the 32-byte Vault Key (`VK`)
 * on Android devices using hardware-backed `AndroidKeyStore`:
 * 1. Interactive biometric unlock via `BiometricPrompt.CryptoObject(cipher)`
 * 2. Background `AutoBackupWorker` unlock via a separate key with `setUnlockedDeviceRequired(true)`.
 *
 * Unit tests on standard JVM use `InMemoryVaultKeyProtector` without requiring an emulator.
 */
interface VaultKeyStoreProtector {
    fun wrapWithUnlockedCipher(vaultKey: ByteArray, unlockedEncryptCipher: Cipher): ByteArray
    fun unwrapWithUnlockedCipher(wrappedBlob: ByteArray, unlockedDecryptCipher: Cipher): ByteArray
    fun wrapForBackgroundAutoBackup(vaultKey: ByteArray): ByteArray
    fun unwrapForBackgroundAutoBackup(wrappedBlob: ByteArray): ByteArray
}

class InMemoryVaultKeyProtector(
    cryptoProvider: ZkCryptoProvider = JvmCryptoProvider
) : VaultKeyStoreProtector {
    private val bgKey = SecretKeySpecHolder(cryptoProvider.randomBytes(32))

    private class SecretKeySpecHolder(val raw: ByteArray)

    override fun wrapWithUnlockedCipher(vaultKey: ByteArray, unlockedEncryptCipher: Cipher): ByteArray {
        val iv = unlockedEncryptCipher.iv
        val ct = unlockedEncryptCipher.doFinal(vaultKey)
        return iv + ct
    }

    override fun unwrapWithUnlockedCipher(wrappedBlob: ByteArray, unlockedDecryptCipher: Cipher): ByteArray {
        val ct = wrappedBlob.copyOfRange(12, wrappedBlob.size)
        return unlockedDecryptCipher.doFinal(ct)
    }

    override fun wrapForBackgroundAutoBackup(vaultKey: ByteArray): ByteArray {
        val iv = JvmCryptoProvider.randomBytes(12)
        val ct = JvmCryptoProvider.aes256GcmEncrypt(bgKey.raw, iv, vaultKey, "vk-bg-v2".toByteArray())
        return iv + ct
    }

    override fun unwrapForBackgroundAutoBackup(wrappedBlob: ByteArray): ByteArray {
        if (wrappedBlob.size < 28) {
            throw ZkCryptoException(ZkErrorCode.TRUNCATED_BLOB, "Invalid background wrapped VK.")
        }
        val iv = wrappedBlob.copyOfRange(0, 12)
        val ct = wrappedBlob.copyOfRange(12, wrappedBlob.size)
        return JvmCryptoProvider.aes256GcmDecrypt(
            bgKey.raw,
            iv,
            ct,
            "vk-bg-v2".toByteArray(),
            ZkErrorCode.WRONG_KEY_OR_PASSPHRASE
        )
    }
}

class AndroidKeyStoreVaultKeyProtector : VaultKeyStoreProtector {
    companion object {
        private const val ANDROID_KEYSTORE = "AndroidKeyStore"
        const val ALIAS_BIOMETRIC_VK = "photocloud_vk_bio_v2"
        const val ALIAS_BACKGROUND_VK = "photocloud_vk_bg_v2"
    }

    private fun getOrCreateKey(alias: String, requireBiometricAuth: Boolean): SecretKey {
        val ks = KeyStore.getInstance(ANDROID_KEYSTORE).apply { load(null) }
        val existing = ks.getEntry(alias, null) as? KeyStore.SecretKeyEntry
        if (existing != null) {
            return existing.secretKey
        }

        val keyGen = KeyGenerator.getInstance(KeyProperties.KEY_ALGORITHM_AES, ANDROID_KEYSTORE)
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
            }
        } else {
            builder.setUserAuthenticationRequired(false)
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.P) {
                builder.setUnlockedDeviceRequired(true)
            }
        }

        keyGen.init(builder.build())
        return keyGen.generateKey()
    }

    fun createBiometricEncryptCipher(): Cipher {
        val secretKey = getOrCreateKey(ALIAS_BIOMETRIC_VK, requireBiometricAuth = true)
        return Cipher.getInstance("AES/GCM/NoPadding").apply {
            init(Cipher.ENCRYPT_MODE, secretKey)
        }
    }

    fun createBiometricDecryptCipher(wrappedBlob: ByteArray): Cipher {
        if (wrappedBlob.size < 28) {
            throw ZkCryptoException(ZkErrorCode.TRUNCATED_BLOB, "Invalid biometric wrapped VK.")
        }
        val iv = wrappedBlob.copyOfRange(0, 12)
        val secretKey = getOrCreateKey(ALIAS_BIOMETRIC_VK, requireBiometricAuth = true)
        return Cipher.getInstance("AES/GCM/NoPadding").apply {
            init(Cipher.DECRYPT_MODE, secretKey, GCMParameterSpec(128, iv))
        }
    }

    override fun wrapWithUnlockedCipher(vaultKey: ByteArray, unlockedEncryptCipher: Cipher): ByteArray {
        val iv = unlockedEncryptCipher.iv
        val ct = unlockedEncryptCipher.doFinal(vaultKey)
        return iv + ct
    }

    override fun unwrapWithUnlockedCipher(wrappedBlob: ByteArray, unlockedDecryptCipher: Cipher): ByteArray {
        if (wrappedBlob.size < 28) {
            throw ZkCryptoException(ZkErrorCode.TRUNCATED_BLOB, "Invalid biometric wrapped VK.")
        }
        val ct = wrappedBlob.copyOfRange(12, wrappedBlob.size)
        return unlockedDecryptCipher.doFinal(ct)
    }

    override fun wrapForBackgroundAutoBackup(vaultKey: ByteArray): ByteArray {
        val secretKey = getOrCreateKey(ALIAS_BACKGROUND_VK, requireBiometricAuth = false)
        val cipher = Cipher.getInstance("AES/GCM/NoPadding")
        cipher.init(Cipher.ENCRYPT_MODE, secretKey)
        val iv = cipher.iv
        val ct = cipher.doFinal(vaultKey)
        return iv + ct
    }

    override fun unwrapForBackgroundAutoBackup(wrappedBlob: ByteArray): ByteArray {
        if (wrappedBlob.size < 28) {
            throw ZkCryptoException(ZkErrorCode.TRUNCATED_BLOB, "Invalid background wrapped VK.")
        }
        val iv = wrappedBlob.copyOfRange(0, 12)
        val ct = wrappedBlob.copyOfRange(12, wrappedBlob.size)
        val secretKey = getOrCreateKey(ALIAS_BACKGROUND_VK, requireBiometricAuth = false)
        val cipher = Cipher.getInstance("AES/GCM/NoPadding")
        cipher.init(Cipher.DECRYPT_MODE, secretKey, GCMParameterSpec(128, iv))
        return cipher.doFinal(ct)
    }
}
