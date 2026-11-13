/**
 * Motore di ricerca in linguaggio naturale (IT/EN) per l'archivio PhotoCloud.
 * Interpreta query tipo:
 *   "foto di agosto 2024", "video dell'anno scorso", "immagini preferite",
 *   "documenti di questa settimana", "album Vacanze mare 2023", "selfie"?
 *
 * Il parser è una funzione PURA: lo stesso identico comportamento è replicato
 * on-device in Kotlin (`NaturalLanguageSearchEngine.kt`) per la ricerca locale
 * nell'app Android.
 */

export interface NaturalQuery {
  /** token testuali liberi (match parziale sul nome file / album) */
  textTokens: string[];
  /** anni espliciti (es. 2023) */
  years: number[];
  /** mesi 1-12 */
  months: number[];
  /** giorni del mese 1-31 */
  days: number[];
  /** intervallo temporale normalizzato (epoch secondi, inclusivo) */
  dateFrom: number | null;
  dateTo: number | null;
  /** filtro per tipo */
  mediaType: 'photo' | 'video' | 'file' | null;
  /** solo preferiti */
  favoritesOnly: boolean;
  /** nomi di album richiesti esplicitamente */
  albums: string[];
  /** la query originale normalizzata (debug/spiegazioni) */
  explanation: string[];
}

export interface SearchableMediaItem {
  filename: string;
  timestamp: number; // epoch seconds
  isMedia: boolean;
  album?: string;
}

const IMAGE_EXTENSIONS = new Set(['jpg', 'jpeg', 'png', 'gif', 'webp', 'bmp', 'svg', 'heic', 'avif']);
const VIDEO_EXTENSIONS = new Set(['mp4', 'mov', 'webm', 'mkv']);

const MONTH_ALIASES: Record<string, number> = {
  gennaio: 1, febbraio: 2, marzo: 3, aprile: 4, maggio: 5, giugno: 6,
  luglio: 7, agosto: 8, settembre: 9, ottobre: 10, novembre: 11, dicembre: 12,
  gen: 1, feb: 2, mar: 3, apr: 4, mag: 5, giu: 6, lug: 7, ago: 8, set: 9, ott: 10, nov: 11, dic: 12,
  january: 1, february: 2, march: 3, april: 4, may: 5, june: 6,
  july: 7, august: 8, september: 9, october: 10, november: 11, december: 12,
  jan: 1, sep: 9, oct: 10, dec: 12,
};

const STOP_WORDS = new Set([
  'di', 'del', 'della', 'dello', 'dei', 'degli', 'delle', 'da', 'dal', 'dai', 'dalle', 'in', 'a', 'al',
  'alla', 'alle', 'e', 'ed', 'o', 'il', 'lo', 'la', 'i', 'gli', 'le', 'un', 'una', 'uno', 'con', 'per',
  'su', 'tra', 'fra', 'the', 'of', 'in', 'on', 'at', 'and', 'or', 'my', 'me', 'to', 'from', 'with',
  'mostra', 'mostrami', 'trova', 'cerca', 'vedi', 'show', 'find', 'search', "l'", "d'", "nell'", "all'",
]);

const DAY_MS = 86400;

function startOfDayEpoch(d: Date): number {
  return Math.floor(new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime() / 1000);
}

