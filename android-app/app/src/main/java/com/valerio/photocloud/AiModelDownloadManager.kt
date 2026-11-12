package com.valerio.photocloud

import android.content.Context
import android.os.StatFs
import android.util.Log
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.Job
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.isActive
import kotlinx.coroutines.launch
import okhttp3.Call
import okhttp3.OkHttpClient
import okhttp3.Request
import java.io.File
import java.io.FileOutputStream
import java.util.concurrent.TimeUnit

enum class AiModelStatus {
    NOT_INSTALLED,
    DOWNLOADING,
    PAUSED,
    INSTALLED,
    ERROR
}

data class AiModelState(
    val status: AiModelStatus = AiModelStatus.NOT_INSTALLED,
    val downloadedBytes: Long = 0L,
    val totalBytes: Long = AiModelDownloadManager.EXPECTED_MODEL_SIZE_BYTES,
    val speedBytesPerSec: Long = 0L,
    val installedSizeBytes: Long = 0L,
    val availableStorageBytes: Long = 0L,
    val requiredStorageBytes: Long = AiModelDownloadManager.REQUIRED_FREE_STORAGE_BYTES,
    val errorMessage: String? = null
) {
    val progressFraction: Float
        get() = if (totalBytes > 0L) {
            (downloadedBytes.toFloat() / totalBytes.toFloat()).coerceIn(0f, 1f)
        } else {
            0f
        }

    val progressPercent: Int
        get() = (progressFraction * 100f).toInt().coerceIn(0, 100)
}

/**
 * Singleton manager for optional On-Device AI model (`efficientnet_lite4.tflite`).
 *
 * - Never downloads automatically on first app launch.
 * - Supports HTTP Range resume (`Range: bytes=<offset>-`), pause, cancel, and deletion to free up storage.
 * - Verifies available disk space (`StatFs`) and file integrity before activating the model.
 */
object AiModelDownloadManager {

    private const val TAG = "AiModelDownloadManager"
    const val MODEL_DIR_NAME = "ai_models"
    const val MODEL_FILENAME = "efficientnet_lite4.tflite"
    const val PART_FILENAME = "efficientnet_lite4.tflite.part"

    // Expected size and SHA-256 of the official MediaPipe EfficientNet-Lite float32 TFLite model (~24.3 MB)
    const val EXPECTED_MODEL_SIZE_BYTES = 24_325_765L
    const val MIN_VALID_MODEL_BYTES = 5_000_000L
    const val REQUIRED_FREE_STORAGE_BYTES = 40_000_000L
    const val EXPECTED_MODEL_SHA256 =
        "94b6c84a5d6de20f932558de213b50e0338dcc06ab83d8d64b12128a476b4b83"

