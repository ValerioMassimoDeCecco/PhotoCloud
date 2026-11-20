import {
  ZkVaultClient,
  evaluatePassphraseStrength,
  generateUuidV4,
  isSafeRasterImageMime,
  isSvgMime,
  isUntrustedActiveMime,
  parseClientDocumentPreview,
  zeroize,
  type AuthConfigV2,
  type DecryptedItemV2,
  type KdfPinningStore,
  type OpenedShareV2,
  type OwnerShareSummaryV2,
  type PinnedKdfRecord,
  type TimelineGroupModeV2,
  type VaultDetailedStatsV2,
  type ZkKeyFileV2,
} from '../zk-sdk/index.ts';
import { formatCoordinates, isValidGpsCoord } from '../../lib/gpsMapClustering.ts';
import { renderGpsMapView } from './gpsMapView.ts';
import { openPhotoEditorModal } from './photoEditorModal.ts';
import { openCreateShareModal, renderSharesManagementView } from './sharesView.ts';

class BrowserLocalStoragePinStore implements KdfPinningStore {
  private readonly prefix = 'pc_v2_kdf_pin_';

  public get(username: string): PinnedKdfRecord | null {
    try {
      const raw = window.localStorage.getItem(this.prefix + username.trim().toLowerCase());
      if (!raw) return null;
      return JSON.parse(raw) as PinnedKdfRecord;
    } catch {
      return null;
    }
  }

  public set(record: PinnedKdfRecord): void {
    try {
      window.localStorage.setItem(
        this.prefix + record.username.trim().toLowerCase(),
        JSON.stringify(record)
      );
    } catch {
      // ignore storage quota errors
    }
  }
}

function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  className?: string,
  text?: string
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  const i = Math.min(units.length - 1, Math.floor(Math.log(bytes) / Math.log(1024)));
  const val = bytes / Math.pow(1024, i);
  return `${val.toFixed(i === 0 ? 0 : 1)} ${units[i]}`;
}

