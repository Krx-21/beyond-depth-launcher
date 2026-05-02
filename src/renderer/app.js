// Renderer logic
const $ = (sel) => document.querySelector(sel);
const consoleEl = $('#console');

// Batched log writer: avoids O(n²) reflow from `textContent +=` per line
// during heavy mclc/jvm output. Lines are queued and flushed on the next
// animation frame in a single DOM mutation.
const _logBuf = [];
let _logScheduled = false;
let _logSize = 0;
function flushLogs() {
  _logScheduled = false;
  if (!_logBuf.length) return;
  const chunk = _logBuf.join('\n') + '\n';
  _logBuf.length = 0;
  // Append via a text node — much faster than reading+writing textContent.
  consoleEl.appendChild(document.createTextNode(chunk));
  _logSize += chunk.length;
  if (_logSize > 200000) {
    // Trim from the front in one pass.
    const txt = consoleEl.textContent;
    consoleEl.textContent = txt.slice(-100000);
    _logSize = consoleEl.textContent.length;
  }
  consoleEl.scrollTop = consoleEl.scrollHeight;
}
function log(msg) {
  _logBuf.push(msg);
  if (!_logScheduled) {
    _logScheduled = true;
    requestAnimationFrame(flushLogs);
  }
}

// ── Toast notification system ──────────────────────────────────
const _toastIcons = { success: '✓', error: '✕', warn: '⚠', info: 'ℹ' };
function toast(msg, type = 'info', duration = 4500) {
  const container = document.getElementById('toast-container');
  const el = document.createElement('div');
  el.className = `toast toast-${type}`;
  el.innerHTML = `<span class="toast-icon">${_toastIcons[type] || 'ℹ'}</span><span class="toast-msg">${escapeHtml(String(msg))}</span>`;
  container.appendChild(el);
  const dismiss = () => {
    el.classList.add('toast-exit');
    el.addEventListener('animationend', () => el.remove(), { once: true });
  };
  const timer = setTimeout(dismiss, duration);
  el.onclick = () => { clearTimeout(timer); dismiss(); };
}

// ── Console drawer ───────────────────────────────────────────────
const consoleDrawer = document.getElementById('console-drawer');
document.getElementById('console-toggle').onclick = () => {
  consoleDrawer.classList.toggle('open');
};
function openConsoleDrawer() { consoleDrawer.classList.add('open'); }

// ── Status dot helper ────────────────────────────────────────────
function setStatus(text, state = 'ready') {
  const statusEl = $('#play-status');
  if (statusEl) statusEl.textContent = text;
  const dot = $('#status-dot');
  if (!dot) return;
  dot.className = 'status-dot';
  if (state === 'busy') dot.classList.add('busy');
  else if (state === 'error') dot.classList.add('error');
}

// Window controls
$('#btn-min').onclick = () => api.minimize();
$('#btn-close').onclick = () => api.close();

// Tabs
document.querySelectorAll('.nav').forEach(b => {
  b.addEventListener('click', () => {
    document.querySelectorAll('.nav').forEach(x => x.classList.remove('active'));
    document.querySelectorAll('.tab').forEach(x => x.classList.remove('active'));
    b.classList.add('active');
    $(`#tab-${b.dataset.tab}`).classList.add('active');
    if (b.dataset.tab === 'news') loadNews();
  });
});

// Profile state
let profiles = [];
let activeProfile = null;

async function loadProfiles() {
  profiles = (await api.getStore('profiles')) || [];
  activeProfile = await api.getStore('activeProfile');
  renderProfiles();
  renderProfileSelect();
}

function renderProfiles() {
  const list = $('#profile-list');
  list.innerHTML = '';
  if (!profiles.length) {
    list.innerHTML = '<li class="muted" style="text-align:center;padding:24px">No profiles. Add one above.</li>';
    return;
  }
  for (const p of profiles) {
    const li = document.createElement('li');
    li.innerHTML = `
      <div class="skin-thumb"></div>
      <div style="flex:1">
        <div class="pname">${escapeHtml(p.name)}</div>
        <div class="puuid">${offlineUuidPreview(p.name)}</div>
      </div>
      <button class="skin-btn">Skin</button>
      <button class="active-btn ${activeProfile === p.name ? 'is-active' : ''}">${activeProfile === p.name ? '★ Active' : 'Set Active'}</button>
      <button class="del">Delete</button>
    `;
    li.querySelector('.skin-btn').onclick = async () => {
      const f = await api.pickSkin();
      if (f) {
        p.skinPath = f;
        await api.setStore('profiles', profiles);
        log(`[UI] Skin set for ${p.name}: ${f}`);
      }
    };
    li.querySelector('.active-btn').onclick = async () => {
      activeProfile = p.name;
      await api.setStore('activeProfile', p.name);
      renderProfiles();
      renderProfileSelect();
    };
    li.querySelector('.del').onclick = async () => {
      if (!confirm(`Delete profile "${p.name}"?`)) return;
      profiles = profiles.filter(x => x.name !== p.name);
      if (activeProfile === p.name) {
        activeProfile = profiles[0]?.name || null;
        await api.setStore('activeProfile', activeProfile);
      }
      await api.setStore('profiles', profiles);
      renderProfiles();
      renderProfileSelect();
    };
    list.appendChild(li);
  }
}

