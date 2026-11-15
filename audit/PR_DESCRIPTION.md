# PR: Security Hardening & Audit Fixes — PhotoCloud v1.4.1 (`fix/audit-findings`)

## Sintesi
Questa PR applica e verifica con test di regressione (test-before-fix) i fix e le misure di hardening derivanti dall'audit di sicurezza e qualità su **PhotoCloud v1.4.1**:
- Protezione quota `maxDownloads` e streaming playback su `/share/:token/media/:filename`
- Preview ridimensionate (`?preview=thumb` 360px / `?preview=large` 1280px) con cache sicura, lazy loading + backoff `1s/2s/4s`, coda Jimp bounded (`32` job, timeout `10s`, `503 + Retry-After`) e rate limit `/share/*` (`600 req/min/IP`)
- Protezione CSRF strict (`Origin: null`, `Sec-Fetch-Site: cross-site`) e configurazione sicura `TRUST_PROXY` (numero hop o lista subnet; con `TRUST_PROXY=true` il server si avvia emettendo un warning esplicito e rifiutando il valore mantenendo `trust proxy = false` + documentazione in `README.md`)
- Gestione conforme HTTP `Range` (`416` su `bytes=` invalido in `/api/shared-albums/*`, `200` su unità ≠ `bytes=`)
- Hardening pipeline release Android (`githubReleasePublisher.ts`, `androidBuilder.ts`, gate `npm run release:check`)

---

## Stato dei Findings Originali (`audit/AUDIT_REPORT.md`)

