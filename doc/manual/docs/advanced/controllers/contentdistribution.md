---
sidebar_position: 6
title: Content Distribution
---

# Content Distribution

Most controllers are sent pixel data over the network while the show runs, and keep nothing.  Some devices are different: they hold their own copy of the show — the sequence files and the audio — and can play it themselves.  Content distribution is how EZPlayer puts this show onto those devices and keeps it current.

:::note
Which devices hold content, and which of those EZPlayer can write to, is listed in the [Support Matrix](supportmatrix.md).  A device that holds no content needs nothing distributed to it; it is simply sent its pixels during the show.
:::

Two kinds of device hold content, and the difference runs through the rest of this page:

- **FPP devices** — including Kulp and Wally's Lights capes, Colorlight and panel players — take the show's own files, work out what to play from a playlist they already keep, and report in detail what they are holding.
- **Controllers that play from a card of their own** — Falcon V4/V5, Genius 2.x and HinksPix — take a file built for them, have to be told what to play, and can tell us very little about what is on the card.

## What gets sent

For each song in the show, EZPlayer sends:

- **The sequence.**  If the device is a remote responsible for part of the layout, it is sent only the channels it actually drives, not the whole show.  The report says so — for example `sliced to 12,288 of 92,775 channels`.
- **The audio**, when the song has any.  This is the same audio EZPlayer itself would play, so a device playing on its own sounds like the show does here.  A normalized song, or one that is not an mp3, is sent as the derived mp3 rather than the original file.
- **An inventory playlist**, listing everything that was put there, so it can be found and played on the device.  This is a list, not a schedule — nothing runs because it exists.  You can rename it or leave it empty to skip it, in the settings described below.

## Controllers that play from their own card

A Falcon, Genius or HinksPix does not store the show's own files.  EZPlayer builds each one what its firmware will play: the compression the board supports, the container it expects, and for a HinksPix an HSEQ in the controller's own packed channel order rather than the show's.  The conversion is ours to get right, so the limits are the firmware's, not a policy:

- A **HinksPix** plays sequences stepped at exactly 25 ms or 50 ms, names files in 29 characters or fewer, and pairs audio by naming it in a playlist entry beside the sequence.
- A **Falcon** needs a V4 or V5 board; a V2 or V3 has no card to write to.
- A **Genius** needs firmware 2.x; 1.x has no upload endpoint.

A device that cannot take what the show is made of says so before anything is transferred, and the reason appears in the report rather than as a failed file.  That is a correct answer, not a fault: a show at 20 ms, for instance, is not something a HinksPix can play from its card at all.

### Audio on a device playing by itself

A device playing from its own card plays its own audio, which means it needs an audio output of its own.  A **HinksPix** has one, and is sent the show's audio converted to the format its firmware reads.  A **Genius** has no audio hardware at all, so it lights and stays silent.  A **Falcon**'s depends on the board.  None of this applies to a device following this player's sync for timing while the audio plays here.

## Starting a distribution

There are three ways in, and they all do the same thing:

- **Show Status** has a **Content Distribution & Sync** card with **Distribute now**, **Check** and **Details**.
- **Playback Settings → Content Sync** has the same actions beside the settings that govern them.
- The [controller actions](controlleractions.md) for a single content-holding device offer **Send content** (**Distribute content** when it is not behind the show) and **Check content**, which act on that device alone.

**Check what's needed** reads each device's own file list and reports what a send *would* transfer, without transferring anything.  It costs a few metadata reads per device, so it is the safe thing to run when you only want to know where you stand.

**Distribute now** sends what is missing.  It never re-sends a file the device already holds correctly, so running it twice is cheap, and running it again after a failure sends only what is still outstanding.

**Send everything again** sends every file to every device, whether or not it looks current.  It is the cure for one problem in particular, described under [Why a file is re-sent](#why-a-file-is-re-sent) below, and it is a full transfer — expect it to take as long as filling the devices did the first time.  It is beside **Distribute now** wherever that appears: the Show Status card, the Content Sync settings, and the foot of the **Details** dialog.

While a run is in flight, both the card and the dialog show overall progress and a line per device, so one slow or stalled device is obvious.  **Stop** cancels the run.

A run with nothing to do is not a failure.  A show whose songs have not been added yet, or a layout that names nobody who plays their own copy, answers with the report you asked for — an empty one, with the reason on it — and the **Details** dialog opens by itself to show it.

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

:::warning
There is one difference this comparison cannot see.  A re-render that moves models to different ports or channels *inside one controller's range* produces a file with the same size, frame count, step time and channel count as the one the device is holding — every field a device can report — while the pixels underneath are different.  A check calls it current, and the device goes on playing the old arrangement.  Nothing can be deleted from a card either, so overwriting is the only way out: use **Send everything again** after a re-render that moved models about.
:::

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

### Sync output

Content is only half of what a remote needs; the other half is being told when to play.  That is the **Sync Output** setting on the same page, and it has three positions:

- **Automatic** — sync is sent whenever there is anyone to send it to: a controller the layout marks as a remote, or an address listed by hand.  This is what a show gets until the setting is touched.
- **On** — always send.
- **Off** — never send.

With sync off, a remote is filled with the whole show and never told to start: it holds everything it needs and sits in the dark.  Because nothing on the device says so, the content status card, the **Details** dialog and this settings page all carry a warning naming the remotes it affects whenever a layout has remotes and sync is off.

## If something goes wrong

**No devices that hold content known yet** means none has been found.  Run a [controller scan](networkscan.md) first; distribution works from the discovered devices, not from the layout.

**A device shows an error instead of a count.**  The device answered discovery but its file list could not be read.  Confirm it is reachable from the [Controller List](controllerlist.md), then run **Check**.

**A device is listed as unsupported, or a file is refused with a reason.**  Its firmware will not take what the show is made of — see [Controllers that play from their own card](#controllers-that-play-from-their-own-card) for the limits that produce this, and the [Support Matrix](supportmatrix.md) for what each family can be sent.

**A transfer failed.**  Check free space on the device first; a show's sequences are large, and a sliced sequence for a remote is smaller than the show's own file but still substantial.  Then run **Distribute now** again — only the outstanding files are retried.

**The device has the files but will not play them.**  Distribution puts files and an inventory playlist on the device; it does not schedule anything there.  A device meant to follow this player needs sync output as well, which is the [**Sync Output**](#sync-output) half of the same settings page — the first thing to check when a remote holds the show and stays dark.  A HinksPix never follows this player's sync — see [Player / Remote / xLights Only](controllerlist.md#player--remote--xlights-only) — so one holding content plays from its card or not at all.
