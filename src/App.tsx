import React, { useEffect, useState, useCallback } from 'react';
import { MediaItem, AndroidReleaseArtifact } from './types';
import { AuthView } from './components/AuthView';
import { GalleryView } from './components/GalleryView';
import { TrashView } from './components/TrashView';
import { AndroidReleaseStudio } from './components/AndroidReleaseStudio';
import { LightboxModal } from './components/LightboxModal';
import { OfflineIndicator } from './components/PWAInstallButton';

type ActiveScreen = 'gallery' | 'trash' | 'android-release';

export function App() {
  const [authenticated, setAuthenticated] = useState<boolean>(false);
  const [username, setUsername] = useState<string>('');
  const [mediaFiles, setMediaFiles] = useState<MediaItem[]>([]);
  const [trashedFiles, setTrashedFiles] = useState<MediaItem[]>([]);
  const [releases, setReleases] = useState<AndroidReleaseArtifact[]>([]);
  const [activeScreen, setActiveScreen] = useState<ActiveScreen>('gallery');
  const [darkMode, setDarkMode] = useState<boolean>(() => {
    const saved = localStorage.getItem('theme');
    if (saved) return saved === 'dark';
    return true;
  });

  const [lightboxState, setLightboxState] = useState<{
    isOpen: boolean;
    index: number;
    filenames: string[];
  }>({
    isOpen: false,
    index: 0,
    filenames: [],
  });

  useEffect(() => {
    if (darkMode) {
      document.body.classList.add('dark-mode');
      localStorage.setItem('theme', 'dark');
    } else {
      document.body.classList.remove('dark-mode');
      localStorage.setItem('theme', 'light');
    }
  }, [darkMode]);

  const fetchSessionAndReleases = useCallback(async () => {
    try {
      const [sessResp, relResp] = await Promise.all([
        fetch('/api/session'),
        fetch('/api/android/releases'),
      ]);

      if (relResp.ok) {
        const relData = await relResp.json();
        setReleases(relData.releases || []);
      }

      if (sessResp.ok) {
        const sessData = await sessResp.json();
        if (sessData.authenticated) {
          setAuthenticated(true);
          setUsername(sessData.username);
          setMediaFiles(sessData.mediaFiles || []);
          setTrashedFiles(sessData.trashedFiles || []);
          return;
        }
      }

      // Support ?autostart=1 or automatic mobile preview session so the user immediately sees their local PhotoCloud Android app + release builder working
      const params = new URLSearchParams(window.location.search);
      if (params.get('login') !== '1') {
        const demoResp = await fetch('/api/demo-login', { method: 'POST' });
        if (demoResp.ok) {
          const demoData = await demoResp.json();
          setAuthenticated(true);
          setUsername(demoData.username);
          setMediaFiles(demoData.mediaFiles || []);
          setTrashedFiles(demoData.trashedFiles || []);
        }
      }
    } catch {
      // ignore network error
    }
  }, []);

  useEffect(() => {
    fetchSessionAndReleases();
  }, [fetchSessionAndReleases]);

  const handleLogout = async () => {
    await fetch('/logout', {
      method: 'POST',
      headers: { Accept: 'application/json' },
    });
    setAuthenticated(false);
    setUsername('');
    setMediaFiles([]);
    setTrashedFiles([]);
  };

  const handleBuildSuccess = (artifact: AndroidReleaseArtifact) => {
    setReleases((prev) => [artifact, ...prev]);
  };

  return (
    <div className="app-shell">
      <main className="container">
        {activeScreen === 'android-release' ? (
          <AndroidReleaseStudio
            releases={releases}
            onBuildSuccess={handleBuildSuccess}
            onBackToGallery={() => setActiveScreen('gallery')}
          />
        ) : !authenticated ? (
          <AuthView
            onAuthenticated={fetchSessionAndReleases}
            onOpenAndroidStudio={() => setActiveScreen('android-release')}
          />
        ) : activeScreen === 'trash' ? (
          <TrashView
            trashedFiles={trashedFiles}
            onBackToGallery={() => setActiveScreen('gallery')}
            onRefresh={fetchSessionAndReleases}
          />
        ) : (
          <GalleryView
            username={username}
            mediaFiles={mediaFiles}
            trashedCount={trashedFiles.length}
            darkMode={darkMode}
            onToggleTheme={() => setDarkMode((d) => !d)}
            onRefresh={fetchSessionAndReleases}
            onOpenTrash={() => setActiveScreen('trash')}
            onOpenAndroidStudio={() => setActiveScreen('android-release')}
            onLogout={handleLogout}
            onOpenLightbox={(index, filenames) =>
              setLightboxState({ isOpen: true, index, filenames })
            }
          />
        )}
      </main>

      {/* BARRA DI NAVIGAZIONE INFERIORE ANDROID (Bottom Navigation Bar) */}
      <nav className="android-bottom-nav" aria-label="Navigazione Principale Android">
        <button
          type="button"
          className={`android-nav-item ${
            authenticated && activeScreen === 'gallery' ? 'active' : ''
          }`}
          onClick={() => setActiveScreen('gallery')}
        >
          <span className="material-icons">photo_library</span>
          <span>Galleria</span>
        </button>

        <button
          type="button"
          className={`android-nav-item ${
            authenticated && activeScreen === 'trash' ? 'active' : ''
          }`}
          onClick={() => {
            if (!authenticated) {
              fetchSessionAndReleases().then(() => setActiveScreen('trash'));
            } else {
              setActiveScreen('trash');
            }
          }}
        >
          <span className="material-icons">delete_outline</span>
          <span>Cestino ({trashedFiles.length})</span>
        </button>

        <button
          type="button"
          className={`android-nav-item ${
            activeScreen === 'android-release' ? 'active' : ''
          }`}
          onClick={() => setActiveScreen('android-release')}
        >
          <span className="material-icons">android</span>
          <span>Release APK</span>
        </button>
      </nav>

      <LightboxModal
        isOpen={lightboxState.isOpen}
        currentIndex={lightboxState.index}
        mediaFilenames={lightboxState.filenames}
        onClose={() => setLightboxState((prev) => ({ ...prev, isOpen: false }))}
        onNavigate={(newIndex) =>
          setLightboxState((prev) => ({ ...prev, index: newIndex }))
        }
      />

      <OfflineIndicator />
    </div>
  );
}
export default App;
