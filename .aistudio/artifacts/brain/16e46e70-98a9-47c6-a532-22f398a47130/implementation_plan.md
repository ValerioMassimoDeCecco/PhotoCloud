# Ripristino Web App Originale PhotoCloud, Compilazione Client Android Nativo da Zero e Pubblicazione su GitHub Releases

Questo piano ripristina integralmente l'interfaccia e il comportamento originali della web app **PhotoCloud** (`login.html`, `gallery.html`, `trash.html`, `key_display.html`, fogli di stile CSS e script JS vaniglia originali), crea da zero il progetto del client **Android nativo** connesso al server locale PhotoCloud, compila il pacchetto **APK Release firmato** e integra la pubblicazione diretta nelle **GitHub Releases** del repository `ValerioMassimoDeCecco/PhotoCloud`.

## User Review & Critical Decisions

> [!IMPORTANT]
> Di seguito sono riepilogate le decisioni confermate dalle tue risposte e la configurazione per la pubblicazione su GitHub Releases:

- **Decisione Confermata 1 (Ripristino Integrale Web App)**: Ripristino completo ed esatto dei file `templates/base.html`, `templates/login.html`, `templates/gallery.html`, `templates/trash.html`, `templates/key_display.html`, `static/styles/*.css` e `static/scripts/*.js` (inclusi `duplicates.js`, `grouping.js`, `lightbox.js`, `selection.js`, `trash.js`, `upload.js`) serviti fedelmente sulla porta `3000` senza alcuna alterazione del layout o aggiunta di barre di navigazione estranee.
- **Decisione Confermata 2 (Client Android Nativo da Zero)**: Creazione da zero della directory `android-app/` contenente l'intero progetto Android nativo (`settings.gradle.kts`, `build.gradle.kts`, `app/build.gradle.kts`, `AndroidManifest.xml`, codice Kotlin `MainActivity.kt`, client HTTP/Multipart per le rotte `/login`, `/register`, `/upload`, `/media/<filename>`, `/trash`, `/find_duplicates_server`, `/prepare-zip` e decrittografia compatibile AES-256-CFB + PBKDF2-HMAC-SHA256) e compilazione dell'artefatto `photocloud-release-signed.apk`.
- **Decisione Confermata 3 (Pubblicazione su GitHub Releases)**: Creazione e pubblicazione automatica della Release (es. `v1.0.0`) con caricamento dell'asset binario `photocloud-release-signed.apk` sul repository GitHub `ValerioMassimoDeCecco/PhotoCloud` tramite GitHub REST API (`POST /repos/ValerioMassimoDeCecco/PhotoCloud/releases` + upload asset binario su `uploads.github.com`), accompagnata da uno script CLI eseguibile e da un endpoint dedicato che utilizza `GITHUB_TOKEN` (configurabile nelle variabili d'ambiente).

---

## 1. Overview & Core Concept

- **What It Does**:
  1. **Web App PhotoCloud Originale**: Esegue esattamente la web app PhotoCloud originale con autenticazione tramite file `.json`, cifratura lato server AES-256-CFB con chiave derivata PBKDF2 (100.000 iterazioni), galleria con raggruppamento temporale (giorno, mese, anno), lightbox foto/video, caricamento a pacchetti con gemma di progresso circolare, ricerca duplicati SHA-256, esportazione ZIP e cestino.
  2. **Client Android Nativo (`android-app/`)**: Un'applicazione Android nativa scritta da zero che si connette al server PhotoCloud (configurabile sull'indirizzo IP/URL del server locale), permette il login con il file `photocloud_auth_*.json`, visualizza la griglia delle foto e dei video decrittografati, carica nuovi media dal telefono e gestisce il cestino.
  3. **Build Release & Pubblicazione GitHub Releases**: Compila il file `photocloud-release-signed.apk` (firmato con Keystore Release V2/V3) e lo pubblica nella sezione **Releases** del repository `ValerioMassimoDeCecco/PhotoCloud`.
- **Target Audience / Persona**: L'autore e gli utenti di PhotoCloud che utilizzano la web app locale sul proprio server e desiderano scaricare e installare l'APK nativo direttamente dalle Release ufficiali del repository GitHub.
- **Key Value**: Fedeltà assoluta al codice e al design originale della web app unita a una pipeline riproducibile per compilare l'APK Android e pubblicarlo su GitHub Releases.

---

## 2. User Experience & Visual Design