    const val OFFICIAL_MODEL_URL =
        "https://storage.googleapis.com/mediapipe-models/image_classifier/efficientnet_lite2/float32/latest/efficientnet_lite2.tflite"

    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.IO)

    private val httpClient: OkHttpClient by lazy {
        OkHttpClient.Builder()
            .connectTimeout(20, TimeUnit.SECONDS)
            .readTimeout(60, TimeUnit.SECONDS)
            .followRedirects(true)
            .followSslRedirects(true)
            .build()
    }

    private val _state = MutableStateFlow(AiModelState())
    val state: StateFlow<AiModelState> = _state.asStateFlow()

    @Volatile
    private var activeJob: Job? = null

    @Volatile
    private var activeCall: Call? = null

    @Volatile
    private var pauseRequested: Boolean = false

    fun getModelDirectory(context: Context): File {
        val dir = File(context.applicationContext.filesDir, MODEL_DIR_NAME)
        if (!dir.exists()) {
            dir.mkdirs()
        }
        return dir
    }

    fun getInstalledModelFile(context: Context): File {
        return File(getModelDirectory(context), MODEL_FILENAME)
    }

    fun getPartModelFile(context: Context): File {
        return File(getModelDirectory(context), PART_FILENAME)
    }

    fun isModelInstalled(context: Context): Boolean {
        val file = getInstalledModelFile(context)
        return file.exists() && file.isFile && file.length() >= MIN_VALID_MODEL_BYTES
    }

    fun verifyModelSha256(file: File): Boolean {
        if (!file.exists() || !file.isFile || file.length() < MIN_VALID_MODEL_BYTES) return false
        return try {
            val digest = java.security.MessageDigest.getInstance("SHA-256")
            file.inputStream().buffered(64 * 1024).use { input ->
                val buf = ByteArray(64 * 1024)
                while (true) {
                    val r = input.read(buf)
                    if (r <= 0) break
                    digest.update(buf, 0, r)
                }
            }
            val hex = digest.digest().joinToString("") { "%02x".format(it) }
            hex.equals(EXPECTED_MODEL_SHA256, ignoreCase = true)
        } catch (_: Throwable) {
            false
        }
    }

    fun getAvailableInternalStorageBytes(context: Context): Long {
        return try {
            val stat = StatFs(context.applicationContext.filesDir.absolutePath)
            stat.availableBytes
        } catch (_: Throwable) {
            0L
        }
    }

    fun refreshState(context: Context) {
        val appCtx = context.applicationContext
        val freeBytes = getAvailableInternalStorageBytes(appCtx)
        if (activeJob?.isActive == true) {
            _state.value = _state.value.copy(availableStorageBytes = freeBytes)
            return
        }

        val installedFile = getInstalledModelFile(appCtx)
        val partFile = getPartModelFile(appCtx)

        if (installedFile.exists() && installedFile.length() >= MIN_VALID_MODEL_BYTES) {
            val len = installedFile.length()
            _state.value = AiModelState(
                status = AiModelStatus.INSTALLED,
                downloadedBytes = len,
                totalBytes = len,
                speedBytesPerSec = 0L,
                installedSizeBytes = len,
                availableStorageBytes = freeBytes,
                requiredStorageBytes = REQUIRED_FREE_STORAGE_BYTES,
                errorMessage = null
            )
        } else if (partFile.exists() && partFile.length() > 0L) {
            val partLen = partFile.length()
            val prevTotal = _state.value.totalBytes.takeIf { it > partLen } ?: EXPECTED_MODEL_SIZE_BYTES
            _state.value = AiModelState(
                status = AiModelStatus.PAUSED,
                downloadedBytes = partLen,
                totalBytes = prevTotal,
                speedBytesPerSec = 0L,
                installedSizeBytes = 0L,
                availableStorageBytes = freeBytes,
                requiredStorageBytes = REQUIRED_FREE_STORAGE_BYTES,
                errorMessage = _state.value.errorMessage
            )
        } else {
            _state.value = AiModelState(
                status = AiModelStatus.NOT_INSTALLED,
                downloadedBytes = 0L,
                totalBytes = EXPECTED_MODEL_SIZE_BYTES,
                speedBytesPerSec = 0L,
                installedSizeBytes = 0L,
                availableStorageBytes = freeBytes,
                requiredStorageBytes = REQUIRED_FREE_STORAGE_BYTES,
                errorMessage = null
            )
        }
    }

    fun startOrResumeDownload(context: Context, serverUrl: String? = null) {
        val appCtx = context.applicationContext
        if (activeJob?.isActive == true) return

        val freeBytes = getAvailableInternalStorageBytes(appCtx)
        val partFile = getPartModelFile(appCtx)
        val existingBytes = if (partFile.exists()) partFile.length() else 0L
        val remainingNeeded = (REQUIRED_FREE_STORAGE_BYTES - existingBytes).coerceAtLeast(10_000_000L)

        if (freeBytes in 1 until remainingNeeded) {
            _state.value = _state.value.copy(
                status = AiModelStatus.ERROR,
                availableStorageBytes = freeBytes,
                speedBytesPerSec = 0L,
                errorMessage = "Spazio di archiviazione insufficiente sul dispositivo (${PhotoCloudApiClient.formatBytesHuman(freeBytes)} disponibili)."
            )
            return
        }

        pauseRequested = false
        activeJob = scope.launch {
            val urlsToTry = buildCandidateUrls(serverUrl)
            var lastError: String? = null

            for (candidateUrl in urlsToTry) {
                if (!isActive) break
                val currentOffset = if (partFile.exists()) partFile.length() else 0L

                _state.value = _state.value.copy(
                    status = AiModelStatus.DOWNLOADING,
                    downloadedBytes = currentOffset,
                    speedBytesPerSec = 0L,
                    availableStorageBytes = getAvailableInternalStorageBytes(appCtx),
                    errorMessage = null
                )

                try {
                    val reqBuilder = Request.Builder()
                        .url(candidateUrl)
                        .header("User-Agent", "PhotoCloud-Android/${BuildConfig.VERSION_NAME}")
                    if (currentOffset > 0L) {
                        reqBuilder.header("Range", "bytes=$currentOffset-")
                    }

                    val call = httpClient.newCall(reqBuilder.build())
                    activeCall = call
                    val response = call.execute()

                    response.use { resp ->
                        if (!resp.isSuccessful && resp.code != 416) {
                            lastError = "Server non raggiungibile (HTTP ${resp.code})"
                            return@use
                        }

                        val isPartialContent = resp.code == 206 && currentOffset > 0L
                        val startBytes = if (isPartialContent) currentOffset else 0L
                        val body = resp.body ?: run {
                            lastError = "Risposta vuota dal server del modello AI"
                            return@use
                        }

                        val contentLength = body.contentLength()
                        val totalExpected = when {
                            contentLength > 0L -> startBytes + contentLength
                            _state.value.totalBytes > 0L -> _state.value.totalBytes
                            else -> EXPECTED_MODEL_SIZE_BYTES
                        }

                        FileOutputStream(partFile, isPartialContent).use { out ->
                            val buffer = ByteArray(32 * 1024)
                            val input = body.byteStream()
                            var bytesSoFar = startBytes
                            var windowStartMs = System.currentTimeMillis()
                            var windowBytes = 0L

                            while (isActive) {
                                val read = input.read(buffer)
                                if (read == -1) break
                                out.write(buffer, 0, read)
                                bytesSoFar += read
                                windowBytes += read

                                val now = System.currentTimeMillis()
                                val elapsedMs = now - windowStartMs
                                if (elapsedMs >= 220L) {
                                    val speed = ((windowBytes * 1000L) / elapsedMs.coerceAtLeast(1L))
                                    _state.value = _state.value.copy(
                                        status = AiModelStatus.DOWNLOADING,
                                        downloadedBytes = bytesSoFar,
                                        totalBytes = maxOf(totalExpected, bytesSoFar),
                                        speedBytesPerSec = speed,
                                        errorMessage = null
                                    )
                                    windowStartMs = now
                                    windowBytes = 0L
                                }
                            }
                            out.flush()
                        }
                    }

                    if (!isActive) break

                    if (partFile.exists() && partFile.length() >= MIN_VALID_MODEL_BYTES && verifyModelSha256(partFile)) {
                        val finalFile = getInstalledModelFile(appCtx)
                        if (finalFile.exists()) {
                            finalFile.delete()
                        }
                        val renamed = partFile.renameTo(finalFile)
                        if (!renamed) {
                            partFile.copyTo(finalFile, overwrite = true)
                            partFile.delete()
                        }

                        val finalLen = finalFile.length()
                        _state.value = AiModelState(
                            status = AiModelStatus.INSTALLED,
                            downloadedBytes = finalLen,
                            totalBytes = finalLen,
                            speedBytesPerSec = 0L,
                            installedSizeBytes = finalLen,
                            availableStorageBytes = getAvailableInternalStorageBytes(appCtx),
                            requiredStorageBytes = REQUIRED_FREE_STORAGE_BYTES,
                            errorMessage = null
                        )
                        PhotoAiIndexingWorker.enqueueIndexing(appCtx, forceReindex = false)
                        return@launch
                    } else {
                        if (partFile.exists() && partFile.length() >= EXPECTED_MODEL_SIZE_BYTES) {
                            try { partFile.delete() } catch (_: Throwable) {}
                        }
                        lastError = "File modello AI incompleto o checksum SHA-256 non valido"
                    }
                } catch (ce: CancellationException) {
                    throw ce
                } catch (e: Throwable) {
                    if (!isActive || pauseRequested) break
                    Log.w(TAG, "AI model download attempt failed from $candidateUrl: ${e.message}")
                    lastError = when {
                        e.message?.contains("ENOSPC", ignoreCase = true) == true ||
                            e.message?.contains("No space left", ignoreCase = true) == true ->
                            "Spazio di archiviazione esaurito durante il download."
                        else -> "Connessione interrotta: ${e.localizedMessage ?: "errore di rete"}"
                    }
                } finally {
                    activeCall = null
                }
            }

            val currentPartLen = if (partFile.exists()) partFile.length() else 0L
            if (pauseRequested) {
                _state.value = _state.value.copy(
                    status = if (currentPartLen > 0L) AiModelStatus.PAUSED else AiModelStatus.NOT_INSTALLED,
                    downloadedBytes = currentPartLen,
                    speedBytesPerSec = 0L,
                    availableStorageBytes = getAvailableInternalStorageBytes(appCtx),
                    errorMessage = null
                )
            } else if (!isModelInstalled(appCtx)) {
                _state.value = _state.value.copy(
                    status = if (currentPartLen > 0L) AiModelStatus.PAUSED else AiModelStatus.ERROR,
                    downloadedBytes = currentPartLen,
                    speedBytesPerSec = 0L,
                    availableStorageBytes = getAvailableInternalStorageBytes(appCtx),
                    errorMessage = lastError ?: "Impossibile completare il download del modello AI. Puoi riprendere in qualsiasi momento."
                )
            }
        }
    }

    fun pauseDownload(context: Context) {
        pauseRequested = true
        try {
            activeCall?.cancel()
        } catch (_: Throwable) {
        }
        activeJob?.cancel()
        activeJob = null
        val partLen = getPartModelFile(context).takeIf { it.exists() }?.length() ?: 0L
        _state.value = _state.value.copy(
            status = if (partLen > 0L) AiModelStatus.PAUSED else AiModelStatus.NOT_INSTALLED,
            downloadedBytes = partLen,
            speedBytesPerSec = 0L,
            availableStorageBytes = getAvailableInternalStorageBytes(context),
            errorMessage = null
        )
    }

    fun cancelDownload(context: Context) {
        pauseRequested = false
        try {
            activeCall?.cancel()
        } catch (_: Throwable) {
        }
        activeJob?.cancel()
        activeJob = null
        try {
            val partFile = getPartModelFile(context)
            if (partFile.exists()) partFile.delete()
        } catch (_: Throwable) {
        }
        _state.value = AiModelState(
            status = AiModelStatus.NOT_INSTALLED,
            downloadedBytes = 0L,
            totalBytes = EXPECTED_MODEL_SIZE_BYTES,
            speedBytesPerSec = 0L,
            installedSizeBytes = 0L,
            availableStorageBytes = getAvailableInternalStorageBytes(context),
            requiredStorageBytes = REQUIRED_FREE_STORAGE_BYTES,
            errorMessage = null
        )
    }

    fun deleteInstalledModel(context: Context, onComplete: (() -> Unit)? = null) {
        val appCtx = context.applicationContext
        cancelDownload(appCtx)
        scope.launch {
            try {
                WorkManagerHelper.cancelAiIndexing(appCtx)
            } catch (_: Throwable) {
            }
            try {
                val installed = getInstalledModelFile(appCtx)
                if (installed.exists()) installed.delete()
                val part = getPartModelFile(appCtx)
                if (part.exists()) part.delete()
                PhotoAiDatabase.getInstance(appCtx).photoAiDao().clearAllEntries()
            } catch (t: Throwable) {
                Log.w(TAG, "Error deleting AI model: ${t.message}")
            }
            _state.value = AiModelState(
                status = AiModelStatus.NOT_INSTALLED,
                downloadedBytes = 0L,
                totalBytes = EXPECTED_MODEL_SIZE_BYTES,
                speedBytesPerSec = 0L,
                installedSizeBytes = 0L,
                availableStorageBytes = getAvailableInternalStorageBytes(appCtx),
                requiredStorageBytes = REQUIRED_FREE_STORAGE_BYTES,
                errorMessage = null
            )
            onComplete?.invoke()
        }
    }

    private fun buildCandidateUrls(serverUrl: String?): List<String> {
        val list = ArrayList<String>(3)
        val cleanedServer = serverUrl?.trim()?.removeSuffix("/")
        if (!cleanedServer.isNullOrBlank() && !cleanedServer.contains("10.0.2.2")) {
            list.add("$cleanedServer/api/ai-model/efficientnet_lite4.tflite")
        }
        list.add(OFFICIAL_MODEL_URL)
        if (!cleanedServer.isNullOrBlank() && cleanedServer.contains("10.0.2.2")) {
            list.add("$cleanedServer/api/ai-model/efficientnet_lite4.tflite")
        }
        return list.distinct()
    }

    private object WorkManagerHelper {
        fun cancelAiIndexing(context: Context) {
            androidx.work.WorkManager.getInstance(context)
                .cancelUniqueWork(PhotoAiIndexingWorker.UNIQUE_WORK_NAME)
        }
    }
}
