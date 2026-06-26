---
sidebar_position: 5
title: Playlists
---

# Playlists

A **playlist** is an ordered list of [songs](./songs.md). Playlists sit between
your song library and the [schedule](./simple-schedules.md): you group sequences
into sets like "Christmas Favorites" or "Weeknight Show," then attach those sets
to date and time windows.

In addition to scheduling, there are a few other uses for playlists, such as
intro/outro and making a list of songs that viewers may select, but the concept
is the same.

![Playlists](/img/playlists.png)

Open **Playlists** from the main navigation bar. The table shows:

- **Playlist** name
- **Tags** on the playlist
- **Duration** — total linear play time
- **Songs count** — number of entries in the playlist

Use **Search By Playlist Title** and **Filter by tags** to find playlists in a
large library.

**Double-click** a row to open the editor. Action buttons on each row:

- **Edit** — open the create/edit screen
- **Clone** — duplicate the playlist
- **Delete** — soft-delete after confirmation

Click the **Create Playlist** button in the upper corner to start a new one.

## Creating and editing a playlist

![Create Playlist](/img/create-playlist.png)

The create/edit screen has two panels:

### Left: Songs List

Every **playable** song in your library — same filter as the Songs screen
(not deleted, has an FSEQ file, not cloud-disabled). Use search, tag filters,
and sort by title or artist to find what you need.

- Click **->** on a song to add it to the playlist.
- **Add All** adds every song that matches your current filters and is not
  already in the playlist.
- **Drag** a song from this panel into the playlist on the right.

Songs already in the playlist are shaded.

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

## Deleting a playlist

Deletion is a **soft delete**: the record is marked `deleted` in storage and
removed from the UI. Existing **schedule entries** that reference the deleted
playlist will show a validation error until you pick a different playlist or
remove the schedule entry.

Deleting a playlist does **not** delete the songs in it.

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

## Cloud-managed playlists

When EZPlayer is registered with **EZRGB Cloud**, playlists can be delivered or
updated from the cloud alongside sequences.  Cloud-managed playlists are merged into
your local playlists.

For cloud registration and content sync, see
[Getting Started (Cloud)](./getting-started-cloud.md).

## Desktop app vs LAN UI

**Playlist create, edit, clone, and delete** are
available in both the desktop app and the [LAN UI](./local-web-interface.md). You
can build or adjust a playlist from a phone or laptop on the same network without
sitting at the show PC.

Song **files** currently still need to be added on the desktop app — the playlist editor
only picks from songs already in your library.