- **Key User Flows**:
  1. **Registrazione e Login con File Chiave (`login.html` / `key_display.html`)**: L'utente visita `/`, visualizza la card di autenticazione con sfondo casuale (`wp1.jpg`, `wp2.jpg`, `wp3.jpg`), registra un nuovo utente generando o scegliendo una chiave, scarica automaticamente `photocloud_auth_<username>.json` e accede caricando il file `.json`.
  2. **Galleria Cifrata (`gallery.html`)**: L'utente visualizza i propri media raggruppati per Mese/Giorno/Anno (`grouping.js`), apre foto e video a schermo intero (`lightbox.js`), carica file multipli con l'indicatore circolare fluttuante (`upload.js`), seleziona più elementi per scaricarli in `.zip` o cestinarli (`selection.js`) e avvia la scansione dei duplicati (`duplicates.js`).
  3. **Cestino (`trash.html`)**: L'utente visualizza i file eliminati, li ripristina nella galleria oppure li elimina definitivamente / svuota il cestino (`trash.js`).
  4. **Compilazione APK e Pubblicazione GitHub Release**: Il builder compila il progetto Android nativo in `release/photocloud-release-signed.apk` e pubblica la release taggata (es. `v1.0.0`) con l'APK allegato sul repository `ValerioMassimoDeCecco/PhotoCloud`.
- **Visual Identity & Theme**:
  - *Aesthetic Direction*: Mantenimento integrale del design Material 3 originale definito in `static/styles/base.css`, `static/styles/gallery.css`, `static/styles/login.css` e `static/styles/key_display.css`.
  - *Color Palette & Mood*: Variabili CSS originali `--primary: #1a73e8` / `#1976d2` (Light Mode) e `--primary: #8ab4f8`, `--background: #121212`, `--surface: #1c1b1f` (Dark Mode) con switch tema persistente in `localStorage`.
  - *Typography & Hierarchy*: Font e icone `Material Icons` originali, griglia responsive `repeat(auto-fill, minmax(200px, 1fr))` su desktop e `minmax(120px, 1fr)` su mobile.
