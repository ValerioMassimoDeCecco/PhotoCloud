// static/scripts/cloud-features.js — Funzionalità PhotoCloud v1.4.0:
// ⭐ Preferiti · 🕐 Ricordi (In questo giorno) · 🔍 Ricerca in linguaggio naturale
// 🔗 Link pubblici temporanei · 👥 Album multi-utente · 🔔 Notifiche Push Web

document.addEventListener('DOMContentLoaded', () => {
    const galleryContainer = document.querySelector('.gallery-container');
    if (!galleryContainer) return; // siamo sulla pagina login/cestino

    // ==========================================================================
    // TOAST MINIMALE
    // ==========================================================================
    let toastEl = null;
    let toastTimer = null;
    function showToast(message, isError = false) {
        if (!toastEl) {
            toastEl = document.createElement('div');
            toastEl.className = 'pc-toast';
            document.body.appendChild(toastEl);
        }
        toastEl.textContent = message;
        toastEl.classList.toggle('error', isError);
        toastEl.classList.add('visible');
        clearTimeout(toastTimer);
        toastTimer = setTimeout(() => toastEl.classList.remove('visible'), 3200);
    }

    async function apiPost(url, body) {
        const res = await fetch(url, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
            body: JSON.stringify(body || {}),
        });
        const data = await res.json().catch(() => ({}));
        return { ok: res.ok, status: res.status, data };
    }

    // ==========================================================================
    // ⭐ PREFERITI
    // ==========================================================================
    let favoriteSet = new Set();
    try {
        favoriteSet = new Set(JSON.parse(galleryContainer.dataset.favorites || '[]'));
    } catch {
        favoriteSet = new Set();
    }

    const favoritesFilterBtn = document.getElementById('favorites-filter-btn');
    let favoritesOnly = false;

    function isMediaFilename(fn) {
        return /\.(jpe?g|png|gif|webp|bmp|svg|heic|avif|mp4|mov|webm|mkv)$/i.test(fn);
    }

    function ensureFavBadge(wrapper) {
        if (!wrapper || wrapper.dataset.isMedia === 'false') return;
        const card = wrapper.querySelector('.media-card');
        if (!card) return;
        let badge = wrapper.querySelector('.media-fav-badge');
        if (!badge) {
            badge = document.createElement('button');
            badge.type = 'button';
            badge.className = 'media-fav-badge';
            badge.innerHTML = '<span class="material-icons">star_border</span>';
            badge.addEventListener('click', (e) => {
                const fn = wrapper.dataset.filename;
                if (fn) window.toggleFavoriteFromGallery(fn, e);
            });
            card.appendChild(badge);
        }
        const isFav = favoriteSet.has(wrapper.dataset.filename);
        wrapper.dataset.favorite = isFav ? 'true' : 'false';
        badge.classList.toggle('is-favourite', isFav);
        badge.querySelector('.material-icons').textContent = isFav ? 'star' : 'star_border';
    }

    function refreshFavBadges() {
        document.querySelectorAll('.media-card-wrapper[data-filename]').forEach(ensureFavBadge);
    }

    function applyFavoritesFilter() {
        document.querySelectorAll('#pane-media .media-card-wrapper, #pane-files .media-card-wrapper').forEach((w) => {
            w.classList.toggle('fav-hidden', favoritesOnly && !favoriteSet.has(w.dataset.filename));
        });
        if (favoritesFilterBtn) {
            favoritesFilterBtn.classList.toggle('active-filter', favoritesOnly);
            favoritesFilterBtn.setAttribute('aria-pressed', favoritesOnly ? 'true' : 'false');
        }
        const countEl = document.getElementById('media-count');
        if (countEl && favoritesOnly) {
            const visible = [...document.querySelectorAll('#pane-media .media-card-wrapper')].filter(
                (w) => !w.classList.contains('fav-hidden') && w.dataset.isMedia !== 'false'
            ).length;
            countEl.textContent = `${visible} preferiti`;
        } else if (countEl && typeof window.refreshGalleryHeader === 'function') {
            window.refreshGalleryHeader();
        }
        // i titoli dei gruppi vuoti vanno nascosti
        document.querySelectorAll('#pane-media .media-group').forEach((g) => {
            const anyVisible = [...g.querySelectorAll('.media-card-wrapper')].some(
                (w) => !w.classList.contains('fav-hidden') && !w.classList.contains('search-hidden')
            );
            g.classList.toggle('group-collapsed', !anyVisible && (favoritesOnly || searchActive));
        });
    }

    async function toggleFavorite(filename, event) {
        if (event) {
            event.stopPropagation();
            event.preventDefault();
        }
        const { ok, data } = await apiPost('/api/favorites/toggle', { filename });
        if (!ok) {
            showToast(data.error || 'Errore preferito', true);
            return;
        }
        favoriteSet = new Set(data.favorites || []);
        refreshFavBadges();
        applyFavoritesFilter();
        syncLightboxFavorite();
        showToast(data.isFavorite ? '⭐ Aggiunto ai Preferiti' : 'Rimosso dai Preferiti');
    }
    window.toggleFavoriteFromGallery = toggleFavorite;

    // --- Pulsante Preferito nella Lightbox ---
    const lightboxFavBtn = document.getElementById('lightbox-favorite-btn');
    const lightboxShareBtn = document.getElementById('lightbox-share-btn');

    function syncLightboxFavorite() {
        if (!lightboxFavBtn) return;
        const fn = typeof window.getCurrentLightboxFilename === 'function' ? window.getCurrentLightboxFilename() : '';
        const visible = !!fn && isMediaFilename(fn);
        lightboxFavBtn.style.display = visible ? 'inline-flex' : 'none';
        if (lightboxShareBtn) lightboxShareBtn.style.display = fn ? 'inline-flex' : 'none';
        if (!visible) return;
        const isFav = favoriteSet.has(fn);
        lightboxFavBtn.classList.toggle('active', isFav);
        lightboxFavBtn.querySelector('.material-icons').textContent = isFav ? 'star' : 'star_border';
    }

    function watchLightboxCurrent() {
        const counter = document.getElementById('lightbox-counter');
        if (!counter) return;
        const mo = new MutationObserver(syncLightboxFavorite);
        mo.observe(counter, { childList: true, characterData: true, subtree: true });
        const lb = document.getElementById('lightbox');
        if (lb) {
            const mo2 = new MutationObserver(syncLightboxFavorite);
            mo2.observe(lb, { attributes: true, attributeFilter: ['style', 'class'] });
        }
    }
    watchLightboxCurrent();

    if (lightboxFavBtn) {
        lightboxFavBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            const fn = typeof window.getCurrentLightboxFilename === 'function' ? window.getCurrentLightboxFilename() : '';
            if (fn) toggleFavorite(fn);
        });
    }

    if (favoritesFilterBtn) {
        favoritesFilterBtn.addEventListener('click', () => {
            favoritesOnly = !favoritesOnly;
            applyFavoritesFilter();
        });
    }

    // --- Pulsante Preferiti nella barra di selezione ---
    const favoriteSelectedBtn = document.getElementById('favorite-selected-btn');
    if (favoriteSelectedBtn) {
        favoriteSelectedBtn.addEventListener('click', async () => {
            const sel = typeof window.getSelectedFilenames === 'function' ? window.getSelectedFilenames() : [];
            if (sel.length === 0) return;
            const { ok, data } = await apiPost('/api/favorites/set-many', { filenames: sel, favorite: true });
            if (ok) {
                favoriteSet = new Set(data.favorites || []);
                refreshFavBadges();
                applyFavoritesFilter();
                showToast(`⭐ ${sel.length} elementi aggiunti ai Preferiti`);
            } else {
                showToast(data.error || 'Errore preferiti', true);
            }
        });
    }

    // ==========================================================================
    // 🔍 RICERCA IN LINGUAGGIO NATURALE
    // ==========================================================================
    const searchInput = document.getElementById('vault-search-input');
    const searchClearBtn = document.getElementById('vault-search-clear-btn');
    let searchActive = false;
    let searchTimer = null;

    function clearSearch() {
        searchActive = false;
        if (searchInput) searchInput.value = '';
        if (searchClearBtn) searchClearBtn.style.display = 'none';
        document.querySelectorAll('.search-hidden').forEach((el) => el.classList.remove('search-hidden'));
        document.querySelectorAll('.group-collapsed').forEach((el) => el.classList.remove('group-collapsed'));
        const countEl = document.getElementById('media-count');
        const pane = document.getElementById('pane-media');
        if (countEl && pane && pane.style.display !== 'none') {
            const n = pane.querySelectorAll('.media-card-wrapper[data-is-media="true"]').length;
            countEl.textContent = `${n} elementi`;
        }
    }

    async function runSearch(query) {
        if (!query || !query.trim()) {
            clearSearch();
            return;
        }
        try {
            const res = await fetch(`/api/search?q=${encodeURIComponent(query)}`);
            const data = await res.json().catch(() => ({}));
            if (!res.ok || !Array.isArray(data.results)) {
                showToast(data.error || 'Errore nella ricerca', true);
                return;
            }
            searchActive = true;
            const matchSet = new Set(data.results.map((r) => r.filename));
            document.querySelectorAll('#pane-media .media-card-wrapper, #pane-files .media-card-wrapper').forEach((w) => {
                w.classList.toggle('search-hidden', !matchSet.has(w.dataset.filename));
            });
            document.querySelectorAll('#pane-media .media-group').forEach((g) => {
                const anyVisible = [...g.querySelectorAll('.media-card-wrapper')].some((w) => !w.classList.contains('search-hidden'));
                g.classList.toggle('group-collapsed', !anyVisible);
            });
            const countEl = document.getElementById('media-count');
            if (countEl) {
                const expl = Array.isArray(data.explanation) && data.explanation.length ? ` · ${data.explanation.join(', ')}` : '';
                countEl.textContent = `${data.count} risultati per "${query}"${expl}`;
            }
            if (searchClearBtn) searchClearBtn.style.display = 'inline-flex';
        } catch {
            showToast('Errore di rete durante la ricerca', true);
        }
    }

    if (searchInput) {
        searchInput.addEventListener('input', () => {
            clearTimeout(searchTimer);
            const q = searchInput.value;
            searchTimer = setTimeout(() => runSearch(q), 350);
        });
        searchInput.addEventListener('keydown', (e) => {
            if (e.key === 'Escape') clearSearch();
        });
    }
    if (searchClearBtn) {
        searchClearBtn.addEventListener('click', clearSearch);
    }

    // ==========================================================================
    // 🕐 RICORDI — "In questo giorno"
    // ==========================================================================
    const memoriesOverlay = document.getElementById('memories-overlay');
    const openMemoriesBtn = document.getElementById('open-memories-btn');
    const closeMemoriesBtn = document.getElementById('close-memories-btn');
    const memoriesContent = document.getElementById('memories-content');
    const memoriesSubtitle = document.getElementById('memories-subtitle');
    const memoriesSlideshowBtn = document.getElementById('memories-slideshow-btn');
    let memoryUrls = [];

    function buildMediaCardHtml(item, baseUrl) {
        const fn = item.filename;
        const ext = (fn.split('.').pop() || '').toLowerCase();
        const isImg = ['jpg', 'jpeg', 'png', 'gif', 'webp', 'bmp', 'svg', 'heic', 'avif'].includes(ext);
        const isVid = ['mp4', 'mov', 'webm', 'mkv'].includes(ext);
        const url = `${baseUrl}${encodeURIComponent(fn)}`;
        const safeName = String(fn).replace(/</g, '&lt;');
        const inner = isImg
            ? `<img loading="lazy" src="${url}" alt="${safeName}">`
            : isVid
              ? `<video preload="metadata" muted src="${url}#t=0.5"></video><div class="video-overlay"><span class="material-icons">play_circle</span></div>`
              : `<div class="cloud-file-preview"><div class="cloud-file-icon-wrap"><span class="material-icons">insert_drive_file</span><span class="cloud-file-ext">${ext.toUpperCase()}</span></div></div>`;
        return `<div class="media-card-wrapper is-media-item" data-filename="${safeName}" data-url="${url}" data-is-media="true">
            <div class="media-card clickable-media vm-memory-card">${inner}</div>
        </div>`;
    }

    async function openMemories() {
        if (!memoriesOverlay) return;
        memoriesOverlay.style.display = 'flex';
        memoriesContent.innerHTML = '<div class="empty-state"><span class="material-icons">hourglass_empty</span><h3>Caricamento ricordi…</h3></div>';
        try {
            const res = await fetch('/api/memories');
            const data = await res.json().catch(() => ({}));
            if (!res.ok) {
                memoriesContent.innerHTML = `<div class="empty-state"><span class="material-icons">error_outline</span><h3>${data.error || 'Errore caricamento'}</h3></div>`;
                return;
            }
            const sections = Array.isArray(data.sections) ? data.sections : [];
            memoryUrls = sections.flatMap((s) =>
                (s.items || []).map((it) => `/media/${encodeURIComponent(it.filename)}`)
            );
            if (data.count === 0) {
                memoriesSubtitle.textContent = 'Nessuna foto scattata in questo giorno negli anni passati';
                memoriesContent.innerHTML = `<div class="empty-state"><span class="material-icons">history_toggle_off</span>
                    <h3>Nessun ricordo oggi</h3>
                    <p>Quando avrai foto scattate in questo giorno negli anni passati, appariranno qui.</p></div>`;
                memoriesSlideshowBtn.style.display = 'none';
                return;
            }
            memoriesSubtitle.textContent = `${data.count} foto e video — ${new Date().toLocaleDateString('it-IT', { day: 'numeric', month: 'long' })}`;
            memoriesSlideshowBtn.style.display = memoryUrls.length > 0 ? 'inline-flex' : 'none';
            memoriesContent.innerHTML = sections
                .map(
                    (s) => `<section class="memories-section">
                        <h3 class="group-title">✨ ${s.yearsAgo} ${s.yearsAgo === 1 ? 'anno' : 'anni'} fa (${s.items.length})</h3>
                        <div class="media-group-grid">${s.items.map((it) => buildMediaCardHtml(it, '/media/')).join('')}</div>
                    </section>`
                )
                .join('');
        } catch {
            memoriesContent.innerHTML = '<div class="empty-state"><span class="material-icons">error_outline</span><h3>Errore di rete</h3></div>';
        }
    }

    if (openMemoriesBtn) openMemoriesBtn.addEventListener('click', openMemories);
    if (closeMemoriesBtn) closeMemoriesBtn.addEventListener('click', () => { memoriesOverlay.style.display = 'none'; });
    if (memoriesOverlay) {
        memoriesOverlay.addEventListener('click', (e) => {
            const card = e.target.closest('.vm-memory-card');
            if (!card) return;
            const wrapper = card.closest('[data-url]');
            const url = wrapper ? wrapper.dataset.url : null;
            if (!url) return;
            if (typeof window.openLightbox === 'function') {
                window.openLightbox(url, false, 0, memoryUrls);
            }
        });
    }
    if (memoriesSlideshowBtn) {
        memoriesSlideshowBtn.addEventListener('click', () => {
            if (memoryUrls.length === 0) return;
            memoriesOverlay.style.display = 'none';
            if (typeof window.openLightbox === 'function') window.openLightbox(memoryUrls[0], false, 0, memoryUrls);
            setTimeout(() => {
                if (typeof window.startPhotoCloudSlideshow === 'function') window.startPhotoCloudSlideshow();
            }, 120);
        });
    }

    // ==========================================================================
    // 🔗 LINK PUBBLICI TEMPORANEI (creazione + gestione)
    // ==========================================================================
    const shareCreateBackdrop = document.getElementById('share-create-modal-backdrop');
    const shareCreateCount = document.getElementById('share-create-count');
    const shareLabelInput = document.getElementById('share-label-input');
    const shareExpirySelect = document.getElementById('share-expiry-select');
    const shareMaxDownloadsInput = document.getElementById('share-max-downloads-input');
    const sharePasswordInput = document.getElementById('share-password-input');
    const shareCreateResult = document.getElementById('share-create-result');
    const shareLinkOutput = document.getElementById('share-link-output');
    const copyShareLinkBtn = document.getElementById('copy-share-link-btn');
    const confirmCreateShareBtn = document.getElementById('confirm-create-share-btn');
    const closeShareCreateModalBtn = document.getElementById('close-share-create-modal-btn');
    let pendingShareFilenames = [];

    function openShareCreateModal(filenames) {
        pendingShareFilenames = filenames.slice(0, 500);
        if (!shareCreateBackdrop || pendingShareFilenames.length === 0) return;
        shareCreateCount.textContent = String(pendingShareFilenames.length);
        shareCreateResult.style.display = 'none';
        shareLinkOutput.value = '';
        confirmCreateShareBtn.disabled = false;
        shareCreateBackdrop.style.display = 'flex';
    }
    window.openPhotoCloudShareModal = openShareCreateModal;

    const shareSelectedBtn = document.getElementById('share-selected-btn');
    if (shareSelectedBtn) {
        shareSelectedBtn.addEventListener('click', () => {
            const sel = typeof window.getSelectedFilenames === 'function' ? window.getSelectedFilenames() : [];
            if (sel.length === 0) {
                showToast('Seleziona prima almeno un elemento', true);
                return;
            }
            openShareCreateModal(sel);
        });
    }
    if (lightboxShareBtn) {
        lightboxShareBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            const fn = typeof window.getCurrentLightboxFilename === 'function' ? window.getCurrentLightboxFilename() : '';
            if (fn) openShareCreateModal([fn]);
        });
    }

    if (closeShareCreateModalBtn) {
        closeShareCreateModalBtn.addEventListener('click', () => { shareCreateBackdrop.style.display = 'none'; });
    }
    if (shareCreateBackdrop) {
        shareCreateBackdrop.addEventListener('click', (e) => {
            if (e.target === shareCreateBackdrop) shareCreateBackdrop.style.display = 'none';
        });
    }
    if (copyShareLinkBtn) {
        copyShareLinkBtn.addEventListener('click', async () => {
            try {
                await navigator.clipboard.writeText(shareLinkOutput.value);
                showToast('🔗 Link copiato negli appunti');
            } catch {
                shareLinkOutput.select();
            }
        });
    }
    if (confirmCreateShareBtn) {
        confirmCreateShareBtn.addEventListener('click', async () => {
            confirmCreateShareBtn.disabled = true;
            const { ok, data } = await apiPost('/api/shares/create', {
                filenames: pendingShareFilenames,
                label: shareLabelInput.value.trim(),
                expiresInHours: Number(shareExpirySelect.value),
                maxDownloads: Number(shareMaxDownloadsInput.value) || null,
                password: sharePasswordInput.value,
            });
            confirmCreateShareBtn.disabled = false;
            if (!ok) {
                showToast(data.error || 'Errore creazione link', true);
                return;
            }
            const absolute = `${window.location.origin}${data.url}`;
            shareLinkOutput.value = absolute;
            shareCreateResult.style.display = 'flex';
            showToast('🔗 Link pubblico creato');
            try {
                await navigator.clipboard.writeText(absolute);
            } catch {
                // clipboard non disponibile: l'utente copia dal campo
            }
        });
    }

    // ==========================================================================
    // 🔗👥 OVERLAY GESTIONE CONDIVISIONI + ALBUM MULTI-UTENTE
    // ==========================================================================
    const sharesOverlay = document.getElementById('shares-overlay');
    const openSharesBtn = document.getElementById('open-shares-btn');
    const closeSharesBtn = document.getElementById('close-shares-btn');
    const publicSharesList = document.getElementById('public-shares-list');
    const ownedAlbumSharesList = document.getElementById('owned-album-shares-list');
    const sharedWithMeList = document.getElementById('shared-with-me-list');

    function formatExpiry(expiresAt) {
        const d = new Date(expiresAt);
        const diff = d.getTime() - Date.now();
        if (diff <= 0) return 'scaduto';
        const hours = Math.round(diff / 3600000);
        if (hours < 48) return `scade tra ${hours}h`;
        return `scade il ${d.toLocaleDateString('it-IT', { day: 'numeric', month: 'short' })}`;
    }

    async function loadSharesOverlay() {
        publicSharesList.innerHTML = '<p class="shares-hint">Caricamento…</p>';
        try {
            const [linksRes, albumsRes] = await Promise.all([fetch('/api/shares'), fetch('/api/albums/shared')]);
            const links = await linksRes.json().catch(() => ({ shares: [] }));
            const albumShares = await albumsRes.json().catch(() => ({ ownedByMe: [], sharedWithMe: [] }));

            // --- Link pubblici ---
            const myShares = Array.isArray(links.shares) ? links.shares : [];
            publicSharesList.innerHTML = myShares.length === 0
                ? '<p class="shares-hint">Nessun link pubblico attivo. Seleziona foto o file e tocca "Condividi".</p>'
                : '';
            myShares.forEach((s) => {
                const row = document.createElement('div');
                row.className = 'share-row';
                const lockIcon = s.hasPassword ? ' 🔒' : '';
                row.innerHTML = `
                    <div class="share-row-main">
                        <strong>${(s.label || 'Link senza nome').replace(/</g, '&lt;')}${lockIcon}</strong>
                        <span class="share-row-meta">${s.filenames.length} elementi · ${formatExpiry(s.expiresAt)} · ${s.downloadCount}${s.maxDownloads ? `/${s.maxDownloads}` : ''} download</span>
                    </div>
                    <button type="button" class="btn icon danger share-revoke-btn" title="Revoca link (smette subito di funzionare)">
                        <span class="material-icons">link_off</span>
                    </button>`;
                row.querySelector('.share-revoke-btn').addEventListener('click', async () => {
                    if (!confirm('Revocare questo link pubblico? Smetterà immediatamente di funzionare.')) return;
                    const { ok } = await apiPost('/api/shares/delete', { id: s.id });
                    if (ok) {
                        row.remove();
                        showToast('Link revocato');
                    } else {
                        showToast('Errore revoca link', true);
                    }
                });
                publicSharesList.appendChild(row);
            });

            // --- Album condivisi da me ---
            const owned = Array.isArray(albumShares.ownedByMe) ? albumShares.ownedByMe : [];
            ownedAlbumSharesList.innerHTML = owned.length === 0
                ? '<p class="shares-hint">Non stai condividendo alcun album. Aprilo da "Album" → sezione Condividi.</p>'
                : '';
            owned.forEach((s) => {
                const row = document.createElement('div');
                row.className = 'share-row';
                const participants = Object.entries(s.participants || {})
                    .map(([u, r]) => `${u} (${r === 'contributor' ? 'collaboratore' : 'lettura'})`)
                    .join(', ');
                row.innerHTML = `
                    <div class="share-row-main">
                        <strong>📁 ${String(s.album).replace(/</g, '&lt;')}</strong>
                        <span class="share-row-meta">${s.itemCount} elementi · condiviso con: ${participants || 'nessuno'}</span>
                    </div>
                    <button type="button" class="btn icon danger share-revoke-btn" title="Rimuovi tutte le condivisioni di questo album">
                        <span class="material-icons">person_remove</span>
                    </button>`;
                row.querySelector('.share-revoke-btn').addEventListener('click', async () => {
                    if (!confirm(`Smettere di condividere l'album "${s.album}"?`)) return;
                    const { ok } = await apiPost('/api/albums/unshare', { album: s.album });
                    if (ok) {
                        row.remove();
                        showToast('Condivisione album rimossa');
                    } else {
                        showToast('Errore rimozione condivisione', true);
                    }
                });
                ownedAlbumSharesList.appendChild(row);
            });

            // --- Album condivisi con me ---
            const withMe = Array.isArray(albumShares.sharedWithMe) ? albumShares.sharedWithMe : [];
            sharedWithMeList.innerHTML = withMe.length === 0
                ? '<p class="shares-hint">Nessun album è condiviso con te al momento.</p>'
                : '';
            withMe.forEach((s) => {
                const row = document.createElement('div');
                row.className = 'share-row actionable';
                row.innerHTML = `
                    <div class="share-row-main">
                        <strong>👥 ${String(s.album).replace(/</g, '&lt;')}</strong>
                        <span class="share-row-meta">di ${String(s.owner).replace(/</g, '&lt;')} · ${s.itemCount} elementi · ${s.role === 'contributor' ? 'puoi caricare' : 'sola lettura'}</span>
                    </div>
                    <button type="button" class="btn outlined share-open-btn">
                        <span class="material-icons">open_in_new</span>
                        <span class="btn-text">Apri</span>
                    </button>`;
                row.querySelector('.share-open-btn').addEventListener('click', () => openSharedAlbum(s));
                sharedWithMeList.appendChild(row);
            });
        } catch {
            publicSharesList.innerHTML = '<p class="shares-hint">Errore di rete.</p>';
        }
    }

    if (openSharesBtn) {
        openSharesBtn.addEventListener('click', () => {
            sharesOverlay.style.display = 'flex';
            loadSharesOverlay();
        });
    }
    if (closeSharesBtn) closeSharesBtn.addEventListener('click', () => { sharesOverlay.style.display = 'none'; });

    // ==========================================================================
    // 👥 OVERLAY ALBUM CONDIVISO (visualizzazione + upload collaboratore)
    // ==========================================================================
    const sharedAlbumOverlay = document.getElementById('shared-album-overlay');
    const closeSharedAlbumBtn = document.getElementById('close-shared-album-btn');
    const sharedAlbumTitle = document.getElementById('shared-album-title');
    const sharedAlbumSubtitle = document.getElementById('shared-album-subtitle');
    const sharedAlbumContent = document.getElementById('shared-album-content');
    const sharedAlbumUploadBtn = document.getElementById('shared-album-upload-btn');
    const sharedAlbumSlideshowBtn = document.getElementById('shared-album-slideshow-btn');
    const sharedAlbumFileInput = document.getElementById('shared-album-file-input');
    let currentSharedAlbum = null;
    let sharedAlbumUrls = [];

    async function openSharedAlbum(share) {
        currentSharedAlbum = share;
        sharedAlbumOverlay.style.display = 'flex';
        sharedAlbumTitle.textContent = share.album;
        sharedAlbumSubtitle.textContent = `Condiviso da ${share.owner} · ${share.role === 'contributor' ? 'collaboratore' : 'sola lettura'}`;
        sharedAlbumUploadBtn.style.display = share.role === 'contributor' ? 'inline-flex' : 'none';
        sharedAlbumContent.innerHTML = '<div class="empty-state"><span class="material-icons">hourglass_empty</span><h3>Caricamento…</h3></div>';
        await reloadSharedAlbumContent();
    }

    async function reloadSharedAlbumContent() {
        if (!currentSharedAlbum) return;
        try {
            const res = await fetch(`/api/shared-albums/${encodeURIComponent(currentSharedAlbum.id)}/media`);
            const data = await res.json().catch(() => ({}));
            if (!res.ok) {
                sharedAlbumContent.innerHTML = `<div class="empty-state"><span class="material-icons">error_outline</span><h3>${data.error || 'Errore caricamento'}</h3></div>`;
                return;
            }
            const items = Array.isArray(data.items) ? data.items : [];
            const base = `/api/shared-albums/${encodeURIComponent(currentSharedAlbum.id)}/file/`;
            sharedAlbumUrls = items.filter((it) => it.isMedia).map((it) => `${base}${encodeURIComponent(it.filename)}`);
            sharedAlbumSlideshowBtn.style.display = sharedAlbumUrls.length > 0 ? 'inline-flex' : 'none';
            if (items.length === 0) {
                sharedAlbumContent.innerHTML = `<div class="empty-state"><span class="material-icons">folder_open</span><h3>Album vuoto</h3>
                    <p>${data.role === 'contributor' ? 'Carica la prima foto con il pulsante "Carica".' : 'Il proprietario non ha ancora aggiunto elementi.'}</p></div>`;
                return;
            }
            sharedAlbumContent.innerHTML = `<div class="media-group-grid">${items.map((it) => buildMediaCardHtml(it, base)).join('')}</div>`;
        } catch {
            sharedAlbumContent.innerHTML = '<div class="empty-state"><span class="material-icons">error_outline</span><h3>Errore di rete</h3></div>';
        }
    }

    if (closeSharedAlbumBtn) closeSharedAlbumBtn.addEventListener('click', () => { sharedAlbumOverlay.style.display = 'none'; });
    if (sharedAlbumOverlay) {
        sharedAlbumOverlay.addEventListener('click', (e) => {
            const card = e.target.closest('.vm-memory-card');
            if (!card) return;
            const wrapper = card.closest('[data-url]');
            const url = wrapper ? wrapper.dataset.url : null;
            if (url && typeof window.openLightbox === 'function') {
                window.openLightbox(url, false, 0, sharedAlbumUrls);
            }
        });
    }
    if (sharedAlbumSlideshowBtn) {
        sharedAlbumSlideshowBtn.addEventListener('click', () => {
            if (sharedAlbumUrls.length === 0) return;
            sharedAlbumOverlay.style.display = 'none';
            if (typeof window.openLightbox === 'function') window.openLightbox(sharedAlbumUrls[0], false, 0, sharedAlbumUrls);
            setTimeout(() => {
                if (typeof window.startPhotoCloudSlideshow === 'function') window.startPhotoCloudSlideshow();
            }, 120);
        });
    }
    if (sharedAlbumUploadBtn && sharedAlbumFileInput) {
        sharedAlbumUploadBtn.addEventListener('click', () => sharedAlbumFileInput.click());
        sharedAlbumFileInput.addEventListener('change', async () => {
            const files = Array.from(sharedAlbumFileInput.files || []);
            if (files.length === 0 || !currentSharedAlbum) return;
            const form = new FormData();
            files.forEach((f) => form.append('file[]', f));
            sharedAlbumUploadBtn.disabled = true;
            try {
                const res = await fetch(`/api/shared-albums/${encodeURIComponent(currentSharedAlbum.id)}/upload`, {
                    method: 'POST',
                    body: form,
                });
                const data = await res.json().catch(() => ({}));
                if (res.ok) {
                    showToast(`📥 ${data.uploadedCount} file caricati nell'album condiviso`);
                    await reloadSharedAlbumContent();
                } else {
                    showToast(data.error || 'Errore caricamento', true);
                }
            } catch {
                showToast('Errore di rete durante il caricamento', true);
            } finally {
                sharedAlbumUploadBtn.disabled = false;
                sharedAlbumFileInput.value = '';
            }
        });
    }

    // ==========================================================================
    // 👥 CONDIVISIONE ALBUM DAL MODALE ALBUM (sezione dedicata)
    // ==========================================================================
    const albumShareSection = document.getElementById('album-share-section');
    const albumShareAlbumSelect = document.getElementById('album-share-album-select');
    const albumShareUsernameInput = document.getElementById('album-share-username-input');
    const albumShareRoleSelect = document.getElementById('album-share-role-select');
    const confirmShareAlbumBtn = document.getElementById('confirm-share-album-btn');
    const albumShareParticipantsList = document.getElementById('album-share-participants-list');
    const newAlbumBtn = document.getElementById('new-album-btn');

    let availableAlbumsCache = [];
    try {
        availableAlbumsCache = JSON.parse(galleryContainer.dataset.albums || '[]');
    } catch {
        availableAlbumsCache = [];
    }

    function populateAlbumShareSelect() {
        if (!albumShareAlbumSelect) return;
        albumShareAlbumSelect.innerHTML = availableAlbumsCache
            .map((a) => `<option value="${String(a).replace(/"/g, '&quot;')}">${String(a).replace(/</g, '&lt;')}</option>`)
            .join('');
        albumShareSection.style.display = availableAlbumsCache.length > 0 ? 'block' : 'none';
        refreshAlbumShareParticipants();
    }

    async function refreshAlbumShareParticipants() {
        if (!albumShareParticipantsList || !albumShareAlbumSelect || !albumShareAlbumSelect.value) {
            if (albumShareParticipantsList) albumShareParticipantsList.innerHTML = '';
            return;
        }
        try {
            const res = await fetch('/api/albums/shared');
            const data = await res.json().catch(() => ({}));
            const mine = (data.ownedByMe || []).find((s) => s.album === albumShareAlbumSelect.value);
            const parts = mine ? Object.entries(mine.participants || {}) : [];
            albumShareParticipantsList.innerHTML =
                parts.length === 0
                    ? '<p class="shares-hint">Nessuna condivisione attiva per questo album.</p>'
                    : parts
                          .map(
                              ([u, r]) => `<div class="share-row">
                                <div class="share-row-main"><strong>${String(u).replace(/</g, '&lt;')}</strong>
                                <span class="share-row-meta">${r === 'contributor' ? 'collaboratore' : 'sola lettura'}</span></div>
                                <button type="button" class="btn icon danger participant-remove-btn" data-user="${String(u).replace(/"/g, '&quot;')}" title="Rimuovi partecipante">
                                    <span class="material-icons">person_remove</span>
                                </button>
                              </div>`
                          )
                          .join('');
            albumShareParticipantsList.querySelectorAll('.participant-remove-btn').forEach((btn) => {
                btn.addEventListener('click', async () => {
                    const { ok } = await apiPost('/api/albums/unshare', {
                        album: albumShareAlbumSelect.value,
                        username: btn.dataset.user,
                    });
                    if (ok) {
                        showToast('Partecipante rimosso');
                        refreshAlbumShareParticipants();
                    } else {
                        showToast('Errore rimozione partecipante', true);
                    }
                });
            });
        } catch {
            // silenzioso
        }
    }

    if (albumShareAlbumSelect) albumShareAlbumSelect.addEventListener('change', refreshAlbumShareParticipants);
    if (newAlbumBtn) newAlbumBtn.addEventListener('click', populateAlbumShareSelect);
    if (confirmShareAlbumBtn) {
        confirmShareAlbumBtn.addEventListener('click', async () => {
            const album = albumShareAlbumSelect ? albumShareAlbumSelect.value : '';
            const username = albumShareUsernameInput.value.trim();
            const role = albumShareRoleSelect.value;
            if (!album || !username) {
                showToast('Scegli album e inserisci lo username', true);
                return;
            }
            const { ok, data } = await apiPost('/api/albums/share', { album, username, role });
            if (ok) {
                showToast(`📁 Album "${album}" condiviso con ${username}`);
                albumShareUsernameInput.value = '';
                refreshAlbumShareParticipants();
            } else {
                showToast(data.error || 'Errore condivisione album', true);
            }
        });
    }

    // ==========================================================================
    // 🔔 NOTIFICHE PUSH WEB (VAPID)
    // ==========================================================================
    const pushBtn = document.getElementById('push-notifications-btn');
    const pushIcon = document.getElementById('push-notifications-icon');
    const pushLabel = document.getElementById('push-notifications-label');
    let pushSupported = 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window;
    let pushSubscribed = false;

    function urlBase64ToUint8Array(base64String) {
        const padding = '='.repeat((4 - (base64String.length % 4)) % 4);
        const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/');
        const rawData = atob(base64);
        const outputArray = new Uint8Array(rawData.length);
        for (let i = 0; i < rawData.length; i++) outputArray[i] = rawData.charCodeAt(i);
        return outputArray;
    }

    function updatePushUi() {
        if (!pushBtn) return;
        if (!pushSupported) {
            pushBtn.style.display = 'none';
            return;
        }
        pushIcon.textContent = pushSubscribed ? 'notifications_active' : 'notifications_none';
        pushLabel.textContent = pushSubscribed ? 'Notifiche ON' : 'Notifiche';
        pushBtn.classList.toggle('active-filter', pushSubscribed);
        pushBtn.title = pushSubscribed
            ? 'Disattiva le Notifiche Push su questo dispositivo'
            : 'Attiva le Notifiche Push su questo dispositivo';
    }

    async function refreshPushState() {
        if (!pushSupported) {
            updatePushUi();
            return;
        }
        try {
            const reg = await navigator.serviceWorker.getRegistration();
            if (!reg) return;
            const sub = await reg.pushManager.getSubscription();
            pushSubscribed = !!sub;
        } catch {
            pushSubscribed = false;
        }
        updatePushUi();
    }

    async function subscribePush() {
        const permission = await Notification.requestPermission();
        if (permission !== 'granted') {
            showToast('Permesso notifiche negato dal browser', true);
            return;
        }
        const keyRes = await fetch('/api/push/vapid-key');
        const keyData = await keyRes.json().catch(() => ({}));
        if (!keyRes.ok || !keyData.publicKey) {
            showToast('Notifiche push non disponibili sul server', true);
            return;
        }
        const reg = await navigator.serviceWorker.register('/service-worker.js');
        const sub = await reg.pushManager.subscribe({
            userVisibleOnly: true,
            applicationServerKey: urlBase64ToUint8Array(keyData.publicKey),
        });
        const payload = JSON.parse(JSON.stringify(sub.toJSON()));
        const { ok, data } = await apiPost('/api/push/subscribe', {
            subscription: { endpoint: sub.endpoint, keys: payload.keys },
        });
        if (!ok) {
            await sub.unsubscribe().catch(() => {});
            showToast(data.error || 'Errore registrazione notifiche', true);
            return;
        }
        pushSubscribed = true;
        updatePushUi();
        showToast('🔔 Notifiche push attivate su questo dispositivo');
    }

    async function unsubscribePush() {
        const reg = await navigator.serviceWorker.getRegistration();
        if (reg) {
            const sub = await reg.pushManager.getSubscription();
            if (sub) {
                await apiPost('/api/push/unsubscribe', { endpoint: sub.endpoint });
                await sub.unsubscribe().catch(() => {});
            }
        }
        pushSubscribed = false;
        updatePushUi();
        showToast('Notifiche push disattivate');
    }

    if (pushBtn) {
        pushBtn.addEventListener('click', async () => {
            pushBtn.disabled = true;
            try {
                if (pushSubscribed) await unsubscribePush();
                else await subscribePush();
            } catch (err) {
                showToast('Errore notifiche push', true);
            } finally {
                pushBtn.disabled = false;
            }
        });
        refreshPushState();
    }

    // ==========================================================================
    // Sincronizzazione iniziale + agganci con la galleria rigenerata
    // ==========================================================================
    refreshFavBadges();

    const paneMediaEl = document.getElementById('pane-media');
    if (paneMediaEl) {
        const mo = new MutationObserver(() => {
            refreshFavBadges();
            if (favoritesOnly) applyFavoritesFilter();
        });
        mo.observe(paneMediaEl, { childList: true, subtree: true });
    }

    // Quando grouping.js rigenera la vista, riapplica badge/filtro
    if (typeof window.refreshGalleryGrouping === 'function') {
        const origRender = window.refreshGalleryGrouping;
        window.refreshGalleryGrouping = function (...args) {
            const out = origRender.apply(this, args);
            refreshFavBadges();
            if (favoritesOnly) applyFavoritesFilter();
            return out;
        };
    }
});