function renderProfileSelect() {
  const sel = $('#profile-select');
  sel.innerHTML = '';
  if (!profiles.length) {
    sel.innerHTML = '<option value="">No profiles</option>';
    return;
  }
  for (const p of profiles) {
    const o = document.createElement('option');
    o.value = p.name; o.textContent = p.name;
    if (p.name === activeProfile) o.selected = true;
    sel.appendChild(o);
  }
}

$('#btn-add-profile').onclick = async () => {
  const inp = $('#new-profile-name');
  const name = inp.value.trim();
  if (!/^[A-Za-z0-9_]{3,16}$/.test(name)) {
    toast('Username must be 3–16 chars (A–Z, 0–9, _)', 'warn');
    return;
  }
  if (profiles.some(p => p.name.toLowerCase() === name.toLowerCase())) {
    toast('Profile already exists.', 'warn');
    return;
  }
  profiles.push({ name, skinPath: null });
  if (!activeProfile) {
    activeProfile = name;
    await api.setStore('activeProfile', name);
  }
  await api.setStore('profiles', profiles);
  inp.value = '';
  renderProfiles();
  renderProfileSelect();
};

// Settings
async function loadSettings() {
  const ram = parseInt(await api.getStore('ramMaxGB'), 10) || 6;
  $('#ram-slider').value = ram;
  $('#ram-input').value = ram;
  $('#server-address').value = await api.getStore('serverAddress') || '';
}
function setRam(v) {
  let n = parseInt(v, 10);
  if (!Number.isFinite(n)) n = 6;
  n = Math.max(2, Math.min(64, n));
  $('#ram-slider').value = n;
  $('#ram-input').value = n;
  api.setStore('ramMaxGB', n);
  api.setStore('ramMinGB', n);
}
$('#ram-slider').oninput = (e) => setRam(e.target.value);
$('#ram-input').onchange = (e) => setRam(e.target.value);
$('#server-address').onchange = (e) => api.setStore('serverAddress', e.target.value);

$('#btn-open-game').onclick = () => api.openGameDir();
$('#btn-open-launcher').onclick = () => api.openLauncherDir();
$('#btn-check-manifest').onclick = async () => {
  $('#updater-status').textContent = 'Checking...';
  try {
    const m = await api.checkManifest();
    const msg = `Manifest v${m.version}, ${m._pending || 0} files to update.`;
    $('#updater-status').textContent = msg;
    toast(msg, 'info');
  } catch (e) {
    const err = `Check failed: ${e.message || e}`;
    $('#updater-status').textContent = err;
    toast(err, 'error');
  }
};

// Console events
api.on('sync:log',     (msg) => log(`[sync] ${msg}`));
api.on('launch:log',   (msg) => log(msg));
// Throttle progress UI to one DOM update per animation frame.
let _pendingProgress = null;
let _progressScheduled = false;
function flushProgress() {
  _progressScheduled = false;
  const p = _pendingProgress; _pendingProgress = null;
  if (!p) return;
  const wrap = $('#progress-wrap');
  wrap.classList.remove('hidden');
  const pct = p.total ? Math.round((p.index / p.total) * 100) : 0;
  $('#progress-fill').style.width = pct + '%';
  $('#progress-text').textContent = `${p.index}/${p.total} — ${p.file}`;
}
api.on('sync:progress',(p) => {
  _pendingProgress = p;
  if (!_progressScheduled) {
    _progressScheduled = true;
    requestAnimationFrame(flushProgress);
  }
});
api.on('launch:close', (code) => {
  log(`[Launcher] Game exited (code ${code})`);
  $('#btn-play').classList.remove('hidden');
  $('#btn-stop').classList.add('hidden');
  setStatus('Ready', 'ready');
  $('#progress-wrap').classList.add('hidden');
});
api.on('launch:crash', ({ code }) => {
  log(`[Launcher] *** CRASH (exit code ${code}) — check console for details ***`);
  // Switch to play tab.
  document.querySelectorAll('.nav').forEach(x => x.classList.remove('active'));
  document.querySelectorAll('.tab').forEach(x => x.classList.remove('active'));
  document.querySelector('.nav[data-tab="play"]').classList.add('active');
  $('#tab-play').classList.add('active');
  // Open the console drawer and scroll to crash line.
  openConsoleDrawer();
  flushLogs();
  consoleEl.scrollTop = consoleEl.scrollHeight;
  toast(`Game crashed (exit ${code}) — see console`, 'error', 7000);
});
api.on('updater', (s) => {
  if (!s) return;
  const map = {
    available: `New launcher version ${s.version} available — downloading...`,
    progress: `Downloading update: ${Math.round(s.percent)}%`,
    downloaded: `Update v${s.version} downloaded. Restart to install.`,
    error: `Updater error: ${s.message}`
  };
  $('#updater-status').textContent = map[s.state] || s.state;
  if (s.state === 'downloaded') {
    if (confirm(`Update v${s.version} ready. Restart now?`)) api.installUpdate();
  }
});

