// static/scripts/duplicates.js

document.addEventListener('DOMContentLoaded', () => {
    const findDuplicatesBtn = document.getElementById('find-duplicates-btn');
    const galleryGrid = document.querySelector('.gallery-grid');
    const statusContainer = document.getElementById('scan-status-container');
    const scanStatus = document.getElementById('scan-status');

    if (!findDuplicatesBtn || !galleryGrid || !scanStatus) {
        return;
    }

    /**
     * Deletes a list of files by sending requests to the server.
     * @param {string[]} filenames - An array of filenames to delete.
     */
    async function deleteFiles(filenames) {
        let deletedCount = 0;
        let failedCount = 0;
        statusContainer.style.display = 'block';

        for (const filename of filenames) {
            try {
                // Use a secure filename for the URL
                const safeFilename = encodeURIComponent(filename);
                const response = await fetch(`/delete/${safeFilename}`, {
                    method: 'POST',
                });

                const result = await response.json();
                if (result.success) {
                    deletedCount++;
                } else {
                    failedCount++;
                    console.error(`Error deleting ${filename}:`, result.error);
                }
                scanStatus.textContent = `Eliminato ${deletedCount}/${filenames.length} (falliti: ${failedCount})...`;

            } catch (error) {
                failedCount++;
                console.error(`Network error while deleting ${filename}:`, error);
            }
        }
        
        const totalAttempts = deletedCount + failedCount;
        if (totalAttempts > 0) {
            alert(`${deletedCount} file duplicati sono stati eliminati. ${failedCount > 0 ? `${failedCount} eliminazioni fallite.` : ''} La pagina verrà ricaricata.`);
            window.location.reload();
        }
    }

    /**
     * Handles the display of found duplicates and prompts the user for deletion.
     * @param {Array<string[]>} duplicates - An array of groups of duplicate filenames.
     */
    function handleDuplicates(duplicates) {
        let filesToDelete = [];
        let confirmationMessage = "Sono stati trovati i seguenti gruppi di file duplicati:\n\n";

        duplicates.forEach((group, index) => {
            const sortedGroup = group.sort(); // Ordina per mantenere sempre lo stesso file
            const fileToKeep = sortedGroup[0];
            const filesToRemove = sortedGroup.slice(1);
            filesToDelete.push(...filesToRemove);

            confirmationMessage += `Gruppo ${index + 1}:\n`;
            confirmationMessage += `  - Mantenuto: ${fileToKeep}\n`;
            confirmationMessage += `  - Da Eliminare: ${filesToRemove.join(', ')}\n\n`;
        });

        confirmationMessage += "Vuoi procedere con l'eliminazione dei file duplicati? Verrà mantenuta una sola copia per ogni gruppo.";

        if (confirm(confirmationMessage)) {
            deleteFiles(filesToDelete);
        } else {
            statusContainer.style.display = 'none';
        }
    }

    findDuplicatesBtn.addEventListener('click', async () => {
        findDuplicatesBtn.disabled = true;
        statusContainer.style.display = 'block';
        scanStatus.textContent = 'Inizio scansione sul server... (potrebbe richiedere tempo)';

        try {
            const response = await fetch('/find_duplicates_server', {
                method: 'POST',
            });

            if (!response.ok) {
                const errorData = await response.json();
                throw new Error(errorData.error || `Errore del server: ${response.statusText}`);
            }

            const data = await response.json();
            const duplicates = data.duplicates;

            statusContainer.style.display = 'none';

            if (duplicates.length === 0) {
                alert("Nessun duplicato trovato.");
            } else {
                handleDuplicates(duplicates);
            }

        } catch (error) {
            console.error('Errore durante la ricerca dei duplicati:', error);
            scanStatus.textContent = `Errore: ${error.message}`;
            alert(`Si è verificato un errore: ${error.message}`);
        } finally {
            findDuplicatesBtn.disabled = false;
        }
    });
});