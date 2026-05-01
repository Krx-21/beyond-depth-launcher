// Generate manifest.json from a server folder for distribution
// Usage:
//   node tools/generate-manifest.js \
//     --server "C:\Users\godof\Documents\Beyond Depth Sever" \
//     --base-url https://github.com/USER/beyond-depth-launcher/releases/download/v1.0.0 \
//     --version 1.0.0 \
//     --mc 1.20.1 --forge 47.4.20 \
//     --forge-installer "C:\path\forge-1.20.1-47.4.20-installer.jar" \
//     --out manifest.json
//
// Then upload all files in the output (manifest.json + listed mod jars + forge installer)
// as assets to the matching GitHub Release.

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

function arg(name, def = null) {
  const i = process.argv.indexOf('--' + name);
  if (i === -1) return def;
  return process.argv[i + 1];
}

function sha1(file) {
  const h = crypto.createHash('sha1');
  h.update(fs.readFileSync(file));
  return h.digest('hex');
}

function walk(dir, baseDir, out) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, e.name);
    if (e.isDirectory()) walk(full, baseDir, out);
    else out.push(full);
  }
}

function main() {
  const serverDir       = arg('server', 'C:\\Users\\godof\\Documents\\Beyond Depth Sever');
  const baseUrl         = arg('base-url');
  const version         = arg('version', '1.0.0');
  const mc              = arg('mc', '1.20.1');
  const forge           = arg('forge', '47.4.20');
  const javaVersion     = parseInt(arg('java', '21'), 10);
  const forgeInstaller  = arg('forge-installer');
  const outFile         = arg('out', path.join(__dirname, '..', 'dist', 'manifest.json'));

  if (!baseUrl) {
    console.error('Missing --base-url. Example: https://github.com/USER/beyond-depth-launcher/releases/download/v1.0.0');
    process.exit(1);
  }
  if (!fs.existsSync(serverDir)) {
    console.error('Server dir not found:', serverDir);
    process.exit(1);
  }

  // Folders to include from server (modpack content only)
  const includeDirs = ['mods', 'config', 'kubejs', 'defaultconfigs', 'resourcepacks', 'shaderpacks'];
  // Skip patterns
  const skip = (rel) => {
    return /(^|[\\/])(saves|world|crash-reports|logs|cache|libraries|versions|backups|local|data|essential|fancymenu_data|mod_data|downloads)([\\/]|$)/i.test(rel)
        || /\.(log|tmp|lock)$/i.test(rel);
  };

  const files = [];
  for (const sub of includeDirs) {
    const full = path.join(serverDir, sub);
    if (!fs.existsSync(full)) continue;
    const collected = [];
    walk(full, full, collected);
    for (const f of collected) {
      const rel = path.relative(serverDir, f).replace(/\\/g, '/');
      if (skip(rel)) continue;
      const stat = fs.statSync(f);
      const hash = sha1(f);
      const fileName = encodeURIComponent(path.basename(f));
      files.push({
        path: rel,
        url: `${baseUrl}/${fileName}`,
        sha1: hash,
        size: stat.size
      });
    }
  }

  let forgeInstallerEntry = null;
  if (forgeInstaller && fs.existsSync(forgeInstaller)) {
    forgeInstallerEntry = {
      url: `${baseUrl}/${encodeURIComponent(path.basename(forgeInstaller))}`,
      sha1: sha1(forgeInstaller),
      size: fs.statSync(forgeInstaller).size
    };
  }

  const manifest = {
    version,
    minecraft: mc,
    forge,
    javaVersion,
    forgeInstaller: forgeInstallerEntry,
    files,
    removed: []
  };

  fs.mkdirSync(path.dirname(outFile), { recursive: true });
  fs.writeFileSync(outFile, JSON.stringify(manifest, null, 2));
  console.log(`Wrote ${outFile} — ${files.length} files`);

  // Also generate an upload list (since GitHub release flat-uploads, we collect all jars/files into one list)
  const uploadList = path.join(path.dirname(outFile), 'upload-list.txt');
  const lines = files.map(f => path.join(serverDir, f.path));
  if (forgeInstaller && fs.existsSync(forgeInstaller)) lines.push(forgeInstaller);
  fs.writeFileSync(uploadList, lines.join('\n'));
  console.log(`Wrote ${uploadList}`);
}

main();
