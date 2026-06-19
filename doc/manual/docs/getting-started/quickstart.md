---
sidebar_position: 1
title: Quickstart
---

# Quickstart (Local)

Get a show running with EZPlayer in a few minutes.

## Before you start

You'll need:

- EZPlayer installed (Windows, macOS, or Linux). See [releases](https://ezrgb.com/ezplayer).
- An **xLights show folder** — layout, sequences, and audio EZPlayer can read.
- Eventually, your controllers reachable on the network, with lights wired up.

## 1. Point EZPlayer at your show folder

![Choose Show Folder](/img/FirstRunWithoutCloud.png)

On first launch, EZPlayer asks for a **show folder**. Pick the same folder you
use in xLights. Everything else — sequences, audio, layout — is discovered from
there, so there's nothing else to configure to get started.

## 2. Add a song

![Add a Song](/img/add-song.png)

![List of songs](/img/songs.png)

Open the **Songs** screen and add a sequence, starting with the `.fseq`. In most cases, EZPlayer picks up the matching
audio and description automatically. If not, fill in the remaining files and details.

Repeat for as many sequences as you like.

## 3. Play it

![Play on jukebox](/img/jukebox.png)

Use the **Jukebox** to queue sequences and let them run. Want to see it before
it hits the real lights? The **3D preview** renders the show on screen as it plays.

## 4. Schedule the show

![Schedule](/img/schedule-calendar.png)

Open the **Schedule** screen to set when your show runs. Schedules are stored
in your show folder and take effect immediately in EZPlayer. You can also edit
them from the LAN UI or the HTTP API — see
[Reference → API](../reference/api.md).

Once a schedule entry's start time arrives, EZPlayer runs it on its own. You do
not need to press Play for each song.

### How scheduling works

Scheduling ties three layers together:

1. **Sequences** — individual songs or effects (the `.fseq` files you added in
   step 2).
2. **Playlists** — ordered lists of sequences (for example, "Christmas Songs").
   Build these on the **Playlists** screen before you schedule them.
3. **Scheduled playlists** — a playlist (plus optional intro and outro playlists)
   assigned to a **date and time window**.

When a window opens, the player walks through the intro playlist (if any), the
main playlist, and the outro playlist (if any), then stops — unless you have
enabled **loop** or **shuffle** on the main section.

#### Local storage

Schedule entries are saved as JSON in your show folder alongside your playlists
and sequence catalog. Changes you make in EZPlayer are written there
immediately and picked up by the playback engine on the next schedule refresh.
If something is already playing, unrelated edits are reconciled without
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
**Settings → Player** — see [Settings](./settings.md#player).

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

## 5. Drive it from your phone, tablet, or other computers

EZPlayer serves a **LAN UI**: open the player's address from any phone or laptop
on the same network to check status and make changes — no remote desktop, no
running back inside to the show PC.

## Where to next

- [Architecture overview](../architecture/overview.md) — how a show reaches
  your lights.
- [Reference → API](../reference/api.md) — the HTTP API for integrations.
