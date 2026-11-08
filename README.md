# PhotoCloud Mobile & Android Release Studio

Versione Android & Progressive Web App (PWA) dell'archivio foto e video cifrato end-to-end **PhotoCloud**.

## Funzionalità Principali
- **Crittografia End-to-End AES-256-CFB + PBKDF2-HMAC-SHA256 (100.000 iterazioni)** compatibile al 100% con il formato di cifratura originale.
- **App Mobile Installabile (PWA / TWA)**: Web App Manifest (`standalone`), Service Worker per caching offline, icone Android maskable (`192x192`, `512x512`) e barra di navigazione inferiore nativa Android.
- **Android Release Studio Integrato**: Configura `applicationId`, `versionName`, `versionCode`, sblocco biometrico e firma V2/V3 per compilare e scaricare direttamente:
  - Il pacchetto **APK Release firmato** (`photocloud-release-v1.0.0-signed.apk`)
  - Il progetto completo **Android Studio (Kotlin + Jetpack Compose + AES-256 Vault)** in formato `.zip`.
- **Galleria, Cestino, Ricerca Duplicati SHA-256 ed Esportazione ZIP**.

## Avvio Locale
```bash
npm install
npm run dev
```
