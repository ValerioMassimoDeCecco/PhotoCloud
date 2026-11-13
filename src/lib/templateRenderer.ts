import fs from 'node:fs';
import path from 'node:path';
import { MediaItem } from '../types';

const TEMPLATE_CACHE = new Map<string, { mtimeMs: number; content: string }>();

function readTemplate(filename: string): string {
  const fullPath = path.resolve(process.cwd(), 'templates', filename);
  try {
    const stat = fs.statSync(fullPath);
    const cached = TEMPLATE_CACHE.get(fullPath);
    if (cached && cached.mtimeMs === stat.mtimeMs) {
      return cached.content;
    }
    const content = fs.readFileSync(fullPath, 'utf-8');
    TEMPLATE_CACHE.set(fullPath, { mtimeMs: stat.mtimeMs, content });
    return content;
  } catch {
    return fs.readFileSync(fullPath, 'utf-8');
  }
}

export function escapeHtml(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

export interface CloudStorageStats {
  mediaBytes: number;
  mediaCount: number;
  filesBytes: number;
  filesCount: number;
  activeBytes: number;
  activeTotalBytes: number;
  activeCount: number;
  trashBytes: number;
  trashCount: number;
  grandTotalBytes: number;
  grandTotalCount: number;
  mediaPct: number;
  filesPct: number;
  trashPct: number;
  mediaPercent: number;
  filesPercent: number;
  trashPercent: number;
  mediaFormatted: string;
  filesFormatted: string;
  activeTotalFormatted: string;
  trashFormatted: string;
  grandTotalFormatted: string;
}

export function formatFileSize(bytes?: number): string {
  if (!bytes || bytes <= 0) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  const i = Math.min(units.length - 1, Math.floor(Math.log(bytes) / Math.log(1024)));
  return `${(bytes / Math.pow(1024, i)).toFixed(i === 0 ? 0 : (i >= 3 ? 2 : 1))} ${units[i]}`;
}

export function computeCloudStorageStats(
  activeFiles: MediaItem[] = [],
  trashedFiles: MediaItem[] = []
): CloudStorageStats {
  let mediaBytes = 0;
  let mediaCount = 0;
  let filesBytes = 0;
  let filesCount = 0;

  for (const item of activeFiles) {
    const ext = (item.filename || '').split('.').pop()?.toLowerCase() || '';
    const isImg = ['jpg', 'jpeg', 'png', 'gif', 'webp', 'bmp', 'svg', 'heic', 'avif'].includes(ext);
    const isVid = ['mp4', 'mov', 'webm', 'mkv'].includes(ext);
    const isMedia = item.isMedia !== undefined ? Boolean(item.isMedia) : isImg || isVid;
    const sz = Math.max(0, Number(item.size) || 0);
    if (isMedia) {
      mediaBytes += sz;
      mediaCount += 1;
    } else {
      filesBytes += sz;
      filesCount += 1;
    }
  }

  let trashBytes = 0;
  let trashCount = 0;
  for (const item of trashedFiles) {
    trashBytes += Math.max(0, Number(item.size) || 0);
    trashCount += 1;
  }

  const activeBytes = mediaBytes + filesBytes;
  const activeCount = mediaCount + filesCount;
  const grandTotalBytes = activeBytes + trashBytes;
  const grandTotalCount = activeCount + trashCount;

  const mediaPct = grandTotalBytes > 0 ? Number(((mediaBytes / grandTotalBytes) * 100).toFixed(1)) : 0;
  const filesPct = grandTotalBytes > 0 ? Number(((filesBytes / grandTotalBytes) * 100).toFixed(1)) : 0;
  const trashPct = grandTotalBytes > 0 ? Number(((trashBytes / grandTotalBytes) * 100).toFixed(1)) : 0;

  return {
    mediaBytes,
    mediaCount,
    filesBytes,
    filesCount,
    activeBytes,
    activeTotalBytes: activeBytes,
    activeCount,
    trashBytes,
    trashCount,
    grandTotalBytes,
    grandTotalCount,
    mediaPct,
    filesPct,
    trashPct,
    mediaPercent: mediaPct,
    filesPercent: filesPct,
    trashPercent: trashPct,
    mediaFormatted: formatFileSize(mediaBytes),
    filesFormatted: formatFileSize(filesBytes),
    activeTotalFormatted: formatFileSize(activeBytes),
    trashFormatted: formatFileSize(trashBytes),
    grandTotalFormatted: formatFileSize(grandTotalBytes),
  };
}

function getCategoryIcon(category?: string, ext?: string): string {
  if (category === 'document') return ext === 'pdf' ? 'picture_as_pdf' : 'description';
  if (category === 'archive') return ext === 'apk' ? 'android' : 'folder_zip';
  if (category === 'audio') return 'audiotrack';
  if (category === 'code') return 'code';
  return 'insert_drive_file';
}

function getStaticAssetVersion(relPath: string): string {
  try {
    const fullPath = path.resolve(process.cwd(), 'static', relPath);
    const stat = fs.statSync(fullPath);
    return String(Math.floor(stat.mtimeMs));
  } catch {
    return '1';
  }
}

export interface RenderMediaCardOptions {
  fromTrash: boolean;
  isFavorite: boolean;
}

export function renderMediaCardHtml(
  item: MediaItem,
  index: number,
  { fromTrash, isFavorite }: RenderMediaCardOptions
): string {
  const file = escapeHtml(item.filename);
  const encodedFilename = encodeURIComponent(item.filename);
  const ext = file.split('.').pop()?.toLowerCase() || '';
  const isImg = (
    fromTrash
      ? ['jpg', 'jpeg', 'png', 'gif', 'webp', 'bmp', 'heic']
      : ['jpg', 'jpeg', 'png', 'gif', 'webp', 'bmp', 'svg', 'heic', 'avif']
  ).includes(ext);
  const isVid = ['mp4', 'mov', 'webm', 'mkv'].includes(ext);
  const isMedia = item.isMedia !== undefined ? item.isMedia : isImg || isVid;
  const rawCategory = item.category || (isMedia ? 'media' : 'other');
  const category = escapeHtml(rawCategory);
  const album = escapeHtml(item.album || '');
  const sizeBytes = Number(item.size) || 0;
  const humanSize = formatFileSize(sizeBytes);

  let mediaTag = '';
  if (isImg) {
    mediaTag = `<img src="/media/${encodedFilename}${fromTrash ? '?from_trash=true' : ''}" alt="${file}" loading="lazy">`;
  } else if (isVid) {
    const videoMime = fromTrash
      ? 'video/mp4'
      : ext === 'webm'
      ? 'video/webm'
      : ext === 'mov'
      ? 'video/quicktime'
      : ext === 'mkv'
      ? 'video/x-matroska'
      : 'video/mp4';
    mediaTag = fromTrash
      ? `<video preload="metadata">
                                <source src="/media/${encodedFilename}?from_trash=true#t=0.5" type="${videoMime}">
                            </video>`
      : `<video preload="metadata" muted playsinline>
                        <source src="/media/${encodedFilename}#t=0.5" type="${videoMime}">
                    </video>
                    <div class="video-overlay"><span class="material-icons">play_circle</span></div>`;
  } else {
    const iconName = escapeHtml(getCategoryIcon(rawCategory, ext));
    mediaTag = fromTrash
      ? `<div class="cloud-file-preview" data-category="${category}">
                            <div class="cloud-file-icon-wrap">
                                <span class="material-icons">${iconName}</span>
                                <span class="cloud-file-ext">${escapeHtml(ext.toUpperCase() || 'FILE')}</span>
                            </div>
                            <div class="cloud-file-meta">
                                <span class="cloud-file-title">${file}</span>
                                <span class="cloud-file-sub">${humanSize}</span>
                            </div>
                        </div>`
      : `<div class="cloud-file-preview" data-category="${category}">
                        <div class="cloud-file-icon-wrap">
                            <span class="material-icons">${iconName}</span>
                            <span class="cloud-file-ext">${escapeHtml(ext.toUpperCase() || 'FILE')}</span>
                        </div>
                        <div class="cloud-file-meta">
                            <span class="cloud-file-title" title="${file}">${file}</span>
                            <span class="cloud-file-sub">${humanSize}${album ? ` • ${album}` : ''}</span>
                        </div>
                    </div>`;
  }

  if (fromTrash) {
    return `
                <div class="media-card-wrapper" data-size="${sizeBytes}" data-category="${category}">
                    <div class="media-card clickable-media" data-filename="${file}">
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
  }

  const albumBadge =
    album && isMedia
      ? `<span class="media-album-badge" title="Album: ${album}"><span class="material-icons">photo_album</span>${album}</span>`
      : '';

  const favoriteBadge = isMedia
    ? `<button type="button" class="media-fav-badge ${isFavorite ? 'is-favourite' : ''}" title="${isFavorite ? 'Rimuovi dai Preferiti' : 'Aggiungi ai Preferiti'}" aria-label="Preferito" onclick="window.toggleFavoriteFromGallery && window.toggleFavoriteFromGallery(this.closest('[data-filename]').dataset.filename, event)"><span class="material-icons">${isFavorite ? 'star' : 'star_border'}</span></button>`
    : '';

  return `
        <div class="media-card-wrapper ${isMedia ? 'is-media-item' : 'is-cloud-file'}"
             data-timestamp="${Number(item.timestamp) || 0}"
             data-filename="${file}"
             data-size="${sizeBytes}"
             data-is-media="${isMedia ? 'true' : 'false'}"
             data-category="${category}"
             data-album="${album}"
             data-favorite="${isFavorite ? 'true' : 'false'}">
            <div class="media-card ${isMedia ? 'clickable-media' : 'clickable-cloud-file'}" data-index="${index}" data-filename="${file}">
                ${mediaTag}
                ${albumBadge}
                ${favoriteBadge}
                <div class="media-actions">
                    ${
                      isImg || isVid
                        ? `<button type="button" class="btn icon edit-photo-btn" title="${isVid ? 'Modifica Video' : 'Modifica Foto'}" aria-label="Modifica ${file}" onclick="window.openPhotoEditor && window.openPhotoEditor(this.closest('[data-filename]').dataset.filename, event)">
                            <span class="material-icons">tune</span>
                        </button>`
                        : ''
                    }
                    ${
                      !isMedia
                        ? `<button type="button" class="btn icon open-doc-btn" title="Apri documento o file" aria-label="Apri ${file}" onclick="window.openCloudFile && window.openCloudFile(this.closest('[data-filename]').dataset.filename, ${sizeBytes}, false, event)">
                            <span class="material-icons">open_in_new</span>
                        </button>`
                        : ''
                    }
                    <form action="/trash/${encodedFilename}" method="POST" class="delete-form" data-filename="${file}">
                        <button type="submit" class="btn icon danger" title="Sposta nel Cestino" onclick="handleDelete(event, this)">
                            <span class="material-icons">delete</span>
                        </button>
                    </form>
                </div>
            </div>
            <div class="selection-overlay"></div>
            <input type="checkbox" class="media-checkbox" data-filename="${file}" onclick="event.stopPropagation();">
        </div>`;
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

export function renderLoginTemplate(errorMessage?: string): string {
  const raw = readTemplate('login.html');
  const stylesMatch = raw.match(/\{%\s*block styles\s*%\}([\s\S]*?)\{%\s*endblock\s*%\}/);
  const contentMatch = raw.match(/\{%\s*block content\s*%\}([\s\S]*?)\{%\s*endblock\s*%\}/);
  const scriptsMatch = raw.match(/\{%\s*block scripts\s*%\}([\s\S]*?)\{%\s*endblock\s*%\}/);

  const styles = (stylesMatch?.[1] || '').replace(
    /\{\{\s*url_for\('static',\s*filename='([^']+)'\)\s*\}\}/g,
    '/static/$1'
  );
  const safeErrorBanner = errorMessage
    ? `<div role="alert" style="background:rgba(239,68,68,0.12);border:1px solid rgba(239,68,68,0.35);color:#ef4444;padding:10px 14px;border-radius:10px;margin-bottom:14px;font-size:14px;">${errorMessage
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')}</div>`
    : '';
  const content = (contentMatch?.[1] || '').replace(
    '<div class="auth-tabs">',
    `${safeErrorBanner}<div class="auth-tabs">`
  );
  const scripts = scriptsMatch?.[1] || '';

  return renderWithBase(styles, content, scripts);
}

export function renderGalleryTemplate(
  allFiles: MediaItem[],
  albums: string[] = [],
  trashedFiles: MediaItem[] = [],
  favorites: string[] = []
): string {
  const filenames = allFiles.map((m) => m.filename);
  const filenamesJson = JSON.stringify(filenames);
  const albumsJson = JSON.stringify(albums);
  const stats = computeCloudStorageStats(allFiles, trashedFiles);
  const favoritesSet = new Set(favorites);
  const favoritesJson = JSON.stringify(favorites);

  const emptyHtml =
    allFiles.length === 0
      ? `<div class="empty-state">
            <span class="material-icons">photo_library</span>
            <h3>Il tuo archivio è vuoto</h3>
            <p>Tocca Carica nella barra fluttuante per cifrare foto, video o qualsiasi file nel Cloud.</p>
        </div>`
      : '';

  const cardsHtml = allFiles
    .map((item, index) =>
      renderMediaCardHtml(item, index, {
        fromTrash: false,
        isFavorite: favoritesSet.has(item.filename),
      })
    )
    .join('\n');

  const styles = `<link rel="stylesheet" href="/static/styles/gallery.css">`;

  const content = `
<div class="gallery-container" data-albums='${escapeHtml(albumsJson)}' data-favorites='${escapeHtml(favoritesJson)}'>
    <header class="gallery-header">
        <div class="header-content">
            <div class="header-title-group">
                <h1 id="main-view-title">Il tuo archivio</h1>
                <p id="media-count">${allFiles.length} elementi</p>
                <button type="button" id="cloud-storage-header-badge" class="cloud-storage-badge" title="Memoria usata totale del Cloud (tocca per dettaglio Foto, File e Cestino)" aria-expanded="false">
                    <span class="material-icons">cloud_done</span>
                    <span id="cloud-storage-badge-text">Cloud: ${formatFileSize(stats.activeBytes)}</span>
                    <span id="cloud-storage-trash-dot" class="cloud-storage-trash-dot" style="display: ${stats.trashBytes > 0 ? 'inline-block' : 'none'};" title="Spazio presente anche nel Cestino"></span>
                </button>
            </div>
            <div class="header-top-controls">
                <div class="vault-search-bar" id="vault-search-bar">
                    <span class="material-icons">search</span>
                    <input type="search" id="vault-search-input" placeholder="Cerca in linguaggio naturale (es. foto di agosto 2024)…" autocomplete="off" aria-label="Cerca nell'archivio" />
                    <button type="button" id="vault-search-clear-btn" class="vault-search-clear" style="display: none;" title="Cancella ricerca" aria-label="Cancella ricerca">
                        <span class="material-icons">close</span>
                    </button>
                </div>
                <button type="button" id="favorites-filter-btn" class="btn outlined icon-text-toggle" title="Mostra solo i Preferiti" aria-pressed="false">
                    <span class="material-icons">star</span>
                    <span class="btn-text">Preferiti</span>
                </button>
                <button type="button" id="open-memories-btn" class="btn outlined" title="Ricordi — In questo giorno">
                    <span class="material-icons">history_toggle_off</span>
                    <span class="btn-text">Ricordi</span>
                </button>
                <button type="button" id="open-shares-btn" class="btn outlined" title="Gestisci Link Pubblici e Album Condivisi">
                    <span class="material-icons">share</span>
                    <span class="btn-text">Condivisioni</span>
                </button>
                <button type="button" id="push-notifications-btn" class="btn outlined" title="Attiva Notifiche Push su questo dispositivo">
                    <span class="material-icons" id="push-notifications-icon">notifications_none</span>
                    <span class="btn-text" id="push-notifications-label">Notifiche</span>
                </button>
                <div class="grouping-controls" id="grouping-controls-wrap">
                    <span class="material-icons">folder_special</span>
                    <select id="group-by-select" class="btn-like-select" aria-label="Raggruppa per">
                        <option value="none">Tutti</option>
                        <option value="day">Giorno</option>
                        <option value="month" selected>Mese</option>
                        <option value="year">Anno</option>
                        <option value="album">Album</option>
                    </select>
                </div>

                <button class="btn outlined" id="new-album-btn" title="Crea o Gestisci Album">
                    <span class="material-icons">create_new_folder</span>
                    <span class="btn-text">Album</span>
                </button>

                <button class="btn outlined" id="select-all-btn" title="Seleziona Tutto" style="display: none;">
                    <span class="material-icons">done_all</span>
                    <span class="btn-text">Seleziona Tutto</span>
                </button>

                <button class="btn danger" id="empty-trash-btn" title="Svuota Cestino" style="display: none;">
                    <span class="material-icons">delete_sweep</span>
                    <span class="btn-text">Svuota Cestino</span>
                </button>

                <!-- TOP-RIGHT DISCREET TRANSFER INDICATOR & FLOATING TRANSFER CENTER -->
                <div id="upload-indicator-container" class="upload-indicator-container top-right-transfer" aria-live="polite">
                    <button type="button" id="upload-gem" class="upload-gem" title="Trasferimenti in corso (clicca per aprire i dettagli)" aria-label="Trasferimenti in corso">
                        <svg class="upload-progress-ring" width="40" height="40">
                            <circle class="progress-ring-track" cx="20" cy="20" r="16"></circle>
                            <circle id="upload-progress-arc" class="progress-ring-arc" cx="20" cy="20" r="16"></circle>
                        </svg>
                        <span id="upload-indicator-icon" class="material-icons">swap_vert</span>
                        <span id="upload-indicator-percentage">0%</span>
                        <span id="upload-active-count-badge" class="upload-active-count-badge" style="display: none;">0</span>
                    </button>

                    <div id="upload-details-card" class="upload-details-card">
                        <header class="upload-card-header">
                            <div>
                                <h3 id="upload-card-title">Centro Trasferimenti</h3>
                                <p id="upload-speed-badge" class="transfer-speed-meta">0 KB/s • 0 B / 0 B</p>
                            </div>
                            <button id="upload-close-btn" class="btn icon" title="Chiudi pannello">
                                <span class="material-icons">close</span>
                            </button>
                        </header>
                        <div class="upload-card-body">
                            <ul id="upload-file-list" class="upload-file-list">
                                <li class="transfer-empty-item">Nessuna operazione in corso</li>
                            </ul>
                        </div>
                        <footer class="upload-card-footer">
                            <p id="upload-card-status">Pronto per caricare o scaricare file</p>
                        </footer>
                    </div>
                </div>
            </div>
        </div>

        <!-- CLOUD TOTAL STORAGE BREAKDOWN POPOVER (Opened by tapping the header badge) -->
        <div id="cloud-storage-popover" class="cloud-storage-popover" style="display: none;" role="region" aria-label="Ripartizione memoria usata del Cloud">
            <div class="cloud-storage-popover-header">
                <div>
                    <span class="cloud-storage-popover-kicker">Memoria Usata Totale del Cloud</span>
                    <div class="cloud-storage-popover-title-row">
                        <strong id="popover-storage-active-bytes">${formatFileSize(stats.activeBytes)}</strong>
                        <span class="cloud-storage-popover-sub" id="popover-storage-grand-total-bytes">(${formatFileSize(stats.grandTotalBytes)} incluso cestino)</span>
                    </div>
                </div>
                <button type="button" class="btn icon" id="close-cloud-storage-popover-btn" title="Chiudi dettaglio memoria" aria-label="Chiudi dettaglio memoria">
                    <span class="material-icons">close</span>
                </button>
            </div>
            <div class="cloud-storage-segmented-bar">
                <div id="popover-bar-media" class="storage-segment segment-media" style="width: ${stats.mediaPct}%;"></div>
                <div id="popover-bar-files" class="storage-segment segment-files" style="width: ${stats.filesPct}%;"></div>
                <div id="popover-bar-trash" class="storage-segment segment-trash" style="width: ${stats.trashPct}%;"></div>
            </div>
            <div class="cloud-storage-popover-list">
                <div class="cloud-storage-popover-item">
                    <span class="storage-item-left"><span class="storage-dot dot-media"></span>Foto e Video (<span id="popover-cat-media-count">${stats.mediaCount}</span>)</span>
                    <span class="storage-item-right"><strong id="popover-cat-media-bytes">${formatFileSize(stats.mediaBytes)}</strong> • <span id="popover-cat-media-pct">${stats.mediaPct}%</span></span>
                </div>
                <div class="cloud-storage-popover-item">
                    <span class="storage-item-left"><span class="storage-dot dot-files"></span>File Cloud (<span id="popover-cat-files-count">${stats.filesCount}</span>)</span>
                    <span class="storage-item-right"><strong id="popover-cat-files-bytes">${formatFileSize(stats.filesBytes)}</strong> • <span id="popover-cat-files-pct">${stats.filesPct}%</span></span>
                </div>
                <div class="cloud-storage-popover-item">
                    <span class="storage-item-left"><span class="storage-dot dot-trash"></span>Cestino (<span id="popover-cat-trash-count">${stats.trashCount}</span>)</span>
                    <span class="storage-item-right"><strong id="popover-cat-trash-bytes">${formatFileSize(stats.trashBytes)}</strong> • <span id="popover-cat-trash-pct">${stats.trashPct}%</span></span>
                </div>
            </div>
            <div class="cloud-storage-popover-actions">
                <button type="button" class="btn outlined" id="popover-open-settings-btn">
                    <span class="material-icons">pie_chart</span>
                    <span>Grafico in Impostazioni</span>
                </button>
                <button type="button" class="btn outlined" id="popover-open-trash-btn">
                    <span class="material-icons">delete_outline</span>
                    <span>Cestino</span>
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

    <div class="gallery-grid" data-media-files='${escapeHtml(filenamesJson)}'>
        ${emptyHtml}
        ${cardsHtml}
    </div>

    <!-- ALBUM MODAL -->
    <div id="album-modal-backdrop" class="m3-modal-backdrop" style="display: none;">
        <div class="m3-modal-card">
            <h3>Gestisci Album</h3>
            <p class="m3-modal-sub">Crea un nuovo album o assegna gli elementi selezionati a un album.</p>
            <div class="m3-modal-input-row">
                <input type="text" id="new-album-name-input" placeholder="Nome nuovo album (es. Vacanze 2026)" />
                <button type="button" class="btn primary" id="confirm-create-album-btn">Crea</button>
            </div>
            <div id="album-chips-list" class="album-chips-list"></div>
            <div id="album-share-section" class="album-share-section" style="display: none;">
                <h4 style="margin: 14px 0 6px;">Condividi album con altri utenti</h4>
                <div class="m3-modal-input-row">
                    <select id="album-share-album-select" class="btn-like-select" aria-label="Album da condividere" style="flex:1;"></select>
                </div>
                <div class="m3-modal-input-row">
                    <input type="text" id="album-share-username-input" placeholder="Username (es. mario)" style="flex:1;" />
                    <select id="album-share-role-select" class="btn-like-select" aria-label="Ruolo">
                        <option value="viewer">Sola lettura</option>
                        <option value="contributor">Collaboratore</option>
                    </select>
                    <button type="button" class="btn primary" id="confirm-share-album-btn">Condividi</button>
                </div>
                <div id="album-share-participants-list" class="album-share-participants-list"></div>
            </div>
            <div class="m3-modal-actions">
                <button type="button" class="btn outlined" id="close-album-modal-btn">Chiudi</button>
            </div>
        </div>
    </div>

    <!-- v1.4.0 — OVERLAY RICORDI (In questo giorno) -->
    <div id="memories-overlay" class="vm-overlay" style="display: none;" role="dialog" aria-modal="true" aria-label="Ricordi PhotoCloud">
        <div class="vm-overlay-header">
            <button type="button" class="btn icon" id="close-memories-btn" title="Chiudi Ricordi" aria-label="Chiudi">
                <span class="material-icons">arrow_back</span>
            </button>
            <div class="vm-overlay-title-group">
                <h2>Ricordi</h2>
                <p id="memories-subtitle" class="vm-overlay-subtitle">In questo giorno, negli anni passati</p>
            </div>
            <button type="button" class="btn primary" id="memories-slideshow-btn" style="display: none;">
                <span class="material-icons">slideshow</span>
                <span class="btn-text">Slideshow</span>
            </button>
        </div>
        <div id="memories-content" class="vm-overlay-content"></div>
    </div>

    <!-- v1.4.0 — OVERLAY CONDIVISIONI (Link Pubblici + Album Condivisi multi-utente) -->
    <div id="shares-overlay" class="vm-overlay" style="display: none;" role="dialog" aria-modal="true" aria-label="Gestione Condivisioni PhotoCloud">
        <div class="vm-overlay-header">
            <button type="button" class="btn icon" id="close-shares-btn" title="Chiudi Condivisioni" aria-label="Chiudi">
                <span class="material-icons">arrow_back</span>
            </button>
            <div class="vm-overlay-title-group">
                <h2>Condivisioni</h2>
                <p class="vm-overlay-subtitle">Link pubblici temporanei e album condivisi con altri utenti</p>
            </div>
        </div>
        <div class="vm-overlay-content">
            <section class="shares-section">
                <h3><span class="material-icons">link</span> I tuoi link pubblici</h3>
                <p class="shares-hint">Seleziona foto/file e tocca "Condividi" nella barra di selezione per creare un link pubblico temporaneo.</p>
                <div id="public-shares-list" class="public-shares-list"></div>
            </section>
            <section class="shares-section">
                <h3><span class="material-icons">folder_shared</span> Album che condividi</h3>
                <div id="owned-album-shares-list" class="public-shares-list"></div>
            </section>
            <section class="shares-section">
                <h3><span class="material-icons">group</span> Album condivisi con te</h3>
                <div id="shared-with-me-list" class="public-shares-list"></div>
            </section>
        </div>
    </div>

    <!-- v1.4.0 — OVERLAY ALBUM CONDIVISO APERTO -->
    <div id="shared-album-overlay" class="vm-overlay" style="display: none;" role="dialog" aria-modal="true" aria-label="Album condiviso">
        <div class="vm-overlay-header">
            <button type="button" class="btn icon" id="close-shared-album-btn" title="Chiudi Album" aria-label="Chiudi">
                <span class="material-icons">arrow_back</span>
            </button>
            <div class="vm-overlay-title-group">
                <h2 id="shared-album-title">Album condiviso</h2>
                <p id="shared-album-subtitle" class="vm-overlay-subtitle"></p>
            </div>
            <button type="button" class="btn primary" id="shared-album-upload-btn" style="display: none;">
                <span class="material-icons">upload</span>
                <span class="btn-text">Carica</span>
            </button>
            <button type="button" class="btn outlined" id="shared-album-slideshow-btn" style="display: none;">
                <span class="material-icons">slideshow</span>
                <span class="btn-text">Slideshow</span>
            </button>
        </div>
        <div id="shared-album-content" class="vm-overlay-content"></div>
        <input type="file" id="shared-album-file-input" multiple hidden>
    </div>

    <!-- v1.4.0 — MODALE CREAZIONE LINK PUBBLICO TEMPORANEO -->
    <div id="share-create-modal-backdrop" class="m3-modal-backdrop" style="display: none;">
        <div class="m3-modal-card">
            <h3>Crea Link Pubblico Temporaneo</h3>
            <p class="m3-modal-sub">Chiunque abbia il link potrà vedere e scaricare i <span id="share-create-count">0</span> elementi selezionati fino alla scadenza.</p>
            <label class="share-field-label" for="share-label-input">Etichetta (opzionale)</label>
            <input type="text" id="share-label-input" class="share-field-input" placeholder="Es. Foto matrimonio" maxlength="120" />
            <label class="share-field-label" for="share-expiry-select">Scadenza</label>
            <select id="share-expiry-select" class="btn-like-select" style="width: 100%; height: 42px;">
                <option value="1">1 ora</option>
                <option value="24">24 ore</option>
                <option value="72" selected>3 giorni</option>
                <option value="168">1 settimana</option>
                <option value="720">30 giorni</option>
                <option value="8760">1 anno</option>
            </select>
            <label class="share-field-label" for="share-max-downloads-input">Download massimi (0 = illimitati)</label>
            <input type="number" id="share-max-downloads-input" class="share-field-input" min="0" max="100000" value="0" />
            <label class="share-field-label" for="share-password-input">Password (opzionale)</label>
            <input type="text" id="share-password-input" class="share-field-input" placeholder="Lascia vuoto per accesso libero" maxlength="128" autocomplete="off" />
            <div id="share-create-result" class="share-create-result" style="display: none;">
                <input type="text" id="share-link-output" class="share-field-input" readonly />
                <button type="button" class="btn primary" id="copy-share-link-btn">
                    <span class="material-icons">content_copy</span>
                    <span class="btn-text">Copia Link</span>
                </button>
            </div>
            <div class="m3-modal-actions">
                <button type="button" class="btn outlined" id="close-share-create-modal-btn">Chiudi</button>
                <button type="button" class="btn primary" id="confirm-create-share-btn">
                    <span class="material-icons">add_link</span>
                    <span class="btn-text">Crea Link</span>
                </button>
            </div>
        </div>
    </div>

    <!-- v1.4.0 — TIMELINE SCRUBBER STILE GOOGLE FOTO -->
    <div id="timeline-scrubber" class="timeline-scrubber" style="display: none;" aria-hidden="true">
        <div class="timeline-scrub-track" id="timeline-scrub-track"></div>
        <div class="timeline-scrub-thumb" id="timeline-scrub-thumb"></div>
        <div class="timeline-scrub-bubble" id="timeline-scrub-bubble">2024</div>
    </div>

    <!-- MATERIAL YOU 120HZ FLOATING BAR -->
    <div class="m3-floating-bar-wrapper">
        <div class="m3-selection-dock">
            <button class="btn primary" id="download-selected-btn" title="Scarica Selezionati" style="display: none;">
                <span class="material-icons">download</span>
                <span class="btn-text">Scarica</span> (<span id="selected-count">0</span>)
            </button>
            <button class="btn outlined" id="assign-album-selected-btn" title="Sposta in un Album" style="display: none;">
                <span class="material-icons">photo_album</span>
                <span class="btn-text">Album</span>
            </button>
            <button class="btn outlined" id="share-selected-btn" title="Crea Link Pubblico Temporaneo" style="display: none;">
                <span class="material-icons">share</span>
                <span class="btn-text">Condividi</span>
            </button>
            <button class="btn outlined" id="favorite-selected-btn" title="Aggiungi ai Preferiti" style="display: none;">
                <span class="material-icons">star</span>
                <span class="btn-text">Preferiti</span>
            </button>
            <button class="btn danger" id="delete-selected-btn" title="Sposta Selezionati nel Cestino" style="display: none;">
                <span class="material-icons">delete_sweep</span>
                <span class="btn-text">Cestina</span>
            </button>
        </div>

        <nav class="m3-floating-bar" aria-label="Azioni principali">
            <button type="button" class="nav-pill active" id="tab-media-btn" data-view-tab="media" title="Galleria Foto e Video">
                <span class="material-icons">photo_library</span>
                <span class="pill-label">Foto</span>
            </button>

            <button type="button" class="nav-pill" id="tab-files-btn" data-view-tab="files" title="File Manager Cloud">
                <span class="material-icons">folder</span>
                <span class="pill-label">File Cloud</span>
            </button>

            <form action="/upload" method="POST" enctype="multipart/form-data" class="upload-form" id="upload-form">
                <input type="file" id="file-input" name="file[]" accept="*/*" hidden multiple>
                <label for="file-input" class="nav-pill tonal-cta" id="upload-label" title="Carica Foto, Video o qualsiasi File Cloud">
                    <span class="material-icons">add</span>
                    <span class="pill-label">Carica</span>
                </label>
            </form>

            <button class="nav-pill" id="find-duplicates-btn" title="Trova Duplicati">
                <span class="material-icons">manage_search</span>
                <span class="pill-label">Duplicati</span>
            </button>

            <a href="/map" class="nav-pill" id="tab-map-btn" title="Mappa interattiva delle foto con GPS (OpenStreetMap)">
                <span class="material-icons">map</span>
                <span class="pill-label">Mappa</span>
            </a>

            <a href="/trash" class="nav-pill" id="tab-trash-btn" data-view-tab="trash" title="Cestino">
                <span class="material-icons">delete_outline</span>
                <span class="pill-label">Cestino</span>
            </a>

            <button type="button" class="nav-pill" id="open-settings-btn" title="Impostazioni e Temi (Originale / Liquid Glass)" aria-label="Impostazioni Tema">
                <span class="material-icons">settings</span>
                <span class="pill-label">Temi</span>
            </button>

            <button class="nav-pill" id="theme-toggle-btn" title="Tema">
                <span class="material-icons">light_mode</span>
            </button>

            <button class="nav-pill" id="logout-btn" title="Esci">
                <span class="material-icons">logout</span>
            </button>
        </nav>
    </div>
</div>

<form action="/logout" method="POST" id="logout-form" style="display:none;"></form>
`;

  const galleryInitVersion = getStaticAssetVersion('scripts/gallery-init.js');
  const scripts = `
<script src="/static/scripts/duplicates.js"></script>
<script src="/static/scripts/selection.js"></script>
<script src="/static/scripts/upload.js"></script>
<script src="/static/scripts/grouping.js"></script>
<script src="/static/scripts/similar-duplicates.js"></script>
<script src="/static/scripts/slideshow.js"></script>
<script src="/static/scripts/timeline-scrubber.js"></script>
<script src="/static/scripts/cloud-features.js"></script>
<script src="/static/scripts/gallery-init.js?v=${encodeURIComponent(galleryInitVersion)}"></script>
`;

  return renderWithBase(styles, content, scripts);
}

export function renderTrashTemplate(trashedFiles: MediaItem[], activeFiles: MediaItem[] = []): string {
  const styles = `<link rel="stylesheet" href="/static/styles/gallery.css">`;
  const storageStats = computeCloudStorageStats(activeFiles, trashedFiles);

  const emptyBtnHtml =
    trashedFiles.length > 0
      ? `<button class="btn danger" id="empty-trash-btn">
                    <span class="material-icons">delete_sweep</span>
                    Svuota Cestino
                </button>`
      : '';

  const trashBannerHtml =
    trashedFiles.length > 0
      ? `<div class="trash-storage-banner" id="trash-recoverable-storage-banner" data-trash-bytes="${storageStats.trashBytes}" data-active-bytes="${storageStats.activeTotalBytes}">
            <div class="trash-storage-banner-info">
                <div class="trash-storage-banner-icon">
                    <span class="material-icons">restore_from_trash</span>
                </div>
                <div class="trash-storage-banner-text">
                    <strong>Spazio recuperabile nel Cestino: <span id="trash-banner-size">${storageStats.trashFormatted}</span></strong>
                    <span><span id="trash-banner-count">${storageStats.trashCount}</span> elementi (${storageStats.trashPercent}% della memoria totale Cloud: ${storageStats.grandTotalFormatted})</span>
                </div>
            </div>
            <div class="trash-storage-banner-bar-wrap">
                <div class="cloud-storage-segmented-bar">
                    <div class="storage-segment segment-media" style="width: ${storageStats.mediaPercent}%"></div>
                    <div class="storage-segment segment-files" style="width: ${storageStats.filesPercent}%"></div>
                    <div class="storage-segment segment-trash" style="width: ${storageStats.trashPercent}%"></div>
                </div>
            </div>
        </div>`
      : '';

  const itemsHtml =
    trashedFiles.length === 0
      ? `<div class="empty-state">
                    <span class="material-icons">delete_sweep</span>
                    <h3>Il cestino è vuoto</h3>
                    <p>I file eliminati appariranno qui.</p>
                </div>`
      : trashedFiles
          .map((item, index) => renderMediaCardHtml(item, index, { fromTrash: true, isFavorite: false }))
          .join('\n');

  const content = `
<div class="gallery-container">
    <header class="gallery-header">
        <div class="header-content">
            <div class="header-title-group">
                <h1>Cestino</h1>
                <p id="media-count">${trashedFiles.length} elementi</p>
            </div>
            <div class="header-top-controls">
                <div class="cloud-storage-badge" id="cloud-storage-header-badge" title="Memoria usata totale del Cloud">
                    <span class="material-icons cloud-storage-icon">cloud_done</span>
                    <span class="cloud-storage-badge-label">Cloud: <strong id="cloud-storage-badge-text">${storageStats.activeTotalFormatted}</strong></span>
                </div>
                ${emptyBtnHtml}
            </div>
        </div>
    </header>

    <div class="gallery-grid">
        ${trashBannerHtml}
        <div class="media-group">
             <div class="media-group-grid">
                ${itemsHtml}
            </div>
        </div>
    </div>

    <div class="m3-floating-bar-wrapper">
        <nav class="m3-floating-bar" aria-label="Navigazione Cestino">
            <a href="/" class="nav-pill" title="Torna alla galleria">
                <span class="material-icons">arrow_back</span>
                <span class="pill-label">Foto</span>
            </a>
            <a href="/trash" class="nav-pill active" title="Cestino">
                <span class="material-icons">delete</span>
                <span class="pill-label">Cestino</span>
            </a>
            <button type="button" class="nav-pill" id="open-settings-btn" title="Impostazioni e Temi (Originale / Liquid Glass)" aria-label="Impostazioni Tema">
                <span class="material-icons">settings</span>
                <span class="pill-label">Temi</span>
            </button>
        </nav>
    </div>
</div>
`;

  const scripts = `<script src="/static/scripts/trash.js"></script>`;

  return renderWithBase(styles, content, scripts);
}

