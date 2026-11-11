document.addEventListener('DOMContentLoaded', () => {
    const fileInput = document.getElementById('file-input');
    const uploadForm = document.getElementById('upload-form');
    const container = document.getElementById('upload-indicator-container');
    if (!container) return;

    const gem = document.getElementById('upload-gem');
    const progressArc = document.getElementById('upload-progress-arc');
    const icon = document.getElementById('upload-indicator-icon');
    const percentageText = document.getElementById('upload-indicator-percentage');
    const activeCountBadge = document.getElementById('upload-active-count-badge');
    const speedBadge = document.getElementById('upload-speed-badge');

    const cardTitle = document.getElementById('upload-card-title');
    const fileList = document.getElementById('upload-file-list');
    const cardStatus = document.getElementById('upload-card-status');
    const closeButton = document.getElementById('upload-close-btn');

    const radius = progressArc && progressArc.r ? progressArc.r.baseVal.value : 16;
    const circumference = 2 * Math.PI * radius;
    if (progressArc) {
        progressArc.style.strokeDasharray = `${circumference} ${circumference}`;
        progressArc.style.strokeDashoffset = circumference;
    }

    // State for concurrent transfers
    // Map<opId, { id, name, type, loadedBytes, totalBytes, speedBps, status: 'running'|'completed'|'failed'|'cancelled', cancelFn?: () => void }>
    const operationsState = new Map();
    let autoCloseTimeoutId = null;

    function formatBytes(bytes) {
        if (!bytes || bytes <= 0) return '0 B';
        const k = 1024;
        const sizes = ['B', 'KB', 'MB', 'GB'];
        const i = Math.min(sizes.length - 1, Math.floor(Math.log(bytes) / Math.log(k)));
        return parseFloat((bytes / Math.pow(k, i)).toFixed(i === 0 ? 0 : 1)) + ' ' + sizes[i];
    }

    function formatSpeed(bytesPerSec) {
        if (!bytesPerSec || bytesPerSec <= 0) return '0 KB/s';
        return `${formatBytes(bytesPerSec)}/s`;
    }

    function setProgress(percent) {
        const clamped = Math.max(0, Math.min(100, percent));
        const offset = circumference - (clamped / 100) * circumference;
        if (progressArc) progressArc.style.strokeDashoffset = offset;
        if (percentageText) percentageText.textContent = `${Math.round(clamped)}%`;
    }

    function cancelPendingAutoClose() {
        if (autoCloseTimeoutId) {
            clearTimeout(autoCloseTimeoutId);
            autoCloseTimeoutId = null;
        }
    }

    function syncGlobalTransferIndicator() {
        const allOps = Array.from(operationsState.values());
        const runningOps = allOps.filter(op => op.status === 'running');
        const runningCount = runningOps.length;

        if (runningCount > 0) {
            cancelPendingAutoClose();
            // Show discreet top-right icon WITHOUT auto-expanding the floating card
            container.classList.add('has-active-transfers');
            gem.classList.add('is-uploading');
            if (progressArc) progressArc.style.stroke = 'var(--primary)';

            if (activeCountBadge) {
                activeCountBadge.textContent = String(runningCount);
                activeCountBadge.style.display = runningCount > 1 ? 'inline-flex' : 'none';
            }

            const totalBytes = runningOps.reduce((sum, op) => sum + Math.max(0, op.totalBytes || 0), 0);
            const loadedBytes = runningOps.reduce((sum, op) => sum + Math.max(0, op.loadedBytes || 0), 0);
            const totalSpeed = runningOps.reduce((sum, op) => sum + Math.max(0, op.speedBps || 0), 0);
            const overallPct = totalBytes > 0 ? (loadedBytes / totalBytes) * 100 : 0;

            setProgress(overallPct);

            const hasUpload = runningOps.some(op => op.type === 'upload');
            const hasDownload = runningOps.some(op => op.type === 'download');
            if (icon) {
                icon.textContent = hasUpload && hasDownload ? 'swap_vert' : (hasUpload ? 'upload' : 'download');
            }

            if (speedBadge) {
                speedBadge.textContent = `${formatSpeed(totalSpeed)} • ${formatBytes(loadedBytes)} / ${formatBytes(totalBytes)}`;
            }
            if (cardTitle) {
                cardTitle.textContent = runningCount === 1
                    ? (runningOps[0].type === 'download' ? 'Scaricamento in corso...' : 'Caricamento in corso...')
                    : `${runningCount} trasferimenti attivi`;
            }
            if (cardStatus) {
                cardStatus.textContent = `${runningCount} in corso • ${Math.round(overallPct)}% (${formatSpeed(totalSpeed)})`;
            }
        } else {
            // All active transfers have finished (completed, failed, or cancelled)
            gem.classList.remove('is-uploading');
            if (activeCountBadge) {
                activeCountBadge.style.display = 'none';
                activeCountBadge.textContent = '0';
            }

            // Schedule automatic closure of the transfer screen & hiding of the indicator
            cancelPendingAutoClose();
            autoCloseTimeoutId = setTimeout(() => {
                const stillRunning = Array.from(operationsState.values()).some(op => op.status === 'running');
                if (!stillRunning) {
                    container.classList.remove('expanded');
                    container.classList.remove('has-active-transfers');
                    setProgress(0);
                    if (icon) icon.textContent = 'swap_vert';
                }
            }, 600);
        }
    }

    function toggleExpand(e) {
        if (e) e.stopPropagation();
        container.classList.toggle('expanded');
    }

    document.addEventListener('click', (e) => {
        if (!container.contains(e.target)) {
            container.classList.remove('expanded');
        }
    });

    function clearEmptyPlaceholder() {
        if (!fileList) return;
        const emptyItem = fileList.querySelector('.transfer-empty-item');
        if (emptyItem) emptyItem.remove();
    }

    // Expose global helper for inspection and testing
    window.getTransferCenterState = function () {
        const allOps = Array.from(operationsState.values());
        const runningOps = allOps.filter(op => op.status === 'running');
        return {
            runningCount: runningOps.length,
            totalTracked: allOps.length,
            isExpanded: container.classList.contains('expanded'),
            isIndicatorVisible: container.classList.contains('has-active-transfers')
        };
    };

    // Expose global helper so ZIP downloads, direct downloads, photo editor saves, and batch uploads share the same Transfer Center
    window.registerTransferOperation = function ({ id, name, type, totalBytes, onCancel }) {
        clearEmptyPlaceholder();
        const opId = id || `op_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;

        const opRecord = {
            id: opId,
            name: name || 'File',
            type: type === 'download' ? 'download' : 'upload',
            loadedBytes: 0,
            totalBytes: totalBytes || 0,
            speedBps: 0,
            status: 'running',
            cancelFn: typeof onCancel === 'function' ? onCancel : null
        };
        operationsState.set(opId, opRecord);

        let li = fileList ? fileList.querySelector(`[data-op-id="${CSS.escape(opId)}"]`) : null;
        if (!li && fileList) {
            li = document.createElement('li');
            li.className = 'upload-file-item';
            li.dataset.opId = opId;
            li.innerHTML = `
                <span class="material-icons">${opRecord.type === 'download' ? 'download' : 'upload'}</span>
                <div class="file-info">
                    <span class="file-name"></span>
                    <span class="file-status">In avvio...</span>
                </div>
                <button type="button" class="btn icon transfer-cancel-btn" title="Annulla trasferimento" style="display: none; width: 28px; height: 28px;">
                    <span class="material-icons" style="font-size: 16px;">close</span>
                </button>
            `;
            li.querySelector('.file-name').textContent = opRecord.name;
            const cancelBtn = li.querySelector('.transfer-cancel-btn');
            if (cancelBtn && opRecord.cancelFn) {
                cancelBtn.style.display = 'inline-flex';
                cancelBtn.addEventListener('click', (ev) => {
                    ev.stopPropagation();
                    if (opRecord.status === 'running' && opRecord.cancelFn) {
                        opRecord.cancelFn();
                    }
                });
            }
            fileList.prepend(li);
        }

        // IMPORTANT: Do NOT auto-expand container! Only show the discreet active indicator.
        syncGlobalTransferIndicator();

        return {
            id: opId,
            setCancelHandler(fn) {
                opRecord.cancelFn = fn;
                const cancelBtn = li ? li.querySelector('.transfer-cancel-btn') : null;
                if (cancelBtn && typeof fn === 'function') {
                    cancelBtn.style.display = 'inline-flex';
                    cancelBtn.onclick = (ev) => {
                        ev.stopPropagation();
                        if (opRecord.status === 'running' && opRecord.cancelFn) {
                            opRecord.cancelFn();
                        }
                    };
                }
            },
            update(loadedBytes, total, speedBps, statusLabel) {
                if (opRecord.status !== 'running') return;
                opRecord.loadedBytes = Math.max(0, loadedBytes || 0);
                opRecord.totalBytes = Math.max(opRecord.loadedBytes, total || opRecord.totalBytes || 0);
                opRecord.speedBps = Math.max(0, speedBps || 0);

                const pct = opRecord.totalBytes > 0 ? (opRecord.loadedBytes / opRecord.totalBytes) * 100 : 0;
                const st = li ? li.querySelector('.file-status') : null;
                if (st) {
                    st.textContent = statusLabel || `${Math.round(pct)}% • ${formatBytes(opRecord.loadedBytes)} / ${formatBytes(opRecord.totalBytes)} (${formatSpeed(opRecord.speedBps)})`;
                }
                syncGlobalTransferIndicator();
            },
            complete(finalBytes, elapsedSec) {
                const resolvedBytes = finalBytes !== undefined ? finalBytes : opRecord.totalBytes;
                opRecord.loadedBytes = resolvedBytes;
                opRecord.totalBytes = resolvedBytes;
                opRecord.speedBps = elapsedSec > 0 ? resolvedBytes / elapsedSec : opRecord.speedBps;
                opRecord.status = 'completed';

                const cancelBtn = li ? li.querySelector('.transfer-cancel-btn') : null;
                if (cancelBtn) cancelBtn.style.display = 'none';

                const st = li ? li.querySelector('.file-status') : null;
                if (st) {
                    st.textContent = `Completato • ${formatBytes(resolvedBytes)}`;
                    st.classList.add('completed');
                }
                if (cardTitle) cardTitle.textContent = 'Operazione Completata';
                if (cardStatus) cardStatus.textContent = `${opRecord.name} completato (${formatBytes(resolvedBytes)})`;

                syncGlobalTransferIndicator();
            },
            cancel(reason) {
                opRecord.status = 'cancelled';
                opRecord.speedBps = 0;

                const cancelBtn = li ? li.querySelector('.transfer-cancel-btn') : null;
                if (cancelBtn) cancelBtn.style.display = 'none';

                const st = li ? li.querySelector('.file-status') : null;
                if (st) {
                    st.textContent = reason || 'Annullato';
                    st.classList.add('error');
                }
                if (cardTitle) cardTitle.textContent = 'Trasferimento Annullato';
                if (cardStatus) cardStatus.textContent = `${opRecord.name}: annullato`;

                syncGlobalTransferIndicator();
            },
            fail(errMsg) {
                opRecord.status = 'failed';
                opRecord.speedBps = 0;

                const cancelBtn = li ? li.querySelector('.transfer-cancel-btn') : null;
                if (cancelBtn) cancelBtn.style.display = 'none';

                const st = li ? li.querySelector('.file-status') : null;
                if (st) {
                    st.textContent = `Errore: ${errMsg}`;
                    st.classList.add('error');
                }
                if (cardTitle) cardTitle.textContent = 'Errore Trasferimento';
                if (cardStatus) cardStatus.textContent = errMsg;

                syncGlobalTransferIndicator();
            }
        };
    };

    window.trackDirectDownload = function (_event, filename, sizeBytes) {
        const tracker = window.registerTransferOperation({
            id: `dl_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
            name: filename,
            type: 'download',
            totalBytes: sizeBytes || 0
        });
        tracker.update(Math.round((sizeBytes || 0) * 0.5), sizeBytes || 0, (sizeBytes || 1024 * 512) * 2, 'Scaricamento avviato...');
        setTimeout(() => tracker.complete(sizeBytes || 0, 0.35), 450);
    };

    const PARALLEL_STORAGE_KEY = 'photocloud_max_parallel_transfers';

    function clampParallelTransfers(val) {
        const parsed = parseInt(String(val), 10);
        if (!Number.isFinite(parsed)) return 3;
        return Math.min(16, Math.max(1, parsed));
    }

    window.getMaxParallelTransfers = function () {
        try {
            const raw = localStorage.getItem(PARALLEL_STORAGE_KEY);
            return raw ? clampParallelTransfers(raw) : 3;
        } catch (_e) {
            return 3;
        }
    };

    window.setMaxParallelTransfers = function (val) {
        const clamped = clampParallelTransfers(val);
        try {
            localStorage.setItem(PARALLEL_STORAGE_KEY, String(clamped));
        } catch (_e) {}
        syncParallelTransferSettingsUI(clamped);
        return clamped;
    };

    function syncParallelTransferSettingsUI(currentVal) {
        const activeVal = currentVal || window.getMaxParallelTransfers();
        const badge = document.getElementById('settings-parallel-active-badge');
        if (badge) {
            badge.textContent = `${activeVal}x simultanei`;
        }
        const customInput = document.getElementById('settings-parallel-custom-input');
        if (customInput && document.activeElement !== customInput) {
            customInput.value = String(activeVal);
        }
        const presetBtns = document.querySelectorAll('.parallel-preset-btn[data-parallel-preset]');
        presetBtns.forEach((btn) => {
            const pVal = parseInt(btn.getAttribute('data-parallel-preset') || '0', 10);
            const isSelected = pVal === activeVal;
            btn.classList.toggle('active', isSelected);
            btn.classList.toggle('primary', isSelected);
            btn.classList.toggle('outlined', !isSelected);
        });
    }

    function bindParallelTransferSettingsUI() {
        const card = document.getElementById('settings-parallel-transfers-card');
        if (!card || card.dataset.bound === 'true') return;
        card.dataset.bound = 'true';

        syncParallelTransferSettingsUI();

        const presetBtns = card.querySelectorAll('.parallel-preset-btn[data-parallel-preset]');
        presetBtns.forEach((btn) => {
            btn.addEventListener('click', () => {
                const pVal = clampParallelTransfers(btn.getAttribute('data-parallel-preset'));
                window.setMaxParallelTransfers(pVal);
            });
        });

        const customInput = document.getElementById('settings-parallel-custom-input');
        const decBtn = document.getElementById('settings-parallel-dec-btn');
        const incBtn = document.getElementById('settings-parallel-inc-btn');
        const applyBtn = document.getElementById('settings-parallel-apply-btn');

        if (decBtn) {
            decBtn.addEventListener('click', () => {
                const next = clampParallelTransfers(window.getMaxParallelTransfers() - 1);
                window.setMaxParallelTransfers(next);
            });
        }
        if (incBtn) {
            incBtn.addEventListener('click', () => {
                const next = clampParallelTransfers(window.getMaxParallelTransfers() + 1);
                window.setMaxParallelTransfers(next);
            });
        }
        if (customInput) {
            customInput.addEventListener('change', () => {
                const next = clampParallelTransfers(customInput.value);
                customInput.value = String(next);
                window.setMaxParallelTransfers(next);
            });
        }
        if (applyBtn && customInput) {
            applyBtn.addEventListener('click', () => {
                const next = clampParallelTransfers(customInput.value);
                customInput.value = String(next);
                window.setMaxParallelTransfers(next);
            });
        }
    }

    bindParallelTransferSettingsUI();

    function uploadMicroBatchXHR(formData, activeXhrsSet, onChunkProgress) {
        return new Promise((resolve, reject) => {
            const xhr = new XMLHttpRequest();
            xhr.open('POST', '/upload', true);
            activeXhrsSet.add(xhr);

            xhr.upload.onprogress = (e) => {
                if (e.lengthComputable && typeof onChunkProgress === 'function') {
                    onChunkProgress(e.loaded);
                }
            };

            xhr.onload = () => {
                activeXhrsSet.delete(xhr);
                if (xhr.status >= 200 && xhr.status < 300) {
                    let parsed = null;
                    try {
                        parsed = JSON.parse(xhr.responseText);
                    } catch (_e) {}
                    resolve(parsed);
                } else {
                    let errorMsg = `Errore server: ${xhr.status}`;
                    try {
                        errorMsg = JSON.parse(xhr.responseText).error || errorMsg;
                    } catch (_e) {}
                    reject(new Error(errorMsg));
                }
            };

            xhr.onabort = () => {
                activeXhrsSet.delete(xhr);
                const abortErr = new Error('Trasferimento annullato dall\'utente.');
                abortErr.isCancelled = true;
                reject(abortErr);
            };

            xhr.onerror = () => {
                activeXhrsSet.delete(xhr);
                reject(new Error('Errore di rete durante il caricamento.'));
            };

            xhr.send(formData);
        });
    }

    /**
     * Partitions any number of files (e.g. 250, 500, 1000+ photos) into small byte-bounded
     * micro-batches and uploads them using a bounded concurrency pool (maxParallelTransfers 1..16).
     * Never packs huge multi-file FormData payloads in RAM and never thrash-rebuilds the DOM on every chunk.
     */
    async function uploadInBatches(files) {
        if (!files || files.length === 0) return;

        const allFiles = Array.from(files);
        const totalFilesCount = allFiles.length;
        const parallelLimit = window.getMaxParallelTransfers();
        const grandTotalBytes = allFiles.reduce((acc, f) => acc + (f.size || 0), 0);
        const opTitle = totalFilesCount === 1
            ? allFiles[0].name
            : `Caricamento (${totalFilesCount} file • ${parallelLimit}x)`;

        const tracker = window.registerTransferOperation({
            id: `up_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
            name: opTitle,
            type: 'upload',
            totalBytes: grandTotalBytes
        });

        // Build byte-aware micro-batches (max 3 files and max 18 MB per XHR request)
        const MAX_FILES_PER_BATCH = totalFilesCount > 40 ? 2 : 1;
        const MAX_BYTES_PER_BATCH = 18 * 1024 * 1024;
        const microBatches = [];
        let currentBatch = [];
        let currentBatchBytes = 0;

        for (let i = 0; i < allFiles.length; i++) {
            const file = allFiles[i];
            const fSize = file.size || 0;
            if (
                currentBatch.length > 0 &&
                (currentBatch.length >= MAX_FILES_PER_BATCH || currentBatchBytes + fSize > MAX_BYTES_PER_BATCH)
            ) {
                microBatches.push({ files: currentBatch, totalBytes: currentBatchBytes });
                currentBatch = [];
                currentBatchBytes = 0;
            }
            currentBatch.push(file);
            currentBatchBytes += fSize;
        }
        if (currentBatch.length > 0) {
            microBatches.push({ files: currentBatch, totalBytes: currentBatchBytes });
        }

        const totalBatches = microBatches.length;
        const activeXhrs = new Set();
        const batchLoadedBytes = new Array(totalBatches).fill(0);
        let completedFilesCount = 0;
        let failedFilesCount = 0;
        let isCancelledByUser = false;
        let latestMediaFiles = null;
        let firstErrorMessage = '';
        const startOverall = performance.now();

        if (tracker && typeof tracker.setCancelHandler === 'function') {
            tracker.setCancelHandler(() => {
                isCancelledByUser = true;
                activeXhrs.forEach((xhr) => {
                    try {
                        xhr.abort();
                    } catch (_e) {}
                });
                activeXhrs.clear();
            });
        }

        function emitCombinedProgress() {
            if (isCancelledByUser) return;
            let loadedSum = 0;
            for (let i = 0; i < batchLoadedBytes.length; i++) {
                loadedSum += batchLoadedBytes[i];
            }
            const currentTotalLoaded = grandTotalBytes > 0 ? Math.min(grandTotalBytes, loadedSum) : loadedSum;
            const elapsedSec = Math.max(0.08, (performance.now() - startOverall) / 1000);
            const speedBps = currentTotalLoaded / elapsedSec;
            const overallPct = grandTotalBytes > 0 ? (currentTotalLoaded / grandTotalBytes) * 100 : 0;

            tracker.update(
                currentTotalLoaded,
                grandTotalBytes,
                speedBps,
                totalFilesCount > 1
                    ? `${completedFilesCount}/${totalFilesCount} file (${parallelLimit}x) • ${Math.round(overallPct)}% (${formatSpeed(speedBps)})`
                    : `${Math.round(overallPct)}% • ${formatBytes(currentTotalLoaded)} / ${formatBytes(grandTotalBytes)} (${formatSpeed(speedBps)})`
            );
        }

        let nextBatchIndex = 0;
        const activeAlbum = window.currentSelectedAlbumFilter || '';

        async function runWorker() {
            while (!isCancelledByUser) {
                const batchIdx = nextBatchIndex++;
                if (batchIdx >= totalBatches) break;

                const micro = microBatches[batchIdx];
                const expectedBytes = micro.totalBytes;
                let attempt = 0;
                let batchSucceeded = false;

                while (attempt < 2 && !batchSucceeded && !isCancelledByUser) {
                    attempt++;
                    const formData = new FormData();
                    micro.files.forEach((file) => {
                        formData.append('file[]', file, file.name);
                        formData.append('timestamp[]', file.lastModified || Date.now());
                    });
                    if (activeAlbum) {
                        formData.append('album', activeAlbum);
                    }
                    // Skip server-side full directory scan on intermediate micro-batches
                    if (totalBatches > 1 && batchIdx < totalBatches - 1) {
                        formData.append('skipList', '1');
                    }

                    try {
                        const resp = await uploadMicroBatchXHR(formData, activeXhrs, (loadedInBatch) => {
                            batchLoadedBytes[batchIdx] = expectedBytes > 0
                                ? Math.min(expectedBytes, loadedInBatch)
                                : loadedInBatch;
                            emitCombinedProgress();
                        });
                        batchSucceeded = true;
                        batchLoadedBytes[batchIdx] = expectedBytes;
                        completedFilesCount += micro.files.length;
                        if (resp && Array.isArray(resp.mediaFiles)) {
                            latestMediaFiles = resp.mediaFiles;
                        }
                        emitCombinedProgress();
                    } catch (err) {
                        if (err && err.isCancelled) {
                            isCancelledByUser = true;
                            throw err;
                        }
                        if (!firstErrorMessage && err && err.message) {
                            firstErrorMessage = err.message;
                        }
                        if (attempt >= 2) {
                            batchLoadedBytes[batchIdx] = 0;
                            failedFilesCount += micro.files.length;
                            emitCombinedProgress();
                        }
                    }
                }
            }
        }

        try {
            const workerCount = Math.min(parallelLimit, totalBatches);
            const workers = [];
            for (let w = 0; w < workerCount; w++) {
                workers.push(runWorker());
            }
            await Promise.all(workers);

            if (isCancelledByUser) {
                tracker.cancel('Annullato dall\'utente');
                return;
            }

            if (completedFilesCount === 0 && failedFilesCount > 0) {
                tracker.fail(firstErrorMessage || 'Errore durante il caricamento dei file');
                return;
            }

            const totalElapsedSec = Math.max(0.1, (performance.now() - startOverall) / 1000);
            tracker.complete(grandTotalBytes, totalElapsedSec);

            // Sync DOM once at the end of the parallel upload session
            if (typeof window.refreshVaultFromSession === 'function') {
                await window.refreshVaultFromSession({ fromUpload: true });
            } else if (latestMediaFiles && typeof window.syncVaultItemsFromServer === 'function') {
                window.syncVaultItemsFromServer(latestMediaFiles, { fromUpload: true });
            } else {
                try {
                    const sessResp = await fetch('/api/session', { headers: { Accept: 'application/json' } });
                    if (sessResp.ok) {
                        const sessJson = await sessResp.json();
                        if (sessJson && Array.isArray(sessJson.media) && typeof window.syncVaultItemsFromServer === 'function') {
                            window.syncVaultItemsFromServer(sessJson.media, { fromUpload: true });
                        }
                    }
                } catch (_e) {}
            }
        } catch (error) {
            if (isCancelledByUser || (error && error.isCancelled)) {
                tracker.cancel('Annullato dall\'utente');
            } else {
                tracker.fail((error && error.message) || 'Errore caricamento');
            }
        } finally {
            if (uploadForm) uploadForm.reset();
        }
    }

    if (fileInput) {
        fileInput.addEventListener('change', (event) => {
            uploadInBatches(event.target.files);
        });
    }
    if (gem) gem.addEventListener('click', toggleExpand);
    if (closeButton) closeButton.addEventListener('click', (e) => {
        if (e) e.stopPropagation();
        container.classList.remove('expanded');
    });
});
