package com.valerio.photocloud.zk

import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.content.BroadcastReceiver
import android.content.ContentUris
import android.content.Context
import android.content.Intent
import android.content.pm.ServiceInfo
import android.net.Uri
import android.os.Build
import android.provider.MediaStore
import androidx.core.app.NotificationCompat
import androidx.work.BackoffPolicy
import androidx.work.Constraints
import androidx.work.CoroutineWorker
import androidx.work.ExistingPeriodicWorkPolicy
import androidx.work.ExistingWorkPolicy
import androidx.work.ForegroundInfo
import androidx.work.NetworkType
import androidx.work.OneTimeWorkRequestBuilder
import androidx.work.PeriodicWorkRequestBuilder
import androidx.work.WorkManager
import androidx.work.WorkerParameters
import com.valerio.photocloud.AutoBackupConfig
import com.valerio.photocloud.AutoBackupLogic
import com.valerio.photocloud.BackupLibraryMode
import com.valerio.photocloud.BackupMediaScope
import com.valerio.photocloud.BuildConfig
import com.valerio.photocloud.MediaBackupCandidate
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import java.io.File
import java.util.concurrent.TimeUnit

/**
 * Zero-Knowledge v2 Auto-Backup configuration (persisted strictly in v2 prefs, isolated from v1).
 * `includeGps` defaults to `false` (GPS coordinates are stripped unless explicitly enabled).
 */
data class ZkAutoBackupConfig(
    val enabled: Boolean = false,
    val paused: Boolean = false,
    val selectedBuckets: Set<String> = setOf("Camera"),
    val mediaScope: BackupMediaScope = BackupMediaScope.BOTH,
    val wifiOnly: Boolean = true,
    val chargingOnly: Boolean = false,
    val respectBatterySaver: Boolean = true,
    val libraryMode: BackupLibraryMode = BackupLibraryMode.NEW_ONLY,
    val activatedAtMs: Long = 0L,
    val maxVideoSizeMb: Int = 0,
    val includeGps: Boolean = false,
    val parallelism: Int = ZkTransferManager.DEFAULT_PARALLELISM
) {
    fun toLegacyFilterConfig(): AutoBackupConfig {
        return AutoBackupConfig(
            enabled = enabled,
            paused = paused,
            selectedBuckets = selectedBuckets,
            mediaScope = mediaScope,
            wifiOnly = wifiOnly,
            chargingOnly = chargingOnly,
            respectBatterySaver = respectBatterySaver,
            libraryMode = libraryMode,
            activatedAtMs = activatedAtMs,
            maxVideoSizeMb = maxVideoSizeMb
        )
    }
}

data class ZkAutoBackupCandidateItem(
    val candidate: MediaBackupCandidate,
    val source: ZkPlaintextSource
)

fun interface ZkAutoBackupCandidateProvider {
    suspend fun scanCandidates(config: ZkAutoBackupConfig): List<ZkAutoBackupCandidateItem>
}

interface ZkAutoBackupNotifier {
    fun onProgress(done: Int, total: Int, currentLabel: String)
    fun notifyDeviceLocked()
    fun notifyQuotaExceeded(message: String)
    fun notifySessionExpired(message: String)
    fun notifyIntegrityMismatch(message: String)
}

object NoOpZkAutoBackupNotifier : ZkAutoBackupNotifier {
    override fun onProgress(done: Int, total: Int, currentLabel: String) = Unit
    override fun notifyDeviceLocked() = Unit
    override fun notifyQuotaExceeded(message: String) = Unit
    override fun notifySessionExpired(message: String) = Unit
    override fun notifyIntegrityMismatch(message: String) = Unit
}

data class ZkAutoBackupRunSummary(
    val scannedCount: Int,
    val eligibleCount: Int,
    val uploadedCount: Int,
    val skippedDuplicateCount: Int,
    val failedCount: Int,
    val retryRecommended: Boolean,
    val stopReason: ZkUploadFailureKind? = null
)

