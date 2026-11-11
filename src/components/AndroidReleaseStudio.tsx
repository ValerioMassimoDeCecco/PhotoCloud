import React, { useState } from 'react';
import { AndroidBuildConfig, AndroidReleaseArtifact } from '../types';
import {
  generateAndroidManifestXml,
  generateAppBuildGradleKts,
  generateMainActivityKt,
} from '../lib/androidBuilder';

interface AndroidReleaseStudioProps {
  releases: AndroidReleaseArtifact[];
  onBuildSuccess: (artifact: AndroidReleaseArtifact) => void;
  onBackToGallery: () => void;
}

export const AndroidReleaseStudio: React.FC<AndroidReleaseStudioProps> = ({
  releases,
  onBuildSuccess,
  onBackToGallery,
}) => {
  const [config, setConfig] = useState<AndroidBuildConfig>({
    appName: 'PhotoCloud',
    packageName: 'com.valerio.photocloud',
    versionName: '1.2.7',
    versionCode: 24,
    serverUrl: typeof window !== 'undefined' ? window.location.origin : 'http://10.0.2.2:3000',
    minSdk: 26,
    targetSdk: 35,
    enableBiometricLock: true,
    enableOfflineCache: true,
    enableAutoBackup: false,
    signingMode: 'release',
    keystoreAlias: 'photocloud-release-key',
  });

  const [isBuilding, setIsBuilding] = useState(false);
  const [buildStepIndex, setBuildStepIndex] = useState<number>(-1);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [activeCodeTab, setActiveCodeTab] = useState<'gradle' | 'manifest' | 'kotlin'>('gradle');

  const latestRelease = releases[0] || null;

  const handleBuildRelease = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMessage(null);
    setIsBuilding(true);
    setBuildStepIndex(0);

    const stepTimer1 = setTimeout(() => setBuildStepIndex(1), 250);
    const stepTimer2 = setTimeout(() => setBuildStepIndex(2), 500);
    const stepTimer3 = setTimeout(() => setBuildStepIndex(3), 750);

    try {
      const resp = await fetch('/api/android/build-release', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(config),
      });

      const data = await resp.json();
      if (!resp.ok || !data.success) {
        setErrorMessage(data.error || 'Errore durante la compilazione della release Android.');
      } else {
        onBuildSuccess(data.artifact);
        // Increment version code for next build convenience
        setConfig((prev) => ({
          ...prev,
          versionCode: prev.versionCode + 1,
        }));
      }
    } catch {
      setErrorMessage('Errore di comunicazione con il builder Android.');
    } finally {
      clearTimeout(stepTimer1);
      clearTimeout(stepTimer2);
      clearTimeout(stepTimer3);
      setIsBuilding(false);
      setBuildStepIndex(-1);
    }
  };

  return (
    <div className="gallery-container">
      <header className="gallery-header">
        <div className="header-content">
          <div>
            <div className="studio-badge-row">
              <span className="material-icons studio-android-icon">android</span>
              <h1>Android App & Release Builder</h1>
            </div>
            <p>
              Configura il pacchetto nativo Android (Kotlin + Jetpack Compose + WebView AES-256) e
              compila la build firmata <code>assembleRelease</code>.
            </p>
          </div>
          <div className="header-actions">
            <button type="button" className="btn outlined" onClick={onBackToGallery}>
              <span className="material-icons">photo_library</span>
              <span>Torna alla Galleria</span>
            </button>
          </div>
        </div>
      </header>

      <div className="android-studio-grid">
        {/* COLONNA SINISTRA: CONFIGURAZIONE & BUILD */}
        <section className="studio-panel">
          <div className="studio-panel-header">
            <span className="material-icons">tune</span>
            <h2>Configurazione Release Android</h2>
          </div>

          {errorMessage && (
            <div className="auth-error-banner" role="alert">
              <span className="material-icons">error</span>
              <span>{errorMessage}</span>
            </div>
          )}

          <form onSubmit={handleBuildRelease} className="studio-form">
            <div className="studio-form-row">
              <div className="form-group">
                <label htmlFor="android-app-name">Nome App Android</label>
                <input
                  id="android-app-name"
                  type="text"
                  className="studio-input"
                  value={config.appName}
                  onChange={(e) => setConfig({ ...config, appName: e.target.value })}
                  required
                />
              </div>

              <div className="form-group">
                <label htmlFor="android-package-name">Application ID / Package Name</label>
                <input
                  id="android-package-name"
                  type="text"
                  className="studio-input"
                  value={config.packageName}
                  onChange={(e) => setConfig({ ...config, packageName: e.target.value })}
                  required
                />
              </div>
            </div>

            <div className="studio-form-row">
              <div className="form-group">
                <label htmlFor="android-version-name">Version Name (SemVer)</label>
                <input
                  id="android-version-name"
                  type="text"
                  className="studio-input"
                  value={config.versionName}
                  onChange={(e) => setConfig({ ...config, versionName: e.target.value })}
                  required
                />
              </div>

              <div className="form-group">
                <label htmlFor="android-version-code">Version Code</label>
                <input
                  id="android-version-code"
                  type="number"
                  min={1}
                  className="studio-input"
                  value={config.versionCode}
                  onChange={(e) =>
                    setConfig({ ...config, versionCode: parseInt(e.target.value, 10) || 1 })
                  }
                  required
                />
              </div>
            </div>

            <div className="studio-form-row">
              <div className="form-group">
                <label htmlFor="android-server-url">Endpoint Server PhotoCloud</label>
                <input
                  id="android-server-url"
                  type="text"
                  className="studio-input"
                  value={config.serverUrl}
                  onChange={(e) => setConfig({ ...config, serverUrl: e.target.value })}
                  required
                />
              </div>

              <div className="form-group">
                <label htmlFor="android-keystore-alias">Keystore Alias (Firma V2/V3)</label>
                <input
                  id="android-keystore-alias"
                  type="text"
                  className="studio-input"
                  value={config.keystoreAlias}
                  onChange={(e) => setConfig({ ...config, keystoreAlias: e.target.value })}
                  required
                />
              </div>
            </div>

            <div className="studio-toggles">
              <label className="studio-checkbox-label">
                <input
                  type="checkbox"
                  checked={config.enableBiometricLock}
                  onChange={(e) =>
                    setConfig({ ...config, enableBiometricLock: e.target.checked })
                  }
                />
                <span>Sblocco Biometrico Impronta / Volto (AndroidX Biometric)</span>
              </label>

              <label className="studio-checkbox-label">
                <input
                  type="checkbox"
                  checked={config.enableOfflineCache}
                  onChange={(e) =>
                    setConfig({ ...config, enableOfflineCache: e.target.checked })
                  }
                />
                <span>Cache Offline Crittografata & Service Worker</span>
              </label>

              <label className="studio-checkbox-label">
                <input
                  type="checkbox"
                  checked={config.enableAutoBackup}
                  onChange={(e) => setConfig({ ...config, enableAutoBackup: e.target.checked })}
                />
                <span>Consenti Auto-Backup Cloud di Sistema Android</span>
              </label>
            </div>

            <button
              type="submit"
              id="build-release-btn"
              className="btn primary build-cta-btn"
              disabled={isBuilding}
            >
              <span className="material-icons">
                {isBuilding ? 'hourglass_top' : 'rocket_launch'}
              </span>
              <span>
                {isBuilding
                  ? 'Compilazione Release in corso (:app:assembleRelease)...'
                  : `Builda Release Android (v${config.versionName})`}
              </span>
            </button>
          </form>

          {isBuilding && (
            <div className="build-progress-box" role="status">
              <p className="build-progress-title">
                Esecuzione pipeline Gradle Release... (Step {buildStepIndex + 1}/4)
              </p>
              <progress value={(buildStepIndex + 1) * 25} max={100} id="scan-progress-bar" />
            </div>
          )}
        </section>

        {/* COLONNA DESTRA: ARTEFATTI RELEASE & CODICE SORGENTE NATIVO */}
        <section className="studio-panel">
          <div className="studio-panel-header">
            <span className="material-icons">verified</span>
            <h2>Release Compilata & Artefatti Pronti</h2>
          </div>

          {latestRelease && (
            <div className="release-artifact-card" data-testid="latest-release-card">
              <div className="artifact-top-row">
                <div>
                  <span className="release-status-pill">
                    <span className="material-icons">check_circle</span>
                    RELEASE SIGNED (V2/V3)
                  </span>
                  <h3>
                    {latestRelease.config.appName} v{latestRelease.config.versionName} (build #
                    {latestRelease.config.versionCode})
                  </h3>
                  <p className="artifact-meta">
                    Package: <code>{latestRelease.config.packageName}</code> • Build ID:{' '}
                    <code>{latestRelease.buildId}</code>
                  </p>
                </div>
              </div>

              <div className="fingerprint-box">
                <span className="fingerprint-label">Certificato SHA-256 (V2/V3 APK Signature):</span>
                <code className="fingerprint-value">{latestRelease.sha256Fingerprint}</code>
              </div>

              <div className="pipeline-steps-list">
                {latestRelease.steps.map((step) => (
                  <div key={step.id} className="pipeline-step-item">
                    <span className="material-icons step-ok-icon">task_alt</span>
                    <div className="step-info">
                      <strong>{step.label}</strong>
                      <code>{step.command}</code>
                    </div>
                    <span className="step-duration">{step.durationMs} ms</span>
                  </div>
                ))}
              </div>

              <div className="artifact-download-actions">
                <a
                  href={`/api/android/download/${latestRelease.buildId}/apk`}
                  download={latestRelease.apkFilename}
                  className="btn primary"
                >
                  <span className="material-icons">download</span>
                  <span>Scarica APK Release ({latestRelease.apkFilename})</span>
                </a>

                <a
                  href={`/api/android/download/${latestRelease.buildId}/project`}
                  download={latestRelease.projectZipFilename}
                  className="btn outlined"
                >
                  <span className="material-icons">folder_zip</span>
                  <span>Scarica Progetto Android Studio (.ZIP)</span>
                </a>
              </div>
            </div>
          )}

          <div className="code-inspector-section">
            <div className="code-tabs">
              <button
                type="button"
                className={`code-tab-btn ${activeCodeTab === 'gradle' ? 'active' : ''}`}
                onClick={() => setActiveCodeTab('gradle')}
              >
                app/build.gradle.kts
              </button>
              <button
                type="button"
                className={`code-tab-btn ${activeCodeTab === 'manifest' ? 'active' : ''}`}
                onClick={() => setActiveCodeTab('manifest')}
              >
                AndroidManifest.xml
              </button>
              <button
                type="button"
                className={`code-tab-btn ${activeCodeTab === 'kotlin' ? 'active' : ''}`}
                onClick={() => setActiveCodeTab('kotlin')}
              >
                MainActivity.kt
              </button>
            </div>
            <pre className="code-preview-box">
              <code>
                {activeCodeTab === 'gradle' && generateAppBuildGradleKts(config)}
                {activeCodeTab === 'manifest' && generateAndroidManifestXml(config)}
                {activeCodeTab === 'kotlin' && generateMainActivityKt(config)}
              </code>
            </pre>
          </div>
        </section>
      </div>
    </div>
  );
};
