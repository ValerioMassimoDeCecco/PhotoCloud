package com.valerio.photocloud

import android.Manifest
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.content.pm.ServiceInfo
import android.net.Uri
import android.os.Build
import android.os.PowerManager
import android.provider.MediaStore
import android.util.Log
import androidx.core.app.NotificationCompat
import androidx.core.content.ContextCompat
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
import androidx.work.workDataOf
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import java.util.concurrent.TimeUnit

class AutoBackupActionReceiver : BroadcastReceiver() {
    override fun onReceive(context: Context, intent: Intent?) {
        val action = intent?.action ?: return
        val prefs = context.getSharedPreferences("photocloud_prefs", Context.MODE_PRIVATE)
        when (action) {
            AutoBackupWorker.ACTION_PAUSE_BACKUP -> {
                prefs.edit().putBoolean("auto_backup_paused", true).apply()
                WorkManager.getInstance(context.applicationContext).cancelUniqueWork(AutoBackupWorker.UNIQUE_IMMEDIATE_WORK)
                WorkManager.getInstance(context.applicationContext).cancelUniqueWork(AutoBackupWorker.UNIQUE_TRIGGER_WORK)
                AutoBackupWorker.dismissProgressNotification(context)
            }
            AutoBackupWorker.ACTION_CANCEL_BACKUP -> {
                prefs.edit()
                    .putBoolean("auto_backup_enabled", false)
                    .putBoolean("auto_backup_paused", false)
                    .apply()
                AutoBackupWorker.cancelAllBackupWork(context)
                AutoBackupWorker.dismissProgressNotification(context)
            }
        }
    }
}

