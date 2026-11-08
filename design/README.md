# PhotoCloud — proposte di design

Cinque direzioni visive per rifare l'interfaccia di PhotoCloud, più un foglio
di prove che le mette in fila.

Sono **pagine HTML autonome**: nessun font esterno, nessuna libreria, nessun
build step. Si aprono direttamente nel browser (o con un server statico) e
lavorano sulle immagini di esempio già presenti in `static/`.

```
design/
├── index.html               foglio di prove: indice delle 5 proposte
├── 01-provino.html          tavolo di sviluppo · pellicola 35mm
├── 02-indice.html           catalogo ragionato · editoria
├── 03-piano-luminoso.html   diapositive appoggiate · luce
├── 04-mirino.html           foto a pieno schermo · HUD
└── 05-bande.html            archivio in sequenza · accordion
```

## Il punto di partenza

Il template principale è `templates/base.html`, con `gallery.html` e
`login.html` come viste. L'impianto attuale è un tema Material-like
(card arrotondate, ombre, icone Google, `--primary` blu), con un `dark-mode`
alternativo e uno sfondo casuale in login.

Le proposte **riscrivono l'impianto visivo**, non il modello dati: la galleria
resta una griglia di elementi, l'accesso resta un upload di file-chiave.

## Le cinque proposte

### 01 · Provino
La galleria diventa un provino a contatto: tre strisce di pellicola 35mm
appoggiate su un banco scuro, numeri di fotogramma stampati sul bordo in
arancio, il nome del file in mono, la selezione segnata con una **matita
rossa** disegnata in SVG. Il login è una "scheda di accesso" in carta
avorio con un alloggiamento tratteggiato per il file-chiave.

