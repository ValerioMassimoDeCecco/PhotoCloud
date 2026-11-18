# Inventario Modifiche per Commit Separati (FASE 4B & FASE 4B-bis — Login, Keystore, Rete v2, Test Strumentati & Hardening Statico)

Tutte le funzionalità v1 esistenti nell'app Android restano intatte dietro `ZkV2FeatureGate` (`zk_v2_enabled`, default `false`). Nessun file di `test-vectors/` né `docs/zk-spec.md` è stato modificato.

---

## 1. Tema `4B.1` — Configurazione Sicurezza Android (Release vs Debug), Manifest, Gradle & ProGuard

| Stato | Percorso File | Scopo Principale |
|---|---|---|
| Modificato | `android-app/app/src/main/res/xml/network_security_config.xml` | Disabilita cleartext HTTP su **tutti** gli host (`cleartextTrafficPermitted="false"`) senza eccezioni loopback per i build **release**. |
| Creato | `android-app/app/src/debug/res/xml/network_security_config.xml` | Override limitato ai soli build `debug` / `androidTest` per consentire HTTP loopback (`localhost`, `127.0.0.1`, `10.0.2.2`). |
| Creato | `android-app/app/src/main/res/xml/backup_rules.xml` | Esclude ogni dominio (`root`, `file`, `database`, `sharedpref`, `external`) dal backup classico Android. |
| Creato | `android-app/app/src/main/res/xml/data_extraction_rules.xml` | Esclude ogni dominio da cloud backup e device transfer Android 12+ (`API 31+`). |
| Modificato | `android-app/app/src/main/AndroidManifest.xml` | Collega `@xml/network_security_config`, `@xml/backup_rules`, `@xml/data_extraction_rules`, mantiene `android:allowBackup="false"` e rimuove `usesCleartextTraffic="true"`. |
| Modificato | `android-app/app/build.gradle.kts` | Imposta `testInstrumentationRunner`, mantiene `maxHeapSize = "128m"`, propaga `-Dzk.mutation`, aggiunge dipendenze di test `mockwebserver`, `okhttp-tls`, `kotlinx-coroutines-test` e `androidTestImplementation`. |

---

## 2. Tema `4B.2` — Rete v2, Keystore Hardware-Backed, Sessione ZK & Isolamento Flag `zk_v2_enabled`

| Stato | Percorso File | Scopo Principale |
|---|---|---|
| Creato | `android-app/app/src/main/java/com/valerio/photocloud/zk/VaultKeyStore.kt` | Interfaccia `VaultKeyStore` + `InMemoryFakeVaultKeyStore` (JVM) + `AndroidHardwareVaultKeyStore` a doppia chiave (`photocloud_vk_bio_v2` `AUTH_BIOMETRIC_STRONG` invalidata al cambio biometria + `photocloud_vk_bg_v2` `setUnlockedDeviceRequired(true)`), tentativo StrongBox + fallback TEE, salvataggio della sola `VK` cifrata. |
| **Eliminato** | `android-app/app/src/main/java/com/valerio/photocloud/zk/ZkKeyStoreProtector.kt` | Sostituito e superato da `VaultKeyStore.kt`. |
| Creato | `android-app/app/src/main/java/com/valerio/photocloud/zk/TofuSpkiPinning.kt` | `TofuSpkiTrustManager` (`X509ExtendedTrustManager`): verifica validità certificato e CA di sistema, rifiuta certificati self-signed/sconosciuti prima dell'invio HTTP con `TofuConfirmationRequiredException`, abortisce su cambio SPKI (`TofuPinMismatchException`); nessun `TrustAll`, `HostnameVerifier` OkHttp intatto. |
| Creato | `android-app/app/src/main/java/com/valerio/photocloud/zk/ZkV2CookieJar.kt` | `CookieJar` esclusivamente in memoria isolato a `/api/v2/*` e HTTPS (o loopback se `allowLocalhostHttpForTests = true`). |
| Creato | `android-app/app/src/main/java/com/valerio/photocloud/zk/PhotoCloudZkApiClientV2.kt` | Client OkHttp `/api/v2/*` con redirect disabilitati, KDF params/login/logout/rewrap e helper test live `/items` + upload/download blob. **Zero interruttori/override di mutazione in `src/main/`.** |
| Creato | `android-app/app/src/main/java/com/valerio/photocloud/zk/ZkSessionManager.kt` | Login KeyFile JSON / Recovery Code + passphrase, `StrictArgon2idKdfPolicy` (`>= 64 MiB, t >= 3, p >= 1, salt >= 16 B`) prima di Argon2id, KDF pinning per username, errori uniformi, `.zeroize()`, `/account/rewrap`, auto-lock & wipe su `lock`/`onAppBackgrounded`/`logout`, fallback esplicito File Chiave + passphrase su `KeyInvalidatedException`. **Zero interruttori di mutazione in `src/main/`.** |
| Creato | `android-app/app/src/main/java/com/valerio/photocloud/zk/ZkV2AuthScreen.kt` | UI minimale Compose M3 (FASE 4B): toggle SAF KeyFile / Recovery Code, dialog TOFU SPKI / Mismatch / Rewrap, pannello stato Keystore/AutoLock/Logout, prompt `BIOMETRIC_STRONG` con `CryptoObject`. |
| Modificato | `android-app/app/src/main/java/com/valerio/photocloud/MainActivity.kt` | **Unico file v1 modificato**: wiring tramite `ZkV2FeatureGate` (`zk_v2_enabled`, default `false`) che impedisce qualsiasi istanziazione/invocazione del package `zk` a flag spento; hook `onStop()` -> `onAppBackgrounded()` solo in modalità v2; switch UI nella schermata auth legacy v1; `FLAG_SECURE` invariato. |

---

