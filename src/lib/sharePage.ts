/**
 * Renderer server-side della pagina pubblica di condivisione `/share/:token`.
 * Pagina self-contained (CSS/JS inline): griglia media, lightbox con slideshow
 * a transizioni e download diretto dei file decifrati.
 */
import path from 'node:path';

function escapeHtml(input: string): string {
  return String(input)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

const IMAGE_EXTS = new Set(['jpg', 'jpeg', 'png', 'gif', 'webp', 'bmp', 'svg', 'heic', 'avif']);
const VIDEO_EXTS = new Set(['mp4', 'mov', 'webm', 'mkv']);

export type SharePageState = 'ok' | 'locked' | 'expired' | 'exhausted' | 'invalid';

export interface SharePageModel {
  token: string;
  filenames: string[];
  label: string;
  owner: string;
  expiresAt: number;
}

const PAGE_STYLE = `
:root{color-scheme:dark;--bg:#0b1220;--card:#111a2e;--acc:#4f8cff;--txt:#e8eefc;--mut:#8ca0c6;}
*{box-sizing:border-box;margin:0;padding:0;}
body{background:radial-gradient(1200px 600px at 80% -10%,#1d2c4d 0%,var(--bg) 55%);min-height:100vh;font-family:'Inter',system-ui,-apple-system,sans-serif;color:var(--txt);}
.share-header{position:sticky;top:0;z-index:10;backdrop-filter:blur(14px);background:rgba(11,18,32,.72);border-bottom:1px solid rgba(140,160,198,.18);padding:14px 20px;display:flex;align-items:center;gap:12px;flex-wrap:wrap;}
.share-header h1{font-size:17px;font-weight:700;}
.share-badge{font-size:11px;background:rgba(79,140,255,.16);border:1px solid rgba(79,140,255,.4);color:#9dbbff;padding:4px 10px;border-radius:999px;}
.share-actions{margin-left:auto;display:flex;gap:8px;}
.share-btn{display:inline-flex;align-items:center;gap:6px;background:var(--acc);color:#fff;border:none;padding:9px 16px;border-radius:12px;font-size:13px;font-weight:600;cursor:pointer;text-decoration:none;transition:transform .15s ease,filter .15s ease;}
.share-btn:hover{filter:brightness(1.12);transform:translateY(-1px);}
.share-btn.ghost{background:rgba(140,160,198,.14);color:var(--txt);border:1px solid rgba(140,160,198,.3);}
.share-meta{font-size:12px;color:var(--mut);padding:12px 20px 0;}
.share-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(180px,1fr));gap:14px;padding:18px 20px 40px;max-width:1400px;margin:0 auto;}
.share-card{position:relative;display:block;border-radius:16px;overflow:hidden;background:var(--card);border:1px solid rgba(140,160,198,.14);aspect-ratio:1;cursor:pointer;transition:transform .2s ease,box-shadow .2s ease;}
.share-card:hover{transform:translateY(-3px);box-shadow:0 12px 32px rgba(0,0,0,.45);}
.share-card img,.share-card video{width:100%;height:100%;object-fit:cover;display:block;}
.share-card .file-chip{position:absolute;inset:0;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:8px;color:var(--mut);}
.share-card .file-chip .ext{font-size:11px;letter-spacing:.08em;font-weight:700;background:rgba(79,140,255,.15);border:1px solid rgba(79,140,255,.35);color:#9dbbff;border-radius:8px;padding:3px 10px;}
.share-card .file-name{position:absolute;left:0;right:0;bottom:0;padding:8px 10px;font-size:11px;background:linear-gradient(transparent,rgba(0,0,0,.78));color:#dfe8fb;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;}
.lock-panel{max-width:420px;margin:14vh auto;background:var(--card);border:1px solid rgba(140,160,198,.2);border-radius:20px;padding:34px 30px;text-align:center;}
.lock-panel h2{font-size:19px;margin-bottom:8px;}
.lock-panel p{font-size:13px;color:var(--mut);margin-bottom:20px;}
.lock-panel input{width:100%;padding:12px 14px;border-radius:12px;border:1px solid rgba(140,160,198,.35);background:#0c1425;color:var(--txt);font-size:14px;margin-bottom:14px;outline:none;}
.lock-panel input:focus{border-color:var(--acc);}
.lock-error{color:#ff8a8a;font-size:12px;margin-bottom:10px;}
.lightbox{position:fixed;inset:0;z-index:50;background:rgba(4,8,16,.94);display:none;align-items:center;justify-content:center;}
.lightbox.open{display:flex;}
.lb-media{max-width:92vw;max-height:86vh;border-radius:12px;box-shadow:0 24px 80px rgba(0,0,0,.6);transition:opacity .35s ease,transform .35s ease;}
.lb-media.fade-out{opacity:0;transform:scale(.985);}
.lb-media.slide-out{opacity:0;transform:translateX(60px);}
.lb-media.zoom-out{opacity:0;transform:scale(1.06);}
.lb-top{position:absolute;top:0;left:0;right:0;display:flex;align-items:center;gap:10px;padding:14px 18px;background:linear-gradient(rgba(4,8,16,.75),transparent);}
.lb-counter{font-size:12px;color:var(--mut);}
.lb-top .share-btn{margin-left:auto;}
.lb-nav{position:absolute;top:50%;transform:translateY(-50%);background:rgba(140,160,198,.14);border:1px solid rgba(140,160,198,.3);color:#fff;border-radius:50%;width:46px;height:46px;font-size:22px;cursor:pointer;display:flex;align-items:center;justify-content:center;}
.lb-nav:hover{background:rgba(79,140,255,.35);}
.lb-prev{left:14px}.lb-next{right:14px}
.ss-progress{position:absolute;bottom:0;left:0;height:3px;background:var(--acc);width:0%;transition:width .3s linear;}
@media(max-width:600px){.share-grid{grid-template-columns:repeat(auto-fill,minmax(120px,1fr));gap:10px;padding:12px;}}
`;

const PAGE_SCRIPT = `
(function(){
  var grid = document.getElementById('share-grid');
  var items = [];
  if (grid) {
    grid.querySelectorAll('.share-card').forEach(function(card){
      items.push({ url: card.getAttribute('data-url'), kind: card.getAttribute('data-kind'), name: card.getAttribute('data-name') });
    });
  }
  var lb = document.getElementById('lb');
  var lbImg = document.getElementById('lb-img');
  var lbVid = document.getElementById('lb-video');
  var lbCounter = document.getElementById('lb-counter');
  var lbDl = document.getElementById('lb-download');
  var idx = 0;
  var ssTimer = null;
  var ssDelay = 3500;
  var ssMode = 'fade';
  var progress = document.getElementById('ss-progress');
  var progressTimer = null;

  function setProgress(){
    if(!progress) return;
    clearInterval(progressTimer);
    progress.style.width = '0%';
    if(!ssTimer) return;
    var start = Date.now();
    progressTimer = setInterval(function(){
      progress.style.width = Math.min(100, ((Date.now()-start)/ssDelay)*100) + '%';
    }, 100);
  }

  function show(i, transition){
    if(items.length===0) return;
    idx = ((i % items.length) + items.length) % items.length;
    var item = items[idx];
    var cls = (transition || 'fade') + '-out';
    lbImg.classList.add(cls);
    setTimeout(function(){
      if(item.kind === 'video'){
        lbImg.style.display='none'; lbVid.style.display='block';
        lbVid.src = item.url;
        lbVid.play().catch(function(){});
      } else {
        if(lbVid){ lbVid.pause(); lbVid.removeAttribute('src'); lbVid.load && lbVid.load(); lbVid.style.display='none'; }
        lbImg.style.display='block'; lbImg.src = item.url;
      }
      lbImg.classList.remove('fade-out','slide-out','zoom-out');
      lbCounter.textContent = (idx+1)+' / '+items.length+' — '+item.name;
      lbDl.href = item.url + '?download=1';
    }, transition ? 240 : 0);
    setProgress();
  }

  function openLb(i, startSlideshow){
    lb.classList.add('open');
    show(i);
    if(startSlideshow) startSs();
  }
  function closeLb(){ stopSs(); lb.classList.remove('open'); if(lbVid){ lbVid.pause(); } }
  function startSs(){
    stopSs();
    ssTimer = setInterval(function(){ show(idx+1, ssMode); }, ssDelay);
    setProgress();
    document.getElementById('lb-ss-btn').textContent = '⏸ Pausa';
  }
  function stopSs(){
    if(ssTimer){ clearInterval(ssTimer); ssTimer = null; clearInterval(progressTimer); if(progress) progress.style.width='0%'; }
    var b = document.getElementById('lb-ss-btn'); if(b) b.textContent = '▶ Slideshow';
  }

  if (grid) {
    grid.addEventListener('click', function(e){
      var card = e.target.closest('.share-card');
      if(!card) return;
      e.preventDefault();
      var i = Array.prototype.indexOf.call(grid.querySelectorAll('.share-card'), card);
      openLb(i < 0 ? 0 : i, false);
    });
  }
  var ssMain = document.getElementById('ss-main-btn');
  if (ssMain) ssMain.addEventListener('click', function(){ openLb(0, true); });
  document.getElementById('lb-close').addEventListener('click', closeLb);
  document.getElementById('lb-ss-btn').addEventListener('click', function(){ ssTimer ? stopSs() : startSs(); });
  document.getElementById('lb-prev').addEventListener('click', function(){ stopSs(); show(idx-1,'slide'); });
  document.getElementById('lb-next').addEventListener('click', function(){ stopSs(); show(idx+1,'slide'); });
  var trans = document.getElementById('ss-transition');
  if(trans) trans.addEventListener('change', function(){ ssMode = trans.value; });
  var spd = document.getElementById('ss-speed');
  if(spd) spd.addEventListener('change', function(){ ssDelay = parseInt(spd.value,10)||3500; if(ssTimer){ startSs(); } });
  document.addEventListener('keydown', function(e){
    if(!lb.classList.contains('open')) return;
    if(e.key==='Escape') closeLb();
    if(e.key==='ArrowLeft'){ stopSs(); show(idx-1,'slide'); }
    if(e.key==='ArrowRight'||e.key===' '){ if(e.key===' ') e.preventDefault(); stopSs(); show(idx+1,'slide'); }
  });
  lb.addEventListener('click', function(e){ if(e.target===lb) closeLb(); });
})();
`;

function mediaKind(filename: string): 'image' | 'video' | 'file' {
  const ext = path.extname(filename).slice(1).toLowerCase();
  if (IMAGE_EXTS.has(ext)) return 'image';
  if (VIDEO_EXTS.has(ext)) return 'video';
  return 'file';
}

export function renderSharePage(model: SharePageModel): string {
  const expiresDate = new Date(model.expiresAt);
  const expiresStr = expiresDate.toLocaleString('it-IT', { dateStyle: 'medium', timeStyle: 'short' });
  const title = model.label || `Condivisione di ${model.owner}`;

  const cards = model.filenames
    .map((fn) => {
      const kind = mediaKind(fn);
      const url = `/share/${model.token}/media/${encodeURIComponent(fn)}`;
      const safeName = escapeHtml(fn);
      let inner = '';
      if (kind === 'image') {
        inner = `<img loading="lazy" src="${url}" alt="${safeName}">`;
      } else if (kind === 'video') {
        inner = `<video preload="metadata" muted src="${url}#t=0.5"></video>`;
      } else {
        const ext = (path.extname(fn).slice(1) || 'FILE').toUpperCase();
        inner = `<div class="file-chip"><span class="ext">${escapeHtml(ext)}</span></div>`;
      }
      return `<a class="share-card" href="${url}?download=1" data-url="${url}" data-kind="${kind}" data-name="${safeName}">${inner}<span class="file-name">${safeName}</span></a>`;
    })
    .join('\n');

  const slideshowBtn = model.filenames.some((f) => mediaKind(f) !== 'file')
    ? `<button type="button" class="share-btn" id="ss-main-btn">▶ Slideshow</button>`
    : '';

  return `<!DOCTYPE html>
<html lang="it">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>${escapeHtml(title)} — PhotoCloud Share</title>
<link rel="icon" href="/favicon.ico">
<style>${PAGE_STYLE}</style>
</head>
<body>
<header class="share-header">
  <span class="share-badge">PhotoCloud · Link Pubblico</span>
  <h1>${escapeHtml(title)}</h1>
  <div class="share-actions">
    ${slideshowBtn}
  </div>
</header>
<p class="share-meta">${model.filenames.length} elementi · condivisi da <strong>${escapeHtml(model.owner)}</strong> · scade il ${escapeHtml(expiresStr)}</p>
<main class="share-grid" id="share-grid">
${cards}
</main>
<div class="lightbox" id="lb">
  <div class="lb-top">
    <span class="lb-counter" id="lb-counter"></span>
    <select id="ss-transition" class="share-btn ghost" style="padding:6px 10px;">
      <option value="fade">Dissolvenza</option>
      <option value="slide">Scorrimento</option>
      <option value="zoom">Zoom</option>
    </select>
    <select id="ss-speed" class="share-btn ghost" style="padding:6px 10px;">
      <option value="2500">2.5s</option>
      <option value="3500" selected>3.5s</option>
      <option value="5000">5s</option>
      <option value="8000">8s</option>
    </select>
    <button type="button" class="share-btn ghost" id="lb-ss-btn">▶ Slideshow</button>
    <a class="share-btn ghost" id="lb-download" href="#">⬇ Scarica</a>
    <button type="button" class="share-btn ghost" id="lb-close">✕ Chiudi</button>
  </div>
  <button type="button" class="lb-nav lb-prev" id="lb-prev">‹</button>
  <img class="lb-media" id="lb-img" alt="">
  <video class="lb-media" id="lb-video" controls playsinline style="display:none"></video>
  <button type="button" class="lb-nav lb-next" id="lb-next">›</button>
  <div class="ss-progress" id="ss-progress"></div>
</div>
<script>${PAGE_SCRIPT}</script>
</body>
</html>`;
}

export function renderSharePasswordPage(token: string, error = ''): string {
  return `<!DOCTYPE html>
<html lang="it">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>Condivisione protetta — PhotoCloud Share</title>
<style>${PAGE_STYLE}</style>
</head>
<body>
<div class="lock-panel">
  <div style="font-size:40px;margin-bottom:6px;">🔒</div>
  <h2>Condivisione protetta da password</h2>
  <p>Inserisci la password per accedere ai contenuti condivisi.</p>
  ${error ? `<div class="lock-error">${escapeHtml(error)}</div>` : ''}
  <form method="POST" action="/share/${encodeURIComponent(token)}/unlock">
    <input type="password" name="password" placeholder="Password" autocomplete="off" autofocus>
    <button type="submit" class="share-btn" style="width:100%;justify-content:center;">Sblocca</button>
  </form>
</div>
</body>
</html>`;
}

export function renderShareErrorPage(state: Exclude<SharePageState, 'ok' | 'locked'>): string {
  const messages: Record<string, [string, string]> = {
    expired: ['⏰ Link scaduto', 'Questo link di condivisione è scaduto e non è più disponibile.'],
    exhausted: ['📦 Limite raggiunto', 'Questo link ha raggiunto il numero massimo di download consentiti.'],
    invalid: ['❌ Link non valido', 'Questo link di condivisione non esiste o è stato revocato dal proprietario.'],
  };
  const [title, body] = messages[state] || messages.invalid;
  return `<!DOCTYPE html>
<html lang="it">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>${escapeHtml(title)} — PhotoCloud Share</title>
<style>${PAGE_STYLE}</style>
</head>
<body>
<div class="lock-panel">
  <div style="font-size:40px;margin-bottom:6px;">🛡️</div>
  <h2>${escapeHtml(title)}</h2>
  <p>${escapeHtml(body)}</p>
</div>
</body>
</html>`;
}
