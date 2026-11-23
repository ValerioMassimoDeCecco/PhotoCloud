export type CropAspectRatio =
  | 'free'
  | 'original'
  | '1:1'
  | '4:3'
  | '3:4'
  | '4:5'
  | '16:9'
  | '9:16';

export type CropDragHandle =
  | 'nw'
  | 'n'
  | 'ne'
  | 'e'
  | 'se'
  | 's'
  | 'sw'
  | 'w'
  | 'move';

export type PhotoFilterPresetId =
  | 'original'
  | 'vivid'
  | 'bw'
  | 'sepia'
  | 'cinema'
  | 'cool'
  | 'vintage';

export interface NormalizedCropBox {
  left: number; // 0..1
  top: number; // 0..1
  right: number; // 0..1
  bottom: number; // 0..1
}

export interface PhotoEditState {
  brightness: number; // -100 to +100
  contrast: number; // -100 to +100
  saturation: number; // -100 to +100
  warmth: number; // -100 to +100
  rotation: number; // 0, 90, 180, 270
  flipH: boolean;
  flipV: boolean;
  cropAspect: CropAspectRatio;
  cropBox: NormalizedCropBox;
  filterPreset: PhotoFilterPresetId;
}

export interface CropRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export const DEFAULT_NORMALIZED_CROP_BOX: NormalizedCropBox = {
  left: 0,
  top: 0,
  right: 1,
  bottom: 1,
};

export const DEFAULT_PHOTO_EDIT_STATE: PhotoEditState = {
  brightness: 0,
  contrast: 0,
  saturation: 0,
  warmth: 0,
  rotation: 0,
  flipH: false,
  flipV: false,
  cropAspect: 'free',
  cropBox: { ...DEFAULT_NORMALIZED_CROP_BOX },
  filterPreset: 'original',
};

export const PHOTO_FILTER_PRESETS: Record<
  PhotoFilterPresetId,
  {
    label: string;
    brightness: number;
    contrast: number;
    saturation: number;
    warmth: number;
  }
> = {
  original: {
    label: 'Originale',
    brightness: 0,
    contrast: 0,
    saturation: 0,
    warmth: 0,
  },
  vivid: {
    label: 'Vivido',
    brightness: 4,
    contrast: 18,
    saturation: 32,
    warmth: 8,
  },
  bw: {
    label: 'Bianco & Nero',
    brightness: 2,
    contrast: 22,
    saturation: -100,
    warmth: 0,
  },
  sepia: {
    label: 'Seppia',
    brightness: 4,
    contrast: 10,
    saturation: -35,
    warmth: 48,
  },
  cinema: {
    label: 'Cinema',
    brightness: -4,
    contrast: 24,
    saturation: -12,
    warmth: -14,
  },
  cool: {
    label: 'Freddo',
    brightness: 2,
    contrast: 10,
    saturation: 8,
    warmth: -34,
  },
  vintage: {
    label: 'Vintage',
    brightness: 6,
    contrast: -10,
    saturation: -24,
    warmth: 30,
  },
};

export function applyPresetToEditState(
  current: PhotoEditState,
  presetId: PhotoFilterPresetId
): PhotoEditState {
  const preset = PHOTO_FILTER_PRESETS[presetId] || PHOTO_FILTER_PRESETS.original;
  return {
    ...current,
    filterPreset: presetId,
    brightness: preset.brightness,
    contrast: preset.contrast,
    saturation: preset.saturation,
    warmth: preset.warmth,
  };
}

export function normalizeRotation(deg: number): number {
  const mod = ((deg % 360) + 360) % 360;
  if (mod === 90 || mod === 180 || mod === 270) return mod;
  return 0;
}

