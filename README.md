# PhotoCloud — Archivio Foto, Video & File Manager Cloud Crittografato (Web & Android Nativo v1.0.7)

**PhotoCloud** è una piattaforma self-hosted crittografata per l'archiviazione sicura di **foto, video e qualsiasi tipo di file non-media** (PDF, ZIP, APK, documenti Office, audio, codice, ecc.), composta da:
1. **Server & Web App Full-Stack** (Node.js / Express + TypeScript, legge il formato crittografico originale Python; i nuovi file usano un formato autenticato non leggibile dalle vecchie versioni).
2. **App Android 100% Nativa (`com.valerio.photocloud`)** scritta in **Kotlin + Jetpack Compose (Material You 120Hz)** che comunica direttamente con il tuo server PhotoCloud.


> **Sicurezza e compatibilità:** la cifratura avviene sul server, non è end-to-end. Usare HTTPS anche per l’accesso Android: HTTP espone chiavi, sessioni e contenuti sulla rete. I nuovi file usano AES-GCM autenticato; i file precedenti AES-CFB restano leggibili ma non sono protetti da manomissioni e non vengono migrati automaticamente. Un backup prima dell’aggiornamento è consigliato.
>
> Il keystore e la password predefinita sono stati pubblicati: la chiave di firma va considerata compromessa. Generarne una nuova e conservarla fuori dalla repository; cambiare firma può impedire l’aggiornamento diretto delle installazioni esistenti. Gli ZIP esportati restano temporaneamente in chiaro nella memoria del server (fino al download o per un’ora); eventuali ZIP lasciati dalle versioni precedenti in `temp_zips/` vanno rimossi manualmente. Gli endpoint HTTP per pubblicare release sono disabilitati: utilizzare la CLI o il workflow manuale. L’app web servita da Express è quella basata su template; il frontend React nella repository è sperimentale e non è collegato al server.

---

## ✨ Tutte le Funzionalità (Aggiornato alla Release `v1.0.7`)

### 🔐 Sicurezza, Crittografia & Biometria
- **Crittografia sul server (`AES-256-GCM` + `PBKDF2-HMAC-SHA256` a 100.000 iterazioni)**: ogni foto, video o documento viene cifrato prima di essere scritto nella cartella `user_media/<username>` con salt e IV dedicati.
- **Autenticazione tramite File Chiave (`.json`)**: accesso immediato caricando il file chiave `photocloud_auth_<username>.json` generato in fase di registrazione (con chiave casuale a 32 caratteri o chiave personalizzata).
- **Sblocco Biometrico Nativo (`BiometricPrompt`)**: su Android puoi sbloccare l'archivio e accedere al tuo account con **impronta digitale o riconoscimento facciale**, con opzione di **blocco automatico quando l'app va in background**.
- **Schermo Sicuro Anti-Screenshot (`FLAG_SECURE`)**: opzione attivabile dalle impostazioni per impedire screenshot e oscurare l'anteprima dell'app nel multitasking di Android.

### ⚡ Prestazioni 120Hz & Avvio Istantaneo a 0ms
- **Zero Cerchio di Caricamento all'Avvio (0ms Instant Startup)**: l'app Android idrata in modo sincrono lo stato della sessione e la cache locale di miniature e metadati nel primo frame, mostrando istantaneamente la Galleria o il Login mentre sincronizza silenziosamente in background.
- **Motore UI a 120Hz**: negoziazione automatica del refresh rate massimo del display su Android e animazioni fluide Material You.

### 🖼️ Galleria Media, Raggruppamento per Album & Drag-to-Select
- **Raggruppamento Intelligente**: raggruppa foto e video per **Tutti**, **Giorno**, **Mese**, **Anno** oppure per **Album**.
- **Gestione Album Completa (Web & APK)**:
  - Crea nuovi album personalizzati (es. *Vacanze*, *Famiglia*, *Lavoro*).
  - Assegna o rimuovi più foto, video o file contemporaneamente tramite il pulsante **Album** nella barra di selezione.
  - Filtra istantaneamente la galleria tramite i chip degli album.