function triggerDownload(bytes: Uint8Array, filename: string, mime = 'application/octet-stream'): void {
  const blob = new Blob([bytes as unknown as BlobPart], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  setTimeout(() => URL.revokeObjectURL(url), 5000);
}

async function registerVideoStreamTicketInSw(ticket: {
  blobId: string;
  fileKey: Uint8Array;
  headerBytes: Uint8Array;
  totalCiphertextBytes: number;
  mime: string;
}): Promise<boolean> {
  if (!('serviceWorker' in navigator)) return false;
  try {
    const reg = await navigator.serviceWorker.ready;
    const targetSw = navigator.serviceWorker.controller || reg.active;
    if (!targetSw) return false;

    return await new Promise<boolean>((resolve) => {
      const channel = new MessageChannel();
      const timer = setTimeout(() => resolve(false), 3000);
      channel.port1.onmessage = (ev) => {
        clearTimeout(timer);
        resolve(Boolean(ev.data && ev.data.ok));
      };
      targetSw.postMessage(
        {
          type: 'REGISTER_STREAM_KEY',
          blobId: ticket.blobId,
          fileKey: ticket.fileKey,
          headerBytes: ticket.headerBytes,
          totalCiphertextBytes: ticket.totalCiphertextBytes,
          mime: ticket.mime,
        },
        [channel.port2]
      );
    });
  } catch {
    return false;
  }
}

async function generateBrowserImageThumbs(
  file: File
): Promise<{ width?: number; height?: number; thumb320?: Uint8Array; thumb1280?: Uint8Array }> {
  if (!isSafeRasterImageMime(file.type) || typeof createImageBitmap !== 'function') {
    return {};
  }
  try {
    const bmp = await createImageBitmap(file);
    const width = bmp.width;
    const height = bmp.height;

    const renderResized = async (maxEdge: number): Promise<Uint8Array | undefined> => {
      const scale = Math.min(1, maxEdge / Math.max(width, height));
      const w = Math.max(1, Math.round(width * scale));
      const h = Math.max(1, Math.round(height * scale));
      const canvas = document.createElement('canvas');
      canvas.width = w;
      canvas.height = h;
      const ctx = canvas.getContext('2d');
      if (!ctx) return undefined;
      ctx.drawImage(bmp, 0, 0, w, h);
      const blob = await new Promise<Blob | null>((resolve) =>
        canvas.toBlob((b) => resolve(b), 'image/jpeg', 0.82)
      );
      if (!blob) return undefined;
      return new Uint8Array(await blob.arrayBuffer());
    };

    const thumb320 = await renderResized(320);
    const thumb1280 = await renderResized(1280);
    bmp.close();
    return { width, height, thumb320, thumb1280 };
  } catch {
    return {};
  }
}

type WorkspaceView = 'gallery' | 'albums' | 'map' | 'shares' | 'trash' | 'security';

export function initZkWebApp(): void {
  const rootEl = document.getElementById('zk-app-root');
  if (!rootEl) return;

  const activeObjectUrls = new Set<string>();
  const registerObjectUrl = (blob: Blob): string => {
    const u = URL.createObjectURL(blob);
    activeObjectUrls.add(u);
    return u;
  };
  const revokeAllObjectUrls = () => {
    for (const u of activeObjectUrls) {
      URL.revokeObjectURL(u);
    }
    activeObjectUrls.clear();
  };

  let authConfig: AuthConfigV2 = {
    registrationOpen: true,
    requiresInviteToken: false,
    policy: 'open',
  };
  let authTab: 'login' | 'register' | 'recovery' = 'login';
  let regKeyMode: 'generated' | 'passphrase' = 'generated';
  let bannerMessage: { type: 'error' | 'warning' | 'success'; text: string } | null = null;

  let currentView: WorkspaceView = 'gallery';
  let selectedAlbumId: string | null = null;
  let cachedStats: VaultDetailedStatsV2 | null = null;
  let groupMode: TimelineGroupModeV2 = 'day';
  let searchQuery = '';
  let includeGpsOnUpload = false;
  let mapFocusCoords: { lat: number; lon: number } | null = null;

  // Multi-select state
  let selectionMode = false;
  const selectedIds = new Set<string>();
  let lastClickedItemId: string | null = null;
  let renderedOrderIds: string[] = [];
  let confirmBatchPermanentDelete = false;

  // Shares management state
  let ownerShares: OwnerShareSummaryV2[] = [];
  let sharesLoading = false;

  // Auth & modal state
  let loadedKeyFile: ZkKeyFileV2 | null = null;
  let lastGeneratedKeyFile: { keyFile: ZkKeyFileV2; fileName: string } | null = null;
  let lastCreatedShare: { shareId: string; shareUrl: string } | null = null;
  let selectedLightboxItem: DecryptedItemV2 | null = null;
  let activeModalCleanup: (() => void) | null = null;

  const closeActiveOverlayModal = () => {
    if (activeModalCleanup) {
      activeModalCleanup();
      activeModalCleanup = null;
    }
  };

  const client = new ZkVaultClient({
    pinningStore: new BrowserLocalStoragePinStore(),
    onAutoLock: () => {
      closeActiveOverlayModal();
      revokeAllObjectUrls();
      selectedIds.clear();
      selectionMode = false;
      if (navigator.serviceWorker?.controller) {
        navigator.serviceWorker.controller.postMessage({ type: 'LOCK_ALL_KEYS' });
      }
      bannerMessage = {
        type: 'warning',
        text: 'Il vault è stato bloccato automaticamente per inattività.',
      };
      render();
    },
    onKdfParamsChangedWarning: (info) => {
      bannerMessage = {
        type: 'warning',
        text: `Attenzione: i parametri KDF o il salt per ${info.username} sono cambiati rispetto all'ultimo accesso.`,
      };
    },
  });

  if ('serviceWorker' in navigator && window.location.pathname.startsWith('/v2')) {
    navigator.serviceWorker.register('/v2/sw-stream.js', { scope: '/v2' }).catch(() => {});
  }

  const shareMatch = /^\/v2\/share\/([0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12})/i.exec(
    window.location.pathname
  );
  if (shareMatch) {
    renderPublicShareApp(rootEl, client, shareMatch[1]);
    return;
  }

  // Load server auth configuration (open vs invite-only)
  client
    .getAuthConfig()
    .then((cfg) => {
      authConfig = cfg;
      if (!cfg.registrationOpen && authTab === 'register') {
        authTab = 'login';
      }
      if (!client.isUnlocked()) {
        render();
      }
    })
    .catch(() => {});

  const refreshOwnerShares = () => {
    sharesLoading = true;
    render();
    client
      .listOwnerShares(window.location.origin)
      .then((list) => {
        ownerShares = list;
        sharesLoading = false;
        render();
      })
      .catch((err) => {
        sharesLoading = false;
        bannerMessage = {
          type: 'error',
          text: err instanceof Error ? err.message : 'Errore caricamento condivisioni.',
        };
        render();
      });
  };

  const clearSelection = () => {
    selectedIds.clear();
    selectionMode = false;
    lastClickedItemId = null;
    confirmBatchPermanentDelete = false;
  };

  const switchView = (next: WorkspaceView) => {
    currentView = next;
    selectedAlbumId = null;
    clearSelection();
    if (next === 'albums') {
      client.getAlbums().then(() => render()).catch(() => render());
      return;
    }
    if (next === 'shares') {
      refreshOwnerShares();
      return;
    }
    if (next === 'security') {
      client
        .getStats()
        .then((st) => {
          cachedStats = st;
          render();
        })
        .catch(() => render());
      return;
    }
    render();
  };

  function render(): void {
    rootEl!.textContent = '';

    // 3-zone single-row header
    const header = el('header', 'app-header');
    const brandGroup = el('div', 'brand-group');
    brandGroup.appendChild(el('span', 'brand-title', 'PhotoCloud'));
    const statusDot = el('span', `header-status-line ${client.isUnlocked() ? 'unlocked' : ''}`);
    statusDot.id = 'e2ee-status-badge';
    statusDot.appendChild(el('span', `status-dot ${client.isUnlocked() ? 'status-dot-active' : ''}`));
    statusDot.appendChild(
      el('span', '', client.isUnlocked() ? `E2EE · ${client.getUsername() ?? ''}` : 'Zero-Knowledge E2EE')
    );
    brandGroup.appendChild(statusDot);
    header.appendChild(brandGroup);

    const actions = el('div', 'header-actions');

    if (client.isUnlocked()) {
      const currentKeyFile = lastGeneratedKeyFile?.keyFile ?? client.exportCurrentKeyFile();
      if (currentKeyFile) {
        const dlKeyBtn = el('button', 'btn btn-ghost', 'Keyfile JSON');
        dlKeyBtn.id = 'btn-download-keyfile';
        dlKeyBtn.title = 'Scarica il tuo Keyfile JSON cifrato';
        dlKeyBtn.addEventListener('click', () => {
          const jsonStr = JSON.stringify(currentKeyFile, null, 2);
          dlKeyBtn.dataset.lastDownloadedJson = jsonStr;
          const bytes = new TextEncoder().encode(jsonStr);
          triggerDownload(
            bytes,
            lastGeneratedKeyFile?.fileName ?? `photocloud_v2_key_${currentKeyFile.username}.json`,
            'application/json'
          );
        });
        actions.appendChild(dlKeyBtn);
      }

      const lockBtn = el('button', 'btn btn-ghost', 'Blocca');
      lockBtn.id = 'btn-lock-vault';
      lockBtn.addEventListener('click', () => {
        closeActiveOverlayModal();
        client.lock();
        revokeAllObjectUrls();
        clearSelection();
        if (navigator.serviceWorker?.controller) {
          navigator.serviceWorker.controller.postMessage({ type: 'LOCK_ALL_KEYS' });
        }
        authTab = 'login';
        bannerMessage = { type: 'success', text: 'Vault bloccato e chiavi zeroizzate dalla RAM.' };
        render();
      });
      actions.appendChild(lockBtn);

      const logoutBtn = el('button', 'btn btn-danger', 'Esci');
      logoutBtn.id = 'btn-logout';
      logoutBtn.addEventListener('click', async () => {
        closeActiveOverlayModal();
        await client.logout();
        revokeAllObjectUrls();
        clearSelection();
        if (navigator.serviceWorker?.controller) {
          navigator.serviceWorker.controller.postMessage({ type: 'LOCK_ALL_KEYS' });
        }
        loadedKeyFile = null;
        lastGeneratedKeyFile = null;
        authTab = 'login';
        render();
      });
      actions.appendChild(logoutBtn);
    }
    header.appendChild(actions);
    rootEl!.appendChild(header);

    if (!client.isUnlocked()) {
      renderAuthView(rootEl!);
    } else {
      renderWorkspaceView(rootEl!);
    }

    if (selectedLightboxItem) {
      renderLightboxModal(rootEl!, selectedLightboxItem);
    }
  }

  function renderAuthView(container: HTMLElement): void {
    const box = el('main', 'auth-container');

    const authHero = el('div', 'auth-hero');
    authHero.appendChild(el('h1', 'auth-hero-title', 'Archivio Fotografico Zero-Knowledge'));
    authHero.appendChild(
      el(
        'p',
        'auth-hero-sub',
        'Accesso rapido tramite file chiave cifrato sul dispositivo. Il server non vede mai chiavi, foto o metadati in chiaro.'
      )
    );
    box.appendChild(authHero);

    if (bannerMessage) {
      const alert = el('div', `alert-banner alert-${bannerMessage.type}`, bannerMessage.text);
      alert.id = 'auth-alert-banner';
      box.appendChild(alert);
    }

    const tabs = el('div', 'tabs-row');
    const loginTabBtn = el('button', `tab-btn ${authTab === 'login' ? 'active' : ''}`, 'Accedi');
    loginTabBtn.id = 'tab-login';
    loginTabBtn.addEventListener('click', () => {
      authTab = 'login';
      bannerMessage = null;
      render();
    });
    tabs.appendChild(loginTabBtn);

    if (authConfig.registrationOpen) {
      const regTabBtn = el('button', `tab-btn ${authTab === 'register' ? 'active' : ''}`, 'Registrati');
      regTabBtn.id = 'tab-register';
      regTabBtn.addEventListener('click', () => {
        authTab = 'register';
        bannerMessage = null;
        render();
      });
      tabs.appendChild(regTabBtn);
    }

    const recTabBtn = el('button', `tab-btn ${authTab === 'recovery' ? 'active' : ''}`, 'Recovery Code');
    recTabBtn.id = 'tab-recovery';
    recTabBtn.addEventListener('click', () => {
      authTab = 'recovery';
      bannerMessage = null;
      render();
    });
    tabs.appendChild(recTabBtn);
    box.appendChild(tabs);

    if (authTab === 'login') {
      const fgFile = el('div', 'form-group');
      fgFile.appendChild(el('label', 'form-label', 'File Chiave (.json)'));
      const fileInput = el('input', 'form-input');
      fileInput.type = 'file';
      fileInput.id = 'login-keyfile-input';
      fileInput.accept = '.json,application/json';
      const keyfileMetaEl = el(
        'div',
        'media-card-meta keyfile-hint-line',
        loadedKeyFile
          ? loadedKeyFile.hasPassphrase === false
            ? `Account: ${loadedKeyFile.username} · Accesso rapido 1-clic (chiave 256-bit)`
            : `Account: ${loadedKeyFile.username} · Protetto da passphrase`
          : 'Seleziona il tuo file photocloud_v2_key_<utente>.json'
      );
      keyfileMetaEl.id = 'login-keyfile-status';

      fileInput.addEventListener('change', async () => {
        const f = fileInput.files?.[0];
        if (!f) return;
        try {
          const txt = await f.text();
          loadedKeyFile = JSON.parse(txt) as ZkKeyFileV2;
          bannerMessage = null;
          render();
        } catch {
          loadedKeyFile = null;
          bannerMessage = { type: 'error', text: 'File keyfile JSON non valido.' };
          render();
        }
      });

      fgFile.appendChild(fileInput);
      fgFile.appendChild(keyfileMetaEl);
      box.appendChild(fgFile);

      const needsPassphrase = !loadedKeyFile || loadedKeyFile.hasPassphrase !== false;
      let passInput: HTMLInputElement | null = null;
      if (needsPassphrase) {
        const fgPass = el('div', 'form-group');
        fgPass.appendChild(
          el(
            'label',
            'form-label',
            loadedKeyFile ? 'Passphrase' : 'Passphrase (solo se impostata alla registrazione)'
          )
        );
        passInput = el('input', 'form-input');
        passInput.type = 'password';
        passInput.id = 'login-passphrase-input';
        passInput.placeholder = 'Inserisci la passphrase del vault';
        fgPass.appendChild(passInput);
        box.appendChild(fgPass);
      }

      const submitBtn = el(
        'button',
        'btn btn-primary btn-full',
        loadedKeyFile?.hasPassphrase === false ? 'Accedi al Vault' : 'Sblocca Vault'
      );
      submitBtn.id = 'btn-login-submit';
      submitBtn.addEventListener('click', async () => {
        if (!loadedKeyFile && fileInput.files?.[0]) {
          try {
            loadedKeyFile = JSON.parse(await fileInput.files[0].text()) as ZkKeyFileV2;
          } catch {
            loadedKeyFile = null;
          }
        }
        if (!loadedKeyFile) {
          bannerMessage = { type: 'error', text: 'Carica prima il tuo File Chiave JSON.' };
          render();
          return;
        }
        submitBtn.disabled = true;
        submitBtn.textContent =
          loadedKeyFile.hasPassphrase === false
            ? 'Sblocco chiavi 256-bit in corso...'
            : 'Derivazione chiavi Argon2id (64 MiB) in corso...';
        try {
          await client.login(loadedKeyFile, passInput?.value ?? '');
          await client.syncItems('all');
          await client.getAlbums();
          bannerMessage = null;
          render();
        } catch (err) {
          bannerMessage = {
            type: 'error',
            text: err instanceof Error ? err.message : 'Errore durante il login.',
          };
          render();
        }
      });
      box.appendChild(submitBtn);
    } else if (authTab === 'register') {
      const fgUser = el('div', 'form-group');
      fgUser.appendChild(el('label', 'form-label', 'Scegli uno Username'));
      const userInput = el('input', 'form-input');
      userInput.type = 'text';
      userInput.id = 'reg-username-input';
      userInput.placeholder = 'es. valerio';
      fgUser.appendChild(userInput);
      box.appendChild(fgUser);

      // V1-simple radio selector for key mode
      const modeGroup = el('div', 'form-group');
      modeGroup.appendChild(el('label', 'form-label', 'Modalità Chiave Zero-Knowledge'));
      const radioGrid = el('div', 'auth-mode-grid');

      const optGen = el('button', `auth-mode-card ${regKeyMode === 'generated' ? 'active' : ''}`);
      optGen.type = 'button';
      optGen.id = 'reg-mode-generated';
      optGen.appendChild(el('div', 'auth-mode-title', 'Genera una chiave sicura per me (Consigliato)'));
      optGen.appendChild(
        el(
          'div',
          'media-card-meta',
          'Chiave casuale a 256 bit salvata in un file JSON. Accesso immediato in 1 clic, nessuna passphrase da ricordare.'
        )
      );
      optGen.addEventListener('click', () => {
        regKeyMode = 'generated';
        render();
      });

      const optPass = el('button', `auth-mode-card ${regKeyMode === 'passphrase' ? 'active' : ''}`);
      optPass.type = 'button';
      optPass.id = 'reg-mode-passphrase';
      optPass.appendChild(el('div', 'auth-mode-title', 'Proteggi anche con passphrase personalizzata'));
      optPass.appendChild(
        el(
          'div',
          'media-card-meta',
          'Secondo fattore opzionale con Argon2id (64 MiB). Richiede sia il file chiave sia la passphrase ad ogni accesso.'
        )
      );
      optPass.addEventListener('click', () => {
        regKeyMode = 'passphrase';
        render();
      });

      radioGrid.append(optGen, optPass);
      modeGroup.appendChild(radioGrid);
      box.appendChild(modeGroup);

      let passInput: HTMLInputElement | null = null;
      if (regKeyMode === 'passphrase') {
        const fgPass = el('div', 'form-group');
        fgPass.appendChild(el('label', 'form-label', 'Passphrase personalizzata (minimo 12 caratteri)'));
        passInput = el('input', 'form-input');
        passInput.type = 'password';
        passInput.id = 'reg-passphrase-input';
        passInput.placeholder = 'Inserisci una passphrase lunga e sicura';
        const strengthInfo = el('div', 'media-card-meta mono-nums', '');
        strengthInfo.id = 'reg-passphrase-strength';
        passInput.addEventListener('input', () => {
          const st = evaluatePassphraseStrength(passInput!.value);
          strengthInfo.textContent = `${st.feedback} · ${st.estimatedBits} bit stimati`;
        });
        fgPass.appendChild(passInput);
        fgPass.appendChild(strengthInfo);
        box.appendChild(fgPass);
      }

      let tokenInput: HTMLInputElement | null = null;
      if (authConfig.requiresInviteToken) {
        const fgToken = el('div', 'form-group');
        fgToken.appendChild(el('label', 'form-label', 'Token di Setup / Invito'));
        tokenInput = el('input', 'form-input');
        tokenInput.type = 'text';
        tokenInput.id = 'reg-setup-token-input';
        tokenInput.placeholder = 'Token richiesto dal server self-hosted';
        fgToken.appendChild(tokenInput);
        box.appendChild(fgToken);
      }

      const submitBtn = el(
        'button',
        'btn btn-primary btn-full',
        'Crea Account e Scarica File Chiave'
      );
      submitBtn.id = 'btn-reg-submit';
      submitBtn.addEventListener('click', async () => {
        const username = userInput.value.trim();
        const passphrase = regKeyMode === 'passphrase' ? (passInput?.value ?? '') : '';
        const token = tokenInput?.value.trim() || undefined;
        submitBtn.disabled = true;
        submitBtn.textContent =
          regKeyMode === 'passphrase'
            ? 'Generazione chiavi e Argon2id (64 MiB)...'
            : 'Generazione chiave 256-bit e creazione account...';
        try {
          const prepared = client.prepareRegistration(username, passphrase);
          const res = await client.register(prepared, passphrase, undefined, {
            setupToken: token,
            inviteToken: token,
            skipRecoveryConfirmation: true,
          });
          lastGeneratedKeyFile = { keyFile: res.keyFile, fileName: res.keyFileFileName };
          loadedKeyFile = res.keyFile;
          // Auto-download keyfile just like V1
          triggerDownload(
            new TextEncoder().encode(JSON.stringify(res.keyFile, null, 2)),
            res.keyFileFileName,
            'application/json'
          );
          bannerMessage = {
            type: 'success',
            text: `Account creato! Il tuo File Chiave (${res.keyFileFileName}) è stato scaricato. Conservalo al sicuro per accedere dai tuoi dispositivi.`,
          };
          render();
        } catch (err) {
          bannerMessage = {
            type: 'error',
            text: err instanceof Error ? err.message : 'Registrazione fallita.',
          };
          render();
        }
      });
      box.appendChild(submitBtn);
    } else if (authTab === 'recovery') {
      const recExplain = el(
        'div',
        'alert-banner alert-warning',
        'Usa il Recovery Code (8 blocchi hex) per ricostruire il tuo file chiave se hai perso il file JSON. Lascia la passphrase vuota se avevi scelto la modalità rapida.'
      );
      recExplain.id = 'recovery-tab-explanation';
      box.appendChild(recExplain);

      const fgUser = el('div', 'form-group');
      fgUser.appendChild(el('label', 'form-label', 'Username'));
      const userInput = el('input', 'form-input');
      userInput.type = 'text';
      userInput.id = 'rec-username-input';
      fgUser.appendChild(userInput);
      box.appendChild(fgUser);

      const fgCode = el('div', 'form-group');
      fgCode.appendChild(el('label', 'form-label', 'Recovery Code'));
      const codeInput = el('input', 'form-input mono-nums');
      codeInput.type = 'text';
      codeInput.id = 'rec-code-input';
      codeInput.placeholder = 'XXXXXXXX-XXXXXXXX-...';
      fgCode.appendChild(codeInput);
      box.appendChild(fgCode);

      const fgPass = el('div', 'form-group');
      fgPass.appendChild(el('label', 'form-label', 'Passphrase (lascia vuoto se non impostata)'));
      const passInput = el('input', 'form-input');
      passInput.type = 'password';
      passInput.id = 'rec-passphrase-input';
      fgPass.appendChild(passInput);
      box.appendChild(fgPass);

      const recBtn = el('button', 'btn btn-primary btn-full', 'Ricostruisci Keyfile e Accedi');
      recBtn.id = 'btn-rec-submit';
      recBtn.addEventListener('click', async () => {
        try {
          const hasPw = passInput.value.length > 0;
          const kf = client.recoverKeyFileFromRecoveryCode(userInput.value, codeInput.value, hasPw);
          loadedKeyFile = kf;
          await client.login(kf, passInput.value);
          await client.syncItems('all');
          await client.getAlbums();
          bannerMessage = null;
          render();
        } catch (err) {
          bannerMessage = {
            type: 'error',
            text: err instanceof Error ? err.message : 'Recupero fallito.',
          };
          render();
        }
      });
      box.appendChild(recBtn);
    }

    container.appendChild(box);
  }

  function renderWorkspaceView(container: HTMLElement): void {
    const layout = el('div', 'workspace-layout');

    const sidebar = el('aside', 'sidebar');
    const navList = el('nav', 'nav-list');

    const activeItems = client.getItems('active');
    const trashedItems = client.getItems('trashed');
    const gpsCount = activeItems.filter((it) =>
      isValidGpsCoord(it.meta.exifSubset?.lat, it.meta.exifSubset?.lon)
    ).length;

    const navDefs: Array<{ id: string; view: WorkspaceView; label: string }> = [
      { id: 'nav-gallery', view: 'gallery', label: 'Galleria' },
      { id: 'nav-albums', view: 'albums', label: 'Album' },
      { id: 'nav-map', view: 'map', label: gpsCount > 0 ? `Mappa (${gpsCount})` : 'Mappa' },
      { id: 'nav-shares', view: 'shares', label: 'Condivisioni' },
      { id: 'nav-trash', view: 'trash', label: trashedItems.length > 0 ? `Cestino (${trashedItems.length})` : 'Cestino' },
      { id: 'nav-security', view: 'security', label: 'Sicurezza' },
    ];

    for (const nav of navDefs) {
      const btn = el('button', `nav-item ${currentView === nav.view ? 'active' : ''}`, nav.label);
      btn.id = nav.id;
      btn.addEventListener('click', () => switchView(nav.view));
      navList.appendChild(btn);
    }
    sidebar.appendChild(navList);

    // Upload Panel
    const uploadPanel = el('div', 'stats-box');
    uploadPanel.appendChild(el('div', 'form-label', 'Carica File E2EE'));
    const fileInput = el('input', 'form-input');
    fileInput.type = 'file';
    fileInput.multiple = true;
    fileInput.id = 'vault-upload-input';
    uploadPanel.appendChild(fileInput);

    const gpsToggleRow = el('label', 'checkbox-row');
    const gpsCheckbox = el('input', '');
    gpsCheckbox.type = 'checkbox';
    gpsCheckbox.id = 'upload-include-gps';
    gpsCheckbox.checked = includeGpsOnUpload;
    gpsCheckbox.addEventListener('change', () => {
      includeGpsOnUpload = gpsCheckbox.checked;
    });
    gpsToggleRow.appendChild(gpsCheckbox);
    gpsToggleRow.appendChild(el('span', 'media-card-meta', 'Includi GPS cifrato per la Mappa'));
    uploadPanel.appendChild(gpsToggleRow);

    const statusLine = el('div', 'media-card-meta', 'Cifratura locale AES-256-GCM');
    statusLine.id = 'upload-status-line';
    uploadPanel.appendChild(statusLine);

    fileInput.addEventListener('change', async () => {
      const files = Array.from(fileInput.files ?? []);
      if (files.length === 0) return;
      statusLine.textContent = `Cifratura e upload di ${files.length} file...`;
      try {
        for (const f of files) {
          const thumbs = await generateBrowserImageThumbs(f);
          const bytes = new Uint8Array(await f.arrayBuffer());
          await client.uploadFile(
            {
              name: f.name,
              mimeType: f.type || 'application/octet-stream',
              size: f.size,
              source: bytes,
              lastModified: f.lastModified,
              width: thumbs.width,
              height: thumbs.height,
              thumb320Plaintext: thumbs.thumb320,
              thumb1280Plaintext: thumbs.thumb1280,
            },
            { includeGps: includeGpsOnUpload }
          );
        }
        await client.syncItems('all');
        bannerMessage = {
          type: 'success',
          text:
            files.length === 1
              ? '1 file cifrato e caricato nel vault.'
              : `${files.length} file cifrati e caricati nel vault.`,
        };
        render();
      } catch (err) {
        bannerMessage = {
          type: 'error',
          text: err instanceof Error ? err.message : 'Errore durante il caricamento.',
        };
        render();
      }
    });
    sidebar.appendChild(uploadPanel);

    const statsBox = el('div', 'stats-box mono-nums');
    const activeCountEl = el('div', '', `Attivi: ${activeItems.length}`);
    activeCountEl.id = 'stats-active-count';
    const trashedCountEl = el('div', '', `Cestino: ${trashedItems.length}`);
    trashedCountEl.id = 'stats-trashed-count';
    statsBox.append(activeCountEl, trashedCountEl);
    sidebar.appendChild(statsBox);

    layout.appendChild(sidebar);

    const main = el('main', 'main-area');
    if (bannerMessage) {
      const alert = el('div', `alert-banner alert-${bannerMessage.type}`, bannerMessage.text);
      alert.id = 'workspace-alert-banner';
      main.appendChild(alert);
    }

    if (lastCreatedShare && currentView !== 'shares') {
      const shareBanner = el('div', 'toolbar-row');
      shareBanner.id = 'last-share-banner';
      const urlSpan = el('span', 'media-card-meta mono-nums', lastCreatedShare.shareUrl);
      urlSpan.id = 'last-share-url-display';
      shareBanner.appendChild(urlSpan);

      const manageBtn = el('button', 'btn btn-ghost', 'Gestisci Condivisioni');
      manageBtn.addEventListener('click', () => switchView('shares'));
      shareBanner.appendChild(manageBtn);

      const revokeBtn = el('button', 'btn btn-danger', 'Revoca');
      revokeBtn.id = 'btn-revoke-last-share';
      revokeBtn.addEventListener('click', async () => {
        if (!lastCreatedShare) return;
        const idToRevoke = lastCreatedShare.shareId;
        await client.revokeShare(idToRevoke);
        bannerMessage = { type: 'success', text: `Link di condivisione revocato.` };
        lastCreatedShare = null;
        render();
      });
      shareBanner.appendChild(revokeBtn);

      const dismissShareBtn = el('button', 'btn btn-ghost', 'Chiudi');
      dismissShareBtn.setAttribute('aria-label', 'Nascondi banner link condiviso');
      dismissShareBtn.addEventListener('click', () => {
        lastCreatedShare = null;
        render();
      });
      shareBanner.appendChild(dismissShareBtn);
      main.appendChild(shareBanner);
    }

    const gridContainer = el('div', '');
    gridContainer.id = 'vault-grid-container';

    if (currentView === 'gallery' || currentView === 'trash') {
      const toolbar = el('div', 'toolbar-row');
      const searchInput = el('input', 'form-input search-input');
      searchInput.type = 'search';
      searchInput.id = 'vault-search-input';
      searchInput.placeholder = 'Cerca in linguaggio naturale (es. "foto preferite", "documenti")';
      searchInput.value = searchQuery;
      searchInput.addEventListener('input', () => {
        searchQuery = searchInput.value;
        renderGalleryGrid(gridContainer);
      });
      toolbar.appendChild(searchInput);

      if (currentView === 'gallery') {
        const groupSelect = el('select', 'form-input');
        groupSelect.id = 'vault-group-select';
        for (const [val, label] of [
          ['day', 'Giorno'],
          ['month', 'Mese'],
          ['year', 'Anno'],
          ['album', 'Album'],
        ] as const) {
          const opt = el('option', '', label);
          opt.value = val;
          if (groupMode === val) opt.selected = true;
          groupSelect.appendChild(opt);
        }
        groupSelect.addEventListener('change', () => {
          groupMode = groupSelect.value as TimelineGroupModeV2;
          renderGalleryGrid(gridContainer);
        });
        toolbar.appendChild(groupSelect);
      }

      const selectToggleBtn = el(
        'button',
        `btn ${selectionMode ? 'active-toggle' : ''}`,
        selectionMode ? 'Fine Selezione' : 'Seleziona'
      );
      selectToggleBtn.id = 'btn-toggle-select';
      selectToggleBtn.addEventListener('click', () => {
        if (selectionMode) {
          clearSelection();
        } else {
          selectionMode = true;
        }
        render();
      });
      toolbar.appendChild(selectToggleBtn);

      if (currentView === 'gallery') {
        const zipBtn = el('button', 'btn btn-ghost', 'Esporta ZIP');
        zipBtn.id = 'btn-export-zip';
        zipBtn.addEventListener('click', () => {
          const items = client.getItems('active');
          void runZipExport(items.map((i) => i.id), zipBtn);
        });
        toolbar.appendChild(zipBtn);
      }

      if (currentView === 'trash' && trashedItems.length > 0) {
        const emptyTrashBtn = el('button', 'btn btn-danger', 'Svuota Cestino');
        emptyTrashBtn.id = 'btn-empty-trash';
        emptyTrashBtn.addEventListener('click', async () => {
          await client.emptyTrash();
          clearSelection();
          bannerMessage = { type: 'success', text: 'Cestino svuotato definitivamente.' };
          render();
        });
        toolbar.appendChild(emptyTrashBtn);
      }

      main.appendChild(toolbar);
      renderGalleryGrid(gridContainer);
    } else if (currentView === 'albums') {
      renderAlbumsView(gridContainer);
    } else if (currentView === 'map') {
      renderGpsMapView(gridContainer, {
        client,
        items: activeItems,
        initialFocus: mapFocusCoords,
        registerObjectUrl,
        onOpenItem: (it) => {
          selectedLightboxItem = it;
          render();
        },
        onNavigateUploadHint: () => switchView('gallery'),
      });
      mapFocusCoords = null;
    } else if (currentView === 'shares') {
      renderSharesManagementView(gridContainer, client, ownerShares, sharesLoading, {
        onStatusMessage: (type, text) => {
          bannerMessage = { type, text };
          render();
        },
        onRefreshRequested: () => refreshOwnerShares(),
      });
    } else if (currentView === 'security') {
      renderSecurityView(gridContainer);
    }

    main.appendChild(gridContainer);
    layout.appendChild(main);
    container.appendChild(layout);

    // Floating Batch Action Bar when selection active
    if (selectedIds.size > 0) {
      renderBatchActionBar(container);
    }
  }

  async function runZipExport(itemIds: string[], triggerBtn?: HTMLButtonElement): Promise<void> {
    if (itemIds.length === 0) return;
    try {
      const stream = client.exportZipStream(itemIds);
      const reader = stream.getReader();
      const chunks: Uint8Array[] = [];
      let total = 0;
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        if (value) {
          chunks.push(value);
          total += value.byteLength;
        }
      }
      const out = new Uint8Array(total);
      let off = 0;
      for (const c of chunks) {
        out.set(c, off);
        off += c.byteLength;
      }
      if (triggerBtn) {
        const sigHex =
          out.byteLength >= 4
            ? Array.from(out.subarray(0, 4))
                .map((b) => b.toString(16).padStart(2, '0'))
                .join('')
            : '';
        triggerBtn.dataset.lastZipBytes = String(out.byteLength);
        triggerBtn.dataset.lastZipMagic = sigHex;
      }
      triggerDownload(out, 'photocloud_v2_export.zip', 'application/zip');
      bannerMessage = {
        type: 'success',
        text: `Archivio ZIP esportato in streaming (${formatBytes(out.byteLength)}).`,
      };
      render();
    } catch (err) {
      bannerMessage = {
        type: 'error',
        text: err instanceof Error ? err.message : 'Errore durante export ZIP.',
      };
      render();
    }
  }

  function toggleItemSelection(itemId: string, shiftKey: boolean): void {
    if (shiftKey && lastClickedItemId && renderedOrderIds.length > 0) {
      const idxA = renderedOrderIds.indexOf(lastClickedItemId);
      const idxB = renderedOrderIds.indexOf(itemId);
      if (idxA >= 0 && idxB >= 0) {
        const [start, end] = idxA <= idxB ? [idxA, idxB] : [idxB, idxA];
        for (let i = start; i <= end; i++) {
          selectedIds.add(renderedOrderIds[i]);
        }
        selectionMode = true;
        lastClickedItemId = itemId;
        render();
        return;
      }
    }

    if (selectedIds.has(itemId)) {
      selectedIds.delete(itemId);
    } else {
      selectedIds.add(itemId);
      selectionMode = true;
    }
    lastClickedItemId = itemId;
    render();
  }

  function renderBatchActionBar(container: HTMLElement): void {
    const bar = el('div', 'batch-action-bar');
    bar.id = 'batch-action-bar';

    const left = el('div', 'batch-bar-left');
    const countLabel = el('span', 'batch-count mono-nums', `${selectedIds.size} selezionati`);
    countLabel.id = 'batch-selected-count';
    left.appendChild(countLabel);

    const selectAllBtn = el('button', 'btn btn-ghost', 'Tutti');
    selectAllBtn.id = 'btn-batch-select-all';
    selectAllBtn.addEventListener('click', () => {
      for (const id of renderedOrderIds) selectedIds.add(id);
      render();
    });

    const clearBtn = el('button', 'btn btn-ghost', 'Annulla');
    clearBtn.id = 'btn-batch-clear';
    clearBtn.addEventListener('click', () => {
      clearSelection();
      render();
    });
    left.append(selectAllBtn, clearBtn);
    bar.appendChild(left);

    const right = el('div', 'batch-bar-actions');
    const ids = Array.from(selectedIds);

    if (currentView === 'trash') {
      const restoreBtn = el('button', 'btn btn-primary', 'Ripristina');
      restoreBtn.id = 'btn-batch-restore';
      restoreBtn.addEventListener('click', async () => {
        await client.restoreItems(ids);
        clearSelection();
        bannerMessage = { type: 'success', text: `${ids.length} elementi ripristinati dal cestino.` };
        render();
      });
      right.appendChild(restoreBtn);

      if (confirmBatchPermanentDelete) {
        const confirmDelBtn = el('button', 'btn btn-danger', 'Conferma Eliminazione');
        confirmDelBtn.id = 'btn-batch-confirm-delete';
        confirmDelBtn.addEventListener('click', async () => {
          for (const id of ids) {
            await client.deleteItemPermanently(id);
          }
          clearSelection();
          bannerMessage = { type: 'success', text: `${ids.length} elementi eliminati definitivamente.` };
          render();
        });
        right.appendChild(confirmDelBtn);
      } else {
        const delBtn = el('button', 'btn btn-danger', 'Elimina Definit.');
        delBtn.id = 'btn-batch-delete';
        delBtn.addEventListener('click', () => {
          confirmBatchPermanentDelete = true;
          render();
        });
        right.appendChild(delBtn);
      }
    } else {
      const albums = client.getCachedAlbums().albums;
      if (albums.length > 0) {
        const albSelect = el('select', 'form-input batch-album-select');
        albSelect.id = 'batch-album-select';
        const defOpt = el('option', '', '+ Album...');
        defOpt.value = '';
        albSelect.appendChild(defOpt);
        for (const a of albums) {
          const o = el('option', '', a.title);
          o.value = a.id;
          albSelect.appendChild(o);
        }
        albSelect.addEventListener('change', async () => {
          const targetId = albSelect.value;
          if (!targetId) return;
          const activeById = new Map(client.getItems('active').map((i) => [i.id, i]));
          const blobIdsToAdd = ids
            .map((id) => activeById.get(id)?.blobId)
            .filter((b): b is string => Boolean(b));
          await client.saveAlbums((cur) => ({
            ...cur,
            albums: cur.albums.map((a) =>
              a.id === targetId
                ? {
                    ...a,
                    blobIds: Array.from(new Set([...a.blobIds, ...blobIdsToAdd])),
                    updatedAt: Date.now(),
                  }
                : a
            ),
          }));
          clearSelection();
          bannerMessage = { type: 'success', text: `${blobIdsToAdd.length} elementi aggiunti all'album.` };
          render();
        });
        right.appendChild(albSelect);
      }

      const shareBtn = el('button', 'btn btn-primary', 'Condividi');
      shareBtn.id = 'btn-batch-share';
      shareBtn.addEventListener('click', () => {
        closeActiveOverlayModal();
        activeModalCleanup = openCreateShareModal(rootEl!, client, {
          itemIds: ids,
          defaultTitle: `Selezione (${ids.length} file)`,
          onCreated: (res) => {
            lastCreatedShare = { shareId: res.shareId, shareUrl: res.shareUrl };
            clearSelection();
          },
          onClose: () => {
            activeModalCleanup = null;
            render();
          },
        });
      });
      right.appendChild(shareBtn);

      const favBtn = el('button', 'btn', 'Preferiti');
      favBtn.id = 'btn-batch-favorite';
      favBtn.addEventListener('click', async () => {
        const map = new Map(client.getItems('active').map((i) => [i.id, i]));
        const anyNotFav = ids.some((id) => !map.get(id)?.meta.isFavorite);
        for (const id of ids) {
          if (map.has(id)) {
            await client.updateItemMeta(id, { isFavorite: anyNotFav });
          }
        }
        clearSelection();
        bannerMessage = {
          type: 'success',
          text: anyNotFav
            ? `${ids.length} elementi aggiunti ai preferiti.`
            : `${ids.length} elementi rimossi dai preferiti.`,
        };
        render();
      });
      right.appendChild(favBtn);

      const zipBtn = el('button', 'btn', 'ZIP');
      zipBtn.id = 'btn-batch-zip';
      zipBtn.addEventListener('click', () => {
        void runZipExport(ids, zipBtn);
      });
      right.appendChild(zipBtn);

      const trashBtn = el('button', 'btn btn-danger', 'Cestino');
      trashBtn.id = 'btn-batch-trash';
      trashBtn.addEventListener('click', async () => {
        await client.trashItems(ids);
        clearSelection();
        bannerMessage = { type: 'success', text: `${ids.length} elementi spostati nel cestino.` };
        render();
      });
      right.appendChild(trashBtn);
    }

    bar.appendChild(right);
    container.appendChild(bar);
  }

  function createMediaCard(item: DecryptedItemV2): HTMLElement {
    const isSelected = selectedIds.has(item.id);
    const card = el('article', `media-card ${isSelected ? 'selected' : ''}`);
    card.dataset.itemId = item.id;
    card.dataset.itemName = item.meta.name;

    const thumbBox = el('div', 'media-thumb-box');

    // Multi-select checkbox overlay
    const checkBtn = el('button', `card-select-check ${isSelected ? 'checked' : ''} ${selectionMode ? 'visible' : ''}`);
    checkBtn.type = 'button';
    checkBtn.setAttribute('aria-label', `Seleziona ${item.meta.name}`);
    checkBtn.textContent = isSelected ? '✓' : '';
    checkBtn.addEventListener('click', (ev) => {
      ev.stopPropagation();
      toggleItemSelection(item.id, ev.shiftKey);
    });
    thumbBox.appendChild(checkBtn);

    if (item.thumbs.includes(320) && isSafeRasterImageMime(item.meta.mime)) {
      const img = el('img', 'media-thumb-img');
      img.alt = item.meta.name;
      client
        .downloadThumbnail(item.blobId, 320)
        .then((bytes) => {
          img.src = registerObjectUrl(new Blob([bytes as unknown as BlobPart], { type: 'image/jpeg' }));
        })
        .catch(() => {});
      thumbBox.appendChild(img);
    } else {
      thumbBox.appendChild(el('span', 'media-card-meta mono-nums', item.category.toUpperCase()));
    }
    card.appendChild(thumbBox);

    const body = el('div', 'media-card-body');
    const titleText = item.meta.isFavorite ? `★ ${item.meta.name}` : item.meta.name;
    body.appendChild(el('div', 'media-card-title', titleText));
    const hasGps = isValidGpsCoord(item.meta.exifSubset?.lat, item.meta.exifSubset?.lon);
    const metaParts = [formatBytes(item.meta.size), `v${item.version}`];
    if (hasGps) metaParts.push('GPS');
    body.appendChild(el('div', 'media-card-meta mono-nums', metaParts.join(' · ')));
    card.appendChild(body);

    card.addEventListener('click', (ev) => {
      if (selectionMode || ev.shiftKey) {
        toggleItemSelection(item.id, ev.shiftKey);
        return;
      }
      selectedLightboxItem = item;
      render();
    });
    return card;
  }

  function renderGalleryGrid(container: HTMLElement): void {
    container.textContent = '';
    renderedOrderIds = [];

    if (currentView === 'trash' || searchQuery.trim()) {
      const items =
        currentView === 'trash' ? client.getItems('trashed') : client.searchItems(searchQuery);

      if (items.length === 0) {
        const empty = el(
          'div',
          'empty-state-card',
          currentView === 'trash' ? 'Il cestino è vuoto.' : 'Nessun elemento corrispondente nel vault.'
        );
        empty.id = 'vault-empty-state';
        container.appendChild(empty);
        return;
      }

      const grid = el('div', 'gallery-grid');
      for (const item of items) {
        renderedOrderIds.push(item.id);
        grid.appendChild(createMediaCard(item));
      }
      container.appendChild(grid);
      return;
    }

    const activeItems = client.getItems('active');
    if (activeItems.length === 0) {
      const empty = el('div', 'empty-state-card');
      empty.id = 'vault-empty-state';
      empty.appendChild(el('h3', 'brand-title', 'Il tuo Vault E2EE è pronto'));
      empty.appendChild(
        el(
          'p',
          'media-card-meta',
          'Carica foto, video o documenti dal pannello laterale: ogni file viene cifrato sul tuo dispositivo prima dell\'invio.'
        )
      );
      container.appendChild(empty);
      return;
    }

    const groups = client.groupItems(groupMode);
    if (groups.length === 0) {
      const info = el(
        'div',
        'alert-banner',
        groupMode === 'album'
          ? 'Nessun album cifrato creato. Visualizzazione completa degli elementi attivi.'
          : 'Nessun gruppo disponibile.'
      );
      container.appendChild(info);
      const grid = el('div', 'gallery-grid');
      for (const item of activeItems) {
        renderedOrderIds.push(item.id);
        grid.appendChild(createMediaCard(item));
      }
      container.appendChild(grid);
      return;
    }

    for (const grp of groups) {
      if (grp.items.length === 0) continue;
      const section = el('section', 'timeline-section');
      const headerRow = el('div', 'timeline-group-header');
      headerRow.appendChild(el('span', 'timeline-group-title', grp.label));
      headerRow.appendChild(el('span', 'media-card-meta mono-nums', `${grp.items.length} file`));
      section.appendChild(headerRow);

      const grid = el('div', 'gallery-grid');
      for (const item of grp.items) {
        renderedOrderIds.push(item.id);
        grid.appendChild(createMediaCard(item));
      }
      section.appendChild(grid);
      container.appendChild(section);
    }
  }

  function renderAlbumsView(container: HTMLElement): void {
    container.textContent = '';
    renderedOrderIds = [];
    const catalog = client.getCachedAlbums();
    const activeItems = client.getItems('active');
    const byBlob = new Map<string, DecryptedItemV2>();
    for (const it of activeItems) byBlob.set(it.blobId, it);

    if (selectedAlbumId) {
      const album = catalog.albums.find((a) => a.id === selectedAlbumId);
      if (!album) {
        selectedAlbumId = null;
      } else {
        const bar = el('div', 'toolbar-row');
        const backBtn = el('button', 'btn btn-ghost', '← Tutti gli Album');
        backBtn.id = 'btn-album-back';
        backBtn.addEventListener('click', () => {
          selectedAlbumId = null;
          clearSelection();
          render();
        });
        bar.appendChild(backBtn);
        bar.appendChild(el('span', 'brand-title', `${album.title} (${album.blobIds.length})`));

        const delBtn = el('button', 'btn btn-danger', 'Elimina Album');
        delBtn.id = 'btn-album-delete';
        delBtn.addEventListener('click', async () => {
          try {
            await client.saveAlbums((cur) => ({
              ...cur,
              albums: cur.albums.filter((a) => a.id !== album.id),
            }));
            selectedAlbumId = null;
            bannerMessage = { type: 'success', text: `Album "${album.title}" eliminato.` };
            render();
          } catch (err) {
            bannerMessage = {
              type: 'error',
              text: err instanceof Error ? err.message : 'Errore eliminazione album.',
            };
            render();
          }
        });
        bar.appendChild(delBtn);
        container.appendChild(bar);

        const albumItems = album.blobIds
          .map((bId) => byBlob.get(bId))
          .filter((x): x is DecryptedItemV2 => Boolean(x));

        if (albumItems.length === 0) {
          container.appendChild(
            el(
              'div',
              'empty-state-card',
              'Questo album cifrato è vuoto. Usa la selezione multipla in Galleria o la lightbox per aggiungere file.'
            )
          );
        } else {
          const grid = el('div', 'gallery-grid');
          for (const it of albumItems) {
            renderedOrderIds.push(it.id);
            grid.appendChild(createMediaCard(it));
          }
          container.appendChild(grid);
        }
        return;
      }
    }

    const createRow = el('div', 'toolbar-row');
    const nameInput = el('input', 'form-input search-input');
    nameInput.type = 'text';
    nameInput.id = 'album-name-input';
    nameInput.placeholder = 'Nome nuovo album cifrato (es. Vacanze 2026)';
    createRow.appendChild(nameInput);

    const createBtn = el('button', 'btn btn-primary', 'Crea Album');
    createBtn.id = 'btn-create-album';
    createBtn.addEventListener('click', async () => {
      const title = nameInput.value.trim();
      if (!title) return;
      createBtn.disabled = true;
      try {
        const now = Date.now();
        await client.saveAlbums((cur) => ({
          ...cur,
          albums: [
            ...cur.albums,
            {
              id: generateUuidV4(),
              title,
              coverBlobId: null,
              blobIds: [],
              createdAt: now,
              updatedAt: now,
            },
          ],
        }));
        bannerMessage = { type: 'success', text: `Album cifrato "${title}" creato.` };
        render();
      } catch (err) {
        bannerMessage = {
          type: 'error',
          text: err instanceof Error ? err.message : 'Errore creazione album.',
        };
        render();
      }
    });
    createRow.appendChild(createBtn);
    container.appendChild(createRow);

    if (catalog.albums.length === 0) {
      const empty = el(
        'div',
        'empty-state-card',
        'Nessun album cifrato. Crea il tuo primo album: nomi e contenuti sono cifrati end-to-end.'
      );
      empty.id = 'albums-empty-state';
      container.appendChild(empty);
      return;
    }

    const grid = el('div', 'gallery-grid');
    for (const alb of catalog.albums) {
      const card = el('article', 'media-card album-card');
      card.dataset.albumId = alb.id;
      const body = el('div', 'media-card-body');
      body.appendChild(el('div', 'media-card-title', alb.title));
      body.appendChild(
        el('div', 'media-card-meta mono-nums', `${alb.blobIds.length} elementi · rev. ${catalog.revision}`)
      );
      card.appendChild(body);
      card.addEventListener('click', () => {
        selectedAlbumId = alb.id;
        render();
      });
      grid.appendChild(card);
    }
    container.appendChild(grid);
  }

  function renderSecurityView(container: HTMLElement): void {
    container.textContent = '';
    const secGrid = el('div', 'security-grid');

    // Card 1: Keyfile & Recovery Backup
    const backupCard = el('section', 'stats-box security-card');
    backupCard.appendChild(el('h2', 'brand-title', 'File Chiave & Recovery Code'));
    backupCard.appendChild(
      el(
        'p',
        'media-card-meta',
        client.isPassphraseProtected()
          ? 'Modalità attiva: File Chiave 256-bit + Passphrase Argon2id (64 MiB).'
          : 'Modalità attiva: Accesso rapido File Chiave 256-bit (nessuna passphrase impostata).'
      )
    );

    const recCode = client.getCurrentRecoveryCode();
    if (recCode) {
      const recBox = el('div', 'recovery-box mono-nums', recCode);
      recBox.id = 'security-recovery-code';
      backupCard.appendChild(recBox);
    }

    const kf = client.exportCurrentKeyFile();
    if (kf) {
      const dlBtn = el('button', 'btn btn-primary', 'Scarica File Chiave JSON');
      dlBtn.addEventListener('click', () => {
        triggerDownload(
          new TextEncoder().encode(JSON.stringify(kf, null, 2)),
          `photocloud_v2_key_${kf.username}.json`,
          'application/json'
        );
      });
      backupCard.appendChild(dlBtn);
    }
    secGrid.appendChild(backupCard);

    // Card 2: Passphrase Rewrap (Add / Change / Remove)
    const rewrapCard = el('section', 'stats-box security-card');
    rewrapCard.appendChild(
      el(
        'h2',
        'brand-title',
        client.isPassphraseProtected() ? 'Cambia o Rimuovi Passphrase' : 'Aggiungi Passphrase (Opzionale)'
      )
    );
    rewrapCard.appendChild(
      el(
        'p',
        'media-card-meta',
        'Ri-cifra solo la Vault Key lato client senza toccare i tuoi file. Tutte le altre sessioni attive vengono revocate.'
      )
    );

    let oldInput: HTMLInputElement | null = null;
    if (client.isPassphraseProtected()) {
      const fgOld = el('div', 'form-group');
      fgOld.appendChild(el('label', 'form-label', 'Passphrase Attuale'));
      oldInput = el('input', 'form-input');
      oldInput.type = 'password';
      oldInput.id = 'rewrap-old-pass';
      fgOld.appendChild(oldInput);
      rewrapCard.appendChild(fgOld);
    }

    const fgNew = el('div', 'form-group');
    fgNew.appendChild(
      el(
        'label',
        'form-label',
        client.isPassphraseProtected()
          ? 'Nuova Passphrase (>= 12 caratteri, oppure vuoto per modalità rapida)'
          : 'Nuova Passphrase (>= 12 caratteri)'
      )
    );
    const newInput = el('input', 'form-input');
    newInput.type = 'password';
    newInput.id = 'rewrap-new-pass';
    const strengthEl = el('div', 'media-card-meta mono-nums', '');
    newInput.addEventListener('input', () => {
      if (!newInput.value) {
        strengthEl.textContent = 'Modalità rapida (solo File Chiave 256-bit)';
        return;
      }
      const st = evaluatePassphraseStrength(newInput.value);
      strengthEl.textContent = `${st.feedback} · ${st.estimatedBits} bit`;
    });
    fgNew.append(newInput, strengthEl);
    rewrapCard.appendChild(fgNew);

    const fgConf = el('div', 'form-group');
    fgConf.appendChild(el('label', 'form-label', 'Conferma Nuova Passphrase'));
    const confInput = el('input', 'form-input');
    confInput.type = 'password';
    confInput.id = 'rewrap-confirm-pass';
    fgConf.appendChild(confInput);
    rewrapCard.appendChild(fgConf);

    const rewrapBtn = el('button', 'btn btn-primary', 'Aggiorna e Scarica Nuovo Keyfile');
    rewrapBtn.id = 'btn-rewrap-submit';
    rewrapBtn.addEventListener('click', async () => {
      if (newInput.value !== confInput.value) {
        bannerMessage = { type: 'error', text: 'Le nuove passphrase non corrispondono.' };
        render();
        return;
      }
      rewrapBtn.disabled = true;
      rewrapBtn.textContent = 'Rewrap Zero-Knowledge in corso...';
      try {
        const updatedKf = await client.changePassphrase(oldInput?.value ?? '', newInput.value);
        const fileName = `photocloud_v2_key_${updatedKf.username}.json`;
        lastGeneratedKeyFile = { keyFile: updatedKf, fileName };
        loadedKeyFile = updatedKf;
        triggerDownload(
          new TextEncoder().encode(JSON.stringify(updatedKf, null, 2)),
          fileName,
          'application/json'
        );
        bannerMessage = {
          type: 'success',
          text: 'Protezione account aggiornata! Il nuovo File Chiave JSON è stato scaricato.',
        };
        render();
      } catch (err) {
        bannerMessage = {
          type: 'error',
          text: err instanceof Error ? err.message : 'Errore durante il rewrap.',
        };
        render();
      }
    });
    rewrapCard.appendChild(rewrapBtn);
    secGrid.appendChild(rewrapCard);

    // Card 3: Cryptographic Posture & Storage Stats
    const postureCard = el('section', 'stats-box security-card');
    postureCard.appendChild(el('h2', 'brand-title', 'Architettura Crittografica'));
    const lines = [
      'Account Key 256-bit CSPRNG + Passphrase opzionale Argon2id (64 MiB, t=3, p=1)',
      'HKDF-SHA256 domain separation: KEK, Auth, Meta, Thumb, Dedup, FKWrap',
      'Blob & Metadata AEAD: AES-256-GCM (PCZK v1 chunked streaming 1 MiB)',
      'Condivisioni: Chiave 256-bit solo nel fragment # · Revoca istantanea',
      'Auto-Lock: 15 minuti di inattività con zeroizzazione RAM',
    ];
    for (const line of lines) {
      postureCard.appendChild(el('div', 'media-card-meta', `· ${line}`));
    }
    if (cachedStats) {
      postureCard.appendChild(
        el(
          'div',
          'exif-meta-bar mono-nums',
          `Spazio: ${formatBytes(cachedStats.activeBytes + cachedStats.trashedBytes)} / ${formatBytes(
            cachedStats.quotaBytes
          )} · Foto: ${cachedStats.photosCount} · Video: ${cachedStats.videosCount} · Documenti: ${
            cachedStats.documentsCount
          }`
        )
      );
    }
    secGrid.appendChild(postureCard);
    container.appendChild(secGrid);
  }

  function renderLightboxModal(container: HTMLElement, item: DecryptedItemV2): void {
    const backdrop = el('div', 'modal-backdrop');
    backdrop.id = 'lightbox-modal';

    const panel = el('div', 'modal-panel');
    const topRow = el('div', 'toolbar-row');
    const title = el('h2', 'brand-title', `${item.meta.name}`);
    title.id = 'lightbox-item-title';
    topRow.appendChild(title);

    const closeBtn = el('button', 'btn btn-ghost', 'Chiudi');
    closeBtn.id = 'btn-lightbox-close';
    closeBtn.addEventListener('click', () => {
      selectedLightboxItem = null;
      render();
    });
    topRow.appendChild(closeBtn);
    panel.appendChild(topRow);

    const previewBox = el('div', 'lightbox-preview-box');
    previewBox.id = 'lightbox-preview-box';
    previewBox.appendChild(el('span', 'media-card-meta', 'Decifratura e verifica GCM in corso...'));
    panel.appendChild(previewBox);

    if (item.category === 'video') {
      (async () => {
        try {
          const ticket = await client.getVideoStreamTicket(item.blobId);
          const swRegistered = await registerVideoStreamTicketInSw(ticket);
          zeroize(ticket.fileKey);
          previewBox.textContent = '';
          const video = el('video', 'lightbox-img');
          video.id = 'lightbox-video-player';
          video.controls = true;
          if (swRegistered) {
            video.dataset.streamMode = 'sw-range';
            video.src = `/v2/__stream/${item.blobId}`;
          } else {
            const plainBytes = await client.downloadBlobToBytes(item.blobId);
            video.dataset.streamMode = 'blob-fallback';
            video.src = registerObjectUrl(
              new Blob([plainBytes as unknown as BlobPart], { type: item.meta.mime })
            );
          }
          previewBox.appendChild(video);
        } catch (err) {
          previewBox.textContent = '';
          previewBox.appendChild(
            el('div', 'alert-banner alert-error', err instanceof Error ? err.message : 'Errore video.')
          );
        }
      })();
    } else {
      client
        .downloadBlobToBytes(item.blobId)
        .then(async (plainBytes) => {
          previewBox.textContent = '';
          if (
            isSafeRasterImageMime(item.meta.mime) &&
            !isSvgMime(item.meta.mime, item.meta.name) &&
            !isUntrustedActiveMime(item.meta.mime, item.meta.name)
          ) {
            const img = el('img', 'lightbox-img');
            img.id = 'lightbox-decrypted-image';
            img.alt = item.meta.name;
            img.src = registerObjectUrl(
              new Blob([plainBytes as unknown as BlobPart], { type: item.meta.mime })
            );
            previewBox.appendChild(img);
          } else if (item.category === 'document') {
            const docPreview = await parseClientDocumentPreview(
              plainBytes,
              item.meta.name,
              item.meta.mime
            );
            const pre = el('pre', 'recovery-box', docPreview.paragraphs.join('\n\n'));
            pre.id = 'lightbox-doc-preview';
            pre.dataset.docKind = docPreview.kind;
            previewBox.appendChild(pre);
          } else {
            previewBox.appendChild(
              el(
                'div',
                'media-card-meta',
                `File verificato (${formatBytes(plainBytes.byteLength)}). Usa "Scarica Originale" per salvarlo.`
              )
            );
          }
        })
        .catch((err) => {
          previewBox.textContent = '';
          previewBox.appendChild(
            el(
              'div',
              'alert-banner alert-error',
              err instanceof Error ? err.message : 'Errore decifratura.'
            )
          );
        });
    }

    const exifParts: string[] = [formatBytes(item.meta.size), `v${item.version}`, item.meta.mime];
    if (item.meta.width && item.meta.height) {
      exifParts.push(`${item.meta.width}×${item.meta.height}`);
    }
    if (item.meta.takenAt) {
      exifParts.push(new Date(item.meta.takenAt).toLocaleDateString('it-IT'));
    }
    if (item.meta.exifSubset?.model) {
      exifParts.push(item.meta.exifSubset.model);
    }
    if (item.meta.exifSubset?.iso) {
      exifParts.push(`ISO ${item.meta.exifSubset.iso}`);
    }
    const itemLat = item.meta.exifSubset?.lat;
    const itemLon = item.meta.exifSubset?.lon;
    const hasGps = isValidGpsCoord(itemLat, itemLon);
    if (hasGps) {
      exifParts.push(formatCoordinates(itemLat!, itemLon!));
    }

    const exifRow = el('div', 'exif-meta-bar mono-nums exif-row-flex');
    exifRow.appendChild(el('span', '', exifParts.join(' · ')));
    if (hasGps) {
      const mapJumpBtn = el('button', 'btn btn-ghost btn-compact', 'Vedi su Mappa');
      mapJumpBtn.id = 'btn-lightbox-view-map';
      mapJumpBtn.addEventListener('click', () => {
        mapFocusCoords = { lat: itemLat!, lon: itemLon! };
        selectedLightboxItem = null;
        switchView('map');
      });
      exifRow.appendChild(mapJumpBtn);
    }
    panel.appendChild(exifRow);

    const actionsRow = el('div', 'toolbar-row');

    if (
      isSafeRasterImageMime(item.meta.mime) &&
      !isSvgMime(item.meta.mime, item.meta.name) &&
      item.state === 'active'
    ) {
      const editBtn = el('button', 'btn btn-primary', 'Modifica Foto');
      editBtn.id = 'btn-lightbox-edit';
      editBtn.addEventListener('click', () => {
        closeActiveOverlayModal();
        const targetItem = item;
        selectedLightboxItem = null;
        render();
        activeModalCleanup = openPhotoEditorModal(rootEl!, client, targetItem, {
          onClose: () => {
            activeModalCleanup = null;
            selectedLightboxItem = targetItem;
            render();
          },
          onSavedOverwrite: (updated) => {
            activeModalCleanup = null;
            selectedLightboxItem = updated;
            bannerMessage = {
              type: 'success',
              text: `Foto modificata e sovrascritta in E2EE (v${updated.version}).`,
            };
            render();
          },
          onSavedCopy: (copyName) => {
            activeModalCleanup = null;
            selectedLightboxItem = null;
            bannerMessage = {
              type: 'success',
              text: `Copia modificata cifrata salvata come "${copyName}".`,
            };
            render();
          },
          onError: (msg) => {
            bannerMessage = { type: 'error', text: msg };
          },
        });
      });
      actionsRow.appendChild(editBtn);
    }

    const dlBtn = el('button', 'btn', 'Scarica');
    dlBtn.id = 'btn-lightbox-download';
    dlBtn.addEventListener('click', async () => {
      const plainBytes = await client.downloadBlobToBytes(item.blobId);
      triggerDownload(plainBytes, item.meta.name, item.meta.mime);
    });
    actionsRow.appendChild(dlBtn);

    const favBtn = el('button', 'btn', item.meta.isFavorite ? '★ Preferito' : '☆ Preferito');
    favBtn.id = 'btn-lightbox-favorite';
    favBtn.addEventListener('click', async () => {
      const updated = await client.updateItemMeta(item.id, { isFavorite: !item.meta.isFavorite });
      selectedLightboxItem = updated;
      render();
    });
    actionsRow.appendChild(favBtn);

    const allAlbums = client.getCachedAlbums().albums;
    if (allAlbums.length > 0 && item.state === 'active') {
      const albSelect = el('select', 'form-input');
      albSelect.id = 'lightbox-album-select';
      const placeholderOpt = el('option', '', 'Assegna ad Album...');
      placeholderOpt.value = '';
      albSelect.appendChild(placeholderOpt);
      for (const alb of allAlbums) {
        const inAlb = alb.blobIds.includes(item.blobId);
        const opt = el('option', '', inAlb ? `✓ ${alb.title} (rimuovi)` : `+ ${alb.title}`);
        opt.value = alb.id;
        albSelect.appendChild(opt);
      }
      albSelect.addEventListener('change', async () => {
        const targetId = albSelect.value;
        if (!targetId) return;
        try {
          await client.saveAlbums((cur) => ({
            ...cur,
            albums: cur.albums.map((a) => {
              if (a.id !== targetId) return a;
              const exists = a.blobIds.includes(item.blobId);
              return {
                ...a,
                blobIds: exists
                  ? a.blobIds.filter((b) => b !== item.blobId)
                  : [...a.blobIds, item.blobId],
                updatedAt: Date.now(),
              };
            }),
          }));
          bannerMessage = { type: 'success', text: 'Catalogo album aggiornato.' };
          render();
        } catch (err) {
          bannerMessage = {
            type: 'error',
            text: err instanceof Error ? err.message : 'Errore aggiornamento album.',
          };
          render();
        }
      });
      actionsRow.appendChild(albSelect);
    }

    if (item.state === 'active') {
      const shareBtn = el('button', 'btn', 'Condividi E2EE');
      shareBtn.id = 'btn-lightbox-share';
      shareBtn.addEventListener('click', () => {
        closeActiveOverlayModal();
        const targetItem = item;
        selectedLightboxItem = null;
        render();
        activeModalCleanup = openCreateShareModal(rootEl!, client, {
          itemIds: [targetItem.id],
          defaultTitle: targetItem.meta.name,
          onCreated: (res) => {
            lastCreatedShare = { shareId: res.shareId, shareUrl: res.shareUrl };
          },
          onClose: () => {
            activeModalCleanup = null;
            render();
          },
        });
      });
      actionsRow.appendChild(shareBtn);

      const trashBtn = el('button', 'btn btn-danger', 'Cestino');
      trashBtn.id = 'btn-lightbox-trash';
      trashBtn.addEventListener('click', async () => {
        await client.trashItems([item.id]);
        selectedLightboxItem = null;
        render();
      });
      actionsRow.appendChild(trashBtn);
    } else {
      const restoreBtn = el('button', 'btn btn-primary', 'Ripristina');
      restoreBtn.id = 'btn-lightbox-restore';
      restoreBtn.addEventListener('click', async () => {
        await client.restoreItems([item.id]);
        selectedLightboxItem = null;
        render();
      });
      actionsRow.appendChild(restoreBtn);

      const permDelBtn = el('button', 'btn btn-danger', 'Elimina Definitivamente');
      permDelBtn.id = 'btn-lightbox-delete-permanent';
      permDelBtn.addEventListener('click', async () => {
        await client.deleteItemPermanently(item.id);
        selectedLightboxItem = null;
        render();
      });
      actionsRow.appendChild(permDelBtn);
    }

    panel.appendChild(actionsRow);
    backdrop.appendChild(panel);
    container.appendChild(backdrop);
  }

  render();
}

