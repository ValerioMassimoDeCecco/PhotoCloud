/**
 * Motore di Perceptual Hash (pHash basato su DCT) per la ricerca di
 * "duplicati quasi identici": foto ridimensionate, ricompresso o ritagliate
 * leggermente che il controllo SHA-256 esatto non intercetta.
 *
 * Pipeline classica (pHash.org):
 *  1. decodifica immagine → grayscale 32×32
 *  2. DCT-II bidimensionale
 *  3. blocco 8×8 a bassa frequenza (DC escluso) confrontato con la mediana
 *  4. hash a 64 bit → distanza di Hamming tra immagini.
 */
import path from 'node:path';

/** Estensioni immagine analizzabili con il decoder pure-JS (jimp). */
export const PHASH_SUPPORTED_EXTENSIONS = new Set([
  '.jpg',
  '.jpeg',
  '.png',
  '.gif',
  '.bmp',
]);

export function isPHashSupportedFilename(filename: string): boolean {
  return PHASH_SUPPORTED_EXTENSIONS.has(path.extname(filename).toLowerCase());
}

/** Dimensione del lato della matrice grayscale campionata per la DCT. */
export const PHASH_SAMPLE_SIZE = 32;
/** Lato del blocco a bassa frequenza estratto dall'angolo alto-sinistro della DCT. */
export const PHASH_LOW_FREQ_SIZE = 8;

let cosTable: Float64Array[] | null = null;

function getCosTable(size: number): Float64Array[] {
  if (cosTable && cosTable.length === size) return cosTable;
  const table: Float64Array[] = [];
  for (let u = 0; u < size; u++) {
    const row = new Float64Array(size);
    for (let x = 0; x < size; x++) {
      row[x] = Math.cos(((2 * x + 1) * u * Math.PI) / (2 * size));
    }
    table.push(row);
  }
  cosTable = table;
  return table;
}

/**
 * Calcola l'hash percettivo a 64 bit a partire dai pixel grayscale (0-255)
 * di una matrice quadrata `size`×`size`.
 */
export function dctPHashFromGrayPixels(
  gray: ArrayLike<number>,
  size: number = PHASH_SAMPLE_SIZE,
  lowFreq: number = PHASH_LOW_FREQ_SIZE
): bigint {
  const N = size;
  if (gray.length < N * N) {
    throw new Error(`Pixel grayscale insufficienti: servono ${N * N}, trovati ${gray.length}`);
  }
  const cosT = getCosTable(N);
  // DCT-II 2D su matrice N×N (separable: righe poi colonne)
  const rowDct = new Float64Array(N * N);
  for (let v = 0; v < N; v++) {
    for (let u = 0; u < N; u++) {
      let sum = 0;
      const rowBase = v * N;
      const cosU = cosT[u];
      for (let x = 0; x < N; x++) {
        sum += gray[rowBase + x] * cosU[x];
      }
      rowDct[v * N + u] = sum;
    }
  }
  const dct = new Float64Array(N * N);
  for (let u = 0; u < N; u++) {
    for (let v = 0; v < N; v++) {
      let sum = 0;
      const cosV = cosT[v];
      for (let y = 0; y < N; y++) {
        sum += rowDct[y * N + u] * cosV[y];
      }
      dct[v * N + u] = sum;
    }
  }

  // Mediana dei coefficienti 8×8 a bassa frequenza (escluso il coefficiente DC)
  const coeffs: number[] = [];
  for (let v = 0; v < lowFreq; v++) {
    for (let u = 0; u < lowFreq; u++) {
      if (u === 0 && v === 0) continue;
      coeffs.push(dct[v * N + u]);
    }
  }
  const sorted = [...coeffs].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  const median =
    sorted.length % 2 === 0 ? (sorted[mid - 1] + sorted[mid]) / 2 : sorted[mid];

  let hash = 0n;
  let bit = 0;
  for (let v = 0; v < lowFreq; v++) {
    for (let u = 0; u < lowFreq; u++) {
      if (u === 0 && v === 0) continue;
      if (dct[v * N + u] > median) {
        hash |= 1n << BigInt(bit);
      }
      bit++;
    }
  }
  hash |= 1n << 63n; // bit di padding per lunghezza costante
  return hash;
}

export function pHashToHex(hash: bigint): string {
  return hash.toString(16).padStart(16, '0');
}

export function hexToPHash(hex: string): bigint {
  const cleaned = String(hex || '').trim().toLowerCase();
  if (!/^[0-9a-f]{1,16}$/.test(cleaned)) return 0n;
  return BigInt('0x' + cleaned);
}

/** Distanza di Hamming tra due hash esadecimali a 64 bit. */
export function hammingDistanceHex(a: string, b: string): number {
  let x = hexToPHash(a) ^ hexToPHash(b);
  let dist = 0;
  while (x > 0n) {
    dist += Number(x & 1n);
    x >>= 1n;
  }
  return dist;
}

/**
 * Calcola il pHash di un file immagine (buffer decodificato in chiaro).
 * Restituisce l'hash in esadecimale a 16 caratteri; solleva errore se il
 * formato non è decodificabile.
 */
export async function computePHashHex(buffer: Buffer): Promise<string> {
  const { Jimp } = await import('jimp');
  const image = await Jimp.fromBuffer(buffer);
  image.greyscale();
  image.resize({ w: PHASH_SAMPLE_SIZE, h: PHASH_SAMPLE_SIZE });
  const bitmap = image.bitmap;
  const gray = new Uint8Array(PHASH_SAMPLE_SIZE * PHASH_SAMPLE_SIZE);
  // Dopo greyscale() R == G == B per ogni pixel RGBA
  for (let i = 0; i < gray.length; i++) {
    gray[i] = bitmap.data[i * 4];
  }
  return pHashToHex(dctPHashFromGrayPixels(gray));
}

/**
 * Raggruppa i file con hash visivamente simili (distanza di Hamming ≤ soglia)
 * usando union-find, così anche le catene A≈B≈C finiscono nello stesso gruppo.
 */
export function groupSimilarByHash(
  entries: Array<{ filename: string; phash: string }>,
  maxDistance = 8
): Array<Array<{ filename: string; phash: string }>> {
  const parent = new Map<number, number>();
  const find = (i: number): number => {
    let root = i;
    while (parent.get(root) !== root) root = parent.get(root)!;
    let cur = i;
    while (parent.get(cur) !== cur) {
      const next = parent.get(cur)!;
      parent.set(cur, root);
      cur = next;
    }
    return root;
  };
  const union = (a: number, b: number) => {
    const ra = find(a);
    const rb = find(b);
    if (ra !== rb) parent.set(rb, ra);
  };
  for (let i = 0; i < entries.length; i++) parent.set(i, i);

  for (let i = 0; i < entries.length; i++) {
    for (let j = i + 1; j < entries.length; j++) {
      if (hammingDistanceHex(entries[i].phash, entries[j].phash) <= maxDistance) {
        union(i, j);
      }
    }
  }

  const groups = new Map<number, Array<{ filename: string; phash: string }>>();
  for (let i = 0; i < entries.length; i++) {
    const root = find(i);
    if (!groups.has(root)) groups.set(root, []);
    groups.get(root)!.push(entries[i]);
  }
  return [...groups.values()].filter((g) => g.length > 1);
}
