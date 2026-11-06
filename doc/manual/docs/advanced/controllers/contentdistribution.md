---
sidebar_position: 6
title: Content Distribution
---

# Content Distribution

Most controllers are sent pixel data over the network while the show runs, and keep nothing.  Some devices are different: they hold their own copy of the show — the sequence files and the audio — and can play it themselves.  Content distribution is how EZPlayer puts this show onto those devices and keeps it current.

:::note
Today this means FPP devices, including Kulp and Wally's Lights capes, Colorlight and panel players.  Which devices hold content, and which of those EZPlayer can write to, is listed in the [Support Matrix](supportmatrix.md).  A device that holds no content needs nothing distributed to it; it is simply sent its pixels during the show.
:::

## What gets sent

For each song in the show, EZPlayer sends:

- **The sequence.**  If the device is a remote responsible for part of the layout, it is sent only the channels it actually drives, not the whole show.  The report says so — for example `sliced to 12,288 of 92,775 channels`.
- **The audio**, when the song has any.  This is the same audio EZPlayer itself would play, so a device playing on its own sounds like the show does here.  A normalized song, or one that is not an mp3, is sent as the derived mp3 rather than the original file.
- **An inventory playlist**, listing everything that was put there, so it can be found and played on the device.  This is a list, not a schedule — nothing runs because it exists.  You can rename it or leave it empty to skip it, in the settings described below.

## Starting a distribution

There are three ways in, and they all do the same thing:

- **Show Status** has a **Content Distribution & Sync** card with **Distribute now**, **Check** and **Details**.
- **Playback Settings → Content Sync** has the same actions beside the settings that govern them.
- The [controller actions](controlleractions.md) for a single content-holding device offer **Send content** and **Check content**, which act on that device alone.

**Check what's needed** reads each device's own file list and reports what a send *would* transfer, without transferring anything.  It costs a few metadata reads per device, so it is the safe thing to run when you only want to know where you stand.

**Distribute now** sends what is missing.  It never re-sends a file the device already holds correctly, so running it twice is cheap, and running it again after a failure sends only what is still outstanding.

While a run is in flight, both the card and the dialog show overall progress and a line per device, so one slow or stalled device is obvious.  **Stop** cancels the run.

## Reading the report

The **Details** dialog pivots the last run into one row per file and one column per device, with each device's FPP version under its name.  Each cell is one of:

| Chip | Meaning |
| - | - |
| **sent** | transferred during this run |
| **current** | already correct on the device, so nothing was sent |
| **to send** | a check found it missing; nothing was transferred |
| **failed** | the transfer was attempted and did not succeed |

Hovering a cell gives the reason behind the decision, and the bytes and time for anything transferred.  A device that came out of the run still behind the show is called out above the table.

### Why a file is re-sent

EZPlayer compares the sequence the device holds against the one here, and re-sends only on a real difference.  The comparison follows the same fields, in the same order, that xLights uses, so a sequence xLights already loaded onto a device is not sent again by EZPlayer, and vice versa.  Reasons you may see:

- `not on device`
- `fseq version 1.0 on device, v2 here`
- `compression 0 on device, 1 here`
- `different sequence id`
- `4513 frames on device, 4200 here`
- `50ms step on device, 25ms here`
- `max channel 93838 on device, 94342 here`
- `6 sparse ranges on device, 1 here`

Audio is simpler: it is re-sent only when the device's byte count disagrees with ours.

## Sending automatically

**Playback Settings → Content Sync** chooses when distribution happens on its own:

- **Only when I ask** — nothing is sent unless you press a button.
- **During scheduled times** — sent inside the distribution windows you define.  With no windows defined, nothing is sent automatically.
- **Whenever something is missing** — sent as soon as a check finds work.

With either automatic mode you can also set:

- **Send new songs as they are added** — a song added on the Songs screen, or installed by the cloud, is queued and sent without waiting for the next look round.
- **Look for work every (minutes)** — how often to check.  A look with nothing to send costs a few metadata reads per device.

:::note
Automatic sends wait for a stopped player.  A large transfer competes with the show for disk and network, so EZPlayer will not start one while something is playing.  The status card says why it is quiet — *Automatic distribution is off*, or *Outside the distribution window*.
:::

## If something goes wrong

**No FPP players known yet** means no content-holding device has been found.  Run a [controller scan](networkscan.md) first; distribution works from the discovered devices, not from the layout.

**A device shows an error instead of a count.**  The device answered discovery but its file list could not be read.  Confirm it is reachable from the [Controller List](controllerlist.md), then run **Check**.

**A transfer failed.**  Check free space on the device first; a show's sequences are large, and a sliced sequence for a remote is smaller than the show's own file but still substantial.  Then run **Distribute now** again — only the outstanding files are retried.

**The device has the files but will not play them.**  Distribution puts files and an inventory playlist on the device; it does not schedule anything there.  A device meant to follow this player needs sync output as well, which is the **Sync Output** half of the same settings page.
