---
sidebar_position: 8
title: Player Screen
---

# Player Screen

The **Player** screen is EZPlayer's home view — the first thing you see when you
open the app. It answers three questions at a glance:

1. **What is playing right now?**
2. **Are my controllers healthy?**
3. **What does today's schedule look like?**

Use it as your day-to-day command center during setup and show nights. For deeper
diagnostics (per-controller detail, statistics, server status), open
[Show Status](../advanced/show-status/details.md).

![Player screen](/img/player.png)

## Layout

The screen has three sections, top to bottom:

| Section               | What it shows                                                       |
| --------------------- | ------------------------------------------------------------------- |
| **Now Playing**       | Live playback status, volume, current song, next item, and controls |
| **Controller Status** | Summary of models, channels, and online/offline health              |
| **Today's timeline**  | Simulated run-through of **today's** scheduled events               |

## Now Playing card

The Now Playing card streams live status from the playback engine.

### Status indicator

A chip at the top shows the current player state:

| Status      | Meaning                                                      |
| ----------- | ------------------------------------------------------------ |
| **Playing** | Sequences are advancing; lights and audio are active         |
| **Paused**  | Playback is frozen (`pause`)                                 |
| **Stopped** | Nothing is playing — schedule was stopped or has not started |

**Last checkin** shows when the player last reported its state.

### Volume

A meter shows the current output level (0–100%).  You can
mute/unmute and adjust default and scheduled volumes via the gear icon — see
[Volume](../advanced/volume.md).

### Now Playing and Next Show

When a song or sequence is active:

- **Now Playing** — title of the current item and **Until** time (when it is
  expected to end).
- **Next Show** — the next scheduled or queued item and when it **Starts**.

If nothing is playing, the card shows _No track currently playing_.

### Controls

When status is **Playing** or **Paused**, the same playback controls as the
[jukebox](./jukebox.md) appear inline:

- **Play / Pause / Resume**
- **Skip** — end the current song abruptly and proceed to the next
- **End** — stop gracefully: after the current song, play any outro, and then stop
- **Abort** — hard stop: immediately stop

If there is a **queue** of jukebox or API requests, they appear below the
controls. Remove an item with **×**.

### Reload Schedule

When the player is **Stopped**, a **Reload Schedule** button appears instead of
the transport controls. Click it to reread the schedule from disk and re-engage
playback (`resetplayback`).  Pressing this is generally not needed unless you
have manually changed files on disk, or something has gone wrong.

## Controller Status card

The Controller Status card summarizes your lighting network:

- **Models** and **Channels** — totals from your show layout
- **Controllers** — count online vs offline
- **Health banner** — green when all controllers are online with no errors,
  red when errors or offline units are detected, grey when no controllers are
  assigned

This is a **summary** view. For details, see the **Show Status** screen.

## Today's timeline

The lower half of the Player screen is an interactive **timeline** of today's
schedule. EZPlayer shows your high-level [schedule](./simple-schedules.md) through the day
here.  For exact details, you can [simulate] your show and get exact timings from the [Schedule Preview](../advanced/complex-schedules/schedule-preview.md) screen.

### What you see

- **Main schedules** — colored by priority (high, normal, low)
- **Background schedules** — shown in a single distinct color

Hover or click timeline items for detail. Use the toolbar to:

- **Zoom in / zoom out** — focus on a time range
- **Fit to screen** — show the full day

### Important notes

- The timeline is a **summary of today's plan**, not a live log of what
  already played. Jukebox overrides and manual stops may cause differences
  differ from what was predicted at the start of the day.
- If you have no songs, playlists, or schedule entries for today, the screen
  shows _No schedule data available for today._
- For multi-day preview, priority conflicts, and loop/shuffle testing across a
  custom date range, use **Schedule Preview** on the Schedule screen — see
  [Schedule Preview](../advanced/complex-schedules/schedule-preview.md).

The timeline updates when your schedule, playlist, or song data changes.

## Desktop app vs LAN UI

The [LAN UI](./local-web-interface.md) can be used to check status from a phone or
other machine on your network. Kiosk mode keeps the Player screen available for a
public-facing display while hiding management screens and destructive controls.

| Capability           | Desktop app | LAN UI (normal) | LAN UI (kiosk)       |
| -------------------- | ----------- | --------------- | -------------------- |
| View Player screen   | Yes         | Yes             | Yes                  |
| Live mute toggle     | Yes         | Yes             | No (read-only meter) |
| Volume settings gear | Yes         | Yes             | No                   |
| End / Abort controls | Yes         | Yes             | Hidden               |
| Today's timeline     | Yes         | Yes             | Yes                  |

