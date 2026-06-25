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

The Player screen is the **default route** when EZPlayer starts — select
**Player** in the sidebar anytime to return here.

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

A meter shows the current output level (0–100%). On the **desktop app**, you can
mute/unmute and adjust default and scheduled volumes via the gear icon — see
[Volume](../advanced/volume.md). In **kiosk mode**, these controls are read-only.

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
- **Skip** — end the current song (`endsong`)
- **End** — graceful stop (`stopgraceful`)
- **Abort** — hard stop (`stopnow`)

If a **queue** has pending jukebox or API requests, they appear below the
controls. Remove an item with **×** (`deleterequest`).

In **kiosk mode**, **End** and **Abort** are hidden.

### Reload Schedule

When the player is **Stopped**, a **Reload Schedule** button appears instead of
the transport controls. Click it to reread the schedule from disk and re-engage
playback (`resetplayback`). Use this after editing schedules or when the show
should start following the calendar again.

## Controller Status card

The Controller Status card summarizes your lighting network:

- **Models** and **Channels** — totals from your show layout
- **Controllers** — count online vs offline
- **Health banner** — green when all controllers are online with no errors,
  red when errors or offline units are detected, grey when no controllers are
  assigned

This is a **summary** view. Expand any controller, see ping history, open the
statistics dialog, and check LAN server status on the dedicated
**Show Status** screen.

## Today's timeline

The lower half of the Player screen is an interactive **timeline** of today's
schedule. EZPlayer simulates your [songs](./songs.md), [playlists](./playlists.md),
and [schedule entries](./simple-schedules.md) from midnight through end of day
using the same playback engine logic as the full schedule preview.

### What you see

- **Main schedules** — colored by priority (high, normal, low)
- **Background schedules** — shown in a single distinct color
- Individual **sequence blocks** within each scheduled window
- Schedule lifecycle events (started, ended, suspended, resumed, and others)

Hover or click timeline items for detail. Use the toolbar to:

- **Zoom in / zoom out** — focus on a time range
- **Fit to screen** — show the full day
- **Refresh** — regenerate the timeline from current schedule data

### Important notes

- The timeline is a **simulation of today's plan**, not a live log of what
  already played. Jukebox overrides and manual stops during the night may
  differ from what was predicted at the start of the day.
- If you have no songs, playlists, or schedule entries for today, the screen
  shows _No schedule data available for today._
- For multi-day preview, priority conflicts, and loop/shuffle testing across a
  custom date range, use **Schedule Preview** on the Schedule screen — see
  [Simulating Your Schedule](../advanced/complex-schedules/simulating-your-schedule.md).

The timeline updates when your schedule, playlist, or song data changes in the
Redux store (for example after you save a schedule entry). |

## Desktop app vs LAN UI

| Capability           | Desktop app | LAN UI (normal) | LAN UI (kiosk)       |
| -------------------- | ----------- | --------------- | -------------------- |
| View Player screen   | Yes         | Yes             | Yes                  |
| Live mute toggle     | Yes         | Yes             | No (read-only meter) |
| Volume settings gear | Yes         | Yes             | No                   |
| End / Abort controls | Yes         | Yes             | Hidden               |
| Today's timeline     | Yes         | Yes             | Yes                  |

The LAN UI is ideal for checking status from a phone on the same network
without remote desktop. Kiosk mode keeps the Player screen available for a
public-facing display while hiding management screens and destructive controls.
