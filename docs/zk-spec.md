# Specifica Tecnica e Crittografica PhotoCloud Zero-Knowledge (v2)

> **Versione specifica**: `v2.0` (Formato framing blob: `PCZK` v1)  
> **Stato**: Normativo per le Fasi 1–5 (Web, Server Node/Express, Android Kotlin/Compose).

---

## 1. Modello di Minaccia (Threat Model) e Limiti Dichiarati

### 1.1 Attaccanti nel Modello di Minaccia (In-Scope)
- **Server self-hosted compromesso o "honest-but-curious"**: amministratore di sistema non fidato, provider VPS/cloud, attaccante con accesso in lettura al database/filesystem del server (`user_media/`, `temp_uploads/`, variabili d'ambiente, log).
- **Furto di backup o snapshot del disco**: copia offline dell'intero volume del server.
- **Intercettazione passiva di link condivisi lato server**: il server che ospita `/share/<shareId>` non deve poter decifrare i file condivisi.

### 1.2 Garanzie di Sicurezza
1. **Confidenzialità dei contenuti e dei metadati**: il server non riceve, non deriva e non può mai ricostruire la passphrase, la `accountKey`, la `root` key, la `kek`, la `VK` (Vault Key), le sottochiavi (`metaKey`, `thumbKey`, `dedupKey`, `fkWrapKey`) né le `FK` (File Key). Nomi file, MIME type, dimensioni del plaintext, date di scatto (`takenAt`), coordinate GPS/EXIF, miniature, nomi e composizione degli album e hash del plaintext sono cifrati e autenticati con AES-256-GCM prima di lasciare il client.
2. **Integrità e Autenticazione (AEAD)**: ogni blob, chunk, metadato, miniatura, chiave wrappata e catalogo album è protetto con AES-256-GCM e `AAD` (Additional Authenticated Data) contestuale per prevenire attacchi di sostituzione (blob swapping, chunk reordering, truncation, cross-user o cross-blob replay).
3. **Deduplicazione cieca per-utente**: il tag di deduplicazione (`dedupTag`) è calcolato come `HMAC-SHA256(dedupKey, plaintext)` con chiave segreta derivata dalla `VK` dell'utente. Il server non può eseguire attacchi a dizionario su file noti (convergent encryption attack) né correlare file identici appartenenti a utenti diversi.

### 1.3 Cosa Può Vedere il Server (Metadati Operativi Opachi)
Il server vede esclusivamente:
- `userId` (UUIDv4 immutabile) e `username` (per il login), `userSalt` (16B), parametri Argon2id (`m`, `t`, `p`), verifier di `authSecret` (`Argon2id(authSecret, serverSalt)`), e il blob `wrappedVk` opaco.
- Per ogni blob nel vault: `blobId` (UUIDv4 casuale generato dal client), dimensione in byte del ciphertext su disco, `createdAt` / `updatedAt` (timestamp server dell'upload/modifica), stato `active` o `trashed`, `dedupTag` opaco (32B), e i byte totali occupati.
- `Content-Type` di tutti i payload crittografici sempre pari a `application/octet-stream`.

### 1.4 Limiti Espliciti Fuori Scope (Out-of-Scope)
- **Server attivamente malevolo che altera il codice JavaScript servito al client Web**: come per qualsiasi applicazione web ospitata sullo stesso server che eroga i bundle HTML/JS, un server attivamente compromesso potrebbe servire codice JavaScript manomesso per esfiltrare la chiave al successivo login web. *(Nota: l'app Android nativa compilata e firmata non soffre di questo vettore perché il codice crittografico risiede nell'APK firmato localmente).*
- **Malware o compromissione root sul dispositivo client** mentre il vault è sbloccato.
- **Traffic analysis / side-channel sulla dimensione dei file**: la dimensione del ciphertext `PCZK` v1 rivela la dimensione del plaintext con un overhead deterministico (`86 byte header + 16 byte * numero_chunk`).

---

## 2. Regole Crittografiche Non Negoziabili

1. **Primitive standard certificate**:
   - **Web**: esclusivamente `window.crypto.subtle` (WebCrypto API) per `HKDF-SHA256`, `HMAC-SHA256`, `SHA-256`, `AES-GCM` (256-bit) e `crypto.getRandomValues` per CSPRNG; `hash-wasm` (o `libsodium-wrappers`) per `Argon2id`.
   - **Android**: esclusivamente `javax.crypto` (`AES/GCM/NoPadding`, `Mac.getInstance("HmacSHA256")`, `MessageDigest.getInstance("SHA-256")`), `java.security.SecureRandom`, `AndroidKeyStore` per il wrapping locale della `VK`, e `argon2kt` / `lazysodium-android` (o implementazione conforme RFC 9106) per `Argon2id`.
   - **Server (Node.js)**: esclusivamente `node:crypto` (`scrypt`/`argon2`, `timingSafeEqual`, `createHash('sha256')`, `randomBytes`, `randomUUID`). Nessuna funzione di cifratura/decifrazione vault sul server.
2. **Divieto assoluto di `Math.random()`**: ogni byte casuale (`accountKey`, `VK`, `FK`, `userSalt`, `noncePrefix`, IV GCM da 12B, `blobId`, `shareId`, `shareKey`) deve provenire da un CSPRNG (`crypto.getRandomValues` / `SecureRandom` / `node:crypto.randomBytes`).
3. **Unicità dei Nonce**:
   - Per `AES-256-GCM` su oggetti singoli (`wrappedVk`, `wrappedFK`, metadati, album, miniature, share), si usa un nonce casuale di 12 byte (96 bit) generato da CSPRNG sotto una chiave specifica (o per-blob derivata con HKDF) oppure al momento di un singolo wrap.
   - Per i chunk di un blob `PCZK` v1 (cifrati tutti con la stessa `FK` monouso del blob), il nonce di 12 byte è costruito deterministicamente come `noncePrefix (4B CSPRNG) || chunkIndex (u64 big-endian, 8B)`, garantendo matematicamente zero collisioni fino a $2^{64}$ chunk per blob.
4. **Confronti Constant-Time**: ogni verifica di segreti, hash di autenticazione, token CSRF o tag HMAC deve usare confronti in tempo costante (`crypto.timingSafeEqual` su Node, `MessageDigest.isEqual` su Android).
5. **Igiene dei Segreti**:
   - Nessuna chiave, passphrase, `authSecret`, `VK`, `FK` o nome file in chiaro nei log, nei messaggi di errore, in `localStorage`, in `sessionStorage`, nei cookie o negli URL.
   - Unica eccezione consentita per gli URL: il fragment `#<shareKey_base64url>` nei link di condivisione (`/share/<shareId>#<shareKey>`), che per specifica HTTP (RFC 3986 §3.5) non viene inviato al server nelle richieste HTTP e viene rimosso immediatamente dalla barra degli indirizzi dal client tramite `history.replaceState` dopo la lettura in memoria.

---

## 3. Gerarchia delle Chiavi e Derivazione (KDF)

### 3.1 Convenzioni di Codifica
- **Base64url**: RFC 4648 §5, alfabeto URL-safe (`-` e `_`), **senza padding `=`**.
- **UTF-8**: tutte le stringhe di contesto (`info` di HKDF, stringhe `AAD`, passphrase) sono codificate in byte UTF-8.
- **UUID (`userId`, `blobId`, `shareId`)**: stringa canonica lowercase RFC 4122 di 36 caratteri ASCII (`xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx`) quando usata in stringhe testuali/AAD (`"vk|"+userId`, `"meta|"+blobId`), e rappresentazione binaria big-endian a 16 byte nell'header binario `PCZK` v1.

### 3.2 File Chiave Utente (`photocloud_auth_<username>.json` v2)
Generato interamente sul client in fase di registrazione e scaricato dall'utente. Non viene mai inviato al server.

```json
{
  "format": "photocloud-keyfile",
  "version": 2,
  "userId": "550e8400-e29b-41d4-a716-446655440000",
  "username": "alice",
  "accountKey": "0102030405060708090a0b0c0d0e0f101112131415161718191a1b1c1d1e1f20",
  "userSalt": "a1a2a3a4a5a6a7a8a9aaabacadaeafb0",
  "kdf": {
    "algorithm": "argon2id",
    "memoryKiB": 65536,
    "iterations": 3,
    "parallelism": 1,
    "hashLength": 32
  },
  "hasPassphrase": true,
  "createdAt": "2026-11-16T00:00:00.000Z"
}
```
- `accountKey`: 32 byte generati da CSPRNG, codificati in **base64url** (43 caratteri).
- `userSalt`: 16 byte generati da CSPRNG, codificati in **base64url** (22 caratteri).
- `passphrase`: opzionale (se presente, minimo 12 caratteri Unicode normalizzati in `NFC`; consigliata di default nella UI di registrazione web).

### 3.3 Derivazione di `root`, `kek` e `authSecret`
1. **Input Passphrase (`passphrasePart`, 32 byte)**:
   - Se l'utente usa una passphrase (`hasPassphrase === true`):
     $$\text{passphrasePart} = \text{Argon2id}(\text{password}=\text{UTF8}(\text{NFC}(\text{passphrase})),\ \text{salt}=\text{userSalt},\ m=65536\text{ KiB},\ t=3,\ p=1,\ \text{tagLen}=32)$$
   - Se l'utente non usa una passphrase (`hasPassphrase === false`):
     $$\text{passphrasePart} = 0x00^{32} \quad (\text{32 byte tutti zero})$$
2. **Input Keying Material (`ikm`, 64 byte)**:
   $$\text{ikm} = \text{passphrasePart}\ (32\text{ B}) \mathbin{\Vert} \text{accountKey}\ (32\text{ B})$$
3. **Root Key (`root`, 32 byte)**:
   $$\text{root} = \text{HKDF-SHA256}(\text{ikm}=\text{ikm},\ \text{salt}=\text{userSalt},\ \text{info}=\text{UTF8}(\texttt{"photocloud/v2/root"}),\ L=32)$$
4. **Key Encryption Key (`kek`, 32 byte)** — *Mai inviata al server*:
   $$\text{kek} = \text{HKDF-SHA256}(\text{ikm}=\text{root},\ \text{salt}=\varnothing,\ \text{info}=\text{UTF8}(\texttt{"photocloud/v2/kek"}),\ L=32)$$
5. **Authentication Secret (`authSecret`, 32 byte)** — *Inviata al server su TLS per login/registrazione*:
   $$\text{authSecret} = \text{HKDF-SHA256}(\text{ikm}=\text{root},\ \text{salt}=\varnothing,\ \text{info}=\text{UTF8}(\texttt{"photocloud/v2/auth"}),\ L=32)$$
   *(Nota: in HKDF con `salt` vuoto $\varnothing$, come da RFC 5869 §2.2, il salt di default equivale a 32 byte zero `0x00 * 32`).*

### 3.4 Vault Key (`VK`) e Wrapping con `kek`
- Alla registrazione, il client genera `VK` = 32 byte CSPRNG.
- Il client cifra `VK` con `kek` tramite `AES-256-GCM`:
  - `nonce`: 12 byte CSPRNG
  - `AAD`: `UTF8("vk|" + userId)` (es. `"vk|550e8400-e29b-41d4-a716-446655440000"`)
  - `tag`: 16 byte (128 bit)
  - Formato binario `wrappedVk` (60 byte): `nonce (12B) || ciphertext (32B) || tag (16B)`, codificato in base64url sul trasporto JSON.
- **Cambio Passphrase**: il client sblocca `VK` in memoria con la vecchia `kek`, genera un nuovo `userSalt` (16B CSPRNG), deriva i nuovi `root'`, `kek'` e `authSecret'`, ri-wrappa la **stessa** `VK` con `kek'` (`wrappedVk'`) e aggiorna atomicamente `{ userSalt', argon2Params', authSecret', wrappedVk' }` sul server (`PUT /api/v2/auth/passphrase`), senza dover ricifrare alcun blob o metadato del vault.

### 3.5 Sottochiavi della Vault Key (`VK`)
Dalla `VK` (32 byte) il client deriva in memoria 4 sottochiavi da 32 byte ciascuna tramite `HKDF-SHA256` con `salt` vuoto ($\varnothing$, cioè 32 byte zero):
- `metaKey = HKDF-SHA256(ikm = VK, salt = empty, info = UTF8("photocloud/v2/metaKey"), L = 32)`
- `thumbKey = HKDF-SHA256(ikm = VK, salt = empty, info = UTF8("photocloud/v2/thumbKey"), L = 32)`
- `dedupKey = HKDF-SHA256(ikm = VK, salt = empty, info = UTF8("photocloud/v2/dedupKey"), L = 32)`
- `fkWrapKey = HKDF-SHA256(ikm = VK, salt = empty, info = UTF8("photocloud/v2/fkWrapKey"), L = 32)`

### 3.6 File Key (`FK`) e Wrapping per-Blob
- Per ogni nuovo blob (foto, video, documento), il client genera:
  - `blobId`: UUIDv4 casuale (es. `"d3b07384-d113-4e59-9c2a-7b8e1f02a3c4"`, che corrisponde a 16 byte binari `d3b07384d1134e599c2a7b8e1f02a3c4`).
  - `FK`: 32 byte CSPRNG.
- `FK` viene wrappata con `fkWrapKey` usando `AES-256-GCM`:
  - `nonce`: 12 byte CSPRNG
  - `AAD`: i **16 byte binari** di `blobId` (gli stessi 16 byte presenti nell'header `PCZK` v1 ai byte `6..21`)
  - `wrappedFK` (60 byte): `nonce (12B) || ciphertext (32B) || tag (16B)`.

---

## 4. Formato Binario Blob `PCZK` v1

Ogni file del vault è cifrato in un flusso binario auto-contenuto `PCZK` v1 che supporta cifratura/decifrazione in streaming e lettura random-access tramite richieste HTTP `Range`.

### 4.1 Layout dell'Header (86 Byte Fissi)

| Offset (Byte) | Lunghezza | Campo | Descrizione |
| :--- | :--- | :--- | :--- |
| `0..3` | 4 B | `magic` | ASCII `"PCZK"` (`0x50 0x43 0x5A 0x4B`) |
| `4` | 1 B | `version` | `0x01` (uint8) |
| `5` | 1 B | `chunkSizeLog2` | `20` (`0x14`, uint8) → dimensione plaintext chunk $C = 2^{20} = 1\,048\,576\text{ B}$ (1 MiB). Valori ammessi dal parser: `16..24` (64 KiB .. 16 MiB). |
| `6..21` | 16 B | `blobId` | UUIDv4 in formato binario big-endian a 16 byte |
| `22..25` | 4 B | `noncePrefix` | 4 byte generati da CSPRNG |
| `26..85` | 60 B | `wrappedFK` | `AES-256-GCM(key=fkWrapKey, nonce=12B, plaintext=FK(32B), AAD=blobId(16B))` → `IV(12B) \|\| CT(32B) \|\| Tag(16B)` |

Totale dimensione `header` = **86 byte**.  
Sia $H = \text{SHA-256}(\text{header}[0..85])$ (32 byte).

### 4.2 Cifratura dei Chunk e Regola File Vuoti
Il plaintext di lunghezza $P \ge 0$ byte viene suddiviso in $N$ chunk di dimensione massima $C = 2^{\text{chunkSizeLog2}}$ byte:
- **Regola file vuoti ($P = 0$)**: deve essere emesso **almeno un chunk** ($N = 1$) con plaintext di 0 byte (che produce 16 byte di authentication tag GCM) e `isLast = 0x01`. Pertanto la dimensione minima valida di un blob `PCZK` v1 è $86 + 16 = 102\text{ byte}$.
- Per $P > 0$: il numero di chunk è $N = \lceil P / C \rceil$, indicizzati con `chunkIndex` $\in \{0, 1, \dots, N-1\}$.
- Per ogni chunk $i \in \{0, \dots, N-1\}$:
  - **Nonce (12 byte)**:
    $$\text{nonce}_i = \text{noncePrefix}\ (4\text{ B}) \mathbin{\Vert} \text{uint64\_be}(i)\ (8\text{ B})$$
  - **Flag `isLast` (1 byte)**:
    $$\text{isLast}_i = \begin{cases} \texttt{0x01} & \text{se } i = N - 1 \\ \texttt{0x00} & \text{se } i < N - 1 \end{cases}$$
  - **AAD (33 byte)**:
    $$\text{AAD}_i = \text{SHA-256}(\text{header})\ (32\text{ B}) \mathbin{\Vert} \text{isLast}_i\ (1\text{ B})$$
  - **Ciphertext del chunk**:
    $$\text{chunkCt}_i = \text{AES-256-GCM-Encrypt}(\text{key}=\text{FK},\ \text{nonce}=\text{nonce}_i,\ \text{plaintext}=\text{chunkPt}_i,\ \text{AAD}=\text{AAD}_i)$$
    dove $|\text{chunkCt}_i| = |\text{chunkPt}_i| + 16\text{ B}$ (ciphertext + tag GCM da 16 byte).

### 4.3 Deduzione di `isLast`, Anti-Truncation e Random-Access per `Range`
Sia $S_{\text{total}}$ la dimensione totale in byte del blob `PCZK` v1 (nota dall'header `Content-Length`, `Content-Range: bytes start-end/S_total` o dai metadati del blob):
1. Deve valere $S_{\text{total}} \ge 102$. Il payload dei chunk cifrati misura $S_{\text{chunks}} = S_{\text{total}} - 86$.
2. Ogni chunk non finale occupa esattamente $C_{\text{enc}} = 2^{\text{chunkSizeLog2}} + 16$ byte ($1\,048\,592$ byte per `chunkSizeLog2 = 20`).
3. Il numero totale di chunk $N$ si deduce univocamente da $S_{\text{total}}$:
   - Se $S_{\text{chunks}} == 16$ (file di 0 byte): $N = 1$, e il chunk $0$ ha `isLast = 0x01` e lunghezza cifrata 16 byte.
   - Se $S_{\text{chunks}} > 16$:
     $$N = \left\lceil \frac{S_{\text{chunks}}}{C_{\text{enc}}} \right\rceil$$
     (Inoltre deve valere che il resto dell'ultimo chunk $S_{\text{chunks}} - (N - 1) \cdot C_{\text{enc}}$ sia $> 16$, altrimenti il blob è malformato/corrotto).
4. **Calcolo Offset Random-Access (Range)**:
   Per leggere un intervallo di byte del plaintext $[p_{\text{start}}, p_{\text{end}}]$ (inclusivo, $0 \le p_{\text{start}} \le p_{\text{end}} < P$):
   - Indice primo chunk: $i_{\text{start}} = \lfloor p_{\text{start}} / C \rfloor$
   - Indice ultimo chunk: $i_{\text{end}} = \lfloor p_{\text{end}} / C \rfloor$
   - Offset byte nel ciphertext da richiedere via HTTP `Range`:
     $$\text{ctStart} = 86 + i_{\text{start}} \cdot (C + 16)$$
     $$\text{ctEnd} = \min\big(S_{\text{total}} - 1,\ 86 + (i_{\text{end}} + 1) \cdot (C + 16) - 1\big)$$
   - Per ogni chunk $i \in [i_{\text{start}}, i_{\text{end}}]$, il client sa che $i$ è l'ultimo chunk ($isLast_i = \texttt{0x01}$) se e solo se $i == N - 1$ (ossia se la fine del chunk coincide con $S_{\text{total}}$), verifica il tag GCM con `AAD = SHA256(header) || isLast_i` e taglia i byte di plaintext richiesti.
   - Se un attaccante sul server tronca gli ultimi chunk di un file multi-chunk e modifica `Content-Length`, il penultimo chunk ha `isLast = 0x00` ma il client (vedendolo alla fine del file troncato) tenterà di verificarlo con `isLast = 0x01`, causando il fallimento immediato dell'autenticazione AES-GCM.

---

## 5. Metadati Cifrati, Album Cifrati, Miniature e Deduplicazione

### 5.1 Metadati Per-Blob (`encryptedMeta`)
Ogni blob possiede un oggetto JSON di metadati cifrato sul client:
```json
{
  "v": 1,
  "name": "IMG_20261115_183000.jpg",
  "mime": "image/jpeg",
  "size": 3451200,
  "takenAt": 1763231400000,
  "createdAt": 1763231405000,
  "width": 4032,
  "height": 3024,
  "duration": null,
  "isFavorite": false,
  "exifSubset": {
    "make": "Google",
    "model": "Pixel 9 Pro",
    "lensModel": "Pixel 9 Pro back camera 6.9mm f/1.68",
    "fNumber": 1.68,
    "exposureTime": "1/125",
    "iso": 64,
    "focalLength": 6.9,
    "lat": 41.89021,
    "lon": 12.49223,
    "altitude": 22.5,
    "phash": "a3f09c12e4b87105"
  },
  "dedupTag": "8f3c...hex_or_b64url...",
  "thumbs": {
    "sm": { "present": true, "width": 320, "height": 240, "sizeBytes": 14200 },
    "md": { "present": true, "width": 1280, "height": 960, "sizeBytes": 98400 }
  }
}
```
- **Chiave per-blob (`blobMetaKey`, 32 byte)**:
  $$\text{blobMetaKey} = \text{HKDF-SHA256}(\text{ikm}=\text{metaKey},\ \text{salt}=\text{blobId\_bytes}(16\text{ B}),\ \text{info}=\text{UTF8}(\texttt{"photocloud/v2/blob-meta"}),\ L=32)$$
- **Cifratura**:
  - `nonce`: 12 byte CSPRNG
  - `AAD`: `UTF8("meta|" + blobId)` (dove `blobId` è la stringa UUID canonica lowercase di 36 caratteri)
  - Formato binario `encryptedMeta`: `nonce (12B) || ciphertext || tag (16B)`, codificato in base64url nei payload JSON API.

### 5.2 Catalogo Album Cifrato (`albums.bin`) con Concorrenza Ottimistica
Tutti gli album dell'utente sono rappresentati da un singolo documento JSON cifrato sul client:
```json
{
  "v": 1,
  "revision": 7,
  "updatedAt": 1763232000000,
  "albums": [
    {
      "id": "alb_90c1a2b3-4d5e-4f6a-8b9c-0d1e2f3a4b5c",
      "name": "Vacanze Estate 2026",
      "createdAt": 1763231000000,
      "coverBlobId": "d3b07384-d113-4e59-9c2a-7b8e1f02a3c4",
      "blobIds": ["d3b07384-d113-4e59-9c2a-7b8e1f02a3c4"]
    }
  ]
}
```
- **Chiave del catalogo album (`albumCatalogKey`, 32 byte)**:
  $$\text{albumCatalogKey} = \text{HKDF-SHA256}(\text{ikm}=\text{metaKey},\ \text{salt}=\text{UTF8}(\text{userId}),\ \text{info}=\text{UTF8}(\texttt{"photocloud/v2/albums"}),\ L=32)$$
- **Cifratura**:
  - `nonce`: 12 byte CSPRNG
  - `AAD`: `UTF8("albums|" + userId + "|" + revision)` (dove `revision` è l'intero incrementale `1, 2, 3...`)
  - Payload binario: `uint32_be(revision) (4B) || nonce (12B) || ciphertext || tag (16B)`.
- **Concorrenza ottimistica (`ETag` / `If-Match`)**:
  - Il server calcola `ETag = "\"" + revision + "-" + sha256(ciphertext).slice(0, 16) + "\""`.
  - `PUT /api/v2/albums` richiede l'header `If-Match: <ETag>` (oppure `If-None-Match: *` per la prima creazione `revision = 1`). Se l'`ETag` non coincide con quello attuale sul server, il server risponde `412 Precondition Failed` restituendo il blob album corrente e il suo `ETag`, permettendo al client di decifrare la versione remota, unire i set `albums` / `blobIds` e riprovare con `revision + 1`.

### 5.3 Miniature Client-Side (`320px` e `1280px`)
- Il client genera due varianti JPEG/WebP (`sm` = max lato 320px, `md` = max lato 1280px).
- Per ciascuna variante `variant` $\in \{\texttt{"320"}, \texttt{"1280"}\}$:
  - **Chiave per-miniatura (`blobThumbKey`, 32 byte)**:
    $$\text{blobThumbKey} = \text{HKDF-SHA256}(\text{ikm}=\text{thumbKey},\ \text{salt}=\text{blobId\_bytes}(16\text{ B}),\ \text{info}=\text{UTF8}(\texttt{"photocloud/v2/thumb/"} + \text{variant}),\ L=32)$$
  - **Cifratura**:
    - `nonce`: 12 byte CSPRNG
    - `AAD`: `UTF8("thumb|" + blobId + "|" + variant)` (es. `"thumb|d3b07384-d113-4e59-9c2a-7b8e1f02a3c4|320"`)
    - Formato binario: `nonce (12B) || ciphertext || tag (16B)`.
- Il server salva i due blob opachi in `user_media/<userId>/thumbs/<blobId>.320.bin` e `<blobId>.1280.bin` e li serve come `application/octet-stream`.

### 5.4 Deduplicazione Streaming (`dedupTag`) e Integrità Ciphertext
- **Calcolo `dedupTag`**:
  - Il client legge il file plaintext in streaming a blocchi di **64 KiB (`65536` byte)** e aggiorna un contesto `HMAC-SHA256` inizializzato con la chiave `dedupKey` (32 byte):
    $$\text{dedupTag} = \text{HMAC-SHA256}(\text{key}=\text{dedupKey},\ \text{message}=\text{plaintext})$$
  - Il risultato di 32 byte è codificato in **base64url** (43 caratteri).
- **Integrità dell'Upload**:
  - Durante la cifratura `PCZK` v1, il client calcola in streaming `ciphertextSha256 = SHA-256(ciphertext)` (32 byte hex lowercase) e lo invia nell'header `X-Ciphertext-Sha256`.
  - Il server calcola `SHA-256` sui byte ricevuti mentre li scrive su disco e rifiuta l'upload con `422 Unprocessable Entity` (`CIPHERTEXT_INTEGRITY_MISMATCH`) se gli hash non coincidono.

---

## 6. Condivisione Zero-Knowledge (`/share/<shareId>#<shareKey>`)

### 6.1 Condivisione Senza Password
1. Il client genera:
   - `shareId`: UUIDv4 casuale
   - `shareKey`: 32 byte CSPRNG
2. Da `shareKey`, il client deriva:
   - `shareWrapKey = HKDF-SHA256(ikm = shareKey, salt = empty, info = UTF8("photocloud/v2/share/wrap"), L = 32)`
   - `shareMetaKey = HKDF-SHA256(ikm = shareKey, salt = empty, info = UTF8("photocloud/v2/share/meta"), L = 32)`
3. Per ogni `blobId` incluso nella condivisione:
   - Il client recupera la `FK` del blob (sbloccandola dall'header del blob o dai metadati locali) e la ri-wrappa con `shareWrapKey`:
     $$\text{shareWrappedFK} = \text{AES-256-GCM}(\text{key}=\text{shareWrapKey},\ \text{nonce}=12\text{B},\ \text{plaintext}=\text{FK},\ \text{AAD}=\text{UTF8}(\texttt{"share-fk|"} + \text{shareId} + \texttt{"|"} + \text{blobId}))$$
   - Il client cifra i metadati di visualizzazione della share (`{ name, mime, size, takenAt, width, height, duration }`) con `shareMetaKey`:
     $$\text{shareEncryptedMeta} = \text{AES-256-GCM}(\text{key}=\text{shareMetaKey},\ \text{nonce}=12\text{B},\ \text{plaintext}=\text{JSON},\ \text{AAD}=\text{UTF8}(\texttt{"share-meta|"} + \text{shareId} + \texttt{"|"} + \text{blobId}))$$
   - Se presente una miniatura `320px`, il client la cifra con `shareMetaKey` e `AAD = UTF8("share-thumb|" + shareId + "|" + blobId)`.
4. Il client invia al server `POST /api/v2/shares` con `{ shareId, expiresAt, passwordProtected: false, items: [{ blobId, shareWrappedFK, shareEncryptedMeta, shareEncryptedThumb }] }`.
5. Il link generato per l'utente è:
   `https://<host>/share/<shareId>#<base64url(shareKey)>`
6. Quando il destinatario apre `/share/<shareId>#<shareKey>`, il browser legge `<shareKey>` da `window.location.hash`, pulisce immediatamente l'hash dalla barra degli indirizzi con `history.replaceState(null, '', window.location.pathname)`, scarica il manifesto cifrato da `GET /api/v2/shares/<shareId>`, decifra i metadati e le `FK` dei singoli blob in WebCrypto, e scarica/decifra i blob `PCZK` v1 (sostituendo l'unwrap della `FK` con `shareWrappedFK`).

### 6.2 Condivisione Protetta da Password Opzionale
Se il creatore della share imposta una password opzionale:
1. Il client genera `shareSalt` (16 byte CSPRNG) e deriva:
   $$\text{pwKey} = \text{Argon2id}(\text{password}=\text{UTF8}(\text{NFC}(\text{password})),\ \text{salt}=\text{shareSalt},\ m=65536\text{ KiB},\ t=3,\ p=1,\ \text{tagLen}=32)$$
2. Il client wrappa `shareKey` (oppure una chiave secondaria combinata con il fragment `#`) con `pwKey`:
   $$\text{pwWrappedShareKey} = \text{AES-256-GCM}(\text{key}=\text{pwKey},\ \text{nonce}=12\text{B},\ \text{plaintext}=\text{shareKey},\ \text{AAD}=\text{UTF8}(\texttt{"share-pw|"} + \text{shareId}))$$
3. Il server salva `{ shareSalt, kdfParams, pwWrappedShareKey }` e applica un **rate limit dedicato** (max 5 richieste / 15 minuti per IP e per `shareId`) sull'endpoint che restituisce il manifesto della share.

---

## 7. Gestione Sessione, Auto-Lock e Android Keystore

### 7.1 Sessione HTTP
- Cookie di sessione `photocloud_sid`:
  `Set-Cookie: photocloud_sid=<32B_hex_CSPRNG>; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=86400`
  *(In ambiente di test locale HTTP su `127.0.0.1`/`localhost`, `Secure` è omesso solo se la connessione non è TLS e `NODE_ENV !== 'production'`).*
- Protezione CSRF: oltre a `SameSite=Strict`, tutte le richieste mutanti (`/api/v2/*` `POST`/`PUT`/`DELETE`/`PATCH`) devono inviare l'header `X-PhotoCloud-Request: 1` (o token CSRF di sessione).

### 7.2 Ciclo di Vita della `VK` sul Client Web
- La `VK` e le sottochiavi (`metaKey`, `thumbKey`, `dedupKey`, `fkWrapKey`) risiedono **esclusivamente in variabili JavaScript in memoria** (closure del modulo crittografico / Web Worker crittografico) come `CryptoKey` (con `extractable: false` ove possibile dopo la derivazione) o `Uint8Array` azzerabili con `.fill(0)`.
- **Mai** in `localStorage`, `sessionStorage` o `IndexedDB` in chiaro.
- **Auto-lock su inattività**: dopo `15 minuti` (configurabile dall'utente: 5, 15, 30 min) senza interazione utente e senza upload/download attivi, o su `lockVault()` esplicito, il client azzera tutti i buffer chiave in RAM (`Uint8Array.fill(0)`) e mostra la schermata di sblocco (richiedendo la passphrase o il file chiave).

### 7.3 Ciclo di Vita della `VK` su Android (`AndroidKeyStore`)
Su Android, dopo il login/registrazione iniziale in cui la `VK` (32B) viene sbloccata in memoria:
1. **Chiave Keystore Interattiva (`photocloud_vk_bio_v2`)**:
   - Generata in `AndroidKeyStore` con `KeyProperties.KEY_ALGORITHM_AES`, `BLOCK_MODE_GCM`, `ENCRYPTION_PADDING_NONE`, `KeySize = 256`.
   - Configurata con:
     - `setUserAuthenticationRequired(true)`
     - `setUserAuthenticationParameters(0, KeyProperties.AUTH_BIOMETRIC_STRONG)` (su API 30+; fallback compatibile API 28-29)
     - `setInvalidatedByBiometricEnrollment(true)`
   - La `VK` viene cifrata con il `Cipher` associato a un `BiometricPrompt.CryptoObject(cipher)` e il ciphertext (`iv || ct || tag`) viene salvato in `SharedPreferences` (`"wrapped_vk_bio_v2"`).
   - A ogni riavvio dell'app o dopo auto-lock per inattività, l'app invoca `BiometricPrompt.authenticate(promptInfo, BiometricPrompt.CryptoObject(decryptCipher))`. Solo il successo biometrico hardware sblocca il `Cipher` nel Keystore e permette di decifrare la `VK` in RAM.
2. **Chiave Keystore per AutoBackup in Background (`photocloud_vk_bg_v2`)**:
   - Poiché `AutoBackupWorker` (`WorkManager`) viene eseguito in background senza UI e non può mostrare `BiometricPrompt`, quando l'utente abilita l'Auto-Backup viene generata una seconda chiave in `AndroidKeyStore`:
     - `KeyProperties.KEY_ALGORITHM_AES`, `BLOCK_MODE_GCM`, `ENCRYPTION_PADDING_NONE`, `KeySize = 256`
     - Configurata con **`setUnlockedDeviceRequired(true)`** (Android 9 / API 28+, che coincide con `minSdk = 28` del progetto!) e `setUserAuthenticationRequired(false)`.
   - Questa chiave wrappa la `VK` (`"wrapped_vk_bg_v2"`) e può essere usata da `AutoBackupWorker` **solo mentre il dispositivo è sbloccato dall'utente**. Appena lo schermo viene bloccato a livello OS, il Keystore rifiuta qualsiasi operazione su `photocloud_vk_bg_v2`.

---

## 8. Architettura Storage Server v2 e Specifica Completa API HTTP (`/api/v2/*`)

### 8.1 Storage Engine (SQLite WAL + Filesystem Sharded `vault_v2/`)
1. **Database Indice (`vault_v2/index.sqlite`)**:
   - Motore: SQLite in modalità `WAL` (`PRAGMA journal_mode = WAL; PRAGMA synchronous = NORMAL; PRAGMA foreign_keys = ON; PRAGMA busy_timeout = 5000;`) tramite il modulo nativo `node:sqlite` (`DatabaseSync`).
   - Tabelle:
     - `users_v2`: `user_id TEXT PRIMARY KEY`, `username TEXT UNIQUE NOT NULL`, `user_salt BLOB NOT NULL`, `kdf_params TEXT NOT NULL`, `server_salt BLOB NOT NULL`, `auth_verifier BLOB NOT NULL`, `wrapped_vk BLOB NOT NULL`, `quota_bytes INTEGER NOT NULL`, `created_at INTEGER NOT NULL`, `updated_at INTEGER NOT NULL`.
     - `sessions_v2`: `session_id TEXT PRIMARY KEY`, `user_id TEXT NOT NULL`, `csrf_token TEXT NOT NULL`, `created_at INTEGER NOT NULL`, `expires_at INTEGER NOT NULL`.
     - `items_v2`: `id TEXT PRIMARY KEY` (UUIDv4 = `blobId` corrente o `itemId`), `owner_id TEXT NOT NULL`, `blob_id TEXT NOT NULL`, `version INTEGER NOT NULL DEFAULT 1`, `size_bytes INTEGER NOT NULL`, `ciphertext_sha256 TEXT NOT NULL`, `state TEXT NOT NULL CHECK(state IN ('active','trashed'))`, `trashed_at INTEGER`, `enc_meta BLOB NOT NULL`, `dedup_tag TEXT`, `thumbs_json TEXT NOT NULL DEFAULT '{}'`, `created_at INTEGER NOT NULL`, `updated_at INTEGER NOT NULL`.
     - `uploads_v2`: `upload_id TEXT PRIMARY KEY`, `owner_id TEXT NOT NULL`, `blob_id TEXT NOT NULL`, `total_size INTEGER NOT NULL`, `chunk_size INTEGER NOT NULL`, `total_chunks INTEGER NOT NULL`, `received_chunks INTEGER NOT NULL DEFAULT 0`, `expected_sha256 TEXT NOT NULL`, `enc_meta BLOB NOT NULL`, `dedup_tag TEXT`, `replace_item_id TEXT`, `expected_version INTEGER`, `temp_path TEXT NOT NULL`, `created_at INTEGER NOT NULL`, `expires_at INTEGER NOT NULL`.
     - `albums_v2`: `owner_id TEXT PRIMARY KEY`, `etag TEXT NOT NULL`, `size_bytes INTEGER NOT NULL`, `updated_at INTEGER NOT NULL`.
     - `shares_v2` & `share_items_v2`: `share_id TEXT PRIMARY KEY`, `owner_id TEXT NOT NULL`, `expires_at INTEGER`, `password_wrap BLOB`, `created_at INTEGER NOT NULL`; `share_items_v2(share_id, blob_id, wrapped_fk BLOB, enc_meta BLOB, enc_thumb BLOB)`.
2. **Layout Filesystem Ciphertext (`vault_v2/`)**:
   - Ogni `blobId` è validato rigorosamente come UUID v4 canonico lowercase (`/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/`). Nessun nome file fornito dal client tocca mai il filesystem.
   - Path del blob: `vault_v2/<userId>/<blobId[0..1]>/<blobId>` (dove `<blobId[0..1]>` sono i primi 2 caratteri esadecimali di `blobId`).
   - Path miniature cifrate: `vault_v2/<userId>/<blobId[0..1]>/<blobId>.thumb.<variant>` (`variant` $\in \{\texttt{320}, \texttt{1280}\}$).
   - Path catalogo album cifrato: `vault_v2/<userId>/albums.bin`.
   - **Scrittura Atomica**: ogni file viene scritto in `temp_uploads/v2_tmp_<uuid>`, sottoposto a `fsync` sul file descriptor, chiuso, e spostato atomicamente con `fs.renameSync(tmpPath, finalPath)` seguito da `fsync` della directory padre.
3. **Crittografia Ammessa sul Server**:
   - Il modulo server v2 **non importa né contiene alcuna funzione di cifratura/decifrazione AES o derivazione chiavi di contenuto**.
   - Uniche operazioni crittografiche eseguite dal server (`node:crypto`):
     1. Verifica di `authSecret` tramite `crypto.scrypt(authSecretBytes, serverSalt, 32, { N: 32768, r: 8, p: 1, maxmem: 64 * 1024 * 1024 })` + `crypto.timingSafeEqual`.
     2. Generazione deterministica di parametri finti su `/api/v2/login/params` per utenti inesistenti tramite `HMAC-SHA256(serverSecret, "login-params|" + username)` + calcolo KDF dummy in tempo costante per prevenire user enumeration.
     3. Verifica `SHA-256` in streaming del **ciphertext** caricato.
     4. Generazione di ID/token casuali (`crypto.randomUUID()`, `crypto.randomBytes(32)`).
4. **Limiti e Sicurezza Trasversale**:
   - `MAX_UPLOAD_MB` (default `2048 MiB`, configurabile via env/options), `MAX_UPLOAD_CHUNKS = 4096`, `MAX_ENC_META_BYTES = 65536` (64 KiB), `MAX_ALBUM_BLOB_BYTES = 4194304` (4 MiB), `MAX_THUMB_BLOB_BYTES = 2097152` (2 MiB).
   - Ogni risorsa è filtrata per `owner_id = session.userId`; qualsiasi accesso a risorse inesistenti o appartenenti ad altri utenti restituisce **`404 Not Found`** (mai `403`).
   - Redazione rigorosa dei log: nessun body di richiesta nei log; redazione automatica di `authSecret`, `oldAuthSecret`, `newAuthSecret`, `wrappedVaultKey`, `wrappedVk`, `encMeta`, `Cookie`, `Authorization`.

### 8.2 Endpoint Account (`/api/v2/register`, `/api/v2/login/params`, `/api/v2/login`, `/api/v2/logout`, `/api/v2/account/rewrap`)
1. **`POST /api/v2/register`** *(alias: `POST /api/v2/auth/register`)*
   - Request JSON: `{ "username": "alice", "userId"?: "<uuid-v4>", "salt": "<base64url 16B>", "kdfParams": { "memoryKiB": 65536, "iterations": 3, "parallelism": 1, "hashLength": 32 }, "authSecret": "<base64url 32B>", "wrappedVaultKey": "<base64url 60B>" }`
   - Response `201 Created`: `{ "userId": "...", "username": "alice", "csrfToken": "..." }` + cookie `photocloud_v2_sid` (`HttpOnly; Secure; SameSite=Strict; Path=/`).
2. **`POST /api/v2/login/params`** *(alias: `POST /api/v2/auth/params`)*
   - Request JSON: `{ "username": "alice" }`
   - Response `200 OK`: `{ "salt": "<base64url 16B>", "kdfParams": { "algorithm": "argon2id", "memoryKiB": 65536, "iterations": 3, "parallelism": 1, "hashLength": 32 } }`.
   - Se `username` non esiste, deriva `salt = HMAC-SHA256(serverSecret, "salt|" + username)[0..15]` ed esegue una derivazione `scrypt` dummy con gli stessi parametri del login per uniformare forma e tempo di risposta.
3. **`POST /api/v2/login`** *(alias: `POST /api/v2/auth/login`)*
   - Request JSON: `{ "username": "alice", "authSecret": "<base64url 32B>" }`
   - Response `200 OK`: `{ "userId": "...", "username": "alice", "salt": "<base64url 16B>", "kdfParams": { ... }, "wrappedVaultKey": "<base64url 60B>", "csrfToken": "..." }` + cookie `photocloud_v2_sid` (`HttpOnly; Secure; SameSite=Strict`).
4. **`POST /api/v2/logout`** *(alias: `POST /api/v2/auth/logout`)*
   - Invalida la sessione nel DB SQLite e azzera il cookie `photocloud_v2_sid`.
5. **`POST /api/v2/account/rewrap`** *(alias: `PUT /api/v2/auth/passphrase`)*
   - Request JSON: `{ "oldAuthSecret": "<base64url 32B>", "newSalt": "<base64url 16B>", "newKdfParams": { ... }, "newAuthSecret": "<base64url 32B>", "newWrappedVaultKey": "<base64url 60B>" }`
   - Verifica `oldAuthSecret` in constant-time, aggiorna atomicamente in transazione SQLite `user_salt`, `kdf_params`, `server_salt`, `auth_verifier` e `wrapped_vk`, e revoca tutte le altre sessioni dell'utente.

### 8.3 Endpoint Blob e Upload Chunked/Resumable (`/api/v2/blobs/*`)
1. **`POST /api/v2/blobs/upload/init`**:
   - Request JSON: `{ "blobId": "<uuid-v4>", "totalSize": 150134, "chunkSize": 65536, "totalChunks": 3, "expectedSha256": "<64-hex>", "encMeta": "<base64url>", "dedupTag"?: "<base64url 32B>", "replaceItemId"?: "<uuid-v4>", "expectedVersion"?: 1 }`
   - Valida `blobId` (UUIDv4 rigoroso), limiti (`totalSize >= 102`, `totalSize <= MAX_UPLOAD_BYTES`, `totalChunks <= MAX_UPLOAD_CHUNKS`, `encMeta <= MAX_ENC_META_BYTES`) e quota disponibile dell'utente (`activeBytes + trashedBytes + totalSize <= quotaBytes`, altrimenti `413 Payload Too Large` `QUOTA_EXCEEDED`).
   - Response `201 Created`: `{ "uploadId": "<uuid-v4>", "blobId": "<uuid-v4>", "receivedChunks": 0 }`.
2. **`PUT /api/v2/blobs/upload/:uploadId/:chunkIndex`**:
   - Body: `application/octet-stream` (bytes del chunk di ciphertext).
   - Verifica che `uploadId` appartenga all'utente (`404` altrimenti), che `chunkIndex === received_chunks` (rifiuta chunk fuori ordine con `409 Conflict` `CHUNK_OUT_OF_ORDER`), che sul chunk `0` i primi 5 byte siano `PCZK\x01` e i byte `6..21` coincidano con `blobId`, e che la somma dei byte non superi `totalSize`.
   - Appende i byte di ciphertext a `temp_uploads/v2_<uploadId>.part` con `fsync`.
3. **`POST /api/v2/blobs/upload/:uploadId/complete`**:
   - Verifica che tutti i chunk siano stati ricevuti e che la dimensione totale coincida con `totalSize`.
   - Calcola in streaming `SHA-256` del file ciphertext in `temp_uploads/v2_<uploadId>.part` e lo confronta in constant-time con `expectedSha256` (`422 CIPHERTEXT_INTEGRITY_MISMATCH` e cancellazione del `.part` in caso di mismatch).
   - Esegue `fsync` + `rename` atomico in `vault_v2/<userId>/<blobId[0..1]>/<blobId>` e registra/aggiorna il record in `items_v2` in transazione SQLite.
4. **`GET /api/v2/blobs/:id`**:
   - Verifica che il blob appartenga all'utente (`404` altrimenti).
   - Imposta sempre:
     - `Content-Type: application/octet-stream`
     - `X-Content-Type-Options: nosniff`
     - `Cache-Control: private, max-age=31536000, immutable`
     - `Accept-Ranges: bytes`
     - `ETag: "<ciphertext_sha256>"`
   - Supporta RFC 9110 `Range` completo:
     - `Range: bytes=start-end` (`0 <= start <= end < size`) → `206 Partial Content`, `Content-Range: bytes start-end/size`.
     - `Range: bytes=start-` (`0 <= start < size`) → `206 Partial Content`, `Content-Range: bytes start-(size-1)/size`.
     - Suffix range `Range: bytes=-suffixLen` (`suffixLen > 0`) → ultimi `min(suffixLen, size)` byte con `206 Partial Content`.
     - Range sintatticamente malformato, `start >= size`, `start > end`, `-0`, o multi-range non supportato → `416 Range Not Satisfiable` con `Content-Range: bytes */size`.
5. **Miniature Cifrate**:
   - `PUT /api/v2/blobs/:id/thumbs/:variant` (`variant` $\in \{\texttt{320}, \texttt{1280}\}$) e `GET /api/v2/blobs/:id/thumbs/:variant`.

### 8.4 Endpoint Item, Editing/Versione, Dedup, Album, Trash, Stats e Share
1. **Item (`GET /api/v2/items`, `GET /api/v2/items/:id`, `PATCH /api/v2/items/:id/meta`, `POST /api/v2/items/:id/replace`)**:
   - Record: `{ id, blobId, version, size, createdAt, updatedAt, state, trashedAt, encMeta, dedupTag, thumbs }`.
   - `GET /api/v2/items?state=active|trashed&limit=50&cursor=<base64url>` restituisce `{ items: [...], nextCursor: "..." | null }`.
   - `PATCH /api/v2/items/:id/meta` aggiorna `encMeta` (validando limite 64 KiB) e `updatedAt`.
   - `POST /api/v2/items/:id/replace` (o `replaceItemId` in upload chunked) sostituisce il blob associato all'item verificando `expectedVersion` (`409 Conflict` / `412 Precondition Failed` se obsoleto), incrementa `version = version + 1`, aggiorna `blobId`, `size`, `encMeta`, `dedupTag`, e rimuove il vecchio blob fisico da `vault_v2/`.
2. **Dedup (`POST /api/v2/backup/check`)**:
   - Riceve `{ "dedupTags": ["<b64u>", ...] }`, interroga SQLite solo sugli item con `owner_id = userId AND state = 'active'`, e restituisce `{ "existing": { "<dedupTag>": "<itemId>" }, "matchedTags": ["..."] }`.
3. **Album (`GET /api/v2/albums`, `PUT /api/v2/albums`)**:
   - `GET /api/v2/albums`: serve il blob cifrato `vault_v2/<userId>/albums.bin` con `Content-Type: application/octet-stream` e header `ETag`. Se non esiste, `204 No Content`.
   - `PUT /api/v2/albums`: richiede `If-Match: "<etag>"` (o `If-None-Match: *` per la prima scrittura). Se l'ETag non corrisponde a quello corrente, risponde `412 Precondition Failed`.
4. **Trash (`POST /api/v2/trash`, `POST /api/v2/trash/restore`, `DELETE /api/v2/trash/items`, `DELETE /api/v2/trash`)**:
   - Transizione `active` ↔ `trashed` con timestamp `trashedAt`, cancellazione definitiva di singoli item, svuotamento cestino (`DELETE /api/v2/trash`) e funzione di purge per TTL (`purgeExpiredTrashV2`).
5. **Stats (`GET /api/v2/stats`)**:
   - Restituisce esclusivamente `{ "activeBytes": number, "trashedBytes": number, "activeCount": number, "trashedCount": number, "quotaBytes": number }` (nessuna categoria MIME).
6. **Share (`POST /api/v2/shares`, `DELETE /api/v2/shares/:shareId`, `GET /api/v2/shares/:shareId`, `GET /api/v2/shares/:shareId/blobs/:blobId`)**:
   - Creazione e revoca di share su blob dell'utente (con `expiresAt` opzionale e `passwordWrap` opzionale salvato come blob opaco), e download pubblico del manifesto e del ciphertext (con supporto `Range`) protetto da rate limit dedicato per IP e per `shareId`.

