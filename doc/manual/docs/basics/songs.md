---
sidebar_position: 3
title: Songs
---

# Songs

In EZPlayer, a **song** is a playable **sequence** — the pairing of a light
show file (`.fseq`) with metadata (title, artist, tags, etc.) and optional audio and artwork. Songs are the
building blocks for everything else: [playlists](./playlists.md),
[schedules](./simple-schedules.md), the [jukebox](./jukebox.md), and remote
control.

## What makes up a song

Each song is stored in your show folder. At a high level it contains:

| Part         | Purpose                                                                            |
| ------------ | ---------------------------------------------------------------------------------- |
| **Work**     | Details: title, artist, duration, optional artwork URL, tags                       |
| **Files**    | Paths to the `.fseq` sequence, optional `.mp3` audio, and optional thumbnail image |
| **Sequence** | Vendor or source info                                                              |
| **Settings** | Per-song playback tweaks: lead time, trail time, volume adjustment                 |

The `.fseq` file is required for playback. EZPlayer reads frame timing from it
and drives your controllers from that data. Audio is optional for silent
animation sequences, but musical songs should include a
matching `.mp3`.

Duration is normally taken from the file header. When you add or replace a sequence file, EZPlayer updates the stored
length automatically.

## The Songs screen

![Add a Song](/img/add-song.png)

![List of songs](/img/songs.png)

Open **Songs** from the main navigation to see every playable sequence in your
show. The table shows:

- **Title** and **artist** (vendor name appears in parentheses when set)
- **Tags** assigned to the song
- **Duration** in `minutes:seconds.milliseconds` format

Use the search box to filter by title or artist. Use **Filter by Tags** to
narrow the list — handy when you have a large library.

**Double-click** a row (or click the edit icon) to open **Edit Song Details**.
From the desktop app you can also click **Add Song** to register a new sequence.

### Desktop app vs LAN UI

| Capability                         | Desktop app | LAN / embedded UI |
| ---------------------------------- | ----------- | ----------------- |
| View song list                     | Yes         | Yes               |
| Add songs                          | Yes         | No                |
| Edit metadata and settings         | Yes         | No                |
| Replace FSEQ / audio / image files | Yes         | No                |
| Delete songs                       | Yes         | Yes               |

The LAN UI is meant for monitoring and light control from phones and tablets on
your network. Full song management stays on the show PC, where the files are stored.

## Adding a song (local show)

1. Open **Songs** and click **Add Song**.
2. Select a **`.fseq` file** (required). This is the sequence EZPlayer will
   play to your lights.
3. Optionally select a **`.mp3` file** for audio and an **image** for the
   jukebox and song list.
4. Fill in **title** and **artist** (required).
5. Adjust optional fields — vendor, tags, lead/trail time, volume adjustment —
   then click **Save**.

### Automatic file matching

On the desktop app, choosing an FSEQ file triggers **auto-detect**:

1. EZPlayer reads the FSEQ header for duration and any embedded audio filename.
2. It searches the show folder for a matching audio file (by header name, then
   by matching basename, then by prefix). The supported audio type is `.mp3`.
3. It looks for a matching image next to the audio or FSEQ file (`.jpg`,
   `.png`, `.gif`, `.webp`, and others), or tries to extract one from the audio file.
4. If the audio file has ID3 tags, title and artist are filled in when those
   fields are still empty. Album art from the tags can become the thumbnail.

If auto-detect does not find everything, pick the remaining files manually.
Selecting a different MP3 re-reads ID3 metadata and refreshes title, artist, and
artwork.

You can also supply an **image URL** instead of (or in addition to) a local
image file. Using a URL for the image will work as long as it can be reached.

### Tips for xLights users

Point EZPlayer at the same **show folder** you use in xLights. Sequences and
audio often already live side by side with matching names, so a single FSEQ
selection is usually enough. If you render new sequences, add them on the Songs
screen (or let the cloud sync deliver them — see below).

## Editing a song

Open **Edit Song Details** for any song in the list. You can change:

- **Title, artist, and vendor**
- **FSEQ, MP3, and image files** (desktop app only — use _Select another file_)
- **Image URL** for artwork shown in the jukebox
- **Lead time**, **trail time**, and **volume adjustment**
- **Tags**

