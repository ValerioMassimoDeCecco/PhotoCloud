# PhotoCloud — Archivio Foto, Video, Categorizzazione AI On-Device, Visualizzatore Documenti & File Manager Cloud Crittografato (Web & Android Nativo v1.2.3)

**PhotoCloud** è una piattaforma self-hosted crittografata per l'archiviazione sicura e la consultazione immediata di **foto, video, documenti Office/PDF e qualsiasi tipo di file non-media** (PDF, DOCX, XLSX, PPTX, ODT, ODS, ODP, RTF, CSV, TXT, ZIP, APK, audio, codice, ecc.), composta da:
1. **Server & Web App Full-Stack** (Node.js / Express + TypeScript, compatibile con il formato crittografico originale Python; i nuovi file usano `AES-256-GCM` autenticato).
2. **App Android 100% Nativa (`com.valerio.photocloud`)** scritta in **Kotlin + Jetpack Compose (Material You 120Hz)** che comunica direttamente con il tuo server PhotoCloud e include **Categorizzazione Automatica delle Foto tramite AI Locale Facoltativa (On-Demand)** e **Sistema di Aggiornamento Automatico In-App**.

> **Sicurezza e compatibilità:** la cifratura avviene sul server, non è end-to-end. Usare HTTPS anche per l’accesso Android: HTTP espone chiavi, sessioni e contenuti sulla rete. I nuovi file usano AES-GCM autenticato; i file precedenti AES-CFB restano leggibili ma non sono protetti da manomissioni e non vengono migrati automaticamente. Un backup prima dell’aggiornamento è consigliato.
>
> Il keystore e la password predefinita sono stati pubblicati: la chiave di firma va considerata compromessa. Generarne una nuova e conservarla fuori dalla repository; cambiare firma può impedire l’aggiornamento diretto delle installazioni esistenti. Gli ZIP esportati restano temporaneamente in chiaro nella memoria del server (fino al download o per un’ora); eventuali ZIP lasciati dalle versioni precedenti in `temp_zips/` vanno rimossi manualmente. Gli endpoint HTTP per pubblicare release sono disabilitati: utilizzare la CLI o il workflow manuale. L’app web servita da Express è quella basata su template; il frontend React nella repository è sperimentale e non è collegato al server.

---

## ⚡ Novità Principali della Release `v1.2.3` (`versionCode 20`) — Modello AI Locale Facoltativo (Download su Richiesta) & Aggiornamento Automatico In-App

### 1. Modello AI Locale (`EfficientNet-Lite4`) Completamente Facoltativo (`AiModelDownloadManager.kt`)
- **APK Più Leggero & Nessun Download Automatico all'Avvio**: il modello `efficientnet_lite4.tflite` (~24,2 MB) è stato rimosso dagli asset interni dell'APK per ridurre il peso dell'installer (~56 MB invece di ~80 MB). L'app funziona integralmente senza modello AI installato e non avvia alcun download automatico al primo avvio.
- **Gestione Completa nelle Impostazioni (`Modello AI Locale — Facoltativo`)**:
  - Mostra chiaramente **stato di installazione**, **dimensione del download (`~24.2 MB`)**, **spazio libero richiesto (`>= 50 MB`)** e **spazio disponibile sul dispositivo** (`StatFs`).
  - **Download con Pausa, Ripresa (`HTTP Range`) e Annullamento**: barra di avanzamento in tempo reale, percentuale completata, velocità di trasferimento (`KB/s` o `MB/s`) e supporto `Range: bytes=<offset>-` su file `.part` sia da CDN Google MediaPipe sia dal server PhotoCloud (`/api/ai-model/efficientnet_lite4.tflite`).
  - **Eliminazione Modello per Liberare Spazio**: un apposito pulsante nelle Impostazioni rimuove il file `.tflite` dalla memoria interna del dispositivo e pulisce l'indice AI locale.

### 2. Sistema Automatico di Aggiornamento In-App (`AppAutoUpdater.kt`)
- **Controllo Silenzioso all'Avvio (`GitHub Releases` + Fallback Server PhotoCloud)**:
  - Ad ogni apertura dell'app viene interrogata l'API ufficiale di **GitHub Releases** (`repos/ValerioMassimoDeCecco/PhotoCloud/releases/latest`) con fallback automatico all'endpoint del server PhotoCloud (`/api/android/update-manifest`).
  - Se la versione installata è già allineata (`versionCode >= remote.versionCode`), non viene mostrata alcuna notifica o finestra superflua.
