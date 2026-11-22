import {
  DEFAULT_NORMALIZED_CROP_BOX,
  DEFAULT_PHOTO_EDIT_STATE,
  PHOTO_FILTER_PRESETS,
  applyPresetToEditState,
  buildCssFilterString,
  clampNormalizedCropBox,
  createEditHistory,
  dragNormalizedCropHandle,
  fitAspectNormalizedCropBox,
  normalizeRotation,
  normalizedBoxToPixelRect,
  pushEditSnapshot,
  redoEditSnapshot,
  transformRgbPixel,
  undoEditSnapshot,
  type CropAspectRatio,
  type CropDragHandle,
  type EditHistoryStack,
  type NormalizedCropBox,
  type PhotoEditState,
  type PhotoFilterPresetId,
} from '../../lib/photoEditorMath.ts';
import type { DecryptedItemV2, ZkVaultClient } from '../zk-sdk/index.ts';

function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  className?: string,
  text?: string
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

function cloneEditState(state: PhotoEditState): PhotoEditState {
  return {
    ...state,
    cropBox: { ...state.cropBox },
  };
}

function hasAnyEdits(state: PhotoEditState): boolean {
  return (
    state.brightness !== 0 ||
    state.contrast !== 0 ||
    state.saturation !== 0 ||
    state.warmth !== 0 ||
    state.rotation !== 0 ||
    state.flipH ||
    state.flipV ||
    state.filterPreset !== 'original' ||
    state.cropBox.left > 0.002 ||
    state.cropBox.top > 0.002 ||
    state.cropBox.right < 0.998 ||
    state.cropBox.bottom < 0.998
  );
}

function formatSignedValue(v: number): string {
  const rounded = Math.round(v);
  return rounded > 0 ? `+${rounded}` : `${rounded}`;
}

export interface PhotoEditorModalCallbacks {
  onClose: () => void;
  onSavedOverwrite: (updatedItem: DecryptedItemV2) => void;
  onSavedCopy: (copyName: string) => void;
  onError: (message: string) => void;
}

/**
 * Pure Canvas 2D rendering pipeline applying rotation, flip, cropBox, and tone/filter adjustments.
 * Keeps pixel-accurate transforms for export while supporting fast preview rendering.
 */
export function renderEditedPhotoToCanvas(
  source: HTMLImageElement | HTMLCanvasElement,
  state: PhotoEditState,
  options: { applyCrop?: boolean; maxEdge?: number; fastPreview?: boolean } = {}
): HTMLCanvasElement {
  const srcW = source instanceof HTMLImageElement ? source.naturalWidth || source.width : source.width;
  const srcH = source instanceof HTMLImageElement ? source.naturalHeight || source.height : source.height;
  const rot = normalizeRotation(state.rotation);
  const rotatedW = rot === 90 || rot === 270 ? srcH : srcW;
  const rotatedH = rot === 90 || rot === 270 ? srcW : srcH;

  // Step 1: Rotate & Flip into intermediate canvas
  const step1 = document.createElement('canvas');
  step1.width = Math.max(1, rotatedW);
  step1.height = Math.max(1, rotatedH);
  const ctx1 = step1.getContext('2d');
  if (!ctx1) return step1;

  ctx1.save();
  ctx1.translate(step1.width / 2, step1.height / 2);
  ctx1.rotate((rot * Math.PI) / 180);
  ctx1.scale(state.flipH ? -1 : 1, state.flipV ? -1 : 1);
  ctx1.drawImage(source, -srcW / 2, -srcH / 2, srcW, srcH);
  ctx1.restore();

  // Step 2: Crop & Scale
  const cropRect =
    options.applyCrop === false
      ? { x: 0, y: 0, width: step1.width, height: step1.height }
      : normalizedBoxToPixelRect(step1.width, step1.height, state.cropBox);

  let outW = Math.max(1, cropRect.width);
  let outH = Math.max(1, cropRect.height);
  if (options.maxEdge && Math.max(outW, outH) > options.maxEdge) {
    const scale = options.maxEdge / Math.max(outW, outH);
    outW = Math.max(1, Math.round(outW * scale));
    outH = Math.max(1, Math.round(outH * scale));
  }

  const out = document.createElement('canvas');
  out.width = outW;
  out.height = outH;
  const outCtx = out.getContext('2d', { willReadFrequently: !options.fastPreview });
  if (!outCtx) return out;

  const hasColorEdits =
    state.brightness !== 0 ||
    state.contrast !== 0 ||
    state.saturation !== 0 ||
    state.warmth !== 0;

  if (options.fastPreview && hasColorEdits && 'filter' in outCtx) {
    outCtx.filter = buildCssFilterString(state);
    outCtx.drawImage(step1, cropRect.x, cropRect.y, cropRect.width, cropRect.height, 0, 0, outW, outH);
    outCtx.filter = 'none';
    return out;
  }

  outCtx.drawImage(step1, cropRect.x, cropRect.y, cropRect.width, cropRect.height, 0, 0, outW, outH);

  // Step 3: Exact pixel-level Brightness / Contrast / Saturation / Warmth
  if (hasColorEdits) {
    const imgData = outCtx.getImageData(0, 0, outW, outH);
    const data = imgData.data;
    for (let i = 0; i < data.length; i += 4) {
      const [nr, ng, nb] = transformRgbPixel(data[i], data[i + 1], data[i + 2], state);
      data[i] = nr;
      data[i + 1] = ng;
      data[i + 2] = nb;
    }
    outCtx.putImageData(imgData, 0, 0);
  }

  return out;
}

