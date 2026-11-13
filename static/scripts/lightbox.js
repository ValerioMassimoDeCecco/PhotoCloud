// static/scripts/lightbox.js — Material You 120Hz Interactive Photo & Video Viewer (Pinch/Wheel Zoom, Pan, Swipe, Video HUD & Filmstrip)

(function () {
    let currentIndex = 0;
    let mediaList = [];
    let isVideoActive = false;

    // Zoom & Pan state (for photos)
    let scale = 1;
    let panX = 0;
    let panY = 0;
    const MIN_SCALE = 1;
    const MAX_SCALE = 5;
    const DOUBLE_TAP_SCALE = 2.5;
    let lastTapTime = 0;
    let lastTapX = 0;
    let lastTapY = 0;

    // Multi-touch & pointer tracking (zero-slip incremental focal tracking + cached layout)
    const activePointers = new Map();
    let cachedContainerCenterX = 0;
    let cachedContainerCenterY = 0;
    let cachedViewportW = 0;
    let cachedViewportH = 0;
    let cachedMediaW = 0;
    let cachedMediaH = 0;
    let hasCachedGeometry = false;
    let springResetTimer = null;
    let suppressBackdropClickUntil = 0;

    let gestureStartX = 0;
    let gestureStartY = 0;
    let isTrackingGesture = false;
    let hasMoved = false;
    let wasPinching = false;

    const SPEED_STEPS = [1, 1.25, 1.5, 2, 0.5];
    let currentSpeedIndex = 0;
    let isLoopEnabled = true;

    function getElements() {
        const lightbox = document.getElementById('lightbox');
        const lightboxImg = document.getElementById('lightbox-img');
        const lightboxVideo = document.getElementById('lightbox-video');
        const lightboxVideoSource = lightboxVideo ? lightboxVideo.querySelector('source') : null;
        const lightboxCounter = document.getElementById('lightbox-counter');
        const lightboxMediaBadge = document.getElementById('lightbox-media-badge');
        const lightboxZoomBadge = document.getElementById('lightbox-zoom-badge');
        const lightboxZoomInBtn = document.getElementById('lightbox-zoom-in-btn');
        const lightboxZoomOutBtn = document.getElementById('lightbox-zoom-out-btn');
        const lightboxEditBtn = document.getElementById('lightbox-edit-btn');
        const lightboxEditLabel = document.getElementById('lightbox-edit-label');
        const lightboxDownloadBtn = document.getElementById('lightbox-download-btn');
        const lightboxFullscreenBtn = document.getElementById('lightbox-fullscreen-btn');
        const lightboxStage = document.getElementById('lightbox-stage');
        const lightboxMediaContainer = document.getElementById('lightbox-media-container');
        const lightboxCenterPlay = document.getElementById('lightbox-video-center-play');
        const videoControls = document.getElementById('lightbox-video-controls');
        const videoCurrent = document.getElementById('lb-video-current');
        const videoSeek = document.getElementById('lb-video-seek');
        const videoDuration = document.getElementById('lb-video-duration');
        const videoPlayBtn = document.getElementById('lb-video-play-btn');
        const videoRewBtn = document.getElementById('lb-video-rew-btn');
        const videoFwdBtn = document.getElementById('lb-video-fwd-btn');
        const videoSpeedBtn = document.getElementById('lb-video-speed-btn');
        const videoMuteBtn = document.getElementById('lb-video-mute-btn');
        const videoLoopBtn = document.getElementById('lb-video-loop-btn');
        const filmstrip = document.getElementById('lightbox-filmstrip');

        return {
            lightbox,
            lightboxImg,
            lightboxVideo,
            lightboxVideoSource,
            lightboxCounter,
            lightboxMediaBadge,
            lightboxZoomBadge,
            lightboxZoomInBtn,
            lightboxZoomOutBtn,
            lightboxEditBtn,
            lightboxEditLabel,
            lightboxDownloadBtn,
            lightboxFullscreenBtn,
            lightboxStage,
            lightboxMediaContainer,
            lightboxCenterPlay,
            videoControls,
            videoCurrent,
            videoSeek,
            videoDuration,
            videoPlayBtn,
            videoRewBtn,
            videoFwdBtn,
            videoSpeedBtn,
            videoMuteBtn,
            videoLoopBtn,
            filmstrip,
        };
    }

    function isTrashContext() {
        return new URLSearchParams(window.location.search).get('from_trash') === 'true';
    }

    function getVideoMimeType(filenameOrUrl) {
        const clean = String(filenameOrUrl || '').split('?')[0].split('#')[0].toLowerCase();
        if (clean.endsWith('.webm')) return 'video/webm';
        if (clean.endsWith('.mov')) return 'video/quicktime';
        if (clean.endsWith('.mkv')) return 'video/x-matroska';
        return 'video/mp4';
    }

    function isVideoUrl(url) {
        const clean = String(url || '').split('?')[0].split('#')[0];
        return /\.(mp4|mov|webm|mkv|avi)$/i.test(clean);
    }

    function formatTime(seconds) {
        const safe = Number.isFinite(seconds) && seconds > 0 ? seconds : 0;
        const hrs = Math.floor(safe / 3600);
        const mins = Math.floor((safe % 3600) / 60);
        const secs = Math.floor(safe % 60);
        const mm = String(mins).padStart(2, '0');
        const ss = String(secs).padStart(2, '0');
        return hrs > 0 ? `${hrs}:${mm}:${ss}` : `${mm}:${ss}`;
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
        return cards
            .map((card) => {
                const df = card.getAttribute('data-filename');
                if (df) return `/media/${encodeURIComponent(df)}`;
                const img = card.querySelector('img');
                if (img && img.getAttribute('src')) return img.getAttribute('src');
                const source = card.querySelector('video source');
                if (source && source.getAttribute('src')) return source.getAttribute('src').split('#')[0];
                return '';
            })
            .filter(Boolean);
    }

    function getActiveMediaElement() {
        const { lightboxImg, lightboxVideo } = getElements();
        if (isVideoActive && lightboxVideo && lightboxVideo.style.display !== 'none') return lightboxVideo;
        if (!isVideoActive && lightboxImg && lightboxImg.style.display !== 'none') return lightboxImg;
        return null;
    }

    function refreshCachedGeometry() {
        const { lightboxMediaContainer, lightboxImg } = getElements();
        const bounds = lightboxMediaContainer ? lightboxMediaContainer.getBoundingClientRect() : null;
        const vw = bounds && bounds.width > 0 ? bounds.width : window.innerWidth;
        const vh = bounds && bounds.height > 0 ? bounds.height : window.innerHeight;
        cachedViewportW = vw;
        cachedViewportH = vh;
        cachedContainerCenterX = bounds ? bounds.left + vw / 2 : vw / 2;
        cachedContainerCenterY = bounds ? bounds.top + vh / 2 : vh / 2;
        if (lightboxImg && lightboxImg.style.display !== 'none') {
            // offsetWidth/offsetHeight reflect unscaled CSS layout box (immune to transform scale)
            const layoutW = lightboxImg.offsetWidth;
            const layoutH = lightboxImg.offsetHeight;
            if (layoutW > 0 && layoutH > 0) {
                cachedMediaW = layoutW;
                cachedMediaH = layoutH;
            } else if (lightboxImg.naturalWidth > 0 && lightboxImg.naturalHeight > 0) {
                const ratio = Math.min(vw / lightboxImg.naturalWidth, vh / lightboxImg.naturalHeight);
                cachedMediaW = lightboxImg.naturalWidth * ratio;
                cachedMediaH = lightboxImg.naturalHeight * ratio;
            } else {
                cachedMediaW = vw;
                cachedMediaH = vh;
            }
        } else {
            cachedMediaW = vw;
            cachedMediaH = vh;
        }
        hasCachedGeometry = true;
    }

    function cancelSpringTransition() {
        if (springResetTimer) {
            clearTimeout(springResetTimer);
            springResetTimer = null;
        }
        const el = getActiveMediaElement();
        if (el) {
            el.classList.remove('lightbox-spring-reset');
        }
    }

    function clampPan(nextScale, nextPanX, nextPanY, useCached = false) {
        if (nextScale <= 1.005) {
            return { scale: 1, panX: 0, panY: 0 };
        }
        if (!useCached || !hasCachedGeometry) {
            refreshCachedGeometry();
        }
        const vw = cachedViewportW || window.innerWidth;
        const vh = cachedViewportH || window.innerHeight;
        const mw = cachedMediaW > 0 ? cachedMediaW : vw;
        const mh = cachedMediaH > 0 ? cachedMediaH : vh;
        const maxX = Math.max(0, (mw * nextScale - vw) / 2);
        const maxY = Math.max(0, (mh * nextScale - vh) / 2);
        return {
            scale: Math.max(MIN_SCALE, Math.min(MAX_SCALE, nextScale)),
            panX: Math.max(-maxX, Math.min(maxX, Number.isFinite(nextPanX) ? nextPanX : 0)),
            panY: Math.max(-maxY, Math.min(maxY, Number.isFinite(nextPanY) ? nextPanY : 0)),
        };
    }

    function applyZoomTransform(animate = false, useCachedGeometry = false) {
        const el = getActiveMediaElement();
        const { lightboxZoomBadge, lightboxMediaContainer } = getElements();

        const clamped = clampPan(scale, panX, panY, useCachedGeometry);
        scale = clamped.scale;
        panX = clamped.panX;
        panY = clamped.panY;

        if (el) {
            if (animate) {
                cancelSpringTransition();
                el.classList.add('lightbox-spring-reset');
                springResetTimer = setTimeout(() => {
                    el.classList.remove('lightbox-spring-reset');
                    springResetTimer = null;
                }, 260);
            } else {
                cancelSpringTransition();
            }

            if (scale <= 1.005 && panX === 0 && panY === 0) {
                el.style.transform = '';
                el.style.cursor = isVideoActive ? 'pointer' : 'zoom-in';
            } else {
                el.style.transform = `translate3d(${panX.toFixed(2)}px, ${panY.toFixed(2)}px, 0) scale(${scale.toFixed(5)})`;
                el.style.cursor = 'grab';
            }
        }

        if (lightboxMediaContainer) {
            lightboxMediaContainer.style.cursor = scale > 1.01 ? 'grab' : '';
        }

        if (lightboxZoomBadge) {
            if (!isVideoActive && scale > 1.02) {
                lightboxZoomBadge.style.display = 'inline-flex';
                lightboxZoomBadge.textContent = `${scale.toFixed(1)}x`;
            } else {
                lightboxZoomBadge.style.display = 'none';
            }
        }
    }

    function resetZoom(animate = false) {
        scale = 1;
        panX = 0;
        panY = 0;
        applyZoomTransform(animate, false);
    }

    function setZoomCenteredAt(targetScale, clientX, clientY, animate = true) {
        const prevScale = Math.max(MIN_SCALE, scale);
        const clampedTarget = Math.max(MIN_SCALE, Math.min(MAX_SCALE, targetScale));
        if (clampedTarget <= 1.01) {
            resetZoom(animate);
            return;
        }
        refreshCachedGeometry();
        if (Number.isFinite(clientX) && Number.isFinite(clientY)) {
            const dx = clientX - cachedContainerCenterX;
            const dy = clientY - cachedContainerCenterY;
            const ratio = clampedTarget / prevScale;
            panX = panX * ratio - dx * (ratio - 1);
            panY = panY * ratio - dy * (ratio - 1);
        }
        scale = clampedTarget;
        applyZoomTransform(animate, true);
    }

    function syncVideoHud() {
        const {
            lightboxVideo,
            lightboxCenterPlay,
            videoPlayBtn,
            videoSeek,
            videoCurrent,
            videoDuration,
            videoMuteBtn,
            videoSpeedBtn,
            videoLoopBtn,
        } = getElements();
        if (!lightboxVideo || !isVideoActive) return;

        const rawDur = Number.isFinite(lightboxVideo.duration) && lightboxVideo.duration > 0 ? lightboxVideo.duration : 0;
        const seekEnd = !rawDur && lightboxVideo.seekable && lightboxVideo.seekable.length > 0
            ? lightboxVideo.seekable.end(lightboxVideo.seekable.length - 1)
            : 0;
        const dur = rawDur || (Number.isFinite(seekEnd) && seekEnd > 0 ? seekEnd : 0);
        const cur = Number.isFinite(lightboxVideo.currentTime) ? lightboxVideo.currentTime : 0;

        if (videoCurrent) videoCurrent.textContent = formatTime(cur);
        if (videoDuration) videoDuration.textContent = formatTime(dur);
        if (videoSeek && dur > 0) {
            videoSeek.value = String(Math.round((cur / dur) * 1000));
        } else if (videoSeek) {
            videoSeek.value = '0';
        }

        const isPaused = lightboxVideo.paused || lightboxVideo.ended;
        const playIconName = isPaused ? 'play_arrow' : 'pause';

        if (videoPlayBtn) {
            const ic = videoPlayBtn.querySelector('.material-icons');
            if (ic) ic.textContent = playIconName;
        }
        if (lightboxCenterPlay) {
            lightboxCenterPlay.style.display = isPaused ? 'flex' : 'none';
            const ic = lightboxCenterPlay.querySelector('.material-icons');
            if (ic) ic.textContent = playIconName;
        }
        if (videoMuteBtn) {
            const ic = videoMuteBtn.querySelector('.material-icons');
            if (ic) ic.textContent = lightboxVideo.muted ? 'volume_off' : 'volume_up';
            videoMuteBtn.classList.toggle('active', lightboxVideo.muted);
        }
        if (videoSpeedBtn) {
            videoSpeedBtn.textContent = `${lightboxVideo.playbackRate}x`;
        }
        if (videoLoopBtn) {
            videoLoopBtn.classList.toggle('active', isLoopEnabled);
        }
    }

    function toggleVideoPlayback() {
        const { lightboxVideo } = getElements();
        if (!lightboxVideo || !isVideoActive) return;
        if (lightboxVideo.paused || lightboxVideo.ended) {
            lightboxVideo.play().catch(() => {});
        } else {
            lightboxVideo.pause();
        }
        syncVideoHud();
    }

    function renderFilmstrip() {
        const { filmstrip } = getElements();
        if (!filmstrip) return;

        if (mediaList.length <= 1) {
            filmstrip.innerHTML = '';
            filmstrip.style.display = 'none';
            return;
        }

        filmstrip.style.display = 'flex';
        const visibleCap = Math.min(mediaList.length, 48);
        const startOffset = Math.max(0, Math.min(currentIndex - Math.floor(visibleCap / 2), mediaList.length - visibleCap));
        const endOffset = startOffset + visibleCap;

        filmstrip.innerHTML = '';
        for (let i = startOffset; i < endOffset; i++) {
            const url = resolveMediaUrl(mediaList[i]);
            const vid = isVideoUrl(url);
            const btn = document.createElement('button');
            btn.type = 'button';
            btn.className = `lb-thumb-item${i === currentIndex ? ' active' : ''}`;
            btn.setAttribute('aria-label', `Media ${i + 1}`);
            btn.onclick = (e) => {
                e.stopPropagation();
                const dir = i === currentIndex ? 0 : i > currentIndex ? 1 : -1;
                currentIndex = i;
                showMediaAtIndex(currentIndex, dir);
            };

            if (vid) {
                const vEl = document.createElement('video');
                vEl.muted = true;
                vEl.playsInline = true;
                vEl.preload = 'metadata';
                vEl.src = `${url.split('#')[0]}#t=0.1`;
                btn.appendChild(vEl);

                const badge = document.createElement('span');
                badge.className = 'lb-thumb-vid-badge';
                badge.innerHTML = '<span class="material-icons">play_arrow</span>';
                btn.appendChild(badge);
            } else {
                const imgEl = document.createElement('img');
                imgEl.src = url;
                imgEl.alt = '';
                imgEl.loading = 'lazy';
                btn.appendChild(imgEl);
            }

            filmstrip.appendChild(btn);
            if (i === currentIndex) {
                requestAnimationFrame(() => {
                    try {
                        btn.scrollIntoView({ behavior: 'smooth', inline: 'center', block: 'nearest' });
                    } catch {
                        // ignore
                    }
                });
            }
        }
    }

    function preloadAdjacentMedia(index) {
        if (mediaList.length <= 1) return;
        const neighbors = [
            (index + 1) % mediaList.length,
            (index - 1 + mediaList.length) % mediaList.length,
        ];
        neighbors.forEach((idx) => {
            const url = resolveMediaUrl(mediaList[idx]);
            if (url && !isVideoUrl(url)) {
                const preloadImg = new Image();
                preloadImg.src = url;
            }
        });
    }

    function showMediaAtIndex(index, direction = 0) {
        const {
            lightbox,
            lightboxImg,
            lightboxVideo,
            lightboxVideoSource,
            lightboxCounter,
            lightboxMediaBadge,
            lightboxEditBtn,
            lightboxEditLabel,
            lightboxDownloadBtn,
            lightboxCenterPlay,
            videoControls,
        } = getElements();
        if (!mediaList.length) return;

        const mediaUrl = resolveMediaUrl(mediaList[index]);
        if (!mediaUrl) return;

        resetZoom(false);
        if (lightbox) lightbox.classList.remove('hud-hidden');

        const isVideo = isVideoUrl(mediaUrl);
        isVideoActive = isVideo;
        const filename = extractFilenameFromMediaUrl(mediaUrl);

        if (lightboxCounter) {
            lightboxCounter.textContent = `${index + 1} / ${mediaList.length}`;
        }
        if (lightboxMediaBadge) {
            lightboxMediaBadge.style.display = 'inline-flex';
            lightboxMediaBadge.textContent = isVideo ? 'Video' : 'Foto';
        }

        // Edit button is enabled for BOTH photos and videos (hidden only in Trash view)
        if (lightboxEditBtn) {
            lightboxEditBtn.style.display = isTrashContext() ? 'none' : 'inline-flex';
        }
        if (lightboxEditLabel) {
            lightboxEditLabel.textContent = isVideo ? 'Modifica Video' : 'Modifica Foto';
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
                void activeEl.offsetWidth;
                activeEl.classList.add('lightbox-animate-next-in');
            } else if (direction < 0) {
                void activeEl.offsetWidth;
                activeEl.classList.add('lightbox-animate-prev-in');
            }
        }

        if (isVideo && lightboxVideo) {
            if (lightboxImg) lightboxImg.style.display = 'none';
            lightboxVideo.style.display = 'block';
            lightboxVideo.loop = isLoopEnabled;
            lightboxVideo.playbackRate = SPEED_STEPS[currentSpeedIndex] || 1;
            const mimeType = getVideoMimeType(filename || mediaUrl);
            if (lightboxVideoSource) {
                lightboxVideoSource.setAttribute('src', mediaUrl);
                lightboxVideoSource.setAttribute('type', mimeType);
            }
            lightboxVideo.setAttribute('src', mediaUrl);
            lightboxVideo.load();
            if (videoControls) videoControls.style.display = 'flex';
            syncVideoHud();
            lightboxVideo.play().then(() => syncVideoHud()).catch(() => syncVideoHud());
        } else if (lightboxImg) {
            if (lightboxVideo) lightboxVideo.style.display = 'none';
            if (videoControls) videoControls.style.display = 'none';
            if (lightboxCenterPlay) lightboxCenterPlay.style.display = 'none';
            lightboxImg.style.display = 'block';
            lightboxImg.style.opacity = '1';
            lightboxImg.setAttribute('src', mediaUrl);
            applyZoomTransform(false);
            preloadAdjacentMedia(index);
        }

        renderFilmstrip();
    }

    window.getCurrentLightboxFilename = function () {
        if (!mediaList.length) return '';
        const mediaUrl = resolveMediaUrl(mediaList[currentIndex]);
        return extractFilenameFromMediaUrl(mediaUrl);
    };

    window.openPhotoEditorFromLightbox = function (event) {
        if (event) event.stopPropagation();
        const { lightboxVideo } = getElements();
        if (lightboxVideo && !lightboxVideo.paused) {
            lightboxVideo.pause();
            syncVideoHud();
        }
        const fn = window.getCurrentLightboxFilename();
        if (fn && window.openPhotoEditor) {
            window.openPhotoEditor(fn, event);
        }
    };

    window.refreshLightboxMediaItem = function (oldFilename, newFilename, cacheBustUrl) {
        if (!mediaList.length) return;
        const updatedUrl = cacheBustUrl || `/media/${encodeURIComponent(newFilename)}?t=${Date.now()}`;
        mediaList = mediaList.map((entry) => {
            const fn = extractFilenameFromMediaUrl(entry);
            return fn === oldFilename ? updatedUrl : entry;
        });
        const activeFn = extractFilenameFromMediaUrl(mediaList[currentIndex]);
        if (activeFn === newFilename || activeFn === oldFilename) {
            showMediaAtIndex(currentIndex, 0);
        } else {
            renderFilmstrip();
        }
    };

    window.openLightbox = function (url, isVideo, index, allMedia) {
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
            const foundIdx = mediaList.findIndex(
                (u) => decodeURIComponent(u.split('?')[0]) === decodeURIComponent(cleanTarget)
            );
            if (foundIdx !== -1) {
                currentIndex = foundIdx;
            } else if (typeof index === 'number' && index >= 0 && index < mediaList.length) {
                currentIndex = index;
            } else {
                mediaList = [targetUrl, ...mediaList];
                currentIndex = 0;
            }
        } else {
            currentIndex = typeof index === 'number' && index >= 0 ? index : 0;
        }

        lightbox.style.display = 'flex';
        lightbox.classList.add('active');
        lightbox.classList.remove('hud-hidden');

        showMediaAtIndex(currentIndex, 0);
        document.addEventListener('keydown', handleKeydown);
    };

    window.closeLightbox = function (force = false) {
        if (!force && Date.now() < suppressBackdropClickUntil) return;
        const { lightbox, lightboxImg, lightboxVideo, lightboxVideoSource, videoControls, lightboxCenterPlay } =
            getElements();
        if (!lightbox) return;

        if (document.fullscreenElement === lightbox && document.exitFullscreen) {
            document.exitFullscreen().catch(() => {});
        }

        cancelSpringTransition();
        activePointers.clear();
        hasCachedGeometry = false;
        wasPinching = false;
        isTrackingGesture = false;

        lightbox.classList.remove('active', 'hud-hidden');
        lightbox.style.display = 'none';
        lightbox.style.backgroundColor = '';
        isVideoActive = false;
        resetZoom(false);

        if (lightboxVideo) {
            lightboxVideo.pause();
            if (lightboxVideoSource) lightboxVideoSource.setAttribute('src', '');
            lightboxVideo.removeAttribute('src');
            lightboxVideo.style.display = 'none';
            lightboxVideo.style.transform = '';
        }
        if (lightboxImg) {
            lightboxImg.removeAttribute('src');
            lightboxImg.style.display = 'none';
            lightboxImg.style.transform = '';
        }
        if (videoControls) videoControls.style.display = 'none';
        if (lightboxCenterPlay) lightboxCenterPlay.style.display = 'none';

        document.removeEventListener('keydown', handleKeydown);
    };

    window.navigateMedia = function (direction, event) {
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

    function toggleFullscreen() {
        const { lightbox } = getElements();
        if (!lightbox) return;
        try {
            if (document.fullscreenElement) {
                document.exitFullscreen().catch(() => {});
            } else if (lightbox.requestFullscreen) {
                lightbox.requestFullscreen().catch(() => {});
            }
        } catch {
            // ignore unsupported fullscreen
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
        } else if (e.key === ' ' && isVideoActive) {
            e.preventDefault();
            toggleVideoPlayback();
        } else if ((e.key === 'f' || e.key === 'F')) {
            toggleFullscreen();
        } else if ((e.key === 'm' || e.key === 'M') && isVideoActive) {
            const { lightboxVideo } = getElements();
            if (lightboxVideo) {
                lightboxVideo.muted = !lightboxVideo.muted;
                syncVideoHud();
            }
        } else if (!isVideoActive && (e.key === '+' || e.key === '=')) {
            setZoomCenteredAt(scale + 0.5);
        } else if (!isVideoActive && e.key === '-') {
            setZoomCenteredAt(scale - 0.5);
        }
    }

    document.addEventListener('DOMContentLoaded', () => {
        const {
            lightbox,
            lightboxImg,
            lightboxVideo,
            lightboxZoomBadge,
            lightboxZoomInBtn,
            lightboxZoomOutBtn,
            lightboxFullscreenBtn,
            lightboxCenterPlay,
            videoSeek,
            videoPlayBtn,
            videoRewBtn,
            videoFwdBtn,
            videoSpeedBtn,
            videoMuteBtn,
            videoLoopBtn,
        } = getElements();
        if (!lightbox) return;

        if (lightboxZoomBadge) {
            lightboxZoomBadge.addEventListener('click', (e) => {
                e.stopPropagation();
                resetZoom(true);
            });
        }
        if (lightboxZoomInBtn) {
            lightboxZoomInBtn.addEventListener('click', (e) => {
                e.stopPropagation();
                if (!isVideoActive) setZoomCenteredAt(scale + 0.6);
            });
        }
        if (lightboxZoomOutBtn) {
            lightboxZoomOutBtn.addEventListener('click', (e) => {
                e.stopPropagation();
                if (!isVideoActive) setZoomCenteredAt(scale - 0.6);
            });
        }
        if (lightboxFullscreenBtn) {
            lightboxFullscreenBtn.addEventListener('click', (e) => {
                e.stopPropagation();
                toggleFullscreen();
            });
        }

        // Video player HUD events
        if (lightboxVideo) {
            lightboxVideo.addEventListener('loadedmetadata', syncVideoHud);
            lightboxVideo.addEventListener('durationchange', syncVideoHud);
            lightboxVideo.addEventListener('timeupdate', syncVideoHud);
            lightboxVideo.addEventListener('play', syncVideoHud);
            lightboxVideo.addEventListener('pause', syncVideoHud);
            lightboxVideo.addEventListener('ended', syncVideoHud);
            lightboxVideo.addEventListener('click', (e) => {
                e.stopPropagation();
                if (!hasMoved) toggleVideoPlayback();
            });
        }
        if (lightboxCenterPlay) {
            lightboxCenterPlay.addEventListener('click', (e) => {
                e.stopPropagation();
                toggleVideoPlayback();
            });
        }
        if (videoPlayBtn) {
            videoPlayBtn.addEventListener('click', (e) => {
                e.stopPropagation();
                toggleVideoPlayback();
            });
        }
        if (videoRewBtn && lightboxVideo) {
            videoRewBtn.addEventListener('click', (e) => {
                e.stopPropagation();
                lightboxVideo.currentTime = Math.max(0, (lightboxVideo.currentTime || 0) - 10);
                syncVideoHud();
            });
        }
        if (videoFwdBtn && lightboxVideo) {
            videoFwdBtn.addEventListener('click', (e) => {
                e.stopPropagation();
                const dur = Number.isFinite(lightboxVideo.duration) ? lightboxVideo.duration : 0;
                lightboxVideo.currentTime = dur > 0 ? Math.min(dur, (lightboxVideo.currentTime || 0) + 10) : 0;
                syncVideoHud();
            });
        }
        if (videoSeek && lightboxVideo) {
            videoSeek.addEventListener('input', (e) => {
                e.stopPropagation();
                const dur = Number.isFinite(lightboxVideo.duration) ? lightboxVideo.duration : 0;
                if (dur > 0) {
                    lightboxVideo.currentTime = (Number(videoSeek.value) / 1000) * dur;
                    syncVideoHud();
                }
            });
        }
        if (videoSpeedBtn && lightboxVideo) {
            videoSpeedBtn.addEventListener('click', (e) => {
                e.stopPropagation();
                currentSpeedIndex = (currentSpeedIndex + 1) % SPEED_STEPS.length;
                lightboxVideo.playbackRate = SPEED_STEPS[currentSpeedIndex];
                syncVideoHud();
            });
        }
        if (videoMuteBtn && lightboxVideo) {
            videoMuteBtn.addEventListener('click', (e) => {
                e.stopPropagation();
                lightboxVideo.muted = !lightboxVideo.muted;
                syncVideoHud();
            });
        }
        if (videoLoopBtn && lightboxVideo) {
            videoLoopBtn.addEventListener('click', (e) => {
                e.stopPropagation();
                isLoopEnabled = !isLoopEnabled;
                lightboxVideo.loop = isLoopEnabled;
                syncVideoHud();
            });
        }

        // Mouse wheel zoom-to-cursor on photos
        lightbox.addEventListener(
            'wheel',
            (e) => {
                if (!lightbox.classList.contains('active') || isVideoActive) return;
                if (e.target.closest('.lightbox-bottom-hud, .lightbox-top-bar')) return;
                e.preventDefault();
                const factor = e.deltaY < 0 ? 1.16 : 0.86;
                setZoomCenteredAt(scale * factor, e.clientX, e.clientY, false);
            },
            { passive: false }
        );

        // Double-click zoom on desktop for photos
        if (lightboxImg) {
            lightboxImg.addEventListener('dblclick', (e) => {
                e.stopPropagation();
                if (isVideoActive) return;
                if (scale > 1.05) {
                    resetZoom(true);
                } else {
                    setZoomCenteredAt(DOUBLE_TAP_SCALE, e.clientX, e.clientY, true);
                }
            });
        }

        // Instant zero-lag Multi-pointer gestures: Focal-Point Locked Pinch Zoom, Seamless Pan, Swipe Left/Right, Swipe Down dismiss
        lightbox.addEventListener('pointerdown', (e) => {
            if (!lightbox.classList.contains('active')) return;
            if (
                e.target.closest(
                    '.nav-btn, .close-btn, .lightbox-icon-btn, .lightbox-action-pill, .lightbox-counter, .lightbox-zoom-badge, .lightbox-bottom-hud, .lightbox-video-center-play'
                )
            ) {
                return;
            }
            if (e.pointerType === 'touch' || scale > 1.01) {
                e.preventDefault();
            }

            cancelSpringTransition();
            const el = getActiveMediaElement();
            if (el) {
                el.classList.remove('lightbox-animate-next-in', 'lightbox-animate-prev-in', 'lightbox-spring-reset');
            }

            activePointers.set(e.pointerId, {
                x: e.clientX,
                y: e.clientY,
                prevX: e.clientX,
                prevY: e.clientY,
            });
            refreshCachedGeometry();

            if (activePointers.size >= 2 && !isVideoActive) {
                // Transitioning to 2+ fingers: lock backdrop and cancel any partial single-finger swipe/dismiss immediately
                wasPinching = true;
                isTrackingGesture = false;
                hasMoved = true;
                lightbox.style.backgroundColor = '';
                suppressBackdropClickUntil = Date.now() + 450;
                // Sync prev positions to current coordinates so frame 0 has 0 delta jump
                activePointers.forEach((pt) => {
                    pt.prevX = pt.x;
                    pt.prevY = pt.y;
                });
                return;
            }

            if (activePointers.size === 1) {
                gestureStartX = e.clientX;
                gestureStartY = e.clientY;
                isTrackingGesture = true;
                hasMoved = false;
                wasPinching = false;
            }
        });

        window.addEventListener('pointermove', (e) => {
            if (!lightbox.classList.contains('active')) return;
            const tracked = activePointers.get(e.pointerId);
            if (!tracked) return;

            tracked.prevX = tracked.x;
            tracked.prevY = tracked.y;
            tracked.x = e.clientX;
            tracked.y = e.clientY;

            if (activePointers.size >= 2 && !isVideoActive) {
                const pts = Array.from(activePointers.values());
                const p0 = pts[0];
                const p1 = pts[1];

                const prevMidX = (p0.prevX + p1.prevX) / 2;
                const prevMidY = (p0.prevY + p1.prevY) / 2;
                const currMidX = (p0.x + p1.x) / 2;
                const currMidY = (p0.y + p1.y) / 2;

                const prevDist = Math.hypot(p1.prevX - p0.prevX, p1.prevY - p0.prevY);
                const currDist = Math.hypot(p1.x - p0.x, p1.y - p0.y);

                if (prevDist > 2 && currDist > 2) {
                    const prevScale = Math.max(MIN_SCALE, Math.min(MAX_SCALE, scale));
                    const nextScale = Math.max(
                        MIN_SCALE,
                        Math.min(MAX_SCALE, prevScale * (currDist / prevDist))
                    );
                    const actualRatio = nextScale / prevScale;

                    const panDx = currMidX - prevMidX;
                    const panDy = currMidY - prevMidY;
                    const cRelX = prevMidX - cachedContainerCenterX;
                    const cRelY = prevMidY - cachedContainerCenterY;

                    scale = nextScale;
                    panX = panX * actualRatio + panDx - cRelX * (actualRatio - 1);
                    panY = panY * actualRatio + panDy - cRelY * (actualRatio - 1);
                } else {
                    panX += currMidX - prevMidX;
                    panY += currMidY - prevMidY;
                }

                // Sync prev to current for all pointers after computing step so stationary second pointer stays calibrated
                p0.prevX = p0.x;
                p0.prevY = p0.y;
                p1.prevX = p1.x;
                p1.prevY = p1.y;

                applyZoomTransform(false, true);
                hasMoved = true;
                suppressBackdropClickUntil = Date.now() + 450;
                return;
            }

            if (!isTrackingGesture) return;

            const dxStep = tracked.x - tracked.prevX;
            const dyStep = tracked.y - tracked.prevY;
            tracked.prevX = tracked.x;
            tracked.prevY = tracked.y;

            const deltaX = tracked.x - gestureStartX;
            const deltaY = tracked.y - gestureStartY;

            if (!hasMoved && Math.hypot(deltaX, deltaY) > 6) {
                hasMoved = true;
            }
            if (!hasMoved && !wasPinching) return;

            if (scale > 1.02 && !isVideoActive) {
                panX += dxStep;
                panY += dyStep;
                applyZoomTransform(false, true);
                suppressBackdropClickUntil = Date.now() + 400;
                return;
            }

            // Do not accidentally dismiss or swipe photo while a pinch finger remains on screen
            if (wasPinching) return;

            const el = getActiveMediaElement();
            if (!el) return;

            if (deltaY > 30 && deltaY > Math.abs(deltaX) * 1.2) {
                const dragFactor = Math.min(deltaY, 300);
                el.style.transform = `translate3d(0, ${dragFactor}px, 0) scale(${1 - dragFactor / 1200})`;
                lightbox.style.backgroundColor = `rgba(8, 8, 12, ${Math.max(0.3, 0.96 - dragFactor / 400)})`;
            } else {
                const scaleFactor = 1 - Math.min(Math.abs(deltaX) / 1500, 0.08);
                el.style.transform = `translate3d(${deltaX}px, 0, 0) scale(${scaleFactor})`;
            }
        });

        const finishGesture = (e) => {
            if (!activePointers.has(e.pointerId)) return;
            activePointers.delete(e.pointerId);

            if (wasPinching) {
                suppressBackdropClickUntil = Date.now() + 450;
                if (activePointers.size >= 1) {
                    // Seamless 2 -> 1 finger handoff: re-anchor remaining pointer to current coords with 0px jump
                    const remaining = Array.from(activePointers.values())[0];
                    remaining.prevX = remaining.x;
                    remaining.prevY = remaining.y;
                    gestureStartX = remaining.x;
                    gestureStartY = remaining.y;
                    isTrackingGesture = true;
                    return;
                }
                wasPinching = false;
                isTrackingGesture = false;
                if (scale <= 1.04) {
                    resetZoom(true);
                } else {
                    applyZoomTransform(false, true);
                }
                return;
            }

            if (!isTrackingGesture) return;
            isTrackingGesture = false;

            const deltaX = e.clientX - gestureStartX;
            const deltaY = e.clientY - gestureStartY;
            const el = getActiveMediaElement();
            lightbox.style.backgroundColor = '';

            if (scale > 1.02 && !isVideoActive) {
                applyZoomTransform(false, true);
                return;
            }

            if (!hasMoved) {
                if (el) el.style.transform = '';
                // Tap without drag on photo toggles HUD (unless touch double-tap)
                if (e.pointerType === 'touch' && !isVideoActive && e.target === lightboxImg) {
                    const now = Date.now();
                    if (now - lastTapTime < 280 && Math.hypot(e.clientX - lastTapX, e.clientY - lastTapY) < 40) {
                        lastTapTime = 0;
                        if (scale > 1.05) resetZoom(true);
                        else setZoomCenteredAt(DOUBLE_TAP_SCALE, e.clientX, e.clientY, true);
                        return;
                    }
                    lastTapTime = now;
                    lastTapX = e.clientX;
                    lastTapY = e.clientY;
                    lightbox.classList.toggle('hud-hidden');
                } else if (!isVideoActive && e.target === lightboxImg) {
                    lightbox.classList.toggle('hud-hidden');
                }
                return;
            }

            // 1. Swipe down to dismiss
            if (deltaY > 80 && deltaY > Math.abs(deltaX) * 1.1) {
                if (el) {
                    el.classList.add('lightbox-animate-dismiss');
                    setTimeout(() => {
                        window.closeLightbox(true);
                    }, 220);
                } else {
                    window.closeLightbox(true);
                }
                return;
            }

            // 2. Horizontal navigation
            if (Math.abs(deltaX) > 48) {
                if (deltaX < 0) {
                    window.navigateMedia(1);
                } else {
                    window.navigateMedia(-1);
                }
                return;
            }

            // 3. Snap back spring reset
            if (el) {
                el.classList.add('lightbox-spring-reset');
                el.style.transform = 'translate3d(0, 0, 0) scale(1)';
                springResetTimer = setTimeout(() => {
                    el.classList.remove('lightbox-spring-reset');
                    el.style.transform = '';
                    springResetTimer = null;
                }, 280);
            }
        };

        window.addEventListener('pointerup', finishGesture);
        window.addEventListener('pointercancel', finishGesture);
    });
})();
