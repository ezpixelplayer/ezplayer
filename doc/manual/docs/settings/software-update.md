---
sidebar_position: 7
title: Software Update
---

# Software Update

_(Desktop app only — not shown in the LAN UI)_

The **Software Update** tile manages EZPlayer releases on this machine. These
settings are stored on the player PC, not in the show folder.

The pane shows the installed version. Updates come from official EZPlayer
releases. EZPlayer never quits or restarts by itself to apply an update.

## Update Mode

- **Check automatically and remind me** _(default)_ — about ten seconds after
  launch, EZPlayer looks for a newer release. If one is available, a toast
  says to open this pane. If the PC then sits idle for at least five minutes
  with no show schedule running, EZPlayer may download the update in the
  background. A finished download is queued to install the next time you quit.
- **Manual — only check when I ask** — no startup check, idle download, or
  toast. Use **Check for Updates** on this pane.

Changing the mode takes effect without restarting. Manual mode stops idle
downloads immediately.

## Check for Updates

**Check for Updates** asks whether a newer version exists. While a check or
download is running, the button is disabled. The pane then shows:

- **No update check has run yet.**
- **Checking for updates…**
- **You're up to date.**
- **Version _x.y.z_ is available.** — **Download _x.y.z_** fetches it. Progress
  (percent and speed) appears on this pane.
- **Version _x.y.z_ is downloaded and ready to install.**
- An error if the check or download failed (offline, blocked network, and so
  on).

Automatic checks and downloads run only in the **installed** desktop app, not
in [headless](../reference/cli.md#headless-mode) mode.

## Skip This Version

When a version is available, **Skip This Version** keeps the current install.
That release no longer shows a toast and is not downloaded while idle. **Download**
still works if you change your mind.

Skipped versions are listed at the bottom of the pane. **Clear** restores
toasts and idle download for all of them.

## Install & Restart / Install on Quit

These buttons appear after a version has been downloaded:

- **Install & Restart** quits EZPlayer, applies the update, and relaunches.
- **Install on Quit** leaves the show running. The pane then says the update
  will install when you quit.

A completed download is already queued for install-on-quit, including one
fetched in the background. Use **Install & Restart** only when you want it
applied immediately.

If a show schedule is active, **Install & Restart** opens **Schedule Is
Running**. Restarting stops playback until EZPlayer comes back. Choose
**Install on Quit** to wait, or **Restart Anyway** to apply it now.

## Locked-down or offline machines

Launch with `--no-update-check` to skip the startup check and idle download
without opening this pane. **Check for Updates** here still works. See
[CLI → Updates](../reference/cli.md#updates).
