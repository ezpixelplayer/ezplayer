---
sidebar_position: 1
title: Getting Started (Local)
---

# Getting Started (Local)

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
[REST Interface (HTTP API)](../reference/api.md).

Once a schedule entry's start time arrives, EZPlayer runs it on its own. You do
not need to press Play for each song.

For how playlists, recurrence, and scheduled windows fit together, see
[Simple Schedules](./simple-schedules.md). For background layers, runtime
behavior, and previewing a schedule, see
[Complex Schedules](../advanced/complex-schedules/overview.md).

## 5. Drive it from your phone, tablet, or other computers

EZPlayer serves a **LAN UI**: open the player's address from any phone or laptop
on the same network to check status and make changes — no remote desktop, no
running back inside to the show PC.

## Where to next

- [What is EZPlayer](../introduction/what-is-ezplayer.md) — how a show reaches your lights.
- [REST Interface (HTTP API)](../reference/api.md) — the HTTP API for integrations.
