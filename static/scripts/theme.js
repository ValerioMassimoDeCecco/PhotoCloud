/**
 * PhotoCloud — Tema e colore d'accento.
 *
 * Gestisce:
 *  - scelta tra tema chiaro, scuro e sistema (prefers-color-scheme);
 *  - colore d'accento personalizzabile tramite palette predefinita,
 *    selettore colore e input HEX con anteprima live;
 * * applicazione live attraverso variabili CSS (--accent e derivate);
 *  - persistenza delle scelte in localStorage, lo stesso meccanismo già
 *    usato dal progetto per il tema.
 *
 * Nessuna dipendenza esterna: solo JavaScript vanilla.
 */

(function () {
    const THEME_STORAGE_KEY = 'theme';
    const ACCENT_STORAGE_KEY = 'photocloud_accent';

    const DEFAULT_ACCENT_LIGHT = '#1a73e8';
    const DEFAULT_ACCENT_DARK = '#8ab4f8';

    const ACCENT_PALETTE = [
        { id: 'default', label: 'Predefinito', hex: '#1a73e8' },
        { id: 'green', label: 'Verde', hex: '#188038' },
        { id: 'terracotta', label: 'Terracotta', hex: '#b3261e' },
        { id: 'amber', label: 'Ambra', hex: '#f9a825' },
        { id: 'indigo', label: 'Indaco', hex: '#6366f1' },
        { id: 'teal', label: 'Verde acqua', hex: '#00897b' },
        { id: 'rose', label: 'Rosa', hex: '#c2185b' },
        { id: 'slate', label: 'Antracite', hex: '#5f6368' },
    ];

    const THEME_ORDER = ['light', 'dark', 'system'];
    const THEME_ICONS = { light: 'light_mode', dark: 'dark_mode', system: 'brightness_auto' };
    const THEME_TITLES = {
        light: 'Tema chiaro attivo',
        dark: 'Tema scuro attivo',
        system: 'Tema di sistema attivo',
    };

    const prefersDarkMedia = window.matchMedia('(prefers-color-scheme: dark)');
    let themeMode = localStorage.getItem(THEME_STORAGE_KEY);

    /* ---------- Utilità colore ---------- */

    function parseHex(hex) {
        let h = String(hex).replace('#', '');
        if (h.length === 3) {
            h = h.split('').map((c) => c + c).join('');
        }
        if (h.length !== 6 || !/^[0-9a-fA-F]{6}$/.test(h)) {
            return null;
        }
        return {
            r: parseInt(h.slice(0, 2), 16),
            g: parseInt(h.slice(2, 4), 16),
            b: parseInt(h.slice(4, 6), 16),
            hex: '#' + h.toLowerCase(),
        };
    }

    function linearize(c) {
        c = c / 255;
        return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
    }

    function luminance(r, g, b) {
        return (
            0.2126 * linearize(r) + 0.7152 * linearize(g) + 0.0722 * linearize(b)
        );
    }

    function rgbToHsl(r, g, b) {
        r /= 255;
        g /= 255;
        b /= 255;
        const max = Math.max(r, g, b);
        const min = Math.min(r, g, b);
        let h = 0;
        let s = 0;
        const l = (max + min) / 2;

        if (max !== min) {
            const d = max - min;
            s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
            switch (max) {
                case r:
                    h = (g - b) / d + (g < b ? 6 : 0);
                    break;
                case g:
                    h = (b - r) / d + 2;
                    break;
                default:
                    h = (r - g) / d + 4;
                    break;
            }
            h /= 6;
        }
        return { h: h * 360, s: s * 100, l: l * 100 };
    }

    function hue2rgb(p, q, t) {
        if (t < 0) t += 1;
        if (t > 1) t -= 1;
        if (t < 1 / 6) return p + (q - p) * 6 * t;
        if (t < 1 / 2) return q;
        if (t < 2 / 3) return p + (q - p) * (2 / 3 - t) * 6;
        return p;
    }

    function hslToRgb(h, s, l) {
        h /= 360;
        s /= 100;
        l /= 100;
        let r = l;
        let g = l;
        let b = l;
        if (s !== 0) {
            const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
            const p = 2 * l - q;
            r = hue2rgb(p, q, h + 1 / 3);
            g = hue2rgb(p, q, h);
            b = hue2rgb(p, q, h - 1 / 3);
        }
        return {
            r: Math.round(r * 255),
            g: Math.round(g * 255),
            b: Math.round(b * 255),
        };
    }

    function formatHex(r, g, b) {
        return (
            '#' +
            [r, g, b]
                .map((v) => v.toString(16).padStart(2, '0'))
                .join('')
        );
    }

    function darken(hex, amount) {
        const c = parseHex(hex);
        if (!c) return hex;
        const hsl = rgbToHsl(c.r, c.g, c.b);
        const rgb = hslToRgb(
            hsl.h,
            hsl.s,
            Math.max(0, Math.min(100, hsl.l - amount * 100))
        );
        return formatHex(rgb.r, rgb.g, rgb.b);
    }

    /* ---------- Applicazione token colore ---------- */

    function accentTokens(hex) {
        const c = parseHex(hex);
        if (!c) return;

        const lum = luminance(c.r, c.g, c.b);
        // Testo su accento: chiaro su tinte scure, scuro su tinte chiare.
        const onAccent = lum > 0.5 ? '#0b2540' : '#ffffff';
        // Testo su fondo tinto con l'accento.
        const onContainer = lum > 0.55 ? '#1a1a1a' : c.hex;

        const body = document.body;
        body.style.setProperty('--accent', c.hex);
        body.style.setProperty('--accent-rgb', `${c.r}, ${c.g}, ${c.b}`);
        body.style.setProperty('--on-accent', onAccent);
        body.style.setProperty('--accent-container', `rgba(${c.r}, ${c.g}, ${c.b}, 0.14)`);
        body.style.setProperty('--on-accent-container', onContainer);
        body.style.setProperty('--accent-hover', darken(c.hex, 0.18));
    }

    function resetAccent() {
        const body = document.body;
        [
            '--accent',
            '--accent-rgb',
            '--on-accent',
            '--accent-container',
            '--on-accent-container',
            '--accent-hover',
        ].forEach((prop) => body.style.removeProperty(prop));
        localStorage.removeItem(ACCENT_STORAGE_KEY);
    }

    function currentAccent() {
        return getComputedStyle(document.body).getPropertyValue('--accent').trim();
    }

    function defaultAccentFor(mode) {
        return mode === 'dark' ? DEFAULT_ACCENT_DARK : DEFAULT_ACCENT_LIGHT;
    }

    /* ---------- Tema chiaro / scuro / sistema ---------- */

    function setThemeMode(mode, save = true) {
        themeMode = mode;
        const effective =
            mode === 'system'
                ? prefersDarkMedia.matches ? 'dark' : 'light'
                : mode;

        document.body.classList.toggle('dark-mode', effective === 'dark');

        if (save) {
            localStorage.setItem(THEME_STORAGE_KEY, mode);
        }
        syncToggleButton();
        syncPanelThemeUI();
    }

    function nextThemeMode(mode) {
        return THEME_ORDER[(THEME_ORDER.indexOf(mode) + 1) % THEME_ORDER.length];
    }

    function syncToggleButton() {
        const btn = document.getElementById('theme-toggle-btn');
        if (!btn) return;
        const icon = btn.querySelector('.material-icons');
        if (icon) {
            icon.textContent = THEME_ICONS[themeMode] || 'light_mode';
        }
        btn.title = THEME_TITLES[themeMode] || '';
    }

    function syncPanelThemeUI() {
        document.querySelectorAll('#theme-settings .segment').forEach((seg) => {
            const active = seg.dataset.theme === themeMode;
            seg.classList.toggle('pressed', active);
            seg.setAttribute('aria-checked', active);
        });
    }

    function onSystemChange() {
        if (themeMode === 'system') {
            setThemeMode('system', false);
        }
    }

    /* ---------- Pannello impostazioni ---------- */

    const panel = document.getElementById('theme-settings');
    const openBtn = document.getElementById('theme-settings-btn');
    const closeBtns = document.querySelectorAll(
        '#theme-settings-close, #theme-settings-close-btn'
    );
    const backdrop = panel ? panel.querySelector('.theme-settings-backdrop') : null;

    function openPanel() {
        if (!panel) return;
        panel.classList.add('open');
        panel.setAttribute('aria-hidden', 'false');
        refreshPanelUI();
        document.addEventListener('keydown', onPanelKeydown);
    }

    function closePanel() {
        if (!panel) return;
        panel.classList.remove('open');
        panel.setAttribute('aria-hidden', 'true');
        document.removeEventListener('keydown', onPanelKeydown);
        if (openBtn) {
            openBtn.focus();
        }
    }

    function onPanelKeydown(event) {
        if (event.key === 'Escape') {
            closePanel();
        }
    }

    function refreshPanelUI() {
        syncPanelThemeUI();

        const eff = currentAccent();
        const hexInput = document.getElementById('accent-hex');
        const colorPicker = document.getElementById('accent-color-picker');
        if (hexInput) hexInput.value = eff;
        if (colorPicker) colorPicker.value = eff;

        document.querySelectorAll('#theme-settings .accent-swatch').forEach((sw) => {
            const active = sw.dataset.hex.toLowerCase() === eff.toLowerCase();
            sw.classList.toggle('pressed', active);
            sw.setAttribute('aria-checked', active);
        });
    }

    function renderPalette() {
        const container = document.querySelector('#theme-settings .accent-palette');
        if (!container) return;
        container.innerHTML = ACCENT_PALETTE.map(
            (c) =>
                `<button type="button" class="accent-swatch" role="radio" data-hex="${c.hex}" aria-label="${c.label}, ${c.hex}">
                    <span class="color-dot" style="background:${c.hex}"></span>
                    <span class="accent-name">${c.label}</span>
                    <span class="material-icons accent-check">done</span>
                 </button>`
        ).join('');
        container.addEventListener('click', (event) => {
            const sw = event.target.closest('.accent-swatch');
            if (sw) {
                applyAccentFromUI(sw.dataset.hex);
            }
        });
    }

    function applyAccentFromUI(hex) {
        const errorEl = document.getElementById('accent-error');
        const c = parseHex(hex);
        if (!c) {
            if (errorEl) errorEl.textContent = 'Codice HEX non valido.';
            return;
        }
        if (errorEl) errorEl.textContent = '';
        accentTokens(c.hex);
        localStorage.setItem(ACCENT_STORAGE_KEY, c.hex);
        refreshPanelUI();
    }

    function bindControls() {
        // Comando rapido tema (galleria): cicla chiaro → scuro → sistema → chiaro
        const toggleBtn = document.getElementById('theme-toggle-btn');
        if (toggleBtn) {
            toggleBtn.addEventListener('click', () => {
                setThemeMode(nextThemeMode(themeMode));
            });
        }

        // Apertura/chiusura pannello
        if (openBtn) {
            openBtn.addEventListener('click', (event) => {
                event.stopPropagation();
                openPanel();
            });
        }
        closeBtns.forEach((btn) => {
            btn.addEventListener('click', closePanel);
        });
        if (backdrop) {
            backdrop.addEventListener('click', closePanel);
        }
        if (panel) {
            panel.addEventListener('click', (event) => {
                if (event.target === panel) {
                    closePanel();
                }
            });
        }

        // Segmenti aspetto dentro il pannello
        document.querySelectorAll('#theme-settings .segment').forEach((seg) => {
            seg.addEventListener('click', () => {
                setThemeMode(seg.dataset.theme);
            });
        });

        // Colore personalizzato: anteprima immediata
        const hexInput = document.getElementById('accent-hex');
        const colorPicker = document.getElementById('accent-color-picker');
        const applyBtn = document.getElementById('accent-apply');
        const resetBtn = document.getElementById('accent-reset');

        if (hexInput) {
            hexInput.addEventListener('input', () => {
                applyAccentFromUI(hexInput.value);
            });
        }
        if (colorPicker) {
            colorPicker.addEventListener('input', () => {
                applyAccentFromUI(colorPicker.value);
            });
        }
        if (applyBtn) {
            applyBtn.addEventListener('click', () => {
                if (hexInput) applyAccentFromUI(hexInput.value);
            });
        }
        if (resetBtn) {
            resetBtn.addEventListener('click', () => {
                resetAccent();
                refreshPanelUI();
            });
        }
    }

    /* ---------- Inizializzazione ---------- */

    document.addEventListener('DOMContentLoaded', () => {
        const savedTheme =
            localStorage.getItem(THEME_STORAGE_KEY) ||
            (prefersDarkMedia.matches ? 'dark' : 'light');
        setThemeMode(savedTheme, false);
        prefersDarkMedia.addEventListener('change', onSystemChange);

        const storedAccent = localStorage.getItem(ACCENT_STORAGE_KEY);
        if (storedAccent && parseHex(storedAccent)) {
            accentTokens(storedAccent);
        }

        renderPalette();
        bindControls();
        syncToggleButton();
    });
})();
