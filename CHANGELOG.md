# Changelog PhotoCloud

Tutte le modifiche rilevanti di PhotoCloud sono documentate in questo file.

## [1.5.1] - Android versionCode 33

### Corretto & Rafforzato
- **Pulizia file `.part` / `.tmp` orfani all'avvio (`src/lib/hashIndex.ts`, `server.ts`)**: aggiunto `cleanupOrphanTempFiles(...)` eseguito allo startup del server (rimozione immediata di eventuali `temp_uploads/chunked_*.part` rimasti da un riavvio a metà upload quando la Map in memoria è vuota) e durante lo sweep TTL periodico; migliorata anche la pulizia se l'allocazione iniziale di `/api/upload/chunked/init` fallisce.
- **Checksum SHA-256 obbligatorio per Backup Automatico (`server.ts`, `AutoBackupLogic.kt`, `AutoBackupWorker.kt`, `PhotoCloudApiClient.kt`)**:
  - `POST /api/upload/chunked/init` rifiuta con `400` richieste di backup automatico (`X-Backup-Origin: auto` o `backupOrigin: "auto"`) prive di `sha256` valido (64 hex), o richieste con `sha256` malformato.
  - `POST /upload` accetta e verifica end-to-end `sha256[]` quando inviato dal client (rimuovendo il file scritto e rispondendo `400` in caso di mismatch).
  - Su Android, `AutoBackupWorker` valida sempre gli hash con `AutoBackupLogic.isValidSha256Hex(...)` e `PhotoCloudApiClient.uploadAutoBackupCandidate` invia sempre `sha256` sia su `/api/upload/chunked/init` che come campo `sha256[]` su `POST /upload?skipList=1`.
- **Fix Compilazione Android Release (`PhotoCloudApiClient.kt`, `AutoBackupWorker.kt`, `MainActivity.kt`)**:
  - Rimosso `/*` annidato nel commento KDoc di `PhotoCloudApiClient.kt` che causava `:app:kspReleaseKotlin FAILED`.
  - Corretto `apiClient.syncGallerySession()` in `AutoBackupWorker.kt` e sostituite le chiamate `SettingsToggleRow` con `SettingsSwitchRow(title, subtitle, ...)` in `MainActivity.kt`.

## [1.5.0] - Android versionCode 32

### Aggiunto (Funzionalità B — Cache Persistente Miniature)
- **Server (`src/lib/thumbCache.ts`, `server.ts`)**:
  - Cache persistente su disco per utente sotto `user_media/<utente>/.thumbs/` cifrata con `AES-256-GCM` per le varianti `thumb` (`320px` lato lungo) e `large` (`1280px` lato lungo) in formato JPEG `q=80`.
  - Negativa cache con TTL sui file non renderizzabili, deduplicazione delle richieste concorrenti in volo, coda GPU/CPU con Jimp ed eviction LRU automatica governata da `THUMB_CACHE_MAX_MB` (default `512` MB).
  - Header HTTP `Cache-Control: private, max-age=604800`, `ETag` e risposta `304 Not Modified` su `GET /media/:filename?preview=thumb|large`.
  - Nuovi endpoint: `PUT /api/thumbs/:filename` (caricamento poster miniature JPEG da Android per i video), `GET /api/thumbs/stats` e `POST /api/thumbs/rebuild`.
  - Invalidazione automatica su `/api/media/edit` (`overwrite`), spostamento nel Cestino, ripristino ed eliminazione definitiva / svuota cestino.
- **Web App & SPA (`static/scripts/*`, `src/components/*`, `templates/base.html`)**:
  - Griglia con `loading="lazy"`, `decoding="async"` e `hasThumb` per mostrare anteprime `<img>` anche sui video con poster salvato.
  - Lightbox progressivo: carica subito `?preview=large` (1280px) e passa automaticamente all'immagine originale completa al superamento di `1.15x` di zoom o su download.
  - Nuova card **Cache miniature** nelle Impostazioni Web con dimensione occupata, varianti e pulsante **Ricostruisci cache**.
