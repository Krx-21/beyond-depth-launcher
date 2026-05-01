// Reconcile a local manifest.json with actual asset names on a GitHub Release.
// GitHub replaces some chars in asset filenames (spaces, apostrophes, etc).
// This script reads the release, then rewrites mod URLs in manifest.json.
//
// Usage:
//   $env:GH_TOKEN = "..."
//   node tools/reconcile-manifest.js --owner Krx-21 --repo beyond-depth-launcher --tag v0.1.0
//
// Then re-upload manifest.json (delete old asset first or use the upload script).

const fs = require('fs');
const path = require('path');
const https = require('https');

function arg(name, def = null) {
  const i = process.argv.indexOf('--' + name);
  return i === -1 ? def : process.argv[i + 1];
}

function fetchJson(url, token) {
  return new Promise((resolve, reject) => {
    const req = https.request(url, {
      headers: {
        'User-Agent': 'BeyondDepthReconcile',
        Authorization: `Bearer ${token}`,
        Accept: 'application/vnd.github+json'
      }
    }, (res) => {
      let body = '';
      res.on('data', c => body += c);
      res.on('end', () => {
        if (res.statusCode >= 200 && res.statusCode < 300) resolve(JSON.parse(body));
        else reject(new Error(`HTTP ${res.statusCode}: ${body}`));
      });
    });
    req.on('error', reject);
    req.end();
  });
}

async function main() {
  const owner = arg('owner', 'Krx-21');
  const repo  = arg('repo', 'beyond-depth-launcher');
  const tag   = arg('tag', 'v0.1.0');
  const manifestFile = arg('manifest', path.join(__dirname, '..', 'dist', 'manifest.json'));
  const token = process.env.GH_TOKEN;

  if (!token) { console.error('Set GH_TOKEN'); process.exit(1); }
  if (!fs.existsSync(manifestFile)) { console.error('No manifest:', manifestFile); process.exit(1); }

  const releases = await fetchJson(`https://api.github.com/repos/${owner}/${repo}/releases?per_page=100`, token);
  const rel = releases.find(r => r.tag_name === tag);
  if (!rel) throw new Error(`No release tag ${tag}`);

  const m = JSON.parse(fs.readFileSync(manifestFile, 'utf8'));

  // Build lookup: assetMap[expectedName] = browser_download_url
  const assetByName = {};
  for (const a of rel.assets) assetByName[a.name] = a.browser_download_url;

  // Pseudo-sanitize same as GitHub:
  // Empirically GitHub replaces [^A-Za-z0-9._+-] with '.' (keeps + and -)
  const sanitize = (s) => s.replace(/[^A-Za-z0-9._+-]/g, '.');

  let fixed = 0, missing = [];
  const fix = (entry) => {
    const file = path.basename(entry.path);
    const candidates = [file, sanitize(file)];
    for (const c of candidates) {
      if (assetByName[c]) {
        if (!entry.url.endsWith(encodeURIComponent(c)) &&
            !entry.url.endsWith(c)) {
          entry.url = assetByName[c];
          fixed++;
        }
        // Always normalize to the actual download URL:
        entry.url = assetByName[c];
        return;
      }
    }
    missing.push(entry.path);
  };

  for (const f of (m.mods || m.files || [])) fix(f);
  for (const b of (m.bundles || [])) {
    // bundle file is bundle-<dir>.zip
    const file = `bundle-${b.path}.zip`;
    if (assetByName[file]) b.url = assetByName[file];
    else missing.push('bundle:' + b.path);
  }
  if (m.forgeInstaller) {
    const file = path.basename(decodeURIComponent(m.forgeInstaller.url));
    const candidates = [file, sanitize(file), 'forge-installer.jar'];
    for (const c of candidates) {
      if (assetByName[c]) { m.forgeInstaller.url = assetByName[c]; break; }
    }
  }

  fs.writeFileSync(manifestFile, JSON.stringify(m, null, 2));
  console.log(`Reconciled. fixed=${fixed} missing=${missing.length}`);
  if (missing.length) {
    console.log('MISSING ASSETS:');
    for (const m of missing) console.log('  -', m);
  }
}

main().catch(e => { console.error(e); process.exit(1); });