/**
 * Pure Kotlin Zero-Knowledge Auto-Backup execution engine (FASE 4C).
 *
 * Security invariants:
 * - Unwraps `VK` ONLY via [VaultKeyStore.unwrapForBackground] (`photocloud_vk_bg_v2` with
 *   `setUnlockedDeviceRequired(true)`).
 * - On [VaultKeyStore.DeviceLockedException], emits explicit notification and requests `Result.retry()`.
 * - Zeroizes `VK` and ALL derived subkeys in `finally` regardless of success or exception.
 * - Distinguishes `413` (quota), `401` (unauth), `422` (ciphertext integrity), and transient network failures.
 */
class ZkAutoBackupEngine(
    private val vaultKeyStore: VaultKeyStore,
    private val pipeline: ZkBlobUploadPipeline,
    private val candidateProvider: ZkAutoBackupCandidateProvider,
    private val notifier: ZkAutoBackupNotifier = NoOpZkAutoBackupNotifier,
    private val cryptoProvider: ZkCryptoProvider = JvmCryptoProvider
) {
    suspend fun runOnce(
        config: ZkAutoBackupConfig,
        control: ZkUploadControl = ZkUploadControl()
    ): ZkAutoBackupRunSummary {
        if (!config.enabled || config.paused) {
            return ZkAutoBackupRunSummary(0, 0, 0, 0, 0, retryRecommended = false)
        }

        val allCandidates = candidateProvider.scanCandidates(config)
        val filterConfig = config.toLegacyFilterConfig()
        val eligible = allCandidates.filter { AutoBackupLogic.shouldIncludeCandidate(it.candidate, filterConfig) }
        if (eligible.isEmpty()) {
            return ZkAutoBackupRunSummary(
                scannedCount = allCandidates.size,
                eligibleCount = 0,
                uploadedCount = 0,
                skippedDuplicateCount = 0,
                failedCount = 0,
                retryRecommended = false
            )
        }

        val vk: ByteArray = try {
            vaultKeyStore.unwrapForBackground()
        } catch (_: VaultKeyStore.DeviceLockedException) {
            notifier.notifyDeviceLocked()
            return ZkAutoBackupRunSummary(
                scannedCount = allCandidates.size,
                eligibleCount = eligible.size,
                uploadedCount = 0,
                skippedDuplicateCount = 0,
                failedCount = 0,
                retryRecommended = true,
                stopReason = ZkUploadFailureKind.DEVICE_LOCKED
            )
        } catch (e: VaultKeyStore.KeyInvalidatedException) {
            notifier.notifySessionExpired(e.message ?: "Chiave background invalidata.")
            return ZkAutoBackupRunSummary(
                scannedCount = allCandidates.size,
                eligibleCount = eligible.size,
                uploadedCount = 0,
                skippedDuplicateCount = 0,
                failedCount = 0,
                retryRecommended = false,
                stopReason = ZkUploadFailureKind.UNAUTHORIZED
            )
        } catch (t: Throwable) {
            notifier.notifySessionExpired(t.message ?: "Chiave background non configurata.")
            return ZkAutoBackupRunSummary(
                scannedCount = allCandidates.size,
                eligibleCount = eligible.size,
                uploadedCount = 0,
                skippedDuplicateCount = 0,
                failedCount = 0,
                retryRecommended = false,
                stopReason = ZkUploadFailureKind.UNAUTHORIZED
            )
        }

        val subkeys = try {
            ZkCoreCrypto.deriveSubkeys(vk, cryptoProvider)
        } finally {
            vk.zeroize()
        }

        var uploaded = 0
        var skipped = 0
        var failed = 0
        var retryRecommended = false
        var stopReason: ZkUploadFailureKind? = null

        try {
            for ((index, item) in eligible.withIndex()) {
                if (control.isCancelled || control.isPaused) break
                notifier.onProgress(index, eligible.size, item.candidate.displayName)

                when (
                    val outcome = pipeline.upload(
                        source = item.source,
                        subkeys = subkeys,
                        includeGps = config.includeGps,
                        checkDedupBeforeUpload = true,
                        control = control,
                        returnImmediatelyOnPause = true
                    )
                ) {
                    is ZkUploadOutcome.Uploaded -> uploaded++
                    is ZkUploadOutcome.SkippedDuplicate -> skipped++
                    is ZkUploadOutcome.Paused -> break
                    ZkUploadOutcome.Cancelled -> break
                    is ZkUploadOutcome.Failed -> {
                        when (outcome.kind) {
                            ZkUploadFailureKind.DEVICE_LOCKED -> {
                                notifier.notifyDeviceLocked()
                                retryRecommended = true
                                stopReason = ZkUploadFailureKind.DEVICE_LOCKED
                                break
                            }
                            ZkUploadFailureKind.QUOTA_EXCEEDED -> {
                                notifier.notifyQuotaExceeded(outcome.message)
                                failed++
                                retryRecommended = false
                                stopReason = ZkUploadFailureKind.QUOTA_EXCEEDED
                                break
                            }
                            ZkUploadFailureKind.UNAUTHORIZED -> {
                                notifier.notifySessionExpired(outcome.message)
                                failed++
                                retryRecommended = false
                                stopReason = ZkUploadFailureKind.UNAUTHORIZED
                                break
                            }
                            ZkUploadFailureKind.INTEGRITY_MISMATCH -> {
                                notifier.notifyIntegrityMismatch(outcome.message)
                                failed++
                                stopReason = ZkUploadFailureKind.INTEGRITY_MISMATCH
                            }
                            ZkUploadFailureKind.RETRYABLE_NETWORK -> {
                                failed++
                                retryRecommended = true
                                stopReason = ZkUploadFailureKind.RETRYABLE_NETWORK
                            }
                            ZkUploadFailureKind.PERMANENT_ERROR -> {
                                failed++
                            }
                        }
                    }
                }
            }
        } finally {
            subkeys.zeroizeAll()
        }

        return ZkAutoBackupRunSummary(
            scannedCount = allCandidates.size,
            eligibleCount = eligible.size,
            uploadedCount = uploaded,
            skippedDuplicateCount = skipped,
            failedCount = failed,
            retryRecommended = retryRecommended,
            stopReason = stopReason
        )
    }
}

