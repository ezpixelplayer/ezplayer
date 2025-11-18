# EZPlayer
_An easy-to-use pixel show player for the xLights ecosystem._

![Platform](https://img.shields.io/badge/platform-Windows%20%7C%20macOS%20%7C%20Linux-blue)
![License](https://img.shields.io/badge/license-AGPL--3.0-red)
![Build](https://img.shields.io/badge/build-passing-brightgreen.svg)

---

## 🚀 Quick Start

### Who Should Use EZPlayer?

Nobody ☺️.  At the time of the latest update of this README, it is already mid-November and the quality of EZPlayer is pre-alpha.  If you already have a working player ([FPP](https://github.com/FalconChristmas/fpp) or [xSchedule](https://xlights.org/)) you should keep using what works.  (This player is only known to have been used in two live shows so far, and has only been tested up to 1M channels at 100FPS.)

That said, if you are up for an adventure and would like to help improve EZPlayer so that it is ready for use in future years, you are welcome to experiment with it.

Currently, EZPlayer supports a subset of what xSchedule supports:
* Setup of a simple schedule of playlists of sequences
* Execution from an xLights show folder
* .mp3 and .fseq playback
* DDP and E1.31 controllers on attached IPv4 networks
* A jukebox view of songs to choose from
* A variety of status screens

It doesn't support (and won't soon support):
* USB controllers
* Master/Remote show designs
* HDMI video playback

We do hope to have support for the following at some point in the 2025 season, as these are in active development:
* Local Web UI
* Remote Falcon
* Background sequence
* Volume control automation

### Download Prebuilt Releases
You do **not need to build from source** to use the app.

➡️ **Download the latest release:**  
https://github.com/ezpixelplayer/ezplayer/releases

We currently provide builds for:
- **Windows (x64)**
- **macOS (dmg)**
- **Linux (AppImage)**

Just download the installer or portable build and run it.

### Running EZPlayer

When you first run EZPlayer, you will choose your show directory.  This should contain your xLights files, which are needed for EZPlayer to find your controllers.  You can change the show folder later from the "Playback Settings" screen.

The player opens to the "Player" screen, but there will not be much here yet.  So, navigate between screens using the sidebar menu.  (If no sidebar is visible, click the 3 bars in the upper right.)

Start on the "Songs" screen.  Here you can add songs, which associate the .fseq file with its .mp3 file, the song title, etc.  If you have image files (or URLs) handy, you can enter those as well, this way your songs will show with images in the jukebox gallery.  It is recommended to add some tags to your songs, as this will help build playlists.  You can try playing your songs from the "Jukebox" gallery.

After adding some songs, create playlists on the "Playlists" screen.  You can think of a playlist as an ordered list of songs to play, but it can also be used as a "set" of songs that are not taken in order.  As we'll see later, you might want to make an "intro" playlist, a few main playlists, and an "outro" playlist.

After you have some playlists, visit the "Schedule" screen.  Here, you can assign your playlists to play on the right days.  Note that each schedule item is where you can set the "intro" and "outro" that goes with your show playlist, assign priorities, add loop/shuffle, and so forth.

Return to the "Player" screen, which will give you a summary of what is going and what will happen next.  But, if you want more detail about exactly how your schedule will run, try the "Schedule Preview" screen, or if you want more details about how the show is running, how the controllers are performing, etc., try "Show Status".

### Known Issues
Sometimes you have to restart the player to get it to do what it is supposed to.
For smooth playback, start EZPlayer before the show, so it can preload all the audio in the schedule.
EZPlayer does not do well with missing files.  Don't remove anything.

### Connecting With Us
Please report any bugs or requests here:
[GitHub Issues](https://github.com/ezpixelplayer/ezplayer/issues)

For any general discussion, join us on [Discord](https://discord.gg/gpwxM4bR94).

---

## About EZPlayer

### 🧩 What This App Does

EZPlayer is a show player and scheduler app for animated light shows based on pixel controllers.  It reads files and sends the data over the network at show time, and plays the audio in sync.  This is very similar to what xLights [xSchedule](https://xlights.org) does.

It is also similar in purpose to [FPP](https://github.com/FalconChristmas/fpp), though FPP is more of an embedded service with a web UI.

### Why Another Player?

With two established player solutions, why would anyone make a brand new one?

Well, we liked the design of xSchedule but found it to be underdesigned and undermaintained, and getting the sort of simplicity and features we wanted to see in the future would have been difficult on that codebase.

On the other hand, FPP is more of a decentralized design and can be extremely complex to work with.

So, we started a new one, featuring:
- Node.js / Electron stack / React, for a modern UI that supports the same look both on the desktop and on the web
- Simplicity, starting with how songs and playlists are assembled
- Affero GPL licensing, so it is free forever

### Roadmap

We have a lot of features planned for the coming years... better previews, better controller health checks, a cloud portal, and so forth.  We aim to simplify the way the xLights ecosystem works, while solving long-standing problems.  We have a plan for interactive show elements, but without resorting to a complex and brittle plugin architecture or a tangled web of version dependencies.

Despite that broad scope, we want to avoid the complexity that currently plagues the xLights ecosystem, so there are a few things we do not expect we will ever implement:
- USB controllers
- All the complexity and limitations of anything like FPP connect.
- Cape support (this is a player, not a controller firmware)
- A complex plugin architecture

---

## 🛠️ Building From Source (Developers)

Because this project is **AGPL**, the full source code is available and the build process is documented.

### Requirements
- Windows (with git bash or WSL) and C++ compiler, MacOS, or Linux with the appropriate dev packages installed
- Node.js ≥ 22  (get from nvm if needed)
- pnpm 
- Python 3 + build tools (for native modules)
- Git

### Clone, Install, and Build
```bash
git clone https://github.com/ezpixelplayer/ezplayer.git
cd ezplayer
pnpm install
pnpm build
```

Then, fix whatever went wrong :-).

Your main build will appear in `apps/ezplayer-ui-electron/release`.

---

## Other

Your various files (song lists, playlists, schedules) end up in your show folder in `.json` files.  You might want to back those up.