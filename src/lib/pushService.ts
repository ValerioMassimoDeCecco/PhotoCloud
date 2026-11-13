/**
 * Servizio Web Push (protocollo VAPID) per le notifiche PWA v1.4.0.
 *
 * - Chiavi VAPID generate una sola volta e persistite in `user_media/.vapid.json`
 *   (zone già esclusa da git): la chiave pubblica è servita ai client, quella
 *   privata non lascia mai il server.
 * - Le subscription push di ogni utente vivono in `user_media/<user>/.push.json`.
 * - `sendPushToUser` è fire-and-forget e non blocca mai la risposta HTTP:
 *   endpoint morti o scaduti vengono rimossi automaticamente (criterio standard
 *   RFC 8030 su risposte 404/410).
 */
import path from 'node:path';
import { readJsonFile, writeJsonAtomic } from './vaultStorage';

interface VapidKeysFile {
  version: 1;
  publicKey: string;
  privateKey: string;
  createdAt: string;
}

export interface PushSubscriptionRecord {
  endpoint: string;
  keys: { p256dh: string; auth: string };
  userAgent?: string;
  createdAt: number;
}

interface UserPushFileSchema {
  version: 1;
  subscriptions: PushSubscriptionRecord[];
}

let cachedVapidKeys: { publicKey: string; privateKey: string } | null = null;

/** Chiave pubblica VAPID disponibile dopo `initPushService()`; null se push non inizializzato. */
export function getVapidPublicKey(): string | null {
  return cachedVapidKeys ? cachedVapidKeys.publicKey : null;
}

let pushInitPromise: Promise<{ publicKey: string; privateKey: string } | null> | null = null;

/** Inizializza (lazy, una sola volta) le chiavi VAPID e configura web-push. */
export async function initPushService(rootDir: string): Promise<{ publicKey: string } | null> {
  if (pushInitPromise) {
    const res = await pushInitPromise;
    return res ? { publicKey: res.publicKey } : null;
  }
  pushInitPromise = (async () => {
    try {
      const webpush = (await import('web-push')).default;
      const vapidPath = path.join(rootDir, '.vapid.json');
      let keys = readJsonFile<VapidKeysFile | null>(vapidPath, null);
      if (
        !keys ||
        keys.version !== 1 ||
        typeof keys.publicKey !== 'string' ||
        typeof keys.privateKey !== 'string' ||
        keys.publicKey.length < 20 ||
        keys.privateKey.length < 20
      ) {
        const generated = webpush.generateVAPIDKeys();
        keys = {
          version: 1,
          publicKey: generated.publicKey,
          privateKey: generated.privateKey,
          createdAt: new Date().toISOString(),
        };
        writeJsonAtomic(vapidPath, keys);
      }
      cachedVapidKeys = { publicKey: keys.publicKey, privateKey: keys.privateKey };
      webpush.setVapidDetails(
        'mailto:photocloud@localhost',
        keys.publicKey,
        keys.privateKey
      );
      return cachedVapidKeys;
    } catch {
      return null;
    }
  })();
  const res = await pushInitPromise;
  return res ? { publicKey: res.publicKey } : null;
}

export function getUserPushPath(userFolder: string): string {
  return path.join(userFolder, '.push.json');
}

export function loadUserSubscriptions(userFolder: string): PushSubscriptionRecord[] {
  const data = readJsonFile<UserPushFileSchema>(getUserPushPath(userFolder), {
    version: 1,
    subscriptions: [],
  });
  if (!Array.isArray(data.subscriptions)) return [];
  return data.subscriptions.filter(
    (s): s is PushSubscriptionRecord =>
      !!s &&
      typeof s.endpoint === 'string' &&
      /^https:\/\//.test(s.endpoint) &&
      !!s.keys &&
      typeof s.keys.p256dh === 'string' &&
      typeof s.keys.auth === 'string'
  );
}

export function saveUserSubscriptions(userFolder: string, subscriptions: PushSubscriptionRecord[]): void {
  writeJsonAtomic(getUserPushPath(userFolder), { version: 1, subscriptions: subscriptions.slice(0, 50) });
}

export function addUserSubscription(userFolder: string, sub: PushSubscriptionRecord): number {
  const list = loadUserSubscriptions(userFolder);
  const idx = list.findIndex((s) => s.endpoint === sub.endpoint);
  if (idx >= 0) list[idx] = sub;
  else list.push(sub);
  saveUserSubscriptions(userFolder, list);
  return list.length;
}

export function removeUserSubscription(userFolder: string, endpoint: string): number {
  const list = loadUserSubscriptions(userFolder).filter((s) => s.endpoint !== endpoint);
  saveUserSubscriptions(userFolder, list);
  return list.length;
}

/**
 * Invia una notifica Web Push a tutti i dispositivi registrati dell'utente.
 * Non solleva mai eccezioni: i fallimenti rimuovono l'endpoint (se morto) e
 * proseguono silenziosamente.
 */
export async function sendPushToUser(
  userFolder: string,
  payload: { title: string; body: string; icon?: string; url?: string; tag?: string }
): Promise<{ sent: number; removed: number }> {
  let sent = 0;
  let removed = 0;
  try {
    if (!cachedVapidKeys) return { sent, removed };
    const webpush = (await import('web-push')).default;
    const subscriptions = loadUserSubscriptions(userFolder);
    if (subscriptions.length === 0) return { sent, removed };

    const body = JSON.stringify({
      title: payload.title,
      body: payload.body,
      icon: payload.icon || '/pwa-192x192.png',
      url: payload.url || '/',
      tag: payload.tag || 'photocloud-notification',
    });

    const survivors: PushSubscriptionRecord[] = [];
    for (const sub of subscriptions) {
      try {
        await webpush.sendNotification(
          { endpoint: sub.endpoint, keys: { p256dh: sub.keys.p256dh, auth: sub.keys.auth } },
          body,
          { TTL: 60 * 60 }
        );
        sent++;
        survivors.push(sub);
      } catch (err: unknown) {
        const statusCode =
          err && typeof err === 'object' && 'statusCode' in err
            ? Number((err as { statusCode?: unknown }).statusCode)
            : 0;
        if (statusCode === 404 || statusCode === 410) {
          removed++;
        } else {
          survivors.push(sub);
        }
      }
    }
    if (survivors.length !== subscriptions.length) {
      saveUserSubscriptions(userFolder, survivors);
    }
  } catch {
    // push non disponibile: ignora
  }
  return { sent, removed };
}
