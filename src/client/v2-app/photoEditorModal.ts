import {
  DEFAULT_NORMALIZED_CROP_BOX,
  DEFAULT_PHOTO_EDIT_STATE,
  PHOTO_FILTER_PRESETS,
  applyPresetToEditState,
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

const FILTER_PRESET_IDS: PhotoFilterPresetId[] = [
  'original',
  'vivid',
  'bw',
  'sepia',
  'cinema',
  'cool',
  'vintage',
];

const CROP_ASPECT_OPTIONS: Array<{ id: CropAspectRatio; label: string }> = [
  { id: 'free', label: 'Libero' },
  { id: '1:1', label: '1:1' },
  { id: '4:3', label: '4:3' },
  { id: '4:5', label: '4:5' },
  { id: '16:9', label: '16:9' },
];

function hasPhotoEdits(state: PhotoEditState): boolean {
  return (
    state.brightness !== 0 ||
    state.contrast !== 0 ||
    state.saturation !== 0 ||
    state.warmth !== 0 ||
    normalizeRotation(state.rotation) !== 0 ||
    state.flipH ||
    state.flipV ||
    state.filterPreset !== 'original' ||
    state.cropAspect !== 'free' ||
    state.cropBox.left > 0.001 ||
    state.cropBox.top > 0.001 ||
    state.cropBox.right < 0.999 ||
    state.cropBox.bottom < 0.999
  );
}

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

function getRotatedDimensions(width: number, height: number, rotation: number): { w: number; h: number } {
  const norm = normalizeRotation(rotation);
  if (norm === 90 || norm === 270) {
    return { w: height, h: width };
  }
  return { w: width, h: height };
}

/**
 * Renders the source image with full geometric transform (rotation + flip),
 * pixel-level color/filter adjustments (`transformRgbPixel`), and crop into a canvas.
 */
export function renderEditedPhotoToCanvas(
  source: HTMLImageElement | HTMLCanvasElement,
  sourceWidth: number,
  sourceHeight: number,
  state: PhotoEditState,
  options: { applyCrop: boolean; maxEdge?: number }
): HTMLCanvasElement {
  const normRot = normalizeRotation(state.rotation);
  const rotDims = getRotatedDimensions(sourceWidth, sourceHeight, normRot);

  const scale =
    options.maxEdge && Math.max(rotDims.w, rotDims.h) > options.maxEdge
      ? options.maxEdge / Math.max(rotDims.w, rotDims.h)
      : 1;

  const fullW = Math.max(1, Math.round(rotDims.w * scale));
  const fullH = Math.max(1, Math.round(rotDims.h * scale));

  // Step 1: Rotate & Flip onto intermediate canvas
  const oriented = document.createElement('canvas');
  oriented.width = fullW;
  oriented.height = fullH;
  const oCtx = oriented.getContext('2d', { willReadFrequently: true });
  if (!oCtx) return oriented;

  oCtx.save();
  oCtx.translate(fullW / 2, fullH / 2);
  oCtx.rotate((normRot * Math.PI) / 180);
  oCtx.scale(state.flipH ? -1 : 1, state.flipV ? -1 : 1);
  const drawW = normRot === 90 || normRot === 270 ? fullH : fullW;
  const drawH = normRot === 90 || normRot === 270 ? fullW : fullH;
  oCtx.drawImage(source, -drawW / 2, -drawH / 2, drawW, drawH);
  oCtx.restore();

  // Step 2: Crop if requested
  let targetCanvas = oriented;
  if (options.applyCrop) {
    const rect = normalizedBoxToPixelRect(fullW, fullH, state.cropBox);
    if (rect.x > 0 || rect.y > 0 || rect.width < fullW || rect.height < fullH) {
      const cropped = document.createElement('canvas');
      cropped.width = rect.width;
      cropped.height = rect.height;
      const cCtx = cropped.getContext('2d', { willReadFrequently: true });
      if (cCtx) {
        cCtx.drawImage(
          oriented,
          rect.x,
          rect.y,
          rect.width,
          rect.height,
          0,
          0,
          rect.width,
          rect.height
        );
        targetCanvas = cropped;
      }
    }
  }

  // Step 3: Exact pixel-level filter & color adjustments from shared photoEditorMath
  const needsPixelPass =
    state.brightness !== 0 ||
    state.contrast !== 0 ||
    state.saturation !== 0 ||
    state.warmth !== 0;

  if (needsPixelPass) {
    const ctx = targetCanvas.getContext('2d', { willReadFrequently: true });
    if (ctx) {
      const imgData = ctx.getImageData(0, 0, targetCanvas.width, targetCanvas.height);
      const data = imgData.data;
      for (let i = 0; i < data.length; i += 4) {
        const [nr, ng, nb] = transformRgbPixel(data[i], data[i + 1], data[i + 2], state);
        data[i] = nr;
        data[i + 1] = ng;
        data[i + 2] = nb;
      }
      ctx.putImageData(imgData, 0, 0);
    }
  }

  return targetCanvas;
}

async function canvasToBytes(
  canvas: HTMLCanvasElement,
  mime: string,
  quality = 0.9
): Promise<Uint8Array> {
  const safeMime = mime === 'image/png' || mime === 'image/webp' ? mime : 'image/jpeg';
  const blob = await new Promise<Blob | null>((resolve) =>
    canvas.toBlob((b) => resolve(b), safeMime, quality)
  );
  if (!blob) {
    throw new Error('Impossibile esportare immagine modificata dal canvas.');
  }
  return new Uint8Array(await blob.arrayBuffer());
}

async function generateCanvasThumbs(
  canvas: HTMLCanvasElement
): Promise<{ thumb320?: Uint8Array; thumb1280?: Uint8Array }> {
  const renderScaled = async (maxEdge: number): Promise<Uint8Array | undefined> => {
    const scale = Math.min(1, maxEdge / Math.max(canvas.width, canvas.height));
    const w = Math.max(1, Math.round(canvas.width * scale));
    const h = Math.max(1, Math.round(canvas.height * scale));
    const c = document.createElement('canvas');
    c.width = w;
    c.height = h;
    const ctx = c.getContext('2d');
    if (!ctx) return undefined;
    ctx.drawImage(canvas, 0, 0, w, h);
    const b = await new Promise<Blob | null>((resolve) =>
      c.toBlob((res) => resolve(res), 'image/jpeg', 0.82)
    );
    return b ? new Uint8Array(await b.arrayBuffer()) : undefined;
  };
  return {
    thumb320: await renderScaled(320),
    thumb1280: await renderScaled(1280),
  };
}

export interface PhotoEditorModalCallbacks {
  onClose: () => void;
  onSavedOverwrite: (updated: DecryptedItemV2) => void;
  onSavedCopy: (copyName: string) => void;
  onError: (message: string) => void;
}

export function openPhotoEditorModal(
  container: HTMLElement,
  client: ZkVaultClient,
  item: DecryptedItemV2,
  callbacks: PhotoEditorModalCallbacks
): () => void {
  let history: EditHistoryStack<PhotoEditState> = createEditHistory<PhotoEditState>({
    ...DEFAULT_PHOTO_EDIT_STATE,
    cropBox: { ...DEFAULT_NORMALIZED_CROP_BOX },
  });
  let activeTab: 'adjust' | 'filters' | 'transform' = 'adjust';
  let comparingOriginal = false;
  let saving = false;
  let sourceImage: HTMLImageElement | null = null;
  let sourceObjectUrl: string | null = null;

  const commitState = (next: PhotoEditState) => {
    history = pushEditSnapshot(history, next);
  };

  const replacePresent = (next: PhotoEditState) => {
    history = { ...history, present: next };
  };

  const backdrop = el('div', 'modal-backdrop editor-backdrop');
  backdrop.id = 'photo-editor-modal';

  const studio = el('div', 'editor-studio');

  // Top Bar
  const topBar = el('div', 'editor-topbar');
  const cancelBtn = el('button', 'btn btn-ghost', 'Annulla');
  cancelBtn.id = 'btn-editor-cancel';

  const historyGroup = el('div', 'editor-topbar-center');
  const undoBtn = el('button', 'btn btn-ghost', '↶ Annulla');
  undoBtn.id = 'btn-editor-undo';
  const redoBtn = el('button', 'btn btn-ghost', '↷ Ripeti');
  redoBtn.id = 'btn-editor-redo';
  const resetBtn = el('button', 'btn btn-ghost', 'Ripristina');
  resetBtn.id = 'btn-editor-reset';
  const compareBtn = el('button', 'btn btn-ghost', 'Confronta');
  compareBtn.id = 'btn-editor-compare';
  historyGroup.append(undoBtn, redoBtn, resetBtn, compareBtn);

  const saveGroup = el('div', 'editor-topbar-right');
  const saveCopyBtn = el('button', 'btn', 'Salva Copia');
  saveCopyBtn.id = 'btn-editor-save-copy';
  const saveOverwriteBtn = el('button', 'btn btn-primary', 'Sovrascrivi');
  saveOverwriteBtn.id = 'btn-editor-save-overwrite';
  saveGroup.append(saveCopyBtn, saveOverwriteBtn);

  topBar.append(cancelBtn, historyGroup, saveGroup);
  studio.appendChild(topBar);

  // Stage
  const stage = el('div', 'editor-stage');
  const loadingLabel = el('div', 'media-card-meta', 'Decifratura foto ad alta risoluzione in corso...');
  stage.appendChild(loadingLabel);

  const canvasWrap = el('div', 'editor-canvas-wrap hidden');
  const previewCanvas = el('canvas', 'editor-preview-canvas');
  previewCanvas.id = 'editor-preview-canvas';
  canvasWrap.appendChild(previewCanvas);

  // Interactive crop box overlay (shown in transform tab)
  const cropOverlay = el('div', 'editor-crop-overlay hidden');
  const cropBox = el('div', 'editor-crop-box');
  cropBox.id = 'editor-crop-box';
  const cropGrid = el('div', 'editor-crop-grid');
  for (let i = 0; i < 4; i++) cropGrid.appendChild(el('span', 'editor-crop-line'));
  cropBox.appendChild(cropGrid);

  const handles: Array<{ handle: CropDragHandle; cls: string }> = [
    { handle: 'nw', cls: 'handle-nw' },
    { handle: 'n', cls: 'handle-n' },
    { handle: 'ne', cls: 'handle-ne' },
    { handle: 'e', cls: 'handle-e' },
    { handle: 'se', cls: 'handle-se' },
    { handle: 's', cls: 'handle-s' },
    { handle: 'sw', cls: 'handle-sw' },
    { handle: 'w', cls: 'handle-w' },
  ];
  for (const h of handles) {
    const hEl = el('div', `editor-crop-handle ${h.cls}`);
    hEl.dataset.handle = h.handle;
    cropBox.appendChild(hEl);
  }
  cropOverlay.appendChild(cropBox);
  canvasWrap.appendChild(cropOverlay);
  stage.appendChild(canvasWrap);

  const statusFooter = el('div', 'editor-status-line mono-nums', '');
  statusFooter.id = 'editor-status-line';
  stage.appendChild(statusFooter);
  studio.appendChild(stage);

  // Bottom Controls
  const controlsDock = el('div', 'editor-controls-dock');
  const tabRow = el('div', 'editor-tab-row');
  const adjustTabBtn = el('button', 'tab-btn active', 'Regola');
  adjustTabBtn.id = 'editor-tab-adjust';
  const filterTabBtn = el('button', 'tab-btn', 'Filtri');
  filterTabBtn.id = 'editor-tab-filters';
  const transformTabBtn = el('button', 'tab-btn', 'Trasforma & Ritaglia');
  transformTabBtn.id = 'editor-tab-transform';
  tabRow.append(adjustTabBtn, filterTabBtn, transformTabBtn);
  controlsDock.appendChild(tabRow);

  const panelBody = el('div', 'editor-panel-body');
  panelBody.id = 'editor-panel-body';
  controlsDock.appendChild(panelBody);
  studio.appendChild(controlsDock);

  backdrop.appendChild(studio);
  container.appendChild(backdrop);

  const cleanup = () => {
    if (sourceObjectUrl) {
      URL.revokeObjectURL(sourceObjectUrl);
      sourceObjectUrl = null;
    }
    backdrop.remove();
  };

  const updateToolbarState = () => {
    undoBtn.disabled = history.past.length === 0 || saving;
    redoBtn.disabled = history.future.length === 0 || saving;
    resetBtn.disabled = !hasPhotoEdits(history.present) || saving;
    saveCopyBtn.disabled = !sourceImage || saving;
    saveOverwriteBtn.disabled = !sourceImage || saving;
    compareBtn.classList.toggle('active-toggle', comparingOriginal);
  };

  const syncCropBoxGeometry = () => {
    const showCrop = activeTab === 'transform' && !comparingOriginal && sourceImage !== null;
    cropOverlay.classList.toggle('hidden', !showCrop);
    if (!showCrop) return;
    const { left, top, right, bottom } = history.present.cropBox;
    cropBox.style.left = `${(left * 100).toFixed(2)}%`;
    cropBox.style.top = `${(top * 100).toFixed(2)}%`;
    cropBox.style.width = `${((right - left) * 100).toFixed(2)}%`;
    cropBox.style.height = `${((bottom - top) * 100).toFixed(2)}%`;
  };

  const renderPreview = () => {
    if (!sourceImage) return;
    const stateToRender = comparingOriginal ? DEFAULT_PHOTO_EDIT_STATE : history.present;
    const applyCropNow = activeTab !== 'transform' && !comparingOriginal;
    const rendered = renderEditedPhotoToCanvas(
      sourceImage,
      sourceImage.naturalWidth,
      sourceImage.naturalHeight,
      stateToRender,
      { applyCrop: applyCropNow, maxEdge: 960 }
    );
    previewCanvas.width = rendered.width;
    previewCanvas.height = rendered.height;
    const ctx = previewCanvas.getContext('2d');
    if (ctx) {
      ctx.clearRect(0, 0, previewCanvas.width, previewCanvas.height);
      ctx.drawImage(rendered, 0, 0);
    }

    const rotDims = getRotatedDimensions(
      sourceImage.naturalWidth,
      sourceImage.naturalHeight,
      history.present.rotation
    );
    const outRect = normalizedBoxToPixelRect(rotDims.w, rotDims.h, history.present.cropBox);
    const presetLabel = PHOTO_FILTER_PRESETS[history.present.filterPreset]?.label ?? 'Originale';
    statusFooter.textContent = comparingOriginal
      ? `ORIGINALE · ${sourceImage.naturalWidth}×${sourceImage.naturalHeight}`
      : `${outRect.width}×${outRect.height} px · Rotazione ${history.present.rotation}° · Filtro ${presetLabel}`;

    syncCropBoxGeometry();
    updateToolbarState();
  };

  const renderControlsPanel = () => {
    panelBody.textContent = '';
    adjustTabBtn.classList.toggle('active', activeTab === 'adjust');
    filterTabBtn.classList.toggle('active', activeTab === 'filters');
    transformTabBtn.classList.toggle('active', activeTab === 'transform');

    const cur = history.present;

    if (activeTab === 'adjust') {
      const slidersGrid = el('div', 'editor-sliders-grid');
      const defs: Array<{
        key: 'brightness' | 'contrast' | 'saturation' | 'warmth';
        label: string;
        id: string;
      }> = [
        { key: 'brightness', label: 'Luminosità', id: 'editor-slider-brightness' },
        { key: 'contrast', label: 'Contrasto', id: 'editor-slider-contrast' },
        { key: 'saturation', label: 'Saturazione', id: 'editor-slider-saturation' },
        { key: 'warmth', label: 'Calore', id: 'editor-slider-warmth' },
      ];

      for (const def of defs) {
        const row = el('div', 'editor-slider-row');
        const head = el('div', 'editor-slider-head');
        head.appendChild(el('label', 'form-label', def.label));
        const valSpan = el(
          'span',
          'mono-nums editor-slider-val',
          cur[def.key] > 0 ? `+${cur[def.key]}` : String(cur[def.key])
        );
        head.appendChild(valSpan);
        row.appendChild(head);

        let beforeDragState: PhotoEditState | null = null;
        const input = el('input', 'editor-range-input');
        input.type = 'range';
        input.id = def.id;
        input.min = '-100';
        input.max = '100';
        input.step = '1';
        input.value = String(cur[def.key]);
        input.addEventListener('pointerdown', () => {
          beforeDragState = { ...history.present, cropBox: { ...history.present.cropBox } };
        });
        input.addEventListener('input', () => {
          const v = Number(input.value);
          valSpan.textContent = v > 0 ? `+${v}` : String(v);
          replacePresent({ ...history.present, [def.key]: v });
          renderPreview();
        });
        input.addEventListener('change', () => {
          const v = Number(input.value);
          if (beforeDragState) {
            const finalState = { ...history.present, [def.key]: v };
            replacePresent(beforeDragState);
            commitState(finalState);
            beforeDragState = null;
          } else {
            commitState({ ...history.present, [def.key]: v });
          }
          updateToolbarState();
        });
        row.appendChild(input);
        slidersGrid.appendChild(row);
      }
      panelBody.appendChild(slidersGrid);
    } else if (activeTab === 'filters') {
      const presetRow = el('div', 'editor-presets-row');
      for (const presetId of FILTER_PRESET_IDS) {
        const preset = PHOTO_FILTER_PRESETS[presetId];
        const btn = el(
          'button',
          `editor-preset-btn ${cur.filterPreset === presetId ? 'active' : ''}`,
          preset.label
        );
        btn.id = `editor-filter-${presetId}`;
        btn.addEventListener('click', () => {
          commitState(applyPresetToEditState(history.present, presetId));
          renderControlsPanel();
          renderPreview();
        });
        presetRow.appendChild(btn);
      }
      panelBody.appendChild(presetRow);
    } else {
      const transformWrap = el('div', 'editor-transform-wrap');
      const geoRow = el('div', 'editor-action-strip');

      const rotLeftBtn = el('button', 'btn', '↺ Ruota -90°');
      rotLeftBtn.id = 'btn-editor-rotate-left';
      rotLeftBtn.addEventListener('click', () => {
        commitState({
          ...history.present,
          rotation: normalizeRotation(history.present.rotation - 90),
        });
        renderPreview();
      });

      const rotRightBtn = el('button', 'btn', '↻ Ruota +90°');
      rotRightBtn.id = 'btn-editor-rotate-right';
      rotRightBtn.addEventListener('click', () => {
        commitState({
          ...history.present,
          rotation: normalizeRotation(history.present.rotation + 90),
        });
        renderPreview();
      });

      const flipHBtn = el('button', `btn ${cur.flipH ? 'active-toggle' : ''}`, '⇄ Capovolgi H');
      flipHBtn.id = 'btn-editor-flip-h';
      flipHBtn.addEventListener('click', () => {
        commitState({ ...history.present, flipH: !history.present.flipH });
        renderControlsPanel();
        renderPreview();
      });

      const flipVBtn = el('button', `btn ${cur.flipV ? 'active-toggle' : ''}`, '⇅ Capovolgi V');
      flipVBtn.id = 'btn-editor-flip-v';
      flipVBtn.addEventListener('click', () => {
        commitState({ ...history.present, flipV: !history.present.flipV });
        renderControlsPanel();
        renderPreview();
      });

      geoRow.append(rotLeftBtn, rotRightBtn, flipHBtn, flipVBtn);
      transformWrap.appendChild(geoRow);

      const aspectRow = el('div', 'editor-action-strip');
      aspectRow.appendChild(el('span', 'media-card-meta', 'Proporzioni ritaglio:'));
      for (const ratio of CROP_ASPECT_OPTIONS) {
        const aBtn = el(
          'button',
          `editor-preset-btn ${cur.cropAspect === ratio.id ? 'active' : ''}`,
          ratio.label
        );
        aBtn.id = `editor-aspect-${ratio.id}`;
        aBtn.addEventListener('click', () => {
          if (!sourceImage) return;
          const rotDims = getRotatedDimensions(
            sourceImage.naturalWidth,
            sourceImage.naturalHeight,
            history.present.rotation
          );
          const nextBox = fitAspectNormalizedCropBox(rotDims.w, rotDims.h, ratio.id);
          commitState({
            ...history.present,
            cropAspect: ratio.id,
            cropBox: nextBox,
          });
          renderControlsPanel();
          renderPreview();
        });
        aspectRow.appendChild(aBtn);
      }
      transformWrap.appendChild(aspectRow);
      panelBody.appendChild(transformWrap);
    }
  };

  // Interactive crop drag handling
  let dragState: {
    handle: CropDragHandle;
    startX: number;
    startY: number;
    startBox: NormalizedCropBox;
    rectW: number;
    rectH: number;
  } | null = null;

  cropBox.addEventListener('pointerdown', (ev) => {
    if (!sourceImage || activeTab !== 'transform') return;
    const target = ev.target as HTMLElement;
    const handle = (target.dataset.handle as CropDragHandle | undefined) ?? 'move';
    const overlayRect = cropOverlay.getBoundingClientRect();
    if (overlayRect.width <= 0 || overlayRect.height <= 0) return;
    ev.preventDefault();
    cropBox.setPointerCapture(ev.pointerId);
    dragState = {
      handle,
      startX: ev.clientX,
      startY: ev.clientY,
      startBox: { ...history.present.cropBox },
      rectW: overlayRect.width,
      rectH: overlayRect.height,
    };
  });

  cropBox.addEventListener('pointermove', (ev) => {
    if (!dragState || !sourceImage) return;
    const dx = (ev.clientX - dragState.startX) / dragState.rectW;
    const dy = (ev.clientY - dragState.startY) / dragState.rectH;
    const rotDims = getRotatedDimensions(
      sourceImage.naturalWidth,
      sourceImage.naturalHeight,
      history.present.rotation
    );
    const nextBox = dragNormalizedCropHandle(
      dragState.startBox,
      dragState.handle,
      dx,
      dy,
      history.present.cropAspect,
      rotDims.w,
      rotDims.h
    );
    replacePresent({ ...history.present, cropBox: nextBox });
    syncCropBoxGeometry();
  });

  cropBox.addEventListener('pointerup', (ev) => {
    if (!dragState) return;
    try {
      cropBox.releasePointerCapture(ev.pointerId);
    } catch {
      // ignore
    }
    const finalBox = { ...history.present.cropBox };
    replacePresent({ ...history.present, cropBox: dragState.startBox });
    commitState({ ...history.present, cropBox: finalBox });
    dragState = null;
    renderPreview();
  });

  // Tab bindings
  adjustTabBtn.addEventListener('click', () => {
    activeTab = 'adjust';
    renderControlsPanel();
    renderPreview();
  });
  filterTabBtn.addEventListener('click', () => {
    activeTab = 'filters';
    renderControlsPanel();
    renderPreview();
  });
  transformTabBtn.addEventListener('click', () => {
    activeTab = 'transform';
    renderControlsPanel();
    renderPreview();
  });

  // Topbar actions
  cancelBtn.addEventListener('click', () => {
    cleanup();
    callbacks.onClose();
  });
  undoBtn.addEventListener('click', () => {
    history = undoEditSnapshot(history);
    renderControlsPanel();
    renderPreview();
  });
  redoBtn.addEventListener('click', () => {
    history = redoEditSnapshot(history);
    renderControlsPanel();
    renderPreview();
  });
  resetBtn.addEventListener('click', () => {
    commitState({
      ...DEFAULT_PHOTO_EDIT_STATE,
      cropBox: { ...DEFAULT_NORMALIZED_CROP_BOX },
    });
    renderControlsPanel();
    renderPreview();
  });
  compareBtn.addEventListener('click', () => {
    comparingOriginal = !comparingOriginal;
    renderPreview();
  });

  const executeSave = async (mode: 'copy' | 'overwrite') => {
    if (!sourceImage || saving) return;
    saving = true;
    updateToolbarState();
    statusFooter.textContent = 'Rendering pixel reali, rigenerazione miniature e cifratura AES-256-GCM...';
    try {
      const finalCanvas = renderEditedPhotoToCanvas(
        sourceImage,
        sourceImage.naturalWidth,
        sourceImage.naturalHeight,
        history.present,
        { applyCrop: true }
      );
      const outMime = item.meta.mime === 'image/png' ? 'image/png' : 'image/jpeg';
      const outBytes = await canvasToBytes(finalCanvas, outMime, 0.91);
      const thumbs = await generateCanvasThumbs(finalCanvas);

      if (mode === 'overwrite') {
        const updated = await client.replaceItemWithEditedBlob(
          item.id,
          outBytes,
          {
            name: item.meta.name,
            mime: outMime,
            width: finalCanvas.width,
            height: finalCanvas.height,
          },
          item.version,
          thumbs
        );
        cleanup();
        callbacks.onSavedOverwrite(updated);
      } else {
        const dotIdx = item.meta.name.lastIndexOf('.');
        const base = dotIdx > 0 ? item.meta.name.slice(0, dotIdx) : item.meta.name;
        const ext = outMime === 'image/png' ? '.png' : '.jpg';
        const copyName = `${base}_modificata${ext}`;
        await client.uploadFile({
          name: copyName,
          mimeType: outMime,
          size: outBytes.byteLength,
          source: outBytes,
          takenAt: item.meta.takenAt,
          width: finalCanvas.width,
          height: finalCanvas.height,
          thumb320Plaintext: thumbs.thumb320,
          thumb1280Plaintext: thumbs.thumb1280,
        });
        await client.syncItems('all');
        cleanup();
        callbacks.onSavedCopy(copyName);
      }
    } catch (err) {
      saving = false;
      updateToolbarState();
      const msg = err instanceof Error ? err.message : 'Errore durante il salvataggio cifrato.';
      statusFooter.textContent = msg;
      callbacks.onError(msg);
    }
  };

  saveCopyBtn.addEventListener('click', () => void executeSave('copy'));
  saveOverwriteBtn.addEventListener('click', () => void executeSave('overwrite'));

  // Decrypt image bytes and decode into HTMLImageElement
  client
    .downloadBlobToBytes(item.blobId)
    .then((plainBytes) => {
      const blob = new Blob([plainBytes as unknown as BlobPart], { type: item.meta.mime });
      sourceObjectUrl = URL.createObjectURL(blob);
      const img = new Image();
      img.onload = () => {
        sourceImage = img;
        loadingLabel.classList.add('hidden');
        canvasWrap.classList.remove('hidden');
        renderControlsPanel();
        renderPreview();
      };
      img.onerror = () => {
        loadingLabel.textContent = 'Impossibile decodificare questa immagine nel browser.';
      };
      img.src = sourceObjectUrl;
    })
    .catch((err) => {
      loadingLabel.textContent =
        err instanceof Error ? err.message : 'Errore decifratura immagine originale.';
    });

  renderControlsPanel();
  updateToolbarState();

  return cleanup;
}
