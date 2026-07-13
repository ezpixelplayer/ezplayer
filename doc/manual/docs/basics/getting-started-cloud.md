---
sidebar_position: 2
title: Getting Started (Cloud)
---

# Getting Started (Cloud)

Get your EZRGB show playing in just a few minutes.

This version of "Getting Started" is for people who set up their shows in the [EZRGB Cloud](https://ezrgb.com).

If you set up your show with xLights and have a show folder on the player machine, [start here instead](./getting-started-local.md).

## Before you start

You'll need:

- EZPlayer installed (Windows, macOS, or Linux). See [releases](https://ezrgb.com/ezplayer).
- A location for your **show folder** — storage space for your layout, sequences, and audio.
- Eventually you will need your controllers reachable on the network, with lights wired up, but you can skip this at first.

## 1. Point EZPlayer at your show folder

On first launch, choose "Connect to EZRGB Cloud".
![Cloud Registration Choice Screen](/img/FirstRunWithCloud.png)

Choose a **show folder** for temporary storage.

When the registration appears, click the URL to sign in to EZRGB and register your player,
or scan the QR code with another device to complete registration.

![Cloud Registration Screen](/img/FirstRunCloudReg.png)

## 2. Wait for content

Open the **Cloud** screen and watch your content download.

## 3. Play it

![Play on jukebox](/img/jukebox.png)

Use the **Jukebox** to queue sequences and let them run. Want to see it before
it hits the real lights? The **3D Preview** screen renders the show on screen as it plays.

## 4. Build a playlist

![Playlists](/img/playlists.png)

![Create playlist](/img/create-playlist.png)

Open **Playlists** and click **Create Playlist**. Drag songs from the list on
the left into your playlist on the right, set a name, and save. Schedules play
playlists — not individual songs — so group your sequences into at least one
playlist before you set show times.

See [Playlists](./playlists.md) for sorting, tags, and cloning.

## 5. Schedule the show

![Schedule](/img/schedule-calendar.png)

Open the **Schedule** screen to set when your show runs. Click a date to add a schedule.
Choose a playlist, a time window, a date range (if desired), loop, shuffle, and other options.

Once a schedule entry's start time arrives, EZPlayer runs it on its own.

For more on recurring schedules and intro/outro playlists see
[Simple Schedules](./simple-schedules.md). For background layers, priorities, runtime
behavior, and previewing a schedule, see
[Complex Schedules](../advanced/complex-schedules/overview.md).

## 6. Drive it from your phone, tablet, or other computers

EZPlayer serves a **LAN UI**: open the player's address from any phone or laptop
on the same network to check status and make changes — no remote desktop, no
running back inside to the show PC.

The default port is 3000, but to confirm, open **Show Status** to see **HTTP Listener Status** (port and
whether the server is listening). See [Local Web Interface](./local-web-interface.md)
for URLs, port configuration, and troubleshooting.

## 7. Use cloud features

Go to [EZRGB](https://ezrgb.com) to adjust your layout, get more songs, and control your player from the internet.

## Where to next

- [Songs](../basics/songs.md), [Playlists](../basics/playlists.md), and [Schedules](../basics/simple-schedules.md) - How to set up songs, playlists, and schedules.
- [Player](../basics/player-screen.md), [Jukebox](../basics/jukebox.md), and [Preview](../basics/preview.md) - How to control and see your show.
- [Web UI](../basics/local-web-interface.md) - How to control the show over your local network
