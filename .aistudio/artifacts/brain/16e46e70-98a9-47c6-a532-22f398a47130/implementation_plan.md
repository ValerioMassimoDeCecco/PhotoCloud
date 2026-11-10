# Piano di Implementazione — PhotoCloud Release v1.2.3

## Obiettivo e Architettura
Rilasciare la versione **1.2.3** (`versionCode = 20`) introducendo due funzionalità architetturali nell'app Android nativa (`com.valerio.photocloud`) e nel backend di supporto:
1. **Modello AI Locale (`EfficientNet-Lite`) a Download Facoltativo**: rimozione del modello pre-incorporato dagli `assets/` dell'APK (riducendo drasticamente il peso dell'APK) e introduzione di un gestore dedicato (`AiModelDownloadManager`) con sezione completa nelle **Impostazioni** per scaricare, mettere in pausa/riprendere, annullare o eliminare il modello per liberare spazio.
2. **Sistema Automatico di Aggiornamento In-App (`AppAutoUpdater`)**: controllo silenzioso all'avvio su **GitHub Releases** con fallback automatico al **manifest del server PhotoCloud** (`/api/android/update-manifest`), download automatico dell'APK direttamente dentro l'app con interfaccia di progresso dedicata, verifica rigorosa di **checksum SHA-256** e **compatibilità della firma digitale (X.509 certificate match)** con l'app installata, e apertura automatica dell'installer ufficiale di Android tramite `FileProvider` + `REQUEST_INSTALL_PACKAGES`.

---

## 1. Modello AI Locale — Download Facoltativo e Gestione Spazio

### Rimozione dall'APK e Caricamento da Storage Interno
- Il file `efficientnet_lite4.tflite` viene rimosso da `android-app/app/src/main/assets/` così che l'APK non contenga i ~24 MB del modello e l'app funzioni al 100% anche senza modello installato.
- Il modello viene archiviato su richiesta in `context.filesDir/ai_models/efficientnet_lite4.tflite` (con file temporaneo `.part` durante lo scaricamento).
- `LocalPhotoCategorizer` verifica prima la presenza e l'integrità del file `filesDir/ai_models/efficientnet_lite4.tflite`:
  - Se il modello non è installato, non avvia MediaPipe e restituisce un risultato vuoto senza errori né crash.
  - Se il modello è installato, carica il buffer `MappedByteBuffer` direttamente dal file locale in `BaseOptions.builder().setModelAssetBuffer(...)` con supporto `Delegate.GPU` e fallback `Delegate.CPU`.
- `PhotoAiIndexingWorker` controlla `AiModelDownloadManager.isModelInstalled(applicationContext)` prima di avviare l'indicizzazione: se il modello non è presente, termina silenziosamente con `Result.success()` senza mostrare banner o consumare batteria.

### Gestore Download (`AiModelDownloadManager`) e UI nelle Impostazioni
- **Sorgenti di download resilienti**: URL ufficiale Google Storage MediaPipe (`https://storage.googleapis.com/mediapipe-models/image_classifier/efficientnet_lite2/float32/latest/efficientnet_lite2.tflite`) con fallback all'endpoint del server PhotoCloud (`/api/ai-model/efficientnet_lite4.tflite`).
- **Supporto Ripresa (`HTTP Range`) e Annullamento**:
  - Se esiste un file parziale `.part` da un tentativo interrotto, invia l'header `Range: bytes=<offset>-` per riprendere dal punto esatto.
  - Controllo preventivo dello spazio libero su disco (`StatFs`) prima di iniziare il download.
  - Stato reattivo (`StateFlow`) con: stato (`NOT_INSTALLED`, `DOWNLOADING`, `PAUSED`, `INSTALLED`, `ERROR`), byte scaricati, byte totali (~24,2 MB), percentuale, velocità in tempo reale (`KB/s` o `MB/s`) e messaggio di errore.
- **Sezione "Modello AI On-Device (Facoltativo)" nelle Impostazioni (`NativeSettingsScreen`)**:
  - Mostra stato di installazione, dimensione del modello (~24,2 MB), spazio libero disponibile sul dispositivo e acceleratore attivo (`GPU / CPU`).
  - Pulsanti contestuali: **Scarica Modello AI**, **Annulla / Pausa**, **Riprendi Download**, **Riprova**, **Elimina Modello (Libera spazio)**.
  - Nella Galleria, se il modello non è installato, la barra delle categorie AI mostra un chip discreto *"AI Locale (Non installato — Configura)"* che porta alle Impostazioni, lasciando invariate tutte le altre funzioni della galleria.

---