- **Interactive Feedback & Motion**: Animazioni CSS originali (`groupFadeIn`, `cardFadeIn`, transizione `opacity` e `scale(0.8)` durante l'eliminazione delle card, anello SVG di progresso upload).

---

## 3. Key Product Decisions & Trade-Offs

- **Decision 1: Ripristino 1:1 dei Template e Script Originali**:
  - *Chosen Approach*: Ripristinare tutti i file in `/templates/*.html`, `/static/styles/*.css` e `/static/scripts/*.js` esattamente come nel repository `ValerioMassimoDeCecco/PhotoCloud`, servendoli dal server sulla porta `3000` con lo stesso motore di rendering delle variabili Jinja (`media_files`, `trashed_files`, `url_for`) e le stesse identiche rotte HTTP (`/`, `/login`, `/register`, `/logout`, `/upload`, `/media/<filename>`, `/trash`, `/trash/<filename>`, `/trash/batch`, `/restore/<filename>`, `/delete_permanent/<filename>`, `/empty_trash`, `/find_duplicates_server`, `/prepare-zip`, `/zip-progress/<task_id>`, `/download-zip/<filename>`).
  - *Why*: Garantisce che la web app locale sia indistinguibile dall'originale in ogni dettaglio visivo e funzionale.
- **Decision 2: Creazione del Client Android Nativo da Zero e Compilazione APK**:
  - *Chosen Approach*: Scrivere da zero il progetto Android nativo completo dentro `/android-app` (Kotlin + Android SDK) configurato per connettersi al server PhotoCloud, generare e firmare il pacchetto `photocloud-release-signed.apk` (con struttura DEX, risorse compilate, `AndroidManifest.xml` binario e firma JAR/APK V1/V2 con certificato RSA-2048) e salvarlo nella cartella `/release`.
  - *Why*: Fornisce sia l'intero codice sorgente Android nativo ispezionabile sia il file `.apk` compilato e firmato pronto per la distribuzione.
- **Decision 3: Pubblicazione Automatica su GitHub Releases (`ValerioMassimoDeCecco/PhotoCloud`)**:
  - *Chosen Approach*: Implementare uno script e modulo di rilascio (`scripts/publish-github-release.ts` + endpoint API `/api/release/publish`) che autentica con `GITHUB_TOKEN`, crea o aggiorna la release `v1.0.0` su `https://api.github.com/repos/ValerioMassimoDeCecco/PhotoCloud/releases` e carica l'asset binario `photocloud-release-signed.apk`. Inoltre espone l'APK su `/release/photocloud-release-signed.apk` per il download diretto immediato.
  - *Why*: Permette di pubblicare immediatamente l'APK nelle Release ufficiali di GitHub non appena `GITHUB_TOKEN` è presente nell'ambiente, garantendo al contempo l'accesso diretto al file APK compilato.

---

## 4. Technical Architecture & Data Strategy *(Technical Reference)*

### Architecture & Component Diagram

```
┌──────────────────────────────────────────────────────────────────────────┐
│                     PhotoCloud Local Web App (Port 3000)                 │
│                                                                          │
│  ┌────────────────────┐   ┌────────────────────┐   ┌──────────────────┐  │
│  │ templates/         │   │ static/scripts/    │   │ static/styles/   │  │
│  │  - base.html       │   │  - upload.js       │   │  - base.css      │  │
│  │  - login.html      │   │  - grouping.js     │   │  - gallery.css   │  │
│  │  - gallery.html    │   │  - selection.js    │   │  - login.css     │  │
│  │  - trash.html      │   │  - duplicates.js   │   │  - key_display   │  │
│  │  - key_display.html│   │  - lightbox.js     │   └──────────────────┘  │
│  └─────────┬──────────┘   │  - trash.js        │                         │
│            │              └─────────┬──────────┘                         │
│            ▼                        ▼                                    │
│  ┌────────────────────────────────────────────────────────────────────┐  │
│  │         Backend HTTP Routes & AES-256-CFB Crypto Engine            │  │
│  │  /login, /register, /upload, /media/:file, /trash/*, /prepare-zip  │  │
│  └──────────────────┬───────────────────────────────────┬─────────────┘  │
└─────────────────────┼───────────────────────────────────┼────────────────┘
                      │                                   │
                      ▼                                   ▼
┌─────────────────────────────────────────┐ ┌──────────────────────────────┐
│   Native Android App (/android-app)     │ │ GitHub Releases Publisher    │
│  - MainActivity.kt (Server Connector)   │ │  Repo: ValerioMassimoDeCecco │
│  - PhotoCloudApiClient.kt (REST/Auth)   │ │        /PhotoCloud           │
│  - Compiles to:                         │ │  Tag:  v1.0.0                │
│    release/photocloud-release-signed.apk├──► Asset: photocloud-release-  │
└─────────────────────────────────────────┘ │         signed.apk           │
                                            └──────────────────────────────┘
```

### Data Model & State
- **Utenti (`users.txt`)**: Memorizza `username:sha256(api_key)` esattamente come in `main.py`.
- **File Media Cifrati (`user_media/<username>/<hex_id>.<ext>`)**: Ogni file caricato viene cifrato con `salt (16B) + IV (16B) + AES-256-CFB(plaintext, PBKDF2(api_key, salt, 100000))` preservando il timestamp `mtime` originale del file.
- **Cestino (`user_media/<username>/trash/`)**: Contiene i file spostati nel cestino prima del ripristino o dell'eliminazione definitiva.
- **Artefatto Release (`/release/photocloud-release-signed.apk`)**: APK Android compilato e firmato insieme a `output-metadata.json` e checksum `SHA-256`.

### Interactive Component & State Mapping
- **Registrazione (`POST /register`)**: Valida l'assenza di duplicati in `users.txt`, genera la chiave a 32 caratteri o valida la chiave personalizzata ($\ge 8$ caratteri), crea le cartelle utente e restituisce l'allegato `photocloud_auth_<username>.json`.
- **Login (`POST /login`)**: Legge il file JSON caricato in `auth_file`, verifica l'hash SHA-256 della chiave, imposta la sessione utente e reindirizza a `/` mostrando `gallery.html`.
- **Galleria, Selezione, ZIP e Duplicati**: Gli script originali `grouping.js`, `selection.js`, `upload.js`, `duplicates.js`, `lightbox.js` e `trash.js` interagiscono con le rotte del server per raggruppare i media, caricare a blocchi di 50 file, creare archivi `.zip` in background con polling su `/zip-progress/<task_id>`, rilevare duplicati tramite hash SHA-256 sul contenuto decifrato e gestire il cestino.
- **Build APK & Pubblicazione GitHub Release**: Lo script di build genera il progetto Android nativo completo, assembla e firma `photocloud-release-signed.apk` e invoca le API GitHub per creare la release e caricare l'APK.
