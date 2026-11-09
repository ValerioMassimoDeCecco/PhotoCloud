# PhotoCloud — Archivio Foto, Video, Visualizzatore Documenti & File Manager Cloud Crittografato (Web & Android Nativo v1.0.9)

**PhotoCloud** è una piattaforma self-hosted crittografata per l'archiviazione sicura e la consultazione immediata di **foto, video, documenti Office/PDF e qualsiasi tipo di file non-media** (PDF, DOCX, XLSX, PPTX, ODT, ODS, ODP, RTF, CSV, TXT, ZIP, APK, audio, codice, ecc.), composta da:
1. **Server & Web App Full-Stack** (Node.js / Express + TypeScript, compatibile con il formato crittografico originale Python; i nuovi file usano `AES-256-GCM` autenticato).
2. **App Android 100% Nativa (`com.valerio.photocloud`)** scritta in **Kotlin + Jetpack Compose (Material You 120Hz)** che comunica direttamente con il tuo server PhotoCloud.

> **Sicurezza e compatibilità:** la cifratura avviene sul server, non è end-to-end. Usare HTTPS anche per l’accesso Android: HTTP espone chiavi, sessioni e contenuti sulla rete. I nuovi file usano AES-GCM autenticato; i file precedenti AES-CFB restano leggibili ma non sono protetti da manomissioni e non vengono migrati automaticamente. Un backup prima dell’aggiornamento è consigliato.
>
> Il keystore e la password predefinita sono stati pubblicati: la chiave di firma va considerata compromessa. Generarne una nuova e conservarla fuori dalla repository; cambiare firma può impedire l’aggiornamento diretto delle installazioni esistenti. Gli ZIP esportati restano temporaneamente in chiaro nella memoria del server (fino al download o per un’ora); eventuali ZIP lasciati dalle versioni precedenti in `temp_zips/` vanno rimossi manualmente. Gli endpoint HTTP per pubblicare release sono disabilitati: utilizzare la CLI o il workflow manuale. L’app web servita da Express è quella basata su template; il frontend React nella repository è sperimentale e non è collegato al server.

---

## 🚀 Novità Principali della Release `v1.0.9`

### 1. Indicatore Discreto dei Trasferimenti & Chiusura Automatica (Web & Android APK)
- **Nessuna Apertura Automatica Intrusiva**: quando parte un caricamento (Upload), uno scaricamento (Download singolo o pacchetto ZIP) o il salvataggio di una foto modificata, **la schermata dei trasferimenti NON si apre più automaticamente**, lasciando libera la navigazione tra Galleria, File Manager Cloud, Cestino e Impostazioni.
- **Icona Discreta Persistente con Animazione**: durante i trasferimenti attivi compare nell'header in alto a destra una **piccola icona dedicata** con anello di avanzamento circolare, animazione pulsante discreta e velocità aggregata in tempo reale (`KB/s` o `MB/s`).
- **Gestione Trasferimenti Multipli e Simultanei**:
  - Se sono attivi più trasferimenti contemporaneamente, l'icona mostra un **badge numerico** con la quantità esatta di trasferimenti in corso.
  - Cliccando sull'icona si apre la schermata fluttuante dei trasferimenti con percentuale di completamento, velocità, dimensione trasferita / totale e pulsante per **annullare** singole operazioni in corso o pulire lo storico.
- **Chiusura Automatica Intelligente & Scomparsa dell'Indicatore**:
  - La schermata dei trasferimenti rimane aperta finché esiste almeno un trasferimento attivo (`RUNNING`).
  - Non appena **tutti i trasferimenti attivi sono terminati** (completati, annullati o falliti), **la schermata dei trasferimenti si chiude automaticamente** (dopo una breve transizione di `600 ms`) e l'icona discreta scompare dall'header senza interrompere alcuna operazione in background.

