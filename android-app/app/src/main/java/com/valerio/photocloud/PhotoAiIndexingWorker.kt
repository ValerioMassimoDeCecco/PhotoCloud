package com.valerio.photocloud

import android.Manifest
import android.content.Context
import android.content.pm.PackageManager
import android.os.Build
import android.util.Log
import androidx.core.content.ContextCompat
import androidx.work.CoroutineWorker
import androidx.work.ExistingWorkPolicy
import androidx.work.OneTimeWorkRequestBuilder
import androidx.work.WorkManager
import androidx.work.WorkerParameters
import androidx.work.workDataOf
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext

/**
 * Background CoroutineWorker (`WorkManager`) that performs incremental On-Device AI categorization
 * using [LocalPhotoCategorizer] (`efficientnet_lite4.tflite`) and persists results to [PhotoAiDatabase].
 *
 * Features:
 * - Indexes exclusively PhotoCloud encrypted vault photos (`cloud://<filename>`), ignoring local device MediaStore photos.
 * - Automatically purges any legacy non-cloud entries and prunes deleted/trashed cloud photos from the Room AI index.
 * - Intelligent diffing: compares vault photo keys against `isAnalyzed = true` entries in Room
 *   and processes strictly the newly uploaded or unanalyzed photos in the current batch.
 * - Emits live `setProgress` updates (`processedCount / totalToProcess`) for the active batch only.
 * - Always closes [LocalPhotoCategorizer] in `finally` to release native JNI pointers.
 */
