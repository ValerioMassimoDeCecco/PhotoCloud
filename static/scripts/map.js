/**
 * PhotoCloud v1.4.1 — Slippy-map interattiva custom (zero dipendenze JS).
 *
 * Renderizza le tile pubbliche di OpenStreetMap e posiziona un marcatore per
 * ogni media che ha coordinate GPS nei metadati EXIF (GET /api/map-photos).
 * Pan trascinabile (pointer events), zoom con rotellina/doppio click/pulsanti,
 * popup anteprima con thumbnail del vault e pannello metadati EXIF on-demand.
 */
(function () {
  'use strict';

  var TILE_URL = 'https://tile.openstreetmap.org/{z}/{x}/{y}.png';
  var TILE_SIZE = 256;
  var MIN_ZOOM = 2;
  var MAX_ZOOM = 18;

  var container = null;
  var tilesLayer = null;
  var markersLayer = null;
  var viewW = 0;
  var viewH = 0;

  // Stato vista: centro in "world pixel" allo zoom corrente
  var zoom = 2;
  var centerX = 0;
  var centerY = 0;
  var markers = []; // { filename, lat, lon, timestamp, album, el, wx, wy }
  var tileCache = {};
  var activeMarker = null;
  var markersLoaded = false;

  // ------------------------------------------------------------------
  // Proiezione Web Mercator
  // ------------------------------------------------------------------
  function project(lat, lon, z) {
    var scale = TILE_SIZE * Math.pow(2, z);
    var x = ((lon + 180) / 360) * scale;
    var rad = (lat * Math.PI) / 180;
    var y = (0.5 - Math.log(Math.tan(Math.PI / 4 + rad / 2)) / (2 * Math.PI)) * scale;
    return { x: x, y: y };
  }

  function unproject(x, y, z) {
    var scale = TILE_SIZE * Math.pow(2, z);
    var lon = (x / scale) * 360 - 180;
    var n = Math.PI - (2 * Math.PI * y) / scale;
    var lat = (180 / Math.PI) * Math.atan(0.5 * (Math.exp(n) - Math.exp(-n)));
    return { lat: lat, lon: lon };
  }

  function clampZoom(z) {
    return Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, z));
  }

  // ------------------------------------------------------------------
  // Rendering
  // ------------------------------------------------------------------
  function originX() { return centerX - viewW / 2; }
  function originY() { return centerY - viewH / 2; }

  function renderTiles() {
    var scale = Math.pow(2, zoom);
    var ox = originX();
    var oy = originY();
    var xMin = Math.floor(ox / TILE_SIZE);
    var yMin = Math.floor(oy / TILE_SIZE);
    var xMax = Math.floor((ox + viewW) / TILE_SIZE);
    var yMax = Math.floor((oy + viewH) / TILE_SIZE);
    var maxTile = scale;
    var wanted = {};

    for (var tx = xMin; tx <= xMax; tx++) {
      for (var ty = yMin; ty <= yMax; ty++) {
        if (ty < 0 || ty >= maxTile) continue;
        var wrappedX = ((tx % maxTile) + maxTile) % maxTile;
        var key = zoom + '/' + wrappedX + '/' + ty;
        wanted[key] = true;
        var el = tileCache[key];
        if (!el) {
          el = document.createElement('img');
          el.className = 'pc-tile';
          el.draggable = false;
          el.width = TILE_SIZE;
          el.height = TILE_SIZE;
          el.alt = '';
          el.src = TILE_URL.replace('{z}', String(zoom))
            .replace('{x}', String(wrappedX))
            .replace('{y}', String(ty));
          tileCache[key] = el;
          tilesLayer.appendChild(el);
        }
        el.style.transform = 'translate(' + (wrappedX * TILE_SIZE - ox) + 'px,' + (ty * TILE_SIZE - oy) + 'px)';
        el.width = TILE_SIZE;
        el.height = TILE_SIZE;
      }
    }
    // Rimuove tile fuori vista o di altro zoom
    Object.keys(tileCache).forEach(function (key) {
      if (!wanted[key]) {
        var el = tileCache[key];
        if (el.parentNode) el.parentNode.removeChild(el);
        delete tileCache[key];
      }
    });
  }

  function renderMarkers() {
    markers.forEach(function (m) {
      if (!m.el) return;
      var x = m.wx - originX();
      var y = m.wy - originY();
      m.el.style.left = x + 'px';
      m.el.style.top = y + 'px';
      var visible = x > -80 && x < viewW + 80 && y > -80 && y < viewH + 80;
      m.el.style.display = visible ? '' : 'none';
    });
  }

  function renderAll() {
    if (!container) return;
    renderTiles();
    renderMarkers();
  }

  function setView(lat, lon, z) {
    zoom = clampZoom(z);
    var p = project(Math.max(-85, Math.min(85, lat)), lon, zoom);
    centerX = p.x;
    centerY = p.y;
    markers.forEach(function (m) {
      var mp = project(m.lat, m.lon, zoom);
      m.wx = mp.x;
      m.wy = mp.y;
    });
    renderAll();
  }

  function centerPx() {
    return unproject(centerX, centerY, zoom);
  }

  // ------------------------------------------------------------------
  // Interazioni
  // ------------------------------------------------------------------
  function bindInteractions() {
    var dragging = false;
    var lastX = 0;
    var lastY = 0;
    var moved = 0;

    container.addEventListener('pointerdown', function (e) {
      dragging = true;
      moved = 0;
      lastX = e.clientX;
      lastY = e.clientY;
      container.classList.add('dragging');
      try { container.setPointerCapture(e.pointerId); } catch (_) {}
    });
    container.addEventListener('pointermove', function (e) {
      if (!dragging) return;
      var dx = e.clientX - lastX;
      var dy = e.clientY - lastY;
      lastX = e.clientX;
      lastY = e.clientY;
      moved += Math.abs(dx) + Math.abs(dy);
      centerX -= dx;
      centerY -= dy;
      clampCenter();
      renderAll();
    });
    function endDrag(e) {
      dragging = false;
      container.classList.remove('dragging');
      try { container.releasePointerCapture(e.pointerId); } catch (_) {}
    }
    container.addEventListener('pointerup', endDrag);
    container.addEventListener('pointercancel', endDrag);

    container.addEventListener('wheel', function (e) {
      e.preventDefault();
      var delta = e.deltaY < 0 ? 1 : -1;
      zoomAroundPoint(delta, e.clientX, e.clientY);
    }, { passive: false });

    container.addEventListener('dblclick', function (e) {
      e.preventDefault();
      zoomAroundPoint(1, e.clientX, e.clientY);
    });

    document.getElementById('pc-zoom-in').addEventListener('click', function () {
      setView(centerPx().lat, centerPx().lon, zoom + 1);
    });
    document.getElementById('pc-zoom-out').addEventListener('click', function () {
      setView(centerPx().lat, centerPx().lon, zoom - 1);
    });
    document.getElementById('pc-zoom-fit').addEventListener('click', function () {
      fitToMarkers(true);
    });

    window.addEventListener('resize', function () {
      measure();
      renderAll();
    });
  }

  function clampCenter() {
    var scale = TILE_SIZE * Math.pow(2, zoom);
    var halfWorld = scale / 2;
    // Limita la latitudine a ~85° (limite Mercator)
    var latPxLimit = (scale * 0.48);
    centerY = Math.max(halfWorld - latPxLimit * 1.02, Math.min(halfWorld + latPxLimit * 1.02, centerY));
  }

  function zoomAroundPoint(delta, clientX, clientY) {
    var rect = container.getBoundingClientRect();
    var px = clientX - rect.left;
    var py = clientY - rect.top;
    var newZoom = clampZoom(zoom + delta);
    if (newZoom === zoom) return;
    // Punto del mondo sotto il cursore
    var worldPointX = originX() + px;
    var worldPointY = originY() + py;
    var ratio = Math.pow(2, newZoom - zoom);
    var geo = unproject(worldPointX, worldPointY, zoom);
    setView(geo.lat, geo.lon, newZoom);
    // Ricentra in modo che il punto sotto il cursore resti fermo
    centerX = worldPointX * ratio - px + viewW / 2;
    centerY = worldPointY * ratio - py + viewH / 2;
    clampCenter();
    renderAll();
  }

  // ------------------------------------------------------------------
  // Dati & marcatori
  // ------------------------------------------------------------------
  function measure() {
    viewW = container.clientWidth;
    viewH = container.clientHeight;
  }

  function createMarkerEl(m) {
    var el = document.createElement('div');
    el.className = 'pc-marker';
    var img = document.createElement('img');
    img.src = '/media/' + encodeURIComponent(m.filename);
    img.alt = m.filename;
    img.loading = 'lazy';
    el.appendChild(img);
    el.addEventListener('click', function (e) {
      e.stopPropagation();
      openPopup(m);
    });
    markersLayer.appendChild(el);
    return el;
  }

  function formatDate(ts) {
    try {
      return new Date(ts * 1000).toLocaleDateString('it-IT', {
        day: 'numeric', month: 'long', year: 'numeric',
      });
    } catch (_) {
      return '';
    }
  }

  function openPopup(m) {
    var popup = document.getElementById('pc-map-popup');
    var img = document.getElementById('pc-popup-img');
    img.src = '/media/' + encodeURIComponent(m.filename);
    document.getElementById('pc-popup-name').textContent = m.filename;
    var meta = formatDate(m.timestamp);
    if (m.album) meta += ' · 📁 ' + m.album;
    meta += ' · ' + m.lat.toFixed(5) + ', ' + m.lon.toFixed(5);
    document.getElementById('pc-popup-date').textContent = meta;
    document.getElementById('pc-popup-open').href = '/media/' + encodeURIComponent(m.filename);
    var exifBtn = document.getElementById('pc-popup-exif');
    exifBtn.onclick = function () { openExifPanel(m.filename); };

    // Posiziona il popup vicino al marcatore, dentro la viewport
    var sx = m.wx - originX();
    var sy = m.wy - originY();
    var pw = 250, ph = 260;
    var left = Math.max(10, Math.min(viewW - pw - 10, sx - pw / 2));
    var top = sy + 40 > viewH - ph ? Math.max(10, sy - ph - 40) : sy + 34;
    popup.style.left = left + 'px';
    popup.style.top = top + 'px';
    popup.style.display = 'block';
    activeMarker = m;
  }

  function closePopup() {
    document.getElementById('pc-map-popup').style.display = 'none';
    activeMarker = null;
  }

  // Piccolo pannello EXIF riutilizzando l'endpoint /api/exif/<file>
  function openExifPanel(filename) {
    var panel = ensureExifPanel();
    panel.querySelector('.pc-exif-grid').innerHTML = '<div class="pc-exif-row">Caricamento metadati…</div>';
    panel.style.display = 'flex';
    fetch('/api/exif/' + encodeURIComponent(filename), { credentials: 'same-origin' })
      .then(function (r) {
        if (!r.ok) throw new Error('HTTP ' + r.status);
        return r.json();
      })
      .then(function (data) {
        var e = data.exif || {};
        var rows = [];
        function row(label, value) {
          if (value === null || value === undefined || value === '') return;
          rows.push('<div class="pc-exif-row"><span>' + label + '</span><b>' + value + '</b></div>');
        }
        row('Fotocamera', e.camera);
        row('Data scatto', e.dateTimeOriginal);
        row('Apertura', e.apertureFNumber != null ? 'f/' + e.apertureFNumber : null);
        row('ISO', e.iso);
        row('Esposizione', e.exposureTimeLabel);
        row('Focale', e.focalLengthMm != null ? e.focalLengthMm + ' mm' : null);
        row('GPS', e.hasGps ? (e.latitude.toFixed(5) + ', ' + e.longitude.toFixed(5)) : null);
        row('Altitudine', e.altitudeM != null ? e.altitudeM + ' m' : null);
        if (rows.length === 0) rows.push('<div class="pc-exif-row">Nessun metadato EXIF trovato.</div>');
        panel.querySelector('.pc-exif-grid').innerHTML = rows.join('');
      })
      .catch(function () {
        panel.querySelector('.pc-exif-grid').innerHTML = '<div class="pc-exif-row">Errore nel caricamento dei metadati.</div>';
      });
  }

  function ensureExifPanel() {
    var panel = document.getElementById('pc-exif-panel');
    if (panel) return panel;
    panel = document.createElement('div');
    panel.id = 'pc-exif-panel';
    panel.style.cssText = 'position:fixed;inset:auto 0 0 0;z-index:80;display:flex;justify-content:center;' +
      'padding:12px;background:linear-gradient(transparent,rgba(9,13,19,.95) 30%);';
    panel.innerHTML =
      '<div style="width:min(460px,100%);background:rgba(16,22,30,.98);border:1px solid rgba(88,166,255,.35);' +
      'border-radius:16px 16px 14px 14px;padding:14px 16px;box-shadow:0 -6px 28px rgba(0,0,0,.5);">' +
      '<div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:8px;">' +
      '<b style="font-size:13px;">📷 Metadati EXIF</b>' +
      '<button type="button" class="pc-exif-close" style="border:0;background:none;color:#9fb3c8;font-size:16px;cursor:pointer;">✕</button>' +
      '</div><div class="pc-exif-grid" style="font-size:12.5px;color:#c8d5e3;"></div></div>';
    document.body.appendChild(panel);
    var styleEl = document.createElement('style');
    styleEl.textContent =
      '#pc-exif-panel .pc-exif-row{display:flex;justify-content:space-between;gap:14px;padding:5px 0;' +
      'border-bottom:1px solid rgba(88,166,255,.12);}#pc-exif-panel .pc-exif-row:last-child{border-bottom:0;}' +
      '#pc-exif-panel .pc-exif-row span{color:#7d8fa3;}#pc-exif-panel .pc-exif-row b{color:#e6edf3;text-align:right;}';
    document.head.appendChild(styleEl);
    panel.querySelector('.pc-exif-close').addEventListener('click', function () {
      panel.style.display = 'none';
    });
    return panel;
  }

  function fitToMarkers(force) {
    if (markers.length === 0) {
      if (!force) setView(41.9, 12.5, 5); // Italia come vista predefinita
      return;
    }
    var minLat = 90, maxLat = -90, minLon = 180, maxLon = -180;
    markers.forEach(function (m) {
      if (m.lat < minLat) minLat = m.lat;
      if (m.lat > maxLat) maxLat = m.lat;
      if (m.lon < minLon) minLon = m.lon;
      if (m.lon > maxLon) maxLon = m.lon;
    });
    var cLat = (minLat + maxLat) / 2;
    var cLon = (minLon + maxLon) / 2;
    var z = MAX_ZOOM;
    while (z > MIN_ZOOM) {
      var p1 = project(maxLat, minLon, z);
      var p2 = project(minLat, maxLon, z);
      if (Math.abs(p2.x - p1.x) < viewW * 0.8 && Math.abs(p2.y - p1.y) < viewH * 0.7) break;
      z--;
    }
    setView(cLat, cLon, clampZoom(z));
  }

  function loadMarkers() {
    var loading = document.getElementById('pc-map-loading');
    loading.style.display = 'block';
    fetch('/api/map-photos', { credentials: 'same-origin' })
      .then(function (r) {
        if (r.status === 403 || r.status === 302 || r.redirected) {
          window.location.href = '/';
          return null;
        }
        if (!r.ok) throw new Error('HTTP ' + r.status);
        return r.json();
      })
      .then(function (data) {
        loading.style.display = 'none';
        if (!data) return;
        markersLoaded = true;
        var items = Array.isArray(data.items) ? data.items : [];
        markers = items.map(function (it) {
          return {
            filename: it.filename,
            lat: it.lat,
            lon: it.lon,
            timestamp: it.timestamp || 0,
            album: it.album || '',
            el: null,
            wx: 0,
            wy: 0,
          };
        });
        var countEl = document.getElementById('pc-map-count');
        countEl.textContent = markers.length === 1
          ? '1 foto GPS'
          : markers.length + ' foto GPS';
        if (markers.length === 0) {
          document.getElementById('pc-map-empty').style.display = 'flex';
          setView(41.9, 12.5, 5);
          return;
        }
        markers.forEach(function (m) { m.el = createMarkerEl(m); });
        // ?focus=<filename> centra direttamente su una foto (es. dalla lucebox)
        var focus = new URLSearchParams(window.location.search).get('focus');
        var focused = focus ? markers.find(function (m) { return m.filename === focus; }) : null;
        if (focused) {
          setView(focused.lat, focused.lon, 14);
          openPopup(focused);
        } else {
          fitToMarkers(false);
        }
      })
      .catch(function () {
        loading.textContent = 'Errore nel caricamento delle posizioni.';
        setTimeout(function () { loading.style.display = 'none'; }, 4000);
        if (!markersLoaded) fitToMarkers(false);
      });
  }

  // ------------------------------------------------------------------
  function init() {
    container = document.getElementById('pc-map');
    if (!container) return;
    tilesLayer = document.createElement('div');
    tilesLayer.style.cssText = 'position:absolute;inset:0;';
    markersLayer = document.createElement('div');
    markersLayer.style.cssText = 'position:absolute;inset:0;';
    container.appendChild(tilesLayer);
    container.appendChild(markersLayer);
    measure();
    // Vista iniziale provvisoria (Italia) finché non arrivano i marker
    setView(41.9, 12.5, 5);
    bindInteractions();
    document.getElementById('pc-popup-close').addEventListener('click', closePopup);
    container.addEventListener('click', function (e) {
      if (e.target === container || e.target === tilesLayer) closePopup();
    });
    loadMarkers();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
