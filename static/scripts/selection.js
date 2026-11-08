document.addEventListener('DOMContentLoaded', () => {
    const selectAllBtn = document.getElementById('select-all-btn');
    const downloadSelectedBtn = document.getElementById('download-selected-btn');
    const assignAlbumSelectedBtn = document.getElementById('assign-album-selected-btn');
    const deleteSelectedBtn = document.getElementById('delete-selected-btn');
    const selectedCountSpan = document.getElementById('selected-count');
    const mediaCheckboxes = document.querySelectorAll('.media-checkbox');
    const hasMedia = mediaCheckboxes.length > 0;

    // Album Modal elements
    const newAlbumBtn = document.getElementById('new-album-btn');
    const albumModalBackdrop = document.getElementById('album-modal-backdrop');
    const closeAlbumModalBtn = document.getElementById('close-album-modal-btn');
    const confirmCreateAlbumBtn = document.getElementById('confirm-create-album-btn');
    const newAlbumNameInput = document.getElementById('new-album-name-input');
    const albumChipsList = document.getElementById('album-chips-list');
    const galleryContainer = document.querySelector('.gallery-container');

    let selectedFiles = new Set();
    let isSelectAll = false;
    let availableAlbums = [];
    try {
        availableAlbums = JSON.parse(galleryContainer?.dataset.albums || '[]');
    } catch (_e) {
        availableAlbums = [];
    }

    if (hasMedia && selectAllBtn) {
        selectAllBtn.style.display = 'inline-flex';
    }

    function updateUI() {
        const count = selectedFiles.size;
        if (selectedCountSpan) selectedCountSpan.textContent = count;

        mediaCheckboxes.forEach(checkbox => {
            const wrapper = checkbox.closest('.media-card-wrapper');
            if (wrapper) {
                const isSelected = selectedFiles.has(checkbox.dataset.filename);
                wrapper.classList.toggle('selected', isSelected);
                checkbox.checked = isSelected;
            }
        });

        const showActionButtons = count > 0;
        if (downloadSelectedBtn) downloadSelectedBtn.style.display = showActionButtons ? 'inline-flex' : 'none';
        if (assignAlbumSelectedBtn) assignAlbumSelectedBtn.style.display = showActionButtons ? 'inline-flex' : 'none';
        if (deleteSelectedBtn) deleteSelectedBtn.style.display = showActionButtons ? 'inline-flex' : 'none';

        if (selectAllBtn) {
            const btnText = selectAllBtn.querySelector('.btn-text');
            if (count > 0 && count === mediaCheckboxes.length) {
                if (btnText) btnText.textContent = 'Deseleziona Tutto';
                isSelectAll = true;
            } else {
                if (btnText) btnText.textContent = 'Seleziona Tutto';
                isSelectAll = false;
            }
        }
    }

    function renderAlbumChips() {
        if (!albumChipsList) return;
        albumChipsList.innerHTML = '';

        const allAlbums = ['Senza Album', ...availableAlbums];
        allAlbums.forEach(albumName => {
            const chip = document.createElement('button');
            chip.type = 'button';
            chip.className = 'btn outlined album-chip-btn';
            chip.innerHTML = `<span class="material-icons">${albumName === 'Senza Album' ? 'folder_off' : 'photo_album'}</span> ${albumName}`;
            chip.addEventListener('click', async () => {
                const targetAlbum = albumName === 'Senza Album' ? '' : albumName;
                const files = Array.from(selectedFiles);
                if (files.length === 0) {
                    const groupBySelect = document.getElementById('group-by-select');
                    if (groupBySelect) {
                        groupBySelect.value = 'album';
                        if (window.refreshGalleryGrouping) window.refreshGalleryGrouping();
                    }
                    if (albumModalBackdrop) albumModalBackdrop.style.display = 'none';
                    return;
                }
                await assignSelectedToAlbum(files, targetAlbum);
            });
            albumChipsList.appendChild(chip);
        });
    }

    async function assignSelectedToAlbum(filenames, albumName) {
        try {
            const resp = await fetch('/api/albums/assign', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ filenames, album: albumName })
            });
            const data = await resp.json();
            if (data.success) {
                availableAlbums = data.albums || availableAlbums;
                filenames.forEach(fn => {
                    const wrapper = document.querySelector(`.media-card-wrapper[data-filename="${CSS.escape(fn)}"]`);
                    if (wrapper) {
                        wrapper.dataset.album = albumName;
                    }
                });
                selectedFiles.clear();
                updateUI();
                if (albumModalBackdrop) albumModalBackdrop.style.display = 'none';
                const groupBySelect = document.getElementById('group-by-select');
                if (groupBySelect) {
                    groupBySelect.value = 'album';
                }
                if (window.refreshGalleryGrouping) window.refreshGalleryGrouping();
            }
        } catch (e) {
            console.error('Errore assegnazione album:', e);
        }
    }

    if (newAlbumBtn) {
        newAlbumBtn.addEventListener('click', () => {
            renderAlbumChips();
            if (albumModalBackdrop) albumModalBackdrop.style.display = 'flex';
        });
    }
    if (assignAlbumSelectedBtn) {
        assignAlbumSelectedBtn.addEventListener('click', () => {
            renderAlbumChips();
            if (albumModalBackdrop) albumModalBackdrop.style.display = 'flex';
        });
    }
    if (closeAlbumModalBtn) {
        closeAlbumModalBtn.addEventListener('click', () => {
            if (albumModalBackdrop) albumModalBackdrop.style.display = 'none';
        });
    }
    if (confirmCreateAlbumBtn && newAlbumNameInput) {
        confirmCreateAlbumBtn.addEventListener('click', async () => {
            const name = newAlbumNameInput.value.trim();
            if (!name) return;
            try {
                const resp = await fetch('/api/albums/create', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ name })
                });
                const data = await resp.json();
                if (data.success) {
                    availableAlbums = data.albums || [];
                    newAlbumNameInput.value = '';
                    if (selectedFiles.size > 0) {
                        await assignSelectedToAlbum(Array.from(selectedFiles), name);
                    } else {
                        renderAlbumChips();
                    }
                }
            } catch (e) {
                console.error('Errore creazione album:', e);
            }
        });
    }

    function triggerDownload(url, filename) {
        const a = document.createElement('a');
        a.href = url;
        a.download = filename;
        a.style.display = 'none';
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
    }

    function pollZipProgress(taskId, fileCount) {
        const startTime = performance.now();
        const tracker = window.registerTransferOperation
            ? window.registerTransferOperation({
                  id: `zip_${taskId}`,
                  name: `Archivio ZIP (${fileCount} file)`,
                  type: 'download',
                  totalBytes: 0
              })
            : null;

        const interval = setInterval(async () => {
            try {
                const response = await fetch(`/zip-progress/${taskId}`);
                if (!response.ok) throw new Error(`Errore: ${response.status}`);
                const data = await response.json();
                const elapsedSec = Math.max(0.1, (performance.now() - startTime) / 1000);
                const processed = data.processedBytes || 0;
                const total = data.totalBytes || processed || 1;
                const speedBps = processed / elapsedSec;

                if (data.status === 'processing') {
                    if (tracker) tracker.update(processed, total, speedBps);
                } else if (data.status === 'complete') {
                    clearInterval(interval);
                    if (tracker) tracker.complete(total, elapsedSec);
                    triggerDownload(`/download-zip/${data.filename}`, data.filename);
                } else if (data.status === 'error' || data.status === 'not_found') {
                    clearInterval(interval);
                    if (tracker) tracker.fail(data.error || 'Errore creazione ZIP');
                }
            } catch (error) {
                clearInterval(interval);
                if (tracker) tracker.fail(error.message);
            }
        }, 800);
    }

    if (selectAllBtn) {
        selectAllBtn.addEventListener('click', () => {
            if (isSelectAll) {
                selectedFiles.clear();
            } else {
                mediaCheckboxes.forEach(checkbox => {
                    if (checkbox.closest('.media-card-wrapper')?.isConnected) {
                        selectedFiles.add(checkbox.dataset.filename);
                    }
                });
            }
            updateUI();
        });
    }

    mediaCheckboxes.forEach(checkbox => {
        checkbox.addEventListener('change', () => {
            const filename = checkbox.dataset.filename;
            if (checkbox.checked) {
                selectedFiles.add(filename);
            } else {
                selectedFiles.delete(filename);
            }
            updateUI();
        });
    });

    if (downloadSelectedBtn) {
        downloadSelectedBtn.addEventListener('click', async () => {
            const filesToDownload = Array.from(selectedFiles);
            if (filesToDownload.length === 0) return;

            try {
                const response = await fetch('/prepare-zip', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ filenames: filesToDownload }),
                });
                const data = await response.json();
                if (data.task_id) {
                    pollZipProgress(data.task_id, filesToDownload.length);
                }
            } catch (error) {
                console.error('Errore preparazione ZIP:', error);
            }
        });
    }

    if (deleteSelectedBtn) {
        deleteSelectedBtn.addEventListener('click', async () => {
            const filesToDelete = Array.from(selectedFiles);
            if (filesToDelete.length === 0) return;
            if (!confirm(`Spostare ${filesToDelete.length} elementi nel cestino?`)) return;

            try {
                const response = await fetch('/trash/batch', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ filenames: filesToDelete }),
                });
                const result = await response.json();
                if (result.success) {
                    filesToDelete.forEach(filename => {
                        const checkbox = document.querySelector(`.media-checkbox[data-filename="${CSS.escape(filename)}"]`);
                        if (checkbox) {
                            const wrapper = checkbox.closest('.media-card-wrapper');
                            if (wrapper) wrapper.remove();
                        }
                    });
                    selectedFiles.clear();
                    updateUI();
                    if (window.refreshGalleryGrouping) window.refreshGalleryGrouping();
                }
            } catch (error) {
                console.error('Errore cestino batch:', error);
            }
        });
    }

    updateUI();
});
