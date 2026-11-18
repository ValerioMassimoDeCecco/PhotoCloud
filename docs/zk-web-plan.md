# Piano Architetturale Client Web Zero-Knowledge v2 (`docs/zk-web-plan.md`)

> **Fase**: `FASE 3 — CLIENT WEB ZERO-KNOWLEDGE`  
> **Ambito**: Solo client web v2 (`/v2/*` e `/v2/share/:shareId`) + SDK client (`src/client/zk-sdk/*`).  
> **Vincolo di coesistenza**: Le rotte e la UI v1 (`/`, `/trash`, `/map`, `/share/:token`, `/static/scripts/*`) e l'app Android (`android-app/`) restano **intatte e invariate**. Il client v2 parla **esclusivamente** con `/api/v2/*`.

---

## 1. Scoperta e Analisi del Client Attuale (v1)

L'analisi del codebase esistente mostra una struttura ibrida ben definita:
1. **Rendering HTML Server-Side (`src/lib/templateRenderer.ts` + `templates/*.html`)**:
   - Le rotte v1 (`/`, `/trash`, `/map`, `/share/:token`) in `server.ts` decriptano i metadati lato server e iniettano gli item direttamente nell'HTML tramite `renderLoginTemplate`, `renderGalleryTemplate` e `renderTrashTemplate`.
   - Il comportamento interattivo nel browser è gestito da moduli vanilla JS in `static/scripts/*`:
     - `upload.js` (upload paralleli `1..16`, pausa/ripresa/annulla, modalità file singoli vs ZIP)
     - `grouping.js` e `timeline-scrubber.js` (raggruppamento giorno/mese/anno/album)
     - `selection.js` (drag-to-select rettangolare)
     - `lightbox.js`, `photo-editor.js`, `slideshow.js` (visualizzazione progressiva, player video, editor non distruttivo)
     - `document-viewer.js` (anteprima PDF, DOCX/ODT, XLSX/ODS/CSV, PPTX/ODP, codice/testo)
     - `exif-panel.js`, `map.js`, `duplicates.js`, `similar-duplicates.js`, `trash.js`, `cloud-features.js`
2. **Librerie Pure Condivise in `src/lib/`**:
   - `src/lib/zk/*`: Core crittografico Zero-Knowledge di Fase 1 (`deriveRoot`, `deriveKekAndAuthSecret`, `wrapVaultKey`/`unwrapVaultKey`, `deriveSubkeys`, `encryptBlobStream`/`decryptBlobStream`, `decryptBlobRange`, `encryptMeta`/`decryptMeta`, `encryptThumbnail`/`decryptThumbnail`, `encryptAlbums`/`decryptAlbums`, `computeDedupTag`, `wrapFileKeyForShare`/`unwrapFileKeyForShare`, `ZkWorkerClient`).
   - `src/lib/exif.ts`: Parser EXIF puro su `Uint8Array`/`Buffer` (`parseExifFromJpeg`) senza dipendenze da filesystem.
   - `src/lib/phash.ts`: Distanza di Hamming e raggruppamento duplicati percettivi (`hammingDistanceHex`, `groupSimilarByHash`).
   - `src/lib/nlSearch.ts`: Parser ed esecutore di query in linguaggio naturale IT/EN (`parseNaturalQuery`, `mediaItemMatchesQuery`).
   - `src/lib/photoEditorMath.ts`: Matematica pura per filtri, esposizione, contrasto, saturazione, calore, rotazione, flip e crop box normalizzato (`PhotoEditState`, `PHOTO_FILTER_PRESETS`, `computePixelCropRect`, `buildCssFilterString`).
   - `src/lib/documentEngine.ts`: Classificazione estensioni/MIME e parsing di documenti Office XML (`JSZip`) con limiti anti-zip-bomb.

---

## 2. Architettura a Due Strati del Client Web v2

Per garantire testabilità completa in Node.js (senza browser) e isolamento totale dalla v1, il client v2 è progettato su **due strati nettamente separati**:

### Strato A — SDK Agnostico (`src/client/zk-sdk/`)
Un SDK TypeScript puro, privo di dipendenze dal DOM, utilizzabile sia dal browser (`/v2/`) sia dai test d'integrazione in Node (`src/lib/zkWebSdk.test.ts`):