### 2. Apertura Intelligente dei File Anziché Download Automatico
- Cliccando o toccando un file nel **File Manager Cloud** o nella **Galleria**, **non viene più avviato il download forzato nella cartella Download**.
- Il sistema ispeziona l'**estensione reale** e il **MIME type** del file:
  1. **Formato supportato dal Visualizzatore Integrato**: il file viene decrittato al volo e **aperto direttamente all'interno dell'applicazione** (Web o Android).
  2. **Formato non supportato internamente o scelta "Apri con..."**:
     - **Su Android (`FileProvider` + `content://` URI)**: il file viene recuperato nella cache privata dell'app e condiviso in sicurezza tramite `androidx.core.content.FileProvider` (`authority: com.valerio.photocloud.fileprovider`) invocando il selettore nativo di sistema (`Intent.ACTION_VIEW` + `Intent.createChooser`). Non vengono mai utilizzati URI `file://` deprecati. Se sul dispositivo non esistono applicazioni compatibili installate, viene mostrato un avviso chiaro con la possibilità di scaricare manualmente il file nella cartella `Download`.
     - **Su Web**: viene mostrato il pannello di apertura esterna con supporto alla condivisione nativa del sistema operativo (`navigator.share` / handler del browser) o scaricamento manuale su richiesta.

### 3. Motore Integrato di Visualizzazione Documenti (Web & Android APK)
Il nuovo motore (`src/lib/documentEngine.ts` + `/api/document-preview/:filename` + `static/scripts/document-viewer.js` su Web e `NativeDocumentViewerModal` su Android) permette di aprire direttamente nell'app:

| Categoria | Estensioni Supportate | Funzionalità del Visualizzatore Integrato |
| :--- | :--- | :--- |
| **PDF** | `.pdf` | **Android**: rendering nativo ad alta definizione tramite `android.graphics.pdf.PdfRenderer` con zoom (`75%`–`300%`), scorrimento continuo e navigazione tra le pagine (`Prec.` / `Succ.`).<br>**Web**: visualizzatore PDF inline con controlli di pagina, salto rapido a pagina specifica e zoom (`60%`–`240%`). Supporto `HTTP Range (206 Partial Content)` per documenti di grandi dimensioni. |
| **Word & Testo Formattato** | `.doc`, `.docx`, `.odt`, `.rtf` | Estrazione strutturata di titoli (`Heading`), paragrafi e liste puntate da pacchetti OpenXML/ODF e flussi RTF/DOC, con vista pagina tipografica, **ricerca nel testo con evidenziazione** e controllo **zoom del carattere**. |
| **Excel & Fogli di Calcolo** | `.xls`, `.xlsx`, `.ods`, `.csv`, `.tsv` | Lettura multi-foglio (schede `Foglio 1`, `Foglio 2`, ecc.), intestazioni di colonna fisse (`sticky header`), **filtro di ricerca righe in tempo reale** e scorrimento bidimensionale fluido. |
| **PowerPoint & Presentazioni** | `.ppt`, `.pptx`, `.odp` | Visualizzatore slide 16:9 con barra laterale delle miniature (su Web), navigazione `Slide Prec. / Succ.`, elenco puntato dei contenuti della diapositiva e visualizzazione delle **Note del relatore**. |
| **Testo & Codice Sorgente** | `.txt`, `.md`, `.json`, `.xml`, `.yaml`, `.yml`, `.html`, `.css`, `.js`, `.ts`, `.py`, `.kt`, `.java`, `.c`, `.cpp`, `.sql`, `.sh`, `.log`, `.ini` | Visualizzatore monospace con **numerazione delle righe**, filtro rapido per riga e pulsante **Copia testo**. |
| **Immagini** | `.png`, `.jpg`, `.jpeg`, `.webp`, `.gif`, `.svg`, `.bmp`, `.avif` | Apertura nella Lightbox a schermo intero con **pinch-to-zoom**, navigazione swipe e accesso diretto al **Photo Editor Studio**. |
| **Audio & Video** | `.mp3`, `.wav`, `.ogg`, `.m4a`, `.flac`, `.aac`, `.mp4`, `.webm`, `.mov`, `.mkv` | Player audio e video integrato (`MediaPlayer` / `VideoView` su Android e player HTML5 con streaming `Range` su Web). |
| **Archivi & Pacchetti Esterni** | `.apk`, `.zip`, `.rar`, `.7z`, `.iso`, `.dmg`, `.exe`, ecc. | Selettore applicazioni nativo del dispositivo (`FileProvider` su Android) o proposta di download manuale se nessuna app compatibile è installata. |

