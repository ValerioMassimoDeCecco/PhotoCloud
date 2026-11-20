# PhotoCloud

**Archivio self-hosted con crittografia Zero-Knowledge End-to-End (v2) per foto, video e documenti, web app (PWA), backend alternativo in Rust e app Android nativa.**

[![Versione](https://img.shields.io/github/package-json/v/ValerioMassimoDeCecco/PhotoCloud?label=versione)](CHANGELOG.md)
[![Node.js](https://img.shields.io/badge/Node.js-22.13%2B%20LTS-339933?logo=nodedotjs&logoColor=white)](https://nodejs.org)
[![Rust](https://img.shields.io/badge/Rust-Axum%20%2B%20Tokio-DEA584?logo=rust&logoColor=white)](#server-nativo-rust)
[![Android](https://img.shields.io/badge/Android-8.0%2B-3DDC84?logo=android&logoColor=white)](#app-android)
[![Kotlin](https://img.shields.io/badge/Kotlin-Jetpack%20Compose-7F52FF?logo=kotlin&logoColor=white)](android-app)

PhotoCloud conserva sul tuo server foto, video, documenti Office/PDF e qualsiasi altro file (ZIP, APK, audio, codice…), li protegge con crittografia autenticata e li rende consultabili da browser o da smartphone. Il progetto è composto da tre componenti principali:

| Componente | Descrizione | Tecnologie |
| --- | --- | --- |
| **Server e web app (Node.js)** | Backend principale con **Vault Zero-Knowledge E2EE (`/v2`, `/api/v2/*`)**, web app classica PWA (`/`) retrocompatibile con i vault v1 e supporto al formato crittografico storico. | Node.js 22.13+ (`node:sqlite`), Express 5, TypeScript, React 19, Vite 8, Tailwind CSS 4, `hash-wasm` (Argon2id) |
| **Server nativo Rust** | Backend standalone ad alte prestazioni senza dipendenze Node.js a runtime, compatibile al 100% con il vault **Zero-Knowledge v2** (`/v2`, `/api/v2/*`, `vault_v2.db`), il formato v1 e tutte le API web/Android. | Rust, Axum, Tokio, `rusqlite`, AES-256-GCM, HKDF, Argon2id/scrypt, PBKDF2 |
| **App Android** (`com.valerio.photocloud`) | Client nativo Material 3 / Liquid Glass. Le nuove installazioni usano di default il **Vault Zero-Knowledge v2** (Argon2id + AES-256-GCM + Android KeyStore + TOFU pinning), con retrocompatibilità per le sessioni v1, backup automatico della Camera Roll, AI on-device facoltativa e aggiornamenti in-app. | Kotlin, Jetpack Compose (Material 3), BouncyCastle (Argon2id), OkHttp, Room, WorkManager, MediaPipe. `minSdk 26`, `targetSdk 35` |

> [!IMPORTANT]
> **Due modalità di crittografia disponibili:**
> - **PhotoCloud v2 (`/v2` — Zero-Knowledge End-to-End, consigliata)**: file, miniature, metadati, nomi file, album e link pubblici (`#fragment`) sono cifrati **esclusivamente sul client** prima di lasciare il dispositivo (Argon2id + Account Key 256-bit + HKDF-SHA256 + AES-256-GCM chunked `PCZK v1`). Il server non vede mai passphrase, chiavi o contenuti in chiaro.
> - **PhotoCloud v1 (`/` — modalità classica retrocompatibile)**: la cifratura (AES-256-GCM; lettura legacy AES-256-CFB) avviene **sul server**, che elabora i contenuti in chiaro. Per disabilitare completamente le rotte v1 e forzare solo la modalità Zero-Knowledge imposta `PHOTOCLOUD_ZK_ONLY=true`.
>
> Pubblica sempre PhotoCloud su **HTTPS** (obbligatorio fuori da `localhost` per WebCrypto e cookie `Secure` delle API `/api/v2/*`, oltre che per l'app Android). **Fai sempre un backup prima di aggiornare** ([come](#dati-e-backup)).

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

Salvo dove indicato, le funzionalità sono disponibili sia nella web app sia nell'app Android.

### Crittografia Zero-Knowledge v2 (E2EE)

Disponibile sul web all'indirizzo **`/v2`** (raggiungibile direttamente anche dalla schermata di accesso e dalla barra di navigazione di `/`) e attiva di default sulle nuove installazioni Android:

- **Derivazione chiavi client-side**: Argon2id (`m = 64 MiB`, `t = 3`, `p = 1`) combinato con una **Account Key casuale a 256 bit** (esportata come Keyfile JSON e Recovery Code esadecimale). La passphrase non viene mai salvata nel Keyfile né inviata al server.
- **Formato blob autenticato `PCZK v1`**: cifratura streaming AES-256-GCM a chunk da 1 MiB con nonce deterministico derivato per chunk, AAD vincolato a `(userId, blobId, chunkIndex, finalFlag)` e random-access decryption per seek video senza caricare l'intero file in RAM.
- **Metadati, miniature e album cifrati**: nomi file, MIME, date EXIF, dimensioni, miniature e catalogo album (`PUT /api/v2/albums` con concorrenza ottimistica `If-Match` e merge automatico su `412`) sono cifrati sul client con `metaKey` / `thumbKey`.
- **Streaming video E2EE via Service Worker**: `/v2/sw-stream.js` (scope `/v2`) decifra i chunk video al volo rispondendo a richieste HTTP Range `206` con `Cache-Control: no-store` e ticket legati a `(blobId, clientId)`, senza mai scrivere testo in chiaro su disco o in Cache Storage.
- **Sicurezza & Chiavi + Cambio Passphrase (Rewrap)**: scheda dedicata in `/v2` con stato crittografico live, statistiche storage cifrate e cambio passphrase **zero-knowledge** (`POST /api/v2/account/rewrap`): ricalcola Argon2id con nuovo salt, ri-cifra la Vault Key lato client senza ricifrare i file, revoca le altre sessioni e scarica il Keyfile JSON aggiornato.
- **Condivisione pubblica E2EE senza cookie**: URL nel formato `/v2/share/<shareId>#<shareKey>` dove la chiave 256-bit resta nel `#fragment` (mai inviata al server), con `shareManifest` cifrato, password opzionale derivata con Argon2id e revoca immediata.
- **Auto-Lock e zeroizzazione RAM**: blocco automatico dopo 15 minuti di inattività (o su comando manuale **Blocca Vault** / **Esci**) con azzeramento dei buffer sensibili in memoria.
- **Modalità ZK esclusiva (`PHOTOCLOUD_ZK_ONLY=true`)**: opzione lato server (Node e Rust) che reindirizza `/` verso `/v2` e risponde `410 Gone` (`LEGACY_V1_DISABLED_ZK_ONLY`) su tutti gli endpoint legacy v1.

### Archivio e galleria

- **Griglia raggruppata** per giorno, mese, anno o album (in `/v2` raggruppamento client-side per mese/giorno e vista **Album Cifrati** dedicata).
- **Selezione multipla con trascinamento**: rettangolo di selezione sul web classico, selezione multipla per azioni batch in `/v2`, pressione prolungata e trascinamento con auto-scroll su Android.
- **Timeline scrubbable** stile Google Foto per saltare tra i periodi *(web v1)*.
- **Preferiti** e **Ricordi** («In questo giorno»: i media scattati lo stesso giorno negli anni passati).
- **Ricerca in linguaggio naturale** in italiano e inglese (es. «foto di agosto 2024», «video preferiti», «documenti»). In `/v2` e su Android il motore gira interamente in locale sui metadati decifrati.
- **Cestino** con ripristino ed eliminazione definitiva, **esportazione ZIP** (in `/v2` generazione ZIP in streaming decifrata lato client) e statistiche dello spazio occupato.
- **Ricerca duplicati**: esatti (SHA-256 in v1; `dedupTag` HMAC blind in v2 senza esporre l'hash del plaintext al server) e quasi identici (perceptual hash pHash 32×32 DCT-II su v1).
- **Dati EXIF** (fotocamera, data di scatto, apertura, ISO, esposizione, focale, GPS) e **mappa delle foto** geolocalizzate (tile OpenStreetMap caricate direttamente dal client).
- Due temi grafici: **Originale (Material You)** e **Liquid Glass**.

### File manager cloud e visualizzatori integrati

PhotoCloud gestisce qualsiasi tipo di file, non solo foto e video. In `/v2` la decifratura e il parsing dell'anteprima avvengono interamente nel browser (o sul dispositivo Android); in v1 il server decifra al volo. Per i formati non renderizzabili inline è disponibile **Apri con…** (Android `FileProvider`) o il download cifrato/decifrato.

| Categoria | Formati | Visualizzatore |
| --- | --- | --- |
| PDF | `.pdf` | Android: rendering nativo (`PdfRenderer`), zoom 75–300% e scorrimento continuo. Web: viewer inline (in `/v2` decifrato client-side) con supporto HTTP Range. |
| Word e testo formattato | `.doc` `.docx` `.odt` `.rtf` | Estrazione testo, titoli, paragrafi e liste in vista pagina (in `/v2` parsing `.docx` lato client con JSZip), ricerca nel testo e zoom. |
| Fogli di calcolo | `.xls` `.xlsx` `.ods` `.csv` `.tsv` | Multi-foglio, intestazioni fisse, filtro righe in tempo reale (anteprima fino a 1.500 righe per foglio). |
| Presentazioni | `.ppt` `.pptx` `.odp` | Slide 16:9, miniature laterali (web), navigazione e note del relatore. |
| Testo e codice | `.txt` `.md` `.json` `.xml` `.yaml` `.html` `.css` `.js` `.ts` `.py` `.kt` `.java` `.c` `.cpp` `.sql` `.sh` `.log` `.ini` … | Monospace con numerazione righe, filtro rapido e copia del testo. |
| Immagini | `.png` `.jpg` `.jpeg` `.webp` `.gif` `.svg` `.bmp` `.avif` | Lightbox a schermo intero, striscia metadati EXIF decifrati ed editor foto. |
| Audio e video | `.mp3` `.wav` `.ogg` `.m4a` `.flac` `.aac` `.mp4` `.webm` `.mov` `.mkv` | Player integrato con streaming HTTP Range (`206`) e decifratura on-the-fly. |
| Archivi e pacchetti | `.apk` `.zip` `.rar` `.7z` `.iso` `.dmg` `.exe` … | **Apri con…** (app esterna) oppure download. |

Limiti noti:

- I formati Office binari legacy (`.doc`, `.xls`, `.ppt` pre-2007) e i file protetti da password mostrano solo il testo estraibile con un avviso; per layout complessi o macro usa **Apri con…**.
- L'anteprima tabellare carica fino a 1.500 righe per foglio per mantenere fluida l'interfaccia; il file originale resta sempre scaricabile integralmente.

### Lightbox ed editor foto e video

- **Lightbox**: pinch-to-zoom, zoom con rotellina (web), doppio tap/clic, pan vincolato, swipe laterale e verso il basso, filmstrip, metadati EXIF e assegnazione diretta agli **Album Cifrati** (in `/v2`).
- **Slideshow** con transizioni (dissolvenza, scorrimento, zoom) e avanzamento automatico a fine video *(web v1)*.
- **Player video** con scrub bar, timecode, salto ±10 s, velocità 0,5×–2×, muto e loop.
- **Editor foto e video**:
  - In **v2 (`/v2`)**: rotazione e modifica lato client con salvataggio cifrato E2EE (sovrascrittura con incremento versione oppure **Salva come Copia E2EE**) senza mai inviare il plaintext al server.
  - In **v1 e Android**: editor non distruttivo con Undo/Redo, confronto con l'originale, filtri (Vivido, Bianco e nero, Seppia, Cinema, Freddo, Vintage), luminosità/contrasto/saturazione/calore, ritaglio 3×3 a 8 maniglie, rotazione/specchio e taglio/velocità/rimozione audio per i video.

### Condivisione

- **Link pubblici E2EE (`/v2/share/<shareId>#<shareKey>`)**: chiave nel fragment URL, `shareManifest` cifrato, password opzionale Argon2id, scadenza e revoca istantanea senza esporre cookie o chiavi al server.
- **Link pubblici v1 (`/share/<token>`)**: token opaco a 48 caratteri esadecimali con scadenza, password opzionale, limite download/visualizzazioni e revoca.
- **Album condivisi v1 tra utenti registrati**, con ruolo *viewer* (sola lettura) o *contributor*.
- **Notifiche push** tramite Web Push (VAPID) per la PWA *(solo web)*.

### Trasferimenti

- **Streaming a memoria costante** (testato anche oltre 300 MiB): in v2 cifratura/decifratura chunked da 1 MiB con upload resumable (`init` / `chunk` / `complete` / `DELETE` abort); in v1 e Android lettura streaming a blocchi (32–64 KB) con upload chunked da 8 MB oltre i 24 MB.
- **Pausa, ripresa e annullamento** dei trasferimenti con pulizia dei file temporanei lato server (`DELETE /api/v2/blobs/upload/:uploadId` in v2).
- **Scelta file singoli o archivio ZIP** e trasferimenti paralleli configurabili (1–16, default 3).
- **Cartelle di download configurabili** (`Pictures/PhotoCloud`, `Movies/PhotoCloud`, `Music/PhotoCloud`, `Download/PhotoCloud` su Android; SAF su Android e File System Access API sul web).
- **HTTP Range** (RFC 9110) per streaming video, PDF e ripresa dei download, sia su blob cifrati v2 sia su media v1.

### Cache miniature cifrata

- **Modalità v2 (E2EE)**: le miniature vengono generate e cifrate **sul client** (WebCanvas / Android) con `thumbKey` (AES-256-GCM) prima del caricamento; il server memorizza esclusivamente blob cifrati opachi.
- **Modalità v1**: il server genera varianti `thumb` (320 px) e `large` (1280 px) JPEG (q=80) cifrate con AES-256-GCM in `user_media/<utente>/.thumbs/`, con `ETag`, `304 Not Modified`, eviction LRU entro `THUMB_CACHE_MAX_MB` e ricostruzione manuale dalle Impostazioni. Su Android è presente una cache LRU locale su disco (`thumb_cache/`, 64–512 MB, default 150 MB).

### Solo Android

- **Vault Zero-Knowledge v2 nativo (predefinito sulle nuove installazioni)**
  - Implementazione completa in Kotlin (`com.valerio.photocloud.zk.*`): Argon2id tramite BouncyCastle, cifratura/decifratura chunked `PCZK v1` (interoperabile byte-per-byte con Web e Rust), `VaultKeyStore` con Android KeyStore hardware-backed, **TOFU SPKI certificate pinning** (`TofuSpkiPinning`) e gestione cookie/CSRF dedicata.
  - Le installazioni con una sessione v1 già attiva mantengono la modalità v1 senza interruzioni, ed è sempre possibile passare tra v2 e v1 dalle Impostazioni.
- **Backup automatico della Camera Roll (v2 e v1)**
  - Worker dedicata per Zero-Knowledge (`ZkAutoBackupWorker`) e per v1 (`AutoBackupWorker`), basate su WorkManager con pianificazione periodica (15 minuti), trigger immediato (`ContentUriTrigger`) e servizio foreground `dataSync` con azioni **Pausa** e **Annulla**.
  - Impostazioni granulari: cartelle MediaStore (`Camera` predefinita), foto/video, solo nuovi elementi o intera libreria, vincoli Wi-Fi/ricarica/risparmio energetico, limite dimensione video e conferma esplicita su URL `http://`.
  - Deduplica blind (`dedupTag` in v2) o SHA-256 (`POST /api/backup/check` in v1) con verifica integrità end-to-end.
- **Categorizzazione AI on-device (facoltativa)**
  - Modello EfficientNet-Lite4 tramite MediaPipe (GPU con fallback automatico CPU): le foto non lasciano mai il dispositivo.
  - Il file `.tflite` (~24 MB) non è incluso nell'APK: si scarica on-demand dalle Impostazioni con supporto HTTP Range, pausa/ripresa, controllo spazio libero (almeno 50 MB) e verifica SHA-256.
  - Indicizzazione in background con WorkManager e Room; chip di filtro in galleria (Animali, Paesaggi, Persone, Cibo, Veicoli, Architettura, Documenti, Tecnologia).
- **Protezione del dispositivo**: sblocco biometrico (`BiometricPrompt`) con blocco automatico in background e `FLAG_SECURE` opzionale contro gli screenshot.
- **Aggiornamenti in-app**: controllo automatico sulle GitHub Releases (con fallback su `/api/android/update-manifest`), download con progresso, verifica SHA-256, controllo certificato X.509 e verifica `versionCode` crescente prima dell'installazione.

### Solo web

- **PWA installabile** (service worker con aggiornamento automatico) e notifiche Web Push (VAPID).
- **Android Release Studio**: area autenticata per scaricare l'APK firmato e generare/esportare il progetto Android Studio già configurato per il proprio server (con default `/v2` e cifratura AES-256-GCM).

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

Apri **`http://localhost:3000/v2`** per il Vault Zero-Knowledge E2EE (oppure `http://localhost:3000/` per l'interfaccia classica, che include il pulsante diretto verso `/v2`).

Per la modalità produzione:

```bash
npm run build
npm start
```

Per forzare **solo** la modalità Zero-Knowledge v2 (disabilitando tutte le rotte legacy v1):

```bash
PHOTOCLOUD_ZK_ONLY=1 PORT=3000 npm start
```

Per cambiare porta: `PORT=8080 npm start` (PowerShell: `$env:PORT=8080; npm start`).

Per installare i prerequisiti a mano:

| Sistema | Comandi |
| --- | --- |
| Windows | `winget install --id OpenJS.NodeJS.LTS -e` e `winget install --id Git.Git -e` |
| macOS | `brew install node git` |
| Linux | Node.js 22.13+ da [nodejs.org](https://nodejs.org/en/download) oppure `nvm install 22`; Git dal gestore pacchetti (es. `sudo apt install -y git build-essential`) |

### Primo accesso

- **Vault Zero-Knowledge v2 (`/v2`, consigliato)**:
  1. Al primo avvio con database `vault_v2` vuoto, il server stampa una sola volta su console un **setup token monouso** (`[PhotoCloud v2 Setup] First-registration single-use setup token (printed once): ...`).
  2. Apri `/v2`, seleziona **Registrati**, inserisci username, setup token e una **Passphrase** robusta (>= 12 caratteri).
  3. Conferma il **Recovery Code** (Account Key 256-bit) e scarica il **Keyfile JSON** (`photocloud_v2_key_<username>.json`).
  4. **Attenzione**: il Keyfile contiene solo la Account Key e **non sostituisce mai la Passphrase**. In modalità Zero-Knowledge il server non può recuperare né resettare passphrase o chiavi perse.
- **Modalità classica v1 (`/`)**:
  - Registra un utente e scarica `photocloud_auth_<username>.json`. Il server conserva solo un hash della chiave: custodisci il file in un luogo sicuro.

### Collegare lo smartphone

Sulla stessa rete Wi-Fi individua l'IPv4 del server (`ipconfig` su Windows, `ipconfig getifaddr en0` su macOS, `hostname -I` su Linux) e configura l'URL nell'app Android. Per l'uso fuori casa — e obbligatoriamente per `/v2` su browser non locali — pubblica PhotoCloud su **HTTPS** ([vedi sotto](#deploy-dietro-reverse-proxy)).

## Server nativo Rust

PhotoCloud include una riscrittura nativa completa del backend in **Rust** (`rust/app/`), basata su [Axum](https://github.com/tokio-rs/axum) e [Tokio](https://tokio.rs).

### Caratteristiche principali

- **Parità completa Zero-Knowledge v2 e v1**: implementa l'intero set di endpoint `/v2` e `/api/v2/*` (inclusi registrazione con setup token, login/sessioni SQLite tramite `rusqlite`, upload chunked con `DELETE /api/v2/blobs/upload/{uploadId}`, catalogo album cifrato con `If-Match`, condivisioni E2EE `#fragment`, rewrap passphrase, streaming Range RFC 9110 e modalità `PHOTOCLOUD_ZK_ONLY=1`), oltre alla piena compatibilità wire e su disco con i vault classici v1 (`PhotoCloud-GCM-v1\0`, PBKDF2-HMAC-SHA256 e lettura legacy AES-256-CFB).
- **Zero dipendenze Node.js a runtime**: il binario compilato (`rust/app/target/release/server` su Linux/macOS, `server.exe` su Windows) è completamente autonomo e riduce drasticamente l'impronta di memoria.
- **Servizio statico integrato**: serve direttamente `/v2` (`public/v2/*` con CSP rigoroso e header `Service-Worker-Allowed: /v2`), la SPA compilata (`dist/`), `static/`, `templates/` e `release/` (APK e modello AI TFLite con Range).
- **Ricerca naturale, EXIF e pHash nativi**: parser semantico IT/EN, estrazione EXIF, deduplica SHA-256 e rilevamento duplicati quasi identici tramite pHash 32×32 DCT-II.
- **Verifica automatizzata completa**:
  - **7/7 unit test Rust** (`cargo test`): crittografia GCM/CFB, tamper detection, Range RFC 9110, validazione UUID v4, SQLite schema v2, scrypt e fake salt deterministico.
  - **18/18 suite E2E Rust (`npm run test:rust`)**: copertura end-to-end di auth, upload cifrati, Range 206/416, condivisioni, `/map`, manifest Android, modello AI TFLite, shell `/v2`, CSRF, `DELETE /api/v2/blobs/upload/{uploadId}` e modalità `PHOTOCLOUD_ZK_ONLY=1`.
  - **Playwright E2E `/v2` (flussi 1–9)**: verificato al 100% anche direttamente contro il binario release Rust con `PHOTOCLOUD_ZK_ONLY=1`.
  - **Replay HTTP (`rust/app-cases/`)**: 155/155 casi di regressione compatibili con Node.js.

### Compilazione ed esecuzione

Per compilare la versione release ottimizzata (richiede la toolchain Rust/`cargo`):

```bash
npm run build:rust
# oppure: cargo build --release --manifest-path rust/app/Cargo.toml
```

Per avviare il server nativo Rust:

```bash
npm run start:rust
# oppure: ./rust/app/target/release/server
```

Con porta personalizzata e modalità Zero-Knowledge esclusiva:

```bash
PORT=8080 PHOTOCLOUD_ZK_ONLY=1 npm run start:rust
# PowerShell:
$env:PORT=8080; $env:PHOTOCLOUD_ZK_ONLY="1"; npm run start:rust
```

Per eseguire i test del backend Rust:

```bash
cargo test --manifest-path rust/app/Cargo.toml
npm run test:rust
```

## Configurazione

Il server legge la configurazione dalle **variabili d'ambiente del processo** e **non carica automaticamente un file `.env`**. Impostale nella shell, nel servizio `systemd` o nel container, ad esempio:

```bash
PORT=3000 TRUST_PROXY=1 PHOTOCLOUD_ZK_ONLY=true MAX_UPLOAD_MB=4096 npm start
```

`.env.example` elenca il modello completo delle variabili supportate.

| Variabile | Predefinito | Descrizione |
| --- | --- | --- |
| `PORT` | `3000` | Porta HTTP del server (Node.js e Rust). |
| `PHOTOCLOUD_ZK_ONLY` | `false` | Se `true` / `1` / `yes`, reindirizza `GET /` a `/v2` e disabilita con `410 Gone` tutte le rotte v1 legacy non-ZK (sia Node sia Rust). |
| `VAULT_V2_DIR` | `vault_v2` | Cartella del vault Zero-Knowledge v2 (`vault_v2.db` e blob cifrati). Supporta anche filesystem/volumi separati da `TEMP_UPLOAD_DIR` con commit atomico cross-device. |
| `TEMP_UPLOAD_DIR` | `temp_uploads` | Cartella temporanea per i chunk in transito durante gli upload. |
| `REGISTRATION_ENABLED` | `false` | Se `false`, dopo il primo utente (bootstrap via setup token) blocca le registrazioni pubbliche salvo presenza di `REGISTRATION_INVITE_TOKEN`. |
| `REGISTRATION_INVITE_TOKEN` | *(vuoto)* | Token di invito opzionale per consentire nuove registrazioni su `/api/v2/register` quando `REGISTRATION_ENABLED=false`. |
| `USER_QUOTA_MB` | `10240` | Quota di storage cifrato predefinita per utente nel vault v2 (in MiB, default 10 GiB). |
| `MAX_UPLOAD_MB` | `2048` | Dimensione massima del singolo file caricato, anche a blocchi (valori ammessi `50`–`16384`). |
| `THUMB_CACHE_MAX_MB` | `512` | Limite su disco per utente della cache miniature cifrata v1. |
| `TRUST_PROXY` | `false` | Numero di hop o subnet fidati quando il server è dietro un reverse proxy ([dettagli](#deploy-dietro-reverse-proxy)). |
| `SHARE_RATE_LIMIT_MAX` | `600` | Richieste al minuto per IP su `/share/*` (minimo `10`). |
| `MAX_JIMP_PREVIEW_QUEUE` | `32` | Lunghezza massima della coda di generazione anteprime Jimp per link pubblici v1. |
| `MAX_JIMP_QUEUE_WAIT_MS` | `10000` | Attesa massima in coda per quelle anteprime, in millisecondi. |

Le altre variabili in `.env.example` (`GITHUB_TOKEN`, `PHOTOCLOUD_KEYSTORE_*`, `PHOTOCLOUD_KEY_*`, `PHOTOCLOUD_SIGNING_PROPERTIES`) servono esclusivamente per firmare e pubblicare gli APK Android ([vedi sotto](#compilare-lapk-da-sorgente)).

## App Android

Requisiti del dispositivo: **Android 8.0 o successivo (API 26)**, compilata per **Android 15 (`targetSdk 35`)**. Versione corrente: **`1.5.1` (`versionCode 33`)**.

### Installare l'APK

1. Scarica l'APK firmato dall'[ultima release](https://github.com/ValerioMassimoDeCecco/PhotoCloud/releases/latest) (sorgente ufficiale). La cartella `release/` del repository contiene gli APK firmati, il modello AI `efficientnet_lite4.tflite` servito on-demand e il manifest `photocloud-release-build.json` (versione, `versionCode`, dimensione, changelog e SHA-256).
2. Apri il file `.apk` sullo smartphone (concedendo il permesso di installazione da questa origine). Se è già installata una versione precedente firmata con lo stesso certificato, l'aggiornamento preserva dati e configurazioni.
3. Configura l'URL del tuo server (`https://<dominio>`, oppure `http://<IP>:3000` solo in rete locale). Le **nuove installazioni** avviano direttamente il **Vault Zero-Knowledge v2** (accesso con Keyfile JSON + Passphrase o registrazione con setup token); gli utenti con una sessione v1 esistente restano connessi senza interruzioni e possono migrare o alternare modalità dalle Impostazioni.

Per il backup automatico sono richiesti i permessi sui media e, da Android 13, il permesso notifiche. Da Android 14 è supportato anche l'accesso parziale («Seleziona foto e video»).

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

Avvio dietro un singolo Nginx locale (1 hop), in modalità Zero-Knowledge esclusiva:

```bash
TRUST_PROXY=1 PHOTOCLOUD_ZK_ONLY=1 PORT=3000 npm start
# oppure con il server nativo Rust:
TRUST_PROXY=1 PHOTOCLOUD_ZK_ONLY=1 PORT=3000 npm run start:rust
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
| `vault_v2/` *(o `VAULT_V2_DIR`)* | **Vault Zero-Knowledge v2**: database SQLite `vault_v2.db` (utenti, salt, `wrappedVaultKey`, metadati cifrati, sessioni, quote, condivisioni) e blob/miniature/album cifrati `PCZK v1`. Non contiene mai plaintext né chiavi in chiaro. |
| `users.txt` | Account utenti della modalità classica v1 (con hash delle chiavi). |
| `user_media/<utente>/` | File cifrati v1 e metadati nascosti (`.albums.json`, `.hashes.json`, `.favorites.json`, `.phash.json`, `.exif.json`, `.push.json`, `.thumbs/`). |
| `user_media/.shares.json`, `.album-shares.json`, `.vapid.json` | Condivisioni v1 e chiavi VAPID per notifiche Web Push. |
| `temp_uploads/` *(o `TEMP_UPLOAD_DIR`)*, `temp_zips/` | File temporanei di upload chunked e ZIP in transito. Puliti automaticamente al completamento, su abort o all'avvio del server. |

Per un backup completo copia **`vault_v2/`** (e, se usi anche la modalità v1, **`user_media/`** e **`users.txt`**) preferibilmente a server fermo. Custodisci **separatamente** il Keyfile JSON (`photocloud_v2_key_<username>.json`), il Recovery Code e la tua **Passphrase**: senza di essi nessun backup Zero-Knowledge può essere decifrato.

## Sicurezza

Le specifiche crittografiche complete e il threat model sono documentati in [`docs/zk-spec.md`](docs/zk-spec.md), [`docs/threat-model.md`](docs/threat-model.md) e [`docs/zk-audit.md`](docs/zk-audit.md).

- **Crittografia Zero-Knowledge v2 (E2EE)**:
  - Master KDF client-side **Argon2id** (`64 MiB`, `t = 3`, `p = 1`) con *KDF parameter floor* verificato dal client prima dell'esecuzione (rifiuto automatico di parametri deboli).
  - Separazione dei domini tramite **HKDF-SHA256** (`KEK`, `AuthSecret`, `MetaKey`, `ThumbKey`, `DedupKey`, `FileKeyWrap`) e **Vault Key 256-bit** casuale avvolta lato client (`wrappedVaultKey`).
  - Formato cifrato streaming **`PCZK v1`** (AES-256-GCM a chunk da 1 MiB, AAD autenticato per ogni chunk e flag finale anti-troncamento/riordino/swap).
  - Lato server, `authSecret` è verificato tramite **scrypt** in tempo costante con fake salt deterministico anti-enumerazione utenti; le sessioni usano cookie `HttpOnly; Secure; SameSite=Strict` + token CSRF `X-CSRF-Token`.
  - Web app `/v2` protetta da **CSP rigoroso** (`script-src 'self' 'wasm-unsafe-eval'`, `style-src 'self'`, zero script/stili inline), `Referrer-Policy: no-referrer` e Service Worker strettamente confinato a `/v2` con `Cache-Control: no-store`.
- **Crittografia classica v1 (retrocompatibilità)**:
  - AES-256-GCM (`PhotoCloud-GCM-v1\0`) con PBKDF2-HMAC-SHA256 (100.000 iterazioni) e salt/IV per file; lettura retrocompatibile dei vecchi file AES-256-CFB. Disabilitabile interamente con `PHOTOCLOUD_ZK_ONLY=true`.
- **Difesa HTTP, file e anteprime**:
  - Protezione CSRF basata su `Origin` e `Sec-Fetch-Site: cross-site`, rate limiting per IP, header di sicurezza (`X-Content-Type-Options`, `X-Frame-Options`, COOP, `Permissions-Policy`) e nessun `X-Powered-By`.
  - Validazione rigorosa dei percorsi contro path traversal e prototype pollution, limiti anti zip-bomb per le anteprime Office (10 MB/voce sul server, 5 MB/voce su Android) e scritture atomiche su disco (con fallback sicuro cross-device `EXDEV`).
- **Sicurezza Android**:
  - Android KeyStore per il wrapping locale delle chiavi, **TOFU SPKI certificate pinning** sulle connessioni HTTPS v2, sblocco biometrico (`BiometricPrompt`), `FLAG_SECURE`, zero keystore nel repository e verifica SHA-256 + certificato X.509 sugli aggiornamenti APK.

## Comandi npm

| Comando | Descrizione |
| --- | --- |
| `npm run dev` | Avvia il server Express + Vite in sviluppo (porta `3000`). |
| `npm run build` | Compila il frontend React/PWA per la produzione (`vite build`). |
| `npm start` | Avvia il server Node.js in produzione (`node --import tsx server.ts`). |
| `npm run build:rust` | Compila il server nativo Rust in modalità release (`rust/app/Cargo.toml`). |
| `npm run start:rust` | Avvia il binario release del server nativo Rust. |
| `npm run test:rust` | Esegue le 18 suite di test end-to-end sul server nativo Rust (`tests/test_rust_server_e2e.py`). |
| `npm run lint` | Controllo statico dei tipi TypeScript (`tsc --noEmit`). |
| `npm test` | Esegue tutte le suite unit e di integrazione in `src/lib/*.test.ts` (crittografia v1 e ZK v2, Web SDK, API `/api/v2`, canary zero-plaintext, EXIF, pHash, ricerca naturale, cache miniature, `TRUST_PROXY`, generatore Android). |
| `npm run release:check` | Verifica la coerenza di versione e checksum tra `package.json`, Gradle, APK e `photocloud-release-build.json`. |
| `npm run release:apk` | Esegue `release:check`, compila l'APK firmato e avvia la pubblicazione su GitHub Releases (richiede `GITHUB_TOKEN`). |
| `npm run android:signing:setup` | Crea o sincronizza la configurazione di firma persistente (`~/.photocloud/signing.properties`). |

Per eseguire la suite Playwright end-to-end completa del Vault Zero-Knowledge `/v2` (flussi 1–9: registrazione, keyfile login, upload E2EE, Service Worker video Range, photo editor E2EE, export ZIP streaming, cestino, anteprima DOCX/PDF decifrata e share `#fragment`):

```bash
bash scripts/run-v2-playwright-e2e.sh
```

## Struttura del progetto

```
PhotoCloud/
├── server.ts                         # Server Express: mount ZK v2 (/v2, /api/v2/*), guard PHOTOCLOUD_ZK_ONLY, API v1, PWA e Android
├── rust/
│   ├── app/                          # Backend standalone nativo Rust (Axum + Tokio + rusqlite)
│   │   ├── Cargo.toml
│   │   └── src/
│   │       ├── main.rs               # Entry point, runtime Tokio, graceful shutdown
│   │       ├── zk_v2_store.rs        # Store SQLite vault_v2, scrypt, Range RFC 9110, I/O atomico cross-FS
│   │       ├── crypto.rs             # Crittografia vault v1 GCM/CFB, PBKDF2-HMAC-SHA256
│   │       ├── vault.rs, vault_manager.rs, hash_index.rs, thumb_cache.rs
│   │       ├── document_engine.rs, exif.rs, phash.rs, nl_search.rs, sharing.rs
│   │       ├── state.rs, types.rs, template_renderer.rs
│   │       └── units/                # Router Axum modulari (zk_v2.rs, auth.rs, media.rs, api.rs, android.rs, mod.rs…)
│   └── app-cases/                    # Suite di replay e regressione HTTP (155 casi)
├── src/
│   ├── App.tsx, main.tsx             # Entry point React (interfaccia classica + accesso diretto a /v2)
│   ├── components/                   # Galleria, Lightbox, Cestino, Auth, installazione PWA, Android Release Studio
│   ├── hooks/                        # usePWAInstall
│   ├── client/
│   │   ├── zk-sdk/                   # SDK Zero-Knowledge client-side (ZkVaultClient, crypto WebCrypto/Argon2id, streaming)
│   │   └── v2-app/                   # Web app Zero-Knowledge /v2 (main.ts, router.ts, album cifrati, sicurezza & rewrap, share)
│   ├── lib/                          # Logica server/condivisa e suite di test *.test.ts
│   │   ├── zk/                       # Primitive crittografiche ZK v2 (Argon2id, HKDF, PCZK v1 chunked AEAD, zeroization)
│   │   ├── zkServerV2.ts             # Router Express & store SQLite Zero-Knowledge /api/v2/*
│   │   ├── crypto.ts                 # AES-256-GCM v1, PBKDF2, SHA-256, streaming
│   │   ├── documentEngine.ts, hashIndex.ts, thumbCache.ts, sharing.ts, sharePage.ts
│   │   ├── nlSearch.ts, phash.ts, exif.ts, mapPage.ts, pushService.ts, trustProxy.ts, vaultStorage.ts
│   │   ├── photoEditorMath.ts, grouping.ts, templateRenderer.ts, liquidGlassEngine.ts
│   │   └── androidBuilder.ts, githubReleasePublisher.ts, persistentSigning.ts
│   └── types.ts                      # Tipi condivisi
├── public/
│   ├── v2/                           # Bundle compilato app.js, app.css e Service Worker streaming sw-stream.js
│   └── manifest.webmanifest, service-worker.js, register-pwa.js, icone PWA
├── static/                           # Script e stili interfaccia classica v1 (base, gallery, login, liquid-glass)
├── templates/                        # Template HTML v1 (base, login)
├── android-app/                      # App Android nativa (Kotlin + Jetpack Compose + Gradle Wrapper 8.10.2)
│   └── app/src/main/java/com/valerio/photocloud/
│       ├── zk/                       # Client ZK v2 nativo: ZkCoreCrypto, ZkArgon2id, VaultKeyStore, TofuSpkiPinning,
│       │                             # PhotoCloudZkApiClientV2, ZkBlobUploadPipeline, ZkAutoBackupWorker, ZkV2AuthScreen, ZkV2VaultScreen…
│       ├── MainActivity.kt           # UI nativa (default ZK v2 su nuove installazioni)
│       ├── PhotoCloudApiClient.kt    # Client HTTP v1, cache miniature, anteprime documenti
│       ├── AutoBackupWorker.kt, AutoBackupLogic.kt
│       ├── LocalPhotoCategorizer.kt, PhotoAiDatabase.kt, PhotoAiIndexingWorker.kt, AiModelDownloadManager.kt
│       ├── NaturalLanguageSearchEngine.kt, AndroidMediaEditorEngine.kt, GalleryDragSelectionController.kt
│       └── AppAutoUpdater.kt, LiquidGlassDesignSystem.kt
├── docs/                             # Specifiche crittografiche (zk-spec.md, threat-model.md, zk-audit.md, piani web/Android)
├── test-vectors/                     # Vettori di test e fixture di interoperabilità Web / Rust / Python / Kotlin
├── tests/
│   └── test_rust_server_e2e.py       # Suite E2E completa per il server Rust (18 suite)
├── scripts/                          # run-v2-playwright-e2e.sh, e2e-v2-playwright.mjs, check-release-gate, publish-github-release…
├── release/                          # APK firmati, modello AI on-demand, manifest di aggiornamento
├── audit/                            # Report di audit e smoke test
├── .github/workflows/                # android-ci.yml, android-release.yml
├── photocloud.bat, photocloud.sh     # Script interattivi per Windows e Linux/macOS
└── .env.example, CHANGELOG.md, package.json, vite.config.ts, tsconfig.json
```

## Test e CI

- **`npm test`**: esegue le suite unit e di integrazione Node/TypeScript (108 test attivi su crittografia v1/v2, formato `PCZK v1` >300 MiB, test negativi AEAD, API `/api/v2/*` incluso abort upload e cross-user isolation, Web SDK con spy di rete e canary zero-plaintext, EXIF, pHash, ricerca naturale, cache miniature, `TRUST_PROXY` e generatore Android; più 1 test opzionale di reverse-interop Kotlin → TypeScript attivato dopo `gradle testDebugUnitTest`).
- **`npm run lint` & `npm run build`**: verifica statica TypeScript (`tsc --noEmit`) e build di produzione Vite.
- **`cargo test` & `npm run test:rust`**: 7 unit test Rust + 18 suite E2E sul binario release Rust (inclusi `/v2`, `/api/v2/*`, abort upload e `PHOTOCLOUD_ZK_ONLY=1`).
- **`bash scripts/run-v2-playwright-e2e.sh`**: 9 flussi browser reali Playwright end-to-end su `/v2` (registrazione, keyfile login, upload multi-formato E2EE, Service Worker video Range con verifica zero cache plaintext, photo editor E2EE, export ZIP streaming, cestino, anteprima DOCX/PDF e condivisione `#fragment`).
- **`android-ci.yml`**: verifica la compilazione Kotlin di release su ogni push o pull request che modifica `android-app/**` o i workflow Android.
- **`android-release.yml`**: compila, firma e pubblica l'APK su GitHub Releases (JDK 17, Android SDK 35, Gradle 8.10.2), verificando corrispondenza versione/tag/APK e continuità del certificato di firma.

## Cronologia delle versioni

Il dettaglio completo delle modifiche è in [CHANGELOG.md](CHANGELOG.md); gli APK installabili sono nelle [Releases](https://github.com/ValerioMassimoDeCecco/PhotoCloud/releases). In sintesi:

| Serie | Novità principali |
| --- | --- |
| 1.5 + ZK v2 | **Vault Zero-Knowledge End-to-End v2 (`/v2`, `/api/v2/*`)** con parità completa Node.js, Rust (Axum + `rusqlite`) e Android Kotlin (Argon2id, `PCZK v1`, album cifrati, Passphrase Rewrap, share `#fragment`, Service Worker Range, `PHOTOCLOUD_ZK_ONLY=1`); backup automatico Camera Roll Android, cache miniature cifrata, checksum SHA-256 end-to-end e pulizia orfani (1.5.0–1.5.1). |
| 1.4 | Preferiti, Ricordi, ricerca in linguaggio naturale, link pubblici, album condivisi, notifiche push, duplicati quasi identici (pHash), EXIF e mappa delle foto. |
| 1.3 | Rafforzamento sicurezza, upload e ZIP su disco, crittografia asincrona (1.3.0); lightbox ed editor foto/video riscritti (1.3.1); pinch-to-zoom ancorato al punto focale (1.3.2). |
| 1.2 | AI on-device (1.2.0); selezione a trascinamento con auto-scroll (1.2.2, 1.2.4); modello AI facoltativo e aggiornamenti in-app (1.2.3); sicurezza (1.2.5); fix ciclo aggiornamenti (1.2.6); indicatore spazio cloud (1.2.7); caricamenti massivi e trasferimenti paralleli (1.2.8); pausa trasferimenti e scelta file singoli / ZIP (1.2.9). |
| 1.1 | Galleria sempre montata ed editor a bassa latenza (1.1.1); anteprime video e fix selezione (1.1.2); controlli player video (1.1.3); drag-to-select e gesti lightbox (1.1.5). |
| 1.0 | Prime release: indicatore trasferimenti, apertura intelligente file e visualizzatore documenti integrato. |
