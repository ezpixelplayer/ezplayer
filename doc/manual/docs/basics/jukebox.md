---
sidebar_position: 4
title: Jukebox
---

# Jukebox

The **jukebox** is EZPlayer's on-demand playback screen. While the
[schedule](./simple-schedules.md) runs your show on autopilot, the jukebox lets
you (or your guests) pick individual [songs](./songs.md) to play right now or
queue for later.

Use it to test sequences before opening night, fill gaps between scheduled
windows, or offer a simple song-picker at a public display.

![Play on jukebox](/img/jukebox.png)

## The Jukebox screen

At the top of the screen:

### Playback controls

- **Play / Pause / Resume** — pause live playback, or resume from a paused state.
  When fully stopped, **Play** reloads the schedule (`resetplayback`).
- **Skip** — end the current song and advance (`endsong`).
- **End** — graceful stop: finish the current song, then stop (`stopgraceful`).
- **Abort** — hard stop: cut immediately (`stopnow`).

In **kiosk mode** (public LAN display), **End** and **Abort** are hidden so
visitors cannot stop the show. Skip and Play/Pause remain available.

### Queue

When you **Queue** a song, it appears in the **Queue** list. Each entry shows
the song title; click the **×** to remove a pending request (`deleterequest`).

Queued songs play at the **next sequence boundary** — after the current song
finishes — unless you used **Play** instead (see below).

### Filters and sorting

Below the controls, narrow the song grid:

- **Filter by Playlist** — show only songs that belong to a chosen
  [playlist](./playlists.md), or **All** for the full jukebox catalog.
- **Filter by tags** — temporary screen filter by song tags (independent of the
  global jukebox tag rules in Settings).
- **Search** — match title or artist.
- **Sort by** — artist or title.

### Song cards

Each card shows artwork (or a music-note placeholder), title, artist, and
vendor. Two actions:

| Button    | Behavior                                                                                                                                          |
| --------- | ------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Play**  | Start the song **immediately** (`playsong` with `immediate: true`). May interrupt or overlay the current sequence depending on schedule priority. |
| **Queue** | Add the song to the interactive queue (`playsong` with `immediate: false`). Plays at the next sequence boundary.                                  |

On the **web / LAN UI** (not the desktop Electron app), a speaker icon in the
header toggles a live **audio stream** — useful for listening over the network
when you are not at the show PC.

## Fullscreen jukebox (`/jukebox`)

The fullscreen route shows a simplified **carousel** UI: large artwork, title,
artist, and **⬅ / ▶ Play / ➡** buttons to browse and play one song at a time.

After **30 seconds** of inactivity, a screensaver logo appears. Touch or click
anywhere to dismiss it and return to the carousel. This layout works well on a
tablet mounted near the sidewalk or in a lobby.

## Which songs appear

A song must be **playable** before it can show up on the jukebox:

1. Not deleted.
2. Has a real `.fseq` file (not waiting for cloud download).
3. `render_enabled` is not `false`.

On top of that, **jukebox tag rules** (configured in Settings) decide which
playable songs are offered:

- **Excluded tags** — songs with any of these tags are always hidden. The tag
  `nojukebox` is excluded by default.
- **Included tags** — when empty, all playable songs are allowed (except
  excluded). When set, only songs matching **at least one** included tag appear.

Tag matching is **case-insensitive**. The same rules apply to the built-in
viewer-control catalog and Remote Falcon integration — see
[Jukebox settings](../settings/jukebox.md) and
[Viewer Control](../advanced/viewer-control.md).

To hide a sequence from the jukebox, add the `nojukebox` tag on the
[Songs](./songs.md) screen (or any tag listed under Excluded Tags in Settings).

## What happens when you play a song

The jukebox sends a `playsong` command to the playback engine. Two modes matter:

### Play (immediate)

The song is marked **immediate** and starts after a short prefetch delay
(about half a second). Audio may overlap with what is already playing. If a
scheduled playlist is running, the schedule is **suspended** while the jukebox
song plays, then **resumes** where it left off (or continues the loop) when the
jukebox song ends.

This is the right choice when you want a request to cut in now.

### Queue (next boundary)

The song joins the **interactive queue** and plays when the current sequence
reaches its natural end. Multiple queued songs play in order, then the
schedule resumes.

This is the polite choice during a live show when you do not want to interrupt
the song that is already playing.

### Priority

Jukebox requests use priority **5** (lower number = higher priority in the
command schema). Viewer-control and API requests can use other priorities to
resolve conflicts — see the [REST Interface](../reference/api.md).

## Jukebox vs schedule vs playlists

|                    | Jukebox                            | Schedule                                   |
| ------------------ | ---------------------------------- | ------------------------------------------ |
| **Plays**          | Individual songs on demand         | [Playlists](./playlists.md) on a timetable |
| **Trigger**        | You or a viewer click Play/Queue   | Clock enters a scheduled window            |
| **After the song** | Schedule resumes if it was running | Continues through the playlist (or loops)  |

The jukebox **Filter by Playlist** dropdown only narrows what you see on screen.
It does not play a whole playlist — use the schedule for that.

## Kiosk mode

When the LAN UI runs in **kiosk mode** (default port 3001), several management
screens are hidden (Songs, Playlists, Schedule, Settings, Cloud). The jukebox
and Player screens stay available for public use.

Stop controls (**End**, **Abort**) are disabled on the jukebox in kiosk mode so
guests cannot shut down the show.

## Configuring the jukebox catalog

Open **Settings → Jukebox** to set global excluded and included tags. Changes
save to your show folder (`playbackSettings.json`) and apply immediately to the
jukebox screen, viewer-control catalog, and playback worker.

For the full settings reference, see [Jukebox settings](../settings/jukebox.md).

## HTTP API

External tools can request songs the same way the jukebox does:

```json
{
    "command": "playsong",
    "songId": "your-song-id",
    "immediate": true,
    "priority": 5,
    "requestId": "unique-request-id"
}
```

Use `deleterequest` with the same `requestId` to cancel a queued item, or
`clearrequests` to empty the queue. See
[REST Interface](../reference/api.md) for all player commands.

## Practical tips

1. **Tag aggressively** — use `nojukebox` on sequences that are not ready for
   public picking (work in progress, licensing restrictions, effects-only
   sequences).
2. **Test with Play** — verify timing and audio before you open the schedule.
3. **Use Queue during a live show** — avoid hard-cutting a scheduled song unless
   you intend to.
4. **Filter by playlist** — during a themed night, limit the grid to that
   night's playlist so guests only see relevant songs.
5. **Fullscreen for kiosks** — point a tablet at `/jukebox` for a touch-friendly
   picker without the full app chrome.
