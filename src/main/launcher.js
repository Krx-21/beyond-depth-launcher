// Wrap minecraft-launcher-core for our needs
const fs = require('fs');
const path = require('path');
const { Client } = require('minecraft-launcher-core');
const Handler = require('minecraft-launcher-core/components/handler');

// Patch child_process.spawn so every java invocation (MCLC, Forge installer, etc.)
// runs with windowsHide: true on Windows — prevents a black console/CMD window
// from appearing when the game or Forge installer starts.
if (process.platform === 'win32') {
  const cp = require('child_process');
  if (!cp._windowsHide_patched) {
    const origSpawn = cp.spawn;
    cp.spawn = function (command, args, options) {
      return origSpawn.call(this, command, args ?? [], { ...(options ?? {}), windowsHide: true });
    };
    cp._windowsHide_patched = true;
  }
}

// One-time monkey patch: filter module-path jars out of MCLC's classpath.
// MCLC 3.18 doesn't honour the `arguments.jvm` block from custom Forge JSON
// (which is required for Forge 1.17+ on Java 17+). We inject those args
// via customArgs, but the same jars MUST NOT remain on -cp or Java errors
// with "package conflicts with package in unnamed module".
if (!Handler.prototype._cleanUp_patched) {
  const origCleanUp = Handler.prototype.cleanUp;
  Handler.prototype.cleanUp = function (array) {
    const cleaned = origCleanUp.call(this, array);
    const mp = this.options?._modulePathJarPaths;
    if (!Array.isArray(mp) || mp.length === 0) return cleaned;
    const norm = p => path.resolve(String(p)).toLowerCase();
    const drop = new Set(mp.map(norm));
    return cleaned.filter(p => typeof p !== 'string' || !drop.has(norm(p)));
  };
  Handler.prototype._cleanUp_patched = true;
}

function expandPlaceholders(str, ctx) {
  return String(str)
    .split('${library_directory}').join(ctx.libraryDirectory)
    .split('${classpath_separator}').join(ctx.classpathSeparator)
    .split('${version_name}').join(ctx.versionName);
}

function buildForgeJvmArgs(gameDir, forgeVerName) {
  const file = path.join(gameDir, 'versions', forgeVerName, `${forgeVerName}.json`);
  if (!fs.existsSync(file)) return { args: [], modulePathJars: [] };
  let json;
  try { json = JSON.parse(fs.readFileSync(file, 'utf8')); }
  catch { return { args: [], modulePathJars: [] }; }
  const rawJvm = Array.isArray(json?.arguments?.jvm) ? json.arguments.jvm : [];
  const ctx = {
    libraryDirectory: path.join(gameDir, 'libraries'),
    classpathSeparator: ';',
    versionName: forgeVerName
  };
  const args = rawJvm
    .filter(a => typeof a === 'string')
    .map(a => expandPlaceholders(a, ctx));
  let modulePathJars = [];
  for (let i = 0; i < args.length - 1; i++) {
    if (args[i] === '-p' || args[i] === '--module-path') {
      modulePathJars = args[i + 1].split(';').filter(Boolean);
      break;
    }
  }
  return { args, modulePathJars };
}

let active = null;

function launchGame({ authorization, gameDir, javaPath, manifest, ramMin, ramMax, serverAddress, onLog, onClose }) {
  return new Promise((resolve, reject) => {
    const launcher = new Client();
    const forgeVerName = `${manifest.minecraft}-forge-${manifest.forge}`;

    const { args: forgeJvmArgs, modulePathJars } = buildForgeJvmArgs(gameDir, forgeVerName);
    onLog?.(`[Launcher] Forge JVM args: ${forgeJvmArgs.length} (module-path jars: ${modulePathJars.length})`);

    // ZGC Generational (Java 21+) — faster startup and lower pause times than G1GC.
    // Avoids the long GC pauses G1GC causes during initial mod/resource loading.
    // -XX:+AlwaysPreTouch: commits all RAM pages upfront to prevent stutter later.
    // -XX:+DisableExplicitGC: prevents mods from triggering full GC via System.gc().
    const gcFlags = [
      '-XX:+UnlockExperimentalVMOptions',
      '-XX:+UseZGC',
      '-XX:+ZGenerational',
      '-XX:+AlwaysPreTouch',
      '-XX:+DisableExplicitGC',
      '-XX:+PerfDisableSharedMem',
      '-XX:+UseStringDeduplication',
    ];

    const opts = {
      authorization,
      root: gameDir,
      javaPath,
      version: {
        number: manifest.minecraft,
        type: 'release',
        custom: forgeVerName  // use installed forge version folder
      },
      memory: { max: `${ramMax}G`, min: `${ramMin}G` },
      window: { width: 1280, height: 720 },
      customArgs: [...gcFlags, ...forgeJvmArgs],
      // Read by our monkey-patched Handler.prototype.cleanUp
      _modulePathJarPaths: modulePathJars
    };

    if (serverAddress) {
      const [host, port] = serverAddress.split(':');
      opts.quickPlay = { type: 'multiplayer', identifier: port ? `${host}:${port}` : host };
    }

    launcher.on('debug', e => onLog?.(`[mclc] ${e}`));
    launcher.on('data',  e => onLog?.(String(e).trimEnd()));
    launcher.on('progress', p => onLog?.(`[mclc:progress] ${p.type} ${p.task}/${p.total}`));
    launcher.on('close', code => {
      onClose?.(code);
      active = null;
      resolve(code);
    });

    launcher.launch(opts).then(child => {
      active = child;
      onLog?.('[Launcher] Minecraft process started.');
      try {
        if (child?.stdout) {
          child.stdout.on('data', d => onLog?.(`[jvm:out] ${String(d).trimEnd()}`));
        }
        if (child?.stderr) {
          child.stderr.on('data', d => onLog?.(`[jvm:err] ${String(d).trimEnd()}`));
        }
        child?.on?.('error', e => onLog?.(`[jvm:spawn-error] ${e.message}`));
      } catch (e) {
        onLog?.(`[Launcher] Could not attach stdio listeners: ${e.message}`);
      }
    }).catch(err => {
      onLog?.(`[Launcher] Launch error: ${err.message}`);
      reject(err);
    });
  });
}

function stopGame() {
  if (active) { try { active.kill(); } catch {} active = null; }
}

module.exports = { launchGame, stopGame };
