// Generate manifest.json (mods individually + config/kubejs/etc as bundles)
//
// Usage:
//   node tools/generate-manifest.js \
//     --server "C:\path\to\Beyond Depth Sever" \
//     --base-url "https://github.com/Krx-21/beyond-depth-launcher/releases/download/v0.1.0" \
//     --version 1.0.0 \
//     --forge-installer "C:\path\to\forge-installer.jar" \
//     --out dist\manifest.json

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const AdmZip = require('adm-zip');

function arg(name, def = null) {
  const i = process.argv.indexOf('--' + name);
  return i === -1 ? def : process.argv[i + 1];
}

function sha1File(file) {
  const h = crypto.createHash('sha1');
  h.update(fs.readFileSync(file));
  return h.digest('hex');
}

function walk(dir, out = []) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, e.name);
    if (e.isDirectory()) walk(full, out);
    else out.push(full);
  }
  return out;
}

function zipDirectory(srcDir, outZip) {
  const zip = new AdmZip();
  zip.addLocalFolder(srcDir);
  zip.writeZip(outZip);
}

function main() {
  const serverDir      = arg('server', 'C:\\Users\\godof\\Documents\\Beyond Depth Sever');
  const baseUrl        = arg('base-url');
  const version        = arg('version', '1.0.0');
  const mc             = arg('mc', '1.20.1');
  const forge          = arg('forge', '47.4.20');
  const javaVersion    = parseInt(arg('java', '21'), 10);
  const forgeInstaller = arg('forge-installer');
  const outFile        = arg('out', path.join(__dirname, '..', 'dist', 'manifest.json'));
  const distDir        = path.dirname(outFile);

  if (!baseUrl) {
    console.error('Missing --base-url. Example: https://github.com/Krx-21/beyond-depth-launcher/releases/download/v0.1.0');
    process.exit(1);
  }
  if (!fs.existsSync(serverDir)) {
    console.error('Server dir not found:', serverDir);
    process.exit(1);
  }

  fs.mkdirSync(distDir, { recursive: true });
  fs.mkdirSync(path.join(distDir, 'mods'), { recursive: true });

  // ---- MODS (individual) ----
  // Server mods first, then overlay client-only mods (rendering, etc.) by filename.
  const clientDir = arg('client', null);
  const modSources = [path.join(serverDir, 'mods')];
  if (clientDir && fs.existsSync(path.join(clientDir, 'mods'))) {
    modSources.push(path.join(clientDir, 'mods'));
  }
  const mods = [];
  const seen = new Set();
  const modUploads = [];
  for (const modsSrc of modSources) {
    if (!fs.existsSync(modsSrc)) continue;
    for (const f of fs.readdirSync(modsSrc)) {
      if (seen.has(f.toLowerCase())) continue;
      const full = path.join(modsSrc, f);
      if (!fs.statSync(full).isFile()) continue;
      if (!/\.(jar|disabled)$/i.test(f)) continue;
      const hash = sha1File(full);
      const enc = encodeURIComponent(f);
      mods.push({
        path: 'mods/' + f,
        url: `${baseUrl}/${enc}`,
        sha1: hash,
        size: fs.statSync(full).size
      });
      modUploads.push(full);
      seen.add(f.toLowerCase());
    }
  }
  console.log(`Mods: ${mods.length} (sources: ${modSources.length})`);

  // ---- BUNDLES (zip whole dir) ----
  const bundleDirs = ['config', 'kubejs', 'defaultconfigs', 'resourcepacks', 'shaderpacks'];
  const bundles = [];
  const bundleUploads = [];
  for (const sub of bundleDirs) {
    const srcDir = path.join(serverDir, sub);
    if (!fs.existsSync(srcDir)) continue;
    const zipName = `bundle-${sub}.zip`;
    const zipPath = path.join(distDir, zipName);
    console.log(`Zipping ${sub} -> ${zipName} ...`);
    zipDirectory(srcDir, zipPath);
    const hash = sha1File(zipPath);
    const size = fs.statSync(zipPath).size;
    bundles.push({
      path: sub,
      url: `${baseUrl}/${encodeURIComponent(zipName)}`,
      sha1: hash,
      size
    });
    bundleUploads.push(zipPath);
    console.log(`  ${sub}: ${(size/1024/1024).toFixed(1)} MB`);
  }

  // ---- FORGE INSTALLER ----
  let forgeInstallerEntry = null;
  const forgeUploads = [];
  if (forgeInstaller && fs.existsSync(forgeInstaller)) {
    forgeInstallerEntry = {
      url: `${baseUrl}/${encodeURIComponent(path.basename(forgeInstaller))}`,
      sha1: sha1File(forgeInstaller),
      size: fs.statSync(forgeInstaller).size
    };
    forgeUploads.push(forgeInstaller);
  }

  const manifest = {
    version,
    minecraft: mc,
    forge,
    javaVersion,
    forgeInstaller: forgeInstallerEntry,
    mods,
    bundles,
    removed: []
  };

  fs.writeFileSync(outFile, JSON.stringify(manifest, null, 2));
  console.log(`\nManifest -> ${outFile}`);

  // Upload list (everything that needs to go to the GitHub release)
  const allUploads = [outFile, ...modUploads, ...bundleUploads, ...forgeUploads];
  const listFile = path.join(distDir, 'upload-list.txt');
  fs.writeFileSync(listFile, allUploads.join('\n'));
  console.log(`Upload list -> ${listFile} (${allUploads.length} files)`);
}

main();
