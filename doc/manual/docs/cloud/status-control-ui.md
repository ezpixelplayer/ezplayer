---
sidebar_position: 2
title: Cloud Status / Control UI
---

# Cloud Status / Control UI

Open the **Cloud** screen from the sidebar to see how your player is connected
to EZRGB and whether layout and sequences are downloading. EZPlayer syncs with
the cloud on its own; this screen is mainly for checking progress and nudging a
sync when you have just added content on [EZRGB](https://ezrgb.com).

If the player is not registered yet, start with [Registering](./registering.md).

![Cloud screen](/img/cloud-screen.png)

## At a glance

The top card shows whether you are **not connected**, **paused**, or **connected**.
When connected, a chip tells you who owns the layout:

- **Cloud master** — layout and sequences come from EZRGB.
- **xLights master** — your local show folder owns the layout; the cloud syncs
  sequences and other content.

A line below may show current activity — pulling a layout, downloading sequences,
or that everything is up to date. The buttons on this card let you register,
resume, sync, pause, or disconnect as needed.

## Cloud Status

A quick health check: whether the cloud was reachable on the last check, whether
this player is registered, and when EZPlayer last contacted EZRGB. If something
is wrong, **Last Error** usually points you in the right direction.

## Cloud Layout

Shows layout sync between EZRGB and your show folder — status, when it was last
downloaded or uploaded, and any errors. A progress bar appears while a transfer
is running.

## Cloud Content

Lists the sequences in the account assigned to this player and how far along each download is.
Click a row to expand it and see individual files. **installed** means ready to
play; **downloading** means in progress; **error** means something failed —
expand the row for details.

If the list is empty, confirm you are registered, cloud is not paused, and you
have sequences assigned on EZRGB.

## Cloud Configuration

Shows this folder's cloud URL and Player ID. Click **Edit** to open registration
and cloud settings — or use **Settings → Cloud**. See [Cloud settings](../settings/cloud.md)
for polling schedule and other options.

Once registered, your player also shows up on EZRGB for remote status and control
from the web.
