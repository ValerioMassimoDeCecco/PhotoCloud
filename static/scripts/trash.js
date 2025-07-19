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
        card.style.transition = 'opacity 0.3s, transform 0.3s';
        card.style.opacity = '0';
        card.style.transform = 'scale(0.8)';
        setTimeout(() => card.remove(), 300);
    }
}

async function handleRestore(button) {
    const filename = button.dataset.filename;
    if (!confirm(`Vuoi davvero ripristinare "${filename}"?`)) return;

    try {
        const response = await fetch(`/restore/${filename}`, {
            method: 'POST',
            headers: { 'Accept': 'application/json' },
        });
        const result = await response.json();
        if (result.success) {
            removeCard(button);
            updateCount(-1);
        } else {
            alert(`Errore: ${result.error || 'Impossibile ripristinare il file.'}`);
        }
    } catch (error) {
        alert('Errore di comunicazione con il server.');
    }
}

async function handlePermanentDelete(button) {
    const filename = button.dataset.filename;
    if (!confirm(`ATTENZIONE: Stai per eliminare definitivamente "${filename}". L'azione è irreversibile. Continuare?`)) return;

    try {
        const response = await fetch(`/delete_permanent/${filename}`, {
            method: 'POST',
            headers: { 'Accept': 'application/json' },
        });
        const result = await response.json();
        if (result.success) {
            removeCard(button);
            updateCount(-1);
        } else {
            alert(`Errore: ${result.error || 'Impossibile eliminare il file.'}`);
        }
    } catch (error) {
        alert('Errore di comunicazione con il server.');
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

function updateCount(change, absolute = false) {
    const countElement = document.getElementById('media-count');
    if (countElement) {
        let currentCount = parseInt(countElement.textContent) || 0;
        let newCount = absolute ? change : currentCount + change;
        countElement.textContent = `${newCount} elementi`;
    }
}