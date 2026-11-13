// static/scripts/slideshow.js — Slideshow nella Lightbox con transizioni fluide (fade / slide / zoom),
// barra di avanzamento, velocità configurabile e avanzamento automatico alla fine dei video.

(function () {
    const TRANSITION_MS = 380;
    let slideshowTimer = null;
    let progressTimer = null;
    let progressStart = 0;
    let isRunning = false;
    let transitionMode = 'fade'; // 'fade' | 'slide' | 'zoom' | 'random'
    let slideDelayMs = 4000;
    let progressEl = null;
    let settingsBar = null;
    let observer = null;

    function getLightboxEls() {
        return {
            lightbox: document.getElementById('lightbox'),
            img: document.getElementById('lightbox-img'),
            video: document.getElementById('lightbox-video'),
            stage: document.getElementById('lightbox-stage'),
            hud: document.getElementById('lightbox-bottom-hud'),
            toggleBtn: document.getElementById('lightbox-slideshow-btn'),
        };
    }

    function ensureUi() {
        const { hud, lightbox } = getLightboxEls();
        if (!lightbox || !hud) return false;

        if (!progressEl) {
            progressEl = document.createElement('div');
            progressEl.id = 'lightbox-slideshow-progress';
            progressEl.className = 'lightbox-slideshow-progress';
            progressEl.style.display = 'none';
            lightbox.appendChild(progressEl);
        }

        if (!settingsBar) {
            settingsBar = document.createElement('div');
            settingsBar.id = 'lightbox-slideshow-settings';
            settingsBar.className = 'lightbox-slideshow-settings';
            settingsBar.style.display = 'none';
            settingsBar.innerHTML = `
                <label class="ss-setting" title="Transizione tra una foto e l'altra">
                    <span class="material-icons">animation</span>
                    <select id="ss-transition-select" aria-label="Tipo di transizione">
                        <option value="fade">Dissolvenza</option>
                        <option value="slide">Scorrimento</option>
                        <option value="zoom">Zoom</option>
                        <option value="random" selected>Mista</option>
                    </select>
                </label>
                <label class="ss-setting" title="Durata di ogni foto">
                    <span class="material-icons">timer</span>
                    <select id="ss-delay-select" aria-label="Durata foto">
                        <option value="2500">2,5s</option>
                        <option value="4000" selected>4s</option>
                        <option value="6000">6s</option>
                        <option value="10000">10s</option>
                    </select>
                </label>`;
            hud.parentElement ? hud.parentElement.appendChild(settingsBar) : hud.appendChild(settingsBar);
            settingsBar.querySelector('#ss-transition-select').addEventListener('change', (e) => {
                transitionMode = e.target.value;
            });
            settingsBar.querySelector('#ss-delay-select').addEventListener('change', (e) => {
                slideDelayMs = parseInt(e.target.value, 10) || 4000;
                if (isRunning) scheduleNext();
            });
        }
        return true;
    }

    function currentTransition() {
        if (transitionMode !== 'random') return transitionMode;
        const modes = ['fade', 'slide', 'zoom'];
        return modes[Math.floor(Math.random() * modes.length)];
    }

    function applyExitTransition() {
        const { img, video } = getLightboxEls();
        const active = video && video.style.display !== 'none' ? video : img;
        if (!active) return;
        const mode = currentTransition();
        active.classList.remove('ss-exit-fade', 'ss-exit-slide', 'ss-exit-zoom');
        void active.offsetWidth; // forza reflow per riavviare l'animazione CSS
        active.classList.add(`ss-exit-${mode}`);
        setTimeout(() => active.classList.remove(`ss-exit-${mode}`), TRANSITION_MS + 60);
    }

    function getCurrentDelay() {
        const { video } = getLightboxEls();
        const isVideo = video && video.style.display !== 'none' && video.currentSrc;
        if (isVideo && video.duration && Number.isFinite(video.duration) && video.duration > 0) {
            // Per i video: attendi la fine della riproduzione (gestita da `ended`),
            // con un tetto massimo di 120s in caso di loop attivo.
            return Math.min((video.duration - (video.currentTime || 0)) * 1000, 120000);
        }
        return slideDelayMs;
    }

    function scheduleNext() {
        clearTimeout(slideshowTimer);
        clearInterval(progressTimer);
        const delay = Math.max(getCurrentDelay(), 600);
        progressStart = Date.now();
        if (progressEl) {
            progressEl.style.display = 'block';
            progressEl.style.width = '0%';
            progressTimer = setInterval(() => {
                const pct = Math.min(100, ((Date.now() - progressStart) / delay) * 100);
                progressEl.style.width = `${pct}%`;
            }, 100);
        }
        slideshowTimer = setTimeout(() => {
            applyExitTransition();
            setTimeout(() => {
                if (typeof window.navigateMedia === 'function') window.navigateMedia(1);
                scheduleNext();
            }, TRANSITION_MS);
        }, delay);
    }

    function onVideoEnded() {
        if (!isRunning) return;
        clearTimeout(slideshowTimer);
        applyExitTransition();
        setTimeout(() => {
            if (typeof window.navigateMedia === 'function') window.navigateMedia(1);
            scheduleNext();
        }, TRANSITION_MS);
    }

    function startSlideshow() {
        if (!ensureUi()) return;
        if (isRunning) return;
        isRunning = true;
        const { toggleBtn, video } = getLightboxEls();
        if (toggleBtn) {
            toggleBtn.classList.add('active');
            toggleBtn.title = 'Ferma Slideshow (P)';
        }
        if (settingsBar) settingsBar.style.display = 'flex';
        if (video) {
            video.loop = false;
            video.addEventListener('ended', onVideoEnded);
        }
        scheduleNext();
    }

    function stopSlideshow() {
        isRunning = false;
        clearTimeout(slideshowTimer);
        clearInterval(progressTimer);
        const { toggleBtn, video } = getLightboxEls();
        if (toggleBtn) {
            toggleBtn.classList.remove('active');
            toggleBtn.title = 'Slideshow con transizioni (P)';
        }
        if (progressEl) progressEl.style.display = 'none';
        if (settingsBar) settingsBar.style.display = 'none';
        if (video) {
            video.loop = true;
            video.removeEventListener('ended', onVideoEnded);
        }
    }

    function toggleSlideshow() {
        if (isRunning) stopSlideshow();
        else startSlideshow();
    }

    // Ferma lo slideshow quando la lightbox viene chiusa
    function watchLightbox() {
        const { lightbox } = getLightboxEls();
        if (!lightbox || observer) return;
        observer = new MutationObserver(() => {
            if (isRunning && lightbox.style.display === 'none') stopSlideshow();
        });
        observer.observe(lightbox, { attributes: true, attributeFilter: ['style', 'class'] });
    }

    document.addEventListener('DOMContentLoaded', () => {
        const { toggleBtn } = getLightboxEls();
        ensureUi();
        watchLightbox();
        if (toggleBtn) {
            toggleBtn.addEventListener('click', (e) => {
                e.stopPropagation();
                toggleSlideshow();
            });
        }
        document.addEventListener('keydown', (e) => {
            const { lightbox } = getLightboxEls();
            if (!lightbox || lightbox.style.display === 'none') return;
            if (e.key.toLowerCase() === 'p' && !e.ctrlKey && !e.metaKey) {
                e.preventDefault();
                toggleSlideshow();
            }
        });
    });

    window.startPhotoCloudSlideshow = startSlideshow;
    window.stopPhotoCloudSlideshow = stopSlideshow;
    window.togglePhotoCloudSlideshow = toggleSlideshow;
})();
