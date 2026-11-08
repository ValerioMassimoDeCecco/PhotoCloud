# PhotoCloud Android v1.0.4 — Avvio Istantaneo (0ms) e Firma Keystore Persistente

Questa versione elimina completamente il cerchio di caricamento all'apertura dell'app Android rendendo l'avvio istantaneo (0ms) grazie alla persistenza locale dello stato e della galleria con sincronizzazione silenziosa in background, e introduce un certificato di firma RSA-2048 fisso nel repository per garantire che tutte le release presenti e future aggiornino direttamente l'APK installato senza conflitti di firma.

## User Review & Critical Decisions

> [!IMPORTANT]
> Le scelte confermate garantiscono un'apertura immediata dell'interfaccia nativa a 120Hz e la continuità crittografica del certificato di firma tra tutte le versioni successive.

- **Avvio Istantaneo a 0ms (Zero Spinner)**: Rimozione totale dello stato di blocco iniziale (`CircularProgressIndicator`). L'app legge sincronamente in memoria i cookie di sessione e la cache locale dei metadati mostrando nel primo frame la schermata di Login oppure la Galleria/Sblocco Biometrico, aggiornando i dati in background senza bloccare l'utente.
- **Keystore Fisso nel Repository**: Salvataggio di un keystore RSA-2048 persistente e immutabile nel repository e rimozione della rigenerazione casuale ad ogni esecuzione di GitHub Actions, così ogni nuova release (`v1.0.4` e successive) mantiene la stessa identica firma digitale e aggiorna l'app Android direttamente.

---

## 1. Overview & Core Concept

- **Cosa fa**: All'apertura dell'app Android nativa, l'interfaccia compare istantaneamente al primo frame (0ms) senza alcuno spinner di attesa. Se l'utente non ha una sessione salvata, vede subito la schermata di Login (con pulsante biometrico rapido); se ha una sessione attiva, vede immediatamente la propria Galleria (o il prompt biometrico se attivo) popolata con gli elementi in cache mentre la sincronizzazione col server avviene silenziosamente in background.
- **Target & Contesto**: Utenti dell'app nativa Android PhotoCloud che desiderano una reattività istantanea a 120Hz e aggiornamenti diretti tramite APK da GitHub Releases.
- **Valore Chiave**: Eliminazione di qualsiasi latenza percepita all'avvio (anche quando il server locale impiega qualche secondo a rispondere o non è raggiungibile) e aggiornamenti in-place dell'APK senza dover disinstallare la versione precedente.

---

## 2. User Experience & Visual Design

- **Flusso di Avvio Istantaneo (0ms Cold/Warm Start)**:
  1. **Utente non autenticato (nessun cookie di sessione salvato)**: L'app apre istantaneamente al frame 0 la schermata `NativeAuthScreen` senza effettuare chiamate di rete bloccanti né mostrare indicatori di caricamento.
  2. **Utente autenticato (sessione presente)**: L'app carica in meno di 1 millisecondo dalla cache locale l'elenco delle foto e del cestino dell'ultima sessione, mostrando subito la griglia Material You (o la schermata `NativeBiometricLockScreen` con `BiometricPrompt` immediato se il blocco biometrico è attivo).
  3. **Sincronizzazione Silenziosa in Background**: In parallelo, il client interroga il server con timeout ridotti per aggiornare eventuali nuovi scatti senza interrompere la navigazione o lo scorrimento a 120Hz.
- **Identità Visiva & Tema**:
  - *Estetica*: Material You (Material Design 3 Dynamic Color) nativo Jetpack Compose, minimalista, 120Hz con Floating Bar posizionata in basso.
  - *Feedback Visivo*: Nessuno spinner a schermo intero all'apertura; transizioni fluide tra le viste e apertura immediata della Lightbox tramite cache `Bitmap` condivisa in memoria e su disco.

---

## 3. Key Product Decisions & Trade-Offs

- **Decisione 1: Persistenza Locale della Sessione e della Galleria (`Offline-First Instant Hydration`)**
  - *Approccio scelto*: Memorizzazione locale istantanea dello stato di autenticazione e della lista JSON degli elementi di Galleria e Cestino, unita alla verifica sincrona della presenza del cookie di sessione prima di qualsiasi richiesta HTTP.
  - *Perché*: Evita di attendere il round-trip HTTP verso il server locale prima di disegnare l'interfaccia, eliminando completamente il cerchio di caricamento iniziale.
  - *Alternative scartate*: Ridurre soltanto il timeout HTTP (mostrerebbe comunque il cerchio per 1-2 secondi a ogni apertura).
