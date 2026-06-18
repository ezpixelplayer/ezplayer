---
sidebar_position: 2
title: Quickstart Cloud
---

# Quickstart (Cloud)

Get your EZRGB show playing in just a few minutes.

## Before you start

You'll need:

- EZPlayer installed (Windows, macOS, or Linux). See [releases](https://ezrgb.com/ezplayer).
- Eventually, your controllers reachable on the network, with lights wired up.
- A **temporary folder** — storage space for your layout, sequences, and audio.

## 1. Point EZPlayer at your show folder

On first launch, choose "Connect to EZRGB Cloud".
![Cloud Registration Choice Screen](/img/FirstRunWithCloud.png)

Choose a **show folder** for temporary storage.

When the registration appears, click the URL to sign in to EZRGB and register your player,
or scan the QR code with another device to complete registration.

![Cloud Registration Screen](/img/FirstRunCloudReg.png)

## 2. Wait for content

![Cloud Screen](/img/cloud-screen.png)

Open the **Cloud** screen and watch your content download.

## 3. Play it

![Play on jukebox](/img/jukebox.png)

Use the **Jukebox** to queue sequences and let them run. You can access the jukebox from

- EZPlayer UI directly
- The EZPlayer LAN UI
- The EZPlayer cloud

## 4. Schedule the show

![Schedule](/img/schedule-calendar.png)

Open the **Schedule** screen to see when your show runs. In cloud mode the
schedule is authored in **EZRGB Cloud** (along with your playlists and
sequences) and synced to the player automatically. You can also view and edit
it from EZPlayer itself, the LAN UI, or the HTTP API — see
[Reference → API](../reference/api.md).

Once a schedule entry's start time arrives, EZPlayer runs it on its own. You do
not need to press Play for each song.

### How scheduling works

Scheduling ties three layers together:

1. **Sequences** — individual songs or effects (`.fseq` files).
2. **Playlists** — ordered lists of sequences (for example, "Christmas Songs").
3. **Scheduled playlists** — a playlist (plus optional intro and outro playlists)
   assigned to a **date and time window**.

When a window opens, the player walks through the intro playlist (if any), the
main playlist, and the outro playlist (if any), then stops — unless you have
enabled **loop** or **shuffle** on the main section.

#### Cloud sync

After registration, the cloud worker polls EZRGB for playlists and schedule
entries on the same cadence as other show content (by default, every few
minutes). When the cloud publishes an update, EZPlayer merges it into the
local show folder using each record's `updatedAt` timestamp — the newest version
wins. The playback engine picks up changes on the next schedule refresh; if
something is already playing, unrelated edits are reconciled without
interrupting the current song.

#### Creating and editing entries

![Schedule editing](/img/schedule-editing.png)

Click a day on the calendar (or an existing block) to open the editor. Pick the
**main playlist**, set **from** and **to** times, and optionally attach:

- **Intro playlist** — plays once at the start of the window.
- **Outro playlist** — plays once as the window winds down.

Use the **Main** / **Background** toggle at the top to switch which kind of
schedule you are editing (see below).

**Recurrence** lets one entry repeat:

![Recurring schedule](/img/schedule-recurring-1.png)

- **Once** — a single date.
- **Daily** — every day until an end date.
- **Selected days** — specific weekdays (for example, Fri–Sun only).

![Recurring options](/img/schedule-recurring-2.png)
![Recurring end date](/img/schedule-recurring-3.png)

#### Main vs background schedules

![Background schedule](/img/background-schedule.png)

Most show content lives on the **Main** schedule — this is what drives your
foreground lights and audio.

**Background** schedules run a second playlist at the same time, blended with
whatever is on main. Use these for always-on elements such as tune-to loops or
ambient effects. The blend mode (**overlay** or **underlay**) is set under
**Playback Settings**.

Background entries follow the same time-window and priority rules as main
entries, but they never replace the foreground show — they layer on top of (or
under) it.

#### What happens at runtime

When the clock enters a scheduled window, EZPlayer:

1. **Loads the entry** into its scheduler (it looks ahead several hours so
   upcoming shows are ready in advance).
2. **Plays the intro playlist** from start to finish (if configured).
3. **Plays the main playlist** — in order, or shuffled/looped if you enabled
   those options.
4. **Transitions to the outro** as the window nears its end time, governed by
   the **end policy**:
    - **Stop at sequence boundary (early)** — end before the last song if time
      is running out.
    - **Stop at sequence boundary (late)** — allow the current song to finish
      even slightly past the window.
    - **Stop at nearest boundary** — compromise between early and late.
    - **Hard cut** — stop exactly at the end time, even mid-sequence.
5. **Plays the outro playlist** (if configured), then the entry is done.

**Priority** resolves overlaps. If two main-schedule windows collide, the
higher-priority entry takes over. Lower-priority entries are suspended and can
resume when the winner finishes — unless you chose **hard cut in**, which
interrupts immediately.

**Loop** replays the main playlist until the window ends. **Shuffle** builds a
randomized main playlist (seeded from the schedule start time so it is
repeatable) long enough to fill the window.

#### Overrides and manual control

The schedule is the default autopilot, but you are not locked in:

- **Jukebox** — queue a song or playlist on demand. Queued items play at the
  next sequence boundary unless marked immediate.
- **Stop** — graceful stop finishes the current song (and outro, if any); stop
  now cuts immediately.
- **Skip** — advance to the next song in the current playlist.
- **Viewer control** — integrations such as Remote Falcon can request songs
  during configured viewer-control hours.

Interactive requests use a separate priority tier from scheduled entries, so a
scheduled show can be suspended and later resumed.

#### Preview before you go live

![Schedule preview](/img/schedule-timings.png)

Open **Schedule Preview** from the Schedule screen to simulate what the player
will do over the next several hours — including priority conflicts, loops,
shuffles, and intro/outro timing. Use this to catch surprises before the lights
go on.

## Where to next

- [Architecture overview](../architecture/overview.md) — how EZPlayer fits in with your show.
- [Reference → API](../reference/api.md) — the HTTP API for integrations.