- **Selezione Multipla tramite Trascinamento (`Drag-to-Select`)**: tieni premuto su una foto e trascina il dito sulla griglia per selezionare o deselezionare rapidamente interi blocchi di elementi, con **auto-scroll** ai bordi e **feedback aptico a 120Hz**.
- **Lightbox Nativa a Schermo Intero**: swipe fluido (`HorizontalPager`), doppio tocco e **pinch-to-zoom fino a 4x**, e player video nativo con controlli e autoplay configurabile.

### 🪄 Photo Editor Studio Integrato (Web & App Android)
- **Editing Fotografico Non-Distruttivo o Diretto**: apri qualsiasi foto nella Lightbox (o premi l'icona di modifica rapida sulla miniatura) e tocca **Modifica Foto** sia nella Web App sia nell'App Android nativa.
- **7 Filtri Fotografici Istantanei**: `Originale`, `Vivido`, `Bianco & Nero`, `Seppia`, `Cinema`, `Freddo` e `Vintage`.
- **Regolazioni Fine in Tempo Reale**: slider ad alta precisione (`-100` a `+100`) per **Luminosità**, **Contrasto**, **Saturazione** e **Calore (Temperatura Colore)**.
- **Trasformazione & Ritaglio Proporzioni**: rotazione rapida (`-90°` / `+90°`), specchiatura **Orizzontale** e **Verticale**, e ritaglio centrato con rapporti d'aspetto `Libero`, `1:1 Quadrato`, `4:5 Ritratto`, `4:3 Foto` e `16:9 Cinema`.
- **Salvataggio Crittografato (`AES-256-GCM`)**: scegli se **Salvare una Nuova Copia** (mantenendo lo stesso album della foto originale) oppure **Sovrascrivere l'Originale** direttamente sul server cifrato, con monitoraggio della velocità nel Centro Trasferimenti in alto a destra.

### 📁 File Manager Cloud (Supporto Qualsiasi File Non-Media)
- **Caricamento Universale**: oltre a foto e video, puoi caricare su Web e APK **qualsiasi file non-media** (`PDF`, `DOCX`, `XLSX`, `PPTX`, `ZIP`, `RAR`, `7Z`, `APK`, `MP3`, `FLAC`, `JSON`, `TXT`, `PY`, `KT`, ecc.).
- **Sezione "File" nella Floating Bar**:
  - Raggruppa automaticamente i file non-media per categoria: **Documenti & PDF**, **Archivi, ZIP & APK**, **Audio & Musica**, **Codice & Dati** e **Altri File Cloud**.
  - Mostra badge con estensione del file, dimensione reale (`KB` / `MB` / `GB`), data di caricamento, eventuale badge Album e pulsante di download rapido.
  - Ricerca istantanea per nome file e filtri rapidi per categoria.

### ⇅ Centro Trasferimenti Floating in Alto a Destra
- **Icona Upload/Download in Alto a Destra**: posizionata nell'header superiore sia su Web sia sull'App Android, con anello circolare di avanzamento e badge della velocità in tempo reale.
- **Menu Floating delle Operazioni in Corso**: cliccando o toccando l'icona in alto a destra si apre il pannello fluttuante con tutte le operazioni di caricamento (Upload) e scaricamento (Download singoli e pacchetti ZIP) con:
  - **Velocità attuale in tempo reale** (`KB/s` o `MB/s`).
  - **Dimensione trasferita / Dimensione totale** (es. `18.4 MB / 64.0 MB`).
  - **Percentuale esatta e barra di progresso** per ogni operazione.

### 🎨 Menu Impostazioni, Personalizzazione & Doppia Icona App
- **Icona App Colorata o Bianco & Nero**: scegli direttamente dalle Impostazioni dell'app Android se mostrare nel launcher l'icona **Colorata (Viola Notte)** oppure l'icona **Bianco & Nero (Monocromatica)**.
- **Personalizzazione Tema & Griglia**:
  - Modalità **Sistema**, **Chiaro** o **Scuro** + **Nero Puro AMOLED (`#000000`)**.
  - **Colori Dinamici Material You** (Android 12+) oppure **6 Palette Accento** (*Viola Notte*, *Blu Oceano*, *Smeraldo*, *Ambra Solare*, *Rosa Corallo*, *Bianco & Nero*).
  - Scelta del **numero di colonne (da 2 a 5)**, **spaziatura miniature (`1–10 dp`)**, **arrotondamento angoli (`0–24 dp`)**, proporzioni **Quadrato 1:1** o **Ritratto 4:5**, e ordinamento (*Più recenti*, *Più vecchi*, *Nome A-Z*).
  - Personalizzazione della **Floating Bar inferiore** (etichette testo on/off, modalità compatta, feedback aptico, conferma prima di cestinare).
- **Strumenti Integrati**: **Ricerca Duplicati SHA-256** sul server, **Cestino con ripristino o eliminazione definitiva**, ed **Esportazione massiva in formato `.zip`**.
- **Firma APK Persistente (`photocloud-release-key.jks`)**: tutte le versioni APK (`v1.0.4`, `v1.0.5`, `v1.0.6` e successive) utilizzano lo stesso keystore RSA-2048 per permettere l'aggiornamento diretto dell'app su Android senza mai dover disinstallare la versione precedente.

---

## 💻 Come Scaricare ed Avviare il Progetto sui Vari Sistemi Operativi

Di seguito trovi le istruzioni passo-passo per scaricare ed eseguire il server e l'interfaccia Web di **PhotoCloud** su **Windows**, **macOS**, **Linux** e come installare e collegare l'**App Android (`.apk`)**.

---

### 🪟 1. Windows (Windows 10 / Windows 11)

#### Prerequisiti
1. Scarica e installa **Node.js (versione 20.19+ oppure 22.12+)** da [https://nodejs.org](https://nodejs.org) (include `npm`).
2. Scarica e installa **Git per Windows** da [https://git-scm.com/download/win](https://git-scm.com/download/win) (oppure scarica direttamente il file `.zip` del repository da GitHub).

#### Scaricare ed Avviare il Progetto (PowerShell o Prompt dei Comandi)
Apri **PowerShell** o il **Terminale di Windows** ed esegui:

```powershell
# 1. Clona il repository da GitHub
git clone https://github.com/ValerioMassimoDeCecco/PhotoCloud.git

# 2. Entra nella cartella del progetto
cd PhotoCloud

# 3. Installa tutte le dipendenze
npm install

# 4. Avvia il server PhotoCloud in modalità sviluppo (porta 3000)
npm run dev
```

Per avviarlo in **modalità produzione** su Windows:
```powershell
npm run build
npm start
```

- Apri il browser su: **`http://localhost:3000`**
- **Per collegare l'app Android nella stessa rete Wi-Fi**:
  1. Scopri l'indirizzo IP locale del tuo PC Windows eseguendo `ipconfig` in PowerShell (cerca *Indirizzo IPv4*, es. `192.168.1.50`).
  2. Quando Windows Firewall mostra l'avviso per Node.js, consenti l'accesso sulle **Reti private**.
  3. Nell'app Android tocca il pulsante del server in alto a destra e inserisci `http://192.168.1.50:3000` (o `:5000` se usi la porta 5000).

---

### 🍎 2. macOS (Intel & Apple Silicon M1 / M2 / M3 / M4)

#### Prerequisiti
Puoi installare `git` e `node` tramite **Homebrew** oppure dal sito ufficiale di Node.js:

```bash
# Se hai Homebrew installato:
brew install node git
```

#### Scaricare ed Avviare il Progetto (Terminale)
Apri l'app **Terminale** ed esegui:

```bash
# 1. Clona il repository
git clone https://github.com/ValerioMassimoDeCecco/PhotoCloud.git

# 2. Entra nella directory
cd PhotoCloud

# 3. Installa le dipendenze
npm install

# 4. Avvia il server PhotoCloud
npm run dev
```

Per l'avvio in **produzione** su macOS:
```bash
npm run build
npm start
```

- Apri Safari o Chrome su: **`http://localhost:3000`**
- **Per collegare l'app Android nella stessa rete Wi-Fi**:
  1. Trova l'IP locale del tuo Mac con:
     ```bash
     ipconfig getifaddr en0
     ```
  2. Inserisci `http://<TUO-IP-MAC>:3000` nelle impostazioni server dell'app Android.

---

### 🐧 3. Linux (Ubuntu / Debian, Fedora, Arch Linux)

#### Prerequisiti
Installa **Node.js (20.19+ oppure 22.12+)** e **Git** con il gestore pacchetti della tua distribuzione:

- **Ubuntu / Debian / Linux Mint**:
  ```bash
  sudo apt update
  sudo apt install -y curl git build-essential
  curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
  sudo apt install -y nodejs
  ```
- **Fedora / RHEL / CentOS**:
  ```bash
  sudo dnf install -y nodejs npm git
  ```
- **Arch Linux / Manjaro**:
  ```bash
  sudo pacman -S nodejs npm git
  ```

#### Scaricare ed Avviare il Progetto
```bash
# 1. Clona il repository
git clone https://github.com/ValerioMassimoDeCecco/PhotoCloud.git

# 2. Entra nella cartella del progetto
cd PhotoCloud

# 3. Installa le dipendenze
npm install

# 4. Avvia il server
npm run dev
```

Per eseguire il server su una porta personalizzata (ad esempio `5000`) o in produzione:
```bash
npm run build
PORT=5000 npm start
```

- **Apertura porta sul Firewall Linux (per connettere lo smartphone Android via Wi-Fi)**:
  - Su Ubuntu/Debian con `ufw`:
    ```bash
    sudo ufw allow 3000/tcp
    ```
  - Su Fedora con `firewalld`:
    ```bash
    sudo firewall-cmd --add-port=3000/tcp --permanent && sudo firewall-cmd --reload
    ```
  - Trova l'IP locale della macchina Linux con `hostname -I` (es. `192.168.1.100`) e inserisci `http://192.168.1.100:3000` nell'app Android.

---

### 🤖 4. Android (Installazione APK Nativo & Compilazione da Sorgente)

#### Opzione A: Scaricare e Installare l'APK Pronto (`v1.0.7`)
1. Vai nella sezione **[Releases di GitHub](https://github.com/ValerioMassimoDeCecco/PhotoCloud/releases)** (oppure scarica l'APK generato nella cartella `/release/photocloud-release-v1.0.7-signed.apk`).
2. Scarica sul tuo telefono Android il file **`photocloud-release-v1.0.7-signed.apk`**.
3. Apri il file `.apk` per installarlo (se hai già installato la `v1.0.4`, `v1.0.5` o `v1.0.6`, Android aggiornerà direttamente l'app mantenendo tutti i tuoi dati, le impostazioni e la chiave biometrica poiché la firma `photocloud-release-key.jks` è identica).
4. All'apertura dell'app:
   - Tocca il badge **Server** in alto a destra (o vai in **Opzioni → Cambia Server**).
   - Inserisci l'indirizzo del tuo server PhotoCloud (es. `http://192.168.1.50:3000` su rete locale Wi-Fi, oppure `http://10.0.2.2:3000` se usi l'Emulatore Android sul PC).
   - Registrati o carica il tuo file chiave `.json` e attiva lo sblocco biometrico.

#### Opzione B: Compilare l'APK da Codice Sorgente (Windows, macOS, Linux)
Il codice sorgente completo dell'app Android nativa si trova nella cartella `/android-app`.

1. **Tramite Android Studio**:
   - Apri **Android Studio (Ladybug / Koala o superiore)** con **JDK 17** e **Android SDK 35**.
   - Seleziona **Open** e scegli la sottocartella `android-app` del progetto.
   - Attendi il completamento del Gradle Sync e premi **Run (`Shift + F10`)** o **Build → Generate Signed App Bundle / APK**.

2. **Tramite Riga di Comando (Gradle)**:
   ```bash
   cd android-app
   gradle assembleRelease --no-daemon
   ```
   L'APK firmato con il keystore persistente `android-app/app/photocloud-release-key.jks` verrà generato in:
   `android-app/app/build/outputs/apk/release/app-release.apk`.

---

## 🛠️ Script NPM Disponibili

| Comando | Descrizione |
| :--- | :--- |
| `npm run dev` | Avvia il server full-stack Express + Vite in modalità sviluppo sulla porta `3000`. |
| `npm run build` | Compila i bundle frontend ottimizzati per la produzione. |
| `npm start` | Avvia il server Node.js/TypeScript in modalità produzione. |
| `npm test` | Esegue la suite di test automatici (crittografia AES-256, deduplicazione SHA-256, Photo Editor Math, template, controlli del workflow e test di integrazione API). |
| `npm run lint` | Verifica statica dei tipi TypeScript (`tsc --noEmit`). |
| `npm run release:apk` | Compila il pacchetto APK firmato in `/release/photocloud-release-v1.0.7-signed.apk` tramite Gradle e Android SDK; con `GITHUB_TOKEN` può anche pubblicare e attivare il workflow. |

---

## 📂 Struttura del Progetto

```text
PhotoCloud/
├── .github/workflows/
│   └── android-release.yml       # Pipeline CI/CD GitHub Actions (JDK 17 + Android SDK 35 + Gradle 8.10.2)
├── android-app/                  # Progetto Nativo Android (Kotlin + Jetpack Compose Material You 120Hz)
│   ├── app/
│   │   ├── photocloud-release-key.jks  # Keystore persistente RSA-2048 per aggiornamenti APK diretti
│   │   ├── build.gradle.kts            # Configurazione SDK 35, Compose, OkHttp, Biometric, versione 1.0.7
│   │   └── src/main/
│   │       ├── AndroidManifest.xml     # Permessi, activity principale e alias icone (Colorata + B/W)
│   │       ├── java/com/valerio/photocloud/
│   │       │   ├── MainActivity.kt          # UI Nativa 120Hz, Galleria, Photo Editor Studio, File Manager Cloud, Album
│   │       │   └── PhotoCloudApiClient.kt   # Client HTTP, cache 0ms, upload foto modificate e tracker velocità
│   │       └── res/drawable/
│   │           ├── ic_launcher_color.xml    # Icona App Colorata (Viola Notte)
│   │           └── ic_launcher_bw.xml       # Icona App Monocromatica (Bianco & Nero)
├── src/
│   ├── lib/
│   │   ├── crypto.ts                   # Motore AES-256-GCM (lettura legacy CFB) + PBKDF2-HMAC-SHA256 + deduplicazione SHA-256
│   │   ├── photoEditorMath.ts          # Logica pura filtri, trasformazioni colore RGB, rotazione e ritaglio
│   │   ├── templateRenderer.ts         # Renderer HTML (Galleria, Photo Editor Modal, File Manager Cloud, Album)
│   │   ├── githubReleasePublisher.ts   # Builder APK e integrazione API GitHub Releases / Actions
│   │   └── crypto.test.ts              # Suite di test automatici
│   └── types.ts                        # Tipi TypeScript condivisi
├── static/
│   ├── scripts/                        # Logica client Web (photo-editor.js, upload.js, grouping.js, lightbox.js...)
│   └── styles/                         # Fogli di stile Material You (base.css, gallery.css, login.css)
├── server.ts                           # Server Express principale (API Media, Photo Edit, File Cloud, Album, ZIP, Auth)
└── package.json
```