function renderPublicShareApp(rootEl: HTMLElement, client: ZkVaultClient, shareId: string): void {
  const initialShareHref = window.location.href;
  if (window.location.hash) {
    window.history.replaceState(null, '', window.location.pathname + window.location.search);
  }
  rootEl.textContent = '';
  const header = el('header', 'app-header');
  const brandGroup = el('div', 'brand-group');
  brandGroup.appendChild(el('span', 'brand-title', 'PhotoCloud'));
  const stLine = el('span', 'header-status-line unlocked');
  stLine.appendChild(el('span', 'status-dot status-dot-active'));
  stLine.appendChild(el('span', '', 'Condivisione E2EE'));
  brandGroup.appendChild(stLine);
  header.appendChild(brandGroup);
  const actions = el('div', 'header-actions');
  const homeLink = el('a', 'btn btn-ghost', 'Apri PhotoCloud');
  homeLink.href = '/v2';
  actions.appendChild(homeLink);
  header.appendChild(actions);
  rootEl.appendChild(header);

  const box = el('main', 'auth-container');
  box.appendChild(el('h1', 'brand-title', 'Condivisione Zero-Knowledge'));
  const statusEl = el('div', 'media-card-meta', 'Decifratura shareManifest in corso...');
  statusEl.id = 'share-status-text';
  box.appendChild(statusEl);
  const contentContainer = el('div', '');
  contentContainer.id = 'share-content-container';
  box.appendChild(contentContainer);
  rootEl.appendChild(box);

  const renderOpenedShare = (opened: OpenedShareV2) => {
    contentContainer.textContent = '';
    statusEl.textContent = opened.title
      ? `${opened.title} · ${opened.items.length} file verificati`
      : `${opened.items.length} file condivisi e verificati`;
    const list = el('div', 'shares-list');
    list.id = 'shared-items-list';
    for (const item of opened.items) {
      const row = el('div', 'share-row-card shared-item-row');
      const nameSpan = el('span', 'media-card-title shared-item-name', item.meta.name);
      row.appendChild(nameSpan);
      const dlBtn = el('button', 'btn btn-primary btn-download-shared-item', 'Scarica e Decifra');
      dlBtn.addEventListener('click', async () => {
        const bytes = await client.downloadSharedBlobToBytes(opened, item.blobId);
        dlBtn.dataset.decryptedBytes = String(bytes.byteLength);
        triggerDownload(bytes, item.meta.name, item.meta.mime);
      });
      row.appendChild(dlBtn);
      list.appendChild(row);
    }
    contentContainer.appendChild(list);
  };

  const renderPasswordPrompt = (errMessage?: string) => {
    contentContainer.textContent = '';
    statusEl.textContent = 'Questa condivisione è protetta da password (Argon2id 64 MiB).';
    if (errMessage) {
      const errBanner = el('div', 'alert-banner alert-error', errMessage);
      errBanner.id = 'share-error-banner';
      contentContainer.appendChild(errBanner);
    }
    const fg = el('div', 'form-group');
    const pwInput = el('input', 'form-input');
    pwInput.type = 'password';
    pwInput.id = 'share-unlock-password-input';
    pwInput.placeholder = 'Inserisci la password della condivisione';
    fg.appendChild(pwInput);
    contentContainer.appendChild(fg);

    const unlockBtn = el('button', 'btn btn-primary btn-full', 'Sblocca Condivisione');
    unlockBtn.id = 'btn-share-unlock-password';
    unlockBtn.addEventListener('click', async () => {
      unlockBtn.disabled = true;
      unlockBtn.textContent = 'Decifratura Argon2id in corso...';
      try {
        const opened = await client.openPublicShare(shareId, initialShareHref, pwInput.value);
        renderOpenedShare(opened);
      } catch (err) {
        renderPasswordPrompt(err instanceof Error ? err.message : 'Password errata.');
      }
    });
    contentContainer.appendChild(unlockBtn);
  };

  client
    .openPublicShare(shareId, initialShareHref)
    .then((opened) => {
      renderOpenedShare(opened);
    })
    .catch((err) => {
      const msg = err instanceof Error ? err.message : 'Impossibile decifrare la condivisione.';
      if (/protetta da password|PASSWORD/i.test(msg)) {
        renderPasswordPrompt();
      } else {
        contentContainer.textContent = '';
        statusEl.textContent = 'Accesso alla condivisione non riuscito.';
        const errBanner = el(
          'div',
          'alert-banner alert-error',
          /404/.test(msg)
            ? 'Link di condivisione non valido, scaduto o revocato (404).'
            : msg
        );
        errBanner.id = 'share-error-banner';
        contentContainer.appendChild(errBanner);
      }
    });
}

if (typeof window !== 'undefined' && typeof document !== 'undefined') {
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => initZkWebApp());
  } else {
    initZkWebApp();
  }
}
