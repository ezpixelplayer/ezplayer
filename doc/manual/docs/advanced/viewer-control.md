---
sidebar_position: 3
title: Viewer Control
---

# Viewer Control

Let viewers request songs during configured hours — either through
**Remote Falcon** or EZPlayer's built-in viewer control.

## Viewer Control Type

| Option                  | What it does                                                            |
| ----------------------- | ----------------------------------------------------------------------- |
| **Disabled**            | No viewer requests.                                                     |
| **Remote Falcon**       | Poll Remote Falcon for viewer requests. Requires a Remote Falcon token. |
| **EZPlayer (built-in)** | Use EZPlayer's own viewer-control integration.                          |

When Remote Falcon is selected, paste your **Remote Falcon Token** into the
field below the type dropdown.

![Remote Falcon show page](/img/remote-falcon-1.png)

During active viewer-control hours, the player keeps your Remote Falcon show
page updated with what's playing and checks for viewer requests as it chooses
the next song.

## Schedule Configuration

When viewer control is enabled (Remote Falcon or EZPlayer), define one or more
**schedule entries** that control when viewers can request songs:

- **Days** — all days, weekends, weekdays, or a single day of the week.
- **Start / end time** — 24-hour format (`14:30`). End times can use extended
  hours (`25:00` = 1:00 AM the next day) for windows that cross midnight.
- **Playlist** — which playlist viewers can pick from during this window.

Add entries with **Add Schedule Entry**. Delete an entry with the trash icon.

If windows overlap, the **last entry in the list takes priority** (shown as
higher priority in the list).
