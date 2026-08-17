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

With no verb, EZPlayer starts the windowed player as always. Flags control the
show folder, LAN web server ports, and first-run behavior.

## Verbs

The **first non-flag argument** decides what EZPlayer does:

| First argument                                                   | What happens                                                                                                                             |
| ---------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------- |
| _(none)_                                                         | Launch the desktop app (the normal GUI).                                                                                                 |
| A leading-dash flag (`--show-folder`, `--web-port`, …)           | Launch the desktop app, configured by that flag and any others.                                                                          |
| [`headless`](#headless-mode)                                     | Run the **full player with no windows** — it still plays the show and serves the web API.                                                |
| `discover`, `interfaces`, `controller`, `shell`, `files`, `help` | Run a **text-only command** and exit without opening a window or starting the show.                                                      |
| Any other bareword                                               | **Error**: EZPlayer prints `unknown command '…'` and the usage text, then exits with code **64**. It does _not_ fall through to the GUI. |

Note the distinction between the two window-less modes: `headless` is the
**player** running without a UI, while the text-only commands are
**diagnostic/management tools** that print and exit before the app ever
bootstraps.

:::note
The text-only commands are also available from the pure-Node CLI entry used in
development and CI (`node dist/cli.js <command>`), which has no GUI to launch.
:::

Everything from [Launch flags](#launch-flags) onward describes the flags that
configure the desktop app. The next section describes the **text-only commands**.

## Text-only commands

These commands print plain text and exit; they never open a window or start
the show. They are useful for setup, network diagnostics, and scripting.

| Command      | Purpose                                                                                        |
| ------------ | ---------------------------------------------------------------------------------------------- |
| `discover`   | Scan LAN networks for lighting controllers.                                                    |
| `interfaces` | List this host's networks (the CIDRs to feed `discover`).                                      |
| `controller` | Inspect and manage lighting controllers — see its four subcommands below.                      |
| `shell`      | Set the password that enables the [remote terminal](#remote-access-terminal-and-file-manager). |
| `files`      | Set the password that enables the [file manager](#remote-access-terminal-and-file-manager).    |
| `help`       | Print the command list. Also `--help`, `-h`.                                                   |

`discover`, `interfaces`, `controller status`, and `controller action` talk to
devices directly and need no running player. `controller list` and
`controller upload` query/drive a **running EZPlayer** over its LAN API
(`--host`, default `127.0.0.1:3000`, honoring `EZPLAYER_WEB_PORT`) — the
reconcile state and the xLights upload intent only exist inside the app.

Everything that acts on a lighting controller is a **subcommand of
`controller`**, which keeps the plain names free for what they sound like — the
player's own status, or uploading show content:

| Subcommand          | Purpose                                                      |
| ------------------- | ------------------------------------------------------------ |
| `controller list`   | Show the controller reconcile state from a running player.   |
| `controller status` | Deep-read one controller and print its detail report.        |
| `controller action` | Run a management action (e.g. reboot) on a controller.       |
| `controller upload` | Upload xLights-derived config to a controller (via the app). |

Get top-level help or per-command help:

```bash
EZPlayer help                 # list commands
EZPlayer discover --help      # options for one command
EZPlayer controller           # list the controller subcommands
```

### `discover`

Scan one or more networks for lighting controllers and print what is found.

```bash
EZPlayer discover [--networks <cidr[,cidr…]>] [--depth sweep|identify|full] [--fpp-proxy]
```

| Option              | Alias | Description                                                                                                                                 |
| ------------------- | ----- | ------------------------------------------------------------------------------------------------------------------------------------------- |
| `--networks <cidr>` | `-n`  | Comma-separated CIDRs to scan (e.g. `192.168.1.0/24,10.0.0.0/24`). Omit to scan every external host network (run `interfaces` to see them). |
| `--depth <level>`   | `-d`  | How hard to look — see the table below. Default: `identify`.                                                                                |
| `--fpp-proxy`       |       | Recurse one level through FPP proxies to find controllers behind them. Needs `identify` or `full`; ignored (with a warning) on `sweep`.     |

**Depth levels**

| Depth      | What you get                                                                          |
| ---------- | ------------------------------------------------------------------------------------- |
| `sweep`    | Liveness only — IP, MAC/OUI, mDNS hostname, and detected protocols.                   |
| `identify` | _(default)_ Everything in `sweep`, plus driver-confirmed vendor, model, and firmware. |
| `full`     | Everything in `identify`, plus a per-device detail tree.                              |

**Output** adapts to where it is going:

- **Interactive terminal** (`sweep`/`identify`): a live table redraws in place as
  devices resolve, ending with a summary line.
- **Piped or redirected** output: progress goes to `stderr`; the final table is
  printed once to `stdout`. This makes `EZPlayer discover … > devices.txt` clean.
- **`full`**: a detail tree is printed per device at the end; progress stays on
  `stderr`.

Every run ends with `N device(s), M identified.` Exit code is `0` on success, or
`2` for a usage error (an invalid `--depth`, an unrecognized argument, or no
scannable network found).

```bash
# Scan the whole LAN at default depth
EZPlayer discover

# Two specific subnets, confirm models, follow FPP proxies
EZPlayer discover -n 192.168.1.0/24,192.168.2.0/24 -d identify --fpp-proxy

# Full detail, captured to a file
EZPlayer discover --depth full > controllers.txt
```

:::note
Discovery scans the network actively (ARP/mDNS/driver probes). Only run it on
networks you are authorized to scan.
:::

### `interfaces`

List this host's external IPv4 networks as CIDRs, ready to pass to
`discover --networks`. Internal and link-local (`169.254.x.x`) addresses are
excluded.

```bash
EZPlayer interfaces
```

```text
  INTERFACE            ADDRESS          NETWORK
  Wi-Fi                192.168.1.154    192.168.1.0/24
  Ethernet             10.0.0.12        10.0.0.0/24
```

Exit code is `0`. If no external IPv4 interface exists, it prints
`(no external IPv4 interfaces)`.

### `controller list`

Print the running player's controller reconcile state: known controllers
(xLights ∪ EZPlayer records) versus what the network scan found, plus recent
operations and network policies.

```bash
EZPlayer controller list [--host <host[:port]>] [--json]
```

| Option                 | Description                                                                           |
| ---------------------- | ------------------------------------------------------------------------------------- |
| `--host <host[:port]>` | The running player's LAN API. Default `127.0.0.1:3000` (`EZPLAYER_WEB_PORT` honored). |
| `--json`               | Emit the raw state as JSON instead of tables.                                         |

```bash
EZPlayer controller list                    # local player
EZPlayer controller list --host pi5:3000    # a player elsewhere on the LAN
```

### `controller status`

Deep-read one controller and print its detail report (identity, health,
per-port config). Talks to the device **directly** — no running player needed.
A bare name (instead of an IP) is resolved through the running player's known
controllers.

```bash
EZPlayer controller status <ip-or-name> [--host <host[:port]>] [--json]
```

```bash
EZPlayer controller status 192.168.11.61
EZPlayer controller status "Mega Tree" --json
```

### `controller action`

Run a management action against one controller, or list the actions its driver
offers. Talks to the device directly.

```bash
EZPlayer controller action <ip-or-name> <actionId> [--host <host[:port]>]
EZPlayer controller action <ip-or-name> --list
```

Action ids are driver-specific — `--list` shows them (e.g. FPP offers
`restart` for a quick daemon restart and `reboot` for a full OS reboot; most
pixel controllers offer `reboot` only).

```bash
EZPlayer controller action 192.168.11.63 --list
EZPlayer controller action 192.168.11.63 reboot
```

### `controller upload`

Push the xLights-derived configuration (input universes and/or string outputs)
to one controller, by known-record name. Runs **through the running player**:
the upload intent comes from the show's xLights files, and the app performs a
post-upload read-back so every UI reflects the device's new state.

```bash
EZPlayer controller upload <name> [--scope inputs|strings|full] [--full-control] [--host <host[:port]>]
```

| Option           | Description                                                                                                                                      |
| ---------------- | ------------------------------------------------------------------------------------------------------------------------------------------------ |
| `--scope`        | `inputs` (universes), `strings` (port outputs), or `full` (both — the default).                                                                  |
| `--full-control` | Settings xLights doesn't specify are reset to the controller defaults (brightness/gamma/color order), wiping per-port tweaks made on the device. |

```bash
EZPlayer controller upload "Mega Tree" --scope strings
EZPlayer controller upload GarageF16 --full-control
```

:::warning
Uploads rewrite the controller's port configuration. There is no undo beyond
uploading again.
:::

### Remote access: terminal and file manager

EZPlayer optionally offers two features:

- **Shell** — a terminal on the player machine.
- **Files** — a file manager for the show folder: browse, upload, download,
  rename, move and delete.

Both are off by default. The only way to turn either on is to establish a
password via these commands, run on the player machine itself:

```bash
# Read the password from a file (recommended form)
EZPlayer files --show-folder "D:\Shows\MyShow" --password-file secret.txt

# Or inline (see the caution below)
EZPlayer files --show-folder "D:\Shows\MyShow" --password "correct horse battery"

# Or inline (see the caution below)
EZPlayer files --show-folder "D:\Shows\MyShow" --stdin    # Read from console

EZPlayer files --show-folder "D:\Shows\MyShow" --status   # is it enabled?
EZPlayer files --show-folder "D:\Shows\MyShow" --clear    # disable it entirely
```

:::caution
For Windows, use `ezplayer.cmd`, not `EZPlayer.exe`.
`EZPlayer.exe` is a **GUI-subsystem binary**, with limited ability to use the
console. `--stdin` does not work directly with `EZPlayer.exe`.

The Windows installer therefore places a small console launcher,
**`ezplayer.cmd`**, next to it. Use that for every text-only command.
:::

There are separate passwords for `files` and `shell`; each is independently on or off.

Until a password is set for a feature there is **no tile in Settings and no
endpoint on the network**. Once one is
set, the matching tile appears in that show's Settings screen; opening it asks
for that password. See [Shell](../settings/shell.md) and
[Files](../settings/files.md) for what each one does.

Password reset commands work whether or not a player is running; if one is running locally
it is nudged over loopback so the change takes effect without a restart.

:::warning
Enabling shell access on a machine provides siginificant power over both that machine,
and anything reachable over the attached networks. You should only enable this if the
diagnostic benefits of full remote access outweigh the potential for damage or loss of
sensitive information.

Enabling remote file access also has the potential to allow remote reading or update of
sensitive files.

Ensure that your passwords are appropriately secure.
:::

There is deliberately no way to set either password from any UI. Enabling remote
access requires the ability to run commands on the player already, which keeps
the decision with whoever owns the machine.

| Option            | Meaning                                                                                                                                                         |
| ----------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `--show-folder`   | Which show to set the password for. Defaults to the current directory when that is already a show folder (it has a `.ezplayer/` directory); otherwise required. |
| `--password-file` | Read the password from the first line of a file (recommended option).                                                                                           |
| `--password`      | The new password, given inline. Convenient, but see the caution below.                                                                                          |
| `--stdin`         | Read the password from stdin. (Requires `ezplayer.cmd` on Windows.)                                                                                             |
| `--clear`         | Remove the password. Anything open at the time is closed immediately.                                                                                           |
| `--status`        | Report whether the feature is enabled for this show, and the file in use.                                                                                       |
| `--port`          | Loopback port of the running player. (Defaults to checking the lockfile)                                                                                        |

:::caution
`--password` puts the password in your shell history, and on most systems it is
visible to other users in the process list for as long as the command runs.
Prefer `--password-file` on a machine you share — the value never reaches
either.
:::

Passwords are stored **salted and hashed** (scrypt) in
`<show folder>/.ezplayer/remote-access.json`, alongside the other per-show
settings. That makes remote access a property of the **show**, not the machine:
move the show folder to another player and the settings travel with it, and two
shows on one machine can differ. Switching a running player to a different show
folder closes any terminal or file-manager session that was open, since it
belonged to the previous show.

Things worth knowing before you enable either:

- **Only one terminal at a time, player-wide.** Opening a second closes the
  first, and it is told why rather than just going quiet. Closing the window
  kills the shell. The file manager has no such limit.
- **The file manager cannot leave the show folder**, and cannot see the
  player's own `.ezplayer/` settings directory at all — that is where these
  password hashes and your cloud credentials live. `xlights_rgbeffects.xml` and
  `xlights_networks.xml` are visible but cannot be renamed, moved or deleted.
- **Cloud security:** All cloud transport, if enabled, is encrypted. A fully
  remote user/attacker needs the cloud URL, the player token, and the relevant
  password.
- **LAN security:** The LAN UI is plain HTTP, so someone sniffing
  your local network while you log in could capture a password. That matches
  the rest of the LAN surface, which has no authentication at all — but it is
  worth knowing if your LAN is not trusted.
- **Repeated wrong guesses lock the endpoint out** for escalating periods, per
  feature, so the password rather than the network is what an attacker has to
  beat.

### Exit codes

| Code | Meaning                                                           |
| ---- | ----------------------------------------------------------------- |
| `0`  | Success, or a help request.                                       |
| `2`  | Usage error within a command — bad option or invalid argument.    |
| `64` | Unknown verb (rejected by the launcher before the app starts).    |
| `1`  | Unexpected failure (an uncaught error while running the command). |

## Launch flags

The remaining sections describe **launch-flag mode** — the flags that configure
the desktop app when it opens. These are leading-dash arguments, so they never
collide with the verbs above.

CLI arguments take **priority over** [environment variables](./env-variables.md)
when both configure the same setting (for example `--web-port=` beats
`EZPLAYER_WEB_PORT`).

On Windows, append flags after the executable path. On Linux AppImage/deb
packages, `executableArgs` may include `--no-sandbox` automatically — see
[Platform notes](#platform-notes).

### Quick reference

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

| Exit code | Meaning                                                     |
| --------- | ----------------------------------------------------------- |
| `2`       | No show folder configured, or the folder is missing/invalid |
| `3`       | The show folder is locked by another EZPlayer instance      |
| `64`      | Unrecognized verb                                           |

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

On headless Linux boxes (no X server), pass `--ozone-platform=headless` on the
command line (it must come before EZPlayer's own arguments):

```bash
./EZPlayer --ozone-platform=headless headless --show-folder=/home/user/show
```

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
