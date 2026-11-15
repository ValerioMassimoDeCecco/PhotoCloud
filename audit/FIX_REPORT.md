# Report di Correzione e Hardening (Fix Report) — PhotoCloud v1.4.1

**Data:** 15 Novembre 2026  
**Branch Git:** `fix/audit-findings`  
**Stato Validazione:** `npm run lint` (`tsc --noEmit` exit `0`) e `npm test` (**67/67 test passati, 0 falliti**)  
**Vincoli rispettati:** Nessuna modifica alla SPA React (`src/App.tsx`, `src/components/*`), ai binari `release/*.apk` né a file contenenti segreti; nessun `git push`, merge o deploy eseguito.

---

## 1. Riepilogo Commit Finali sulla Branch `fix/audit-findings`

| Ordine | Commit | Messaggio | File Toccati |
| :---: | :--- | :--- | :--- |
| **Baseline** | `1b624c3` | `chore: baseline PhotoCloud v1.4.1 audit hardening passes 1-4` | Tutti i fix delle passate 1–4 consolidati |
| **M-1** | `d6f5320` | `fix(share): add lazy loading with 1s/2s/4s retry backoff on thumbnails, 32-job 10s Jimp queue, and 600/min rate limit` | `src/lib/sharePage.ts`, `server.ts`, `src/lib/serverFeatures.test.ts` |
| **M-2** | `4ccec0c` | `fix(proxy): validate TRUST_PROXY as hop integer or subnet list, reject 'true' with warning, test X-Forwarded-For rate-limit resistance, and document reverse-proxy deploy in README` | `src/lib/trustProxy.ts`, `src/lib/trustProxy.test.ts`, `server.ts`, `src/lib/server.test.ts`, `src/lib/githubReleasePublisher.ts`, `README.md` |
| **M-3** | `778b84c` | `fix(share): assert 206 Content-Length sum <= budget, abort cleanly on mid-transfer disconnect, and verify fail-closed byte reservation` | `server.ts`, `src/lib/serverFeatures.test.ts` |
| **M-4** | *(questo commit)* | `docs(audit): update FIX_REPORT.md and add PR_DESCRIPTION.md with original findings status, residual risks, and test commands` | `audit/FIX_REPORT.md`, `audit/PR_DESCRIPTION.md` |

---

## 2. Dettaglio Tecnico Ultimo Mini-Giro (`M-1 → M-3`) e Output Rossi Pre-Fix

### M-1 (`d6f5320`) — Griglia share (`loading="lazy"` + backoff `1s/2s/4s`), coda Jimp `32` job / timeout `10s`, rate limit `/share/*` a `600/min`

- **Problema:** La coda Jimp limitata a `4` job rigettava immediatamente con `503` l'apertura di gallerie condivise da `40+` foto non ancora in cache, e la soglia `240 req/min` su `/share/*` rischiava di bloccare pagina da 40 foto + retry + lightbox; inoltre i tag `<img>` non avevano `loading="lazy"` né retry con backoff esponenziale.
- **Fix applicata:**
  1. In `src/lib/sharePage.ts`, ogni miniatura della griglia usa `<img loading="lazy" ...>` con handler `onerror` che ritenta automaticamente fino a 3 volte con backoff **`1s, 2s, 4s`** (`[1000, 2000, 4000]`).
  2. In `server.ts`, `MAX_JIMP_PREVIEW_QUEUE_LENGTH` portato a **`32`** job (con `MAX_CONCURRENT_JIMP_PREVIEWS = 2`) e timeout di attesa **`10000ms` (10s)** (`JIMP_QUEUE_FULL` / `JIMP_QUEUE_TIMEOUT` → `503 Service Unavailable` + `Retry-After: 2`).
  3. Soglia del rate limit per IP su `/share/*` portata a **`600 req/min`** (`SHARE_IP_RATE_MAX = 600`), sufficiente per 40 miniature + preview lightbox + eventuali retry di una sessione reale.
- **Test aggiunto (`src/lib/serverFeatures.test.ts`):** Share con 40 foto non in cache + 40 preview lightbox lanciate in concorrenza: verifica `loading="lazy"`, `onerror` `(1000,2000,4000)`, risposta `503 + Retry-After` oltre coda `32`, e caricamento `200` di tutte le 40 miniature + 40 lightbox entro `< 10s`.

---

### M-2 (`4ccec0c`) — `TRUST_PROXY` sicuro (intero hop / lista subnet, rifiuto `"true"` con warning), test anti-spoofing `X-Forwarded-For` e guida README

