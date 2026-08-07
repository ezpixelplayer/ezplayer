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

**Double-click** a row (or click the edit icon) to open **Edit Song Details**,
or click **Add Song** to register a new sequence. The **play** button on a row
starts that song immediately, the same as pressing **Play** in the jukebox.

### Desktop app vs LAN / cloud UI

| Capability                         | Desktop app        | LAN / cloud UI                 |
| ---------------------------------- | ------------------ | ------------------------------ |
| View song list                     | Yes                | Yes                            |
| Add songs                          | Yes                | Yes                            |
| Bulk import many `.fseq` files     | Yes                | Yes                            |
| Edit metadata and settings         | Yes                | Yes                            |
| Replace FSEQ / audio / image files | Yes (local picker) | Yes (upload or choose on player) |
| Delete songs                       | Yes                | Yes                            |

The desktop app picks files with native dialogs. The LAN and cloud UIs either
**upload** a file from the browser's machine or **choose** one already in the
player's show folder; uploads over the cloud show a progress bar. The
kiosk page has no song management.

## Adding a song (local show)

1. Open **Songs** and click **Add Song**.
2. Select a **`.fseq` file** (required). This is the sequence EZPlayer will
   play to your lights.
3. Optionally select a **`.mp3` file** for audio and an **image** for the
   jukebox and song list.
4. Fill in **title** and **artist** (required). The form will not save until
   both are set — you will see validation messages on empty required fields.
5. Adjust optional fields — vendor, tags, lead/trail time, volume adjustment —
   then click **Save**.

### Automatic file matching

Choosing an FSEQ file triggers **auto-detect** (over the network, this runs
on the player after the upload or selection):

1. EZPlayer reads the FSEQ header for duration, any embedded audio filename,
   and (when present) title/artist metadata stored in the sequence.
2. It searches for a matching audio file — first next to the FSEQ, then in the
   optional [Media Folder](../settings/show-folder.md#media-folder), then in
   the show folder (by header name, then by matching basename, then by
   prefix). The supported audio type is `.mp3` (and related formats such as
   `.wav`, `.m4a`, `.flac`, and `.ogg` where available).
3. It looks for a matching image next to the audio or FSEQ file (`.jpg`,
   `.png`, `.gif`, `.webp`, and others), or tries to extract one from the audio file.
4. If the audio file has ID3 tags, title and artist are filled in when those
   fields are still empty. Album art from the tags can become the thumbnail.
   FSEQ header title/artist are used as a fallback when tags are missing.

If auto-detect does not find everything, pick the remaining files manually.
Selecting a different MP3 re-reads ID3 metadata and refreshes title, artist, and
artwork.

You can also supply an **image URL** instead of (or in addition to) a local
image file. Using a URL for the image will work as long as it can be reached.

### Tips for xLights users

Point EZPlayer at the same **show folder** you use in xLights. Sequences and
audio often already live side by side with matching names, so a single FSEQ
selection is usually enough. If your MP3s live in a separate render or media
directory, set that path as the [Media Folder](../settings/show-folder.md#media-folder)
so auto-detect and bulk import can find them. If you render new sequences, add
them on the Songs screen (or let the cloud sync deliver them — see below), or
use [Bulk import](#bulk-import) to bring in many at once.

## Bulk import

Use **Bulk Import** on the Songs screen when you need to register many
sequences at once instead of adding them one by one.

1. Open **Songs** and click **Bulk Import**.
2. Choose either:
   - **Select .fseq files…** — pick one or more `.fseq` files, or
   - **Select folder…** — pick a folder; every `.fseq` under it is considered.
3. Wait for the **Bulk Import Summary** dialog. It lists each successful import
   (file name, title, artist) and each failure with a reason.

### Desktop app

Native file and folder dialogs open on the show PC. EZPlayer searches for
companion audio next to each FSEQ and in the configured Media Folder.

### LAN / cloud UI

The browser picks files (or a folder) and uploads them to the player in a
**single request**, then runs the same import logic on the player. Include the
matching MP3 (and optional images) in the same selection when they are not
already available via the Media Folder.

### Rules (desktop and LAN)

Bulk import is stricter than single **Add Song** about audio:

| Rule | Behavior |
| ---- | -------- |
| Companion audio required | Each FSEQ must resolve to a matching audio file, or that file fails with **Audio file not found**. |
| Exact basename match | Audio is matched by exact name (from the FSEQ header or the FSEQ basename), not a loose prefix match. |
| Media Folder | Searched after the FSEQ’s own folder (desktop) or as the shared media location (LAN). |
| One failure does not stop the rest | Other sequences in the same batch still import. |
| Title / artist | Taken from audio tags when present; otherwise from FSEQ metadata; otherwise the FSEQ basename and **Unknown Artist**. |

Failed imports leave that sequence out of the catalog. Fix the missing audio
(or Media Folder path), then run Bulk Import again for those files.

When one or more failures are **Audio file not found**, the Bulk Import Summary
dialog shows a tip to choose a Media Folder:

1. Click **Choose Media Folder**.
   - **Desktop app:** a native folder picker opens on this PC; the path is saved
     as the Media Folder setting.
   - **LAN UI:** a folder picker opens **in this browser**. Matching audio files
     are uploaded to the player (you do not need to use the player PC).
2. EZPlayer then **automatically retries** only the sequences that failed for
   missing audio.

You can also set a permanent Media Folder path anytime under
[Settings → Show Folder](../settings/show-folder.md#media-folder) in the desktop
app. On the LAN UI, use **Choose Media Folder** in the Bulk Import Summary when
audio is missing.

## Editing a song

Open **Edit Song Details** for any song in the list. You can change:

- **Title, artist, and vendor** (title and artist remain required — empty
  values show validation errors and block save)
- **FSEQ, MP3, and image files** (desktop: _Select another file_; network:
  upload or choose a file on the player)
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

- Import many sequences at once with [Bulk Import](#bulk-import), or set a
  [Media Folder](../settings/show-folder.md#media-folder) for companion audio
- Play your song from the [Jukebox](../basics/jukebox.md), and watch the [Preview](../basics/preview.md)
- Add songs to [Playlists](../basics/playlists.md), and [Schedules](../basics/simple-schedules.md) so they play automatically
