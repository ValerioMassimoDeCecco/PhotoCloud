// static/scripts/duplicates.js

document.addEventListener('DOMContentLoaded', () => {
    // Seleziona gli elementi dell'interfaccia
    const findDuplicatesBtn = document.getElementById('find-duplicates-btn');
    const galleryGrid = document.querySelector('.gallery-grid');
    const statusContainer = document.getElementById('scan-status-container');
    // CORREZIONE 1: Utilizza l'ID corretto 'scan-main-status' invece di 'scan-status'
    const scanStatus = document.getElementById('scan-main-status'); 

    // Verifica che tutti gli elementi necessari esistano
    if (!findDuplicatesBtn || !galleryGrid || !statusContainer || !scanStatus) {
        console.error("Uno o più elementi della UI per i duplicati non sono stati trovati.");
        return;
    }

    /**
     * Sposta una lista di file nel cestino inviando richieste al server.
     * @param {string[]} filenames - Un array di nomi di file da spostare nel cestino.
     */
    async function moveFilesToTrash(filenames) {
        let movedCount = 0;
        let failedCount = 0;
        statusContainer.style.display = 'block'; // Mostra l'indicatore di stato

        for (const filename of filenames) {
            try {
                // CORREZIONE 2: Usa l'endpoint corretto '/trash/' invece di '/delete/'
                const response = await fetch(`/trash/${encodeURIComponent(filename)}`, {
                    method: 'POST',
                    headers: {
                        'Accept': 'application/json'
                    }
                });

                const result = await response.json();
                if (result.success) {
                    movedCount++;
                } else {
                    failedCount++;
                    console.error(`Errore spostando ${filename}:`, result.error);
                }
                // Aggiorna il messaggio di stato per l'utente
                scanStatus.textContent = `Spostato ${movedCount}/${filenames.length} file nel cestino (falliti: ${failedCount})...`;

            } catch (error) {
                failedCount++;
                console.error(`Errore di rete durante lo spostamento di ${filename}:`, error);
            }
        }
        
        // Informa l'utente del risultato finale e ricarica la pagina
        if (filenames.length > 0) {
            alert(`${movedCount} file duplicati sono stati spostati nel cestino. ${failedCount > 0 ? `${failedCount} operazioni fallite.` : ''} La pagina verrà ricaricata per aggiornare la vista.`);
            window.location.reload();
        }
    }

    /**
     * Gestisce la visualizzazione dei duplicati trovati e chiede conferma all'utente.
     * @param {Array<string[]>} duplicates - Un array di gruppi di nomi di file duplicati.
     */
    function handleDuplicates(duplicates) {
        let filesToTrash = [];
        let confirmationMessage = "Sono stati trovati i seguenti gruppi di file duplicati:\n\n";

        duplicates.forEach((group, index) => {
            // Ordina i file per nome per mantenere sempre la stessa copia
            const sortedGroup = group.sort(); 
            const fileToKeep = sortedGroup[0];
            const filesToRemove = sortedGroup.slice(1);
            filesToTrash.push(...filesToRemove);

            confirmationMessage += `Gruppo ${index + 1}:\n`;
            confirmationMessage += `  - ✅ Mantenuto: ${fileToKeep}\n`;
            confirmationMessage += `  - 🗑️ Da Spostare: ${filesToRemove.join(', ')}\n\n`;
        });

        confirmationMessage += "Vuoi procedere spostando i file duplicati nel cestino? Verrà mantenuta una sola copia per ogni gruppo.";

        if (confirm(confirmationMessage)) {
            moveFilesToTrash(filesToTrash); // Avvia l'operazione se l'utente conferma
        } else {
            statusContainer.style.display = 'none'; // Nasconde la barra di stato se l'utente annulla
        }
    }

    // Aggiunge l'evento 'click' al pulsante di ricerca duplicati
    findDuplicatesBtn.addEventListener('click', async () => {
        findDuplicatesBtn.disabled = true;
        statusContainer.style.display = 'block';
        scanStatus.textContent = 'Inizio scansione sul server... (potrebbe richiedere tempo)';

        try {
            // Chiama l'endpoint del server per trovare i duplicati
            const response = await fetch('/find_duplicates_server', {
                method: 'POST',
            });

            if (!response.ok) {
                const errorData = await response.json().catch(() => ({ error: `Errore del server: ${response.statusText}` }));
                throw new Error(errorData.error);
            }

            const data = await response.json();
            const duplicates = data.duplicates;
            
            statusContainer.style.display = 'none'; // Nasconde la barra di stato

            if (duplicates.length === 0) {
                alert("🎉 Nessun duplicato trovato!");
            } else {
                handleDuplicates(duplicates); // Gestisce i duplicati trovati
            }

        } catch (error) {
            console.error('Errore durante la ricerca dei duplicati:', error);
            scanStatus.textContent = `Errore: ${error.message}`;
            alert(`Si è verificato un errore durante la ricerca: ${error.message}`);
            statusContainer.style.display = 'block'; // Mantieni visibile il messaggio di errore
        } finally {
            findDuplicatesBtn.disabled = false; // Riattiva il pulsante
        }
    });
});