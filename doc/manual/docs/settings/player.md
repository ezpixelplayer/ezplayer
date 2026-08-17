---
sidebar_position: 4
title: Player
---

# Player Settings

The **Player** tile holds playback-engine behaviors.

## Start EZPlayer when I sign in

_(Desktop app — Windows and Mac)_

When enabled, the OS launches EZPlayer automatically after you sign in to
your user account. Turn it off to remove EZPlayer from automatic startup.

This starts the app at sign-in, not at power-on. For a machine that should
run EZPlayer completely unattended, you also need the OS to
sign in automatically.

To confirm the app is registered for startup on Windows, go to
**Settings → Apps → Startup**. On Mac, check **System Settings → General → Login Items**.

This setting is not available on Linux. The recommendation there is systemd
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

## Sync Output

Enable **FPP MultiSync master** to have FPP or xSchedule remotes follow this
player's sequence playback. List remotes as comma-separated `host[:port]`, or
leave the list empty to send to the FPP multicast group so every listening
remote follows. Off by default — only one sync master should exist on a
network. Details and limits: [FPP compatibility](../reference/fpp-compat.md#multisync-master).

## Test Sequences

Sequences carrying any of these tags (default `test`) are offered in the
[Show Status](../advanced/show-status/details.md) test area, so a test sequence
can be played even when it is hidden from the jukebox. Clear the list to hide
the test area.

## Advanced

Overrides for testing and unusual networks; leave blank for standard behavior.

- **MultiSync port** — default 32320.
- **MultiSync multicast address** — default 239.70.80.80.
- **DDP output port** — default 4048. Takes effect when the show folder
  reloads or the player restarts.
