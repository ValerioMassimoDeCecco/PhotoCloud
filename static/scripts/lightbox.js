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
    if (window.__photoCloudDidDragSelection) return;
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

    showMediaAtIndex(currentIndex, 0);
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
        lightboxVideo.style.transform = '';
    }
    if (lightboxImg) {
        lightboxImg.removeAttribute('src');
        lightboxImg.style.display = 'none';
        lightboxImg.style.transform = '';
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

    showMediaAtIndex(currentIndex, direction);
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

function showMediaAtIndex(index, direction = 0) {
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

    const activeEl = isVideo ? lightboxVideo : lightboxImg;
    if (activeEl) {
        activeEl.classList.remove('lightbox-animate-next-in', 'lightbox-animate-prev-in', 'lightbox-spring-reset');
        activeEl.style.transform = '';
        activeEl.style.opacity = '';

        if (direction > 0) {
            void activeEl.offsetWidth; // trigger reflow
            activeEl.classList.add('lightbox-animate-next-in');
        } else if (direction < 0) {
            void activeEl.offsetWidth; // trigger reflow
            activeEl.classList.add('lightbox-animate-prev-in');
        }
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

// --- INTERACTIVE TOUCH & POINTER GESTURES CON ANIMAZIONE COERENTE ---
document.addEventListener('DOMContentLoaded', () => {
    const { lightbox } = getElements();
    if (!lightbox) return;

    let gestureStartX = 0;
    let gestureStartY = 0;
    let isTrackingGesture = false;
    let hasMoved = false;

    function getActiveMediaElement() {
        const { lightboxImg, lightboxVideo } = getElements();
        if (lightboxVideo && lightboxVideo.style.display !== 'none') return lightboxVideo;
        if (lightboxImg && lightboxImg.style.display !== 'none') return lightboxImg;
        return null;
    }

    lightbox.addEventListener('pointerdown', (e) => {
        if (e.target.closest('.nav-btn, .close-btn, .lightbox-action-pill, .lightbox-counter')) return;
        gestureStartX = e.clientX;
        gestureStartY = e.clientY;
        isTrackingGesture = true;
        hasMoved = false;

        const el = getActiveMediaElement();
        if (el) {
            el.classList.remove('lightbox-animate-next-in', 'lightbox-animate-prev-in', 'lightbox-spring-reset');
        }
    });

    window.addEventListener('pointermove', (e) => {
        if (!isTrackingGesture) return;
        const deltaX = e.clientX - gestureStartX;
        const deltaY = e.clientY - gestureStartY;

        if (!hasMoved && Math.hypot(deltaX, deltaY) > 8) {
            hasMoved = true;
        }

        if (!hasMoved) return;

        const el = getActiveMediaElement();
        if (!el) return;

        // If dragging primarily downward, support swipe-to-dismiss
        if (deltaY > 30 && deltaY > Math.abs(deltaX) * 1.2) {
            const dragFactor = Math.min(deltaY, 300);
            el.style.transform = `translate3d(0, ${dragFactor}px, 0) scale(${1 - dragFactor / 1200})`;
            lightbox.style.backgroundColor = `rgba(8, 8, 10, ${Math.max(0.3, 0.96 - dragFactor / 400)})`;
        } else {
            // Horizontal swipe gesture with subtle scale response
            const scale = 1 - Math.min(Math.abs(deltaX) / 1500, 0.08);
            el.style.transform = `translate3d(${deltaX}px, 0, 0) scale(${scale})`;
        }
    });

    const finishGesture = (e) => {
        if (!isTrackingGesture) return;
        isTrackingGesture = false;

        const deltaX = e.clientX - gestureStartX;
        const deltaY = e.clientY - gestureStartY;
        const el = getActiveMediaElement();

        lightbox.style.backgroundColor = '';

        if (!hasMoved) {
            if (el) el.style.transform = '';
            return;
        }

        // 1. Swipe down to dismiss
        if (deltaY > 80 && deltaY > Math.abs(deltaX) * 1.1) {
            if (el) {
                el.classList.add('lightbox-animate-dismiss');
                setTimeout(() => {
                    window.closeLightbox();
                }, 220);
            } else {
                window.closeLightbox();
            }
            return;
        }

        // 2. Horizontal navigation threshold crossed
        if (Math.abs(deltaX) > 48) {
            if (deltaX < 0) {
                window.navigateMedia(1);
            } else {
                window.navigateMedia(-1);
            }
            return;
        }

        // 3. Below threshold: snap back spring reset
        if (el) {
            el.classList.add('lightbox-spring-reset');
            el.style.transform = 'translate3d(0, 0, 0) scale(1)';
            setTimeout(() => {
                el.classList.remove('lightbox-spring-reset');
                el.style.transform = '';
            }, 280);
        }
    };

    window.addEventListener('pointerup', finishGesture);
    window.addEventListener('pointercancel', finishGesture);
});

