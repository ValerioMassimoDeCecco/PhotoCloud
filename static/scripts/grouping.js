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

    // Capture initial server-rendered cards BEFORE clearing galleryGrid
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

    const IMG_EXTENSIONS = new Set(['jpg', 'jpeg', 'png', 'gif', 'webp', 'bmp', 'svg', 'heic', 'avif']);
    const VID_EXTENSIONS = new Set(['mp4', 'mov', 'webm', 'mkv']);

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

    function classifyExtensionClient(filename) {
        const ext = (filename.split('.').pop() || '').toLowerCase();
        if (IMG_EXTENSIONS.has(ext) || VID_EXTENSIONS.has(ext)) {
            return { isMedia: true, category: 'media', ext, isImg: IMG_EXTENSIONS.has(ext), isVid: VID_EXTENSIONS.has(ext) };
        }
        const docExts = new Set(['pdf', 'doc', 'docx', 'xls', 'xlsx', 'ppt', 'pptx', 'odt', 'ods', 'odp', 'rtf', 'txt', 'md', 'csv', 'tsv']);
        const archiveExts = new Set(['zip', 'rar', '7z', 'tar', 'gz', 'bz2', 'apk', 'iso', 'dmg', 'exe']);
        const audioExts = new Set(['mp3', 'wav', 'flac', 'aac', 'ogg', 'm4a', 'opus']);
        const codeExts = new Set(['json', 'xml', 'yaml', 'yml', 'js', 'ts', 'tsx', 'jsx', 'py', 'kt', 'java', 'c', 'cpp', 'h', 'html', 'htm', 'css', 'sql', 'sh', 'ini', 'conf', 'log']);
        if (docExts.has(ext)) return { isMedia: false, category: 'document', ext, isImg: false, isVid: false };
        if (archiveExts.has(ext)) return { isMedia: false, category: 'archive', ext, isImg: false, isVid: false };
        if (audioExts.has(ext)) return { isMedia: false, category: 'audio', ext, isImg: false, isVid: false };
        if (codeExts.has(ext)) return { isMedia: false, category: 'code', ext, isImg: false, isVid: false };
        return { isMedia: false, category: 'other', ext, isImg: false, isVid: false };
    }

    /**
     * Builds a `.media-card-wrapper` DOM node identical to server-side `renderGalleryTemplate`
     * so newly uploaded or restored files can be inserted in-place without reloading the page.
     */
    function createCardWrapperElement(item, index = 0) {
        const filename = String(item.filename || '');
        const info = classifyExtensionClient(filename);
        const isMedia = item.isMedia !== undefined ? Boolean(item.isMedia) : info.isMedia;
        const category = item.category || info.category;
        const album = String(item.album || '');
        const sizeBytes = Number(item.size || 0);
        const timestamp = Number(item.timestamp || Date.now() / 1000);
        const humanSize = formatBytesHuman(sizeBytes);

        const wrapper = document.createElement('div');
        wrapper.className = `media-card-wrapper ${isMedia ? 'is-media-item' : 'is-cloud-file'}`;
        wrapper.dataset.timestamp = String(timestamp);
        wrapper.dataset.filename = filename;
        wrapper.dataset.size = String(sizeBytes);
        wrapper.dataset.isMedia = isMedia ? 'true' : 'false';
        wrapper.dataset.category = category;
        wrapper.dataset.album = album;

        const card = document.createElement('div');
        card.className = `media-card ${isMedia ? 'clickable-media' : 'clickable-cloud-file'}`;
        card.dataset.index = String(index);
        card.dataset.filename = filename;

        if (info.isImg) {
            const img = document.createElement('img');
            img.src = `/media/${encodeURIComponent(filename)}`;
            img.alt = filename;
            img.loading = 'lazy';
            card.appendChild(img);
        } else if (info.isVid) {
            const video = document.createElement('video');
            video.preload = 'metadata';
            const source = document.createElement('source');
            source.src = `/media/${encodeURIComponent(filename)}#t=0.5`;
            source.type = 'video/mp4';
            video.appendChild(source);
            card.appendChild(video);

            const overlay = document.createElement('div');
            overlay.className = 'video-overlay';
            overlay.innerHTML = '<span class="material-icons">play_circle</span>';
            card.appendChild(overlay);
        } else {
            const iconName = getCategoryIcon(category, info.ext);
            const preview = document.createElement('div');
            preview.className = 'cloud-file-preview';
            preview.dataset.category = category;
            preview.innerHTML = `
                <div class="cloud-file-icon-wrap">
                    <span class="material-icons">${iconName}</span>
                    <span class="cloud-file-ext"></span>
                </div>
                <div class="cloud-file-meta">
                    <span class="cloud-file-title"></span>
                    <span class="cloud-file-sub"></span>
                </div>
            `;
            preview.querySelector('.cloud-file-ext').textContent = (info.ext || 'FILE').toUpperCase();
            const titleEl = preview.querySelector('.cloud-file-title');
            titleEl.textContent = filename;
            titleEl.title = filename;
            preview.querySelector('.cloud-file-sub').textContent = `${humanSize}${album ? ` • ${album}` : ''}`;
            card.appendChild(preview);
        }

        if (album && isMedia) {
            const badge = document.createElement('span');
            badge.className = 'media-album-badge';
            badge.title = `Album: ${album}`;
            badge.innerHTML = '<span class="material-icons">photo_album</span>';
            badge.appendChild(document.createTextNode(album));
            card.appendChild(badge);
        }

        const actions = document.createElement('div');
        actions.className = 'media-actions';

        if (info.isImg) {
            const editBtn = document.createElement('button');
            editBtn.type = 'button';
            editBtn.className = 'btn icon edit-photo-btn';
            editBtn.title = 'Modifica Foto';
            editBtn.setAttribute('aria-label', `Modifica ${filename}`);
            editBtn.innerHTML = '<span class="material-icons">tune</span>';
            editBtn.addEventListener('click', (ev) => {
                if (window.openPhotoEditor) {
                    window.openPhotoEditor(filename, ev);
                }
            });
            actions.appendChild(editBtn);
        }

        if (!isMedia) {
            const openDocBtn = document.createElement('button');
            openDocBtn.type = 'button';
            openDocBtn.className = 'btn icon open-doc-btn';
            openDocBtn.title = 'Apri documento o file';
            openDocBtn.setAttribute('aria-label', `Apri ${filename}`);
            openDocBtn.innerHTML = '<span class="material-icons">open_in_new</span>';
            openDocBtn.addEventListener('click', (ev) => {
                if (window.openCloudFile) {
                    window.openCloudFile(filename, sizeBytes, false, ev);
                }
            });
            actions.appendChild(openDocBtn);
        }

        const deleteForm = document.createElement('form');
        deleteForm.action = `/trash/${encodeURIComponent(filename)}`;
        deleteForm.method = 'POST';
        deleteForm.className = 'delete-form';
        deleteForm.dataset.filename = filename;

        const deleteBtn = document.createElement('button');
        deleteBtn.type = 'submit';
        deleteBtn.className = 'btn icon danger';
        deleteBtn.title = 'Sposta nel Cestino';
        deleteBtn.innerHTML = '<span class="material-icons">delete</span>';
        deleteBtn.addEventListener('click', (ev) => {
            if (typeof window.handleDelete === 'function') {
                window.handleDelete(ev, deleteBtn);
            }
        });
        deleteForm.appendChild(deleteBtn);
        actions.appendChild(deleteForm);

        card.appendChild(actions);
        wrapper.appendChild(card);

        const selOverlay = document.createElement('div');
        selOverlay.className = 'selection-overlay';
        wrapper.appendChild(selOverlay);

        const checkbox = document.createElement('input');
        checkbox.type = 'checkbox';
        checkbox.className = 'media-checkbox';
        checkbox.dataset.filename = filename;
        checkbox.addEventListener('click', (ev) => ev.stopPropagation());
        wrapper.appendChild(checkbox);

        return wrapper;
    }

    function getActiveElements() {
        allElements = allElements.filter(el => el && el.dataset.removed !== 'true');
        return allElements;
    }

    function getMediaElements() {
        return getActiveElements().filter(el => el.dataset.isMedia !== 'false');
    }

    function getFileElements() {
        return getActiveElements().filter(el => el.dataset.isMedia === 'false');
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

    /**
     * Synchronizes the DOM cards in `#pane-media` and `#pane-files` in-place from the server's
     * authoritative `mediaFiles` array without performing a full page navigation.
     */
    function syncVaultItemsFromServer(serverMediaFiles, options = {}) {
        if (!Array.isArray(serverMediaFiles)) return;

        const existingByFilename = new Map();
        getActiveElements().forEach(el => {
            if (el.dataset.filename) {
                existingByFilename.set(el.dataset.filename, el);
            }
        });

        const previousFilenames = new Set(existingByFilename.keys());
        const addedItems = [];
        const updatedElements = [];

        serverMediaFiles.forEach((item, idx) => {
            const fn = String(item.filename || '');
            if (!fn) return;

            let wrapper = existingByFilename.get(fn);
            if (wrapper) {
                wrapper.dataset.timestamp = String(item.timestamp || wrapper.dataset.timestamp || Date.now() / 1000);
                wrapper.dataset.size = String(item.size !== undefined ? item.size : (wrapper.dataset.size || 0));
                wrapper.dataset.album = String(item.album || '');
                delete wrapper.dataset.removed;
                updatedElements.push(wrapper);
            } else {
                wrapper = createCardWrapperElement(item, idx);
                updatedElements.push(wrapper);
                if (!previousFilenames.has(fn)) {
                    addedItems.push(item);
                }
            }
        });

        allElements = updatedElements;
        galleryGrid.dataset.mediaFiles = JSON.stringify(serverMediaFiles.map(m => m.filename));

        buildMediaPane();
        buildFilesPane();

        // If the user uploaded non-media Cloud files while on the Foto tab (and no media photos in that upload),
        // automatically switch to File Cloud so they immediately see their uploaded file(s)!
        if (options.fromUpload && addedItems.length > 0) {
            const hasNewCloudFiles = addedItems.some(item => item.isMedia === false || !classifyExtensionClient(item.filename || '').isMedia);
            const hasNewMediaFiles = addedItems.some(item => item.isMedia === true || classifyExtensionClient(item.filename || '').isMedia);
            if (hasNewCloudFiles && !hasNewMediaFiles && currentViewTab !== 'files') {
                switchToTab('files');
            } else if (hasNewMediaFiles && !hasNewCloudFiles && currentViewTab === 'trash') {
                switchToTab('media');
            }
        }

        updateHeaderForCurrentTab();
        if (typeof window.syncSelectionUI === 'function') {
            window.syncSelectionUI();
        }
    }

    async function refreshVaultFromSession(options = {}) {
        try {
            const res = await fetch('/api/session', {
                headers: { 'Accept': 'application/json' }
            });
            if (!res.ok) return;
            const data = await res.json();
            if (data && Array.isArray(data.mediaFiles)) {
                syncVaultItemsFromServer(data.mediaFiles, options);
            }
            if (data && Array.isArray(data.trashedFiles)) {
                trashItemsCache = data.trashedFiles;
                trashLoaded = true;
                renderTrashPaneDom();
                updateHeaderForCurrentTab();
            }
        } catch {
            // Ignore transient network errors
        }
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
            const info = classifyExtensionClient(filename);
            const isMedia = item.isMedia !== undefined ? item.isMedia : info.isMedia;
            const category = item.category || info.category;

            const wrapper = document.createElement('div');
            wrapper.className = 'media-card-wrapper';
            wrapper.dataset.filename = filename;
            wrapper.dataset.size = String(item.size || 0);
            wrapper.dataset.isMedia = isMedia ? 'true' : 'false';

            const card = document.createElement('div');
            card.className = `media-card ${isMedia ? 'clickable-media' : 'clickable-cloud-file'}`;
            card.dataset.filename = filename;

            if (info.isImg) {
                const img = document.createElement('img');
                img.src = `/media/${encodeURIComponent(filename)}?from_trash=true`;
                img.alt = filename;
                img.loading = 'lazy';
                card.appendChild(img);
            } else if (info.isVid) {
                const video = document.createElement('video');
                video.preload = 'metadata';
                const source = document.createElement('source');
                source.src = `/media/${encodeURIComponent(filename)}?from_trash=true#t=0.5`;
                source.type = 'video/mp4';
                video.appendChild(source);
                card.appendChild(video);
            } else {
                const iconName = getCategoryIcon(category, info.ext);
                const preview = document.createElement('div');
                preview.className = 'cloud-file-preview';
                preview.dataset.category = String(category);

                const iconWrap = document.createElement('div');
                iconWrap.className = 'cloud-file-icon-wrap';
                const iconSpan = document.createElement('span');
                iconSpan.className = 'material-icons';
                iconSpan.textContent = iconName;
                const extSpan = document.createElement('span');
                extSpan.className = 'cloud-file-ext';
                extSpan.textContent = (info.ext || 'FILE').toUpperCase();
                iconWrap.appendChild(iconSpan);
                iconWrap.appendChild(extSpan);

                const metaWrap = document.createElement('div');
                metaWrap.className = 'cloud-file-meta';
                const titleSpan = document.createElement('span');
                titleSpan.className = 'cloud-file-title';
                titleSpan.textContent = filename;
                const subSpan = document.createElement('span');
                subSpan.className = 'cloud-file-sub';
                subSpan.textContent = formatBytesHuman(item.size);
                metaWrap.appendChild(titleSpan);
                metaWrap.appendChild(subSpan);

                preview.appendChild(iconWrap);
                preview.appendChild(metaWrap);
                card.appendChild(preview);
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
                if (trashItemsCache.length === 0) renderTrashPaneDom();
                updateHeaderForCurrentTab();
                try {
                    const res = await fetch(`/restore/${encodeURIComponent(filename)}`, {
                        method: 'POST',
                        headers: { 'Accept': 'application/json' }
                    });
                    const data = await res.json();
                    if (data.success) {
                        await refreshVaultFromSession();
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
            const currentSelectableCount = currentViewTab === 'media' ? mediaCount : (currentViewTab === 'files' ? filesCount : 0);
            selectAllBtn.style.display = currentSelectableCount > 0 ? 'inline-flex' : 'none';
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
        if (typeof window.syncSelectionUI === 'function') {
            window.syncSelectionUI();
        }

        if (targetTab === 'trash' && !trashLoaded) {
            loadTrashItems();
        }
    }

    function renderGroups() {
        buildMediaPane();
        buildFilesPane();
        updateHeaderForCurrentTab();
        if (typeof window.syncSelectionUI === 'function') {
            window.syncSelectionUI();
        }
    }

    window.refreshGalleryGrouping = renderGroups;
    window.refreshTrashPane = loadTrashItems;
    window.switchVaultTab = switchToTab;
    window.syncVaultItemsFromServer = syncVaultItemsFromServer;
    window.refreshVaultFromSession = refreshVaultFromSession;

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