- **Problema:** `TRUST_PROXY="true"` veniva accettato impostando Express `trust proxy`, e non erano supportati né numeri di hop `> 1` né liste di subnet fidate. Inoltre mancava un test che dimostrasse la resistenza del rate limiter `/share/*` a header `X-Forwarded-For` multipli contraffatti con `TRUST_PROXY=1`.
- **Fix applicata:**
  1. Nuovo modulo `src/lib/trustProxy.ts` (`parseTrustProxyConfig`) integrato in `server.ts` e in `EXPLICIT_SYNC_FILES` (`src/lib/githubReleasePublisher.ts`):
     - Accetta **interi positivi** (`1..64`) passati a Express come **`number`** (`app.set('trust proxy', 1)`).
     - Accetta **liste di IP / subnet CIDR IPv4/IPv6 o preset Express** (`loopback`, `linklocal`, `uniquelocal`) validate con `net.isIP`.
     - **Rifiuta e ignora `"true"`** emettendo un warning esplicito all'avvio (`console.warn`).
  2. Aggiunta in `README.md` la sezione **`Deploy dietro reverse proxy`** con documentazione dettagliata per `TRUST_PROXY`, `Host` / `X-Forwarded-Host`, `X-Forwarded-Proto` ed esempio di configurazione Nginx.
- **Test aggiunti (`src/lib/trustProxy.test.ts`, `src/lib/server.test.ts`):**
  - `TRUST_PROXY=1` con `X-Forwarded-For` multipli (`198.51.100.X, 203.0.113.50`) su `/share/*`: l'IP sinistro spoofato non aggira il rate limit (`429` all'11ª richiesta con `SHARE_RATE_LIMIT_MAX=10`).
  - `TRUST_PROXY="true"` emette warning all'avvio e non si fida di `X-Forwarded-*` (`403`).
  - `TRUST_PROXY="127.0.0.0/8, 10.0.0.0/8"` viene accettato e abilita `X-Forwarded-*`.
