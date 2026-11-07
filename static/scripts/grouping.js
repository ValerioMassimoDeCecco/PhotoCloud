document.addEventListener('DOMContentLoaded', () => {
    const galleryGrid = document.querySelector('.gallery-grid');
    const groupBySelect = document.getElementById('group-by-select');
    
    // Se non ci sono elementi nella griglia, non fare nulla
    if (!galleryGrid || !galleryGrid.children.length || !groupBySelect) {
        // Nasconde i controlli se la galleria è vuota
        if (document.querySelector('.grouping-controls')) {
             document.querySelector('.grouping-controls').style.display = 'none';
        }
        return;
    }

    // Ordine dei livelli di raggruppamento per lo zoom con la rotellina
    const groupingLevels = ['none', 'year', 'month', 'day'];
    let currentGroupingIndex = groupingLevels.indexOf(groupBySelect.value);

    // Memorizza gli elementi originali per evitare di interrogare il DOM ogni volta
    let allMediaElements = Array.from(galleryGrid.querySelectorAll('.media-card-wrapper'));

    /**
     * Riorganizza e visualizza i media nella griglia in base al livello di raggruppamento.
     * @param {string} level - Il livello di raggruppamento ('none', 'day', 'month', 'year').
     */
    function renderGroups(level) {
        // 1. Animazione di uscita
        galleryGrid.style.opacity = '0';

        // Attendi la fine dell'animazione per modificare il DOM
        setTimeout(() => {
            allMediaElements = allMediaElements.filter(el => el.isConnected);
            galleryGrid.innerHTML = ''; // Svuota la griglia
            
            if (level === 'none') {
                // Se nessun raggruppamento, crea un'unica griglia
                const groupGrid = document.createElement('div');
                groupGrid.className = 'media-group-grid';
                allMediaElements.forEach(el => groupGrid.appendChild(el));
                galleryGrid.appendChild(groupGrid);

            } else {
                // 2. Raggruppa gli elementi
                const groups = new Map();

                allMediaElements.forEach(el => {
                    const timestamp = parseFloat(el.dataset.timestamp) * 1000;
                    const date = new Date(timestamp);
                    let key;

                    if (level === 'day') {
                        key = date.toLocaleDateString('it-IT', { day: 'numeric', month: 'long', year: 'numeric' });
                    } else if (level === 'month') {
                        key = date.toLocaleDateString('it-IT', { month: 'long', year: 'numeric' });
                    } else if (level === 'year') {
                        key = date.getFullYear().toString();
                    }

                    if (!groups.has(key)) {
                        groups.set(key, []);
                    }
                    groups.get(key).push(el);
                });

                // 3. Crea e popola gli elementi del DOM per ogni gruppo
                groups.forEach((media, title) => {
                    const groupContainer = document.createElement('div');
                    groupContainer.className = 'media-group';

                    const groupTitle = document.createElement('h2');
                    groupTitle.className = 'group-title';
                    groupTitle.textContent = title;

                    const groupGrid = document.createElement('div');
                    groupGrid.className = 'media-group-grid';
                    media.forEach(el => groupGrid.appendChild(el));
                    
                    groupContainer.appendChild(groupTitle);
                    groupContainer.appendChild(groupGrid);
                    galleryGrid.appendChild(groupContainer);
                });
            }
            
            // 4. Animazione di entrata
            galleryGrid.style.opacity = '1';

        }, 400); // Deve corrispondere alla durata della transizione CSS
    }

    /**
     * Aggiorna il livello di raggruppamento e l'interfaccia.
     * @param {number} newIndex - Il nuovo indice nell'array `groupingLevels`.
     */
    function updateGrouping(newIndex) {
        if (newIndex >= 0 && newIndex < groupingLevels.length) {
            currentGroupingIndex = newIndex;
            const newLevel = groupingLevels[currentGroupingIndex];
            groupBySelect.value = newLevel;
            renderGroups(newLevel);
        }
    }

    // --- EVENT LISTENERS ---

    // Gestisce il cambio dal selettore
    groupBySelect.addEventListener('change', (e) => {
        currentGroupingIndex = groupingLevels.indexOf(e.target.value);
        renderGroups(e.target.value);
    });

    // Gestisce lo zoom con Ctrl + Rotellina
    galleryGrid.addEventListener('wheel', (e) => {
        if (e.ctrlKey) {
            e.preventDefault(); // Impedisce lo zoom della pagina intera
            
            let newIndex = currentGroupingIndex;
            if (e.deltaY < 0) {
                // Ruota verso l'alto (zoom in -> raggruppamento più fine)
                newIndex++;
            } else {
                // Ruota verso il basso (zoom out -> raggruppamento più ampio)
                newIndex--;
            }
            // Limita l'indice ai valori validi
            newIndex = Math.max(0, Math.min(newIndex, groupingLevels.length - 1));

            if(newIndex !== currentGroupingIndex) {
                updateGrouping(newIndex);
            }
        }
    }, { passive: false });

    // Esegui il rendering iniziale al caricamento della pagina
    renderGroups(groupBySelect.value);
});