document.addEventListener('DOMContentLoaded', () => {
    const galleryGrid = document.querySelector('.gallery-grid');
    const groupBySelect = document.getElementById('group-by-select');
    const mainViewTitle = document.getElementById('main-view-title');
    const mediaCountEl = document.getElementById('media-count');
    const tabMediaBtn = document.getElementById('tab-media-btn');
    const tabFilesBtn = document.getElementById('tab-files-btn');
    const groupingControlsWrap = document.getElementById('grouping-controls-wrap');

    if (!galleryGrid || !groupBySelect) return;

    const groupingLevels = ['none', 'year', 'month', 'day', 'album'];
    let currentGroupingIndex = groupingLevels.indexOf(groupBySelect.value);
    let currentViewTab = 'media'; // 'media' | 'files'

    let allElements = Array.from(galleryGrid.querySelectorAll('.media-card-wrapper'));

    const categoryLabels = {
        document: 'Documenti & PDF',
        archive: 'Archivi, ZIP & APK',
        audio: 'Audio & Musica',
        code: 'Codice & Dati',
        other: 'Altri File Cloud'
    };

    function renderGroups() {
        galleryGrid.style.opacity = '0';

        setTimeout(() => {
            allElements = allElements.filter(el => el.isConnected || el.parentElement);
            galleryGrid.innerHTML = '';

            const filtered = allElements.filter(el => {
                const isMedia = el.dataset.isMedia !== 'false';
                return currentViewTab === 'media' ? isMedia : !isMedia;
            });

            if (mainViewTitle) {
                mainViewTitle.textContent = currentViewTab === 'media' ? 'Il tuo archivio' : 'File Manager Cloud';
            }
            if (mediaCountEl) {
                mediaCountEl.textContent = `${filtered.length} elementi`;
            }
            if (groupingControlsWrap) {
                groupingControlsWrap.style.display = currentViewTab === 'media' ? 'inline-flex' : 'none';
            }

            if (filtered.length === 0) {
                const emptyDiv = document.createElement('div');
                emptyDiv.className = 'empty-state';
                emptyDiv.innerHTML = currentViewTab === 'media'
                    ? `<span class="material-icons">photo_library</span>
                       <h3>Nessuna foto o video</h3>
                       <p>Tocca + Carica nella barra in basso per aggiungere foto o video.</p>`
                    : `<span class="material-icons">folder_open</span>
                       <h3>Nessun file nel File Manager Cloud</h3>
                       <p>Tocca + Carica per caricare PDF, archivi ZIP, APK, documenti o audio.</p>`;
                galleryGrid.appendChild(emptyDiv);
                galleryGrid.style.opacity = '1';
                return;
            }

            if (currentViewTab === 'files') {
                // Cloud File Manager: group non-media files by Category (and Album if assigned)
                const groups = new Map();
                filtered.forEach(el => {
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
                    galleryGrid.appendChild(groupContainer);
                });
            } else {
                const level = groupBySelect.value;
                if (level === 'none') {
                    const groupGrid = document.createElement('div');
                    groupGrid.className = 'media-group-grid';
                    filtered.forEach(el => groupGrid.appendChild(el));
                    galleryGrid.appendChild(groupGrid);
                } else {
                    const groups = new Map();
                    filtered.forEach(el => {
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
                        galleryGrid.appendChild(groupContainer);
                    });
                }
            }

            galleryGrid.style.opacity = '1';
        }, 160);
    }

    window.refreshGalleryGrouping = renderGroups;

    groupBySelect.addEventListener('change', (e) => {
        currentGroupingIndex = groupingLevels.indexOf(e.target.value);
        renderGroups();
    });

    if (tabMediaBtn && tabFilesBtn) {
        tabMediaBtn.addEventListener('click', () => {
            currentViewTab = 'media';
            tabMediaBtn.classList.add('active');
            tabFilesBtn.classList.remove('active');
            renderGroups();
        });
        tabFilesBtn.addEventListener('click', () => {
            currentViewTab = 'files';
            tabFilesBtn.classList.add('active');
            tabMediaBtn.classList.remove('active');
            renderGroups();
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
                renderGroups();
            }
        }
    }, { passive: false });

    renderGroups();
});
