package com.valerio.photocloud.zk

import com.valerio.photocloud.AutoBackupLogic
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Job
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.launch
import kotlinx.coroutines.sync.Semaphore
import kotlinx.coroutines.sync.withPermit
import java.util.UUID
import java.util.concurrent.ConcurrentHashMap

enum class ZkTransferStatus {
    QUEUED,
    RUNNING,
    PAUSED,
    COMPLETED,
    SKIPPED_DUPLICATE,
    CANCELLED,
    FAILED
}

data class ZkTransferItemState(
    val transferId: String,
    val sourceKey: String,
    val displayName: String,
    val sizeBytes: Long,
    val status: ZkTransferStatus = ZkTransferStatus.QUEUED,
    val bytesUploaded: Long = 0L,
    val totalCiphertextBytes: Long = 0L,
    val uploadedChunks: Int = 0,
    val totalChunks: Int = 0,
    val blobId: String? = null,
    val errorMessage: String? = null,
    val failureKind: ZkUploadFailureKind? = null
) {
    val progressFraction: Float
        get() = if (totalCiphertextBytes <= 0L) {
            if (status == ZkTransferStatus.COMPLETED || status == ZkTransferStatus.SKIPPED_DUPLICATE) 1f else 0f
        } else {
            (bytesUploaded.toFloat() / totalCiphertextBytes.toFloat()).coerceIn(0f, 1f)
        }
}

/**
 * Interactive Zero-Knowledge upload queue manager (FASE 4C):
 * - Configurable parallelism clamped to `1..16` (default `2`)
 * - Per-item Pause, Resume, and Cancel controls
 * - Non-HTTPS transport warning helper
 * - Zero plaintext persistence; delegates streaming encryption/upload to [ZkBlobUploadPipeline]
 */