async function canvasToBytes(canvas: HTMLCanvasElement, mime: string, quality = 0.92): Promise<Uint8Array> {
  const targetMime = mime === 'image/png' ? 'image/png' : 'image/jpeg';
  const blob = await new Promise<Blob | null>((resolve) =>
    canvas.toBlob((b) => resolve(b), targetMime, targetMime === 'image/jpeg' ? quality : undefined)
  );
  if (!blob) throw new Error('Impossibile codificare immagine modificata.');
  return new Uint8Array(await blob.arrayBuffer());
}

async function generateThumbFromCanvas(canvas: HTMLCanvasElement, maxEdge: number): Promise<Uint8Array> {
  const scale = Math.min(1, maxEdge / Math.max(canvas.width, canvas.height));
  const w = Math.max(1, Math.round(canvas.width * scale));
  const h = Math.max(1, Math.round(canvas.height * scale));
  const t = document.createElement('canvas');
  t.width = w;
  t.height = h;
  const ctx = t.getContext('2d');
  if (ctx) {
    ctx.drawImage(canvas, 0, 0, w, h);
  }
  return canvasToBytes(t, 'image/jpeg', 0.82);
}

function buildDownscaledPreviewSource(img: HTMLImageElement, maxEdge = 1280): HTMLCanvasElement {
  const w = img.naturalWidth || img.width;
  const h = img.naturalHeight || img.height;
  const scale = Math.min(1, maxEdge / Math.max(1, w, h));
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.round(w * scale));
  canvas.height = Math.max(1, Math.round(h * scale));
  const ctx = canvas.getContext('2d');
  if (ctx) {
    ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
  }
  return canvas;
}

