import React, { useState } from 'react';
import { AuthFilePayload } from '../types';
import { PWAInstallButton } from './PWAInstallButton';

interface AuthViewProps {
  onAuthenticated: () => void;
  onOpenAndroidStudio: () => void;
}

export const AuthView: React.FC<AuthViewProps> = ({ onAuthenticated, onOpenAndroidStudio }) => {
  const [activeTab, setActiveTab] = useState<'login' | 'register'>('login');
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [registerUsername, setRegisterUsername] = useState('');
  const [keyType, setKeyType] = useState<'generate' | 'custom'>('generate');
  const [customKey, setCustomKey] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [registeredAuth, setRegisteredAuth] = useState<AuthFilePayload | null>(null);
  const [copiedKey, setCopiedKey] = useState(false);

  const handleLoginSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMessage(null);
    if (!selectedFile) {
      setErrorMessage('Seleziona un file di autenticazione JSON valido.');
      return;
    }

    setLoading(true);
    try {
      const formData = new FormData();
      formData.append('auth_file', selectedFile);
      const resp = await fetch('/login', {
        method: 'POST',
        headers: { Accept: 'application/json' },
        body: formData,
      });

      if (!resp.ok) {
        const text = await resp.text();
        setErrorMessage(text || 'Credenziali non valide.');
      } else {
        onAuthenticated();
      }
    } catch {
      setErrorMessage('Errore di comunicazione durante il login.');
    } finally {
      setLoading(false);
    }
  };

  const handleDemoLogin = async () => {
    setErrorMessage(null);
    setLoading(true);
    try {
      const resp = await fetch('/api/demo-login', { method: 'POST' });
      if (resp.ok) {
        onAuthenticated();
      } else {
        setErrorMessage('Impossibile avviare la sessione demo.');
      }
    } catch {
      setErrorMessage('Errore di rete.');
    } finally {
      setLoading(false);
    }
  };

  const handleRegisterSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMessage(null);
    const trimmed = registerUsername.trim();
    if (!trimmed) {
      setErrorMessage('Inserisci uno username valido.');
      return;
    }
    if (keyType === 'custom' && customKey.length < 8) {
      setErrorMessage('La chiave personalizzata deve avere almeno 8 caratteri.');
      return;
    }

    setLoading(true);
    try {
      const formData = new FormData();
      formData.append('username', trimmed);
      formData.append('key_type', keyType);
      if (keyType === 'custom') {
        formData.append('custom_key', customKey);
      }

      const resp = await fetch('/register', {
        method: 'POST',
        body: formData,
      });

      if (!resp.ok) {
        const errText = await resp.text();
        setErrorMessage(errText || 'Errore durante la registrazione.');
        return;
      }

      const authPayload: AuthFilePayload = await resp.json();
      setRegisteredAuth(authPayload);

      // Trigger automatic JSON download matching original main.py behavior
      const blob = new Blob([JSON.stringify(authPayload, null, 2)], {
        type: 'application/json',
      });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `photocloud_auth_${trimmed.replace(/[^a-zA-Z0-9_-]/g, '_')}.json`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    } catch {
      setErrorMessage('Errore durante la registrazione.');
    } finally {
      setLoading(false);
    }
  };

  const handleCopyKey = async () => {
    if (!registeredAuth) return;
    try {
      await navigator.clipboard.writeText(registeredAuth.api_key);
      setCopiedKey(true);
      setTimeout(() => setCopiedKey(false), 2000);
    } catch {
      // ignore clipboard errors
    }
  };

  if (registeredAuth) {
    return (
      <div className="key-display-container">
        <div className="key-card">
          <div className="key-header">
            <span className="material-icons">check_circle</span>
            <h1>Registrazione completata!</h1>
          </div>

          <div className="key-content">
            <div className="key-field">
              <label>Username</label>
              <div className="key-value">{registeredAuth.username}</div>
            </div>

            <div className="key-field">
              <label>Chiave API Crittografica</label>
              <div className="key-value" id="api-key">
                {registeredAuth.api_key}
              </div>
              <button
                type="button"
                className={`btn icon ${copiedKey ? 'copied' : ''}`}
                id="copy-btn"
                title="Copia chiave"
                onClick={handleCopyKey}
              >
                <span className="material-icons">
                  {copiedKey ? 'done' : 'content_copy'}
                </span>
              </button>
            </div>

            <div className="key-warning">
              <span className="material-icons">warning</span>
              <div>
                <p>
                  <strong>CONSERVA QUESTA CHIAVE CON CURA</strong>
                </p>
                <p>
                  Il file <code>photocloud_auth_{registeredAuth.username}.json</code> è stato
                  scaricato. Questa chiave è necessaria per decrittare i tuoi file.
                </p>
              </div>
            </div>
          </div>

          <div className="key-actions">
            <button
              type="button"
              className="btn primary"
              onClick={onAuthenticated}
            >
              Entra nella Galleria
            </button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="auth-container">
      <div className="auth-card">
        <div className="auth-header">
          <div className="auth-brand-badge">
            <span className="material-icons">cloud_done</span>
            <span>Android & Web Vault</span>
          </div>
          <h1>PhotoCloud</h1>
          <p>Il tuo archivio foto/video sicuro con crittografia AES-256</p>
        </div>

        <div className="auth-tabs" role="tablist">
          <button
            type="button"
            id="login-tab"
            role="tab"
            aria-selected={activeTab === 'login'}
            className={`auth-tab ${activeTab === 'login' ? 'active' : ''}`}
            onClick={() => {
              setActiveTab('login');
              setErrorMessage(null);
            }}
          >
            Accedi
          </button>
          <button
            type="button"
            id="register-tab"
            role="tab"
            aria-selected={activeTab === 'register'}
            className={`auth-tab ${activeTab === 'register' ? 'active' : ''}`}
            onClick={() => {
              setActiveTab('register');
              setErrorMessage(null);
            }}
          >
            Registrati
          </button>
        </div>

        {errorMessage && (
          <div className="auth-error-banner" role="alert">
            <span className="material-icons">error_outline</span>
            <span>{errorMessage}</span>
          </div>
        )}

        {activeTab === 'login' ? (
          <div id="login-form" className="auth-form active">
            <form id="actual-login-form" onSubmit={handleLoginSubmit}>
              <div className="form-group">
                <label htmlFor="auth-file-input">File di Autenticazione</label>
                <div className="file-upload-container">
                  <input
                    type="file"
                    id="auth-file-input"
                    name="auth_file"
                    accept=".json,.txt"
                    onChange={(e) => setSelectedFile(e.target.files?.[0] || null)}
                  />
                  <label htmlFor="auth-file-input" className="file-upload-label">
                    <span className="material-icons">
                      {selectedFile ? 'check_circle' : 'upload_file'}
                    </span>
                    <span id="file-upload-text">
                      {selectedFile ? selectedFile.name : 'Clicca per caricare il file'}
                    </span>
                  </label>
                </div>
                <p className="form-hint">
                  Carica il file <code>photocloud_auth_...json</code> scaricato durante la
                  registrazione.
                </p>
              </div>
              <button type="submit" className="btn primary" disabled={loading}>
                <span className="material-icons">login</span>
                {loading ? 'Verifica in corso...' : 'Accedi con File'}
              </button>
            </form>

            <div className="auth-divider">
              <span>oppure</span>
            </div>

            <div className="auth-quick-actions">
              <button
                type="button"
                className="btn outlined full-width-btn"
                onClick={handleDemoLogin}
                disabled={loading}
              >
                <span className="material-icons">smartphone</span>
                Accesso Rapido Demo Mobile (con foto cifrate)
              </button>

              <button
                type="button"
                className="btn outlined full-width-btn"
                onClick={onOpenAndroidStudio}
              >
                <span className="material-icons">android</span>
                Apri Android Release Builder (APK / AAB)
              </button>
            </div>
          </div>
        ) : (
          <div id="register-form" className="auth-form active">
            <form id="actual-register-form" onSubmit={handleRegisterSubmit}>
              <div className="form-group">
                <label htmlFor="register-username">Scegli username</label>
                <div className="input-container">
                  <span className="material-icons">person_add</span>
                  <input
                    type="text"
                    id="register-username"
                    name="username"
                    value={registerUsername}
                    onChange={(e) => setRegisterUsername(e.target.value)}
                    placeholder="es. valerio_mobile"
                    required
                    autoComplete="username"
                  />
                </div>
              </div>

              <div className="form-group">
                <label>Tipo di Chiave</label>
                <div className="radio-group">
                  <label>
                    <input
                      type="radio"
                      name="key_type"
                      value="generate"
                      checked={keyType === 'generate'}
                      onChange={() => setKeyType('generate')}
                    />
                    Genera una chiave sicura per me
                  </label>
                  <label>
                    <input
                      type="radio"
                      name="key_type"
                      value="custom"
                      checked={keyType === 'custom'}
                      onChange={() => setKeyType('custom')}
                    />
                    Voglio usare una chiave personalizzata
                  </label>
                </div>
              </div>

              {keyType === 'custom' && (
                <div className="form-group" id="custom-key-group">
                  <label htmlFor="register-custom-key">La tua chiave personalizzata</label>
                  <div className="input-container">
                    <span className="material-icons">password</span>
                    <input
                      type={showPassword ? 'text' : 'password'}
                      id="register-custom-key"
                      name="custom_key"
                      value={customKey}
                      onChange={(e) => setCustomKey(e.target.value)}
                      autoComplete="new-password"
                      minLength={8}
                      required
                    />
                    <button
                      type="button"
                      className="toggle-password-btn"
                      onClick={() => setShowPassword((prev) => !prev)}
                      aria-label="Mostra o nascondi chiave"
                    >
                      <span className="material-icons">
                        {showPassword ? 'visibility_off' : 'visibility'}
                      </span>
                    </button>
                  </div>
                  <p className="form-hint">
                    Usa una frase o una password con almeno 8 caratteri per la massima sicurezza.
                  </p>
                </div>
              )}

              <button type="submit" className="btn primary" disabled={loading}>
                <span className="material-icons">vpn_key</span>
                {loading ? 'Generazione chiave...' : 'Registrati e Scarica Chiave'}
              </button>
            </form>
          </div>
        )}
      </div>

      <div className="auth-footer">
        <p>I tuoi file sono protetti con crittografia end-to-end AES-256-CFB</p>
        <div style={{ marginTop: '12px', display: 'flex', justifyContent: 'center' }}>
          <PWAInstallButton onOpenAndroidStudio={onOpenAndroidStudio} />
        </div>
      </div>
    </div>
  );
};
