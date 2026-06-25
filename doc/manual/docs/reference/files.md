---
sidebar_position: 2
title: Files Reference
---

# Files Reference

EZPlayer keeps all of a show's data **in the show folder** — the same folder you
open in xLights. There is no hidden per-user database; everything is on disk
next to your sequences, which makes shows easy to back up, version, and move
between machines.

The show folder has two zones:

- **The folder root** — files xLights and your media tools own (layout, network
  config, `.fseq` sequences, audio, thumbnails).
- **`.ezplayer/`** — a subdirectory holding EZPlayer's own state as JSON
  (your song catalog, playlists, schedule, and settings).

```
<show folder>/
  xlights_rgbeffects.xml      # layout / models (required)
  xlights_networks.xml        # controller network config (required)
  *.fseq, *.mp3, ...          # sequence and audio media (referenced relatively)
  .ezplayer-folder.lock       # single-instance lock (see below)
  .ezplayer/
    sequences.json            # the song catalog
    playlists.json            # playlists
    schedule.json             # scheduled (and background) playlists
    playbackSettings.json     # volume, viewer control, jukebox, audio sync, blend
    playbackSettingsCloudMeta.json  # cloud last-write-wins stamps (sidecar)
    cloud-config.json         # cloud connection + polling config
    cloud/                    # cloud download staging + install ledger
      installed-files.json
```

## The `.ezplayer/` files

All of EZPlayer's JSON lives under `.ezplayer/`. The content files share a common
envelope — the records are wrapped in a `data` object — while the settings files
are stored as a plain object.

## Where songs are stored

Song files (.fseq and .mp3) should be stored directly in the show folder.

Song catalog data lives in your show folder at:

```
.ezplayer/sequences.json
```

File paths inside each record are stored **relative to the show folder** (for
example `sequences/MySong.fseq`). When EZPlayer loads the folder it resolves
those paths to absolute locations on disk.

If a stored duration looks wrong (for example left over from an old import),
EZPlayer re-reads the FSEQ header on load and corrects it.

### `sequences.json`

The song catalog. Envelope: `{ "data": { "allSongs": SequenceRecord[] } }`,
pretty-printed with 4-space indentation.

```json
{
    "data": {
        "allSongs": [
            {
                "instanceId": "…",
                "id": "seq-123",
                "work": { "title": "…", "artist": "…", "length": 212.4 },
                "files": {
                    "fseq": "Christmas/song.fseq",
                    "audio": "Christmas/song.mp3",
                    "thumb": "Christmas/song.png"
                },
                "updatedAt": 1704067200000,
                "deleted": false
            }
        ]
    }
}
```

Notes:

- **Media paths in `files` are stored relative to the show folder** (for example
  `Christmas/song.fseq`). EZPlayer resolves them to absolute paths on load and
  re-relativizes on save, so the folder stays portable.
- A record may also carry `render_enabled` (user-suspended, hidden like
  `deleted` but reversible), and `cloud` / `source_kind` / `source_id` metadata
  on cloud- or vendor-sourced sequences.

### `playlists.json`

Ordered lists of songs. Envelope:
`{ "data": { "playlists": PlaylistRecord[] } }`, 4-space indentation.

Each `PlaylistRecord` has `id`, `title`, `tags`, an ordered `items` array
(each `{ id, sequence }` referencing a song), and `createdAt` / `updatedAt`.
Deletes are **soft** (`deleted: true`). See the
[`POST /api/playlists`](./api.md) body for the full field list.

### `schedule.json`

Scheduled (and background) playlists. Envelope:
`{ "data": { "scheduledPlaylists": ScheduledPlaylist[] } }`, 4-space indentation.

Each `ScheduledPlaylist` ties a `playlistId` (plus optional `prePlaylistId` /
`postPlaylistId`) to a `date` + `fromTime` / `toTime` window, and carries the
runtime knobs documented under
[Complex Schedules](../advanced/complex-schedules/overview.md): `scheduleType`
(`main` | `background`), `priority`, `loop`, `shuffle`, `endPolicy`,
`recurrenceRule`, and so on. See the [`POST /api/schedules`](./api.md) body for
the full field list.

### `playbackSettings.json`

Volume, viewer control, jukebox tags, audio sync, and background blend mode.
Unlike the content files, this is a **plain `PlaybackSettings` object** (no `data`
envelope), pretty-printed with 2-space indentation:

```json
{
    "audioSyncAdjust": 0,
    "backgroundSequence": "overlay",
    "viewerControl": { "enabled": false, "type": "disabled", "schedule": [] },
    "volumeControl": { "defaultVolume": 100, "schedule": [] },
    "jukebox": { "excludedTags": ["nojukebox"], "includedTags": [] }
}
```

This is the same shape as the [`POST /api/playback-settings`](./api.md) body. A
missing or empty file falls back to these defaults.

### `playbackSettingsCloudMeta.json`

A small sidecar to `playbackSettings.json` used only when the show is
cloud-managed. It records the epoch-ms stamp of the cloud value each settings
group has adopted (`playback`, `volume`, `viewerControl`) so cloud→player
updates apply last-write-wins without clobbering a newer local edit. You should
not need to touch it.

### `cloud-config.json`

The folder's cloud connection and polling configuration (`CloudConfig`), 2-space
indentation:

- `cloudServiceUrl`, `playerIdToken` — endpoint and player identity (empty
  strings mean "not configured").
- `layoutSource` — `'xlights'` (you manage the layout files) or `'cloud'` (the
  cloud worker downloads them into the folder root). Absent is treated as
  `'xlights'`.
- `cloudEnabled`, `cloudPollMode` (`'always'` | `'scheduled'`),
  `cloudPollSchedule`, `cloudPollIntervals` — worker activity and cadence.
- `layoutMeta` — last-downloaded layout file ids/times, for staleness checks.

A folder is treated as cloud-managed only when this file exists and sets
`layoutSource: "cloud"`.

### `cloud/`

A staging area the cloud content worker uses while downloading sequences and
layout (`cloud/<sequence>/`, `cloud/layout/`), plus `cloud/installed-files.json`
— a ledger of which cloud files are currently installed in the folder so the
worker can detect stale bytes and clean up. This directory is managed entirely
by EZPlayer.

## Reading these files

Reading the JSON directly is fine and supported — it is how external tools can
inspect a show.

- **Expect missing files.** On a fresh folder, any of these may not exist yet;
  EZPlayer itself treats a missing (or empty) file as "no data" rather than an
  error. Your reader should do the same.
- **Writes are atomic, so you get whole files.** EZPlayer writes by staging to a
  temp file, flushing it, and renaming it over the target. A reader therefore
  sees either the complete old file or the complete new one — never a
  half-written or zero-byte file.
- **Retry on a transient failure.** Because a save swaps the file underneath
  you, a read that races a write can still fail occasionally — a brief
  `ENOENT`/sharing error on Windows during the rename, or a parse error if you
  caught a momentary gap. Retry a few times with a short backoff (e.g. 25ms,
  50ms, 100ms) before giving up.
- **Ignore temp files.** You may briefly see `.<name>.<pid>.<random>.tmp` files
  in `.ezplayer/` during a write. Don't read them; they are removed on success.

## Writing these files

**Do not write these files while EZPlayer is running.** EZPlayer holds the show
state in memory and writes it back on change, so anything you edit on disk under
a running player will be silently overwritten — and a concurrent write from your
side can clobber EZPlayer's. The folder is single-instance locked (see below),
which is the contract: one writer at a time.

- **Offline edits** — only edit `.ezplayer/` files directly when you are certain
  EZPlayer is **not running** on that folder.
- **Live changes** — to change a running show, call the HTTP API instead of
  touching the files. It updates the in-memory state and persists it through the
  same atomic path:
    - `POST /api/playlists` — replace playlists
    - `POST /api/schedules` — replace the schedule
    - `POST /api/playback-settings` — update volume / viewer control / jukebox / audio sync / blend
    - `POST /api/player-command` — transport and request control (play, stop, queue, volume, …)

    See the [REST Interface (HTTP API)](./api.md) for the full surface.

## The folder lock

When EZPlayer opens a show folder it creates and locks
`.ezplayer-folder.lock` at the folder root. This enforces a single active
instance per folder: a second EZPlayer (or another writer) that finds the lock
held will refuse to open the folder. The lock auto-expires a few seconds after
its owner exits, so a crash does not leave the folder permanently locked.

## First run

The `.ezplayer/` subdirectory is created automatically the first time EZPlayer
opens a folder.

:::note Runtime state is not stored here
Live status — what is playing, controller health, statistics, version numbers —
is computed at runtime and pushed over the API/WebSocket. It is **not** persisted
to the show folder, so there is no status file to read on disk.
:::

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
