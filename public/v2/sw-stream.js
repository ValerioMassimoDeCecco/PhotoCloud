/**
 * PhotoCloud Zero-Knowledge v2 — Service Worker per lo streaming video Range (`/v2/__stream/:blobId`).
 *
 * Semantica e Invarianti di sicurezza (Spec §4.3 / Requisito 4.0.3):
 * 1. Scope limitato rigorosamente a `/v2/`.
 * 2. Ogni ticket è legato alla coppia `(blobId, clientId)` (`key = "${clientId}|${blobId}"`).
 * 3. È accettato solo da client la cui URL appartiene alla scope `/v2/`.
 * 4. Vale per tutte le richieste `Range` di quel `blobId` provenienti da quel `clientId`
 *    finché non scade (`TICKET_TTL_MS = 5 minuti`) o non arriva `LOCK_ALL_KEYS`.
 * 5. Non riceve MAI la Vault Key (`VK`) né `fkWrapKey`, ma solo la `fileKey` (32 byte) del singolo blob.
 * 6. Ogni chunk PCZK v1 scaricato via `Range` da `/api/v2/blobs/:blobId` viene autenticato
 *    integralmente con AES-256-GCM (`nonce = noncePrefix(4B) || BE64(chunkIndex)`,
 *    `AAD = SHA256(headerBytes) || isLast`) prima di emettere i byte verso `<video>`.
 * 7. Tutte le risposte hanno `Cache-Control: no-store` (mai Cache API sul plaintext).
 */

const STREAM_TICKETS = new Map();
const TICKET_TTL_MS = 5 * 60 * 1000;
const PCZK_HEADER_SIZE = 86;
const GCM_TAG_BYTES = 16;
const UUID_V4_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function zeroizeBuffer(buf) {
  if (buf instanceof Uint8Array) {
    buf.fill(0);
  }
}

function makeTicketKey(clientId, blobId) {
  return `${String(clientId || '').trim()}|${String(blobId || '').trim().toLowerCase()}`;
}

function isUrlInV2Scope(rawUrl) {
  try {
    const u = new URL(rawUrl);
    if (u.origin !== self.location.origin) return false;
    return u.pathname === '/v2' || u.pathname.startsWith('/v2/');
  } catch {
    return false;
  }
}

function purgeExpiredTickets() {
  const now = Date.now();
  for (const [key, ticket] of STREAM_TICKETS.entries()) {
    if (now >= ticket.expiresAt) {
      zeroizeBuffer(ticket.fileKey);
      STREAM_TICKETS.delete(key);
    }
  }
}

function computePlaintextAndChunkCount(totalCiphertextBytes, chunkSizeLog2) {
  const chunkPlainSize = 1 << chunkSizeLog2;
  const chunkCipherSize = chunkPlainSize + GCM_TAG_BYTES;
  const payloadBytes = totalCiphertextBytes - PCZK_HEADER_SIZE;
  if (payloadBytes <= GCM_TAG_BYTES) {
    return { totalChunks: 1, totalPlaintextBytes: 0, chunkPlainSize };
  }
  const totalChunks = Math.ceil(payloadBytes / chunkCipherSize);
  const lastChunkCtLen = payloadBytes - (totalChunks - 1) * chunkCipherSize;
  const totalPlaintextBytes = (totalChunks - 1) * chunkPlainSize + (lastChunkCtLen - GCM_TAG_BYTES);
  return { totalChunks, totalPlaintextBytes, chunkPlainSize };
}

self.addEventListener('install', () => {
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(self.clients.claim());
});

