---
sidebar_position: 3
title: Getting Sequences from EZRGB
---

# Getting Sequences from EZRGB

Once your player is [registered](./registering.md) with EZRGB, sequences (songs)
can be delivered to your show folder over the internet. You choose what the
player should have on [EZRGB](https://ezrgb.com); EZPlayer downloads the files
and adds them to your library.

## Before you start

Make sure:

- EZPlayer is installed and is registered and shows **Cloud connected** on the
  [Cloud screen](./status-control-ui.md).
- Cloud is not paused.

If you are on a polling schedule that only syncs during certain hours, downloads
may wait until the next allowed window. See [Cloud settings](../settings/cloud.md).

## On EZRGB

Use the EZRGB website to add sequences to your show, using the same account as
the player.  Check that the sequences are active (you may choose to disable
sequences that you do not want in your show, perhaps due to the season).

## On EZPlayer

After you purchase content on EZRGB, any registered EZPlayer with an internet
connection will pick it up automatically.

For status, open the **Cloud** screen and check **Cloud Content** to see each
sequence and whether it is **downloading**, **installed**, or still being prepared.

If you just made a change and do not want to wait, click **Sync Content Now**
(or **Sync Layout + Content** on a cloud-managed show) on the Cloud screen.

When a sequence is fully **installed**, it appears in the [Songs](../basics/songs.md)
list and can be used in playlists, the jukebox, and schedules. Until the
sequence file is ready, you may see it on the Cloud screen with a status like
**rendering** or **pending**, but it will not show up as a playable song yet.

## If nothing downloads

- Confirm that the sequence is in your EZRGB account.
- Confirm the player is registered to the same account as the sequence.
- Check **Cloud Status** on the Cloud screen — **Cloud Reachable** should be
  **yes**, and **Last Error** should be **(none)**.
- Make sure cloud is not paused and your player has internet access.
- Try **Sync Content Now** once to force a refresh.

For registration problems, see [Registering](./registering.md). For connection
and sync progress, see [Cloud Status / Control UI](./status-control-ui.md).