/** Normalizza una query in linguaggio naturale in una struttura interrogabile. */
export function parseNaturalQuery(rawQuery: string, now: Date = new Date()): NaturalQuery {
  const explanation: string[] = [];
  let text = ` ${String(rawQuery || '').toLowerCase()} `
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '') // rimuove accenti/diacritici
    .replace(/[^a-z0-9' ]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

  const q: NaturalQuery = {
    textTokens: [],
    years: [],
    months: [],
    days: [],
    dateFrom: null,
    dateTo: null,
    mediaType: null,
    favoritesOnly: false,
    albums: [],
    explanation,
  };
  if (!text) return q;

  const nowDayStart = startOfDayEpoch(now);

  // --- Frasi temporali multi-parola (valutate prima dei singoli token) ---
  const multiWord: Array<[RegExp, () => void, string]> = [
    [/\bquesta settimana\b|\bthis week\b/, () => {
      q.dateFrom = nowDayStart - 6 * DAY_MS;
      q.dateTo = nowDayStart + DAY_MS - 1;
    }, 'settimana corrente'],
    [/\bsettimana scorsa\b|\blast week\b/, () => {
      q.dateFrom = nowDayStart - 13 * DAY_MS;
      q.dateTo = nowDayStart - 7 * DAY_MS + DAY_MS - 1;
    }, 'settimana scorsa'],
    [/\bquesto mese\b|\bthis month\b/, () => {
      q.months.push(now.getMonth() + 1);
      q.years.push(now.getFullYear());
    }, 'mese corrente'],
    [/\bmese scorso\b|\blast month\b/, () => {
      const d = new Date(now.getFullYear(), now.getMonth() - 1, 1);
      q.months.push(d.getMonth() + 1);
      q.years.push(d.getFullYear());
    }, 'mese scorso'],
    [/\bquest'?anno\b|\bthis year\b/, () => {
      q.years.push(now.getFullYear());
    }, 'anno corrente'],
    [/\banno scorso\b|\blast year\b/, () => {
      q.years.push(now.getFullYear() - 1);
    }, 'anno scorso'],
    [/\boggi\b|\btoday\b/, () => {
      q.dateFrom = nowDayStart;
      q.dateTo = nowDayStart + DAY_MS - 1;
    }, 'oggi'],
    [/\bieri\b|\byesterday\b/, () => {
      q.dateFrom = nowDayStart - DAY_MS;
      q.dateTo = nowDayStart - 1;
    }, 'ieri'],
    [/\b(ultimi|ultime)\s+(\d{1,3})\s+giorni\b|\blast\s+(\d{1,3})\s+days\b/, () => {
      // gestita sotto con cattura del numero
    }, 'ultimi N giorni'],
  ];

  const lastNDays = text.match(/\b(?:ultimi|ultime)\s+(\d{1,3})\s+giorni\b/) || text.match(/\blast\s+(\d{1,3})\s+days\b/);
  if (lastNDays) {
    const n = Math.min(3650, parseInt(lastNDays[1], 10));
    q.dateFrom = nowDayStart - (n - 1) * DAY_MS;
    q.dateTo = nowDayStart + DAY_MS - 1;
    explanation.push(`ultimi ${n} giorni`);
    text = text.replace(lastNDays[0], ' ');
  }

  for (const [re, apply, label] of multiWord) {
    if (label === 'ultimi N giorni') continue;
    const m = text.match(re);
    if (m) {
      apply();
      explanation.push(label);
      text = text.replace(re, ' ');
    }
  }

  // --- album: "album Vacanze", "in vacanze 2023" ---
  const albumMatch = text.match(/\balbum\s+([a-z0-9][a-z0-9 _-]{0,60})/);
  if (albumMatch) {
    const name = albumMatch[1].trim().split(/\s+/).slice(0, 6).join(' ');
    if (name) {
      q.albums.push(name);
      explanation.push(`album "${name}"`);
      text = text.replace(albumMatch[0], ' ');
    }
  }

  // --- token singoli ---
  const rawTokens = text.split(' ').filter(Boolean);
  for (const tokenRaw of rawTokens) {
    const token = tokenRaw.replace(/^'+|'+$/g, '');
    if (!token) continue;

    if (/^(19|20)\d{2}$/.test(token)) {
      q.years.push(parseInt(token, 10));
      explanation.push(`anno ${token}`);
      continue;
    }
    if (MONTH_ALIASES[token] !== undefined) {
      q.months.push(MONTH_ALIASES[token]);
      explanation.push(`mese ${MONTH_ALIASES[token]}`);
      continue;
    }
    if (['foto', 'photo', 'photos', 'immagini', 'immagine', 'picture', 'pictures', 'image', 'images'].includes(token)) {
      q.mediaType = 'photo';
      explanation.push('solo foto');
      continue;
    }
    if (['video', 'videos', 'filmato', 'filmati', 'clip'].includes(token)) {
      q.mediaType = 'video';
      explanation.push('solo video');
      continue;
    }
    if (['file', 'documento', 'documenti', 'document', 'documents', 'pdf', 'doc', 'docs'].includes(token)) {
      q.mediaType = 'file';
      explanation.push('solo file cloud');
      continue;
    }
    if (['preferiti', 'preferito', 'favorite', 'favorites', 'favourites', 'starred', 'stella'].includes(token)) {
      q.favoritesOnly = true;
      explanation.push('solo preferiti');
      continue;
    }
    if (STOP_WORDS.has(token)) continue;

    q.textTokens.push(token);
  }

  q.years = [...new Set(q.years)];
  q.months = [...new Set(q.months)];
  q.textTokens = [...new Set(q.textTokens)];
  return q;
}

function itemExtension(item: SearchableMediaItem): string {
  const idx = item.filename.lastIndexOf('.');
  return idx >= 0 ? item.filename.slice(idx + 1).toLowerCase() : '';
}

/** Verifica se un elemento media corrisponde alla query parsata. */
export function mediaItemMatchesQuery(
  item: SearchableMediaItem,
  q: NaturalQuery,
  favorites?: ReadonlySet<string>
): boolean {
  if (q.favoritesOnly) {
    if (!favorites || !favorites.has(item.filename)) return false;
  }

  if (q.mediaType === 'photo') {
    if (!item.isMedia || !IMAGE_EXTENSIONS.has(itemExtension(item))) return false;
  } else if (q.mediaType === 'video') {
    if (!item.isMedia || !VIDEO_EXTENSIONS.has(itemExtension(item))) return false;
  } else if (q.mediaType === 'file') {
    if (item.isMedia) return false;
  }

  if (q.dateFrom !== null && q.dateTo !== null) {
    if (item.timestamp < q.dateFrom || item.timestamp > q.dateTo) return false;
  }

  if (q.years.length > 0 || q.months.length > 0 || q.days.length > 0) {
    const d = new Date(item.timestamp * 1000);
    if (q.years.length > 0 && !q.years.includes(d.getFullYear())) return false;
    if (q.months.length > 0 && !q.months.includes(d.getMonth() + 1)) return false;
    if (q.days.length > 0 && !q.days.includes(d.getDate())) return false;
  }

  if (q.albums.length > 0) {
    const itemAlbum = (item.album || '').toLowerCase();
    const allAlbumsOk = q.albums.every((a) => itemAlbum.includes(a));
    if (!allAlbumsOk) return false;
  }

  if (q.textTokens.length > 0) {
    const haystack = `${item.filename} ${(item.album || '')}`.toLowerCase();
    const allTokensOk = q.textTokens.every((t) => haystack.includes(t));
    if (!allTokensOk) return false;
  }

  return true;
}

/** Filtra una lista di elementi media in base a una query in linguaggio naturale. */
export function searchMediaItems(
  items: SearchableMediaItem[],
  rawQuery: string,
  favorites?: ReadonlySet<string>,
  now: Date = new Date()
): { query: NaturalQuery; results: SearchableMediaItem[] } {
  const query = parseNaturalQuery(rawQuery, now);
  const results = items.filter((item) => mediaItemMatchesQuery(item, query, favorites));
  return { query, results };
}
