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

- **Type** — the kind of player.
- **Last Checkin** — when the player last reported in.
- **Playback details** — opens a closer look at what is on, what it
  interrupted, what is waiting, and what is next. See
  [Playback details](../../basics/player-screen.md#playback-details).
- **Status** — Playing, Paused, Ending (a graceful stop is under way), or Not
  Playing.
- **Now Playing** and **Until** — the current song and when it's expected to end.
- **Background** and **Until** — the background sequence, when one is running.
- **Upcoming Songs / Upcoming Shows** — what's queued to play next.

If there are interactive requests or schedules that were paused by a
higher-priority show, they appear here too (as **queue**, **suspended**, or
**preempted** items).

The **Stats** button opens detailed playback statistics — see
[Statistics](./statistics.md).

## Test Sequences

Play a test sequence on demand.
The dropdown lists sequences carrying one of the configured test
tags (default `test`; set under
[Settings → Player](../../settings/player.md#test-sequences)), and **Play Test
Sequence** starts the selection immediately. **Stop** ends the test sequence you
started from this screen.  Unavailable when no test tags are configured.

## Content & Schedule

A summary of the show data the player has loaded:

- **Sequences** — how many songs/sequences are available, and how many still
  **need download** (for cloud shows).
- **Music proof needed** — shown when some sequences still need proof of music
  rights. **Fix on Cloud page** takes you to the [Cloud](../../settings/cloud.md)
  page.
- **Schedules** — how many schedule entries are loaded.
- **Sync times** — when the sequence and schedule data were last refreshed.

## Viewer Control

A summary of viewer requests. See [Viewer Control](../viewer-control.md) for how
to set it up.

- **Chips** — which backends are on: **EZPlayer viewer page**, **Remote
  Falcon**, or both. They are green while a request window is open and amber
  while it is closed. **Disabled** is shown when viewer control is off.
- **Request window** — whether a window is open right now, and if so the
  playlist viewers are picking from and when it ends. Shows _No request windows
  scheduled_ if none are set up.
- **Viewer page** (EZPlayer viewer page only) — whether the page is taking
  requests or votes, how many people are on it and listening, and the queue
  length or vote count. Marked _(stale)_ if the cloud has not reported recently,
  or _player offline_ when the player is not connected.
- **Today** — requests and votes on the viewer page, and songs picked by source
  (viewer page, Remote Falcon, jukebox).

When both backends are on, viewer-page requests play before Remote Falcon
suggestions.

**Settings** opens the Viewer Control settings. **Viewer activity** opens the
full activity view.

## Controller Status

A summary of your lighting network — model and channel counts, how many
controllers were seen, and an overall health indicator — with expandable detail
for each controller. This is covered on its own page:
[Controllers](./controllers.md).

## HTTP Listener Status

Shows the port the local web server is using and whether it is **Listening**.
This is mainly useful when connecting from the [LAN UI](../../basics/local-web-interface.md)
or troubleshooting a connection from another device.