class PhotoAiIndexingWorker(
    appContext: Context,
    workerParams: WorkerParameters
) : CoroutineWorker(appContext, workerParams) {

    private data class CandidatePhoto(
        val uriString: String,
        val filename: String
    )

    override suspend fun doWork(): Result = withContext(Dispatchers.IO) {
        val db = PhotoAiDatabase.getInstance(applicationContext)
        val dao = db.photoAiDao()
        val forceReindex = inputData.getBoolean(KEY_FORCE_REINDEX, false)

        // 1. Purge any legacy non-cloud (MediaStore) rows so only PhotoCloud vault photos exist in DB
        dao.deleteNonCloudEntries()

        // 2. Load active PhotoCloud Vault image items (excluding videos and non-media documents)
        val prefs = applicationContext.getSharedPreferences("photocloud_prefs", Context.MODE_PRIVATE)
        val serverUrl = prefs.getString("server_url", BuildConfig.DEFAULT_SERVER_URL)
            ?: BuildConfig.DEFAULT_SERVER_URL
        val apiClient = PhotoCloudApiClient(applicationContext, serverUrl)
        val vaultMedia = apiClient.getCachedGalleryItems().filter { it.isMedia && !it.isVideo }

        // 3. Prune stale AI index entries for photos that were deleted or moved to trash
        val activeCloudUris = vaultMedia.map { "cloud://${it.filename}" }.toHashSet()
        if (activeCloudUris.isEmpty()) {
            dao.clearAllEntries()
            setProgress(workDataOf(KEY_ANALYZED to 0, KEY_TOTAL to 0))
            return@withContext Result.success(workDataOf(KEY_ANALYZED to 0, KEY_TOTAL to 0))
        } else {
            val existingCloudUris = dao.getAllCloudUriStrings()
            val staleUris = existingCloudUris.filter { it !in activeCloudUris }
            if (staleUris.isNotEmpty()) {
                staleUris.chunked(400).forEach { chunk ->
                    dao.deleteByUriStrings(chunk)
                }
            }
        }

        if (forceReindex) {
            dao.resetAllForReindex()
        }

        val analyzedUris = dao.getAnalyzedUriStrings().toHashSet()
        val candidates = ArrayList<CandidatePhoto>()
        val seenUris = HashSet<String>()

        for (item in vaultMedia) {
            val cloudKey = "cloud://${item.filename}"
            if (cloudKey !in analyzedUris && seenUris.add(cloudKey)) {
                candidates.add(
                    CandidatePhoto(
                        uriString = cloudKey,
                        filename = item.filename
                    )
                )
            }
        }

        if (candidates.isEmpty()) {
            setProgress(workDataOf(KEY_ANALYZED to 0, KEY_TOTAL to 0))
            return@withContext Result.success(workDataOf(KEY_ANALYZED to 0, KEY_TOTAL to 0))
        }

        // Pre-seed pending rows for the current batch with isAnalyzed = false
        val pendingEntities = candidates.map { cand ->
            PhotoAiEntity(
                uriString = cand.uriString,
                mediaStoreId = 0L,
                filename = cand.filename,
                categories = "",
                topConfidence = 0f,
                isAnalyzed = false,
                timestamp = System.currentTimeMillis()
            )
        }
        dao.upsertAll(pendingEntities)

        val totalToProcess = candidates.size
        var processedCount = 0
        setProgress(workDataOf(KEY_ANALYZED to 0, KEY_TOTAL to totalToProcess))

        var categorizer: LocalPhotoCategorizer? = null
        try {
            categorizer = LocalPhotoCategorizer(applicationContext)
            val batchBuffer = ArrayList<PhotoAiEntity>(BATCH_SIZE)

            for (candidate in candidates) {
                if (isStopped) break

                val bmp = apiClient.getRamThumbnailBitmap(candidate.filename, fromTrash = false)
                    ?: apiClient.loadThumbnailBitmap(candidate.filename, fromTrash = false)
                val aiResult = if (bmp != null) {
                    categorizer.classifyBitmap(bmp)
                } else {
                    AiClassificationResult(emptyList(), 0f, categorizer.isUsingGpuDelegate)
                }

                val categoriesCsv = aiResult.categories.joinToString(",")
                batchBuffer.add(
                    PhotoAiEntity(
                        uriString = candidate.uriString,
                        mediaStoreId = 0L,
                        filename = candidate.filename,
                        categories = categoriesCsv,
                        topConfidence = aiResult.topConfidence,
                        isAnalyzed = true,
                        timestamp = System.currentTimeMillis()
                    )
                )
                processedCount++

                val shouldFlush = batchBuffer.size >= BATCH_SIZE ||
                    totalToProcess <= 16 ||
                    processedCount == totalToProcess

                if (shouldFlush) {
                    dao.upsertAll(batchBuffer.toList())
                    batchBuffer.clear()
                    setProgress(
                        workDataOf(
                            KEY_ANALYZED to processedCount,
                            KEY_TOTAL to totalToProcess
                        )
                    )
                }
            }

            if (batchBuffer.isNotEmpty()) {
                dao.upsertAll(batchBuffer.toList())
                batchBuffer.clear()
            }
            Result.success(
                workDataOf(
                    KEY_ANALYZED to processedCount,
                    KEY_TOTAL to totalToProcess
                )
            )
        } catch (t: Throwable) {
            Log.e(TAG, "AI Photo Indexing Worker error: ${t.message}", t)
            Result.success()
        } finally {
            try {
                categorizer?.close()
            } catch (_: Throwable) {
            }
        }
    }

    companion object {
        private const val TAG = "PhotoAiIndexingWorker"
        const val UNIQUE_WORK_NAME = "ai_photo_indexing"
        const val KEY_FORCE_REINDEX = "force_reindex"
        const val KEY_ANALYZED = "analyzed"
        const val KEY_TOTAL = "total"
        private const val BATCH_SIZE = 4

        fun hasMediaReadPermission(context: Context): Boolean {
            return if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
                ContextCompat.checkSelfPermission(
                    context,
                    Manifest.permission.READ_MEDIA_IMAGES
                ) == PackageManager.PERMISSION_GRANTED
            } else {
                ContextCompat.checkSelfPermission(
                    context,
                    Manifest.permission.READ_EXTERNAL_STORAGE
                ) == PackageManager.PERMISSION_GRANTED
            }
        }

        fun enqueueIndexing(context: Context, forceReindex: Boolean = false) {
            val workRequest = OneTimeWorkRequestBuilder<PhotoAiIndexingWorker>()
                .setInputData(workDataOf(KEY_FORCE_REINDEX to forceReindex))
                .addTag(UNIQUE_WORK_NAME)
                .build()

            WorkManager.getInstance(context.applicationContext).enqueueUniqueWork(
                UNIQUE_WORK_NAME,
                if (forceReindex) ExistingWorkPolicy.REPLACE else ExistingWorkPolicy.APPEND_OR_REPLACE,
                workRequest
            )
        }
    }
}
