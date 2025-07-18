document.addEventListener('DOMContentLoaded', () => {
    const fileInput = document.getElementById('file-input');
    const uploadForm = document.getElementById('upload-form');
    
    const progressContainer = document.getElementById('progress-container');
    const progressStatus = document.getElementById('progress-status');
    const progressBar = document.getElementById('progress-bar');

    if (!fileInput || !uploadForm || !progressContainer) {
        return;
    }

    function formatBytes(bytes) {
        if (bytes === 0) return '0 Bytes';
        const k = 1024;
        const sizes = ['Bytes', 'KB', 'MB', 'GB'];
        const i = Math.floor(Math.log(bytes) / Math.log(k));
        return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
    }

    async function handleFileSelect(event) {
        const files = event.target.files;
        if (files.length === 0) {
            return;
        }

        // --- MODIFICHE CHIAVE ---
        // 1. Crea un oggetto FormData VUOTO invece di inizializzarlo dal form.
        const formData = new FormData();

        // 2. Aggiungi manualmente SIA i file SIA i loro timestamp.
        // Questo garantisce che entrambi i dati siano presenti nella richiesta.
        for (const file of files) {
            formData.append('file[]', file);
            formData.append('timestamp[]', file.lastModified);
        }
        // --- FINE MODIFICHE CHIAVE ---

        progressContainer.style.display = 'block';
        progressBar.style.width = '0%';
        progressBar.style.backgroundColor = 'var(--primary)';
        progressStatus.textContent = 'Inizio caricamento...';

        let lastLoaded = 0;
        let lastTime = Date.now();

        const xhr = new XMLHttpRequest();
        xhr.open('POST', '/upload', true);

        xhr.upload.onprogress = (e) => {
            if (e.lengthComputable) {
                const percentComplete = (e.loaded / e.total) * 100;
                progressBar.style.width = percentComplete + '%';
                const currentTime = Date.now();
                const deltaTime = (currentTime - lastTime) / 1000;
                const deltaLoaded = e.loaded - lastLoaded;
                const speed = deltaTime > 0 ? deltaLoaded / deltaTime : 0;
                progressStatus.textContent = `Caricamento... ${Math.round(percentComplete)}% ` +
                                           `(${formatBytes(e.loaded)} / ${formatBytes(e.total)}) - ` +
                                           `${formatBytes(speed)}/s`;
                lastLoaded = e.loaded;
                lastTime = currentTime;
            }
        };

        xhr.onload = () => {
            progressBar.style.width = '100%';
            if (xhr.status === 200) {
                progressStatus.textContent = 'Caricamento completato! La pagina sarà ricaricata.';
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

        xhr.onerror = () => {
            progressStatus.textContent = 'Errore di rete. Impossibile completare il caricamento.';
            progressBar.style.backgroundColor = 'var(--error)';
            alert('Errore di rete durante il caricamento.');
        };

        xhr.send(formData);
    }

    fileInput.addEventListener('change', handleFileSelect);
});