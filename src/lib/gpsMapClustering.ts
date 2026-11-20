/**
 * Client-side Zero-Knowledge Web Mercator projection & spatial clustering
 * for decrypted photo GPS coordinates (`encMeta.exifSubset.{lat,lon}`).
 *
 * Pure module with zero DOM/network dependencies so it can be unit-tested
 * deterministically via `node:test`.
 */

export const MAX_MERCATOR_LAT = 85.05112878;
export const TILE_SIZE = 256;

export interface GeoPointItem<T = unknown> {
  id: string;
  lat: number;
  lon: number;
  takenAt?: number;
  payload: T;
}

export interface MapCluster<T = unknown> {
  id: string;
  lat: number;
  lon: number;
  worldX: number;
  worldY: number;
  count: number;
  items: GeoPointItem<T>[];
  representative: GeoPointItem<T>;
  bounds: {
    minLat: number;
    maxLat: number;
    minLon: number;
    maxLon: number;
  };
}

export interface MapViewport {
  lat: number;
  lon: number;
  zoom: number;
}

export function clampLatitude(lat: number): number {
  return Math.max(-MAX_MERCATOR_LAT, Math.min(MAX_MERCATOR_LAT, lat));
}

export function normalizeLongitude(lon: number): number {
  let out = ((lon + 180) % 360 + 360) % 360 - 180;
  if (out === -180 && lon > 0) out = 180;
  return out;
}

export function isValidGpsCoord(lat: unknown, lon: unknown): lat is number {
  return (
    typeof lat === 'number' &&
    typeof lon === 'number' &&
    Number.isFinite(lat) &&
    Number.isFinite(lon) &&
    lat >= -90 &&
    lat <= 90 &&
    lon >= -180 &&
    lon <= 180 &&
    !(Math.abs(lat) < 1e-7 && Math.abs(lon) < 1e-7)
  );
}

/**
 * Projects `(lat, lon)` into Web Mercator world pixel coordinates at `zoom`.
 */
export function latLonToWorldPixel(
  lat: number,
  lon: number,
  zoom: number
): { x: number; y: number } {
  const worldSize = TILE_SIZE * Math.pow(2, zoom);
  const clampedLat = clampLatitude(lat);
  const sinLat = Math.sin((clampedLat * Math.PI) / 180);
  const x = ((normalizeLongitude(lon) + 180) / 360) * worldSize;
  const y =
    (0.5 - Math.log((1 + sinLat) / (1 - sinLat)) / (4 * Math.PI)) * worldSize;
  return { x, y };
}

/**
 * Inverse Web Mercator projection from world pixel coordinates at `zoom` back to `(lat, lon)`.
 */
export function worldPixelToLatLon(
  x: number,
  y: number,
  zoom: number
): { lat: number; lon: number } {
  const worldSize = TILE_SIZE * Math.pow(2, zoom);
  const lon = normalizeLongitude((x / worldSize) * 360 - 180);
  const n = Math.PI - (2 * Math.PI * y) / worldSize;
  const lat = clampLatitude((180 / Math.PI) * Math.atan(0.5 * (Math.exp(n) - Math.exp(-n))));
  return { lat, lon };
}

/**
 * Deterministic greedy distance clustering in projected pixel space.
 * Items sorted newest-first so cluster representative is always the most recent photo.
 */
