// Wrap minecraft-launcher-core for our needs
const { Client } = require('minecraft-launcher-core');

let active = null;

function launchGame({ authorization, gameDir, javaPath, manifest, ramMin, ramMax, serverAddress, onLog, onClose }) {
  return new Promise((resolve, reject) => {
    const launcher = new Client();
    const forgeVerName = `${manifest.minecraft}-forge-${manifest.forge}`;

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
      window: { width: 1280, height: 720 }
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
