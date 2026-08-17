---
sidebar_position: 6
title: Simple Schedules
---

# Simple Schedules

Scheduling automates the show: [**Playlists**](./playlists.md) of [**Songs/Sequences**](./songs.md) are set to play at
specified date and time windows.

When a schedule runs, the player plays through:

1.  The intro playlist (if any)
2.  The main playlist (optionally applying loop or shuffle to fill the full time slot), and
3.  The outro playlist (if any)

The schedule then stops.

## Creating and editing entries

![Schedule editing](/img/schedule-editing.png)

Click a day on the calendar (or an existing block) to open the editor. Fill in:

- **Select Playlist** — the main playlist for this window. Duration is shown next to each playlist.
- **Title** — label shown on the calendar. Defaults to the playlist name when you pick a playlist; you can rename it.
- **From** / **To** — the time window in 24-hour `HH:MM` format.
    - **From** must be within the same day (00:00–23:59).
    - **To** supports _extended_ times so a window can cross midnight — for example `25:00` is 1:00 AM the next day, `48:00` is midnight two days later (up to 168 hours).
- Optionally attach:
    - **Intro playlist** — plays once at the start of the window.
    - **Outro playlist** — plays once as the window winds down.

If the window is longer than the main playlist, **Loop** may turn on automatically so the slot stays filled. You can switch to **Shuffle** instead, or turn both off (the player will warn if the playlist is too short to fill the window).

**Repeat** lets one entry recur:

![Recurring schedule](/img/schedule-recurring-1.png)

- **Occurs Once** — a single date.
- **Occurs Daily** — every day until an end date.
- **Occurs for Selected Days** — specific weekdays (for example, Fri–Sun only).

![Recurring options](/img/schedule-recurring-2.png)
![Recurring end date](/img/schedule-recurring-3.png)

When you edit or delete a recurring entry, choose **This Event** (only that occurrence) or **All Events** (the whole series).

Use the **FG / BG** (Main / Background) toggle at the top to switch which kind of
schedule you are editing (see
[Background Schedule](../advanced/complex-schedules/background-schedule.md)).

![FG-BG Toggle Button](/img/fg-bg-toggle.png)

## Going further

For background layers, runtime behavior (end policies, priority, loop, shuffle),
and previewing a schedule before you go live, see
[Complex Schedules](../advanced/complex-schedules/overview.md).