- **Decisione 2: Keystore RSA-2048 Persistente e Deterministico**
  - *Approccio scelto*: Generazione e inclusione diretta del keystore di rilascio fisso nel repository Android, modificando la pipeline CI/CD di GitHub Actions affinché utilizzi sempre il keystore esistente anziché eseguire `rm -f` e `keytool -genkeypair` ad ogni build.
  - *Perché*: Il sistema operativo Android consente l'aggiornamento diretto (`adb install -r` o installazione da pacchetto scaricato) solo se il certificato X.509 dell'APK coincide esattamente con quello già installato.

---

## 4. Technical Architecture & Data Strategy *(Technical Reference)*

- **Architettura di Avvio Istantaneo e Pipeline di Firma**:

```
┌─────────────────────────────────────────────────────────────────────────┐
│                    AVVIO APP ANDROID NATIVA (0ms)                       │
└───────────────────────────────────┬─────────────────────────────────────┘
                                    │
                  Lettura Sincrona Cookie + Cache Locale
                                    │
            ┌───────────────────────┴───────────────────────┐
            ▼                                               ▼
┌───────────────────────────────┐               ┌───────────────────────────────┐
│   Nessun Cookie di Sessione   │               │    Cookie Sessione Presente   │
│  ───────────────────────────  │               │  ───────────────────────────  │
│  Mostra subito al Frame 0:    │               │  Idrata subito da Cache:      │
│  • NativeAuthScreen           │               │  • NativeBiometricLockScreen  │
│  • Login Rapido con Impronta  │               │    oppure NativeVaultScreen   │
│  (Zero chiamate di rete)      │               │  • Sync silenzioso in bg      │
└───────────────────────────────┘               └───────────────┬───────────────┘
                                                                │
                                                                ▼
                                                ┌───────────────────────────────┐
                                                │   Background Coroutine Sync   │
                                                │  ───────────────────────────  │
                                                │  • Aggiorna lista foto/trash  │
                                                │  • Salva nuova cache locale   │
                                                └───────────────────────────────┘

┌─────────────────────────────────────────────────────────────────────────┐
│             PIPELINE DI FIRMA PERSISTente (v1.0.4 -> v1.0.x)            │
│  ┌──────────────────────────────┐      ┌─────────────────────────────┐  │
│  │ Keystore RSA-2048 Fisso      │ ───► │ Gradle assembleRelease      │  │
│  │ (Stesso Certificato SHA-256) │      │ APK v1.0.4 (versionCode 5)  │  │
│  └──────────────────────────────┘      └─────────────────────────────┘  │
└─────────────────────────────────────────────────────────────────────────┘
```

- **Modello Dati & Stato Locale**:
  - **Stato di Sessione Sincrono**: Metodo immediato `hasActiveSessionCookie()` sul `CookieJar` persistente per sapere a 0ms se esiste un cookie `photocloud_sid` per il server configurato.
  - **Cache Metadati Galleria/Cestino**: Serializzazione immediata della lista di `MediaItemModel` in `SharedPreferences` a ogni caricamento o modifica (upload, spostamento nel cestino, ripristino, eliminazione), letta sincronamente nel blocco `remember` iniziale di `MainActivity`.
  - **Cache Miniature su Disco + RAM**: Oltre alla `LruCache<String, Bitmap>` in RAM per l'apertura istantanea della Lightbox, salvataggio delle immagini decifrate nella directory `cacheDir` privata dell'app per mostrare le miniature istantaneamente anche al riavvio dell'app.
- **Mappatura Interazioni & Gestione Stato**:
  - All'avvio (`onCreate`), se `hasActiveSessionCookie()` è falso, `isAuthenticated` parte a `false` e non viene lanciata alcuna richiesta di rete finché l'utente non effettua il login.
  - Se `hasActiveSessionCookie()` è vero, `isAuthenticated` parte subito a `true`, `galleryItems` e `trashItems` vengono popolati istantaneamente dalla cache locale, l'eventuale `BiometricPrompt` viene mostrato immediatamente e in background `refreshVault()` aggiorna silenziosamente i dati.
