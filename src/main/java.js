// Auto-download Adoptium Temurin JRE if needed
const fs = require('fs');
const path = require('path');
const { execFile } = require('child_process');
const extract = require('extract-zip');
const { downloadFile } = require('./manifest');

function runCmd(cmd, args) {
  return new Promise((resolve) => {
    execFile(cmd, args, { windowsHide: true }, (err, stdout, stderr) => {
      resolve({ ok: !err, stdout, stderr: stderr || (err && err.message) });
    });
  });
}

async function getJavaMajor(javaExe) {
  const r = await runCmd(javaExe, ['-version']);
  const text = r.stderr + r.stdout;
  const m = text.match(/version "(\d+)(?:\.(\d+))?/);
  if (!m) return null;
  let major = parseInt(m[1], 10);
  if (major === 1) major = parseInt(m[2], 10); // legacy "1.8"
  return major;
}

async function ensureJava({ javaDir, requiredMajor = 21, onLog }) {
  // Try bundled in javaDir/jdk-XX/bin/java.exe
  const localCandidates = fs.existsSync(javaDir)
    ? fs.readdirSync(javaDir)
        .filter(n => fs.statSync(path.join(javaDir, n)).isDirectory())
        .map(n => path.join(javaDir, n, 'bin', 'java.exe'))
        .filter(p => fs.existsSync(p))
    : [];
  for (const c of localCandidates) {
    const m = await getJavaMajor(c);
    if (m === requiredMajor) { onLog?.(`Java ${m} found: ${c}`); return c; }
  }

  // Try system java
  const sys = await runCmd('java', ['-version']);
  if (sys.ok || sys.stderr) {
    const text = sys.stderr + sys.stdout;
    const m = text.match(/version "(\d+)/);
    if (m && parseInt(m[1], 10) === requiredMajor) {
      onLog?.(`System Java ${requiredMajor} found.`);
      return 'java';
    }
  }

  // Download Adoptium
  onLog?.(`Downloading Java ${requiredMajor} (Adoptium Temurin)...`);
  const arch = process.arch === 'x64' ? 'x64' : 'x86';
  const url = `https://api.adoptium.net/v3/binary/latest/${requiredMajor}/ga/windows/${arch}/jre/hotspot/normal/eclipse?project=jdk`;
  const zipPath = path.join(javaDir, `jre-${requiredMajor}.zip`);
  await downloadFile(url, zipPath);
  onLog?.(`Extracting Java...`);
  await extract(zipPath, { dir: javaDir });
  fs.rmSync(zipPath, { force: true });

  const dirs = fs.readdirSync(javaDir).filter(n => /jdk|jre/i.test(n));
  for (const d of dirs) {
    const p = path.join(javaDir, d, 'bin', 'java.exe');
    if (fs.existsSync(p)) {
      const m = await getJavaMajor(p);
      if (m === requiredMajor) { onLog?.(`Java ${m} ready: ${p}`); return p; }
    }
  }
  throw new Error('Java install failed');
}

module.exports = { ensureJava };
