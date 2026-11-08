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
        preset: 'original',
    };

    function resetEditState() {
        editState.brightness = 0;
        editState.contrast = 0;
        editState.saturation = 0;
        editState.warmth = 0;
        editState.rotation = 0;
        editState.flipH = false;
        editState.flipV = false;
        editState.cropAspect = 'free';
        editState.preset = 'original';
        syncControlsFromState();
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
    }

    function computeCropBox(w, h, aspect) {
        if (!aspect || aspect === 'free') {
            return { x: 0, y: 0, width: w, height: h };
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
        return {
            x: Math.floor((w - cw) / 2),
            y: Math.floor((h - ch) / 2),
            width: cw,
            height: ch,
        };
    }

    function renderEditorCanvas() {
        const canvas = document.getElementById('photo-editor-canvas');
        const resBadge = document.getElementById('editor-resolution-badge');
        if (!canvas || !sourceImage) return;

        const srcW = sourceImage.naturalWidth || sourceImage.width || 800;
        const srcH = sourceImage.naturalHeight || sourceImage.height || 600;

        // First draw rotated & flipped full image onto an offscreen canvas
        const isRotated90 = editState.rotation === 90 || editState.rotation === 270;
        const rotW = isRotated90 ? srcH : srcW;
        const rotH = isRotated90 ? srcW : srcH;

        const offCanvas = document.createElement('canvas');
        offCanvas.width = rotW;
        offCanvas.height = rotH;
        const offCtx = offCanvas.getContext('2d');
        if (!offCtx) return;

        offCtx.save();
        offCtx.translate(rotW / 2, rotH / 2);
        offCtx.rotate((editState.rotation * Math.PI) / 180);
        const scaleX = editState.flipH ? -1 : 1;
        const scaleY = editState.flipV ? -1 : 1;
        offCtx.scale(scaleX, scaleY);
        offCtx.drawImage(sourceImage, -srcW / 2, -srcH / 2, srcW, srcH);
        offCtx.restore();

        // Compute centered crop box on the rotated canvas
        const crop = computeCropBox(rotW, rotH, editState.cropAspect);
        canvas.width = crop.width;
        canvas.height = crop.height;

        const ctx = canvas.getContext('2d', { willReadFrequently: true });
        if (!ctx) return;

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

        // Apply pixel-accurate color adjustments (brightness, contrast, saturation, warmth)
        if (
            editState.brightness !== 0 ||
            editState.contrast !== 0 ||
            editState.saturation !== 0 ||
            editState.warmth !== 0
        ) {
            const imgData = ctx.getImageData(0, 0, canvas.width, canvas.height);
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

        if (resBadge) {
            resBadge.textContent = `${canvas.width} × ${canvas.height} px • Crittografia AES-256`;
        }
    }

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
    };

    async function saveEditedPhoto(mode) {
        if (isSaving || !sourceImage || !currentFilename) return;
        const canvas = document.getElementById('photo-editor-canvas');
        const resBadge = document.getElementById('editor-resolution-badge');
        const saveCopyBtn = document.getElementById('editor-save-copy-btn');
        const saveOverwriteBtn = document.getElementById('editor-save-overwrite-btn');
        if (!canvas) return;

        isSaving = true;
        if (saveCopyBtn) saveCopyBtn.disabled = true;
        if (saveOverwriteBtn) saveOverwriteBtn.disabled = true;
        if (resBadge) resBadge.textContent = 'Crittografia e salvataggio sul server...';

        try {
            const blob = await new Promise((resolve) => canvas.toBlob(resolve, 'image/jpeg', 0.94));
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
                // Refresh any matching image in DOM & Lightbox with cache-buster
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
                // Saved as a new copy: reload gallery so the new photo card appears immediately
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

    document.addEventListener('DOMContentLoaded', () => {
        const closeBtn = document.getElementById('editor-close-btn');
        const resetBtn = document.getElementById('editor-reset-btn');
        const saveCopyBtn = document.getElementById('editor-save-copy-btn');
        const saveOverwriteBtn = document.getElementById('editor-save-overwrite-btn');

        if (closeBtn) closeBtn.addEventListener('click', () => window.closePhotoEditor());
        if (resetBtn) {
            resetBtn.addEventListener('click', () => {
                resetEditState();
                renderEditorCanvas();
            });
        }
        if (saveCopyBtn) saveCopyBtn.addEventListener('click', () => saveEditedPhoto('copy'));
        if (saveOverwriteBtn) saveOverwriteBtn.addEventListener('click', () => saveEditedPhoto('overwrite'));

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
                renderEditorCanvas();
            });
        }
        if (rotRight) {
            rotRight.addEventListener('click', () => {
                editState.rotation = (editState.rotation + 90) % 360;
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
