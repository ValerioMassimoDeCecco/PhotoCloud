// Variabili globali per gestire lo stato della lightbox
let currentIndex = 0;
let mediaList = [];

// Riferimenti agli elementi del DOM
const lightbox = document.getElementById('lightbox');
const lightboxImg = document.getElementById('lightbox-img');
const lightboxVideo = document.getElementById('lightbox-video');
const lightboxVideoSource = lightboxVideo.querySelector('source');

/**
 * Apre la lightbox per mostrare un media specifico.
 * @param {string} url - L'URL del media da mostrialmente.
 * @param {boolean} isVideo - True se il media è un video.
 * @param {number} index - L'indice del media nella galleria.
 * @param {Array<string>} allMedia - L'array con i nomi di tutti i file media.
 */
window.openLightbox = function(url, isVideo, index, allMedia) {
    // Inizializza lo stato
    mediaList = allMedia;
    currentIndex = index;
    
    // Mostra la lightbox
    lightbox.style.display = 'flex';
    
    // Mostra il media corretto
    showMediaAtIndex(currentIndex);

    // Aggiungi la navigazione da tastiera
    document.addEventListener('keydown', handleKeydown);
}

/**
 * Chiude la visualizzazione a schermo intero.
 */
window.closeLightbox = function() {
    lightbox.style.display = 'none';
    
    // Interrompi la riproduzione del video per sicurezza
    lightboxVideo.pause();
    lightboxVideoSource.setAttribute('src', '');
    
    // Nascondi entrambi gli elementi
    lightboxImg.style.display = 'none';
    lightboxVideo.style.display = 'none';

    // Rimuovi l'ascoltatore di eventi per la tastiera
    document.removeEventListener('keydown', handleKeydown);
}

/**
 * Naviga al media precedente o successivo.
 * @param {number} direction - (-1) per il precedente, (1) per il successivo.
 * @param {Event} event - L'evento click per fermare la propagazione.
 */
window.navigateMedia = function(direction, event) {
    // Evita che il click si propaghi allo sfondo della lightbox, chiudendola
    if (event) event.stopPropagation();
    
    // Calcola il nuovo indice
    currentIndex += direction;
    
    // Gestisce il "loop" della galleria
    if (currentIndex >= mediaList.length) {
        currentIndex = 0; // Torna al primo
    } else if (currentIndex < 0) {
        currentIndex = mediaList.length - 1; // Vai all'ultimo
    }
    
    // Mostra il nuovo media
    showMediaAtIndex(currentIndex);
}

/**
 * Mostra il media all'indice specificato.
 * @param {number} index - L'indice del media da mostrare.
 */
function showMediaAtIndex(index) {
    const filename = mediaList[index];
    const mediaUrl = `/media/${filename}`; // Costruisce l'URL per la rotta Flask
    const isVideo = /\.(mp4|mov)$/i.test(filename);
    
    // Ferma qualsiasi media in riproduzione
    lightboxVideo.pause();
    
    if (isVideo) {
        // Mostra il video
        lightboxImg.style.display = 'none';
        lightboxVideo.style.display = 'block';
        lightboxVideoSource.setAttribute('src', mediaUrl);
        lightboxVideo.load();
        lightboxVideo.play().catch(e => console.error("La riproduzione automatica del video non è riuscita:", e));
    } else {
        // Mostra l'immagine
        lightboxVideo.style.display = 'none';
        lightboxImg.style.display = 'block';
        lightboxImg.setAttribute('src', mediaUrl);
    }
}

/**
 * Gestisce gli eventi della tastiera per la navigazione (frecce) e la chiusura (Esc).
 * @param {KeyboardEvent} e - L'evento della tastiera.
 */
function handleKeydown(e) {
    if (e.key === 'ArrowRight') {
        navigateMedia(1);
    } else if (e.key === 'ArrowLeft') {
        navigateMedia(-1);
    } else if (e.key === 'Escape') {
        closeLightbox();
    }
}