- **Output rosso del test senza fix:**
  ```text
  not ok 1 - server protects vaults, preserves collisions, and handles real media flows
    ---
    location: '/app/applet/src/lib/server.test.ts:12:1'
    failureType: 'testCodeFailure'
    error: `TRUST_PROXY="true" deve emettere un warning esplicito all'avvio`
    code: 'ERR_ASSERTION'
    operator: 'match'
  ```

---

### M-3 (`778b84c`) — Playback grant: assert `somma Content-Length dei 206 <= budget` e verifica su connessione caduta a metà

- **Verifica su connessione caduta a metà (comportamento fail-closed):**
  - `SHARE_PLAYBACK_GRANTS` prenota `grant.bytesUsed += responseBytes` **sincronamente prima** di `decryptFileAsync` e dell'invio HTTP (`res.send`).
  - Se il client chiude/interrompe la connessione mentre `decryptFileAsync` è in corso, la guardia `if (req.destroyed || res.destroyed || res.writableEnded) return;` interrompe l'invio prima di scrivere header/body, evitando errori su socket chiuso.
  - I byte già prenotati (`responseBytes`) **restano scalati** dal budget (`fail-closed`, nessun rimborso gratuito su abort TCP): un attaccante non può ottenere download illimitati chiudendo la connessione prima dell'EOF dopo aver scaricato quasi tutto il payload.
- **Test aggiunto (`src/lib/serverFeatures.test.ts`):**
  - **Test (c):** Verifica esplicita che `somma dei Content-Length di tutte le risposte 206 <= budget 1.5x (30B)` sotto 10 richieste `bytes=1-` parallele con cookie valido.
  - **Test (d):** Interrompe a metà una richiesta `Range: bytes=4-15` (12B) via `node:http` (`resDrop.destroy()` appena arrivano gli header `206`), poi verifica che un seek nel residuo (`bytes=16-19` → 20B/30B) riesca (`206`) mentre `bytes=1-` (19B → 39B > 30B) risponda `410`.
- **Output rosso del test senza fix (race asincrona tra check e incremento, fallimento specifico su somma `Content-Length`, NON su `500`):**
  ```text
  not ok 11 - share pubblico playback grant: budget 1.5x file size in 2h blocca bytes=1- ripetuto con cookie (410) e consente seek legittimi (206)
    ---
    location: '/app/applet/src/lib/serverFeatures.test.ts:546:13'
    failureType: 'testCodeFailure'
    error: 'Somma dei Content-Length dei 206 (194B) deve essere <= budget 1.5x (30B)'
    code: 'ERR_ASSERTION'
    expected: true
    actual: false
    operator: '=='
  ```

---

## 3. Stato Completo dei Findings Originali dell'Audit (`BUG-01` → `BUG-08`)

| ID | Severità | Finding Originale (`AUDIT_REPORT.md`) | Stato | Evidenza / Dettagli |
| :--- | :---: | :--- | :---: | :--- |
| **BUG-01** | ALTA | `/api/android/update-manifest` e `build-release` 404 per v1.4.1 (APK assente, metadata a 0) | **Accettato / Mitigato** | Mantenuto `404` intenzionale (Opzione 6C) finché l'APK `v1.4.1` non viene compilato con Android SDK; `AppAutoUpdater.kt` gestisce il `404` senza crash e `npm run release:check` blocca release con APK mancante o metadata a zero. |
| **BUG-02** | ALTA | `githubReleasePublisher.ts`: versione hardcoded `v1.3.2` e `filesToSync` incompleto | **Risolto** | Versione letta dinamicamente da `build.gradle.kts` (fallisce se mancante); scansione dinamica di `android-app/` + `EXPLICIT_SYNC_FILES`; allowlist senza `.properties` (eccetto `gradle-wrapper.properties`) e denylist estesa per segreti/keystore. |
| **BUG-03** | ALTA | Bypass `maxDownloads` su `GET /share/:token/media/:filename` | **Risolto** | Ogni accesso all'originale incrementa atomicamente `downloadCount`; introdotte varianti `?preview=thumb` (360px, q=68) e `?preview=large` (1280px, q=75) con `Cache-Control: private, no-cache`, coda Jimp `32` job (`10s` timeout → `503`), lazy+backoff UI, rate limit `600/min/IP` e playback grant 2h (`1.5x` byte budget sincrono fail-closed). |
| **BUG-04** | MEDIA | `androidBuilder.ts`: `generateAppBuildGradleKts()` disallineato dal progetto Android reale | **Risolto** | Allineato con `KSP`, `Room`, `WorkManager`, `MediaPipe`, `OkHttp` e JVM 17. |
| **BUG-05** | MEDIA | `GET /api/shared-albums/:shareId/file/:filename` restituiva `200` su Range invalido invece di `416` | **Risolto** | `parseHttpByteRange()` distingue `'none'` (unità ≠ `bytes=` → `200` per RFC 9110 §14.2) da `'invalid'` (`bytes=` malformato/fuori range → `416`). |
| **BUG-06** | BASSA | CSRF con `Origin: null` o `Sec-Fetch-Site: cross-site` | **Risolto** | Rifiuto `403` su `Origin` non same-origin (incluso `"null"`) e `Sec-Fetch-Site: cross-site`; cookie `HttpOnly; SameSite=Lax`; `X-Forwarded-*` letto solo con `TRUST_PROXY` configurato via intero hop o subnet list (mai `"true"`). |
| **BUG-07** | MEDIA | Dualismo SPA React (`src/App.tsx` / `src/components/*`) non servita da `server.ts` | **Aperto (Fuori Scope)** | Esclusa esplicitamente la modifica della SPA React per vincolo operativo; la web app di produzione usa i template SSR (`templateRenderer.ts`, `sharePage.ts`, `mapPage.ts`). |
| **BUG-08** | BASSA | Pulizia mappe rate-limit/grant in-memory e 6 warning `npm audit` su toolchain dev | **Accettato / Mitigato** | Aggiunto pruning per `SHARE_PLAYBACK_GRANTS` e `shareIpRateBuckets`; i 6 advisory `npm audit` riguardano dipendenze transitive dev (`vite-plugin-pwa`/`workbox-build`); resta l'assunzione single-process per gli stati in-memory. |

---

## 4. Rischi Residui Accettati

1. **Preview a `1280px` (`?preview=large`, JPEG q=75) esenti da `downloadCount` finché la quota è attiva:** scelta UX accettata per consentire la consultazione galleria/lightbox senza consumare la quota dell'originale full-resolution; bloccate immediatamente con `410` a esaurimento quota o revoca e protette da `Cache-Control: private, no-cache`, coda Jimp (`2` attivi / `32` in coda / `10s` timeout → `503`) e rate limit `600 req/min/IP`.
2. **Runtime Single-Process:** atomicità di `incrementShareDownloadCount()`, `SHARE_PLAYBACK_GRANTS`, `SHARE_PREVIEW_CACHE`, semaforo Jimp, sessioni e bucket rate-limit assumono un singolo processo Node.js sullo stesso volume.
3. **Prenotazione fail-closed su connessioni interrotte a metà:** i byte prenotati in `SHARE_PLAYBACK_GRANTS` restano dedotti se il client interrompe la connessione, evitando aggiramenti del budget `1.5x` tramite TCP reset ripetuti (un client su rete molto instabile potrebbe consumare il proprio margine extra dello `0.5x` prima di ricevere `410`).
4. **APK `v1.4.1` da compilare con Android SDK in CI / locale:** `release/photocloud-release-v1.4.1-signed.apk` non è compilabile nel container privo di JDK/Android SDK; finché non viene generato, `/api/android/update-manifest` risponde `404` e `npm run release:check` fallisce intenzionalmente.

---

## 5. Comandi per Riprodurre i Test e le Verifiche

```bash
# 1. Verifica statica dei tipi TypeScript
npm run lint

# 2. Esecuzione completa della suite unit & integration (67 test)
npm test

# 3. Esecuzione mirata per singolo file di test
npx tsx --test src/lib/trustProxy.test.ts
npx tsx --test src/lib/server.test.ts
npx tsx --test src/lib/serverFeatures.test.ts
npx tsx --test src/lib/crypto.test.ts

# 4. Build bundle frontend + Service Worker PWA
npm run build

# 5. Verifica gate di release Android (fallisce intenzionalmente finché manca l'APK v1.4.1)
npm run release:check
```
