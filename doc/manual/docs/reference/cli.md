---
sidebar_position: 2
title: Command Line Interface (CLI)
---

# Command Line Interface (CLI)

:::note
The CLI is subject to redesign, and is expected to stabilize in v1.0.
:::

The **desktop EZPlayer** application (Windows, macOS, Linux) accepts an optional
**verb** followed by command-line flags when launched from a terminal, shortcut,
or service script:

```text
EZPlayer.exe [<verb>] [--flags...]
```

With no verb, EZPlayer starts the windowed player as always. Verbs select an
alternate mode — currently the only verb is [`headless`](#headless-mode). Flags
control the show folder, LAN web server ports, and first-run behavior.

CLI arguments take **priority over** [environment variables](./env-variables.md)
when both configure the same setting (for example `--web-port=` beats
`EZPLAYER_WEB_PORT`).

On Windows, append flags after the executable path. On Linux AppImage/deb
packages, `executableArgs` may include `--no-sandbox` automatically — see
[Platform notes](#platform-notes).

## Quick reference

| Verb / Flag            | Purpose                                                         |
| ---------------------- | --------------------------------------------------------------- |
| `headless`             | Run the full player with no windows ([details](#headless-mode)) |
| `--show-folder=<path>` | Open the given show folder on launch                            |
| `--web-port=<n>`       | LAN HTTP server port (default `3000`)                           |
| `--kiosk-port=<n>`     | Kiosk web server port (default `3001`)                          |
| `--kiosk-port=0`       | Disable the kiosk server                                        |
| `--user-data-dir=<p>`  | Isolate all persisted app state to the given directory          |
| `--reset`              | Clear persisted state, then quit (cloud welcome on next launch) |
| `--reset-nocloud`      | Clear persisted state, pin local-only welcome, then quit        |
| `--no-update-check`    | Skip the startup check for a newer EZPlayer release             |

## Show folder

Point EZPlayer at a specific [show folder](../settings/show-folder.md) without
using the folder picker:

```bash
EZPlayer.exe --show-folder=C:\Shows\MyDisplay
```

```bash
./EZPlayer --show-folder=/home/user/shows/my-display
```

The preferred form is `--show-folder=<path>`. A camelCase alias (`--showFolder=`)
and a space-separated form (`--show-folder <path>`) are also accepted.

The path must **exist** as a directory. If it is valid, EZPlayer saves it as
the persisted show folder and loads sequences, playlists, schedule, and layout
from there.

If the folder is missing required files (for xLights-managed shows:
`xlights_rgbeffects.xml` and `xlights_networks.xml`), EZPlayer warns you and
offers to pick another folder.

Only **one EZPlayer instance** can lock a given show folder at a time. A second
instance using the same folder is prompted to choose a different path or quit.

## Headless mode

The `headless` verb runs the **full player with no windows**: scheduled and
API-driven playback, light output, the LAN web/API server, kiosk server, and
cloud connectivity all behave exactly as in the windowed app. Audio is still
decoded and streamed to the web UI and cloud listeners; it is simply not played
out on the machine's local speakers (no hidden audio window is created).

```bash
EZPlayer.exe headless --show-folder=D:\Shows\2025 --web-port=3000
```

Anything that would normally raise a dialog fails fast instead:

| Exit code | Meaning                                                             |
| --------- | ------------------------------------------------------------------- |
| `2`       | No show folder configured, or the folder is missing/invalid         |
| `3`       | The show folder is locked by another EZPlayer instance              |
| `64`      | Unrecognized verb                                                   |

A headless run **never modifies persisted preferences** — the show folder and
ports passed on the command line apply to that run only, so it can coexist with
an interactive install on the same machine. To fully isolate state (e.g. for
automated testing, or a second independent player), add `--user-data-dir=`:

```bash
EZPlayer.exe headless --show-folder=C:\Shows\Test --web-port=8090 ^
    --kiosk-port=0 --user-data-dir=C:\Temp\ezp-test-profile
```

Stop a headless player with `Ctrl-C` (SIGINT) or SIGTERM; it stops playback,
releases the show-folder lock, and exits cleanly. `EZPLAYER_HEADLESS=1` in the
environment is equivalent to the verb for service scripts that cannot alter
arguments.

On headless Linux boxes (no X server), run under `xvfb-run -a` or pass
`--disable-gpu`; Electron still needs a display stack to boot even though no
window is shown.

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
| `--reset-nocloud` | Same as `--reset`                            | Local/xLights only (cloud CTA hidden) |

`--reset-cloud` is an alias of `--reset`.

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

## Updates

EZPlayer checks for a newer release a few seconds after launch. To suppress that
check on locked-down or offline show machines:

| Flag                | Description                              |
| ------------------- | ---------------------------------------- |
| `--no-update-check` | Skip the automatic startup update check. |

## Certificates and TLS

EZPlayer talks to the EZRGB cloud over HTTPS from the Node side. It
**automatically trusts the operating-system certificate store**, so an
OS-trusted corporate proxy or self-signed root that works in your browser works
here too. To add a CA that isn't in the OS store, set the standard Node.js
variable **`NODE_EXTRA_CA_CERTS`** (path to a PEM file). As a last-resort
debugging step only, `NODE_TLS_REJECT_UNAUTHORIZED=0` disables verification
entirely (insecure). See
[Environment Variables → Certificates and TLS](./env-variables.md#certificates-and-tls).

## Sandbox, GPU, and proxy

These are **standard Electron/Chromium switches** (not EZPlayer-specific) that
pass through to the underlying runtime. They are occasionally useful for
troubleshooting startup, rendering, or networking:

| Flag                       | When to use                                                                                                                                       |
| -------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------- |
| `--no-sandbox`             | Applied automatically on Linux (see [Platform notes](#platform-notes)). Rarely needed elsewhere; can work around sandbox-related launch failures. |
| `--disable-gpu`            | Force software rendering to work around GPU/driver glitches (blank window, flicker, artifacts).                                                   |
| `--proxy-server=host:port` | Route EZPlayer's traffic through an explicit HTTP/HTTPS proxy. Pair with a trusted CA (above) if the proxy intercepts TLS.                        |

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