export function openPhotoEditorModal(
  container: HTMLElement,
  client: ZkVaultClient,
  item: DecryptedItemV2,
  callbacks: PhotoEditorModalCallbacks
): () => void {
  const backdrop = el('div', 'modal-backdrop modal-backdrop-fullscreen');
  backdrop.id = 'photo-editor-modal';

  const studio = el('div', 'editor-studio');

  // --- Clean single-row Top Bar ---
  const topBar = el('header', 'editor-topbar');

  const topLeft = el('div', 'editor-topbar-left');
  const cancelBtn = el('button', 'btn btn-ghost editor-icon-btn', 'Annulla');
  cancelBtn.id = 'btn-editor-cancel';
  cancelBtn.setAttribute('aria-label', 'Annulla modifiche');
  topLeft.appendChild(cancelBtn);

  const titleEl = el('span', 'editor-doc-title', item.meta.name);
  topLeft.appendChild(titleEl);

  const topCenter = el('div', 'editor-topbar-center');
  const undoBtn = el('button', 'btn btn-ghost editor-tool-btn', '↶');
  undoBtn.id = 'btn-editor-undo';
  undoBtn.title = 'Annulla ultima modifica (Ctrl+Z)';
  undoBtn.setAttribute('aria-label', 'Annulla ultima modifica');
  undoBtn.disabled = true;

  const redoBtn = el('button', 'btn btn-ghost editor-tool-btn', '↷');
  redoBtn.id = 'btn-editor-redo';
  redoBtn.title = 'Ripeti modifica (Ctrl+Shift+Z)';
  redoBtn.setAttribute('aria-label', 'Ripeti modifica');
  redoBtn.disabled = true;

  const compareBtn = el('button', 'btn btn-ghost editor-tool-btn', 'Confronta');
  compareBtn.id = 'btn-editor-compare';
  compareBtn.setAttribute('aria-pressed', 'false');

  const resetBtn = el('button', 'btn btn-ghost editor-tool-btn', 'Ripristina');
  resetBtn.id = 'btn-editor-reset';

  topCenter.append(undoBtn, redoBtn, compareBtn, resetBtn);

  const topRight = el('div', 'editor-topbar-right');
  const saveCopyBtn = el('button', 'btn btn-ghost', 'Salva copia');
  saveCopyBtn.id = 'btn-editor-save-copy';
  const saveOverwriteBtn = el('button', 'btn btn-primary', 'Sovrascrivi');
  saveOverwriteBtn.id = 'btn-editor-save-overwrite';
  topRight.append(saveCopyBtn, saveOverwriteBtn);

  topBar.append(topLeft, topCenter, topRight);
  studio.appendChild(topBar);

  // --- Dominant Darkroom Stage ---
  const stage = el('div', 'editor-stage');
  const canvasWrap = el('div', 'editor-canvas-wrap');
  const previewCanvas = el('canvas', 'editor-preview-canvas');
  previewCanvas.id = 'editor-preview-canvas';
  canvasWrap.appendChild(previewCanvas);

  const compareBadge = el('div', 'editor-compare-badge', 'Originale');
  compareBadge.style.display = 'none';
  canvasWrap.appendChild(compareBadge);

  // Interactive crop overlay (visible in Ritaglia tab)
  const cropOverlay = el('div', 'editor-crop-overlay');
  cropOverlay.id = 'editor-crop-overlay';
  cropOverlay.style.display = 'none';

  const cropBoxEl = el('div', 'editor-crop-box');
  cropBoxEl.id = 'editor-crop-box';
  cropBoxEl.dataset.handle = 'move';

  const cropGrid = el('div', 'editor-crop-grid');
  cropGrid.append(
    el('span', 'editor-crop-line'),
    el('span', 'editor-crop-line'),
    el('span', 'editor-crop-line'),
    el('span', 'editor-crop-line')
  );
  cropBoxEl.appendChild(cropGrid);

  const handles: CropDragHandle[] = ['nw', 'n', 'ne', 'e', 'se', 's', 'sw', 'w'];
  for (const h of handles) {
    const handleEl = el('div', `editor-crop-handle handle-${h}`);
    handleEl.dataset.handle = h;
    cropBoxEl.appendChild(handleEl);
  }
  cropOverlay.appendChild(cropBoxEl);
  canvasWrap.appendChild(cropOverlay);

  const statusLine = el('div', 'editor-status-line mono-nums', 'Decifratura foto locale in corso...');
  statusLine.id = 'editor-status-line';

  stage.append(canvasWrap, statusLine);
  studio.appendChild(stage);

  // --- Bottom Intuitive Controls Dock ---
  const dock = el('div', 'editor-controls-dock');

  const controlsBody = el('div', 'editor-controls-body');
  controlsBody.id = 'editor-controls-body';

  const tabRow = el('div', 'editor-tab-row');
  tabRow.setAttribute('role', 'tablist');
  let activeTab: 'filters' | 'adjust' | 'transform' = 'adjust';

  const tabButtons: Record<'filters' | 'adjust' | 'transform', HTMLButtonElement> = {
    adjust: el('button', 'editor-tab-btn active', 'Regola'),
    filters: el('button', 'editor-tab-btn', 'Filtri'),
    transform: el('button', 'editor-tab-btn', 'Ritaglia'),
  };
  tabButtons.adjust.id = 'editor-tab-adjust';
  tabButtons.filters.id = 'editor-tab-filters';
  tabButtons.transform.id = 'editor-tab-transform';
  for (const key of ['adjust', 'filters', 'transform'] as const) {
    tabButtons[key].setAttribute('role', 'tab');
    tabButtons[key].setAttribute('aria-selected', String(key === activeTab));
  }
  tabRow.append(tabButtons.adjust, tabButtons.filters, tabButtons.transform);

  dock.append(controlsBody, tabRow);
  studio.appendChild(dock);
  backdrop.appendChild(studio);
  container.appendChild(backdrop);

  // --- Editor State ---
  let sourceImage: HTMLImageElement | null = null;
  let previewSource: HTMLCanvasElement | null = null;
  let sourceObjectUrl: string | null = null;
  let history: EditHistoryStack<PhotoEditState> = createEditHistory(cloneEditState(DEFAULT_PHOTO_EDIT_STATE));
  let isComparing = false;
  let isSaving = false;
  let isDisposed = false;
  let rafPending = false;
  const filterThumbUrls = new Map<PhotoFilterPresetId, string>();

  const currentState = () => history.present;

  const updateUndoRedoButtons = () => {
    const edited = hasAnyEdits(currentState());
    undoBtn.disabled = history.past.length === 0 || isSaving;
    redoBtn.disabled = history.future.length === 0 || isSaving;
    resetBtn.disabled = !edited || isSaving;
    compareBtn.disabled = !edited || isSaving;
    compareBtn.classList.toggle('active-toggle', isComparing);
    compareBtn.setAttribute('aria-pressed', String(isComparing));
    compareBadge.style.display = isComparing ? 'block' : 'none';
  };

  const syncCropOverlayDom = () => {
    const showCrop = activeTab === 'transform' && !isComparing && Boolean(sourceImage);
    cropOverlay.style.display = showCrop ? 'block' : 'none';
    if (!showCrop) return;
    const b = clampNormalizedCropBox(currentState().cropBox);
    cropBoxEl.style.left = `${(b.left * 100).toFixed(3)}%`;
    cropBoxEl.style.top = `${(b.top * 100).toFixed(3)}%`;
    cropBoxEl.style.width = `${((b.right - b.left) * 100).toFixed(3)}%`;
    cropBoxEl.style.height = `${((b.bottom - b.top) * 100).toFixed(3)}%`;
  };

  const renderPreviewNow = () => {
    if (!sourceImage || !previewSource || isDisposed) return;
    const st = currentState();
    const effectiveState = isComparing ? DEFAULT_PHOTO_EDIT_STATE : st;
    const applyCrop = activeTab !== 'transform' && !isComparing;

    const rendered = renderEditedPhotoToCanvas(previewSource, effectiveState, {
      applyCrop,
      maxEdge: 1280,
      fastPreview: true,
    });

    previewCanvas.width = rendered.width;
    previewCanvas.height = rendered.height;
    const ctx = previewCanvas.getContext('2d');
    if (ctx) {
      ctx.clearRect(0, 0, previewCanvas.width, previewCanvas.height);
      ctx.drawImage(rendered, 0, 0);
    }

    const fullRot = normalizeRotation(st.rotation);
    const fullW = fullRot === 90 || fullRot === 270 ? sourceImage.naturalHeight : sourceImage.naturalWidth;
    const fullH = fullRot === 90 || fullRot === 270 ? sourceImage.naturalWidth : sourceImage.naturalHeight;
    const outRect = normalizedBoxToPixelRect(fullW, fullH, st.cropBox);

    if (isComparing) {
      statusLine.textContent = `Originale · ${sourceImage.naturalWidth}×${sourceImage.naturalHeight} px`;
    } else {
      const presetLabel = PHOTO_FILTER_PRESETS[st.filterPreset]?.label ?? 'Originale';
      const parts = [`${outRect.width}×${outRect.height} px`];
      if (st.rotation !== 0) parts.push(`${st.rotation}°`);
      if (st.filterPreset !== 'original') parts.push(presetLabel);
      if (activeTab === 'transform') parts.push('Trascina i bordi per ritagliare');
      statusLine.textContent = parts.join(' · ');
    }

    syncCropOverlayDom();
    updateUndoRedoButtons();
  };

  const schedulePreviewRender = () => {
    if (rafPending || isDisposed) return;
    rafPending = true;
    requestAnimationFrame(() => {
      rafPending = false;
      renderPreviewNow();
    });
  };

  const commitState = (next: PhotoEditState, rerenderControls = false) => {
    client.touchActivity();
    history = pushEditSnapshot(history, cloneEditState(next));
    schedulePreviewRender();
    if (rerenderControls) renderControlsBody();
  };

  const generateFilterThumbnails = () => {
    if (!previewSource) return;
    const small = document.createElement('canvas');
    small.width = 96;
    small.height = 96;
    const sCtx = small.getContext('2d');
    if (!sCtx) return;

    // Center-square crop for clean uniform thumbnails
    const side = Math.min(previewSource.width, previewSource.height);
    const sx = Math.floor((previewSource.width - side) / 2);
    const sy = Math.floor((previewSource.height - side) / 2);
    sCtx.drawImage(previewSource, sx, sy, side, side, 0, 0, 96, 96);

    for (const presetId of Object.keys(PHOTO_FILTER_PRESETS) as PhotoFilterPresetId[]) {
      const preset = PHOTO_FILTER_PRESETS[presetId];
      const thumbCanvas = renderEditedPhotoToCanvas(
        small,
        {
          ...DEFAULT_PHOTO_EDIT_STATE,
          brightness: preset.brightness,
          contrast: preset.contrast,
          saturation: preset.saturation,
          warmth: preset.warmth,
          filterPreset: presetId,
        },
        { applyCrop: false, fastPreview: false }
      );
      filterThumbUrls.set(presetId, thumbCanvas.toDataURL('image/jpeg', 0.78));
    }
  };

  const renderControlsBody = () => {
    controlsBody.textContent = '';
    const st = currentState();

    if (activeTab === 'adjust') {
      const slidersGrid = el('div', 'editor-sliders-grid');
      const sliderDefs: Array<{
        key: 'brightness' | 'contrast' | 'saturation' | 'warmth';
        label: string;
        id: string;
      }> = [
        { key: 'brightness', label: 'Luminosità', id: 'editor-slider-brightness' },
        { key: 'contrast', label: 'Contrasto', id: 'editor-slider-contrast' },
        { key: 'saturation', label: 'Saturazione', id: 'editor-slider-saturation' },
        { key: 'warmth', label: 'Calore', id: 'editor-slider-warmth' },
      ];

      for (const def of sliderDefs) {
        const row = el('div', 'editor-slider-row');
        const head = el('div', 'editor-slider-head');
        const lbl = el('label', 'editor-slider-label', def.label);
        lbl.htmlFor = def.id;

        const valBtn = el(
          'button',
          `editor-slider-val mono-nums ${st[def.key] !== 0 ? 'modified' : ''}`,
          formatSignedValue(st[def.key])
        );
        valBtn.type = 'button';
        valBtn.title = `Clicca per azzerare ${def.label}`;

        const input = el('input', 'editor-range-input');
        input.id = def.id;
        input.type = 'range';
        input.min = '-100';
        input.max = '100';
        input.step = '1';
        input.value = String(st[def.key]);

        let draftStart: PhotoEditState | null = null;
        input.addEventListener('pointerdown', () => {
          draftStart = cloneEditState(currentState());
        });
        input.addEventListener('input', () => {
          client.touchActivity();
          const num = Number(input.value);
          valBtn.textContent = formatSignedValue(num);
          valBtn.classList.toggle('modified', num !== 0);
          history = {
            ...history,
            present: {
              ...currentState(),
              [def.key]: num,
              filterPreset: 'original',
            },
          };
          schedulePreviewRender();
        });
        input.addEventListener('change', () => {
          const num = Number(input.value);
          valBtn.textContent = formatSignedValue(num);
          valBtn.classList.toggle('modified', num !== 0);
          const next = {
            ...currentState(),
            [def.key]: num,
            filterPreset: 'original' as PhotoFilterPresetId,
          };
          if (draftStart) {
            history = pushEditSnapshot({ ...history, present: draftStart }, next);
            draftStart = null;
          } else {
            history = pushEditSnapshot(history, next);
          }
          schedulePreviewRender();
        });
        input.addEventListener('dblclick', () => {
          commitState({ ...currentState(), [def.key]: 0, filterPreset: 'original' }, true);
        });
        valBtn.addEventListener('click', () => {
          if (currentState()[def.key] !== 0) {
            commitState({ ...currentState(), [def.key]: 0, filterPreset: 'original' }, true);
          }
        });

        head.append(lbl, valBtn);
        row.append(head, input);
        slidersGrid.appendChild(row);
      }
      controlsBody.appendChild(slidersGrid);
      return;
    }

    if (activeTab === 'filters') {
      const strip = el('div', 'editor-presets-row editor-filter-strip');
      for (const presetId of Object.keys(PHOTO_FILTER_PRESETS) as PhotoFilterPresetId[]) {
        const preset = PHOTO_FILTER_PRESETS[presetId];
        const btn = el(
          'button',
          `editor-filter-card ${st.filterPreset === presetId ? 'active' : ''}`
        );
        btn.type = 'button';
        btn.id = `editor-filter-${presetId}`;
        btn.setAttribute('aria-pressed', String(st.filterPreset === presetId));

        const thumbWrap = el('span', 'editor-filter-thumb-wrap');
        const thumbUrl = filterThumbUrls.get(presetId);
        if (thumbUrl) {
          const img = el('img', 'editor-filter-thumb');
          img.src = thumbUrl;
          img.alt = '';
          img.draggable = false;
          thumbWrap.appendChild(img);
        }
        const labelSpan = el('span', 'editor-filter-label', preset.label);
        btn.append(thumbWrap, labelSpan);

        btn.addEventListener('click', () => {
          commitState(applyPresetToEditState(currentState(), presetId), true);
        });
        strip.appendChild(btn);
      }
      controlsBody.appendChild(strip);
      return;
    }

    // Transform & Crop tab
    const wrap = el('div', 'editor-transform-wrap');

    const actionRow = el('div', 'editor-action-strip');
    const rotLeftBtn = el('button', 'btn btn-ghost editor-tool-btn', '↺ Ruota -90°');
    rotLeftBtn.id = 'btn-editor-rotate-left';
    rotLeftBtn.addEventListener('click', () => {
      const cur = currentState();
      commitState(
        {
          ...cur,
          rotation: normalizeRotation(cur.rotation - 90),
          cropBox: { ...DEFAULT_NORMALIZED_CROP_BOX },
        },
        true
      );
    });

    const rotRightBtn = el('button', 'btn btn-ghost editor-tool-btn', '↻ Ruota +90°');
    rotRightBtn.id = 'btn-editor-rotate-right';
    rotRightBtn.addEventListener('click', () => {
      const cur = currentState();
      commitState(
        {
          ...cur,
          rotation: normalizeRotation(cur.rotation + 90),
          cropBox: { ...DEFAULT_NORMALIZED_CROP_BOX },
        },
        true
      );
    });

    const flipHBtn = el('button', `btn btn-ghost editor-tool-btn ${st.flipH ? 'active-toggle' : ''}`, '⇄ Specchia O');
    flipHBtn.id = 'btn-editor-flip-h';
    flipHBtn.addEventListener('click', () => {
      const cur = currentState();
      commitState({ ...cur, flipH: !cur.flipH }, true);
    });

    const flipVBtn = el('button', `btn btn-ghost editor-tool-btn ${st.flipV ? 'active-toggle' : ''}`, '⇅ Specchia V');
    flipVBtn.id = 'btn-editor-flip-v';
    flipVBtn.addEventListener('click', () => {
      const cur = currentState();
      commitState({ ...cur, flipV: !cur.flipV }, true);
    });

    actionRow.append(rotLeftBtn, rotRightBtn, flipHBtn, flipVBtn);
    wrap.appendChild(actionRow);

    const aspectRow = el('div', 'editor-presets-row');
    const aspects: Array<{ id: CropAspectRatio; label: string }> = [
      { id: 'free', label: 'Libero' },
      { id: '1:1', label: '1:1' },
      { id: '4:3', label: '4:3' },
      { id: '4:5', label: '4:5' },
      { id: '16:9', label: '16:9' },
    ];
    for (const asp of aspects) {
      const btn = el(
        'button',
        `editor-preset-btn ${st.cropAspect === asp.id ? 'active' : ''}`,
        asp.label
      );
      btn.type = 'button';
      btn.id = `editor-aspect-${asp.id.replace(':', '-')}`;
      btn.addEventListener('click', () => {
        const cur = currentState();
        const fittedBox = fitAspectNormalizedCropBox(
          previewCanvas.width || 1000,
          previewCanvas.height || 1000,
          asp.id
        );
        commitState({ ...cur, cropAspect: asp.id, cropBox: fittedBox }, true);
      });
      aspectRow.appendChild(btn);
    }
    wrap.appendChild(aspectRow);
    controlsBody.appendChild(wrap);
  };

  // --- Interactive Crop Box Pointer Drag ---
  let activeCropDrag: {
    handle: CropDragHandle;
    startX: number;
    startY: number;
    startBox: NormalizedCropBox;
    overlayW: number;
    overlayH: number;
  } | null = null;

  const onCropPointerDown = (ev: PointerEvent) => {
    const target = ev.target as HTMLElement | null;
    const handle = (target?.dataset.handle ?? 'move') as CropDragHandle;
    const rect = cropOverlay.getBoundingClientRect();
    if (rect.width <= 0 || rect.height <= 0) return;
    ev.preventDefault();
    client.touchActivity();
    activeCropDrag = {
      handle,
      startX: ev.clientX,
      startY: ev.clientY,
      startBox: { ...currentState().cropBox },
      overlayW: rect.width,
      overlayH: rect.height,
    };
    window.addEventListener('pointermove', onCropPointerMove);
    window.addEventListener('pointerup', onCropPointerUp);
    window.addEventListener('pointercancel', onCropPointerUp);
  };

  const onCropPointerMove = (ev: PointerEvent) => {
    if (!activeCropDrag) return;
    const dxNorm = (ev.clientX - activeCropDrag.startX) / activeCropDrag.overlayW;
    const dyNorm = (ev.clientY - activeCropDrag.startY) / activeCropDrag.overlayH;
    const nextBox = dragNormalizedCropHandle(
      activeCropDrag.startBox,
      activeCropDrag.handle,
      dxNorm,
      dyNorm,
      currentState().cropAspect,
      previewCanvas.width || 1000,
      previewCanvas.height || 1000
    );
    history = {
      ...history,
      present: {
        ...currentState(),
        cropBox: nextBox,
      },
    };
    syncCropOverlayDom();
    schedulePreviewRender();
  };

  const onCropPointerUp = () => {
    if (!activeCropDrag) return;
    const startBox = activeCropDrag.startBox;
    const endBox = currentState().cropBox;
    activeCropDrag = null;
    window.removeEventListener('pointermove', onCropPointerMove);
    window.removeEventListener('pointerup', onCropPointerUp);
    window.removeEventListener('pointercancel', onCropPointerUp);

    if (
      startBox.left !== endBox.left ||
      startBox.top !== endBox.top ||
      startBox.right !== endBox.right ||
      startBox.bottom !== endBox.bottom
    ) {
      history = pushEditSnapshot(
        {
          ...history,
          present: { ...currentState(), cropBox: startBox },
        },
        cloneEditState(currentState())
      );
      updateUndoRedoButtons();
    }
  };

  cropBoxEl.addEventListener('pointerdown', onCropPointerDown);

  // --- Tabs & Top Bar Wiring ---
  for (const key of ['adjust', 'filters', 'transform'] as const) {
    tabButtons[key].addEventListener('click', () => {
      client.touchActivity();
      activeTab = key;
      for (const k of ['adjust', 'filters', 'transform'] as const) {
        const isAct = k === key;
        tabButtons[k].classList.toggle('active', isAct);
        tabButtons[k].setAttribute('aria-selected', String(isAct));
      }
      renderControlsBody();
      schedulePreviewRender();
    });
  }

  undoBtn.addEventListener('click', () => {
    client.touchActivity();
    history = undoEditSnapshot(history);
    renderControlsBody();
    schedulePreviewRender();
  });

  redoBtn.addEventListener('click', () => {
    client.touchActivity();
    history = redoEditSnapshot(history);
    renderControlsBody();
    schedulePreviewRender();
  });

  compareBtn.addEventListener('click', () => {
    client.touchActivity();
    isComparing = !isComparing;
    schedulePreviewRender();
  });

  resetBtn.addEventListener('click', () => {
    isComparing = false;
    commitState(cloneEditState(DEFAULT_PHOTO_EDIT_STATE), true);
  });

  const onKeyDown = (ev: KeyboardEvent) => {
    if (isDisposed) return;
    if (ev.key === 'Escape' && !isSaving) {
      ev.preventDefault();
      cleanup();
      callbacks.onClose();
      return;
    }
    if ((ev.metaKey || ev.ctrlKey) && ev.key.toLowerCase() === 'z') {
      ev.preventDefault();
      if (ev.shiftKey) {
        if (history.future.length > 0 && !isSaving) {
          history = redoEditSnapshot(history);
          renderControlsBody();
          schedulePreviewRender();
        }
      } else if (history.past.length > 0 && !isSaving) {
        history = undoEditSnapshot(history);
        renderControlsBody();
        schedulePreviewRender();
      }
    }
  };
  window.addEventListener('keydown', onKeyDown);

  const cleanup = () => {
    if (isDisposed) return;
    isDisposed = true;
    window.removeEventListener('keydown', onKeyDown);
    window.removeEventListener('pointermove', onCropPointerMove);
    window.removeEventListener('pointerup', onCropPointerUp);
    window.removeEventListener('pointercancel', onCropPointerUp);
    if (sourceObjectUrl) {
      URL.revokeObjectURL(sourceObjectUrl);
      sourceObjectUrl = null;
    }
    backdrop.remove();
  };

  cancelBtn.addEventListener('click', () => {
    if (isSaving) return;
    cleanup();
    callbacks.onClose();
  });

  const saveEdited = async (mode: 'overwrite' | 'copy') => {
    if (!sourceImage || isSaving) return;
    client.touchActivity();
    isSaving = true;
    saveOverwriteBtn.disabled = true;
    saveCopyBtn.disabled = true;
    cancelBtn.disabled = true;
    updateUndoRedoButtons();
    statusLine.textContent =
      mode === 'overwrite'
        ? 'Esportazione e ri-cifratura AES-256-GCM (sovrascrittura)...'
        : 'Esportazione e cifratura AES-256-GCM (nuova copia)...';

    try {
      const finalCanvas = renderEditedPhotoToCanvas(sourceImage, currentState(), {
        applyCrop: true,
        fastPreview: false,
      });
      const targetMime = item.meta.mime === 'image/png' ? 'image/png' : 'image/jpeg';
      const plainBytes = await canvasToBytes(finalCanvas, targetMime, 0.92);
      const thumb320 = await generateThumbFromCanvas(finalCanvas, 320);
      const thumb1280 = await generateThumbFromCanvas(finalCanvas, 1280);

      if (mode === 'overwrite') {
        const updated = await client.replaceItemWithEditedBlob(
          item.id,
          plainBytes,
          {
            mime: targetMime,
            width: finalCanvas.width,
            height: finalCanvas.height,
          },
          item.version,
          { thumb320, thumb1280 }
        );
        cleanup();
        callbacks.onSavedOverwrite(updated);
      } else {
        const ext = targetMime === 'image/png' ? 'png' : 'jpg';
        const baseName = item.meta.name.replace(/\.[^.]+$/, '');
        const copyName = `${baseName}_modificata.${ext}`;
        await client.uploadFile({
          name: copyName,
          mimeType: targetMime,
          size: plainBytes.byteLength,
          source: plainBytes,
          width: finalCanvas.width,
          height: finalCanvas.height,
          takenAt: item.meta.takenAt,
          thumb320Plaintext: thumb320,
          thumb1280Plaintext: thumb1280,
        });
        await client.syncItems('all');
        cleanup();
        callbacks.onSavedCopy(copyName);
      }
    } catch (err) {
      isSaving = false;
      saveOverwriteBtn.disabled = false;
      saveCopyBtn.disabled = false;
      cancelBtn.disabled = false;
      updateUndoRedoButtons();
      const msg = err instanceof Error ? err.message : 'Errore salvataggio modifica foto.';
      statusLine.textContent = `Errore: ${msg}`;
      callbacks.onError(msg);
    }
  };

  saveOverwriteBtn.addEventListener('click', () => void saveEdited('overwrite'));
  saveCopyBtn.addEventListener('click', () => void saveEdited('copy'));

  // Load decrypted original image client-side
  renderControlsBody();
  client
    .downloadBlobToBytes(item.blobId)
    .then((plainBytes) => {
      if (isDisposed) return;
      const blob = new Blob([plainBytes as unknown as BlobPart], { type: item.meta.mime });
      sourceObjectUrl = URL.createObjectURL(blob);
      const img = new Image();
      img.onload = () => {
        if (isDisposed) return;
        sourceImage = img;
        previewSource = buildDownscaledPreviewSource(img, 1280);
        generateFilterThumbnails();
        renderControlsBody();
        renderPreviewNow();
      };
      img.onerror = () => {
        statusLine.textContent = 'Errore caricamento immagine decifrata nel canvas.';
      };
      img.src = sourceObjectUrl;
    })
    .catch((err) => {
      if (isDisposed) return;
      statusLine.textContent =
        err instanceof Error ? `Errore decifratura: ${err.message}` : 'Errore decifratura immagine.';
    });

  return cleanup;
}
