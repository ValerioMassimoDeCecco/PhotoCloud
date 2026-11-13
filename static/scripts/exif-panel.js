/**
 * PhotoCloud v1.4.1 — Pannello metadati EXIF nella lightbox.
 *
 * Mostra fotocamera, apertura (f/), ISO, tempo di esposizione, focale,
 * data originale di scatto e coordinate GPS della foto attualmente aperta,
 * leggendo l'endpoint GET /api/exif/<filename> (cache lato server in
 * `user_media/<user>/.exif.json`). Se ci sono coordinate GPS offre il
 * collegamento diretto alla mappa interattiva (/map?focus=<file>).
 */
(function () {
  'use strict';

  var panel = null;
  var grid = null;
  var mapLink = null;
  var backdropCloser = null;

  function els() {
    panel = document.getElementById('exif-panel');
    grid = document.getElementById('exif-panel-grid');
    mapLink = document.getElementById('exif-panel-map-link');
    return panel && grid && mapLink;
  }

  function currentFilename() {
    return typeof window.getCurrentLightboxFilename === 'function'
      ? window.getCurrentLightboxFilename()
      : '';
  }

  function esc(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }

  function row(label, value) {
    if (value === null || value === undefined || value === '') return '';
    return '<div class="exif-row"><span class="exif-label">' + esc(label) + '</span>' +
      '<span class="exif-value">' + esc(value) + '</span></div>';
  }

  function formatOriginalDate(exif) {
    if (exif.dateTimeOriginalMs) {
      try {
        return new Date(exif.dateTimeOriginalMs).toLocaleString('it-IT', {
          day: 'numeric', month: 'long', year: 'numeric',
          hour: '2-digit', minute: '2-digit',
        });
      } catch (_) {}
    }
    return exif.dateTimeOriginal || null;
  }

  function renderExif(exif, filename) {
    var html = '';
    html += row('Fotocamera', exif.camera);
    html += row('Data scatto', formatOriginalDate(exif));
    html += row('Apertura', exif.apertureFNumber != null ? 'f/' + exif.apertureFNumber : null);
    html += row('ISO', exif.iso);
    html += row('Esposizione', exif.exposureTimeLabel);
    html += row('Focale', exif.focalLengthMm != null ? exif.focalLengthMm + ' mm' : null);
    html += row('Coordinate GPS', exif.hasGps
      ? exif.latitude.toFixed(5) + ', ' + exif.longitude.toFixed(5)
      : null);
    html += row('Altitudine', exif.altitudeM != null ? exif.altitudeM + ' m s.l.m.' : null);
    if (!html) {
      html = '<div class="exif-empty">Nessun metadato EXIF trovato in questo file.</div>';
    }
    grid.innerHTML = html;
    if (exif.hasGps) {
      mapLink.hidden = false;
      mapLink.href = '/map?focus=' + encodeURIComponent(filename);
    } else {
      mapLink.hidden = true;
      mapLink.href = '#';
    }
  }

  function openPanel() {
    if (!els()) return;
    var filename = currentFilename();
    if (!filename) return;
    document.getElementById('exif-panel-title').textContent = filename;
    grid.innerHTML = '<div class="exif-empty">Caricamento metadati…</div>';
    mapLink.hidden = true;
    panel.hidden = false;
    fetch('/api/exif/' + encodeURIComponent(filename), { credentials: 'same-origin' })
      .then(function (r) {
        if (!r.ok) throw new Error('HTTP ' + r.status);
        return r.json();
      })
      .then(function (data) {
        var exif = data && data.exif ? data.exif : {};
        if (data && data.supported === false) {
          grid.innerHTML = '<div class="exif-empty">Metadati EXIF disponibili solo per le foto JPEG.</div>';
          return;
        }
        renderExif(exif, filename);
      })
      .catch(function () {
        grid.innerHTML = '<div class="exif-empty">Errore nel caricamento dei metadati.</div>';
      });
  }

  function closePanel() {
    if (!els()) return;
    panel.hidden = true;
  }

  function init() {
    if (!els()) return;
    var btn = document.getElementById('lightbox-exif-btn');
    if (btn) {
      // Il pulsante è visibile nella lightbox solo per i media attivi
      btn.addEventListener('click', function (e) {
        e.preventDefault();
        e.stopPropagation();
        closePanel();
        openPanel();
      });
    }
    var closeBtn = document.getElementById('exif-panel-close');
    if (closeBtn) closeBtn.addEventListener('click', closePanel);
    backdropCloser = function (e) {
      if (panel && !panel.hidden && e.target === panel) closePanel();
    };
    panel.addEventListener('click', backdropCloser);
    document.addEventListener('keydown', function (e) {
      if (e.key === 'Escape' && panel && !panel.hidden) {
        e.stopPropagation();
        closePanel();
      } else if ((e.key === 'i' || e.key === 'I') && panel && panel.hidden) {
        // Scorciatoia "I" solo quando la lightbox è aperta
        if (currentFilename()) openPanel();
      }
    });
    // Mostra/nascondi il pulsante ℹ️ in lightbox quando cambia la foto
    var observer = new MutationObserver(function () {
      syncExifButtonVisibility();
    });
    var lb = document.getElementById('lightbox');
    if (lb) observer.observe(lb, { attributes: true, attributeFilter: ['class', 'style'] });
    syncExifButtonVisibility();
  }

  function syncExifButtonVisibility() {
    var btn = document.getElementById('lightbox-exif-btn');
    if (!btn) return;
    var lb = document.getElementById('lightbox');
    var lightboxOpen = lb && lb.classList.contains('open');
    var favVisible = (function () {
      var fav = document.getElementById('lightbox-favorite-btn');
      return fav && fav.style.display !== 'none';
    })();
    // Visibile solo nella lightbox dei media attivi (come il pulsante ⭐)
    btn.style.display = lightboxOpen && favVisible && currentFilename() ? '' : 'none';
    if (btn.style.display === 'none') closePanel();
  }
  window.syncExifButtonVisibility = syncExifButtonVisibility;
  setInterval(syncExifButtonVisibility, 1200);

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
