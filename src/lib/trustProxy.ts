import net from 'node:net';

const EXPRESS_PROXY_PRESETS = new Set(['loopback', 'linklocal', 'uniquelocal']);

function isValidSubnetOrIpEntry(entry: string): boolean {
  if (!entry) return false;
  if (EXPRESS_PROXY_PRESETS.has(entry.toLowerCase())) return true;
  const slashIdx = entry.indexOf('/');
  if (slashIdx === -1) {
    return net.isIP(entry) !== 0;
  }
  const ipPart = entry.slice(0, slashIdx);
  const maskPart = entry.slice(slashIdx + 1);
  const ipVersion = net.isIP(ipPart);
  if (ipVersion === 0 || !/^\d+$/.test(maskPart)) return false;
  const prefix = Number.parseInt(maskPart, 10);
  return ipVersion === 4 ? prefix >= 0 && prefix <= 32 : prefix >= 0 && prefix <= 128;
}

export function parseTrustProxyConfig(
  rawValue: string | undefined,
  onWarn: (msg: string) => void = (msg) => console.warn(msg)
): false | number | string[] {
  const trimmed = String(rawValue ?? '').trim();
  if (!trimmed || trimmed === '0' || trimmed.toLowerCase() === 'false') {
    return false;
  }
  if (trimmed.toLowerCase() === 'true') {
    onWarn(
      '[PhotoCloud][WARN] TRUST_PROXY="true" è stato rifiutato e ignorato per motivi di sicurezza (permette lo spoofing di X-Forwarded-For). Usa un intero (es. TRUST_PROXY=1) o una lista di subnet/IP fidati (es. TRUST_PROXY=127.0.0.1,10.0.0.0/8).'
    );
    return false;
  }
  if (/^\d+$/.test(trimmed)) {
    const hops = Number.parseInt(trimmed, 10);
    if (!Number.isSafeInteger(hops) || hops <= 0 || hops > 64) {
      onWarn(`[PhotoCloud][WARN] TRUST_PROXY="${trimmed}" fuori intervallo valido (1..64 hop); ignorato.`);
      return false;
    }
    return hops;
  }
  const parts = trimmed
    .split(',')
    .map((p) => p.trim())
    .filter(Boolean);
  if (parts.length === 0 || !parts.every(isValidSubnetOrIpEntry)) {
    onWarn(
      `[PhotoCloud][WARN] TRUST_PROXY="${trimmed}" non è un intero né una lista valida di IP/subnet CIDR; ignorato.`
    );
    return false;
  }
  return parts;
}