- **Download Automatico In-App Senza Browser Esterno (`AppUpdateModal`)**:
  - Quando viene rilevata una nuova versione, il download dell'APK parte automaticamente all'interno dell'app mostrando **numero della nuova versione**, **dimensione del file**, **barra di avanzamento**, **percentuale**, **velocità di download in tempo reale**, **changelog** e pulsante **Annulla**.
- **Verifica Crittografica SHA-256 & Compatibilità Firma Digitale X.509**:
  - Al termine del download viene verificato il **checksum SHA-256** dell'APK scaricato e confrontato il **certificato di firma X.509 (`PackageManager.getPackageArchiveInfo` + `GET_SIGNING_CERTIFICATES`)** con quello dell'app installata.
  - Solo se entrambe le verifiche hanno esito positivo viene aperta automaticamente la schermata ufficiale di installazione di Android tramite `FileProvider` (`Intent.ACTION_VIEW` + `REQUEST_INSTALL_PACKAGES`).

---

## ⚡ Novità Principali della Release `v1.2.2` (`versionCode 19`) — Selezione Multipla Drag-to-Select Perfezionata con Auto-Scroll su Android

### 1. Selezione Continua e Fluida con Pressione Prolungata (Long-Press + Drag)
- **Attivazione Intelligente e Immediata**: tenendo premuto su una qualsiasi foto della griglia, la modalità di selezione si attiva evidenziando l'elemento con bordo, scala elastica e checkbox Material You.
- **Trascinamento Sequenziale su più Righe e Colonne**: senza sollevare il dito, scorrendo sopra le altre miniature vengono selezionati automaticamente tutti gli elementi attraversati, calcolando con precisione millimetrica l'intervallo tra il punto di inizio e la posizione corrente.
- **Deselezione Naturale a Ritroso**: tornando indietro con il dito sulle immagini precedentemente attraversate, queste vengono deselezionate istantaneamente, evitando duplicazioni o selezioni errate.
- **Auto-Scroll Attivo**: quando il dito raggiunge la parte superiore (< 140dp) o inferiore dello schermo durante il drag, la griglia scorre automaticamente permettendo di estendere la selezione anche su migliaia di foto non visibili inizialmente.
- **Persistenza della Modalità Selezione al Rilascio**: al sollevamento del dito la modalità di selezione resta attiva con il pannello operativo `SelectionActionsPanel` (Sposta in Album, Scarica ZIP, Cestina), consentendo di rifinire la selezione con ulteriori tocchi singoli.

---

## ⚡ Novità Principali della Release `v1.2.0` (`versionCode 17`) — Categorizzazione Foto con AI Locale On-Device (`EfficientNet-Lite4`)

### 1. Motore AI On-Device Resiliente (`LocalPhotoCategorizer` + `efficientnet_lite4.tflite`)
- **100% Offline in `assets/efficientnet_lite4.tflite`**: basato su Google MediaPipe Tasks Vision (`com.google.mediapipe:tasks-vision:0.10.14`) con metadati integrati e `noCompress += "tflite"`.
- **Accelerazione Hardware GPU con Fallback Automatico su CPU (`Delegate.GPU` -> `Delegate.CPU`)**: inizializzazione protetta da `try-catch (Throwable)` contro errori JNI/OpenGL/Vulkan sui driver GPU del telefono e switch automatico a runtime su `Delegate.CPU` senza mai causare crash.
- **Pre-processing Anti-OOM & Rotazione EXIF**: decodifica tramite `BitmapFactory.Options` con `inSampleSize` dinamico fino a max `380x380px`, conversione esplicita a `Bitmap.Config.ARGB_8888` per `MPImage` e orientamento automatico tramite `ExifInterface`.
- **Inferenza Thread-Safe & Mappatura Semantica**: accesso sequenziale protetto da `Mutex` su `Dispatchers.Default` (`scoreThreshold = 0.55f`, `maxResults = 4`), pulizia delle etichette ImageNet e raggruppamento in macro-categorie (`Animali`, `Paesaggi`, `Persone`, `Cibo`, `Veicoli`, `Architettura`, `Documenti`, `Tecnologia`) oltre alle etichette specifiche capitalizzate.

