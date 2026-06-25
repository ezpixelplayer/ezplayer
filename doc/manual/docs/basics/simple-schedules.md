---
sidebar_position: 6
title: Simple Schedules
---

# Simple Schedules

Scheduling ties three layers together:

1. **Sequences** — individual songs or effects (the `.fseq` files you added in
   [Getting Started](./getting-started-local.md#2-add-a-song)).
2. **Playlists** — ordered lists of sequences (for example, "Christmas Songs").
   Build these on the **Playlists** screen before you schedule them.
3. **Scheduled playlists** — a playlist (plus optional intro and outro playlists)
   assigned to a **date and time window**.

When a window opens, the player walks through the intro playlist (if any), the
main playlist, and the outro playlist (if any), then stops — unless you have
enabled **loop** or **shuffle** on the main section.

## Creating and editing entries

![Schedule editing](/img/schedule-editing.png)

Click a day on the calendar (or an existing block) to open the editor. Pick the
**main playlist**, set **from** and **to** times, and optionally attach:

- **Intro playlist** — plays once at the start of the window.
- **Outro playlist** — plays once as the window winds down.

Use the **Main** / **Background** toggle at the top to switch which kind of
schedule you are editing (see
[Background Schedule](../advanced/complex-schedules/background-schedule.md)).

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
