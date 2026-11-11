// static/scripts/trash.js

document.addEventListener('DOMContentLoaded', () => {
    // Gestione pulsante "Svuota Cestino"
    const emptyTrashBtn = document.getElementById('empty-trash-btn');
    if (emptyTrashBtn) {
        emptyTrashBtn.addEventListener('click', handleEmptyTrash);
    }

    // Gestione pulsanti sulle singole card
    const grid = document.querySelector('.gallery-grid');
    if (grid) {
        grid.addEventListener('click', (event) => {
            const restoreBtn = event.target.closest('.restore-btn');
            const deleteBtn = event.target.closest('.permanent-delete-btn');

            if (restoreBtn) {
                handleRestore(restoreBtn);
            } else if (deleteBtn) {
                handlePermanentDelete(deleteBtn);
            }
        });
    }
});

function removeCard(button) {
    const card = button.closest('.media-card-wrapper');
    if (card) {
        card.remove();
    }
}

async function handleRestore(button) {
    const filename = button.dataset.filename;
    if (!confirm(`Vuoi davvero ripristinare "${filename}"?`)) return;

    removeCard(button);
    updateCount(-1);

    try {
        const response = await fetch(`/restore/${encodeURIComponent(filename)}`, {
            method: 'POST',
            headers: { 'Accept': 'application/json' },
        });
        const result = await response.json();
        if (!result.success) {
            alert(`Errore: ${result.error || 'Impossibile ripristinare il file.'}`);
            window.location.reload();
        }
    } catch (error) {
        alert('Errore di comunicazione con il server.');
        window.location.reload();
    }
}

async function handlePermanentDelete(button) {
    const filename = button.dataset.filename;
    if (!confirm(`ATTENZIONE: Stai per eliminare definitivamente "${filename}". L'azione è irreversibile. Continuare?`)) return;

    removeCard(button);
    updateCount(-1);

    try {
        const response = await fetch(`/delete_permanent/${encodeURIComponent(filename)}`, {
            method: 'POST',
            headers: { 'Accept': 'application/json' },
        });
        const result = await response.json();
        if (!result.success) {
            alert(`Errore: ${result.error || 'Impossibile eliminare il file.'}`);
            window.location.reload();
        }
    } catch (error) {
        alert('Errore di comunicazione con il server.');
        window.location.reload();
    }
}

async function handleEmptyTrash() {
    if (!confirm('ATTENZIONE: Stai per svuotare l\'intero cestino. Tutti i file verranno eliminati permanentemente. Continuare?')) return;
    
    try {
        const response = await fetch('/empty_trash', {
            method: 'POST',
            headers: { 'Accept': 'application/json' },
        });
        const result = await response.json();
        if (result.success) {
            const grid = document.querySelector('.media-group-grid');
            if(grid) {
                 grid.innerHTML = `
                    <div class="empty-state">
                        <span class="material-icons">delete_sweep</span>
                        <h3>Il cestino è vuoto</h3>
                        <p>I file eliminati appariranno qui.</p>
                    </div>`;
            }
            updateCount(0, true); // Imposta il contatore a 0
            document.getElementById('empty-trash-btn').style.display = 'none';
        } else {
            alert(`Errore: ${result.error || 'Impossibile svuotare il cestino.'}`);
        }
    } catch (error) {
         alert('Errore di comunicazione con il server.');
    }
}

function formatBytesHumanTrash(bytes) {
    if (!bytes || bytes <= 0) return '0 B';
    const units = ['B', 'KB', 'MB', 'GB'];
    const i = Math.min(units.length - 1, Math.floor(Math.log(bytes) / Math.log(1024)));
    return `${(bytes / Math.pow(1024, i)).toFixed(i === 0 ? 0 : 1)} ${units[i]}`;
}

function syncStandaloneTrashBanner() {
    const banner = document.getElementById('trash-recoverable-storage-banner');
    if (!banner) return;
    const wrappers = Array.from(document.querySelectorAll('.media-card-wrapper'));
    if (wrappers.length === 0) {
        banner.remove();
        return;
    }
    const trashBytes = wrappers.reduce((acc, el) => acc + (Number(el.dataset.size) || 0), 0);
    const sizeSpan = document.getElementById('trash-banner-size');
    const countSpan = document.getElementById('trash-banner-count');
    if (sizeSpan) sizeSpan.textContent = formatBytesHumanTrash(trashBytes);
    if (countSpan) countSpan.textContent = String(wrappers.length);
}

function updateCount(change, absolute = false) {
    const countElement = document.getElementById('media-count');
    if (countElement) {
        let currentCount = parseInt(countElement.textContent) || 0;
        let newCount = absolute ? change : currentCount + change;
        countElement.textContent = `${newCount} elementi`;
    }
    syncStandaloneTrashBanner();
}