### 2. Persistenza Room (`PhotoAiDatabase`) & Indicizzazione in Background (`PhotoAiIndexingWorker`)
- **Database SQLite/Room Reattivo (`PhotoAiEntity` & `PhotoAiDao`)**: espone `Flow` reattivi per tutte le categorie distinte ordinate per numero di foto, filtro istantaneo per categoria e stato di avanzamento (`analyzedCount / totalCount`).
- **Scansione Incrementale in Background (`WorkManager`)**: `PhotoAiIndexingWorker` scansiona sia `MediaStore.Images.Media.EXTERNAL_CONTENT_URI` (quando il permesso `READ_MEDIA_IMAGES` è concesso) sia le foto del vault PhotoCloud, eseguendo il diffing rispetto agli elementi già analizzati (`isAnalyzed = true`), aggiornando il database a blocchi (`batch`) e rilasciando sempre il puntatore nativo nel blocco `finally`.

### 3. UI Reattiva in Jetpack Compose (`MainActivity.kt`)
- **Barra Orizzontale di `FilterChip` Categorie AI**: mostra `"Tutte"`, le categorie rilevate dall'AI con il conteggio foto (es. `"Animali (12)"`, `"Paesaggi (8)"`) e il chip `"Rianalizza AI"` per sincronizzare su richiesta.
- **Banner di Progresso Non Invasivo**: mostra `"Indicizzazione AI in corso: X/Y foto..."` con `LinearProgressIndicator` e percentuale durante l'esecuzione del worker, scomparendo automaticamente al termine.
- **Badge AI nel Dettaglio Foto (`NativeLightboxModal`)**: mostra i tag AI assegnati alla singola foto direttamente nella vista a schermo intero.

---

## ⚡ Novità Principali della Release `v1.1.5` (`versionCode 16`) — Selezione a Trascinamento sui Media & Gesti Lightbox con Animazioni Coerenti (Web & Android APK)

### 1. Selezione a Trascinamento sui Media (`Drag-to-Select`)
- **Su Android APK (`MainActivity.kt` — `LazyVerticalGrid`)**:
  - Tenendo premuto su una foto/video e trascinando il dito sulla griglia viene selezionato o deselezionato l'intero intervallo di media attraversato, con feedback aptico ad ogni tessera e auto-scroll automatico vicino ai bordi superiore/inferiore.
  - Il gestore intercetta il trascinamento nel passaggio `PointerEventPass.Initial` e disabilita temporaneamente lo scroll verticale concorrente (`userScrollEnabled = currentTab == VaultTab.GALLERY && dragStartIndex == null`), evitando che la griglia interrompa la selezione durante il movimento verticale.
  - `findMediaFilenameAtOffset` aggancia automaticamente la tessera visibile più vicina quando il dito attraversa i margini tra le miniature.
- **Su Web App (`GalleryView.tsx` & `static/scripts/selection.js`)**:
  - Trascinamento con rettangolo di selezione traslucido (`.selection-marquee`) sui media della griglia, auto-scroll fluido vicino ai bordi del viewport e protezione anti-click accidentale al rilascio.

### 2. Gesti nella Navigazione tra le Foto con Animazioni Coerenti nel Lightbox
- **Su Android APK (`NativeLightboxModal`)**:
  - **Swipe orizzontale a 1 dito non bloccato**: sostituito `detectTransformGestures` (che consumava tutti i pan a 1 dito anche a zoom `1x` impedendo a `HorizontalPager` di scorrere) con un gestore multi-touch `awaitEachGesture` su misura che delega lo swipe orizzontale a `HorizontalPager` quando `zoomScale <= 1.02f`.
  - **Transizione coerente tra le pagine**: ogni pagina applica interpolazione `graphicsLayer` continua di scala (`0.88f..1f`), opacità (`0.55f..1f`) e traslazione parallasse in funzione di `pagerState.currentPageOffsetFraction`.
  - **Doppio tap per zoom (`1x` ↔ `2.5x`)**, **pinch-to-zoom a 2 dita (`1x..4x`)**, **swipe verticale per chiudere (dismiss)** con dissolvenza progressiva dello sfondo e pulsanti rapidi **Precedente / Successiva** con precaricamento in RAM delle foto adiacenti.
