// static/scripts/similar-duplicates.js — Ricerca "Duplicati Quasi Identici" (pHash DCT percettivo):
// trova foto visivamente simili anche se ricompresse o ridimensionate, con anteprime
// e pulizia selettiva delle copie superflue.

document.addEventListener('DOMContentLoaded', () => {
    const findDuplicatesBtn = document.getElementById('find-duplicates-btn');
    const statusContainer = document.getElementById('scan-status-container');
    const scanStatus = document.getElementById('scan-main-status');
    if (!findDuplicatesBtn || !statusContainer || !scanStatus) return;

    // Overlay dedicato ai risultati "quasi identici"
    let overlay = document.createElement('div');
    overlay.className = 'vm-overlay';
    overlay.id = 'similar-duplicates-overlay';
    overlay.style.display = 'none';
    overlay.innerHTML = `
        <div class="vm-overlay-header">
            <button type="button" class="btn icon" id="close-similar-btn" title="Chiudi" aria-label="Chiudi">
                <span class="material-icons">arrow_back</span>
            </button>
            <div class="vm-overlay-title-group">
                <h2>Duplicati quasi identici</h2>
                <p class="vm-overlay-subtitle" id="similar-subtitle">Foto visivamente simili (pHash percettivo)</p>
            </div>
        </div>
        <div class="vm-overlay-content" id="similar-content"></div>`;
    document.body.appendChild(overlay);
    const content = overlay.querySelector('#similar-content');
    const subtitle = overlay.querySelector('#similar-subtitle');
    overlay.querySelector('#close-similar-btn').addEventListener('click', () => {
        overlay.style.display = 'none';
    });

    findDuplicatesBtn.addEventListener('contextmenu', async (e) => {
        // Tasto destro sul pulsante Duplicati → scansione "quasi identici"
        e.preventDefault();
        await runSimilarScan(8);
    });

    // Doppio click → scansione simili (più scopribile del solo tasto destro)
    findDuplicatesBtn.addEventListener('dblclick', async (e) => {
        e.preventDefault();
        await runSimilarScan(8);
    });

    async function runSimilarScan(threshold) {
        findDuplicatesBtn.disabled = true;
        statusContainer.style.display = 'block';
        scanStatus.textContent = 'Analisi percettiva delle foto sul server (può richiedere tempo alla prima scansione)…';
        try {
            const res = await fetch('/api/similar_duplicates', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
                body: JSON.stringify({ threshold }),
            });
            const data = await res.json().catch(() => ({}));
            statusContainer.style.display = 'none';
            if (!res.ok) {
                alert(data.error || 'Errore durante la scansione delle foto simili.');
                return;
            }
            const groups = Array.isArray(data.groups) ? data.groups : [];
            subtitle.textContent = `${data.total} foto analizzate (${data.cached} dalla cache, ${data.scanned} nuove) · soglia ${data.threshold}`;
            if (groups.length === 0) {
                content.innerHTML = `<div class="empty-state"><span class="material-icons">photo_library</span>
                    <h3>Nessuna foto quasi identica</h3>
                    <p>Il motore percettivo non ha trovato immagini visivamente simili. (Sono analizzate solo JPEG/PNG/GIF/BMP)</p></div>`;
            } else {
                content.innerHTML = groups
                    .map((g, gi) => {
                        const cards = g.filenames
                            .map((fn, fi) => {
                                const dist = g.distances[fi];
                                const safe = String(fn).replace(/</g, '&lt;');
                                const isKeeper = fi === 0;
                                return `<div class="media-card-wrapper is-media-item similar-card ${isKeeper ? 'similar-keeper' : ''}" data-filename="${safe}">
                                    <div class="media-card">
                                        <img loading="lazy" src="/media/${encodeURIComponent(fn)}" alt="${safe}">
                                        ${isKeeper ? '<span class="similar-keep-badge">✔ Mantieni</span>' : `<span class="similar-dist-badge">Δ ${dist}</span>`}
                                    </div>
                                    ${!isKeeper ? `<button type="button" class="btn danger similar-trash-btn" data-filename="${encodeURIComponent(fn)}">Cestina</button>` : ''}
                                </div>`;
                            })
                            .join('');
                        return `<section class="memories-section">
                            <h3 class="group-title">Gruppo ${gi + 1} — ${g.filenames.length} foto simili</h3>
                            <div class="media-group-grid">${cards}</div>
                        </section>`;
                    })
                    .join('');

                content.querySelectorAll('.similar-trash-btn').forEach((btn) => {
                    btn.addEventListener('click', async () => {
                        const fn = decodeURIComponent(btn.dataset.filename);
                        if (!confirm(`Spostare "${fn}" nel cestino?`)) return;
                        try {
                            const r = await fetch(`/trash/${encodeURIComponent(fn)}`, {
                                method: 'POST',
                                headers: { Accept: 'application/json' },
                            });
                            const j = await r.json().catch(() => ({}));
                            if (j.success) {
                                const card = btn.closest('.similar-card');
                                if (card) card.remove();
                                if (typeof window.refreshVaultFromSession === 'function') window.refreshVaultFromSession();
                            } else {
                                alert(j.error || 'Errore spostamento nel cestino');
                            }
                        } catch {
                            alert('Errore di rete.');
                        }
                    });
                });
            }
            overlay.style.display = 'flex';
        } catch (err) {
            statusContainer.style.display = 'none';
            alert(`Errore di rete durante la scansione: ${err && err.message ? err.message : err}`);
        } finally {
            findDuplicatesBtn.disabled = false;
        }
    }
});
