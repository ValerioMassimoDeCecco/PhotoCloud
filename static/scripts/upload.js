document.addEventListener('DOMContentLoaded', () => {
    // --- Elementi DOM (invariati) ---
    const fileInput = document.getElementById('file-input');
    const uploadForm = document.getElementById('upload-form');
    const container = document.getElementById('upload-indicator-container');
    if (!fileInput || !container || !uploadForm) return;

    const gem = document.getElementById('upload-gem');
    const detailsCard = document.getElementById('upload-details-card');
    const progressArc = document.getElementById('upload-progress-arc');
    const icon = document.getElementById('upload-indicator-icon');
    const percentageText = document.getElementById('upload-indicator-percentage');
    
    const cardTitle = document.getElementById('upload-card-title');
    const fileList = document.getElementById('upload-file-list');
    const cardStatus = document.getElementById('upload-card-status');
    const closeButton = document.getElementById('upload-close-btn');

    // --- Calcoli per l'anello di progresso (invariati) ---
    const radius = progressArc.r.baseVal.value;
    const circumference = 2 * Math.PI * radius;
    progressArc.style.strokeDasharray = `${circumference} ${circumference}`;
    progressArc.style.strokeDashoffset = circumference;

    // --- Funzioni di Utilità (invariate) ---
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

    // --- Gestione dello Stato (invariata) ---
    function showInitialUI(files) {
        container.style.opacity = '1';
        fileList.innerHTML = '';
        files.forEach(file => {
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
        });
        
        icon.textContent = 'upload';
        gem.classList.add('is-uploading');
        setProgress(0);
        cardTitle.textContent = 'Preparazione...';
        cardStatus.textContent = `Pronti per caricare ${files.length} file.`
        progressArc.style.stroke = 'var(--primary)';
        container.style.display = 'block';
        setTimeout(() => container.classList.add('expanded'), 50);
    }
    
    // --- Funzione di upload per singolo pacchetto (invariata) ---
    function uploadSingleBatch(formData, batchFiles, batchNum, totalBatches) {
        return new Promise((resolve, reject) => {
            const xhr = new XMLHttpRequest();
            xhr.open('POST', '/upload', true);

            xhr.upload.onprogress = (e) => {
                if (e.lengthComputable) {
                    const percentComplete = (e.loaded / e.total) * 100;
                    cardStatus.textContent = `Caricamento pacchetto ${batchNum}/${totalBatches}: ${Math.round(percentComplete)}%...`;
                    
                    batchFiles.forEach(file => {
                        const fileItem = fileList.querySelector(`[data-filename="${file.name}"]`);
                        if (fileItem) {
                            fileItem.querySelector('.file-status').textContent = 'In corso...';
                        }
                    });
                }
            };

            xhr.onload = () => {
                if (xhr.status === 200) {
                    batchFiles.forEach(file => {
                        const fileItem = fileList.querySelector(`[data-filename="${file.name}"]`);
                        if (fileItem) {
                            const statusEl = fileItem.querySelector('.file-status');
                            statusEl.textContent = 'Completato';
                            statusEl.classList.add('completed');
                        }
                    });
                    resolve();
                } else {
                    const errorMsg = JSON.parse(xhr.responseText).error || `Errore server: ${xhr.status}`;
                    reject(new Error(errorMsg));
                }
            };

            xhr.onerror = () => {
                reject(new Error('Errore di rete. Impossibile connettersi al server.'));
            };

            xhr.send(formData);
        });
    }

    /**
     * Gestisce l'intero processo di upload, suddividendo i file in pacchetti.
     * @param {FileList} files - La lista dei file da caricare.
     */
    async function uploadInBatches(files) {
        if (files.length === 0) return;

        showInitialUI(Array.from(files));

        const allFiles = Array.from(files);
        const batchSize = 50;
        let totalUploadedCount = 0;

        try {
            for (let i = 0; i < allFiles.length; i += batchSize) {
                const batch = allFiles.slice(i, i + batchSize);
                const formData = new FormData();
                
                batch.forEach(file => {
                    formData.append('file[]', file, file.name);
                    formData.append('timestamp[]', file.lastModified);
                });

                const batchNum = (i / batchSize) + 1;
                const totalBatches = Math.ceil(allFiles.length / batchSize);
                
                cardTitle.textContent = `Caricamento pacchetto ${batchNum} di ${totalBatches}...`;
                
                await uploadSingleBatch(formData, batch, batchNum, totalBatches);

                totalUploadedCount += batch.length;
                const overallProgress = (totalUploadedCount / allFiles.length) * 100;
                setProgress(overallProgress);
            }

            // --- Gestione successo ---
            gem.classList.remove('is-uploading');
            icon.textContent = 'check_circle';
            cardTitle.textContent = 'Completato';
            cardStatus.textContent = `Caricati ${allFiles.length} file con successo!`;
            
            setTimeout(() => {
                container.classList.remove('expanded');
                container.style.opacity = '0';
                setTimeout(() => window.location.reload(), 500);
            }, 2500);

        } catch (error) {
            // --- Gestione Errore ---
            gem.classList.remove('is-uploading');
            icon.textContent = 'error';
            progressArc.style.stroke = 'var(--error)';
            cardTitle.textContent = 'Caricamento Fallito';
            cardStatus.textContent = error.message;

            fileList.querySelectorAll('.file-status').forEach(statusEl => {
                if (!statusEl.classList.contains('completed')) {
                    statusEl.textContent = 'Fallito';
                    statusEl.classList.add('error');
                }
            });
        } finally {
            uploadForm.reset();
        }
    }


    // --- Event Listener ---
    fileInput.addEventListener('change', (event) => {
        uploadInBatches(event.target.files);
    });
    gem.addEventListener('click', toggleExpand);
    closeButton.addEventListener('click', toggleExpand);
});
