---
sidebar_position: 4
title: Jukebox
---

# Jukebox

The **jukebox** is EZPlayer's on-demand playback screen. While the
[schedule](./simple-schedules.md) runs your show on autopilot, the jukebox lets
you (or your guests) pick individual [songs](./songs.md) to play right now or
queue for later.

![Play on jukebox](/img/jukebox.png)

### Playback controls

- **Play** — play the song.
- **Pause / Resume** — pause live playback, or resume from a paused state.
- **Skip** — skip the current song.
- **End** — graceful stop that waits for the current song to finish before stopping.
- **Abort** — hard stop that cuts playback instantly, without finishing the song.

In **kiosk mode** (public LAN display), **End** and **Abort** are hidden so
visitors cannot stop the show. Skip and Play/Pause remain available.

### Queue

When you **Queue** a song, it appears in the **Queue** list. Each entry shows
the song title; click the **×** to remove a pending request (`deleterequest`).

Queued songs play at the **next sequence boundary** — after the current song
finishes — unless you used **Play** instead.

### Filters and sorting

Below the controls, narrow the song grid:

- **Filter by Playlist** — show only songs that belong to a chosen
  [playlist](./playlists.md), or **All** for the full jukebox catalog.
- **Filter by tags** — filters available songs by song tags.
- **Search** — match title or artist.
- **Sort by** — artist or title.

### Song cards

Each card shows artwork (or a music-note placeholder), title, artist, and
vendor. Two actions:

| Button    | Behavior                                                                                                      |
| --------- | ------------------------------------------------------------------------------------------------------------- |
| **Play**  | Start the song **immediately**. May interrupt or overlay the current sequence depending on schedule priority. |
| **Queue** | Add the song to the interactive queue. Plays at the next sequence boundary.                                   |

On the **web / LAN UI**, a speaker icon in the
header toggles a live **audio stream** — useful for listening over the network
when you are not at the show PC.

## Which songs appear

A song must be **playable** before it can show up on the jukebox:

1. Not deleted.
2. Has a real `.fseq` file (not waiting for cloud download).
3. `render_enabled` is not `false`.

Beyond that, **jukebox tag rules** decide which playable songs are offered. These
rules (excluded and included tags) are configured in **Settings → Jukebox** and
apply equally to the jukebox screen, the built-in viewer-control catalog, and
Remote Falcon integration — see [Jukebox settings](../settings/jukebox.md) and
[Viewer Control](../advanced/viewer-control.md).

The quickest way to hide a sequence is to add the `nojukebox` tag on the
[Songs](./songs.md) screen.

## Jukebox vs schedule vs playlists

|                    | Jukebox                            | Schedule                                   |
| ------------------ | ---------------------------------- | ------------------------------------------ |
| **Plays**          | Individual songs on demand         | [Playlists](./playlists.md) on a timetable |
| **Trigger**        | You or a viewer click Play/Queue   | Clock enters a scheduled window            |
| **After the song** | Schedule resumes if it was running | Continues through the playlist (or loops)  |

## Kiosk mode

When the LAN UI runs in **kiosk mode** (default port 3001), several management
screens are hidden (Songs, Playlists, Schedule, Settings, Cloud). The jukebox
and Player screens stay available for public use.

Stop controls (**End**, **Abort**) are disabled on the jukebox in kiosk mode so
guests cannot shut down the show.
