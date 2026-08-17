---
sidebar_position: 4
title: Using Full Cloud Control
---

# Using Full Cloud Control

**Full cloud control** means running your show from the [EZRGB](https://ezrgb.com)
website — layout, sequences, playlists, and schedule — while EZPlayer on the show
PC handles playback. In this configuration, xLights is not required to maintain
the player's show folder day to day.

## Two ways to use the cloud

| Setup                    | Best for                                                                                                                                               |
| ------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------ |
| **Cloud-managed show**   | Starting fresh on EZRGB. Layout, sequences, playlists, and schedule all come from the cloud.                                                           |
| **xLights show + cloud** | You already have a local xLights folder. The cloud syncs sequences and other content; your folder keeps the layout unless you switch to cloud-managed. |

A cloud-managed show is the simplest path to full cloud control. Start with
[Getting Started (Cloud)](../basics/getting-started-cloud.md) or
[Registering](./registering.md). If you started with xLights, you can still
register and sync content — see [Getting Sequences from EZRGB](./getting-sequences.md)
— and optionally click **Switch to Cloud-managed** on the Cloud screen later.

## Manage the show on EZRGB

On [EZRGB](https://ezrgb.com) you can:

- Build, edit, or upload your **layout**.
- Acquire **sequences** (they map, render, and download to the player
  automatically once assigned).
- Set up **playlists** and **schedule** entries.
- Open **Manage Player** from the **EZPlayer** section of your account for the
  full remote player UI over the internet.

Changes you make on the website flow down to EZPlayer on the next sync. Watch
progress on the [Cloud screen](./status-control-ui.md), or click
**Sync Layout + Content** (cloud-managed) / **Sync Content Now** (xLights-managed)
there if you want updates right away.

Some **player settings** — such as volume rules and viewer-control options — can
also be pushed from EZRGB and adopted by the player when they change on the
cloud.

## Control from near and far

- **On the show network** — the [LAN UI](../basics/local-web-interface.md) runs
  from the player machine for local phones and laptops.
- **Over the internet** — after [registration](./registering.md), open your
  EZRGB account → **EZPlayer** → **Manage Player**. That loads the full EZPlayer
  UI remotely so you can check status, edit playlists and schedules, play songs,
  adjust volume, and more when you are not on site. Open it in a **new tab** for
  the most usable layout.

The player must stay registered, online, and not paused for remote control to
work. The Cloud screen in EZPlayer is where you confirm that connection on the
player side.

## Optional: viewer / show page

EZRGB can also host a public **show page** for your audience — show info, song
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
