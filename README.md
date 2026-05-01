# Beyond Depth Launcher

Standalone Minecraft modpack launcher for Beyond Depth (Forge 1.20.1).

**Features**
- One-click play — no manual Forge install
- Offline mode (TLauncher-style, no Microsoft account needed)
- Auto-update game files via GitHub Releases manifest
- Auto-update launcher via electron-updater
- RAM slider, multi-profile, custom skin (requires CustomSkinLoader on server)

## Architecture

```
[Player launcher (Electron)]  ──fetches──► [GitHub Releases]
       │                                       │
       │ downloads via manifest.json           │ assets:
       │                                       │  - manifest.json
       └──► launches via minecraft-launcher    │  - mods/*.jar (flat names)
            -core (offline UUID)               │  - forge installer
                                               │  - news.md
```

## Develop

```powershell
cd "C:\Users\godof\Documents\Beyond Depth Launcher"
npm install
npm run dev
```

## Build installer (.exe)

```powershell
npm run build
```

Output: `dist/Beyond Depth Launcher Setup x.y.z.exe`

## Publish a new modpack version (server owner)

1. **Generate manifest** from your server folder:

   ```powershell
   node tools/generate-manifest.js `
     --server "C:\Users\godof\Documents\Beyond Depth Sever" `
     --base-url "https://github.com/YOUR_USER/beyond-depth-launcher/releases/download/modpack-v1.0.0" `
     --version 1.0.0 `
     --forge-installer "C:\path\to\forge-1.20.1-47.4.20-installer.jar" `
     --out dist\manifest.json
   ```

2. **Create GitHub Release** with tag `modpack-v1.0.0`. Upload these as release assets:
   - `dist/manifest.json`
   - All files listed in `dist/upload-list.txt` (each file uploaded with its base name — manifest URL points to flat asset URL)
   - `news.md` (optional)
   - **Also publish a release with tag matching launcher version** for `latest/download/manifest.json` to resolve. Use a separate release named `latest` or update the manifestUrl in launcher settings to point to your specific tag.

3. **For "always points to newest"**, use this manifestUrl pattern:
   `https://github.com/USER/beyond-depth-launcher/releases/latest/download/manifest.json`

   And tag your modpack release as `latest`-style by giving it the highest semver and not pre-release.

## Auto-update (launcher itself)

`electron-updater` checks GitHub Releases of THIS repo (`package.json` → `build.publish`).
To publish a new launcher build:

```powershell
$env:GH_TOKEN = "ghp_xxx"   # personal access token with repo scope
npm run publish
```

It will create/update a draft release for the launcher version. Promote the draft to "Released" and clients will auto-update.

## Required server-side mods (so launcher features work)

- **CustomSkinLoader** — for offline-mode skins. Players' skins go to `gameDir/CustomSkinLoader/LocalSkin/skins/<name>.png`.

## Game files location

- Launcher root: `%APPDATA%\BeyondDepthLauncher\`
- Game dir:      `%APPDATA%\BeyondDepthLauncher\game\`
- Bundled Java:  `%APPDATA%\BeyondDepthLauncher\java\`
- Forge cache:   `%APPDATA%\BeyondDepthLauncher\forge\`

## Configure for your repo

In `package.json`:
```json
"publish": [{
  "provider": "github",
  "owner": "Krx-21",
  "repo": "beyond-depth-launcher"
}]
```

In `src/main/index.js` defaults (`manifestUrl`):
```js
manifestUrl: 'https://github.com/Krx-21/beyond-depth-launcher/releases/latest/download/manifest.json'
```
