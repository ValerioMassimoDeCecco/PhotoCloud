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
    // Map<opId, { id, name, type, loadedBytes, totalBytes, speedBps, status: 'running'|'paused'|'completed'|'failed'|'cancelled', cancelFn?: () => void, pauseFn?: () => void, resumeFn?: () => void }>
    const operationsState = new Map();
    let autoCloseTimeoutId = null;
    let pickedDirectoryHandle = null;

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
        const activeOps = allOps.filter(op => op.status === 'running' || op.status === 'paused');
        const runningOps = allOps.filter(op => op.status === 'running');
        const pausedOps = allOps.filter(op => op.status === 'paused');
        const activeCount = activeOps.length;

        if (activeCount > 0) {
            cancelPendingAutoClose();
            // Show discreet top-right icon WITHOUT auto-expanding the floating card
            container.classList.add('has-active-transfers');
            gem.classList.add('is-uploading');
            if (progressArc) {
                progressArc.style.stroke = runningOps.length === 0 && pausedOps.length > 0
                    ? '#F59E0B'
                    : 'var(--primary)';
            }

            if (activeCountBadge) {
                activeCountBadge.textContent = String(activeCount);
                activeCountBadge.style.display = activeCount > 1 ? 'inline-flex' : 'none';
            }

            const totalBytes = activeOps.reduce((sum, op) => sum + Math.max(0, op.totalBytes || 0), 0);
            const loadedBytes = activeOps.reduce((sum, op) => sum + Math.max(0, op.loadedBytes || 0), 0);
            const totalSpeed = runningOps.reduce((sum, op) => sum + Math.max(0, op.speedBps || 0), 0);
            const overallPct = totalBytes > 0 ? (loadedBytes / totalBytes) * 100 : 0;

            setProgress(overallPct);

            const hasUpload = activeOps.some(op => op.type === 'upload');
            const hasDownload = activeOps.some(op => op.type === 'download');
            if (icon) {
                if (runningOps.length === 0 && pausedOps.length > 0) {
                    icon.textContent = 'pause';
                } else {
                    icon.textContent = hasUpload && hasDownload ? 'swap_vert' : (hasUpload ? 'upload' : 'download');
                }
            }

            if (speedBadge) {
                speedBadge.textContent = runningOps.length === 0 && pausedOps.length > 0
                    ? `In pausa • ${formatBytes(loadedBytes)} / ${formatBytes(totalBytes)}`
                    : `${formatSpeed(totalSpeed)} • ${formatBytes(loadedBytes)} / ${formatBytes(totalBytes)}`;
            }
            if (cardTitle) {
                if (runningOps.length === 0 && pausedOps.length > 0) {
                    cardTitle.textContent = `${pausedOps.length} trasferimenti in pausa`;
                } else {
                    cardTitle.textContent = activeCount === 1
                        ? (activeOps[0].type === 'download' ? 'Scaricamento in corso...' : 'Caricamento in corso...')
                        : `${activeCount} trasferimenti attivi`;
                }
            }
            if (cardStatus) {
                cardStatus.textContent = runningOps.length === 0 && pausedOps.length > 0
                    ? `In pausa • ${Math.round(overallPct)}%`
                    : `${runningOps.length} in corso • ${Math.round(overallPct)}% (${formatSpeed(totalSpeed)})`;
            }
        } else {
            gem.classList.remove('is-uploading');
            if (activeCountBadge) {
                activeCountBadge.style.display = 'none';
                activeCountBadge.textContent = '0';
            }

            cancelPendingAutoClose();
            autoCloseTimeoutId = setTimeout(() => {
                const stillActive = Array.from(operationsState.values()).some(
                    op => op.status === 'running' || op.status === 'paused'
                );
                if (!stillActive) {
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

    function ensureEmptyPlaceholderIfNoItems() {
        if (!fileList) return;
        if (fileList.children.length === 0) {
            const emptyLi = document.createElement('li');
            emptyLi.className = 'transfer-empty-item';
            emptyLi.textContent = 'Nessun trasferimento attivo';
            fileList.appendChild(emptyLi);
        }
    }

    // Expose global helper for inspection and testing
    window.getTransferCenterState = function () {
        const allOps = Array.from(operationsState.values());
        const runningOps = allOps.filter(op => op.status === 'running');
        const pausedOps = allOps.filter(op => op.status === 'paused');
        return {
            runningCount: runningOps.length,
            pausedCount: pausedOps.length,
            totalTracked: allOps.length,
            isExpanded: container.classList.contains('expanded'),
            isIndicatorVisible: container.classList.contains('has-active-transfers')
        };
    };

    window.pauseTransferOperation = function (opId) {
        const opRecord = operationsState.get(opId);
        if (!opRecord || opRecord.status !== 'running') return false;
        opRecord.status = 'paused';
        opRecord.speedBps = 0;
        if (typeof opRecord.pauseFn === 'function') {
            opRecord.pauseFn();
        }
        const li = fileList ? fileList.querySelector(`[data-op-id="${CSS.escape(opId)}"]`) : null;
        if (li) {
            const pauseIcon = li.querySelector('.transfer-pause-btn .material-icons');
            if (pauseIcon) pauseIcon.textContent = 'play_arrow';
            const pauseBtn = li.querySelector('.transfer-pause-btn');
            if (pauseBtn) pauseBtn.title = 'Riprendi trasferimento';
            const st = li.querySelector('.file-status');
            const pct = opRecord.totalBytes > 0 ? Math.round((opRecord.loadedBytes / opRecord.totalBytes) * 100) : 0;
            if (st) st.textContent = `In pausa • ${pct}% (${formatBytes(opRecord.loadedBytes)} / ${formatBytes(opRecord.totalBytes)})`;
        }
        syncGlobalTransferIndicator();
        return true;
    };

    window.resumeTransferOperation = function (opId) {
        const opRecord = operationsState.get(opId);
        if (!opRecord || opRecord.status !== 'paused') return false;
        opRecord.status = 'running';
        if (typeof opRecord.resumeFn === 'function') {
            opRecord.resumeFn();
        }
        const li = fileList ? fileList.querySelector(`[data-op-id="${CSS.escape(opId)}"]`) : null;
        if (li) {
            const pauseIcon = li.querySelector('.transfer-pause-btn .material-icons');
            if (pauseIcon) pauseIcon.textContent = 'pause';
            const pauseBtn = li.querySelector('.transfer-pause-btn');
            if (pauseBtn) pauseBtn.title = 'Metti in pausa';
            const st = li.querySelector('.file-status');
            const pct = opRecord.totalBytes > 0 ? Math.round((opRecord.loadedBytes / opRecord.totalBytes) * 100) : 0;
            if (st) st.textContent = `Ripresa in corso... • ${pct}%`;
        }
        syncGlobalTransferIndicator();
        return true;
    };

    window.deleteTransferOperation = function (opId) {
        const opRecord = operationsState.get(opId);
        if (opRecord) {
            if ((opRecord.status === 'running' || opRecord.status === 'paused') && typeof opRecord.cancelFn === 'function') {
                opRecord.cancelFn();
            }
            opRecord.status = 'cancelled';
            operationsState.delete(opId);
        }
        const li = fileList ? fileList.querySelector(`[data-op-id="${CSS.escape(opId)}"]`) : null;
        if (li) li.remove();
        ensureEmptyPlaceholderIfNoItems();
        syncGlobalTransferIndicator();
        return true;
    };

    // Expose global helper so ZIP downloads, direct downloads, photo editor saves, and batch uploads share the same Transfer Center
    window.registerTransferOperation = function ({ id, name, type, totalBytes, onCancel, onPause, onResume }) {
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
            cancelFn: typeof onCancel === 'function' ? onCancel : null,
            pauseFn: typeof onPause === 'function' ? onPause : null,
            resumeFn: typeof onResume === 'function' ? onResume : null
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
                <div class="transfer-item-actions" style="display: inline-flex; align-items: center; gap: 4px;">
                    <button type="button" class="btn icon transfer-pause-btn" title="Metti in pausa" style="width: 28px; height: 28px;">
                        <span class="material-icons" style="font-size: 16px;">pause</span>
                    </button>
                    <button type="button" class="btn icon transfer-delete-btn transfer-cancel-btn" title="Elimina trasferimento" style="width: 28px; height: 28px;">
                        <span class="material-icons" style="font-size: 16px;">delete_outline</span>
                    </button>
                </div>
            `;
            li.querySelector('.file-name').textContent = opRecord.name;

            const pauseBtn = li.querySelector('.transfer-pause-btn');
            if (pauseBtn) {
                pauseBtn.addEventListener('click', (ev) => {
                    ev.stopPropagation();
                    if (opRecord.status === 'running') {
                        window.pauseTransferOperation(opId);
                    } else if (opRecord.status === 'paused') {
                        window.resumeTransferOperation(opId);
                    }
                });
            }

            const deleteBtn = li.querySelector('.transfer-delete-btn');
            if (deleteBtn) {
                deleteBtn.addEventListener('click', (ev) => {
                    ev.stopPropagation();
                    window.deleteTransferOperation(opId);
                });
            }

            fileList.prepend(li);
        }

        // IMPORTANT: Do NOT auto-expand container! Only show the discreet active indicator.
        syncGlobalTransferIndicator();

        return {
            id: opId,
            isPaused() {
                return opRecord.status === 'paused';
            },
            setCancelHandler(fn) {
                opRecord.cancelFn = fn;
            },
            setPauseResumeHandlers(pauseFn, resumeFn) {
                opRecord.pauseFn = pauseFn;
                opRecord.resumeFn = resumeFn;
            },
            update(loadedBytes, total, speedBps, statusLabel) {
                if (opRecord.status !== 'running' && opRecord.status !== 'paused') return;
                opRecord.loadedBytes = Math.max(0, loadedBytes || 0);
                opRecord.totalBytes = Math.max(opRecord.loadedBytes, total || opRecord.totalBytes || 0);
                opRecord.speedBps = opRecord.status === 'paused' ? 0 : Math.max(0, speedBps || 0);

                const pct = opRecord.totalBytes > 0 ? (opRecord.loadedBytes / opRecord.totalBytes) * 100 : 0;
                const st = li ? li.querySelector('.file-status') : null;
                if (st) {
                    if (opRecord.status === 'paused') {
                        st.textContent = `In pausa • ${Math.round(pct)}% (${formatBytes(opRecord.loadedBytes)} / ${formatBytes(opRecord.totalBytes)})`;
                    } else {
                        st.textContent = statusLabel || `${Math.round(pct)}% • ${formatBytes(opRecord.loadedBytes)} / ${formatBytes(opRecord.totalBytes)} (${formatSpeed(opRecord.speedBps)})`;
                    }
                }
                syncGlobalTransferIndicator();
            },
            complete(finalBytes, elapsedSec) {
                const resolvedBytes = finalBytes !== undefined ? finalBytes : opRecord.totalBytes;
                opRecord.loadedBytes = resolvedBytes;
                opRecord.totalBytes = resolvedBytes;
                opRecord.speedBps = elapsedSec > 0 ? resolvedBytes / elapsedSec : opRecord.speedBps;
                opRecord.status = 'completed';

                const pauseBtn = li ? li.querySelector('.transfer-pause-btn') : null;
                if (pauseBtn) pauseBtn.style.display = 'none';

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

                const pauseBtn = li ? li.querySelector('.transfer-pause-btn') : null;
                if (pauseBtn) pauseBtn.style.display = 'none';

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

                const pauseBtn = li ? li.querySelector('.transfer-pause-btn') : null;
                if (pauseBtn) pauseBtn.style.display = 'none';

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

    // =========================================================================
    // === PARALLEL TRANSFERS & DOWNLOAD DIRECTORY / PACKAGING PREFERENCES
    // =========================================================================
    const PARALLEL_STORAGE_KEY = 'photocloud_max_parallel_transfers';
    const UPLOAD_PACKAGING_KEY = 'photocloud_upload_packaging_mode';
    const DOWNLOAD_PACKAGING_KEY = 'photocloud_download_packaging_mode';
    const DOWNLOAD_DIR_MODE_KEY = 'photocloud_download_directory_mode';
    const PHOTO_DIR_MODE_KEY = 'photocloud_photo_download_dir_mode';
    const VIDEO_DIR_MODE_KEY = 'photocloud_video_download_dir_mode';
    const FILE_DIR_MODE_KEY = 'photocloud_file_download_dir_mode';
    const DOWNLOAD_SUBFOLDER_KEY = 'photocloud_custom_download_subfolder';

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

    window.getTransferPreferences = function () {
        try {
            return {
                uploadPackagingMode: localStorage.getItem(UPLOAD_PACKAGING_KEY) || 'ASK_ALWAYS',
                downloadPackagingMode: localStorage.getItem(DOWNLOAD_PACKAGING_KEY) || 'ASK_ALWAYS',
                downloadDirectoryMode: localStorage.getItem(DOWNLOAD_DIR_MODE_KEY) || 'AUTO_BY_TYPE',
                photoDownloadDirMode: localStorage.getItem(PHOTO_DIR_MODE_KEY) || 'AUTO_BY_TYPE',
                videoDownloadDirMode: localStorage.getItem(VIDEO_DIR_MODE_KEY) || 'AUTO_BY_TYPE',
                fileDownloadDirMode: localStorage.getItem(FILE_DIR_MODE_KEY) || 'AUTO_BY_TYPE',
                customDownloadSubfolder: localStorage.getItem(DOWNLOAD_SUBFOLDER_KEY) || 'PhotoCloud'
            };
        } catch (_e) {
            return {
                uploadPackagingMode: 'ASK_ALWAYS',
                downloadPackagingMode: 'ASK_ALWAYS',
                downloadDirectoryMode: 'AUTO_BY_TYPE',
                photoDownloadDirMode: 'AUTO_BY_TYPE',
                videoDownloadDirMode: 'AUTO_BY_TYPE',
                fileDownloadDirMode: 'AUTO_BY_TYPE',
                customDownloadSubfolder: 'PhotoCloud'
            };
        }
    };

    window.setTransferPreferences = function (partial) {
        const current = window.getTransferPreferences();
        const next = { ...current, ...(partial || {}) };
        try {
            localStorage.setItem(UPLOAD_PACKAGING_KEY, next.uploadPackagingMode);
            localStorage.setItem(DOWNLOAD_PACKAGING_KEY, next.downloadPackagingMode);
            localStorage.setItem(DOWNLOAD_DIR_MODE_KEY, next.downloadDirectoryMode);
            localStorage.setItem(PHOTO_DIR_MODE_KEY, next.photoDownloadDirMode);
            localStorage.setItem(VIDEO_DIR_MODE_KEY, next.videoDownloadDirMode);
            localStorage.setItem(FILE_DIR_MODE_KEY, next.fileDownloadDirMode);
            localStorage.setItem(DOWNLOAD_SUBFOLDER_KEY, next.customDownloadSubfolder || 'PhotoCloud');
        } catch (_e) {}
        syncTransferPreferencesSettingsUI(next);
        return next;
    };

    window.resolveCategoryTargetDirectory = function (filename, overrideGlobalMode) {
        const prefs = window.getTransferPreferences();
        const globalMode = overrideGlobalMode || prefs.downloadDirectoryMode || 'AUTO_BY_TYPE';
        const subfolder = (prefs.customDownloadSubfolder || 'PhotoCloud').replace(/^\/+|\/+$/g, '') || 'PhotoCloud';
        const ext = (String(filename || '').split('.').pop() || '').toLowerCase();
        const isPhoto = ['jpg', 'jpeg', 'png', 'webp', 'gif', 'bmp', 'heic', 'heif', 'avif', 'svg'].includes(ext);
        const isVideo = ['mp4', 'mov', 'webm', 'avi', 'mkv', 'm4v', '3gp'].includes(ext);
        const isAudio = ['mp3', 'wav', 'ogg', 'm4a', 'flac', 'aac', 'opus'].includes(ext);

        let effective = globalMode;
        if (globalMode === 'AUTO_BY_TYPE') {
            if (isPhoto) {
                effective = prefs.photoDownloadDirMode === 'AUTO_BY_TYPE' ? 'PICTURES' : prefs.photoDownloadDirMode;
            } else if (isVideo) {
                effective = prefs.videoDownloadDirMode === 'AUTO_BY_TYPE' ? 'MOVIES' : prefs.videoDownloadDirMode;
            } else if (isAudio) {
                effective = 'MUSIC';
            } else {
                effective = prefs.fileDownloadDirMode === 'AUTO_BY_TYPE' ? 'DOWNLOADS' : prefs.fileDownloadDirMode;
            }
        }

        const baseFolderMap = {
            PICTURES: 'Pictures',
            MOVIES: 'Movies',
            MUSIC: 'Music',
            DOCUMENTS: 'Documents',
            DOWNLOADS: 'Download',
            CUSTOM_FOLDER: 'Custom'
        };
        const rootFolder = baseFolderMap[effective] || 'Download';
        return {
            mode: effective,
            rootFolder,
            subfolder,
            relativePath: `${rootFolder}/${subfolder}/${filename}`
        };
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

    function syncTransferPreferencesSettingsUI(prefsInput) {
        const prefs = prefsInput || window.getTransferPreferences();
        const upSel = document.getElementById('settings-upload-packaging-select');
        const dlSel = document.getElementById('settings-download-packaging-select');
        const dirModeSel = document.getElementById('settings-download-dir-mode-select');
        const photoDirSel = document.getElementById('settings-photo-dir-select');
        const videoDirSel = document.getElementById('settings-video-dir-select');
        const fileDirSel = document.getElementById('settings-file-dir-select');
        const subInput = document.getElementById('settings-download-subfolder-input');
        const dirStatus = document.getElementById('settings-picked-dir-status');

        if (upSel) upSel.value = prefs.uploadPackagingMode;
        if (dlSel) dlSel.value = prefs.downloadPackagingMode;
        if (dirModeSel) dirModeSel.value = prefs.downloadDirectoryMode;
        if (photoDirSel) photoDirSel.value = prefs.photoDownloadDirMode;
        if (videoDirSel) videoDirSel.value = prefs.videoDownloadDirMode;
        if (fileDirSel) fileDirSel.value = prefs.fileDownloadDirMode;
        if (subInput && document.activeElement !== subInput) {
            subInput.value = prefs.customDownloadSubfolder || 'PhotoCloud';
        }
        if (dirStatus) {
            if (pickedDirectoryHandle && pickedDirectoryHandle.name) {
                dirStatus.textContent = `Cartella selezionata: ${pickedDirectoryHandle.name}/${prefs.customDownloadSubfolder || 'PhotoCloud'}`;
            } else if (prefs.downloadDirectoryMode === 'AUTO_BY_TYPE') {
                dirStatus.textContent = `Automatica per tipo (Pictures / Movies / Download → ${prefs.customDownloadSubfolder || 'PhotoCloud'})`;
            } else {
                dirStatus.textContent = `Directory: ${prefs.downloadDirectoryMode} (${prefs.customDownloadSubfolder || 'PhotoCloud'})`;
            }
        }
    }

    async function pickDeviceDownloadDirectory() {
        if (typeof window.showDirectoryPicker === 'function') {
            try {
                pickedDirectoryHandle = await window.showDirectoryPicker({ mode: 'readwrite' });
                window.setTransferPreferences({ downloadDirectoryMode: 'CUSTOM_FOLDER' });
                return pickedDirectoryHandle;
            } catch (_e) {
                return null;
            }
        }
        return null;
    }

    function bindParallelTransferSettingsUI() {
        const card = document.getElementById('settings-parallel-transfers-card');
        if (!card || card.dataset.bound === 'true') return;
        card.dataset.bound = 'true';

        syncParallelTransferSettingsUI();
        syncTransferPreferencesSettingsUI();

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

        const upSel = document.getElementById('settings-upload-packaging-select');
        const dlSel = document.getElementById('settings-download-packaging-select');
        const dirModeSel = document.getElementById('settings-download-dir-mode-select');
        const photoDirSel = document.getElementById('settings-photo-dir-select');
        const videoDirSel = document.getElementById('settings-video-dir-select');
        const fileDirSel = document.getElementById('settings-file-dir-select');
        const subInput = document.getElementById('settings-download-subfolder-input');
        const pickDirBtn = document.getElementById('settings-pick-download-dir-btn');

        if (upSel) {
            upSel.addEventListener('change', () => window.setTransferPreferences({ uploadPackagingMode: upSel.value }));
        }
        if (dlSel) {
            dlSel.addEventListener('change', () => window.setTransferPreferences({ downloadPackagingMode: dlSel.value }));
        }
        if (dirModeSel) {
            dirModeSel.addEventListener('change', () => window.setTransferPreferences({ downloadDirectoryMode: dirModeSel.value }));
        }
        if (photoDirSel) {
            photoDirSel.addEventListener('change', () => window.setTransferPreferences({ photoDownloadDirMode: photoDirSel.value }));
        }
        if (videoDirSel) {
            videoDirSel.addEventListener('change', () => window.setTransferPreferences({ videoDownloadDirMode: videoDirSel.value }));
        }
        if (fileDirSel) {
            fileDirSel.addEventListener('change', () => window.setTransferPreferences({ fileDownloadDirMode: fileDirSel.value }));
        }
        if (subInput) {
            subInput.addEventListener('change', () => {
                const cleaned = (subInput.value || 'PhotoCloud').trim() || 'PhotoCloud';
                window.setTransferPreferences({ customDownloadSubfolder: cleaned });
            });
        }
        if (pickDirBtn) {
            pickDirBtn.addEventListener('click', () => {
                pickDeviceDownloadDirectory();
            });
        }
    }

    bindParallelTransferSettingsUI();

    // =========================================================================
    // === PURE-JS STREAMING ZIP ARCHIVE BUILDER (FOR UPLOAD ARCHIVING)
    // =========================================================================
    const crcTable = (() => {
        const table = new Uint32Array(256);
        for (let n = 0; n < 256; n++) {
            let c = n;
            for (let k = 0; k < 8; k++) {
                c = (c & 1) ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1);
            }
            table[n] = c >>> 0;
        }
        return table;
    })();

    function crc32Uint8(bytes) {
        let crc = 0xFFFFFFFF;
        for (let i = 0; i < bytes.length; i++) {
            crc = crcTable[(crc ^ bytes[i]) & 0xFF] ^ (crc >>> 8);
        }
        return (crc ^ 0xFFFFFFFF) >>> 0;
    }

    async function createClientZipFile(files, archiveFilename, onProgress) {
        const encoder = new TextEncoder();
        const fileParts = [];
        const centralDirectoryParts = [];
        let offset = 0;
        let processedBytes = 0;
        const totalBytes = Array.from(files).reduce((s, f) => s + (f.size || 0), 0);

        for (let i = 0; i < files.length; i++) {
            const file = files[i];
            const rawName = (file.name || `file_${i + 1}`).replace(/\\/g, '/');
            const nameBytes = encoder.encode(rawName);
            const buf = await file.arrayBuffer();
            const dataBytes = new Uint8Array(buf);
            const crc = crc32Uint8(dataBytes);
            const size = dataBytes.byteLength;

            const localHeader = new ArrayBuffer(30 + nameBytes.length);
            const lv = new DataView(localHeader);
            lv.setUint32(0, 0x04034b50, true); // Local file header signature
            lv.setUint16(4, 20, true);         // Version needed
            lv.setUint16(6, 0x0800, true);     // UTF-8 flag
            lv.setUint16(8, 0, true);          // Store (no recompression of already-compressed JPEGs/MP4s)
            lv.setUint16(10, 0, true);
            lv.setUint16(12, 0, true);
            lv.setUint32(14, crc, true);
            lv.setUint32(18, size, true);
            lv.setUint32(22, size, true);
            lv.setUint16(26, nameBytes.length, true);
            lv.setUint16(28, 0, true);
            new Uint8Array(localHeader, 30).set(nameBytes);

            fileParts.push(localHeader, dataBytes);

            const centralHeader = new ArrayBuffer(46 + nameBytes.length);
            const cv = new DataView(centralHeader);
            cv.setUint32(0, 0x02014b50, true); // Central directory file header signature
            cv.setUint16(4, 20, true);
            cv.setUint16(6, 20, true);
            cv.setUint16(8, 0x0800, true);
            cv.setUint16(10, 0, true);
            cv.setUint16(12, 0, true);
            cv.setUint16(14, 0, true);
            cv.setUint32(16, crc, true);
            cv.setUint32(20, size, true);
            cv.setUint32(24, size, true);
            cv.setUint16(28, nameBytes.length, true);
            cv.setUint16(30, 0, true);
            cv.setUint16(32, 0, true);
            cv.setUint16(34, 0, true);
            cv.setUint16(36, 0, true);
            cv.setUint32(38, 0, true);
            cv.setUint32(42, offset, true);
            new Uint8Array(centralHeader, 46).set(nameBytes);

            centralDirectoryParts.push(centralHeader);
            offset += localHeader.byteLength + size;
            processedBytes += size;
            if (typeof onProgress === 'function') {
                onProgress(processedBytes, totalBytes, i + 1, files.length);
            }
        }

        const cdSize = centralDirectoryParts.reduce((s, p) => s + p.byteLength, 0);
        const eocd = new ArrayBuffer(22);
        const ev = new DataView(eocd);
        ev.setUint32(0, 0x06054b50, true);
        ev.setUint16(4, 0, true);
        ev.setUint16(6, 0, true);
        ev.setUint16(8, files.length, true);
        ev.setUint16(10, files.length, true);
        ev.setUint32(12, cdSize, true);
        ev.setUint32(16, offset, true);
        ev.setUint16(20, 0, true);

        const safeZipName = (archiveFilename || 'PhotoCloud_Archivio.zip').endsWith('.zip')
            ? archiveFilename
            : `${archiveFilename}.zip`;
        const zipBlob = new Blob([...fileParts, ...centralDirectoryParts, eocd], { type: 'application/zip' });
        return new File([zipBlob], safeZipName, { type: 'application/zip', lastModified: Date.now() });
    }

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
                const abortErr = new Error('Trasferimentointerrotto');
                abortErr.isAborted = true;
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
     * Supports real-time Pause / Resume, Delete / Cancel, and optional .zip archive packaging.
     */
    async function uploadInBatches(files, options = {}) {
        if (!files || files.length === 0) return;

        let allFiles = Array.from(files);
        const archiveAsZip = Boolean(options.archiveAsZip);
        const archiveName = options.archiveName || `PhotoCloud_${new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-')}.zip`;

        const parallelLimit = window.getMaxParallelTransfers();
        const initialTotalBytes = allFiles.reduce((acc, f) => acc + (f.size || 0), 0);
        const opTitle = archiveAsZip
            ? `Archivio ZIP (${allFiles.length} file)`
            : (allFiles.length === 1 ? allFiles[0].name : `Caricamento (${allFiles.length} file • ${parallelLimit}x)`);

        let isCancelledByUser = false;
        let isPausedByUser = false;
        let pauseWaitResolvers = [];
        const activeXhrs = new Set();

        const tracker = window.registerTransferOperation({
            id: `up_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
            name: opTitle,
            type: 'upload',
            totalBytes: initialTotalBytes,
            onCancel: () => {
                isCancelledByUser = true;
                isPausedByUser = false;
                pauseWaitResolvers.forEach(r => r());
                pauseWaitResolvers = [];
                activeXhrs.forEach((xhr) => {
                    try { xhr.abort(); } catch (_e) {}
                });
                activeXhrs.clear();
            },
            onPause: () => {
                isPausedByUser = true;
                activeXhrs.forEach((xhr) => {
                    try { xhr.abort(); } catch (_e) {}
                });
                activeXhrs.clear();
            },
            onResume: () => {
                isPausedByUser = false;
                const resolvers = pauseWaitResolvers.slice();
                pauseWaitResolvers = [];
                resolvers.forEach(r => r());
            }
        });

        async function waitIfPaused() {
            while (isPausedByUser && !isCancelledByUser) {
                await new Promise((resolve) => {
                    pauseWaitResolvers.push(resolve);
                });
            }
        }

        if (archiveAsZip) {
            try {
                const zipFile = await createClientZipFile(allFiles, archiveName, (done, total, idx, count) => {
                    tracker.update(
                        Math.round(done * 0.25),
                        total,
                        0,
                        `Creazione archivio .zip (${idx}/${count} file)...`
                    );
                });
                allFiles = [zipFile];
            } catch (zipErr) {
                tracker.fail((zipErr && zipErr.message) || 'Errore creazione archivio .zip');
                return;
            }
        }

        const totalFilesCount = allFiles.length;
        const grandTotalBytes = allFiles.reduce((acc, f) => acc + (f.size || 0), 0);

        // Build byte-aware micro-batches (max 2 files and max 18 MB per XHR request)
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
        const batchLoadedBytes = new Array(totalBatches).fill(0);
        let completedFilesCount = 0;
        let failedFilesCount = 0;
        let latestMediaFiles = null;
        let firstErrorMessage = '';
        const startOverall = performance.now();

        function emitCombinedProgress() {
            if (isCancelledByUser) return;
            let loadedSum = 0;
            for (let i = 0; i < batchLoadedBytes.length; i++) {
                loadedSum += batchLoadedBytes[i];
            }
            const currentTotalLoaded = grandTotalBytes > 0 ? Math.min(grandTotalBytes, loadedSum) : loadedSum;
            const elapsedSec = Math.max(0.08, (performance.now() - startOverall) / 1000);
            const speedBps = isPausedByUser ? 0 : currentTotalLoaded / elapsedSec;
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
                await waitIfPaused();
                if (isCancelledByUser) break;

                const batchIdx = nextBatchIndex++;
                if (batchIdx >= totalBatches) break;

                const micro = microBatches[batchIdx];
                const expectedBytes = micro.totalBytes;
                let attempt = 0;
                let batchSucceeded = false;

                while (attempt < 2 && !batchSucceeded && !isCancelledByUser) {
                    await waitIfPaused();
                    if (isCancelledByUser) break;

                    attempt++;
                    const formData = new FormData();
                    micro.files.forEach((file) => {
                        formData.append('file[]', file, file.name);
                        formData.append('timestamp[]', file.lastModified || Date.now());
                    });
                    if (activeAlbum) {
                        formData.append('album', activeAlbum);
                    }
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
                        if (isCancelledByUser) {
                            throw err;
                        }
                        if (isPausedByUser || (err && err.isAborted && isPausedByUser)) {
                            // Batch was aborted because user paused: reset attempt so it resumes cleanly on unpause
                            attempt--;
                            batchLoadedBytes[batchIdx] = 0;
                            await waitIfPaused();
                            continue;
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
            if (isCancelledByUser) {
                tracker.cancel('Annullato dall\'utente');
            } else {
                tracker.fail((error && error.message) || 'Errore caricamento');
            }
        } finally {
            if (uploadForm) uploadForm.reset();
        }
    }

    // =========================================================================
    // === DIRECT MULTI-FILE DOWNLOAD ENGINE WITH DIRECTORY & PAUSE/CANCEL SUPPORT
    // =========================================================================
    async function saveBlobToChosenDirectory(blob, filename, dirInfo) {
        if (pickedDirectoryHandle && typeof pickedDirectoryHandle.getDirectoryHandle === 'function') {
            try {
                let targetDir = pickedDirectoryHandle;
                if (dirInfo && dirInfo.mode !== 'CUSTOM_FOLDER' && dirInfo.rootFolder) {
                    targetDir = await targetDir.getDirectoryHandle(dirInfo.rootFolder, { create: true });
                }
                if (dirInfo && dirInfo.subfolder) {
                    const parts = dirInfo.subfolder.split('/').filter(Boolean);
                    for (const part of parts) {
                        targetDir = await targetDir.getDirectoryHandle(part, { create: true });
                    }
                }
                const fileHandle = await targetDir.getFileHandle(filename, { create: true });
                const writable = await fileHandle.createWritable();
                await writable.write(blob);
                await writable.close();
                return true;
            } catch (_e) {
                // Fall back to browser download below
            }
        }
        const blobUrl = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = blobUrl;
        a.download = filename;
        a.style.display = 'none';
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        setTimeout(() => URL.revokeObjectURL(blobUrl), 5000);
        return true;
    }

    window.downloadFilesDirectInParallel = async function (filenames, options = {}) {
        const list = Array.isArray(filenames) ? filenames : [];
        if (list.length === 0) return;

        const fromTrash = Boolean(options.fromTrash);
        const dirModeOverride = options.dirMode || window.getTransferPreferences().downloadDirectoryMode;
        const parallelLimit = window.getMaxParallelTransfers();
        let isCancelledByUser = false;
        let isPausedByUser = false;
        let pauseWaitResolvers = [];
        const activeControllers = new Set();

        const opTitle = list.length === 1
            ? `Download: ${list[0]}`
            : `Scaricamento diretto (${list.length} file • ${parallelLimit}x)`;

        const tracker = window.registerTransferOperation({
            id: `dl_batch_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
            name: opTitle,
            type: 'download',
            totalBytes: list.length * 1024 * 256,
            onCancel: () => {
                isCancelledByUser = true;
                isPausedByUser = false;
                pauseWaitResolvers.forEach(r => r());
                pauseWaitResolvers = [];
                activeControllers.forEach((ctrl) => {
                    try { ctrl.abort(); } catch (_e) {}
                });
                activeControllers.clear();
            },
            onPause: () => {
                isPausedByUser = true;
                activeControllers.forEach((ctrl) => {
                    try { ctrl.abort(); } catch (_e) {}
                });
                activeControllers.clear();
            },
            onResume: () => {
                isPausedByUser = false;
                const resolvers = pauseWaitResolvers.slice();
                pauseWaitResolvers = [];
                resolvers.forEach(r => r());
            }
        });

        async function waitIfPaused() {
            while (isPausedByUser && !isCancelledByUser) {
                await new Promise((resolve) => {
                    pauseWaitResolvers.push(resolve);
                });
            }
        }

        let nextIdx = 0;
        let completedCount = 0;
        let downloadedBytes = 0;
        const startOverall = performance.now();

        async function runDownloadWorker() {
            while (!isCancelledByUser) {
                await waitIfPaused();
                if (isCancelledByUser) break;

                const idx = nextIdx++;
                if (idx >= list.length) break;

                const filename = list[idx];
                const dirInfo = window.resolveCategoryTargetDirectory(filename, dirModeOverride);
                const endpoint = fromTrash
                    ? `/trash/media/${encodeURIComponent(filename)}`
                    : `/media/${encodeURIComponent(filename)}?download=true`;

                let doneThisFile = false;
                let attempts = 0;

                while (!doneThisFile && attempts < 2 && !isCancelledByUser) {
                    await waitIfPaused();
                    if (isCancelledByUser) break;

                    attempts++;
                    const controller = new AbortController();
                    activeControllers.add(controller);

                    try {
                        const resp = await fetch(endpoint, { signal: controller.signal });
                        activeControllers.delete(controller);
                        if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
                        const blob = await resp.blob();
                        await saveBlobToChosenDirectory(blob, filename, dirInfo);

                        doneThisFile = true;
                        completedCount++;
                        downloadedBytes += blob.size || 0;
                        const elapsedSec = Math.max(0.08, (performance.now() - startOverall) / 1000);
                        const speedBps = downloadedBytes / elapsedSec;
                        const estTotal = Math.max(downloadedBytes, Math.round((downloadedBytes / completedCount) * list.length));

                        tracker.update(
                            downloadedBytes,
                            estTotal,
                            speedBps,
                            `${completedCount}/${list.length} salvati in ${dirInfo.rootFolder}/${dirInfo.subfolder}`
                        );
                    } catch (err) {
                        activeControllers.delete(controller);
                        if (isCancelledByUser) break;
                        if (isPausedByUser) {
                            attempts--;
                            await waitIfPaused();
                            continue;
                        }
                    }
                }
            }
        }

        const workerCount = Math.min(parallelLimit, list.length);
        const workers = [];
        for (let w = 0; w < workerCount; w++) {
            workers.push(runDownloadWorker());
        }
        await Promise.all(workers);

        if (isCancelledByUser) {
            tracker.cancel('Annullato dall\'utente');
            return;
        }
        const elapsedSec = Math.max(0.1, (performance.now() - startOverall) / 1000);
        tracker.complete(downloadedBytes, elapsedSec);
    };

    // =========================================================================
    // === PRE-TRANSFER OPTIONS MODAL (START OF EVERY UPLOAD / DOWNLOAD)
    // =========================================================================
    let currentModalCallback = null;

    function initPreTransferModal() {
        const backdrop = document.getElementById('pre-transfer-modal-backdrop');
        if (!backdrop || backdrop.dataset.bound === 'true') return;
        backdrop.dataset.bound = 'true';

        const closeBtn = document.getElementById('pre-transfer-modal-close-btn');
        const cancelBtn = document.getElementById('pre-transfer-cancel-btn');
        const confirmBtn = document.getElementById('pre-transfer-confirm-btn');
        const directBtn = document.getElementById('pre-transfer-choice-direct');
        const zipBtn = document.getElementById('pre-transfer-choice-zip');
        const zipNameRow = document.getElementById('pre-transfer-zip-name-row');
        const pickDirBtn = document.getElementById('pre-transfer-pick-dir-btn');

        function setArchiveChoice(useZip) {
            backdrop.dataset.archiveChoice = useZip ? 'zip' : 'direct';
            if (directBtn) directBtn.classList.toggle('active', !useZip);
            if (zipBtn) zipBtn.classList.toggle('active', useZip);
            if (zipNameRow) {
                zipNameRow.style.display = useZip && backdrop.dataset.transferType === 'upload' ? 'block' : 'none';
            }
        }

        if (directBtn) directBtn.addEventListener('click', () => setArchiveChoice(false));
        if (zipBtn) zipBtn.addEventListener('click', () => setArchiveChoice(true));

        function closeModal() {
            backdrop.style.display = 'none';
            currentModalCallback = null;
            if (uploadForm) uploadForm.reset();
        }

        if (closeBtn) closeBtn.addEventListener('click', closeModal);
        if (cancelBtn) cancelBtn.addEventListener('click', closeModal);
        if (pickDirBtn) {
            pickDirBtn.addEventListener('click', async () => {
                const handle = await pickDeviceDownloadDirectory();
                const dirSel = document.getElementById('pre-transfer-dir-mode-select');
                if (handle && dirSel) {
                    dirSel.value = 'CUSTOM_FOLDER';
                }
            });
        }

        if (confirmBtn) {
            confirmBtn.addEventListener('click', () => {
                const archiveAsZip = backdrop.dataset.archiveChoice === 'zip';
                const transferType = backdrop.dataset.transferType || 'upload';
                const zipNameInput = document.getElementById('pre-transfer-zip-name-input');
                const dirModeSelect = document.getElementById('pre-transfer-dir-mode-select');
                const subInput = document.getElementById('pre-transfer-subfolder-input');
                const rememberCb = document.getElementById('pre-transfer-remember-checkbox');

                const archiveName = (zipNameInput && zipNameInput.value.trim()) || 'PhotoCloud_Archivio.zip';
                const dirMode = (dirModeSelect && dirModeSelect.value) || 'AUTO_BY_TYPE';
                const subfolder = (subInput && subInput.value.trim()) || 'PhotoCloud';
                const remember = Boolean(rememberCb && rememberCb.checked);

                if (transferType === 'upload') {
                    if (remember) {
                        window.setTransferPreferences({
                            uploadPackagingMode: archiveAsZip ? 'ZIP_ARCHIVE' : 'DIRECT_FILES'
                        });
                    }
                } else {
                    window.setTransferPreferences({
                        downloadPackagingMode: remember
                            ? (archiveAsZip ? 'ZIP_ARCHIVE' : 'DIRECT_FILES')
                            : window.getTransferPreferences().downloadPackagingMode,
                        downloadDirectoryMode: dirMode,
                        customDownloadSubfolder: subfolder
                    });
                }

                const cb = currentModalCallback;
                backdrop.style.display = 'none';
                currentModalCallback = null;
                if (typeof cb === 'function') {
                    cb({ archiveAsZip, archiveName, dirMode, subfolder });
                }
            });
        }
    }

    initPreTransferModal();

    window.openPreTransferModal = function ({ type, count, defaultZip, onConfirm }) {
        initPreTransferModal();
        const backdrop = document.getElementById('pre-transfer-modal-backdrop');
        if (!backdrop) {
            if (typeof onConfirm === 'function') {
                onConfirm({
                    archiveAsZip: Boolean(defaultZip),
                    archiveName: 'PhotoCloud_Archivio.zip',
                    dirMode: window.getTransferPreferences().downloadDirectoryMode,
                    subfolder: window.getTransferPreferences().customDownloadSubfolder
                });
            }
            return;
        }

        const prefs = window.getTransferPreferences();
        const isUpload = type !== 'download';
        backdrop.dataset.transferType = isUpload ? 'upload' : 'download';
        backdrop.dataset.archiveChoice = defaultZip ? 'zip' : 'direct';

        const iconEl = document.getElementById('pre-transfer-modal-icon');
        const titleEl = document.getElementById('pre-transfer-modal-title-text');
        const subEl = document.getElementById('pre-transfer-modal-subtitle');
        const directBtn = document.getElementById('pre-transfer-choice-direct');
        const zipBtn = document.getElementById('pre-transfer-choice-zip');
        const zipNameRow = document.getElementById('pre-transfer-zip-name-row');
        const zipNameInput = document.getElementById('pre-transfer-zip-name-input');
        const dlDirSection = document.getElementById('pre-transfer-download-dir-section');
        const dirModeSelect = document.getElementById('pre-transfer-dir-mode-select');
        const subInput = document.getElementById('pre-transfer-subfolder-input');
        const rememberCb = document.getElementById('pre-transfer-remember-checkbox');
        const confirmIcon = document.getElementById('pre-transfer-confirm-icon');
        const confirmLabel = document.getElementById('pre-transfer-confirm-label');

        if (iconEl) iconEl.textContent = isUpload ? 'upload' : 'download';
        if (titleEl) {
            titleEl.textContent = isUpload
                ? 'Modalità di Caricamento'
                : 'Modalità e Directory di Scaricamento';
        }
        if (subEl) {
            subEl.textContent = `${count} ${count === 1 ? 'elemento selezionato' : 'elementi selezionati'} — scegli se trasferire direttamente in memoria o come archivio .zip`;
        }
        if (directBtn) directBtn.classList.toggle('active', !defaultZip);
        if (zipBtn) zipBtn.classList.toggle('active', Boolean(defaultZip));
        if (zipNameRow) {
            zipNameRow.style.display = isUpload && defaultZip ? 'block' : 'none';
        }
        if (zipNameInput) {
            const stamp = new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-');
            zipNameInput.value = `PhotoCloud_${stamp}.zip`;
        }
        if (dlDirSection) {
            dlDirSection.style.display = isUpload ? 'none' : 'block';
        }
        if (dirModeSelect) dirModeSelect.value = prefs.downloadDirectoryMode || 'AUTO_BY_TYPE';
        if (subInput) subInput.value = prefs.customDownloadSubfolder || 'PhotoCloud';
        if (rememberCb) rememberCb.checked = false;
        if (confirmIcon) confirmIcon.textContent = isUpload ? 'upload' : 'download';
        if (confirmLabel) confirmLabel.textContent = isUpload ? 'Avvia Caricamento' : 'Avvia Scaricamento';

        currentModalCallback = onConfirm;
        backdrop.style.display = 'flex';
    };

    window.startOrPromptUpload = function (fileListInput) {
        if (!fileListInput || fileListInput.length === 0) return;
        const filesArray = Array.from(fileListInput);
        const prefs = window.getTransferPreferences();
        if (prefs.uploadPackagingMode === 'DIRECT_FILES') {
            uploadInBatches(filesArray, { archiveAsZip: false });
        } else if (prefs.uploadPackagingMode === 'ZIP_ARCHIVE') {
            uploadInBatches(filesArray, { archiveAsZip: true });
        } else {
            window.openPreTransferModal({
                type: 'upload',
                count: filesArray.length,
                defaultZip: false,
                onConfirm: ({ archiveAsZip, archiveName }) => {
                    uploadInBatches(filesArray, { archiveAsZip, archiveName });
                }
            });
        }
    };

    if (fileInput) {
        fileInput.addEventListener('change', (event) => {
            window.startOrPromptUpload(event.target.files);
        });
    }
    if (gem) gem.addEventListener('click', toggleExpand);
    if (closeButton) closeButton.addEventListener('click', (e) => {
        if (e) e.stopPropagation();
        container.classList.remove('expanded');
    });
});
