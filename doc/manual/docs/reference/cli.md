---
sidebar_position: 2
title: Command Line Interface (CLI)
---

# Command Line Interface (CLI)

The **desktop EZPlayer** application (Windows, macOS, Linux) accepts command-line
flags when launched from a terminal, shortcut, or service script. Flags control
the show folder, LAN web server ports, and first-run behavior.

CLI arguments take **priority over** [environment variables](./env-variables.md)
when both configure the same setting (for example `--web-port=` beats
`EZPLAYER_WEB_PORT`).

On Windows, append flags after the executable path. On Linux AppImage/deb
packages, `executableArgs` may include `--no-sandbox` automatically — see
[Platform notes](#platform-notes).

## Quick reference

| Flag                   | Purpose                                                         |
| ---------------------- | --------------------------------------------------------------- |
| `--show-folder=<path>` | Open the given show folder on launch                            |
| `--showFolder=<path>`  | Alias of `--show-folder`                                        |
| `--show-folder <path>` | Same as above (space-separated value)                           |
| `--web-port=<n>`       | LAN HTTP server port (default `3000`)                           |
| `--kiosk-port=<n>`     | Kiosk web server port (default `3001`)                          |
| `--kiosk-port=0`       | Disable the kiosk server                                        |
| `--reset`              | Clear persisted state, then quit (cloud welcome on next launch) |
| `--reset-cloud`        | Same as `--reset`                                               |
| `--reset-nocloud`      | Clear persisted state, pin local-only welcome, then quit        |

## Show folder

Point EZPlayer at a specific [show folder](../settings/show-folder.md) without
using the folder picker:

```bash
EZPlayer.exe --show-folder=C:\Shows\MyDisplay
```

```bash
./EZPlayer --show-folder=/home/user/shows/my-display
```

Accepted forms:

- `--show-folder=C:\path\to\folder`
- `--showFolder=C:\path\to\folder` (camelCase alias)
- `--show-folder C:\path\to\folder` (value as the next argument)

The path must **exist** as a directory. If it is valid, EZPlayer saves it as
the persisted show folder and loads sequences, playlists, schedule, and layout
from there.

If the folder is missing required files (for xLights-managed shows:
`xlights_rgbeffects.xml` and `xlights_networks.xml`), EZPlayer warns you and
offers to pick another folder.

Only **one EZPlayer instance** can lock a given show folder at a time. A second
instance using the same folder is prompted to choose a different path or quit.

## LAN and kiosk ports

EZPlayer starts a **Koa HTTP server** for the [LAN web interface](../basics/local-web-interface.md)
and optionally a second **kiosk** listener. Configure ports at launch:

```bash
EZPlayer.exe --web-port=8080 --kiosk-port=8081
```

| Flag               | Default | Description                                              |
| ------------------ | ------- | -------------------------------------------------------- |
| `--web-port=<n>`   | `3000`  | Main LAN UI, [REST API](./api.md), and WebSocket (`/ws`) |
| `--kiosk-port=<n>` | `3001`  | Simplified public UI (jukebox/player only)               |
| `--kiosk-port=0`   | —       | Do not start the kiosk server                            |

Valid ports: **1024–65535**.

### Port resolution order

For each port setting, EZPlayer resolves the value in this order:

1. **CLI flag** (`--web-port=` / `--kiosk-port=`)
2. **Environment variable** (`EZPLAYER_WEB_PORT` / `EZPLAYER_KIOSK_PORT`)
3. **Stored preference** (saved from a prior launch)
4. **Built-in default** (`3000` / `3001`)

If the chosen port is already in use, EZPlayer tries up to **ten** consecutive
ports. Check **Show Status → HTTP Listener Status** on the desktop app for the
actual **Port**, **Source**, and **Listening** state.

Equivalent environment variables are documented in
[Environment Variables](./env-variables.md).

## Reset and first-run flags

Reset flags **clear persisted startup state and exit immediately** — they do not
start a show. Use them to recover from a bad folder choice or to re-run the
welcome flow.

| Flag              | What is cleared                              | Next launch welcome screen            |
| ----------------- | -------------------------------------------- | ------------------------------------- |
| `--reset`         | Show folder pointer, renderer `localStorage` | Cloud option shown (default)          |
| `--reset-cloud`   | Same as `--reset`                            | Cloud option shown                    |
| `--reset-nocloud` | Same as `--reset`                            | Local/xLights only (cloud CTA hidden) |

Example:

```bash
EZPlayer.exe --reset-nocloud
```

After running a reset flag, start EZPlayer normally. You will see the welcome
screen again and can pick a new show folder.

:::warning
Reset flags quit the app after clearing state. They do not delete your show
folder files — only EZPlayer's stored pointer to that folder.
:::

## Debugging and logging

These are standard **Chromium/Electron** switches useful when diagnosing
problems. They are not required for normal operation.

| Flag               | Description                                            |
| ------------------ | ------------------------------------------------------ |
| `--enable-logging` | Enable Chromium logging to stderr/log files            |
| `--v=1`            | Verbose log level (often used with `--enable-logging`) |

Example from the project's `package.json` scripts:

```bash
./release/win-unpacked/EZPlayer.exe --enable-logging --v=1
```

Log files are written under the platform log directory (on Windows, typically
under `%APPDATA%\EZPlayer\logs` via Electron's `app.getPath('logs')`).

To open DevTools in a **packaged** build, use the environment variable
`EZP_OPEN_DEVTOOLS` instead of a CLI flag — see
[Environment Variables](./env-variables.md).

## Platform notes

**Linux**

- EZPlayer appends `--no-sandbox` on Linux at startup (Ubuntu 24.04+ AppArmor and
  older distros without a setuid sandbox helper).
- Linux packages in `electron-builder` config also list `--no-sandbox` in
  `executableArgs` for AppImage/deb/tar.gz targets.

**macOS**

- Use quoted paths if the show folder contains spaces:
  `--show-folder="/Users/me/My Show"`.

**Windows**

- Paths with spaces work with `--show-folder=C:\My Shows\Display` or quoted forms
  in batch files.

## Examples

**Production show PC — fixed LAN port, known folder**

```bat
"C:\Program Files\EZPlayer\EZPlayer.exe" --show-folder=D:\Shows\2025 --web-port=3000
```

**Dedicated kiosk tablet browser target — disable main port change, custom kiosk**

```bash
./EZPlayer --kiosk-port=3001
```

Guests open `http://<show-pc-ip>:3001`.

**Development (from repository)**

```bash
pnpm dev
```

Prompts for a web port and sets `EZPLAYER_WEB_PORT` before starting Electron.
Additional flags can be passed through `pnpm dev:direct` / `electron .` when
needed.

**Factory reset before handing off a machine**

```bash
EZPlayer.exe --reset
```

## Internal flags (not for operators)

The main process may pass these to the renderer via Electron
`additionalArguments`. They are not part of the public operator CLI:

| Flag                                           | Purpose                                                            |
| ---------------------------------------------- | ------------------------------------------------------------------ |
| `--show-welcome=true` / `--show-welcome=false` | Controls whether the welcome screen appears on that process launch |

Use `--reset*` or remove an invalid show folder rather than passing
`--show-welcome` manually.
