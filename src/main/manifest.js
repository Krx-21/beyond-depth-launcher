// Manifest sync: download/update mods, config, etc. based on remote manifest.json
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const axios = require('axios');

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
  const response = await axios.get(url, { responseType: 'stream', timeout: 60000, maxRedirects: 5 });
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

/**
 * manifest format:
 * {
 *   "version": "1.0.5",
 *   "minecraft": "1.20.1",
 *   "forge": "47.4.20",
 *   "javaVersion": 21,
 *   "forgeInstaller": { "url": "...", "sha1": "...", "size": ... },
 *   "files": [ { "path": "mods/x.jar", "url": "...", "sha1": "...", "size": ... } ],
 *   "removed": [ "mods/old.jar" ]
 * }
 */
async function syncManifest({ manifestUrl, gameDir, forgeDir, onProgress, onLog, dryRun = false }) {
  onLog?.(`Fetching manifest: ${manifestUrl}`);
  const manifest = await fetchManifest(manifestUrl);
  onLog?.(`Manifest version ${manifest.version} — ${manifest.files?.length || 0} files`);

  const tasks = [];
  for (const f of (manifest.files || [])) {
    const dest = path.join(gameDir, f.path);
    const local = await sha1File(dest);
    if (local !== f.sha1) tasks.push({ ...f, dest });
  }

  // Removals
  for (const rel of (manifest.removed || [])) {
    const p = path.join(gameDir, rel);
    if (fs.existsSync(p) && !dryRun) {
      fs.rmSync(p, { force: true });
      onLog?.(`Removed: ${rel}`);
    }
  }

  if (dryRun) {
    return { ...manifest, _pending: tasks.length };
  }

  let done = 0;
  for (const t of tasks) {
    onLog?.(`Downloading ${t.path}`);
    await downloadFile(t.url, t.dest, (rec, total) => {
      onProgress?.({
        file: t.path,
        index: done + 1,
        total: tasks.length,
        bytes: rec,
        bytesTotal: total
      });
    });
    done++;
    onProgress?.({ file: t.path, index: done, total: tasks.length, bytes: 0, bytesTotal: 0, finished: true });
  }
  onLog?.(`Sync complete (${done} files updated)`);
  return manifest;
}

module.exports = { syncManifest, downloadFile, sha1File, fetchManifest };
