---
sidebar_position: 3
title: Getting Sequences from EZRGB
---

# Getting Sequences from EZRGB

Once your player is [registered](./registering.md) with EZRGB, sequences (songs)
can be delivered to your show folder over the internet. You choose what the
player should have on [EZRGB](https://ezrgb.com); EZPlayer downloads the files
and adds them to your library.

Playlists and schedule entries can sync the same way — you do not need a
separate step for each one.

## Before you start

Make sure:

- The player is **registered** and shows **Cloud connected** on the
  [Cloud screen](./status-control-ui.md).
- Cloud is **not paused**.
- You have sequences **assigned to this player** on EZRGB.

If you are on a polling schedule that only syncs during certain hours, downloads
may wait until the next allowed window. See [Cloud settings](../settings/cloud.md).

## On EZRGB

Use the EZRGB website to add sequences to your show and assign them to this
player — the same player you registered from EZPlayer. That tells the cloud
which songs this install should download.

Exact steps depend on how your EZRGB account is set up, but the idea is always
the same: the player only fetches sequences the cloud has given it access to.

## On EZPlayer

After you assign content on EZRGB, EZPlayer picks it up automatically. Open the
**Cloud** screen and check **Cloud Content** to see each sequence and whether it
is **downloading**, **installed**, or still being prepared.

If you just made a change and do not want to wait, click **Sync Content Now**
(or **Sync Layout + Content** on a cloud-managed show) on the Cloud screen.

When a sequence is fully **installed**, it appears in the [Songs](../basics/songs.md)
list and can be used in playlists, the jukebox, and schedules. Until the
sequence file is ready, you may see it on the Cloud screen with a status like
**rendering** or **pending**, but it will not show up as a playable song yet.

## If nothing downloads

- Confirm the sequence is assigned to **this** player on EZRGB, not just added
  to your account in general.
- Check **Cloud Status** on the Cloud screen — **Cloud Reachable** should be
  **yes**, and **Last Error** should be **(none)**.
- Make sure cloud is not paused and your player has internet access.
- Try **Sync Content Now** once to force a refresh.

For registration problems, see [Registering](./registering.md). For connection
and sync progress, see [Cloud Status / Control UI](./status-control-ui.md).
