import React, { useState, useRef } from 'react';
import { MediaItem } from '../types';
import { groupMediaItems, isVideoFilename } from '../lib/grouping';
import { PWAInstallButton } from './PWAInstallButton';

interface GalleryViewProps {
  username: string;
  mediaFiles: MediaItem[];
  trashedCount: number;
  darkMode: boolean;
  onToggleTheme: () => void;
  onRefresh: () => Promise<void>;
  onOpenTrash: () => void;
  onOpenAndroidStudio: () => void;
  onLogout: () => void;
  onOpenLightbox: (index: number, allFilenames: string[]) => void;
}

export const GalleryView: React.FC<GalleryViewProps> = ({
  username,
  mediaFiles,
  trashedCount,
  darkMode,
  onToggleTheme,
  onRefresh,
  onOpenTrash,
  onOpenAndroidStudio,
  onLogout,
  onOpenLightbox,
}) => {
  const [groupBy, setGroupBy] = useState<'none' | 'day' | 'month' | 'year'>('month');
  const [selectedFiles, setSelectedFiles] = useState<Set<string>>(new Set());
  const [scanStatus, setScanStatus] = useState<string | null>(null);
  const [scanProgress, setScanProgress] = useState<number>(0);
  const [duplicateGroups, setDuplicateGroups] = useState<string[][] | null>(null);
  const [uploadState, setUploadState] = useState<{
    visible: boolean;
    expanded: boolean;
    uploading: boolean;
    progress: number;
    title: string;
    status: string;
    files: Array<{ name: string; status: string }>;
  }>({
    visible: false,
    expanded: false,
    uploading: false,
    progress: 0,
    title: '',
    status: '',
    files: [],
  });

  const fileInputRef = useRef<HTMLInputElement | null>(null);

  const groupedMedia = groupMediaItems(mediaFiles, groupBy);
  const allFilenames = mediaFiles.map((m) => m.filename);
  const isAllSelected =
    mediaFiles.length > 0 && selectedFiles.size === mediaFiles.length;

  const toggleSelectFile = (filename: string) => {
    setSelectedFiles((prev) => {
      const next = new Set(prev);
      if (next.has(filename)) {
        next.delete(filename);
      } else {
        next.add(filename);
      }
      return next;
    });
  };

  const handleSelectAll = () => {
    if (isAllSelected) {
      setSelectedFiles(new Set());
    } else {
      setSelectedFiles(new Set(allFilenames));
    }
  };

  const handleUploadChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const fileList = e.target.files;
    if (!fileList || fileList.length === 0) return;

    const filesArray = Array.from(fileList);
    setUploadState({
      visible: true,
      expanded: true,
      uploading: true,
      progress: 10,
      title: 'Caricamento pacchetto 1 di 1...',
      status: `Cifratura AES-256 di ${filesArray.length} file...`,
      files: filesArray.map((f) => ({ name: f.name, status: 'In corso...' })),
    });

    try {
      const formData = new FormData();
      filesArray.forEach((f) => {
        formData.append('file[]', f, f.name);
        formData.append('timestamp[]', String(f.lastModified || Date.now()));
      });

      const resp = await fetch('/upload', {
        method: 'POST',
        body: formData,
      });

      const result = await resp.json();
      if (!resp.ok || !result.success) {
        throw new Error(result.error || 'Errore durante il caricamento');
      }

      setUploadState({
        visible: true,
        expanded: true,
        uploading: false,
        progress: 100,
        title: 'Completato',
        status: `Caricati ${filesArray.length} file con successo!`,
        files: filesArray.map((f) => ({ name: f.name, status: 'Completato' })),
      });

      await onRefresh();
      setTimeout(() => {
        setUploadState((prev) => ({ ...prev, visible: false, expanded: false }));
      }, 2500);
    } catch (err: unknown) {
      setUploadState((prev) => ({
        ...prev,
        uploading: false,
        title: 'Caricamento Fallito',
        status: err instanceof Error ? err.message : 'Errore di rete',
      }));
    } finally {
      if (fileInputRef.current) {
        fileInputRef.current.value = '';
      }
    }
  };

  const handleTrashSingle = async (filename: string, e: React.MouseEvent) => {
    e.stopPropagation();
    try {
      const resp = await fetch(`/trash/${encodeURIComponent(filename)}`, {
        method: 'POST',
        headers: { Accept: 'application/json' },
      });
      const data = await resp.json();
      if (data.success) {
        setSelectedFiles((prev) => {
          const next = new Set(prev);
          next.delete(filename);
          return next;
        });
        await onRefresh();
      }
    } catch {
      // ignore
    }
  };

  const handleTrashSelected = async () => {
    const list = Array.from(selectedFiles);
    if (list.length === 0) return;

    try {
      const resp = await fetch('/trash/batch', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ filenames: list }),
      });
      const data = await resp.json();
      if (data.success) {
        setSelectedFiles(new Set());
        await onRefresh();
      }
    } catch {
      // ignore
    }
  };

  const handleDownloadSelectedZip = async () => {
    const list = Array.from(selectedFiles);
    if (list.length === 0) return;

    setScanStatus("Avvio della preparazione dell'archivio ZIP...");
    setScanProgress(20);

    try {
      const prepResp = await fetch('/prepare-zip', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ filenames: list }),
      });
      const prepData = await prepResp.json();
      if (!prepData.task_id) {
        throw new Error(prepData.error || 'Impossibile preparare lo ZIP');
      }

      const taskId = prepData.task_id;
      const poll = async () => {
        const progResp = await fetch(`/zip-progress/${taskId}`);
        const progData = await progResp.json();
        if (progData.status === 'processing' || progData.status === 'starting') {
          setScanProgress(progData.progress || 50);
          setScanStatus(`Creazione archivio in corso... ${progData.progress || 50}%`);
          setTimeout(poll, 300);
        } else if (progData.status === 'complete' && progData.filename) {
          setScanProgress(100);
          setScanStatus('Archivio pronto! Download avviato.');
          const a = document.createElement('a');
          a.href = `/download-zip/${progData.filename}`;
          a.download = progData.filename;
          document.body.appendChild(a);
          a.click();
          document.body.removeChild(a);
          setTimeout(() => setScanStatus(null), 2500);
        } else {
          setScanStatus(`Errore creazione ZIP: ${progData.error || ' Sconosciuto'}`);
          setTimeout(() => setScanStatus(null), 3000);
        }
      };
      await poll();
    } catch (err: unknown) {
      setScanStatus(err instanceof Error ? err.message : 'Errore creazione ZIP');
      setTimeout(() => setScanStatus(null), 3000);
    }
  };

  const handleFindDuplicates = async () => {
    setScanStatus('Scansione hash SHA-256 sui file decrittografati...');
    setScanProgress(45);
    setDuplicateGroups(null);

    try {
      const resp = await fetch('/find_duplicates_server', { method: 'POST' });
      const data = await resp.json();
      setScanProgress(100);
      const dups: string[][] = data.duplicates || [];
      if (dups.length === 0) {
        setScanStatus('Nessun duplicato trovato! Il tuo archivio è ottimizzato.');
        setTimeout(() => setScanStatus(null), 3000);
      } else {
        setDuplicateGroups(dups);
        setScanStatus(`Trovati ${dups.length} gruppi di file duplicati.`);
      }
    } catch {
      setScanStatus('Errore durante la scansione dei duplicati.');
    }
  };

  const handleConfirmRemoveDuplicates = async () => {
    if (!duplicateGroups) return;
    const toRemove: string[] = [];
    for (const group of duplicateGroups) {
      const sorted = [...group].sort();
      toRemove.push(...sorted.slice(1));
    }
    if (toRemove.length > 0) {
      await fetch('/trash/batch', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ filenames: toRemove }),
      });
      setDuplicateGroups(null);
      setScanStatus(`${toRemove.length} copie duplicate spostate nel cestino.`);
      await onRefresh();
      setTimeout(() => setScanStatus(null), 3000);
    }
  };

  return (
    <div className="gallery-container">
      <header className="gallery-header">
        <div className="header-content">
          <div>
            <h1>Il tuo archivio ({username})</h1>
            <p id="media-count">{mediaFiles.length} elementi cifrati</p>
          </div>

          <div className="header-actions">
            {mediaFiles.length > 0 && (
              <div className="grouping-controls btn outlined">
                <span className="material-icons">sort</span>
                <select
                  id="group-by-select"
                  className="btn-like-select"
                  aria-label="Raggruppa foto per data"
                  value={groupBy}
                  onChange={(e) =>
                    setGroupBy(e.target.value as 'none' | 'day' | 'month' | 'year')
                  }
                >
                  <option value="none">Nessun gruppo</option>
                  <option value="day">Per Giorno</option>
                  <option value="month">Per Mese</option>
                  <option value="year">Per Anno</option>
                </select>
              </div>
            )}

            {mediaFiles.length > 0 && (
              <button
                type="button"
                className="btn outlined"
                id="select-all-btn"
                title="Seleziona Tutto"
                onClick={handleSelectAll}
              >
                <span className="material-icons">select_all</span>
                <span className="btn-text">
                  {isAllSelected ? 'Deseleziona Tutto' : 'Seleziona Tutto'}
                </span>
              </button>
            )}

            {selectedFiles.size > 0 && (
              <>
                <button
                  type="button"
                  className="btn primary"
                  id="download-selected-btn"
                  title="Scarica Selezionati"
                  onClick={handleDownloadSelectedZip}
                >
                  <span className="material-icons">download</span>
                  <span className="btn-text">Scarica</span> (
                  <span id="selected-count">{selectedFiles.size}</span>)
                </button>
                <button
                  type="button"
                  className="btn danger"
                  id="delete-selected-btn"
                  title="Sposta Selezionati nel Cestino"
                  onClick={handleTrashSelected}
                >
                  <span className="material-icons">delete_sweep</span>
                  <span className="btn-text">Sposta nel Cestino</span>
                </button>
              </>
            )}

            <form className="upload-form" id="upload-form" onSubmit={(e) => e.preventDefault()}>
              <input
                ref={fileInputRef}
                type="file"
                id="file-input"
                name="file[]"
                accept="image/*,video/*"
                hidden
                multiple
                onChange={handleUploadChange}
              />
              <label htmlFor="file-input" className="btn outlined" id="upload-label">
                <span className="material-icons">add_photo_alternate</span>
                <span>Carica</span>
              </label>
            </form>

            <button
              type="button"
              className="btn outlined"
              id="find-duplicates-btn"
              title="Trova Duplicati"
              onClick={handleFindDuplicates}
            >
              <span className="material-icons">manage_search</span>
              <span className="btn-text">Duplicati</span>
            </button>

            <button
              type="button"
              className="btn primary"
              onClick={onOpenAndroidStudio}
              title="Android Release Studio (APK & AAB)"
            >
              <span className="material-icons">android</span>
              <span className="btn-text">Build Android Release</span>
            </button>

            <PWAInstallButton onOpenAndroidStudio={onOpenAndroidStudio} />

            <button
              type="button"
              className="btn icon badge-btn"
              title="Cestino"
              onClick={onOpenTrash}
              aria-label="Apri Cestino"
            >
              <span className="material-icons">delete_outline</span>
              {trashedCount > 0 && <span className="trash-badge">{trashedCount}</span>}
            </button>

            <button
              type="button"
              className="btn icon"
              id="theme-toggle-btn"
              title={darkMode ? 'Passa a tema chiaro' : 'Passa a tema scuro'}
              onClick={onToggleTheme}
              aria-label="Cambia tema chiaro o scuro"
            >
              <span className="material-icons">
                {darkMode ? 'dark_mode' : 'light_mode'}
              </span>
            </button>

            <button
              type="button"
              className="btn icon"
              id="logout-btn"
              title="Esci"
              onClick={onLogout}
              aria-label="Esci dall'account"
            >
              <span className="material-icons">logout</span>
            </button>
          </div>
        </div>

        {scanStatus && (
          <div id="scan-status-container" className="scan-status-container">
            <div id="scan-progress-details">
              <p id="scan-main-status">{scanStatus}</p>
              <progress id="scan-progress-bar" value={scanProgress} max={100} />
              {duplicateGroups && duplicateGroups.length > 0 && (
                <div className="duplicate-action-bar">
                  <span>
                    Vuoi spostare nel cestino le copie extra mantenendo un originale per gruppo?
                  </span>
                  <div className="duplicate-action-buttons">
                    <button
                      type="button"
                      className="btn danger"
                      onClick={handleConfirmRemoveDuplicates}
                    >
                      Sposta duplicati nel Cestino
                    </button>
                    <button
                      type="button"
                      className="btn outlined"
                      onClick={() => {
                        setDuplicateGroups(null);
                        setScanStatus(null);
                      }}
                    >
                      Annulla
                    </button>
                  </div>
                </div>
              )}
            </div>
          </div>
        )}
      </header>

      <div className="gallery-grid" data-testid="gallery-grid">
        {mediaFiles.length === 0 ? (
          <div className="empty-state">
            <span className="material-icons">photo_library</span>
            <h3>Il tuo archivio è vuoto</h3>
            <p>Carica foto o video per proteggerli con crittografia AES-256.</p>
          </div>
        ) : (
          groupedMedia.map((group, gIdx) => (
            <div key={group.title || gIdx} className="media-group" style={{ opacity: 1 }}>
              {group.title && <h2 className="group-title">{group.title}</h2>}
              <div className="media-group-grid">
                {group.items.map((media) => {
                  const globalIdx = allFilenames.indexOf(media.filename);
                  const isSelected = selectedFiles.has(media.filename);
                  const isVid = isVideoFilename(media.filename);

                  return (
                    <div
                      key={media.filename}
                      className={`media-card-wrapper ${isSelected ? 'selected' : ''}`}
                      data-timestamp={media.timestamp}
                      style={{ opacity: 1 }}
                    >
                      <div
                        className="media-card clickable-media"
                        onClick={() => onOpenLightbox(globalIdx, allFilenames)}
                      >
                        {isVid ? (
                          <>
                            <video preload="metadata">
                              <source
                                src={`/media/${encodeURIComponent(media.filename)}#t=0.5`}
                                type="video/mp4"
                              />
                            </video>
                            <div className="video-overlay">
                              <span className="material-icons">play_circle</span>
                            </div>
                          </>
                        ) : (
                          <img
                            src={`/media/${encodeURIComponent(media.filename)}`}
                            alt={media.filename}
                            loading="lazy"
                          />
                        )}
                        <div className="media-actions">
                          <button
                            type="button"
                            className="btn icon danger"
                            title="Sposta nel Cestino"
                            aria-label={`Sposta ${media.filename} nel cestino`}
                            onClick={(e) => handleTrashSingle(media.filename, e)}
                          >
                            <span className="material-icons">delete</span>
                          </button>
                        </div>
                      </div>
                      <div className="selection-overlay" />
                      <input
                        type="checkbox"
                        className="media-checkbox"
                        aria-label={`Seleziona ${media.filename}`}
                        checked={isSelected}
                        onChange={() => toggleSelectFile(media.filename)}
                        onClick={(e) => e.stopPropagation()}
                      />
                    </div>
                  );
                })}
              </div>
            </div>
          ))
        )}
      </div>

      {/* FLOATING UPLOAD GEM INDICATOR */}
      {uploadState.visible && (
        <div
          id="upload-indicator-container"
          className={`upload-indicator-container ${uploadState.expanded ? 'expanded' : ''}`}
        >
          <div
            id="upload-gem"
            className={`upload-gem ${uploadState.uploading ? 'is-uploading' : ''}`}
            onClick={() =>
              setUploadState((prev) => ({ ...prev, expanded: !prev.expanded }))
            }
          >
            <span id="upload-indicator-icon" className="material-icons">
              {uploadState.uploading ? 'upload' : 'check_circle'}
            </span>
            <span id="upload-indicator-percentage">
              {Math.round(uploadState.progress)}%
            </span>
          </div>

          <div id="upload-details-card" className="upload-details-card">
            <header className="upload-card-header">
              <h3 id="upload-card-title">{uploadState.title}</h3>
              <button
                type="button"
                id="upload-close-btn"
                className="btn icon"
                title="Chiudi"
                onClick={() =>
                  setUploadState((prev) => ({ ...prev, expanded: !prev.expanded }))
                }
              >
                <span className="material-icons">expand_more</span>
              </button>
            </header>
            <div className="upload-card-body">
              <ul id="upload-file-list" className="upload-file-list">
                {uploadState.files.map((f) => (
                  <li key={f.name} className="upload-file-item">
                    <span className="material-icons">description</span>
                    <div className="file-info">
                      <span className="file-name">{f.name}</span>
                      <span className="file-status completed">{f.status}</span>
                    </div>
                  </li>
                ))}
              </ul>
            </div>
            <footer className="upload-card-footer">
              <p id="upload-card-status">{uploadState.status}</p>
            </footer>
          </div>
        </div>
      )}
    </div>
  );
};