```
src/client/zk-sdk/
├── index.ts          # Barrel export pubblico dell'SDK
├── types.ts          # Tipi keyfile v2, KDF floor, item decifrati, shareManifest, transfer state
├── kdfPolicy.ts      # Validazione KDF floor, non-secret parameter pinning, recovery code e forza passphrase
├── shareCrypto.ts    # Cifratura/decifratura shareManifest, passwordWrap Argon2id e costruzione URL #fragment
├── zipStream.ts      # Generatore ZIP in streaming (CRC32 + local/central directory) senza caricare tutto in RAM
├── docPreview.ts     # Ispezione MIME allowlist e parser documenti client-side con limiti anti-zip-bomb
└── client.ts         # Classe ZkVaultClient (auth, vault, upload, download, items, albums, trash, share)
```

**Moduli e responsabilità di `ZkVaultClient` (`src/client/zk-sdk/client.ts`)**:
1. **`auth`**:
   - `prepareRegistration(username, passphrase)`: valida lunghezza passphrase ($\ge 12$ caratteri NFC) e forza, genera `accountKey` (32B CSPRNG) e `userSalt` (16B CSPRNG), formatta il codice di recupero stampabile a gruppi di 4 caratteri (`XXXX-XXXX-...`) e genera una sfida di verifica (`verifyRecoveryCodeConfirmation`) che obbliga la conferma prima dell'invio al server.
   - `completeRegistration(prepared, confirmationInput, options)`: verifica la conferma del codice di recupero, deriva `root`, `kek`, `authSecret` via Worker, genera `VK` (32B CSPRNG), calcola `wrappedVaultKey`, invia `POST /api/v2/register` (con `setupToken` o `inviteToken`), costruisce il keyfile v2 JSON (`photocloud_v2_key_<username>.json`) e sblocca il vault in memoria.
   - `login(keyfileOrAccountKey, passphrase)`: chiama `POST /api/v2/login/params`, **verifica il KDF floor** (`memoryKiB >= 32768`, `iterations >= 2`, `parallelism >= 1`, `salt >= 16B`), controlla il **non-secret parameter pinning** rispetto all'ultimo login noto per quell'utente (emettendo un avviso esplicito se `salt` o `kdfParams` sono cambiati), deriva `root`, `kek`, `authSecret`, chiama `POST /api/v2/login` e sblocca `VK` + sottochiavi (`metaKey`, `thumbKey`, `dedupKey`, `fkWrapKey`).
   - `changePassphrase(oldPassphrase, newPassphrase)`: deriva i nuovi segreti con nuovo `userSalt` CSPRNG, ri-wrappa la stessa `VK` in RAM e invia `POST /api/v2/account/rewrap`.
2. **`vault` (Gestione chiavi in memoria e Auto-Lock)**:
   - Le chiavi (`VK`, `metaKey`, `thumbKey`, `dedupKey`, `fkWrapKey`, `accountKey`) vivono **solo in RAM** (nel Worker crittografico) e non toccano mai `localStorage`, `sessionStorage`, `IndexedDB` o cookie.
   - Timer di auto-lock su inattività configurabile (`autoLockTimeoutMs`, default 15 minuti); `lock()` e `logout()` azzerano tutti i buffer con `zeroize()` (`Uint8Array.fill(0)`).