- Ideale per: chi vuole un'app che sembri uno strumento da fotografo.
- Riuso: `.frame`, `.strip`, `.sel`, variabili `--bench/--film/--red`.
- Nota: la selezione qui è a doppio clic (per non togliere il clic che apre
  l'immagine); nel porting possiamo spostarla su una spilla o su Shift.

### 02 · Indice
Nessuna griglia: un **elenco numerato di opere** su carta calda, filetti
sottili, titoli che passano all'italic al passaggio del cursore, e una
**tavola** grande a destra che cambia con una tendina verticale. L'accesso è
un modulo stampato con campi numerati.

- Ideale per: un archivio che deve sembrare una pubblicazione, non un'app.
- Riuso: `.work`, `.plate`, `.plate-meta`, il meccanismo a due livelli
  `#p-a` / `#p-b` per la transizione senza sfarfallio.
- Nota: su mobile la tavola va sopra l'elenco e le righe mostrano miniature
  più grandi — già fatto.

### 03 · Piano luminoso
Le foto sono **diapositive** con montatura di cartoncino, appoggiate a mano
su un tavolo luminoso: rotazioni minime, ombre reali, linguette di carta per
i mesi. Un tasto **Raddrizza** allinea tutto con una transizione, e
**Sparpaglia** rimette le diapositive di traverso.

- Ideale per: un tono caldo, tattile, "casa" — l'opposto del cloud astratto.
- Riuso: `.slide`, le variabili inline `--r` / `--y`, `.pin`, `.piano.tidy`.
- Nota: le rotazioni sono variazioni di ±1° per scelta; oltre diventa disordine
  e la lettura peggiora.

### 04 · Mirino
Una foto a pieno schermo, i **dati di scatto** agli angoli, il rullino in
basso, quattro angoli verdi acido da mirino. Tutti gli strumenti stanno in
un pannello laterale; la selezione multipla è una modalità.

- Ideale per: godersi le foto. È la più "wow", la meno adatta a gestire
  centinaia di file senza il pannello.
- Riuso: `.stage`, `.layer`, `.br`, `.hud`, `.filmstrip`, il pannello.
- Nota: navigazione da tastiera (← →, Esc) già attiva; il punto di messa a
  fuoco segue il mouse ed è puramente decorativo.

### 05 · Bande
La collezione è una pila di **bande orizzontali** da 50 px che si aprono una
alla volta mostrando la foto intera. Zero cornici, zero ombre, un solo
accento rosso. La colonna di sinistra tiene identità, strumenti e filtri.

- Ideale per: un archivio lungo e ordinato, che si legge come una scaletta.
- Riuso: `.band`, `.row`, `.pick`, `.go`, il filtro mesi.
- Nota: l'apertura è al clic (o da tastiera); l'hover accende solo la foto,
  così la lista non si riordina sotto il cursore.

## Regole che ho tenuto per evitare il "design da AI"

- **Nessun gradiente viola, nessun vetro smerigliato, nessuna emoji.**
- **Un solo accento per proposta** (rosso matita, vermiglio, rosso timbro,
  verde acido, rosso segnale) e palette derivate da materiali reali.
- **Tipografia di sistema** con ruoli netti: grotesk per i titoli, mono per i
  metadati. Nessun font caricato dalla rete.
- **Metafore fisiche** (provino, catalogo, diapositiva, mirino) invece di
  "card + ombra + icona".
- **Contenuto vero**: titoli, date, nomi file, pesi e dati di scatto coerenti
  fra le proposte, così si confronta la struttura e non il riempitivo.

## Cosa è reale e cosa è statico

Funziona davvero (JS vanilla, nessuna dipendenza):

- navigazione fra le immagini, lightbox/lente, frecce e tasti ← → / Esc;
- selezione multipla e conteggi, stati disabilitati dei pulsanti;
- filtri per mese (03, 05), raggruppamento ciclico (01, 02, 04);
- apertura a fisarmonica con una sola banda aperta (05);
- drag & drop del file-chiave, con nome file mostrato nel campo;
- tab Accesso / Registrazione, Raddrizza / Sparpaglia.

Non è collegato al backend:

- upload, download, cestino, duplicati: sono bottoni con stato, non rotte;
- i form di accesso non chiamano `/login` o `/register`;
- i dati delle foto sono un elenco dimostrativo di 12 elementi.

## Portare una proposta nei template Flask

1. Scegliere la proposta e prendere il suo `<style>` come base di
   `static/styles/gallery.css` + `base.css` (le variabili in `:root` sono già
   pronte per un tema scuro).
2. Riscrivere `templates/gallery.html` mantenendo gli **hook usati dagli
   script esistenti**, altrimenti `selection.js`, `upload.js`, `grouping.js`,
   `duplicates.js` e `lightbox.js` smettono di funzionare:
   `#upload-form`, `#file-input`, `#upload-label`, `.gallery-grid`,
   `.media-card-wrapper`, `.media-checkbox`, `#select-all-btn`,
   `#selected-count`, `#download-selected-btn`, `#delete-selected-btn`,
   `#find-duplicates-btn`, `#media-count`, `#group-by-select`,
   `.grouping-controls`, `#theme-toggle-btn`, `#logout-btn`,
   `#upload-indicator-container` (e i figli), `#scan-status-container`.
3. La lightbox vive in `base.html`: se la proposta ne cambia l'aspetto
   (01, 02, 03, 05) basta ristilizzare `#lightbox`, `#lightbox-img`,
   `#lightbox-video` senza toccare `lightbox.js`.
4. Per `login.html` vale lo stesso: gli id `#login-tab`, `#register-tab`,
   `#login-form`, `#register-form`, `#auth-file-input`,
   `#file-upload-text`, `#register-username`, `#register-custom-key`,
   `#custom-key-group`, i radio `name="key_type"` e `#actual-login-form`
   sono referenziati dallo script in fondo al template.
5. Le immagini: in produzione arrivano da `/media/<filename>`, qui da
   `../static/wp1..3.jpg` solo per il prototipo.

L'idea è partire da **una** proposta, non mescolarle: ognuna ha una sua
grammatica e le contaminazioni si vedono subito.