// Play
$('#btn-play').onclick = async () => {
  const profileName = $('#profile-select').value;
  if (!profileName) { toast('Add a profile first (Profiles tab)', 'warn'); return; }
  $('#btn-play').classList.add('hidden');
  $('#btn-stop').classList.remove('hidden');
  setStatus('Launching…', 'busy');
  openConsoleDrawer();
  $('#progress-wrap').classList.remove('hidden');
  log('================ Launch start ================');
  try {
    const r = await api.launch({
      profileName,
      directConnect: $('#direct-connect').checked
    });
    if (!r.ok) {
      toast('Launch failed: ' + r.error, 'error', 8000);
      $('#btn-play').classList.remove('hidden');
      $('#btn-stop').classList.add('hidden');
      setStatus('Error', 'error');
      $('#progress-wrap').classList.add('hidden');
    } else {
      setStatus('Running', 'busy');
    }
  } catch (e) {
    // Unexpected IPC error — always restore the button so the user can retry.
    log(`[Launcher] Unexpected error: ${e.message || e}`);
    toast(`Unexpected error: ${e.message || e}`, 'error');
    $('#btn-play').classList.remove('hidden');
    $('#btn-stop').classList.add('hidden');
    setStatus('Error', 'error');
    $('#progress-wrap').classList.add('hidden');
  }
};
$('#btn-stop').onclick = async () => {
  if (confirm('Force-close Minecraft?')) {
    api.stopGame();
    setStatus('Stopped', 'ready');
  }
};
$('#btn-clear-console').onclick = (e) => {
  e.stopPropagation(); // prevent bubbling to console-toggle div
  consoleEl.textContent = '';
  _logSize = 0;
};

// News link delegation — route <a> clicks to shell.openExternal
document.getElementById('news-content').addEventListener('click', (e) => {
  const a = e.target.closest('a[href]');
  if (a) { e.preventDefault(); api.openExternal(a.href); }
});

// News (cached per session to avoid refetching on every tab click)
let _newsHtmlCache = null;
async function loadNews() {
  if (_newsHtmlCache !== null) {
    $('#news-content').innerHTML = _newsHtmlCache;
    return;
  }
  const md = await api.fetchNews();
  _newsHtmlCache = md ? renderMarkdown(md) : '<p class="muted">No news available.</p>';
  $('#news-content').innerHTML = _newsHtmlCache;
}

function renderMarkdown(md) {
  // Tiny MD renderer (h1-3, paragraphs, lists, links)
  const esc = (s) => s.replace(/[&<>]/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;'}[c]));
  let html = '';
  for (const block of md.split(/\n\n+/)) {
    const t = block.trim();
    if (!t) continue;
    if (/^### /.test(t))      html += `<h3>${esc(t.replace(/^### /,''))}</h3>`;
    else if (/^## /.test(t))  html += `<h2>${esc(t.replace(/^## /,''))}</h2>`;
    else if (/^# /.test(t))   html += `<h1>${esc(t.replace(/^# /,''))}</h1>`;
    else if (/^- /m.test(t))  html += `<ul>${t.split('\n').map(l => `<li>${esc(l.replace(/^- /,''))}</li>`).join('')}</ul>`;
    else                       html += `<p>${esc(t).replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2" target="_blank">$1</a>')}</p>`;
  }
  return html;
}

function escapeHtml(s) { return s.replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c])); }

function offlineUuidPreview(name) {
  // Same algorithm as main process — for display only
  // We can compute here without crypto using a simple FNV preview:
  return 'offline:' + name;
}

// Init
(async () => {
  await loadSettings();
  await loadProfiles();
  // Show real version from package.json via main process
  try {
    const ver = await api.getVersion();
    if (ver) $('#app-version').textContent = 'v' + ver;
  } catch {}
})();
