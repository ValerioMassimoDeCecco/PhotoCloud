// static/scripts/lightbox.js — Material You 120Hz Lightbox con supporto touch swipe, download e avvio Photo Editor

let currentIndex = 0;
let mediaList = [];
let touchStartX = 0;
let touchEndX = 0;

function getElements() {
    const lightbox = document.getElementById('lightbox');
    const lightboxImg = document.getElementById('lightbox-img');
    const lightboxVideo = document.getElementById('lightbox-video');
    const lightboxVideoSource = lightboxVideo ? lightboxVideo.querySelector('source') : null;
    const lightboxCounter = document.getElementById('lightbox-counter');
    const lightboxEditBtn = document.getElementById('lightbox-edit-btn');
    const lightboxDownloadBtn = document.getElementById('lightbox-download-btn');
    return {
        lightbox,
        lightboxImg,
        lightboxVideo,
        lightboxVideoSource,
        lightboxCounter,
        lightboxEditBtn,
        lightboxDownloadBtn,
    };
}

function resolveMediaUrl(item) {
    if (!item) return '';
    let raw = '';
    if (typeof item === 'string') {
        raw = item;
    } else if (typeof item === 'object' && item !== null) {
        raw = item.filename || item.url || item.src || '';
    }
    raw = String(raw).trim();
    if (!raw) return '';
    if (raw.startsWith('/media/') || raw.startsWith('http://') || raw.startsWith('https://')) {
        return raw.split('#')[0];
    }
    return `/media/${encodeURIComponent(raw)}`;
}

function extractFilenameFromMediaUrl(mediaUrl) {
    if (!mediaUrl) return '';
    const clean = mediaUrl.split('?')[0].split('#')[0];
    const parts = clean.split('/');
    const last = parts[parts.length - 1] || '';
    try {
        return decodeURIComponent(last);
    } catch {
        return last;
    }
}

function collectDomMediaUrls() {
    const cards = Array.from(document.querySelectorAll('.clickable-media'));
    return cards.map(card => {
        const df = card.getAttribute('data-filename');
        if (df) return `/media/${encodeURIComponent(df)}`;
        const img = card.querySelector('img');
        if (img && img.getAttribute('src')) return img.getAttribute('src');
        const source = card.querySelector('video source');
        if (source && source.getAttribute('src')) return source.getAttribute('src').split('#')[0];
        return '';
    }).filter(Boolean);
}

window.getCurrentLightboxFilename = function() {
    if (!mediaList.length) return '';
    const mediaUrl = resolveMediaUrl(mediaList[currentIndex]);
    return extractFilenameFromMediaUrl(mediaUrl);
};

window.openPhotoEditorFromLightbox = function(event) {
    if (event) event.stopPropagation();
    const fn = window.getCurrentLightboxFilename();
    if (fn && window.openPhotoEditor) {
        window.openPhotoEditor(fn, event);
    }
};

window.openLightbox = function(url, isVideo, index, allMedia) {
    const { lightbox } = getElements();
    if (!lightbox) return;

    const domUrls = collectDomMediaUrls();
    if (Array.isArray(allMedia) && allMedia.length > 0) {
        mediaList = allMedia.map(resolveMediaUrl).filter(Boolean);
    } else {
        mediaList = domUrls;
    }

    const targetUrl = resolveMediaUrl(url);
    if (targetUrl) {
        const cleanTarget = targetUrl.split('?')[0];
        const foundIdx = mediaList.findIndex(u => decodeURIComponent(u.split('?')[0]) === decodeURIComponent(cleanTarget));
        if (foundIdx !== -1) {
            currentIndex = foundIdx;
        } else if (typeof index === 'number' && index >= 0 && index < mediaList.length) {
            currentIndex = index;
        } else {
            mediaList = [targetUrl, ...mediaList];
            currentIndex = 0;
        }
    } else {
        currentIndex = (typeof index === 'number' && index >= 0) ? index : 0;
    }

    lightbox.style.display = 'flex';
    lightbox.classList.add('active');

    showMediaAtIndex(currentIndex);
    document.addEventListener('keydown', handleKeydown);
};

