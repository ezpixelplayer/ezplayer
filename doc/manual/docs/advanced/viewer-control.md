---
sidebar_position: 3
title: Viewer Control
---

# Viewer Control

Let viewers request songs during configured hours — either through
[**Remote Falcon**](https://remotefalcon.com) or EZPlayer's built-in viewer control.

## Where Viewers Can Pick Songs

Two switches control where viewers can pick songs from:

| Switch                              | What it does                                                           |
| ----------------------------------- | ---------------------------------------------------------------------- |
| **EZPlayer viewer page (built-in)** | Use EZPlayer's own viewer-control integration.                         |
| **Remote Falcon**                   | Poll Remote Falcon for viewer requests. Requires a Remote Falcon token. |

Both can be on at once; requests from the EZPlayer viewer page are played
before Remote Falcon suggestions. With both off, there are no viewer requests.

When **Remote Falcon** is on, paste your **Remote Falcon Token** into the field
below the switches. Use the eye icon to show or hide the token.

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

When either switch is on, define one or more **schedule entries** that control
when viewers can request songs. The schedule is shared by both:

- **Days** — all days, weekends, weekdays, or a single day of the week.
- **Start / end time** — 24-hour format (`14:30`). End times can use extended
  hours (`25:00` = 1:00 AM the next day) for windows that cross midnight.
- **Playlist** — which playlist viewers can pick from during this window.

Add entries with **Add Schedule Entry**. Each entry in **Current Schedule** has
buttons to edit it, move it to a lower or higher priority (up/down arrows), and
delete it (trash icon, with a confirmation).

If windows overlap, the **last entry in the list takes priority** (shown as
`Priority: <number>`, where a higher number wins).
