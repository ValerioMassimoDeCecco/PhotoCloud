// static/scripts/photo-editor.js — Material You 120Hz Photo & Video Editor Studio per PhotoCloud Web

(function () {
    const FILTER_PRESETS = {
        original: { brightness: 0, contrast: 0, saturation: 0, warmth: 0 },
        vivid: { brightness: 4, contrast: 18, saturation: 32, warmth: 8 },
        bw: { brightness: 2, contrast: 22, saturation: -100, warmth: 0 },
        sepia: { brightness: 4, contrast: 10, saturation: -35, warmth: 48 },
        cinema: { brightness: -4, contrast: 24, saturation: -12, warmth: -14 },
        cool: { brightness: 2, contrast: 10, saturation: 8, warmth: -34 },
        vintage: { brightness: 6, contrast: -10, saturation: -24, warmth: 30 },
    };

    const VIDEO_SPEED_STEPS = [1, 1.25, 1.5, 2, 0.5];
    const MAX_PREVIEW_DIMENSION = 1080;
    const MAX_VIDEO_EXPORT_SIDE = 1280;
    const MAX_HISTORY_ITEMS = 30;

    let currentFilename = '';
    let isVideoMode = false;
    let sourceImage = null;
    let previewSourceCanvas = null;
    let sourceVideoDuration = 0;
    let isSaving = false;
    let isComparingOriginal = false;
    let pendingRafId = 0;
    let activeDrag = null;

    let historyPast = [];
    let historyFuture = [];

    const editState = {
        brightness: 0,
        contrast: 0,
        saturation: 0,
        warmth: 0,
        rotation: 0,
        flipH: false,
        flipV: false,
        cropAspect: 'free',
        cropBox: { left: 0, top: 0, right: 1, bottom: 1 },
        showCropGrid: true,
        preset: 'original',
        trimStartSec: 0,
        trimEndSec: 0,
        muted: false,
        playbackRate: 1,
    };

    function isVideoFilename(name) {
        return /\.(mp4|mov|webm|mkv|avi)$/i.test(String(name || '').split('?')[0]);
    }

    function cloneState() {
        return {
            brightness: editState.brightness,
            contrast: editState.contrast,
            saturation: editState.saturation,
            warmth: editState.warmth,
            rotation: editState.rotation,
            flipH: editState.flipH,
            flipV: editState.flipV,
            cropAspect: editState.cropAspect,
            cropBox: { ...editState.cropBox },
            showCropGrid: editState.showCropGrid,
            preset: editState.preset,
            trimStartSec: editState.trimStartSec,
            trimEndSec: editState.trimEndSec,
            muted: editState.muted,
            playbackRate: editState.playbackRate,
        };
    }

    function applyStateSnapshot(snap) {
        if (!snap) return;
        editState.brightness = snap.brightness;
        editState.contrast = snap.contrast;
        editState.saturation = snap.saturation;
        editState.warmth = snap.warmth;
        editState.rotation = snap.rotation;
        editState.flipH = snap.flipH;
        editState.flipV = snap.flipV;
        editState.cropAspect = snap.cropAspect;
        editState.cropBox = { ...snap.cropBox };
        editState.showCropGrid = snap.showCropGrid;
        editState.preset = snap.preset;
        editState.trimStartSec = snap.trimStartSec;
        editState.trimEndSec = snap.trimEndSec;
        editState.muted = snap.muted;
        editState.playbackRate = snap.playbackRate;
        syncControlsFromState();
        schedulePreviewRender();
    }

    function pushHistorySnapshot(snapshotOverride = null) {
        const snap = snapshotOverride || cloneState();
        historyPast.push(snap);
        if (historyPast.length > MAX_HISTORY_ITEMS) {
            historyPast.shift();
        }
        historyFuture = [];
        syncHistoryButtons();
    }

    function undoEdit() {
        if (historyPast.length === 0) return;
        const previous = historyPast.pop();
        historyFuture.push(cloneState());
        applyStateSnapshot(previous);
        syncHistoryButtons();
    }

    function redoEdit() {
        if (historyFuture.length === 0) return;
        const next = historyFuture.pop();
        historyPast.push(cloneState());
        applyStateSnapshot(next);
        syncHistoryButtons();
    }

    function syncHistoryButtons() {
        const undoBtn = document.getElementById('editor-undo-btn');
        const redoBtn = document.getElementById('editor-redo-btn');
        if (undoBtn) undoBtn.disabled = historyPast.length === 0;
        if (redoBtn) redoBtn.disabled = historyFuture.length === 0;
    }

    function formatDuration(seconds, withTenths = true) {
        const safe = Number.isFinite(seconds) && seconds > 0 ? seconds : 0;
        const mins = Math.floor(safe / 60);
        const secsFloat = safe % 60;
        const secs = Math.floor(secsFloat);
        const tenths = Math.min(9, Math.floor((secsFloat - secs) * 10));
        const base = `${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}`;
        return withTenths ? `${base}.${tenths}` : base;
    }

    function buildCssFilter(state) {
        if (
            state.brightness === 0 &&
            state.contrast === 0 &&
            state.saturation === 0 &&
            state.warmth === 0
        ) {
            return 'none';
        }
        const bVal = Math.max(0.15, Math.min(2.2, 1 + state.brightness / 120));
        const cVal = Math.max(0.2, Math.min(2.4, Math.pow((state.contrast + 100) / 100, 1.35)));
        const sVal = Math.max(0, Math.min(2.5, (state.saturation + 100) / 100));
        const parts = [
            `brightness(${bVal.toFixed(3)})`,
            `contrast(${cVal.toFixed(3)})`,
            `saturate(${sVal.toFixed(3)})`,
        ];
        if (state.warmth > 0) {
            const sepiaAmt = Math.min(0.65, (state.warmth / 100) * 0.52);
            parts.push(`sepia(${sepiaAmt.toFixed(3)})`);
        } else if (state.warmth < 0) {
            const hueShift = Math.max(-28, (state.warmth / 100) * 24);
            parts.push(`hue-rotate(${hueShift.toFixed(1)}deg)`);
        }
        return parts.join(' ');
    }

    function getSourceDimensions() {
        if (isVideoMode) {
            const video = document.getElementById('photo-editor-video');
            const srcW = (video && video.videoWidth) || 1280;
            const srcH = (video && video.videoHeight) || 720;
            return { srcW, srcH };
        }
        if (!sourceImage) return { srcW: 800, srcH: 600 };
        return {
            srcW: sourceImage.naturalWidth || sourceImage.width || 800,
            srcH: sourceImage.naturalHeight || sourceImage.height || 600,
        };
    }

    function getRotatedDimensions() {
        const { srcW, srcH } = getSourceDimensions();
        const isRotated90 = editState.rotation === 90 || editState.rotation === 270;
        return {
            width: isRotated90 ? srcH : srcW,
            height: isRotated90 ? srcW : srcH,
            srcW,
            srcH,
        };
    }

    function clampCropBox(box, minSpan = 0.08) {
        const span = Math.max(0.04, Math.min(0.5, minSpan));
        let left = Math.max(0, Math.min(1 - span, box.left));
        let top = Math.max(0, Math.min(1 - span, box.top));
        let right = Math.max(left + span, Math.min(1, box.right));
        let bottom = Math.max(top + span, Math.min(1, box.bottom));
        if (right - left < span) {
            if (left + span <= 1) right = left + span;
            else left = Math.max(0, right - span);
        }
        if (bottom - top < span) {
            if (top + span <= 1) bottom = top + span;
            else top = Math.max(0, bottom - span);
        }
        return { left, top, right, bottom };
    }

    function fitAspectCropBox(w, h, aspect) {
        if (!aspect || aspect === 'free') {
            return { left: 0, top: 0, right: 1, bottom: 1 };
        }
        const ratioMap = { '1:1': 1, '4:5': 4 / 5, '4:3': 4 / 3, '16:9': 16 / 9 };
        const target = ratioMap[aspect] || 1;
        const curr = w / Math.max(1, h);
        let cw = w;
        let ch = h;
        if (curr > target) cw = Math.max(1, Math.round(h * target));
        else ch = Math.max(1, Math.round(w / target));
        const x = Math.floor((w - cw) / 2);
        const y = Math.floor((h - ch) / 2);
        return clampCropBox({
            left: x / Math.max(1, w),
            top: y / Math.max(1, h),
            right: (x + cw) / Math.max(1, w),
            bottom: (y + ch) / Math.max(1, h),
        });
    }

    function getCroppedPixelRect(rotW, rotH) {
        const safe = clampCropBox(editState.cropBox, 0.04);
        const x = Math.max(0, Math.min(rotW - 1, Math.round(safe.left * rotW)));
        const y = Math.max(0, Math.min(rotH - 1, Math.round(safe.top * rotH)));
        const width = Math.max(1, Math.min(rotW - x, Math.round((safe.right - safe.left) * rotW)));
        const height = Math.max(1, Math.min(rotH - y, Math.round((safe.bottom - safe.top) * rotH)));
        return { x, y, width, height };
    }

    function switchEditorTab(tabId) {
        document.querySelectorAll('.editor-panel-tab').forEach((btn) => {
            const active = btn.getAttribute('data-editor-tab') === tabId;
            btn.classList.toggle('active', active);
            btn.setAttribute('aria-selected', active ? 'true' : 'false');
        });
        document.querySelectorAll('.editor-tab-pane').forEach((pane) => {
            pane.classList.toggle('active', pane.getAttribute('data-editor-pane') === tabId);
        });
    }

    function resetEditState() {
        editState.brightness = 0;
        editState.contrast = 0;
        editState.saturation = 0;
        editState.warmth = 0;
        editState.rotation = 0;
        editState.flipH = false;
        editState.flipV = false;
        editState.cropAspect = 'free';
        editState.cropBox = { left: 0, top: 0, right: 1, bottom: 1 };
        editState.showCropGrid = true;
        editState.preset = 'original';
        editState.trimStartSec = 0;
        editState.trimEndSec = sourceVideoDuration > 0 ? sourceVideoDuration : 0;
        editState.muted = false;
        editState.playbackRate = 1;
        syncControlsFromState();
    }

    function syncCropOverlayDOM() {
        const overlay = document.getElementById('photo-editor-crop-overlay');
        const cropBoxEl = document.getElementById('photo-editor-crop-box');
        const dimLabel = document.getElementById('crop-box-dimensions-label');
        const resBadge = document.getElementById('editor-resolution-badge');
        const toggleGridBtn = document.getElementById('editor-toggle-crop-grid-btn');

        const hasLoadedMedia = isVideoMode
            ? Boolean(document.getElementById('photo-editor-video')?.videoWidth)
            : Boolean(sourceImage);

        if (toggleGridBtn) {
            toggleGridBtn.classList.toggle('active', editState.showCropGrid);
        }
        if (overlay) {
            overlay.classList.toggle('active', Boolean(editState.showCropGrid && !isComparingOriginal && hasLoadedMedia));
        }

        const { width: rotW, height: rotH } = getRotatedDimensions();
        const rect = getCroppedPixelRect(rotW, rotH);

        if (cropBoxEl) {
            cropBoxEl.style.left = `${(editState.cropBox.left * 100).toFixed(2)}%`;
            cropBoxEl.style.top = `${(editState.cropBox.top * 100).toFixed(2)}%`;
            cropBoxEl.style.width = `${((editState.cropBox.right - editState.cropBox.left) * 100).toFixed(2)}%`;
            cropBoxEl.style.height = `${((editState.cropBox.bottom - editState.cropBox.top) * 100).toFixed(2)}%`;
        }

        if (dimLabel) {
            dimLabel.textContent = `${rect.width} × ${rect.height} px`;
        }
        if (resBadge && hasLoadedMedia && !isSaving) {
            if (isVideoMode) {
                const clipSec = Math.max(0, editState.trimEndSec - editState.trimStartSec);
                resBadge.textContent = `${rect.width} × ${rect.height} px • Clip ${clipSec.toFixed(1)}s${editState.muted ? ' • Muto' : ''}`;
            } else {
                resBadge.textContent = `${rect.width} × ${rect.height} px • Crittografia AES-256`;
            }
        }
    }

    function syncVideoTrimControls() {
        const video = document.getElementById('photo-editor-video');
        const trimStartSlider = document.getElementById('slider-trim-start');
        const trimEndSlider = document.getElementById('slider-trim-end');
        const valTrimStart = document.getElementById('val-trim-start');
        const valTrimEnd = document.getElementById('val-trim-end');
        const trimSummary = document.getElementById('editor-video-trim-summary');
        const trimActiveRange = document.getElementById('editor-trim-active-range');
        const muteBtn = document.getElementById('editor-video-mute-btn');
        const speedBtn = document.getElementById('editor-video-speed-btn');
        const playBtn = document.getElementById('editor-video-play-btn');

        const dur = sourceVideoDuration > 0 ? sourceVideoDuration : 1;
        const startRatio = Math.max(0, Math.min(1, editState.trimStartSec / dur));
        const endRatio = Math.max(startRatio, Math.min(1, editState.trimEndSec / dur));

        if (trimStartSlider) trimStartSlider.value = String(Math.round(startRatio * 1000));
        if (trimEndSlider) trimEndSlider.value = String(Math.round(endRatio * 1000));
        if (valTrimStart) valTrimStart.textContent = formatDuration(editState.trimStartSec, true);
        if (valTrimEnd) valTrimEnd.textContent = formatDuration(editState.trimEndSec, true);

        const clipLen = Math.max(0, editState.trimEndSec - editState.trimStartSec);
        if (trimSummary) {
            trimSummary.textContent = `Clip: ${formatDuration(editState.trimStartSec, true)} → ${formatDuration(editState.trimEndSec, true)} (${clipLen.toFixed(1)}s)`;
        }
        if (trimActiveRange) {
            trimActiveRange.style.left = `${(startRatio * 100).toFixed(2)}%`;
            trimActiveRange.style.width = `${Math.max(1, (endRatio - startRatio) * 100).toFixed(2)}%`;
        }

        if (video) {
            video.muted = editState.muted;
            video.playbackRate = editState.playbackRate;
        }
        if (muteBtn) {
            muteBtn.classList.toggle('active', editState.muted);
            const ic = muteBtn.querySelector('.material-icons');
            const label = muteBtn.querySelector('span:last-child');
            if (ic) ic.textContent = editState.muted ? 'volume_off' : 'volume_up';
            if (label) label.textContent = editState.muted ? 'Muto' : 'Audio Attivo';
        }
        if (speedBtn) {
            const label = speedBtn.querySelector('span:last-child');
            if (label) label.textContent = `${editState.playbackRate}x`;
            speedBtn.classList.toggle('active', editState.playbackRate !== 1);
        }
        if (playBtn && video) {
            const ic = playBtn.querySelector('.material-icons');
            const label = playBtn.querySelector('span:last-child');
            const playing = !video.paused && !video.ended;
            if (ic) ic.textContent = playing ? 'pause' : 'play_arrow';
            if (label) label.textContent = playing ? 'Pausa' : 'Anteprima';
        }
    }

    function syncControlsFromState() {
        const sBri = document.getElementById('slider-brightness');
        const sCon = document.getElementById('slider-contrast');
        const sSat = document.getElementById('slider-saturation');
        const sWar = document.getElementById('slider-warmth');

        const vBri = document.getElementById('val-brightness');
        const vCon = document.getElementById('val-contrast');
        const vSat = document.getElementById('val-saturation');
        const vWar = document.getElementById('val-warmth');

        if (sBri) sBri.value = String(editState.brightness);
        if (sCon) sCon.value = String(editState.contrast);
        if (sSat) sSat.value = String(editState.saturation);
        if (sWar) sWar.value = String(editState.warmth);

        if (vBri) vBri.textContent = (editState.brightness > 0 ? '+' : '') + editState.brightness;
        if (vCon) vCon.textContent = (editState.contrast > 0 ? '+' : '') + editState.contrast;
        if (vSat) vSat.textContent = (editState.saturation > 0 ? '+' : '') + editState.saturation;
        if (vWar) vWar.textContent = (editState.warmth > 0 ? '+' : '') + editState.warmth;

        document.querySelectorAll('.editor-preset-chip').forEach((btn) => {
            btn.classList.toggle('active', btn.getAttribute('data-preset') === editState.preset);
        });
        document.querySelectorAll('.editor-crop-chip').forEach((btn) => {
            btn.classList.toggle('active', btn.getAttribute('data-crop') === editState.cropAspect);
        });

        const flipHBtn = document.getElementById('editor-flip-h-btn');
        const flipVBtn = document.getElementById('editor-flip-v-btn');
        if (flipHBtn) flipHBtn.classList.toggle('active', editState.flipH);
        if (flipVBtn) flipVBtn.classList.toggle('active', editState.flipV);

        if (isVideoMode) {
            syncVideoTrimControls();
        }
        syncCropOverlayDOM();
        syncHistoryButtons();
    }

    function applyColorAdjustmentsToContext(ctx, width, height) {
        if (
            editState.brightness === 0 &&
            editState.contrast === 0 &&
            editState.saturation === 0 &&
            editState.warmth === 0
        ) {
            return;
        }
        const imgData = ctx.getImageData(0, 0, width, height);
        const data = imgData.data;

        const bOffset = (editState.brightness / 100) * 90;
        const cFactor = Math.pow((editState.contrast + 100) / 100, 2);
        const sFactor = (editState.saturation + 100) / 100;
        const wShift = (editState.warmth / 100) * 42;

        for (let i = 0; i < data.length; i += 4) {
            let r = data[i] + bOffset;
            let g = data[i + 1] + bOffset;
            let b = data[i + 2] + bOffset;

            r = (r - 128) * cFactor + 128;
            g = (g - 128) * cFactor + 128;
            b = (b - 128) * cFactor + 128;

            const luma = 0.299 * r + 0.587 * g + 0.114 * b;
            r = luma + (r - luma) * sFactor;
            g = luma + (g - luma) * sFactor;
            b = luma + (b - luma) * sFactor;

            r += wShift;
            g += wShift * 0.18;
            b -= wShift;

            data[i] = r < 0 ? 0 : r > 255 ? 255 : r;
            data[i + 1] = g < 0 ? 0 : g > 255 ? 255 : g;
            data[i + 2] = b < 0 ? 0 : b > 255 ? 255 : b;
        }
        ctx.putImageData(imgData, 0, 0);
    }

    function buildPreviewSourceCanvas(img) {
        const srcW = img.naturalWidth || img.width || 800;
        const srcH = img.naturalHeight || img.height || 600;
        const maxSide = Math.max(srcW, srcH, 1);
        const scale = maxSide > MAX_PREVIEW_DIMENSION ? MAX_PREVIEW_DIMENSION / maxSide : 1;
        const prevW = Math.max(1, Math.round(srcW * scale));
        const prevH = Math.max(1, Math.round(srcH * scale));
        const c = document.createElement('canvas');
        c.width = prevW;
        c.height = prevH;
        const cCtx = c.getContext('2d', { willReadFrequently: true });
        if (cCtx) {
            cCtx.drawImage(img, 0, 0, prevW, prevH);
        }
        return c;
    }

    function createTransformedOffscreenCanvas(usePreview = false) {
        const baseImg = usePreview && previewSourceCanvas ? previewSourceCanvas : sourceImage;
        if (!baseImg) return null;
        const srcW = baseImg.naturalWidth || baseImg.width || 800;
        const srcH = baseImg.naturalHeight || baseImg.height || 600;
        const isRotated90 = editState.rotation === 90 || editState.rotation === 270;
        const rotW = isRotated90 ? srcH : srcW;
        const rotH = isRotated90 ? srcW : srcH;

        const offCanvas = document.createElement('canvas');
        offCanvas.width = rotW;
        offCanvas.height = rotH;
        const offCtx = offCanvas.getContext('2d', { willReadFrequently: true });
        if (!offCtx) return null;

        offCtx.save();
        offCtx.translate(rotW / 2, rotH / 2);
        offCtx.rotate((editState.rotation * Math.PI) / 180);
        offCtx.scale(editState.flipH ? -1 : 1, editState.flipV ? -1 : 1);
        offCtx.drawImage(baseImg, -srcW / 2, -srcH / 2, srcW, srcH);
        offCtx.restore();
        return offCanvas;
    }

    function renderVideoPreview() {
        const video = document.getElementById('photo-editor-video');
        if (!video) return;

        if (isComparingOriginal) {
            video.style.filter = 'none';
            video.style.transform = '';
            syncCropOverlayDOM();
            return;
        }

        video.style.filter = buildCssFilter(editState);

        let scaleAdj = 1;
        if ((editState.rotation === 90 || editState.rotation === 270) && video.videoWidth > 0 && video.videoHeight > 0) {
            const w = video.clientWidth || video.videoWidth;
            const h = video.clientHeight || video.videoHeight;
            scaleAdj = Math.min(w / Math.max(1, h), h / Math.max(1, w));
        }
        const sx = (editState.flipH ? -1 : 1) * scaleAdj;
        const sy = (editState.flipV ? -1 : 1) * scaleAdj;
        video.style.transform = `rotate(${editState.rotation}deg) scale(${sx}, ${sy})`;

        syncCropOverlayDOM();
        syncVideoTrimControls();
    }

    function renderEditorCanvas() {
        if (isVideoMode) {
            renderVideoPreview();
            return;
        }

        const canvas = document.getElementById('photo-editor-canvas');
        if (!canvas || !sourceImage) return;

        const basePreview = previewSourceCanvas || sourceImage;
        const prevSrcW = basePreview.naturalWidth || basePreview.width || 800;
        const prevSrcH = basePreview.naturalHeight || basePreview.height || 600;
        const ctx = canvas.getContext('2d', { willReadFrequently: true });
        if (!ctx) return;

        if (isComparingOriginal) {
            if (canvas.width !== prevSrcW) canvas.width = prevSrcW;
            if (canvas.height !== prevSrcH) canvas.height = prevSrcH;
            ctx.filter = 'none';
            ctx.clearRect(0, 0, prevSrcW, prevSrcH);
            ctx.drawImage(basePreview, 0, 0, prevSrcW, prevSrcH);
            syncCropOverlayDOM();
            return;
        }

        const isRotated90 = editState.rotation === 90 || editState.rotation === 270;
        const prevRotW = isRotated90 ? prevSrcH : prevSrcW;
        const prevRotH = isRotated90 ? prevSrcW : prevSrcH;

        if (editState.showCropGrid) {
            if (canvas.width !== prevRotW) canvas.width = prevRotW;
            if (canvas.height !== prevRotH) canvas.height = prevRotH;
            ctx.clearRect(0, 0, prevRotW, prevRotH);
            ctx.save();
            ctx.translate(prevRotW / 2, prevRotH / 2);
            ctx.rotate((editState.rotation * Math.PI) / 180);
            ctx.scale(editState.flipH ? -1 : 1, editState.flipV ? -1 : 1);
            ctx.drawImage(basePreview, -prevSrcW / 2, -prevSrcH / 2, prevSrcW, prevSrcH);
            ctx.restore();
            applyColorAdjustmentsToContext(ctx, prevRotW, prevRotH);
        } else {
            const offCanvas = createTransformedOffscreenCanvas(true);
            if (!offCanvas) return;
            const crop = getCroppedPixelRect(offCanvas.width, offCanvas.height);
            if (canvas.width !== crop.width) canvas.width = crop.width;
            if (canvas.height !== crop.height) canvas.height = crop.height;
            ctx.drawImage(offCanvas, crop.x, crop.y, crop.width, crop.height, 0, 0, crop.width, crop.height);
            applyColorAdjustmentsToContext(ctx, crop.width, crop.height);
        }

        syncCropOverlayDOM();
    }

    function schedulePreviewRender() {
        if (pendingRafId) return;
        pendingRafId = requestAnimationFrame(() => {
            pendingRafId = 0;
            renderEditorCanvas();
        });
    }

    function buildFinalCroppedExportCanvas() {
        if (!sourceImage) return null;
        const offCanvas = createTransformedOffscreenCanvas(false);
        if (!offCanvas) return null;

        const crop = getCroppedPixelRect(offCanvas.width, offCanvas.height);
        const exportCanvas = document.createElement('canvas');
        exportCanvas.width = crop.width;
        exportCanvas.height = crop.height;
        const exportCtx = exportCanvas.getContext('2d', { willReadFrequently: true });
        if (!exportCtx) return null;

        exportCtx.drawImage(offCanvas, crop.x, crop.y, crop.width, crop.height, 0, 0, crop.width, crop.height);
        applyColorAdjustmentsToContext(exportCtx, crop.width, crop.height);
        return exportCanvas;
    }

    function selectBestMediaRecorderMime() {
        if (typeof MediaRecorder === 'undefined') return '';
        const candidates = [
            'video/webm;codecs=vp9,opus',
            'video/webm;codecs=vp8,opus',
            'video/webm',
            'video/mp4',
        ];
        for (const mime of candidates) {
            try {
                if (!MediaRecorder.isTypeSupported || MediaRecorder.isTypeSupported(mime)) {
                    return mime;
                }
            } catch {
                // continue
            }
        }
        return '';
    }

    async function exportEditedVideoBlob(onProgress) {
        const previewVideo = document.getElementById('photo-editor-video');
        if (!previewVideo || !previewVideo.src) {
            throw new Error('Video sorgente non disponibile');
        }
        if (typeof MediaRecorder === 'undefined') {
            throw new Error('Questo browser non supporta MediaRecorder per esportazione video');
        }

        const { width: rotW, height: rotH } = getRotatedDimensions();
        const crop = getCroppedPixelRect(rotW, rotH);
        const maxCropSide = Math.max(crop.width, crop.height, 1);
        const scale = maxCropSide > MAX_VIDEO_EXPORT_SIDE ? MAX_VIDEO_EXPORT_SIDE / maxCropSide : 1;

        // Ensure even pixel dimensions for hardware codecs
        const outW = Math.max(2, Math.round((crop.width * scale) / 2) * 2);
        const outH = Math.max(2, Math.round((crop.height * scale) / 2) * 2);

        const exportCanvas = document.createElement('canvas');
        exportCanvas.width = outW;
        exportCanvas.height = outH;
        const ctx = exportCanvas.getContext('2d');
        if (!ctx || typeof exportCanvas.captureStream !== 'function') {
            throw new Error('Esportazione video HTML5 Canvas Stream non supportata dal browser');
        }

        const workVideo = document.createElement('video');
        workVideo.src = previewVideo.src;
        workVideo.crossOrigin = 'anonymous';
        workVideo.playsInline = true;
        workVideo.muted = editState.muted;
        workVideo.playbackRate = editState.playbackRate;

        await new Promise((resolve, reject) => {
            workVideo.onloadedmetadata = () => resolve();
            workVideo.onerror = () => reject(new Error('Errore nel caricamento del video per esportazione'));
        });

        const startSec = Math.max(0, editState.trimStartSec || 0);
        const endSec = Math.max(startSec + 0.1, editState.trimEndSec || workVideo.duration || 1);
        const totalClipSec = Math.max(0.1, endSec - startSec);

        await new Promise((resolve) => {
            const onSeeked = () => {
                workVideo.removeEventListener('seeked', onSeeked);
                resolve();
            };
            workVideo.addEventListener('seeked', onSeeked);
            workVideo.currentTime = startSec;
        });

        const canvasStream = exportCanvas.captureStream(30);
        const combinedTracks = [...canvasStream.getVideoTracks()];

        if (!editState.muted && typeof workVideo.captureStream === 'function') {
            try {
                const vStream = workVideo.captureStream();
                vStream.getAudioTracks().forEach((t) => combinedTracks.push(t));
            } catch {
                // Fallback to video-only if audio capture blocked
            }
        }

        const outputStream = new MediaStream(combinedTracks);
        const mimeType = selectBestMediaRecorderMime();
        const chunks = [];
        const recorder = mimeType
            ? new MediaRecorder(outputStream, { mimeType, videoBitsPerSecond: 4_500_000 })
            : new MediaRecorder(outputStream);

        recorder.ondataavailable = (ev) => {
            if (ev.data && ev.data.size > 0) chunks.push(ev.data);
        };

        const cssFilter = buildCssFilter(editState);

        function drawFrameToExportCanvas() {
            const srcW = workVideo.videoWidth || 1280;
            const srcH = workVideo.videoHeight || 720;
            const isRotated90 = editState.rotation === 90 || editState.rotation === 270;
            const fullRotW = isRotated90 ? srcH : srcW;
            const fullRotH = isRotated90 ? srcW : srcH;

            const cropRatioW = crop.width / Math.max(1, fullRotW);
            const cropRatioH = crop.height / Math.max(1, fullRotH);
            const scaleX = outW / crop.width;
            const scaleY = outH / crop.height;

            ctx.save();
            ctx.clearRect(0, 0, outW, outH);
            ctx.filter = cssFilter === 'none' ? 'none' : cssFilter;

            // Translate so crop region aligns directly with output canvas [0..outW, 0..outH]
            const cropCenterOffsetX = (crop.x + crop.width / 2 - fullRotW / 2) * scaleX;
            const cropCenterOffsetY = (crop.y + crop.height / 2 - fullRotH / 2) * scaleY;
            ctx.translate(outW / 2 - cropCenterOffsetX, outH / 2 - cropCenterOffsetY);
            ctx.scale(scaleX, scaleY);
            ctx.rotate((editState.rotation * Math.PI) / 180);
            ctx.scale(editState.flipH ? -1 : 1, editState.flipV ? -1 : 1);
            ctx.drawImage(workVideo, -srcW / 2, -srcH / 2, srcW, srcH);
            ctx.restore();
            void cropRatioW;
            void cropRatioH;
        }

        return new Promise((resolve, reject) => {
            let stopped = false;
            let rafHandle = 0;

            recorder.onerror = () => {
                stopped = true;
                cancelAnimationFrame(rafHandle);
                reject(new Error('Errore codifica video nel browser'));
            };

            recorder.onstop = () => {
                const resolvedMime = (recorder.mimeType || mimeType || 'video/webm').toLowerCase();
                const blob = new Blob(chunks, { type: resolvedMime });
                const ext = resolvedMime.includes('mp4') ? '.mp4' : '.webm';
                outputStream.getTracks().forEach((t) => {
                    try {
                        t.stop();
                    } catch {
                        // ignore
                    }
                });
                workVideo.pause();
                workVideo.removeAttribute('src');
                resolve({ blob, ext, mimeType: resolvedMime });
            };

            const finishExport = () => {
                if (stopped) return;
                stopped = true;
                cancelAnimationFrame(rafHandle);
                workVideo.pause();
                try {
                    if (recorder.state !== 'inactive') recorder.stop();
                } catch {
                    // ignore
                }
            };

            const tick = () => {
                if (stopped) return;
                drawFrameToExportCanvas();
                const cur = workVideo.currentTime || startSec;
                const progress = Math.max(0, Math.min(1, (cur - startSec) / totalClipSec));
                if (onProgress) onProgress(progress);

                if (cur >= endSec || workVideo.ended) {
                    finishExport();
                    return;
                }
                rafHandle = requestAnimationFrame(tick);
            };

            workVideo.onended = finishExport;
            drawFrameToExportCanvas();
            recorder.start(200);
            workVideo
                .play()
                .then(() => {
                    rafHandle = requestAnimationFrame(tick);
                })
                .catch((err) => {
                    stopped = true;
                    reject(err);
                });
        });
    }

    function updateCardsAndLightboxAfterSave(oldFilename, newFilename, mode, data) {
        const cacheBustUrl = `/media/${encodeURIComponent(newFilename)}?t=${Date.now()}`;
        const containerChanged = newFilename !== oldFilename;

        if (mode === 'overwrite' && !containerChanged) {
            document.querySelectorAll('.media-card-wrapper').forEach((wrap) => {
                if (wrap.getAttribute('data-filename') === oldFilename) {
                    const img = wrap.querySelector('img');
                    if (img) img.src = cacheBustUrl;
                    const vSource = wrap.querySelector('video source');
                    const vEl = wrap.querySelector('video');
                    if (vSource) vSource.src = `${cacheBustUrl}#t=0.1`;
                    if (vEl) vEl.load();
                }
            });
            if (typeof window.refreshLightboxMediaItem === 'function') {
                window.refreshLightboxMediaItem(oldFilename, newFilename, cacheBustUrl);
            }
            return;
        }

        if (Array.isArray(data.mediaFiles) && typeof window.syncVaultItemsFromServer === 'function') {
            window.syncVaultItemsFromServer(data.mediaFiles, { fromUpload: false });
        } else if (typeof window.refreshVaultFromSession === 'function') {
            window.refreshVaultFromSession();
        }
        if (typeof window.refreshLightboxMediaItem === 'function') {
            window.refreshLightboxMediaItem(oldFilename, newFilename, cacheBustUrl);
        }
    }

    async function saveEditedMedia(mode) {
        if (isSaving || !currentFilename) return;
        if (!isVideoMode && !sourceImage) return;

        const resBadge = document.getElementById('editor-resolution-badge');
        const saveCopyBtn = document.getElementById('editor-save-copy-btn');
        const saveOverwriteBtn = document.getElementById('editor-save-overwrite-btn');
        const progressBanner = document.getElementById('editor-export-progress-banner');
        const progressText = document.getElementById('editor-export-progress-text');

        isSaving = true;
        if (saveCopyBtn) saveCopyBtn.disabled = true;
        if (saveOverwriteBtn) saveOverwriteBtn.disabled = true;

        try {
            let uploadBlob;
            let uploadFilename = currentFilename;

            if (isVideoMode) {
                const videoEl = document.getElementById('photo-editor-video');
                if (videoEl && !videoEl.paused) videoEl.pause();

                if (progressBanner) progressBanner.style.display = 'inline-flex';
                if (progressText) progressText.textContent = 'Esportazione video: 0%';
                if (resBadge) resBadge.textContent = 'Esportazione video in corso...';

                const exported = await exportEditedVideoBlob((pct) => {
                    const p = Math.min(99, Math.round(pct * 100));
                    if (progressText) progressText.textContent = `Esportazione video: ${p}%`;
                });
                uploadBlob = exported.blob;
                const dotIdx = currentFilename.lastIndexOf('.');
                const stem = dotIdx > 0 ? currentFilename.slice(0, dotIdx) : currentFilename;
                uploadFilename = `${stem}${exported.ext}`;
                if (progressText) progressText.textContent = 'Crittografia AES-256 e salvataggio...';
            } else {
                const exportCanvas = buildFinalCroppedExportCanvas();
                if (!exportCanvas) throw new Error('Impossibile preparare l immagine');
                if (resBadge) resBadge.textContent = 'Crittografia e salvataggio sul server...';
                uploadBlob = await new Promise((resolve) => exportCanvas.toBlob(resolve, 'image/jpeg', 0.94));
            }

            if (!uploadBlob) throw new Error('Impossibile esportare il file modificato');

            const formData = new FormData();
            formData.append('file', uploadBlob, uploadFilename);
            formData.append('originalFilename', currentFilename);
            formData.append('mode', mode);

            const resp = await fetch('/api/media/edit', {
                method: 'POST',
                body: formData,
            });
            const data = await resp.json();
            if (!resp.ok || !data.success) {
                throw new Error(data.error || 'Errore durante il salvataggio');
            }

            const savedName = data.filename || uploadFilename;
            const prevName = currentFilename;
            isSaving = false;
            window.closePhotoEditor(true);
            updateCardsAndLightboxAfterSave(prevName, savedName, mode, data);
        } catch (err) {
            if (resBadge) {
                resBadge.textContent = `Errore: ${err.message || err}`;
            }
        } finally {
            isSaving = false;
            if (progressBanner) progressBanner.style.display = 'none';
            if (saveCopyBtn) saveCopyBtn.disabled = false;
            if (saveOverwriteBtn) saveOverwriteBtn.disabled = false;
        }
    }

    function applyDragDelta(startBox, handle, dxNorm, dyNorm) {
        const minSpan = 0.08;
        if (handle === 'move') {
            const clampedDx = Math.max(-startBox.left, Math.min(1 - startBox.right, dxNorm));
            const clampedDy = Math.max(-startBox.top, Math.min(1 - startBox.bottom, dyNorm));
            return {
                left: startBox.left + clampedDx,
                top: startBox.top + clampedDy,
                right: startBox.right + clampedDx,
                bottom: startBox.bottom + clampedDy,
            };
        }

        let { left, top, right, bottom } = startBox;
        if (handle.includes('w')) left = Math.max(0, Math.min(right - minSpan, startBox.left + dxNorm));
        if (handle.includes('e')) right = Math.min(1, Math.max(left + minSpan, startBox.right + dxNorm));
        if (handle.includes('n')) top = Math.max(0, Math.min(bottom - minSpan, startBox.top + dyNorm));
        if (handle.includes('s')) bottom = Math.min(1, Math.max(top + minSpan, startBox.bottom + dyNorm));

        if (editState.cropAspect !== 'free') {
            const ratioMap = { '1:1': 1, '4:5': 4 / 5, '4:3': 4 / 3, '16:9': 16 / 9 };
            const targetPixelRatio = ratioMap[editState.cropAspect] || 1;
            const { width: rotW, height: rotH } = getRotatedDimensions();
            const imgRatio = Math.max(1, rotW) / Math.max(1, rotH);
            const normRatio = targetPixelRatio / imgRatio;

            const newW = right - left;
            const newH = bottom - top;

            if (handle === 'n' || handle === 's') {
                const desiredW = Math.min(1, Math.max(minSpan, newH * normRatio));
                const centerX = (left + right) / 2;
                left = Math.max(0, Math.min(1 - desiredW, centerX - desiredW / 2));
                right = left + desiredW;
            } else {
                const desiredH = Math.min(1, Math.max(minSpan, newW / normRatio));
                if (handle.includes('n')) {
                    top = Math.max(0, bottom - desiredH);
                    bottom = top + desiredH;
                } else if (handle.includes('s')) {
                    bottom = Math.min(1, top + desiredH);
                    top = bottom - desiredH;
                } else {
                    const centerY = (top + bottom) / 2;
                    top = Math.max(0, Math.min(1 - desiredH, centerY - desiredH / 2));
                    bottom = top + desiredH;
                }
            }
        }

        return clampCropBox({ left, top, right, bottom }, minSpan);
    }

    window.setManualCropBox = function (left, top, right, bottom) {
        pushHistorySnapshot();
        editState.cropBox = clampCropBox({ left, top, right, bottom });
        syncCropOverlayDOM();
        if (!editState.showCropGrid) {
            schedulePreviewRender();
        }
    };

    window.openPhotoEditor = function (filename, event) {
        if (event) {
            event.stopPropagation();
            event.preventDefault();
        }
        if (!filename) return;

        const modal = document.getElementById('photo-editor-modal');
        const titleEl = document.getElementById('editor-filename-title');
        const resBadge = document.getElementById('editor-resolution-badge');
        const canvas = document.getElementById('photo-editor-canvas');
        const video = document.getElementById('photo-editor-video');
        const videoTabBtn = document.getElementById('editor-tab-video-btn');
        const progressBanner = document.getElementById('editor-export-progress-banner');
        if (!modal) return;

        currentFilename = filename;
        isVideoMode = isVideoFilename(filename);
        isComparingOriginal = false;
        sourceImage = null;
        previewSourceCanvas = null;
        sourceVideoDuration = 0;
        historyPast = [];
        historyFuture = [];

        if (titleEl) titleEl.textContent = `Studio: ${filename}`;
        if (resBadge) resBadge.textContent = isVideoMode ? 'Caricamento video HD...' : 'Caricamento immagine HD...';
        if (progressBanner) progressBanner.style.display = 'none';

        if (videoTabBtn) {
            videoTabBtn.style.display = isVideoMode ? 'inline-flex' : 'none';
        }

        resetEditState();
        switchEditorTab('adjust');
        modal.style.display = 'flex';
        syncHistoryButtons();

        const mediaSrc = `/media/${encodeURIComponent(filename)}?t=${Date.now()}`;

        if (isVideoMode && video) {
            if (canvas) canvas.style.display = 'none';
            video.style.display = 'block';
            const applyVideoMeta = () => {
                const finDur = Number.isFinite(video.duration) && video.duration > 0 ? video.duration : 0;
                const seekEnd = !finDur && video.seekable && video.seekable.length > 0
                    ? video.seekable.end(video.seekable.length - 1)
                    : 0;
                const nextDur = finDur || (Number.isFinite(seekEnd) && seekEnd > 0 ? seekEnd : 0);
                if (nextDur > 0 && (sourceVideoDuration <= 0 || Math.abs(sourceVideoDuration - nextDur) > 0.05)) {
                    const wasUnbounded = sourceVideoDuration <= 0 || editState.trimEndSec <= 0;
                    sourceVideoDuration = nextDur;
                    if (wasUnbounded) {
                        editState.trimStartSec = 0;
                        editState.trimEndSec = nextDur;
                    }
                }
                syncControlsFromState();
                renderVideoPreview();
            };
            video.onloadedmetadata = function () {
                editState.showCropGrid = true;
                editState.cropBox = { left: 0, top: 0, right: 1, bottom: 1 };
                applyVideoMeta();
            };
            video.ondurationchange = applyVideoMeta;
            video.onerror = function () {
                if (resBadge) resBadge.textContent = 'Errore nel caricamento del video';
            };
            video.src = mediaSrc;
            video.load();
        } else if (canvas) {
            if (video) {
                video.pause();
                video.removeAttribute('src');
                video.style.display = 'none';
            }
            canvas.style.display = 'block';
            const img = new Image();
            img.crossOrigin = 'anonymous';
            img.onload = function () {
                sourceImage = img;
                previewSourceCanvas = buildPreviewSourceCanvas(img);
                editState.showCropGrid = true;
                editState.cropBox = { left: 0, top: 0, right: 1, bottom: 1 };
                renderEditorCanvas();
            };
            img.onerror = function () {
                if (resBadge) resBadge.textContent = 'Errore nel caricamento della foto';
            };
            img.src = mediaSrc;
        }
    };

    window.closePhotoEditor = function (forceClose) {
        if (isSaving && forceClose !== true) return;
        const modal = document.getElementById('photo-editor-modal');
        const video = document.getElementById('photo-editor-video');
        if (video) {
            video.pause();
            video.removeAttribute('src');
            video.style.filter = '';
            video.style.transform = '';
            video.style.display = 'none';
        }
        if (modal) modal.style.display = 'none';
        sourceImage = null;
        previewSourceCanvas = null;
        activeDrag = null;
        isVideoMode = false;
        isComparingOriginal = false;
        historyPast = [];
        historyFuture = [];
    };

    document.addEventListener('DOMContentLoaded', () => {
        const closeBtn = document.getElementById('editor-close-btn');
        const undoBtn = document.getElementById('editor-undo-btn');
        const redoBtn = document.getElementById('editor-redo-btn');
        const compareBtn = document.getElementById('editor-compare-btn');
        const resetBtn = document.getElementById('editor-reset-btn');
        const saveCopyBtn = document.getElementById('editor-save-copy-btn');
        const saveOverwriteBtn = document.getElementById('editor-save-overwrite-btn');
        const toggleCropGridBtn = document.getElementById('editor-toggle-crop-grid-btn');
        const cropOverlay = document.getElementById('photo-editor-crop-overlay');
        const editorVideo = document.getElementById('photo-editor-video');

        if (closeBtn) closeBtn.addEventListener('click', () => window.closePhotoEditor());
        if (undoBtn) undoBtn.addEventListener('click', undoEdit);
        if (redoBtn) redoBtn.addEventListener('click', redoEdit);

        if (compareBtn) {
            const startCompare = () => {
                isComparingOriginal = true;
                compareBtn.classList.add('active');
                schedulePreviewRender();
            };
            const stopCompare = () => {
                if (!isComparingOriginal) return;
                isComparingOriginal = false;
                compareBtn.classList.remove('active');
                schedulePreviewRender();
            };
            compareBtn.addEventListener('pointerdown', startCompare);
            window.addEventListener('pointerup', stopCompare);
            window.addEventListener('pointercancel', stopCompare);
            compareBtn.addEventListener('pointerleave', stopCompare);
        }

        if (resetBtn) {
            resetBtn.addEventListener('click', () => {
                pushHistorySnapshot();
                resetEditState();
                schedulePreviewRender();
            });
        }
        if (saveCopyBtn) saveCopyBtn.addEventListener('click', () => saveEditedMedia('copy'));
        if (saveOverwriteBtn) saveOverwriteBtn.addEventListener('click', () => saveEditedMedia('overwrite'));

        // Category Tabs
        document.querySelectorAll('.editor-panel-tab').forEach((tabBtn) => {
            tabBtn.addEventListener('click', () => {
                const tabId = tabBtn.getAttribute('data-editor-tab');
                if (tabId) switchEditorTab(tabId);
            });
        });

        if (toggleCropGridBtn) {
            toggleCropGridBtn.addEventListener('click', () => {
                pushHistorySnapshot();
                editState.showCropGrid = !editState.showCropGrid;
                schedulePreviewRender();
            });
        }

        // Crop Overlay Drag Handles
        if (cropOverlay) {
            cropOverlay.addEventListener('pointerdown', (e) => {
                const targetEl = e.target.closest('[data-crop-handle]');
                const mediaReady = isVideoMode ? Boolean(editorVideo?.videoWidth) : Boolean(sourceImage);
                if (!targetEl || !mediaReady) return;
                const handle = targetEl.getAttribute('data-crop-handle') || 'move';
                const rect = cropOverlay.getBoundingClientRect();
                if (rect.width <= 0 || rect.height <= 0) return;

                e.preventDefault();
                e.stopPropagation();
                if (targetEl.setPointerCapture) {
                    try {
                        targetEl.setPointerCapture(e.pointerId);
                    } catch {
                        // ignore
                    }
                }

                activeDrag = {
                    pointerId: e.pointerId,
                    handle,
                    startX: e.clientX,
                    startY: e.clientY,
                    overlayWidth: rect.width,
                    overlayHeight: rect.height,
                    startBox: { ...editState.cropBox },
                    preDragSnapshot: cloneState(),
                };
            });

            window.addEventListener('pointermove', (e) => {
                if (!activeDrag || e.pointerId !== activeDrag.pointerId) return;
                e.preventDefault();
                const dxNorm = (e.clientX - activeDrag.startX) / Math.max(1, activeDrag.overlayWidth);
                const dyNorm = (e.clientY - activeDrag.startY) / Math.max(1, activeDrag.overlayHeight);
                editState.cropBox = applyDragDelta(activeDrag.startBox, activeDrag.handle, dxNorm, dyNorm);
                syncCropOverlayDOM();
            });

            const finishDrag = (e) => {
                if (!activeDrag || (e && e.pointerId !== undefined && e.pointerId !== activeDrag.pointerId)) {
                    return;
                }
                const moved =
                    Math.abs(editState.cropBox.left - activeDrag.startBox.left) > 0.002 ||
                    Math.abs(editState.cropBox.top - activeDrag.startBox.top) > 0.002 ||
                    Math.abs(editState.cropBox.right - activeDrag.startBox.right) > 0.002 ||
                    Math.abs(editState.cropBox.bottom - activeDrag.startBox.bottom) > 0.002;
                if (moved && activeDrag.preDragSnapshot) {
                    pushHistorySnapshot(activeDrag.preDragSnapshot);
                }
                activeDrag = null;
            };
            window.addEventListener('pointerup', finishDrag);
            window.addEventListener('pointercancel', finishDrag);
        }

        // Filter Preset Chips
        document.querySelectorAll('.editor-preset-chip').forEach((btn) => {
            btn.addEventListener('click', () => {
                pushHistorySnapshot();
                const presetId = btn.getAttribute('data-preset') || 'original';
                const p = FILTER_PRESETS[presetId] || FILTER_PRESETS.original;
                editState.preset = presetId;
                editState.brightness = p.brightness;
                editState.contrast = p.contrast;
                editState.saturation = p.saturation;
                editState.warmth = p.warmth;
                syncControlsFromState();
                schedulePreviewRender();
            });
        });

        // Adjustment Sliders (History snapshot on pointerdown / start, smooth 120Hz rAF on input)
        let sliderBeforeSnapshot = null;
        const bindSlider = (id, key) => {
            const el = document.getElementById(id);
            if (!el) return;
            el.addEventListener('pointerdown', () => {
                sliderBeforeSnapshot = cloneState();
            });
            el.addEventListener('input', () => {
                editState[key] = parseInt(el.value, 10) || 0;
                syncControlsFromState();
                schedulePreviewRender();
            });
            el.addEventListener('change', () => {
                if (sliderBeforeSnapshot) {
                    pushHistorySnapshot(sliderBeforeSnapshot);
                    sliderBeforeSnapshot = null;
                }
            });
        };
        bindSlider('slider-brightness', 'brightness');
        bindSlider('slider-contrast', 'contrast');
        bindSlider('slider-saturation', 'saturation');
        bindSlider('slider-warmth', 'warmth');

        // Rotate & Flip Buttons
        const rotLeft = document.getElementById('editor-rotate-left-btn');
        const rotRight = document.getElementById('editor-rotate-right-btn');
        const flipH = document.getElementById('editor-flip-h-btn');
        const flipV = document.getElementById('editor-flip-v-btn');

        if (rotLeft) {
            rotLeft.addEventListener('click', () => {
                pushHistorySnapshot();
                editState.rotation = (editState.rotation + 270) % 360;
                const { width: rotW, height: rotH } = getRotatedDimensions();
                if (editState.cropAspect !== 'free') {
                    editState.cropBox = fitAspectCropBox(rotW, rotH, editState.cropAspect);
                }
                schedulePreviewRender();
            });
        }
        if (rotRight) {
            rotRight.addEventListener('click', () => {
                pushHistorySnapshot();
                editState.rotation = (editState.rotation + 90) % 360;
                const { width: rotW, height: rotH } = getRotatedDimensions();
                if (editState.cropAspect !== 'free') {
                    editState.cropBox = fitAspectCropBox(rotW, rotH, editState.cropAspect);
                }
                schedulePreviewRender();
            });
        }
        if (flipH) {
            flipH.addEventListener('click', () => {
                pushHistorySnapshot();
                editState.flipH = !editState.flipH;
                syncControlsFromState();
                schedulePreviewRender();
            });
        }
        if (flipV) {
            flipV.addEventListener('click', () => {
                pushHistorySnapshot();
                editState.flipV = !editState.flipV;
                syncControlsFromState();
                schedulePreviewRender();
            });
        }

        // Crop Aspect Chips
        document.querySelectorAll('.editor-crop-chip').forEach((btn) => {
            btn.addEventListener('click', () => {
                pushHistorySnapshot();
                editState.cropAspect = btn.getAttribute('data-crop') || 'free';
                editState.showCropGrid = true;
                const { width: rotW, height: rotH } = getRotatedDimensions();
                if (editState.cropAspect !== 'free') {
                    editState.cropBox = fitAspectCropBox(rotW, rotH, editState.cropAspect);
                } else {
                    editState.cropBox = { left: 0, top: 0, right: 1, bottom: 1 };
                }
                syncControlsFromState();
                schedulePreviewRender();
            });
        });

        // Video Tab Controls
        const videoPlayBtn = document.getElementById('editor-video-play-btn');
        const videoMuteBtn = document.getElementById('editor-video-mute-btn');
        const videoSpeedBtn = document.getElementById('editor-video-speed-btn');
        const trimStartSlider = document.getElementById('slider-trim-start');
        const trimEndSlider = document.getElementById('slider-trim-end');
        const markInBtn = document.getElementById('editor-mark-in-btn');
        const markOutBtn = document.getElementById('editor-mark-out-btn');

        if (editorVideo) {
            editorVideo.addEventListener('timeupdate', () => {
                if (!isVideoMode) return;
                if (editState.trimEndSec > editState.trimStartSec && editorVideo.currentTime >= editState.trimEndSec) {
                    editorVideo.currentTime = editState.trimStartSec;
                }
            });
            editorVideo.addEventListener('play', syncVideoTrimControls);
            editorVideo.addEventListener('pause', syncVideoTrimControls);
        }

        if (videoPlayBtn && editorVideo) {
            videoPlayBtn.addEventListener('click', () => {
                if (editorVideo.paused || editorVideo.ended) {
                    if (editorVideo.currentTime < editState.trimStartSec || editorVideo.currentTime >= editState.trimEndSec) {
                        editorVideo.currentTime = editState.trimStartSec;
                    }
                    editorVideo.play().catch(() => {});
                } else {
                    editorVideo.pause();
                }
            });
        }
        if (videoMuteBtn) {
            videoMuteBtn.addEventListener('click', () => {
                pushHistorySnapshot();
                editState.muted = !editState.muted;
                syncControlsFromState();
            });
        }
        if (videoSpeedBtn) {
            videoSpeedBtn.addEventListener('click', () => {
                pushHistorySnapshot();
                const idx = VIDEO_SPEED_STEPS.indexOf(editState.playbackRate);
                editState.playbackRate = VIDEO_SPEED_STEPS[(idx + 1) % VIDEO_SPEED_STEPS.length];
                syncControlsFromState();
            });
        }
        if (trimStartSlider && editorVideo) {
            trimStartSlider.addEventListener('pointerdown', () => {
                sliderBeforeSnapshot = cloneState();
            });
            trimStartSlider.addEventListener('input', () => {
                const dur = sourceVideoDuration > 0 ? sourceVideoDuration : 1;
                const minGap = Math.min(0.25, dur * 0.1);
                const nextStart = (Number(trimStartSlider.value) / 1000) * dur;
                editState.trimStartSec = Math.max(0, Math.min(editState.trimEndSec - minGap, nextStart));
                editorVideo.currentTime = editState.trimStartSec;
                syncControlsFromState();
            });
            trimStartSlider.addEventListener('change', () => {
                if (sliderBeforeSnapshot) {
                    pushHistorySnapshot(sliderBeforeSnapshot);
                    sliderBeforeSnapshot = null;
                }
            });
        }
        if (trimEndSlider && editorVideo) {
            trimEndSlider.addEventListener('pointerdown', () => {
                sliderBeforeSnapshot = cloneState();
            });
            trimEndSlider.addEventListener('input', () => {
                const dur = sourceVideoDuration > 0 ? sourceVideoDuration : 1;
                const minGap = Math.min(0.25, dur * 0.1);
                const nextEnd = (Number(trimEndSlider.value) / 1000) * dur;
                editState.trimEndSec = Math.min(dur, Math.max(editState.trimStartSec + minGap, nextEnd));
                editorVideo.currentTime = editState.trimEndSec;
                syncControlsFromState();
            });
            trimEndSlider.addEventListener('change', () => {
                if (sliderBeforeSnapshot) {
                    pushHistorySnapshot(sliderBeforeSnapshot);
                    sliderBeforeSnapshot = null;
                }
            });
        }
        if (markInBtn && editorVideo) {
            markInBtn.addEventListener('click', () => {
                pushHistorySnapshot();
                const minGap = Math.min(0.25, sourceVideoDuration * 0.1);
                editState.trimStartSec = Math.max(0, Math.min(editState.trimEndSec - minGap, editorVideo.currentTime || 0));
                syncControlsFromState();
            });
        }
        if (markOutBtn && editorVideo) {
            markOutBtn.addEventListener('click', () => {
                pushHistorySnapshot();
                const minGap = Math.min(0.25, sourceVideoDuration * 0.1);
                editState.trimEndSec = Math.min(
                    sourceVideoDuration,
                    Math.max(editState.trimStartSec + minGap, editorVideo.currentTime || sourceVideoDuration)
                );
                syncControlsFromState();
            });
        }

        // Keyboard shortcuts: Esc, Ctrl+Z, Ctrl+Y / Ctrl+Shift+Z
        document.addEventListener('keydown', (e) => {
            const modal = document.getElementById('photo-editor-modal');
            if (!modal || modal.style.display === 'none') return;

            if (e.key === 'Escape') {
                window.closePhotoEditor();
                return;
            }
            const mod = e.ctrlKey || e.metaKey;
            if (mod && e.key.toLowerCase() === 'z') {
                e.preventDefault();
                if (e.shiftKey) redoEdit();
                else undoEdit();
            } else if (mod && e.key.toLowerCase() === 'y') {
                e.preventDefault();
                redoEdit();
            }
        });
    });
})();
