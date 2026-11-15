package com.valerio.photocloud

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test
import java.io.ByteArrayInputStream
import java.security.MessageDigest

class AutoBackupLogicTest {

    @Test
    fun computeSha256HexStream_matchesExpectedAcrossMultiChunkStreams() {
        val emptyDigest = AutoBackupLogic.computeSha256HexStream(ByteArrayInputStream(ByteArray(0)))
        assertEquals("e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855", emptyDigest)

        // > 2 * 64 KB to exercise streaming loop multiple iterations
        val payload = ByteArray(150_000) { i -> ((i * 31) and 0xFF).toByte() }
        val expected = MessageDigest.getInstance("SHA-256")
            .digest(payload)
            .joinToString("") { "%02x".format(it) }
        val actual = AutoBackupLogic.computeSha256HexStream(ByteArrayInputStream(payload))
        assertEquals(expected, actual)
        assertTrue(AutoBackupLogic.isValidSha256Hex(actual))
        assertTrue(AutoBackupLogic.isValidSha256Hex("  ${actual.uppercase()} "))
        assertFalse(AutoBackupLogic.isValidSha256Hex(""))
        assertFalse(AutoBackupLogic.isValidSha256Hex("z".repeat(64)))
        assertFalse(AutoBackupLogic.isValidSha256Hex("a".repeat(63)))
    }

    @Test
    fun insecureHttpConfirmation_requiredUntilConfirmedForSameOrigin() {
        assertTrue(AutoBackupLogic.isHttpsServerUrl("https://cloud.example.com"))
        assertFalse(AutoBackupLogic.requiresInsecureHttpConfirmation("https://cloud.example.com", ""))

        assertTrue(AutoBackupLogic.requiresInsecureHttpConfirmation("http://192.168.1.10:3000", ""))
        assertFalse(
            AutoBackupLogic.requiresInsecureHttpConfirmation(
                "http://192.168.1.10:3000/",
                "http://192.168.1.10:3000"
            )
        )
        assertTrue(
            AutoBackupLogic.requiresInsecureHttpConfirmation(
                "http://192.168.1.25:3000",
                "http://192.168.1.10:3000"
            )
        )
    }

    @Test
    fun shouldIncludeCandidate_respectsBucketsScopeLibraryModeAndMaxVideoSize() {
        val baseTime = 1_750_000_000_000L
        val config = AutoBackupConfig(
            enabled = true,
            selectedBuckets = setOf("Camera"),
            mediaScope = BackupMediaScope.PHOTO,
            libraryMode = BackupLibraryMode.NEW_ONLY,
            activatedAtMs = baseTime,
            maxVideoSizeMb = 50
        )

        val validPhoto = MediaBackupCandidate(
            mediaStoreId = 1L,
            uriString = "content://media/external/images/media/1",
            displayName = "IMG_1.jpg",
            bucketName = "camera",
            mimeType = "image/jpeg",
            isVideo = false,
            sizeBytes = 2_000_000L,
            dateTakenMs = baseTime + 10_000L,
            dateAddedMs = baseTime + 10_000L
        )
        assertTrue(AutoBackupLogic.shouldIncludeCandidate(validPhoto, config))

        // Different bucket excluded
        assertFalse(AutoBackupLogic.shouldIncludeCandidate(validPhoto.copy(bucketName = "WhatsApp Images"), config))

        // Video excluded when scope is PHOTO
        val videoCand = validPhoto.copy(
            mediaStoreId = 2L,
            displayName = "VID_2.mp4",
            mimeType = "video/mp4",
            isVideo = true,
            sizeBytes = 20L * 1024L * 1024L
        )
        assertFalse(AutoBackupLogic.shouldIncludeCandidate(videoCand, config))

        // Video allowed when scope = BOTH and size <= maxVideoSizeMb
        val bothConfig = config.copy(mediaScope = BackupMediaScope.BOTH)
        assertTrue(AutoBackupLogic.shouldIncludeCandidate(videoCand, bothConfig))

        // Video > 50 MB excluded
        assertFalse(
            AutoBackupLogic.shouldIncludeCandidate(
                videoCand.copy(sizeBytes = 51L * 1024L * 1024L),
                bothConfig
            )
        )

        // Old item excluded in NEW_ONLY, included in FULL_LIBRARY
        val oldPhoto = validPhoto.copy(
            dateTakenMs = baseTime - 60_000L,
            dateAddedMs = baseTime - 60_000L
        )
        assertFalse(AutoBackupLogic.shouldIncludeCandidate(oldPhoto, config))
        assertTrue(AutoBackupLogic.shouldIncludeCandidate(oldPhoto, config.copy(libraryMode = BackupLibraryMode.FULL_LIBRARY)))
    }

    @Test
    fun nextStateAfterServerCheck_deduplicatesActiveAndRequeuesTrashedOrMissing() {
        val existing = setOf("a".repeat(64))
        assertEquals(
            BackupItemStatus.SKIPPED,
            AutoBackupLogic.nextStateAfterServerCheck(BackupItemStatus.PENDING, "a".repeat(64), existing)
        )
        assertEquals(
            BackupItemStatus.PENDING,
            AutoBackupLogic.nextStateAfterServerCheck(BackupItemStatus.PENDING, "b".repeat(64), existing)
        )
        assertEquals(
            BackupItemStatus.UPLOADED,
            AutoBackupLogic.nextStateAfterServerCheck(BackupItemStatus.UPLOADED, "b".repeat(64), existing)
        )
    }

    @Test
    fun chunkedThresholdRetryCodesAndBackoff_behaveAsExpected() {
        assertFalse(AutoBackupLogic.shouldUseChunkedUpload(24L * 1024L * 1024L))
        assertTrue(AutoBackupLogic.shouldUseChunkedUpload(24L * 1024L * 1024L + 1L))

        assertTrue(AutoBackupLogic.isRetryableHttpCode(429))
        assertTrue(AutoBackupLogic.isRetryableHttpCode(503))
        assertFalse(AutoBackupLogic.isRetryableHttpCode(413))
        assertFalse(AutoBackupLogic.isRetryableHttpCode(403))

        assertEquals(15L, AutoBackupLogic.computeBackoffDelaySeconds(0))
        assertEquals(30L, AutoBackupLogic.computeBackoffDelaySeconds(1))
        assertEquals(3600L, AutoBackupLogic.computeBackoffDelaySeconds(12))
    }

    @Test
    fun planLruEvictions_evictsOldestFilesFirstUntilUnderBudget() {
        val entries = listOf(
            Triple("newest.jpg", 60L, 3000L),
            Triple("oldest.jpg", 50L, 1000L),
            Triple("middle.jpg", 40L, 2000L)
        )
        val evict = AutoBackupLogic.planLruEvictions(entries, maxBytes = 100L)
        assertEquals(listOf("oldest.jpg"), evict)

        val evictMore = AutoBackupLogic.planLruEvictions(entries, maxBytes = 60L)
        assertEquals(listOf("oldest.jpg", "middle.jpg"), evictMore)
    }
}