#### Limitazioni Note dei Visualizzatori Integrati e Fallback
- **File Office binari legacy (`.doc`, `.xls`, `.ppt` pre-2007) o protetti da password**: per i formati binari legacy non-XML viene estratto il testo leggibile disponibile e mostrato un avviso informativo; per visualizzare layout complessi, macro, grafici embedded o animazioni avanzate è sempre presente nella barra superiore del visualizzatore il pulsante **"Apri con..."**, che delega l'apertura a Microsoft Office, Collabora, Google Documenti o qualsiasi altra app installata sul dispositivo.
- **Fogli di calcolo di grandi dimensioni**: per evitare blocchi dell'interfaccia utente (`UI freeze`), l'anteprima tabellare in-app carica fino a `1.500` righe per foglio con filtro istantaneo; il file completo resta sempre apribile in un'app esterna o scaricabile integralmente.

---

## ✨ Riepilogo Completo delle Altre Funzionalità

### 🔐 Sicurezza, Crittografia & Biometria
- **Crittografia sul server (`AES-256-GCM` + `PBKDF2-HMAC-SHA256` a 100.000 iterazioni)**: ogni foto, video o documento viene cifrato prima di essere scritto nella cartella `user_media/<username>` con salt e IV dedicati.
- **Autenticazione tramite File Chiave (`.json`)**: accesso immediato caricando il file chiave `photocloud_auth_<username>.json` generato in fase di registrazione.
- **Sblocco Biometrico Nativo (`BiometricPrompt`)**: su Android puoi sbloccare l'archivio con **impronta digitale o riconoscimento facciale**, con opzione di **blocco automatico in background**.
- **Schermo Sicuro Anti-Screenshot (`FLAG_SECURE`)**: opzione attivabile dalle impostazioni Android.

### 🪄 Photo Editor Studio Integrato & Griglia di Ritaglio Manuale Trascinabile (Web & APK)
- **Griglia di Ritaglio Manuale Trascinabile Immediata all'Apertura**: entrando in **Modifica Foto**, si attiva subito la griglia 3×3 trascinabile con **8 maniglie tattili** (4 angoli + 4 lati), trascinamento interno e risoluzione in pixel in tempo reale.
- **7 Filtri Fotografici & Regolazioni Fine**: `Originale`, `Vivido`, `Bianco & Nero`, `Seppia`, `Cinema`, `Freddo`, `Vintage` + slider `Luminosità`, `Contrasto`, `Saturazione`, `Calore`, rotazione `-90°/+90°` e specchiatura.
- **Salvataggio Crittografato**: `Salva Copia` o `Sovrascrivi` originale.

### 🖼️ Galleria 120Hz, Album, Drag-to-Select & Strumenti
- **Raggruppamento per Giorno, Mese, Anno o Album** con creazione, assegnazione multipla e filtro rapido per Album.
- **Selezione Multipla `Drag-to-Select`** sulla griglia con auto-scroll e feedback aptico.
- **Ricerca Duplicati SHA-256**, **Cestino con ripristino/eliminazione definitiva** ed **Esportazione ZIP**.

---

## 📦 Dipendenze Principali del Progetto

### Server & Web App (`package.json`)
- **`express` (`^5.3.0`) & `multer` (`^2.5.0`)**: server HTTP, gestione sessioni, streaming media con supporto `Range` e upload multipart.
- **`jszip` (`^3.10.2`)**: utilizzato sia per l'esportazione massiva di archivi `.zip` sia dal nuovo motore **`src/lib/documentEngine.ts`** per ispezionare e decodificare in memoria i contenitori OpenXML (`.docx`, `.xlsx`, `.pptx`) e OpenDocument (`.odt`, `.ods`, `.odp`) senza introdurre dipendenze native pesanti o obsolete.
- **`vite` & `typescript`**: compilazione asset frontend e verifica statica dei tipi.

