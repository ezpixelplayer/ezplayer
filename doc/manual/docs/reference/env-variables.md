---
sidebar_position: 3
title: Environment Variables
---

# Environment Variables

EZPlayer reads a small set of environment variables at **runtime** (Electron main
process) and a few **build-time** `VITE_*` variables when compiling the web UIs.
CLI flags with the same purpose take priority over environment variables — see
[Local Web Interface](../basics/local-web-interface.md#configuring-the-port) for
port precedence.

On the desktop app, **Show Status → HTTP Listener Status** shows the effective
LAN port and its **Source** (including when it came from an environment variable).

## Runtime variables (Electron)

These apply to the packaged desktop app and `electron .` development runs. Set them
before launching EZPlayer.

| Variable              | Default   | Description                                                                                                                                                                                       |
| --------------------- | --------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `EZPLAYER_WEB_PORT`   | `3000`    | TCP port for the main **LAN HTTP server** (web UI, REST API, WebSocket at `/ws`). Valid range: 1024–65535. Stored in electron-store after first successful use. CLI equivalent: `--web-port=<n>`. |
| `EZPLAYER_KIOSK_PORT` | `3001`    | TCP port for the **kiosk** web server (simplified public UI). Set to `0` to disable the kiosk listener. CLI equivalent: `--kiosk-port=<n>` or `--kiosk-port=0`.                                   |
| `EZP_OPEN_DEVTOOLS`   | _(unset)_ | When set to any value, opens Chromium DevTools on the main window even in **packaged** builds. Dev builds open DevTools automatically without this variable.                                      |
| `APP_MODE`            | _(unset)_ | Set to `local` to enable permissive CORS headers on the Koa server worker (main and kiosk listeners). Used for local development when the embedded UI is served from a separate origin.           |

### Examples

**Windows (Command Prompt)**

```bat
set EZPLAYER_WEB_PORT=8080
set EZPLAYER_KIOSK_PORT=8081
EZPlayer.exe
```

**Windows (PowerShell)**

```powershell
$env:EZPLAYER_WEB_PORT = "8080"
$env:EZPLAYER_KIOSK_PORT = "8081"
.\EZPlayer.exe
```

**Linux / macOS**

```bash
EZPLAYER_WEB_PORT=8080 EZPLAYER_KIOSK_PORT=8081 ./EZPlayer
```

**Disable kiosk server**

```bash
EZPLAYER_KIOSK_PORT=0 ./EZPlayer
```

### Port resolution order

For both `EZPLAYER_WEB_PORT` and `EZPLAYER_KIOSK_PORT`, EZPlayer resolves the
port in this order:

1. CLI argument (`--web-port=` / `--kiosk-port=`)
2. Environment variable
3. Stored preference (electron-store from a prior launch)
4. Built-in default (`3000` / `3001`)

If the preferred port is in use, the server tries up to ten consecutive ports.
The bound port and source are shown on **HTTP Listener Status**.

## Build-time variables (Vite)

These are read when building the **Electron renderer** or **embedded LAN UI**
with Vite. They are baked into the bundle at compile time — changing them
requires a rebuild (or restarting the Vite dev server), not just relaunching
EZPlayer.

### Electron renderer (`apps/ezplayer-ui-electron`)

| Variable                 | Description                                                                                            |
| ------------------------ | ------------------------------------------------------------------------------------------------------ |
| `VITE_EZP_CLOUD_API_URL` | Base URL for the EZRGB cloud API used by the desktop renderer's data layer (`ElectronDataStorageAPI`). |

### Embedded web UI (`apps/ezplayer-ui-embedded`)

Used by the LAN/kiosk web app for WebSocket connection setup when defaults are
not sufficient:

| Variable           | Description                                                                                                                          |
| ------------------ | ------------------------------------------------------------------------------------------------------------------------------------ |
| `VITE_WS_BASE_URL` | Full WebSocket base URL (path `/ws` is appended). When set, overrides host/port/protocol below. Example: `http://192.168.1.50:3000`. |
| `VITE_WS_HOST`     | WebSocket hostname when not using `VITE_WS_BASE_URL`. Defaults to `window.location.hostname`.                                        |
| `VITE_WS_PORT`     | WebSocket port candidate. Falls back to the page's port, then `3000`.                                                                |
| `VITE_WS_PROTOCOL` | `ws:` or `wss:`. Defaults from the page (`https:` → `wss:`).                                                                         |

Example for a standalone embedded dev build pointing at a player on another host:

```bash
VITE_WS_BASE_URL=http://192.168.1.50:3000 pnpm --filter @ezplayer/ui-embedded build:web
```

## Development helpers

| Mechanism                        | Description                                                                                                                                          |
| -------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------- |
| `pnpm dev` (`dev-with-port.mjs`) | Prompts for a port and sets `EZPLAYER_WEB_PORT` before starting `dev:direct`.                                                                        |
| `NODE_OPTIONS`                   | Standard Node.js variable. The `prod:nodetrace` script in `package.json` sets tracing flags for performance debugging — not required for normal use. |

## Related configuration (not environment variables)

These are set via **CLI flags** or in-app settings rather than environment
variables, but often appear alongside them:

| Flag / setting                                  | Purpose                                                        |
| ----------------------------------------------- | -------------------------------------------------------------- |
| `--show-folder=<path>`                          | Open a specific show folder on launch                          |
| `--reset` / `--reset-cloud` / `--reset-nocloud` | Clear persisted show-folder and welcome state, then exit       |
| `window.__EZPLAYER_MODE__`                      | Injected as `"kiosk"` in kiosk server HTML (not an OS env var) |

CLI documentation: [Command Line Interface (CLI)](./cli.md).
