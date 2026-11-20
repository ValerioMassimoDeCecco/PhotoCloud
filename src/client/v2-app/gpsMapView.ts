import {
  TILE_SIZE,
  clusterGeoItems,
  computeInitialMapViewport,
  formatCoordinates,
  isValidGpsCoord,
  latLonToWorldPixel,
  worldPixelToLatLon,
  type GeoPointItem,
  type MapCluster,
  type MapViewport,
} from '../../lib/gpsMapClustering.ts';
import { isSafeRasterImageMime, type DecryptedItemV2, type ZkVaultClient } from '../zk-sdk/index.ts';

function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  className?: string,
  text?: string
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

export interface GpsMapViewOptions {
  client: ZkVaultClient;
  items: DecryptedItemV2[];
  initialFocus?: { lat: number; lon: number } | null;
  registerObjectUrl: (blob: Blob) => string;
  onOpenItem: (item: DecryptedItemV2) => void;
  onNavigateUploadHint: () => void;
}

export function renderGpsMapView(container: HTMLElement, opts: GpsMapViewOptions): void {
  container.textContent = '';

  const geoItems: GeoPointItem<DecryptedItemV2>[] = [];
  for (const item of opts.items) {
    const lat = item.meta.exifSubset?.lat;
    const lon = item.meta.exifSubset?.lon;
    if (typeof lat === 'number' && typeof lon === 'number' && isValidGpsCoord(lat, lon)) {
      geoItems.push({
        id: item.id,
        lat,
        lon,
        takenAt: item.meta.takenAt ?? item.createdAt,
        payload: item,
      });
    }
  }

  const headerBar = el('div', 'toolbar-row map-toolbar');
  const titleGroup = el('div', 'map-toolbar-left');
  titleGroup.appendChild(el('span', 'brand-title', 'Mappa GPS Cifrata'));
  titleGroup.appendChild(
    el(
      'span',
      'media-card-meta mono-nums',
      geoItems.length === 1
        ? '1 foto geolocalizzata decifrata in RAM · Zero dati GPS al server'
        : `${geoItems.length} foto geolocalizzate decifrate in RAM · Zero dati GPS al server`
    )
  );
  headerBar.appendChild(titleGroup);

  const controlsRight = el('div', 'map-toolbar-right');
  let offlineVectorMode = false;
  const offlineBtn = el('button', 'btn btn-ghost', 'Tile OSM: Attive');
  offlineBtn.id = 'btn-map-toggle-tiles';
  const zoomOutBtn = el('button', 'btn', '−');
  zoomOutBtn.id = 'btn-map-zoom-out';
  zoomOutBtn.title = 'Riduci zoom';
  const zoomInBtn = el('button', 'btn', '+');
  zoomInBtn.id = 'btn-map-zoom-in';
  zoomInBtn.title = 'Aumenta zoom';
  const fitBtn = el('button', 'btn', 'Centra Tutto');
  fitBtn.id = 'btn-map-fit';

  controlsRight.append(offlineBtn, zoomOutBtn, zoomInBtn, fitBtn);
  headerBar.appendChild(controlsRight);
  container.appendChild(headerBar);

  if (geoItems.length === 0) {
    const emptyCard = el('div', 'empty-state-card');
    emptyCard.id = 'map-empty-state';
    emptyCard.appendChild(el('h3', 'brand-title', 'Nessuna foto con coordinate GPS cifrate'));
    emptyCard.appendChild(
      el(
        'p',
        'media-card-meta',
        'Per privacy, l\'upload rimuove le coordinate GPS di default. Attiva "Includi GPS cifrato" nel pannello di caricamento per visualizzare le tue foto sulla mappa Zero-Knowledge.'
      )
    );
    const goBtn = el('button', 'btn btn-primary', 'Torna alla Galleria');
    goBtn.addEventListener('click', () => opts.onNavigateUploadHint());
    emptyCard.appendChild(goBtn);
    container.appendChild(emptyCard);
    return;
  }

  let viewport: MapViewport = opts.initialFocus
    ? { lat: opts.initialFocus.lat, lon: opts.initialFocus.lon, zoom: 13 }
    : computeInitialMapViewport(geoItems, 920, 500);
  let selectedCluster: MapCluster<DecryptedItemV2> | null = null;
  const thumbUrlCache = new Map<string, string>();

  const mapShell = el('div', 'map-shell');
  const mapStage = el('div', 'map-stage');
  mapStage.id = 'zk-gps-map-stage';

  const tileLayer = el('div', 'map-tile-layer');
  const gridOverlay = el('div', 'map-vector-grid hidden');
  const markerLayer = el('div', 'map-marker-layer');
  const coordHud = el('div', 'map-coord-hud mono-nums', '');
  coordHud.id = 'map-coord-hud';

  mapStage.append(tileLayer, gridOverlay, markerLayer, coordHud);
  mapShell.appendChild(mapStage);

  const drawer = el('div', 'map-cluster-drawer hidden');
  drawer.id = 'map-cluster-drawer';
  mapShell.appendChild(drawer);
  container.appendChild(mapShell);

  const loadThumb = (item: DecryptedItemV2, imgEl: HTMLImageElement) => {
    const cached = thumbUrlCache.get(item.blobId);
    if (cached) {
      imgEl.src = cached;
      return;
    }
    if (!item.thumbs.includes(320) || !isSafeRasterImageMime(item.meta.mime)) return;
    opts.client
      .downloadThumbnail(item.blobId, 320)
      .then((bytes) => {
        const url = opts.registerObjectUrl(
          new Blob([bytes as unknown as BlobPart], { type: 'image/jpeg' })
        );
        thumbUrlCache.set(item.blobId, url);
        imgEl.src = url;
      })
      .catch(() => {});
  };

  const renderDrawer = () => {
    drawer.textContent = '';
    if (!selectedCluster) {
      drawer.classList.add('hidden');
      return;
    }
    drawer.classList.remove('hidden');

    const head = el('div', 'map-drawer-head');
    head.appendChild(
      el(
        'div',
        'map-drawer-title',
        `${selectedCluster.count} ${selectedCluster.count === 1 ? 'foto' : 'foto'} · ${formatCoordinates(
          selectedCluster.lat,
          selectedCluster.lon
        )}`
      )
    );
    const closeDrawerBtn = el('button', 'btn btn-ghost', 'Chiudi');
    closeDrawerBtn.addEventListener('click', () => {
      selectedCluster = null;
      renderDrawer();
    });
    head.appendChild(closeDrawerBtn);
    drawer.appendChild(head);

    const strip = el('div', 'map-drawer-strip');
    for (const geo of selectedCluster.items) {
      const item = geo.payload;
      const card = el('button', 'map-drawer-item');
      card.type = 'button';
      const thumb = el('img', 'map-drawer-thumb');
      thumb.alt = item.meta.name;
      loadThumb(item, thumb);
      card.appendChild(thumb);
      card.appendChild(el('span', 'map-drawer-name', item.meta.name));
      card.addEventListener('click', () => opts.onOpenItem(item));
      strip.appendChild(card);
    }
    drawer.appendChild(strip);
  };

  const renderMap = () => {
    const stageW = Math.max(300, mapStage.clientWidth || 860);
    const stageH = Math.max(320, mapStage.clientHeight || 480);
    const z = Math.max(2, Math.min(18, Math.round(viewport.zoom)));
    viewport.zoom = z;

    const centerWorld = latLonToWorldPixel(viewport.lat, viewport.lon, z);
    const originX = centerWorld.x - stageW / 2;
    const originY = centerWorld.y - stageH / 2;

    // 1. Render OSM tiles or offline vector graticule
    tileLayer.textContent = '';
    gridOverlay.classList.toggle('hidden', !offlineVectorMode);
    if (!offlineVectorMode) {
      const numTiles = 1 << z;
      const startTx = Math.floor(originX / TILE_SIZE);
      const endTx = Math.floor((originX + stageW) / TILE_SIZE);
      const startTy = Math.max(0, Math.floor(originY / TILE_SIZE));
      const endTy = Math.min(numTiles - 1, Math.floor((originY + stageH) / TILE_SIZE));

      for (let tx = startTx; tx <= endTx; tx++) {
        const wrappedTx = ((tx % numTiles) + numTiles) % numTiles;
        for (let ty = startTy; ty <= endTy; ty++) {
          const tileImg = el('img', 'map-tile-img');
          tileImg.alt = '';
          tileImg.decoding = 'async';
          tileImg.referrerPolicy = 'no-referrer';
          tileImg.draggable = false;
          tileImg.style.left = `${Math.round(tx * TILE_SIZE - originX)}px`;
          tileImg.style.top = `${Math.round(ty * TILE_SIZE - originY)}px`;
          tileImg.src = `https://tile.openstreetmap.org/${z}/${wrappedTx}/${ty}.png`;
          tileImg.onerror = () => {
            tileImg.style.display = 'none';
            gridOverlay.classList.remove('hidden');
          };
          tileLayer.appendChild(tileImg);
        }
      }
    }

    // 2. Render clusters in RAM
    markerLayer.textContent = '';
    const clusters = clusterGeoItems(geoItems, z, 54);
    for (const cluster of clusters) {
      const sx = cluster.worldX - originX;
      const sy = cluster.worldY - originY;
      if (sx < -64 || sx > stageW + 64 || sy < -64 || sy > stageH + 64) continue;

      const pin = el(
        'button',
        `map-pin ${cluster.count > 1 ? 'map-pin-cluster' : 'map-pin-single'}`
      );
      pin.type = 'button';
      pin.dataset.clusterId = cluster.id;
      pin.style.left = `${Math.round(sx)}px`;
      pin.style.top = `${Math.round(sy)}px`;
      pin.title = `${cluster.representative.payload.meta.name} (${formatCoordinates(
        cluster.lat,
        cluster.lon
      )})`;

      const thumbImg = el('img', 'map-pin-thumb');
      thumbImg.alt = cluster.representative.payload.meta.name;
      loadThumb(cluster.representative.payload, thumbImg);
      pin.appendChild(thumbImg);

      if (cluster.count > 1) {
        const countEl = el('span', 'map-pin-count mono-nums', String(cluster.count));
        pin.appendChild(countEl);
      }

      pin.addEventListener('click', (ev) => {
        ev.stopPropagation();
        if (cluster.count > 1 && z < 15) {
          viewport = { lat: cluster.lat, lon: cluster.lon, zoom: Math.min(16, z + 2) };
          selectedCluster = cluster;
          renderMap();
          renderDrawer();
        } else {
          selectedCluster = cluster;
          renderDrawer();
        }
      });

      markerLayer.appendChild(pin);
    }

    coordHud.textContent = `${formatCoordinates(viewport.lat, viewport.lon)} · Zoom ${z} · ${clusters.length} marker`;
  };

  // Pan interactions
  let panState: { startX: number; startY: number; startWorldX: number; startWorldY: number } | null =
    null;

  mapStage.addEventListener('pointerdown', (ev) => {
    if ((ev.target as HTMLElement).closest('.map-pin')) return;
    mapStage.setPointerCapture(ev.pointerId);
    const w = latLonToWorldPixel(viewport.lat, viewport.lon, viewport.zoom);
    panState = {
      startX: ev.clientX,
      startY: ev.clientY,
      startWorldX: w.x,
      startWorldY: w.y,
    };
  });

  mapStage.addEventListener('pointermove', (ev) => {
    if (!panState) return;
    const dx = ev.clientX - panState.startX;
    const dy = ev.clientY - panState.startY;
    const next = worldPixelToLatLon(
      panState.startWorldX - dx,
      panState.startWorldY - dy,
      viewport.zoom
    );
    viewport = { ...viewport, lat: next.lat, lon: next.lon };
    renderMap();
  });

  mapStage.addEventListener('pointerup', (ev) => {
    if (!panState) return;
    try {
      mapStage.releasePointerCapture(ev.pointerId);
    } catch {
      // ignore
    }
    panState = null;
  });

  mapStage.addEventListener(
    'wheel',
    (ev) => {
      ev.preventDefault();
      const delta = ev.deltaY < 0 ? 1 : -1;
      viewport = { ...viewport, zoom: Math.max(2, Math.min(18, viewport.zoom + delta)) };
      renderMap();
    },
    { passive: false }
  );

  zoomInBtn.addEventListener('click', () => {
    viewport = { ...viewport, zoom: Math.min(18, viewport.zoom + 1) };
    renderMap();
  });
  zoomOutBtn.addEventListener('click', () => {
    viewport = { ...viewport, zoom: Math.max(2, viewport.zoom - 1) };
    renderMap();
  });
  fitBtn.addEventListener('click', () => {
    viewport = computeInitialMapViewport(
      geoItems,
      mapStage.clientWidth || 860,
      mapStage.clientHeight || 480
    );
    selectedCluster = null;
    renderMap();
    renderDrawer();
  });
  offlineBtn.addEventListener('click', () => {
    offlineVectorMode = !offlineVectorMode;
    offlineBtn.textContent = offlineVectorMode ? 'Griglia Offline: Attiva' : 'Tile OSM: Attive';
    renderMap();
  });

  requestAnimationFrame(() => renderMap());
}
