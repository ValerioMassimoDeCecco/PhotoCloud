# Modello di Minaccia (Threat Model) e Limiti di Recupero — PhotoCloud Zero-Knowledge v2

> **Versione**: `v2.0`  
> **Riferimento normativo**: `docs/zk-spec.md` §1, §3, §7

---

## 1. Perimetro di Fiducia e Attaccanti In-Scope

1. **Server self-hosted compromesso o "Honest-but-Curious"**:
   - L'amministratore di sistema, il provider cloud/VPS o un attaccante con accesso in lettura al filesystem (`vault_v2/`, `temp_uploads/`, database SQLite `index.db`, log, variabili d'ambiente) **non può decifrare** alcun file, miniatura, metadato (`encMeta`), catalogo album o manifesto di condivisione (`shareManifest`).
   - Il server non riceve mai: `passphrase`, `accountKey` (32B), `root` (32B), `kek` (32B), `VK` (Vault Key, 32B), le sottochiavi (`metaKey`, `thumbKey`, `dedupKey`, `fkWrapKey`), le `FK` (File Key per-blob) né la `shareKey` (contenuta esclusivamente nel fragment URL `#<shareKey>` che non lascia il browser).
2. **Compromissione passiva del database (`index.db`)**:
   - I token di sessione (`photocloud_v2_sid`) sono memorizzati esclusivamente come digest `SHA-256` (`sid_hash`).
   - Il segreto di autenticazione `authSecret` è verificato tramite `scrypt` (`N=32768, r=8, p=1`) con `server_salt` dedicato per utente e confronto `crypto.timingSafeEqual`.
   - Il `setupToken` di avvio viene generato in memoria da CSPRNG (24 byte), stampato **una sola volta** sullo `stdout` del processo quando il database non ha utenti, confrontato in tempo costante e azzerato in RAM dopo la prima registrazione; **non viene mai salvato su file di log né in chiaro in SQLite**.
3. **Prevenzione di User Enumeration in Registrazione e Login**:
   - `POST /api/v2/login/params` restituisce parametri deterministici derivati via `HMAC-SHA256(serverSecret, username)` ed esegue un calcolo `scrypt` fittizio per gli utenti inesistenti.
   - `POST /api/v2/register` valida rigorosamente `userId` (se fornito dal client) come UUIDv4 canonico e restituisce la medesima risposta generica `409 Conflict` (`{ "error": "REGISTRATION_CONFLICT" }`) sia quando collide `username` sia quando collide `userId`, senza rivelare quale dei due campi sia già registrato.

---

## 2. Ruolo del File Chiave (`accountKey`), del Recovery Code e della Passphrase

Nella gerarchia crittografica PhotoCloud v2 (`docs/zk-spec.md` §3.3), la chiave radice `root` è derivata combinando due fattori indipendenti:

$$\text{passphrasePart} = \text{Argon2id}(\text{NFC}(\text{passphrase}),\ \text{userSalt},\ m \ge 65536\text{ KiB},\ t \ge 3,\ p \ge 1)$$
$$\text{ikm} = \text{passphrasePart}\ (32\text{ B}) \mathbin{\Vert} \text{accountKey}\ (32\text{ B})$$
$$\text{root} = \text{HKDF-SHA256}(\text{ikm},\ \text{userSalt},\ \texttt{"photocloud/v2/root"},\ 32)$$

### 2.1 Cosa Sostituisce il Recovery Code (e Cosa NON Sostituisce)
- **Il Recovery Code è una codifica testuale della sola `accountKey` (32 byte / 256 bit)**: permette di rigenerare il file chiave JSON (`photocloud_v2_key_<username>.json`) qualora il file venga smarrito o si acceda da un nuovo dispositivo.
- **Il Recovery Code NON sostituisce e NON contiene la Passphrase**: chi possiede solo il Recovery Code (o solo il file chiave) senza conoscere la passphrase non può derivare `passphrasePart`, non può calcolare `root` / `kek` e non può decifrare `wrappedVk`.
- **Perdita della Passphrase = Perdita Irreversibile dei Dati**:
  - Poiché il server è Zero-Knowledge e non memorizza né la passphrase né la `VK` in chiaro, **non esiste alcuna procedura di "Reset Password" lato server**.
  - Se l'utente dimentica o perde la **Passphrase**, oppure perde contemporaneamente sia il **File Chiave** sia il **Recovery Code**, tutti i dati cifrati nel vault sono **matematicamente e definitivamente irrecuperabili**.
  - Questo avviso è mostrato in modo esplicito nella schermata di registrazione (`/v2`), nel flusso di conferma del Recovery Code e nel pannello di gestione del File Chiave.

---

## 3. Soglia Minima KDF (KDF Floor Pinning)

Per impedire a un server compromesso di eseguire un attacco di *KDF Parameter Downgrade* (restituendo parametri Argon2id banali su `/api/v2/login/params` per velocizzare il brute-force offline di `authSecret` o per indurre collisioni/debolezze), il client Web e Android impongono una soglia minima inderogabile (**KDF Floor**) prima ancora di invocare Argon2id:
- `algorithm`: `"Argon2id"`
- `memoryKiB >= 65536` (**64 MiB**, pari ai parametri usati in registrazione)
- `iterations (t) >= 3`
- `parallelism (p) >= 1`
- `salt.byteLength >= 16` byte (128 bit)

Qualsiasi parametro inferiore alla soglia causa l'interruzione immediata del login con errore crittografico `INVALID_PARAMETER` prima che la passphrase venga processata da Argon2id.

---

## 4. Isolamento dello Streaming Video nel Service Worker (`/v2/sw-stream.js`)

Per consentire la riproduzione fluida e il *seek* (`Range` HTTP `206 Partial Content`) di file video cifrati `PCZK` v1 senza caricare l'intero video in RAM:
1. Il thread principale non invia mai la `VK` né la `fkWrapKey` al Service Worker: decifra solo l'header `PCZK` di 86 byte del singolo video e invia al Service Worker un **ticket monouso/temporaneo** contenente esclusivamente la `FK` (32B) di quel singolo blob, l'header `PCZK` e `totalCiphertextBytes`.
2. **Legame `(blobId, clientId)` e Scope `/v2/`**:
   - Ogni ticket è vincolato alla coppia `(blobId, clientId)` del client finestra appartenente allo scope `/v2/`. Messaggi o richieste provenienti da client fuori dallo scope `/v2/` vengono rifiutati (`403`).
   - Un ticket registrato per il `blobId` $A$ non può mai essere usato per decifrare o servire il `blobId` $B$ (`403 Forbidden`).
   - Il ticket resta valido per tutte le richieste `Range` successive del player `<video>` su quel `(blobId, clientId)` fino alla scadenza del TTL (`5 minuti`) o alla ricezione del comando `LOCK_ALL_KEYS` (inviato al lock del vault o al logout), che azzera immediatamente (`fill(0)`) tutte le `FK` in memoria nel Service Worker.
3. **Divieto di Persistenza su Disco (`Cache-Control: no-store`)**:
   - Tutte le risposte sintetizzate dal Service Worker su `/v2/__stream/<blobId>` includono obbligatoriamente `Cache-Control: no-store, no-cache, must-revalidate, max-age=0` e `X-Content-Type-Options: nosniff`. Il Service Worker non utilizza mai la `Cache API` del browser per memorizzare porzioni di plaintext.
