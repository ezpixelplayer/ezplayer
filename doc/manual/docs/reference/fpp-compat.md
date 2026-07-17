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
| GET    | `/api/system/status` | Full FPP status JSON: `status`/`status_name` (0 idle, 1 playing, 2 stopping gracefully, 5 paused), `current_playlist{playlist,type,index,count}`, `current_sequence`, `current_song`, `seconds_played/elapsed/remaining` (strings), `milliseconds_elapsed` (int), `time_elapsed/remaining` (`MM:SS`), `repeat_mode`, `next_playlist`, `scheduler`, `volume` |
| GET    | `/api/fppd/status`   | Same payload |
| GET    | `/api/system/info`   | `Platform: "EZPlayer"`, `Version: "8.0-EZPlayer-<version>"`, `majorVersion: 8`, `Mode: "player"`, persistent `uuid`, `IPs` |
| GET    | `/api/fppd/version`  | `{version, majorVersion, minorVersion, branch, fppdAPI: 4, Status: "OK"}` |
| GET    | `/api/plugin`        | `[]` (probed by some discovery flows) |

EZPlayer identifies itself honestly (`Platform`/`Variant`/`branch` say
EZPlayer) while keeping the shape FPP-parseable. The `uuid` persists in
`.ezplayer/fpp-compat.json`.

## Playback commands

| Method | Path | Notes |
| ------ | ---- | ----- |
| GET    | `/api/command/{Name}[/{args...}]` | URL-encoded command name + args as path segments |
| POST   | `/api/command` | body `{"command": "...", "args": [...]}` |
| POST   | `/api/command/{Name}` | body = JSON array of args |
| GET    | `/api/commands` / `/api/commands/{Name}` | descriptors for the supported set |
| GET    | `/api/playlist/{Name}/start[/{Repeat}[/{SchedProtected}]]` | convenience |
| GET    | `/api/playlists/stop` `stopgracefully` `stopgracefullyafterloop` `pause` `resume` | convenience |
| GET    | `/api/system/volume` | read-only: `{status, volume}` (volume writes are settings/schedule-driven) |

Supported commands and their EZPlayer semantics:

| FPP command | EZPlayer behavior |
| ----------- | ----------------- |
| `Start Playlist {name} {repeat} {startItem}` | Starts the playlist (title match, case-insensitive) or — like FPP — a bare sequence name/fseq. `repeat` loops until stopped. `startItem` is ignored (always starts at item 1, noted in the response). |
| `Start Playlist At Item` | As above; the item argument is ignored. |
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
| POST   | `/api/playlist/{Name}` | create/update from FPP playlist JSON |
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
| GET    | `/api/fppd/schedule` | `{schedule: [...], Status: "OK"}` |

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
end to end: listings (`GET /api/files/{dir}`), downloads
(`GET /api/file/{dir}/{name}`, `?play=1` to stream), raw-body uploads
(single-shot POST and chunked POST+PATCH with `Upload-Name`/`Upload-Offset`/
`Upload-Length` headers), deletes, `GET /api/media`, and
`GET|POST /api/sequence/{name}`.

## Not implemented (404)

MultiSync, OSC/Art-Net timecode output (planned follow-on), GPIO, effects,
scripts, plugin management, system control (reboot/shutdown/update), volume
writes (`POST /api/system/volume`, the `Volume *` commands — EZPlayer volume
is settings/schedule-driven), channel output configuration, and
`/api/media/{name}/meta`. EZPlayer's own API lives entirely under
[`/api/ezp/*`](./api.md), so the two surfaces cannot collide.
