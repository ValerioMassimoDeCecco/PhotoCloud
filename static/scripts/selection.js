// static/scripts/selection.js (versione corretta e completa)

document.addEventListener('DOMContentLoaded', () => {
    // Riferimenti agli elementi del DOM
    const selectAllBtn = document.getElementById('select-all-btn');
    const downloadSelectedBtn = document.getElementById('download-selected-btn');
    const deleteSelectedBtn = document.getElementById('delete-selected-btn');
    const selectedCountSpan = document.getElementById('selected-count');
    const mediaCheckboxes = document.querySelectorAll('.media-checkbox');
    const hasMedia = mediaCheckboxes.length > 0;

    // Elementi per la barra di avanzamento del download
    const progressContainer = document.querySelector('.scan-status-container'); // Usiamo il container esistente
    const progressStatus = document.getElementById('scan-status');

    // Stato della selezione
    let selectedFiles = new Set();
    let isSelectAll = false;

    // Se non ci sono media, non fare nulla
    if (!hasMedia) {
        if(selectAllBtn) selectAllBtn.style.display = 'none';
        return;
    };

    // Mostra il pulsante "Seleziona Tutto" se ci sono media
    if(selectAllBtn) selectAllBtn.style.display = 'inline-flex';

    /**
     * Aggiorna l'interfaccia utente in base alla selezione corrente.
     */
    function updateUI() {
        const count = selectedFiles.size;
        if(selectedCountSpan) selectedCountSpan.textContent = count;

        mediaCheckboxes.forEach(checkbox => {
            const wrapper = checkbox.closest('.media-card-wrapper');
            if (wrapper) {
                if (selectedFiles.has(checkbox.dataset.filename)) {
                    wrapper.classList.add('selected');
                    checkbox.checked = true;
                } else {
                    wrapper.classList.remove('selected');
                    checkbox.checked = false;
                }
            }
        });

        const showActionButtons = count > 0;
        if(downloadSelectedBtn) downloadSelectedBtn.style.display = showActionButtons ? 'inline-flex' : 'none';
        if(deleteSelectedBtn) deleteSelectedBtn.style.display = showActionButtons ? 'inline-flex' : 'none';

        if(selectAllBtn) {
            const btnText = selectAllBtn.querySelector('.btn-text');
            if (count === mediaCheckboxes.length && mediaCheckboxes.length > 0) {
                btnText.textContent = "Deseleziona Tutto";
                isSelectAll = true;
            } else {
                btnText.textContent = "Seleziona Tutto";
                isSelectAll = false;
            }
        }
    }

    /**
     * Gestisce il click sul pulsante "Seleziona Tutto / Deseleziona Tutto".
     */
    if(selectAllBtn) {
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

    /**
     * Aggiunge un listener a ogni checkbox.
     */
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

    /**
     * Funzione per interrogare lo stato di avanzamento dello ZIP.
     * @param {string} taskId - L'ID del task da controllare.
     */
    function pollZipProgress(taskId) {
        const interval = setInterval(async () => {
            try {
                const response = await fetch(`/zip-progress/${taskId}`);
                if (!response.ok) throw new Error('Network response was not ok');
                const data = await response.json();

                if (data.status === 'processing') {
                    progressStatus.innerHTML = `Creazione archivio in corso... <div class="progress-bar-inline" style="width:${data.progress}%"></div> ${data.progress}%`;
                } else if (data.status === 'complete') {
                    clearInterval(interval);
                    progressStatus.textContent = "Archivio pronto! Avvio il download...";
                    
                    // Crea un link invisibile e cliccalo per avviare il download
                    const a = document.createElement('a');
                    a.href = `/download-zip/${data.filename}`;
                    a.download = data.filename;
                    document.body.appendChild(a);
                    a.click();
                    document.body.removeChild(a);

                    setTimeout(() => {
                        progressContainer.style.display = 'none';
                    }, 3000);

                } else if (data.status === 'error' || data.status === 'not_found') {
                    clearInterval(interval);
                    progressStatus.textContent = `Errore: ${data.error || 'Task non trovato.'}`;
                    alert(`Si è verificato un errore durante la creazione dell'archivio: ${data.error}`);
                }
            } catch (error) {
                clearInterval(interval);
                progressStatus.textContent = 'Errore di rete durante il controllo.';
                console.error("Errore di polling:", error);
                setTimeout(() => { progressContainer.style.display = 'none'; }, 3000);
            }
        }, 2000);
    }

    /**
     * Gestisce il click sul pulsante "Scarica Selezionati".
     */
    if(downloadSelectedBtn) {
        downloadSelectedBtn.addEventListener('click', async () => {
            const filesToDownload = Array.from(selectedFiles);
            if (filesToDownload.length === 0) {
                alert("Nessun file selezionato.");
                return;
            }
            
            progressContainer.style.display = 'block';
            progressStatus.textContent = "Avvio della preparazione dell'archivio...";

            try {
                const response = await fetch('/prepare-zip', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ filenames: filesToDownload }),
                });

                if (!response.ok) throw new Error("Impossibile avviare la creazione dell'archivio.");

                const data = await response.json();
                if (data.task_id) {
                    pollZipProgress(data.task_id);
                } else {
                    throw new Error(data.error || "Risposta non valida dal server.");
                }
            } catch (error) {
                console.error("Errore durante la preparazione dello ZIP:", error);
                progressStatus.textContent = `Errore: ${error.message}`;
                alert(error.message);
            }
        });
    }

    /**
     * Gestisce il click sul pulsante "Sposta Selezionati nel Cestino".
     */
    if(deleteSelectedBtn) {
        deleteSelectedBtn.addEventListener('click', async () => {
            const filesToDelete = Array.from(selectedFiles);
            if (filesToDelete.length === 0) {
                alert("Nessun file selezionato.");
                return;
            }

            if (!confirm(`Sei sicuro di voler spostare ${filesToDelete.length} elementi nel cestino?`)) {
                return;
            }

            try {
                // USA LA NUOVA ROTTA /trash/batch
                const response = await fetch('/trash/batch', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ filenames: filesToDelete }),
                });

                const result = await response.json();

                if (result.success) {
                    // Rimuovi gli elementi dall'interfaccia
                    filesToDelete.forEach(filename => {
                        const checkbox = document.querySelector(`.media-checkbox[data-filename="${filename}"]`);
                        if (checkbox) {
                            const wrapper = checkbox.closest('.media-card-wrapper');
                            wrapper.style.opacity = '0';
                            wrapper.style.transform = 'scale(0.8)';
                            setTimeout(() => wrapper.remove(), 300);
                        }
                    });
                    
                    // Aggiorna il conteggio totale
                    const countElement = document.getElementById('media-count');
                    if (countElement) {
                        let currentCount = parseInt(countElement.textContent) || 0;
                        countElement.textContent = `${Math.max(0, currentCount - filesToDelete.length)} elementi`;
                    }

                    // Resetta la selezione
                    selectedFiles.clear();
                    updateUI();
                } else {
                    alert(`Errore: ${result.error || 'Impossibile spostare i file nel cestino.'}`);
                }
            } catch (error) {
                alert('Errore di comunicazione col server durante lo spostamento nel cestino.');
                console.error('Batch trash error:', error);
            }
        });
    }
});