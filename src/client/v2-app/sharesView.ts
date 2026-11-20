import type {
  CreateShareResultV2,
  OwnerShareSummaryV2,
  ZkVaultClient,
} from '../zk-sdk/index.ts';

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

function formatDateShort(ms: number): string {
  return new Date(ms).toLocaleDateString('it-IT', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
  });
}

async function copyTextSafe(text: string): Promise<boolean> {
  try {
    if (navigator.clipboard && typeof navigator.clipboard.writeText === 'function') {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch {
    // fallback below
  }
  try {
    const ta = document.createElement('textarea');
    ta.value = text;
    ta.style.position = 'fixed';
    ta.style.opacity = '0';
    document.body.appendChild(ta);
    ta.select();
    const ok = document.execCommand('copy');
    ta.remove();
    return ok;
  } catch {
    return false;
  }
}

export interface CreateShareModalOptions {
  itemIds: string[];
  defaultTitle: string;
  onCreated: (res: CreateShareResultV2) => void;
  onClose: () => void;
}

export function openCreateShareModal(
  container: HTMLElement,
  client: ZkVaultClient,
  opts: CreateShareModalOptions
): () => void {
  const backdrop = el('div', 'modal-backdrop');
  backdrop.id = 'create-share-modal';

  const panel = el('div', 'modal-panel share-modal-panel');
  const topRow = el('div', 'toolbar-row');
  topRow.appendChild(
    el(
      'h2',
      'brand-title',
      opts.itemIds.length === 1
        ? 'Condividi File E2EE'
        : `Condividi ${opts.itemIds.length} Elementi E2EE`
    )
  );
  const closeBtn = el('button', 'btn btn-ghost', 'Chiudi');
  closeBtn.id = 'btn-share-modal-close';
  closeBtn.addEventListener('click', () => {
    backdrop.remove();
    opts.onClose();
  });
  topRow.appendChild(closeBtn);
  panel.appendChild(topRow);

  const infoNote = el(
    'p',
    'media-card-meta',
    'La chiave di decifratura (256-bit) vive solo nel fragment # dell\'URL e non viene mai trasmessa al server.'
  );
  panel.appendChild(infoNote);

  const fgTitle = el('div', 'form-group');
  fgTitle.appendChild(el('label', 'form-label', 'Titolo Condivisione (cifrato)'));
  const titleInput = el('input', 'form-input');
  titleInput.type = 'text';
  titleInput.id = 'share-modal-title';
  titleInput.value = opts.defaultTitle;
  titleInput.placeholder = 'es. Vacanze Dolomiti 2026';
  fgTitle.appendChild(titleInput);
  panel.appendChild(fgTitle);

  const rowTwo = el('div', 'share-options-grid');

  const fgExp = el('div', 'form-group');
  fgExp.appendChild(el('label', 'form-label', 'Scadenza'));
  const expSelect = el('select', 'form-input');
  expSelect.id = 'share-modal-expiry';
  for (const [val, label] of [
    ['0', 'Nessuna scadenza'],
    [String(24 * 60 * 60 * 1000), '24 ore'],
    [String(7 * 24 * 60 * 60 * 1000), '7 giorni'],
    [String(30 * 24 * 60 * 60 * 1000), '30 giorni'],
  ]) {
    const o = el('option', '', label);
    o.value = val;
    expSelect.appendChild(o);
  }
  fgExp.appendChild(expSelect);
  rowTwo.appendChild(fgExp);

  const fgMax = el('div', 'form-group');
  fgMax.appendChild(el('label', 'form-label', 'Limite Download'));
  const maxSelect = el('select', 'form-input');
  maxSelect.id = 'share-modal-max-downloads';
  for (const [val, label] of [
    ['0', 'Illimitati'],
    ['1', '1 download'],
    ['5', '5 download'],
    ['10', '10 download'],
    ['50', '50 download'],
  ]) {
    const o = el('option', '', label);
    o.value = val;
    maxSelect.appendChild(o);
  }
  fgMax.appendChild(maxSelect);
  rowTwo.appendChild(fgMax);
  panel.appendChild(rowTwo);

  const fgPw = el('div', 'form-group');
  fgPw.appendChild(el('label', 'form-label', 'Password Aggiuntiva (Opzionale — Argon2id)'));
  const pwInput = el('input', 'form-input');
  pwInput.type = 'password';
  pwInput.id = 'share-modal-password';
  pwInput.placeholder = 'Lascia vuoto per accesso diretto tramite link #chiave';
  fgPw.appendChild(pwInput);
  panel.appendChild(fgPw);

  const errBox = el('div', 'alert-banner alert-error hidden', '');
  panel.appendChild(errBox);

  const resultBox = el('div', 'share-result-box hidden');
  resultBox.id = 'share-modal-result';
  panel.appendChild(resultBox);

  const footerRow = el('div', 'toolbar-row');
  const createBtn = el('button', 'btn btn-primary', 'Genera Link E2EE');
  createBtn.id = 'btn-share-modal-submit';
  createBtn.addEventListener('click', async () => {
    errBox.classList.add('hidden');
    createBtn.disabled = true;
    createBtn.textContent = 'Cifratura chiavi di condivisione...';
    try {
      const expMs = Number(expSelect.value);
      const maxDl = Number(maxSelect.value);
      const pw = pwInput.value.trim();
      const res = await client.createShare(
        {
          itemIds: opts.itemIds,
          title: titleInput.value.trim() || opts.defaultTitle,
          expiresAt: expMs > 0 ? Date.now() + expMs : null,
          maxDownloads: maxDl > 0 ? maxDl : null,
          password: pw.length > 0 ? pw : undefined,
        },
        window.location.origin
      );
      resultBox.textContent = '';
      resultBox.classList.remove('hidden');
      resultBox.appendChild(el('div', 'form-label', 'Link E2EE pronto (chiave nel fragment #):'));
      const urlCode = el('div', 'recovery-box mono-nums', res.shareUrl);
      urlCode.id = 'share-modal-url-display';
      resultBox.appendChild(urlCode);

      const copyBtn = el('button', 'btn btn-primary', 'Copia Link Completo');
      copyBtn.id = 'btn-share-modal-copy';
      copyBtn.addEventListener('click', async () => {
        const ok = await copyTextSafe(res.shareUrl);
        copyBtn.textContent = ok ? 'Link Copiato' : 'Copia non riuscita';
      });
      resultBox.appendChild(copyBtn);

      createBtn.classList.add('hidden');
      opts.onCreated(res);
    } catch (err) {
      createBtn.disabled = false;
      createBtn.textContent = 'Genera Link E2EE';
      errBox.textContent = err instanceof Error ? err.message : 'Creazione condivisione fallita.';
      errBox.classList.remove('hidden');
    }
  });
  footerRow.appendChild(createBtn);
  panel.appendChild(footerRow);

  backdrop.appendChild(panel);
  container.appendChild(backdrop);

  return () => backdrop.remove();
}

export interface SharesViewCallbacks {
  onStatusMessage: (type: 'success' | 'error', text: string) => void;
  onRefreshRequested: () => void;
}

export function renderSharesManagementView(
  container: HTMLElement,
  client: ZkVaultClient,
  shares: OwnerShareSummaryV2[],
  loading: boolean,
  callbacks: SharesViewCallbacks
): void {
  container.textContent = '';

  const headRow = el('div', 'toolbar-row');
  const titleBlock = el('div', 'map-toolbar-left');
  titleBlock.appendChild(el('span', 'brand-title', 'Condivisioni E2EE'));
  titleBlock.appendChild(
    el(
      'span',
      'media-card-meta mono-nums',
      `${shares.length} ${shares.length === 1 ? 'link gestito' : 'link gestiti'} · Metadati decifrati localmente`
    )
  );
  headRow.appendChild(titleBlock);

  const refreshBtn = el('button', 'btn', 'Aggiorna');
  refreshBtn.id = 'btn-shares-refresh';
  refreshBtn.addEventListener('click', () => callbacks.onRefreshRequested());
  headRow.appendChild(refreshBtn);
  container.appendChild(headRow);

  if (loading) {
    container.appendChild(el('div', 'alert-banner', 'Caricamento e decifratura elenco condivisioni...'));
    return;
  }

  if (shares.length === 0) {
    const empty = el('div', 'empty-state-card');
    empty.id = 'shares-empty-state';
    empty.appendChild(el('h3', 'brand-title', 'Nessuna condivisione attiva'));
    empty.appendChild(
      el(
        'p',
        'media-card-meta',
        'Seleziona uno o più file dalla Galleria e clicca "Condividi" per creare un link Zero-Knowledge con chiave nel fragment #.'
      )
    );
    container.appendChild(empty);
    return;
  }

  const list = el('div', 'shares-list');
  list.id = 'owner-shares-list';

  let pendingConfirmRevokeId: string | null = null;

  const renderRows = () => {
    list.textContent = '';
    for (const share of shares) {
      const card = el('article', 'share-row-card');
      card.dataset.shareId = share.shareId;

      const left = el('div', 'share-row-info');
      const titleLine = el('div', 'share-row-title-line');
      const dotCls =
        share.status === 'active'
          ? 'status-dot-active'
          : share.status === 'expired'
            ? 'status-dot-warn'
            : 'status-dot-danger';
      titleLine.appendChild(el('span', `status-dot ${dotCls}`));
      titleLine.appendChild(el('span', 'share-row-title', share.title));
      left.appendChild(titleLine);

      const statusText =
        share.status === 'active'
          ? share.expiresAt
            ? `Attiva · Scade il ${formatDateShort(share.expiresAt)}`
            : 'Attiva · Senza scadenza'
          : share.status === 'expired'
            ? 'Scaduta'
            : 'Limite download raggiunto';

      const dlText =
        share.maxDownloads !== null
          ? `${share.downloadCount} / ${share.maxDownloads} download`
          : `${share.downloadCount} download`;

      const metaParts = [
        statusText,
        `${share.itemCount} ${share.itemCount === 1 ? 'file' : 'file'}`,
        dlText,
        `Creata il ${formatDateShort(share.createdAt)}`,
      ];
      if (share.hasPassword) metaParts.push('Protetta da password');

      left.appendChild(el('div', 'media-card-meta mono-nums', metaParts.join(' · ')));
      card.appendChild(left);

      const actions = el('div', 'share-row-actions');
      if (share.shareUrl) {
        const copyBtn = el('button', 'btn', 'Copia Link');
        copyBtn.dataset.action = 'copy-share';
        copyBtn.addEventListener('click', async () => {
          const ok = await copyTextSafe(share.shareUrl!);
          copyBtn.textContent = ok ? 'Copiato' : 'Errore copia';
          setTimeout(() => {
            copyBtn.textContent = 'Copia Link';
          }, 1800);
        });
        actions.appendChild(copyBtn);
      }

      if (pendingConfirmRevokeId === share.shareId) {
        const confirmBtn = el('button', 'btn btn-danger', 'Conferma Revoca');
        confirmBtn.dataset.action = 'confirm-revoke-share';
        confirmBtn.addEventListener('click', async () => {
          confirmBtn.disabled = true;
          try {
            await client.revokeShare(share.shareId);
            callbacks.onStatusMessage('success', `Condivisione "${share.title}" revocata definitivamente.`);
            callbacks.onRefreshRequested();
          } catch (err) {
            callbacks.onStatusMessage(
              'error',
              err instanceof Error ? err.message : 'Errore durante la revoca.'
            );
          }
        });
        const cancelBtn = el('button', 'btn btn-ghost', 'Annulla');
        cancelBtn.addEventListener('click', () => {
          pendingConfirmRevokeId = null;
          renderRows();
        });
        actions.append(confirmBtn, cancelBtn);
      } else {
        const revokeBtn = el('button', 'btn btn-danger', 'Revoca');
        revokeBtn.dataset.action = 'revoke-share';
        revokeBtn.addEventListener('click', () => {
          pendingConfirmRevokeId = share.shareId;
          renderRows();
        });
        actions.appendChild(revokeBtn);
      }

      card.appendChild(actions);
      list.appendChild(card);
    }
  };

  renderRows();
  container.appendChild(list);
}
