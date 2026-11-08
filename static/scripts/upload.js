document.addEventListener('DOMContentLoaded', () => {
    const fileInput = document.getElementById('file-input');
    const uploadForm = document.getElementById('upload-form');
    const container = document.getElementById('upload-indicator-container');
    if (!fileInput || !container || !uploadForm) return;

    const gem = document.getElementById('upload-gem');
    const progressArc = document.getElementById('upload-progress-arc');
    const icon = document.getElementById('upload-indicator-icon');
    const percentageText = document.getElementById('upload-indicator-percentage');
    const speedBadge = document.getElementById('upload-speed-badge');

    const cardTitle = document.getElementById('upload-card-title');
    const fileList = document.getElementById('upload-file-list');
    const cardStatus = document.getElementById('upload-card-status');
    const closeButton = document.getElementById('upload-close-btn');

    const radius = progressArc.r.baseVal.value;
    const circumference = 2 * Math.PI * radius;
    progressArc.style.strokeDasharray = `${circumference} ${circumference}`;
    progressArc.style.strokeDashoffset = circumference;

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
        progressArc.style.strokeDashoffset = offset;
        percentageText.textContent = `${Math.round(clamped)}%`;
    }

    function toggleExpand(e) {
        if (e) e.stopPropagation();
        container.classList.toggle('expanded');
    }

    // Close floating menu when clicking outside
    document.addEventListener('click', (e) => {
        if (!container.contains(e.target)) {
            container.classList.remove('expanded');
        }
    });

    function clearEmptyPlaceholder() {
        const emptyItem = fileList.querySelector('.transfer-empty-item');
        if (emptyItem) emptyItem.remove();
    }

    // Expose global helper so selection.js ZIP downloads and direct file downloads appear in the top-right Transfer Center
    window.registerTransferOperation = function ({ id, name, type, totalBytes }) {
        clearEmptyPlaceholder();
        let li = fileList.querySelector(`[data-op-id="${id}"]`);
        if (!li) {
            li = document.createElement('li');
            li.className = 'upload-file-item';
            li.dataset.opId = id;
            li.innerHTML = `
                <span class="material-icons">${type === 'download' ? 'download' : 'upload'}</span>
                <div class="file-info">
                    <span class="file-name">${name}</span>
                    <span class="file-status">In avvio...</span>
                </div>
            `;
            fileList.prepend(li);
        }
        gem.classList.add('is-uploading');
        icon.textContent = type === 'download' ? 'download' : 'upload';
        container.classList.add('expanded');
        return {
            update(loadedBytes, total, speedBps, statusLabel) {
                const pct = total > 0 ? (loadedBytes / total) * 100 : 0;
                setProgress(pct);
                if (speedBadge) {
                    speedBadge.textContent = `${formatSpeed(speedBps)} • ${formatBytes(loadedBytes)} / ${formatBytes(total)}`;
                }
                const st = li.querySelector('.file-status');
                if (st) {
                    st.textContent = statusLabel || `${Math.round(pct)}% • ${formatBytes(loadedBytes)} / ${formatBytes(total)} (${formatSpeed(speedBps)})`;
                }
                cardTitle.textContent = type === 'download' ? 'Scaricamento in corso...' : 'Caricamento in corso...';
            },
            complete(finalBytes, elapsedSec) {
                setProgress(100);
                gem.classList.remove('is-uploading');
                icon.textContent = 'swap_vert';
                const avgSpeed = elapsedSec > 0 ? finalBytes / elapsedSec : finalBytes;
                if (speedBadge) {
                    speedBadge.textContent = `Completato • ${formatBytes(finalBytes)} (${formatSpeed(avgSpeed)})`;
                }
                const st = li.querySelector('.file-status');
                if (st) {
                    st.textContent = `Completato • ${formatBytes(finalBytes)}`;
                    st.classList.add('completed');
                }
                cardTitle.textContent = 'Operazione Completata';
                cardStatus.textContent = `${name} completato (${formatBytes(finalBytes)})`;
            },
            fail(errMsg) {
                gem.classList.remove('is-uploading');
                icon.textContent = 'error';
                const st = li.querySelector('.file-status');
                if (st) {
                    st.textContent = `Errore: ${errMsg}`;
                    st.classList.add('error');
                }
                cardTitle.textContent = 'Errore Trasferimento';
                cardStatus.textContent = errMsg;
            }
        };
    };

    window.trackDirectDownload = function (_event, filename, sizeBytes) {
        const tracker = window.registerTransferOperation({
            id: `dl_${Date.now()}`,
            name: filename,
            type: 'download',
            totalBytes: sizeBytes || 0
        });
        tracker.update(sizeBytes || 0, sizeBytes || 0, (sizeBytes || 1024 * 512) * 2, 'Download avviato...');
        setTimeout(() => tracker.complete(sizeBytes || 0, 0.4), 600);
    };

    function showInitialUI(files, totalBytes) {
        clearEmptyPlaceholder();
        files.forEach(file => {
            const li = document.createElement('li');
            li.className = 'upload-file-item';
            li.innerHTML = `
                <span class="material-icons">upload_file</span>
                <div class="file-info">
                    <span class="file-name">${file.name}</span>
                    <span class="file-status">In coda • ${formatBytes(file.size)}</span>
                </div>
            `;
            li.dataset.filename = file.name;
            fileList.prepend(li);
        });

        icon.textContent = 'upload';
        gem.classList.add('is-uploading');
        setProgress(0);
        cardTitle.textContent = `Caricamento (${files.length} file)`;
        if (speedBadge) {
            speedBadge.textContent = `0 KB/s • 0 B / ${formatBytes(totalBytes)}`;
        }
        cardStatus.textContent = `Invio di ${files.length} file (${formatBytes(totalBytes)})...`;
        progressArc.style.stroke = 'var(--primary)';
        container.classList.add('expanded');
    }

    function uploadSingleBatch(formData, batchFiles, batchNum, totalBatches, previouslyLoadedBytes, grandTotalBytes) {
        return new Promise((resolve, reject) => {
            const xhr = new XMLHttpRequest();
            const startTime = performance.now();
            xhr.open('POST', '/upload', true);

            xhr.upload.onprogress = (e) => {
                if (e.lengthComputable) {
                    const elapsedSec = Math.max(0.05, (performance.now() - startTime) / 1000);
                    const speedBps = e.loaded / elapsedSec;
                    const currentTotalLoaded = Math.min(grandTotalBytes, previouslyLoadedBytes + e.loaded);
                    const overallPct = grandTotalBytes > 0 ? (currentTotalLoaded / grandTotalBytes) * 100 : (e.loaded / e.total) * 100;

                    setProgress(overallPct);
                    if (speedBadge) {
                        speedBadge.textContent = `${formatSpeed(speedBps)} • ${formatBytes(currentTotalLoaded)} / ${formatBytes(grandTotalBytes)}`;
                    }
                    cardStatus.textContent = `Pacchetto ${batchNum}/${totalBatches}: ${Math.round(overallPct)}% (${formatSpeed(speedBps)})`;

                    batchFiles.forEach(file => {
                        const fileItem = fileList.querySelector(`[data-filename="${CSS.escape(file.name)}"]`);
                        if (fileItem) {
                            fileItem.querySelector('.file-status').textContent = `In corso • ${formatBytes(file.size)} (${formatSpeed(speedBps)})`;
                        }
                    });
                }
            };

            xhr.onload = () => {
                if (xhr.status === 200) {
                    batchFiles.forEach(file => {
                        const fileItem = fileList.querySelector(`[data-filename="${CSS.escape(file.name)}"]`);
                        if (fileItem) {
                            const statusEl = fileItem.querySelector('.file-status');
                            statusEl.textContent = `Completato • ${formatBytes(file.size)}`;
                            statusEl.classList.add('completed');
                        }
                    });
                    resolve();
                } else {
                    let errorMsg = `Errore server: ${xhr.status}`;
                    try {
                        errorMsg = JSON.parse(xhr.responseText).error || errorMsg;
                    } catch (_e) {}
                    reject(new Error(errorMsg));
                }
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
        showInitialUI(allFiles, grandTotalBytes);

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

                cardTitle.textContent = `Caricamento ${batchNum}/${totalBatches}...`;

                await uploadSingleBatch(formData, batch, batchNum, totalBatches, uploadedBytesSoFar, grandTotalBytes);
                uploadedBytesSoFar += batchBytes;
                setProgress(grandTotalBytes > 0 ? (uploadedBytesSoFar / grandTotalBytes) * 100 : 100);
            }

            const totalElapsedSec = Math.max(0.1, (performance.now() - startOverall) / 1000);
            const avgSpeed = grandTotalBytes / totalElapsedSec;

            gem.classList.remove('is-uploading');
            icon.textContent = 'check_circle';
            cardTitle.textContent = 'Caricamento Completato';
            if (speedBadge) {
                speedBadge.textContent = `${formatSpeed(avgSpeed)} • ${formatBytes(grandTotalBytes)} / ${formatBytes(grandTotalBytes)}`;
            }
            cardStatus.textContent = `Caricati ${allFiles.length} file (${formatBytes(grandTotalBytes)})!`;

            setTimeout(() => {
                window.location.reload();
            }, 1200);
        } catch (error) {
            gem.classList.remove('is-uploading');
            icon.textContent = 'error';
            progressArc.style.stroke = 'var(--error)';
            cardTitle.textContent = 'Caricamento Fallito';
            cardStatus.textContent = error.message;

            fileList.querySelectorAll('.file-status').forEach(statusEl => {
                if (!statusEl.classList.contains('completed')) {
                    statusEl.textContent = 'Fallito';
                    statusEl.classList.add('error');
                }
            });
        } finally {
            uploadForm.reset();
        }
    }

    fileInput.addEventListener('change', (event) => {
        uploadInBatches(event.target.files);
    });
    gem.addEventListener('click', toggleExpand);
    closeButton.addEventListener('click', toggleExpand);
});
