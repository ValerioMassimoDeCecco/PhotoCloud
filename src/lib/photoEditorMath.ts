export type CropAspectRatio = 'free' | '1:1' | '4:3' | '4:5' | '16:9';

export type PhotoFilterPresetId =
  | 'original'
  | 'vivid'
  | 'bw'
  | 'sepia'
  | 'cinema'
  | 'cool'
  | 'vintage';

export interface PhotoEditState {
  brightness: number; // -100 to +100
  contrast: number; // -100 to +100
  saturation: number; // -100 to +100
  warmth: number; // -100 to +100
  rotation: number; // 0, 90, 180, 270
  flipH: boolean;
  flipV: boolean;
  cropAspect: CropAspectRatio;
  filterPreset: PhotoFilterPresetId;
}

export interface CropRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export const DEFAULT_PHOTO_EDIT_STATE: PhotoEditState = {
  brightness: 0,
  contrast: 0,
  saturation: 0,
  warmth: 0,
  rotation: 0,
  flipH: false,
  flipV: false,
  cropAspect: 'free',
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

export function computeCropRect(
  srcWidth: number,
  srcHeight: number,
  aspect: CropAspectRatio
): CropRect {
  const w = Math.max(1, Math.floor(srcWidth));
  const h = Math.max(1, Math.floor(srcHeight));
  if (aspect === 'free') {
    return { x: 0, y: 0, width: w, height: h };
  }

  const ratioMap: Record<Exclude<CropAspectRatio, 'free'>, number> = {
    '1:1': 1,
    '4:3': 4 / 3,
    '4:5': 4 / 5,
    '16:9': 16 / 9,
  };

  const targetRatio = ratioMap[aspect] || 1;
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
