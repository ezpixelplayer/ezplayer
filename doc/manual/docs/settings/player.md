---
sidebar_position: 4
title: Player
---

# Player Settings

The **Player** tile holds playback-engine behaviors.

## Start EZPlayer when I sign in

_(Desktop app only — Windows)_

When enabled, Windows launches EZPlayer automatically **after you sign in** to
your Windows user account. Turn it off to remove EZPlayer from automatic startup.

This follows Windows **user sign-in**, not the moment the PC finishes powering
on. If nobody is signed in yet (for example at the lock/login screen), EZPlayer
does not start. Locking the screen and unlocking does **not** re-trigger
startup; only a new sign-in (or a reboot that ends with you signing in) does.

The checkbox reads and writes the OS login-item setting directly — there is no
separate EZPlayer preference that can drift out of sync. You can confirm the
same toggle in **Windows Settings → Apps → Startup** (or Task Manager → Startup
apps).

Notes:

- Available only in the **installed** EZPlayer desktop app. It does not appear
  in the LAN browser UI, and it is not offered while running from development
  mode (`pnpm dev`).
- Enabling it does not change how EZPlayer behaves once it is already running —
  schedules, playback, and other settings work the same whether or not
  auto-start is on.
- This is **not** Windows Auto Login (signing into Windows without a password).
  EZPlayer only starts after an existing user session has begun.

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
