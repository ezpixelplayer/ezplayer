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
  - **To** supports *extended* times so a window can cross midnight — for example `25:00` is 1:00 AM the next day, `48:00` is midnight two days later (up to 168 hours).
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

## Calendar views

Use the view toggle above the calendar to switch between:

- **Month** — full-month grid. Days from the previous or next month may appear
  at the edges of the grid (shown with a muted background).
- **Week** — seven-day timeline with hourly slots.
- **Day** — a single-day hourly timeline.

Month and Week views support drag-and-drop (see below). Day view does not.

## Moving schedules by drag-and-drop

In **Month** or **Week** view, you can drag a schedule block to another day.
After you drop it, a dialog asks what you want to do — nothing is changed until
you pick an action.

### One-time schedules (Occurs Once)

When you drag a schedule that does **not** repeat, the dialog offers:

| Action | What it does |
| ------ | ------------ |
| **Move** | Move this entry to the dropped date. The time window and all other settings stay the same. |
| **Copy** | Leave the original entry in place and create a copy on the dropped date. |
| **Repeat** | Turn this entry into a **daily** repeating series from one date through the other. If you drag to an **earlier** date, that date becomes the series start and the original date becomes the end. If you drag to a **later** date, the original date is the start and the dropped date is the end. All other schedule settings are preserved. |
| **Cancel** | Close the dialog and leave the schedule unchanged. |

### Repeating schedules (Occurs Daily or Occurs for Selected Days)

Repeating entries behave differently depending on **which occurrence** you drag:

| Occurrence | Can drag? | Available actions |
| ---------- | --------- | ----------------- |
| **First** date in the series | Yes | **Change Start Date** — move the series start to the dropped date (the end date stays the same), or **Cancel**. |
| **Last** date in the series | Yes | **Change End Date** — move the series end to the dropped date (the start date stays the same), or **Cancel**. |
| **Middle** dates | No | These occurrences cannot be dragged. The series is left unchanged. |

Only the boundary you change is updated — other occurrences and settings in the
series are not modified.

### Dropping on adjacent-month dates

In **Month** view, the grid may show a few days from the previous or next month
(muted cells at the start or end of the grid). You can drag schedules onto those
visible dates without switching months first. The schedule is placed on the
**actual calendar date** shown in that cell.

### Schedule conflicts

If the dropped date already has a schedule that overlaps in time, the destination
day is highlighted with an **ERR** marker and you must confirm before the change
is applied. You can cancel to keep everything as it was.

## Going further

For background layers, runtime behavior (end policies, priority, loop, shuffle),
and previewing a schedule before you go live, see
[Complex Schedules](../advanced/complex-schedules/overview.md).