Changes are saved to your show folder and picked up by the playback
engine on the next data refresh. If a song is currently playing, unrelated edits
do not interrupt it.

### Lead time and trail time

These settings fine-tune how long a song occupies the schedule timeline and when
the next song may start. Values are in **seconds**, from **-5.0** to **5.0**.

- **Positive lead time** — extra time _before_ the sequence content starts (for
  example a few seconds of silence before the audio starts).
- **Negative lead time** — _trim_ the beginning of the scheduled window (start
  partway into the sequence).
- **Positive trail time** — extra time _after_ the sequence content ends.
- **Negative trail time** — _trim_ the end of the scheduled window (end before
  the FSEQ finishes), useful if there is too much dead time in the audio.

The scheduler uses these values when calculating playlist length, schedule
windows, and sequence boundaries. They are most useful when the gap between songs is uneven.

### Volume adjustment

EZPlayer recommends normalizing your show audio. However, if the audio level seems
to vary from one song to the next, per-song volume adjustment is available.
**Volume adjustment** ranges from **-100** to **+100**. The value is
saved on each song record so you can balance sequences that were mastered at
different levels. Show-wide loudness is controlled separately — see
[Volume](../advanced/volume.md) for the default level and time-based overrides.

### Tags

Tags are free-form labels on each song (for example `christmas`, `high-energy`,
`animation`, or `nojukebox`). They appear in the Songs table and drive jukebox filtering —
see [Jukebox settings](../settings/jukebox.md).

When you type a new tag while adding or editing a song, it is added to the
global tag list so you can reuse it on other songs. (Consistency helps.)

## Deleting a song

Click the delete icon and confirm. The record is
marked `deleted` and removed from every playlist that referenced it.
However, deletion is a **soft delete**: files are not removed.

Deleted songs no longer appear in the jukebox, playlist builder, or schedule
picker. If you need the sequence again, add it back as a new song.

## Which songs are “playable”

Not every record in `sequences.json` appears in the Songs list. A sequence is
**playable** only when all of the following are true:

1. It is **not deleted**.
2. **`render_enabled` is not `false`** — cloud-side suspensions hide a sequence
   without removing it from your account.
3. It has a real **`.fseq` file path** — sequences waiting for cloud download
   or render do not show up until the file is installed.

The same rule applies everywhere songs are offered: the Songs screen, jukebox,
playlist editor, and scheduler all use this filter.

## Cloud-delivered songs

When EZPlayer is registered with **EZRGB Cloud**, sequences can arrive from the
cloud instead of (or in addition to) manual adds. The cloud worker downloads
FSEQ, audio, and thumbnail files into your show folder and updates
your song list.

While a granted sequence is still rendering or disabled, EZPlayer keeps a
placeholder record so the Cloud screen can show progress, but the song will not
appear in the Songs list until the FSEQ file is ready.

See [Getting Started (Cloud)](./getting-started-cloud.md) and
[Getting Sequences from EZRGB](../cloud/getting-sequences.md) for the cloud
workflow.

## How songs are used at runtime

Once registered, a song can be played in several ways:

### Playlists and schedules

Add songs to [playlists](./playlists.md), then attach those playlists to
[schedule](./simple-schedules.md) entries. During a scheduled window EZPlayer
walks the playlist in order (or shuffled/looped if configured).

### Jukebox

The [jukebox](./jukebox.md) shows playable songs that pass your tag filters.
Choosing a song sends a `playsong` command. By default it plays **immediately**
(interrupting or overlaying depending on schedule priority). Tag rules are
configured under [Settings → Jukebox](../settings/jukebox.md); the default
excluded tag `nojukebox` is always enforced.

### Viewer control integrations

Viewer-control integrations such as Remote
Falcon and EZVC use the same song IDs. See
[Viewer Control](../advanced/viewer-control.md) for details.

## Next steps

- Play your song from the [Jukebox](../basics/jukebox.md), and watch the [Preview](../basics/preview.md)
- Add songs to [Playlists](../basics/playlists.md), and [Schedules](../basics/simple-schedules.md) so they play automatically
