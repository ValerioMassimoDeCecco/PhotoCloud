import {
  ZkVaultClient,
  evaluatePassphraseStrength,
  isSafeRasterImageMime,
  isSvgMime,
  isUntrustedActiveMime,
  parseClientDocumentPreview,
  zeroize,
  type DecryptedItemV2,
  type KdfPinningStore,
  type OpenedShareV2,
  type PinnedKdfRecord,
  type PreparedRegistrationV2,
  type TimelineGroupModeV2,
  type ZkKeyFileV2,
} from '../zk-sdk/index.ts';
import {
  DEFAULT_PHOTO_EDIT_STATE,
  normalizeRotation,
  transformRgbPixel,
} from '../../lib/photoEditorMath.ts';

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

  let bannerMessage: { type: 'error' | 'warning' | 'success'; text: string } | null = null;
  let currentView: 'gallery' | 'albums' | 'trash' = 'gallery';
  let groupMode: TimelineGroupModeV2 = 'day';
  let searchQuery = '';
  let preparedReg: PreparedRegistrationV2 | null = null;
  let pendingRegPassphrase = '';
  let pendingRegSetupToken = '';
  let loadedKeyFile: ZkKeyFileV2 | null = null;
  let lastGeneratedKeyFile: { keyFile: ZkKeyFileV2; fileName: string } | null = null;
  let lastCreatedShare: { shareId: string; shareUrl: string } | null = null;
  let selectedLightboxItem: DecryptedItemV2 | null = null;

  const client = new ZkVaultClient({
    pinningStore: new BrowserLocalStoragePinStore(),
    onAutoLock: () => {
      revokeAllObjectUrls();
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

  function render(): void {
    rootEl!.textContent = '';

    const header = el('header', 'app-header');
    const brandGroup = el('div', 'brand-group');
    brandGroup.appendChild(el('span', 'brand-title', 'PhotoCloud v2'));
    const badge = el(
      'span',
      'e2ee-badge',
      client.isUnlocked() ? 'E2EE Attivo (Vault Sbloccato)' : 'Zero-Knowledge E2EE'
    );
    badge.id = 'e2ee-status-badge';
    brandGroup.appendChild(badge);
    header.appendChild(brandGroup);

    const actions = el('div', 'header-actions');
    const backV1Link = el('a', 'btn btn-ghost', 'PhotoCloud Classico');
    backV1Link.id = 'btn-back-v1';
    backV1Link.href = '/';
    backV1Link.title = 'Torna a PhotoCloud Classico (v1)';
    actions.appendChild(backV1Link);

    if (client.isUnlocked()) {
      const userLabel = el('span', 'media-card-meta user-chip', `Utente: ${client.getUsername() ?? ''}`);
      actions.appendChild(userLabel);

      if (lastGeneratedKeyFile) {
        const dlKeyBtn = el('button', 'btn', 'Scarica Keyfile JSON');
        dlKeyBtn.id = 'btn-download-keyfile';
        dlKeyBtn.title =
          'Il Keyfile JSON contiene la tua Account Key (32B), ma NON contiene la Passphrase. Passphrase persa = dati non recuperabili.';
        dlKeyBtn.addEventListener('click', () => {
          const jsonStr = JSON.stringify(lastGeneratedKeyFile!.keyFile, null, 2);
          dlKeyBtn.dataset.lastDownloadedJson = jsonStr;
          const bytes = new TextEncoder().encode(jsonStr);
          triggerDownload(bytes, lastGeneratedKeyFile!.fileName, 'application/json');
        });
        actions.appendChild(dlKeyBtn);
      }

      const lockBtn = el('button', 'btn', 'Blocca Vault');
      lockBtn.id = 'btn-lock-vault';
      lockBtn.addEventListener('click', () => {
        client.lock();
        revokeAllObjectUrls();
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
        await client.logout();
        revokeAllObjectUrls();
        if (navigator.serviceWorker?.controller) {
          navigator.serviceWorker.controller.postMessage({ type: 'LOCK_ALL_KEYS' });
        }
        loadedKeyFile = null;
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

  let authTab: 'login' | 'register' | 'recovery' = 'login';

  function renderAuthView(container: HTMLElement): void {
    const box = el('main', 'auth-container');

    const authHero = el('div', 'auth-hero');
    authHero.appendChild(el('h1', 'auth-hero-title', 'Vault Zero-Knowledge'));
    authHero.appendChild(
      el(
        'p',
        'auth-hero-sub',
        'Cifratura client-side Argon2id + AES-256-GCM. Le tue chiavi non lasciano mai il dispositivo.'
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

    const regTabBtn = el('button', `tab-btn ${authTab === 'register' ? 'active' : ''}`, 'Registrati');
    regTabBtn.id = 'tab-register';
    regTabBtn.addEventListener('click', () => {
      authTab = 'register';
      bannerMessage = null;
      render();
    });

    const recTabBtn = el('button', `tab-btn ${authTab === 'recovery' ? 'active' : ''}`, 'Recovery Code');
    recTabBtn.id = 'tab-recovery';
    recTabBtn.addEventListener('click', () => {
      authTab = 'recovery';
      bannerMessage = null;
      render();
    });

    tabs.appendChild(loginTabBtn);
    tabs.appendChild(regTabBtn);
    tabs.appendChild(recTabBtn);
    box.appendChild(tabs);

    if (authTab === 'login') {
      const fgFile = el('div', 'form-group');
      fgFile.appendChild(el('label', 'form-label', 'Keyfile JSON (.json)'));
      const fileInput = el('input', 'form-input');
      fileInput.type = 'file';
      fileInput.id = 'login-keyfile-input';
      fileInput.accept = '.json,application/json';
      const keyfileMetaEl = el(
        'div',
        'media-card-meta',
        loadedKeyFile ? `Utente keyfile: ${loadedKeyFile.username}` : ''
      );
      keyfileMetaEl.id = 'login-keyfile-status';
      fileInput.addEventListener('change', async () => {
        const f = fileInput.files?.[0];
        if (!f) return;
        try {
          const txt = await f.text();
          loadedKeyFile = JSON.parse(txt) as ZkKeyFileV2;
          keyfileMetaEl.textContent = `Utente keyfile: ${loadedKeyFile.username}`;
        } catch {
          loadedKeyFile = null;
          keyfileMetaEl.textContent = 'File keyfile JSON non valido.';
        }
      });
      fgFile.appendChild(fileInput);
      fgFile.appendChild(keyfileMetaEl);
      box.appendChild(fgFile);

      const fgPass = el('div', 'form-group');
      fgPass.appendChild(el('label', 'form-label', 'Passphrase'));
      const passInput = el('input', 'form-input');
      passInput.type = 'password';
      passInput.id = 'login-passphrase-input';
      passInput.placeholder = 'Inserisci la tua passphrase (>= 12 caratteri)';
      fgPass.appendChild(passInput);
      box.appendChild(fgPass);

      const submitBtn = el('button', 'btn btn-primary', 'Sblocca Vault');
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
          bannerMessage = { type: 'error', text: 'Carica prima il tuo Keyfile JSON.' };
          render();
          return;
        }
        submitBtn.disabled = true;
        submitBtn.textContent = 'Derivazione chiavi Argon2id (64 MiB, t=3) in corso...';
        try {
          await client.login(loadedKeyFile, passInput.value);
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
      const warningNotice = el(
        'div',
        'alert-banner alert-warning',
        'AVVISO CRITICO ZERO-KNOWLEDGE: Il Recovery Code (codifica esadecimale della tua Account Key a 32 byte) sostituisce SOLO il Keyfile JSON, ma NON sostituisce MAI la tua Passphrase. Passphrase persa = dati matematicamente non recuperabili.'
      );
      warningNotice.id = 'reg-warning-unrecoverable';
      box.appendChild(warningNotice);

      if (!preparedReg) {
        const fgUser = el('div', 'form-group');
        fgUser.appendChild(el('label', 'form-label', 'Username'));
        const userInput = el('input', 'form-input');
        userInput.type = 'text';
        userInput.id = 'reg-username-input';
        userInput.placeholder = 'es. alice';
        fgUser.appendChild(userInput);
        box.appendChild(fgUser);

        const fgToken = el('div', 'form-group');
        fgToken.appendChild(el('label', 'form-label', 'Setup Token / Invite Token'));
        const tokenInput = el('input', 'form-input');
        tokenInput.type = 'text';
        tokenInput.id = 'reg-setup-token-input';
        tokenInput.placeholder = 'Token stampato su stdout dal server al primo avvio';
        fgToken.appendChild(tokenInput);
        box.appendChild(fgToken);

        const fgPass = el('div', 'form-group');
        fgPass.appendChild(el('label', 'form-label', 'Passphrase (minimo 12 caratteri)'));
        const passInput = el('input', 'form-input');
        passInput.type = 'password';
        passInput.id = 'reg-passphrase-input';
        const strengthInfo = el('div', 'media-card-meta', '');
        strengthInfo.id = 'reg-passphrase-strength';
        passInput.addEventListener('input', () => {
          const st = evaluatePassphraseStrength(passInput.value);
          strengthInfo.textContent = `${st.feedback} (${st.estimatedBits} bit stimati)`;
        });
        fgPass.appendChild(passInput);
        fgPass.appendChild(strengthInfo);
        box.appendChild(fgPass);

        const prepBtn = el('button', 'btn btn-primary', 'Genera Chiavi e Recovery Code');
        prepBtn.id = 'btn-reg-prepare';
        prepBtn.addEventListener('click', () => {
          try {
            preparedReg = client.prepareRegistration(userInput.value, passInput.value);
            pendingRegPassphrase = passInput.value;
            pendingRegSetupToken = tokenInput.value.trim();
            bannerMessage = null;
            render();
          } catch (err) {
            bannerMessage = {
              type: 'error',
              text: err instanceof Error ? err.message : 'Parametri non validi.',
            };
            render();
          }
        });
        box.appendChild(prepBtn);
      } else {
        const recNotice = el(
          'p',
          'form-label',
          'Salva questo Recovery Code (rappresenta la tua Account Key a 32 byte). Ricorda: il Recovery Code sostituisce il Keyfile JSON in caso di perdita del dispositivo, ma NON sostituisce la Passphrase. Se perdi la Passphrase, i dati sono irrecuperabili:'
        );
        recNotice.id = 'reg-recovery-notice';
        box.appendChild(recNotice);

        const codeBox = el('div', 'recovery-box', preparedReg.recoveryCode);
        codeBox.id = 'reg-recovery-code-display';
        box.appendChild(codeBox);

        const fgConfirm = el('div', 'form-group');
        fgConfirm.appendChild(
          el('label', 'form-label', 'Riscrivi o incolla il Recovery Code per confermare il backup')
        );
        const confirmInput = el('input', 'form-input');
        confirmInput.type = 'text';
        confirmInput.id = 'reg-recovery-confirm-input';
        confirmInput.placeholder = 'Incolla qui il Recovery Code completo';
        fgConfirm.appendChild(confirmInput);
        box.appendChild(fgConfirm);

        const completeBtn = el('button', 'btn btn-primary', 'Completa Registrazione e Sblocca Vault');
        completeBtn.id = 'btn-reg-complete';
        completeBtn.addEventListener('click', async () => {
          completeBtn.disabled = true;
          completeBtn.textContent = 'Registrazione e derivazione Argon2id (64 MiB, t=3) in corso...';
          try {
            const res = await client.register(
              preparedReg!,
              pendingRegPassphrase,
              confirmInput.value,
              { setupToken: pendingRegSetupToken }
            );
            lastGeneratedKeyFile = { keyFile: res.keyFile, fileName: res.keyFileFileName };
            loadedKeyFile = res.keyFile;
            preparedReg = null;
            pendingRegPassphrase = '';
            bannerMessage = {
              type: 'success',
              text: `Registrazione completata! Il tuo Keyfile (${res.keyFileFileName}) è pronto. Nota: il Keyfile e il Recovery Code non contengono la Passphrase (passphrase persa = dati non recuperabili).`,
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
        box.appendChild(completeBtn);
      }
    } else if (authTab === 'recovery') {
      const recExplain = el(
        'div',
        'alert-banner alert-warning',
        'Il Recovery Code ricostruisce il tuo Keyfile JSON (Account Key a 32 byte), ma richiede comunque la tua Passphrase originale per sbloccare il vault. Senza la Passphrase i dati non sono recuperabili.'
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
      fgCode.appendChild(el('label', 'form-label', 'Recovery Code (8 gruppi da 8 caratteri hex = Account Key)'));
      const codeInput = el('input', 'form-input');
      codeInput.type = 'text';
      codeInput.id = 'rec-code-input';
      fgCode.appendChild(codeInput);
      box.appendChild(fgCode);

      const fgPass = el('div', 'form-group');
      fgPass.appendChild(el('label', 'form-label', 'Passphrase (Obbligatoria)'));
      const passInput = el('input', 'form-input');
      passInput.type = 'password';
      passInput.id = 'rec-passphrase-input';
      fgPass.appendChild(passInput);
      box.appendChild(fgPass);

      const recBtn = el('button', 'btn btn-primary', 'Ricostruisci Keyfile e Accedi');
      recBtn.id = 'btn-rec-submit';
      recBtn.addEventListener('click', async () => {
        try {
          const kf = client.recoverKeyFileFromRecoveryCode(userInput.value, codeInput.value);
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
    const navList = el('div', 'nav-list');

    const galBtn = el('button', `nav-item ${currentView === 'gallery' ? 'active' : ''}`, 'Galleria Media');
    galBtn.id = 'nav-gallery';
    galBtn.addEventListener('click', () => {
      currentView = 'gallery';
      render();
    });

    const albBtn = el('button', `nav-item ${currentView === 'albums' ? 'active' : ''}`, 'Album Cifrati');
    albBtn.id = 'nav-albums';
    albBtn.addEventListener('click', () => {
      currentView = 'albums';
      render();
    });

    const trashBtn = el('button', `nav-item ${currentView === 'trash' ? 'active' : ''}`, 'Cestino');
    trashBtn.id = 'nav-trash';
    trashBtn.addEventListener('click', () => {
      currentView = 'trash';
      render();
    });

    navList.appendChild(galBtn);
    navList.appendChild(albBtn);
    navList.appendChild(trashBtn);
    sidebar.appendChild(navList);

    const uploadPanel = el('div', 'stats-box');
    uploadPanel.appendChild(el('div', 'form-label', 'Carica File Cifrati (E2EE)'));
    const fileInput = el('input', 'form-input');
    fileInput.type = 'file';
    fileInput.multiple = true;
    fileInput.id = 'vault-upload-input';
    uploadPanel.appendChild(fileInput);

    const statusLine = el('div', 'media-card-meta', 'Pronto per la cifratura locale');
    statusLine.id = 'upload-status-line';
    uploadPanel.appendChild(statusLine);

    fileInput.addEventListener('change', async () => {
      const files = Array.from(fileInput.files ?? []);
      if (files.length === 0) return;
      statusLine.textContent = `Cifratura e upload di ${files.length} file in corso...`;
      try {
        for (const f of files) {
          const thumbs = await generateBrowserImageThumbs(f);
          const bytes = new Uint8Array(await f.arrayBuffer());
          await client.uploadFile({
            name: f.name,
            mimeType: f.type || 'application/octet-stream',
            size: f.size,
            source: bytes,
            lastModified: f.lastModified,
            width: thumbs.width,
            height: thumbs.height,
            thumb320Plaintext: thumbs.thumb320,
            thumb1280Plaintext: thumbs.thumb1280,
          });
        }
        await client.syncItems('all');
        bannerMessage = { type: 'success', text: `${files.length} file cifrati e caricati con successo.` };
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

    if (lastGeneratedKeyFile) {
      const kfWarningBox = el('div', 'stats-box');
      kfWarningBox.id = 'keyfile-passphrase-warning';
      kfWarningBox.appendChild(
        el(
          'div',
          'media-card-meta',
          'Promemoria Sicurezza: Il Keyfile JSON e il Recovery Code contengono solo la Account Key (32B) e NON sostituiscono la Passphrase. Passphrase persa = dati non recuperabili.'
        )
      );
      sidebar.appendChild(kfWarningBox);
    }

    const statsBox = el('div', 'stats-box');
    const activeItems = client.getItems('active');
    const trashedItems = client.getItems('trashed');
    const activeCountEl = el('div', '', `Elementi attivi: ${activeItems.length}`);
    activeCountEl.id = 'stats-active-count';
    const trashedCountEl = el('div', '', `Nel cestino: ${trashedItems.length}`);
    trashedCountEl.id = 'stats-trashed-count';
    statsBox.appendChild(activeCountEl);
    statsBox.appendChild(trashedCountEl);
    sidebar.appendChild(statsBox);

    layout.appendChild(sidebar);

    const main = el('main', 'main-area');
    if (bannerMessage) {
      const alert = el('div', `alert-banner alert-${bannerMessage.type}`, bannerMessage.text);
      alert.id = 'workspace-alert-banner';
      main.appendChild(alert);
    }

    if (lastCreatedShare) {
      const shareBanner = el('div', 'toolbar-row');
      shareBanner.id = 'last-share-banner';
      const urlSpan = el('span', 'media-card-meta', lastCreatedShare.shareUrl);
      urlSpan.id = 'last-share-url-display';
      shareBanner.appendChild(urlSpan);

      const revokeBtn = el('button', 'btn btn-danger', 'Revoca Ultimo Link');
      revokeBtn.id = 'btn-revoke-last-share';
      revokeBtn.addEventListener('click', async () => {
        if (!lastCreatedShare) return;
        const idToRevoke = lastCreatedShare.shareId;
        await client.revokeShare(idToRevoke);
        bannerMessage = { type: 'success', text: `Link di condivisione ${idToRevoke} revocato.` };
        lastCreatedShare = null;
        render();
      });
      shareBanner.appendChild(revokeBtn);
      main.appendChild(shareBanner);
    }

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

    const groupSelect = el('select', 'form-input');
    groupSelect.id = 'vault-group-select';
    for (const [val, label] of [
      ['day', 'Raggruppa per Giorno'],
      ['month', 'Raggruppa per Mese'],
      ['year', 'Raggruppa per Anno'],
      ['album', 'Raggruppa per Album'],
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

    const zipBtn = el('button', 'btn', 'Esporta ZIP');
    zipBtn.id = 'btn-export-zip';
    zipBtn.addEventListener('click', async () => {
      const items = client.getItems('active');
      if (items.length === 0) return;
      const stream = client.exportZipStream(items.map((i) => i.id));
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
      const sigHex =
        out.byteLength >= 4
          ? Array.from(out.subarray(0, 4))
              .map((b) => b.toString(16).padStart(2, '0'))
              .join('')
          : '';
      zipBtn.dataset.lastZipBytes = String(out.byteLength);
      zipBtn.dataset.lastZipMagic = sigHex;
      triggerDownload(out, 'photocloud_v2_export.zip', 'application/zip');
      bannerMessage = {
        type: 'success',
        text: `Archivio ZIP esportato in streaming (${formatBytes(out.byteLength)}).`,
      };
      render();
    });
    toolbar.appendChild(zipBtn);

    if (currentView === 'trash' && trashedItems.length > 0) {
      const emptyTrashBtn = el('button', 'btn btn-danger', 'Svuota Cestino');
      emptyTrashBtn.id = 'btn-empty-trash';
      emptyTrashBtn.addEventListener('click', async () => {
        await client.emptyTrash();
        bannerMessage = { type: 'success', text: 'Cestino svuotato definitivamente.' };
        render();
      });
      toolbar.appendChild(emptyTrashBtn);
    }

    main.appendChild(toolbar);

    const gridContainer = el('div', '');
    gridContainer.id = 'vault-grid-container';
    renderGalleryGrid(gridContainer);
    main.appendChild(gridContainer);

    layout.appendChild(main);
    container.appendChild(layout);
  }

  function renderGalleryGrid(container: HTMLElement): void {
    container.textContent = '';

    const items =
      currentView === 'trash'
        ? client.getItems('trashed')
        : searchQuery.trim()
          ? client.searchItems(searchQuery)
          : client.getItems('active');

    if (items.length === 0) {
      const empty = el(
        'div',
        'alert-banner',
        currentView === 'trash' ? 'Il cestino è vuoto.' : 'Nessun elemento nel vault.'
      );
      empty.id = 'vault-empty-state';
      container.appendChild(empty);
      return;
    }

    const grid = el('div', 'gallery-grid');
    for (const item of items) {
      const card = el('article', 'media-card');
      card.dataset.itemId = item.id;
      card.dataset.itemName = item.meta.name;

      const thumbBox = el('div', 'media-thumb-box');
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
        thumbBox.appendChild(el('span', 'media-card-meta', item.category.toUpperCase()));
      }
      card.appendChild(thumbBox);

      const body = el('div', 'media-card-body');
      const titleEl = el('div', 'media-card-title', item.meta.name);
      body.appendChild(titleEl);
      body.appendChild(
        el(
          'div',
          'media-card-meta',
          `${formatBytes(item.meta.size)} • v${item.version} • ${item.meta.mime}`
        )
      );
      card.appendChild(body);

      card.addEventListener('click', () => {
        selectedLightboxItem = item;
        render();
      });

      grid.appendChild(card);
    }

    container.appendChild(grid);
  }

  function renderLightboxModal(container: HTMLElement, item: DecryptedItemV2): void {
    const backdrop = el('div', 'modal-backdrop');
    backdrop.id = 'lightbox-modal';

    const panel = el('div', 'modal-panel');
    const topRow = el('div', 'toolbar-row');
    const title = el('h2', 'brand-title', `${item.meta.name} (v${item.version})`);
    title.id = 'lightbox-item-title';
    topRow.appendChild(title);

    const closeBtn = el('button', 'btn', 'Chiudi');
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
            video.src = registerObjectUrl(new Blob([plainBytes as unknown as BlobPart], { type: item.meta.mime }));
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
            img.src = registerObjectUrl(new Blob([plainBytes as unknown as BlobPart], { type: item.meta.mime }));
            previewBox.appendChild(img);
          } else if (item.category === 'document') {
            const docPreview = await parseClientDocumentPreview(plainBytes, item.meta.name, item.meta.mime);
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
            el('div', 'alert-banner alert-error', err instanceof Error ? err.message : 'Errore decifratura.')
          );
        });
    }

    const actionsRow = el('div', 'toolbar-row');

    const dlBtn = el('button', 'btn btn-primary', 'Scarica Originale');
    dlBtn.id = 'btn-lightbox-download';
    dlBtn.addEventListener('click', async () => {
      const plainBytes = await client.downloadBlobToBytes(item.blobId);
      triggerDownload(plainBytes, item.meta.name, item.meta.mime);
    });
    actionsRow.appendChild(dlBtn);

    const favBtn = el('button', 'btn', item.meta.isFavorite ? 'Rimuovi Preferito' : 'Aggiungi Preferito');
    favBtn.id = 'btn-lightbox-favorite';
    favBtn.addEventListener('click', async () => {
      const updated = await client.updateItemMeta(item.id, { isFavorite: !item.meta.isFavorite });
      selectedLightboxItem = updated;
      render();
    });
    actionsRow.appendChild(favBtn);

    const sharePwInput = el('input', 'form-input');
    sharePwInput.type = 'password';
    sharePwInput.id = 'share-password-input';
    sharePwInput.placeholder = 'Password share opzionale';
    actionsRow.appendChild(sharePwInput);

    const shareBtn = el('button', 'btn', 'Condividi Link E2EE');
    shareBtn.id = 'btn-lightbox-share';
    shareBtn.addEventListener('click', async () => {
      const pw = sharePwInput.value.trim();
      const res = await client.createShare(
        {
          itemIds: [item.id],
          title: item.meta.name,
          password: pw.length > 0 ? pw : undefined,
        },
        window.location.origin
      );
      lastCreatedShare = { shareId: res.shareId, shareUrl: res.shareUrl };
      bannerMessage = {
        type: 'success',
        text: `Link E2EE creato (chiave nel fragment #): ${res.shareUrl}`,
      };
      selectedLightboxItem = null;
      render();
    });
    actionsRow.appendChild(shareBtn);

    if (isSafeRasterImageMime(item.meta.mime)) {
      const editOverwriteBtn = el('button', 'btn', 'Ruota 90° e Sovrascrivi (E2EE)');
      editOverwriteBtn.id = 'btn-lightbox-rotate-save';
      editOverwriteBtn.addEventListener('click', async () => {
        const plainBytes = await client.downloadBlobToBytes(item.blobId);
        const editState = {
          ...DEFAULT_PHOTO_EDIT_STATE,
          rotation: normalizeRotation(DEFAULT_PHOTO_EDIT_STATE.rotation + 90),
          brightness: 4,
        };
        transformRgbPixel(255, 128, 64, editState);
        const updated = await client.replaceItemWithEditedBlob(item.id, plainBytes, {
          name: item.meta.name,
        });
        selectedLightboxItem = updated;
        bannerMessage = {
          type: 'success',
          text: `Immagine sovrascritta alla versione v${updated.version}.`,
        };
        render();
      });
      actionsRow.appendChild(editOverwriteBtn);

      const editSaveCopyBtn = el('button', 'btn', 'Salva come Copia (E2EE)');
      editSaveCopyBtn.id = 'btn-lightbox-save-copy';
      editSaveCopyBtn.addEventListener('click', async () => {
        const plainBytes = await client.downloadBlobToBytes(item.blobId);
        const editState = {
          ...DEFAULT_PHOTO_EDIT_STATE,
          rotation: normalizeRotation(DEFAULT_PHOTO_EDIT_STATE.rotation + 90),
          contrast: 8,
        };
        transformRgbPixel(200, 100, 50, editState);
        const dotIdx = item.meta.name.lastIndexOf('.');
        const copyName =
          dotIdx > 0
            ? `${item.meta.name.slice(0, dotIdx)}_copia${item.meta.name.slice(dotIdx)}`
            : `${item.meta.name}_copia`;
        await client.uploadFile({
          name: copyName,
          mimeType: item.meta.mime,
          size: plainBytes.byteLength,
          source: plainBytes,
        });
        await client.syncItems('all');
        selectedLightboxItem = null;
        bannerMessage = {
          type: 'success',
          text: `Copia modificata salvata come "${copyName}".`,
        };
        render();
      });
      actionsRow.appendChild(editSaveCopyBtn);
    }

    if (item.state === 'active') {
      const trashBtn = el('button', 'btn btn-danger', 'Sposta nel Cestino');
      trashBtn.id = 'btn-lightbox-trash';
      trashBtn.addEventListener('click', async () => {
        await client.trashItems([item.id]);
        selectedLightboxItem = null;
        render();
      });
      actionsRow.appendChild(trashBtn);
    } else {
      const restoreBtn = el('button', 'btn', 'Ripristina');
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
  brandGroup.appendChild(el('span', 'brand-title', 'PhotoCloud v2'));
  brandGroup.appendChild(el('span', 'e2ee-badge', 'Condivisione E2EE'));
  header.appendChild(brandGroup);
  const actions = el('div', 'header-actions');
  const homeLink = el('a', 'btn btn-ghost', 'Apri PhotoCloud');
  homeLink.href = '/v2';
  actions.appendChild(homeLink);
  header.appendChild(actions);
  rootEl.appendChild(header);

  const box = el('main', 'auth-container');
  box.appendChild(el('h1', 'brand-title', 'Condivisione Pubblica Zero-Knowledge'));
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
      ? `Collezione: ${opened.title} (${opened.items.length} file)`
      : `${opened.items.length} file condivisi e verificati.`;
    const list = el('div', '');
    list.id = 'shared-items-list';
    for (const item of opened.items) {
      const row = el('div', 'toolbar-row');
      row.className = 'toolbar-row shared-item-row';
      const nameSpan = el('span', 'media-card-title', item.meta.name);
      nameSpan.className = 'media-card-title shared-item-name';
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

    const unlockBtn = el('button', 'btn btn-primary', 'Sblocca Condivisione');
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
