// Manifest sync: download/update mods, config bundles, etc.
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const os = require('os');
const http = require('http');
const https = require('https');
const axios = require('axios');
const extract = require('extract-zip');

// Shared keep-alive agents — massively reduces per-file TCP/TLS handshake overhead
// when downloading many mods from the same host (e.g. GitHub releases CDN).
const httpAgent  = new http.Agent({  keepAlive: true, maxSockets: 16, scheduling: 'fifo' });
const httpsAgent = new https.Agent({ keepAlive: true, maxSockets: 16, scheduling: 'fifo' });
const httpClient = axios.create({ httpAgent, httpsAgent, maxRedirects: 5 });

// Bounded parallelism: respect IO limits without serializing.
const SHA1_CONCURRENCY     = Math.max(4, Math.min(os.cpus().length, 8));
const DOWNLOAD_CONCURRENCY = 6;

async function fetchManifest(url) {
  const r = await httpClient.get(url, { timeout: 15000, responseType: 'json' });
  return r.data;
}

function sha1File(filePath) {
  return new Promise((resolve, reject) => {
    if (!fs.existsSync(filePath)) return resolve(null);
    const h = crypto.createHash('sha1');
    // Larger buffer => fewer syscalls, faster hashing of big jars.
    const s = fs.createReadStream(filePath, { highWaterMark: 1024 * 1024 });
    s.on('data', (d) => h.update(d));
    s.on('end', () => resolve(h.digest('hex')));
    s.on('error', reject);
  });
}

// Run async tasks with bounded concurrency (preserves input order in results).
async function pMap(items, mapper, concurrency) {
  const results = new Array(items.length);
  let i = 0;
  const workers = new Array(Math.min(concurrency, items.length || 1)).fill(0).map(async () => {
    while (true) {
      const idx = i++;
      if (idx >= items.length) return;
      results[idx] = await mapper(items[idx], idx);
    }
  });
  await Promise.all(workers);
  return results;
}

async function downloadFile(url, dest, onChunk) {
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  const tmp = dest + '.tmp';
  const MAX_RETRIES = 3;
  let attempt = 0;
  while (true) {
    attempt++;
    let writer;
    try {
      writer = fs.createWriteStream(tmp);
      const response = await httpClient.get(url, { responseType: 'stream', timeout: 120000 });
      const total = parseInt(response.headers['content-length'] || '0', 10);
      let received = 0;
      response.data.on('data', (chunk) => {
        received += chunk.length;
        if (onChunk) onChunk(received, total);
      });
      await new Promise((res, rej) => {
        response.data.pipe(writer);
        writer.on('finish', res);
        writer.on('error', rej);
        response.data.on('error', rej);
      });
      fs.renameSync(tmp, dest);
      return; // success
    } catch (err) {
      // Close writer if it was opened before axios threw.
      try { writer?.destroy(); } catch {}
      // Clean up partial write.
      try { fs.rmSync(tmp, { force: true }); } catch {}
      // Handle HTTP 429: respect Retry-After if present.
      const status = err?.response?.status;
      const retryAfterMs = status === 429
        ? (parseInt(err.response?.headers?.['retry-after'] || '5', 10) * 1000)
        : 0;
      if (attempt >= MAX_RETRIES) {
        err.message = `Download failed (${url}): ${err.message}`;
        throw err;
      }
      const backoff = retryAfterMs || Math.min(1000 * 2 ** (attempt - 1), 10000);
      await new Promise(r => setTimeout(r, backoff));
    }
  }
}

function rmrf(p) {
  if (fs.existsSync(p)) fs.rmSync(p, { recursive: true, force: true });
}

/**
 * manifest format v2:
 * {
 *   "version": "1.0.0",
 *   "minecraft": "1.20.1",
 *   "forge": "47.4.20",
 *   "javaVersion": 21,
 *   "forgeInstaller": { "url", "sha1", "size" },
 *   "mods":    [ { "path": "mods/x.jar", "url", "sha1", "size" } ],
 *   "bundles": [ { "path": "config",     "url", "sha1", "size" } ],
 *   "removed": [ "mods/old.jar" ]
 * }
 * Bundles = zip of a whole dir. On sha1 mismatch, wipe + extract.
 */