class AutoBackupWorker(
    appContext: Context,
    workerParams: WorkerParameters
) : CoroutineWorker(appContext, workerParams) {

    override suspend fun doWork(): Result = withContext(Dispatchers.IO) {
        val prefs = applicationContext.getSharedPreferences("photocloud_prefs", Context.MODE_PRIVATE)
        val serverUrl = prefs.getString("server_url", BuildConfig.DEFAULT_SERVER_URL)
            ?: BuildConfig.DEFAULT_SERVER_URL
        val apiClient = PhotoCloudApiClient(applicationContext, serverUrl)
        val config = apiClient.getAutoBackupConfig()

        if (!config.enabled || config.paused) {
            return@withContext Result.success(workDataOf(KEY_UPLOADED to 0, KEY_TOTAL to 0))
        }

        if (!apiClient.hasActiveSessionCookie()) {
            return@withContext Result.success(workDataOf(KEY_UPLOADED to 0, KEY_TOTAL to 0))
        }

        if (config.respectBatterySaver) {
            val pm = applicationContext.getSystemService(Context.POWER_SERVICE) as? PowerManager
            if (pm?.isPowerSaveMode == true) {
                return@withContext Result.retry()
            }
        }

        if (!hasAnyMediaReadPermission(applicationContext, config.mediaScope)) {
            return@withContext Result.success(workDataOf(KEY_UPLOADED to 0, KEY_TOTAL to 0))
        }

        val db = PhotoAiDatabase.getInstance(applicationContext)
        val backupDao = db.backupStateDao()
        if (inputData.getBoolean(KEY_RETRY_FAILED, false)) {
            backupDao.resetRetryableStates()
        }

        ensureNotificationChannel(applicationContext)
        promoteForegroundSafe("Analisi camera roll in corso...", 0, 0)

        try {
            val candidates = apiClient.scanMediaStoreBackupCandidates(config)
            if (candidates.isEmpty()) {
                return@withContext Result.success(workDataOf(KEY_UPLOADED to 0, KEY_TOTAL to 0))
            }

            val existingMap = backupDao.getAll().associateBy { it.mediaStoreId }
            val toCheckWithServer = ArrayList<Pair<MediaBackupCandidate, String>>()

            for (cand in candidates) {
                if (isStopped || apiClient.getAutoBackupConfig().let { !it.enabled || it.paused }) {
                    return@withContext Result.success()
                }
                val prev = existingMap[cand.mediaStoreId]
                if (prev != null && prev.sizeBytes == cand.sizeBytes &&
                    (prev.status == BackupItemStatus.UPLOADED || prev.status == BackupItemStatus.SKIPPED)
                ) {
                    continue
                }

                val sha = if (prev != null && prev.sizeBytes == cand.sizeBytes && prev.sha256.length == 64) {
                    prev.sha256
                } else {
                    apiClient.computeUriSha256(Uri.parse(cand.uriString))
                } ?: continue

                toCheckWithServer.add(cand to sha)
            }

            if (toCheckWithServer.isEmpty()) {
                if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.N) {
                    scheduleContentTriggerIfEnabled(applicationContext, config)
                }
                return@withContext Result.success(workDataOf(KEY_UPLOADED to 0, KEY_TOTAL to 0))
            }

            val checkResult = apiClient.checkBackupHashes(
                toCheckWithServer.map { (cand, sha) -> sha to cand.sizeBytes }
            )
            if (checkResult == null) {
                // Server unreachable or auth expired; retry later without marking items failed
                return@withContext Result.retry()
            }

            val (existingHashes, serverMaxUploadMb) = checkResult
            val pendingToUpload = ArrayList<Pair<MediaBackupCandidate, String>>()
            val skippedEntities = ArrayList<BackupStateEntity>()

            for ((cand, sha) in toCheckWithServer) {
                val prev = existingMap[cand.mediaStoreId]
                val nextStatus = AutoBackupLogic.nextStateAfterServerCheck(
                    previousStatus = prev?.status,
                    sha256 = sha,
                    serverExistingHashes = existingHashes
                )
                if (nextStatus == BackupItemStatus.SKIPPED) {
                    skippedEntities.add(
                        BackupStateEntity(
                            mediaStoreId = cand.mediaStoreId,
                            uriString = cand.uriString,
                            displayName = cand.displayName,
                            bucketName = cand.bucketName,
                            mimeType = cand.mimeType,
                            isVideo = cand.isVideo,
                            sizeBytes = cand.sizeBytes,
                            dateTakenMs = cand.dateTakenMs,
                            sha256 = sha,
                            status = BackupItemStatus.SKIPPED,
                            attemptCount = prev?.attemptCount ?: 0,
                            lastError = "",
                            serverFilename = prev?.serverFilename ?: "",
                            updatedAtMs = System.currentTimeMillis()
                        )
                    )
                } else {
                    pendingToUpload.add(cand to sha)
                }
            }

            if (skippedEntities.isNotEmpty()) {
                skippedEntities.chunked(200).forEach { backupDao.upsertAll(it) }
            }

            if (pendingToUpload.isEmpty()) {
                if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.N) {
                    scheduleContentTriggerIfEnabled(applicationContext, config)
                }
                return@withContext Result.success(workDataOf(KEY_UPLOADED to 0, KEY_TOTAL to 0))
            }

            var uploadedCount = 0
            var hasRetryableFailure = false
            val totalPending = pendingToUpload.size

            for ((idx, pair) in pendingToUpload.withIndex()) {
                val liveConfig = apiClient.getAutoBackupConfig()
                if (isStopped || !liveConfig.enabled || liveConfig.paused) {
                    break
                }
                val (cand, sha) = pair
                val prev = existingMap[cand.mediaStoreId]
                val attempt = (prev?.attemptCount ?: 0) + 1

                promoteForegroundSafe(
                    "Backup ${idx + 1}/$totalPending: ${cand.displayName}",
                    idx,
                    totalPending
                )
                setProgress(workDataOf(KEY_UPLOADED to uploadedCount, KEY_TOTAL to totalPending))

                backupDao.upsert(
                    BackupStateEntity(
                        mediaStoreId = cand.mediaStoreId,
                        uriString = cand.uriString,
                        displayName = cand.displayName,
                        bucketName = cand.bucketName,
                        mimeType = cand.mimeType,
                        isVideo = cand.isVideo,
                        sizeBytes = cand.sizeBytes,
                        dateTakenMs = cand.dateTakenMs,
                        sha256 = sha,
                        status = BackupItemStatus.UPLOADING,
                        attemptCount = attempt,
                        lastError = "",
                        serverFilename = "",
                        updatedAtMs = System.currentTimeMillis()
                    )
                )

                val outcome = apiClient.uploadAutoBackupCandidate(
                    candidate = cand,
                    sha256 = sha,
                    serverMaxUploadMb = serverMaxUploadMb
                )

                if (outcome.uploaded) {
                    uploadedCount++
                    backupDao.upsert(
                        BackupStateEntity(
                            mediaStoreId = cand.mediaStoreId,
                            uriString = cand.uriString,
                            displayName = cand.displayName,
                            bucketName = cand.bucketName,
                            mimeType = cand.mimeType,
                            isVideo = cand.isVideo,
                            sizeBytes = cand.sizeBytes,
                            dateTakenMs = cand.dateTakenMs,
                            sha256 = sha,
                            status = BackupItemStatus.UPLOADED,
                            attemptCount = attempt,
                            lastError = "",
                            serverFilename = outcome.serverFilename,
                            updatedAtMs = System.currentTimeMillis()
                        )
                    )
                } else {
                    if (outcome.retryable) {
                        hasRetryableFailure = true
                    }
                    backupDao.upsert(
                        BackupStateEntity(
                            mediaStoreId = cand.mediaStoreId,
                            uriString = cand.uriString,
                            displayName = cand.displayName,
                            bucketName = cand.bucketName,
                            mimeType = cand.mimeType,
                            isVideo = cand.isVideo,
                            sizeBytes = cand.sizeBytes,
                            dateTakenMs = cand.dateTakenMs,
                            sha256 = sha,
                            status = if (outcome.retryable) BackupItemStatus.PENDING else BackupItemStatus.FAILED,
                            attemptCount = attempt,
                            lastError = outcome.errorMessage.take(240),
                            serverFilename = "",
                            updatedAtMs = System.currentTimeMillis()
                        )
                    )
                }
            }

            if (uploadedCount > 0) {
                try {
                    val sync = apiClient.syncGallery()
                    if (sync is GallerySyncResult.Authenticated) {
                        PhotoAiIndexingWorker.enqueueIndexing(applicationContext, forceReindex = false)
                    }
                } catch (_: Exception) {
                }
            }

            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.N) {
                scheduleContentTriggerIfEnabled(applicationContext, apiClient.getAutoBackupConfig())
            }

            setProgress(workDataOf(KEY_UPLOADED to uploadedCount, KEY_TOTAL to totalPending))
            if (hasRetryableFailure && !isStopped) {
                Result.retry()
            } else {
                Result.success(workDataOf(KEY_UPLOADED to uploadedCount, KEY_TOTAL to totalPending))
            }
        } catch (t: Throwable) {
            Log.e(TAG, "AutoBackupWorker failure: ${t.message}", t)
            Result.retry()
        } finally {
            dismissProgressNotification(applicationContext)
        }
    }

    private suspend fun promoteForegroundSafe(text: String, progress: Int, max: Int) {
        try {
            val info = buildForegroundInfo(applicationContext, text, progress, max)
            setForeground(info)
        } catch (_: Throwable) {
            // Android 12+ can restrict FGS launch from certain background triggers; keep working safely
        }
    }

    private fun buildForegroundInfo(
        context: Context,
        contentText: String,
        progress: Int,
        max: Int
    ): ForegroundInfo {
        val pauseIntent = Intent(context, AutoBackupActionReceiver::class.java).apply {
            action = ACTION_PAUSE_BACKUP
        }
        val pausePending = PendingIntent.getBroadcast(
            context,
            101,
            pauseIntent,
            PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE
        )

        val cancelIntent = Intent(context, AutoBackupActionReceiver::class.java).apply {
            action = ACTION_CANCEL_BACKUP
        }
        val cancelPending = PendingIntent.getBroadcast(
            context,
            102,
            cancelIntent,
            PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE
        )

        val notification = NotificationCompat.Builder(context, CHANNEL_ID)
            .setSmallIcon(android.R.drawable.stat_sys_upload)
            .setContentTitle("PhotoCloud Backup automatico")
            .setContentText(contentText)
            .setOngoing(true)
            .setOnlyAlertOnce(true)
            .setSilent(true)
            .setProgress(max.coerceAtLeast(0), progress.coerceAtLeast(0), max <= 0)
            .addAction(android.R.drawable.ic_media_pause, "Pausa", pausePending)
            .addAction(android.R.drawable.ic_menu_close_clear_cancel, "Annulla", cancelPending)
            .build()

        return if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
            ForegroundInfo(
                NOTIFICATION_ID,
                notification,
                ServiceInfo.FOREGROUND_SERVICE_TYPE_DATA_SYNC
            )
        } else {
            ForegroundInfo(NOTIFICATION_ID, notification)
        }
    }

    companion object {
        private const val TAG = "AutoBackupWorker"
        private const val CHANNEL_ID = "photocloud_auto_backup"
        private const val NOTIFICATION_ID = 4401

        const val UNIQUE_PERIODIC_WORK = "photocloud_auto_backup_periodic"
        const val UNIQUE_IMMEDIATE_WORK = "photocloud_auto_backup_immediate"
        const val UNIQUE_TRIGGER_WORK = "photocloud_auto_backup_content_trigger"

        const val KEY_RETRY_FAILED = "retry_failed"
        const val KEY_UPLOADED = "uploaded"
        const val KEY_TOTAL = "total"

        const val ACTION_PAUSE_BACKUP = "com.valerio.photocloud.action.PAUSE_AUTO_BACKUP"
        const val ACTION_CANCEL_BACKUP = "com.valerio.photocloud.action.CANCEL_AUTO_BACKUP"

        fun ensureNotificationChannel(context: Context) {
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
                val nm = context.getSystemService(Context.NOTIFICATION_SERVICE) as? NotificationManager ?: return
                if (nm.getNotificationChannel(CHANNEL_ID) == null) {
                    val channel = NotificationChannel(
                        CHANNEL_ID,
                        "Backup automatico foto/video",
                        NotificationManager.IMPORTANCE_LOW
                    ).apply {
                        description = "Avanzamento del caricamento automatico della galleria su PhotoCloud"
                        setShowBadge(false)
                    }
                    nm.createNotificationChannel(channel)
                }
            }
        }

        fun dismissProgressNotification(context: Context) {
            try {
                val nm = context.getSystemService(Context.NOTIFICATION_SERVICE) as? NotificationManager
                nm?.cancel(NOTIFICATION_ID)
            } catch (_: Exception) {
            }
        }

        fun requiredPermissionsForScope(scope: BackupMediaScope): Array<String> {
            return if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.UPSIDE_DOWN_CAKE) {
                when (scope) {
                    BackupMediaScope.PHOTO -> arrayOf(
                        Manifest.permission.READ_MEDIA_IMAGES,
                        Manifest.permission.READ_MEDIA_VISUAL_USER_SELECTED
                    )
                    BackupMediaScope.VIDEO -> arrayOf(
                        Manifest.permission.READ_MEDIA_VIDEO,
                        Manifest.permission.READ_MEDIA_VISUAL_USER_SELECTED
                    )
                    BackupMediaScope.BOTH -> arrayOf(
                        Manifest.permission.READ_MEDIA_IMAGES,
                        Manifest.permission.READ_MEDIA_VIDEO,
                        Manifest.permission.READ_MEDIA_VISUAL_USER_SELECTED
                    )
                }
            } else if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
                when (scope) {
                    BackupMediaScope.PHOTO -> arrayOf(Manifest.permission.READ_MEDIA_IMAGES)
                    BackupMediaScope.VIDEO -> arrayOf(Manifest.permission.READ_MEDIA_VIDEO)
                    BackupMediaScope.BOTH -> arrayOf(
                        Manifest.permission.READ_MEDIA_IMAGES,
                        Manifest.permission.READ_MEDIA_VIDEO
                    )
                }
            } else {
                arrayOf(Manifest.permission.READ_EXTERNAL_STORAGE)
            }
        }

        fun hasAnyMediaReadPermission(context: Context, scope: BackupMediaScope): Boolean {
            return if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
                val hasImg = ContextCompat.checkSelfPermission(context, Manifest.permission.READ_MEDIA_IMAGES) == PackageManager.PERMISSION_GRANTED
                val hasVid = ContextCompat.checkSelfPermission(context, Manifest.permission.READ_MEDIA_VIDEO) == PackageManager.PERMISSION_GRANTED
                val hasPartial = Build.VERSION.SDK_INT >= Build.VERSION_CODES.UPSIDE_DOWN_CAKE &&
                    ContextCompat.checkSelfPermission(context, Manifest.permission.READ_MEDIA_VISUAL_USER_SELECTED) == PackageManager.PERMISSION_GRANTED
                when (scope) {
                    BackupMediaScope.PHOTO -> hasImg || hasPartial
                    BackupMediaScope.VIDEO -> hasVid || hasPartial
                    BackupMediaScope.BOTH -> hasImg || hasVid || hasPartial
                }
            } else {
                ContextCompat.checkSelfPermission(
                    context,
                    Manifest.permission.READ_EXTERNAL_STORAGE
                ) == PackageManager.PERMISSION_GRANTED
            }
        }

        /**
         * Returns true on Android 14+ when the user granted ONLY limited/selected media access
         * rather than full photo/video access.
         */
        fun isPartialPhotoAccess(context: Context): Boolean {
            if (Build.VERSION.SDK_INT < Build.VERSION_CODES.UPSIDE_DOWN_CAKE) return false
            val hasImg = ContextCompat.checkSelfPermission(context, Manifest.permission.READ_MEDIA_IMAGES) == PackageManager.PERMISSION_GRANTED
            val hasVid = ContextCompat.checkSelfPermission(context, Manifest.permission.READ_MEDIA_VIDEO) == PackageManager.PERMISSION_GRANTED
            val hasSelected = ContextCompat.checkSelfPermission(context, Manifest.permission.READ_MEDIA_VISUAL_USER_SELECTED) == PackageManager.PERMISSION_GRANTED
            return hasSelected && !hasImg && !hasVid
        }

        private fun buildWorkConstraints(config: AutoBackupConfig): Constraints {
            return Constraints.Builder()
                .setRequiredNetworkType(if (config.wifiOnly) NetworkType.UNMETERED else NetworkType.CONNECTED)
                .setRequiresCharging(config.chargingOnly)
                .setRequiresBatteryNotLow(true)
                .build()
        }

        fun syncScheduleFromPrefs(context: Context) {
            val appCtx = context.applicationContext
            val prefs = appCtx.getSharedPreferences("photocloud_prefs", Context.MODE_PRIVATE)
            val serverUrl = prefs.getString("server_url", BuildConfig.DEFAULT_SERVER_URL)
                ?: BuildConfig.DEFAULT_SERVER_URL
            val apiClient = PhotoCloudApiClient(appCtx, serverUrl)
            val config = apiClient.getAutoBackupConfig()

            if (!config.enabled || config.paused || !apiClient.hasActiveSessionCookie()) {
                cancelAllBackupWork(appCtx)
                return
            }

            val constraints = buildWorkConstraints(config)
            val periodic = PeriodicWorkRequestBuilder<AutoBackupWorker>(15, TimeUnit.MINUTES)
                .setConstraints(constraints)
                .setBackoffCriteria(BackoffPolicy.EXPONENTIAL, 30, TimeUnit.SECONDS)
                .addTag(UNIQUE_PERIODIC_WORK)
                .build()

            WorkManager.getInstance(appCtx).enqueueUniquePeriodicWork(
                UNIQUE_PERIODIC_WORK,
                ExistingPeriodicWorkPolicy.UPDATE,
                periodic
            )

            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.N) {
                scheduleContentTriggerIfEnabled(appCtx, config)
            }
        }

        private fun scheduleContentTriggerIfEnabled(context: Context, config: AutoBackupConfig) {
            if (!config.enabled || config.paused) return
            val builder = Constraints.Builder()
                .setRequiredNetworkType(if (config.wifiOnly) NetworkType.UNMETERED else NetworkType.CONNECTED)
                .setRequiresCharging(config.chargingOnly)
                .setRequiresBatteryNotLow(true)

            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.N) {
                if (config.mediaScope != BackupMediaScope.VIDEO) {
                    builder.addContentUriTrigger(MediaStore.Images.Media.EXTERNAL_CONTENT_URI, true)
                }
                if (config.mediaScope != BackupMediaScope.PHOTO) {
                    builder.addContentUriTrigger(MediaStore.Video.Media.EXTERNAL_CONTENT_URI, true)
                }
                builder.setTriggerContentUpdateDelay(10, TimeUnit.SECONDS)
                builder.setTriggerContentMaxDelay(2, TimeUnit.MINUTES)
            }

            val triggerWork = OneTimeWorkRequestBuilder<AutoBackupWorker>()
                .setConstraints(builder.build())
                .setBackoffCriteria(BackoffPolicy.EXPONENTIAL, 30, TimeUnit.SECONDS)
                .addTag(UNIQUE_TRIGGER_WORK)
                .build()

            WorkManager.getInstance(context.applicationContext).enqueueUniqueWork(
                UNIQUE_TRIGGER_WORK,
                ExistingWorkPolicy.REPLACE,
                triggerWork
            )
        }

        fun enqueueImmediateBackup(context: Context, retryFailed: Boolean = false) {
            val appCtx = context.applicationContext
            val prefs = appCtx.getSharedPreferences("photocloud_prefs", Context.MODE_PRIVATE)
            val serverUrl = prefs.getString("server_url", BuildConfig.DEFAULT_SERVER_URL)
                ?: BuildConfig.DEFAULT_SERVER_URL
            val config = PhotoCloudApiClient(appCtx, serverUrl).getAutoBackupConfig()

            val constraints = Constraints.Builder()
                .setRequiredNetworkType(NetworkType.CONNECTED)
                .build()

            val req = OneTimeWorkRequestBuilder<AutoBackupWorker>()
                .setConstraints(constraints)
                .setInputData(workDataOf(KEY_RETRY_FAILED to retryFailed))
                .setBackoffCriteria(BackoffPolicy.EXPONENTIAL, 30, TimeUnit.SECONDS)
                .addTag(UNIQUE_IMMEDIATE_WORK)
                .build()

            WorkManager.getInstance(appCtx).enqueueUniqueWork(
                UNIQUE_IMMEDIATE_WORK,
                ExistingWorkPolicy.REPLACE,
                req
            )
            if (config.enabled && !config.paused) {
                syncScheduleFromPrefs(appCtx)
            }
        }

        fun cancelAllBackupWork(context: Context) {
            val wm = WorkManager.getInstance(context.applicationContext)
            wm.cancelUniqueWork(UNIQUE_PERIODIC_WORK)
            wm.cancelUniqueWork(UNIQUE_IMMEDIATE_WORK)
            wm.cancelUniqueWork(UNIQUE_TRIGGER_WORK)
        }
    }
}
