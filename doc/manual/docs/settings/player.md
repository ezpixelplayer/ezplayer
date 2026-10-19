---
sidebar_position: 4
title: Player
---

# Player Settings

The **Player** tile holds playback-engine behaviors.

## Start EZPlayer at sign-in

_(Desktop app — Windows and Mac)_

When enabled, the OS launches EZPlayer automatically after you sign in to
your user account.  Turn it off to remove EZPlayer from automatic startup.

This starts the app at sign-in, not at power-on.  For a machine that should
run EZPlayer completely unattended, you also need the OS to
sign in automatically.

To confirm the app is registered for startup on Windows, go to
**Settings → Apps → Startup**.  On Mac, check **System Settings → General → Login Items**.

This setting is not available on Linux.  The recommendation there is systemd
services.

## Background Sequence

Whether a background schedule blends **over** or **under** the main sequence.
See [Background Schedule](../advanced/complex-schedules/background-schedule.md).

## Blackout when idle

On by default: EZPlayer sends black frames whenever nothing is playing, so
lights go dark between shows and after a stop.

Turn it **off** when another player drives the same controllers — EZPlayer then
leaves the network untouched outside active playback. Note that with blackout
off, lights hold their last frame when playback stops.

## Controllers

The player can read each controller's configuration on its own — ports,
firmware, and anything that has drifted from xLights. A read takes up to tens of
seconds and pauses that controller's data, so reads normally wait for an idle
player. **Read controller details automatically** sets when this happens:

| Option                                         | What it does                                                                                                      |
| ---------------------------------------------- | ----------------------------------------------------------------------------------------------------------------- |
| **When nothing is playing (recommended)**      | Reads only while the player is idle.                                                                              |
| **Also when a controller comes back mid-show** | Also reads a controller that just came back up; it joins the show once the read finishes.                         |
| **Never**                                      | No automatic reads.                                                                                               |

## Diagnostics

- **Send anonymous crash reports** — sends anonymous crash and error reports to
  help improve EZPlayer. No show data, files, or personal information is
  included.
- **Include my Player ID with reports** — lets support connect reports to your
  player when you ask for help. Off by default, and available only when crash
  reports are on.

### Support bundle

A zip of information about the player computer, to send when asking for help.
Passwords and tokens are removed. It is offered when you open settings on the
player computer itself, not through the cloud. Choose what to **Include**, then
click **Download**:

| Option                                | What it includes                                                                                                                          |
| ------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------- |
| **Logs**                              | Recent logs, crash information, versions, system details, and settings changed from their defaults.                                        |
| **Logs and player setup**             | Adds network addresses, the xLights controller setup, and your songs, playlists, and schedule. No audio or sequence files.                 |
| **Logs, player setup, and layout**    | Adds the xLights layout file as well.                                                                                                      |

The download is an ordinary zip file. Open it and look through it before you
send it, and remove anything you would rather not share.

## Sync Output

Enable **FPP MultiSync master** to have FPP or xSchedule remotes follow this
player's sequence playback. List remotes as comma-separated `host[:port]`, or
leave the list empty to send to the FPP multicast group so every listening
remote follows. Off by default — only one sync master should exist on a
network. Details and limits: [FPP compatibility](../reference/fpp-compat.md#multisync-master).

The **Remotes**, **MultiSync port** and **MultiSync multicast address** fields
are available only while the master is enabled:

- **MultiSync port** — default 32320.
- **MultiSync multicast address** — default 239.70.80.80.

## Test Sequences

Sequences carrying any of these tags (default `test`) are offered in the
[Show Status](../advanced/show-status/details.md) test area, so a test sequence
can be played even when it is hidden from the jukebox. Clear the list to hide
the test area.

## Advanced

Overrides for testing and unusual networks; leave blank for standard behavior.

- **DDP output port** — default 4048. Takes effect when the show folder
  reloads or the player restarts.
