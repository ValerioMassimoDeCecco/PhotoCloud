package com.valerio.photocloud

import android.Manifest
import android.content.ContentUris
import android.content.Context
import android.content.pm.PackageManager
import android.net.Uri
import android.os.Build
import android.provider.MediaStore
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
 * - Queries `MediaStore.Images.Media.EXTERNAL_CONTENT_URI` when `READ_MEDIA_IMAGES` / `READ_EXTERNAL_STORAGE`
 *   permissions are granted (terminates cleanly with `Result.success()` without crashing if not granted).
 * - Also indexes PhotoCloud vault photos so all gallery photos receive real-time AI tags.
 * - Intelligent diffing: compares candidate photo IDs/keys against `isAnalyzed = true` entries in Room
 *   and only processes new or unanalyzed photos.
 * - Chunk/batch progressive updates: writes results in batches of 4 and emits live `setProgress` updates
 *   so category chips and progress indicators update in real time in the UI.
 * - Always closes [LocalPhotoCategorizer] in `finally` to release native JNI pointers.
 */
class PhotoAiIndexingWorker(
    appContext: Context,
    workerParams: WorkerParameters
) : CoroutineWorker(appContext, workerParams) {

    private data class CandidatePhoto(
        val uriString: String,
        val mediaStoreId: Long,
        val filename: String,
        val contentUri: Uri?
    )

    override suspend fun doWork(): Result = withContext(Dispatchers.IO) {
        val db = PhotoAiDatabase.getInstance(applicationContext)
        val dao = db.photoAiDao()
        val forceReindex = inputData.getBoolean(KEY_FORCE_REINDEX, false)

        if (forceReindex) {
            dao.resetAllForReindex()
        }

        val analyzedUris = dao.getAnalyzedUriStrings().toHashSet()
        val analyzedMediaStoreIds = dao.getAnalyzedMediaStoreIds().toHashSet()

        val candidates = mutableListOf<CandidatePhoto>()
        val seenUris = HashSet<String>()

        // 1. Query MediaStore.Images.Media.EXTERNAL_CONTENT_URI if media permission is granted
        if (hasMediaReadPermission(applicationContext)) {
            try {
                val projection = arrayOf(
                    MediaStore.Images.Media._ID,
                    MediaStore.Images.Media.DISPLAY_NAME,
                    MediaStore.Images.Media.MIME_TYPE
                )
                val sortOrder = "${MediaStore.Images.Media.DATE_ADDED} DESC"
                applicationContext.contentResolver.query(
                    MediaStore.Images.Media.EXTERNAL_CONTENT_URI,
                    projection,
                    null,
                    null,
                    sortOrder
                )?.use { cursor ->
                    val idCol = cursor.getColumnIndexOrThrow(MediaStore.Images.Media._ID)
                    val nameCol = cursor.getColumnIndexOrThrow(MediaStore.Images.Media.DISPLAY_NAME)
                    var count = 0
                    while (cursor.moveToNext() && count < MAX_MEDIASTORE_SCAN_LIMIT) {
                        val id = cursor.getLong(idCol)
                        val name = cursor.getString(nameCol) ?: "media_$id.jpg"
                        val contentUri = ContentUris.withAppendedId(
                            MediaStore.Images.Media.EXTERNAL_CONTENT_URI,
                            id
                        )
                        val uriStr = contentUri.toString()
                        if (id !in analyzedMediaStoreIds && uriStr !in analyzedUris && seenUris.add(uriStr)) {
                            candidates.add(
                                CandidatePhoto(
                                    uriString = uriStr,
                                    mediaStoreId = id,
                                    filename = name,
                                    contentUri = contentUri
                                )
                            )
                        }
                        count++
                    }
                }
            } catch (e: Throwable) {
                Log.w(TAG, "MediaStore query warning: ${e.message}")
            }
        }

        // 2. Also include PhotoCloud Vault image items (cached or active server session)
        val prefs = applicationContext.getSharedPreferences("photocloud_prefs", Context.MODE_PRIVATE)
        val serverUrl = prefs.getString("server_url", BuildConfig.DEFAULT_SERVER_URL)
            ?: BuildConfig.DEFAULT_SERVER_URL
        val apiClient = PhotoCloudApiClient(applicationContext, serverUrl)
        val vaultMedia = apiClient.getCachedGalleryItems().filter { it.isMedia && !it.isVideo }
        for (item in vaultMedia) {
            val cloudKey = "cloud://${item.filename}"
            if (cloudKey !in analyzedUris && seenUris.add(cloudKey)) {
                candidates.add(
                    CandidatePhoto(
                        uriString = cloudKey,
                        mediaStoreId = 0L,
                        filename = item.filename,
                        contentUri = null
                    )
                )
            }
        }

        if (candidates.isEmpty()) {
            setProgress(workDataOf(KEY_ANALYZED to 0, KEY_TOTAL to 0))
            return@withContext Result.success()
        }

        // Pre-seed pending rows with isAnalyzed = false so Room progress Flow shows exact queue size
        val pendingEntities = candidates.map { cand ->
            PhotoAiEntity(
                uriString = cand.uriString,
                mediaStoreId = cand.mediaStoreId,
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

                val aiResult = if (candidate.contentUri != null) {
                    categorizer.classifyUri(candidate.contentUri)
                } else {
                    val bmp = apiClient.getRamThumbnailBitmap(candidate.filename, fromTrash = false)
                        ?: apiClient.loadThumbnailBitmap(candidate.filename, fromTrash = false)
                    if (bmp != null) {
                        categorizer.classifyBitmap(bmp)
                    } else {
                        AiClassificationResult(emptyList(), 0f, categorizer.isUsingGpuDelegate)
                    }
                }

                val categoriesCsv = aiResult.categories.joinToString(",")
                batchBuffer.add(
                    PhotoAiEntity(
                        uriString = candidate.uriString,
                        mediaStoreId = candidate.mediaStoreId,
                        filename = candidate.filename,
                        categories = categoriesCsv,
                        topConfidence = aiResult.topConfidence,
                        isAnalyzed = true,
                        timestamp = System.currentTimeMillis()
                    )
                )
                processedCount++

                if (batchBuffer.size >= BATCH_SIZE || processedCount == totalToProcess) {
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
        private const val MAX_MEDIASTORE_SCAN_LIMIT = 500

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
                if (forceReindex) ExistingWorkPolicy.REPLACE else ExistingWorkPolicy.KEEP,
                workRequest
            )
        }
    }
}
