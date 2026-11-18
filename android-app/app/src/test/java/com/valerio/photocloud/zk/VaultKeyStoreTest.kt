package com.valerio.photocloud.zk

import org.junit.Assert.assertArrayEquals
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertTrue
import org.junit.Assert.fail
import org.junit.Test

class VaultKeyStoreTest {

    @Test
    fun `InMemoryFakeVaultKeyStore wraps and unwraps VK with separate biometric and background keys without plaintext on blob`() {
        val store = InMemoryFakeVaultKeyStore(strongBoxAvailable = true, deviceUnlocked = true)
        val vk = JvmCryptoProvider.randomBytes(32)
        val expectedVk = vk.copyOf()

        val bioEncryptSession = store.prepareBiometricEncryptSession()
        val statusAfterBio = store.finishBiometricWrap(vk, bioEncryptSession)
        assertTrue(statusAfterBio.biometricEnrolled)
        assertFalse(statusAfterBio.backgroundEnrolled)
        assertTrue(statusAfterBio.strongBoxBacked)

        val statusAfterBg = store.wrapForBackground(vk)
        assertTrue(statusAfterBg.biometricEnrolled)
        assertTrue(statusAfterBg.backgroundEnrolled)

        val rawBioBlob = store.getRawBiometricWrappedBlobForTest()
        val rawBgBlob = store.getRawBackgroundWrappedBlobForTest()
        assertNotNull(rawBioBlob)
        assertNotNull(rawBgBlob)
        assertFalse(rawBioBlob!!.contentEquals(expectedVk))
        assertFalse(rawBgBlob!!.contentEquals(expectedVk))
        assertFalse(rawBioBlob.contentEquals(rawBgBlob))

        val bioDecryptSession = store.prepareBiometricDecryptSession()
        val unwrappedBio = store.finishBiometricUnwrap(bioDecryptSession)
        assertArrayEquals(expectedVk, unwrappedBio)

        val unwrappedBg = store.unwrapForBackground()
        assertArrayEquals(expectedVk, unwrappedBg)

        vk.zeroize()
        unwrappedBio.zeroize()
        unwrappedBg.zeroize()
    }

    @Test
    fun `background key refuses unwrap while device is locked (setUnlockedDeviceRequired simulation)`() {
        val store = InMemoryFakeVaultKeyStore(deviceUnlocked = true)
        val vk = JvmCryptoProvider.randomBytes(32)
        store.wrapForBackground(vk)

        store.deviceUnlocked = false
        try {
            store.unwrapForBackground()
            fail("Expected DeviceLockedException when device is locked")
        } catch (expected: VaultKeyStore.DeviceLockedException) {
            assertTrue(expected.message!!.contains("locked", ignoreCase = true))
        }

        store.deviceUnlocked = true
        val unwrapped = store.unwrapForBackground()
        assertArrayEquals(vk, unwrapped)
    }

    @Test
    fun `biometric enrollment invalidation blocks decrypt and resets cleanly upon re-enrollment`() {
        val store = InMemoryFakeVaultKeyStore()
        val vk = JvmCryptoProvider.randomBytes(32)
        val session1 = store.prepareBiometricEncryptSession()
        store.finishBiometricWrap(vk, session1)

        store.simulateBiometricEnrollmentChanged()

        try {
            store.prepareBiometricDecryptSession()
            fail("Expected KeyInvalidatedException after biometric enrollment changed")
        } catch (expected: VaultKeyStore.KeyInvalidatedException) {
            assertTrue(expected.message!!.contains("invalidated", ignoreCase = true))
        }

        // Clearing stale wrapped VK and re-enrolling creates a fresh key seamlessly
        store.clearBiometricWrappedVk()
        val session2 = store.prepareBiometricEncryptSession()
        store.finishBiometricWrap(vk, session2)
        val unwrapped = store.finishBiometricUnwrap(store.prepareBiometricDecryptSession())
        assertArrayEquals(vk, unwrapped)
    }

    @Test
    fun `StrongBox unavailable falls back cleanly without failing wrap or unwrap`() {
        val store = InMemoryFakeVaultKeyStore(strongBoxAvailable = false, deviceUnlocked = true)
        val vk = JvmCryptoProvider.randomBytes(32)

        val encSession = store.prepareBiometricEncryptSession()
        val status = store.finishBiometricWrap(vk, encSession)
        assertFalse(status.strongBoxBacked)
        assertTrue(status.biometricEnrolled)

        val unwrapped = store.finishBiometricUnwrap(store.prepareBiometricDecryptSession())
        assertArrayEquals(vk, unwrapped)
    }

    @Test
    fun `deleteAllKeys removes all wrapped blobs and resets status`() {
        val store = InMemoryFakeVaultKeyStore()
        val vk = JvmCryptoProvider.randomBytes(32)
        store.finishBiometricWrap(vk, store.prepareBiometricEncryptSession())
        store.wrapForBackground(vk)
        assertTrue(store.hasBiometricWrappedVk())
        assertTrue(store.hasBackgroundWrappedVk())

        store.deleteAllKeys()
        assertFalse(store.hasBiometricWrappedVk())
        assertFalse(store.hasBackgroundWrappedVk())
        val status = store.getStatus()
        assertFalse(status.biometricEnrolled)
        assertFalse(status.backgroundEnrolled)
    }
}