object ZkAutoBackupPrefs {
    private const val PREFS_NAME = "photocloud_v2_autobackup"

    fun load(context: Context): ZkAutoBackupConfig {
        val p = context.applicationContext.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE)
        val buckets = p.getStringSet("buckets", setOf("Camera"))?.toSet() ?: setOf("Camera")
        return ZkAutoBackupConfig(
            enabled = p.getBoolean("enabled", false),
            paused = p.getBoolean("paused", false),
            selectedBuckets = buckets,
            mediaScope = BackupMediaScope.fromKey(p.getString("media_scope", BackupMediaScope.BOTH.storageKey)),
            wifiOnly = p.getBoolean("wifi_only", true),
            chargingOnly = p.getBoolean("charging_only", false),
            respectBatterySaver = p.getBoolean("respect_battery_saver", true),
            libraryMode = BackupLibraryMode.fromKey(p.getString("library_mode", BackupLibraryMode.NEW_ONLY.storageKey)),
            activatedAtMs = p.getLong("activated_at_ms", 0L),
            maxVideoSizeMb = p.getInt("max_video_size_mb", 0),
            includeGps = p.getBoolean("include_gps", false),
            parallelism = ZkTransferManager.clampParallelism(
                p.getInt("parallelism", ZkTransferManager.DEFAULT_PARALLELISM)
            )
        )
    }

    fun save(context: Context, config: ZkAutoBackupConfig) {
        val p = context.applicationContext.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE)
        p.edit()
            .putBoolean("enabled", config.enabled)
            .putBoolean("paused", config.paused)
            .putStringSet("buckets", config.selectedBuckets)
            .putString("media_scope", config.mediaScope.storageKey)
            .putBoolean("wifi_only", config.wifiOnly)
            .putBoolean("charging_only", config.chargingOnly)
            .putBoolean("respect_battery_saver", config.respectBatterySaver)
            .putString("library_mode", config.libraryMode.storageKey)
            .putLong("activated_at_ms", config.activatedAtMs)
            .putInt("max_video_size_mb", config.maxVideoSizeMb)
            .putBoolean("include_gps", config.includeGps)
            .putInt("parallelism", ZkTransferManager.clampParallelism(config.parallelism))
            .apply()
    }

    fun setPaused(context: Context, paused: Boolean) {
        val current = load(context)
        save(context, current.copy(paused = paused))
    }
}