- **Su Web App (`LightboxModal.tsx` & `static/scripts/lightbox.js`)**:
  - Navigazione swipe touch/pointer con trascinamento in tempo reale, animazioni direzionali coerenti (`lightbox-animate-next-in`, `lightbox-animate-prev-in`), ritorno elastico (`lightbox-spring-reset`) e swipe verso il basso per chiudere (`lightbox-animate-dismiss`).

---

## ⚡ Novità Principali della Release `v1.1.3` (`versionCode 14`) — Fix APK: Controlli del Player Video nel Lightbox

### Controlli del Video di Nuovo Disponibili nel Visualizzatore a Schermo Intero
- **Problema**: toccando un video nella Galleria/Cestino si vedeva solo l'anteprima statica, senza alcun comando del player (niente play/pausa, seek bar o durata).
- **Causa**: nel lightbox (`NativeLightboxModal`) il ramo `Image(loadedBitmap)` veniva valutato **prima** del ramo video; dopo la v1.1.2 i video hanno sempre una miniatura in cache RAM, quindi il `VideoView` + `MediaController` non veniva mai creato.
- **Fix**:
  - Il ramo video viene ora valutato **per primo**: i video passano sempre da `VideoView` + `MediaController` — un tap sul video mostra/nasconde i controlli (play/pausa, seek bar e durata).
  - All'avvio i controlli vengono mostrati esplicitamente per 3 secondi (`controller.show(3000)`).
  - Il pinch/pan del lightbox non intercetta più i touch sulla seek bar (`pointerInput` attivo solo per le immagini; `pointerInput(pageIndex, media.isVideo)`).
  - La miniatura video resta come anteprima nella griglia e nel Cestino; per le foto tutto invariato (pan/pinch fino a 4x).

---

## ⚡ Novità Principali della Release `v1.1.2` (`versionCode 13`) — Fix APK: Anteprime Video, Long-Press Selezione e Pannello Opzioni

### 1. Anteprime (Thumbnail) dei Video nella Galleria Android APK
- **Prima**: i video nella griglia mostravano solo l'icona play generica — nessuna anteprima.
- **Ora**: `MediaGridTile` carica il primo frame del video come miniatura tramite `MediaMetadataRetriever`:
  - **Fast path via HTTP Range** (`decodeVideoThumbnailFromUrl`): il server PhotoCloud supporta `Range (206 Partial Content)`, quindi il retriever scarica solo i metadati del contenitore e un frame iniziale invece dell'intero file; la chiamata passa il cookie di sessione già autenticato.
  - **Fallback su download completo in cache** (`decodeVideoThumbnailFromFile`) quando lo streaming del frame non è disponibile (es. HTTPS con certificato self-signed), con scala a `380px` e salvataggio nella `thumbnailCache` RAM.
  - La miniatura video viene renderizzata con `ContentScale.Crop` + badge play sovrapposto (se `showVideoBadge`), esattamente come le foto.

### 2. Selezione con Pressione Prolungata (Long-Press) di Nuovo Funzionante
- **Bug**: il `pointerInput` della griglia (`detectDragGesturesAfterLongPress`) e l'`onLongClick` del tile eseguivano **due toggle opposti** per lo stesso gesto, annullandosi a vicenda — era impossibile selezionare qualunque media con la pressione prolungata.
- **Fix**: nuovo toggle condiviso `toggleGallerySelectionFromLongPress` con **debounce a 400ms** (`gridLongPressToggleAtMs`): esattamente un toggle per long-press, da qualunque percorso arrivi (tile o griglia), mantenendo il **Drag-to-Select** con auto-scroll funzionante. Haptic feedback una sola volta per gesto.

