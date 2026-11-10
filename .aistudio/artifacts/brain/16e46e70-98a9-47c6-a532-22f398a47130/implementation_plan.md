# Piano di Implementazione — Release v1.2.1

## Obiettivo e Contesto
Preparare la nuova release **v1.2.1** di PhotoCloud coadiuvando:
1. **Aggiornamento versione**: Incrementare `versionName` a `"1.2.1"` e `versionCode` a `18` in `android-app/app/build.gradle.kts` e `package.json`.
2. **Selezione Multipla con Pressione Prolungata e Trascinamento (Drag-to-Select)**: Verificare, rifinire e testare la logica di drag-to-select nella galleria media sia su dispositivi touch che con il mouse, garantendo che il drag inizi solo dopo una pressione prolungata senza compromettere tap, apertura dei media e scorrimento normale.
3. **Aggiornamento Test e Build**: Aggiornare i test unitari in `src/lib/crypto.test.ts` e compilare la nuova release APK firmata `photocloud-release-v1.2.1-signed.apk`.

---

## Modifiche Pianificate

### 1. Aggiornamento Versioni (v1.2.1)
- `android-app/app/build.gradle.kts`: `versionName = "1.2.1"`, `versionCode = 18`.
- `package.json`: `"version": "1.2.1"`.
- Script di rilascio e metadati `.github/workflows/android-release.yml`.

### 2. Raffinamento Drag-to-Select in Galleria
- Controllo dei gesti di drag dopo pressione prolungata (`detectDragGesturesAfterLongPress` e puntatori pointer input in `MainActivity.kt` e `GalleryView.tsx`) per garantire fluidità e precisione millimetrica su touchscreen e mouse.
- Preservazione rigorosa del comportamento di tap singolo, apertura Lightbox e scroll verticale standard.

### 3. Test e Compilazione Release APK
- Aggiornamento delle asserzioni in `src/lib/crypto.test.ts` per la versione `1.2.1`.
- Esecuzione di `gradle assembleRelease` e copia dell'APK in `release/photocloud-release-v1.2.1-signed.apk`.
- Esecuzione dei test TAP, lint e compilazione applet.
