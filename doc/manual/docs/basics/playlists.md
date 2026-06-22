---
sidebar_position: 5
title: Playlists
---

# Playlists

A **playlist** is an ordered list of [songs](./songs.md). Playlists sit between
your song library and the [schedule](./simple-schedules.md): you group sequences
into sets like "Christmas Favorites" or "Weeknight Show," then attach those sets
to date and time windows.

If you already have songs imported, building playlists is the next step toward
an automated show. See
[Getting Started (Local)](./getting-started-local.md#4-schedule-the-show) for the
full flow.

## What makes up a playlist

Each playlist is stored as a **playlist record** in your show folder:

| Field | Purpose |
| --- | --- |
| **id** | Unique identifier (assigned when you create the playlist) |
| **title** | Display name shown in the Playlists screen and schedule editor |
| **tags** | Labels for organizing and filtering playlists (separate from song tags) |
| **items** | Ordered list of song IDs, each with a sequence position |
| **createdAt** / **updatedAt** | Timestamps for when the playlist was created and last saved |

Each item in `items` references a song by its `id`. The `sequence` number is
the play order (1, 2, 3, …). When EZPlayer plays a playlist, it walks those items
from first to last unless a schedule entry overrides behavior with **shuffle**
or **loop** — see [Complex Schedules](../advanced/complex-schedules/overview.md).

**Duration** shown in the UI is the sum of each song's total time, including
per-song [lead and trail time](./songs.md#lead-time-and-trail-time). That gives
you a rough length for planning schedule windows; actual runtime can differ when
shuffle, loop, or end policies are in play.

## The Playlists screen

![Playlists](/img/playlists.png)

Open **Playlists** from the main navigation. The table shows:

- **Playlist** name
- **Tags** on the playlist
- **Duration** — total linear play time
- **Songs count** — number of entries in the playlist

Use **Search By Playlist Title** and **Filter by tags** to find playlists in a
large library.

**Double-click** a row to open the editor. Action buttons on each row:

- **Edit** — open the create/edit screen
- **Clone** — duplicate the playlist (EZPlayer names the copy
  `OriginalTitle-1`, `OriginalTitle-2`, and so on)
- **Delete** — soft-delete after confirmation

Click **Create Playlist** to start a new one.

## Creating and editing a playlist

The create/edit screen has two panels:

### Left: Songs List

Every **playable** song in your library — same filter as the Songs screen
(not deleted, has an FSEQ file, not cloud-disabled). Use search, tag filters,
and sort by title or artist to find what you need.

- Click **+** on a song to add it to the playlist.
- **Add All** adds every song that matches your current filters and is not
  already in the playlist.
- **Drag** a song from this panel into the playlist on the right.

Songs already in the playlist are marked and cannot be added again from this
panel. The editor keeps **one entry per song** — you cannot place the same
sequence twice through the UI.

### Right: Playlist

The ordered list of songs that will play when this playlist runs.

- **Drag** songs to reorder.
- **Drag** a song back to the left panel, or click remove, to take it out.
- **Sort** by title or artist (A–Z or Z–A).
- **Shuffle** randomizes the current order in the editor (this only changes the
  saved playlist order; it is separate from schedule-level shuffle at runtime).

At the top, set:

- **Playlist Name** (required)
- **Tags** (optional — type new tags or pick from existing playlist tags)

Click **Save Playlist** when done. A playlist must have a **name** and at least
**one song** before you can save.

Use **Discard** to return to the list. If you have unsaved changes, EZPlayer
warns you before navigating away or closing the browser tab.

## Playlist tags vs song tags

Playlists and songs each have their own tags:

- **Song tags** — control jukebox visibility and help filter songs while building
  playlists. See [Jukebox settings](../settings/jukebox.md).
- **Playlist tags** — organize your playlist library and filter the Playlists
  screen. They do not affect which songs appear in the editor's Songs List.

Tag names are independent. A playlist tagged `holiday` can contain songs tagged
`christmas` or `winter`.

## Deleting a playlist

Deletion is a **soft delete**: the record is marked `deleted` in storage and
removed from the UI. Existing **schedule entries** that reference the deleted
playlist will show a validation error until you pick a different playlist or
remove the schedule entry.

Deleting a playlist does **not** delete the songs in it.

## Where playlists are stored

Playlist data lives in your show folder at:

```
.ezplayer/playlists.json
```

Changes you make in EZPlayer (or via the LAN UI / HTTP API) are written there
immediately. When the playback engine reloads show data, it picks up the latest
playlists without requiring a restart.

If a playlist references a song ID that no longer exists (for example after a
song was deleted), EZPlayer logs a validation warning. Remove the missing entry
by editing the playlist or restore the song.

## How playlists are used at runtime

### Schedules

This is the primary way playlists run. On the **Schedule** screen you attach a
playlist to a time window as:

- **Main playlist** — the core set of songs for that window
- **Intro playlist** (optional) — plays once at the start
- **Outro playlist** (optional) — plays as the window winds down

When the window opens, EZPlayer plays the intro (if any), then the main playlist
in order, then handles the outro according to the schedule's end policy. See
[Simple Schedules](./simple-schedules.md) and
[Complex Schedules](../advanced/complex-schedules/overview.md) for recurrence,
loop, shuffle, priority, and end-policy behavior.

### Live edits

Schedule entries read from `playlists.json` on refresh. If you edit a playlist
while the show is running, unrelated changes are reconciled **without
interrupting the current song**. Changes to a playlist that is actively playing
may not reshuffle what is already in progress until the next natural boundary.

### Jukebox

The jukebox plays **individual songs**, not whole playlists. Use playlists for
scheduled and automated show flow; use the jukebox for one-off requests.

### HTTP API

External tools can read and update playlists via `GET /api/current-show` and
`POST /api/playlists`. The player command `playplaylist` exists in the API
schema for requesting on-demand playlist playback; scheduled and jukebox flows
are the main interactive paths today. See the
[REST Interface](../reference/api.md).

## Cloud-managed playlists

When EZPlayer is registered with **EZRGB Cloud**, playlists can be delivered or
updated from the cloud alongside sequences. Cloud-arrived playlists merge into
your local `playlists.json` through the same path as edits from the UI.

For cloud registration and content sync, see
[Getting Started (Cloud)](./getting-started-cloud.md).

## Desktop app vs LAN UI

Unlike song file management, **playlist create, edit, clone, and delete** are
available in both the desktop app and the LAN UI. You can build or adjust a
playlist from a phone or laptop on the same network without sitting at the show
PC.

Song **files** still need to be added on the desktop app — the playlist editor
only picks from songs already in your library.

## Practical workflow

A typical playlist build:

1. **Import songs** on the [Songs](./songs.md) screen.
2. **Create playlists** — group songs by theme, night, or venue section.
3. **Tag playlists** — for example `weeknight`, `weekend`, `static`.
4. **Check duration** — use the Duration column to size schedule windows.
5. **Schedule** — assign intro, main, and outro playlists on the Schedule
   screen.
6. **Test** — run a short schedule window or step through songs on the jukebox
   before opening night.

## Related pages

- [Songs](./songs.md) — importing and configuring sequences
- [Simple Schedules](./simple-schedules.md) — attaching playlists to time windows
- [Complex Schedules](../advanced/complex-schedules/overview.md) — loop, shuffle,
  priority, and end policies
- [Getting Started (Local)](./getting-started-local.md) — end-to-end local setup
- [REST Interface](../reference/api.md) — `POST /api/playlists` and show state API
- [Show Folder](../settings/show-folder.md) — where playlist data is stored
