---
sidebar_position: 5
title: Setting Up a Viewer Page
---

# Setting Up a Viewer Page

A viewer page is a public web page for your audience, hosted on
[EZRGB](https://ezrgb.com). This page walks through turning one on; the
[Show Settings](./show-settings.md) page lists every field.

## What viewers get

<!-- TODO: one paragraph, no settings. What the audience sees on the page:
now playing, the song list, requests or votes during allowed hours,
listening options, the schedule, location, and contact links. -->

## Choose your viewer control

EZPlayer's built-in viewer page and [Remote Falcon](https://remotefalcon.com)
both let viewers pick songs, and you can run either or both. The comparison is
in [Viewer Control](../advanced/viewer-control.md#which-viewer-control-should-i-use).
The rest of this page covers the EZPlayer viewer page; Remote Falcon needs no
EZRGB setup beyond pasting its token into Viewer Control.

## Before you start

- The player is [registered](./registering.md) and the
  [Cloud screen](./status-control-ui.md) shows **Cloud connected**.
- You have at least one [playlist](../basics/playlists.md) for viewers to
  pick from.

## Turn the page on

On EZRGB, open **Show Settings** and, under **Viewer Page Settings**:

1. Enable **Viewer page**.
2. Set the **URL slug**. The page lives at `/shows/<slug>`.
3. Use **Share link** to copy the URL or download a QR code for signage.

Everything else on that screen (logo, theme, page sections, template) is
optional and described on [Show Settings](./show-settings.md#viewer-page-settings).

## Let viewers listen

The **Listen** section of the viewer page can offer any of these. Turn on the
ones that fit your show:

| Option | How it works | Pick it when |
| --- | --- | --- |
| **In-browser listen** | The player streams its audio to the cloud and the page plays it. Needs **Cloud audio** on the player's [Cloud screen](./status-control-ui.md#remote-control-link) set to anything but **Never stream**. | <!-- TODO --> |
| **FM** | Shows the **Frequency** from Core Show Settings so visitors tune a car radio. Needs your own FM transmitter. | <!-- TODO --> |
| **Tune2** | <!-- TODO: what Tune2 is and what the URL points at --> | <!-- TODO --> |
| **PulseMesh** | <!-- TODO: what PulseMesh is and what the URL points at --> | <!-- TODO --> |

<!-- TODO: a sentence on combining them, e.g. FM for cars plus in-browser for
walk-ups, and any latency or sync caveats worth stating. -->

## Open the request line

Requests need settings on both sides:

- **On EZRGB**, under **Viewer control** in Show Settings, choose **Request**
  or **Vote** and set cooldowns, queue limits, and anonymous participation.
  See [Show Settings](./show-settings.md#viewer-control).
- **In EZPlayer**, open **Settings → Viewer Control**, turn on
  **EZPlayer viewer page**, and add schedule entries for the hours and
  playlist viewers can pick from. See
  [Viewer Control](../advanced/viewer-control.md#schedule-configuration).

Outside those hours the page still shows what is playing; it just does not take
requests.

## Check it is working

- **Preview in window** at the top of Viewer Page Settings opens the live page.
- On the player, **Show Status → Viewer Control** shows whether the page is
  taking requests, and **Viewer Activity** shows who is on the page and
  listening. See
  [Show Status](../advanced/show-status/details.md#viewer-control).
