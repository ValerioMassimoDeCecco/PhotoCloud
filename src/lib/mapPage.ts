/**
 * PhotoCloud v1.4.1 — Pagina "Mappa Foto" interattiva.
 *
 * Slippy-map custom (nessuna dipendenza esterna lato server): le tile vengono
 * caricate dal servizio pubblico OpenStreetMap (tile.openstreetmap.org) e i
 * marcatori provengono da GET /api/map-photos (EXIF GPS del vault utente).
 *
 * La stessa pagina viene caricata nell'app Android dentro un WebView con i
 * cookie di sessione sincronizzati, così web e mobile condividono il codice.
 */
import { escapeHtml } from './templateRenderer';

export function renderMapPage(username: string): string {
  const safeUser = escapeHtml(username);
  return `<!DOCTYPE html>
<html lang="it">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<meta name="theme-color" content="#0b0f14">
<title>Mappa Foto GPS — PhotoCloud</title>
<link rel="stylesheet" href="https://fonts.googleapis.com/icon?family=Material+Icons">
<style>
  * { box-sizing: border-box; margin: 0; padding: 0; }
  html, body { height: 100%; overflow: hidden; background: #0b0f14; color: #e6edf3;
    font-family: 'Roboto', 'Segoe UI', system-ui, sans-serif; }
  #pc-map { position: fixed; inset: 0; overflow: hidden; background: #0d1826;
    touch-action: none; cursor: grab; user-select: none; -webkit-user-select: none; }
  #pc-map.dragging { cursor: grabbing; }
  .pc-tile { position: absolute; display: block; pointer-events: none; }
  .pc-marker { position: absolute; width: 44px; height: 44px; margin: -22px 0 0 -22px;
    border-radius: 50%; border: 3px solid #fff; overflow: hidden; cursor: pointer;
    box-shadow: 0 2px 10px rgba(0,0,0,.55); background: #1f2a37;
    transition: width .15s ease, height .15s ease, margin .15s ease; z-index: 5; }
  .pc-marker:hover, .pc-marker.active { width: 56px; height: 56px; margin: -28px 0 0 -28px;
    z-index: 40; border-color: #58a6ff; }
  .pc-marker img { width: 100%; height: 100%; object-fit: cover; display: block; pointer-events: none; }
  .pc-marker .pc-marker-badge { position: absolute; right: -2px; bottom: -2px; min-width: 18px;
    height: 18px; padding: 0 4px; border-radius: 9px; background: #58a6ff; color: #062340;
    font-size: 11px; font-weight: 700; display: flex; align-items: center; justify-content: center; }
  #pc-map-header { position: fixed; top: 0; left: 0; right: 0; z-index: 60;
    display: flex; align-items: center; gap: 10px; padding: 10px 14px;
    background: linear-gradient(rgba(9,13,19,.92), rgba(9,13,19,0)); pointer-events: none; }
  #pc-map-header > * { pointer-events: auto; }
  .pc-hdr-btn { display: inline-flex; align-items: center; gap: 6px; border: 0; cursor: pointer;
    background: rgba(23,32,42,.9); color: #e6edf3; border-radius: 20px; padding: 8px 14px;
    font-size: 13px; font-weight: 600; text-decoration: none; backdrop-filter: blur(8px);
    border: 1px solid rgba(88,166,255,.25); }
  .pc-hdr-btn:hover { background: rgba(33,45,58,.95); }
  .pc-hdr-btn .material-icons { font-size: 18px; }
  #pc-map-title { font-size: 14px; font-weight: 700; letter-spacing: .3px; }
  #pc-map-count { margin-left: auto; font-size: 12px; color: #9fb3c8;
    background: rgba(23,32,42,.85); padding: 6px 12px; border-radius: 14px; }
  .pc-zoom-ctrl { position: fixed; right: 14px; bottom: 76px; z-index: 60; display: flex;
    flex-direction: column; gap: 8px; }
  .pc-zoom-ctrl button { width: 42px; height: 42px; border-radius: 50%; border: 1px solid rgba(88,166,255,.3);
    background: rgba(23,32,42,.92); color: #e6edf3; font-size: 22px; font-weight: 700;
    cursor: pointer; backdrop-filter: blur(8px); }
  .pc-zoom-ctrl button:hover { background: rgba(33,45,58,.95); }
  #pc-map-popup { position: fixed; z-index: 70; display: none; width: 250px;
    background: rgba(16,22,30,.97); border: 1px solid rgba(88,166,255,.35); border-radius: 14px;
    overflow: hidden; box-shadow: 0 8px 32px rgba(0,0,0,.6); }
  #pc-map-popup img { width: 100%; height: 140px; object-fit: cover; display: block; background: #111; }
  #pc-map-popup .pop-body { padding: 10px 12px; }
  #pc-map-popup .pop-name { font-size: 12px; font-weight: 700; word-break: break-all; }
  #pc-map-popup .pop-date { font-size: 11px; color: #9fb3c8; margin-top: 2px; }
  #pc-map-popup .pop-actions { display: flex; gap: 6px; margin-top: 8px; }
  #pc-map-popup .pop-actions a, #pc-map-popup .pop-actions button { flex: 1; display: inline-flex;
    align-items: center; justify-content: center; gap: 4px; font-size: 11px; font-weight: 700;
    padding: 6px 8px; border-radius: 10px; border: 1px solid rgba(88,166,255,.35); cursor: pointer;
    background: rgba(88,166,255,.12); color: #9ecbff; text-decoration: none; }
  #pc-map-popup .pop-close { position: absolute; top: 6px; right: 6px; width: 26px; height: 26px;
    border-radius: 50%; border: 0; background: rgba(0,0,0,.6); color: #fff; cursor: pointer;
    font-size: 14px; line-height: 1; }
  #pc-map-empty { position: fixed; inset: 0; display: none; align-items: center; justify-content: center;
    text-align: center; padding: 24px; z-index: 55; pointer-events: none; }
  #pc-map-empty .empty-card { pointer-events: auto; background: rgba(16,22,30,.94); border-radius: 18px;
    padding: 26px 30px; border: 1px solid rgba(88,166,255,.25); max-width: 420px; }
  #pc-map-empty h2 { font-size: 17px; margin-bottom: 8px; }
  #pc-map-empty p { font-size: 13px; color: #9fb3c8; line-height: 1.5; }
  #pc-osm-attribution { position: fixed; left: 10px; bottom: 8px; z-index: 60; font-size: 10.5px;
    color: #7d8fa3; background: rgba(9,13,19,.72); padding: 3px 8px; border-radius: 8px; }
  #pc-osm-attribution a { color: #9ecbff; }
  #pc-map-loading { position: fixed; top: 64px; left: 50%; transform: translateX(-50%); z-index: 65;
    background: rgba(23,32,42,.94); border: 1px solid rgba(88,166,255,.3); border-radius: 14px;
    padding: 8px 16px; font-size: 12.5px; color: #9fb3c8; display: none; }
</style>
</head>
<body>
  <div id="pc-map" aria-label="Mappa interattiva delle foto con GPS"></div>

  <header id="pc-map-header">
    <a class="pc-hdr-btn" href="/" title="Torna alla galleria PhotoCloud">
      <span class="material-icons">arrow_back</span> Galleria
    </a>
    <span id="pc-map-title">🗺️ Mappa Foto GPS</span>
    <span id="pc-map-count">…</span>
  </header>

  <div class="pc-zoom-ctrl">
    <button type="button" id="pc-zoom-in" title="Zoom avanti" aria-label="Zoom avanti">+</button>
    <button type="button" id="pc-zoom-out" title="Zoom indietro" aria-label="Zoom indietro">−</button>
    <button type="button" id="pc-zoom-fit" title="Inquadra tutte le foto" aria-label="Inquadra tutte" style="font-size: 15px;">⤢</button>
  </div>

  <div id="pc-map-popup" role="dialog" aria-label="Anteprima foto">
    <button type="button" class="pop-close" id="pc-popup-close" aria-label="Chiudi anteprima">✕</button>
    <img id="pc-popup-img" alt="" draggable="false">
    <div class="pop-body">
      <div class="pop-name" id="pc-popup-name"></div>
      <div class="pop-date" id="pc-popup-date"></div>
      <div class="pop-actions">
        <a id="pc-popup-open" href="#" target="_blank" rel="noopener">
          <span class="material-icons" style="font-size:14px;">open_in_full</span> Apri
        </a>
        <button type="button" id="pc-popup-exif">
          <span class="material-icons" style="font-size:14px;">info</span> Metadati EXIF
        </button>
      </div>
    </div>
  </div>

  <div id="pc-map-loading">Caricamento posizioni GPS dalle foto…</div>

  <div id="pc-map-empty">
    <div class="empty-card">
      <h2>Nessuna foto con coordinate GPS</h2>
      <p>Le foto che carichi su PhotoCloud e che contengono coordinate GPS nei metadati EXIF
         (es. scattate dallo smartphone con la localizzazione attiva) appariranno qui sulla mappa.</p>
    </div>
  </div>

  <footer id="pc-osm-attribution">© <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener">OpenStreetMap</a> contributors — Mappa interattiva pubblica</footer>

  <script>window.PC_MAP_USERNAME = "${safeUser}";</script>
  <script src="/static/scripts/map.js"></script>
</body>
</html>`;
}
