# Inventario Modifiche per Commit Separati (FASE 4.0.x & FASE 4A / 4A-bis)

Poiché il container non dispone della storia `.git`, questo documento raggruppa tutti i file creati, modificati o eliminati per area tematica, consentendo commit atomici e separati.

---

## 1. Tema `4.0.x` — Web App v2, SDK Web Zero-Knowledge & Server API v2

| Stato | Percorso File | Scopo Principale |
|---|---|---|
| Modificato | `package.json` | Separazione netta `dependencies` (solo runtime `npm start`) vs `devDependencies` (Vite/React/Tailwind/TypeScript/`@types/*`); pin `hash-wasm@4.12.0` (>= 2 settimane, rimosso `@google/genai` inutilizzato). |
| Modificato | `package-lock.json` | Lockfile allineato dopo `npm install` e `npm audit fix` (non-breaking). |
| Modificato | `server.ts` | Mount isolato `/api/v2` e `/v2`, emissione singola di `setupToken` CSPRNG su stdout al primo avvio, supporto `TRUST_PROXY`. |
| Modificato | `src/lib/zkServerV2.ts` | Enforcement `HTTPS_REQUIRED` (`403`), `setupToken` monouso in `timingSafeEqual`, hash `SHA-256` per `sid_hash`, limiti e cleanup upload orfani/cestino/share. |
| Esistente/Modificato | `src/lib/zk/` (`argon2id.ts`, `errors.ts`, `index.ts`, `kdf.ts`, `metaAndDedup.ts`, `pczkStream.ts`, `provider.ts`, `worker.ts`, `zeroize.ts`) | Core crittografico Web TS (`Argon2id`, `HKDF-SHA256`, `AES-256-GCM`, framing `PCZK v1`, `decryptBlobRange`, zeroizzazione). |
| Esistente/Modificato | `src/client/zk-sdk/` (`client.ts`, `docPreview.ts`, `index.ts`, `kdfPolicy.ts`, `shareCrypto.ts`, `swStreamEngine.ts`, `types.ts`, `zipStream.ts`) | SDK Web v2: KDF floor (`>= 64 MiB`, `t >= 3`, `salt >= 16B`) & pinning, share E2EE (`#fragment`), engine Service Worker ticket `(blobId, clientId)`, anteprima DOCX/PDF/testo client-side, export ZIP streaming. |
| Modificato | `src/client/v2-app/main.ts` | UI `/v2` senza inline script/style, avviso passphrase non recuperabile, player `<video>` via `/v2/__stream/:blobId`, registrazione Service Worker con `scope: '/v2'`. |
| Modificato | `src/client/v2-app/router.ts` | Router `/v2` con CSP rigorosa (`V2_STRICT_CSP`), `Referrer-Policy: no-referrer`, header `Service-Worker-Allowed: /v2`. |
| Rigenerato | `public/v2/app.js` | Bundle ESM `/v2/app.js` rigenerato da `src/client/v2-app/main.ts` con `hash-wasm@4.12.0` e `scope: '/v2'`. |
| Esistente | `public/v2/app.css`, `public/v2/sw-stream.js` | Foglio di stile CSP-compliant e Service Worker streaming `Range` (`Cache-Control: no-store`, zero Cache API sul plaintext). |
| Modificato | `src/lib/serverV2.test.ts` | Suite integrazione API server v2 (10 test, incluso test `#10` `HTTPS_REQUIRED`). |
| Modificato | `src/lib/zkWebSdk.test.ts` | Suite SDK Web v2 (9 test totali: 8 PASS + 1 `SKIP`/`PENDING` in locale per reverse interop `Kotlin -> TS`, `REQUIRE_KOTLIN_ARTIFACTS=1` in CI). |

---

## 2. Tema `4A.x` — Android Core Crypto (Kotlin JVM, BouncyCastle & ProGuard)

*(Nessuna modifica al codice v1 esistente in `MainActivity.kt`, `PhotoCloudApiClient.kt`, `AutoBackupWorker.kt` né alcuna UI Android.)*