export function clusterGeoItems<T>(
  items: ReadonlyArray<GeoPointItem<T>>,
  zoom: number,
  radiusPx = 56
): MapCluster<T>[] {
  const valid = items
    .filter((item) => isValidGpsCoord(item.lat, item.lon))
    .slice()
    .sort((a, b) => (b.takenAt ?? 0) - (a.takenAt ?? 0) || a.id.localeCompare(b.id));

  const clusters: Array<{
    sumLat: number;
    sumLon: number;
    worldX: number;
    worldY: number;
    minLat: number;
    maxLat: number;
    minLon: number;
    maxLon: number;
    items: GeoPointItem<T>[];
  }> = [];

  const rSq = Math.max(16, radiusPx) ** 2;

  for (const item of valid) {
    const pt = latLonToWorldPixel(item.lat, item.lon, zoom);
    let target: (typeof clusters)[number] | null = null;
    let bestDistSq = Infinity;

    for (const c of clusters) {
      const dx = c.worldX - pt.x;
      const dy = c.worldY - pt.y;
      const distSq = dx * dx + dy * dy;
      if (distSq <= rSq && distSq < bestDistSq) {
        bestDistSq = distSq;
        target = c;
      }
    }

    if (target) {
      target.items.push(item);
      target.sumLat += item.lat;
      target.sumLon += item.lon;
      target.minLat = Math.min(target.minLat, item.lat);
      target.maxLat = Math.max(target.maxLat, item.lat);
      target.minLon = Math.min(target.minLon, item.lon);
      target.maxLon = Math.max(target.maxLon, item.lon);
      const count = target.items.length;
      const meanLat = target.sumLat / count;
      const meanLon = target.sumLon / count;
      const updatedPt = latLonToWorldPixel(meanLat, meanLon, zoom);
      target.worldX = updatedPt.x;
      target.worldY = updatedPt.y;
    } else {
      clusters.push({
        sumLat: item.lat,
        sumLon: item.lon,
        worldX: pt.x,
        worldY: pt.y,
        minLat: item.lat,
        maxLat: item.lat,
        minLon: item.lon,
        maxLon: item.lon,
        items: [item],
      });
    }
  }

  return clusters.map((c) => {
    const count = c.items.length;
    const lat = Number((c.sumLat / count).toFixed(6));
    const lon = Number((c.sumLon / count).toFixed(6));
    const rep = c.items[0];
    return {
      id: count === 1 ? `pin-${rep.id}` : `cluster-${rep.id}-${count}`,
      lat,
      lon,
      worldX: c.worldX,
      worldY: c.worldY,
      count,
      items: c.items,
      representative: rep,
      bounds: {
        minLat: c.minLat,
        maxLat: c.maxLat,
        minLon: c.minLon,
        maxLon: c.maxLon,
      },
    };
  });
}

/**
 * Computes an ideal center & zoom level to fit all GPS points within `(widthPx, heightPx)`.
 */
export function computeInitialMapViewport(
  points: ReadonlyArray<{ lat: number; lon: number }>,
  widthPx = 900,
  heightPx = 560,
  minZoom = 2,
  maxZoom = 15
): MapViewport {
  const valid = points.filter((p) => isValidGpsCoord(p.lat, p.lon));
  if (valid.length === 0) {
    // Default overview centered on Italy / Europe
    return { lat: 42.5, lon: 12.5, zoom: 5 };
  }
  if (valid.length === 1) {
    return { lat: valid[0].lat, lon: valid[0].lon, zoom: 12 };
  }

  let minLat = 90;
  let maxLat = -90;
  let minLon = 180;
  let maxLon = -180;
  for (const p of valid) {
    minLat = Math.min(minLat, p.lat);
    maxLat = Math.max(maxLat, p.lat);
    minLon = Math.min(minLon, p.lon);
    maxLon = Math.max(maxLon, p.lon);
  }

  const centerLat = (minLat + maxLat) / 2;
  const centerLon = (minLon + maxLon) / 2;
  const padW = Math.max(160, widthPx * 0.72);
  const padH = Math.max(160, heightPx * 0.72);

  for (let z = maxZoom; z >= minZoom; z--) {
    const p1 = latLonToWorldPixel(maxLat, minLon, z);
    const p2 = latLonToWorldPixel(minLat, maxLon, z);
    if (Math.abs(p2.x - p1.x) <= padW && Math.abs(p2.y - p1.y) <= padH) {
      return { lat: centerLat, lon: centerLon, zoom: z };
    }
  }
  return { lat: centerLat, lon: centerLon, zoom: minZoom };
}

/**
 * Formats coordinates in compact tabular format, e.g. `45.4642° N · 9.1900° E`.
 */
export function formatCoordinates(lat: number, lon: number): string {
  const latDir = lat >= 0 ? 'N' : 'S';
  const lonDir = lon >= 0 ? 'E' : 'W';
  return `${Math.abs(lat).toFixed(4)}° ${latDir} · ${Math.abs(lon).toFixed(4)}° ${lonDir}`;
}
