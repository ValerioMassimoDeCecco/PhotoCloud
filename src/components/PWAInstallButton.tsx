import React, { useState } from 'react';
import { usePWAInstall, useOnlineStatus } from '../hooks/usePWAInstall';

interface PWAInstallButtonProps {
  onOpenAndroidStudio?: () => void;
}

export const PWAInstallButton: React.FC<PWAInstallButtonProps> = ({ onOpenAndroidStudio }) => {
  const { isInstallable, isInstalled, isIOS, install } = usePWAInstall();
  const [showGuideModal, setShowGuideModal] = useState(false);

  if (isInstalled) {
    return null;
  }

  return (
    <>
      {isInstallable ? (
        <button
          type="button"
          onClick={install}
          className="btn primary"
          title="Installa App su Android / Home Screen"
        >
          <span className="material-icons">install_mobile</span>
          <span className="btn-text">Installa App</span>
        </button>
      ) : (
        <button
          type="button"
          onClick={() => setShowGuideModal(true)}
          className="btn outlined"
          title="Installa come Web App o Scarica APK Android"
        >
          <span className="material-icons">android</span>
          <span className="btn-text">{isIOS ? 'Installa su iOS' : 'App Android / PWA'}</span>
        </button>
      )}

      {showGuideModal && (
        <div
          className="modal-backdrop"
          onClick={() => setShowGuideModal(false)}
          role="dialog"
          aria-modal="true"
          aria-labelledby="pwa-modal-title"
        >
          <div className="modal-card" onClick={(e) => e.stopPropagation()}>
            <div className="modal-header">
              <div className="modal-title-row">
                <span className="material-icons text-primary-icon">install_mobile</span>
                <h3 id="pwa-modal-title">Installa PhotoCloud su Android</h3>
              </div>
              <button
                type="button"
                className="btn icon"
                onClick={() => setShowGuideModal(false)}
                aria-label="Chiudi finestra installazione"
              >
                <span className="material-icons">close</span>
              </button>
            </div>

            <div className="modal-body">
              <div className="install-option-box">
                <h4>1. Pacchetto Release Android (.APK + Progetto Android Studio)</h4>
                <p>
                  Usa la scheda <strong>Android Release</strong> integrata per compilare e scaricare
                  il pacchetto <code>photocloud-release-v1.3.2-signed.apk</code> firmato o il
                  progetto completo Kotlin + Jetpack Compose pronto per Android Studio.
                </p>
                {onOpenAndroidStudio && (
                  <button
                    type="button"
                    className="btn primary"
                    onClick={() => {
                      setShowGuideModal(false);
                      onOpenAndroidStudio();
                    }}
                  >
                    <span className="material-icons">build_circle</span>
                    Apri Android Release Builder
                  </button>
                )}
              </div>

              <div className="install-option-box">
                <h4>2. Installazione Diretta PWA (Chrome per Android / iOS)</h4>
                <p>
                  Su Chrome per Android tocca il menu <strong>⋮</strong> in alto a destra e
                  seleziona <strong>Installa app</strong> o{' '}
                  <strong>Aggiungi a schermata Home</strong> per avviare PhotoCloud a schermo intero
                  (standalone).
                </p>
              </div>
            </div>
          </div>
        </div>
      )}
    </>
  );
};

export const OfflineIndicator: React.FC = () => {
  const isOnline = useOnlineStatus();

  if (isOnline) return null;

  return (
    <div className="offline-toast" role="status">
      <span className="material-icons">wifi_off</span>
      <span>Modalità Offline — I dati nella cache locale sono attivi.</span>
    </div>
  );
};
