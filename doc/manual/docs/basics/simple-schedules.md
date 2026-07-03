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

Click a day on the calendar (or an existing block) to open the editor. Pick the
**main playlist**, set **from** and **to** times, and optionally attach:

- **Intro playlist** — plays once at the start of the window.
- **Outro playlist** — plays once as the window winds down.

Use the **Main** / **Background** toggle at the top to switch which kind of
schedule you are editing (see
[Background Schedule](../advanced/complex-schedules/background-schedule.md)).

![FG-BG Toggle BUtton](/img/fg-bg-toggle.png)

**Recurrence** lets one entry repeat:

![Recurring schedule](/img/schedule-recurring-1.png)

- **Once** — a single date.
- **Daily** — every day until an end date.
- **Selected days** — specific weekdays (for example, Fri–Sun only).

![Recurring options](/img/schedule-recurring-2.png)
![Recurring end date](/img/schedule-recurring-3.png)

## Going further

For background layers, runtime behavior (end policies, priority, loop, shuffle),
and previewing a schedule before you go live, see
[Complex Schedules](../advanced/complex-schedules/overview.md).
