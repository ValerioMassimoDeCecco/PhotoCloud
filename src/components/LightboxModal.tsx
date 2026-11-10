import React, { useEffect, useState, useRef, useCallback } from 'react';
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
  const [animClass, setAnimClass] = useState<'lightbox-animate-next-in' | 'lightbox-animate-prev-in' | 'lightbox-animate-dismiss' | 'lightbox-spring-reset' | ''>('');
  const [dragOffset, setDragOffset] = useState<{ x: number; y: number }>({ x: 0, y: 0 });
  const [isDragging, setIsDragging] = useState(false);

  const dragStartRef = useRef<{ x: number; y: number } | null>(null);
  const hasMovedRef = useRef(false);

  const navigateWithAnimation = useCallback(
    (direction: 'next' | 'prev') => {
      if (mediaFilenames.length <= 1) return;
      const step = direction === 'next' ? 1 : -1;
      const target = (currentIndex + step + mediaFilenames.length) % mediaFilenames.length;

      setAnimClass(direction === 'next' ? 'lightbox-animate-next-in' : 'lightbox-animate-prev-in');
      setDragOffset({ x: 0, y: 0 });
      onNavigate(target);
    },
    [currentIndex, mediaFilenames.length, onNavigate]
  );

  useEffect(() => {
    if (!isOpen) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'ArrowRight') {
        navigateWithAnimation('next');
      } else if (e.key === 'ArrowLeft') {
        navigateWithAnimation('prev');
      } else if (e.key === 'Escape') {
        onClose();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, navigateWithAnimation, onClose]);

  // Clear animation class after transition finishes
  useEffect(() => {
    if (!animClass) return;
    const timer = setTimeout(() => {
      setAnimClass('');
    }, 320);
    return () => clearTimeout(timer);
  }, [animClass, currentIndex]);

  if (!isOpen || mediaFilenames.length === 0) return null;

  const filename = mediaFilenames[currentIndex] || mediaFilenames[0];
  const isVideo = isVideoFilename(filename);
  const mediaUrl = `/media/${encodeURIComponent(filename)}${fromTrash ? '?from_trash=true' : ''}`;

  const handlePrev = (e: React.MouseEvent) => {
    e.stopPropagation();
    navigateWithAnimation('prev');
  };

  const handleNext = (e: React.MouseEvent) => {
    e.stopPropagation();
    navigateWithAnimation('next');
  };

  // --- GESTURE DRAG / SWIPE HANDLERS ---
  const handlePointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    const target = e.target as HTMLElement;
    if (target.closest('.nav-btn') || target.closest('.close-btn') || target.closest('.lightbox-counter-badge')) {
      return;
    }
    dragStartRef.current = { x: e.clientX, y: e.clientY };
    hasMovedRef.current = false;
    setIsDragging(true);
    setAnimClass('');
  };

  const handlePointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!dragStartRef.current) return;
    const dx = e.clientX - dragStartRef.current.x;
    const dy = e.clientY - dragStartRef.current.y;

    if (!hasMovedRef.current && Math.hypot(dx, dy) > 6) {
      hasMovedRef.current = true;
    }

    if (!hasMovedRef.current) return;

    // Check if dragging down for dismiss
    if (dy > 20 && dy > Math.abs(dx) * 1.1) {
      setDragOffset({ x: 0, y: Math.min(dy, 320) });
    } else {
      // Horizontal swipe navigation
      setDragOffset({ x: dx, y: 0 });
    }
  };

  const handlePointerUpOrCancel = () => {
    if (!dragStartRef.current) return;
    const dx = dragOffset.x;
    const dy = dragOffset.y;
    dragStartRef.current = null;
    setIsDragging(false);

    if (!hasMovedRef.current) {
      setDragOffset({ x: 0, y: 0 });
      return;
    }

    // 1. Swipe down to dismiss threshold
    if (dy > 80) {
      setAnimClass('lightbox-animate-dismiss');
      setTimeout(() => {
        setDragOffset({ x: 0, y: 0 });
        onClose();
      }, 240);
      return;
    }

    // 2. Horizontal navigation threshold crossed
    if (Math.abs(dx) > 48) {
      if (dx < 0) {
        navigateWithAnimation('next');
      } else {
        navigateWithAnimation('prev');
      }
      return;
    }

    // 3. Below threshold: snap back with spring
    setAnimClass('lightbox-spring-reset');
    setDragOffset({ x: 0, y: 0 });
  };

  // Compute transform and opacity during active dragging
  const isDismissDrag = dragOffset.y > 0;
  const currentScale = isDismissDrag
    ? 1 - Math.min(dragOffset.y / 1000, 0.15)
    : 1 - Math.min(Math.abs(dragOffset.x) / 1400, 0.08);

  const mediaTransform = isDragging || dragOffset.x !== 0 || dragOffset.y !== 0
    ? `translate3d(${dragOffset.x}px, ${dragOffset.y}px, 0) scale(${currentScale})`
    : undefined;

  const backdropOpacity = isDismissDrag
    ? Math.max(0.4, 0.94 - dragOffset.y / 500)
    : 0.94;

  return (
    <div
      id="lightbox"
      className="lightbox"
      style={{
        display: 'flex',
        backgroundColor: `rgba(0, 0, 0, ${backdropOpacity})`,
      }}
      onClick={onClose}
      role="dialog"
      aria-modal="true"
      aria-label="Visualizzatore Media"
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={handlePointerUpOrCancel}
      onPointerCancel={handlePointerUpOrCancel}
    >
      <div className="lightbox-counter-badge">
        {currentIndex + 1} / {mediaFilenames.length}
      </div>

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
            <video
              id="lightbox-video"
              controls
              autoPlay
              style={{
                display: 'block',
                transform: mediaTransform,
              }}
              className={`lightbox-media-draggable ${animClass}`}
              key={mediaUrl}
            >
              <source src={mediaUrl} type="video/mp4" />
              Il tuo browser non supporta i video.
            </video>
          ) : (
            <img
              id="lightbox-img"
              src={mediaUrl}
              alt={filename}
              style={{
                display: 'block',
                transform: mediaTransform,
              }}
              className={`lightbox-media-draggable ${animClass}`}
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

      <div className="lightbox-gesture-hint">
        <span className="material-icons" style={{ fontSize: '15px' }}>swipe</span>
        <span>Scorri per navigare • Trascina in basso per chiudere</span>
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

