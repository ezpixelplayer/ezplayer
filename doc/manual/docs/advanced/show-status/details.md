---
sidebar_position: 1
title: Details
---

# Show Status — Details

The **Show Status** screen is your diagnostics view. Where the
[Player screen](../../basics/player-screen.md) gives an at-a-glance summary, this
screen lays out the full detail in a set of cards. It's the place to look when
something isn't behaving as expected.

![Show status](/img/status-1.png)

## Player Status

What the playback engine is doing right now:

- **Status** — Playing or Not Playing.
- **Last Checkin** — when the player last reported in.
- **Now Playing** and **Until** — the current song and when it's expected to end.
- **Upcoming Songs / Upcoming Shows** — what's queued to play next.

If there are interactive requests or schedules that were paused by a
higher-priority show, they appear here too (as **queue**, **suspended**, or
**preempted** items).

The **Stats** button opens detailed playback statistics — see
[Statistics](./statistics.md).

## Content & Schedule

A summary of the show data the player has loaded:

- **Sequences** — how many songs/sequences are available, and how many still
  **need download** (for cloud shows).
- **Schedules** — how many schedule entries are loaded.
- **Sync times** — when the sequence and schedule data were last refreshed.
- **Viewer Control** — whether viewer requests are enabled, and which mode
  (EZPlayer or Remote Falcon). See [Viewer Control](../viewer-control.md).

## Controller Status

A summary of your lighting network — model and channel counts, how many
controllers were seen, and an overall health indicator — with expandable detail
for each controller. This is covered on its own page:
[Controllers](./controllers.md).

## HTTP Listener Status

Shows the port the local web server is using and whether it is **Listening**.
This is mainly useful when connecting from the [LAN UI](../../basics/local-web-interface.md)
or troubleshooting a connection from another device.