/**
 * BroadcastReceiver handling Pause / Cancel actions from the `ZkAutoBackupWorker` foreground notification.
 */
class ZkAutoBackupActionReceiver : BroadcastReceiver() {
    companion object {
        const val ACTION_PAUSE_V2_BACKUP = "com.valerio.photocloud.zk.ACTION_PAUSE_V2_BACKUP"
        const val ACTION_CANCEL_V2_BACKUP = "com.valerio.photocloud.zk.ACTION_CANCEL_V2_BACKUP"
    }

    override fun onReceive(context: Context, intent: Intent?) {
        when (intent?.action) {
            ACTION_PAUSE_V2_BACKUP -> {
                ZkAutoBackupPrefs.setPaused(context, true)
                ZkAutoBackupWorker.activeControl?.pause()
                ZkAutoBackupWorker.cancelRunningWork(context)
            }
            ACTION_CANCEL_V2_BACKUP -> {
                ZkAutoBackupPrefs.setPaused(context, true)
                ZkAutoBackupWorker.activeControl?.cancel()
                ZkAutoBackupWorker.cancelAllWork(context)
            }
        }
    }
}

/**
 * WorkManager foreground worker (`dataSync`) executing Zero-Knowledge v2 Auto-Backup.
 *
 * Strictly isolated from v1 `AutoBackupWorker`: returns immediately if `zk_v2_enabled == false`.
 */
