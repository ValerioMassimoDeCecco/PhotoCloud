/**
 * Shared HTTP / HTTPS transport protocol mode helpers for PhotoCloud Zero-Knowledge v2.
 * Pure, side-effect-free functions so they can be unit-tested deterministically.
 */

export type TransportProtocolMode = 'http' | 'https';

export const TRANSPORT_MODE_HEADER = 'X-PhotoCloud-Transport-Mode';
export const TRANSPORT_MODE_STORAGE_KEY = 'photocloud_v2_transport_mode';

export function normalizeTransportMode(
  value: unknown,
  fallback: TransportProtocolMode = 'https'
): TransportProtocolMode {
  if (typeof value === 'string') {
    const cleaned = value.trim().toLowerCase().replace(/:$/, '');
    if (cleaned === 'http') return 'http';
    if (cleaned === 'https') return 'https';
  }
  return fallback;
}

export function detectDefaultTransportMode(
  locationProtocol?: string | null
): TransportProtocolMode {
  return normalizeTransportMode(locationProtocol, 'https');
}

/**
 * Rewrites an HTTP/HTTPS URL (or bare host[:port]) to use the requested protocol scheme.
 * Empty strings are preserved for same-origin relative requests.
 */
export function applyTransportModeToUrl(
  rawUrl: string,
  mode: TransportProtocolMode
): string {
  const trimmed = rawUrl.trim().replace(/\/+$/, '');
  if (!trimmed) return '';
  if (/^https?:\/\//i.test(trimmed)) {
    return trimmed.replace(/^https?:\/\//i, `${mode}://`);
  }
  if (trimmed.startsWith('/')) {
    return trimmed;
  }
  return `${mode}://${trimmed}`;
}

/**
 * Resolves the effective origin string using the chosen HTTP or HTTPS protocol mode.
 */
export function resolveOriginForTransportMode(
  origin: string,
  mode: TransportProtocolMode,
  advertisedUrls?: { httpUrl?: string | null; httpsUrl?: string | null }
): string {
  const explicit = mode === 'https' ? advertisedUrls?.httpsUrl : advertisedUrls?.httpUrl;
  if (typeof explicit === 'string' && explicit.trim().length > 0) {
    return applyTransportModeToUrl(explicit, mode);
  }
  return applyTransportModeToUrl(origin, mode);
}
