---
sidebar_position: 3
title: Viewer Control
---

# Viewer Control

Let viewers request songs during configured hours — either through
[**Remote Falcon**](https://remotefalcon.com) or EZPlayer's built-in viewer control.

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

## Songs Between Repeats

Remote Falcon and the EZPlayer viewer page each keep their own "don't repeat"
rules, but neither sees the other's picks or the songs your playlist plays on
its own. Set **Songs between repeats** to have the player itself drop a viewer
pick when that song is playing, up next, already requested, or started within
that many songs. Dropped picks show in **Viewer Activity** as skipped picks.
`0` turns the check off.

It works the other way too: when a song has just played (usually a viewer pick), a
scheduled playlist passes over that song if it comes up again too soon. For a
playlist the spacing is held to 40% of its distinct songs, so a short playlist
is never starved — a 5-song playlist waits at most 2 songs. Repeats your
schedule makes on its own (a song listed twice, or back-to-back shows that share
a song) still play, and requests themselves are never skipped this way.

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

### Separate Remote Falcon Schedule

When the viewer page and Remote Falcon are both on, they share one schedule by
default. Turn on **Separate Remote Falcon schedule and playlists** to give
Remote Falcon its own windows and playlists, shown as a second list, **Remote
Falcon Schedule**, under the **Viewer Page Schedule**. Use it when Remote
Falcon should offer a shorter song list than the viewer page (Remote Falcon
limits how many songs a show can list), or take requests at different hours.

The Remote Falcon schedule starts as a copy of the shared schedule; after that,
edit either list on its own. Viewer-page requests still play before Remote
Falcon suggestions whenever both windows are open.
