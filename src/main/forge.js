// Ensure Forge installer is downloaded and Forge version is installed
const fs = require('fs');
const path = require('path');
const { execFile } = require('child_process');
const { downloadFile, sha1File } = require('./manifest');

function runJava(javaPath, args, cwd, onLog) {
  return new Promise((resolve, reject) => {
    const p = execFile(javaPath, args, { cwd, windowsHide: true, maxBuffer: 50 * 1024 * 1024 });
    p.stdout?.on('data', d => onLog?.(String(d).trimEnd()));
    p.stderr?.on('data', d => onLog?.(String(d).trimEnd()));
    p.on('exit', code => code === 0 ? resolve() : reject(new Error(`Forge installer exit ${code}`)));
    p.on('error', reject);
  });
}

async function ensureForge({ forgeDir, manifest, javaPath, gameDir, onLog }) {
  const fi = manifest.forgeInstaller;
  const forgeVerName = `${manifest.minecraft}-forge-${manifest.forge}`;
  const versionsDir = path.join(gameDir, 'versions', forgeVerName);
  const alreadyInstalled = fs.existsSync(path.join(versionsDir, `${forgeVerName}.json`));

  if (alreadyInstalled) {
    onLog?.(`Forge ${manifest.forge} already installed.`);
    return null;
  }

  if (!fi) throw new Error('manifest.forgeInstaller missing (and Forge is not installed yet)');

  const installerPath = path.join(forgeDir, `forge-${manifest.minecraft}-${manifest.forge}-installer.jar`);
  const need = !fs.existsSync(installerPath) || (await sha1File(installerPath)) !== fi.sha1;
  if (need) {
    onLog?.(`Downloading Forge installer...`);
    await downloadFile(fi.url, installerPath);
  }

  onLog?.(`Installing Forge ${manifest.forge} (this takes a while)...`);
  // Forge installer requires a launcher_profiles.json in the game dir
  const lpPath = path.join(gameDir, 'launcher_profiles.json');
  if (!fs.existsSync(lpPath)) {
    fs.mkdirSync(gameDir, { recursive: true });
    fs.writeFileSync(lpPath, JSON.stringify({ profiles: {}, settings: {}, version: 3 }, null, 2));
  }
  // Forge installer headless with --installClient <gameDir>
  await runJava(javaPath, ['-jar', installerPath, '--installClient', gameDir], forgeDir, onLog);
  onLog?.(`Forge installed.`);
  return installerPath;
}

module.exports = { ensureForge };
