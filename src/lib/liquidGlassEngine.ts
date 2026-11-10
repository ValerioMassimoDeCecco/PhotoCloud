/**
 * PhotoCloud Liquid Glass Design System Engine (Web & Shared Token Spec)
 * Technical & visual architecture modeled on Kyant0/AndroidLiquidGlass (`io.github.kyant0:backdrop`):
 * - Multi-stage optical backdrop pipeline: Blur + ColorMatrix (Saturation, Brightness, Contrast)
 * - Rounded-rectangle SDF Lens Refraction & Chromatic Rim Dispersion
 * - Dual-angle Specular Highlights & Luminous Rim Borders
 * - Layered Visual Depth & Elevation Shadows
 */

export type DesignThemeMode = 'original' | 'liquid_glass';

export type NavBarGlassStyle = 'capsule' | 'floating' | 'crystal';
export type CardGlassStyle = 'elevated' | 'frosted' | 'prism';

export interface LiquidGlassConfig {
  // General Appearance (Aspetto generale)
  glassIntensity: number;         // 0..100 (default 78)
  transparency: number;           // 0..100 (default 68)
  opacity: number;                // 0..100 (default 32)
  blurRadius: number;             // 0..60 px/dp (default 28)
  backdropSaturation: number;     // 50..250 % (default 185)
  brightness: number;             // 50..150 % (default 106)
  contrast: number;               // 50..150 % (default 108)
  visualDepth: number;            // 0..100 (default 75)

  // Colors (Colori + colori personalizzati)
  primaryColor: string;           // Hex #RRGGBB
  secondaryColor: string;         // Hex #RRGGBB
  glassColor: string;             // Hex #RRGGBB
  surfaceToneColor: string;       // Hex #RRGGBB
  borderColor: string;            // Hex #RRGGBB
  iconColor: string;              // Hex #RRGGBB
  textColor: string;              // Hex #RRGGBB
  accentColor: string;            // Hex #RRGGBB
  useCustomColors: boolean;

  // Visual Effects (Effetti visivi)
  specularHighlights: boolean;
  highlightIntensity: number;     // 0..100 (default 80)
  luminousBorders: boolean;
  borderGlowIntensity: number;    // 0..100 (default 72)
  surfaceGradient: boolean;
  gradientAngle: number;          // 0..360 deg (default 135)
  shadowsEnabled: boolean;
  shadowIntensity: number;        // 0..100 (default 70)
  depthEffect: boolean;
  refractionIntensity: number;    // 0..100 (default 65)
  animationsEnabled: boolean;
  animationIntensity: number;     // 0..100 (default 80)

  // Components (Componenti)
  componentCornerRadius: number;  // 8..40 px/dp (default 24)
  navBarGlassStyle: NavBarGlassStyle;
  cardGlassStyle: CardGlassStyle;
}

export interface LiquidGlassPreset {
  id: string;
  name: string;
  subtitle: string;
  config: LiquidGlassConfig;
}

export const DEFAULT_LIQUID_GLASS_CONFIG: LiquidGlassConfig = {
  glassIntensity: 78,
  transparency: 68,
  opacity: 32,
  blurRadius: 28,
  backdropSaturation: 185,
  brightness: 106,
  contrast: 108,
  visualDepth: 75,

  primaryColor: '#38BDF8',
  secondaryColor: '#818CF8',
  glassColor: '#E0F2FE',
  surfaceToneColor: '#0B132B',
  borderColor: '#BAE6FD',
  iconColor: '#E0F2FE',
  textColor: '#F8FAFC',
  accentColor: '#00F5D4',
  useCustomColors: false,

  specularHighlights: true,
  highlightIntensity: 80,
  luminousBorders: true,
  borderGlowIntensity: 72,
  surfaceGradient: true,
  gradientAngle: 135,
  shadowsEnabled: true,
  shadowIntensity: 70,
  depthEffect: true,
  refractionIntensity: 65,
  animationsEnabled: true,
  animationIntensity: 80,

  componentCornerRadius: 24,
  navBarGlassStyle: 'capsule',
  cardGlassStyle: 'elevated',
};