## 2. Sistema Automatico di Aggiornamento In-App (`AppAutoUpdater`)

### Controllo Versione all'Avvio e Manifest Aggiornamenti
- All'apertura dell'app (`LaunchedEffect(Unit)` in `MainActivity`), `AppAutoUpdater` esegue in background (`Dispatchers.IO`) il controllo della versione:
  1. Interroga prima **GitHub Releases API** (`https://api.github.com/repos/ValerioMassimoDeCecco/PhotoCloud/releases/latest`) e/o il manifest `photocloud-release-build.json` allegato o pubblicato nel repository.
  2. Se GitHub non è raggiungibile o non restituisce un asset APK valido, esegue il **fallback automatico** verso il server PhotoCloud configurato (`GET /api/android/update-manifest` e `GET /release/photocloud-release-build.json`).
- **Struttura del Manifest (`release/photocloud-release-build.json` & `/api/android/update-manifest`)**:
  - `versionName` (`"1.2.3"`), `versionCode` (`20`), `apkFilename` (`"photocloud-release-v1.2.3-signed.apk"`), `apkDownloadUrl`, `apkSizeBytes`, `sha256`, `changelog`.
- **Confronto versione**:
  - Confronta sia `remoteVersionCode > BuildConfig.VERSION_CODE` sia il confronto semantico `compareSemanticVersions(remoteVersionName, BuildConfig.VERSION_NAME) > 0`.
  - Se la versione installata è già aggiornata (`<=`), il controllo termina in modo completamente silenzioso senza alcuna notifica o finestra.

### Download In-App Automatico e Finestra Dedicata
- Quando viene rilevata una nuova versione:
  - Se l'APK della nuova versione è già stato scaricato in cache ed è integro (SHA-256 corrispondente), passa direttamente alla verifica e proposta di installazione evitando download ripetuti.
  - Altrimenti avvia automaticamente il download dell'APK in `context.cacheDir/updates/photocloud-update-<version>.apk` e mostra il dialogo/schermata dedicata **`AppUpdateModal`** con:
    - Numero della nuova versione (`vX.Y.Z`) e changelog delle novità.
    - Dimensione del file e spazio richiesto.
    - Barra di avanzamento lineare, percentuale di completamento (`0%–100%`), byte scaricati / totali e velocità di download in tempo reale.
    - Pulsante **Annulla** (e **Riprova** in caso di errore di rete).

### Verifica Integrità, Firma Digitale e Avvio Installer Ufficiale Android
- Al completamento del download, prima di avviare l'installazione:
  1. **Controllo integrità archivio e dimensione**: verifica che il file esista, non sia vuoto e corrisponda alla dimensione attesa.
  2. **Verifica SHA-256**: calcola il digest `SHA-256` del file scaricato e lo confronta con l'hash atteso nel manifest (se presente).
  3. **Verifica Firma Digitale (`PackageManager.getPackageArchiveInfo` + `GET_SIGNING_CERTIFICATES`)**: estrae i certificati di firma dall'APK scaricato e li confronta con i certificati di firma dell'app attualmente installata (`context.packageName`). Se la firma non coincide o il pacchetto è corrotto, blocca l'installazione, elimina il file corrotto e mostra un messaggio chiaro all'utente.
  4. **Avvio schermata ufficiale di installazione Android**:
     - Aggiunge il permesso `<uses-permission android:name="android.permission.REQUEST_INSTALL_PACKAGES" />` in `AndroidManifest.xml`.
     - Verifica `packageManager.canRequestPackageInstalls()`: se l'utente non ha ancora autorizzato l'installazione da questa sorgente, apre le impostazioni ufficiali di Android (`Settings.ACTION_MANAGE_UNKNOWN_APP_SOURCES`) e avvia l'installer non appena concesso; altrimenti apre immediatamente `Intent(Intent.ACTION_VIEW)` con `FileProvider.getUriForFile(...)` (`application/vnd.android.package-archive`) e `FLAG_GRANT_READ_URI_PERMISSION`.

---

## 3. Versionamento `1.2.3` (`versionCode 20`), Test e Build APK
- Aggiornamento a `versionName = "1.2.3"` e `versionCode = 20` in `android-app/app/build.gradle.kts`, `package.json`, `server.ts`, `.github/workflows/android-release.yml`, `release/photocloud-release-build.json`, `release/output-metadata.json` e `README.md`.
- Compilazione di `assembleDebug` e `assembleRelease`, generazione di `release/photocloud-release-v1.2.3-signed.apk` firmato con il keystore esistente (`photocloud-release-key.jks`) e aggiornamento dei test in `src/lib/crypto.test.ts`.