window.closeLightbox = function() {
    const { lightbox, lightboxImg, lightboxVideo, lightboxVideoSource } = getElements();
    if (!lightbox) return;

    lightbox.classList.remove('active');
    lightbox.style.display = 'none';
    if (lightboxVideo) {
        lightboxVideo.pause();
        if (lightboxVideoSource) lightboxVideoSource.setAttribute('src', '');
        lightboxVideo.style.display = 'none';
    }
    if (lightboxImg) {
        lightboxImg.removeAttribute('src');
        lightboxImg.style.display = 'none';
    }

    document.removeEventListener('keydown', handleKeydown);
};

window.navigateMedia = function(direction, event) {
    if (event) event.stopPropagation();
    if (!mediaList.length) return;

    currentIndex += direction;
    if (currentIndex >= mediaList.length) {
        currentIndex = 0;
    } else if (currentIndex < 0) {
        currentIndex = mediaList.length - 1;
    }

    showMediaAtIndex(currentIndex);
};

function preloadAdjacentMedia(index) {
    if (mediaList.length <= 1) return;
    const neighbors = [
        (index + 1) % mediaList.length,
        (index - 1 + mediaList.length) % mediaList.length,
    ];
    neighbors.forEach((idx) => {
        const url = resolveMediaUrl(mediaList[idx]);
        if (url && !/\.(mp4|mov|webm|mkv|avi)$/i.test(url.split('?')[0])) {
            const preloadImg = new Image();
            preloadImg.src = url;
        }
    });
}

function showMediaAtIndex(index) {
    const {
        lightboxImg,
        lightboxVideo,
        lightboxVideoSource,
        lightboxCounter,
        lightboxEditBtn,
        lightboxDownloadBtn,
    } = getElements();
    if (!mediaList.length) return;

    const mediaUrl = resolveMediaUrl(mediaList[index]);
    if (!mediaUrl) return;

    const cleanPath = mediaUrl.split('?')[0].split('#')[0];
    const isVideo = /\.(mp4|mov|webm|mkv|avi)$/i.test(cleanPath);
    const filename = extractFilenameFromMediaUrl(mediaUrl);

    if (lightboxCounter) {
        lightboxCounter.textContent = `${index + 1} / ${mediaList.length}`;
    }

    if (lightboxEditBtn) {
        lightboxEditBtn.style.display = isVideo ? 'none' : 'inline-flex';
    }

    if (lightboxDownloadBtn && filename) {
        lightboxDownloadBtn.setAttribute('href', `/media/${encodeURIComponent(filename)}?download=1`);
        lightboxDownloadBtn.setAttribute('download', filename);
    }

    if (lightboxVideo) {
        lightboxVideo.pause();
    }

    if (isVideo && lightboxVideo) {
        if (lightboxImg) lightboxImg.style.display = 'none';
        lightboxVideo.style.display = 'block';
        if (lightboxVideoSource) {
            lightboxVideoSource.setAttribute('src', mediaUrl);
        } else {
            lightboxVideo.setAttribute('src', mediaUrl);
        }
        lightboxVideo.load();
        lightboxVideo.play().catch(() => {});
    } else if (lightboxImg) {
        if (lightboxVideo) lightboxVideo.style.display = 'none';
        lightboxImg.style.display = 'block';
        lightboxImg.style.opacity = '1';
        lightboxImg.setAttribute('src', mediaUrl);
        preloadAdjacentMedia(index);
    }
}

function handleKeydown(e) {
    const editorModal = document.getElementById('photo-editor-modal');
    if (editorModal && editorModal.style.display !== 'none') return;

    if (e.key === 'ArrowRight') {
        window.navigateMedia(1);
    } else if (e.key === 'ArrowLeft') {
        window.navigateMedia(-1);
    } else if (e.key === 'Escape') {
        window.closeLightbox();
    }
}

document.addEventListener('DOMContentLoaded', () => {
    const { lightbox } = getElements();
    if (!lightbox) return;

    lightbox.addEventListener('touchstart', (e) => {
        if (e.changedTouches && e.changedTouches.length > 0) {
            touchStartX = e.changedTouches[0].screenX;
        }
    }, { passive: true });

    lightbox.addEventListener('touchend', (e) => {
        if (e.changedTouches && e.changedTouches.length > 0) {
            touchEndX = e.changedTouches[0].screenX;
            const deltaX = touchEndX - touchStartX;
            if (Math.abs(deltaX) > 48) {
                if (deltaX < 0) {
                    window.navigateMedia(1);
                } else {
                    window.navigateMedia(-1);
                }
            }
        }
    }, { passive: true });
});