export const LIQUID_GLASS_PRESETS: LiquidGlassPreset[] = [
  {
    id: 'arctic_crystal',
    name: 'Cristallo Artico',
    subtitle: 'Rifrazione pura ciano-ghiaccio ispirata ad AndroidLiquidGlass',
    config: { ...DEFAULT_LIQUID_GLASS_CONFIG },
  },
  {
    id: 'liquid_amethyst',
    name: 'Ametista Liquida',
    subtitle: 'Vetro profondo viola-indaco con riflessi speculari intensi',
    config: {
      ...DEFAULT_LIQUID_GLASS_CONFIG,
      glassIntensity: 84,
      transparency: 64,
      opacity: 36,
      blurRadius: 32,
      backdropSaturation: 195,
      brightness: 108,
      contrast: 112,
      visualDepth: 82,
      primaryColor: '#C084FC',
      secondaryColor: '#818CF8',
      glassColor: '#F3E8FF',
      surfaceToneColor: '#130924',
      borderColor: '#E9D5FF',
      iconColor: '#F3E8FF',
      textColor: '#FAF5FF',
      accentColor: '#F472B6',
      highlightIntensity: 88,
      borderGlowIntensity: 80,
      refractionIntensity: 74,
      cardGlassStyle: 'prism',
    },
  },
  {
    id: 'emerald_abyss',
    name: 'Smeraldo Abissale',
    subtitle: 'Superfici stratificate acquamarina ad alta saturazione',
    config: {
      ...DEFAULT_LIQUID_GLASS_CONFIG,
      glassIntensity: 80,
      transparency: 66,
      opacity: 34,
      blurRadius: 30,
      backdropSaturation: 200,
      brightness: 105,
      contrast: 110,
      visualDepth: 78,
      primaryColor: '#34D399',
      secondaryColor: '#2DD4BF',
      glassColor: '#D1FAE5',
      surfaceToneColor: '#061A17',
      borderColor: '#A7F3D0',
      iconColor: '#ECFDF5',
      textColor: '#F0FDF4',
      accentColor: '#10B981',
      highlightIntensity: 82,
      borderGlowIntensity: 76,
      refractionIntensity: 68,
      navBarGlassStyle: 'floating',
      cardGlassStyle: 'elevated',
    },
  },
  {
    id: 'rose_quartz',
    name: 'Quarzo Rosa',
    subtitle: 'Luce soffusa corallo-pesca con bordi luminosi satinati',
    config: {
      ...DEFAULT_LIQUID_GLASS_CONFIG,
      glassIntensity: 76,
      transparency: 70,
      opacity: 30,
      blurRadius: 26,
      backdropSaturation: 175,
      brightness: 110,
      contrast: 105,
      visualDepth: 70,
      primaryColor: '#FB7185',
      secondaryColor: '#F472B6',
      glassColor: '#FFE4E6',
      surfaceToneColor: '#1F0B16',
      borderColor: '#FECDD3',
      iconColor: '#FFF1F2',
      textColor: '#FFF1F2',
      accentColor: '#FDA4AF',
      highlightIntensity: 85,
      borderGlowIntensity: 75,
      refractionIntensity: 60,
      cardGlassStyle: 'frosted',
    },
  },
  {
    id: 'obsidian_mirror',
    name: 'Ossidiana Speculare',
    subtitle: 'Vetro fumé scuro ad alto contrasto con rifrazione nitida',
    config: {
      ...DEFAULT_LIQUID_GLASS_CONFIG,
      glassIntensity: 88,
      transparency: 54,
      opacity: 46,
      blurRadius: 36,
      backdropSaturation: 160,
      brightness: 98,
      contrast: 118,
      visualDepth: 90,
      primaryColor: '#94A3B8',
      secondaryColor: '#64748B',
      glassColor: '#E2E8F0',
      surfaceToneColor: '#05070E',
      borderColor: '#CBD5E1',
      iconColor: '#F1F5F9',
      textColor: '#F8FAFC',
      accentColor: '#38BDF8',
      highlightIntensity: 92,
      borderGlowIntensity: 84,
      refractionIntensity: 80,
      navBarGlassStyle: 'crystal',
      cardGlassStyle: 'prism',
    },
  },
  {
    id: 'solar_amber',
    name: 'Ambra Rifrattiva',
    subtitle: 'Calore dorato con rifrazione prismatica e profondità calda',
    config: {
      ...DEFAULT_LIQUID_GLASS_CONFIG,
      glassIntensity: 82,
      transparency: 65,
      opacity: 35,
      blurRadius: 28,
      backdropSaturation: 190,
      brightness: 109,
      contrast: 109,
      visualDepth: 76,
      primaryColor: '#FBBF24',
      secondaryColor: '#FB923C',
      glassColor: '#FEF3C7',
      surfaceToneColor: '#1C1206',
      borderColor: '#FDE68A',
      iconColor: '#FFFBEB',
      textColor: '#FFFBEB',
      accentColor: '#F59E0B',
      highlightIntensity: 84,
      borderGlowIntensity: 78,
      refractionIntensity: 70,
      cardGlassStyle: 'elevated',
    },
  },
];

function clampNum(val: unknown, min: number, max: number, fallback: number): number {
  const n = typeof val === 'number' ? val : Number(val);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(max, Math.max(min, Math.round(n)));
}