3. **`upload`**:
   - `uploadFile(source, metadataInput, transferController)`:
     - Calcola `dedupTag` in streaming (`computeDedupTag` a blocchi da 64 KiB) senza caricare il file in RAM.
     - Controlla opzionalmente i duplicati attivi con `POST /api/v2/backup/check`.
     - Estrae EXIF client-side (`parseExifFromJpeg`), **rimuovendo le coordinate GPS di default** (`stripGps = true` salvo opt-in esplicito dell'utente), calcola `phash` percettivo e categoria MIME (`photo`, `video`, `document`, `archive`, `audio`, `other`).
     - Cifra `encMeta` (`encryptMeta`) e cifra il file in streaming (`encryptBlobStream`), inviando i chunk su `POST /api/v2/blobs/upload/init` → `PUT /api/v2/blobs/upload/:uploadId/:chunkIndex` → `POST /api/v2/blobs/upload/:uploadId/complete`.
     - Supporta `pause()`, `resume()` e `cancel()` per singolo trasferimento e pool di upload concorrenti configurabile da `1` a `16` (`uploadBatch`).
     - Carica le miniature `320` e `1280` cifrate con `encryptThumbnail` (`PUT /api/v2/blobs/:id/thumbs/320` e `1280`).
4. **`items` & `gallery`**:
   - `syncAllItems(state)`: scarica tutte le pagine da `GET /api/v2/items`, decifra i metadati `encMeta` in batch nel Worker, popola l'indice in memoria, raggruppa per giorno/mese/anno/album, esegue ricerche locali con `nlSearch` (`searchItems`) e calcola le statistiche per categoria client-side unite ai byte di `GET /api/v2/stats`.
5. **`download` & `lightbox` & `video Range`**:
   - `downloadBlobToBytes(blobId)` / `downloadBlobStream(blobId)` / `downloadThumb(blobId, variant)`.
   - `downloadBlobRange(blobId, plaintextStart, plaintextEnd)`: calcola i chunk necessari con `computeBlobRangePlan`, scarica solo l'header (86B, cached in RAM) e l'intervallo di chunk cifrati con header `Range: bytes=ctStart-ctEnd` da `GET /api/v2/blobs/:id`, sblocca la `FK` (o usa la `FK` fornita) e decifra/autentica ogni chunk con `decryptBlobRange`.
   - `extractFileKeyForStream(blobId)`: scarica i primi 86 byte dell'header `PCZK` v1 e restituisce esclusivamente la `FK` (32B) e l'header di quel singolo video per passarla via `MessageChannel` al Service Worker di streaming `/v2/sw-stream.js` con TTL limitato (senza mai esporre la `VK`).
6. **`editor` & `replace`**:
   - Riusa `photoEditorMath.ts` per trasformazioni su `<canvas>`; salva come copia (nuovo upload) oppure sovrascrive l'originale caricando il nuovo blob (`createItem: false`) e chiamando `POST /api/v2/items/:id/replace` con `expectedVersion`.
7. **`albums` (Concorrenza Ottimistica `If-Match` / `412`)**:
   - `getAlbums()` e `saveAlbums(mutator)`: cifra il catalogo con `encryptAlbums` e invia `PUT /api/v2/albums` con `If-Match` (o `If-None-Match: *`). Se il server risponde `412 Precondition Failed`, l'SDK scarica automaticamente il catalogo remoto aggiornato, decifra, esegue il merge set-union degli album e dei `blobIds`, incrementa `revision` e riprova.
8. **`trash` & `zip`**:
   - `trashItems`, `restoreItems`, `deleteItemPermanently`, `emptyTrash`.
   - `exportZipStream(itemIds)`: genera uno stream ZIP in memoria costante decifrando un file alla volta, salvabile su disco tramite File System Access API (`showSaveFilePicker`) o fallback Blob con avviso dimensione.
9. **`share`**:
   - `createShare(options)`: genera `shareId` (UUIDv4) e `shareKey` (32B CSPRNG), wrappa la `FK` di ogni blob condiviso (`wrapFileKeyForShare`), cifra l'intero `shareManifest` (contenente per ogni blob `wrappedFk` ed `encMeta`), cifra opzionalmente `shareKey` con password tramite Argon2id (`passwordWrap`), invia `POST /api/v2/shares` e restituisce l'URL `/v2/share/<shareId>#<base64url(shareKey)>` (con la chiave **esclusivamente nel fragment `#`**, mai nella query string o nel path).
   - `openPublicShare(shareId, fragmentKey, password?)`: scarica `GET /api/v2/shares/:shareId`, sblocca `shareKey` (direttamente dal fragment `#` o sbloccando `passwordWrap` con Argon2id), decifra e autentica `shareManifest` e consente il download intero o per `Range` dei blob condivisi (`/api/v2/shares/:shareId/blobs/:blobId`).

---

### Strato B — Applicazione Web `/v2/` e `/v2/share/:shareId` (`src/client/v2-app/`)
Servita sotto il prefisso `/v2` senza toccare la web app v1 su `/`:
- **Pagine e Asset**:
  - `GET /v2` e `GET /v2/share/:shareId`: servono un documento HTML minimale con riferimenti esterni `/v2/app.css` e `/v2/app.js` (zero inline script, zero inline style).
  - `GET /v2/app.js`, `GET /v2/zk-worker.js`, `GET /v2/sw-stream.js`, `GET /v2/app.css`: compilati/serviti localmente dallo stesso origin (`'self'`).
- **Service Worker Video Streaming (`/v2/sw-stream.js`)**:
  - Registrato con scope `/v2/`.
  - Intercetta `GET /v2/_zk/stream/:blobId` (e `/_zk/stream/:blobId`).
  - Riceve dalla pagina principale via `MessageChannel` esclusivamente `{ blobId, fileKey, headerBytes, totalCiphertextSize, plaintextSize, mimeType, expiresAt }` per il singolo video in riproduzione (mai la `VK`!).
  - Risponde `206 Partial Content` alle richieste `Range: bytes=start-end` dell'elemento `<video>` scaricando da `/api/v2/blobs/:blobId` (o `/api/v2/shares/:shareId/blobs/:blobId`) solo i chunk `PCZK` necessari e decifrandoli al volo con `decryptBlobRange`.
  - Se il Service Worker non è attivo o il video è sotto la soglia configurata (es. `< 32 MiB`), usa un fallback `Blob` URL decifrato in streaming e revocato con `URL.revokeObjectURL` alla chiusura della lightbox.

---

## 3. Content Security Policy (CSP) e Sanificazione DOM

Tutte le risposte sotto `/v2` e `/v2/*` impongono gli header:
```http
Content-Security-Policy: default-src 'self'; script-src 'self' 'wasm-unsafe-eval'; style-src 'self'; img-src 'self' blob: data:; media-src 'self' blob:; worker-src 'self'; connect-src 'self'; object-src 'none'; base-uri 'self'; frame-ancestors 'none'
Referrer-Policy: no-referrer
X-Content-Type-Options: nosniff
X-Frame-Options: DENY
```
- **Nessuno script inline e nessuno stile inline**: tutto il codice JS e il foglio di stile sono caricati da `/v2/app.js` e `/v2/app.css`. `'wasm-unsafe-eval'` è incluso esclusivamente per l'istanza WebAssembly di `hash-wasm` (Argon2id).
- **Trattamento dati decifrati come non fidati (Anti-XSS)**:
  - Nomi file, date, modelli fotocamera, nomi album e testi estratti dai documenti vengono inseriti nel DOM **esclusivamente tramite `element.textContent = ...` o `document.createTextNode(...)`** (mai `innerHTML`, `outerHTML` o `insertAdjacentHTML`).
  - Allowlist rigorosa dei MIME type visualizzabili:
    - Immagini raster (`image/jpeg`, `image/png`, `image/webp`, `image/gif`, `image/bmp`, `image/avif`): renderizzate in `<img>`.
    - `image/svg+xml`: renderizzato **solo** dentro un tag `<img src="blob:...">` isolato (con MIME forzato o download) e **mai** iniettato inline come `<svg>` o aperto in `<iframe>`/`<object>`.
    - File `text/html`, `application/xhtml+xml`, `text/javascript`: **mai** renderizzati come HTML eseguibile; mostrati solo come testo sorgente in chiaro (`textContent` in `<pre>`) o scaricati con `download`.

---

## 4. Dipendenze Pinnate ed Esito `npm audit`

In `package.json`:
- `"engines": { "node": ">=22.13.0" }` (prima versione Node 22 LTS con `node:sqlite` attivo senza flag).
- Tutte le dipendenze sono pinnate a versioni esatte (nessun prefisso `^` o `~`):
  - Crittografia Argon2id WebAssembly: `"hash-wasm": "4.13.0"` (bundle locale, nessuna CDN esterna).
  - Parsing/creazione archivi: `"jszip": "3.10.2"`.
  - Server & build: `"express": "5.3.0"`, `"vite": "8.3.6"`, `"typescript": "7.0.2"`, `"tsx": "4.23.15"`.
- **Report `npm audit`**:
  - `0` vulnerabilità `critical`, `0` vulnerabilità `high`.
  - Le uniche segnalazioni (`4 moderate`, `2 low`) riguardano dipendenze transitive di build-time di `vite-plugin-pwa` (`workbox-build` → `glob` / `minimatch` / `@rollup/plugin-node-resolve` / `deepmerge`), che **non fanno parte del runtime server né del bundle client `/v2/`**. Nessuna libreria crittografica o di runtime (`hash-wasm`, `jszip`, `express`) presenta vulnerabilità.
