/**
 * PhotoCloud Dual-Theme Manager & Liquid Glass Customization Studio (Web)
 * Reference: Kyant0/AndroidLiquidGlass (`io.github.kyant0:backdrop`)
 * - Theme 1 ('original'): 100% untouched original Material You design.
 * - Theme 2 ('liquid_glass'): Full optical Liquid Glass design system with real-time customization.
 */
(function () {
    const STORAGE_THEME_KEY = 'photocloud_design_theme';
    const STORAGE_CONFIG_KEY = 'photocloud_liquid_glass_config';
    const STORAGE_SAVED_PRESETS_KEY = 'photocloud_liquid_glass_saved_presets';

    const DEFAULT_CONFIG = {
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
        cardGlassStyle: 'elevated'
    };

    const BUILTIN_PRESETS = [
        {
            id: 'arctic_crystal',
            name: 'Cristallo Artico',
            subtitle: 'Rifrazione ciano-ghiaccio AndroidLiquidGlass',
            config: Object.assign({}, DEFAULT_CONFIG)
        },
        {
            id: 'liquid_amethyst',
            name: 'Ametista Liquida',
            subtitle: 'Vetro viola-indaco con riflessi speculari',
            config: Object.assign({}, DEFAULT_CONFIG, {
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
                cardGlassStyle: 'prism'
            })
        },
        {
            id: 'emerald_abyss',
            name: 'Smeraldo Abissale',
            subtitle: 'Superfici stratificate acquamarina',
            config: Object.assign({}, DEFAULT_CONFIG, {
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
                cardGlassStyle: 'elevated'
            })
        },
        {
            id: 'rose_quartz',
            name: 'Quarzo Rosa',
            subtitle: 'Luce soffusa corallo con bordi satinati',
            config: Object.assign({}, DEFAULT_CONFIG, {
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
                cardGlassStyle: 'frosted'
            })
        },
        {
            id: 'obsidian_mirror',
            name: 'Ossidiana Speculare',
            subtitle: 'Vetro fumé scuro ad alto contrasto',
            config: Object.assign({}, DEFAULT_CONFIG, {
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
                cardGlassStyle: 'prism'
            })
        },
        {
            id: 'solar_amber',
            name: 'Ambra Rifrattiva',
            subtitle: 'Calore dorato e rifrazione prismatica',
            config: Object.assign({}, DEFAULT_CONFIG, {
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
                cardGlassStyle: 'elevated'
            })
        }
    ];

    function clamp(val, min, max, fallback) {
        const n = Number(val);
        if (!Number.isFinite(n)) return fallback;
        return Math.min(max, Math.max(min, Math.round(n)));
    }

    function sanitizeHex(val, fallback) {
        if (typeof val !== 'string') return fallback;
        const s = val.trim();
        if (/^#[0-9a-fA-F]{6}$/.test(s)) return s.toUpperCase();
        return fallback;
    }

    function hexToRgb(hex) {
        const clean = sanitizeHex(hex, '#38BDF8').slice(1);
        return [
            parseInt(clean.slice(0, 2), 16),
            parseInt(clean.slice(2, 4), 16),
            parseInt(clean.slice(4, 6), 16)
        ];
    }

    function sanitizeConfig(raw) {
        const src = raw && typeof raw === 'object' ? raw : {};
        const d = DEFAULT_CONFIG;
        const transparency = clamp(src.transparency, 0, 100, d.transparency);
        const opacity = src.opacity !== undefined
            ? clamp(src.opacity, 0, 100, d.opacity)
            : Math.max(0, Math.min(100, 100 - transparency));

        return {
            glassIntensity: clamp(src.glassIntensity, 0, 100, d.glassIntensity),
            transparency: transparency,
            opacity: opacity,
            blurRadius: clamp(src.blurRadius, 0, 60, d.blurRadius),
            backdropSaturation: clamp(src.backdropSaturation, 50, 250, d.backdropSaturation),
            brightness: clamp(src.brightness, 50, 150, d.brightness),
            contrast: clamp(src.contrast, 50, 150, d.contrast),
            visualDepth: clamp(src.visualDepth, 0, 100, d.visualDepth),

            primaryColor: sanitizeHex(src.primaryColor, d.primaryColor),
            secondaryColor: sanitizeHex(src.secondaryColor, d.secondaryColor),
            glassColor: sanitizeHex(src.glassColor, d.glassColor),
            surfaceToneColor: sanitizeHex(src.surfaceToneColor, d.surfaceToneColor),
            borderColor: sanitizeHex(src.borderColor, d.borderColor),
            iconColor: sanitizeHex(src.iconColor, d.iconColor),
            textColor: sanitizeHex(src.textColor, d.textColor),
            accentColor: sanitizeHex(src.accentColor, d.accentColor),
            useCustomColors: Boolean(src.useCustomColors ?? d.useCustomColors),

            specularHighlights: src.specularHighlights !== undefined ? Boolean(src.specularHighlights) : d.specularHighlights,
            highlightIntensity: clamp(src.highlightIntensity, 0, 100, d.highlightIntensity),
            luminousBorders: src.luminousBorders !== undefined ? Boolean(src.luminousBorders) : d.luminousBorders,
            borderGlowIntensity: clamp(src.borderGlowIntensity, 0, 100, d.borderGlowIntensity),
            surfaceGradient: src.surfaceGradient !== undefined ? Boolean(src.surfaceGradient) : d.surfaceGradient,
            gradientAngle: clamp(src.gradientAngle, 0, 360, d.gradientAngle),
            shadowsEnabled: src.shadowsEnabled !== undefined ? Boolean(src.shadowsEnabled) : d.shadowsEnabled,
            shadowIntensity: clamp(src.shadowIntensity, 0, 100, d.shadowIntensity),
            depthEffect: src.depthEffect !== undefined ? Boolean(src.depthEffect) : d.depthEffect,
            refractionIntensity: clamp(src.refractionIntensity, 0, 100, d.refractionIntensity),
            animationsEnabled: src.animationsEnabled !== undefined ? Boolean(src.animationsEnabled) : d.animationsEnabled,
            animationIntensity: clamp(src.animationIntensity, 0, 100, d.animationIntensity),

            componentCornerRadius: clamp(src.componentCornerRadius, 8, 40, d.componentCornerRadius),
            navBarGlassStyle: ['capsule', 'floating', 'crystal'].includes(src.navBarGlassStyle) ? src.navBarGlassStyle : d.navBarGlassStyle,
            cardGlassStyle: ['elevated', 'frosted', 'prism'].includes(src.cardGlassStyle) ? src.cardGlassStyle : d.cardGlassStyle
        };
    }

    let currentDesignTheme = localStorage.getItem(STORAGE_THEME_KEY) === 'liquid_glass' ? 'liquid_glass' : 'original';
    let currentConfig = (function () {
        try {
            const raw = localStorage.getItem(STORAGE_CONFIG_KEY);
            return raw ? sanitizeConfig(JSON.parse(raw)) : Object.assign({}, DEFAULT_CONFIG);
        } catch {
            return Object.assign({}, DEFAULT_CONFIG);
        }
    })();

    function loadSavedPresets() {
        try {
            const raw = localStorage.getItem(STORAGE_SAVED_PRESETS_KEY);
            const parsed = raw ? JSON.parse(raw) : [];
            return Array.isArray(parsed) ? parsed : [];
        } catch {
            return [];
        }
    }

    function saveCustomPreset(name) {
        const list = loadSavedPresets();
        const cleanName = String(name || 'Preset Personalizzato').trim().slice(0, 40) || 'Preset Personalizzato';
        const preset = {
            id: 'custom_' + Date.now(),
            name: cleanName,
            subtitle: 'Configurazione salvata dall\'utente',
            config: sanitizeConfig(currentConfig)
        };
        list.unshift(preset);
        localStorage.setItem(STORAGE_SAVED_PRESETS_KEY, JSON.stringify(list.slice(0, 12)));
        return preset;
    }

    function ensureRefractionSvgFilter() {
        if (document.getElementById('liquid-glass-refraction-svg')) return;
        const svgNS = 'http://www.w3.org/2000/svg';
        const svg = document.createElementNS(svgNS, 'svg');
        svg.id = 'liquid-glass-refraction-svg';
        svg.setAttribute('width', '0');
        svg.setAttribute('height', '0');
        svg.style.position = 'absolute';
        svg.style.pointerEvents = 'none';
        svg.innerHTML = `
            <defs>
                <filter id="liquid-glass-refraction-filter" x="-10%" y="-10%" width="120%" height="120%" color-interpolation-filters="sRGB">
                    <feTurbulence type="fractalNoise" baseFrequency="0.018 0.022" numOctaves="2" seed="7" result="noise" />
                    <feDisplacementMap id="lg-svg-displacement" in="SourceGraphic" in2="noise" scale="9" xChannelSelector="R" yChannelSelector="G" />
                </filter>
            </defs>
        `;
        document.body.appendChild(svg);
    }

    const CSS_VAR_NAMES = [
        '--lg-primary', '--lg-primary-rgb',
        '--lg-secondary', '--lg-secondary-rgb',
        '--lg-glass-color', '--lg-glass-rgb',
        '--lg-surface-tone', '--lg-surface-tone-rgb',
        '--lg-border-color', '--lg-border-rgb',
        '--lg-icon-color', '--lg-text-color',
        '--lg-accent-color', '--lg-accent-rgb',
        '--lg-blur', '--lg-saturation', '--lg-brightness', '--lg-contrast',
        '--lg-surface-alpha', '--lg-elevated-alpha',
        '--lg-highlight-alpha', '--lg-border-alpha', '--lg-shadow-alpha',
        '--lg-depth-spread', '--lg-gradient-angle', '--lg-refraction-scale',
        '--lg-corner-radius', '--lg-anim-duration'
    ];

    function applyThemeAndVariables() {
        const body = document.body;
        if (!body) return;

        ensureRefractionSvgFilter();
        body.setAttribute('data-design-theme', currentDesignTheme);

        if (currentDesignTheme !== 'liquid_glass') {
            body.classList.remove('liquid-glass-theme');
            body.removeAttribute('data-lg-nav-style');
            body.removeAttribute('data-lg-card-style');
            body.removeAttribute('data-lg-custom-colors');
            CSS_VAR_NAMES.forEach((k) => body.style.removeProperty(k));
            return;
        }

        body.classList.add('liquid-glass-theme');
        const cfg = sanitizeConfig(currentConfig);
        body.setAttribute('data-lg-nav-style', cfg.navBarGlassStyle);
        body.setAttribute('data-lg-card-style', cfg.cardGlassStyle);
        body.setAttribute('data-lg-custom-colors', cfg.useCustomColors ? 'true' : 'false');

        const [pr, pg, pb] = hexToRgb(cfg.primaryColor);
        const [sr, sg, sb] = hexToRgb(cfg.secondaryColor);
        const [gr, gg, gb] = hexToRgb(cfg.glassColor);
        const [tr, tg, tb] = hexToRgb(cfg.surfaceToneColor);
        const [br, bg, bb] = hexToRgb(cfg.borderColor);
        const [ar, ag, ab] = hexToRgb(cfg.accentColor);

        const intensityFactor = cfg.glassIntensity / 100;
        const surfaceAlpha = Math.min(0.88, Math.max(0.08, (cfg.opacity / 100) * (0.55 + intensityFactor * 0.45)));
        const elevatedAlpha = Math.min(0.92, surfaceAlpha + 0.12);
        const highlightAlpha = cfg.specularHighlights ? ((cfg.highlightIntensity / 100) * 0.52).toFixed(3) : '0';
        const borderAlpha = cfg.luminousBorders ? ((cfg.borderGlowIntensity / 100) * 0.62).toFixed(3) : '0.16';
        const isDark = body.classList.contains('dark-mode');
        const shadowAlpha = cfg.shadowsEnabled ? ((cfg.shadowIntensity / 100) * (isDark ? 0.68 : 0.28)).toFixed(3) : '0';
        const depthSpreadPx = cfg.depthEffect ? Math.round((cfg.visualDepth / 100) * 38 + 10) : 8;
        const refractionScale = ((cfg.refractionIntensity / 100) * 18 * intensityFactor).toFixed(2);
        const animDurationMs = cfg.animationsEnabled ? Math.round(140 + (cfg.animationIntensity / 100) * 220) : 0;

        const vars = {
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
            '--lg-gradient-angle': cfg.surfaceGradient ? `${cfg.gradientAngle}deg` : '180deg',
            '--lg-refraction-scale': refractionScale,
            '--lg-corner-radius': `${cfg.componentCornerRadius}px`,
            '--lg-anim-duration': `${animDurationMs}ms`
        };

        Object.entries(vars).forEach(([k, v]) => body.style.setProperty(k, v));

        const dispEl = document.getElementById('lg-svg-displacement');
        if (dispEl) {
            dispEl.setAttribute('scale', String(refractionScale));
        }
    }

    function setDesignTheme(mode) {
        currentDesignTheme = mode === 'liquid_glass' ? 'liquid_glass' : 'original';
        localStorage.setItem(STORAGE_THEME_KEY, currentDesignTheme);
        applyThemeAndVariables();
        syncSettingsDialogControls();
    }

    function updateLiquidGlassConfig(partial) {
        if (partial && partial.transparency !== undefined && partial.opacity === undefined) {
            partial.opacity = 100 - clamp(partial.transparency, 0, 100, currentConfig.transparency);
        } else if (partial && partial.opacity !== undefined && partial.transparency === undefined) {
            partial.transparency = 100 - clamp(partial.opacity, 0, 100, currentConfig.opacity);
        }
        currentConfig = sanitizeConfig(Object.assign({}, currentConfig, partial));
        localStorage.setItem(STORAGE_CONFIG_KEY, JSON.stringify(currentConfig));
        applyThemeAndVariables();
        syncSettingsDialogControls();
    }

    function resetLiquidGlassConfig() {
        currentConfig = Object.assign({}, DEFAULT_CONFIG);
        localStorage.setItem(STORAGE_CONFIG_KEY, JSON.stringify(currentConfig));
        applyThemeAndVariables();
        syncSettingsDialogControls();
    }

    function syncSettingsDialogControls() {
        const modal = document.getElementById('lg-settings-modal-backdrop');
        if (!modal) return;

        const origBtn = document.getElementById('lg-select-theme-original');
        const glassBtn = document.getElementById('lg-select-theme-liquid');
        const studioSection = document.getElementById('lg-customization-studio');

        if (origBtn) origBtn.classList.toggle('active', currentDesignTheme === 'original');
        if (glassBtn) glassBtn.classList.toggle('active', currentDesignTheme === 'liquid_glass');
        if (studioSection) {
            studioSection.style.display = currentDesignTheme === 'liquid_glass' ? 'flex' : 'none';
            studioSection.style.flexDirection = 'column';
            studioSection.style.gap = '20px';
        }

        const sliderBindings = [
            ['lg-slider-intensity', 'lg-val-intensity', currentConfig.glassIntensity, '%'],
            ['lg-slider-transparency', 'lg-val-transparency', currentConfig.transparency, '%'],
            ['lg-slider-opacity', 'lg-val-opacity', currentConfig.opacity, '%'],
            ['lg-slider-blur', 'lg-val-blur', currentConfig.blurRadius, 'px'],
            ['lg-slider-saturation', 'lg-val-saturation', currentConfig.backdropSaturation, '%'],
            ['lg-slider-brightness', 'lg-val-brightness', currentConfig.brightness, '%'],
            ['lg-slider-contrast', 'lg-val-contrast', currentConfig.contrast, '%'],
            ['lg-slider-depth', 'lg-val-depth', currentConfig.visualDepth, '%'],
            ['lg-slider-highlight', 'lg-val-highlight', currentConfig.highlightIntensity, '%'],
            ['lg-slider-border-glow', 'lg-val-border-glow', currentConfig.borderGlowIntensity, '%'],
            ['lg-slider-gradient-angle', 'lg-val-gradient-angle', currentConfig.gradientAngle, '°'],
            ['lg-slider-shadow', 'lg-val-shadow', currentConfig.shadowIntensity, '%'],
            ['lg-slider-refraction', 'lg-val-refraction', currentConfig.refractionIntensity, '%'],
            ['lg-slider-anim-intensity', 'lg-val-anim-intensity', currentConfig.animationIntensity, '%'],
            ['lg-slider-corner-radius', 'lg-val-corner-radius', currentConfig.componentCornerRadius, 'px']
        ];

        sliderBindings.forEach(([inputId, valId, val, unit]) => {
            const el = document.getElementById(inputId);
            if (el && document.activeElement !== el) el.value = String(val);
            const label = document.getElementById(valId);
            if (label) label.textContent = `${val}${unit}`;
        });

        const colorBindings = [
            ['lg-color-primary', currentConfig.primaryColor],
            ['lg-color-secondary', currentConfig.secondaryColor],
            ['lg-color-glass', currentConfig.glassColor],
            ['lg-color-surface', currentConfig.surfaceToneColor],
            ['lg-color-border', currentConfig.borderColor],
            ['lg-color-icon', currentConfig.iconColor],
            ['lg-color-text', currentConfig.textColor],
            ['lg-color-accent', currentConfig.accentColor]
        ];
        colorBindings.forEach(([id, val]) => {
            const el = document.getElementById(id);
            if (el) el.value = val;
        });

        const toggleBindings = [
            ['lg-toggle-custom-colors', currentConfig.useCustomColors],
            ['lg-toggle-highlights', currentConfig.specularHighlights],
            ['lg-toggle-borders', currentConfig.luminousBorders],
            ['lg-toggle-gradient', currentConfig.surfaceGradient],
            ['lg-toggle-shadows', currentConfig.shadowsEnabled],
            ['lg-toggle-depth', currentConfig.depthEffect],
            ['lg-toggle-animations', currentConfig.animationsEnabled]
        ];
        toggleBindings.forEach(([id, val]) => {
            const el = document.getElementById(id);
            if (el) el.checked = Boolean(val);
        });

        const navSelect = document.getElementById('lg-select-nav-style');
        if (navSelect) navSelect.value = currentConfig.navBarGlassStyle;
        const cardSelect = document.getElementById('lg-select-card-style');
        if (cardSelect) cardSelect.value = currentConfig.cardGlassStyle;
    }

    function renderSavedPresetsList() {
        const container = document.getElementById('lg-saved-presets-grid');
        if (!container) return;
        const saved = loadSavedPresets();
        container.innerHTML = '';
        saved.forEach((p) => {
            const btn = document.createElement('button');
            btn.type = 'button';
            btn.className = 'lg-preset-btn';
            const title = document.createElement('strong');
            title.textContent = p.name;
            const sub = document.createElement('span');
            sub.style.fontSize = '11px';
            sub.style.opacity = '0.78';
            sub.textContent = p.subtitle || 'Preset Utente';
            btn.appendChild(title);
            btn.appendChild(sub);
            btn.addEventListener('click', () => {
                updateLiquidGlassConfig(p.config);
            });
            container.appendChild(btn);
        });
    }

    function openSettingsModal() {
        const modal = document.getElementById('lg-settings-modal-backdrop');
        if (!modal) return;
        modal.classList.add('open');
        syncSettingsDialogControls();
        renderSavedPresetsList();
    }

    function closeSettingsModal() {
        const modal = document.getElementById('lg-settings-modal-backdrop');
        if (!modal) return;
        modal.classList.remove('open');
    }

    function bindModalEvents() {
        const modal = document.getElementById('lg-settings-modal-backdrop');
        if (!modal || modal.dataset.bound === 'true') return;
        modal.dataset.bound = 'true';

        modal.addEventListener('click', (e) => {
            if (e.target === modal) closeSettingsModal();
        });

        const closeBtn = document.getElementById('lg-settings-close-btn');
        if (closeBtn) closeBtn.addEventListener('click', closeSettingsModal);

        const openBtns = document.querySelectorAll('#open-settings-btn, #auth-open-settings-btn');
        openBtns.forEach((btn) => {
            btn.addEventListener('click', (e) => {
                e.preventDefault();
                openSettingsModal();
            });
        });

        const origBtn = document.getElementById('lg-select-theme-original');
        if (origBtn) origBtn.addEventListener('click', () => setDesignTheme('original'));

        const glassBtn = document.getElementById('lg-select-theme-liquid');
        if (glassBtn) glassBtn.addEventListener('click', () => setDesignTheme('liquid_glass'));

        // Builtin presets
        const builtinGrid = document.getElementById('lg-builtin-presets-grid');
        if (builtinGrid) {
            builtinGrid.innerHTML = '';
            BUILTIN_PRESETS.forEach((preset) => {
                const btn = document.createElement('button');
                btn.type = 'button';
                btn.className = 'lg-preset-btn';
                btn.dataset.presetId = preset.id;
                btn.innerHTML = `<strong>${preset.name}</strong><span style="font-size:11px;opacity:0.78;">${preset.subtitle}</span>`;
                btn.addEventListener('click', () => {
                    updateLiquidGlassConfig(preset.config);
                });
                builtinGrid.appendChild(btn);
            });
        }

        const sliderMap = {
            'lg-slider-intensity': 'glassIntensity',
            'lg-slider-transparency': 'transparency',
            'lg-slider-opacity': 'opacity',
            'lg-slider-blur': 'blurRadius',
            'lg-slider-saturation': 'backdropSaturation',
            'lg-slider-brightness': 'brightness',
            'lg-slider-contrast': 'contrast',
            'lg-slider-depth': 'visualDepth',
            'lg-slider-highlight': 'highlightIntensity',
            'lg-slider-border-glow': 'borderGlowIntensity',
            'lg-slider-gradient-angle': 'gradientAngle',
            'lg-slider-shadow': 'shadowIntensity',
            'lg-slider-refraction': 'refractionIntensity',
            'lg-slider-anim-intensity': 'animationIntensity',
            'lg-slider-corner-radius': 'componentCornerRadius'
        };

        Object.entries(sliderMap).forEach(([id, key]) => {
            const el = document.getElementById(id);
            if (el) {
                el.addEventListener('input', (e) => {
                    updateLiquidGlassConfig({ [key]: Number(e.target.value) });
                });
            }
        });

        const colorMap = {
            'lg-color-primary': 'primaryColor',
            'lg-color-secondary': 'secondaryColor',
            'lg-color-glass': 'glassColor',
            'lg-color-surface': 'surfaceToneColor',
            'lg-color-border': 'borderColor',
            'lg-color-icon': 'iconColor',
            'lg-color-text': 'textColor',
            'lg-color-accent': 'accentColor'
        };

        Object.entries(colorMap).forEach(([id, key]) => {
            const el = document.getElementById(id);
            if (el) {
                el.addEventListener('input', (e) => {
                    updateLiquidGlassConfig({ [key]: e.target.value, useCustomColors: true });
                });
            }
        });

        const toggleMap = {
            'lg-toggle-custom-colors': 'useCustomColors',
            'lg-toggle-highlights': 'specularHighlights',
            'lg-toggle-borders': 'luminousBorders',
            'lg-toggle-gradient': 'surfaceGradient',
            'lg-toggle-shadows': 'shadowsEnabled',
            'lg-toggle-depth': 'depthEffect',
            'lg-toggle-animations': 'animationsEnabled'
        };

        Object.entries(toggleMap).forEach(([id, key]) => {
            const el = document.getElementById(id);
            if (el) {
                el.addEventListener('change', (e) => {
                    updateLiquidGlassConfig({ [key]: Boolean(e.target.checked) });
                });
            }
        });

        const navSelect = document.getElementById('lg-select-nav-style');
        if (navSelect) {
            navSelect.addEventListener('change', (e) => {
                updateLiquidGlassConfig({ navBarGlassStyle: e.target.value });
            });
        }

        const cardSelect = document.getElementById('lg-select-card-style');
        if (cardSelect) {
            cardSelect.addEventListener('change', (e) => {
                updateLiquidGlassConfig({ cardGlassStyle: e.target.value });
            });
        }

        const resetBtn = document.getElementById('lg-reset-defaults-btn');
        if (resetBtn) {
            resetBtn.addEventListener('click', () => {
                resetLiquidGlassConfig();
            });
        }

        const savePresetBtn = document.getElementById('lg-save-preset-btn');
        if (savePresetBtn) {
            savePresetBtn.addEventListener('click', () => {
                const nameInput = document.getElementById('lg-custom-preset-name');
                const name = nameInput && nameInput.value ? nameInput.value : 'Mio Liquid Glass';
                saveCustomPreset(name);
                if (nameInput) nameInput.value = '';
                renderSavedPresetsList();
            });
        }

        const exportBtn = document.getElementById('lg-export-json-btn');
        const jsonArea = document.getElementById('lg-config-json-area');
        const statusMsg = document.getElementById('lg-json-status-msg');
        if (exportBtn && jsonArea) {
            exportBtn.addEventListener('click', () => {
                const payload = JSON.stringify({
                    schema: 'photocloud.liquid_glass.v1',
                    exportedAt: new Date().toISOString(),
                    config: currentConfig
                }, null, 2);
                jsonArea.value = payload;
                if (statusMsg) statusMsg.textContent = 'Configurazione esportata nel riquadro sottostante.';
            });
        }

        const importBtn = document.getElementById('lg-import-json-btn');
        if (importBtn && jsonArea) {
            importBtn.addEventListener('click', () => {
                try {
                    const parsed = JSON.parse(jsonArea.value || '{}');
                    const rawCfg = parsed && parsed.config ? parsed.config : parsed;
                    if (!rawCfg || typeof rawCfg !== 'object') throw new Error('Formato non valido');
                    updateLiquidGlassConfig(rawCfg);
                    if (statusMsg) statusMsg.textContent = 'Configurazione Liquid Glass importata e applicata in tempo reale.';
                } catch {
                    if (statusMsg) statusMsg.textContent = 'JSON non valido: verifica il contenuto incollato.';
                }
            });
        }
    }

    window.PhotoCloudThemeManager = {
        getDesignTheme: () => currentDesignTheme,
        setDesignTheme,
        getConfig: () => Object.assign({}, currentConfig),
        updateConfig: updateLiquidGlassConfig,
        resetConfig: resetLiquidGlassConfig,
        openSettingsModal,
        closeSettingsModal,
        refresh: applyThemeAndVariables
    };

    document.addEventListener('DOMContentLoaded', () => {
        applyThemeAndVariables();
        bindModalEvents();
    });
})();