| ID | Severità | Descrizione | Stato | Note |
| :--- | :---: | :--- | :---: | :--- |
| **BUG-01** | ALTA | `/api/android/update-manifest` e `build-release` 404 per `v1.4.1` (APK non ancora compilato) | **Accettato / Mitigato** | Mantenuto `404` (Opzione 6C); `AppAutoUpdater.kt` gestisce il 404 senza crash; aggiunto gate `npm run release:check` su `release:apk`. |
| **BUG-02** | ALTA | `githubReleasePublisher.ts`: versione hardcoded `v1.3.2` e `filesToSync` incompleto | **Risolto** | Lettura versione da `build.gradle.kts` (fallisce se assente), allowlist/denylist strict (rimossa `.properties` eccetto `gradle-wrapper.properties`, bloccati `*keystore*`, `*secret*`, `*credential*`, `*.pem`, `*.key`, `.env*`, `signing*`), scansione limitata a `android-app/` + file espliciti. |
| **BUG-03** | ALTA | Bypass `maxDownloads` su `GET /share/:token/media/:filename` | **Risolto** | Conteggio atomico su ogni accesso all'originale; preview `360px`/`1280px` con `Cache-Control: private, no-cache` + evizione alla revoca; playback grant 2h con budget `1.5x` prenotato sincronamente prima della decifratura (fail-closed su disconnect); lazy+backoff e coda Jimp `32`/`10s` (`503 + Retry-After`). |
| **BUG-04** | MEDIA | `androidBuilder.ts`: `generateAppBuildGradleKts()` incompatibile con progetto Compose/Room/MediaPipe | **Risolto** | Allineato a `build.gradle.kts` reale (KSP, Room, WorkManager, MediaPipe, OkHttp, JVM 17). |
| **BUG-05** | MEDIA | `GET /api/shared-albums/:shareId/file/:filename` rispondeva `200` su `Range` invalido | **Risolto** | Restituisce `416 Range Not Satisfiable` su `bytes=` malformato/fuori limite; ignora unità ≠ `bytes=` con `200` (RFC 9110 §14.2). |
| **BUG-06** | BASSA | CSRF con `Origin: null` o `Sec-Fetch-Site: cross-site` | **Risolto** | Blocco `403` su `Origin` non same-origin / `"null"` e `Sec-Fetch-Site: cross-site`; `X-Forwarded-*` letto solo se `TRUST_PROXY` è configurato come intero hop (`number`) o lista subnet fidate (`"true"` rifiutato con warning all'avvio senza bloccare lo startup). |
| **BUG-07** | MEDIA | SPA React (`src/App.tsx`, `src/components/*`) scollegata da `server.ts` | **Aperto (Fuori Scope)** | Non modificata per vincolo di scope; il server usa i renderer SSR. |
| **BUG-08** | BASSA | Pulizia mappe rate-limit/grant e 6 warning `npm audit` (dev build deps) | **Accettato / Mitigato** | Pruning aggiunto a `SHARE_PLAYBACK_GRANTS` e `shareIpRateBuckets`; 6 advisory confinati alle dipendenze dev di `vite-plugin-pwa`/`workbox-build`. |

---

## Findings aperti / fuori scope

1. **APK `v1.4.1` mancante (`release/photocloud-release-v1.4.1-signed.apk`):** l'ambiente container è privo di JDK e Android SDK; `/api/android/update-manifest` continua intenzionalmente a restituire `404` (`BUG-01`) finché l'APK non viene compilato in locale/CI e `npm run release:check` fallisce come gate di sicurezza finché l'artefatto manca.
2. **ZIP progetto Android non compilato con Gradle in questo ambiente:** `POST /api/android/build-release` e lo script di sync sono coperti da allineamento configurazione (`build.gradle.kts`, KSP, Room, WorkManager, MediaPipe) e guardie statiche nei test TS, ma la compilazione nativa `./gradlew assembleRelease` sullo ZIP esportato resta da verificare in ambiente Android SDK / CI GitHub Actions.
3. **SPA React (`src/App.tsx`, `src/components/*`) non collegata a `server.ts` (`BUG-07`):** esclusa esplicitamente dallo scope di questa branch; il traffico web servito in produzione continua a passare dai template SSR (`templateRenderer.ts`, `sharePage.ts`, `mapPage.ts`).
4. **Copertura `src/lib/grouping.ts` allo `0%`:** modulo helper lato client/condiviso (`AUDIT_REPORT.md` §5.2) non importato direttamente dalla suite Node (`server.test.ts` esercita il corrispondente script runtime `static/scripts/grouping.js` tramite il server); nessuna modifica effettuata per evitare refactor fuori perimetro.

---

## Rischi Residui Accettati

1. **Preview `1280px` (`?preview=large`) non conteggiate in `maxDownloads`:** scelte per consentire l'uso di griglia e lightbox senza consumare i download dell'originale; restituiscono `410` appena scade/revoca/esaurisce la quota e sono protette da `Cache-Control: private, no-cache`, coda Jimp (`32` job, `10s` timeout → `503`) e rate limit `600 req/min/IP`.
2. **Assunzione Single-Process:** l'atomicità sincrona di quota, playback grant, cache preview, coda Jimp, sessioni e rate-limit richiede l'esecuzione su singolo processo Node.js.
3. **Prenotazione byte fail-closed su disconnessioni a metà:** i byte prenotati in `SHARE_PLAYBACK_GRANTS` restano dedotti se il client chiude a metà la connessione, prevenendo download illimitati tramite TCP reset.
4. **Comportamento `TRUST_PROXY=true` e rischio `429` a bucket unico senza trust proxy:** con `TRUST_PROXY=true` il server **si avvia** emettendo un `console.warn` esplicito e **rifiuta il valore** lasciando `trust proxy = false`. Se l'istanza gira dietro un reverse proxy con `trust proxy` disabilitato (valore omesso, `0`/`false`, oppure `"true"` rifiutato), `req.ip` corrisponde all'IP del proxy: **tutti i client condividono un unico bucket di rate limit**, con rischio di falsi `HTTP 429` su `/share/*`, `/login` e `/share/:token/unlock` (oltre a `403` CSRF se l'origin esterno usa `https`). Configurare sempre `TRUST_PROXY=<numero-hop>` o una lista di subnet fidate.
5. **Compilazione APK `v1.4.1`:** richiede JDK + Android SDK (non disponibili in questo container; verificabile in CI su GitHub Actions).

---

## Comandi per Riprodurre i Test

```bash
# Typecheck statico
npm run lint

# Suite completa unit & integration (67/67 pass)
npm test

# Test mirati per area modificata
npx tsx --test src/lib/trustProxy.test.ts
npx tsx --test src/lib/server.test.ts
npx tsx --test src/lib/serverFeatures.test.ts
npx tsx --test src/lib/crypto.test.ts

# Build produzione PWA / Vite
npm run build

# Gate release APK (atteso fail finché release/photocloud-release-v1.4.1-signed.apk non è compilato)
npm run release:check
```
