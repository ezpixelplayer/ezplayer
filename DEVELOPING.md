# Developing EZPlayer

## 🛠️ Building From Source (Developers)

Because this project is **AGPL**, the full source code is available and the build process is documented.

### Requirements

- Windows (with git bash or WSL) and C++ compiler, MacOS, or Linux with the appropriate dev packages installed
- Node.js ≥ 22 (get from nvm if needed)
- pnpm
- Python 3 + build tools (for native modules)
- Git

### Clone, Install, and Build

```bash
git clone https://github.com/ezpixelplayer/ezplayer.git
cd ezplayer
pnpm install
pnpm build          # Build for current platform
pnpm build:win      # Build for Windows
pnpm build:mac      # Build for macOS
pnpm build:linux    # Build for Linux
```

Then, fix whatever went wrong :-).

Your main build will appear in `apps/ezplayer-ui-electron/release`.

## Release Process

Releases are automated via GitHub Actions. Pushing a version tag triggers a build on all three platforms (Windows, macOS, Linux) and publishes the artifacts as a GitHub **prerelease**.

### How it works

1. The workflow is defined in `.github/workflows/release.yaml`.
2. It triggers on tags matching `v*.*.*` or `v*.*.*-*` (e.g. `v0.1.0-prealpha`, `v1.0.0`).
3. GitHub Actions builds the Electron app on **ubuntu-latest**, **windows-latest**, and **macos-latest** in parallel.
4. `electron-builder` is configured with `"publish": [{ "provider": "github", "releaseType": "prerelease" }]`, so it automatically uploads the installers to a GitHub Release for the tag.
5. Build artifacts per platform:
   - **Windows** — NSIS installer (`.exe`)
   - **macOS** — DMG disk image (universal arch)
   - **Linux** — AppImage

### Creating a release

1. Make sure all changes are merged to the branch you want to release from.
2. Update the version in `apps/ezplayer-ui-electron/package.json` if needed.
3. Tag the commit and push the tag:

   ```bash
   git tag v0.1.1-prealpha
   git push origin v0.1.1-prealpha
   ```

4. GitHub Actions picks up the tag push and runs the **Build & Release EZPlayer** workflow.
5. Once the workflow completes, a new prerelease appears on the [GitHub Releases](https://github.com/ezpixelplayer/ezplayer/releases) page with installers for all platforms.

You can also trigger the workflow manually from the Actions tab using **workflow_dispatch**.

### Auto-update

The app includes an auto-update mechanism (`electron-updater`) that checks for new GitHub releases on startup and periodically when the system is idle. Users are prompted to download and install updates. If a schedule is active, the update is deferred until the app is quit.

## Raspberry Pi 5 (ARM64 Linux) Builds

GitHub Actions doesn't have native ARM64 Linux runners on the free tier, so Pi builds need to be done locally on the Pi itself. The app's native addons (`win_hirez_timer`, `affinity`, `icmp_ping`) all have Linux/POSIX code paths and will compile natively on ARM64. The `mpg123-decoder-ezp` dependency is WASM-based, so it's architecture-independent.

### Prerequisites (on the Pi)

1. **Raspberry Pi OS 64-bit** (Bookworm or later recommended)
2. **Node.js 24** — install via [NodeSource](https://github.com/nodesource/distributions) or `nvm`:
   ```bash
   curl -fsSL https://deb.nodesource.com/setup_24.x | sudo bash -
   sudo apt-get install -y nodejs
   ```
3. **pnpm 10**:
   ```bash
   corepack enable && corepack prepare pnpm@10 --activate
   ```
4. **Build tools** for native addons:
   ```bash
   sudo apt-get install -y build-essential python3 git
   ```
5. **GitHub CLI** (`gh`) for uploading release artifacts:
   ```bash
   sudo apt-get install -y gh
   gh auth login
   ```

### Building on the Pi

```bash
git clone https://github.com/ezpixelplayer/ezplayer.git
cd ezplayer
git checkout <tag>           # e.g. v0.1.1-prealpha
pnpm install
pnpm run build:linux         # builds packages then runs electron-builder --linux
```

This produces an AppImage for `arm64` in `apps/ezplayer-ui-electron/release/`.

### Publishing to the existing GitHub Release

After the GitHub Actions workflow has created the release from the tag, upload the Pi artifact to that same release:

```bash
gh release upload v0.1.1-prealpha \
  apps/ezplayer-ui-electron/release/*.AppImage \
  --repo ezpixelplayer/ezplayer
```

The arm64 AppImage will appear alongside the x64 Windows/macOS/Linux artifacts on the Releases page.

### Tips

- You can also set up the Pi as a [self-hosted GitHub Actions runner](https://docs.github.com/en/actions/hosting-your-own-runners) so arm64 builds trigger automatically on tag push — just add `runs-on: self-hosted` as an additional matrix entry in `release.yaml`.

## CI / Build Checks

Pull requests targeting `main`, `master`, `production`, or `develop` trigger the **Build Check** workflow (`.github/workflows/build.yml`), which builds on all three platforms to verify the PR doesn't break the build.