self.addEventListener('message', (event) => {
  const data = event.data;
  if (!data || typeof data !== 'object') return;

  if (data.type === 'REGISTER_STREAM_KEY' || data.type === 'REGISTER_VIDEO_KEY') {
    purgeExpiredTickets();
    const sender = event.source;
    const senderUrl = sender && sender.url ? sender.url : '';
    const clientId = (sender && sender.id) ? sender.id : String(data.clientId || '').trim();

    if (!clientId || !isUrlInV2Scope(senderUrl)) {
      if (event.ports && event.ports[0]) {
        event.ports[0].postMessage({ ok: false, error: 'CLIENT_OUTSIDE_V2_SCOPE' });
      }
      return;
    }

    const blobId = String(data.blobId || '').trim().toLowerCase();
    const fileKey = new Uint8Array(data.fileKey || []);
    const headerBytes = new Uint8Array(data.headerBytes || []);
    const totalCiphertextBytes = Number(data.totalCiphertextBytes || 0);

    if (
      !UUID_V4_RE.test(blobId) ||
      fileKey.byteLength !== 32 ||
      headerBytes.byteLength < PCZK_HEADER_SIZE ||
      totalCiphertextBytes < PCZK_HEADER_SIZE + GCM_TAG_BYTES
    ) {
      zeroizeBuffer(fileKey);
      if (event.ports && event.ports[0]) {
        event.ports[0].postMessage({ ok: false, error: 'INVALID_TICKET_PARAMETERS' });
      }
      return;
    }

    const chunkSizeLog2 = headerBytes[5];
    const noncePrefix = headerBytes.slice(22, 26);
    const { totalChunks, totalPlaintextBytes, chunkPlainSize } = computePlaintextAndChunkCount(
      totalCiphertextBytes,
      chunkSizeLog2
    );

    const mapKey = makeTicketKey(clientId, blobId);
    const prev = STREAM_TICKETS.get(mapKey);
    if (prev) {
      zeroizeBuffer(prev.fileKey);
    }

    STREAM_TICKETS.set(mapKey, {
      blobId,
      clientId,
      fileKey,
      headerBytes: headerBytes.slice(0, PCZK_HEADER_SIZE),
      noncePrefix,
      chunkSize: chunkPlainSize,
      totalChunks,
      totalCiphertextBytes,
      totalPlaintextSize: totalPlaintextBytes,
      mime: String(data.mime || 'video/mp4'),
      expiresAt: Date.now() + TICKET_TTL_MS,
    });

    if (event.ports && event.ports[0]) {
      event.ports[0].postMessage({ ok: true, clientId, blobId });
    }
  } else if (data.type === 'LOCK_ALL_KEYS') {
    for (const ticket of STREAM_TICKETS.values()) {
      zeroizeBuffer(ticket.fileKey);
    }
    STREAM_TICKETS.clear();
    if (event.ports && event.ports[0]) {
      event.ports[0].postMessage({ ok: true });
    }
  }
});

function buildChunkNonce(noncePrefix4B, chunkIndex) {
  const iv = new Uint8Array(12);
  iv.set(noncePrefix4B.subarray(0, 4), 0);
  const view = new DataView(iv.buffer, iv.byteOffset, iv.byteLength);
  view.setBigUint64(4, BigInt(chunkIndex), false);
  return iv;
}

function buildChunkAad(headerSha256Bytes, isLast) {
  const aad = new Uint8Array(33);
  aad.set(headerSha256Bytes, 0);
  aad[32] = isLast ? 0x01 : 0x00;
  return aad;
}

