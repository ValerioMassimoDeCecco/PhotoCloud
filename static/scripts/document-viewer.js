(function () {
    let currentDocPreview = null;
    let currentPdfPage = 1;
    let currentPdfZoom = 100;
    let currentWordFontScale = 100;
    let currentSheetIndex = 0;
    let currentSlideIndex = 0;
    let currentSearchQuery = '';

    function escapeHtml(str) {
        return String(str ?? '')
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;')
            .replace(/'/g, '&#39;');
    }

    function formatBytes(bytes) {
        if (!bytes || bytes <= 0) return '0 B';
        const units = ['B', 'KB', 'MB', 'GB'];
        const i = Math.min(units.length - 1, Math.floor(Math.log(bytes) / Math.log(1024)));
        return `${(bytes / Math.pow(1024, i)).toFixed(i === 0 ? 0 : 1)} ${units[i]}`;
    }

    function highlightQuery(text, query) {
        const safe = escapeHtml(text);
        if (!query || !query.trim()) return safe;
        const escapedQ = query.trim().replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        const re = new RegExp(`(${escapedQ})`, 'gi');
        return safe.replace(re, '<mark class="doc-search-highlight">$1</mark>');
    }

    function colIndexToLetter(idx) {
        let s = '';
        let n = idx + 1;
        while (n > 0) {
            const rem = (n - 1) % 26;
            s = String.fromCharCode(65 + rem) + s;
            n = Math.floor((n - 1) / 26);
        }
        return s;
    }

    function closeDocumentViewer() {
        const modal = document.getElementById('document-viewer-modal');
        const stage = document.getElementById('document-viewer-stage');
        if (modal) modal.style.display = 'none';
        if (stage) stage.innerHTML = '';
        currentDocPreview = null;
    }

    async function openWithSystemAppOrChooser(preview) {
        if (!preview) return;
        // 1. If Web Share API with files is supported (Android Chrome / iOS Safari / modern desktop), invoke native OS app chooser
        if (navigator.canShare && navigator.share) {
            try {
                const resp = await fetch(preview.mediaUrl);
                if (resp.ok) {
                    const blob = await resp.blob();
                    const fileObj = new File([blob], preview.filename, {
                        type: (preview.mimeType || 'application/octet-stream').split(';')[0].trim()
                    });
                    if (navigator.canShare({ files: [fileObj] })) {
                        await navigator.share({
                            title: preview.filename,
                            files: [fileObj]
                        });
                        return;
                    }
                }
            } catch (err) {
                if (err && err.name === 'AbortError') return;
            }
        }

        // 2. Otherwise open the inline stream in a new tab so the OS / browser protocol handler can pick the installed application
        const win = window.open(preview.mediaUrl, '_blank', 'noopener');
        if (!win) {
            // If popup blocked or no handler, prompt user in the viewer
            const statusEl = document.getElementById('doc-external-status-msg');
            if (statusEl) {
                statusEl.textContent = 'Nessuna applicazione di sistema rilevata direttamente dal browser. Puoi scaricare manualmente il file qui sotto.';
                statusEl.style.display = 'block';
            }
        }
    }

    function triggerManualDownload(preview) {
        if (!preview) return;
        if (window.trackDirectDownload) {
            window.trackDirectDownload(null, preview.filename, preview.sizeBytes || 0);
        }
        const a = document.createElement('a');
        a.href = preview.downloadUrl;
        a.download = preview.filename;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
    }

    function renderPdfStage(preview, toolbar, stage) {
        const totalPages = Math.max(1, preview.pageCount || 1);
        currentPdfPage = Math.max(1, Math.min(totalPages, currentPdfPage));

        toolbar.innerHTML = `
            <div class="doc-toolbar-group">
                <button type="button" class="btn outlined doc-tool-btn" id="pdf-prev-page" ${currentPdfPage <= 1 ? 'disabled' : ''} title="Pagina precedente">
                    <span class="material-icons">chevron_left</span>
                </button>
                <span class="doc-toolbar-pill">
                    Pagina <input type="number" id="pdf-page-input" min="1" max="${totalPages}" value="${currentPdfPage}" aria-label="Numero pagina"> di ${totalPages}
                </span>
                <button type="button" class="btn outlined doc-tool-btn" id="pdf-next-page" ${currentPdfPage >= totalPages ? 'disabled' : ''} title="Pagina successiva">
                    <span class="material-icons">chevron_right</span>
                </button>
            </div>
            <div class="doc-toolbar-group">
                <button type="button" class="btn outlined doc-tool-btn" id="pdf-zoom-out" title="Riduci zoom">
                    <span class="material-icons">remove</span>
                </button>
                <span class="doc-toolbar-pill" id="pdf-zoom-label">${currentPdfZoom}%</span>
                <button type="button" class="btn outlined doc-tool-btn" id="pdf-zoom-in" title="Aumenta zoom">
                    <span class="material-icons">add</span>
                </button>
                <button type="button" class="btn outlined doc-tool-btn" id="pdf-zoom-reset" title="Reimposta zoom 100%">
                    <span>100%</span>
                </button>
            </div>
        `;

        const pdfSrc = `${preview.mediaUrl}#page=${currentPdfPage}&zoom=${currentPdfZoom}`;
        const hasNativePdfPlugin = typeof navigator !== 'undefined' && navigator.pdfViewerEnabled === true;

        if (hasNativePdfPlugin) {
            stage.innerHTML = `
                <div class="doc-pdf-container" id="doc-pdf-container">
                    <div class="doc-pdf-zoom-wrapper" id="doc-pdf-zoom-wrapper" style="width: ${Math.max(100, currentPdfZoom)}%; height: 100%;">
                        <iframe
                            id="doc-pdf-frame"
                            class="doc-pdf-frame"
                            src="${escapeHtml(pdfSrc)}"
                            title="${escapeHtml(preview.filename)}"
                        ></iframe>
                    </div>
                </div>
            `;
        } else {
            const blocks = Array.isArray(preview.blocks) ? preview.blocks : [];
            const paragraphsHtml = blocks.length > 0
                ? blocks.map(b => `<p class="doc-paragraph">${escapeHtml(b.text || '')}</p>`).join('\n')
                : `<p class="doc-paragraph">Anteprima pagina ${currentPdfPage} di ${totalPages} • ${escapeHtml(preview.filename)} (${formatBytes(preview.sizeBytes)})</p>`;
            stage.innerHTML = `
                <div class="doc-pdf-container" id="doc-pdf-container">
                    <article id="doc-pdf-frame" class="doc-pdf-fallback-sheet" style="font-size: ${currentPdfZoom}%;">
                        <div class="doc-slide-badge">PDF • PAGINA ${currentPdfPage} DI ${totalPages}</div>
                        <h3 style="margin: 12px 0;">${escapeHtml(preview.filename)}</h3>
                        ${paragraphsHtml}
                    </article>
                </div>
            `;
        }

        const updatePdfView = () => {
            renderPdfStage(preview, toolbar, stage);
        };

        document.getElementById('pdf-prev-page')?.addEventListener('click', () => {
            if (currentPdfPage > 1) {
                currentPdfPage--;
                updatePdfView();
            }
        });
        document.getElementById('pdf-next-page')?.addEventListener('click', () => {
            if (currentPdfPage < totalPages) {
                currentPdfPage++;
                updatePdfView();
            }
        });
        document.getElementById('pdf-page-input')?.addEventListener('change', (e) => {
            const val = parseInt(e.target.value, 10);
            if (!Number.isNaN(val)) {
                currentPdfPage = Math.max(1, Math.min(totalPages, val));
                updatePdfView();
            }
        });
        document.getElementById('pdf-zoom-out')?.addEventListener('click', () => {
            currentPdfZoom = Math.max(50, currentPdfZoom - 25);
            updatePdfView();
        });
        document.getElementById('pdf-zoom-in')?.addEventListener('click', () => {
            currentPdfZoom = Math.min(250, currentPdfZoom + 25);
            updatePdfView();
        });
        document.getElementById('pdf-zoom-reset')?.addEventListener('click', () => {
            currentPdfZoom = 100;
            updatePdfView();
        });
    }

    function renderWordStage(preview, toolbar, stage) {
        const blocks = Array.isArray(preview.blocks) ? preview.blocks : [];

        toolbar.innerHTML = `
            <div class="doc-toolbar-group">
                <div class="doc-search-input-wrap">
                    <span class="material-icons">search</span>
                    <input type="search" id="doc-word-search" placeholder="Cerca nel documento..." value="${escapeHtml(currentSearchQuery)}">
                </div>
            </div>
            <div class="doc-toolbar-group">
                <button type="button" class="btn outlined doc-tool-btn" id="word-font-dec" title="Riduci dimensione testo">A-</button>
                <span class="doc-toolbar-pill">${currentWordFontScale}%</span>
                <button type="button" class="btn outlined doc-tool-btn" id="word-font-inc" title="Aumenta dimensione testo">A+</button>
                <span class="doc-toolbar-pill">${preview.wordCount || 0} parole</span>
            </div>
        `;

        const renderWordBody = () => {
            const q = currentSearchQuery.trim().toLowerCase();
            const filteredBlocks = q
                ? blocks.filter(b => {
                      if (b.rows) return b.rows.some(r => r.some(c => c.toLowerCase().includes(q)));
                      return (b.text || '').toLowerCase().includes(q);
                  })
                : blocks;

            if (filteredBlocks.length === 0) {
                stage.innerHTML = `
                    <div class="doc-paper-sheet" style="font-size: ${currentWordFontScale}%;">
                        <p class="doc-empty-notice">${q ? 'Nessuna corrispondenza trovata nel documento.' : 'Documento vuoto o privo di testo formattato.'}</p>
                    </div>
                `;
                return;
            }

            const htmlParts = filteredBlocks.map(block => {
                if (block.type === 'heading') {
                    const lvl = Math.min(3, Math.max(1, block.level || 1));
                    return `<h${lvl} class="doc-heading-${lvl}">${highlightQuery(block.text || '', currentSearchQuery)}</h${lvl}>`;
                }
                if (block.type === 'list-item') {
                    return `<div class="doc-list-item"><span class="doc-bullet">•</span><span>${highlightQuery(block.text || '', currentSearchQuery)}</span></div>`;
                }
                if (block.type === 'table' && Array.isArray(block.rows)) {
                    const rowsHtml = block.rows
                        .map((row, rIdx) => {
                            const tag = rIdx === 0 ? 'th' : 'td';
                            return `<tr>${row.map(c => `<${tag}>${highlightQuery(c, currentSearchQuery)}</${tag}>`).join('')}</tr>`;
                        })
                        .join('');
                    return `<div class="doc-table-scroll"><table class="doc-word-table"><tbody>${rowsHtml}</tbody></table></div>`;
                }
                return `<p class="doc-paragraph">${highlightQuery(block.text || '', currentSearchQuery)}</p>`;
            });

            stage.innerHTML = `
                <article class="doc-paper-sheet" id="doc-word-sheet" style="font-size: ${currentWordFontScale}%;">
                    ${htmlParts.join('\n')}
                </article>
            `;
        };

        renderWordBody();

        document.getElementById('doc-word-search')?.addEventListener('input', (e) => {
            currentSearchQuery = e.target.value || '';
            renderWordBody();
        });
        document.getElementById('word-font-dec')?.addEventListener('click', () => {
            currentWordFontScale = Math.max(75, currentWordFontScale - 15);
            renderWordStage(preview, toolbar, stage);
        });
        document.getElementById('word-font-inc')?.addEventListener('click', () => {
            currentWordFontScale = Math.min(175, currentWordFontScale + 15);
            renderWordStage(preview, toolbar, stage);
        });
    }

    function renderSpreadsheetStage(preview, toolbar, stage) {
        const sheets = Array.isArray(preview.sheets) && preview.sheets.length > 0
            ? preview.sheets
            : [{ name: 'Foglio 1', rows: [] }];
        currentSheetIndex = Math.max(0, Math.min(sheets.length - 1, currentSheetIndex));
        const activeSheet = sheets[currentSheetIndex];

        const tabsHtml = sheets
            .map((sh, idx) => `
                <button type="button" class="doc-sheet-tab ${idx === currentSheetIndex ? 'active' : ''}" data-sheet-idx="${idx}">
                    <span class="material-icons" style="font-size: 15px;">grid_on</span>
                    <span>${escapeHtml(sh.name)}</span>
                </button>
            `)
            .join('');

        const activeRows = Array.isArray(activeSheet.allRows)
            ? activeSheet.allRows
            : (Array.isArray(activeSheet.headers) && activeSheet.headers.length > 0
                ? [activeSheet.headers, ...(activeSheet.rows || [])]
                : (activeSheet.rows || []));

        toolbar.innerHTML = `
            <div class="doc-toolbar-group">
                <div class="doc-sheet-tabs-row">${tabsHtml}</div>
            </div>
            <div class="doc-toolbar-group">
                <div class="doc-search-input-wrap">
                    <span class="material-icons">filter_list</span>
                    <input type="search" id="doc-sheet-search" placeholder="Filtra righe..." value="${escapeHtml(currentSearchQuery)}">
                </div>
                <span class="doc-toolbar-pill">${activeRows.length} righe</span>
            </div>
        `;

        const renderTableGrid = () => {
            const rows = activeRows;
            const q = currentSearchQuery.trim().toLowerCase();
            const filteredRows = q
                ? rows.filter(r => r.some(cell => String(cell || '').toLowerCase().includes(q)))
                : rows;

            const maxCols = Math.max(
                1,
                filteredRows.reduce((m, r) => Math.max(m, r.length), 0)
            );

            const colHeaders = Array.from({ length: maxCols }, (_, i) => `<th>${colIndexToLetter(i)}</th>`).join('');
            const bodyRows = filteredRows
                .map((r, rIdx) => {
                    const cells = Array.from({ length: maxCols }, (_, cIdx) => {
                        const val = r[cIdx] ?? '';
                        return `<td class="${rIdx === 0 && !q ? 'doc-sheet-first-row' : ''}">${highlightQuery(val, currentSearchQuery)}</td>`;
                    }).join('');
                    return `<tr><td class="doc-sheet-row-num">${rIdx + 1}</td>${cells}</tr>`;
                })
                .join('');

            stage.innerHTML = `
                <div class="doc-spreadsheet-wrap">
                    ${
                        filteredRows.length === 0
                            ? `<div class="doc-empty-notice">Nessuna cella trovata in questo foglio.</div>`
                            : `<table class="doc-spreadsheet-table">
                                <thead>
                                    <tr>
                                        <th class="doc-sheet-corner">#</th>
                                        ${colHeaders}
                                    </tr>
                                </thead>
                                <tbody>${bodyRows}</tbody>
                               </table>`
                    }
                </div>
            `;
        };

        renderTableGrid();

        toolbar.querySelectorAll('.doc-sheet-tab').forEach(btn => {
            btn.addEventListener('click', () => {
                currentSheetIndex = Number(btn.dataset.sheetIdx || 0);
                renderSpreadsheetStage(preview, toolbar, stage);
            });
        });

        document.getElementById('doc-sheet-search')?.addEventListener('input', (e) => {
            currentSearchQuery = e.target.value || '';
            renderTableGrid();
        });
    }

    function renderPresentationStage(preview, toolbar, stage) {
        const slides = Array.isArray(preview.slides) && preview.slides.length > 0
            ? preview.slides
            : [{ slideNumber: 1, title: preview.filename, bullets: ['Nessuna slide testuale estratta.'] }];
        currentSlideIndex = Math.max(0, Math.min(slides.length - 1, currentSlideIndex));
        const activeSlide = slides[currentSlideIndex];

        toolbar.innerHTML = `
            <div class="doc-toolbar-group">
                <button type="button" class="btn outlined doc-tool-btn" id="ppt-prev-slide" ${currentSlideIndex <= 0 ? 'disabled' : ''}>
                    <span class="material-icons">chevron_left</span>
                    <span>Precedente</span>
                </button>
                <span class="doc-toolbar-pill">Slide ${currentSlideIndex + 1} di ${slides.length}</span>
                <button type="button" class="btn outlined doc-tool-btn" id="ppt-next-slide" ${currentSlideIndex >= slides.length - 1 ? 'disabled' : ''}>
                    <span>Successiva</span>
                    <span class="material-icons">chevron_right</span>
                </button>
            </div>
        `;

        const bulletsHtml = (activeSlide.bullets || [])
            .map(b => `<li class="doc-slide-bullet">${escapeHtml(b)}</li>`)
            .join('');

        const thumbsHtml = slides
            .map((sl, idx) => `
                <button type="button" class="doc-slide-thumb ${idx === currentSlideIndex ? 'active' : ''}" data-slide-idx="${idx}">
                    <span class="slide-thumb-num">${sl.slideNumber}</span>
                    <span class="slide-thumb-title">${escapeHtml(sl.title)}</span>
                </button>
            `)
            .join('');

        stage.innerHTML = `
            <div class="doc-presentation-layout">
                <div class="doc-slide-canvas" id="doc-slide-canvas">
                    <div class="doc-slide-badge">SLIDE ${activeSlide.slideNumber} / ${slides.length}</div>
                    <h2 class="doc-slide-title">${escapeHtml(activeSlide.title)}</h2>
                    ${
                        bulletsHtml
                            ? `<ul class="doc-slide-bullets">${bulletsHtml}</ul>`
                            : `<p class="doc-slide-empty">Slide senza elenco puntato aggiuntivo</p>`
                    }
                    ${
                        activeSlide.notes
                            ? `<div class="doc-slide-notes"><strong>Note relatore:</strong> ${escapeHtml(activeSlide.notes)}</div>`
                            : ''
                    }
                </div>
                <div class="doc-slide-strip">${thumbsHtml}</div>
            </div>
        `;

        document.getElementById('ppt-prev-slide')?.addEventListener('click', () => {
            if (currentSlideIndex > 0) {
                currentSlideIndex--;
                renderPresentationStage(preview, toolbar, stage);
            }
        });
        document.getElementById('ppt-next-slide')?.addEventListener('click', () => {
            if (currentSlideIndex < slides.length - 1) {
                currentSlideIndex++;
                renderPresentationStage(preview, toolbar, stage);
            }
        });
        stage.querySelectorAll('.doc-slide-thumb').forEach(btn => {
            btn.addEventListener('click', () => {
                currentSlideIndex = Number(btn.dataset.slideIdx || 0);
                renderPresentationStage(preview, toolbar, stage);
            });
        });
    }

    function renderTextStage(preview, toolbar, stage) {
        const rawText = preview.textContent || '';
        const lines = rawText.split(/\r?\n/);

        toolbar.innerHTML = `
            <div class="doc-toolbar-group">
                <div class="doc-search-input-wrap">
                    <span class="material-icons">search</span>
                    <input type="search" id="doc-text-search" placeholder="Cerca nel testo..." value="${escapeHtml(currentSearchQuery)}">
                </div>
            </div>
            <div class="doc-toolbar-group">
                <span class="doc-toolbar-pill">${lines.length} righe • ${preview.wordCount || 0} parole</span>
                <button type="button" class="btn outlined doc-tool-btn" id="doc-copy-text-btn" title="Copia contenuto">
                    <span class="material-icons" style="font-size: 16px;">content_copy</span>
                    <span>Copia</span>
                </button>
            </div>
        `;

        const renderLines = () => {
            const numberedHtml = lines
                .map((line, i) => `
                    <div class="doc-code-line">
                        <span class="doc-code-ln">${i + 1}</span>
                        <span class="doc-code-content">${highlightQuery(line, currentSearchQuery) || '&nbsp;'}</span>
                    </div>
                `)
                .join('');
            stage.innerHTML = `<div class="doc-code-viewer">${numberedHtml}</div>`;
        };

        renderLines();

        document.getElementById('doc-text-search')?.addEventListener('input', (e) => {
            currentSearchQuery = e.target.value || '';
            renderLines();
        });
        document.getElementById('doc-copy-text-btn')?.addEventListener('click', async (e) => {
            try {
                await navigator.clipboard.writeText(rawText);
                const btn = e.currentTarget;
                const span = btn.querySelector('span:last-child');
                if (span) span.textContent = 'Copiato!';
                setTimeout(() => {
                    if (span) span.textContent = 'Copia';
                }, 1500);
            } catch (_e) {}
        });
    }

    function renderAudioStage(preview, toolbar, stage) {
        toolbar.innerHTML = `
            <div class="doc-toolbar-group">
                <span class="doc-toolbar-pill">${escapeHtml(preview.formatLabel)} • ${formatBytes(preview.sizeBytes)}</span>
            </div>
        `;
        stage.innerHTML = `
            <div class="doc-external-card">
                <div class="doc-external-icon-wrap">
                    <span class="material-icons">graphic_eq</span>
                </div>
                <h3>${escapeHtml(preview.filename)}</h3>
                <p class="doc-external-meta">${escapeHtml(preview.mimeType)} • ${formatBytes(preview.sizeBytes)}</p>
                <audio controls autoplay class="doc-audio-player" src="${escapeHtml(preview.mediaUrl)}"></audio>
            </div>
        `;
    }

    function renderExternalOrChooserStage(preview, toolbar, stage) {
        toolbar.innerHTML = `
            <div class="doc-toolbar-group">
                <span class="doc-toolbar-pill">${escapeHtml(preview.formatLabel)} • ${escapeHtml(preview.mimeType)}</span>
            </div>
        `;

        stage.innerHTML = `
            <div class="doc-external-card" id="doc-external-chooser-card">
                <div class="doc-external-icon-wrap">
                    <span class="material-icons">open_in_new</span>
                </div>
                <h3>Apri "${escapeHtml(preview.filename)}"</h3>
                <p class="doc-external-meta">
                    Formato: <strong>${escapeHtml(preview.formatLabel)}</strong> (${escapeHtml(preview.mimeType)}) • ${formatBytes(preview.sizeBytes)}
                </p>
                <p class="doc-external-desc">
                    Questo formato non è visualizzabile direttamente nel lettore interno. Scegli con quale applicazione del dispositivo desideri aprirlo oppure scaricalo manualmente.
                </p>
                <p id="doc-external-status-msg" class="doc-external-status-msg" style="display: none;"></p>
                <div class="doc-external-actions">
                    <button type="button" class="btn primary" id="doc-choose-external-app-btn">
                        <span class="material-icons">apps</span>
                        <span>Scegli Applicazione sul Dispositivo</span>
                    </button>
                    <button type="button" class="btn outlined" id="doc-manual-download-fallback-btn">
                        <span class="material-icons">download</span>
                        <span>Scarica Manualmente (${formatBytes(preview.sizeBytes)})</span>
                    </button>
                </div>
            </div>
        `;

        document.getElementById('doc-choose-external-app-btn')?.addEventListener('click', () => {
            openWithSystemAppOrChooser(preview);
        });
        document.getElementById('doc-manual-download-fallback-btn')?.addEventListener('click', () => {
            triggerManualDownload(preview);
        });
    }

    function renderDocumentPreview(preview) {
        currentDocPreview = preview;
        currentPdfPage = 1;
        currentPdfZoom = 100;
        currentWordFontScale = 100;
        currentSheetIndex = 0;
        currentSlideIndex = 0;
        currentSearchQuery = '';

        const titleEl = document.getElementById('doc-viewer-title');
        const subtitleEl = document.getElementById('doc-viewer-subtitle');
        const toolbar = document.getElementById('document-viewer-toolbar');
        const stage = document.getElementById('document-viewer-stage');

        if (titleEl) titleEl.textContent = preview.filename;
        if (subtitleEl) {
            subtitleEl.textContent = `${preview.formatLabel} • ${formatBytes(preview.sizeBytes)}`;
        }
        if (!toolbar || !stage) return;

        if (preview.viewerMode === 'pdf') {
            renderPdfStage(preview, toolbar, stage);
        } else if (preview.viewerMode === 'word') {
            renderWordStage(preview, toolbar, stage);
        } else if (preview.viewerMode === 'spreadsheet') {
            renderSpreadsheetStage(preview, toolbar, stage);
        } else if (preview.viewerMode === 'presentation') {
            renderPresentationStage(preview, toolbar, stage);
        } else if (preview.viewerMode === 'text') {
            renderTextStage(preview, toolbar, stage);
        } else if (preview.viewerMode === 'audio') {
            renderAudioStage(preview, toolbar, stage);
        } else {
            renderExternalOrChooserStage(preview, toolbar, stage);
        }
    }

    window.openCloudFile = async function (filename, sizeBytes = 0, fromTrash = false, event = null) {
        if (event) {
            event.stopPropagation();
            event.preventDefault();
        }
        if (!filename) return;

        const ext = filename.split('.').pop()?.toLowerCase() || '';
        const isImg = ['jpg', 'jpeg', 'png', 'gif', 'webp', 'bmp', 'svg', 'heic', 'avif'].includes(ext);
        const isVid = ['mp4', 'mov', 'webm', 'mkv', 'avi'].includes(ext);

        if (isImg || isVid) {
            const url = `/media/${encodeURIComponent(filename)}${fromTrash ? '?from_trash=true' : ''}`;
            if (window.openLightbox) {
                window.openLightbox(url, isVid, 0, [url]);
                return;
            }
        }

        const modal = document.getElementById('document-viewer-modal');
        const titleEl = document.getElementById('doc-viewer-title');
        const subtitleEl = document.getElementById('doc-viewer-subtitle');
        const toolbar = document.getElementById('document-viewer-toolbar');
        const stage = document.getElementById('document-viewer-stage');

        if (!modal || !stage) return;

        modal.style.display = 'flex';
        if (titleEl) titleEl.textContent = filename;
        if (subtitleEl) subtitleEl.textContent = `Decrittografia e apertura in corso (${formatBytes(sizeBytes)})...`;
        if (toolbar) toolbar.innerHTML = '';
        stage.innerHTML = `
            <div class="doc-loading-state">
                <div class="doc-spinner"></div>
                <p>Decrittografia e preparazione del documento in corso...</p>
            </div>
        `;

        try {
            const resp = await fetch(`/api/document-preview/${encodeURIComponent(filename)}${fromTrash ? '?from_trash=true' : ''}`);
            if (!resp.ok) {
                throw new Error(`Impossibile aprire il documento (${resp.status})`);
            }
            const preview = await resp.json();
            renderDocumentPreview(preview);
        } catch (err) {
            stage.innerHTML = `
                <div class="doc-external-card">
                    <div class="doc-external-icon-wrap" style="background: var(--error-container); color: var(--on-error-container);">
                        <span class="material-icons">error_outline</span>
                    </div>
                    <h3>Impossibile visualizzare l'anteprima</h3>
                    <p class="doc-external-desc">${escapeHtml(err.message || 'Errore durante il caricamento del file.')}</p>
                    <div class="doc-external-actions">
                        <button type="button" class="btn primary" id="doc-err-download-btn">
                            <span class="material-icons">download</span>
                            <span>Scarica Manualmente</span>
                        </button>
                    </div>
                </div>
            `;
            document.getElementById('doc-err-download-btn')?.addEventListener('click', () => {
                triggerManualDownload({
                    filename,
                    sizeBytes,
                    downloadUrl: `/media/${encodeURIComponent(filename)}?download=1${fromTrash ? '&from_trash=true' : ''}`
                });
            });
        }
    };

    window.closeDocumentViewer = closeDocumentViewer;

    document.addEventListener('DOMContentLoaded', () => {
        document.getElementById('doc-viewer-close-btn')?.addEventListener('click', closeDocumentViewer);
        document.getElementById('doc-viewer-open-external-btn')?.addEventListener('click', () => {
            if (currentDocPreview) openWithSystemAppOrChooser(currentDocPreview);
        });
        document.getElementById('doc-viewer-download-btn')?.addEventListener('click', () => {
            if (currentDocPreview) triggerManualDownload(currentDocPreview);
        });

        document.addEventListener('keydown', (e) => {
            const modal = document.getElementById('document-viewer-modal');
            if (!modal || modal.style.display === 'none' || !currentDocPreview) return;

            if (e.key === 'Escape') {
                closeDocumentViewer();
            } else if (currentDocPreview.viewerMode === 'presentation') {
                const toolbar = document.getElementById('document-viewer-toolbar');
                const stage = document.getElementById('document-viewer-stage');
                const slidesCount = (currentDocPreview.slides || []).length;
                if (e.key === 'ArrowRight' && currentSlideIndex < slidesCount - 1) {
                    currentSlideIndex++;
                    renderPresentationStage(currentDocPreview, toolbar, stage);
                } else if (e.key === 'ArrowLeft' && currentSlideIndex > 0) {
                    currentSlideIndex--;
                    renderPresentationStage(currentDocPreview, toolbar, stage);
                }
            }
        });
    });
})();
