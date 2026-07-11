---
sidebar_position: 4
title: Using Full Cloud Control
---

# Using Full Cloud Control

**Full cloud control** means running your show with just the EZRGB website, which manages your
layout, sequences, and show schedule, while EZPlayer handles
playback.  (Note that in this configuration, xLights is not involved in maintaining the player's show folder.)

## Two ways to use the cloud

| Setup                    | Best for                                                                                                                                               |
| ------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------ |
| **Cloud-managed show**   | Starting fresh on EZRGB. Layout, sequences, playlists, and schedule all come from the cloud.                                                           |
| **xLights show + cloud** | You already have a local xLights folder. The cloud syncs sequences and other content; your folder keeps the layout unless you switch to cloud-managed. |

A cloud-managed show is the simplest path to full cloud control. If you started
with xLights, you can still [register](./registering.md) and sync content — see
[Getting Sequences from EZRGB](./getting-sequences.md).

## Manage the show on EZRGB

On [EZRGB](https://ezrgb.com) you can:

- Build, edit, or upload your **layout**.
- Acquire **sequences**.
- Set up **playlists** and **schedule** entries.
- See **player status** and send commands when you are away from the show PC.

Changes you make on the website flow down to EZPlayer on the next sync. Watch
progress on the [Cloud screen](./status-control-ui.md), or click **Sync** there
if you want updates right away.

Some **player settings** — such as volume rules and viewer-control options — can
also be pushed from EZRGB and adopted by the player when they change on the
cloud.

## Control from near and far

- **On the show network** — the [LAN UI](../basics/local-web-interface.md) runs
  from the player machine for local phones and laptops.
- **Over the internet** — EZRGB talks to your registered player through the
  cloud. Use it to check status, manage content, and control playback when you
  are not on site.  You can find the link to your player's cloud control
  page in your account on the EZRGB website.

The player must stay registered, online, and not paused for remote control to
work. The Cloud screen in EZPlayer is where you confirm that connection on the
player side.

## Optional: viewer page

EZRGB can also back a public **viewer page** for your audience — show info, song
requests during allowed hours, and optional audio. Configure viewer-control
hours and playlists in EZPlayer under [Viewer Control](../advanced/viewer-control.md);
the cloud keeps the public page in sync while the show runs.

## What still happens locally

Even with full cloud control, EZPlayer on the show computer still:

- Plays sequences and drives your controllers on the network.
- Runs [schedules](../basics/simple-schedules.md) and the [jukebox](../basics/jukebox.md)
  at show time.
- Serves the LAN on your network.

The cloud is how you **manage** the show; the player is what **runs** it.
