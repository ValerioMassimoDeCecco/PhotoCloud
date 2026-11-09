// static/scripts/photo-editor.js — Material You 120Hz Photo Editor Studio per PhotoCloud Web

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

    let currentFilename = '';
    let sourceImage = null;
    let isSaving = false;

    const editState = {
        brightness: 0,
        contrast: 0,
        saturation: 0,
        warmth: 0,
        rotation: 0, // 0, 90, 180, 270
        flipH: false,
        flipV: false,
        cropAspect: 'free',
        cropBox: { left: 0, top: 0, right: 1, bottom: 1 },
        showCropGrid: true, // Opens immediately with the draggable manual crop grid active
        preset: 'original',
    };

    // Active drag state for the manual crop grid
    let activeDrag = null;

    function getRotatedDimensions() {
        if (!sourceImage) return { width: 800, height: 600 };
        const srcW = sourceImage.naturalWidth || sourceImage.width || 800;
        const srcH = sourceImage.naturalHeight || sourceImage.height || 600;
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
        const ratioMap = {
            '1:1': 1,
            '4:5': 4 / 5,
            '4:3': 4 / 3,
            '16:9': 16 / 9,
        };
        const target = ratioMap[aspect] || 1;
        const curr = w / h;
        let cw = w;
        let ch = h;
        if (curr > target) {
            cw = Math.max(1, Math.round(h * target));
        } else {
            ch = Math.max(1, Math.round(w / target));
        }
        const x = Math.floor((w - cw) / 2);
        const y = Math.floor((h - ch) / 2);
        return clampCropBox({
            left: x / w,
            top: y / h,
            right: (x + cw) / w,
            bottom: (y + ch) / h,
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
        syncControlsFromState();
    }

    function syncCropOverlayDOM() {
        const overlay = document.getElementById('photo-editor-crop-overlay');
        const cropBoxEl = document.getElementById('photo-editor-crop-box');
        const dimLabel = document.getElementById('crop-box-dimensions-label');
        const resBadge = document.getElementById('editor-resolution-badge');
        const toggleGridBtn = document.getElementById('editor-toggle-crop-grid-btn');

        if (toggleGridBtn) {
            toggleGridBtn.classList.toggle('active', editState.showCropGrid);
        }

        if (overlay) {
            overlay.classList.toggle('active', Boolean(editState.showCropGrid && sourceImage));
        }

        const { width: rotW, height: rotH } = getRotatedDimensions();
        const rect = getCroppedPixelRect(rotW, rotH);

        if (cropBoxEl) {
            const leftPct = (editState.cropBox.left * 100).toFixed(2);
            const topPct = (editState.cropBox.top * 100).toFixed(2);
            const widthPct = ((editState.cropBox.right - editState.cropBox.left) * 100).toFixed(2);
            const heightPct = ((editState.cropBox.bottom - editState.cropBox.top) * 100).toFixed(2);
            cropBoxEl.style.left = `${leftPct}%`;
            cropBoxEl.style.top = `${topPct}%`;
            cropBoxEl.style.width = `${widthPct}%`;
            cropBoxEl.style.height = `${heightPct}%`;
        }

        if (dimLabel) {
            dimLabel.textContent = `${rect.width} × ${rect.height} px`;
        }
        if (resBadge && sourceImage) {
            resBadge.textContent = `${rect.width} × ${rect.height} px • Crittografia AES-256`;
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

        syncCropOverlayDOM();
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

    function createTransformedOffscreenCanvas() {
        const { width: rotW, height: rotH, srcW, srcH } = getRotatedDimensions();
        const offCanvas = document.createElement('canvas');
        offCanvas.width = rotW;
        offCanvas.height = rotH;
        const offCtx = offCanvas.getContext('2d', { willReadFrequently: true });
        if (!offCtx) return null;

        offCtx.save();
        offCtx.translate(rotW / 2, rotH / 2);
        offCtx.rotate((editState.rotation * Math.PI) / 180);
        const scaleX = editState.flipH ? -1 : 1;
        const scaleY = editState.flipV ? -1 : 1;
        offCtx.scale(scaleX, scaleY);
        offCtx.drawImage(sourceImage, -srcW / 2, -srcH / 2, srcW, srcH);
        offCtx.restore();
        return offCanvas;
    }

    function renderEditorCanvas() {
        const canvas = document.getElementById('photo-editor-canvas');
        if (!canvas || !sourceImage) return;

        const offCanvas = createTransformedOffscreenCanvas();
        if (!offCanvas) return;

        const rotW = offCanvas.width;
        const rotH = offCanvas.height;
        const crop = getCroppedPixelRect(rotW, rotH);

        const ctx = canvas.getContext('2d', { willReadFrequently: true });
        if (!ctx) return;

        if (editState.showCropGrid) {
            // Show the full transformed image on the canvas and position the draggable crop grid overlay on top
            canvas.width = rotW;
            canvas.height = rotH;
            ctx.drawImage(offCanvas, 0, 0, rotW, rotH);
            applyColorAdjustmentsToContext(ctx, rotW, rotH);
        } else {
            // Show only the cropped region
            canvas.width = crop.width;
            canvas.height = crop.height;
            ctx.drawImage(
                offCanvas,
                crop.x,
                crop.y,
                crop.width,
                crop.height,
                0,
                0,
                crop.width,
                crop.height
            );
            applyColorAdjustmentsToContext(ctx, crop.width, crop.height);
        }

        syncCropOverlayDOM();
    }

    function buildFinalCroppedExportCanvas() {
        if (!sourceImage) return null;
        const offCanvas = createTransformedOffscreenCanvas();
        if (!offCanvas) return null;

        const crop = getCroppedPixelRect(offCanvas.width, offCanvas.height);
        const exportCanvas = document.createElement('canvas');
        exportCanvas.width = crop.width;
        exportCanvas.height = crop.height;
        const exportCtx = exportCanvas.getContext('2d', { willReadFrequently: true });
        if (!exportCtx) return null;

        exportCtx.drawImage(
            offCanvas,
            crop.x,
            crop.y,
            crop.width,
            crop.height,
            0,
            0,
            crop.width,
            crop.height
        );
        applyColorAdjustmentsToContext(exportCtx, crop.width, crop.height);
        return exportCanvas;
    }

    window.setManualCropBox = function (left, top, right, bottom) {
        editState.cropBox = clampCropBox({ left, top, right, bottom });
        syncCropOverlayDOM();
        if (!editState.showCropGrid) {
            renderEditorCanvas();
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
        if (!modal) return;

        currentFilename = filename;
        if (titleEl) titleEl.textContent = `Modifica: ${filename}`;
        if (resBadge) resBadge.textContent = 'Caricamento immagine...';

        resetEditState();
        modal.style.display = 'flex';

        const img = new Image();
        img.crossOrigin = 'anonymous';
        img.onload = function () {
            sourceImage = img;
            // Immediately open with the draggable manual crop grid active on the loaded image
            editState.showCropGrid = true;
            editState.cropBox = { left: 0, top: 0, right: 1, bottom: 1 };
            renderEditorCanvas();
        };
        img.onerror = function () {
            if (resBadge) resBadge.textContent = 'Errore nel caricamento della foto';
        };
        img.src = `/media/${encodeURIComponent(filename)}?t=${Date.now()}`;
    };

    window.closePhotoEditor = function () {
        const modal = document.getElementById('photo-editor-modal');
        if (modal) {
            modal.style.display = 'none';
        }
        sourceImage = null;
        activeDrag = null;
    };

    async function saveEditedPhoto(mode) {
        if (isSaving || !sourceImage || !currentFilename) return;
        const resBadge = document.getElementById('editor-resolution-badge');
        const saveCopyBtn = document.getElementById('editor-save-copy-btn');
        const saveOverwriteBtn = document.getElementById('editor-save-overwrite-btn');

        const exportCanvas = buildFinalCroppedExportCanvas();
        if (!exportCanvas) return;

        isSaving = true;
        if (saveCopyBtn) saveCopyBtn.disabled = true;
        if (saveOverwriteBtn) saveOverwriteBtn.disabled = true;
        if (resBadge) resBadge.textContent = 'Crittografia e salvataggio sul server...';

        try {
            const blob = await new Promise((resolve) => exportCanvas.toBlob(resolve, 'image/jpeg', 0.94));
            if (!blob) throw new Error('Impossibile esportare il canvas');

            const formData = new FormData();
            formData.append('file', blob, currentFilename);
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

            if (mode === 'overwrite') {
                const cacheBustUrl = `/media/${encodeURIComponent(currentFilename)}?t=${Date.now()}`;
                document.querySelectorAll('.media-card-wrapper').forEach((wrap) => {
                    if (wrap.getAttribute('data-filename') === currentFilename) {
                        const img = wrap.querySelector('img');
                        if (img) img.src = cacheBustUrl;
                    }
                });
                const lbImg = document.getElementById('lightbox-img');
                if (lbImg && lbImg.style.display !== 'none') {
                    lbImg.src = cacheBustUrl;
                }
                window.closePhotoEditor();
            } else {
                window.closePhotoEditor();
                window.location.reload();
            }
        } catch (err) {
            if (resBadge) {
                resBadge.textContent = `Errore: ${err.message || err}`;
            }
        } finally {
            isSaving = false;
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
        if (handle.includes('w')) {
            left = Math.max(0, Math.min(right - minSpan, startBox.left + dxNorm));
        }
        if (handle.includes('e')) {
            right = Math.min(1, Math.max(left + minSpan, startBox.right + dxNorm));
        }
        if (handle.includes('n')) {
            top = Math.max(0, Math.min(bottom - minSpan, startBox.top + dyNorm));
        }
        if (handle.includes('s')) {
            bottom = Math.min(1, Math.max(top + minSpan, startBox.bottom + dyNorm));
        }

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

    document.addEventListener('DOMContentLoaded', () => {
        const closeBtn = document.getElementById('editor-close-btn');
        const resetBtn = document.getElementById('editor-reset-btn');
        const saveCopyBtn = document.getElementById('editor-save-copy-btn');
        const saveOverwriteBtn = document.getElementById('editor-save-overwrite-btn');
        const toggleCropGridBtn = document.getElementById('editor-toggle-crop-grid-btn');
        const cropOverlay = document.getElementById('photo-editor-crop-overlay');

        if (closeBtn) closeBtn.addEventListener('click', () => window.closePhotoEditor());
        if (resetBtn) {
            resetBtn.addEventListener('click', () => {
                resetEditState();
                renderEditorCanvas();
            });
        }
        if (saveCopyBtn) saveCopyBtn.addEventListener('click', () => saveEditedPhoto('copy'));
        if (saveOverwriteBtn) saveOverwriteBtn.addEventListener('click', () => saveEditedPhoto('overwrite'));

        if (toggleCropGridBtn) {
            toggleCropGridBtn.addEventListener('click', () => {
                editState.showCropGrid = !editState.showCropGrid;
                renderEditorCanvas();
            });
        }

        // Interactive Pointer Dragging for Manual Crop Grid (8 handles + interior pan)
        if (cropOverlay) {
            cropOverlay.addEventListener('pointerdown', (e) => {
                const targetEl = e.target.closest('[data-crop-handle]');
                if (!targetEl || !sourceImage) return;
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
                };
            });

            window.addEventListener('pointermove', (e) => {
                if (!activeDrag || e.pointerId !== activeDrag.pointerId) return;
                e.preventDefault();
                const dxNorm = (e.clientX - activeDrag.startX) / Math.max(1, activeDrag.overlayWidth);
                const dyNorm = (e.clientY - activeDrag.startY) / Math.max(1, activeDrag.overlayHeight);
                editState.cropBox = applyDragDelta(
                    activeDrag.startBox,
                    activeDrag.handle,
                    dxNorm,
                    dyNorm
                );
                syncCropOverlayDOM();
            });

            const finishDrag = (e) => {
                if (!activeDrag || (e && e.pointerId !== undefined && e.pointerId !== activeDrag.pointerId)) {
                    return;
                }
                activeDrag = null;
            };
            window.addEventListener('pointerup', finishDrag);
            window.addEventListener('pointercancel', finishDrag);
        }

        // Filter Preset Chips
        document.querySelectorAll('.editor-preset-chip').forEach((btn) => {
            btn.addEventListener('click', () => {
                const presetId = btn.getAttribute('data-preset') || 'original';
                const p = FILTER_PRESETS[presetId] || FILTER_PRESETS.original;
                editState.preset = presetId;
                editState.brightness = p.brightness;
                editState.contrast = p.contrast;
                editState.saturation = p.saturation;
                editState.warmth = p.warmth;
                syncControlsFromState();
                renderEditorCanvas();
            });
        });

        // Adjustment Sliders
        const bindSlider = (id, key) => {
            const el = document.getElementById(id);
            if (!el) return;
            el.addEventListener('input', () => {
                editState[key] = parseInt(el.value, 10) || 0;
                syncControlsFromState();
                renderEditorCanvas();
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
                editState.rotation = (editState.rotation + 270) % 360;
                const { width: rotW, height: rotH } = getRotatedDimensions();
                if (editState.cropAspect !== 'free') {
                    editState.cropBox = fitAspectCropBox(rotW, rotH, editState.cropAspect);
                }
                renderEditorCanvas();
            });
        }
        if (rotRight) {
            rotRight.addEventListener('click', () => {
                editState.rotation = (editState.rotation + 90) % 360;
                const { width: rotW, height: rotH } = getRotatedDimensions();
                if (editState.cropAspect !== 'free') {
                    editState.cropBox = fitAspectCropBox(rotW, rotH, editState.cropAspect);
                }
                renderEditorCanvas();
            });
        }
        if (flipH) {
            flipH.addEventListener('click', () => {
                editState.flipH = !editState.flipH;
                syncControlsFromState();
                renderEditorCanvas();
            });
        }
        if (flipV) {
            flipV.addEventListener('click', () => {
                editState.flipV = !editState.flipV;
                syncControlsFromState();
                renderEditorCanvas();
            });
        }

        // Crop Aspect Chips
        document.querySelectorAll('.editor-crop-chip').forEach((btn) => {
            btn.addEventListener('click', () => {
                editState.cropAspect = btn.getAttribute('data-crop') || 'free';
                editState.showCropGrid = true;
                const { width: rotW, height: rotH } = getRotatedDimensions();
                if (editState.cropAspect !== 'free') {
                    editState.cropBox = fitAspectCropBox(rotW, rotH, editState.cropAspect);
                }
                syncControlsFromState();
                renderEditorCanvas();
            });
        });

        document.addEventListener('keydown', (e) => {
            const modal = document.getElementById('photo-editor-modal');
            if (modal && modal.style.display !== 'none' && e.key === 'Escape') {
                window.closePhotoEditor();
            }
        });
    });
})();