### 3. Pannello Opzioni per i File Scelti (`SelectionActionsPanel`)
- **Tenendo premuto** su un media/file compaiono sopra la barra inferiore le **opzioni per i file scelti**: conteggio elementi selezionati, **Seleziona tutti / Deseleziona tutti** e chiusura della selezione.
- Azioni disponibili: **Sposta in album…** (apre il gestore album: assegnare i file scelti a un album esistente, spostarli rimuovendoli dall'album corrente o crearne uno nuovo), **Scarica** (singolo o Archivio ZIP con indicatore di trasferimento), **Cestina** (con conferma opzionale).
- Il pannello sostituisce la precedente barra di selezione slim, è disponibile sia nella **Galleria** sia in **File Cloud**, e funziona con le stesse operazioni ottimistiche della v1.1.1.

---

## ⚡ Novità Principali della Release `v1.1.1` (`versionCode 12`)

### 1. Passaggio Istantaneo (`0.0ms` / 120Hz) da Qualsiasi Scheda alla Galleria (`Foto`) su Android APK e Web App
- **Su Android (`Keep-Alive LazyVerticalGrid` + `thumbnailCache` RAM dedicata)**:
  - **Griglia Galleria Permanentemente Montata (`Keep-Alive`)**: in `MainActivity.kt` (`NativeVaultScreen`), la `LazyVerticalGrid` della Galleria non viene più smontata quando si passa a **File Cloud**, **Cestino** o **Impostazioni**. Resta attiva nel grafo Compose con il proprio stato di scorrimento dedicato (`galleryGridState`) e con le sezioni ordinate/raggruppate pre-calcolate in modo indipendente dalla scheda attiva (`gallerySortedItems`, `galleryGroupedSections`). Tornare alla **Galleria** da qualsiasi scheda avviene in **0.0 ms** (1 singolo frame a 120Hz) senza ricomporre né ridisporre le tessere.
  - **Zero Decodifiche Sincrone da Disco sul Main Thread + `thumbnailCache` RAM (`380px`)**: in `PhotoCloudApiClient.kt` è stata introdotta una cache LRU in RAM dedicata esclusivamente alle miniature della griglia (`thumbnailCache`, campionamento veloce `inSampleSize` a `380px`, ~300 KB per miniatura anziché 48 MB di una foto 12 MP), interrogata da `MediaGridTile` tramite `getRamThumbnailBitmap` in `0.001 ms` senza mai eseguire `BitmapFactory.decodeFile` sul Main Thread UI.
- **Su Web App (`Keep-Alive DOM Panes` `#pane-media`, `#pane-files`, `#pane-trash`)**:
  - In `static/scripts/grouping.js` e `src/lib/templateRenderer.ts`, la griglia mantiene tre contenitori DOM persistenti (`#pane-media`, `#pane-files`, `#pane-trash`). Passare da **File Cloud** o **Cestino** a **Foto** commuta istantaneamente (`0.0 ms`) la proprietà `display` senza mai svuotare `galleryGrid.innerHTML`, senza rimuovere/reinserire gli elementi `<img>` già decodificati dal browser e senza ricaricare la pagina.

### 2. Photo Editor Studio a Latenza Zero (`0ms` / 120Hz) per Rotazione, Specchiatura, Filtri e Ritaglio (Web & Android APK)
- **Eliminazione Completa del Ritardo (~1 secondo -> `< 1.5 ms`) sulla Rotazione (`-90°` / `+90°`) e Specchiatura**:
  - **Su Android (`NativePhotoEditorModal`)**: il motore di modifica genera all'apertura una bitmap di anteprima leggera (`previewSourceBitmap`, max `1080px` sul lato lungo) e separa le trasformazioni geometriche (`renderGeometryPreviewBitmap`) dalle regolazioni cromatiche. Le regolazioni di `Luminosità`, `Contrasto`, `Saturazione`, `Calore` e i 7 filtri rapidi vengono applicati a **0.0 ms direttamente sulla GPU** tramite `androidx.compose.ui.graphics.ColorFilter.colorMatrix`, mentre il trascinamento della griglia di ritaglio non ricalcola mai la bitmap sottostante. Al salvataggio (`Salva Copia` o `Sovrasvb`), l'esportazione alla **piena risoluzione originale** viene eseguita in background su `Dispatchers.Default` senza bloccare il thread UI.
  - **Su Web (`static/scripts/photo-editor.js`)**: all'apertura della foto viene costruito un `previewSourceCanvas` scalato (`max 1080px`) che viene ruotato e specchiato direttamente sul canvas di stage tramite trasformazioni matriciali 2D senza allocare canvas offscreen ad alta risoluzione ad ogni click (`< 1.5 ms`), mantenendo il calcolo delle dimensioni reali in pixel e l'esportazione finale (`buildFinalCroppedExportCanvas`) al **100% della risoluzione nativa**.
- **Lightbox Istantanea & Azioni Cestino Ottimistiche (`0ms`)**: precaricamento automatico delle foto adiacenti e rimozione/ripristino immediato nella UI su Web e Android.

---

## 🚀 Funzionalità Introdotte nella `v1.0.9`–`v1.10` e Perfezionate nella `v1.1.1`

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
Il motore (`src/lib/documentEngine.ts` + `/api/document-preview/:filename` + `static/scripts/document-viewer.js` su Web e `NativeDocumentViewerModal` su Android) permette di aprire direttamente nell'app:

| Categoria | Estensioni Supportate | Funzionalità del Visualizzatore Integrato |
| :--- | :--- | :--- |
| **PDF** | `.pdf` | **Android**: rendering nativo ad alta definizione tramite `android.graphics.pdf.PdfRenderer` con zoom (`75%`–`300%`), scorrimento continuo e navigazione tra le pagine (`Prec.` / `Succ.`).<br>**Web**: visualizzatore PDF inline con controlli di pagina, salto rapido a pagina specifica e zoom (`60%`–`240%`). Supporto `HTTP Range (206 Partial Content)` per documenti di grandi dimensioni. |
| **Word & Testo Formattato** | `.doc`, `.docx`, `.odt`, `.rtf` | Estrazione strutturata di titoli (`Heading`), paragrafi e liste puntate da pacchetti OpenXML/ODF e flussi RTF/DOC, con vista pagina tipografica, **ricerca nel testo con evidenziazione** e controllo **zoom del carattere**. |
| **Excel & Fogli di Calcolo** | `.xls`, `.xlsx`, `.ods`, `.csv`, `.tsv` | Lettura multi-foglio (schede `Foglio 1`, `Foglio 2`, ecc.), intestazioni di colonna fisse (`sticky header`), **filtro di ricerca righe in tempo reale** e scorrimento bidimensionale fluido. |
| **PowerPoint & Presentazioni** | `.ppt`, `.pptx`, `.odp` | Visualizzatore slide 16:9 con barra laterale delle miniature (su Web), navigazione `Slide Prec. / Succ.`, elenco puntato dei contenuti della diapositiva e visualizzazione delle **Note del relatore**. |
| **Testo & Codice Sorgente** | `.txt`, `.md`, `.json`, `.xml`, `.yaml`, `.yml`, `.html`, `.css`, `.js`, `.ts`, `.py`, `.kt`, `.java`, `.c`, `.cpp`, `.sql`, `.sh`, `.log`, `.ini` | Visualizzatore monospace con **numerazione delle righe**, filtro rapido per riga e pulsante **Copia testo**. |
| **Immagini** | `.png`, `.jpg`, `.jpeg`, `.webp`, `.gif`, `.svg`, `.bmp`, `.avif` | Apertura nella Lightbox a schermo intero con **pinch-to-zoom**, navigazione swipe e accesso diretto al **Photo Editor Studio 0ms**. |
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

### 🪄 Photo Editor Studio Integrato 0ms & Griglia di Ritaglio Manuale Trascinabile (Web & APK)
- **Griglia di Ritaglio Manuale Trascinabile Immediata all'Apertura**: entrando in **Modifica Foto**, si attiva subito la griglia 3×3 trascinabile con **8 maniglie tattili** (4 angoli + 4 lati), trascinamento interno e risoluzione in pixel in tempo reale.
- **Rotazione e Specchiatura Istantanee (`0ms`) + 7 Filtri Fotografici GPU**: `Originale`, `Vivido`, `Bianco & Nero`, `Seppia`, `Cinema`, `Freddo`, `Vintage` + slider `Luminosità`, `Contrasto`, `Saturazione`, `Calore`, rotazione `-90°/+90°` e specchiatura senza alcun ritardo.
- **Salvataggio Crittografato**: `Salva Copia` o `Sovrascrivi` originale alla massima risoluzione.

### 🖼️ Galleria 120Hz, Album, Drag-to-Select & Strumenti
- **Raggruppamento Istantaneo per Giorno, Mese, Anno o Album** con creazione, assegnazione multipla e filtro rapido per Album.
- **Selezione Multipla `Drag-to-Select`** sulla griglia con auto-scroll e feedback aptico.
- **Ricerca Duplicati SHA-256**, **Cestino con ripristino/eliminazione definitiva istantanea** ed **Esportazione ZIP**.

---

## 📦 Dipendenze Principali del Progetto

### Server & Web App (`package.json`)
- **`express` (`^5.3.0`) & `multer` (`^2.5.0`)**: server HTTP, gestione sessioni, streaming media con supporto `Range` e upload multipart.
- **`jszip` (`^3.10.2`)**: utilizzato sia per l'esportazione massiva di archivi `.zip` sia dal motore **`src/lib/documentEngine.ts`** per ispezionare e decodificare in memoria i contenitori OpenXML (`.docx`, `.xlsx`, `.pptx`) e OpenDocument (`.odt`, `.ods`, `.odp`).
- **`vite` & `typescript`**: compilazione asset frontend e verifica statica dei tipi.

### App Android Nativa (`android-app/app/build.gradle.kts`)
- **Android SDK 35 / Kotlin 2.0 / Java 17**: compilazione nativa con Jetpack Compose (`androidx.compose:compose-bom:2024.10.01`) e Material 3.
- **`androidx.core:core-ktx:1.13.1`**: include `androidx.core.content.FileProvider` per la condivisione sicura di `content://` URI verso applicazioni esterne.
- **API Native Android (`android.graphics.pdf.PdfRenderer`, `androidx.compose.ui.graphics.ColorFilter` & `android.media.MediaPlayer`)**: utilizzate per il rendering nativo ad alta definizione dei PDF, l'applicazione GPU a 0ms dei filtri fotografici e la riproduzione audio.
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

### 🔄 4. Come Aggiornare la Web App Localmente (A Seguito di Nuove Release o Aggiornamenti)

Quando vengono rilasciati nuovi aggiornamenti sul repository, esegui i seguenti comandi nel terminale all'interno della cartella del progetto (`PhotoCloud`) per aggiornare l'applicazione locale:

1. **Scarica gli ultimi aggiornamenti dal repository:**
   ```bash
   git pull
   ```

2. **Aggiorna le dipendenze NPM:**
   ```bash
   npm install
   ```

3. **Ricompila la Web App per la produzione (se avviata con `npm start`):**
   ```bash
   npm run build
   ```

4. **Riavvia il server:**
   - **In modalità Sviluppo (Dev):**
     ```bash
     npm run dev
     ```
   - **In modalità Produzione:**
     ```bash
     npm start
     ```
     *(Oppure con porta personalizzata: `PORT=3000 npm start`)*

---

### 🤖 5. Android (Installazione APK & Compilazione da Sorgente)

#### Opzione A: Installare l'APK Firmato Pronto (`v1.2.3`)
1. Scarica **`photocloud-release-v1.2.3-signed.apk`** dalla sezione **[Releases di GitHub](https://github.com/ValerioMassimoDeCecco/PhotoCloud/releases/tag/v1.2.3)** (le Release GitHub sono la sorgente ufficiale dell'APK firmato; `release/photocloud-release-build.json` ne riporta il checksum SHA-256). In alternativa puoi compilarlo localmente con la Opzione B (`/release/photocloud-release-v1.2.3-signed.apk`).
2. Apri il file `.apk` sul tuo dispositivo Android per installarlo o aggiornare direttamente una versione precedente (`v1.0.4`–`v1.2.2`) senza perdere dati o configurazioni. Dalle versioni `v1.2.3+` gli aggiornamenti successivi vengono rilevati e scaricati automaticamente all'apertura dell'app.
3. Tocca il badge **Server** in alto a destra per inserire l'URL del tuo server PhotoCloud (`http://<IP-SERVER>:3000`), effettua il login con il tuo file `.json` e apri o modifica istantaneamente qualsiasi foto, video, PDF o documento Office.

#### Opzione B: Compilare l'APK da Sorgente con Gradle
```bash
# Compilazione diretta tramite Gradle (richiede JDK 17 e Android SDK 35)
cd android-app
gradle assembleRelease --no-daemon

# Oppure tramite lo script integrato che genera e verifica /release/photocloud-release-v1.2.3-signed.apk
npm run release:apk
```

---

## 🛠️ Script NPM Disponibili

| Comando | Descrizione |
| :--- | :--- |
| `npm run dev` | Avvia il server full-stack Express + Vite in modalità sviluppo sulla porta `3000`. |
| `npm run build` | Compila i bundle frontend ottimizzati per la produzione. |
| `npm start` | Avvia il server Node.js/TypeScript in modalità produzione. |
| `npm test` | Esegue la suite di test automatici (crittografia AES-256, deduplicazione SHA-256, Photo Editor Math & Manual Crop Grid, Document Viewer Engine per PDF/DOCX/XLSX/PPTX/CSV, template e configurazione Android `v1.2.3`). |
| `npm run lint` | Verifica statica dei tipi TypeScript (`tsc --noEmit`). |
| `npm run release:apk` | Compila l'APK firmato `/release/photocloud-release-v1.2.3-signed.apk` tramite Gradle e Android SDK; se `GITHUB_TOKEN` è presente nel sistema, sincronizza e avvia anche la GitHub Action di release. |

---

## 📂 Struttura del Progetto

```text
PhotoCloud/
├── .github/workflows/
│   └── android-release.yml       # Pipeline CI/CD GitHub Actions (JDK 17 + Android SDK 35 + Gradle 8.10.2) per v1.2.3
├── android-app/                  # Progetto Nativo Android (Kotlin + Jetpack Compose Material You 120Hz)
│   ├── app/
│   │   ├── photocloud-release-key.jks  # Keystore RSA-2048 per firma APK
│   │   ├── build.gradle.kts            # Configurazione SDK 35, Compose, OkHttp, Biometric, versione 1.2.3 (versionCode 20)
│   │   └── src/main/
│   │       ├── AndroidManifest.xml     # Permessi (incluso REQUEST_INSTALL_PACKAGES), FileProvider (content:// URI) e alias icone
│   │       ├── java/com/valerio/photocloud/
│   │       │   ├── MainActivity.kt             # UI Nativa 120Hz, Keep-Alive Gallery Grid, Drag-to-Select, Impostazioni Modello AI & Auto-Update Modal
│   │       │   ├── AiModelDownloadManager.kt   # Gestore download facoltativo modello AI (HTTP Range pause/resume, controllo spazio e rimozione)
│   │       │   ├── AppAutoUpdater.kt           # Controllo aggiornamenti all'avvio, download in-app, verifica SHA-256 + firma X.509 e installer Android
│   │       │   ├── LocalPhotoCategorizer.kt    # Inferenza AI locale on-device da file scaricato su richiesta
│   │       │   ├── PhotoAiDatabase.kt          # Database Room per categorie AI
│   │       │   ├── PhotoAiIndexingWorker.kt    # Worker WorkManager per indicizzazione foto cloud quando il modello è installato
│   │       │   └── PhotoCloudApiClient.kt      # Client HTTP, thumbnailCache RAM 0ms (380px), preview documenti, FileProvider chooser e tracker velocità
│   │       └── res/
│   │           ├── xml/file_paths.xml          # Percorsi autorizzati per FileProvider (inclusi APK di aggiornamento)
│   │           └── drawable/                   # Icone Launcher Colorata e Monocromatica
├── release/
│   ├── photocloud-release-v1.2.3-signed.apk    # APK firmato v1.2.3 (oltre a tutte le release storiche incluse v1.1.3–v1.2.2)
│   ├── efficientnet_lite4.tflite               # Modello AI servito on-demand dal server (/api/ai-model/efficientnet_lite4.tflite)
│   └── photocloud-release-build.json           # Manifest aggiornamenti con versione, versionCode, dimensione, changelog e SHA-256
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
│   ├── scripts/                        # Logica client Web 0ms (grouping.js Keep-Alive Panes, photo-editor.js, lightbox.js, trash.js, document-viewer.js, upload.js)
│   └── styles/                         # Fogli di stile Material You (base.css, gallery.css, login.css)
├── server.ts                           # Server Express principale (API Media, Document Preview, Photo Edit, File Cloud, Album, ZIP, Auth)
└── package.json
```
