document.addEventListener('DOMContentLoaded', () => {
    // Riferimenti agli elementi del DOM
    const fileInput = document.getElementById('file-input');
    const uploadForm = document.getElementById('upload-form');
    
    // Elementi della barra di avanzamento (riutilizzati da selection.js)
    const progressContainer = document.getElementById('progress-container');
    const progressStatus = document.getElementById('progress-status');
    const progressBar = document.getElementById('progress-bar');

    if (!fileInput || !uploadForm || !progressContainer) {
        return; // Esce se gli elementi necessari non sono presenti
    }

    /**
     * Formatta i byte in un formato leggibile (KB, MB, GB).
     * @param {number} bytes - Il numero di byte.
     * @returns {string} La stringa formattata.
     */
    function formatBytes(bytes) {
        if (bytes === 0) return '0 Bytes';
        const k = 1024;
        const sizes = ['Bytes', 'KB', 'MB', 'GB'];
        const i = Math.floor(Math.log(bytes) / Math.log(k));
        return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
    }

    /**
     * Gestisce l'evento di selezione dei file.
     * @param {Event} event - L'evento 'change' dell'input file.
     */
    async function handleFileSelect(event) {
        const files = event.target.files;
        if (files.length === 0) {
            return; // Nessun file selezionato
        }

        // Prepara i dati del form per la richiesta
        const formData = new FormData(uploadForm);
        // Nota: non è necessario aggiungere manualmente i file a formData
        // se l'input ha il nome corretto ("file[]"). Vengono inclusi automaticamente.

        // Mostra e resetta la barra di avanzamento
        progressContainer.style.display = 'block';
        progressBar.style.width = '0%';
        progressBar.style.backgroundColor = 'var(--primary)';
        progressStatus.textContent = 'Inizio caricamento...';

        // Variabili per il calcolo della velocità
        let lastLoaded = 0;
        let lastTime = Date.now();

        // Crea e configura la richiesta XMLHttpRequest
        const xhr = new XMLHttpRequest();
        xhr.open('POST', '/upload', true);

        // Listener per l'avanzamento dell'upload
        xhr.upload.onprogress = (e) => {
            if (e.lengthComputable) {
                const percentComplete = (e.loaded / e.total) * 100;
                progressBar.style.width = percentComplete + '%';

                const currentTime = Date.now();
                const deltaTime = (currentTime - lastTime) / 1000; // in secondi
                const deltaLoaded = e.loaded - lastLoaded;
                
                // Calcola la velocità solo se è passato un po' di tempo per evitare divisioni per zero
                const speed = deltaTime > 0 ? deltaLoaded / deltaTime : 0; 

                progressStatus.textContent = `Caricamento... ${Math.round(percentComplete)}% ` +
                                           `(${formatBytes(e.loaded)} / ${formatBytes(e.total)}) - ` +
                                           `${formatBytes(speed)}/s`;
                
                lastLoaded = e.loaded;
                lastTime = currentTime;
            }
        };

        // Listener per il completamento del caricamento
        xhr.onload = () => {
            progressBar.style.width = '100%';
            if (xhr.status === 200) {
                progressStatus.textContent = 'Caricamento completato! La pagina sarà ricaricata.';
                // Ricarica la pagina per mostrare i nuovi file
                setTimeout(() => window.location.reload(), 1500);
            } else {
                progressStatus.textContent = `Errore durante il caricamento: ${xhr.statusText}`;
                 progressBar.style.backgroundColor = 'var(--error)';
                try {
                    const response = JSON.parse(xhr.responseText);
                    alert(`Errore: ${response.error}`);
                } catch (err) {
                    alert(`Errore sconosciuto durante il caricamento. Codice: ${xhr.status}`);
                }
            }
        };

        // Listener per gli errori di rete
        xhr.onerror = () => {
            progressStatus.textContent = 'Errore di rete. Impossibile completare il caricamento.';
            progressBar.style.backgroundColor = 'var(--error)';
            alert('Errore di rete durante il caricamento.');
        };

        // Invia la richiesta
        xhr.send(formData);
    }

    // Aggiunge il listener all'input dei file
    fileInput.addEventListener('change', handleFileSelect);
});