class ZkAutoBackupWorker(
    appContext: Context,
    params: WorkerParameters
) : CoroutineWorker(appContext, params) {

    companion object {
        const val WORK_NAME_PERIODIC = "photocloud_zk_v2_autobackup_periodic"
        const val WORK_NAME_TRIGGER = "photocloud_zk_v2_autobackup_trigger"
        const val WORK_NAME_IMMEDIATE = "photocloud_zk_v2_autobackup_immediate"
        const val CHANNEL_ID = "photocloud_v2_autobackup"
        const val NOTIFICATION_ID_PROGRESS = 4201
        const val NOTIFICATION_ID_ALERT = 4202

        @Volatile
        internal var activeControl: ZkUploadControl? = null

        fun syncScheduleFromPrefs(context: Context) {
            val appCtx = context.applicationContext
            val mainPrefs = appCtx.getSharedPreferences("photocloud_prefs", Context.MODE_PRIVATE)
            val zkV2Enabled = mainPrefs.getBoolean("zk_v2_enabled", false)
            val config = ZkAutoBackupPrefs.load(appCtx)
            val wm = WorkManager.getInstance(appCtx)

            if (!zkV2Enabled || !config.enabled || config.paused) {
                cancelAllWork(appCtx)
                return
            }

            val baseConstraints = Constraints.Builder()
                .setRequiredNetworkType(if (config.wifiOnly) NetworkType.UNMETERED else NetworkType.CONNECTED)
                .setRequiresCharging(config.chargingOnly)
                .setRequiresBatteryNotLow(config.respectBatterySaver)
                .build()

            val periodicReq = PeriodicWorkRequestBuilder<ZkAutoBackupWorker>(15, TimeUnit.MINUTES)
                .setConstraints(baseConstraints)
                .setBackoffCriteria(BackoffPolicy.EXPONENTIAL, 30, TimeUnit.SECONDS)
                .build()
            wm.enqueueUniquePeriodicWork(WORK_NAME_PERIODIC, ExistingPeriodicWorkPolicy.UPDATE, periodicReq)

            val triggerConstraints = Constraints.Builder()
                .setRequiredNetworkType(if (config.wifiOnly) NetworkType.UNMETERED else NetworkType.CONNECTED)
                .setRequiresCharging(config.chargingOnly)
                .setRequiresBatteryNotLow(config.respectBatterySaver)
                .addContentUriTrigger(MediaStore.Images.Media.EXTERNAL_CONTENT_URI, true)
                .addContentUriTrigger(MediaStore.Video.Media.EXTERNAL_CONTENT_URI, true)
                .setTriggerContentUpdateDelay(5, TimeUnit.SECONDS)
                .setTriggerContentMaxDelay(60, TimeUnit.SECONDS)
                .build()
            val triggerReq = OneTimeWorkRequestBuilder<ZkAutoBackupWorker>()
                .setConstraints(triggerConstraints)
                .setBackoffCriteria(BackoffPolicy.EXPONENTIAL, 30, TimeUnit.SECONDS)
                .build()
            wm.enqueueUniqueWork(WORK_NAME_TRIGGER, ExistingWorkPolicy.REPLACE, triggerReq)
        }

        fun enqueueImmediate(context: Context) {
            val appCtx = context.applicationContext
            val mainPrefs = appCtx.getSharedPreferences("photocloud_prefs", Context.MODE_PRIVATE)
            if (!mainPrefs.getBoolean("zk_v2_enabled", false)) return
            val req = OneTimeWorkRequestBuilder<ZkAutoBackupWorker>()
                .setBackoffCriteria(BackoffPolicy.EXPONENTIAL, 30, TimeUnit.SECONDS)
                .build()
            WorkManager.getInstance(appCtx).enqueueUniqueWork(
                WORK_NAME_IMMEDIATE,
                ExistingWorkPolicy.REPLACE,
                req
            )
        }

        fun cancelRunningWork(context: Context) {
            val wm = WorkManager.getInstance(context.applicationContext)
            wm.cancelUniqueWork(WORK_NAME_IMMEDIATE)
            wm.cancelUniqueWork(WORK_NAME_TRIGGER)
        }

        fun cancelAllWork(context: Context) {
            val wm = WorkManager.getInstance(context.applicationContext)
            wm.cancelUniqueWork(WORK_NAME_PERIODIC)
            wm.cancelUniqueWork(WORK_NAME_TRIGGER)
            wm.cancelUniqueWork(WORK_NAME_IMMEDIATE)
        }
    }

    override suspend fun doWork(): Result = withContext(Dispatchers.IO) {
        val mainPrefs = applicationContext.getSharedPreferences("photocloud_prefs", Context.MODE_PRIVATE)
        if (!mainPrefs.getBoolean("zk_v2_enabled", false)) {
            return@withContext Result.success()
        }
        val config = ZkAutoBackupPrefs.load(applicationContext)
        if (!config.enabled || config.paused) {
            return@withContext Result.success()
        }

        val serverUrl = mainPrefs.getString("server_url", "").orEmpty().trim()
        if (serverUrl.isBlank()) {
            return@withContext Result.success()
        }

        ensureNotificationChannel()
        try {
            setForeground(buildForegroundInfo(0, 0, "Scansione libreria cifrata..."))
        } catch (_: Throwable) {
        }

        val allowLoopback = BuildConfig.DEBUG
        val apiClient = PhotoCloudZkApiClientV2(
            initialBaseUrl = serverUrl,
            pinStore = PrefsTofuSpkiPinStore(applicationContext),
            allowLocalhostHttpForTests = allowLoopback,
            cookieJar = ZkV2CookieJar(allowLocalhostHttpForTests = allowLoopback)
        )
        val keyStore = AndroidHardwareVaultKeyStore(applicationContext)
        val spoolDir = File(applicationContext.cacheDir, "zk_upload_spool")
        val resumableStore = PrefsResumableUploadStore(applicationContext)
        val activeSpools = resumableStore.listAll().map { it.spoolFileName }.toSet()
        ZkBlobUploadPipeline.cleanupOrphanSpoolFiles(spoolDir, activeSpools)

        val pipeline = ZkBlobUploadPipeline(
            apiClient = apiClient,
            spoolDir = spoolDir,
            resumableStore = resumableStore,
            fkProtector = BackgroundKeyStoreFkProtector(keyStore),
            thumbnailGenerator = AndroidZkThumbnailGenerator(applicationContext)
        )

        val notifier = object : ZkAutoBackupNotifier {
            override fun onProgress(done: Int, total: Int, currentLabel: String) {
                try {
                    val nm = applicationContext.getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager
                    nm.notify(NOTIFICATION_ID_PROGRESS, buildProgressNotification(done, total, currentLabel))
                } catch (_: Throwable) {
                }
            }

            override fun notifyDeviceLocked() {
                postAlertNotification(
                    "Backup Zero-Knowledge in attesa",
                    "Sblocca il dispositivo per consentire alla chiave AndroidKeyStore di cifrare e caricare i nuovi media."
                )
            }

            override fun notifyQuotaExceeded(message: String) {
                postAlertNotification("Spazio esaurito sul server (413)", message)
            }

            override fun notifySessionExpired(message: String) {
                postAlertNotification("Sessione v2 scaduta", "Apri PhotoCloud e sblocca il Vault per riprendere il backup.")
            }

            override fun notifyIntegrityMismatch(message: String) {
                postAlertNotification("Errore integrità ciphertext (422)", message)
            }
        }

        val control = ZkUploadControl()
        activeControl = control
        val engine = ZkAutoBackupEngine(
            vaultKeyStore = keyStore,
            pipeline = pipeline,
            candidateProvider = ZkAutoBackupCandidateProvider { cfg -> scanDeviceMediaStore(cfg) },
            notifier = notifier
        )

        val summary = try {
            engine.runOnce(config, control)
        } finally {
            if (activeControl === control) {
                activeControl = null
            }
        }

        // Re-arm ContentUriTrigger for future photos/videos when still enabled
        if (config.enabled && !config.paused && summary.stopReason != ZkUploadFailureKind.QUOTA_EXCEEDED) {
            syncScheduleFromPrefs(applicationContext)
        }

        if (summary.retryRecommended) Result.retry() else Result.success()
    }

    private fun scanDeviceMediaStore(config: ZkAutoBackupConfig): List<ZkAutoBackupCandidateItem> {
        val out = ArrayList<ZkAutoBackupCandidateItem>()
        if (config.mediaScope == BackupMediaScope.PHOTO || config.mediaScope == BackupMediaScope.BOTH) {
            queryMediaCollection(
                collection = MediaStore.Images.Media.EXTERNAL_CONTENT_URI,
                isVideo = false,
                out = out
            )
        }
        if (config.mediaScope == BackupMediaScope.VIDEO || config.mediaScope == BackupMediaScope.BOTH) {
            queryMediaCollection(
                collection = MediaStore.Video.Media.EXTERNAL_CONTENT_URI,
                isVideo = true,
                out = out
            )
        }
        return out
    }

    private fun queryMediaCollection(
        collection: Uri,
        isVideo: Boolean,
        out: MutableList<ZkAutoBackupCandidateItem>
    ) {
        val projection = arrayOf(
            MediaStore.MediaColumns._ID,
            MediaStore.MediaColumns.DISPLAY_NAME,
            MediaStore.MediaColumns.BUCKET_DISPLAY_NAME,
            MediaStore.MediaColumns.MIME_TYPE,
            MediaStore.MediaColumns.SIZE,
            MediaStore.MediaColumns.DATE_TAKEN,
            MediaStore.MediaColumns.DATE_ADDED
        )
        try {
            applicationContext.contentResolver.query(
                collection,
                projection,
                null,
                null,
                "${MediaStore.MediaColumns.DATE_ADDED} DESC"
            )?.use { c ->
                val idCol = c.getColumnIndexOrThrow(MediaStore.MediaColumns._ID)
                val nameCol = c.getColumnIndex(MediaStore.MediaColumns.DISPLAY_NAME)
                val bucketCol = c.getColumnIndex(MediaStore.MediaColumns.BUCKET_DISPLAY_NAME)
                val mimeCol = c.getColumnIndex(MediaStore.MediaColumns.MIME_TYPE)
                val sizeCol = c.getColumnIndex(MediaStore.MediaColumns.SIZE)
                val takenCol = c.getColumnIndex(MediaStore.MediaColumns.DATE_TAKEN)
                val addedCol = c.getColumnIndex(MediaStore.MediaColumns.DATE_ADDED)

                var count = 0
                while (c.moveToNext() && count < 500) {
                    val id = c.getLong(idCol)
                    val uri = ContentUris.withAppendedId(collection, id)
                    val name = if (nameCol >= 0) c.getString(nameCol) ?: "media_$id" else "media_$id"
                    val bucket = if (bucketCol >= 0) c.getString(bucketCol) ?: "" else ""
                    val mime = if (mimeCol >= 0) c.getString(mimeCol) ?: if (isVideo) "video/mp4" else "image/jpeg"
                    else if (isVideo) "video/mp4" else "image/jpeg"
                    val size = if (sizeCol >= 0) c.getLong(sizeCol) else 0L
                    val taken = if (takenCol >= 0) c.getLong(takenCol) else 0L
                    val addedSec = if (addedCol >= 0) c.getLong(addedCol) else 0L
                    val addedMs = if (addedSec > 10_000_000_000L) addedSec else addedSec * 1000L

                    val candidate = MediaBackupCandidate(
                        mediaStoreId = id,
                        uriString = uri.toString(),
                        displayName = name,
                        bucketName = bucket,
                        mimeType = mime,
                        isVideo = isVideo,
                        sizeBytes = size,
                        dateTakenMs = taken,
                        dateAddedMs = addedMs
                    )
                    val source = AndroidUriPlaintextSource(
                        context = applicationContext,
                        uri = uri,
                        sourceKey = uri.toString(),
                        fallbackName = name,
                        fallbackMime = mime,
                        fallbackSizeBytes = size,
                        fallbackTakenAtMs = if (taken > 0L) taken else addedMs
                    )
                    out.add(ZkAutoBackupCandidateItem(candidate, source))
                    count++
                }
            }
        } catch (_: Throwable) {
        }
    }

    private fun ensureNotificationChannel() {
        val nm = applicationContext.getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager
        val channel = NotificationChannel(
            CHANNEL_ID,
            "Backup Zero-Knowledge v2",
            NotificationManager.IMPORTANCE_LOW
        )
        nm.createNotificationChannel(channel)
    }

    private fun buildProgressNotification(done: Int, total: Int, detail: String): Notification {
        val pauseIntent = Intent(applicationContext, ZkAutoBackupActionReceiver::class.java).apply {
            action = ZkAutoBackupActionReceiver.ACTION_PAUSE_V2_BACKUP
        }
        val cancelIntent = Intent(applicationContext, ZkAutoBackupActionReceiver::class.java).apply {
            action = ZkAutoBackupActionReceiver.ACTION_CANCEL_V2_BACKUP
        }
        val flags = PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE
        val pausePi = PendingIntent.getBroadcast(applicationContext, 421, pauseIntent, flags)
        val cancelPi = PendingIntent.getBroadcast(applicationContext, 422, cancelIntent, flags)

        val builder = NotificationCompat.Builder(applicationContext, CHANNEL_ID)
            .setSmallIcon(android.R.drawable.stat_sys_upload)
            .setContentTitle("PhotoCloud Backup Cifrato v2")
            .setContentText(if (total > 0) "$done / $total • $detail" else detail)
            .setOngoing(true)
            .setOnlyAlertOnce(true)
            .addAction(0, "Pausa", pausePi)
            .addAction(0, "Annulla", cancelPi)
        if (total > 0) {
            builder.setProgress(total, done, false)
        } else {
            builder.setProgress(0, 0, true)
        }
        return builder.build()
    }

    private fun buildForegroundInfo(done: Int, total: Int, detail: String): ForegroundInfo {
        val notification = buildProgressNotification(done, total, detail)
        return if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
            ForegroundInfo(
                NOTIFICATION_ID_PROGRESS,
                notification,
                ServiceInfo.FOREGROUND_SERVICE_TYPE_DATA_SYNC
            )
        } else {
            ForegroundInfo(NOTIFICATION_ID_PROGRESS, notification)
        }
    }

    private fun postAlertNotification(title: String, body: String) {
        try {
            val nm = applicationContext.getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager
            val n = NotificationCompat.Builder(applicationContext, CHANNEL_ID)
                .setSmallIcon(android.R.drawable.stat_notify_error)
                .setContentTitle(title)
                .setContentText(body)
                .setStyle(NotificationCompat.BigTextStyle().bigText(body))
                .setAutoCancel(true)
                .build()
            nm.notify(NOTIFICATION_ID_ALERT, n)
        } catch (_: Throwable) {
        }
    }
}