export function sanitizeHexColor(val: unknown, fallback: string): string {
  if (typeof val !== 'string') return fallback;
  const trimmed = val.trim();
  if (/^#[0-9a-fA-F]{6}$/.test(trimmed)) {
    return trimmed.toUpperCase();
  }
  if (/^#[0-9a-fA-F]{3}$/.test(trimmed)) {
    const r = trimmed[1];
    const g = trimmed[2];
    const b = trimmed[3];
    return `#${r}${r}${g}${g}${b}${b}`.toUpperCase();
  }
  return fallback;
}

export function hexToRgbTuple(hex: string): [number, number, number] {
  const clean = sanitizeHexColor(hex, '#38BDF8').slice(1);
  const r = parseInt(clean.slice(0, 2), 16);
  const g = parseInt(clean.slice(2, 4), 16);
  const b = parseInt(clean.slice(4, 6), 16);
  return [r, g, b];
}

export function sanitizeLiquidGlassConfig(raw: Partial<LiquidGlassConfig> | null | undefined): LiquidGlassConfig {
  const src = raw && typeof raw === 'object' ? raw : {};
  const d = DEFAULT_LIQUID_GLASS_CONFIG;

  const navStyle: NavBarGlassStyle =
    src.navBarGlassStyle === 'capsule' || src.navBarGlassStyle === 'floating' || src.navBarGlassStyle === 'crystal'
      ? src.navBarGlassStyle
      : d.navBarGlassStyle;

  const cardStyle: CardGlassStyle =
    src.cardGlassStyle === 'elevated' || src.cardGlassStyle === 'frosted' || src.cardGlassStyle === 'prism'
      ? src.cardGlassStyle
      : d.cardGlassStyle;

  const transparency = clampNum(src.transparency, 0, 100, d.transparency);
  const opacity =
    src.opacity !== undefined
      ? clampNum(src.opacity, 0, 100, d.opacity)
      : Math.max(0, Math.min(100, 100 - transparency));

  return {
    glassIntensity: clampNum(src.glassIntensity, 0, 100, d.glassIntensity),
    transparency,
    opacity,
    blurRadius: clampNum(src.blurRadius, 0, 60, d.blurRadius),
    backdropSaturation: clampNum(src.backdropSaturation, 50, 250, d.backdropSaturation),
    brightness: clampNum(src.brightness, 50, 150, d.brightness),
    contrast: clampNum(src.contrast, 50, 150, d.contrast),
    visualDepth: clampNum(src.visualDepth, 0, 100, d.visualDepth),

    primaryColor: sanitizeHexColor(src.primaryColor, d.primaryColor),
    secondaryColor: sanitizeHexColor(src.secondaryColor, d.secondaryColor),
    glassColor: sanitizeHexColor(src.glassColor, d.glassColor),
    surfaceToneColor: sanitizeHexColor(src.surfaceToneColor, d.surfaceToneColor),
    borderColor: sanitizeHexColor(src.borderColor, d.borderColor),
    iconColor: sanitizeHexColor(src.iconColor, d.iconColor),
    textColor: sanitizeHexColor(src.textColor, d.textColor),
    accentColor: sanitizeHexColor(src.accentColor, d.accentColor),
    useCustomColors: Boolean(src.useCustomColors ?? d.useCustomColors),

    specularHighlights: src.specularHighlights !== undefined ? Boolean(src.specularHighlights) : d.specularHighlights,
    highlightIntensity: clampNum(src.highlightIntensity, 0, 100, d.highlightIntensity),
    luminousBorders: src.luminousBorders !== undefined ? Boolean(src.luminousBorders) : d.luminousBorders,
    borderGlowIntensity: clampNum(src.borderGlowIntensity, 0, 100, d.borderGlowIntensity),
    surfaceGradient: src.surfaceGradient !== undefined ? Boolean(src.surfaceGradient) : d.surfaceGradient,
    gradientAngle: clampNum(src.gradientAngle, 0, 360, d.gradientAngle),
    shadowsEnabled: src.shadowsEnabled !== undefined ? Boolean(src.shadowsEnabled) : d.shadowsEnabled,
    shadowIntensity: clampNum(src.shadowIntensity, 0, 100, d.shadowIntensity),
    depthEffect: src.depthEffect !== undefined ? Boolean(src.depthEffect) : d.depthEffect,
    refractionIntensity: clampNum(src.refractionIntensity, 0, 100, d.refractionIntensity),
    animationsEnabled: src.animationsEnabled !== undefined ? Boolean(src.animationsEnabled) : d.animationsEnabled,
    animationIntensity: clampNum(src.animationIntensity, 0, 100, d.animationIntensity),

    componentCornerRadius: clampNum(src.componentCornerRadius, 8, 40, d.componentCornerRadius),
    navBarGlassStyle: navStyle,
    cardGlassStyle: cardStyle,
  };
}