export function clampNormalizedCropBox(
  box: NormalizedCropBox,
  minSpan = 0.08
): NormalizedCropBox {
  const span = Math.max(0.02, Math.min(0.5, minSpan));
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

export function isFullNormalizedCropBox(box: NormalizedCropBox, eps = 0.002): boolean {
  return (
    box.left <= eps &&
    box.top <= eps &&
    box.right >= 1 - eps &&
    box.bottom >= 1 - eps
  );
}

export function resolveAspectPixelRatio(
  aspect: CropAspectRatio,
  srcWidth: number,
  srcHeight: number
): number | null {
  if (aspect === 'free') return null;
  const w = Math.max(1, Number.isFinite(srcWidth) ? srcWidth : 1);
  const h = Math.max(1, Number.isFinite(srcHeight) ? srcHeight : 1);
  if (aspect === 'original') return w / h;
  const ratioMap: Record<Exclude<CropAspectRatio, 'free' | 'original'>, number> = {
    '1:1': 1,
    '4:3': 4 / 3,
    '3:4': 3 / 4,
    '4:5': 4 / 5,
    '16:9': 16 / 9,
    '9:16': 9 / 16,
  };
  return ratioMap[aspect] ?? null;
}

export function fitAspectNormalizedCropBox(
  srcWidth: number,
  srcHeight: number,
  aspect: CropAspectRatio
): NormalizedCropBox {
  const rect = computeCropRect(srcWidth, srcHeight, aspect);
  const w = Math.max(1, srcWidth);
  const h = Math.max(1, srcHeight);
  return clampNormalizedCropBox({
    left: rect.x / w,
    top: rect.y / h,
    right: (rect.x + rect.width) / w,
    bottom: (rect.y + rect.height) / h,
  });
}

export function dragNormalizedCropHandle(
  startBox: NormalizedCropBox,
  handle: CropDragHandle,
  dxNorm: number,
  dyNorm: number,
  aspect: CropAspectRatio = 'free',
  srcWidth = 1000,
  srcHeight = 1000,
  minSpan = 0.08
): NormalizedCropBox {
  const span = Math.max(0.04, Math.min(0.5, minSpan));
  const safeStart = clampNormalizedCropBox(startBox, span);

  if (handle === 'move') {
    const clampedDx = Math.max(-safeStart.left, Math.min(1 - safeStart.right, dxNorm));
    const clampedDy = Math.max(-safeStart.top, Math.min(1 - safeStart.bottom, dyNorm));
    return {
      left: safeStart.left + clampedDx,
      top: safeStart.top + clampedDy,
      right: safeStart.right + clampedDx,
      bottom: safeStart.bottom + clampedDy,
    };
  }

  const targetPixelRatio = resolveAspectPixelRatio(aspect, srcWidth, srcHeight);

  if (targetPixelRatio === null) {
    let { left, top, right, bottom } = safeStart;
    if (handle.includes('w')) {
      left = Math.max(0, Math.min(right - span, safeStart.left + dxNorm));
    }
    if (handle.includes('e')) {
      right = Math.min(1, Math.max(left + span, safeStart.right + dxNorm));
    }
    if (handle.includes('n')) {
      top = Math.max(0, Math.min(bottom - span, safeStart.top + dyNorm));
    }
    if (handle.includes('s')) {
      bottom = Math.min(1, Math.max(top + span, safeStart.bottom + dyNorm));
    }
    return clampNormalizedCropBox({ left, top, right, bottom }, span);
  }

  const imgRatio = Math.max(1, srcWidth) / Math.max(1, srcHeight);
  // Normalized width / normalized height = targetPixelRatio / imgRatio
  const normRatio = targetPixelRatio / imgRatio;

  // Vertical edge drags (N / S): pin opposite horizontal edge, expand/shrink symmetrically on X
  if (handle === 'n' || handle === 's') {
    const centerX = (safeStart.left + safeStart.right) / 2;
    const availH = handle === 'n' ? safeStart.bottom : 1 - safeStart.top;
    const maxH = Math.min(availH, 1 / normRatio);
    const minH = Math.min(maxH, Math.max(span, span / normRatio));
    const rawH =
      handle === 'n'
        ? safeStart.bottom - (safeStart.top + dyNorm)
        : safeStart.bottom + dyNorm - safeStart.top;
    const h = Math.max(minH, Math.min(maxH, rawH));
    const w = Math.min(1, h * normRatio);
    const left = Math.max(0, Math.min(1 - w, centerX - w / 2));
    const right = left + w;
    const top = handle === 'n' ? safeStart.bottom - h : safeStart.top;
    const bottom = handle === 'n' ? safeStart.bottom : safeStart.top + h;
    return { left, top, right, bottom };
  }

  // Horizontal edge drags (W / E): pin opposite vertical edge, expand/shrink symmetrically on Y
  if (handle === 'w' || handle === 'e') {
    const centerY = (safeStart.top + safeStart.bottom) / 2;
    const availW = handle === 'w' ? safeStart.right : 1 - safeStart.left;
    const maxW = Math.min(availW, normRatio);
    const minW = Math.min(maxW, Math.max(span, span * normRatio));
    const rawW =
      handle === 'w'
        ? safeStart.right - (safeStart.left + dxNorm)
        : safeStart.right + dxNorm - safeStart.left;
    const w = Math.max(minW, Math.min(maxW, rawW));
    const h = Math.min(1, w / normRatio);
    const top = Math.max(0, Math.min(1 - h, centerY - h / 2));
    const bottom = top + h;
    const left = handle === 'w' ? safeStart.right - w : safeStart.left;
    const right = handle === 'w' ? safeStart.right : safeStart.left + w;
    return { left, top, right, bottom };
  }

  // Corner drags (NW, NE, SW, SE): strictly pin opposite corner anchor
  const anchorLeft = handle.includes('e');
  const anchorTop = handle.includes('s');
  const anchorX = anchorLeft ? safeStart.left : safeStart.right;
  const anchorY = anchorTop ? safeStart.top : safeStart.bottom;
  const availW = anchorLeft ? 1 - anchorX : anchorX;
  const availH = anchorTop ? 1 - anchorY : anchorY;

  const maxW = Math.min(availW, availH * normRatio);
  const minW = Math.min(maxW, Math.max(span, span * normRatio));

  const candWFromX = anchorLeft
    ? safeStart.right + dxNorm - anchorX
    : anchorX - (safeStart.left + dxNorm);
  const candHFromY = anchorTop
    ? safeStart.bottom + dyNorm - anchorY
    : anchorY - (safeStart.top + dyNorm);
  const candWFromY = candHFromY * normRatio;

  const startW = safeStart.right - safeStart.left;
  const deltaWX = Math.abs(candWFromX - startW);
  const deltaWY = Math.abs(candWFromY - startW);
  const chosenW = deltaWX >= deltaWY ? candWFromX : candWFromY;

  const w = Math.max(minW, Math.min(maxW, chosenW));
  const h = w / normRatio;

  const left = anchorLeft ? anchorX : anchorX - w;
  const right = anchorLeft ? anchorX + w : anchorX;
  const top = anchorTop ? anchorY : anchorY - h;
  const bottom = anchorTop ? anchorY + h : anchorY;

  return { left, top, right, bottom };
}

export function normalizedBoxToPixelRect(
  srcWidth: number,
  srcHeight: number,
  box: NormalizedCropBox
): CropRect {
  const w = Math.max(1, Math.floor(srcWidth));
  const h = Math.max(1, Math.floor(srcHeight));
  const safe = clampNormalizedCropBox(box, 0.02);
  const x = Math.max(0, Math.min(w - 1, Math.round(safe.left * w)));
  const y = Math.max(0, Math.min(h - 1, Math.round(safe.top * h)));
  const width = Math.max(1, Math.min(w - x, Math.round((safe.right - safe.left) * w)));
  const height = Math.max(1, Math.min(h - y, Math.round((safe.bottom - safe.top) * h)));
  return { x, y, width, height };
}

export function computeCropRect(
  srcWidth: number,
  srcHeight: number,
  aspect: CropAspectRatio
): CropRect {
  const w = Math.max(1, Math.floor(srcWidth));
  const h = Math.max(1, Math.floor(srcHeight));
  const targetRatio = resolveAspectPixelRatio(aspect, w, h);
  if (targetRatio === null || aspect === 'original') {
    return { x: 0, y: 0, width: w, height: h };
  }

  const currentRatio = w / h;

  let cropW = w;
  let cropH = h;

  if (currentRatio > targetRatio) {
    cropW = Math.max(1, Math.round(h * targetRatio));
  } else {
    cropH = Math.max(1, Math.round(w / targetRatio));
  }

  const x = Math.max(0, Math.floor((w - cropW) / 2));
  const y = Math.max(0, Math.floor((h - cropH) / 2));
  return { x, y, width: cropW, height: cropH };
}

export function clampByte(val: number): number {
  return Math.max(0, Math.min(255, Math.round(val)));
}

export function transformRgbPixel(
  r: number,
  g: number,
  b: number,
  state: Pick<PhotoEditState, 'brightness' | 'contrast' | 'saturation' | 'warmth'>
): [number, number, number] {
  // 1. Brightness (-100..+100 -> -100..+100 offset)
  const bOffset = (state.brightness / 100) * 90;
  let nr = r + bOffset;
  let ng = g + bOffset;
  let nb = b + bOffset;

  // 2. Contrast (-100..+100)
  const cFactor = Math.pow((state.contrast + 100) / 100, 2);
  nr = (nr - 128) * cFactor + 128;
  ng = (ng - 128) * cFactor + 128;
  nb = (nb - 128) * cFactor + 128;

  // 3. Saturation (-100..+100)
  const sFactor = (state.saturation + 100) / 100;
  const luma = 0.299 * nr + 0.587 * ng + 0.114 * nb;
  nr = luma + (nr - luma) * sFactor;
  ng = luma + (ng - luma) * sFactor;
  nb = luma + (nb - luma) * sFactor;

  // 4. Warmth (-100..+100 -> R+/B- for warm, R-/B+ for cool)
  const wShift = (state.warmth / 100) * 42;
  nr += wShift;
  ng += wShift * 0.18;
  nb -= wShift;

  return [clampByte(nr), clampByte(ng), clampByte(nb)];
}

export interface VideoTrimRange {
  trimStartSec: number;
  trimEndSec: number;
  trimmedDurationSec: number;
}

export interface VideoEditState extends PhotoEditState {
  trimStartSec: number;
  trimEndSec: number;
  durationSec: number;
  muted: boolean;
  volume: number; // 0..1
  playbackRate: number; // 0.5..2.0
}

export const DEFAULT_VIDEO_EDIT_STATE: VideoEditState = {
  ...DEFAULT_PHOTO_EDIT_STATE,
  trimStartSec: 0,
  trimEndSec: 0,
  durationSec: 0,
  muted: false,
  volume: 1,
  playbackRate: 1,
};

export function clampTrimRange(
  startSec: number,
  endSec: number,
  durationSec: number,
  minClipSec = 0.25
): VideoTrimRange {
  const safeDuration = Number.isFinite(durationSec) && durationSec > 0 ? durationSec : 0;
  if (safeDuration <= 0) {
    return { trimStartSec: 0, trimEndSec: 0, trimmedDurationSec: 0 };
  }
  const minSpan = Math.min(safeDuration, Math.max(0.05, minClipSec));
  let start = Number.isFinite(startSec) ? Math.max(0, Math.min(safeDuration - minSpan, startSec)) : 0;
  let end = Number.isFinite(endSec) ? Math.max(start + minSpan, Math.min(safeDuration, endSec)) : safeDuration;
  if (end - start < minSpan) {
    if (start + minSpan <= safeDuration) {
      end = start + minSpan;
    } else {
      start = Math.max(0, end - minSpan);
    }
  }
  const trimmedDurationSec = Math.max(0, Number((end - start).toFixed(3)));
  return {
    trimStartSec: Number(start.toFixed(3)),
    trimEndSec: Number(end.toFixed(3)),
    trimmedDurationSec,
  };
}

export function formatMediaDuration(seconds: number, withTenths = false): string {
  const safe = Number.isFinite(seconds) && seconds > 0 ? seconds : 0;
  const hrs = Math.floor(safe / 3600);
  const mins = Math.floor((safe % 3600) / 60);
  const secsFloat = safe % 60;
  const secs = Math.floor(secsFloat);
  const tenths = Math.min(9, Math.floor((secsFloat - secs) * 10));

  const mm = String(mins).padStart(2, '0');
  const ss = String(secs).padStart(2, '0');
  const suffix = withTenths ? `.${tenths}` : '';
  if (hrs > 0) {
    return `${hrs}:${mm}:${ss}${suffix}`;
  }
  return `${mm}:${ss}${suffix}`;
}

export function buildCssFilterString(
  state: Pick<PhotoEditState, 'brightness' | 'contrast' | 'saturation' | 'warmth'>
): string {
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
  const parts: string[] = [
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

export interface ZoomPanState {
  scale: number;
  panX: number;
  panY: number;
}

export interface MediaDimensions {
  width: number;
  height: number;
}

export function computeFittedMediaSize(
  viewportWidth: number,
  viewportHeight: number,
  mediaWidth?: number,
  mediaHeight?: number
): MediaDimensions {
  const vw = Math.max(0, Number.isFinite(viewportWidth) ? viewportWidth : 0);
  const vh = Math.max(0, Number.isFinite(viewportHeight) ? viewportHeight : 0);
  if (
    !mediaWidth ||
    !mediaHeight ||
    !Number.isFinite(mediaWidth) ||
    !Number.isFinite(mediaHeight) ||
    mediaWidth <= 0 ||
    mediaHeight <= 0 ||
    vw <= 0 ||
    vh <= 0
  ) {
    return { width: vw, height: vh };
  }
  const fitRatio = Math.min(vw / mediaWidth, vh / mediaHeight);
  return {
    width: mediaWidth * fitRatio,
    height: mediaHeight * fitRatio,
  };
}

export function clampZoomPan(
  scale: number,
  panX: number,
  panY: number,
  viewportWidth: number,
  viewportHeight: number,
  minScale = 1,
  maxScale = 5,
  mediaWidth?: number,
  mediaHeight?: number
): ZoomPanState {
  const safeScale = Number.isFinite(scale)
    ? Math.max(minScale, Math.min(maxScale, scale))
    : minScale;
  if (safeScale <= 1.005) {
    return { scale: 1, panX: 0, panY: 0 };
  }
  const vw = Math.max(0, Number.isFinite(viewportWidth) ? viewportWidth : 0);
  const vh = Math.max(0, Number.isFinite(viewportHeight) ? viewportHeight : 0);
  const fitted = computeFittedMediaSize(vw, vh, mediaWidth, mediaHeight);
  const maxX = Math.max(0, (fitted.width * safeScale - vw) / 2);
  const maxY = Math.max(0, (fitted.height * safeScale - vh) / 2);
  return {
    scale: Number(safeScale.toFixed(6)),
    panX: Math.max(-maxX, Math.min(maxX, Number.isFinite(panX) ? panX : 0)),
    panY: Math.max(-maxY, Math.min(maxY, Number.isFinite(panY) ? panY : 0)),
  };
}

export interface PinchZoomStepInput {
  currentScale: number;
  currentPanX: number;
  currentPanY: number;
  prevMidX: number;
  prevMidY: number;
  currMidX: number;
  currMidY: number;
  prevDist: number;
  currDist: number;
  centerX: number;
  centerY: number;
  viewportWidth: number;
  viewportHeight: number;
  mediaWidth?: number;
  mediaHeight?: number;
  minScale?: number;
  maxScale?: number;
}

/**
 * Computes exact focal-point locked (scale, panX, panY) for multi-touch pinch-to-zoom.
 * Keeps the image pixel initially under prevMid pinned directly under currMid with zero drift or lag.
 */
export function computePinchZoomPan(input: PinchZoomStepInput): ZoomPanState {
  const minScale = input.minScale ?? 1;
  const maxScale = input.maxScale ?? 5;
  const safePrevScale = Math.max(
    minScale,
    Math.min(maxScale, Number.isFinite(input.currentScale) ? input.currentScale : 1)
  );
  const safePrevDist = Number.isFinite(input.prevDist) && input.prevDist > 1 ? input.prevDist : 1;
  const safeCurrDist = Number.isFinite(input.currDist) && input.currDist > 1 ? input.currDist : safePrevDist;
  const zoomDelta = safeCurrDist / safePrevDist;
  const targetScale = Math.max(minScale, Math.min(maxScale, safePrevScale * zoomDelta));
  const actualRatio = targetScale / safePrevScale;

  const panDeltaX = input.currMidX - input.prevMidX;
  const panDeltaY = input.currMidY - input.prevMidY;
  const centerRelX = input.prevMidX - input.centerX;
  const centerRelY = input.prevMidY - input.centerY;

  const rawPanX = input.currentPanX * actualRatio + panDeltaX - centerRelX * (actualRatio - 1);
  const rawPanY = input.currentPanY * actualRatio + panDeltaY - centerRelY * (actualRatio - 1);

  return clampZoomPan(
    targetScale,
    rawPanX,
    rawPanY,
    input.viewportWidth,
    input.viewportHeight,
    minScale,
    maxScale,
    input.mediaWidth,
    input.mediaHeight
  );
}

export interface EditHistoryStack<T> {
  past: T[];
  present: T;
  future: T[];
}

export function createEditHistory<T>(initial: T): EditHistoryStack<T> {
  return { past: [], present: initial, future: [] };
}

export function pushEditSnapshot<T>(
  history: EditHistoryStack<T>,
  next: T,
  maxEntries = 30
): EditHistoryStack<T> {
  const nextPast = [...history.past, history.present];
  if (nextPast.length > maxEntries) {
    nextPast.splice(0, nextPast.length - maxEntries);
  }
  return {
    past: nextPast,
    present: next,
    future: [],
  };
}

export function undoEditSnapshot<T>(history: EditHistoryStack<T>): EditHistoryStack<T> {
  if (history.past.length === 0) return history;
  const previous = history.past[history.past.length - 1];
  return {
    past: history.past.slice(0, -1),
    present: previous,
    future: [history.present, ...history.future],
  };
}

export function redoEditSnapshot<T>(history: EditHistoryStack<T>): EditHistoryStack<T> {
  if (history.future.length === 0) return history;
  const next = history.future[0];
  return {
    past: [...history.past, history.present],
    present: next,
    future: history.future.slice(1),
  };
}

