import React from 'react';
import { MediaItem } from '../types';
import { isVideoFilename } from '../lib/grouping';

interface TrashViewProps {
  trashedFiles: MediaItem[];
  onBackToGallery: () => void;
  onRefresh: () => Promise<void>;
}

export const TrashView: React.FC<TrashViewProps> = ({
  trashedFiles,
  onBackToGallery,
  onRefresh,
}) => {
  const handleRestore = async (filename: string) => {
    try {
      const resp = await fetch(`/restore/${encodeURIComponent(filename)}`, {
        method: 'POST',
        headers: { Accept: 'application/json' },
      });
      const result = await resp.json();
      if (result.success) {
        await onRefresh();
      }
    } catch {
      // ignore
    }
  };

  const handlePermanentDelete = async (filename: string) => {
    try {
      const resp = await fetch(`/delete_permanent/${encodeURIComponent(filename)}`, {
        method: 'POST',
        headers: { Accept: 'application/json' },
      });
      const result = await resp.json();
      if (result.success) {
        await onRefresh();
      }
    } catch {
      // ignore
    }
  };

  const handleEmptyTrash = async () => {
    try {
      const resp = await fetch('/empty_trash', {
        method: 'POST',
        headers: { Accept: 'application/json' },
      });
      const result = await resp.json();
      if (result.success) {
        await onRefresh();
      }
    } catch {
      // ignore
    }
  };

  return (
    <div className="gallery-container">
      <header className="gallery-header">
        <div className="header-content">
          <div>
            <h1>Cestino</h1>
            <p id="media-count">{trashedFiles.length} elementi</p>
          </div>
          <div className="header-actions">
            <button type="button" className="btn outlined" onClick={onBackToGallery}>
              <span className="material-icons">arrow_back</span>
              <span>Torna alla galleria</span>
            </button>
            {trashedFiles.length > 0 && (
              <button
                type="button"
                className="btn danger"
                id="empty-trash-btn"
                onClick={handleEmptyTrash}
              >
                <span className="material-icons">delete_sweep</span>
                <span>Svuota Cestino</span>
              </button>
            )}
          </div>
        </div>
      </header>

      <div className="gallery-grid">
        <div className="media-group" style={{ opacity: 1 }}>
          <div className="media-group-grid">
            {trashedFiles.length === 0 ? (
              <div className="empty-state">
                <span className="material-icons">delete_sweep</span>
                <h3>Il cestino è vuoto</h3>
                <p>I file eliminati appariranno qui.</p>
              </div>
            ) : (
              trashedFiles.map((media) => {
                const isVid = isVideoFilename(media.filename);
                return (
                  <div key={media.filename} className="media-card-wrapper" style={{ opacity: 1 }}>
                    <div className="media-card">
                      {isVid ? (
                        <video preload="metadata">
                          <source
                            src={`/media/${encodeURIComponent(media.filename)}?from_trash=true#t=0.5`}
                            type="video/mp4"
                          />
                        </video>
                      ) : (
                        <img
                          src={`/media/${encodeURIComponent(media.filename)}?from_trash=true`}
                          alt={media.filename}
                          loading="lazy"
                        />
                      )}
                      <div className="media-actions" style={{ opacity: 1 }}>
                        <button
                          type="button"
                          className="btn icon restore-btn"
                          title="Ripristina"
                          aria-label={`Ripristina ${media.filename}`}
                          onClick={() => handleRestore(media.filename)}
                        >
                          <span className="material-icons">restore_from_trash</span>
                        </button>
                        <button
                          type="button"
                          className="btn icon danger permanent-delete-btn"
                          title="Elimina Definitivamente"
                          aria-label={`Elimina definitivamente ${media.filename}`}
                          onClick={() => handlePermanentDelete(media.filename)}
                        >
                          <span className="material-icons">delete_forever</span>
                        </button>
                      </div>
                    </div>
                  </div>
                );
              })
            )}
          </div>
        </div>
      </div>
    </div>
  );
};
