---
sidebar_position: 2
title: Cloud Status / Control UI
---

# Cloud Status / Control UI

Open the **Cloud** screen from the sidebar to see how your player is connected
to EZRGB, watch layout and sequence downloads, and trigger a sync when you have
just changed something on [EZRGB](https://ezrgb.com).

If the player is not registered yet, start with [Registering](./registering.md).

![Cloud screen](/img/cloud-screen.png)

## Connection summary

The card at the top shows your overall cloud state:

| What you see               | What it means                                                                     |
| -------------------------- | --------------------------------------------------------------------------------- |
| **Not connected to cloud** | The player is not registered yet. Click **Register Player**.                      |
| **Cloud paused**           | Cloud sync is turned off. Settings are kept — click **Resume Cloud** to continue. |
| **Cloud connected**        | The player is registered and actively talking to EZRGB.                           |

When connected (or paused with a layout mode already chosen), a chip shows who
owns the layout:

- **Cloud master** — layout and sequences come from EZRGB. Local layout edits
  will be overwritten on the next sync.
- **xLights master** — your local show folder owns the layout; the cloud syncs
  sequences and other content.

A line below may show current activity — **Pulling layout…**,
**Unpacking layout…**, **Pushing layout…**, downloading sequences, or that
everything is **Up to date**.

### Buttons on the top card

What you see depends on the connection mode:

| Mode           | Actions                                                                                       |
| -------------- | --------------------------------------------------------------------------------------------- |
| Not connected  | **Register Player**                                                                           |
| Paused         | **Resume Cloud**, **Disconnect**                                                              |
| xLights master | **Sync Content Now**, **Push Layout**, **Pause**, **Switch to Cloud-managed**, **Disconnect** |
| Cloud master   | **Sync Layout + Content**, **Pause**, **Switch to xLights-managed**, **Disconnect**           |

**Disconnect** clears this folder's Player ID (the cloud URL is kept). Confirm
in the dialog before continuing — you will need to register again to reconnect.

## Cloud Status

A quick health check:

- **Cloud Reachable** — `yes` / `no` / `(unknown)` from the last check-in
- **Player Registered** — whether EZRGB knows this player
- **Cloud Version**, **Last Checked**, **Last Error**

If something is wrong, **Last Error** usually points you in the right direction.

## Cloud Layout

Shows layout sync between EZRGB and your show folder — status, direction, when
it was last downloaded or uploaded, and any errors. A progress bar appears while
a transfer is running.

From this card you can also:

- **Fetch Layout** — pull the layout from EZRGB (cloud-managed shows)
- **Push Layout** — upload your local layout to EZRGB (xLights-managed shows)

## Cloud Content

Lists the sequences assigned to this player and how far along each download is.
Click a row to expand it and see individual files.

Common sequence statuses:

| Status                      | Meaning                                                |
| --------------------------- | ------------------------------------------------------ |
| **installed**               | Ready to play — appears in [Songs](../basics/songs.md) |
| **downloading**             | Files are transferring now                             |
| **pending** / **rendering** | Cloud is still preparing the sequence                  |
| **disabled**                | Turned off on EZRGB for this show                      |
| **error**                   | Something failed — expand the row for details          |
| **known**                   | Seen in the manifest, but not ready yet                |

If the list is empty, confirm you are registered, cloud is not paused, and you
have sequences assigned on EZRGB. A **halted** chip means content sync stopped
with an error — check **Last Error** and try **Sync Content Now** (or
**Sync Layout + Content**) after fixing the underlying problem.

## Cloud Configuration

Shows this folder's cloud URL and Player ID. Click **Edit** to open the same
registration / settings dialog as **Settings → Cloud**. See
[Cloud settings](../settings/cloud.md) for polling schedule and other options.

## On the EZRGB website

Once registered, open your [EZRGB](https://ezrgb.com) account and find the
player under **EZPlayer**. Click **Manage Player** to use the full EZPlayer UI
over the internet — playlists, schedule, playback, volume, and the rest of the
management screens — without being on the show network. Prefer opening
**Manage Player** in a new browser tab so the player UI has full screen space.

For building the show entirely from the website, see
[Using Full Cloud Control](./full-cloud-control.md).