### App Android Nativa (`android-app/app/build.gradle.kts`)
- **Android SDK 35 / Kotlin 2.0 / Java 17**: compilazione nativa con Jetpack Compose (`androidx.compose:compose-bom:2024.10.01`) e Material 3.
- **`androidx.core:core-ktx:1.13.1`**: include `androidx.core.content.FileProvider` per la condivisione sicura di `content://` URI verso applicazioni esterne.
- **API Native Android (`android.graphics.pdf.PdfRenderer` & `android.media.MediaPlayer`)**: utilizzate per il rendering nativo ad alta definizione dei PDF e la riproduzione audio senza appesantire l'APK con librerie di terze parti ridondanti.
- **`com.squareup.okhttp3:okhttp:4.12.0` & `androidx.biometric:biometric:1.1.0`**: networking con cookie store persistente, tracking velocità di trasferimento e autenticazione biometrica.

---

## 💻 Come Scaricare, Compilare ed Avviare il Progetto sui Vari Sistemi Operativi

### 🪟 1. Windows (Windows 10 / Windows 11)

1. Installa **Node.js (20.19+ o 22.12+)** da [https://nodejs.org](https://nodejs.org) e **Git** da [https://git-scm.com/download/win](https://git-scm.com/download/win).
2. Apri **PowerShell** ed esegui:
   ```powershell
   git clone https://github.com/ValerioMassimoDeCecco/PhotoCloud.git
   cd PhotoCloud
   npm install
   npm run dev
   ```
3. Per avviare in **modalità produzione**:
   ```powershell
   npm run build
   npm start
   ```
4. Apri il browser su **`http://localhost:3000`**. Per collegare lo smartphone Android sulla stessa rete Wi-Fi, trova l'IPv4 del PC con `ipconfig` (es. `192.168.1.50`) e inserisci `http://192.168.1.50:3000` nell'app Android.

---

### 🍎 2. macOS (Intel & Apple Silicon M1 / M2 / M3 / M4)

1. Installa Node.js e Git (`brew install node git`).
2. Apri il **Terminale** ed esegui:
   ```bash
   git clone https://github.com/ValerioMassimoDeCecco/PhotoCloud.git
   cd PhotoCloud
   npm install
   npm run dev
   ```
3. Per la build di produzione:
   ```bash
   npm run build
   npm start
   ```
4. Apri **`http://localhost:3000`**. Per collegare l'app Android via Wi-Fi usa l'IP restituito da `ipconfig getifaddr en0`.

---

### 🐧 3. Linux (Ubuntu / Debian, Fedora, Arch Linux)

1. Installa **Node.js 20+** e **Git**:
   ```bash
   # Ubuntu / Debian
   sudo apt update && sudo apt install -y curl git build-essential
   curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
   sudo apt install -y nodejs
   ```
2. Clona e avvia il server:
   ```bash
   git clone https://github.com/ValerioMassimoDeCecco/PhotoCloud.git
   cd PhotoCloud
   npm install
   npm run dev
   ```
3. Per avviare in produzione (es. sulla porta `3000` o `5000`):
   ```bash
   npm run build
   PORT=3000 npm start
   ```

---

### 🤖 4. Android (Installazione APK `v1.0.9` & Compilazione da Sorgente)

#### Opzione A: Installare l'APK Firmato Pronto (`v1.0.9`)
1. Scarica **`photocloud-release-v1.0.9-signed.apk`** dalla sezione **[Releases di GitHub](https://github.com/ValerioMassimoDeCecco/PhotoCloud/releases)** oppure dalla cartella locale `/release/photocloud-release-v1.0.9-signed.apk`.
2. Apri il file `.apk` sul tuo dispositivo Android per installarlo o aggiornare direttamente una versione precedente (`v1.0.4`–`v1.0.8`) senza perdere dati o configurazioni.
3. Tocca il badge **Server** in alto a destra per inserire l'URL del tuo server PhotoCloud (`http://<IP-SERVER>:3000`), effettua il login con il tuo file `.json` e apri direttamente qualsiasi foto, video, PDF o documento Office.

#### Opzione B: Compilare l'APK da Sorgente con Gradle
```bash
# Compilazione diretta tramite Gradle (richiede JDK 17 e Android SDK 35)
cd android-app
gradle assembleRelease --no-daemon

# Oppure tramite lo script integrato che genera e verifica /release/photocloud-release-v1.0.9-signed.apk
npm run release:apk
```

---

## 🛠️ Script NPM Disponibili

| Comando | Descrizione |
| :--- | :--- |
| `npm run dev` | Avvia il server full-stack Express + Vite in modalità sviluppo sulla porta `3000`. |
| `npm run build` | Compila i bundle frontend ottimizzati per la produzione. |
| `npm start` | Avvia il server Node.js/TypeScript in modalità produzione. |
| `npm test` | Esegue la suite di test automatici (crittografia AES-256, deduplicazione SHA-256, Photo Editor Math & Manual Crop Grid, Document Viewer Engine per PDF/DOCX/XLSX/PPTX/CSV, template e configurazione Android `v1.0.9`). |
| `npm run lint` | Verifica statica dei tipi TypeScript (`tsc --noEmit`). |
| `npm run release:apk` | Compila l'APK firmato `/release/photocloud-release-v1.0.9-signed.apk` tramite Gradle e Android SDK; se `GITHUB_TOKEN` è presente nel sistema, sincronizza e avvia anche la GitHub Action di release. |

---

## 📂 Struttura del Progetto

```text
PhotoCloud/
├── .github/workflows/
│   └── android-release.yml       # Pipeline CI/CD GitHub Actions (JDK 17 + Android SDK 35 + Gradle 8.10.2) per v1.0.9
├── android-app/                  # Progetto Nativo Android (Kotlin + Jetpack Compose Material You 120Hz)
│   ├── app/
│   │   ├── photocloud-release-key.jks  # Keystore RSA-2048 per firma APK
│   │   ├── build.gradle.kts            # Configurazione SDK 35, Compose, OkHttp, Biometric, versione 1.0.9 (versionCode 10)
│   │   └── src/main/
│   │       ├── AndroidManifest.xml     # Permessi, FileProvider (content:// URI) e alias icone (Colorata + B/W)
│   │       ├── java/com/valerio/photocloud/
│   │       │   ├── MainActivity.kt          # UI Nativa 120Hz, Indicatore Trasferimenti Discreto con Auto-Close, NativeDocumentViewerModal (PdfRenderer, Word, Excel, PPT, Codice, Audio), Photo Editor Studio
│   │       │   └── PhotoCloudApiClient.kt   # Client HTTP, cache 0ms, preview documenti, FileProvider chooser e tracker velocità
│   │       └── res/
│   │           ├── xml/file_paths.xml       # Percorsi autorizzati per FileProvider
│   │           └── drawable/                # Icone Launcher Colorata e Monocromatica
├── release/
│   ├── photocloud-release-v1.0.9-signed.apk # Pacchetto APK firmato pronto per l'installazione
│   └── photocloud-release-build.json        # Metadati e checksum SHA-256 della build
├── src/
│   ├── lib/
│   │   ├── crypto.ts                   # Motore AES-256-GCM + PBKDF2-HMAC-SHA256 + deduplicazione SHA-256
│   │   ├── documentEngine.ts           # Motore di ispezione MIME e parsing documenti (PDF, DOCX, XLSX, PPTX, ODF, RTF, CSV, Codice)
│   │   ├── photoEditorMath.ts          # Logica pura filtri, trasformazioni colore RGB, rotazione e ritaglio manuale
│   │   ├── templateRenderer.ts         # Renderer HTML (Galleria, File Manager Cloud, Document Viewer Modal, Indicatore Trasferimenti)
│   │   ├── githubReleasePublisher.ts   # Compilatore Gradle APK e integrazione GitHub Releases / Actions
│   │   └── crypto.test.ts              # Suite di test unitari e di integrazione
│   └── types.ts                        # Tipi TypeScript condivisi
├── static/
│   ├── scripts/                        # Logica client Web (document-viewer.js, upload.js, photo-editor.js, grouping.js, lightbox.js)
│   └── styles/                         # Fogli di stile Material You (base.css, gallery.css, login.css)
├── server.ts                           # Server Express principale (API Media, Document Preview, Photo Edit, File Cloud, Album, ZIP, Auth)
└── package.json
```