## 3. Tema `4B.3` — Test JVM (33 `@Test`), Mutazioni Isolate in `src/test`, Test Strumentati (3 `@Test`), Live Integration & CI

| Stato | Percorso File | Scopo Principale |
|---|---|---|
| **Eliminato** | `android-app/app/src/test/java/com/valerio/photocloud/zk/ZkReferenceArgon2idCrossCheck.kt` | Rimozione del cross-check in-house (bug indice `-2048` in `compressBlockFlat`, CI #29); i controlli indipendenti restano RFC 9106 §5.3 su BouncyCastle + `verify-interop.py` (`argon2-cffi`, 64 MiB). |
| Modificato | `android-app/app/src/main/java/com/valerio/photocloud/zk/ZkCoreCrypto.kt` & `ZkCoreCryptoTest.kt` (10 `@Test`) | Rimozione `ZkReferenceArgon2idCrossCheck`, allineamento `decryptBlobStream` STREAM al comportamento TS (emissione chunk autenticati + `.zeroize()` immediato) e asserzione esatta su prefisso chunk verificato / zero byte da chunk manomesso (`chunk k > 0`). |
| Creato | `android-app/app/src/test/java/com/valerio/photocloud/zk/VaultKeyStoreTest.kt` | 5 `@Test` JVM su `InMemoryFakeVaultKeyStore`: doppia chiave, `DeviceLockedException`, `KeyInvalidatedException`, fallback StrongBox, `deleteAllKeys`. |
| Creato | `android-app/app/src/test/java/com/valerio/photocloud/zk/ZkNetworkSpy.kt` | `ZkNetworkSpyInterceptor`: ispeziona URL, header e body HTTP per varianti `raw`, `hex`, `base64`, `base64url` e URL-encoded. |
| Creato | `android-app/app/src/test/java/com/valerio/photocloud/zk/PhotoCloudZkV2NetworkTest.kt` | 7 `@Test` JVM: guard `/api/v2/*` + HTTPS, isolamento `CookieJar`, handshake TOFU SPKI + hostname verifier + mismatch abort, KDF floor pre-Argon2id, errori uniformi, flusso completo `64 MiB` + rewrap + auto-lock + spy, e prove negative `-Dzk.mutation=accept_weak_kdf` / `leak_vk_header` interamente isolate in `src/test/`. |
| Creato | `android-app/app/src/test/java/com/valerio/photocloud/zk/ZkV2IsolationAndKeystorePolicyTest.kt` | 4 `@Test` JVM: isolamento totale `ZkV2FeatureGate` con `zk_v2_enabled=false`, fallback esplicito Key File + passphrase dopo `KeyInvalidatedException`, wipe su `lock`/`onAppBackgrounded`/`logout`, verifica assenza `VK` plaintext su prefs/file serializzati. |
| Creato | `android-app/app/src/test/java/com/valerio/photocloud/zk/AndroidLiveIntegrationTest.kt` | 1 `@Test` JVM live contro Express `/api/v2/*` seedato da TypeScript: decifratura blob TS in Kotlin, logout/wipe, rewrap Kotlin, vecchio/nuovo passphrase, upload PCZK v1 Kotlin verificato poi da TS, e `ZkNetworkSpyInterceptor`. |
| Creato | `android-app/app/src/androidTest/java/com/valerio/photocloud/zk/Argon2idBenchmarkInstrumentedTest.kt` | 1 `@Test` strumentato: benchmark BouncyCastle `1.82` Argon2id `64 MiB / t=3 / p=1` su emulatore/dispositivo Android con telemetria heap/latenza su `Log.i`, `stdout` e `sendStatus`. |
| Creato | `android-app/app/src/androidTest/java/com/valerio/photocloud/zk/AndroidKeyStoreInstrumentedTest.kt` | 2 `@Test` strumentati su `AndroidHardwareVaultKeyStore` reale (`KeyInfo`, nessuna `VK` plaintext nelle prefs, wipe, `CryptoObject` biometrico se configurato). |
| Creato | `scripts/android-integration-seed.ts` | Script Node/TS con credenziali random per run, masking `::add-mask::` in CI, output fuori dal repo (`os.tmpdir()`). |
| Creato | `scripts/android-integration-verify-kotlin-blob.ts` | Script Node/TS che verifica il rewrap Kotlin, rifiuto vecchia passphrase, login con nuova passphrase, sync e decifratura del blob `PCZK v1` caricato da Kotlin. |
| Modificato | `scripts/run-v2-playwright-e2e.sh` | Log server raw fuori dal repo, `::add-mask::` sul `setupToken` in CI, artifact `e2e-server.log` redatto. |
| Modificato | `.github/workflows/android-ci.yml` | Aggiunti step dedicati per le due mutazioni negative con verifica fallimento e nomi test rossi nel `GITHUB_STEP_SUMMARY`, check `aapt2`/`apkanalyzer` zero cleartext su APK release, masking `::add-mask::` anticipato prima di `keytool` + audit anti-leak finale su `unit-test-execution.log`, tabella benchmark Argon2id emulatore e summary/artifact `if: always()` in tutti i job. |
| Modificato | `.github/workflows/android-release.yml` | Aggiunto audit `aapt2`/`apkanalyzer` zero cleartext sull'APK release firmato, masking `::add-mask::` anticipato prima di `keytool`, audit anti-leak finale, upload audit artifact e summary `if: always()`. |
| Modificato | `docs/zk-android-plan.md`, `docs/phase-4b-changes.md`, `.gitignore` | Documentazione confini sicurezza `setUnlockedDeviceRequired`, deviazione rimozione `ZkReferenceArgon2idCrossCheck`, avvertenza emulatore vs device reale + comandi ADB/Gradle low-end, inventario aggiornato e `ci-logs/` in `.gitignore`. |
