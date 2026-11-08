import fs from 'node:fs';
import path from 'node:path';
import { MediaItem } from '../types';

function readTemplate(filename: string): string {
  return fs.readFileSync(path.resolve(process.cwd(), 'templates', filename), 'utf-8');
}

function escapeHtml(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function renderWithBase(stylesBlock: string, contentBlock: string, scriptsBlock: string): string {
  let base = readTemplate('base.html');
  base = base.replace(
    /\{\{\s*url_for\('static',\s*filename='([^']+)'\)\s*\}\}/g,
    '/static/$1'
  );
  base = base.replace('{% block styles %}{% endblock %}', stylesBlock);
  base = base.replace('{% block content %}{% endblock %}', contentBlock);
  base = base.replace('{% block scripts %}{% endblock %}', scriptsBlock);
  return base;
}

export function renderLoginTemplate(): string {
  const raw = readTemplate('login.html');
  const stylesMatch = raw.match(/\{%\s*block styles\s*%\}([\s\S]*?)\{%\s*endblock\s*%\}/);
  const contentMatch = raw.match(/\{%\s*block content\s*%\}([\s\S]*?)\{%\s*endblock\s*%\}/);
  const scriptsMatch = raw.match(/\{%\s*block scripts\s*%\}([\s\S]*?)\{%\s*endblock\s*%\}/);

  const styles = (stylesMatch?.[1] || '').replace(
    /\{\{\s*url_for\('static',\s*filename='([^']+)'\)\s*\}\}/g,
    '/static/$1'
  );
  const content = contentMatch?.[1] || '';
  const scripts = scriptsMatch?.[1] || '';

  return renderWithBase(styles, content, scripts);
}

export function renderGalleryTemplate(mediaFiles: MediaItem[]): string {
  const filenames = mediaFiles.map((m) => m.filename);
  const filenamesJson = JSON.stringify(filenames);

  const cardsHtml = mediaFiles
    .map((media, index) => {
      const file = escapeHtml(media.filename);
      const ext = file.split('.').pop()?.toLowerCase() || '';
      const isImg = ['jpg', 'jpeg', 'png', 'gif', 'webp'].includes(ext);

      const mediaTag = isImg
        ? `<img src="/media/${encodeURIComponent(media.filename)}" alt="${file}" loading="lazy">`
        : `<video preload="metadata">
                        <source src="/media/${encodeURIComponent(media.filename)}#t=0.5" type="video/mp4">
                    </video>
                    <div class="video-overlay"><span class="material-icons">play_circle</span></div>`;

      return `
        <div class="media-card-wrapper" data-timestamp="${media.timestamp}">
            <div class="media-card clickable-media" data-index="${index}">
                ${mediaTag}
                <div class="media-actions">
                    <form action="/trash/${encodeURIComponent(media.filename)}" method="POST" class="delete-form" data-filename="${file}">
                        <button type="submit" class="btn icon danger" title="Sposta nel Cestino" onclick="handleDelete(event, this)">
                            <span class="material-icons">delete</span>
                        </button>
                    </form>
                </div>
            </div>
            <div class="selection-overlay"></div>
            <input type="checkbox" class="media-checkbox" data-filename="${file}" onclick="event.stopPropagation();">
        </div>`;
    })
    .join('\n');

  const styles = `<link rel="stylesheet" href="/static/styles/gallery.css">`;

  const content = `
<div class="gallery-container">
    <header class="gallery-header">
        <div class="header-content">
            <div>
                <h1>Il tuo archivio</h1>
                <p id="media-count">${mediaFiles.length} elementi</p>
            </div>
            <div class="header-actions">
                <div class="grouping-controls btn outlined">
                    <span class="material-icons">sort</span>
                    <select id="group-by-select" class="btn-like-select">
                        <option value="none">Nessun gruppo</option>
                        <option value="day">Per Giorno</option>
                        <option value="month" selected>Per Mese</option>
                        <option value="year">Per Anno</option>
                    </select>
                </div>

                <button class="btn outlined" id="select-all-btn" title="Seleziona Tutto" style="display: none;">
                    <span class="material-icons">select_all</span>
                    <span class="btn-text">Seleziona Tutto</span>
                </button>
                <button class="btn primary" id="download-selected-btn" title="Scarica Selezionati" style="display: none;">
                    <span class="material-icons">download</span>
                    <span class="btn-text">Scarica</span> (<span id="selected-count">0</span>)
                </button>
                <button class="btn danger" id="delete-selected-btn" title="Sposta Selezionati nel Cestino" style="display: none;">
                    <span class="material-icons">delete_sweep</span>
                    <span class="btn-text">Sposta nel Cestino</span>
                </button>

                <form action="/upload" method="POST" enctype="multipart/form-data" class="upload-form" id="upload-form">
                    <input type="file" id="file-input" name="file[]" accept="image/*,video/*" hidden multiple>
                    <label for="file-input" class="btn outlined" id="upload-label">
                        <span class="material-icons">add_photo_alternate</span>
                        Carica
                    </label>
                </form>

                <button class="btn outlined" id="find-duplicates-btn" title="Trova Duplicati">
                    <span class="material-icons">manage_search</span>
                </button>
                <a href="/trash" class="btn icon" title="Cestino">
                    <span class="material-icons">delete_outline</span>
                </a>

                <button class="btn icon" id="theme-toggle-btn" title="Passa a tema scuro">
                    <span class="material-icons">light_mode</span>
                </button>

                <button class="btn icon" id="logout-btn" title="Esci">
                    <span class="material-icons">logout</span>
                </button>
            </div>
        </div>
        <div id="scan-status-container" class="scan-status-container" style="display: none;">
            <div id="scan-progress-details">
                <p id="scan-main-status">Inizio scansione...</p>
                <progress id="scan-progress-bar" value="0" max="100"></progress>
                <div class="scan-counters">
                    <span id="scan-progress-text">File: 0 / ?</span>
                    <span id="scan-duplicates-found">Duplicati trovati: 0</span>
                </div>
            </div>
        </div>
    </header>

    <div class="gallery-grid" data-media-files='${filenamesJson}'>
        ${cardsHtml}
    </div>
</div>

<!-- INDICATORE DI UPLOAD FLUTTUANTE -->
<div id="upload-indicator-container" class="upload-indicator-container" style="display: none;">
    <div id="upload-gem" class="upload-gem">
        <svg class="upload-progress-ring" width="56" height="56">
            <circle class="progress-ring-track" cx="28" cy="28" r="24"></circle>
            <circle id="upload-progress-arc" class="progress-ring-arc" cx="28" cy="28" r="24"></circle>
        </svg>
        <span id="upload-indicator-icon" class="material-icons">upload</span>
        <span id="upload-indicator-percentage">0%</span>
    </div>

    <div id="upload-details-card" class="upload-details-card">
        <header class="upload-card-header">
            <h3 id="upload-card-title">In caricamento...</h3>
            <button id="upload-close-btn" class="btn icon" title="Chiudi">
                <span class="material-icons">expand_more</span>
            </button>
        </header>
        <div class="upload-card-body">
            <ul id="upload-file-list" class="upload-file-list">
            </ul>
        </div>
        <footer class="upload-card-footer">
            <p id="upload-card-status">Preparazione...</p>
        </footer>
    </div>
</div>

<form action="/logout" method="POST" id="logout-form" style="display:none;"></form>
`;

  const scripts = `
<script src="/static/scripts/duplicates.js"></script>
<script src="/static/scripts/selection.js"></script>
<script src="/static/scripts/upload.js"></script>
<script src="/static/scripts/grouping.js"></script>

<script>
    document.addEventListener('DOMContentLoaded', () => {
        const themeToggleBtn = document.getElementById('theme-toggle-btn');
        if (!themeToggleBtn) return;

        const body = document.body;
        const icon = themeToggleBtn.querySelector('.material-icons');

        const applyTheme = (theme) => {
            if (theme === 'dark') {
                body.classList.add('dark-mode');
                icon.textContent = 'dark_mode';
                themeToggleBtn.title = 'Passa a tema chiaro';
            } else {
                body.classList.remove('dark-mode');
                icon.textContent = 'light_mode';
                themeToggleBtn.title = 'Passa a tema scuro';
            }
        };

        const toggleTheme = () => {
            const newTheme = body.classList.contains('dark-mode') ? 'light' : 'dark';
            localStorage.setItem('theme', newTheme);
            applyTheme(newTheme);
        };

        const savedTheme = localStorage.getItem('theme');
        const prefersDark = window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches;
        applyTheme(savedTheme || (prefersDark ? 'dark' : 'light'));
        themeToggleBtn.addEventListener('click', toggleTheme);
    });
</script>

<script>
    document.addEventListener('DOMContentLoaded', () => {
        const groupingControls = document.querySelector('.grouping-controls');
        if (groupingControls) {
            groupingControls.style.display = 'flex';
        }

        const logoutBtn = document.getElementById('logout-btn');
        if (logoutBtn) {
            logoutBtn.addEventListener('click', () => document.getElementById('logout-form').submit());
        }

        const galleryGrid = document.querySelector('.gallery-grid');
        if (galleryGrid) {
            const mediaFiles = JSON.parse(galleryGrid.dataset.mediaFiles || '[]');
            galleryGrid.addEventListener('click', (event) => {
                const clickedCard = event.target.closest('.clickable-media');
                if (clickedCard && !event.target.closest('.delete-form') && !event.target.matches('.media-checkbox')) {
                    const index = parseInt(clickedCard.dataset.index, 10);
                    const filename = mediaFiles[index];
                    const isVideo = /\\.(mp4|mov|avi|mkv)$/i.test(filename);
                    const url = \`/media/\${filename}\`;
                    if (window.openLightbox) {
                        window.openLightbox(url, isVideo, index, mediaFiles);
                    }
                }
            });
        }
    });

    async function handleDelete(event, button) {
        event.stopPropagation();
        event.preventDefault();
        
        if (!confirm('Spostare questo elemento nel cestino?')) return;
        
        const form = button.closest('form');
        const cardWrapper = form.closest('.media-card-wrapper');
        
        try {
            const response = await fetch(form.action, {
                method: 'POST',
                headers: { 
                    'Accept': 'application/json',
                    'Content-Type': 'application/json'
                }
            });
            
            const result = await response.json();

            if (result.success) {
                cardWrapper.style.transition = 'opacity 0.3s ease, transform 0.3s ease';
                cardWrapper.style.opacity = '0';
                cardWrapper.style.transform = 'scale(0.8)';
                setTimeout(() => {
                    cardWrapper.remove();
                    const countElement = document.getElementById('media-count');
                    let currentCount = parseInt(countElement.textContent) || 0;
                    countElement.textContent = \`\${Math.max(0, currentCount - 1)} elementi\`;
                }, 300);
            } else {
                alert(\`Errore: \${result.error || 'Impossibile spostare il file nel cestino'}\`);
            }
        } catch (error) {
            alert('Errore di comunicazione con il server.');
            console.error('Errore durante lo spostamento nel cestino:', error);
        }
    }
</script>
`;

  return renderWithBase(styles, content, scripts);
}

export function renderTrashTemplate(trashedFiles: MediaItem[]): string {
  const styles = `<link rel="stylesheet" href="/static/styles/gallery.css">`;

  const emptyBtnHtml =
    trashedFiles.length > 0
      ? `<button class="btn danger" id="empty-trash-btn">
                    <span class="material-icons">delete_sweep</span>
                    Svuota Cestino
                </button>`
      : '';

  const itemsHtml =
    trashedFiles.length === 0
      ? `<div class="empty-state">
                    <span class="material-icons">delete_sweep</span>
                    <h3>Il cestino è vuoto</h3>
                    <p>I file eliminati appariranno qui.</p>
                </div>`
      : trashedFiles
          .map((media) => {
            const file = escapeHtml(media.filename);
            const ext = file.split('.').pop()?.toLowerCase() || '';
            const isImg = ['jpg', 'jpeg', 'png'].includes(ext);
            const mediaTag = isImg
              ? `<img src="/media/${encodeURIComponent(media.filename)}?from_trash=true" alt="${file}" loading="lazy">`
              : `<video preload="metadata">
                                <source src="/media/${encodeURIComponent(media.filename)}?from_trash=true#t=0.5" type="video/mp4">
                            </video>`;

            return `
                <div class="media-card-wrapper">
                    <div class="media-card">
                        ${mediaTag}
                        <div class="media-actions">
                            <button class="btn icon restore-btn" title="Ripristina" data-filename="${file}">
                                <span class="material-icons">restore_from_trash</span>
                            </button>
                            <button class="btn icon danger permanent-delete-btn" title="Elimina Definitivamente" data-filename="${file}">
                                <span class="material-icons">delete_forever</span>
                            </button>
                        </div>
                    </div>
                </div>`;
          })
          .join('\n');

  const content = `
<div class="gallery-container">
    <header class="gallery-header">
        <div class="header-content">
            <div>
                <h1>Cestino</h1>
                <p id="media-count">${trashedFiles.length} elementi</p>
            </div>
            <div class="header-actions">
                <a href="/" class="btn outlined">
                    <span class="material-icons">arrow_back</span>
                    Torna alla galleria
                </a>
                ${emptyBtnHtml}
            </div>
        </div>
    </header>

    <div class="gallery-grid">
        <div class="media-group">
             <div class="media-group-grid">
                ${itemsHtml}
            </div>
        </div>
    </div>
</div>
`;

  const scripts = `<script src="/static/scripts/trash.js"></script>`;

  return renderWithBase(styles, content, scripts);
}
