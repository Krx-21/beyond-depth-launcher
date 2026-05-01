// Manifest sync: download/update mods, config bundles, etc.
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const axios = require('axios');
const extract = require('extract-zip');

async function fetchManifest(url) {
  const r = await axios.get(url, { timeout: 15000, responseType: 'json' });
  return r.data;
}

function sha1File(filePath) {
  return new Promise((resolve, reject) => {
    if (!fs.existsSync(filePath)) return resolve(null);
    const h = crypto.createHash('sha1');
    const s = fs.createReadStream(filePath);
    s.on('data', (d) => h.update(d));
    s.on('end', () => resolve(h.digest('hex')));
    s.on('error', reject);
  });
}

async function downloadFile(url, dest, onChunk) {
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  const tmp = dest + '.tmp';
  const writer = fs.createWriteStream(tmp);
  const response = await axios.get(url, { responseType: 'stream', timeout: 120000, maxRedirects: 5 });
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

  const modsTasks = [];
  for (const f of (manifest.mods || manifest.files || [])) {
    const dest = path.join(gameDir, f.path);
    const local = await sha1File(dest);
    if (local !== f.sha1) modsTasks.push({ kind: 'file', ...f, dest });
  }

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

  for (const t of modsTasks) {
    onLog?.(`Mod: ${t.path}`);
    await downloadFile(t.url, t.dest, (rec, sz) => {
      onProgress?.({ file: t.path, index: done + 1, total, bytes: rec, bytesTotal: sz });
    });
    done++;
    onProgress?.({ file: t.path, index: done, total, finished: true });
  }

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
    fs.writeFileSync(stateFile, JSON.stringify(state, null, 2));
    done++;
    onProgress?.({ file: b.path, index: done, total, finished: true });
  }

  onLog?.(`Sync complete: ${done}/${total}`);
  return manifest;
}

module.exports = { syncManifest, downloadFile, sha1File, fetchManifest };
