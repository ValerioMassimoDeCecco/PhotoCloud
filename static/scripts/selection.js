// static/scripts/selection.js (Versione con controlli di esistenza degli elementi UI)

document.addEventListener('DOMContentLoaded', () => {
    // --- Riferimenti agli elementi del DOM ---
    const selectAllBtn = document.getElementById('select-all-btn');
    const downloadSelectedBtn = document.getElementById('download-selected-btn');
    const deleteSelectedBtn = document.getElementById('delete-selected-btn');
    const selectedCountSpan = document.getElementById('selected-count');
    const mediaCheckboxes = document.querySelectorAll('.media-checkbox');
    const hasMedia = mediaCheckboxes.length > 0;

    // Elementi per la barra di avanzamento del download
    const progressContainer = document.querySelector('.scan-status-container');
    const progressStatus = document.getElementById('scan-status');

    // --- Stato della selezione ---
    let selectedFiles = new Set();
    let isSelectAll = false;

    // --- Inizializzazione ---
    if (!hasMedia && !window.location.pathname.includes('/trash')) {
        if (selectAllBtn) selectAllBtn.style.display = 'none';
        return;
    }

    if (selectAllBtn) selectAllBtn.style.display = 'inline-flex';

    // --- Funzioni ---

    /**
     * Aggiorna l'interfaccia utente (UI) in base ai file selezionati.
     */
    function updateUI() {
        const count = selectedFiles.size;
        if (selectedCountSpan) selectedCountSpan.textContent = count;

        mediaCheckboxes.forEach(checkbox => {
            const wrapper = checkbox.closest('.media-card-wrapper');
            if (wrapper) {
                const isSelected = selectedFiles.has(checkbox.dataset.filename);
                wrapper.classList.toggle('selected', isSelected);
                checkbox.checked = isSelected;
            }
        });

        const showActionButtons = count > 0;
        if (downloadSelectedBtn) downloadSelectedBtn.style.display = showActionButtons ? 'inline-flex' : 'none';
        if (deleteSelectedBtn) deleteSelectedBtn.style.display = showActionButtons ? 'inline-flex' : 'none';

        if (selectAllBtn) {
            const btnText = selectAllBtn.querySelector('.btn-text');
            if (count > 0 && count === mediaCheckboxes.length) {
                btnText.textContent = "Deseleziona Tutto";
                isSelectAll = true;
            } else {
                btnText.textContent = "Seleziona Tutto";
                isSelectAll = false;
            }
        }
    }

    /**
     * Avvia il download di un file creando un link temporaneo.
     */
    function triggerDownload(url, filename) {
        const a = document.createElement('a');
        a.href = url;
        a.download = filename;
        a.style.display = 'none';
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        console.log(`Download avviato per: ${filename}`);
    }

    /**
     * Interroga il server per ottenere lo stato di avanzamento della creazione dello ZIP.
     */
    function pollZipProgress(taskId) {
        console.log(`Avvio polling per il task ID: ${taskId}`);
        const interval = setInterval(async () => {
            try {
                const response = await fetch(`/zip-progress/${taskId}`);
                if (!response.ok) {
                    throw new Error(`Errore di rete: ${response.status} ${response.statusText}`);
                }
                const data = await response.json();
                console.log('Stato ricevuto:', data);

                // **INIZIO BLOCCO CORRETTO**
                // Aggiunti controlli per verificare se gli elementi progressStatus e progressContainer esistono
                switch (data.status) {
                    case 'processing':
                        if (progressStatus) {
                            progressStatus.innerHTML = `Creazione archivio in corso... <div class="progress-bar-inline" style="width:${data.progress}%"></div> ${data.progress}%`;
                        }
                        break;
                    case 'complete':
                        clearInterval(interval);
                        if (progressStatus) {
                            progressStatus.textContent = "Archivio pronto! Download in avvio...";
                        }
                        triggerDownload(`/download-zip/${data.filename}`, data.filename);
                        
                        setTimeout(() => {
                            if (progressContainer) progressContainer.style.display = 'none';
                        }, 5000);
                        break;
                    case 'error':
                    case 'not_found':
                        clearInterval(interval);
                        const errorMessage = data.error || 'Task non trovato o fallito.';
                        if (progressStatus) {
                            progressStatus.textContent = `Errore: ${errorMessage}`;
                        }
                        alert(`Si è verificato un errore durante la creazione dell'archivio: ${errorMessage}`);
                        setTimeout(() => { if (progressContainer) progressContainer.style.display = 'none'; }, 5000);
                        break;
                    default:
                        console.warn(`Stato del task non riconosciuto: ${data.status}`);
                        break;
                }
            } catch (error) {
                clearInterval(interval);
                if (progressStatus) {
                    progressStatus.textContent = 'Errore di comunicazione durante il controllo.';
                }
                console.error("Errore durante il polling:", error);
                alert("Impossibile contattare il server per verificare lo stato dell'archivio.");
                setTimeout(() => { if (progressContainer) progressContainer.style.display = 'none'; }, 3000);
            }
            // **FINE BLOCCO CORRETTO**
        }, 2000);
    }

    // --- Gestori di Eventi ---

    if (selectAllBtn) {
        selectAllBtn.addEventListener('click', () => {
            if (isSelectAll) {
                selectedFiles.clear();
            } else {
                mediaCheckboxes.forEach(checkbox => {
                    selectedFiles.add(checkbox.dataset.filename);
                });
            }
            updateUI();
        });
    }

    mediaCheckboxes.forEach(checkbox => {
        checkbox.addEventListener('change', () => {
            const filename = checkbox.dataset.filename;
            if (checkbox.checked) {
                selectedFiles.add(filename);
            } else {
                selectedFiles.delete(filename);
            }
            updateUI();
        });
    });

    if (downloadSelectedBtn) {
        downloadSelectedBtn.addEventListener('click', async () => {
            const filesToDownload = Array.from(selectedFiles);
            if (filesToDownload.length === 0) {
                alert("Nessun file selezionato per il download.");
                return;
            }

            console.log("Richiesta di download per i file:", filesToDownload);

            if (progressContainer) progressContainer.style.display = 'block';
            if (progressStatus) progressStatus.textContent = "Avvio della preparazione dell'archivio...";

            try {
                const response = await fetch('/prepare-zip', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ filenames: filesToDownload }),
                });

                if (!response.ok) {
                    throw new Error("Il server non ha potuto avviare la creazione dell'archivio.");
                }

                const data = await response.json();
                if (data.task_id) {
                    pollZipProgress(data.task_id);
                } else {
                    throw new Error(data.error || "Risposta non valida dal server dopo la richiesta di ZIP.");
                }
            } catch (error) {
                console.error("Errore durante la preparazione dello ZIP:", error);
                if (progressStatus) progressStatus.textContent = `Errore: ${error.message}`;
                alert(error.message);
            }
        });
    }

    if (deleteSelectedBtn) {
        deleteSelectedBtn.addEventListener('click', async () => {
            const filesToDelete = Array.from(selectedFiles);
            if (filesToDelete.length === 0) {
                alert("Nessun file selezionato da eliminare.");
                return;
            }

            if (!confirm(`Sei sicuro di voler spostare ${filesToDelete.length} elementi nel cestino?`)) {
                return;
            }

            console.log("Richiesta di eliminazione per i file:", filesToDelete);

            try {
                const response = await fetch('/trash/batch', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ filenames: filesToDelete }),
                });

                const result = await response.json();

                if (result.success) {
                    filesToDelete.forEach(filename => {
                        const checkbox = document.querySelector(`.media-checkbox[data-filename="${filename}"]`);
                        if (checkbox) {
                            const wrapper = checkbox.closest('.media-card-wrapper');
                            if (wrapper) {
                                wrapper.style.transition = 'opacity 0.3s ease, transform 0.3s ease';
                                wrapper.style.opacity = '0';
                                wrapper.style.transform = 'scale(0.8)';
                                setTimeout(() => wrapper.remove(), 300);
                            }
                        }
                    });
                    
                    const countElement = document.getElementById('media-count');
                    if (countElement) {
                        const currentCount = parseInt(countElement.textContent) || 0;
                        countElement.textContent = `${Math.max(0, currentCount - filesToDelete.length)} elementi`;
                    }

                    selectedFiles.clear();
                    updateUI();

                } else {
                    alert(`Errore: ${result.error || "Impossibile completare l'operazione."}`);
                }
            } catch (error) {
                console.error('Errore durante lo spostamento nel cestino:', error);
                alert('Errore di comunicazione con il server.');
            }
        });
    }
    
    updateUI();
});