# PhotoCloud

**Archivio self-hosted 100% Zero-Knowledge End-to-End Encrypted (E2EE) per foto, video e documenti, con web app (PWA), backend alternativo in Rust e app Android nativa.**

[![Versione](https://img.shields.io/github/package-json/v/ValerioMassimoDeCecco/PhotoCloud?label=versione)](CHANGELOG.md)
[![Node.js](https://img.shields.io/badge/Node.js-22.13%2B%20LTS-339933?logo=nodedotjs&logoColor=white)](https://nodejs.org)
[![Rust](https://img.shields.io/badge/Rust-Axum%20%2B%20Tokio-DEA584?logo=rust&logoColor=white)](#server-nativo-rust)
[![Android](https://img.shields.io/badge/Android-8.0%2B-3DDC84?logo=android&logoColor=white)](#app-android)
[![Kotlin](https://img.shields.io/badge/Kotlin-Jetpack%20Compose-7F52FF?logo=kotlin&logoColor=white)](android-app)

PhotoCloud conserva sul tuo server foto, video, documenti Office/PDF e qualsiasi altro file (ZIP, APK, audio, codice…), proteggendoli con **crittografia autenticata esclusivamente lato client** e rendendoli consultabili da browser o da smartphone. Il progetto è composto da tre componenti principali:

| Componente | Descrizione | Tecnologie |
| --- | --- | --- |
| **Server e web app (Node.js)** | Backend **100% Zero-Knowledge E2EE** (`/v2`, `/api/v2/*`). Non contiene né importa alcun cifrario simmetrico per i dati utente: riceve, archivia e serve esclusivamente ciphertext opaco `PCZK v1`. | Node.js 22.13+ (`node:sqlite`), Express 5, TypeScript, Vite 8, `hash-wasm` (Argon2id), WebCrypto AES-256-GCM |
| **Server nativo Rust** | Backend standalone ad alte prestazioni senza dipendenze Node.js a runtime, compatibile al 100% con il vault **Zero-Knowledge v2** (`/v2`, `/api/v2/*`, `index.sqlite`). Compilato **senza alcun crate di cifratura simmetrica** (`aes`, `aes-gcm`, `cfb-mode`, `pbkdf2`, `hkdf` assenti dal `Cargo.toml`). | Rust, Axum, Tokio, `rusqlite`, `scrypt`, `hmac`, `sha2`, `subtle` |
| **App Android** (`com.valerio.photocloud`) | Client nativo Material 3 / Jetpack Compose **esclusivamente Zero-Knowledge E2EE**: cifratura/decifratura `PCZK v1` on-device (Argon2id + HKDF-SHA256 + AES-256-GCM), Android KeyStore hardware-backed, TOFU SPKI certificate pinning, backup automatico cifrato della Camera Roll, AI on-device facoltativa e aggiornamenti in-app. | Kotlin, Jetpack Compose (Material 3), BouncyCastle (Argon2id), OkHttp, Room, WorkManager, MediaPipe. `minSdk 26`, `targetSdk 35` |

> [!IMPORTANT]
> **Crittografia 100% Client-Side (Zero-Knowledge End-to-End):**
> - **File, miniature, metadati, nomi file, album e link pubblici (`#fragment`)** sono cifrati **esclusivamente sul client** prima di lasciare il dispositivo (Argon2id + Account Key 256-bit + HKDF-SHA256 + AES-256-GCM chunked `PCZK v1`).
> - **Il server non vede mai passphrase, chiavi o contenuti in chiaro**, e **non esiste più alcuna opzione di cifratura lato server** (tutte le rotte legacy v1 sono state rimosse definitivamente con `HTTP 410 Gone`; `/` reindirizza direttamente a `/v2`).
> - Pubblica sempre PhotoCloud su **HTTPS** (obbligatorio fuori da `localhost` per WebCrypto e cookie `Secure` delle API `/api/v2/*`, oltre che per l'app Android). **Fai sempre un backup di `vault_v2/` e conserva separatamente Keyfile JSON, Recovery Code e Passphrase** ([dettagli](#dati-e-backup)).

## Indice

- [Funzionalità](#funzionalità)
- [Avvio rapido](#avvio-rapido)
- [Server nativo Rust](#server-nativo-rust)
- [Configurazione](#configurazione)
- [App Android](#app-android)
- [Deploy dietro reverse proxy](#deploy-dietro-reverse-proxy)
- [Aggiornamento](#aggiornamento)
- [Dati e backup](#dati-e-backup)
- [Sicurezza](#sicurezza)
- [Comandi npm](#comandi-npm)
- [Struttura del progetto](#struttura-del-progetto)
- [Test e CI](#test-e-ci)
- [Cronologia delle versioni](#cronologia-delle-versioni)

## Funzionalità

Salvo dove indicato, le funzionalità sono disponibili sia nella web app (`/v2`) sia nell'app Android, interamente in modalità Zero-Knowledge End-to-End.

### Crittografia Zero-Knowledge End-to-End (`PCZK v1`)

- **Derivazione chiavi client-side**: Argon2id (`m = 64 MiB`, `t = 3`, `p = 1`) combinato con una **Account Key casuale a 256 bit** (esportata come Keyfile JSON e Recovery Code esadecimale). La passphrase non viene mai salvata nel Keyfile né inviata al server.
- **Formato blob autenticato `PCZK v1`**: cifratura streaming AES-256-GCM a chunk da 1 MiB con nonce deterministico derivato per chunk, AAD vincolato a `(userId, blobId, chunkIndex, finalFlag)` e random-access decryption per seek video senza caricare l'intero file in RAM.
- **Metadati, miniature e album cifrati**: nomi file, MIME, date EXIF, dimensioni, miniature e catalogo album (`PUT /api/v2/albums` con concorrenza ottimistica `If-Match` e merge automatico su `412`) sono cifrati sul client con `metaKey` / `thumbKey`.
- **Streaming video E2EE via Service Worker**: `/v2/sw-stream.js` (scope `/v2`) decifra i chunk video al volo rispondendo a richieste HTTP Range `206` con `Cache-Control: no-store` e ticket legati a `(blobId, clientId)`, senza mai scrivere testo in chiaro su disco o in Cache Storage.
- **Sicurezza & Chiavi + Cambio Passphrase (Rewrap)**: scheda dedicata in `/v2` con stato crittografico live, statistiche storage cifrate e cambio passphrase **zero-knowledge** (`POST /api/v2/account/rewrap`): ricalcola Argon2id con nuovo salt, ri-cifra la Vault Key lato client senza ricifrare i file, revoca le altre sessioni e scarica il Keyfile JSON aggiornato.
- **Condivisione pubblica E2EE senza cookie**: URL nel formato `/v2/share/<shareId>#<shareKey>` dove la chiave 256-bit resta nel `#fragment` (mai inviata al server), con `shareManifest` cifrato, password opzionale derivata con Argon2id e revoca immediata.
- **Auto-Lock e zeroizzazione RAM**: blocco automatico dopo 15 minuti di inattività (o su comando manuale **Blocca Vault** / **Esci**) con azzeramento dei buffer sensibili in memoria.
- **Nessuna modalità server-side**: i server Node.js e Rust non dispongono di primitive di cifratura simmetrica e rifiutano tutte le vecchie rotte v1 con `410 Gone` (`SERVER_SIDE_ENCRYPTION_REMOVED`).

### Archivio e galleria

- **Griglia raggruppata client-side** per giorno/mese e vista **Album Cifrati** dedicata, con decifratura on-demand delle miniature.
- **Selezione multipla** per azioni batch (sposta in album cifrati, esporta ZIP decifrato sul client, sposta nel cestino, condividi).
- **Ricerca locale sui metadati decifrati** in italiano e inglese (es. nome file, periodo, tipologia di media) senza mai esporre termini di ricerca al server.
- **Cestino** con ripristino, eliminazione definitiva e svuotamento automatico dopo 30 giorni; **esportazione ZIP** generata in streaming direttamente sul client.
- **Deduplica blind Zero-Knowledge**: `dedupTag` calcolato con HMAC-SHA256 lato client usando `dedupKey` derivata dalla Vault Key (`POST /api/v2/backup/check`), evitando upload duplicati senza rivelare al server l'hash del file in chiaro.
- **Dati EXIF e metadati**: estratti e cifrati lato client in `encMeta` (con rimozione opzionale del GPS).

### File manager cloud e visualizzatori integrati (decifrati sul client)

PhotoCloud gestisce qualsiasi tipo di file, non solo foto e video. La decifratura e il parsing dell'anteprima avvengono **interamente nel browser o sul dispositivo Android** (il server invia solo ciphertext `PCZK v1`). Per i formati non renderizzabili inline è disponibile **Apri con…** (Android `FileProvider` con pulizia immediata al blocco/uscita) o il download decifrato locale.

| Categoria | Formati | Visualizzatore (client-side) |
| --- | --- | --- |
| PDF | `.pdf` | Android: rendering nativo (`PdfRenderer`), zoom 75–300% e scorrimento continuo. Web: viewer inline decifrato lato client. |
| Word e testo formattato | `.doc` `.docx` `.odt` `.rtf` | Estrazione testo, titoli, paragrafi e liste in vista pagina (parsing `.docx` lato client con JSZip). |
| Fogli di calcolo | `.xls` `.xlsx` `.ods` `.csv` `.tsv` | Anteprima tabellare multi-foglio e download decifrato integrale. |
| Presentazioni | `.ppt` `.pptx` `.odp` | Visualizzazione slide e note estratte localmente o apertura esterna. |
| Testo e codice | `.txt` `.md` `.json` `.xml` `.yaml` `.html` `.css` `.js` `.ts` `.py` `.kt` `.java` `.c` `.cpp` `.sql` `.sh` `.log` `.ini` … | Vista monospace con copia rapida del testo decifrato. |
| Immagini | `.png` `.jpg` `.jpeg` `.webp` `.gif` `.svg` `.bmp` `.avif` | Lightbox a schermo intero, metadati decifrati ed editor foto E2EE. |
| Audio e video | `.mp3` `.wav` `.ogg` `.m4a` `.flac` `.aac` `.mp4` `.webm` `.mov` `.mkv` | Player integrato con streaming HTTP Range (`206`) e decifratura on-the-fly via Service Worker / `DataSource`. |
| Archivi e pacchetti | `.apk` `.zip` `.rar` `.7z` `.iso` `.dmg` `.exe` … | **Apri con…** (app esterna su Android) oppure download decifrato. |

### Lightbox ed editor foto e video

- **Lightbox**: pinch-to-zoom, zoom con rotellina, navigazione laterale, metadati decifrati e assegnazione diretta agli **Album Cifrati**.
- **Player video E2EE**: scrub bar e seek casuale grazie ai chunk AES-256-GCM da 1 MiB + HTTP Range `206`.
- **Editor foto E2EE**: modifica lato client (rotazione, filtri, ritaglio e regolazioni) con salvataggio cifrato End-to-End (sovrascrittura con incremento versione tramite `POST /api/v2/items/:id/replace` oppure **Salva come Copia E2EE**) senza mai trasmettere immagini in chiaro al server.

### Condivisione

- **Link pubblici E2EE (`/v2/share/<shareId>#<shareKey>`)**: la chiave 256-bit resta nel `#fragment` URL (mai trasmessa nelle richieste HTTP), con `shareManifest` cifrato, password opzionale protetta con Argon2id, scadenza e revoca istantanea senza cookie.
- **Notifiche push** tramite Web Push (VAPID) autenticate tramite sessione v2 *(solo web)*.

### Trasferimenti

- **Streaming a memoria costante** (testato anche oltre 300 MiB): cifratura/decifratura chunked da 1 MiB con upload resumable (`init` / `PUT chunk` / `complete` / `DELETE` abort) e verifica integrità SHA-256 del ciphertext.
- **Pausa, ripresa e annullamento** dei trasferimenti con pulizia immediata dei file temporanei lato server (`DELETE /api/v2/blobs/upload/:uploadId`).
- **Scelta file singoli o esportazione ZIP E2EE** e trasferimenti paralleli configurabili.
- **HTTP Range** (RFC 9110) per streaming video, PDF e ripresa dei download sui blob cifrati `PCZK v1`.

### Cache miniature cifrata

- Le miniature vengono generate e cifrate **sul client** (WebCanvas / Android) con `thumbKey` (AES-256-GCM) prima del caricamento su `/api/v2/blobs/:id/thumbs/:variant`; il server memorizza esclusivamente blob cifrati opachi e non decodifica mai immagini.
- Su Android la cache su disco (`zk_thumbs_enc/`) conserva solo miniature cifrate e la cache RAM viene azzerata immediatamente al blocco o in background.

### Solo Android

- **Vault Zero-Knowledge nativo (unica modalità attiva)**
  - Implementazione completa in Kotlin (`com.valerio.photocloud.zk.*`): Argon2id tramite BouncyCastle, cifratura/decifratura chunked `PCZK v1` (interoperabile byte-per-byte con Web e Rust), `VaultKeyStore` con Android KeyStore hardware-backed, **TOFU SPKI certificate pinning** (`TofuSpkiPinning`) e gestione cookie/CSRF dedicata.
- **Backup automatico cifrato della Camera Roll (`ZkAutoBackupWorker`)**
  - Worker dedicata basata su WorkManager con pianificazione periodica (15 minuti), trigger immediato (`ContentUriTrigger`) e servizio foreground `dataSync` con azioni **Pausa** e **Annulla**.
  - Sblocca la Vault Key tramite chiave dedicata Android KeyStore (`photocloud_vk_bg_v2` con `setUnlockedDeviceRequired(true)`), cifra ogni foto/video localmente prima dell'upload e azzera tutte le chiavi in RAM nel blocco `finally`.
  - Impostazioni granulari: cartelle MediaStore (`Camera` predefinita), foto/video, solo nuovi elementi o intera libreria, vincoli Wi-Fi/ricarica/risparmio energetico, rimozione GPS predefinita (`includeGps = false`) e deduplica blind `dedupTag`.
- **Categorizzazione AI on-device (facoltativa)**
  - Modello EfficientNet-Lite4 tramite MediaPipe (GPU con fallback automatico CPU): le foto non lasciano mai il dispositivo.
  - Il file `.tflite` (~24 MB) si scarica on-demand dalle Impostazioni con supporto HTTP Range, pausa/ripresa e verifica SHA-256.
- **Protezione del dispositivo**: sblocco biometrico forte (`BIOMETRIC_STRONG` + `CryptoObject`) con blocco automatico in background e `FLAG_SECURE` contro gli screenshot.
- **Aggiornamenti in-app**: controllo automatico sulle GitHub Releases (con fallback su `/api/android/update-manifest`), download con progresso, verifica SHA-256, controllo certificato X.509 e verifica `versionCode` crescente prima dell'installazione.

### Solo web

- **PWA installabile** (service worker `/v2/sw-stream.js` e manifest PWA) e notifiche Web Push (VAPID).
- **API Android Release Studio**: endpoint autenticati via sessione v2 per scaricare l'APK firmato e generare/esportare il progetto Android Studio già configurato per il proprio server (`/v2` e cifratura AES-256-GCM).

## Avvio rapido

**Requisiti:** [Node.js](https://nodejs.org) 22.13+ LTS (`>= 22.13.0`, richiesto da Vite 8 e dal modulo nativo `node:sqlite` usato dal vault Zero-Knowledge v2) e Git.

### Con gli script interattivi

`photocloud.bat` (Windows 10/11) e `photocloud.sh` (Linux e macOS) verificano la presenza di Git e Node.js (installandoli se necessario via `winget`, `brew`, `apt`, `dnf` o `pacman`) e offrono un menu guidato per avviare il server in sviluppo o produzione, aggiornare l'installazione e gestire le build.

```bash
./photocloud.sh        # Linux / macOS (se necessario: chmod +x photocloud.sh)
```

```bat
photocloud.bat         :: Windows (doppio clic, oppure da Prompt dei comandi / PowerShell)
```

> [!NOTE]
> Su alcune distribuzioni Linux il pacchetto Node.js di sistema può essere inferiore alla 22.13. In quel caso installa Node 22 LTS con [nvm](https://github.com/nvm-sh/nvm) o dal sito ufficiale.

### Manualmente

```bash
git clone https://github.com/ValerioMassimoDeCecco/PhotoCloud.git
cd PhotoCloud
npm install
npm run dev
```

Apri **`http://localhost:3000`** (reindirizza automaticamente a **`/v2`**).

Per la modalità produzione:

```bash
npm run build
npm start
```

Per cambiare porta: `PORT=8080 npm start` (PowerShell: `$env:PORT=8080; npm start`).

Per installare i prerequisiti a mano:

| Sistema | Comandi |
| --- | --- |
| Windows | `winget install --id OpenJS.NodeJS.LTS -e` e `winget install --id Git.Git -e` |
| macOS | `brew install node git` |
| Linux | Node.js 22.13+ da [nodejs.org](https://nodejs.org/en/download) oppure `nvm install 22`; Git dal gestore pacchetti (es. `sudo apt install -y git build-essential`) |

### Primo accesso

1. Al primo avvio con database `vault_v2` vuoto, il server stampa una sola volta su console un **setup token monouso** (`[PhotoCloud v2 Setup] First-registration single-use setup token (printed once): ...`).
2. Apri **`/v2`**, seleziona **Registrati**, inserisci username, setup token e una **Passphrase** robusta (>= 12 caratteri).
3. Conferma il **Recovery Code** (Account Key 256-bit) e scarica il **Keyfile JSON** (`photocloud_v2_key_<username>.json`).
4. **Attenzione**: il Keyfile contiene solo la Account Key e **non sostituisce mai la Passphrase**. Essendo un vault 100% Zero-Knowledge, il server non può in alcun modo recuperare né resettare passphrase o chiavi perse.

### Collegare lo smartphone

Sulla stessa rete Wi-Fi individua l'IPv4 del server (`ipconfig` su Windows, `ipconfig getifaddr en0` su macOS, `hostname -I` su Linux) e configura l'URL nell'app Android. Per l'uso fuori casa — e obbligatoriamente per `/v2` su browser non locali — pubblica PhotoCloud su **HTTPS** ([vedi sotto](#deploy-dietro-reverse-proxy)).

## Server nativo Rust

PhotoCloud include un backend standalone nativo in **Rust** (`rust/app/`), basato su [Axum](https://github.com/tokio-rs/axum) e [Tokio](https://tokio.rs), progettato fin dal `Cargo.toml` per essere **100% Zero-Knowledge**.

### Caratteristiche principali

- **Garanzia a tempo di compilazione (Zero Cipher Crates)**: `rust/app/Cargo.toml` **non include alcun crate di cifratura simmetrica o decodifica immagini** (nessun `aes`, `aes-gcm`, `cfb-mode`, `pbkdf2`, `hkdf` o `image`). Il binario compilato è fisicamente incapace di cifrare o decifrare i file degli utenti.
- **Parità completa Zero-Knowledge (`/v2`, `/api/v2/*`)**: registrazione con setup token, login/sessioni SQLite tramite `rusqlite`, upload chunked con `DELETE /api/v2/blobs/upload/{uploadId}`, catalogo album cifrato con `If-Match`/`412`, condivisioni E2EE `#fragment`, rewrap passphrase, streaming Range RFC 9110, Android update-manifest e streaming TFLite con Range.
- **Zero dipendenze Node.js a runtime**: il binario compilato (`rust/app/target/release/server` su Linux/macOS, `server.exe` su Windows) è completamente autonomo e riduce drasticamente l'impronta di memoria.
- **Fail-closed sulle vecchie rotte v1**: `/`, `/login`, `/trash`, `/map` reindirizzano a `/v2`; ogni altra rotta legacy v1 risponde `410 Gone` (`SERVER_SIDE_ENCRYPTION_REMOVED`).

### Compilazione ed esecuzione

Per compilare la versione release ottimizzata (richiede la toolchain Rust/`cargo`):

```bash
npm run build:rust
# oppure: cargo build --release --manifest-path rust/app/Cargo.toml
```

Per avviare il server nativo Rust (porta predefinita `3000`):

```bash
npm run start:rust
# oppure: ./rust/app/target/release/server
```

Con porta personalizzata:

```bash
PORT=8080 npm run start:rust
# PowerShell:
$env:PORT=8080; npm run start:rust
```

Per eseguire i test del backend Rust:

```bash
cargo test --manifest-path rust/app/Cargo.toml
npm run test:rust
```

## Configurazione

Il server legge la configurazione dalle **variabili d'ambiente del processo** e **non carica automaticamente un file `.env`**. Impostale nella shell, nel servizio `systemd` o nel container, ad esempio:

```bash
PORT=3000 TRUST_PROXY=1 MAX_UPLOAD_MB=4096 npm start
```

`.env.example` elenca il modello completo delle variabili supportate.

| Variabile | Predefinito | Descrizione |
| --- | --- | --- |
| `PORT` | `3000` | Porta HTTP del server (Node.js e Rust). |
| `VAULT_V2_DIR` | `vault_v2` | Cartella del vault Zero-Knowledge (`index.sqlite`, `.server-secret` per fake salt anti-enumerazione e blob cifrati). Supporta filesystem/volumi separati da `TEMP_UPLOAD_DIR` con commit atomico cross-device. |
| `TEMP_UPLOAD_DIR` | `temp_uploads` | Cartella temporanea per i chunk cifrati in transito durante gli upload. |
| `REGISTRATION_ENABLED` | `false` | Se `false`, dopo il primo utente (bootstrap via setup token) blocca le registrazioni pubbliche salvo presenza di `REGISTRATION_INVITE_TOKEN`. |
| `REGISTRATION_INVITE_TOKEN` | *(vuoto)* | Token di invito opzionale per consentire nuove registrazioni su `/api/v2/register` quando `REGISTRATION_ENABLED=false`. |
| `USER_QUOTA_MB` | `10240` | Quota di storage cifrato predefinita per utente nel vault (in MiB, default 10 GiB). |
| `MAX_UPLOAD_MB` | `2048` | Dimensione massima del singolo blob cifrato caricato (valori ammessi `50`–`16384`). |
| `TRUST_PROXY` | `false` | Numero di hop o subnet fidati quando il server è dietro un reverse proxy ([dettagli](#deploy-dietro-reverse-proxy)). |

Le altre variabili in `.env.example` (`GITHUB_TOKEN`, `PHOTOCLOUD_KEYSTORE_*`, `PHOTOCLOUD_KEY_*`, `PHOTOCLOUD_SIGNING_PROPERTIES`) servono esclusivamente per firmare e pubblicare gli APK Android ([vedi sotto](#compilare-lapk-da-sorgente)).

## App Android

Requisiti del dispositivo: **Android 8.0 o successivo (API 26)**, compilata per **Android 15 (`targetSdk 35`)**. Versione corrente: **`1.5.2` (`versionCode 34`)**.

### Installare l'APK

1. Scarica l'APK firmato dall'[ultima release](https://github.com/ValerioMassimoDeCecco/PhotoCloud/releases/latest) (sorgente ufficiale). La cartella `release/` del repository contiene gli APK firmati, il modello AI `efficientnet_lite4.tflite` servito on-demand e il manifest `photocloud-release-build.json` (versione, `versionCode`, dimensione, changelog e SHA-256).
2. Apri il file `.apk` sullo smartphone (concedendo il permesso di installazione da questa origine). Se è già installata una versione precedente firmata con lo stesso certificato, l'aggiornamento preserva dati e configurazioni.
3. Configura l'URL del tuo server (`https://<dominio>`, oppure `http://<IP>:3000` solo in rete locale in debug) e accedi o registrati direttamente nel **Vault Zero-Knowledge v2** con Keyfile JSON + Passphrase.

Per il backup automatico cifrato sono richiesti i permessi sui media e, da Android 13, il permesso notifiche. Da Android 14 è supportato anche l'accesso parziale («Seleziona foto e video»).

### Compilare l'APK da sorgente

Servono **JDK 17** e **Android SDK 35** (`platforms;android-35`, `build-tools;35.0.0`). Il repository include il **Gradle Wrapper (`8.10.2`)**:

```bash
cd android-app
./gradlew assembleRelease --no-daemon      # Linux / macOS
# gradlew.bat assembleRelease --no-daemon  # Windows
```

I task di release richiedono le credenziali di firma. Nessun keystore o password è committato nel repository (`.gitignore` esclude `*.jks`, `*.keystore` e `signing.properties`). La firma viene risolta su tre livelli:

1. **GitHub Secrets** in CI/CD: `PHOTOCLOUD_KEYSTORE_BASE64`, `PHOTOCLOUD_KEYSTORE_PASSWORD`, `PHOTOCLOUD_KEY_ALIAS`, `PHOTOCLOUD_KEY_PASSWORD`.
2. **Vault privato** (`photocloud-signing-vault`): se i Secrets non sono impostati, `android-release.yml` crea una sola volta una chiave RSA-2048 in una release in bozza protetta da `GITHUB_TOKEN` e la riutilizza per tutte le release successive, verificando la continuità SHA-256 con `apksigner`.
3. **File locale**: `android-app/signing.properties` oppure `~/.photocloud/signing.properties` (generabile o sincronizzabile con `npm run android:signing:setup`).

**Versione unica.** `versionName` e `versionCode` sono definiti unicamente in `android-app/app/build.gradle.kts`; tag `v*`, nome APK e manifest di aggiornamento derivano da lì. `npm run release:check` e la CI bloccano la pubblicazione in caso di disallineamento tra `package.json`, Gradle, APK compilato e `photocloud-release-build.json`.

**Pubblicazione.** Non esistono endpoint HTTP di pubblicazione: usa `npm run release:apk` (richiede `GITHUB_TOKEN` con scope `repo`) oppure il workflow GitHub Actions `android-release.yml`.

## Deploy dietro reverse proxy

Quando PhotoCloud è esposto in HTTPS tramite reverse proxy (Nginx, Caddy, Traefik, Cloudflare Tunnel, Cloud Run…), imposta `TRUST_PROXY` e inoltra correttamente gli header HTTP. **HTTPS è obbligatorio** per usare il Vault Zero-Knowledge `/v2` da domini remoti o IP LAN (WebCrypto `crypto.subtle` e cookie `Secure` richiedono un Secure Context).

### `TRUST_PROXY`

| Valore | Effetto |
| --- | --- |
| non impostato, `0` o `false` (predefinito) | Gli header `X-Forwarded-*` sono ignorati e `Origin` viene confrontato solo con `Host`. |
| intero da `1` a `64` (es. `1`) | Numero di hop proxy fidati davanti al server. `req.ip` viene estratto dall'ultimo hop non fidato impedendo lo spoofing di `X-Forwarded-For` nei rate limiter. |
| lista di IP, subnet CIDR (IPv4/IPv6) o preset Express (`loopback`, `linklocal`, `uniquelocal`) | Esempi: `127.0.0.1,10.0.0.0/8` oppure `loopback,uniquelocal`. |
| `true` | **Rifiutato**: il server stampa un warning e mantiene `trust proxy` disabilitato per evitare bypass dei rate limiter. |

> [!WARNING]
> Senza `TRUST_PROXY` configurato dietro reverse proxy, tutte le richieste risultano provenire dall'IP del proxy (es. `127.0.0.1`), causando falsi `429` nei rate limiter e possibili `403` CSRF se `Origin` è `https://` mentre la connessione interna è `http://`.

### Cosa deve fare il proxy

- **`Host` / `X-Forwarded-Host`**: conservare hostname pubblico ed eventuale porta per il controllo CSRF su `POST`, `PUT`, `DELETE`, `PATCH`.
- **`X-Forwarded-Proto`**: impostare il protocollo esterno reale (`$scheme` in Nginx). Necessario anche per il controllo HTTPS obbligatorio delle API `/api/v2/*`.

### Esempio minimo con Nginx

```nginx
server {
    listen 443 ssl;
    server_name cloud.example.com;
    # configura qui ssl_certificate e ssl_certificate_key

    client_max_body_size 0;   # il limite reale è gestito da MAX_UPLOAD_MB

    location / {
        proxy_pass http://127.0.0.1:3000;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_set_header X-Forwarded-Host $host;
        proxy_set_header X-Forwarded-Port $server_port;
    }
}
```

Avvio dietro un singolo Nginx locale (1 hop):

```bash
TRUST_PROXY=1 PORT=3000 npm start
# oppure con il server nativo Rust:
TRUST_PROXY=1 PORT=3000 npm run start:rust
```

## Aggiornamento

Esegui prima un [backup](#dati-e-backup), poi usa l'opzione **3** («Aggiorna la Web App») di `photocloud.bat` / `photocloud.sh`, oppure aggiorna manualmente:

```bash
git pull
npm install
npm run build        # compila il frontend per npm start
npm run build:rust   # opzionale: ricompila il server nativo Rust
```

Riavvia quindi il server (`npm run dev`, `npm start` oppure `npm run start:rust`). Il dettaglio delle novità per versione è in [CHANGELOG.md](CHANGELOG.md).

## Dati e backup

Tutti i dati risiedono nelle cartelle locali della directory da cui avvii il server (o nei percorsi impostati tramite variabili d'ambiente):

| Percorso | Contenuto |
| --- | --- |
| `vault_v2/` *(o `VAULT_V2_DIR`)* | **Vault Zero-Knowledge**: database SQLite `index.sqlite` (utenti, salt, `wrappedVaultKey`, metadati cifrati, sessioni, quote, condivisioni), `.server-secret` (solo per fake salt HMAC anti-enumerazione) e blob/miniature/album cifrati `PCZK v1`. **Non contiene mai plaintext né chiavi in chiaro.** |
| `temp_uploads/` *(o `TEMP_UPLOAD_DIR`)* | File temporanei dei chunk cifrati in transito durante gli upload. Puliti automaticamente al completamento, su abort (`DELETE`) o all'avvio del server. |

Per un backup completo copia **`vault_v2/`** preferibilmente a server fermo. Custodisci **separatamente** il Keyfile JSON (`photocloud_v2_key_<username>.json`), il Recovery Code e la tua **Passphrase**: senza di essi nessun backup Zero-Knowledge può essere decifrato.

## Sicurezza

Le specifiche crittografiche complete e il threat model sono documentati in [`docs/zk-spec.md`](docs/zk-spec.md), [`docs/threat-model.md`](docs/threat-model.md) e [`docs/zk-audit.md`](docs/zk-audit.md).

- **Crittografia esclusivamente Client-Side (Zero-Knowledge E2EE)**:
  - Master KDF client-side **Argon2id** (`64 MiB`, `t = 3`, `p = 1`) con *KDF parameter floor* verificato dal client prima dell'esecuzione (rifiuto automatico di parametri deboli).
  - Separazione dei domini tramite **HKDF-SHA256** (`KEK`, `AuthSecret`, `MetaKey`, `ThumbKey`, `DedupKey`, `FileKeyWrap`) e **Vault Key 256-bit** casuale avvolta lato client (`wrappedVaultKey`).
  - Formato cifrato streaming **`PCZK v1`** (AES-256-GCM a chunk da 1 MiB, AAD autenticato per ogni chunk e flag finale anti-troncamento/riordino/swap).
  - **Zero codice di cifratura lato server**: sia `server.ts` / `zkServerV2.ts` (Node.js) sia `rust/app/` (Rust) non importano né linkano alcuna primitiva AES/CFB/PBKDF2/HKDF. Il server verifica `authSecret` con **scrypt** in tempo costante, usa **HMAC-SHA256** solo per fake salt anti-enumerazione e **SHA-256** solo sull'integrità del ciphertext.
  - Web app `/v2` protetta da **CSP rigoroso** (`script-src 'self' 'wasm-unsafe-eval'`, `style-src 'self'`, zero script/stili inline), `Referrer-Policy: no-referrer` e Service Worker strettamente confinato a `/v2` con `Cache-Control: no-store`.
- **Difesa HTTP e integrità storage**:
  - Sessioni con cookie `HttpOnly; Secure; SameSite=Strict` + token CSRF `X-CSRF-Token`, blocco richieste cross-site (`Origin` / `Sec-Fetch-Site`), rate limiting per IP e per share, header di sicurezza (`X-Content-Type-Options`, `X-Frame-Options`, COOP, `Permissions-Policy`) e nessun `X-Powered-By`.
  - Validazione rigorosa dei percorsi contro path traversal e prototype pollution, scritture atomiche su disco (con fallback sicuro cross-device `EXDEV`).
- **Sicurezza Android**:
  - Android KeyStore per il wrapping locale delle chiavi (`BIOMETRIC_STRONG` + chiave dedicata `setUnlockedDeviceRequired(true)` per il backup in background), **TOFU SPKI certificate pinning** sulle connessioni HTTPS v2, `FLAG_SECURE`, zero keystore nel repository e verifica SHA-256 + certificato X.509 sugli aggiornamenti APK.

## Comandi npm

| Comando | Descrizione |
| --- | --- |
| `npm run dev` | Avvia il server Express Zero-Knowledge + Vite in sviluppo (porta `3000`). |
| `npm run build` | Compila il bundle web di produzione (`vite build`). |
| `npm start` | Avvia il server Node.js Zero-Knowledge in produzione (`node --import tsx server.ts`). |
| `npm run build:rust` | Compila il server nativo Rust Zero-Knowledge in modalità release (`rust/app/Cargo.toml`). |
| `npm run start:rust` | Avvia il binario release del server nativo Rust. |
| `npm run test:rust` | Esegue la suite E2E Zero-Knowledge completa sul binario release Rust (`tests/test_rust_server_e2e.py`). |
| `npm run lint` | Controllo statico dei tipi TypeScript (`tsc --noEmit`). |
| `npm test` | Esegue tutte le suite unit, integrazione e audit crittografico in `src/lib/*.test.ts` (incluso `zkOnlyRepoAudit.test.ts` con spy di rete e canary zero-plaintext su disco). |
| `npm run release:check` | Verifica la coerenza di versione e checksum tra `package.json`, Gradle, APK e `photocloud-release-build.json`. |
| `npm run release:apk` | Esegue `release:check`, compila l'APK firmato e avvia la pubblicazione su GitHub Releases (richiede `GITHUB_TOKEN`). |
| `npm run android:signing:setup` | Crea o sincronizza la configurazione di firma persistente (`~/.photocloud/signing.properties`). |

Per eseguire la suite Playwright end-to-end completa del Vault Zero-Knowledge `/v2` (flussi 1–9: registrazione, keyfile login, upload multi-formato E2EE, Service Worker video Range, photo editor E2EE, export ZIP streaming, cestino, anteprima DOCX/PDF decifrata e share `#fragment`):

```bash
bash scripts/run-v2-playwright-e2e.sh
```

## Struttura del progetto

```
PhotoCloud/
├── server.ts                         # Server Express 100% Zero-Knowledge (/v2, /api/v2/*, 410 Gone su rotte v1, PWA e Android)
├── rust/
│   ├── app/                          # Backend standalone nativo Rust 100% Zero-Knowledge (Axum + Tokio + rusqlite, zero crate AES)
│   │   ├── Cargo.toml
│   │   └── src/
│   │       ├── main.rs               # Entry point, runtime Tokio, cleanup periodico, graceful shutdown
│   │       ├── state.rs              # AppState minimale (temp_dir, vault_v2, .server-secret per fake salt)
│   │       ├── zk_v2_store.rs        # Store SQLite vault_v2, scrypt, Range RFC 9110, I/O atomico cross-FS
│   │       └── units/                # Router Axum modulari (zk_v2.rs, android.rs, push.rs, common.rs, mod.rs)
│   └── app-cases/                    # Archivi di riferimento HTTP
├── src/
│   ├── App.tsx, main.tsx             # Entry point React (redirect incondizionato a /v2)
│   ├── client/
│   │   ├── zk-sdk/                   # SDK Zero-Knowledge client-side (ZkVaultClient, WebCrypto/Argon2id, streaming)
│   │   └── v2-app/                   # Web app Zero-Knowledge /v2 (main.ts, router.ts, album cifrati, sicurezza & rewrap, share)
│   ├── lib/                          # Logica condivisa/server ZK e suite di test *.test.ts
│   │   ├── zk/                       # Primitive crittografiche client-side (Argon2id, HKDF, PCZK v1 chunked AEAD, zeroization)
│   │   ├── zkServerV2.ts             # Router Express & store SQLite Zero-Knowledge /api/v2/*
│   │   ├── zkOnlyRepoAudit.test.ts   # Audit statico zero-cifrari lato server + prova canary wire & disco
│   │   ├── nlSearch.ts, photoEditorMath.ts, pushService.ts, trustProxy.ts, vaultStorage.ts
│   │   └── androidBuilder.ts, githubReleasePublisher.ts, persistentSigning.ts
│   └── types.ts                      # Tipi condivisi
├── public/
│   ├── v2/                           # Bundle compilato app.js, app.css e Service Worker streaming sw-stream.js
│   └── manifest.webmanifest, service-worker.js, register-pwa.js, icone PWA
├── android-app/                      # App Android nativa 100% Zero-Knowledge (Kotlin + Jetpack Compose + Gradle Wrapper 8.10.2)
│   └── app/src/main/java/com/valerio/photocloud/
│       ├── zk/                       # Client ZK v2 nativo: ZkCoreCrypto, ZkArgon2id, VaultKeyStore, TofuSpkiPinning,
│       │                             # PhotoCloudZkApiClientV2, ZkBlobUploadPipeline, ZkAutoBackupWorker, ZkV2AuthScreen, ZkV2VaultScreen…
│       ├── MainActivity.kt           # Entry point UI nativa (esclusivamente ZkV2AuthCoordinator)
│       ├── AutoBackupLogic.kt        # Filtri locali MediaStore usati da ZkAutoBackupWorker
│       ├── LocalPhotoCategorizer.kt, PhotoAiDatabase.kt, PhotoAiIndexingWorker.kt, AiModelDownloadManager.kt
│       ├── NaturalLanguageSearchEngine.kt, AndroidMediaEditorEngine.kt, GalleryDragSelectionController.kt
│       └── AppAutoUpdater.kt, LiquidGlassDesignSystem.kt
├── docs/                             # Specifiche crittografiche (zk-spec.md, threat-model.md, zk-audit.md, piani web/Android)
├── test-vectors/                     # Vettori di test e fixture di interoperabilità Web / Rust / Python / Kotlin
├── tests/
│   └── test_rust_server_e2e.py       # Suite E2E Zero-Knowledge per il server Rust (13 suite)
├── scripts/                          # run-v2-playwright-e2e.sh, e2e-v2-playwright.mjs, check-release-gate, publish-github-release…
├── release/                          # APK firmati, modello AI on-demand, manifest di aggiornamento
├── audit/                            # Report di audit e smoke test
├── .github/workflows/                # android-ci.yml, android-release.yml
├── photocloud.bat, photocloud.sh     # Script interattivi per Windows e Linux/macOS
└── .env.example, CHANGELOG.md, package.json, vite.config.ts, tsconfig.json
```

## Test e CI

- **`npm test`**: esegue tutte le suite unit, di integrazione e audit Zero-Knowledge Node/TypeScript (`zkCrypto.test.ts`, `serverV2.test.ts`, `zkWebSdk.test.ts`, `zkOnlyRepoAudit.test.ts`, `nlSearch.test.ts`, `trustProxy.test.ts`): verifica statica che nessun file server Node o Rust contenga cifrari simmetrici, prova live wire+disco con stringhe canary, `PCZK v1` >300 MiB, test negativi AEAD, API `/api/v2/*` incluso abort upload e cross-user isolation, e `410 Gone` su tutte le rotte v1 rimosse.
- **`npm run lint` & `npm run build`**: verifica statica TypeScript (`tsc --noEmit`) e build di produzione Vite.
- **`cargo test` & `npm run test:rust`**: unit test Rust + 13 suite E2E sul binario release Rust Zero-Knowledge (inclusa verifica assenza crate AES in `Cargo.toml`, redirect `/ -> /v2`, `410 Gone` su v1, upload/Range/abort, album `If-Match`/`412`, share `#fragment`, rewrap passphrase e zero file v1 su disco).
- **`bash scripts/run-v2-playwright-e2e.sh`**: 9 flussi browser reali Playwright end-to-end su `/v2` (verificati sia sul server Node.js sia sul binario release Rust).
- **`android-ci.yml`**: verifica la compilazione Kotlin di release su ogni push o pull request che modifica `android-app/**` o i workflow Android.
- **`android-release.yml`**: compila, firma e pubblica l'APK su GitHub Releases (JDK 17, Android SDK 35, Gradle 8.10.2), verificando corrispondenza versione/tag/APK e continuità del certificato di firma.

## Cronologia delle versioni

Il dettaglio completo delle modifiche è in [CHANGELOG.md](CHANGELOG.md); gli APK installabili sono nelle [Releases](https://github.com/ValerioMassimoDeCecco/PhotoCloud/releases). In sintesi:

| Serie | Novità principali |
| --- | --- |
| 1.5 + ZK-Only | **Architettura 100% Zero-Knowledge End-to-End** su Node.js, Rust (Axum + `rusqlite`, zero crate AES) e Android Kotlin (Argon2id, `PCZK v1`, album cifrati, Passphrase Rewrap, share `#fragment`, Service Worker Range, backup automatico cifrato Camera Roll): **rimossa definitivamente la modalità v1 con cifratura lato server** in tutto il repository (`410 Gone` su endpoint legacy). |
| 1.4 | Preferiti, Ricordi, ricerca in linguaggio naturale, link pubblici, album condivisi, notifiche push, deduplica e dati EXIF. |
| 1.3 | Rafforzamento sicurezza, upload e ZIP su disco, crittografia asincrona (1.3.0); lightbox ed editor foto/video riscritti (1.3.1); pinch-to-zoom ancorato al punto focale (1.3.2). |
| 1.2 | AI on-device (1.2.0); selezione a trascinamento con auto-scroll (1.2.2, 1.2.4); modello AI facoltativo e aggiornamenti in-app (1.2.3); sicurezza (1.2.5); fix ciclo aggiornamenti (1.2.6); indicatore spazio cloud (1.2.7); caricamenti massivi e trasferimenti paralleli (1.2.8); pausa trasferimenti e scelta file singoli / ZIP (1.2.9). |
| 1.1 | Galleria sempre montata ed editor a bassa latenza (1.1.1); anteprime video e fix selezione (1.1.2); controlli player video (1.1.3); drag-to-select e gesti lightbox (1.1.5). |
| 1.0 | Prime release: indicatore trasferimenti, apertura intelligente file e visualizzatore documenti integrato. |
