// Renderer logic
const $ = (sel) => document.querySelector(sel);
const consoleEl = $('#console');

function log(msg) {
  consoleEl.textContent += msg + '\n';
  if (consoleEl.textContent.length > 200000) {
    consoleEl.textContent = consoleEl.textContent.slice(-100000);
  }
  consoleEl.scrollTop = consoleEl.scrollHeight;
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
      <button class="active-btn">${activeProfile === p.name ? '★ Active' : 'Set Active'}</button>
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
    alert('Username must be 3-16 chars (A-Z, 0-9, _)');
    return;
  }
  if (profiles.some(p => p.name.toLowerCase() === name.toLowerCase())) {
    alert('Profile already exists.');
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
    $('#updater-status').textContent = `Manifest v${m.version}, ${m._pending || 0} files to update.`;
  } catch (e) {
    $('#updater-status').textContent = `Error: ${e.message || e}`;
  }
};

// Console events
api.on('sync:log',     (msg) => log(`[sync] ${msg}`));
api.on('launch:log',   (msg) => log(msg));
api.on('sync:progress',(p) => {
  const wrap = $('#progress-wrap');
  wrap.classList.remove('hidden');
  const pct = p.total ? Math.round((p.index / p.total) * 100) : 0;
  $('#progress-fill').style.width = pct + '%';
  $('#progress-text').textContent = `${p.index}/${p.total} — ${p.file}`;
});
api.on('launch:close', (code) => {
  log(`[Launcher] Game exited (code ${code})`);
  $('#btn-play').classList.remove('hidden');
  $('#btn-stop').classList.add('hidden');
  $('#play-status').textContent = 'Ready';
  $('#progress-wrap').classList.add('hidden');
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
  if (!profileName) { alert('Add a profile first (Profiles tab).'); return; }
  $('#btn-play').classList.add('hidden');
  $('#btn-stop').classList.remove('hidden');
  $('#play-status').textContent = 'Launching...';
  $('#progress-wrap').classList.remove('hidden');
  log('================ Launch start ================');
  const r = await api.launch({
    profileName,
    directConnect: $('#direct-connect').checked
  });
  if (!r.ok) {
    alert('Launch failed:\n' + r.error);
    $('#btn-play').classList.remove('hidden');
    $('#btn-stop').classList.add('hidden');
    $('#play-status').textContent = 'Error';
    $('#progress-wrap').classList.add('hidden');
  } else {
    $('#play-status').textContent = 'Running';
  }
};
$('#btn-stop').onclick = async () => {
  if (confirm('Force-close Minecraft?')) api.stopGame();
};
$('#btn-clear-console').onclick = () => { consoleEl.textContent = ''; };

// News
async function loadNews() {
  const md = await api.fetchNews();
  $('#news-content').innerHTML = md
    ? renderMarkdown(md)
    : '<p class="muted">No news available.</p>';
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
})();
