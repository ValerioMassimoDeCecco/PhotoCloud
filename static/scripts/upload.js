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

    function uploadSingleBatch(formData, batchFiles, batchNum, totalBatches, previouslyLoadedBytes, grandTotalBytes, tracker) {
        return new Promise((resolve, reject) => {
            const xhr = new XMLHttpRequest();
            const startTime = performance.now();
            xhr.open('POST', '/upload', true);

            if (tracker && typeof tracker.setCancelHandler === 'function') {
                tracker.setCancelHandler(() => {
                    xhr.abort();
                });
            }

            xhr.upload.onprogress = (e) => {
                if (e.lengthComputable) {
                    const elapsedSec = Math.max(0.05, (performance.now() - startTime) / 1000);
                    const speedBps = e.loaded / elapsedSec;
                    const currentTotalLoaded = Math.min(grandTotalBytes, previouslyLoadedBytes + e.loaded);
                    const overallPct = grandTotalBytes > 0 ? (currentTotalLoaded / grandTotalBytes) * 100 : (e.loaded / e.total) * 100;

                    tracker.update(
                        currentTotalLoaded,
                        grandTotalBytes,
                        speedBps,
                        totalBatches > 1
                            ? `Pacchetto ${batchNum}/${totalBatches} • ${Math.round(overallPct)}% (${formatSpeed(speedBps)})`
                            : `${Math.round(overallPct)}% • ${formatBytes(currentTotalLoaded)} / ${formatBytes(grandTotalBytes)} (${formatSpeed(speedBps)})`
                    );
                }
            };

            xhr.onload = () => {
                if (xhr.status === 200) {
                    resolve();
                } else {
                    let errorMsg = `Errore server: ${xhr.status}`;
                    try {
                        errorMsg = JSON.parse(xhr.responseText).error || errorMsg;
                    } catch (_e) {}
                    reject(new Error(errorMsg));
                }
            };

            xhr.onabort = () => {
                const abortErr = new Error('Trasferimento annullato dall\'utente.');
                abortErr.isCancelled = true;
                reject(abortErr);
            };

            xhr.onerror = () => {
                reject(new Error('Errore di rete. Impossibile connettersi al server.'));
            };

            xhr.send(formData);
        });
    }

    async function uploadInBatches(files) {
        if (!files || files.length === 0) return;

        const allFiles = Array.from(files);
        const grandTotalBytes = allFiles.reduce((acc, f) => acc + (f.size || 0), 0);
        const opTitle = allFiles.length === 1 ? allFiles[0].name : `Caricamento (${allFiles.length} file)`;

        const tracker = window.registerTransferOperation({
            id: `up_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
            name: opTitle,
            type: 'upload',
            totalBytes: grandTotalBytes
        });

        const batchSize = 25;
        let uploadedBytesSoFar = 0;
        const startOverall = performance.now();

        try {
            for (let i = 0; i < allFiles.length; i += batchSize) {
                const batch = allFiles.slice(i, i + batchSize);
                const batchBytes = batch.reduce((acc, f) => acc + (f.size || 0), 0);
                const formData = new FormData();

                batch.forEach(file => {
                    formData.append('file[]', file, file.name);
                    formData.append('timestamp[]', file.lastModified);
                });

                const activeAlbum = window.currentSelectedAlbumFilter || '';
                if (activeAlbum) {
                    formData.append('album', activeAlbum);
                }

                const batchNum = Math.floor(i / batchSize) + 1;
                const totalBatches = Math.ceil(allFiles.length / batchSize);

                await uploadSingleBatch(formData, batch, batchNum, totalBatches, uploadedBytesSoFar, grandTotalBytes, tracker);
                uploadedBytesSoFar += batchBytes;
            }

            const totalElapsedSec = Math.max(0.1, (performance.now() - startOverall) / 1000);
            tracker.complete(grandTotalBytes, totalElapsedSec);

            // Reload only when no other transfers are running
            setTimeout(() => {
                const state = window.getTransferCenterState ? window.getTransferCenterState() : { runningCount: 0 };
                if (state.runningCount === 0) {
                    window.location.reload();
                }
            }, 750);
        } catch (error) {
            if (error && error.isCancelled) {
                tracker.cancel('Annullato dall\'utente');
            } else {
                tracker.fail(error.message || 'Errore caricamento');
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