async function handleStreamRequest(event, blobId) {
  purgeExpiredTickets();
  const noStoreHeaders = {
    'Cache-Control': 'no-store',
    'X-Content-Type-Options': 'nosniff',
  };

  const clientId = String(event.clientId || '').trim();
  if (!clientId) {
    return new Response('STREAM_CLIENT_ID_MISSING', { status: 403, headers: noStoreHeaders });
  }

  const clientObj = await self.clients.get(clientId);
  if (!clientObj || !isUrlInV2Scope(clientObj.url)) {
    return new Response('CLIENT_OUTSIDE_V2_SCOPE', { status: 403, headers: noStoreHeaders });
  }

  const ticket = STREAM_TICKETS.get(makeTicketKey(clientId, blobId));
  if (!ticket) {
    return new Response('STREAM_KEY_NOT_REGISTERED', { status: 403, headers: noStoreHeaders });
  }

  const request = event.request;
  const totalSize = ticket.totalPlaintextSize;
  const rangeHeader = request.headers.get('Range');
  let startByte = 0;
  let endByte = Math.max(0, totalSize - 1);
  let isRange = false;

  if (rangeHeader && /^bytes=\d*-\d*$/i.test(rangeHeader.trim())) {
    isRange = true;
    const parts = rangeHeader.trim().slice(6).split('-');
    if (parts[0] !== '') startByte = Number(parts[0]);
    if (parts[1] !== '') endByte = Number(parts[1]);
    if (!Number.isFinite(startByte) || !Number.isFinite(endByte) || startByte > endByte || startByte >= totalSize) {
      return new Response(null, {
        status: 416,
        headers: {
          ...noStoreHeaders,
          'Content-Range': `bytes */${totalSize}`,
        },
      });
    }
    endByte = Math.min(endByte, totalSize - 1);
  }

  if (totalSize === 0) {
    return new Response(new Uint8Array(0), {
      status: isRange ? 206 : 200,
      headers: {
        ...noStoreHeaders,
        'Content-Type': ticket.mime,
        'Accept-Ranges': 'bytes',
        'Content-Length': '0',
      },
    });
  }

  const chunkSize = ticket.chunkSize;
  const firstChunkIdx = Math.floor(startByte / chunkSize);
  const lastChunkIdx = Math.floor(endByte / chunkSize);

  const firstCipherOffset = PCZK_HEADER_SIZE + firstChunkIdx * (chunkSize + GCM_TAG_BYTES);
  let lastCipherEndInclusive = 0;
  for (let idx = firstChunkIdx; idx <= lastChunkIdx; idx++) {
    const isLast = idx === ticket.totalChunks - 1;
    const plainLen = isLast ? totalSize - idx * chunkSize : chunkSize;
    const cOffset = PCZK_HEADER_SIZE + idx * (chunkSize + GCM_TAG_BYTES);
    lastCipherEndInclusive = cOffset + plainLen + GCM_TAG_BYTES - 1;
  }

  const fetchResp = await fetch(`/api/v2/blobs/${ticket.blobId}`, {
    headers: { Range: `bytes=${firstCipherOffset}-${lastCipherEndInclusive}` },
    credentials: 'same-origin',
  });
  if (!fetchResp.ok) {
    return new Response('UPSTREAM_BLOB_ERROR', { status: 502, headers: noStoreHeaders });
  }

  const cipherSpan = new Uint8Array(await fetchResp.arrayBuffer());
  const headerHashBuf = await crypto.subtle.digest('SHA-256', ticket.headerBytes);
  const headerSha256 = new Uint8Array(headerHashBuf);
  const cryptoKey = await crypto.subtle.importKey('raw', ticket.fileKey, { name: 'AES-GCM' }, false, ['decrypt']);

  const decryptedParts = [];
  let totalDecryptedLen = 0;
  for (let idx = firstChunkIdx; idx <= lastChunkIdx; idx++) {
    const isLast = idx === ticket.totalChunks - 1;
    const plainLen = isLast ? totalSize - idx * chunkSize : chunkSize;
    const cLen = plainLen + GCM_TAG_BYTES;
    const relStart = PCZK_HEADER_SIZE + idx * (chunkSize + GCM_TAG_BYTES) - firstCipherOffset;
    const encChunk = cipherSpan.subarray(relStart, relStart + cLen);

    const iv = buildChunkNonce(ticket.noncePrefix, idx);
    const aad = buildChunkAad(headerSha256, isLast);
    const plainBuf = await crypto.subtle.decrypt(
      { name: 'AES-GCM', iv, additionalData: aad, tagLength: 128 },
      cryptoKey,
      encChunk
    );
    const plainArr = new Uint8Array(plainBuf);
    decryptedParts.push(plainArr);
    totalDecryptedLen += plainArr.byteLength;
  }

  const combined = new Uint8Array(totalDecryptedLen);
  let offset = 0;
  for (const part of decryptedParts) {
    combined.set(part, offset);
    offset += part.byteLength;
  }

  const sliceStart = startByte - firstChunkIdx * chunkSize;
  const sliceLen = endByte - startByte + 1;
  const outputSlice = combined.subarray(sliceStart, sliceStart + sliceLen);

  const headers = {
    ...noStoreHeaders,
    'Content-Type': ticket.mime,
    'Accept-Ranges': 'bytes',
    'Content-Length': String(outputSlice.byteLength),
  };
  if (isRange) {
    headers['Content-Range'] = `bytes ${startByte}-${endByte}/${totalSize}`;
  }

  return new Response(outputSlice, {
    status: isRange ? 206 : 200,
    headers,
  });
}

self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url);
  const m = /^\/v2\/__stream\/([0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12})$/i.exec(
    url.pathname
  );
  if (m) {
    event.respondWith(handleStreamRequest(event, m[1]));
  }
});