- **Android (`PhotoCloudApiClient.kt`, `MainActivity.kt`)**:
  - Cache miniature dedicata su disco `thumb_cache/` con eviction LRU e limite configurabile (`64 / 150 / 300 / 512 MB`, default `150 MB`).
  - Griglia con varianti `?preview=thumb` ed estrazione automatica locale dei fotogrammi video con upload verso `PUT /api/thumbs/:filename`.
  - `NativeLightboxModal` mostra rapidamente `?preview=large` prima di caricare l'originale ad alta risoluzione; aggiunta card **Cache miniature** in `NativeSettingsScreen`.

### Aggiunto (Funzionalità A — Backup Automatico Camera Roll Android)
- **Server (`src/lib/crypto.ts`, `src/lib/hashIndex.ts`, `server.ts`)**:
  - Crittografia/verifica streaming a blocchi da `64 KB` (`encryptFileStream`, `decryptFileSha256Stream`) compatibile al 100% con i file `PhotoCloud-GCM-v1` esistenti e legacy `AES-256-CFB`.
  - Indice persistente atomico `.hashes.json` dei soli file **attivi** (il Cestino viene escluso, così i file cestinati vengono ricaricati dal backup automatico).
  - Nuovo endpoint `POST /api/backup/check` per deduplica SHA-256 e lettura `maxUploadMb`.
  - Nuovi endpoint chunked streaming: `POST /api/upload/chunked/init`, `PUT /api/upload/chunked/:uploadId/:chunkIndex`, `POST /api/upload/chunked/:uploadId/complete` con limite configurabile `MAX_UPLOAD_MB` (default `2048 MB`), `X-Backup-Origin: auto` (silenzia push automatici) e conservazione `timestamp` originale.
- **Android (`PhotoAiDatabase.kt`, `AutoBackupLogic.kt`, `AutoBackupWorker.kt`, `PhotoCloudApiClient.kt`, `MainActivity.kt`, `AndroidManifest.xml`)**:
  - Migrazione Room `1 -> 2` (`MIGRATION_1_2`) con tabella persistente `backup_state` senza perdita dell'indice AI `photo_ai_categories`.
  - `AutoBackupWorker` (`WorkManager`) con `ForegroundInfo` di tipo `dataSync`, azioni notifica **Pausa / Annulla**, pianificazione periodica + `ContentUriTrigger`, streaming SHA-256 `64 KB`, upload chunked `8 MB` oltre `24 MB` con retry per-chunk, e accodamento automatico di `PhotoAiIndexingWorker`.
  - Card **Backup automatico** nelle Impostazioni Android con selettore cartelle MediaStore (`Camera` predefinita), filtro foto/video, `Solo nuovi elementi da ora` vs `Intera libreria`, vincoli Wi-Fi/ricarica/risparmio energetico, limite video e finestra di conferma obbligatoria su URL `http://`.

### Checklist Verifica Manuale Android (12 / 13 / 14 / 15)
- **Android 12 (API 31–32)**: concede `READ_EXTERNAL_STORAGE`; verifica caricamento miniature cache e backup automatico in background (`Camera`).
- **Android 13 (API 33)**: concede `READ_MEDIA_IMAGES` + `READ_MEDIA_VIDEO` + `POST_NOTIFICATIONS`; verifica notifica foreground `dataSync` con pulsanti **Pausa / Annulla**.
- **Android 14 (API 34)**: prova sia *Consenti tutte* sia *Seleziona foto e video* (`READ_MEDIA_VISUAL_USER_SELECTED`), verificando la comparsa del banner di avviso accesso parziale in Impostazioni.
- **Android 15 (API 35 — targetSdk 35)**: verifica conformità `FOREGROUND_SERVICE_DATA_SYNC`, comportamento con Risparmio Energetico attivo, backup file video > 24 MB tramite `/api/upload/chunked/*` e ri-upload dopo spostamento del file nel Cestino sul server.
