# Piano di Architettura e Migrazione Android Zero-Knowledge (FASE 4A.4)

Questo documento definisce l'inventario completo dei file Android esistenti e l'architettura target per le fasi **4B (Login, Keystore & Rete)**, **4C (Upload, Backup & Dedup)** e **4D (Galleria, Viewer, Video, Editor & Share)** dell'app Android PhotoCloud Zero-Knowledge v2 (`PCZK v1`).

In conformità con lo scopo della **FASE 4A**, nessun file di produzione del flusso v1 Android (`MainActivity.kt`, `PhotoCloudApiClient.kt`, `AutoBackupWorker.kt`, ecc.) è stato alterato in questa fase.

---

## 1. Inventario dei File Android Esistenti e Impatto per Fase

| File Android (`android-app/app/src/main/java/com/valerio/photocloud/`) | Ruolo Attuale (v1) | Destino / Modifiche Previste in v2 (Fasi 4B–4D e Fase 5) |
|---|---|---|
| `MainActivity.kt` | Activity principale Compose con login password v1, galleria cloud/locale, player video ExoPlayer/MediaPlayer su URL `/api/files/:id/content`, editor, cestino, condivisione e impostazioni auto-backup. | **4B**: Aggiunta schermata di sblocco Vault v2 (import Key File JSON / scansione QR / Recovery Code + Passphrase + sblocco biometrico via `BiometricPrompt.CryptoObject`). Conservato `WindowManager.LayoutParams.FLAG_SECURE` invariato.<br>**4C**: Stato e progressi upload cifrato PCZK.<br>**4D**: Integrazione griglia miniature decifrate in RAM, viewer full-res streaming, player video chunked, editor E2EE e creazione link di share `#fragment`. |
| `PhotoCloudApiClient.kt` | Client HTTP OkHttp per le API legacy `/api/*` (login sessione v1, multipart upload in chiaro, download `/api/files/:id/content`, share v1). | **4B**: Introduzione del client parallelo `PhotoCloudZkApiClientV2.kt` (isolato su `/api/v2/*` con `CookieJar` dedicato al path `/api/v2` e cookie `__Host-pczk_sid` / `pczk_sid`).<br>**Fase 5**: Rimozione definitiva di `PhotoCloudApiClient.kt` v1 dopo la migrazione completa. |
| `AutoBackupWorker.kt` | `CoroutineWorker` (WorkManager) che scansiona `MediaStore` e carica foto/video in chiaro verso `/api/files/upload`. | **4C**: Sostituzione del flusso di rete con pipeline streaming E2EE: apertura `ContentResolver.openInputStream(uri)`, calcolo streaming `dedupTag = HMAC-SHA256(K_dedup, plaintext)` a blocchi da 64 KiB, query `/api/v2/blobs/dedup`, generazione miniatura WebP cifrata (`encThumb`), cifratura streaming `PCZK v1` a chunk da 1 MiB tramite `RequestBody.writeTo(BufferedSink)` senza mai caricare l'intero file in RAM, commit finale con `wrappedFk` e `encMeta`. Usa la chiave `photocloud_vk_bg_v2` dell'`AndroidKeyStore` (`setUnlockedDeviceRequired(true)`). |
| `AutoBackupLogic.kt` | Logica di selezione cartelle locali, filtri Wi-Fi/ricarica, stato elementi già sincronizzati. | **4C**: Estensione per tracciare `blobId` UUIDv4 e `dedupTag` locale prima dell'upload e gestire il resume dei caricamenti multi-chunk interrotti (`/api/v2/blobs/upload/:uploadId/chunk/:index`). |
| `AndroidMediaEditorEngine.kt` | Motore di editing immagini/video su file locali/temporanei prima del salvataggio su cloud. | **4D**: L'input all'editor viene decifrato in stream su memoria o file temporaneo cifrato effimero in `context.cacheDir/zk_edit_tmp/`; l'output modificato ("Salva copia" -> nuovo `blobId` e nuova `FK`; "Sovrascrivi" -> nuova `FK` + `expectedVersion` optimistic locking) viene cifrato lato client prima dell'invio. Wiping sicuro dei file temporanei al termine, al lock e in `onStop`/`onDestroy`. |
| `PhotoAiDatabase.kt` | Database Room locale (`photo_ai.db`) con entità `PhotoAiEntry` (tag semantici, embedding/label MediaPipe, timestamp). | **4D**: **Decisione architetturale AI locale**: l'indicizzazione AI MediaPipe rimane **100% on-device**. Per evitare leak di metadati su disco non cifrato o tramite backup di sistema: (1) `allowBackup="false"` e `dataExtractionRules` escludono il DB; (2) per i soli utenti che vogliono sincronizzare l'indice semantico tra dispositivi, i record AI vengono esportati come blob catalogo cifrato con `K_meta` (`AAD = "PCZK-AI-INDEX-V1\x00" \|\| utf8(userId) \|\| u32be(version)`), mentre su disco locale i campi sensibili (`labels`, `ocrText`) nel DB Room vengono cifrati con una chiave derivata da `K_meta` tenuta solo in RAM a vault sbloccato. |
| `PhotoAiIndexingWorker.kt` | Worker in background che esegue MediaPipe Tasks Vision sulle foto per estrarre categorie e tag. | **4D**: Esegue solo quando il Vault è sbloccato (o con chiave background sbloccata a schermo acceso/sbloccato dopo il boot), decifrando in RAM la miniatura/immagine senza lasciare copie plaintext su disco. |
| `LocalPhotoCategorizer.kt` | Classificatore MediaPipe locale per immagini. | **4D**: Riceve `Bitmap` già decifrate in RAM; nessuna modifica al modello ML. |
| `NaturalLanguageSearchEngine.kt` | Motore di ricerca locale in linguaggio naturale sui metadati e tag AI. | **4D**: Opera esclusivamente in RAM sui metadati decifrati (`encMeta`) e sui tag AI decifrati dopo lo sblocco del Vault. Il server `/api/v2/blobs` continua a vedere solo filtri opachi (`afterCursor`, `includeTrash`). |
| `AppAutoUpdater.kt` | Controllo aggiornamenti APK da GitHub Releases con verifica versione. | **4B**: Invariato nel meccanismo di verifica APK firmata (Android verifica la firma del certificato di release prima dell'installazione), ma separato dal client API del vault e con timeout/pinning HTTPS rigoroso. |
| `zk/ZkCoreCrypto.kt`, `zk/ZkArgon2id.kt`, `zk/CryptoProvider.kt`, `zk/ZkErrors.kt` | Modulo crittografico puro Zero-Knowledge (HKDF-SHA256, Argon2id RFC 9106 via BouncyCastle `Argon2BytesGenerator`, AES-256-GCM, formato streaming `PCZK v1`, range decrypt, share manifest, album catalog). | **4A-bis (Scritto; compilazione/test Kotlin da eseguire in CI)**: Nessuna implementazione in-house di Argon2id nel codice di produzione `src/main/`. Vettori `test-vectors/zk-v1.json` e `test-vectors/interop/` (Web -> Android) allineati; direzione inversa Kotlin -> Web verificata in CI tramite artifact `interop-kotlin-fixtures` (`PENDING` in locale senza runtime Gradle/JDK). |

---

## 2. Architettura Target Dettagliata

### 2.1 Rete v2 (`PhotoCloudZkApiClientV2`) e KDF Floor / Pinning
1. **Client OkHttp v2 Dedicato**:
   - Istanza `OkHttpClient` con `CookieJar` che persiste in memoria (o cifrato nel Keystore) esclusivamente il cookie `HttpOnly; SameSite=Strict; Path=/api/v2` (`__Host-pczk_sid` su HTTPS).
   - **TLS & Pinning**: Su connessioni self-hosted HTTPS, supporto a `CertificatePinner` configurabile (SPKI SHA-256) o TrustAnchor per CA privata, disabilitando esplicitamente cleartext HTTP fuori da `10.0.2.2` / `127.0.0.1` in debug.
2. **KDF Floor & Anti-Downgrade Identici al Web**:
   - Prima di eseguire `ZkArgon2id.deriveRfc9106` o il wrapper NDK, il client Android invoca obbligatoriamente `ZkArgon2id.validateKdfParamsFloor(params, userSalt)` che rifiuta con `ZkErrorCode.KDF_PARAMS_TOO_WEAK` qualsiasi parametro inferiore a:
     - `memoryKiB >= 65536` (64 MiB)
     - `iterations >= 3`
     - `parallelism >= 1`
     - `userSalt.size >= 16` byte
   - **Pinning Locale dei Parametri KDF**: Dopo il primo login riuscito per `userId`, i parametri KDF e `userSalt` vengono salvati localmente firmati/cifrati tramite `AndroidKeyStore`. Se a un login successivo `/api/v2/auth/kdf-params` restituisce parametri inferiori o un `userSalt` differente senza rotazione autorizzata, il client interrompe il login e segnala un tentativo di downgrade/MITM.

### 2.2 Libreria Argon2id su Android: Deviazione Documentata (`BouncyCastle 1.82` vs `argon2kt`)
- **Deviazione esplicita dalla specifica/piano iniziale (FASE 4A-bis)**:
  - L'implementazione in-house (BLAKE2b/Argon2id manuale) è stata **rimossa completamente da `src/main/`**. In `src/test/` resta esclusivamente `ZkReferenceArgon2idCrossCheck.kt`, etichettato esplicitamente come **TEST-ONLY CROSS-CHECK**.
  - Sia in **produzione Android (`src/main/`)** sia nei **test unitari JVM (`testDebugUnitTest`)**, l'app esegue **esattamente lo stesso percorso di codice** basato su **BouncyCastle (`org.bouncycastle:bcprov-jdk18on:1.82`)** (`Argon2BytesGenerator` + `Argon2Parameters`), versione pinnata `1.82` (rilasciata `2025-09-17`), licenza **The Bouncy Castle License (MIT-style License)**.
  - `proguard-rules.pro` include le regole `-keep` / `-dontwarn` dedicate per `Argon2BytesGenerator`, `Argon2Parameters` e `Blake2bDigest` per il minify/R8 release.
- **Ruolo opzionale di `argon2kt`**:
  - `com.lambdapioneer.argon2kt:argon2kt:1.6.0` (MIT, JNI/NDK off-heap) **resta opzionale** e differito rispetto alla 4B: verrà introdotto **solo se** misure reali con **test strumentati su dispositivo fisico** (Android low-end e mid-range) mostreranno latenza o pressione heap/OOM inaccettabili con BouncyCastle `Argon2BytesGenerator` a `64 MiB / t=3 / p=1`.
- **Analisi Memoria JVM (`-Xmx128m`) e Rischio OOM su Dispositivo**:
  - **Vincolo JVM Unit Test**: `android-app/app/build.gradle.kts` forza `maxHeapSize = "128m"` per `testDebugUnitTest`. La matrice Argon2id `64 MiB` + allocazione GC deve convivere nell'heap da 128 MiB insieme ai test streaming `PCZK v1`.
  - **Rischio OOM e Mitigazione**:
    - Su Android di fascia bassa, `Runtime.getRuntime().maxMemory()` dell'heap gestito ART (`dalvik.vm.heapgrowthlimit`) può essere limitato a `128 MiB` o `192 MiB`.
    - **Mitigazione**: (a) La derivazione Argon2id viene eseguita **solo una volta** al momento dell'onboarding/sblocco con passphrase su `Dispatchers.Default` con un mutex globale (`Mutex()`), mentre gli sblocchi quotidiani usano direttamente la `VK` wrappata nell'`AndroidKeyStore` (0 byte Argon2id, latenza < 15 ms); (b) blocco `try { ... } catch (oom: OutOfMemoryError)` che libera la cache bitmap in RAM prima di ritentare o mostrare un errore pulito; (c) se i benchmark strumentati su device reale con `bcprov-jdk18on:1.82` mostreranno latenza > target UX o OOM su dispositivi `heapgrowthlimit=128m`, si attiverà `argon2kt:1.6.0` (off-heap NDK) dietro l'interfaccia `ZkArgon2id.Argon2idProvider`.
- **Toolchain Gradle e JDK**:
  - Nel repository sono assenti `android-app/gradlew` e `android-app/gradle/wrapper/gradle-wrapper.jar` (presente solo `android-app/gradle/wrapper/gradle-wrapper.properties` che fissa `gradle-8.10.2-bin.zip`).
  - Sia il workflow CI (`.github/workflows/android-ci.yml`, JDK `17` Temurin + `gradle/actions/setup-gradle@v4` con `gradle-version: '8.10.2'`) sia il comando locale documentato eseguono in modo identico:
    `cd android-app && gradle testDebugUnitTest --info --no-daemon --stacktrace`.
  - Per generare e versionare opzionalmente il wrapper da una macchina con Gradle `8.10.2` installato: `cd android-app && gradle wrapper --gradle-version 8.10.2`.

### 2.3 Gestione `VaultKeyStore` e Android Keystore (Interattivo vs AutoBackupWorker)
Viene definita l'interfaccia astratta `VaultKeyStore` con due implementazioni:
- `InMemoryFakeVaultKeyStore` (per unit test JVM in `src/test/` senza dipendenze da Android OS).
- `AndroidHardwareVaultKeyStore` (per produzione su Android API 28+).

Architettura a **doppia chiave Hardware-Backed AES-256-GCM** in `AndroidKeyStore`:
1. **Chiave Interattiva (`photocloud_vk_bio_v2`)**:
   - Generata con `KeyGenParameterSpec.Builder("photocloud_vk_bio_v2", PURPOSE_ENCRYPT or PURPOSE_DECRYPT)`:
     - `setBlockModes(KeyProperties.BLOCK_MODE_GCM)`
     - `setEncryptionPaddings(KeyProperties.ENCRYPTION_PADDING_NONE)`
     - `setUserAuthenticationRequired(true)`
     - `setInvalidatedByBiometricEnrollment(true)`
   - Sbloccata esclusivamente tramite `BiometricPrompt.PromptInfo` + `BiometricPrompt.CryptoObject(cipher)` quando l'utente apre l'app per consultare la galleria.
2. **Chiave Background per AutoBackup (`photocloud_vk_bg_v2`)**:
   - Attivata **solo se** l'utente abilita l'Auto-Backup in background nelle impostazioni.
   - Generata con `KeyGenParameterSpec.Builder("photocloud_vk_bg_v2", PURPOSE_ENCRYPT or PURPOSE_DECRYPT)`:
     - `setBlockModes(KeyProperties.BLOCK_MODE_GCM)`
     - `setEncryptionPaddings(KeyProperties.ENCRYPTION_PADDING_NONE)`
     - `setUnlockedDeviceRequired(true)` (disponibile su API 28+: il Keystore consente la decifratura solo quando il dispositivo è stato sbloccato dopo il boot e lo schermo non è nello stato locked BFU/AFU ristretto, senza richiedere un prompt biometrico interattivo al `WorkManager`).
   - Se il dispositivo è bloccato al momento dell'esecuzione di `AutoBackupWorker`, `KeyStore` solleva `UserNotAuthenticatedException` / `KeyPermanentlyInvalidatedException`: il worker restituisce `Result.retry()` con backoff esponenziale senza mai salvare la `VK` in chiaro in `SharedPreferences` o su disco.
3. **Lock e Logout**:
   - Al lock manuale o per timeout inattività: zeroization immediata (`fill(0)`) dei `ByteArray` di `VK`, `K_meta`, `K_thumb`, `K_dedup`, `K_fk_wrap` in RAM.
   - Al logout: `keyStore.deleteEntry("photocloud_vk_bio_v2")`, `keyStore.deleteEntry("photocloud_vk_bg_v2")`, cancellazione del cookie di sessione `/api/v2/auth/logout` e wipe della cache miniature cifrate.

### 2.4 Cache Miniature su Disco (Solo Ciphertext) e Decifratura in RAM
- **Regola aurea**: Nessuna miniatura o immagine decifrata viene mai scritta sul filesystem (`cacheDir` o `filesDir`).
- **Disk Cache (`EncryptedThumbDiskCache`)**:
  - Salva su disco in `context.cacheDir/zk_thumbs_ct/<blobId>.enc` esclusivamente il blob cifrato restituito da `GET /api/v2/blobs/:blobId/thumb` (`12B IV || ciphertext || 16B GCM tag`).
  - L'integrità e l'autenticità sono garantite dal tag AES-256-GCM verificato a ogni lettura tramite `ZkCoreCrypto.decryptThumbnail(K_thumb, encThumb, blobId)`.
- **Memory Cache (`LruCache<String, Bitmap>`)**:
  - Le `Bitmap` decifrate risiedono esclusivamente in una `LruCache` in RAM dimensionata al 15% dell'heap disponibile e vengono svuotate (`evictAll()`) immediatamente a ogni evento di `lockVault()`, `onTrimMemory(TRIM_MEMORY_UI_HIDDEN)` o logout.

### 2.5 Playback Video via Media3 / ExoPlayer (`ZkChunkedMedia3DataSource`)
- **Zero File Temporanei Plaintext**: I video non vengono mai scaricati e decifrati per intero su disco.
- **Architettura `DataSource` Custom per Media3 (`androidx.media3.datasource.DataSource`)**:
  1. `open(dataSpec: DataSpec)`:
     - Se l'header `PCZK v1` (86 byte) e la `FK` del `blobId` non sono ancora in cache in RAM per la sessione del player, esegue `GET /api/v2/blobs/:blobId` con header `Range: bytes=0-85`, fa il parse con `ZkCoreCrypto.parsePczkHeader` e decifra `FK = unwrapFileKey(K_fk_wrap, header.wrappedFk, blobId)`.
     - Calcola l'intervallo di byte plaintext richiesto da ExoPlayer (`dataSpec.position` .. `end`).
  2. `read(buffer, offset, length)`:
     - Mappa l'offset plaintext `pos` all'indice di chunk `chunkIndex = (pos / chunkSize).toInt()` e all'offset interno al chunk `offsetInChunk = (pos % chunkSize).toInt()`.
     - Mantiene una piccola **LRU in RAM di max 4 chunk decifrati** (`4 x 1 MiB = 4 MiB` totali) per assorbire le letture sequenziali di `MediaExtractor` / `MatroskaExtractor` / `Mp4Extractor` (incluso il box `moov` a inizio o fine file).
     - Se `chunkIndex` non è nella LRU di 4 chunk, scarica dal server il singolo chunk cifrato con `Range: bytes=<ctStart>-<ctEnd>`, lo autentica e decifra con `ZkCoreCrypto.decryptBlobRange` (che verifica nell'AAD `blobId`, `chunkIndex`, `chunkSizeLog2` e il flag `FINAL` contro troncamento/riordino), e copia i byte richiesti nel buffer di Media3.
  3. `close()`:
     - Azzera i buffer della LRU in RAM e la copia locale di `FK`.

### 2.6 File Temporanei per "Apri con..." (`Intent.ACTION_VIEW` / `ACTION_SEND`) e `FLAG_SECURE`
- **`FLAG_SECURE` Invariato**: `window.setFlags(WindowManager.LayoutParams.FLAG_SECURE, WindowManager.LayoutParams.FLAG_SECURE)` resta attivo in `MainActivity.onCreate()` per impedire screenshot di sistema, schermate negli App Recents e screen recording non autorizzati.
- **"Apri con..." / Condivisione verso App Esterne**:
  - Quando l'utente sceglie esplicitamente "Apri con..." per un documento (es. PDF/DOCX/video verso app esterna):
    1. L'app mostra un avviso esplicito che il file verrà decifrato temporaneamente per l'app esterna selezionata.
    2. Lo stream viene decifrato in `context.cacheDir/zk_external_share/<random_uuid>/<sanitized_name>` servito tramite `FileProvider` con permessi `FLAG_GRANT_READ_URI_PERMISSION` a tempo limitato.
    3. **Wipe Deterministico**: L'intera cartella `context.cacheDir/zk_external_share/` viene sovrascritta con zeri e cancellata (`deleteRecursively()`) in tre punti: (a) al `lockVault()`, (b) in `MainActivity.onStop()` / `onDestroy()`, e (c) all'avvio dell'app (`Application.onCreate()`) per ripulire eventuali residui da crash o force-stop.

---

## 3. Scomposizione Operativa nelle Fasi 4B, 4C e 4D

### FASE 4B — Login, Android Keystore, KDF Floor & Client di Rete v2
1. Implementazione di `VaultKeyStore` (`AndroidHardwareVaultKeyStore` + `InMemoryFakeVaultKeyStore` per test JVM).
2. Utilizzo di BouncyCastle `bcprov-jdk18on:1.82` (`ZkArgon2id`) già adottato in produzione/test in 4A-bis; aggiunta opzionale di `argon2kt:1.6.0` dietro `ZkArgon2id.Argon2idProvider` solo se test strumentati su device reale mostrano latenza o memoria inaccettabili.
3. Implementazione di `PhotoCloudZkApiClientV2` (OkHttp, cookie jar isolato `/api/v2`, enforcement KDF floor `64 MiB / t=3 / p=1 / salt>=16B`, pinning dei parametri KDF per `userId`).
4. Flussi di Onboarding / Sblocco Vault (import Key File JSON o Recovery Code + Passphrase, cambio passphrase = re-wrap di `VK` + rotazione `authVerifier` senza ricifrare i blob, sblocco biometrico con `BiometricPrompt.CryptoObject`).
5. Unit test JVM su `InMemoryFakeVaultKeyStore`, `PhotoCloudZkApiClientV2` (con `MockWebServer`), KDF floor anti-downgrade e spy di rete Kotlin (verifica che `accountKey`, `passphrase`, `kek`, `VK`, `FK`, `shareKey` non compaiano mai in URL, header o body).

### FASE 4C — Upload Streaming, AutoBackupWorker & Deduplicazione Client-Side
1. Pipeline di upload streaming in `PhotoCloudZkApiClientV2`: calcolo `dedupTag` a 64 KiB, check `/api/v2/blobs/dedup`, generazione `encThumb`, upload chunked `PCZK v1` da 1 MiB con resume automatico e commit finale (`wrappedFk`, `encMeta`, `dedupTag`).
2. Aggiornamento di `AutoBackupWorker` e `AutoBackupLogic` per usare `photocloud_vk_bg_v2` (`setUnlockedDeviceRequired(true)`), gestendo `UserNotAuthenticatedException` a dispositivo bloccato con `Result.retry()`.
3. Test JVM su upload multi-chunk, deduplicazione hit/miss, interruzione e ripresa al chunk `N`, e test di memoria costante.

### FASE 4D — Galleria E2EE, Viewer, Video Media3, Editor, Album, Cestino & Share
1. Galleria Compose alimentata da `/api/v2/blobs`: decifratura `encMeta` in RAM, `EncryptedThumbDiskCache` (solo ciphertext su disco) + `LruCache` bitmap in RAM svuotata al lock.
2. Player video basato su `ZkChunkedMedia3DataSource` con richieste `Range` autenticate per chunk e LRU da 4 chunk in RAM.
3. Editor immagini/video E2EE ("Salva copia" e "Sovrascrivi" con `expectedVersion`), gestione album cifrati (`/api/v2/albums`), cestino (`/trash`, `/restore`, `DELETE`) ed export/gestione file temporanei "Apri con..." con wipe al lock/uscita.
4. Creazione e apertura di Share Link v2 (`/s/<shareId>#<base64url(shareKey)>`, con o senza password aggiuntiva Argon2id), inclusa protezione cifrata del database AI locale Room (`PhotoAiDatabase`).
