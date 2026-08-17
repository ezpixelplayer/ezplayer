# Developing EZPlayer

## 🛠️ Building From Source (Developers)

Because this project is **AGPL**, the full source code is available and the build process is documented.

### Requirements

- Windows (with git bash or WSL) and C++ compiler, MacOS, or Linux with the appropriate dev packages installed
- Node.js ≥ 24 (get from nvm if needed)
- pnpm 10
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
2. It triggers on tags matching `v*.*.*` or `v*.*.*-*` (e.g. `v0.6.3`, `v1.0.0`).
3. GitHub Actions builds the Electron app on **ubuntu-latest**, **windows-2022**, and **macos-latest** in parallel, plus a Linux **arm64** build on the self-hosted Raspberry Pi runner.
4. Each build job runs `electron-builder --publish never` and uploads its output as workflow artifacts; a single `release` job then assembles them all into one GitHub **prerelease** for the tag. (Per-job auto-publishing raced across the matrix and produced duplicate releases.)
5. Build artifacts per platform:
    - **Windows** — NSIS installer (`.exe`)
    - **macOS** — DMG disk images (separate x64 and arm64)
    - **Linux x64** — AppImage, `.deb`, `.tar.gz`
    - **Linux arm64** — AppImage, `.deb` (from the Pi runner)

### Creating a release

1. Make sure all changes are merged to the branch you want to release from.
2. Update the version in `apps/ezplayer-ui-electron/package.json` if needed.
3. Tag the commit and push the tag:

    ```bash
    git tag v0.6.3
    git push origin v0.6.3
    ```

4. GitHub Actions picks up the tag push and runs the **Build & Release EZPlayer** workflow.
5. Once the workflow completes, a new prerelease appears on the [GitHub Releases](https://github.com/ezpixelplayer/ezplayer/releases) page with installers for all platforms.

You can also trigger the workflow manually from the Actions tab using **workflow_dispatch** — that builds all platforms but publishes no release (releases only happen on tag pushes).

### Auto-update

The app includes an auto-update mechanism (`electron-updater`) that follows stable GitHub releases. All interaction is in-app (Settings → Software Update — mode, current vs. latest version, check/download/install actions); the main process pops no native dialogs. Two modes, persisted in electron-store:

- **Check automatically** (default): checks on startup and pre-downloads when the system is idle with no schedule running; an in-app toast reminds the user when a version is available (skipped versions stay quiet).
- **Manual**: no unsolicited checks; everything is driven from the settings pane.

Installing never restarts the player on its own. If a schedule is active, install defers to quit; the settings pane asks for explicit confirmation before a forced restart. The `--no-update-check` switch suppresses both the startup check and the idle watcher (useful in dev).

## Raspberry Pi 5 (ARM64 Linux) Builds

This is supported.  The app's native addons (`win_hirez_timer`, `affinity`, `icmp_ping`) all have Linux/POSIX code paths and will compile natively on ARM64. The `mpg123-decoder-ezp` dependency is WASM-based, so it's architecture-independent.

GitHub Actions doesn't have native ARM64 Linux runners on the free tier, so Pi builds need to be done locally on the Pi itself.  We currently have a self-hosted runner on a Pi for this: the release workflow's `build-pi` job builds arm64 on it automatically, and its AppImage/`.deb` land in the same prerelease as the other platforms — no manual steps needed.

The rest of this section is the manual fallback for when the runner is down (or for local testing).

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
git checkout <tag>           # e.g. v0.6.3
pnpm install
pnpm run build:linux         # builds packages then runs electron-builder --linux
```

This produces an AppImage for `arm64` in `apps/ezplayer-ui-electron/release/`.

### Publishing to the existing GitHub Release

After the GitHub Actions workflow has created the release from the tag, upload the manually built Pi artifact to that same release:

```bash
gh release upload v0.6.3 \
  apps/ezplayer-ui-electron/release/*.AppImage \
  --repo ezpixelplayer/ezplayer
```

The arm64 AppImage will appear alongside the x64 Windows/macOS/Linux artifacts on the Releases page.

## CI / Build Checks

Pull requests targeting `main`, `master`, `production`, or `develop` trigger:

- **Build Check** (`.github/workflows/build.yml`) — builds on all three platforms to verify the PR doesn't break the build.
- **Unit Tests** (`.github/workflows/test.yml`) — also runs on pushes to `main`.

**Integration Tests** (`.github/workflows/integration.yml`) are heavier — they build the app, launch headless EZPlayer instances, and verify DDP output at a mock controller — so they run nightly and on demand (workflow_dispatch) rather than per-PR.
