import test from 'node:test';
import assert from 'node:assert/strict';
import {
  DEFAULT_NORMALIZED_CROP_BOX,
  dragNormalizedCropHandle,
  fitAspectNormalizedCropBox,
  isFullNormalizedCropBox,
  normalizedBoxToPixelRect,
  resolveAspectPixelRatio,
  type CropAspectRatio,
} from './photoEditorMath';

function pixelRatioOf(
  box: { left: number; top: number; right: number; bottom: number },
  srcW: number,
  srcH: number
): number {
  const pw = (box.right - box.left) * srcW;
  const ph = (box.bottom - box.top) * srcH;
  return pw / ph;
}

test('fitAspectNormalizedCropBox fits all modern gallery aspect presets accurately', () => {
  const srcW = 2000;
  const srcH = 1000;

  const cases: Array<{ aspect: CropAspectRatio; expectedRatio: number }> = [
    { aspect: 'original', expectedRatio: 2.0 },
    { aspect: '1:1', expectedRatio: 1.0 },
    { aspect: '4:3', expectedRatio: 4 / 3 },
    { aspect: '3:4', expectedRatio: 3 / 4 },
    { aspect: '4:5', expectedRatio: 4 / 5 },
    { aspect: '16:9', expectedRatio: 16 / 9 },
    { aspect: '9:16', expectedRatio: 9 / 16 },
  ];

  for (const tc of cases) {
    const box = fitAspectNormalizedCropBox(srcW, srcH, tc.aspect);
    assert.ok(box.left >= 0 && box.top >= 0 && box.right <= 1 && box.bottom <= 1);
    const actualRatio = pixelRatioOf(box, srcW, srcH);
    assert.ok(
      Math.abs(actualRatio - tc.expectedRatio) < 0.01,
      `Aspect ${tc.aspect}: expected ${tc.expectedRatio}, got ${actualRatio}`
    );
  }

  assert.equal(isFullNormalizedCropBox(DEFAULT_NORMALIZED_CROP_BOX), true);
  assert.equal(isFullNormalizedCropBox(fitAspectNormalizedCropBox(srcW, srcH, '1:1')), false);
  assert.equal(resolveAspectPixelRatio('free', srcW, srcH), null);
});

test('freeform corner and edge drags clamp cleanly within [0, 1] and respect minSpan', () => {
  const start = { left: 0.2, top: 0.2, right: 0.8, bottom: 0.8 };

  const moved = dragNormalizedCropHandle(start, 'move', 0.5, -0.5, 'free', 1600, 1200);
  assert.ok(Math.abs(moved.right - 1) < 1e-6);
  assert.ok(Math.abs(moved.left - 0.4) < 1e-6);
  assert.ok(Math.abs(moved.top - 0) < 1e-6);
  assert.ok(Math.abs(moved.bottom - 0.6) < 1e-6);

  const shrunkN = dragNormalizedCropHandle(start, 'n', 0, 0.9, 'free', 1600, 1200, 0.1);
  assert.ok(Math.abs(shrunkN.bottom - 0.8) < 1e-6);
  assert.ok(Math.abs(shrunkN.bottom - shrunkN.top - 0.1) < 1e-6);

  const expandedW = dragNormalizedCropHandle(start, 'w', -0.5, 0, 'free', 1600, 1200, 0.1);
  assert.equal(expandedW.left, 0);
  assert.equal(expandedW.right, 0.8);
});

test('aspect-locked corner drags strictly pin the opposite anchor and preserve ratio at bounds', () => {
  const srcW = 1600;
  const srcH = 900;
  // Start with a centered 1:1 square inside 16:9 image
  const start = fitAspectNormalizedCropBox(srcW, srcH, '1:1');

  // Shrink from SE corner: NW corner must remain pinned
  const shrunkSe = dragNormalizedCropHandle(start, 'se', -0.15, -0.1, '1:1', srcW, srcH, 0.1);
  assert.ok(Math.abs(shrunkSe.left - start.left) < 1e-6, 'SE drag must pin left anchor');
  assert.ok(Math.abs(shrunkSe.top - start.top) < 1e-6, 'SE drag must pin top anchor');
  assert.ok(Math.abs(pixelRatioOf(shrunkSe, srcW, srcH) - 1.0) < 0.005);

  // Over-drag NW past image boundary: SE corner must stay pinned and ratio preserved
  const shrunkCenter = { left: 0.3, top: 0.2, right: 0.3 + (0.6 * srcH) / srcW, bottom: 0.8 };
  const overNw = dragNormalizedCropHandle(shrunkCenter, 'nw', -0.9, -0.9, '1:1', srcW, srcH, 0.1);
  assert.ok(Math.abs(overNw.right - shrunkCenter.right) < 1e-6, 'NW over-drag must pin right anchor');
  assert.ok(Math.abs(overNw.bottom - shrunkCenter.bottom) < 1e-6, 'NW over-drag must pin bottom anchor');
  assert.ok(overNw.left >= 0 && overNw.top >= 0);
  assert.ok(Math.abs(pixelRatioOf(overNw, srcW, srcH) - 1.0) < 0.005);
});

test('aspect-locked edge drags (N/S/E/W) keep exact aspect ratio and stay within bounds', () => {
  const srcW = 1200;
  const srcH = 800;
  const start = fitAspectNormalizedCropBox(srcW, srcH, 'original'); // full 3:2 box

  const draggedTop = dragNormalizedCropHandle(start, 'n', 0, 0.25, 'original', srcW, srcH, 0.1);
  assert.ok(Math.abs(draggedTop.bottom - 1) < 1e-6);
  assert.ok(Math.abs(pixelRatioOf(draggedTop, srcW, srcH) - srcW / srcH) < 0.005);

  const draggedRight = dragNormalizedCropHandle(start, 'e', -0.3, 0, 'original', srcW, srcH, 0.1);
  assert.ok(Math.abs(draggedRight.left - 0) < 1e-6);
  assert.ok(Math.abs(pixelRatioOf(draggedRight, srcW, srcH) - srcW / srcH) < 0.005);

  const rect = normalizedBoxToPixelRect(srcW, srcH, draggedRight);
  assert.ok(Math.abs(rect.width / rect.height - srcW / srcH) < 0.02);
});
