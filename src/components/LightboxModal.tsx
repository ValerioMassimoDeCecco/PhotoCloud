import React, { useEffect } from 'react';
import { isVideoFilename } from '../lib/grouping';

interface LightboxModalProps {
  isOpen: boolean;
  currentIndex: number;
  mediaFilenames: string[];
  fromTrash?: boolean;
  onClose: () => void;
  onNavigate: (newIndex: number) => void;
}

export const LightboxModal: React.FC<LightboxModalProps> = ({
  isOpen,
  currentIndex,
  mediaFilenames,
  fromTrash = false,
  onClose,
  onNavigate,
}) => {
  useEffect(() => {
    if (!isOpen) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'ArrowRight') {
        const next = (currentIndex + 1) % mediaFilenames.length;
        onNavigate(next);
      } else if (e.key === 'ArrowLeft') {
        const prev = (currentIndex - 1 + mediaFilenames.length) % mediaFilenames.length;
        onNavigate(prev);
      } else if (e.key === 'Escape') {
        onClose();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, currentIndex, mediaFilenames.length, onClose, onNavigate]);

  if (!isOpen || mediaFilenames.length === 0) return null;

  const filename = mediaFilenames[currentIndex] || mediaFilenames[0];
  const isVideo = isVideoFilename(filename);
  const mediaUrl = `/media/${encodeURIComponent(filename)}${fromTrash ? '?from_trash=true' : ''}`;

  const handlePrev = (e: React.MouseEvent) => {
    e.stopPropagation();
    const prev = (currentIndex - 1 + mediaFilenames.length) % mediaFilenames.length;
    onNavigate(prev);
  };

  const handleNext = (e: React.MouseEvent) => {
    e.stopPropagation();
    const next = (currentIndex + 1) % mediaFilenames.length;
    onNavigate(next);
  };

  return (
    <div
      id="lightbox"
      className="lightbox"
      style={{ display: 'flex' }}
      onClick={onClose}
      role="dialog"
      aria-modal="true"
      aria-label="Visualizzatore Media"
    >
      <div className="lightbox-content" onClick={(e) => e.stopPropagation()}>
        <button
          type="button"
          className="nav-btn prev-btn"
          onClick={handlePrev}
          aria-label="Media precedente"
        >
          <span className="material-icons">arrow_back</span>
        </button>

        <div className="media-container">
          {isVideo ? (
            <video id="lightbox-video" controls autoPlay style={{ display: 'block' }} key={mediaUrl}>
              <source src={mediaUrl} type="video/mp4" />
              Il tuo browser non supporta i video.
            </video>
          ) : (
            <img
              id="lightbox-img"
              src={mediaUrl}
              alt={filename}
              style={{ display: 'block' }}
            />
          )}
        </div>

        <button
          type="button"
          className="nav-btn next-btn"
          onClick={handleNext}
          aria-label="Media successivo"
        >
          <span className="material-icons">arrow_forward</span>
        </button>
      </div>

      <button
        type="button"
        className="close-btn"
        onClick={onClose}
        aria-label="Chiudi visualizzatore"
      >
        <span className="material-icons">close</span>
      </button>
    </div>
  );
};
