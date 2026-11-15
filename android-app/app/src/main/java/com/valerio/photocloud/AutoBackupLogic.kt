package com.valerio.photocloud

import java.io.InputStream
import java.security.MessageDigest
import java.util.Locale

enum class BackupMediaScope(val storageKey: String, val label: String) {
    PHOTO("photo", "Solo foto"),
    VIDEO("video", "Solo video"),
    BOTH("both", "Foto e video");

    companion object {
        fun fromKey(key: String?): BackupMediaScope {
            return entries.firstOrNull { it.storageKey.equals(key, ignoreCase = true) } ?: BOTH
        }
    }
}

enum class BackupLibraryMode(val storageKey: String, val label: String) {
    NEW_ONLY("new_only", "Solo nuovi elementi da ora"),
    FULL_LIBRARY("full_library", "Intera libreria");

    companion object {
        fun fromKey(key: String?): BackupLibraryMode {
            return entries.firstOrNull { it.storageKey.equals(key, ignoreCase = true) } ?: NEW_ONLY
        }
    }
}

data class AutoBackupConfig(
    val enabled: Boolean = false,
    val paused: Boolean = false,
    val selectedBuckets: Set<String> = setOf("Camera"),
    val mediaScope: BackupMediaScope = BackupMediaScope.BOTH,
    val wifiOnly: Boolean = true,
    val chargingOnly: Boolean = false,
    val respectBatterySaver: Boolean = true,
    val libraryMode: BackupLibraryMode = BackupLibraryMode.NEW_ONLY,
    val activatedAtMs: Long = 0L,
    val maxVideoSizeMb: Int = 0, // 0 = fino al limite del server
    val confirmedInsecureHttpUrl: String = ""
)

data class MediaBackupCandidate(
    val mediaStoreId: Long,
    val uriString: String,
    val displayName: String,
    val bucketName: String,
    val mimeType: String,
    val isVideo: Boolean,
    val sizeBytes: Long,
    val dateTakenMs: Long,
    val dateAddedMs: Long
)

data class BackupUploadOutcome(
    val uploaded: Boolean,
    val retryable: Boolean,
    val serverFilename: String = "",
    val errorMessage: String = ""
)

object AutoBackupLogic {

    const val STREAM_BUFFER_BYTES = 64 * 1024
    const val CHUNKED_UPLOAD_THRESHOLD_BYTES = 24L * 1024L * 1024L

    fun isHttpsServerUrl(serverUrl: String): Boolean {
        return serverUrl.trim().lowercase(Locale.ROOT).startsWith("https://")
    }

    fun requiresInsecureHttpConfirmation(serverUrl: String, confirmedUrl: String): Boolean {
        val clean = serverUrl.trim().removeSuffix("/")
        if (clean.isBlank()) return false
        if (isHttpsServerUrl(clean)) return false
        return !clean.equals(confirmedUrl.trim().removeSuffix("/"), ignoreCase = true)
    }

    /**
     * Streams [inputStream] in 64 KB chunks to compute its lowercase hex SHA-256 digest
     * without allocating the entire payload in heap memory.
     */
    fun computeSha256HexStream(inputStream: InputStream): String {
        val digest = MessageDigest.getInstance("SHA-256")
        val buffer = ByteArray(STREAM_BUFFER_BYTES)
        var read: Int
        while (inputStream.read(buffer).also { read = it } != -1) {
            if (read > 0) {
                digest.update(buffer, 0, read)
            }
        }
        return digest.digest().joinToString("") { "%02x".format(it) }
    }

    fun isValidSha256Hex(raw: String?): Boolean {
        val clean = raw?.trim() ?: return false
        return clean.length == 64 && clean.all {
            it in '0'..'9' || it in 'a'..'f' || it in 'A'..'F'
        }
    }

    /**
     * Evaluates whether a MediaStore item matches user-configured bucket, type, timestamp, and video size cap filters.
     */
    fun shouldIncludeCandidate(candidate: MediaBackupCandidate, config: AutoBackupConfig): Boolean {
        if (candidate.sizeBytes < 0L) return false

        when (config.mediaScope) {
            BackupMediaScope.PHOTO -> if (candidate.isVideo) return false
            BackupMediaScope.VIDEO -> if (!candidate.isVideo) return false
            BackupMediaScope.BOTH -> Unit
        }

        if (config.selectedBuckets.isNotEmpty()) {
            val matchesBucket = config.selectedBuckets.any {
                it.equals(candidate.bucketName.trim(), ignoreCase = true)
            }
            if (!matchesBucket) return false
        }

        if (candidate.isVideo && config.maxVideoSizeMb > 0) {
            val maxBytes = config.maxVideoSizeMb.toLong() * 1024L * 1024L
            if (candidate.sizeBytes > maxBytes) return false
        }

        if (config.libraryMode == BackupLibraryMode.NEW_ONLY && config.activatedAtMs > 0L) {
            // Allow a small 5-second skew between MediaStore DATE_ADDED and activation time
            val threshold = config.activatedAtMs - 5_000L
            val effectiveCreatedMs = maxOf(candidate.dateAddedMs, candidate.dateTakenMs)
            if (effectiveCreatedMs < threshold) return false
        }

        return true
    }

    /**
     * Computes next state transition for a backup item.
     * - Trashed files on the server are excluded from serverExisting, so if status was UPLOADED
     *   in the past, matching hashes from MediaStore are still kept UPLOADED in Room only if
     *   not re-queued, while any PENDING/FAILED item checked against server uses active-only truth.
     */
    fun nextStateAfterServerCheck(
        previousStatus: String?,
        sha256: String,
        serverExistingHashes: Set<String>
    ): String {
        if (sha256 in serverExistingHashes) {
            return BackupItemStatus.SKIPPED
        }
        if (previousStatus == BackupItemStatus.UPLOADED) {
            return BackupItemStatus.UPLOADED
        }
        return BackupItemStatus.PENDING
    }

    fun shouldUseChunkedUpload(sizeBytes: Long): Boolean {
        return sizeBytes > CHUNKED_UPLOAD_THRESHOLD_BYTES
    }

    fun isRetryableHttpCode(code: Int): Boolean {
        return code == 408 || code == 429 || code in 500..599
    }

    /**
     * Exponential backoff helper in seconds for transient worker retries (capped at 1 hour).
     */
    fun computeBackoffDelaySeconds(attemptCount: Int): Long {
        val exp = attemptCount.coerceIn(0, 8)
        val raw = 15L * (1L shl exp)
        return raw.coerceAtMost(3600L)
    }

    /**
     * Given a list of (key, sizeBytes, lastModifiedMs), returns the keys to evict oldest-first
     * so total remaining bytes stays <= [maxBytes].
     */
    fun planLruEvictions(
        entries: List<Triple<String, Long, Long>>,
        maxBytes: Long
    ): List<String> {
        var total = entries.sumOf { it.second.coerceAtLeast(0L) }
        if (total <= maxBytes) return emptyList()
        val toDelete = ArrayList<String>()
        for ((key, size, _) in entries.sortedBy { it.third }) {
            if (total <= maxBytes) break
            toDelete.add(key)
            total -= size.coerceAtLeast(0L)
        }
        return toDelete
    }
}
