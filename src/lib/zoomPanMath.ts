import {
  clampZoomPan,
  computePinchZoomPan,
  type ZoomPanState,
} from './photoEditorMath.ts';

export const ZOOM_MIN_SCALE = 1;
export const ZOOM_MAX_SCALE = 5;
export const ZOOM_DOUBLE_TAP_SCALE = 2.5;
export const ZOOM_RESET_EPSILON = 1.02;

export interface ZoomViewportMetrics {
  viewportWidth: number;
  viewportHeight: number;
  mediaWidth?: number;
  mediaHeight?: number;
}

export function createInitialZoomPan(): ZoomPanState {
  return { scale: 1, panX: 0, panY: 0 };
}

export function isZoomedIn(state: ZoomPanState): boolean {
  return Number.isFinite(state.scale) && state.scale > ZOOM_RESET_EPSILON;
}

export function clampScale(
  scale: number,
  minScale = ZOOM_MIN_SCALE,
  maxScale = ZOOM_MAX_SCALE
): number {
  if (!Number.isFinite(scale)) return minScale;
  return Math.max(minScale, Math.min(maxScale, scale));
}

/**
 * Applies a focal-point-locked zoom factor around (focalRelX, focalRelY) measured relative
 * to the viewport center, plus an optional pan delta (dx, dy).
 */
export function applyFocalZoom(
  current: ZoomPanState,
  targetScaleRaw: number,
  focalRelX: number,
  focalRelY: number,
  metrics: ZoomViewportMetrics,
  panDeltaX = 0,
  panDeltaY = 0,
  minScale = ZOOM_MIN_SCALE,
  maxScale = ZOOM_MAX_SCALE
): ZoomPanState {
  const safePrevScale = clampScale(current.scale, minScale, maxScale);
  const targetScale = clampScale(targetScaleRaw, minScale, maxScale);
  const ratio = targetScale / safePrevScale;

  const rawPanX = current.panX * ratio + panDeltaX - focalRelX * (ratio - 1);
  const rawPanY = current.panY * ratio + panDeltaY - focalRelY * (ratio - 1);

  return clampZoomPan(
    targetScale,
    rawPanX,
    rawPanY,
    metrics.viewportWidth,
    metrics.viewportHeight,
    minScale,
    maxScale,
    metrics.mediaWidth,
    metrics.mediaHeight
  );
}

/**
 * Simple intuitive single-finger / mouse-drag pan when zoomed in.
 */
export function applyPanDelta(
  current: ZoomPanState,
  dx: number,
  dy: number,
  metrics: ZoomViewportMetrics,
  minScale = ZOOM_MIN_SCALE,
  maxScale = ZOOM_MAX_SCALE
): ZoomPanState {
  if (!isZoomedIn(current)) {
    return createInitialZoomPan();
  }
  return clampZoomPan(
    current.scale,
    current.panX + dx,
    current.panY + dy,
    metrics.viewportWidth,
    metrics.viewportHeight,
    minScale,
    maxScale,
    metrics.mediaWidth,
    metrics.mediaHeight
  );
}

/**
 * Intuitive double-tap / double-click zoom:
 * - At 1x -> smoothly zooms to targetScale (2.5x) centered on the tapped point.
 * - When already zoomed -> smoothly resets back to 1x centered.
 */
export function toggleDoubleTapZoom(
  current: ZoomPanState,
  tapRelX: number,
  tapRelY: number,
  metrics: ZoomViewportMetrics,
  targetScale = ZOOM_DOUBLE_TAP_SCALE
): ZoomPanState {
  if (isZoomedIn(current)) {
    return createInitialZoomPan();
  }
  return applyFocalZoom(current, targetScale, tapRelX, tapRelY, metrics);
}

/**
 * Smooth mouse wheel / trackpad pinch zoom around pointer coordinates relative to viewport center.
 */
export function applyWheelZoom(
  current: ZoomPanState,
  deltaY: number,
  pointerRelX: number,
  pointerRelY: number,
  metrics: ZoomViewportMetrics,
  isPinchGesture = false
): ZoomPanState {
  if (!Number.isFinite(deltaY) || deltaY === 0) return current;
  const clampedDelta = Math.max(-180, Math.min(180, deltaY));
  const sensitivity = isPinchGesture ? 0.0085 : 0.0022;
  const factor = Math.exp(-clampedDelta * sensitivity);
  return applyFocalZoom(
    current,
    current.scale * factor,
    pointerRelX,
    pointerRelY,
    metrics
  );
}

/**
 * Step zoom for +/- buttons or keyboard shortcuts around viewport center.
 */
export function stepButtonZoom(
  current: ZoomPanState,
  direction: 'in' | 'out',
  metrics: ZoomViewportMetrics,
  stepRatio = 1.45
): ZoomPanState {
  const nextScale =
    direction === 'in'
      ? current.scale * stepRatio
      : current.scale / stepRatio;
  if (nextScale <= ZOOM_RESET_EPSILON) {
    return createInitialZoomPan();
  }
  return applyFocalZoom(current, nextScale, 0, 0, metrics);
}

/**
 * Two-finger pinch gesture step helper wrapping focal-point pinch math.
 */
export function applyTwoFingerPinch(
  current: ZoomPanState,
  prevMidX: number,
  prevMidY: number,
  currMidX: number,
  currMidY: number,
  prevDist: number,
  currDist: number,
  centerX: number,
  centerY: number,
  metrics: ZoomViewportMetrics
): ZoomPanState {
  return computePinchZoomPan({
    currentScale: current.scale,
    currentPanX: current.panX,
    currentPanY: current.panY,
    prevMidX,
    prevMidY,
    currMidX,
    currMidY,
    prevDist,
    currDist,
    centerX,
    centerY,
    viewportWidth: metrics.viewportWidth,
    viewportHeight: metrics.viewportHeight,
    mediaWidth: metrics.mediaWidth,
    mediaHeight: metrics.mediaHeight,
    minScale: ZOOM_MIN_SCALE,
    maxScale: ZOOM_MAX_SCALE,
  });
}

export function formatZoomPercent(scale: number): string {
  const safe = clampScale(scale);
  return `${Math.round(safe * 100)}%`;
}
