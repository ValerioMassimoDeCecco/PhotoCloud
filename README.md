# PhotoCloud

**Archivio self-hosted e cifrato per foto, video e documenti, con web app (PWA) e app Android nativa.**

[![Versione](https://img.shields.io/github/package-json/v/ValerioMassimoDeCecco/PhotoCloud?label=versione)](CHANGELOG.md)
[![Node.js](https://img.shields.io/badge/Node.js-22.13%2B%20LTS-339933?logo=nodedotjs&logoColor=white)](https://nodejs.org)
[![Android](https://img.shields.io/badge/Android-8.0%2B-3DDC84?logo=android&logoColor=white)](#app-android)
[![Kotlin](https://img.shields.io/badge/Kotlin-Jetpack%20Compose-7F52FF?logo=kotlin&logoColor=white)](android-app)

PhotoCloud conserva sul tuo server foto, video, documenti Office/PDF e qualsiasi altro file (ZIP, APK, audio, codice…), li cifra a riposo e li rende consultabili da browser o da smartphone. Il progetto ha due componenti:

| Componente | Descrizione | Tecnologie |
| --- | --- | --- |
| **Server e web app** | API, archiviazione cifrata e interfaccia web installabile come PWA. Legge anche il formato crittografico della versione Python originale. | Node.js, Express 5, TypeScript, React 19, Vite, Tailwind CSS 4 |
| **App Android** (`com.valerio.photocloud`) | Client nativo che comunica direttamente con il tuo server. Aggiunge il backup automatico della Camera Roll, la categorizzazione AI on-device facoltativa e gli aggiornamenti in-app. | Kotlin, Jetpack Compose (Material 3), OkHttp, Room, WorkManager, MediaPipe. minSdk 26, targetSdk 35 |

> [!IMPORTANT]
> **La cifratura avviene sul server, non è end-to-end**: il server elabora i contenuti in chiaro. Pubblica PhotoCloud solo su **HTTPS**, anche per l’app Android: con HTTP chiavi, sessioni e contenuti viaggiano in chiaro sulla rete.
>
> I file nuovi usano AES-256-GCM (autenticato). I file creati con le versioni precedenti (AES-CFB) restano leggibili, ma non sono protetti da manomissioni e non vengono migrati automaticamente. **Fai un backup prima di aggiornare** ([come](#dati-e-backup)).

## Indice

- [Funzionalità](#funzionalità)
- [Avvio rapido](#avvio-rapido)
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

Salvo dove indicato, le funzioni sono disponibili sia nella web app sia nell’app Android.

### Archivio e galleria

- **Griglia raggruppata** per giorno, mese, anno o album, con album a assegnazione multipla e filtro rapido.
- **Selezione multipla con trascinamento**: rettangolo di selezione sul web, pressione prolungata e trascinamento con auto-scroll su Android.
- **Timeline scrubbable** stile Google Foto per saltare tra i periodi *(solo web)*.
- **Preferiti** e **Ricordi** («In questo giorno»: i media scattati lo stesso giorno negli anni passati).
- **Ricerca in linguaggio naturale** in italiano e inglese, ad esempio «foto di agosto 2024», «video dell’anno scorso», «immagini preferite». Su Android lo stesso motore gira in locale.
- **Cestino** con ripristino ed eliminazione definitiva, **esportazione ZIP** e indicatore dello spazio usato (Foto e video, File cloud, Cestino).
- **Ricerca duplicati**: esatti (SHA-256) e quasi identici (perceptual hash pHash: foto ridimensionate, ricompresse o leggermente ritagliate; JPG, PNG, GIF, BMP).
- **Dati EXIF** (fotocamera, data di scatto, apertura, ISO, esposizione, focale, GPS) e **mappa delle foto** geolocalizzate. Le tile della mappa vengono caricate da OpenStreetMap direttamente dal client.
- Due temi: **Originale (Material You)** e **Liquid Glass**.

### File manager cloud e visualizzatori integrati

PhotoCloud gestisce qualsiasi tipo di file, non solo i media. Toccando un file, questo viene decifrato al volo e aperto nell’app se il formato è supportato; altrimenti puoi usare **Apri con…** (Android: `FileProvider` e selettore di sistema; web: condivisione nativa o download manuale).

| Categoria | Formati | Visualizzatore |
| --- | --- | --- |
| PDF | `.pdf` | Android: rendering nativo (`PdfRenderer`), zoom 75–300% e scorrimento continuo. Web: viewer inline con salto a pagina e zoom 60–240%. Supporta HTTP Range per i file grandi. |
| Word e testo formattato | `.doc` `.docx` `.odt` `.rtf` | Titoli, paragrafi e liste in vista pagina, ricerca nel testo con evidenziazione, zoom del carattere. |
| Fogli di calcolo | `.xls` `.xlsx` `.ods` `.csv` `.tsv` | Multi-foglio, intestazioni fisse, filtro righe in tempo reale. |
| Presentazioni | `.ppt` `.pptx` `.odp` | Slide 16:9, miniature laterali (web), navigazione e note del relatore. |
| Testo e codice | `.txt` `.md` `.json` `.xml` `.yaml` `.html` `.css` `.js` `.ts` `.py` `.kt` `.java` `.c` `.cpp` `.sql` `.sh` `.log` `.ini` … | Monospace con numerazione delle righe, filtro rapido e copia del testo. |
| Immagini | `.png` `.jpg` `.jpeg` `.webp` `.gif` `.svg` `.bmp` `.avif` | Lightbox a schermo intero ed editor foto. |
| Audio e video | `.mp3` `.wav` `.ogg` `.m4a` `.flac` `.aac` `.mp4` `.webm` `.mov` `.mkv` | Player integrato con streaming Range. |
| Archivi e pacchetti | `.apk` `.zip` `.rar` `.7z` `.iso` `.dmg` `.exe` … | **Apri con…** (app esterna) oppure download. |

Limiti noti:

- I formati Office binari legacy (`.doc`, `.xls`, `.ppt` precedenti al 2007) e i file protetti da password mostrano solo il testo estraibile, con un avviso. Per layout complessi, grafici o macro usa **Apri con…**.
- L’anteprima dei fogli di calcolo carica fino a 1.500 righe per foglio, per evitare blocchi dell’interfaccia. Il file completo resta apribile in un’app esterna o scaricabile.

### Lightbox ed editor foto e video

- **Lightbox**: pinch-to-zoom, zoom con la rotellina (web), doppio tap o doppio clic, pan vincolato ai bordi, swipe laterale per scorrere e verso il basso per chiudere, filmstrip e precaricamento delle foto adiacenti. Mostra subito l’anteprima a 1280 px e carica l’originale quando lo zoom supera 1,15×.
- **Slideshow** con transizioni (dissolvenza, scorrimento, zoom) e avanzamento automatico alla fine dei video *(solo web)*.
- **Player video** con scrub bar e timecode, salto di ±10 s, velocità da 0,5× a 2×, muto e loop.
- **Editor non distruttivo**: Undo/Redo (`Ctrl+Z` / `Ctrl+Y` sul web), confronto con l’originale, filtri (Vivido, Bianco e nero, Seppia, Cinema, Freddo, Vintage), luminosità, contrasto, saturazione e calore, ritaglio con griglia 3×3 a 8 maniglie, rotazione e specchio. Per i video: taglio di inizio e fine, rimozione dell’audio e velocità. Puoi salvare una copia o sovrascrivere l’originale, alla risoluzione piena e sempre cifrato.

### Condivisione

- **Link pubblici temporanei** con scadenza, password opzionale e limite di download; si possono revocare in qualsiasi momento. Il token è opaco (48 caratteri esadecimali) e la chiave dell’utente non è mai salvata in chiaro.
- **Album condivisi tra utenti registrati**, con ruolo *viewer* (sola lettura) o *contributor* (può anche caricare).
- **Notifiche push** tramite Web Push (VAPID) per la PWA *(solo web)*.

### Trasferimenti

- **Streaming a memoria costante**, anche con migliaia di file: Android legge da disco a blocchi di 32 KB senza caricare i file in RAM; il web invia micro-blocchi con un pool di worker concorrenti.
- **Pausa, ripresa e annullamento** di ogni trasferimento, con un indicatore discreto nell’header (velocità aggregata e contatore).
- **Scelta prima di ogni trasferimento**: file singoli oppure un unico archivio ZIP (con preferenza predefinita nelle Impostazioni).
- **Trasferimenti paralleli** configurabili da 1 a 16 (predefinito 3).
- **Cartelle di download configurabili** per foto, video e file. Su Android, di default `Pictures/PhotoCloud`, `Movies/PhotoCloud`, `Music/PhotoCloud` e `Download/PhotoCloud`; è possibile scegliere una cartella personalizzata (SAF su Android, File System Access API sul web).
- **HTTP Range** (RFC 9110) per streaming e ripresa dei download.

### Cache miniature cifrata

- Il server genera le varianti `thumb` (320 px) e `large` (1280 px) in JPEG (qualità 80) e le salva cifrate con AES-256-GCM in `user_media/<utente>/.thumbs/`.
- Risposte con `ETag` e `304 Not Modified`, cache negativa con TTL ed eviction LRU entro il limite `THUMB_CACHE_MAX_MB`. La cache si invalida da sola quando un file viene modificato, cestinato, ripristinato o eliminato.
- Per i video, l’app Android estrae il fotogramma poster e lo carica con `PUT /api/thumbs/:filename`.
- Dalle Impostazioni (**Cache miniature**) vedi lo spazio occupato e puoi ricostruire la cache. Su Android è presente anche una cache LRU su disco (`thumb_cache/`, 64, 150, 300 o 512 MB, predefinito 150 MB).

### Solo Android

- **Backup automatico della Camera Roll**
  - Pianificazione periodica (15 minuti) con WorkManager, trigger immediato sui nuovi media (`ContentUriTrigger`) e servizio in foreground `dataSync` con notifica e azioni **Pausa** e **Annulla**.
  - Impostazioni: cartelle MediaStore (predefinita `Camera`), tipo di contenuto (foto e video, solo foto, solo video), modalità (solo nuovi elementi da ora, oppure intera libreria), vincoli (solo Wi-Fi, predefinito; solo in ricarica; rispetta il risparmio energetico) e limite di dimensione per i video.
  - Se il server usa `http://`, prima di attivare il backup viene chiesta una conferma esplicita.
  - **Deduplica SHA-256**: l’hash, calcolato in streaming a blocchi da 64 KB, viene confrontato con l’indice del server (`POST /api/backup/check`) solo sui file attivi. Una foto finita nel Cestino viene quindi ricaricata.
  - Il checksum SHA-256 è obbligatorio e verificato end-to-end. I file fino a 24 MB passano da `POST /upload`; quelli più grandi vengono caricati a blocchi da 8 MB su `/api/upload/chunked/*`, fino a `MAX_UPLOAD_MB`.
- **Categorizzazione AI on-device (facoltativa)**
  - Usa EfficientNet-Lite4 tramite MediaPipe, con GPU e fallback automatico su CPU. Le foto restano sul dispositivo.
  - Il modello (~24 MB) **non è incluso nell’APK**: si scarica dalle Impostazioni, con pausa, ripresa (HTTP Range) e annullamento, controllo dello spazio libero (almeno 50 MB) e verifica di dimensione e SHA-256. Si può eliminare per liberare spazio.
  - Categorie principali: Animali, Paesaggi, Persone, Cibo, Veicoli, Architettura, Documenti, Tecnologia, più le etichette specifiche. L’indicizzazione gira in background (WorkManager e Room) con barra di avanzamento; la galleria mostra chip di filtro e i tag AI nel dettaglio foto.
- **Protezione del dispositivo**: sblocco biometrico (`BiometricPrompt`) con blocco automatico in background e, a scelta, `FLAG_SECURE` contro gli screenshot.
- **Aggiornamenti in-app**: all’avvio controlla le GitHub Releases (con fallback su `/api/android/update-manifest` del server), scarica l’APK nell’app con progresso e velocità, verifica SHA-256 e certificato di firma X.509 e controlla che il `versionCode` sia maggiore di quello installato prima di aprire l’installer.

### Solo web

- **PWA installabile** (service worker con aggiornamento automatico) e notifiche push.
- **Android Release Studio**: pagina riservata agli utenti autenticati per scaricare l’APK firmato e il progetto Android Studio di una versione già compilata.

## Avvio rapido

**Requisiti:** [Node.js](https://nodejs.org) 22.13+ LTS (`>= 22.13.0`, richiesto da Vite 8 e dal motore nativo `node:sqlite` senza flag per il vault Zero-Knowledge v2) e Git.

### Con gli script interattivi

`photocloud.bat` (Windows 10/11) e `photocloud.sh` (Linux e macOS) controllano la presenza di Git e Node.js e, se mancano, li installano (`winget` su Windows; `brew`, `apt`, `dnf` o `pacman` su Linux e macOS). Poi mostrano un menu per avviare il server in sviluppo o in produzione, aggiornare l’installazione, clonare il repository e compilare l’APK.

```bash
./photocloud.sh        # Linux / macOS (se necessario: chmod +x photocloud.sh)
```

```bat
photocloud.bat         :: Windows (doppio clic, oppure da prompt dei comandi / PowerShell)
```

> [!NOTE]
> Su alcune distribuzioni Linux la versione di Node.js nei repository può essere troppo vecchia. In quel caso installa una versione supportata con [nvm](https://github.com/nvm-sh/nvm) o dal sito ufficiale.

### Manualmente

```bash
git clone https://github.com/ValerioMassimoDeCecco/PhotoCloud.git
cd PhotoCloud
npm install
npm run dev
```

Apri `http://localhost:3000`. Per la modalità produzione:

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
| Linux | Node.js da [nodejs.org](https://nodejs.org/en/download) oppure `nvm install 22`; Git dal gestore pacchetti (es. `sudo apt install -y git build-essential`) |

### Primo accesso

Apri l’app, registra un utente e scarica il **file chiave** `photocloud_auth_<username>.json`. È la credenziale per accedere (anche dall’app Android) e da essa deriva la chiave di cifratura dei tuoi file. Il server ne conserva solo un hash e non può rigenerarla: **conservala in un luogo sicuro**.

### Collegare lo smartphone

Sulla stessa rete Wi-Fi trova l’IPv4 del computer (`ipconfig` su Windows, `ipconfig getifaddr en0` su macOS, `hostname -I` su Linux) e inserisci `http://<IP>:3000` nell’app. Va bene solo in rete locale: fuori casa pubblica il server su HTTPS ([vedi sotto](#deploy-dietro-reverse-proxy)).

## Configurazione

Il server legge la configurazione dalle **variabili d’ambiente del processo** e **non carica automaticamente un file `.env`**. Impostale nella shell, nel servizio systemd o nel container, ad esempio:

```bash
PORT=3000 TRUST_PROXY=1 MAX_UPLOAD_MB=4096 npm start
```

`.env.example` è un modello con tutte le variabili supportate.

| Variabile | Predefinito | Descrizione |
| --- | --- | --- |
| `PORT` | `3000` | Porta HTTP del server. |
| `MAX_UPLOAD_MB` | `2048` | Dimensione massima del singolo file caricato, anche con upload a blocchi (valori ammessi da 50 a 16384). |
| `THUMB_CACHE_MAX_MB` | `512` | Limite su disco, per utente, della cache miniature cifrata. |
| `TRUST_PROXY` | `false` | Hop o subnet fidati quando il server sta dietro un reverse proxy ([dettagli](#deploy-dietro-reverse-proxy)). |
| `SHARE_RATE_LIMIT_MAX` | `600` | Richieste al minuto per IP su `/share/*` (minimo 10). |
| `MAX_JIMP_PREVIEW_QUEUE` | `32` | Lunghezza massima della coda di generazione anteprime (Jimp) per i link pubblici. |
| `MAX_JIMP_QUEUE_WAIT_MS` | `10000` | Attesa massima in coda per quelle anteprime, in millisecondi. |

Le altre variabili di `.env.example` (`GITHUB_TOKEN`, `PHOTOCLOUD_KEYSTORE_*`, `PHOTOCLOUD_KEY_*`, `PHOTOCLOUD_SIGNING_PROPERTIES`) servono solo per firmare e pubblicare l’APK ([vedi sotto](#compilare-lapk-da-sorgente)).

## App Android

Requisiti del dispositivo: Android 8.0 o successivo (API 26).

### Installare l’APK

1. Scarica l’APK firmato dall’[ultima release](https://github.com/ValerioMassimoDeCecco/PhotoCloud/releases/latest): le GitHub Releases sono la sorgente ufficiale. La cartella `release/` del repository contiene APK di release passate, il modello AI servito on-demand e il manifest di aggiornamento `photocloud-release-build.json` (versione, `versionCode`, dimensione, changelog e SHA-256).
2. Apri il file `.apk` sul dispositivo (Android ti chiederà di consentire l’installazione da quell’origine). Se è già installata una versione precedente firmata con lo stesso certificato, viene aggiornata senza perdere dati o configurazioni.
3. Tocca il badge **Server** in alto a destra e inserisci l’URL del tuo server: `https://<dominio>`, oppure `http://<IP>:3000` solo in rete locale. Accedi con il tuo file chiave `.json`.

Per il backup automatico servono i permessi sui media e, da Android 13, quello sulle notifiche. Da Android 14 è supportato anche l’accesso parziale («Seleziona foto e video»). Le versioni successive vengono rilevate e scaricate dall’app stessa.

### Compilare l’APK da sorgente

Servono JDK 17, Android SDK 35 (`platforms;android-35`, `build-tools;35.0.0`) e Gradle 8.10.x, la versione usata dalla CI: il repository non include il Gradle wrapper.

```bash
cd android-app
gradle assembleRelease --no-daemon
```

I task di release richiedono le credenziali di firma. Nessun keystore o password è committato nel repository (`.gitignore` esclude `*.jks`, `*.keystore` e `signing.properties`). La firma viene risolta su tre livelli:

1. **GitHub Secrets** in CI/CD: `PHOTOCLOUD_KEYSTORE_BASE64`, `PHOTOCLOUD_KEYSTORE_PASSWORD`, `PHOTOCLOUD_KEY_ALIAS`, `PHOTOCLOUD_KEY_PASSWORD`.
2. **Vault privato** (`photocloud-signing-vault`): se i Secrets non sono configurati, `android-release.yml` crea una sola volta una chiave RSA-2048 in una release in bozza, protetta da `GITHUB_TOKEN` e invisibile al pubblico, e la riutilizza per tutte le release successive. La continuità del certificato SHA-256 viene verificata con `apksigner`.
3. **File locale**: `android-app/signing.properties` oppure `~/.photocloud/signing.properties`. Puoi generarlo o sincronizzarlo con `npm run android:signing:setup`.

**Versione unica.** `versionName` e `versionCode` vivono solo in `android-app/app/build.gradle.kts`. Tag (`v*`), nome dell’APK e manifest di aggiornamento ne derivano. `npm run release:check` e la CI bloccano la pubblicazione se package.json, Gradle, nome dell’APK e `photocloud-release-build.json` non coincidono, oppure se l’APK compilato dichiara una versione diversa. Questo evita il ciclo infinito di aggiornamento che si verifica quando una release contiene l’APK della versione precedente; l’app, in ogni caso, annulla l’installazione se il `versionCode` non è maggiore di quello installato.

**Pubblicazione.** Non esistono endpoint HTTP per pubblicare release: usa `npm run release:apk` oppure il workflow GitHub Actions. `release:apk` esegue `release:check`, compila l’APK firmato in `release/`, avvia il workflow `android-release.yml` e pubblica su GitHub Releases (serve `GITHUB_TOKEN` con scope `repo`).

## Deploy dietro reverse proxy

Se PhotoCloud è esposto in HTTPS tramite un reverse proxy (Nginx, Caddy, Traefik, Cloudflare Tunnel, Cloud Run…), configura `TRUST_PROXY` e fai in modo che il proxy imposti in modo affidabile gli header di inoltro.

### `TRUST_PROXY`

| Valore | Effetto |
| --- | --- |
| non impostato, `0` o `false` (predefinito) | Gli header `X-Forwarded-*` vengono ignorati e `Origin` è confrontato solo con l’header `Host` della connessione diretta. |
| intero da 1 a 64 (es. `1`) | Numero di hop proxy fidati davanti al server, passato a Express come numero. `req.ip` è ricavato dall’ultimo hop non fidato: un client che invia più `X-Forwarded-For` non può falsificare l’IP usato dai rate limiter. |
| lista di IP, subnet CIDR (IPv4/IPv6) o preset Express (`loopback`, `linklocal`, `uniquelocal`) | Esempi: `127.0.0.1,10.0.0.0/8` oppure `loopback,uniquelocal`. |
| `true` | **Rifiutato**: farebbe fidare l’app di tutti gli hop di `X-Forwarded-For`, permettendo di falsificare l’IP. Il server si avvia comunque, stampa un warning e lascia `trust proxy` disabilitato. |

> [!WARNING]
> Dietro un reverse proxy **senza** `TRUST_PROXY` valido, `req.ip` coincide con l’IP del proxy (es. `127.0.0.1`): tutti gli utenti finiscono nello stesso bucket di rate limiting e rischiano falsi `429` su `/login`, `/share/*` e `/share/:token/unlock`. Possono comparire anche `403` della protezione CSRF, se `Origin` è `https://` mentre il socket interno è `http://`.

### Cosa deve fare il proxy

- **`Host` / `X-Forwarded-Host`**: mantenere o impostare l’hostname pubblico (ed eventuale porta non standard), perché la protezione CSRF su `POST`, `PUT`, `DELETE` e `PATCH` verifichi che `Origin` corrisponda a `Host` (o a `X-Forwarded-Host` quando `TRUST_PROXY` è attivo).
- **`X-Forwarded-Proto`**: impostarlo il proxy stesso (es. `$scheme` in Nginx) al protocollo esterno reale. Con `TRUST_PROXY` attivo il server risponde `403` se lo schema di `Origin` non coincide.

### Esempio minimo con Nginx

```nginx
server {
    listen 443 ssl;
    server_name cloud.example.com;
    # configura qui ssl_certificate e ssl_certificate_key

    client_max_body_size 0;   # nessun limite sul proxy: il limite è MAX_UPLOAD_MB

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

Avvio di PhotoCloud dietro un solo Nginx locale (1 hop):

```bash
TRUST_PROXY=1 PORT=3000 npm start
```

## Aggiornamento

Fai prima un [backup](#dati-e-backup), poi usa l’opzione **3** («Aggiorna la Web App») di `photocloud.bat` o `photocloud.sh`, oppure aggiorna a mano:

```bash
git pull
npm install
npm run build      # solo se avvii il server con npm start
```

Poi riavvia il server (`npm run dev` oppure `npm start`). Le modifiche tra una versione e l’altra sono nel [CHANGELOG](CHANGELOG.md).

## Dati e backup

Tutti i dati vivono accanto al progetto, nella cartella da cui avvii il server:

| Percorso | Contenuto |
| --- | --- |
| `users.txt` | Account utente (con l’hash delle chiavi). |
| `user_media/<utente>/` | File cifrati e metadati nascosti dell’utente (`.albums.json`, `.hashes.json`, `.favorites.json`, `.phash.json`, `.exif.json`, `.push.json`, `.thumbs/`). |
| `user_media/.shares.json`, `.album-shares.json`, `.vapid.json` | Link pubblici, album condivisi e chiavi VAPID per le notifiche push. |
| `temp_uploads/`, `temp_zips/` | File temporanei di upload e ZIP in corso. Vengono rimossi a fine operazione; all’avvio il server elimina anche gli eventuali `chunked_*.part` orfani. |

Per un backup completo copia `user_media/` e `users.txt`, preferibilmente a server fermo. Conserva **separatamente i file chiave** degli utenti: senza di essi i dati non sono decifrabili. La cache `.thumbs/` è ricostruibile da **Impostazioni → Cache miniature**.

## Sicurezza

- **Cifratura**: AES-256-GCM con chiave derivata tramite PBKDF2-HMAC-SHA256 (100.000 iterazioni), con salt e IV per file; cifratura in streaming per i file grandi. La derivazione è asincrona (con cache LRU) per non bloccare l’event loop. I file AES-CFB precedenti restano leggibili.
- **Autenticazione**: file chiave verificato in tempo costante; limite di tentativi falliti per IP su login e registrazione (finestra di 15 minuti) e verifica fittizia per impedire l’enumerazione degli utenti.
- **Richieste**: la sessione viene verificata prima di avviare Multer, quindi le richieste non autenticate non consumano disco né RAM; controllo `Origin` anti-CSRF sulle richieste che modificano dati; header di sicurezza (CSP, `X-Content-Type-Options`, `X-Frame-Options`, `Referrer-Policy`, `Permissions-Policy`, COOP) e nessun `X-Powered-By`.
- **File**: nomi validati contro path traversal, file nascosti e chiavi riservate (`__proto__`, `constructor`, `prototype`); i file attivi (`.html`, `.svg`, `.xml`, `.js`) sono serviti con `Content-Disposition: attachment` e CSP `sandbox`; i metadati JSON sono scritti in modo atomico.
- **Anteprime documenti**: limiti anti zip-bomb (server: 10 MB per voce e 1.000 voci; Android: 5 MB e 500 voci).
- **Condivisioni**: token opachi e chiavi salvate solo «avvolte» con un segreto del server; la revoca elimina il record.
- **Android**: sblocco biometrico, `FLAG_SECURE`, manifest rafforzato, nessun keystore nel repository, aggiornamenti verificati con SHA-256 e certificato di firma.

## Comandi npm

| Comando | Descrizione |
| --- | --- |
| `npm run dev` | Avvia il server Express con Vite in sviluppo (porta `3000`). |
| `npm run build` | Compila il frontend per la produzione (`vite build`). |
| `npm start` | Avvia il server in produzione. |
| `npm run lint` | Controllo dei tipi TypeScript (`tsc --noEmit`). |
| `npm test` | Esegue i test di `src/lib/*.test.ts`: crittografia, indice hash, EXIF, pHash, ricerca in linguaggio naturale, cache miniature, `TRUST_PROXY` e funzioni del server. |
| `npm run release:check` | Verifica la coerenza di versione e artefatti prima di una release (package.json, Gradle, nome e checksum dell’APK, `photocloud-release-build.json`). |
| `npm run release:apk` | Esegue `release:check`, compila l’APK firmato in `release/` e avvia il workflow GitHub Actions di release (richiede `GITHUB_TOKEN`). |
| `npm run android:signing:setup` | Crea o sincronizza la firma persistente (`~/.photocloud/signing.properties`). |

## Struttura del progetto

```
PhotoCloud/
├── server.ts                  # Server Express: auth, media, anteprime, editing, album, condivisioni, ZIP, upload a blocchi, API Android
├── src/
│   ├── App.tsx, main.tsx      # Entry point React
│   ├── components/            # Galleria, Lightbox, Cestino, Auth, installazione PWA, Android Release Studio
│   ├── hooks/                 # usePWAInstall
│   ├── lib/                   # Logica del server e condivisa (con i test *.test.ts)
│   │   ├── crypto.ts          # AES-256-GCM, PBKDF2, SHA-256, cifratura in streaming
│   │   ├── documentEngine.ts  # Ispezione MIME e parsing dei documenti
│   │   ├── hashIndex.ts       # Indice SHA-256 dei file attivi, pulizia dei file temporanei
│   │   ├── thumbCache.ts      # Cache miniature cifrata
│   │   ├── sharing.ts, sharePage.ts   # Link pubblici e album condivisi
│   │   ├── nlSearch.ts        # Ricerca in linguaggio naturale (IT/EN)
│   │   ├── phash.ts           # Duplicati quasi identici (perceptual hash)
│   │   ├── exif.ts, mapPage.ts        # Metadati EXIF e mappa delle foto
│   │   ├── pushService.ts     # Web Push (VAPID)
│   │   ├── trustProxy.ts      # Parsing di TRUST_PROXY
│   │   ├── vaultStorage.ts    # Scrittura JSON atomica e segreti «avvolti»
│   │   ├── photoEditorMath.ts, grouping.ts, templateRenderer.ts, liquidGlassEngine.ts
│   │   └── androidBuilder.ts, githubReleasePublisher.ts, persistentSigning.ts   # Strumenti di release Android
│   └── types.ts               # Tipi condivisi
├── static/
│   ├── scripts/               # Client web (grouping, lightbox, photo-editor, upload, selection, trash, document-viewer, map, slideshow…)
│   └── styles/                # Fogli di stile (base, gallery, login, liquid-glass)
├── templates/                 # Template HTML (base, login)
├── public/                    # Icone, manifest e service worker della PWA
├── android-app/               # App Android (Kotlin + Jetpack Compose)
│   └── app/src/main/java/com/valerio/photocloud/
│       ├── MainActivity.kt                    # UI nativa
│       ├── PhotoCloudApiClient.kt             # Client HTTP, cache miniature, anteprime documenti
│       ├── AutoBackupWorker.kt, AutoBackupLogic.kt          # Backup automatico della Camera Roll
│       ├── LocalPhotoCategorizer.kt, PhotoAiDatabase.kt, PhotoAiIndexingWorker.kt, AiModelDownloadManager.kt   # AI on-device
│       ├── NaturalLanguageSearchEngine.kt     # Ricerca in linguaggio naturale locale
│       ├── AndroidMediaEditorEngine.kt        # Esportazione dell’editor foto e video
│       ├── GalleryDragSelectionController.kt  # Selezione a trascinamento con auto-scroll
│       ├── AppAutoUpdater.kt                  # Aggiornamenti in-app
│       └── LiquidGlassDesignSystem.kt         # Tema Liquid Glass
├── scripts/                   # check-release-gate, publish-github-release, setup-persistent-signing
├── release/                   # APK di release passate, modello AI on-demand, manifest di aggiornamento
├── release_builds/            # Output di Android Release Studio
├── audit/                     # Report di audit e correzioni, smoke test
├── .github/workflows/         # android-ci.yml, android-release.yml
├── photocloud.bat, photocloud.sh      # Script interattivi per Windows e Linux/macOS
└── .env.example, CHANGELOG.md, package.json, vite.config.ts, tsconfig.json
```

## Test e CI

- `npm test` esegue la suite di test; `npm run lint` controlla i tipi.
- **`android-ci.yml`** compila il progetto Android (verifica la compilazione Kotlin di release) a ogni push o pull request su `main` che tocca `android-app/**` o i workflow Android.
- **`android-release.yml`** compila, firma e pubblica l’APK su GitHub Releases (JDK 17, Android SDK 35, Gradle 8.10.2). Parte su push a `main`, su tag `v*` o manualmente, con gli input `release_tag`, `publish_release`, `allow_signature_rotation` e `changelog`. Controlla che tag, nome dell’APK e versione dichiarata coincidano e che il certificato di firma sia lo stesso della release precedente, salvo rotazione esplicita.

## Cronologia delle versioni

Il dettaglio delle modifiche è nel [CHANGELOG](CHANGELOG.md); gli APK installabili sono nelle [Releases](https://github.com/ValerioMassimoDeCecco/PhotoCloud/releases). In sintesi:

| Serie | Novità principali |
| --- | --- |
| 1.5 | Backup automatico della Camera Roll (Android), cache miniature cifrata, checksum SHA-256 end-to-end per i backup. |
| 1.4 | Preferiti, Ricordi, ricerca in linguaggio naturale, link pubblici, album condivisi, notifiche push, duplicati quasi identici (pHash), EXIF e mappa delle foto. |
| 1.3 | Rafforzamento della sicurezza, upload e ZIP su disco, crittografia asincrona (1.3.0); lightbox ed editor foto e video riscritti (1.3.1); pinch-to-zoom ancorato al punto focale (1.3.2). |
| 1.2 | AI on-device (1.2.0); selezione a trascinamento con auto-scroll (1.2.2, 1.2.4); modello AI facoltativo e aggiornamenti in-app (1.2.3); sicurezza (1.2.5); correzione del ciclo di aggiornamento (1.2.6); indicatore dello spazio cloud (1.2.7); caricamenti massivi e trasferimenti paralleli (1.2.8); pausa dei trasferimenti e scelta file singoli / ZIP (1.2.9). |
| 1.1 | Galleria sempre montata e editor a bassa latenza (1.1.1); anteprime video e correzioni della selezione (1.1.2); controlli del player video (1.1.3); drag-to-select e gesti della lightbox (1.1.5). |
| 1.0 | Prime release: indicatore dei trasferimenti, apertura intelligente dei file e visualizzatore di documenti integrato. |
