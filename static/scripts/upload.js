document.addEventListener('DOMContentLoaded', () => {
    // --- Elementi DOM ---
    const fileInput = document.getElementById('file-input');
    const container = document.getElementById('upload-indicator-container');
    if (!fileInput || !container) return; // Esce se gli elementi non esistono

    const gem = document.getElementById('upload-gem');
    const detailsCard = document.getElementById('upload-details-card');
    const progressArc = document.getElementById('upload-progress-arc');
    const icon = document.getElementById('upload-indicator-icon');
    const percentageText = document.getElementById('upload-indicator-percentage');
    
    const cardTitle = document.getElementById('upload-card-title');
    const fileList = document.getElementById('upload-file-list');
    const cardStatus = document.getElementById('upload-card-status');
    const closeButton = document.getElementById('upload-close-btn');

    // --- Calcoli per l'anello di progresso ---
    const radius = progressArc.r.baseVal.value;
    const circumference = 2 * Math.PI * radius;
    progressArc.style.strokeDasharray = `${circumference} ${circumference}`;
    progressArc.style.strokeDashoffset = circumference;

    // --- Funzioni di Utilità ---
    function formatBytes(bytes) {
        if (bytes === 0) return '0 Bytes';
        const k = 1024;
        const sizes = ['Bytes', 'KB', 'MB', 'GB'];
        const i = Math.floor(Math.log(bytes) / Math.log(k));
        return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
    }

    function setProgress(percent) {
        const offset = circumference - (percent / 100) * circumference;
        progressArc.style.strokeDashoffset = offset;
        percentageText.textContent = `${Math.round(percent)}%`;
    }

    function toggleExpand() {
        container.classList.toggle('expanded');
    }

    // --- Gestione dello Stato ---
    function showIndicator(files) {
        // Resetta lo stato visivo
        container.style.opacity = '1';
        fileList.innerHTML = ''; // Pulisce la lista precedente
        for (const file of files) {
            const li = document.createElement('li');
            li.className = 'upload-file-item';
            li.innerHTML = `
                <span class="material-icons">description</span>
                <div class="file-info">
                    <span class="file-name">${file.name}</span>
                    <span class="file-status">In coda...</span>
                </div>
            `;
            li.dataset.filename = file.name;
            fileList.appendChild(li);
        }
        
        icon.textContent = 'upload';
        gem.classList.add('is-uploading');
        setProgress(0);
        cardTitle.textContent = 'In caricamento...';
        progressArc.style.stroke = 'var(--primary)';
        container.style.display = 'block';
        setTimeout(() => container.classList.add('expanded'), 50); // Apri la card all'inizio
    }

    // --- Logica di Upload ---
    async function handleFileSelect(event) {
        const files = event.target.files;
        if (files.length === 0) return;

        showIndicator(files);

        const formData = new FormData();
        for (const file of files) {
            formData.append('file[]', file);
            formData.append('timestamp[]', file.lastModified);
        }
        
        let lastLoaded = 0;
        let lastTime = Date.now();
        const xhr = new XMLHttpRequest();
        xhr.open('POST', '/upload', true);

        xhr.upload.onprogress = (e) => {
            if (e.lengthComputable) {
                const percentComplete = (e.loaded / e.total) * 100;
                setProgress(percentComplete);
                
                const currentTime = Date.now();
                const deltaTime = (currentTime - lastTime) / 1000;
                const deltaLoaded = e.loaded - lastLoaded;
                const speed = deltaTime > 0 ? deltaLoaded / deltaTime : 0;
                
                cardStatus.textContent = `Caricati ${formatBytes(e.loaded)} di ${formatBytes(e.total)} (${formatBytes(speed)}/s)`;
                
                // Aggiorna lo stato dei file nella lista
                fileList.querySelectorAll('.file-status').forEach(statusEl => {
                    if (statusEl.textContent !== 'Completato') {
                        statusEl.textContent = 'In corso...';
                    }
                });

                lastLoaded = e.loaded;
                lastTime = currentTime;
            }
        };

        xhr.onload = () => {
            gem.classList.remove('is-uploading');

            if (xhr.status === 200) {
                setProgress(100);
                icon.textContent = 'check_circle';
                progressArc.style.stroke = 'var(--primary)'; // o un colore verde se preferisci
                cardTitle.textContent = 'Completato';
                cardStatus.textContent = `Caricati ${files.length} file con successo!`;

                fileList.querySelectorAll('.file-status').forEach(statusEl => {
                    statusEl.textContent = 'Completato';
                    statusEl.classList.add('completed');
                });
                
                setTimeout(() => {
                    container.classList.remove('expanded');
                    container.style.opacity = '0';
                    setTimeout(() => window.location.reload(), 500);
                }, 2000);

            } else {
                icon.textContent = 'error';
                progressArc.style.stroke = 'var(--error)';
                cardTitle.textContent = 'Errore';
                try {
                    const response = JSON.parse(xhr.responseText);
                    cardStatus.textContent = `Errore: ${response.error || xhr.statusText}`;
                } catch (err) {
                    cardStatus.textContent = `Errore durante il caricamento. Codice: ${xhr.status}`;
                }

                fileList.querySelectorAll('.file-status').forEach(statusEl => {
                    statusEl.textContent = 'Fallito';
                    statusEl.classList.add('error');
                });
            }
        };

        xhr.onerror = () => {
            gem.classList.remove('is-uploading');
            icon.textContent = 'error';
            progressArc.style.stroke = 'var(--error)';
            cardTitle.textContent = 'Errore di Rete';
            cardStatus.textContent = 'Impossibile connettersi al server.';
            
            fileList.querySelectorAll('.file-status').forEach(statusEl => {
                statusEl.textContent = 'Fallito';
                statusEl.classList.add('error');
            });
        };

        xhr.send(formData);
    }

    // --- Event Listeners ---
    fileInput.addEventListener('change', handleFileSelect);
    gem.addEventListener('click', toggleExpand);
    closeButton.addEventListener('click', toggleExpand);
});