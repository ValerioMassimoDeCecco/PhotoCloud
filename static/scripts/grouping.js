document.addEventListener('DOMContentLoaded', () => {
    const galleryGrid = document.querySelector('.gallery-grid');
    const groupBySelect = document.getElementById('group-by-select');
    const mainViewTitle = document.getElementById('main-view-title');
    const mediaCountEl = document.getElementById('media-count');
    const tabMediaBtn = document.getElementById('tab-media-btn');
    const tabFilesBtn = document.getElementById('tab-files-btn');
    const tabTrashBtn = document.getElementById('tab-trash-btn');
    const groupingControlsWrap = document.getElementById('grouping-controls-wrap');
    const newAlbumBtn = document.getElementById('new-album-btn');
    const selectAllBtn = document.getElementById('select-all-btn');
    const emptyTrashBtn = document.getElementById('empty-trash-btn');

    if (!galleryGrid || !groupBySelect) return;

    const groupingLevels = ['none', 'year', 'month', 'day', 'album'];
    let currentGroupingIndex = groupingLevels.indexOf(groupBySelect.value);
    let currentViewTab = 'media'; // 'media' | 'files' | 'trash'

    let allElements = Array.from(galleryGrid.querySelectorAll('.media-card-wrapper'));
    let trashItemsCache = [];
    let trashLoaded = false;

    const categoryLabels = {
        document: 'Documenti & PDF',
        archive: 'Archivi, ZIP & APK',
        audio: 'Audio & Musica',
        code: 'Codice & Dati',
        other: 'Altri File Cloud'
    };

    // Create 3 persistent Keep-Alive DOM panes so switching tabs is 0.0ms with zero DOM destruction
    const paneMedia = document.createElement('div');
    paneMedia.id = 'pane-media';
    paneMedia.className = 'keep-alive-pane';
    paneMedia.style.display = 'block';

    const paneFiles = document.createElement('div');
    paneFiles.id = 'pane-files';
    paneFiles.className = 'keep-alive-pane';
    paneFiles.style.display = 'none';

    const paneTrash = document.createElement('div');
    paneTrash.id = 'pane-trash';
    paneTrash.className = 'keep-alive-pane';
    paneTrash.style.display = 'none';

    galleryGrid.innerHTML = '';
    galleryGrid.appendChild(paneMedia);
    galleryGrid.appendChild(paneFiles);
    galleryGrid.appendChild(paneTrash);
    galleryGrid.style.opacity = '1';

    function formatBytesHuman(bytes) {
        if (!bytes || bytes <= 0) return '0 B';
        const units = ['B', 'KB', 'MB', 'GB'];
        const i = Math.min(units.length - 1, Math.floor(Math.log(bytes) / Math.log(1024)));
        return `${(bytes / Math.pow(1024, i)).toFixed(i === 0 ? 0 : 1)} ${units[i]}`;
    }

    function getCategoryIcon(category, ext) {
        if (category === 'document') return ext === 'pdf' ? 'picture_as_pdf' : 'description';
        if (category === 'archive') return ext === 'apk' ? 'android' : 'folder_zip';
        if (category === 'audio') return 'audiotrack';
        if (category === 'code') return 'code';
        return 'insert_drive_file';
    }

    function pruneDetachedElements() {
        allElements = allElements.filter(el => el.isConnected || el.parentElement);
    }

    function getMediaElements() {
        pruneDetachedElements();
        return allElements.filter(el => el.dataset.isMedia !== 'false');
    }

    function getFileElements() {
        pruneDetachedElements();
        return allElements.filter(el => el.dataset.isMedia === 'false');
    }

    function buildMediaPane() {
        const mediaEls = getMediaElements();
        paneMedia.innerHTML = '';

        if (mediaEls.length === 0) {
            const emptyDiv = document.createElement('div');
            emptyDiv.className = 'empty-state';
            emptyDiv.innerHTML = `<span class="material-icons">photo_library</span>
                <h3>Nessuna foto o video</h3>
                <p>Tocca + Carica nella barra in basso per aggiungere foto o video.</p>`;
            paneMedia.appendChild(emptyDiv);
            return;
        }

        const fragment = document.createDocumentFragment();
        const level = groupBySelect.value;

        if (level === 'none') {
            const groupGrid = document.createElement('div');
            groupGrid.className = 'media-group-grid';
            mediaEls.forEach(el => groupGrid.appendChild(el));
            fragment.appendChild(groupGrid);
        } else {
            const groups = new Map();
            mediaEls.forEach(el => {
                let key = '';
                if (level === 'album') {
                    key = (el.dataset.album || '').trim() || 'Senza Album';
                } else {
                    const timestamp = parseFloat(el.dataset.timestamp) * 1000;
                    const date = new Date(timestamp);
                    if (level === 'day') {
                        key = date.toLocaleDateString('it-IT', { day: 'numeric', month: 'long', year: 'numeric' });
                    } else if (level === 'month') {
                        key = date.toLocaleDateString('it-IT', { month: 'long', year: 'numeric' });
                    } else if (level === 'year') {
                        key = date.getFullYear().toString();
                    }
                }

                if (!groups.has(key)) groups.set(key, []);
                groups.get(key).push(el);
            });

            groups.forEach((media, title) => {
                const groupContainer = document.createElement('div');
                groupContainer.className = 'media-group';

                const groupTitle = document.createElement('h2');
                groupTitle.className = 'group-title';
                groupTitle.textContent = `${title} (${media.length})`;

                const groupGrid = document.createElement('div');
                groupGrid.className = 'media-group-grid';
                media.forEach(el => groupGrid.appendChild(el));

                groupContainer.appendChild(groupTitle);
                groupContainer.appendChild(groupGrid);
                fragment.appendChild(groupContainer);
            });
        }

        paneMedia.appendChild(fragment);
    }

    function buildFilesPane() {
        const fileEls = getFileElements();
        paneFiles.innerHTML = '';

        if (fileEls.length === 0) {
            const emptyDiv = document.createElement('div');
            emptyDiv.className = 'empty-state';
            emptyDiv.innerHTML = `<span class="material-icons">folder_open</span>
                <h3>Nessun file nel File Manager Cloud</h3>
                <p>Tocca + Carica per caricare PDF, archivi ZIP, APK, documenti o audio.</p>`;
            paneFiles.appendChild(emptyDiv);
            return;
        }

        const fragment = document.createDocumentFragment();
        const groups = new Map();
        fileEls.forEach(el => {
            const cat = el.dataset.category || 'other';
            const title = categoryLabels[cat] || 'Altri File Cloud';
            if (!groups.has(title)) groups.set(title, []);
            groups.get(title).push(el);
        });

        groups.forEach((items, title) => {
            const groupContainer = document.createElement('div');
            groupContainer.className = 'media-group';

            const groupTitle = document.createElement('h2');
            groupTitle.className = 'group-title';
            groupTitle.textContent = `${title} (${items.length})`;

            const groupGrid = document.createElement('div');
            groupGrid.className = 'media-group-grid cloud-files-grid';
            items.forEach(el => groupGrid.appendChild(el));

            groupContainer.appendChild(groupTitle);
            groupContainer.appendChild(groupGrid);
            fragment.appendChild(groupContainer);
        });

        paneFiles.appendChild(fragment);
    }

    function renderTrashPaneDom() {
        paneTrash.innerHTML = '';
        if (!trashItemsCache || trashItemsCache.length === 0) {
            const emptyDiv = document.createElement('div');
            emptyDiv.className = 'empty-state';
            emptyDiv.innerHTML = `<span class="material-icons">delete_sweep</span>
                <h3>Il cestino è vuoto</h3>
                <p>I file eliminati appariranno qui.</p>`;
            paneTrash.appendChild(emptyDiv);
            if (currentViewTab === 'trash' && emptyTrashBtn) {
                emptyTrashBtn.style.display = 'none';
            }
            return;
        }

        if (currentViewTab === 'trash' && emptyTrashBtn) {
            emptyTrashBtn.style.display = 'inline-flex';
        }

        const groupContainer = document.createElement('div');
        groupContainer.className = 'media-group';
        const groupGrid = document.createElement('div');
        groupGrid.className = 'media-group-grid';

        trashItemsCache.forEach(item => {
            const filename = item.filename || '';
            const ext = filename.split('.').pop()?.toLowerCase() || '';
            const isImg = ['jpg', 'jpeg', 'png', 'gif', 'webp', 'bmp', 'svg', 'heic', 'avif'].includes(ext);
            const isVid = ['mp4', 'mov', 'webm', 'mkv'].includes(ext);
            const isMedia = item.isMedia !== undefined ? item.isMedia : (isImg || isVid);
            const category = item.category || (isMedia ? 'media' : 'other');

            const wrapper = document.createElement('div');
            wrapper.className = 'media-card-wrapper';
            wrapper.dataset.filename = filename;
            wrapper.dataset.size = String(item.size || 0);
            wrapper.dataset.isMedia = isMedia ? 'true' : 'false';

            const card = document.createElement('div');
            card.className = `media-card ${isMedia ? 'clickable-media' : 'clickable-cloud-file'}`;
            card.dataset.filename = filename;

            if (isImg) {
                const img = document.createElement('img');
                img.src = `/media/${encodeURIComponent(filename)}?from_trash=true`;
                img.alt = filename;
                img.loading = 'lazy';
                card.appendChild(img);
            } else if (isVid) {
                card.innerHTML = `<video preload="metadata"><source src="/media/${encodeURIComponent(filename)}?from_trash=true#t=0.5" type="video/mp4"></video>`;
            } else {
                const iconName = getCategoryIcon(category, ext);
                card.innerHTML = `<div class="cloud-file-preview" data-category="${category}">
                    <div class="cloud-file-icon-wrap">
                        <span class="material-icons">${iconName}</span>
                        <span class="cloud-file-ext">${(ext || 'FILE').toUpperCase()}</span>
                    </div>
                    <div class="cloud-file-meta">
                        <span class="cloud-file-title"></span>
                        <span class="cloud-file-sub">${formatBytesHuman(item.size)}</span>
                    </div>
                </div>`;
                const titleSpan = card.querySelector('.cloud-file-title');
                if (titleSpan) titleSpan.textContent = filename;
            }

            const actions = document.createElement('div');
            actions.className = 'media-actions';

            const restoreBtn = document.createElement('button');
            restoreBtn.type = 'button';
            restoreBtn.className = 'btn icon restore-btn';
            restoreBtn.title = 'Ripristina';
            restoreBtn.dataset.filename = filename;
            restoreBtn.innerHTML = '<span class="material-icons">restore_from_trash</span>';
            restoreBtn.addEventListener('click', async (ev) => {
                ev.stopPropagation();
                ev.preventDefault();
                wrapper.remove();
                trashItemsCache = trashItemsCache.filter(t => t.filename !== filename);
                updateHeaderForCurrentTab();
                try {
                    const res = await fetch(`/restore/${encodeURIComponent(filename)}`, {
                        method: 'POST',
                        headers: { 'Accept': 'application/json' }
                    });
                    const data = await res.json();
                    if (data.success) {
                        window.location.reload();
                    } else {
                        await loadTrashItems();
                    }
                } catch {
                    await loadTrashItems();
                }
            });

            const deletePermBtn = document.createElement('button');
            deletePermBtn.type = 'button';
            deletePermBtn.className = 'btn icon danger permanent-delete-btn';
            deletePermBtn.title = 'Elimina Definitivamente';
            deletePermBtn.dataset.filename = filename;
            deletePermBtn.innerHTML = '<span class="material-icons">delete_forever</span>';
            deletePermBtn.addEventListener('click', async (ev) => {
                ev.stopPropagation();
                ev.preventDefault();
                if (!confirm(`Eliminare definitivamente "${filename}"? L'azione è irreversibile.`)) return;
                wrapper.remove();
                trashItemsCache = trashItemsCache.filter(t => t.filename !== filename);
                if (trashItemsCache.length === 0) renderTrashPaneDom();
                updateHeaderForCurrentTab();
                try {
                    await fetch(`/delete_permanent/${encodeURIComponent(filename)}`, {
                        method: 'POST',
                        headers: { 'Accept': 'application/json' }
                    });
                } catch {
                    await loadTrashItems();
                }
            });

            actions.appendChild(restoreBtn);
            actions.appendChild(deletePermBtn);
            card.appendChild(actions);
            wrapper.appendChild(card);
            groupGrid.appendChild(wrapper);
        });

        groupContainer.appendChild(groupGrid);
        paneTrash.appendChild(groupContainer);
    }

    async function loadTrashItems() {
        try {
            const res = await fetch('/api/session', {
                headers: { 'Accept': 'application/json' }
            });
            if (!res.ok) return;
            const data = await res.json();
            if (data && Array.isArray(data.trashedFiles)) {
                trashItemsCache = data.trashedFiles;
                trashLoaded = true;
                renderTrashPaneDom();
                if (currentViewTab === 'trash') {
                    updateHeaderForCurrentTab();
                }
            }
        } catch {
            // Silent background preload failure
        }
    }

    function updateHeaderForCurrentTab() {
        const mediaCount = getMediaElements().length;
        const filesCount = getFileElements().length;
        const trashCount = trashItemsCache.length;

        if (mainViewTitle) {
            if (currentViewTab === 'media') mainViewTitle.textContent = 'Il tuo archivio';
            else if (currentViewTab === 'files') mainViewTitle.textContent = 'File Manager Cloud';
            else mainViewTitle.textContent = 'Cestino';
        }
        if (mediaCountEl) {
            const count = currentViewTab === 'media'
                ? mediaCount
                : (currentViewTab === 'files' ? filesCount : trashCount);
            mediaCountEl.textContent = `${count} elementi`;
        }
        if (groupingControlsWrap) {
            groupingControlsWrap.style.display = currentViewTab === 'media' ? 'inline-flex' : 'none';
        }
        if (newAlbumBtn) {
            newAlbumBtn.style.display = currentViewTab === 'trash' ? 'none' : 'inline-flex';
        }
        if (selectAllBtn) {
            if (currentViewTab === 'trash') {
                selectAllBtn.style.display = 'none';
            }
        }
        if (emptyTrashBtn) {
            emptyTrashBtn.style.display = (currentViewTab === 'trash' && trashCount > 0) ? 'inline-flex' : 'none';
        }
    }

    /**
     * 0.0ms Instantaneous Tab Switch:
     * Only toggles display style on persistent Keep-Alive panes (#pane-media, #pane-files, #pane-trash).
     * Never clears innerHTML or detaches/re-attaches Gallery DOM elements!
     */
    function switchToTab(targetTab) {
        currentViewTab = targetTab;

        paneMedia.style.display = targetTab === 'media' ? 'block' : 'none';
        paneFiles.style.display = targetTab === 'files' ? 'block' : 'none';
        paneTrash.style.display = targetTab === 'trash' ? 'block' : 'none';

        if (tabMediaBtn) tabMediaBtn.classList.toggle('active', targetTab === 'media');
        if (tabFilesBtn) tabFilesBtn.classList.toggle('active', targetTab === 'files');
        if (tabTrashBtn) tabTrashBtn.classList.toggle('active', targetTab === 'trash');

        updateHeaderForCurrentTab();

        if (targetTab === 'trash' && !trashLoaded) {
            loadTrashItems();
        }
    }

    function renderGroups() {
        buildMediaPane();
        buildFilesPane();
        updateHeaderForCurrentTab();
    }

    window.refreshGalleryGrouping = renderGroups;
    window.refreshTrashPane = loadTrashItems;
    window.switchVaultTab = switchToTab;

    groupBySelect.addEventListener('change', (e) => {
        currentGroupingIndex = groupingLevels.indexOf(e.target.value);
        buildMediaPane();
        updateHeaderForCurrentTab();
    });

    if (tabMediaBtn) {
        tabMediaBtn.addEventListener('click', (e) => {
            e.preventDefault();
            switchToTab('media');
        });
    }

    if (tabFilesBtn) {
        tabFilesBtn.addEventListener('click', (e) => {
            e.preventDefault();
            switchToTab('files');
        });
    }

    if (tabTrashBtn) {
        tabTrashBtn.addEventListener('click', (e) => {
            e.preventDefault();
            switchToTab('trash');
        });
    }

    if (emptyTrashBtn) {
        emptyTrashBtn.addEventListener('click', async (e) => {
            e.preventDefault();
            if (!confirm('Vuoi svuotare definitivamente il cestino? Tutti i file saranno eliminati per sempre.')) return;
            trashItemsCache = [];
            renderTrashPaneDom();
            updateHeaderForCurrentTab();
            try {
                await fetch('/empty_trash', {
                    method: 'POST',
                    headers: { 'Accept': 'application/json' }
                });
            } catch {
                await loadTrashItems();
            }
        });
    }

    galleryGrid.addEventListener('wheel', (e) => {
        if (e.ctrlKey && currentViewTab === 'media') {
            e.preventDefault();
            let newIndex = currentGroupingIndex + (e.deltaY < 0 ? 1 : -1);
            newIndex = Math.max(0, Math.min(newIndex, groupingLevels.length - 1));
            if (newIndex !== currentGroupingIndex) {
                currentGroupingIndex = newIndex;
                groupBySelect.value = groupingLevels[currentGroupingIndex];
                buildMediaPane();
            }
        }
    }, { passive: false });

    // Initial build of Keep-Alive panes + background preload of Trash pane
    renderGroups();
    loadTrashItems();
});