class ZkTransferManager(
    private val pipeline: ZkBlobUploadPipeline,
    private val subkeysProvider: () -> ZkCoreCrypto.VaultSubkeys?,
    private val scope: CoroutineScope,
    initialParallelism: Int = DEFAULT_PARALLELISM,
    private val onItemCompleted: ((ZkUploadOutcome.Uploaded) -> Unit)? = null
) {
    companion object {
        const val MIN_PARALLELISM = 1
        const val MAX_PARALLELISM = 16
        const val DEFAULT_PARALLELISM = 2

        fun clampParallelism(requested: Int): Int {
            return requested.coerceIn(MIN_PARALLELISM, MAX_PARALLELISM)
        }

        fun requiresHttpsWarning(serverUrl: String): Boolean {
            val clean = serverUrl.trim()
            return clean.isNotEmpty() && !AutoBackupLogic.isHttpsServerUrl(clean)
        }
    }

    @Volatile
    private var maxParallelism: Int = clampParallelism(initialParallelism)

    @Volatile
    private var semaphore: Semaphore = Semaphore(maxParallelism)

    private val _transfers = MutableStateFlow<List<ZkTransferItemState>>(emptyList())
    val transfers: StateFlow<List<ZkTransferItemState>> = _transfers.asStateFlow()

    private val _parallelismFlow = MutableStateFlow(maxParallelism)
    val parallelism: StateFlow<Int> = _parallelismFlow.asStateFlow()

    private data class EntryRecord(
        val source: ZkPlaintextSource,
        val includeGps: Boolean,
        val control: ZkUploadControl,
        @Volatile var job: Job? = null
    )

    private val entries = ConcurrentHashMap<String, EntryRecord>()

    fun getParallelism(): Int = maxParallelism

    @Synchronized
    fun setParallelism(requested: Int): Int {
        val clamped = clampParallelism(requested)
        if (clamped != maxParallelism) {
            maxParallelism = clamped
            semaphore = Semaphore(clamped)
            _parallelismFlow.value = clamped
        }
        return clamped
    }

    fun enqueue(
        source: ZkPlaintextSource,
        includeGps: Boolean = false
    ): String {
        val transferId = UUID.randomUUID().toString().lowercase()
        val control = ZkUploadControl()
        val initial = ZkTransferItemState(
            transferId = transferId,
            sourceKey = source.sourceKey,
            displayName = source.displayName,
            sizeBytes = source.sizeBytes,
            status = ZkTransferStatus.QUEUED
        )
        entries[transferId] = EntryRecord(source = source, includeGps = includeGps, control = control)
        synchronized(this) {
            _transfers.value = _transfers.value + initial
        }
        launchTransferJob(transferId)
        return transferId
    }

    private fun launchTransferJob(transferId: String) {
        val rec = entries[transferId] ?: return
        val activeSemaphore = semaphore
        rec.job = scope.launch {
            activeSemaphore.withPermit {
                if (rec.control.isCancelled) {
                    updateState(transferId) { it.copy(status = ZkTransferStatus.CANCELLED) }
                    return@withPermit
                }
                if (rec.control.isPaused) {
                    updateState(transferId) { it.copy(status = ZkTransferStatus.PAUSED) }
                    return@withPermit
                }
                val subkeys = subkeysProvider()
                if (subkeys == null) {
                    updateState(transferId) {
                        it.copy(
                            status = ZkTransferStatus.FAILED,
                            failureKind = ZkUploadFailureKind.UNAUTHORIZED,
                            errorMessage = "Vault bloccato: sblocca prima di caricare."
                        )
                    }
                    return@withPermit
                }

                updateState(transferId) {
                    it.copy(status = ZkTransferStatus.RUNNING, errorMessage = null, failureKind = null)
                }

                val outcome = pipeline.upload(
                    source = rec.source,
                    subkeys = subkeys,
                    includeGps = rec.includeGps,
                    checkDedupBeforeUpload = true,
                    control = rec.control,
                    returnImmediatelyOnPause = true,
                    onProgress = { progress ->
                        updateState(transferId) {
                            it.copy(
                                status = ZkTransferStatus.RUNNING,
                                blobId = progress.blobId,
                                bytesUploaded = progress.bytesUploaded,
                                totalCiphertextBytes = progress.totalCiphertextBytes,
                                uploadedChunks = progress.uploadedChunks,
                                totalChunks = progress.totalChunks
                            )
                        }
                    }
                )

                when (outcome) {
                    is ZkUploadOutcome.Uploaded -> {
                        updateState(transferId) {
                            it.copy(
                                status = ZkTransferStatus.COMPLETED,
                                blobId = outcome.blobId,
                                bytesUploaded = it.totalCiphertextBytes.coerceAtLeast(outcome.item.size),
                                totalCiphertextBytes = it.totalCiphertextBytes.coerceAtLeast(outcome.item.size)
                            )
                        }
                        onItemCompleted?.invoke(outcome)
                    }
                    is ZkUploadOutcome.SkippedDuplicate -> {
                        updateState(transferId) {
                            it.copy(
                                status = ZkTransferStatus.SKIPPED_DUPLICATE,
                                blobId = outcome.existingBlobId.ifBlank { it.blobId }
                            )
                        }
                    }
                    is ZkUploadOutcome.Paused -> {
                        updateState(transferId) {
                            it.copy(
                                status = ZkTransferStatus.PAUSED,
                                blobId = outcome.state.blobId,
                                uploadedChunks = outcome.state.nextChunkIndex,
                                totalChunks = outcome.state.totalChunks,
                                totalCiphertextBytes = outcome.state.totalCiphertextBytes
                            )
                        }
                    }
                    ZkUploadOutcome.Cancelled -> {
                        updateState(transferId) {
                            it.copy(status = ZkTransferStatus.CANCELLED)
                        }
                    }
                    is ZkUploadOutcome.Failed -> {
                        updateState(transferId) {
                            it.copy(
                                status = ZkTransferStatus.FAILED,
                                failureKind = outcome.kind,
                                errorMessage = outcome.message
                            )
                        }
                    }
                }
            }
        }
    }

    fun pause(transferId: String) {
        val rec = entries[transferId] ?: return
        rec.control.pause()
        updateState(transferId) {
            if (it.status == ZkTransferStatus.QUEUED || it.status == ZkTransferStatus.RUNNING) {
                it.copy(status = ZkTransferStatus.PAUSED)
            } else {
                it
            }
        }
    }

    fun resume(transferId: String) {
        val rec = entries[transferId] ?: return
        if (rec.control.isCancelled) return
        rec.control.resume()
        val current = _transfers.value.firstOrNull { it.transferId == transferId } ?: return
        if (current.status == ZkTransferStatus.PAUSED || current.status == ZkTransferStatus.FAILED) {
            updateState(transferId) {
                it.copy(status = ZkTransferStatus.QUEUED, errorMessage = null, failureKind = null)
            }
            launchTransferJob(transferId)
        }
    }

    fun cancel(transferId: String) {
        val rec = entries[transferId] ?: return
        rec.control.cancel()
        rec.job?.cancel()
        updateState(transferId) {
            if (it.status != ZkTransferStatus.COMPLETED && it.status != ZkTransferStatus.SKIPPED_DUPLICATE) {
                it.copy(status = ZkTransferStatus.CANCELLED)
            } else {
                it
            }
        }
    }

    fun pauseAll() {
        for (id in entries.keys) {
            pause(id)
        }
    }

    fun cancelAll() {
        for (id in entries.keys) {
            cancel(id)
        }
    }

    fun clearFinished() {
        synchronized(this) {
            val keep = _transfers.value.filter {
                it.status == ZkTransferStatus.QUEUED ||
                    it.status == ZkTransferStatus.RUNNING ||
                    it.status == ZkTransferStatus.PAUSED
            }
            val keepIds = keep.map { it.transferId }.toSet()
            for (key in entries.keys.toList()) {
                if (key !in keepIds) {
                    entries.remove(key)
                }
            }
            _transfers.value = keep
        }
    }

    private fun updateState(
        transferId: String,
        transform: (ZkTransferItemState) -> ZkTransferItemState
    ) {
        synchronized(this) {
            _transfers.value = _transfers.value.map { item ->
                if (item.transferId == transferId) transform(item) else item
            }
        }
    }
}
