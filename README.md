# EZPlayer

_An easy-to-use pixel show player for the xLights ecosystem._

![Platform](https://img.shields.io/badge/platform-Windows%20%7C%20macOS%20%7C%20Linux-blue)
![License](https://img.shields.io/badge/license-AGPL--3.0-red)
![Build](https://img.shields.io/badge/build-passing-brightgreen.svg)

---

## 🚀 Quick Start

### Features

While we will continue to add features through the 2026 season, EZPlayer is ready for 4th of July shows.

EZPlayer can be used completely locally, supporting:
- A flexible schedule of playlists of sequences
- A jukebox view of songs to choose from for immediate / queued playback
- .mp3 and .fseq playback from an xLights show folder
- DDP and E1.31 controllers on attached IPv4 networks
- Live view of the show
- Status screens
- Remote Falcon viewer control
- Local (LAN) Web UI
- Background sequences, volume control automation, etc.

With the (optional) EZPlayer cloud registration:
- See the full EZPlayer UI for your show over the internet
- A show page for your viewers

For sequences from EZRGB:
- Automatic sequence mapping, download, and installation
- Layout sync

You can also build and deploy your whole show through the cloud, directly to your EZPlayer.

We are currently enhancing:
- Controller status
- [Background blending, brightness options, and other small issues](https://github.com/ezpixelplayer/ezplayer/issues)

Later in 2026 we will be adding:
- Sync packets
- Documentation of the HTTP API for integration projects

On the roadmap (dates not committed):
- HDMI video playback
- Interactivity

EZPlayer doesn't support (and likely won't support):
- USB controllers
- OS management
- Controller capes
- Plugins (equivalent functionality is available by using other integration methods)

### Download Prebuilt Releases

You do **not need to build from source** to use the app.

➡️ **Download the latest release:**  
https://github.com/ezpixelplayer/ezplayer/releases

We currently provide builds for:

- **Windows (x64)**
- **macOS (dmg)**
- **Linux (AppImage)**

Just download the installer or portable build and run it.

#### Signed Images
EZPlayer images are currently not signed, and you may have to approve installation.  We're working on that.

#### Raspberry Pi
EZPlayer is tested on Raspberry Pi 5 and 4 (4GB or more required), but you currently have to compile it yourself.  We might provide images later in the year.

### Running EZPlayer Locally

When you first run EZPlayer, you will choose your show folder.  This should contain your xLights files, which are needed for EZPlayer to find your controllers. You can change the show folder later from the "Settings" screen.

The player opens to the "Player" screen, but there will not be much here yet. So, navigate between screens using the sidebar menu. (If no sidebar is visible, click the 3 bars in the upper right corner.)

Start on the "Songs" screen. Here you can add songs (aka "sequences").  Start by choosing the .fseq; hopefully the music and metadata will be found automatically.  If not, associate the .fseq file with its .mp3 file, the song title, etc. If you have image files (or URLs) handy, you can enter those as well, this way your songs will show with images in the jukebox gallery. It is recommended to add some tags to your songs, as this will help build playlists.   You can then try playing your songs from the "Jukebox" gallery.

After adding some songs, create playlists on the "Playlists" screen. You can think of a playlist as an ordered list of songs to play, but it can also be used as a "set" of songs that are not taken in order.  As we'll see later, you might want to make an "intro" playlist, a few main playlists, and an "outro" playlist.

After you have some playlists, visit the "Schedule" screen. Here, you can assign your playlists to play on the right days. Note that each schedule item is where you can set the "intro" and "outro" that goes with your show playlist, assign priorities, add loop/shuffle, and so forth.

Return to the "Player" screen, which will give you a summary of what is going and what will happen next. But, if you want more detail about exactly how your schedule will run, try the "Schedule Preview" button on the "Schedule" screen, or if you want more details about how the show is running, how the controllers are performing, etc., try "Show Status".

If you want to connect to the cloud (for remote management, automatic sequence rendering and download, etc.), visit the "Cloud" screen.

### Starting In The Cloud

If you used the EZRGB website to set up your show, choose cloud setup when EZPlayer launches for the first time.  Click the link, or use the QR code to register the player via another device (such as your phone).  Your layout, sequences, schedule, and settings will download to your show folder automatically.

### Known Issues

EZPlayer does not do well with missing files. Don't remove anything.

### Connecting With Us

Please report any bugs or requests here:
[GitHub Issues](https://github.com/ezpixelplayer/ezplayer/issues)

For any general discussion, join us on [Discord](https://discord.gg/gpwxM4bR94).

---

## About EZPlayer

### 🧩 What This App Does

EZPlayer is a show player and scheduler app for animated light shows based on pixel controllers. It reads files and sends the data over the network at show time, and plays the audio in sync. This is very similar to what xLights [xSchedule](https://xlights.org) does.

It is also similar in purpose to [FPP](https://github.com/FalconChristmas/fpp), though FPP is more of an embedded service with a web UI.

### Why Another Player?

With two established player solutions, why would anyone make a brand new one?

Well, we liked the design of xSchedule but found it to be underdesigned and undermaintained, and getting the sort of simplicity and features we wanted to see in the future would have been difficult on that codebase.

On the other hand, FPP is more of a decentralized design, hybrid player+OS manager+cape firmware, and as a result, can be extremely complex to work with.

So, we started a new one, featuring:

- Node.js / Electron stack / React, for a modern UI that supports the same look both on the desktop and on the web (local or cloud)
- Simplicity, starting with how songs and playlists are maintained
- Affero GPL licensing, so it is free forever

### Roadmap

We have a lot of features planned for the coming years. We aim to simplify the way the xLights ecosystem works, while solving long-standing problems. We have a plan for interactive show elements, but without resorting to a complex and brittle plugin architecture or a tangled web of version dependencies.

Despite that broad scope, we want to avoid the complexity that currently plagues the xLights ecosystem, so there are a few things we do not expect we will ever implement:

- USB controllers
- Cape support (this is a player, not a controller firmware)
- All the complexity and limitations of anything like FPP connect
- A complex plugin architecture

### What Is The Relationship To EZRGB?

EZPlayer is developed in part by [EZRGB](https://ezrgb.com/).  EZRGB feels that the community should have a PC-based player that is easy to use, and hosts cloud functionality for the community and their commercial clients.

---

## 🛠️ Building From Source (Developers)

See [DEVELOPING.md](./DEVELOPING.md).

---

## Other

Your various files (song lists, playlists, schedules, and settings) end up in your show folder in `./ezplayer` in `.json` files. You might want to back those up if you spend a lot of time working on them.
