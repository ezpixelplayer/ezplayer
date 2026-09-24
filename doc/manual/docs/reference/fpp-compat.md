---
sidebar_position: 4
title: FPP-Compatible API
---

# FPP-Compatible API

EZPlayer emulates the subset of the [FPP (Falcon Player)](https://github.com/FalconChristmas/fpp)
HTTP API that integrators actually use — status polling, playback commands,
playlist and schedule management, and file transfer — **on the same paths a
real FPP serves them**, on EZPlayer's normal web port (default `3000`). Tools
and services built against FPP (music-sync services, remote-management
dashboards) can usually be pointed at an EZPlayer with only a host/port
change.

Field names **and JSON types** mirror FPP exactly where tools are known to
depend on them (e.g. `seconds_elapsed` is a *string*, `milliseconds_elapsed`
an *int*). Endpoints not listed here return **404**, exactly like an FPP that
doesn't have the feature — write endpoints are never stubbed with a fake
success.

## Identity & status

| Method | Path                 | Notes |
| ------ | -------------------- | ----- |
| GET    | `/api/system/status` | Full FPP status JSON: `status`/`status_name` (0 idle, 1 playing, 2 stopping gracefully, 5 paused), `current_playlist{playlist,type,index,count}`, `current_sequence`, `current_song`, `seconds_played/elapsed/remaining` (strings), `milliseconds_elapsed` (int), `time_elapsed/remaining` (`MM:SS`), `repeat_mode`, `next_playlist`, `scheduler`, `volume`, the clock strings (`time`, `timeStr`, `timeStrFull`, `dateStr`, in FPP's default formats), the uptime breakdown (`uptime*`, `systemUptimeTotalSeconds`), `media_playing`, `warningInfo`, and `global_pause`. Field types follow FPP exactly, including its own inconsistency in `repeat_mode` (the string `"0"` when idle, a number while playing), and its wording `"No playlist scheduled."` when the schedule is empty |
| GET    | `/api/fppd/status`   | Same payload |
| GET    | `/api/system/info`   | `Platform: "EZPlayer"`, `Version: "8.0-EZPlayer-<version>"`, `majorVersion: 8`, `Mode: "player"`, persistent `uuid`, `IPs`, host OS name/release, and `Utilization` with memory, uptime and disk free/total for the show folder and the player's own drive |
| GET    | `/api/fppd/version`  | `{version, majorVersion, minorVersion, branch, fppdAPI: "v1", Status, Message, respCode}` — FPP sends the version numbers as *strings* on this endpoint (they are numbers in `/api/system/info`) |
| GET    | `/api/plugin`        | `[]` (probed by some discovery flows) |
| GET    | `/api/proxies`       | FPP 8+ proxy list `[{host, description}]` — the controllers EZPlayer can proxy to (see [System inventory](#system-inventory)) |
| GET    | `/api/time`          | `{time}`, formatted like FPP's `%a %b %d %H:%M:%S %Z %Y` in local time (e.g. `Sun Sep 20 07:31:17 EDT 2026`) |

## Player

What is playing, in FPP's player terms (`Player::GetStatusJSON`,
`Playlist::GetInfo`). FPP plays one playlist at a time, so `playlists` holds
exactly one entry, the idle placeholder when nothing is playing.

| Method | Path | Notes |
| ------ | ---- | ----- |
| GET    | `/api/player`, `/api/player/status` | `{playlists: [{name, desc, currentState, currentEntry, size, repeat, …, details, status, scheduled, position, startTime, stopTime, priority}]}`. `details` is the running playlist's config with each entry's run state; `currentEntry` carries `secondsElapsed`, `millisecondsElapsed` and `secondsRemaining` |
| GET    | `/api/player/current` | `{playlist: {…the same info, without details…}}` |
| GET    | `/api/fppd/playlists` | `{playlists: [name]}` while playing, `[]` when idle |
| GET    | `/api/fppd/playlist/config` | the running playlist's config (as in `details` above); only the status fields when idle |

`currentState` uses FPP's names: `idle`, `playing`, `stoppingGracefully`,
`paused`. A song started on its own reports as a one-entry playlist named
after the song.

EZPlayer identifies itself honestly (`Platform`/`Variant`/`branch` say
EZPlayer) while keeping the shape FPP-parseable. The `uuid` persists in
`.ezplayer/fpp-compat.json`.

## Playback commands

| Method | Path | Notes |
| ------ | ---- | ----- |
| GET    | `/api/command/{Name}[/{args...}]` | URL-encoded command name + args as path segments |
| POST   | `/api/command` | body `{"command": "...", "args": [...]}` |
| POST   | `/api/command/{Name}` | body = JSON array of args |
| GET    | `/api/commands` / `/api/commands/{Name}` | descriptors for the supported set, in FPP's format: `{name, category, level, description, args[]}` with FPP's own argument names, types and defaults (clients pass arguments positionally) |
| GET    | `/api/playlist/{Name}/start[/{Repeat}[/{SchedProtected}]]` | convenience |
| GET    | `/api/playlists/stop` `stopgracefully` `stopgracefullyafterloop` `pause` `resume` | convenience |

| GET    | `/api/system/volume` | read: `{status, method, volume}`. `POST` is answered **500 with a reason** (FPP accepts it): EZPlayer volume is settings/schedule-driven, so a one-shot override would be reverted at the next schedule change |

Between a graceful stop and the player going idle, the status reads
`status: 2` / `stopping gracefully`, as FPP's does: it plays on to the next
convenient point.

Supported commands and their EZPlayer semantics:

| FPP command | EZPlayer behavior |
| ----------- | ----------------- |
| `Start Playlist {name} {repeat} {ifNotRunning} {scheduleProtected}` | Starts the playlist (title match, case-insensitive) or — like FPP — a bare sequence name/fseq. `repeat` loops until stopped. With `ifNotRunning` set, nothing happens if something is already playing. `scheduleProtected` is accepted and ignored: EZPlayer has no schedule-override flag. |
| `Insert Playlist Immediate {name} {startItem} {endItem} {ifNotRunning}` | Starts the playlist now. The item range is ignored (it always plays from item 1 to the end, noted in the response); `ifNotRunning` as above. |
| `Start Playlist At Item {name} {item} {repeat} {ifNotRunning} {scheduleProtected}` | As above; the item argument is ignored (playback starts at item 1). |
| `Stop Now` | Immediate stop |
| `Stop Gracefully [true]` | Graceful stop (the after-loop variant behaves the same) |
| `Pause Playlist` / `Resume Playlist` | Pause / resume |
| `Next Playlist Item` | Skip to next item |
| `Prev Playlist Item` | **Not supported** (500) |
| `All Lights Off` | Maps to an immediate stop |

## Playlists

| Method | Path | Notes |
| ------ | ---- | ----- |
| GET    | `/api/playlists` | array of playlist names |
| GET    | `/api/playlists/playable` | playlist names + registered `*.fseq` file names |
| GET    | `/api/playlist/{Name}` | FPP playlist JSON (v4 shape with `playlistInfo`) |
| POST   | `/api/playlist/{Name}` | create/update from FPP playlist JSON; answers with the stored playlist (`name`, `mainPlaylist`, `playlistInfo`, `version`) as FPP does, plus EZPlayer's `Status`/`Message` and any `Warnings` |
| POST   | `/api/playlists` | create (object body with `name`) |
| DELETE | `/api/playlist/{Name}` | delete |

EZPlayer playlists are ordered lists of sequences, so the FPP format maps with
**documented lossy rules** (warnings are returned in `Message`):

- `leadIn` + `mainPlaylist` + `leadOut` flatten into one list (EZPlayer models
  pre/post shows at the schedule level).
- `sequence`/`both` entries resolve to registered sequences by fseq basename
  or title (case-insensitive, extension optional). If the name isn't
  registered but the `.fseq` file exists in the show folder (e.g. it was just
  uploaded via the file API), a sequence record is **auto-registered**.
- Audio-only `media` entries and `pause` entries are skipped.
- Nested `playlist` entries are rejected (400).
- `repeat`/`loopCount` are not stored — pass repeat to `Start Playlist` or set
  loop on a schedule.

## Schedule

| Method | Path | Notes |
| ------ | ---- | ----- |
| GET    | `/api/schedule` | FPP schedule entry array |
| POST   | `/api/schedule` | **full replace** from an FPP entry array |
| POST   | `/api/schedule/reload` | 200 no-op — EZPlayer applies schedule changes live |
| GET    | `/api/fppd/schedule` | The scheduler as it is running, not the stored file: `schedule.entries` (the rules, with FPP's `dayStr`/`stopTypeStr` and integer dates) and `schedule.items` (occurrences due within `scheduleDistance` days, as the `Start Playlist` commands FPP would run) |

Mapping: `playlist` matches by title; `startTime`/`endTime` →
`fromTime`/`toTime`; `repeat` → loop; `stopType` 0/1/2 → graceful / hard cut /
graceful-after-loop end policies; `day` codes (0–6 single day, 7 everyday,
8 weekdays, 9 weekend, 10 M/W/F, 11 Tu/Th, 12 Sun–Thu, 13 Fri/Sat, `0x10000`
bitmask) map to recurrence rules. Odd/even day-of-month (14/15) is not
supported (skipped with a warning).

EZPlayer materializes recurring schedules into dated occurrences, bounded to
**~13 months ahead**; a `POST /api/schedule` with a farther end date succeeds
with a warning and can simply be re-POSTed later to extend. `GET` collapses
each materialized series back into a single FPP entry.

## Files

The [file-management API](./api.md#file-management-fpp-shaped) is FPP-shaped
end to end, including `sizeBytes` being a *string* in `GET /api/files/{dir}`,
as current FPP reports it: listings (`GET /api/files/{dir}`), downloads
(`GET /api/file/{dir}/{name}`, `?play=1` to stream), raw-body uploads
(single-shot POST and chunked POST+PATCH with `Upload-Name`/`Upload-Offset`/
`Upload-Length` headers), deletes, `GET /api/media`, and
`GET|POST /api/sequence/{name}`.

`GET /api/media/{name}/meta` answers the part of FPP's ffprobe dump EZPlayer
can give without decoding media: a `format` block with the file, its size, and
its duration when a sequence record knows it. `streams` is left out rather
than faked. `GET /api/media/{name}/duration` returns
`{"<name>": {"duration": seconds}}` for audio belonging to a registered
sequence, and 404s otherwise.

`GET /api/sequence/{name}/meta` returns the sequence header summary FPP's
`fsequtils -j` prints: `Name`, `Version`, `ID`, `StepTime`, `NumFrames`,
`MaxChannel`, `ChannelCount`, any `variableHeaders`, and for v2 files the
sparse `Ranges` (when present), `CompressionType` and
`CompressionTypeString`.

## MultiSync (master)

EZPlayer can act as an FPP MultiSync **master**: enable it under
Settings → Player → Sync Output (or via playback settings,
`sync: { multisync: { enabled, remotes } }`) and it sends the standard sync
UDP packets (port 32320) that FPP and xSchedule remotes follow — sequence
OPEN/START on begin, SYNC frames every ~16 frames (every frame for the first
few so remotes lock on fast), and STOP on end/pause/idle. `remotes` is a list
of `host[:port]`; an empty list broadcasts to the FPP multicast group
239.70.80.80 (port and multicast address are overridable under Advanced).
Media sync packets are not sent (audio plays on the master), and EZPlayer
does not act as a sync *remote*. Default is **off** — sync-master is a
topology decision; exactly one master should exist on a network.

The packets carry FPP's own `SYNC_PKT_*` action codes (`src/MultiSync.h`):
START 0, STOP 1, SYNC 2, OPEN 3 — not the order the flow suggests.
`multisync-live.test.ts` checks this against a real FPP in remote mode.

## System inventory

`GET /api/fppd/multiSyncSystems` serves the FPP systems roster from
EZPlayer's controller-discovery state: one entry for EZPlayer itself
(type `EZPlayer`, typeId `0xee`) plus every device the scans identified
as a real FPP or another EZPlayer. Each entry carries FPP's full system
record — `address`, `hostname`, `HostDescription`, `type`/`typeId`, `model`,
`version`/`majorVersion`/`minorVersion`, `fppMode`/`fppModeString`,
`capeInfo`, `channelInputsEnabled`/`channelOutputsEnabled`, `channelRanges`,
`lastSeen`/`lastSeenStr`, `local`, `multiSyncCapable`, `multisync`, `uuid` —
with `lastSeen` taken from when discovery last saw that device.
`channelRanges` is empty for the same reason as in `/api/system/info`:
EZPlayer drives outputs from the show rather than publishing a channel map.

Other controller families are omitted — they don't speak the FPP systems
protocol, and tools discover them directly.
Combined with `GET /api/proxies`, this lets xLights' FPP discovery crawl
through an EZPlayer to everything behind it.

## Checked against a real FPP

`fpp-compat-live.test.ts` runs one scripted session — upload, create a
playlist, read the inventory, play, pause, resume, stop gracefully, stop —
against EZPlayer and a real FPP from the same code, and compares the
transcripts: same HTTP status, same response structure, and the same values
where they should agree (names, counts, sizes, states, command signatures).

Differences live in that test's `DIVERGENCES` table with a reason, and an
entry that stops matching fails the run, so the list cannot go stale.

## Not implemented (404)

MultiSync remote mode, GPIO, effects, scripts, plugin management, system
control (reboot/shutdown/update), and channel output configuration. OSC and
Art-Net timecode are not part of this API at all — FPP has no OSC support
either, so they are tracked as their own project.

Two things answer rather than 404 — the only deliberate behavioural
differences from FPP:

- **Volume writes** (`POST /api/system/volume`, the `Volume *` commands) are
  declined with **500 and a reason**.
- **Media metadata** (`GET /api/media/{name}/meta`) answers a subset, rather
  than faking codec detail.

Some read-only fields have no EZPlayer counterpart and are absent from
otherwise FPP-shaped payloads: `sensors` and `streamSlots` on the status.

EZPlayer's own API lives entirely under [`/api/ezp/*`](./api.md), so the two
surfaces cannot collide.
