import test from 'node:test';
import assert from 'node:assert/strict';
import {
  ZOOM_DOUBLE_TAP_SCALE,
  ZOOM_MAX_SCALE,
  applyFocalZoom,
  applyPanDelta,
  applyTwoFingerPinch,
  applyWheelZoom,
  createInitialZoomPan,
  formatZoomPercent,
  isZoomedIn,
  stepButtonZoom,
  toggleDoubleTapZoom,
} from './zoomPanMath.ts';

const METRICS = {
  viewportWidth: 1000,
  viewportHeight: 800,
  mediaWidth: 2000,
  mediaHeight: 1600,
};

test('toggleDoubleTapZoom zooms in to 2.5x centered on tap and resets cleanly to 1x', () => {
  const initial = createInitialZoomPan();
  assert.equal(isZoomedIn(initial), false);

  const zoomed = toggleDoubleTapZoom(initial, 120, -80, METRICS);
  assert.equal(zoomed.scale, ZOOM_DOUBLE_TAP_SCALE);
  assert.equal(isZoomedIn(zoomed), true);
  // Tapping right/top (+120, -80) shifts image left/down so tapped point moves toward center
  assert.ok(zoomed.panX < 0);
  assert.ok(zoomed.panY > 0);

  const reset = toggleDoubleTapZoom(zoomed, 0, 0, METRICS);
  assert.deepEqual(reset, { scale: 1, panX: 0, panY: 0 });
});

test('applyPanDelta is a no-op at 1x and strictly clamps pan within image bounds when zoomed', () => {
  const atOne = applyPanDelta(createInitialZoomPan(), 250, -300, METRICS);
  assert.deepEqual(atOne, { scale: 1, panX: 0, panY: 0 });

  // At 2x with 1000x800 fitted media in 1000x800 viewport, maxPanX = 500, maxPanY = 400
  const zoomed = { scale: 2, panX: 0, panY: 0 };
  const clamped = applyPanDelta(zoomed, 9999, -9999, METRICS);
  assert.equal(clamped.panX, 500);
  assert.equal(clamped.panY, -400);
});

test('applyTwoFingerPinch keeps focal point pinned under fingers and enforces max scale', () => {
  const initial = createInitialZoomPan();
  const pinched = applyTwoFingerPinch(
    initial,
    600,
    450,
    600,
    450,
    100,
    200,
    500,
    400,
    METRICS
  );
  assert.equal(pinched.scale, 2);
  // Focal offset was (+100, +50) from center; at 2x ratio, pan shifts (-100, -50) to lock pixel
  assert.equal(pinched.panX, -100);
  assert.equal(pinched.panY, -50);

  const overZoomed = applyTwoFingerPinch(
    pinched,
    500,
    400,
    500,
    400,
    100,
    1000,
    500,
    400,
    METRICS
  );
  assert.equal(overZoomed.scale, ZOOM_MAX_SCALE);
});

test('applyWheelZoom zooms in on negative deltaY and out on positive deltaY down to 1x', () => {
  const zoomedIn = applyWheelZoom(createInitialZoomPan(), -120, 80, 40, METRICS);
  assert.ok(zoomedIn.scale > 1.2);
  assert.ok(zoomedIn.panX < 0);

  const zoomedOut = applyWheelZoom(zoomedIn, 180, 0, 0, METRICS, true);
  assert.equal(zoomedOut.scale, 1);
  assert.equal(zoomedOut.panX, 0);
  assert.equal(zoomedOut.panY, 0);
});

test('stepButtonZoom and formatZoomPercent produce clean predictable steps', () => {
  const s1 = stepButtonZoom(createInitialZoomPan(), 'in', METRICS);
  assert.equal(formatZoomPercent(s1.scale), '145%');

  const s0 = stepButtonZoom(s1, 'out', METRICS);
  assert.deepEqual(s0, { scale: 1, panX: 0, panY: 0 });
  assert.equal(formatZoomPercent(s0.scale), '100%');

  // Extreme zoom in caps at 500%
  const max = applyFocalZoom(createInitialZoomPan(), 12, 0, 0, METRICS);
  assert.equal(formatZoomPercent(max.scale), '500%');
});
