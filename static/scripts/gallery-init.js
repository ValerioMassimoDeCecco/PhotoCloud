document.addEventListener('DOMContentLoaded', () => {
    const themeToggleBtn = document.getElementById('theme-toggle-btn');
    if (!themeToggleBtn) return;

    const body = document.body;
    const icon = themeToggleBtn.querySelector('.material-icons');

    const applyTheme = (theme) => {
        if (theme === 'dark') {
            body.classList.add('dark-mode');
            icon.textContent = 'dark_mode';
            themeToggleBtn.title = 'Passa a tema chiaro';
        } else {
            body.classList.remove('dark-mode');
            icon.textContent = 'light_mode';
            themeToggleBtn.title = 'Passa a tema scuro';
        }
        if (window.PhotoCloudThemeManager && typeof window.PhotoCloudThemeManager.refresh === 'function') {
            window.PhotoCloudThemeManager.refresh();
        }
    };

    const toggleTheme = () => {
        const newTheme = body.classList.contains('dark-mode') ? 'light' : 'dark';
        localStorage.setItem('theme', newTheme);
        applyTheme(newTheme);
    };

    const savedTheme = localStorage.getItem('theme');
    const prefersDark = window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches;
    applyTheme(savedTheme || (prefersDark ? 'dark' : 'light'));
    themeToggleBtn.addEventListener('click', toggleTheme);
});

document.addEventListener('DOMContentLoaded', () => {
    const groupingControls = document.querySelector('.grouping-controls');
    if (groupingControls) {
        groupingControls.style.display = 'inline-flex';
    }

    const logoutBtn = document.getElementById('logout-btn');
    if (logoutBtn) {
        logoutBtn.addEventListener('click', () => document.getElementById('logout-form').submit());
    }

    const galleryGrid = document.querySelector('.gallery-grid');
    if (galleryGrid) {
        galleryGrid.addEventListener('click', (event) => {
            const clickedCloudFile = event.target.closest('.clickable-cloud-file');
            if (clickedCloudFile && !event.target.closest('.media-actions') && !event.target.matches('.media-checkbox')) {
                const df = clickedCloudFile.getAttribute('data-filename');
                const wrapper = clickedCloudFile.closest('.media-card-wrapper');
                const sz = Number(wrapper?.getAttribute('data-size') || 0);
                const fromTrash = Boolean(clickedCloudFile.closest('#pane-trash'));
                if (df && window.openCloudFile) {
                    window.openCloudFile(df, sz, fromTrash, event);
                }
                return;
            }

            const clickedCard = event.target.closest('.clickable-media');
            if (clickedCard && !event.target.closest('.media-actions') && !event.target.closest('.delete-form') && !event.target.matches('.media-checkbox')) {
                const activePane = clickedCard.closest('.keep-alive-pane') || galleryGrid;
                const allCards = Array.from(activePane.querySelectorAll('.clickable-media'));
                const fromTrash = activePane.id === 'pane-trash';
                const allUrls = allCards.map(card => {
                    const df = card.getAttribute('data-filename');
                    if (df) return `/media/${encodeURIComponent(df)}${fromTrash ? '?from_trash=true' : ''}`;
                    const img = card.querySelector('img');
                    if (img && img.getAttribute('src')) return img.getAttribute('src');
                    const src = card.querySelector('video source');
                    return src ? src.getAttribute('src').split('#')[0] : '';
                }).filter(Boolean);

                const clickedIndex = Math.max(0, allCards.indexOf(clickedCard));
                const filename = clickedCard.getAttribute('data-filename') || '';
                const imgEl = clickedCard.querySelector('img');
                const url = filename
                    ? `/media/${encodeURIComponent(filename)}${fromTrash ? '?from_trash=true' : ''}`
                    : (imgEl ? imgEl.getAttribute('src') : allUrls[clickedIndex]);
                const isVideo = /\.(mp4|mov|avi|mkv|webm)(\?.*)?$/i.test(url || '');

                if (window.openLightbox && url) {
                    window.openLightbox(url, isVideo, clickedIndex, allUrls);
                }
            }
        });
    }
});

async function handleDelete(event, button) {
    event.stopPropagation();
    event.preventDefault();

    if (!confirm('Spostare questo elemento nel cestino?')) return;

    const form = button.closest('form');
    const cardWrapper = form.closest('.media-card-wrapper');
    const parentNode = cardWrapper ? cardWrapper.parentNode : null;
    const nextSibling = cardWrapper ? cardWrapper.nextSibling : null;

    if (cardWrapper) {
        cardWrapper.dataset.removed = 'true';
        cardWrapper.remove();
    }
    if (window.refreshGalleryGrouping) {
        window.refreshGalleryGrouping();
    }

    try {
        const response = await fetch(form.action, {
            method: 'POST',
            headers: {
                'Accept': 'application/json',
                'Content-Type': 'application/json'
            }
        });

        const result = await response.json();

        if (!result.success) {
            if (cardWrapper) {
                delete cardWrapper.dataset.removed;
            }
            if (parentNode && cardWrapper) {
                parentNode.insertBefore(cardWrapper, nextSibling);
            }
            if (window.refreshGalleryGrouping) {
                window.refreshGalleryGrouping();
            }
            alert(`Errore: ${result.error || 'Impossibile spostare il file nel cestino'}`);
        } else if (window.refreshTrashPane) {
            window.refreshTrashPane();
        }
    } catch (error) {
        if (cardWrapper) {
            delete cardWrapper.dataset.removed;
        }
        if (parentNode && cardWrapper) {
            parentNode.insertBefore(cardWrapper, nextSibling);
        }
        if (window.refreshGalleryGrouping) {
            window.refreshGalleryGrouping();
        }
        alert('Errore di comunicazione con il server.');
        console.error('Errore durante lo spostamento nel cestino:', error);
    }
}
window.handleDelete = handleDelete;