/**
 * Computes all CSS Custom Properties (`--lg-*`) and SVG displacement scale values
 * for the Web Liquid Glass engine from a sanitized `LiquidGlassConfig`.
 */
export function computeLiquidGlassCssVariables(
  rawConfig: Partial<LiquidGlassConfig>,
  isDarkMode = true
): Record<string, string> {
  const cfg = sanitizeLiquidGlassConfig(rawConfig);
  const [pr, pg, pb] = hexToRgbTuple(cfg.primaryColor);
  const [sr, sg, sb] = hexToRgbTuple(cfg.secondaryColor);
  const [gr, gg, gb] = hexToRgbTuple(cfg.glassColor);
  const [tr, tg, tb] = hexToRgbTuple(cfg.surfaceToneColor);
  const [br, bg, bb] = hexToRgbTuple(cfg.borderColor);
  const [ar, ag, ab] = hexToRgbTuple(cfg.accentColor);

  const intensityFactor = cfg.glassIntensity / 100;
  const surfaceAlpha = Math.min(0.88, Math.max(0.08, (cfg.opacity / 100) * (0.55 + intensityFactor * 0.45)));
  const elevatedAlpha = Math.min(0.92, surfaceAlpha + 0.12);
  const highlightAlpha = cfg.specularHighlights ? ((cfg.highlightIntensity / 100) * 0.52).toFixed(3) : '0';
  const borderAlpha = cfg.luminousBorders ? ((cfg.borderGlowIntensity / 100) * 0.62).toFixed(3) : '0.16';
  const shadowAlpha = cfg.shadowsEnabled ? ((cfg.shadowIntensity / 100) * (isDarkMode ? 0.68 : 0.28)).toFixed(3) : '0';
  const depthSpreadPx = cfg.depthEffect ? Math.round((cfg.visualDepth / 100) * 38 + 10) : 8;
  const refractionScale = ((cfg.refractionIntensity / 100) * 18 * intensityFactor).toFixed(2);
  const animDurationMs = cfg.animationsEnabled
    ? Math.round(140 + (cfg.animationIntensity / 100) * 220)
    : 0;

  return {
    '--lg-primary': cfg.primaryColor,
    '--lg-primary-rgb': `${pr}, ${pg}, ${pb}`,
    '--lg-secondary': cfg.secondaryColor,
    '--lg-secondary-rgb': `${sr}, ${sg}, ${sb}`,
    '--lg-glass-color': cfg.glassColor,
    '--lg-glass-rgb': `${gr}, ${gg}, ${gb}`,
    '--lg-surface-tone': cfg.surfaceToneColor,
    '--lg-surface-tone-rgb': `${tr}, ${tg}, ${tb}`,
    '--lg-border-color': cfg.borderColor,
    '--lg-border-rgb': `${br}, ${bg}, ${bb}`,
    '--lg-icon-color': cfg.iconColor,
    '--lg-text-color': cfg.textColor,
    '--lg-accent-color': cfg.accentColor,
    '--lg-accent-rgb': `${ar}, ${ag}, ${ab}`,

    '--lg-blur': `${cfg.blurRadius}px`,
    '--lg-saturation': `${cfg.backdropSaturation}%`,
    '--lg-brightness': `${cfg.brightness}%`,
    '--lg-contrast': `${cfg.contrast}%`,
    '--lg-surface-alpha': surfaceAlpha.toFixed(3),
    '--lg-elevated-alpha': elevatedAlpha.toFixed(3),
    '--lg-highlight-alpha': highlightAlpha,
    '--lg-border-alpha': borderAlpha,
    '--lg-shadow-alpha': shadowAlpha,
    '--lg-depth-spread': `${depthSpreadPx}px`,
    '--lg-gradient-angle': `${cfg.gradientAngle}deg`,
    '--lg-refraction-scale': refractionScale,
    '--lg-corner-radius': `${cfg.componentCornerRadius}px`,
    '--lg-anim-duration': `${animDurationMs}ms`,
  };
}

export function exportLiquidGlassConfigJson(config: Partial<LiquidGlassConfig>): string {
  const sanitized = sanitizeLiquidGlassConfig(config);
  return JSON.stringify(
    {
      schema: 'photocloud.liquid_glass.v1',
      exportedAt: new Date().toISOString(),
      config: sanitized,
    },
    null,
    2
  );
}

export function importLiquidGlassConfigJson(jsonText: string): LiquidGlassConfig | null {
  try {
    const parsed = JSON.parse(jsonText);
    if (!parsed || typeof parsed !== 'object') return null;
    const rawConfig = parsed.config && typeof parsed.config === 'object' ? parsed.config : parsed;
    return sanitizeLiquidGlassConfig(rawConfig);
  } catch {
    return null;
  }
}
