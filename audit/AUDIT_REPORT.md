# Audit di Testing e Qualità del Software (QA / SDET Report) — PhotoCloud v1.4.1

**Data Audit:** 14 Novembre 2026  
**Repository / Progetto:** `photocloud-mobile` (`v1.4.1`, `versionCode: 31`)  
**Ruolo:** Senior QA Engineer / SDET  
**Vincoli applicati:** Nessun file di produzione modificato; ogni affermazione è corredata da comandi reali eseguiti e relativi output osservati.

---

## 1. Executive Summary

**Stato Generale del Progetto: 🟡 GIALLO (Parzialmente Funzionante con Criticità di Release, Sicurezza e Architettura)**

Il core applicativo Web/Backend (`server.ts`, crittografia vault `AES-256-GCM`, deduplicazione SHA-256 + perceptual hash DCT 64-bit, parser EXIF/GPS, ricerca in linguaggio naturale IT/EN, anteprima documenti e condivisioni) compila senza errori TypeScript (`tsc --noEmit` exit `0`), supera l'intera suite ufficiale di **56 test su 56** (`npm test` in ~6,5s, 0 flaky su 3 esecuzioni) e si avvia regolarmente su porta `3000` (zero errori console/network verificati via Playwright).  
Tuttavia, l'audit approfondito (analisi statica, coverage analysis e smoke test E2E in `audit/scripts/smoke_audit.ts`) ha portato alla luce **8 problemi reali verificati**, tra cui:
1. **Rottura dell'OTA Android e del Release Builder per la v1.4.1** (`GET /api/android/update-manifest` e `POST /api/android/build-release` per `1.4.1` restituiscono `HTTP 404` perché `photocloud-release-v1.4.1-signed.apk` è assente in `release/` e `release/photocloud-release-build.json` contiene `sizeBytes: 0` e `sha256: "0000..."`).
2. **Version Drift e regressione latente nello script di pubblicazione** (`src/lib/githubReleasePublisher.ts` ha cablato `v1.3.2` / `versionCode: 29` e omette 2 file Kotlin essenziali dal sync GitHub Actions).
3. **Bypass della quota `maxDownloads` nelle condivisioni pubbliche** (`GET /share/:token/media/:filename` senza `?download=1` serve l'intero file decifrato senza incrementare `downloadCount`) e **mancata gestione `HTTP 416` su header `Range` invalidi negli album condivisi multi-utente**.

---

## 2. Come ho verificato (Ambiente e Comandi Eseguiti)

### 2.1 Ambiente di Verifica
- **Sistema Operativo / Container:** Linux (ambiente isolato AI Studio)
- **Node.js:** `v22.23.2`
- **Package Manager:** `npm 10.9.8`
- **OpenSSL:** `/usr/bin/openssl` (disponibile)
- **Java JDK / `keytool` / Android SDK (`gradle`):** Non installati nel container (`sh: 1: java: not found`)
- **Repository Git (`.git`):** Directory `.git` non presente nel filesystem montato (`fatal: not a git repository`)

### 2.2 Elenco Comandi Eseguiti
1. **Verifica ambiente e toolchain:**
   ```bash
   node -v && npm -v && (java -version 2>&1 || true) && (which gradle 2>&1 || true) && (which keytool 2>&1 || true) && (which openssl 2>&1 || true)
   ```
2. **Type-checking statico TypeScript (`lint`):**
   ```bash
   npm run lint   # esegue: tsc --noEmit -> EXIT 0
   ```
3. **Build di produzione Frontend + Service Worker PWA (`build`):**
   ```bash
   npm run build  # esegue: vite build -> EXIT 0 (595ms, genera dist/ + dist/sw.js)
   ```
4. **Audit vulnerabilità dipendenze e scansione segreti / sintassi shell:**
   ```bash
   npm audit
   grep -rnE 'AIza[0-9A-Za-z_-]{35}|ghp_[0-9A-Za-z]{36}|github_pat_[0-9A-Za-z_]{82}|sk-[0-9A-Za-z]{32,}|-----BEGIN (RSA|EC|PRIVATE) KEY' src server.ts scripts static android-app .env*
   bash -n photocloud.sh
   ```
5. **Esecuzione suite di test ufficiale e verifica anti-flakiness (ripetuta più volte):**
   ```bash
   npm test       # esegue: tsx --test src/lib/*.test.ts -> 56 pass, 0 fail (6.55s)
   ```
6. **Analisi di Code Coverage (Linee / Branch / Funzioni):**
   ```bash
   npx tsx --test --experimental-test-coverage src/lib/*.test.ts
   ```
7. **Verifica E2E / Smoke API, Sicurezza, Edge Case e CLI (script dedicato):**
   ```bash
   npx tsx audit/scripts/smoke_audit.ts
   ```
8. **Verifica Browser Reale (Playwright CLI su `http://localhost:3000`):**
   ```bash
   playwright-cli -s=qa open http://localhost:3000 --persistent
   playwright-cli -s=qa snapshot
   playwright-cli -s=qa console
   playwright-cli -s=qa requests
   playwright-cli -s=qa close
   ```

---

## 3. Tabella Risultati per Area / Modulo

| Area / Modulo | Tipo di Verifica | Stato | Evidenza Sintetica / Risultato Osservato |
| :--- | :--- | :---: | :--- |
| **Setup & Dipendenze (`package.json`)** | Installazione & `npm audit` | ⚠️ PARZIALE | Dipendenze installate correttamente. `npm audit` segnala **6 vulnerabilità** (2 low, 4 moderate) nella catena di build dev (`vite-plugin-pwa` -> `workbox-build` -> `glob`/`minimatch`/`deepmerge`). |
| **Typecheck TypeScript (`npm run lint`)** | Analisi Statica (`tsc --noEmit`) | ✅ VERIFICATO | Exit code `0`, zero errori di tipo su `server.ts`, `src/**`, `scripts/**`. |
| **Build Frontend React/PWA (`npm run build`)** | Build (`vite build`) | ⚠️ PARZIALE | Exit code `0` in `595ms` (`dist/assets/index-L4TS3W4j.js` 507.78 kB, warning chunk > 500 kB). **Critica architetturale:** `server.ts` non serve mai `dist/index.html`, rendendo la SPA React in `src/App.tsx` e `src/components/*` codice morto a runtime. |
| **Analisi Segreti & Script Launcher (`photocloud.sh`)** | Security Scan & `bash -n` | ✅ VERIFICATO | Nessuna chiave privata o API key hardcoded trovata nel codice sorgente. `bash -n photocloud.sh` -> `photocloud.sh syntax OK`. |
| **Unit Test Crittografia & Vault (`crypto.test.ts`)** | Unit Test (`node:test`) | ✅ VERIFICATO | **21/21 test passati** (AES-256-GCM, legacy CFB migration, streaming bulk upload, math editor, persistent signing, Kotlin static guards). |
| **Unit Test EXIF & GPS (`exif.test.ts`)** | Unit Test (`node:test`) | ✅ VERIFICATO | **7/7 test passati** (TIFF little/big endian, razionali, coordinate GPS emisferi N/S/E/W, robustezza su buffer corrotti). |
| **Unit Test NL Search (`nlSearch.test.ts`)** | Unit Test (`node:test`) | ✅ VERIFICATO | **11/11 test passati** (date relative e assolute IT/EN, filtri tipo file, album, preferiti). |
| **Unit Test Perceptual Hash (`phash.test.ts`)** | Unit Test (`node:test`) | ✅ VERIFICATO | **6/6 test passati** (DCT 32x32, distanza di Hamming, union-find transitivo). |
| **Integration Test Server Core (`server.test.ts`)** | Integration E2E (`node:test`) | ✅ VERIFICATO | **1 macro-suite passata** (5.63s): registrazione, isolamento vault multi-utente, deduplicazione, collisioni nomi, cestino, ZIP export/import, Range HTTP, anteprima documenti, editing media. |
| **Integration Test v1.4.x (`serverFeatures.test.ts`)** | Integration E2E (`node:test`) | ✅ VERIFICATO | **9/9 subtest passati** (3.17s): preferiti, ricordi, ricerca NL, duplicati pHash, VAPID push, share pubblici e protetti da password, album multi-utente, mappa GPS EXIF. |
| **Code Coverage (`--experimental-test-coverage`)** | Coverage Linee / Branch | ⚠️ PARZIALE | Aggregato processi test diretti: **86.77% linee / 73.54% branch / 90.85% funzioni**. Moduli sotto la soglia del 70%: `githubReleasePublisher.ts` (**17.32% linee**), `documentEngine.ts` (**66.91% linee / 57.14% branch**), `grouping.ts` (**0% — mai importato nei test**), `src/components/*` (**0% — mai testati**). |
| **Smoke E2E: Sicurezza CSRF & Share Quota** | Verifica Funzionale (`smoke_audit.ts`) | ❌ FALLITO | Confermati **BUG-SHARE-QUOTA** (scaricamento inline `/share/:token/media/:file` non incrementa `downloadCount` e aggira `maxDownloads=1`), **BUG-SHARED-ALBUM-RANGE** (`200 OK` invece di `416` su Range invalido) e **SEC-01** (POST senza `X-CSRF-Token` accettata se `Origin` è omesso). |
| **Smoke E2E: Android OTA & Release Studio v1.4.1** | Verifica Funzionale (`smoke_audit.ts`) | ❌ FALLITO | `GET /api/android/update-manifest` -> `HTTP 404` (`Nessun APK di release disponibile sul server`); `POST /api/android/build-release` (`versionName: "1.4.1"`) -> `HTTP 404`. |
| **CLI Scripts (`setup-persistent-signing`, `publish-github-release`)** | Verifica CLI | ⚠️ PARZIALE | `setup-persistent-signing.ts` gestisce con grazia l'assenza di `keytool` e `GITHUB_TOKEN` (exit `0`). `publish-github-release.ts` (`npm run release:apk`) **corrompe** `release/photocloud-release-build.json` riportandolo a `v1.3.2` (`versionCode: 29`). |
| **Web UI Live (`http://localhost:3000`)** | Browser E2E (`playwright-cli`) | ✅ VERIFICATO | Pagina `/login` SSR (`templateRenderer.ts`) renderizzata correttamente, 0 errori console, 0 richieste fallite, form di accesso/registrazione e login tramite file `.json` funzionanti. |
| **Build Nativa Android (`./gradlew assembleRelease`)** | Compilazione Kotlin/Gradle | ❓ NON VERIFICABILE | Nel container non sono presenti Java JDK (`java: not found`), Android SDK né `gradlew`. La correttezza sintattica Kotlin è coperta solo da guardie statiche regex nei test TypeScript. |

---

## 4. Problemi Trovati (Ordinati per Severità)

### 🔴 CRITICA / ALTA

#### [BUG-01] Severità: ALTA — Endpoint OTA `/api/android/update-manifest` e Release Builder `/api/android/build-release` restituiscono `HTTP 404` per la versione corrente `v1.4.1`
- **File / Riga:**
  - `release/photocloud-release-build.json` (righe 1–12)
  - `release/output-metadata.json` (righe 1–20)
  - `server.ts` (righe 2566–2637 `resolveReleaseApk`, righe 2820–2894 `GET /api/android/update-manifest`, righe 2979–2994 `POST /api/android/build-release`)
- **Descrizione:** Il progetto è stato aggiornato alla versione `1.4.1` (`versionCode: 31`) in `package.json`, `android-app/app/build.gradle.kts` e `release/photocloud-release-build.json`. Tuttavia:
  1. Il file binario `release/photocloud-release-v1.4.1-signed.apk` **non esiste** (l'ultimo APK presente in `release/` è `photocloud-release-v1.3.2-signed.apk`).
  2. `release/photocloud-release-build.json` contiene valori segnaposto invalidi (`"sizeBytes": 0`, `"sha256": "0000000000000000000000000000000000000000000000000000000000000000"`).
  3. `release/output-metadata.json` è rimasto fermo a `versionCode: 29`, `versionName: "1.3.2"`.
  4. In `server.ts`, `GET /api/android/update-manifest` legge `manifest.versionName` (`1.4.1`) e `manifest.apkFileName` (`photocloud-release-v1.4.1-signed.apk`) e invoca `resolveReleaseApk('1.4.1', 'photocloud-release-v1.4.1-signed.apk')`. Poiché `resolveReleaseApk` cerca **esclusivamente** il file `v1.4.1` quando `versionName` è specificato (senza fare fallback all'ultimo APK firmato valido `v1.3.2`), restituisce `null` e l'endpoint risponde con `HTTP 404`.
- **Passi per riprodurre:**
  ```bash
  curl -i http://localhost:3000/api/android/update-manifest
  ```
- **Output Osservato (da `audit/scripts/smoke_audit.ts`):**
  ```json
  HTTP 404
  {"error":"Nessun APK di release disponibile sul server."}
  ```
  E su `POST /api/android/build-release` con `versionName: "1.4.1"`:
  ```json
  HTTP 404
  {"error":"Binario APK pre-compilato per la versione v1.4.1 non trovato in release/. Compila prima l'APK reale con Android SDK (./gradlew assembleRelease)."}
  ```
- **Output Atteso:** `GET /api/android/update-manifest` deve restituire `HTTP 200` con i metadati e l'hash SHA-256 reali dell'APK firmato `v1.4.1` (oppure fare fallback all'ultimo APK firmato fisicamente presente in `release/` se la build `v1.4.1` non è ancora stata pubblicata).
- **Fix Suggerito:** Compilare e firmare `release/photocloud-release-v1.4.1-signed.apk`, aggiornare `sizeBytes` e `sha256` in `release/photocloud-release-build.json` e `release/output-metadata.json`, e aggiungere in `resolveReleaseApk()` un fallback all'APK firmato più recente qualora il file della versione dichiarata nel manifest non sia ancora presente su disco.

---

#### [BUG-02] Severità: ALTA — `githubReleasePublisher.ts` (`npm run release:apk`) ha cablato `v1.3.2` (code `29`), corrompe `photocloud-release-build.json` e omette 2 file Kotlin dal sync CI
- **File / Riga:**
  - `src/lib/githubReleasePublisher.ts` (righe 42–43, 108–128, 178–213)
  - `scripts/publish-github-release.ts` (righe 1–78)
- **Descrizione:**
  1. In `src/lib/githubReleasePublisher.ts`, le costanti di rilascio sono rimaste hardcoded a:
     ```ts
     const DEFAULT_TAG = 'v1.3.2';
     const APK_FILENAME = 'photocloud-release-v1.3.2-signed.apk';
     ```
     e `ensureLocalReleaseManifest()` sovrascrive incondizionatamente `release/photocloud-release-build.json` con `versionName: '1.3.2'` e `versionCode: 29`. Se si esegue `npm run release:apk`, il file `release/photocloud-release-build.json` viene retrocesso a `1.3.2`, facendo **fallire** immediatamente il test di allineamento versioni in `src/lib/crypto.test.ts` (righe 768–776: `assert.equal(manifestJson.versionName, gradleVersion)`).
  2. Inoltre, nella funzione `triggerGitHubActionsBuild()` (`src/lib/githubReleasePublisher.ts:178-213`), l'array `filesToSync` sincronizza i sorgenti Android sul repository GitHub per la compilazione CI, ma **dimentica di includere**:
     - `android-app/app/src/main/java/com/valerio/photocloud/AndroidMediaEditorEngine.kt`
     - `android-app/app/src/main/java/com/valerio/photocloud/NaturalLanguageSearchEngine.kt`
     Poiché `MainActivity.kt` utilizza entrambi i moduli, una build GitHub Actions su un repository non già aggiornato fallisce in compilazione Kotlin (`Unresolved reference`).
- **Passi per riprodurre:** Ispezionare `src/lib/githubReleasePublisher.ts:42-43,108-128,178-213` o eseguire `npx tsx audit/scripts/smoke_audit.ts` (`BUG-RELEASE-PUBLISHER-DRIFT`).
- **Output Osservato:** `DEFAULT_TAG='v1.3.2' (code 29), omits AndroidMediaEditorEngine.kt=true, omits NaturalLanguageSearchEngine.kt=true`.
- **Output Atteso:** Lettura dinamica di `versionName` / `versionCode` da `android-app/app/build.gradle.kts` (o `package.json`) e scansione dinamica (`fs.readdirSync`) di tutti i file `.kt` in `android-app/app/src/main/java/com/valerio/photocloud/`.

---

#### [BUG-03] Severità: ALTA — Bypass della quota `maxDownloads` nelle condivisioni pubbliche (`GET /share/:token/media/:filename`)
- **File / Riga:** `server.ts` (righe 1425–1470)
- **Descrizione:** Quando un utente crea un link di condivisione pubblica con limite massimo di scaricamenti (es. `maxDownloads: 1`), `GET /share/:token/media/:filename` decifra e restituisce l'intero file originale. Tuttavia, il contatore `incrementShareDownloadCount(UPLOAD_FOLDER, id)` viene invocato **solo** se nella query string è presente `?download=1` o `?download=true` (`if (isExplicitDownload)` alla riga 1461). Qualsiasi client o utente che acceda a `/share/:token/media/:filename` senza `?download=1` (incluso il caricamento diretto del file nel browser, `curl`, `Right-Click -> Save As` o lo streaming video/foto) può scaricare il file **infinite volte** senza che `downloadCount` aumenti mai.
- **Passi per riprodurre (eseguiti in `audit/scripts/smoke_audit.ts`):**
  1. Creare una share pubblica con `POST /api/shares` e `maxDownloads: 1`.
  2. Effettuare 3 richieste `GET /share/:token/media/vacanza_roma.jpg` (senza `?download=1`).
  3. Controllare `downloadCount` tramite `GET /api/shares`.
- **Output Osservato:**
  ```
  3 richieste a /share/:token/media/vacanza_roma.jpg -> status [200, 200, 200], downloadCount=0/1
  ```
- **Output Atteso:** L'erogazione del payload completo su `/share/:token/media/:filename` (almeno per richieste non-Range o all'inizio del download completo) deve incrementare `downloadCount` e bloccare gli accessi successivi con `HTTP 410 Gone` al raggiungimento di `maxDownloads`.
- **Fix Suggerito:** Incrementare `downloadCount` su ogni richiesta `GET /share/:token/media/:filename` che non sia una richiesta parziale `Range` con `start > 0` (oppure tracciare il consumo quota sia su preview full-res sia su download esplicito).

---

### 🟠 MEDIA

#### [BUG-04] Severità: MEDIA — `src/lib/androidBuilder.ts` sovrascrive `app/build.gradle.kts` e `AndroidManifest.xml` nello ZIP Android Studio esportato con configurazioni WebView legacy incompatibili
- **File / Riga:**
  - `src/lib/androidBuilder.ts` (righe 111–189 `generateAppBuildGradleKts`, righe 195–345 `generateMainActivityKt`)
  - `server.ts` (righe 3083–3088 in `POST /api/android/build-release`)
- **Descrizione:** Durante `POST /api/android/build-release`, `server.ts` copia il progetto reale Jetpack Compose da `android-app/` dentro lo `.zip` del progetto Android Studio, ma alle righe 3085–3086 **sovrascrive** `app/build.gradle.kts` e `app/src/main/AndroidManifest.xml` usando `generateAppBuildGradleKts(config)` e `generateAndroidManifestXml(config)`:
  ```ts
  projectFolder.file("app/build.gradle.kts", generateAppBuildGradleKts(config));
  projectFolder.file("app/src/main/AndroidManifest.xml", generateAndroidManifestXml(config));
  ```
  `generateAppBuildGradleKts()` genera un file `build.gradle.kts` che **non contiene** le dipendenze `androidx.room`, `androidx.work:work-runtime-ktx`, `com.google.mediapipe:tasks-vision`, `com.squareup.okhttp3:okhttp`, né il plugin `ksp`, e imposta `JavaVersion.VERSION_21` invece di `VERSION_17`. Di conseguenza, il pacchetto `.zip` Android Studio scaricato dall'utente **non può compilare** i sorgenti Kotlin presenti in `app/src/main/java/com/valerio/photocloud/`! Inoltre, `generateMainActivityKt()` in `androidBuilder.ts` contiene ancora codice morto WebView con cifratura legacy `AES/CFB/NoPadding`.
- **Passi per riprodurre:** Eseguire `npx tsx audit/scripts/smoke_audit.ts` (`BUG-ANDROID-ZIP-EXPORT`) o confrontare `android-app/app/build.gradle.kts` con l'output di `generateAppBuildGradleKts()`.
- **Output Osservato:** `Room/WorkManager/MediaPipe assenti in generateAppBuildGradleKts(): true`.
- **Output Atteso:** Lo ZIP Android Studio esportato deve preservare `android-app/app/build.gradle.kts` e `AndroidManifest.xml` reali, sostituendo unicamente `applicationId`, `versionCode`, `versionName` e `DEFAULT_SERVER_URL`.

---

#### [BUG-05] Severità: MEDIA — `GET /api/shared-albums/:shareId/file/:filename` restituisce `HTTP 200 OK` invece di `HTTP 416 Range Not Satisfiable` su header `Range` fuori limite
- **File / Riga:** `server.ts` (righe 1676–1689)
- **Descrizione:** Negli endpoint `/media/:filename` (riga 1173) e `/share/:token/media/:filename` (riga 1455), quando `parseHttpRangeHeader()` restituisce `{ status: 'invalid' }`, il server risponde correttamente con `HTTP 416 Range Not Satisfiable`. Nell'endpoint degli album condivisi multi-utente `GET /api/shared-albums/:shareId/file/:filename` (righe 1678–1688), invece, viene controllato solo `if (parsedRange.status === 'ok')` e il ramo `parsedRange.status === 'invalid'` viene ignorato, facendo cadere l'esecuzione nel fallback finale `res.send(decryptedBuffer)` con `HTTP 200 OK` e l'invio dell'intero file.
- **Passi per riprodurre (eseguiti in `audit/scripts/smoke_audit.ts`):**
  ```bash
  curl -i -H "Cookie: session_id=..." -H "Range: bytes=99999999-100000000" \
    http://localhost:3000/api/shared-albums/<shareId>/file/vacanza_roma.jpg
  ```
- **Output Osservato:** `HTTP 200 (invia l'intero buffer ignorando parsedRange.status === 'invalid')`.
- **Output Atteso:** `HTTP 416 Range Not Satisfiable` con header `Content-Range: bytes */<size>`.
- **Fix Suggerito:** Aggiungere prima di `if (parsedRange.status === 'ok')`:
  ```ts
  if (parsedRange.status === 'invalid') {
    res.setHeader('Content-Range', `bytes */${decryptedBuffer.length}`);
    return res.status(416).end();
  }
  ```

---

#### [BUG-07] Severità: MEDIA — Dualismo Architetturale: Frontend React/Vite (`src/App.tsx`, `src/components/*`) completamente scollegato da `server.ts` (Dead Code a Runtime)
- **File / Riga:**
  - `server.ts` (righe 964–1068)
  - `src/App.tsx`, `src/components/GalleryView.tsx`, `src/components/LightboxModal.tsx`, `src/components/TrashView.tsx`, `src/components/AuthView.tsx`, `src/components/AndroidReleaseStudio.tsx`
- **Descrizione:** `npm run build` (`vite build`) compila l'applicazione React SPA situata in `index.html` + `src/App.tsx` + `src/components/*` dentro `dist/`. Tuttavia, `server.ts` **non monta mai Vite né serve `dist/`**: tutte le route web (`/login`, `/`, `/trash`, `/map`, `/share/:token`) restituiscono HTML generato lato server da `src/lib/templateRenderer.ts`, `src/lib/mapPage.ts` e `src/lib/sharePage.ts` corredato da script vanilla JS in `/static/scripts/*.js`. Inoltre, `src/App.tsx` gestisce stati solo in `localStorage` senza chiamare le API reali di `server.ts`.
- **Impatto:** Confusione manutentiva, build artifact (`dist/` da 913 KiB) inutilizzato dal server di produzione e **0% di test coverage** sui componenti React in `src/components/*`.
- **Fix Suggerito:** Rimuovere i componenti React legacy inutilizzati se l'architettura ufficiale è SSR (`templateRenderer.ts`), oppure collegare esplicitamente `server.ts` ai bundle compilati.

---

### 🟡 BASSA

#### [BUG-06] Severità: BASSA — Protezione CSRF aggirabile quando l'header `Origin` è `null` o con `Sec-Fetch-Site: cross-site` senza `Origin` (declassata a Bassa poiché `photocloud_sid` ha `HttpOnly` e `SameSite=Lax`)
- **File / Riga:** `server.ts` (righe 689–717 e riga 1923)
- **Descrizione:** Il cookie di sessione `photocloud_sid` è già emesso con i flag `Path=/; HttpOnly; SameSite=Lax; Max-Age=86400`, impedendo l'invio automatico del cookie su richieste `POST` cross-site nei browser moderni. Tuttavia, il middleware CSRF lasciava passare richieste con `Origin: null` (es. `<iframe sandbox allow-forms>`) o con `Sec-Fetch-Site: cross-site` prive di `Origin`.
- **Passi per riprodurre (eseguiti in `audit/scripts/smoke_audit.ts`):**
  Inviare `POST /api/albums/create` con `Origin: null` o `Sec-Fetch-Site: cross-site`.
- **Output Osservato:**
  ```
  Con Origin=evil.example.com -> HTTP 403; Con Origin=null -> HTTP 200
  ```
- **Output Atteso:** Rifiutare con `HTTP 403` qualsiasi richiesta state-changing con `Origin` presente e non same-origin (incluso `"null"`) o con `Sec-Fetch-Site: cross-site`, consentendo le richieste legittime prive di entrambi gli header (client nativo Android `OkHttp`).

---

#### [BUG-08] Severità: BASSA — Memory Leak potenziale in `SHARE_UNLOCK_ATTEMPTS` e vulnerabilità transitive `npm audit`
- **File / Riga:** `server.ts` (righe 205–222 e 473–491)
- **Descrizione:**
  1. Mentre le mappe di rate-limiting `LOGIN_ATTEMPTS`, `REGISTER_ATTEMPTS` e `SESSIONS` vengono ripulite periodicamente ogni 10 minuti nel timer `sessionCleanupTimer` (`server.ts:205-222`), la mappa `SHARE_UNLOCK_ATTEMPTS` (`server.ts:473`) non è inclusa nel ciclo di cleanup: chiavi `<ip>:<shareId>` scadute ma non più interrogate restano in RAM fino al riavvio del processo.
  2. `npm audit` rileva **6 vulnerabilità** (4 moderate su `glob` `GHSA-3g3m-2fjr-6pw4` e `minimatch` `GHSA-g3hv-75wg-m249`, 2 low su `deepmerge` `GHSA-gcqx-w48m-w2h4`) introdotte come dipendenze transitive di build da `vite-plugin-pwa@1.2.0` (`workbox-build`).

---

## 5. Analisi Qualità dei Test Esistenti e Gap di Copertura

### 5.1 Valutazione Qualitativa della Suite Esistente (`56 test`, `0 skippati`, `0 flaky`)
- **Punti di forza:**
  - I test non usano mock fittizi per il backend o il filesystem: `server.test.ts` e `serverFeatures.test.ts` avviano una vera istanza di `server.ts` su porta effimera con directory temporanea isolata (`fs.mkdtempSync`), testando la crittografia reale `AES-256-GCM`, il salvataggio atomico del vault e l'isolamento tra utenti.
  - Zero test skippati (`# skipped 0`, `# todo 0`) e zero flakiness osservata su 3 esecuzioni consecutive (`6.55s` – `7.78s`).
- **Debolezze strutturali nei test esistenti:**
  - Alcuni test in `crypto.test.ts` (test 10–19 e 21) eseguono verifiche su sorgenti Android/Web tramite **espressioni regolari sul testo dei file `.kt` e `.ts`** (`assert.match(mainActivityKt, ...)`). Sebbene utili come guardie statiche in assenza di Android SDK, non sostituiscono il compilatore Kotlin né test strumentati Android (infatti non hanno intercettato l'omissione di `AndroidMediaEditorEngine.kt` e `NaturalLanguageSearchEngine.kt` in `githubReleasePublisher.ts`).

### 5.2 Report di Coverage (`npx tsx --test --experimental-test-coverage`)

| File / Modulo | Line % | Branch % | Funcs % | Stato vs Soglia 70% | Note |
| :--- | :---: | :---: | :---: | :---: | :--- |
| `src/lib/templateRenderer.ts` | **98.98%** | 63.54% | 100.00% | ✅ Sopra 70% (Linee) | Branch < 70% |
| `src/lib/androidBuilder.ts` | **96.81%** | 40.00% | 100.00% | ✅ Sopra 70% (Linee) | Branch < 70% |
| `src/lib/crypto.ts` | **95.96%** | 83.33% | 100.00% | ✅ Sopra 70% | Ottima copertura |
| `src/lib/phash.ts` | **93.40%** | 90.38% | 100.00% | ✅ Sopra 70% | Ottima copertura |
| `src/lib/persistentSigning.ts` | **86.62%** | 59.77% | 100.00% | ✅ Sopra 70% (Linee) | Rami CLI `keytool` non coperti |
| `src/lib/liquidGlassEngine.ts` | **85.85%** | 72.73% | 100.00% | ✅ Sopra 70% | Buona copertura |
| `src/lib/exif.ts` | **85.41%** | 72.65% | 88.24% | ✅ Sopra 70% | Buona copertura |
| `src/lib/nlSearch.ts` | **80.08%** | 85.51% | 64.71% | ✅ Sopra 70% (Linee) | Funzioni helper secondarie |
| `src/lib/photoEditorMath.ts` | **79.78%** | 57.75% | 94.74% | ✅ Sopra 70% (Linee) | Rami edge-case crop/preset |
| `src/lib/documentEngine.ts` | **66.91%** | **57.14%** | **54.55%** | ❌ **Sotto 70%** | Mancano unit test diretti per PDF parser (`previewPdf`), legacy `.doc`/`.xls` (`extractPrintableRuns`) e ZIP nested entries |
| `src/lib/githubReleasePublisher.ts` | **17.32%** | **55.56%** | **57.14%** | ❌ **Sotto 70%** | Righe 72–456 mai eseguite nei test; conteneva infatti il bug v1.3.2 hardcoded |
| `src/lib/grouping.ts` | **0.00%** | **0.00%** | **0.00%** | ❌ **Sotto 70%** | Mai importato da alcun test |
| `src/App.tsx` & `src/components/*` | **0.00%** | **0.00%** | **0.00%** | ❌ **Sotto 70%** | Nessun test unitario/componente e non serviti da `server.ts` |

*(Nota: `server.ts`, `sharing.ts`, `pushService.ts`, `vaultStorage.ts`, `mapPage.ts` e `sharePage.ts` sono eseguiti nel processo figlio avviato da `server.test.ts` e `serverFeatures.test.ts`, ma non hanno unit test diretti nel processo principale del test runner).*

### 5.3 Test Mancanti Consigliati (in ordine di priorità)
1. **Priorità 1 (Release & OTA):** Test di regressione che verifichi che `release/photocloud-release-build.json`, `release/output-metadata.json`, `src/lib/githubReleasePublisher.ts`, `package.json` e `android-app/app/build.gradle.kts` abbiano tutti la **stessa `versionName` e `versionCode`**, che l'APK corrispondente esista in `release/` con `sizeBytes > 0`, e che `GET /api/android/update-manifest` risponda `HTTP 200`.
2. **Priorità 2 (Public Share Quota & Range):** Test per `maxDownloads` su accessi inline `/share/:token/media/:filename` (senza `?download=1`) e test `HTTP 416` su `Range` invalido in `/api/shared-albums/:shareId/file/:filename`.
3. **Priorità 3 (`documentEngine.ts`):** Unit test diretti per `previewPdf()`, file binari legacy `.doc`/`.xls` (`extractPrintableRuns`), CSV con virgolette annidate e protezione Zip-Bomb (`MAX_XML_UNCOMPRESSED_BYTES`, già prototipato in `audit/scripts/smoke_audit.ts`).
4. **Priorità 4 (`sharing.ts` & `vaultStorage.ts`):** Unit test diretti per scadenza temporale (`expiresAt`), concorrenza scritture (`withVaultLock` / `withSharingLock`) e migrazione automatica da file `.json` legacy in chiaro a `.enc` (`AES-256-GCM`).
5. **Priorità 5 (`grouping.ts`):** Unit test per `groupMediaByDate()` e `filterMediaBySearch()`.

---

## 6. Cosa NON ho potuto verificare e perché

1. **Compilazione reale ed esecuzione dell'APK Android nativo (`./gradlew assembleRelease` / Emulator):**
   - **Stato:** ❓ NON VERIFICABILE localmente.
   - **Motivo:** L'ambiente containerizzato Linux non dispone di Java JDK (`sh: 1: java: not found`), `keytool`, Android SDK né del wrapper `gradlew`. La compilazione Android avviene tramite GitHub Actions (`.github/workflows/android-ci.yml`).
2. **Pubblicazione reale su GitHub Releases e sincronizzazione GitHub Secrets (`publish-github-release.ts` verso API GitHub):**
   - **Stato:** ❓ NON VERIFICABILE contro le API remote di produzione.
   - **Motivo:** Assenza intenzionale di `GITHUB_TOKEN` (regola d'audit: non usare credenziali di produzione né eseguire deploy/push su repository reali).
3. **Consegna reale di notifiche Web Push cifrate RFC 8291 a browser remoti (FCM / Mozilla autopush):**
   - **Stato:** ⚠️ PARZIALE (verificati endpoint VAPID, subscribe/unsubscribe e payload encryption in `pushService.ts`, non il relay esterno FCM).
   - **Motivo:** Richiede una subscription push reale generata da un service worker registrato presso i server push di Google/Mozilla su dominio HTTPS pubblico.

---

## 7. Prossimi Passi Raccomandati

1. **Allineare subito la pipeline di Release v1.4.1 (Critico/Alto):**
   - Rimuovere `v1.3.2` / `versionCode: 29` hardcoded da `src/lib/githubReleasePublisher.ts` leggendo dinamicamente la versione da `package.json` / `build.gradle.kts`.
   - Aggiungere `AndroidMediaEditorEngine.kt` e `NaturalLanguageSearchEngine.kt` (o una scansione dinamica della cartella) a `filesToSync` in `src/lib/githubReleasePublisher.ts`.
   - Generare `release/photocloud-release-v1.4.1-signed.apk` o abilitare in `resolveReleaseApk()` (`server.ts:2566`) il fallback all'ultimo APK firmato valido presente in `release/` (`v1.3.2`), così da ripristinare immediatamente `GET /api/android/update-manifest` (`HTTP 200`).
2. **Correggere l'esportazione ZIP Android Studio (`src/lib/androidBuilder.ts` / `server.ts:3085`):**
   - Non sovrascrivere `app/build.gradle.kts` e `AndroidManifest.xml` con i template WebView legacy di `androidBuilder.ts`; patchare invece il file `android-app/app/build.gradle.kts` reale mantenendo Room, WorkManager, MediaPipe e JDK 17.
3. **Chiudere i bug di sicurezza e protocollo HTTP in `server.ts`:**
   - Incrementare `downloadCount` in `GET /share/:token/media/:filename` anche quando `?download=1` non è specificato (evitando il bypass di `maxDownloads`).
   - Gestire `if (parsedRange.status === 'invalid') return res.status(416)...` in `GET /api/shared-albums/:shareId/file/:filename`.
   - Rafforzare il middleware CSRF richiedendo `X-CSRF-Token` su tutte le mutazioni autenticate via cookie anche quando `Origin` è assente.
   - Aggiungere la pulizia di `SHARE_UNLOCK_ATTEMPTS` nel timer `sessionCleanupTimer`.
4. **Risolvere il dualismo Frontend (`dist/` vs `templateRenderer.ts`):**
   - Archiviare o rimuovere `src/App.tsx` e `src/components/*` se l'interfaccia ufficiale servita da `server.ts` è quella SSR (`src/lib/templateRenderer.ts` + `static/scripts/*`), eliminando codice morto non testato.