| Stato | Percorso File | Scopo Principale |
|---|---|---|
| Modificato | `android-app/app/build.gradle.kts` | Aggiunta dipendenza `org.bouncycastle:bcprov-jdk18on:1.82` (licenza MIT-style) usata sia in `src/main` sia in `testDebugUnitTest`; mantenuto `maxHeapSize = "128m"`. |
| Modificato | `android-app/app/proguard-rules.pro` | Regole R8/ProGuard `-keep` / `-dontwarn` per `Argon2BytesGenerator`, `Argon2Parameters`, `Blake2bDigest` e `com.valerio.photocloud.zk.**`. |
| Riscritto | `android-app/app/src/main/java/com/valerio/photocloud/zk/ZkArgon2id.kt` | **Rimossa l'implementazione in-house da `src/main/`**. Ora usa esclusivamente BouncyCastle `Argon2BytesGenerator` + `Argon2Parameters` e `validateKdfParamsFloor(...)`. |
| Esistente | `android-app/app/src/main/java/com/valerio/photocloud/zk/ZkCoreCrypto.kt` | HKDF-SHA256, wrapping `VK`/`FK`/`Share`, streaming `PCZK v1`, `decryptBlobRange`, metadati, `shareManifest`, catalogo album cifrato. |
| Esistente | `android-app/app/src/main/java/com/valerio/photocloud/zk/ZkKeyStoreProtector.kt` | Interfaccia astrazione `VaultKeyStore` + `InMemoryVaultKeyStore` (usata dai futuri flussi 4B, senza modifiche ai file v1). |
| Creato | `android-app/app/src/test/java/com/valerio/photocloud/zk/ZkReferenceArgon2idCrossCheck.kt` | Implementazione RFC 9106 di riferimento isolata esclusivamente in `src/test/` ed etichettata `TEST-ONLY CROSS-CHECK`. |
| Riscritto | `android-app/app/src/test/java/com/valerio/photocloud/zk/ZkCoreCryptoTest.kt` | Test JVM su RFC 5869, RFC 9106 §5.3 (con produzione BouncyCastle + cross-check test-only), key hierarchy, 305 MiB `-Xmx128m`, negativi, `TS -> Kotlin` (`test-vectors/interop/`) ed emissione reale `Kotlin -> TS` in `android-app/app/build/interop-kotlin/`. |
| Modificato | `android-app/gradle/wrapper/gradle-wrapper.properties` | Versione Gradle fissata a `gradle-8.10.2-bin.zip` *(nota: `gradlew` e `gradle-wrapper.jar` non sono presenti nel repo)*. |

---

## 3. Tema `CI, Interop & E2E Tooling`

| Stato | Percorso File | Scopo Principale |
|---|---|---|
| **Eliminato** | `test-vectors/interop-kotlin/` *(intera cartella)* | Rimossi i fixture non generati da Kotlin; nessuna pretesa residua di "Kotlin -> Web verificato" finché il job CI `interop` non consuma l'artifact di `kotlin-tests`. |
| Esistente | `test-vectors/zk-v1.json`, `test-vectors/interop/*.bin`, `test-vectors/interop/blob.pczk`, `test-vectors/interop/manifest.json` | Vettori ufficiali e fixture reali `Web -> Android/Python`. |
| Modificato | `scripts/verify-interop.py` | Rimosso `ensure_kotlin_reverse_interop_fixtures()`; default `--kotlin-dir` su `android-app/app/build/interop-kotlin`; emette `[PENDING]` in locale se assenti ed esce `!= 0` con `--require-kotlin` / `REQUIRE_KOTLIN_ARTIFACTS=1`. |
| Modificato | `scripts/e2e-v2-server.ts` | Server E2E `/v2` con directory temporanea (`E2E_DATA_DIR`), porta effimera (`E2E_PORT=0`) e stampa su stdout di `setupToken` CSPRNG monouso (nessun token hardcoded). |
| Creato | `scripts/e2e-v2-playwright.mjs` | Suite Playwright browser reale per tutti i flussi 1–9 (inclusi SW Video Range `206`, `Cache-Control: no-store`, zero Cache API, Editor, ZIP, Cestino, DOCX/PDF, Share `#fragment` in contesto zero-cookie), tracce `trace-*.zip`, screenshot ed exit `!= 0` su qualsiasi fallimento. |
| Modificato | `scripts/run-v2-playwright-e2e.sh` | Launcher E2E con `mktemp -d`, estrazione dinamica `setupToken` e `E2E_BASE_URL` dallo stdout di `e2e-v2-server.ts` e propagazione exit code non zero. |
| Modificato | `.github/workflows/android-ci.yml` | 3 job: `kotlin-tests` (JDK 17, Gradle `8.10.2`, comando `gradle testDebugUnitTest --info --no-daemon --stacktrace`, upload artifact `interop-kotlin-fixtures`), `interop` (`needs: kotlin-tests`, download artifact, `tsx --test src/lib/zkWebSdk.test.ts` + `verify-interop.py --require-kotlin`), e `web-e2e` (Playwright Chromium, `run-v2-playwright-e2e.sh`, upload tracce/screenshot). |

---

## 4. Tema `Docs`

| Stato | Percorso File | Scopo Principale |
|---|---|---|
| Modificato | `docs/zk-spec.md` | Deviazione documentata Android Argon2id (`bcprov-jdk18on:1.82` in prod/test, `argon2kt` opzionale su benchmark reali), `hash-wasm@4.12.0`, requisiti `HTTPS_REQUIRED` / `setupToken` / SW ticket semantics. |
| Modificato | `docs/zk-android-plan.md` | Aggiornamento architettura Argon2id BouncyCastle 1.82 vs `argon2kt` opzionale, allineamento Gradle `8.10.2` / JDK `17` e stato reale `4A-bis`. |
| Creato | `docs/phase-4a-changes.md` | Questo indice tematico per commit separati. |
