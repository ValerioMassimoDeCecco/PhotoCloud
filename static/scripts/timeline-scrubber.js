// static/scripts/timeline-scrubber.js — Barra Timeline Scrubbable stile Google Foto:
// traccia verticale sul bordo destro con thumb trascinabile, bolla con il periodo
// corrente e salto istantaneo alla sezione desiderata.

(function () {
    let scrubber = null;
    let track = null;
    let thumb = null;
    let bubble = null;
    let anchors = []; // [{ top: number, label: string }]
    let dragging = false;
    let rebuildTimer = null;
    let mutObserver = null;

    function getEls() {
        scrubber = document.getElementById('timeline-scrubber');
        track = document.getElementById('timeline-scrub-track');
        thumb = document.getElementById('timeline-scrub-thumb');
        bubble = document.getElementById('timeline-scrub-bubble');
        return !!(scrubber && track && thumb && bubble);
    }

    function paneMediaVisible() {
        const pane = document.getElementById('pane-media');
        return !!pane && pane.style.display !== 'none';
    }

    function rebuildAnchors() {
        if (!getEls()) return;
        anchors = [];
        const pane = document.getElementById('pane-media');
        if (!pane || !paneMediaVisible()) {
            scrubber.style.display = 'none';
            return;
        }
        const groups = pane.querySelectorAll('.media-group .group-title');
        if (groups.length < 2) {
            // Con meno di 2 sezioni la timeline non serve: nascondila
            scrubber.style.display = 'none';
            return;
        }
        groups.forEach((g) => {
            const rect = g.getBoundingClientRect();
            anchors.push({ top: rect.top + window.scrollY, label: g.textContent || '' });
        });
        if (anchors.length >= 2) {
            scrubber.style.display = 'flex';
            updateThumb();
        }
    }

    function scheduleRebuild() {
        clearTimeout(rebuildTimer);
        rebuildTimer = setTimeout(rebuildAnchors, 120);
    }

    function maxScrollY() {
        return Math.max(1, document.documentElement.scrollHeight - window.innerHeight);
    }

    function updateThumb() {
        if (!getEls() || scrubber.style.display === 'none') return;
        const ratio = Math.min(1, Math.max(0, window.scrollY / maxScrollY()));
        const trackH = track.clientHeight - thumb.clientHeight;
        thumb.style.top = `${Math.round(ratio * trackH)}px`;
        if (!dragging) {
            const current = anchorLabelForScroll(window.scrollY + 80);
            bubble.textContent = current.shortLabel;
        }
    }

    function anchorLabelForScroll(scrollY) {
        let best = anchors[0];
        for (const a of anchors) {
            if (a.top <= scrollY) best = a;
            else break;
        }
        const full = best ? best.label : '';
        // "12 marzo 2024 (15)" → "mar 2024"
        const cleaned = full.replace(/\s*\(\d+\)\s*$/, '');
        const parts = cleaned.split(' ');
        const shortLabel = parts.length >= 2 ? parts.slice(-2).join(' ') : cleaned;
        return { full: cleaned, shortLabel };
    }

    function scrollToRatio(ratio) {
        const docTop = ratio * maxScrollY();
        // Trova l'ancora più vicina al target
        let target = anchors[0];
        let bestDist = Infinity;
        for (const a of anchors) {
            const d = Math.abs(a.top - docTop);
            if (d < bestDist) {
                bestDist = d;
                target = a;
            }
        }
        const offset = Math.max(0, target.top - 90);
        window.scrollTo({ top: offset, behavior: 'auto' });
        const { shortLabel } = anchorLabelForScroll(offset + 80);
        bubble.textContent = shortLabel;
        updateThumb();
    }

    function handlePointer(e) {
        const rect = track.getBoundingClientRect();
        const y = e.clientY - rect.top;
        const ratio = Math.min(1, Math.max(0, y / rect.height));
        const trackH = track.clientHeight - thumb.clientHeight;
        thumb.style.top = `${Math.round(ratio * trackH)}px`;
        scrollToRatio(ratio);
    }

    document.addEventListener('DOMContentLoaded', () => {
        if (!getEls()) return;

        const pane = document.getElementById('pane-media');
        if (pane && !mutObserver) {
            mutObserver = new MutationObserver(scheduleRebuild);
            mutObserver.observe(pane, { childList: true, subtree: true });
        }

        const groupSel = document.getElementById('group-by-select');
        if (groupSel) groupSel.addEventListener('change', scheduleRebuild);

        window.addEventListener('scroll', () => {
            if (!dragging) updateThumb();
        }, { passive: true });
        window.addEventListener('resize', scheduleRebuild);

        track.addEventListener('pointerdown', (e) => {
            dragging = true;
            track.setPointerCapture(e.pointerId);
            scrubber.classList.add('dragging');
            handlePointer(e);
            e.preventDefault();
        });
        track.addEventListener('pointermove', (e) => {
            if (dragging) handlePointer(e);
        });
        const endDrag = () => {
            dragging = false;
            scrubber.classList.remove('dragging');
        };
        track.addEventListener('pointerup', endDrag);
        track.addEventListener('pointercancel', endDrag);

        scheduleRebuild();
        // Ricostruisci anche quando cambiano i tab (pane-media si mostra/nasconde)
        document.querySelectorAll('.nav-pill').forEach((btn) => {
            btn.addEventListener('click', scheduleRebuild);
        });
    });

    window.rebuildPhotoCloudTimeline = scheduleRebuild;
})();
