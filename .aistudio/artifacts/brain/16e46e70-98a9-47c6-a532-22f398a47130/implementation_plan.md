# Piano di Correzione — Indicizzazione AI On-Device (PhotoCloud)

## Obiettivo e Contesto
Quando l'utente carica $n$ nuove foto nel vault PhotoCloud, il banner di avanzamento (`"Indicizzazione AI in corso: X/Y foto..."`) mostra un totale $Y$ molto più alto rispetto alle $n$ foto effettivamente caricate.

Dall'analisi del codice emergono due cause principali:
1. **Scansione della galleria locale del telefono (`MediaStore`)**: Il worker di indicizzazione (`PhotoAiIndexingWorker`) interroga anche `MediaStore.Images.Media.EXTERNAL_CONTENT_URI`, aggiungendo fino a 500 immagini locali del dispositivo alla coda di analisi insieme alle foto caricate su PhotoCloud.
2. **Conteggio cumulativo dal database Room**: La barra di progresso utilizza come fallback il conteggio totale cumulativo delle righe presenti nella tabella `photo_ai_categories` (che include tutte le foto già analizzate in precedenza e le immagini locali), anziché mostrare esclusivamente il numero di nuove foto del caricamento corrente.

---

## Funzionalità e Modifiche Chiave

### 1. Analisi Esclusiva delle Foto Caricate su PhotoCloud
- **Rimozione scansione `MediaStore`**: Il worker `PhotoAiIndexingWorker` analizzerà esclusivamente gli elementi immagine presenti nel vault PhotoCloud (`uriString` con prefisso `cloud://`), ignorando le foto salvate nella memoria locale del telefono.
- **Pulizia automatica del database AI (`PhotoAiDatabase`)**:
  - Rimozione immediata di eventuali record non appartenenti al cloud (`uriString NOT LIKE 'cloud://%'`) salvati da esecuzioni precedenti.
  - Allineamento automatico con il catalogo attivo del vault: le foto eliminate o spostate nel cestino verranno rimosse anche dall'indice AI, mantenendo i contatori dei chip categorie sempre coerenti con le foto effettivamente presenti nel cloud.
- **Rimozione richiesta permessi superflui**: All'apertura della galleria non verrà più richiesto automaticamente il permesso `READ_MEDIA_IMAGES` per la scansione in background del dispositivo.

### 2. Conteggio del Banner Limitato al Caricamento in Corso
- **Calcolo del batch attivo**: Ad ogni nuovo caricamento di $n$ foto (o avvio dell'indicizzazione), il worker calcolerà esclusivamente le foto del cloud non ancora analizzate (`totalToProcess = n`) ed emetterà il progresso `processedCount / totalToProcess` (es. `1/n`, `2/n`, ..., `n/n`).
- **Visibilità e stato del banner UI**:
  - Il banner di avanzamento nella schermata principale mostrerà unicamente i valori del batch attivo (`workerAnalyzed / workerTotal`) riportati dal `WorkInfo` in stato `RUNNING` quando `workerTotal > 0`.
  - Al termine dell'analisi delle $n$ foto caricate, il banner scomparirà immediatamente senza mostrare il totale storico cumulativo del database.
- **Ricalcolo manuale ("Ricalcola AI")**: Premendo il pulsante di ricalcolo manuale, il database AI del vault verrà azzerato e il banner mostrerà l'analisi completa delle sole foto presenti nel cloud PhotoCloud.

### 3. Verifica e Build APK Aggiornata
- Compilazione e verifica di `assembleDebug` e `assembleRelease` tramite Gradle.
- Aggiornamento dell'APK firmato nella cartella `release/` e verifica della suite di test.