async function syncManifest({ manifestUrl, gameDir, forgeDir, onProgress, onLog, dryRun = false }) {
  onLog?.(`Fetching manifest: ${manifestUrl}`);
  const manifest = await fetchManifest(manifestUrl);

  // Fast-path: if manifest version is unchanged AND last sync was clean,
  // skip the full SHA1 scan entirely (saves 10-60s on big modpacks).
  const syncStateFile = path.join(gameDir, '.bd-sync-state.json');
  let syncState = {};
  try { if (fs.existsSync(syncStateFile)) syncState = JSON.parse(fs.readFileSync(syncStateFile, 'utf8')); } catch {}
  if (!dryRun && syncState.version && syncState.version === manifest.version && syncState.clean) {
    onLog?.(`Manifest v${manifest.version} unchanged since last clean sync — skipping verification.`);
    return manifest;
  }

  // Persistent verify cache: file path -> { mtime, size, sha1 }
  // Avoids re-hashing files that haven't changed since last sync.
  const verifyCacheFile = path.join(gameDir, '.bd-verify-cache.json');
  let verifyCache = {};
  try { if (fs.existsSync(verifyCacheFile)) verifyCache = JSON.parse(fs.readFileSync(verifyCacheFile, 'utf8')); } catch {}
  const newVerifyCache = {};

  // Parallel SHA1 verification with stat-based shortcut.
  const allMods = (manifest.mods || manifest.files || []);
  const modChecks = await pMap(allMods, async (f) => {
    const dest = path.join(gameDir, f.path);
    let st;
    try { st = fs.statSync(dest); } catch { st = null; }
    if (!st) return { kind: 'file', ...f, dest };

    const cached = verifyCache[f.path];
    if (cached && cached.size === st.size && cached.mtime === st.mtimeMs) {
      // mtime+size unchanged since last sync — cached.sha1 is authoritative.
      if (cached.sha1 === f.sha1) {
        newVerifyCache[f.path] = cached;
        return null;
      }
      // File unchanged on disk but manifest expects a different hash → redownload, skip re-hashing.
      return { kind: 'file', ...f, dest };
    }
    const local = await sha1File(dest);
    if (local === f.sha1) {
      newVerifyCache[f.path] = { size: st.size, mtime: st.mtimeMs, sha1: local };
      return null;
    }
    return { kind: 'file', ...f, dest };
  }, SHA1_CONCURRENCY);
  const modsTasks = modChecks.filter(Boolean);

  const stateFile = path.join(gameDir, '.bd-bundles.json');
  let state = {};
  try { if (fs.existsSync(stateFile)) state = JSON.parse(fs.readFileSync(stateFile, 'utf8')); } catch {}
  const bundleTasks = [];
  for (const b of (manifest.bundles || [])) {
    if (state[b.path] !== b.sha1) bundleTasks.push({ kind: 'bundle', ...b });
  }

  const total = modsTasks.length + bundleTasks.length;
  onLog?.(`Manifest v${manifest.version}: ${modsTasks.length} mods + ${bundleTasks.length} bundles to update`);

  for (const rel of (manifest.removed || [])) {
    const p = path.join(gameDir, rel);
    if (fs.existsSync(p) && !dryRun) {
      rmrf(p);
      onLog?.(`Removed: ${rel}`);
    }
  }

  if (dryRun) return { ...manifest, _pending: total };

  let done = 0;
  const cacheDir = path.join(gameDir, '.bd-cache');
  fs.mkdirSync(cacheDir, { recursive: true });

  // Parallel mod downloads. Per-file byte progress is noisy with N concurrent
  // streams, so we report aggregate file-completion progress instead.
  await pMap(modsTasks, async (t) => {
    onLog?.(`Mod: ${t.path}`);
    await downloadFile(t.url, t.dest);
    try {
      const st = fs.statSync(t.dest);
      newVerifyCache[t.path] = { size: st.size, mtime: st.mtimeMs, sha1: t.sha1 };
    } catch {}
    done++;
    onProgress?.({ file: t.path, index: done, total, finished: true });
  }, DOWNLOAD_CONCURRENCY);

  // Bundles are big zips that we extract — keep these sequential to avoid
  // disk thrashing during extraction. Persist state once at the end.
  for (const b of bundleTasks) {
    const zipPath = path.join(cacheDir, `${b.path.replace(/[\\/]/g, '_')}.zip`);
    onLog?.(`Bundle: ${b.path} (downloading)`);
    await downloadFile(b.url, zipPath, (rec, sz) => {
      onProgress?.({ file: `${b.path}.zip`, index: done + 1, total, bytes: rec, bytesTotal: sz });
    });
    const dir = path.join(gameDir, b.path);
    onLog?.(`Bundle: ${b.path} (extracting)`);
    rmrf(dir);
    fs.mkdirSync(dir, { recursive: true });
    await extract(zipPath, { dir });
    fs.rmSync(zipPath, { force: true });
    state[b.path] = b.sha1;
    done++;
    onProgress?.({ file: b.path, index: done, total, finished: true });
  }
  if (bundleTasks.length) {
    fs.writeFileSync(stateFile, JSON.stringify(state, null, 2));
  }

  // Persist caches so the next launch can skip work.
  try { fs.writeFileSync(verifyCacheFile, JSON.stringify(newVerifyCache)); } catch {}
  try { fs.writeFileSync(syncStateFile, JSON.stringify({ version: manifest.version, clean: true, ts: Date.now() })); } catch {}

  onLog?.(`Sync complete: ${done}/${total}`);
  return manifest;
}

module.exports = { syncManifest, downloadFile, sha1File, fetchManifest };
