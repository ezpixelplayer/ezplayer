---
sidebar_position: 3
sidebar_label: REST Interface (HTTP API)
title: REST Interface (HTTP API)
---

# EZPlayer API Documentation

## Koa Server REST APIs

:::note
The REST API is subject to change. Currently used internally, could be used externally if you don't mind churn.
The goal is to finalize the shape and provide backward compatibility after the 1.0 release.
:::

### GET /api/ezp/hello

Health check endpoint. Simple endpoint to verify the server is running.

**Request:**

- Method: GET
- Headers: None required

**Response:**

- Status: 200 OK
- Body:

```json
{
    "message": "Hello from Koa + Electron!"
}
```

---

### GET /api/ezp/current-show

Get current show data. Returns the complete current show state, including sequences, playlists, schedules, user info, and status.

**Request:**

- Method: GET
- Headers: None required

**Response:**

- Status: 200 OK
- Body: the cached broadcast state — the same keys the WebSocket `snapshot`
  carries for the show itself

```json
{
  "showFolder": "/path/to/show",
  "sequences": [...],
  "playlists": [...],
  "schedule": [...],
  "pStatus": {...},
  "cStatus": {...},
  "nStatus": {...}
}
```

The three status objects are absent until their workers have reported once,
so a freshly started player answers with the arrays and `showFolder` alone.
The other `FullPlayerState` keys (settings, cloud, controller ops) come from
the WebSocket snapshot or their own endpoints.

---

### GET /api/ezp/getimage/:sequenceId

Get sequence thumbnail image. Serves thumbnail images for sequences by sequence ID. Supports multiple image formats (PNG, JPG, JPEG, GIF, WEBP, SVG, ICO, BMP).

**Request:**

- Method: GET
- Path Parameters:
    - `sequenceId` (string, required) - Sequence identifier (alphanumeric, hyphens, underscores only)
- Query form: `GET /api/ezp/getimage?id=<sequenceId>` is also accepted

**Response:**

- Status: 200 OK - Image file with appropriate MIME type
- Status: 400 Bad Request - Invalid or missing sequence ID
- Status: 404 Not Found - Image not found for sequence ID

**Example:**

```
GET /api/ezp/getimage/seq-123-abc
```

**Error Response (400):**

```json
{
    "error": "Invalid sequence ID"
}
```

**Error Response (404):**

```json
{
    "error": "Image not found for sequence ID"
}
```

---

### GET /api/ezp/playback-stats

Get the playback engine's statistics — the counters behind the Status screen's
statistics dialog and the `EZPlayer play` / `EZPlayer stats` commands. The
playback worker publishes a fresh set about once a second.

**Request:**

- Method: GET
- Headers: None required

**Response:**

- Status: 200 OK
- Body:

```json
{
  "stats": {
    "iteration": 1234,
    "sentFramesCumulative": 1351,
    "skippedFramesCumulative": 76,
    "missedFramesCumulative": 0,
    "worstLagHistorical": 4.9,
    "avgSendTime": 12.7,
    "maxSendTimeHistorical": 59.6,
    "measurementPeriod": 1000,
    "idleTimePeriod": 480,
    "sendTimePeriod": 510,
    "loopDelay": { "p50": 2.1, "p99": 18.3, "max": 23.0 },
    "sequenceDecompress": { "fileReadTimeCumulative": 1870, "decompressTimeCumulative": 1390 },
    "fseqPrefetch": { "totalMem": 1400000000, "headerCache": { "...": "..." }, "chunkCache": { "...": "..." } },
    "...": "..."
  },
  "pStatus": { "status": "Playing", "now_playing": { "...": "..." } },
  "serverNow": 1787496621562
}
```

`stats` is a `PlaybackStatistics` object (see `@ezplayer/ezplayer-core`).
Counters ending in `Cumulative` grow until a `resetstats` player command;
`*Period` values cover the last measurement period; `*Historical` values are
maxima since the last reset. `loopDelay` is the playback thread's event-loop
delay over the period — high values mean the loop is hogged by synchronous work
(typically sending many thousands of packets per frame), which delays the FSEQ
prefetch's completions and inflates the read/decompress times.

- Status: 503 Service Unavailable — the playback worker has not reported yet (still starting).

---

### POST /api/ezp/player-command

Send player command. Sends a command to control player playback, volume, or request playback of songs/playlists.

**Request:**

- Method: POST
- Headers:
    - Content-Type: application/json
- Body: EZPlayerCommand object

**Available Commands:**

| Command             | Description                                                                          | Additional Fields                                  |
| ------------------- | ------------------------------------------------------------------------------------ | -------------------------------------------------- |
| `stopnow`           | Stop all playing immediately                                                         |                                                    |
| `stopgraceful`      | Stop all playing at a convenient spot                                                |                                                    |
| `pause`             | Pause all playback                                                                   |                                                    |
| `resume`            | Resume playback                                                                      |                                                    |
| `reloadcontrollers` | Reset playback from current show folder, reloading network and reopening controllers |                                                    |
| `resetplayback`     | Reread and reset playback from current schedule items                                |                                                    |
| `resetstats`        | Reset cumulative stats counters                                                      |                                                    |
| `suppressoutput`    | Continue playback (timing, preview, statistics) but send nothing to the controllers  |                                                    |
| `activateoutput`    | Re-enable controller output                                                          |                                                    |
| `playsong`          | Play or enqueue a song                                                               | `songId`, `immediate`, `priority`, `requestId`     |
| `playplaylist`      | Play or enqueue a playlist                                                           | `playlistId`, `immediate`, `priority`, `requestId` |
| `deleterequest`     | Cancel a pending song or playlist request                                            | `requestId`                                        |
| `clearrequests`     | Clear all pending requests                                                           |                                                    |
| `endsong`           | End the current song (skip to the next item)                                         | `songId?` (only skip if this song is playing)      |
| `setvolume`         | Set the default volume (persisted) and/or mute (live); see the note below            | `volume?`, `mute?`                                 |
| `setbrightness`     | Set the default output brightness and/or color temperature (persisted); see below   | `brightness?`, `colorTemperature?`                |

**Request Body Examples:**

Stop playback immediately:

```json
{
    "command": "stopnow"
}
```

Play a song immediately:

```json
{
    "command": "playsong",
    "songId": "seq-123",
    "immediate": true,
    "priority": 1,
    "requestId": "req-456"
}
```

Play a playlist:

```json
{
    "command": "playplaylist",
    "playlistId": "playlist-1",
    "immediate": true,
    "priority": 1,
    "requestId": "req-789"
}
```

Set volume:

```json
{
    "command": "setvolume",
    "volume": 75,
    "mute": false
}
```

Volume in EZPlayer is automated: the player ramps toward the **default
volume**, or toward the **scheduled volume window** in effect (see
[Volume](../advanced/volume.md)). A one-shot live level would be ramped
straight back, so `volume` here sets the default volume instead, for every
output, and persists it in playback settings. If no window is in effect the
player ramps to the new level within about a second. If a window is in
effect the default is still written, but the window keeps the level until it
ends; the response says which (`defaultInEffect`, and a `warning` naming the
window). `mute` is live and takes effect at once either way. Per-output
defaults and the windows themselves are managed through
[`/api/ezp/volume`](#get-apiezpvolume).

`setbrightness` works the same way for the lights: `brightness` (0–100) and
`colorTemperature` (kelvin, 2000–12000, 6500 neutral) write the **defaults**
in `brightnessControl`, the player ramps to them within about a second unless
a scheduled brightness window is in effect, and the response carries the same
`defaultInEffect` and `warning` fields plus the
[`/api/ezp/brightness`](#get-apiezpbrightness) overview as `brightness`.

```json
{
    "success": true,
    "message": "Command sent",
    "defaultInEffect": false,
    "warning": "A scheduled volume window is in effect (System default: 20:00-22:00 at 40%); the default applies when it ends",
    "volume": { "mode": "default", "targets": [{ "id": "default", "label": "System default", "defaultVolume": 75, "level": 40, "activeWindow": { "startTime": "20:00", "endTime": "22:00", "volumeLevel": 40, "days": "all", "id": "w1" }, "schedule": [] }] }
}
```

**Response:**

- Status: 200 OK - Command sent successfully
- Status: 400 Bad Request - Invalid command format (or `setvolume` with a non-numeric `volume`)
- Status: 503 Service Unavailable - Playback worker not available (or `setvolume` before settings have loaded)
- Status: 500 Internal Server Error - Server error

**Success Response:**

```json
{
    "success": true,
    "message": "Command sent"
}
```

**Error Response (400):**

```json
{
    "error": "Invalid command format"
}
```

**Error Response (503):**

```json
{
    "error": "Playback worker not available"
}
```

---

### POST /api/ezp/playlists

Update playlists. Accepts an array of playlist records. Updates `updatedAt` timestamp automatically.

**Request:**

- Method: POST
- Headers:
    - Content-Type: application/json
- Body: Array of PlaylistRecord objects

**Request Body Example:**

```json
[
    {
        "id": "playlist-1",
        "title": "Christmas Songs",
        "tags": ["holiday", "christmas"],
        "items": [
            {
                "id": "seq-1",
                "sequence": 0
            },
            {
                "id": "seq-2",
                "sequence": 1
            }
        ],
        "createdAt": 1609459200000
    }
]
```

**Response:**

- Status: 200 OK - Playlists updated successfully
- Status: 400 Bad Request - Invalid format (expected array)
- Status: 500 Internal Server Error - Server error

**Success Response:**

```json
{
  "success": true,
  "playlists": [
    {
      "id": "playlist-1",
      "title": "Christmas Songs",
      "tags": ["holiday", "christmas"],
      "items": [...],
      "createdAt": 1609459200000,
      "updatedAt": 1704067200000
    }
  ]
}
```

Note: The response includes only non-deleted playlists (`deleted !== true`).

---

### POST /api/ezp/schedules

Update schedules. Accepts an array of scheduled playlist records. Updates `updatedAt` timestamp automatically.

**Request:**

- Method: POST
- Headers:
    - Content-Type: application/json
- Body: Array of ScheduledPlaylist objects

**Request Body Example:**

```json
[
    {
        "id": "schedule-1",
        "playlistId": "playlist-1",
        "title": "Evening Show",
        "date": 1704067200000,
        "fromTime": "18:00",
        "toTime": "22:00",
        "playlistTitle": "Christmas Songs",
        "duration": 14400,
        "priority": "normal"
    }
]
```

**Response:**

- Status: 200 OK - Schedules updated successfully
- Status: 400 Bad Request - Invalid format (expected array)
- Status: 500 Internal Server Error - Server error

**Success Response:**

```json
{
    "success": true,
    "schedules": [
        {
            "id": "schedule-1",
            "playlistId": "playlist-1",
            "title": "Evening Show",
            "date": 1704067200000,
            "fromTime": "18:00",
            "toTime": "22:00",
            "playlistTitle": "Christmas Songs",
            "duration": 14400,
            "priority": "normal",
            "updatedAt": 1704067200000
        }
    ]
}
```

Note: The response includes only non-deleted schedules (`deleted !== true`).

---

### File management (FPP-shaped)

Remote file operations on the show folder. Paths and response shapes follow the
[FPP](https://github.com/FalconChristmas/fpp) file API so FPP-ecosystem tools
work unchanged. Every logical directory maps to the show folder root with an
extension filter. Uploads and deletes act on the root. Reads by name
(downloads, `/api/sequence/:name`, `/api/media/:name/…`) look in the root,
then at the file a registered song plays (which may be in a show subfolder or
the media folder), then in the media folder, then in show subfolders
(skipping hidden folders and `Backup`). Listings show the root's files plus
the files registered songs play elsewhere.

| `:dirName`  | Contents                                              |
| ----------- | ----------------------------------------------------- |
| `sequences` | `*.fseq`                                              |
| `music`     | `*.mp3 *.m4a *.aac *.wav *.ogg *.flac *.wma *.mp4`    |
| `videos`    | `*.mp4 *.mkv *.avi *.mov *.mpg *.mpeg`                |
| `images`    | `*.gif *.jpg *.jpeg *.png *.webp *.bmp`               |
| `uploads`   | everything (minus protected/dot files)                |

| Method   | Path                        | Purpose                                                                                      |
| -------- | --------------------------- | -------------------------------------------------------------------------------------------- |
| `GET`    | `/api/files/:dirName`       | List: `{status:"ok", files:[{name,mtime,sizeBytes,sizeHuman,playtimeSeconds}]}`; `?nameOnly=1` returns a plain name array |
| `GET`    | `/api/file/:dirName/:name`  | Download (attachment); `?play=1` streams inline with a media content type                     |
| `POST`   | `/api/file/:dirName/:name`  | Single-shot upload, file bytes as the raw request body. Answers `{status:"OK", file, dir, written, size, offset}`, with the byte counts as strings, as FPP does |
| `POST`   | `/api/file/:dirName`        | Chunked-upload init; returns an id (plain text)                                               |
| `PATCH`  | `/api/file/:dirName`        | Upload one chunk; headers `Upload-Name`, `Upload-Offset`, `Upload-Length` (raw body = chunk)  |
| `DELETE` | `/api/file/:dirName/:name`  | Delete a file; answers `{status:"OK", file, dir}`                                             |
| `GET`    | `/api/media`                | Music + video file names (array)                                                              |
| `GET`    | `/api/sequence`             | Sequence base names, no `.fseq` extension (array)                                             |
| `GET`    | `/api/sequence/:name`       | Download `<name>.fseq`                                                                        |
| `POST`   | `/api/sequence/:name`       | Upload `<name>.fseq` (raw body) → `{"Status":"OK","Message":""}`                              |
| `GET`    | `/api/sequence/:name/meta`  | FSEQ header summary, as FPP's `fsequtils -j` prints it (see [FPP-compat](./fpp-compat.md#files)) |
| `GET`    | `/api/media/:name/meta`     | The part of FPP's ffprobe dump EZPlayer can answer truthfully: a `format` block with the file, its size, and its duration when a sequence record knows it |
| `GET`    | `/api/media/:name/duration` | `{"<name>": {"duration": seconds}}` for audio belonging to a registered sequence; `404` otherwise |

Uploads are **raw request bodies** (not multipart). Chunked uploads assemble in
`.ezplayer/tmp-uploads/` and move into place atomically on completion, so a
file never appears half-written. Upload size cap: 2 GB by default
(`EZPLAYER_MAX_UPLOAD_MB` overrides).

Safety: names must be plain basenames (no subdirectories, no traversal, no
dotfiles); `xlights_rgbeffects.xml`, `xlights_networks.xml`, and everything
under `.ezplayer/` cannot be modified or deleted through this API. These
routes are served on the main web port only — the kiosk port has no file
API.

---

### Network scan API (`/api/ezp/scan`)

Discover lighting controllers on the network — the HTTP face of the same engine
behind the [`discover` CLI verb](./cli.md#discover). Powers web/cloud discovery
UIs, and is the endpoint one EZPlayer calls on another to federate a scan (the
CLI's `--ezp-proxy`).

These routes are served on the **main web port only, never the kiosk port** — a
scan actively probes the LAN, so it is not exposed on the public jukebox
surface. Only run discovery on networks you are authorized to scan.

#### GET /api/ezp/scan/interfaces

List this host's external IPv4 networks — the CIDRs you can feed to a discover
request. Internal and link-local (`169.254.x.x`) addresses are excluded.

```json
{
  "interfaces": [
    { "name": "eth0", "address": "192.168.25.11", "network": "192.168.25.0/24" },
    { "name": "wlan0", "address": "192.168.11.123", "network": "192.168.11.0/24" }
  ]
}
```

#### POST /api/ezp/scan/discover

Run a discovery and return the full result. Body (all fields optional):

| Field               | Type                        | Default      | Meaning                                                        |
| ------------------- | --------------------------- | ------------ | -------------------------------------------------------------- |
| `networks`          | `[{ "cidr": "…" }]`         | host's own   | Networks to scan. **Omit to scan this host's own networks** — which is what a federated scan wants. |
| `depth`             | `"sweep"｜"identify"｜"full"` | `"identify"` | `sweep` = liveness (IP/MAC/OUI/protocols); `identify` = + driver-confirmed vendor/model/firmware; `full` = + per-device detail tree. |
| `recurseFppProxies` | `boolean`                   | `false`      | Recurse one level through FPP proxies (identify/full only).    |

There is intentionally **no `recurseEzpProxies`** here: a federated scan must
not chain onward, so EZPlayer federation stays strictly one level.

```bash
# Scan two subnets, confirm models, follow FPP proxies
curl -X POST http://player.local:3000/api/ezp/scan/discover \
  -H 'Content-Type: application/json' \
  -d '{"networks":[{"cidr":"192.168.1.0/24"}],"depth":"identify","recurseFppProxies":true}'

# Ask a remote EZPlayer to discover on its own networks (federation)
curl -X POST http://other-player.local:3000/api/ezp/scan/discover -d '{"depth":"full"}'
```

The response is a `DiscoveryResult`:

```json
{
  "request": { "networks": [{ "cidr": "192.168.1.0/24" }], "depth": "identify" },
  "devices": [
    {
      "ip": "192.168.1.58",
      "source": { "via": "direct" },
      "mac": "b8:27:eb:…", "oui": "Raspberry Pi",
      "driverType": "FPP", "vendor": "FPP", "model": "WB1616", "firmwareVersion": "pre-7"
    }
  ],
  "startedAt": "2026-06-28T15:00:00.000Z",
  "finishedAt": "2026-06-28T15:00:12.000Z"
}
```

Each device's `source` records provenance: `{ "via": "direct" }`,
`{ "via": "fpp-proxy", "proxy": "<ip>" }`, or `{ "via": "ezp", "host": "<ip>" }`.
For `depth: "full"`, devices also carry a `report` and a generic `detail` tree.

#### GET /api/ezp/scan/discover

Convenience form of the POST for quick checks — parameters as query string:
`?networks=192.168.1.0/24,10.0.0.0/24&depth=full&fppProxy=1`. Same result shape.

Concurrent scans are limited (currently two at once, and an identical scan of
the same networks/depth is rejected while one is running); a request over the
limit returns `409`. A bad `depth` or no scannable network returns `400`, and a
network disallowed by [policy](#post-apiezpcontrollerscommand) returns `403`.

---

### Controller management API (`/api/ezp/controllers`)

The HTTP face of the controllers screen: the reconcile state (xLights ∪
EZPlayer records vs. the live scan) and the same command dispatcher every UI
uses. Like the scan API, it is served on the **main web port only** — never the
public kiosk surface.

#### GET /api/ezp/controllers

The full controller-ops state in one snapshot:

```json
{
  "interfaces":      [ { "name": "Ethernet 2", "address": "…", "network": "…" } ],
  "devices":         { "<ip>|direct": { "id": "…", "ip": "…", "driverType": "Falcon", "…": "…" } },
  "operations":      { "op_…": { "kind": "status", "status": "done", "…": "…" } },
  "known":           [ { "name": "Mega Tree", "address": "…", "ports": [], "…": "…" } ],
  "networkPolicies": [ { "cidr": "192.168.1.0/24", "allow": false } ],
  "contentDist":     { "run": { "…": "…" }, "lastReport": { "…": "…" }, "queued": [], "autoHold": "idle" }
}
```

`devices` is keyed by `"<ip>|<via>"` — that key is the `id` that `status`,
`action`, and `upload` commands target.

#### GET /api/ezp/controllers/:id

One device by its state key (URL-encode the `|`, e.g.
`/api/ezp/controllers/192.168.11.61%7Cdirect`) or by bare IP. `404` if unknown.

#### POST /api/ezp/controllers/command

The generic command endpoint — the body is one `ControllerCommand`, identical
to what the desktop/LAN/cloud UIs issue. One endpoint covers every verb:

| `cmd`               | Purpose                                                            |
| ------------------- | ------------------------------------------------------------------ |
| `scan`              | Discover controllers (same options as `/api/ezp/scan/discover`); returns the scan result. |
| `status`            | Deep-read one controller: `{ "cmd": "status", "id": "<ip>\|direct", "address": "<ip>" }`. `address` lets it work with no prior scan. |
| `action`            | Run a driver action: `{ "cmd": "action", "id": "…", "action": "reboot" }`. Action ids are driver-enumerated (see each device's `actions`). |
| `upload`            | Push xLights config: `{ "cmd": "upload", "id": "…", "scope": "inputs"\|"strings"\|"full", "fullControl": true\|false }`. `fullControl` is optional; left out, the controller's [port settings](../advanced/controllers/controllerlist.md#port-settings) choice decides what happens to settings xLights doesn't specify. |
| `distribute`        | Send show content to the devices that hold their own copy: `{ "cmd": "distribute", "ids": ["…"], "sequences": ["<file.fseq>"], "checkOnly": true\|false, "force": true\|false }`. Omit `ids` for every device that should hold content, `sequences` for the whole show; `checkOnly` reports what a send would transfer, `force` sends every file. The report lands in `contentDist.lastReport`; see [Content Distribution](../advanced/controllers/contentdistribution.md). |
| `record`            | Create/update a persisted controller record: `{ "cmd": "record", "name": "…", "patch": { … } }`. |
| `network`           | Update a per-network policy: `{ "cmd": "network", "cidr": "…", "patch": { "allow": false } }`. |
| `refreshInterfaces` | Re-enumerate this host's networks.                                 |
| `cancel`            | Stop a running operation: `{ "cmd": "cancel", "opId": "op_…" }`. Partial results are kept and the op ends as `cancelled`. |
| `dismiss`           | Clear a finished operation (and its error) from the shared state: `{ "cmd": "dismiss", "opId": "op_…" }`. Dismissal is shared, so every UI stops showing it. |

The request is synchronous: it answers when the operation has finished, which
for a `distribute` can be minutes.  Verbs other than `scan` answer `{"ok":true}`;
results and progress ride the shared `controllerops` state (WebSocket
broadcast, or re-poll the GET) — a device's detail under `devices`, an
operation's outcome under `operations`, a distribution's report under
`contentDist.lastReport`.
Errors map to HTTP status: unknown `cmd` or missing fields `400`, network
disallowed by policy `403`, unknown controller id `404`, scan limit `409`,
anything else `500`.

```bash
# Deep-read a controller that was never scanned
curl -X POST http://player.local:3000/api/ezp/controllers/command \
  -H 'Content-Type: application/json' \
  -d '{"cmd":"status","id":"192.168.11.61|direct","address":"192.168.11.61"}'

# Upload the xLights config, resetting unspecified settings to defaults
curl -X POST http://player.local:3000/api/ezp/controllers/command \
  -H 'Content-Type: application/json' \
  -d '{"cmd":"upload","id":"192.168.11.61|direct","scope":"full","fullControl":true}'

# Check what every content-holding device is missing, then read the report
curl -X POST http://player.local:3000/api/ezp/controllers/command \
  -H 'Content-Type: application/json' \
  -d '{"cmd":"distribute","checkOnly":true}'
curl http://player.local:3000/api/ezp/controllers | jq .contentDist.lastReport
```

#### GET /api/proxies (FPP-compatible)

Advertises the controllers this player can proxy to, in the FPP 8+ wire shape
`[{ "host": "<ip>", "description": "<name>" }]` — so tools that use FPP hosts
as proxy hops (e.g. xLights) can use EZPlayer the same way, reaching each
listed host via `http://<player>/proxy/<ip>/…`. The list is the distinct
addresses of known controllers and directly-scanned devices, excluding this
host's own IPs and any network whose policy disallows proxying. Served on the
main web port only; `POST /api/proxies` is intentionally not implemented
(`404`).

---

### POST /api/ezp/sequences

Register (upsert) sequences from files already in the show folder — the
API-driven equivalent of the desktop "Add Sequence" flow. Body is an array of
`SequenceRecord`s; `files.*` may be show-relative names (they are resolved
against the show folder), `id`/`instanceId` are generated when omitted, and a
missing `work.length` is filled from the FSEQ header.

**Request:**

```json
[{ "files": { "fseq": "MySong.fseq", "audio": "MySong.mp3" }, "work": { "title": "My Song", "artist": "Artist", "length": 0 } }]
```

**Response:** `{ "success": true, "sequences": [ ...updated records... ] }`

---

### POST /api/ezp/sequences/autodetect

Given `{ "fseq": "<name in show folder>" }`, look for a matching audio file
(FSEQ header hints, then basename/prefix matching) and extract tag metadata.
Also reads title/artist from the FSEQ when present. Searches the sequence’s
folder, the configured media folder, and the show folder.
Returns `{ audioFile?, imageFile?, detectedTitle?, detectedArtist?, durationSecs? }`
with show-relative file names.

---

### POST /api/ezp/sequences/audio-metadata

Given `{ "audio": "<name in show folder>" }`, extract ID3 (or equivalent) tag
metadata from an audio file already in the show folder.
Returns `{ title?, artist?, imageFile? }` (image is show-relative when cover
art was extracted).

---

### POST /api/ezp/sequences/batch-import

Bulk-import `.fseq` files that are **already** in the show folder — same
autodetect + register path as the desktop Bulk Import action.

**Request:**

```json
{
    "fseqNames": ["SongA.fseq", "SongB.fseq"],
    "companionAudioNames": ["SongA.mp3"],
    "allowExistingAudio": true
}
```

| Field | Meaning |
| ----- | ------- |
| `fseqNames` | Basenames of `.fseq` files in the show folder (required) |
| `companionAudioNames` | Optional audio basenames from the same LAN selection. On the HTTP/LAN path, show-folder audio is restricted to this allowlist (plus the media folder). Omit or pass `[]` when relying only on the media folder. |
| `allowExistingAudio` | Pass `true` for existing-files imports: any show-folder audio (root or subdirectory) may satisfy an import by exact name, ignoring the allowlist. Used by the LAN/cloud "Import from Show Folder" dialog. |

Bulk import requires a resolved companion audio file for each FSEQ (exact
basename match). Failures are per-file and do not abort the rest of the batch.
All successful records are persisted in **one** sequence commit. FSEQs that
already have a song entry (matched by fseq basename) are skipped.

**Response (200):** `BatchImportSummary`

```json
{
    "total": 2,
    "imported": 1,
    "failed": 1,
    "successes": [
        {
            "fseqPath": "/show/SongA.fseq",
            "fseqName": "SongA.fseq",
            "title": "Song A",
            "artist": "Artist",
            "mediaFound": true
        }
    ],
    "failures": [
        {
            "fseqPath": "/show/SongB.fseq",
            "fseqName": "SongB.fseq",
            "reason": "Audio file not found (SongB.mp3)"
        }
    ]
}
```

---

### POST /api/ezp/sequences/batch-upload-import

LAN Bulk Import in **one HTTP request**: upload companions + FSEQs, then run
the same import as `batch-import`. Prefer this from browsers so you do not
issue one `/api/file/sequences/...` upload per file.

**Request:**

- Method: POST
- Headers:
    - `Content-Type: application/octet-stream`
- Body (binary, concatenated):
    1. `uint32` big-endian length `N` of the UTF-8 manifest JSON
    2. `N` bytes of UTF-8 JSON manifest (see below)
    3. Raw concatenation of each file’s bytes, in the same order as
       `manifest.files`

The manifest lives in the body (not a header) so large folder imports do not
hit Node’s default ~16 KB request-header limit.

**Manifest JSON:**

```json
{
    "files": [
        { "name": "SongA.mp3", "size": 4123456 },
        { "name": "SongA.fseq", "size": 89123456 }
    ],
    "companionAudioNames": ["SongA.mp3"],
    "importFseqNames": ["SongB.fseq"]
}
```

Files are written into the show folder, then import runs. By default every
`.fseq` in `manifest.files` is imported. If the upload has **no** FSEQs (audio
only), pass `importFseqNames` with basenames of FSEQs already in the show
folder — used by the LAN UI when choosing a media folder after a failed bulk
import. Response shape matches `batch-import` (`BatchImportSummary`).

**Errors:** `400` invalid manifest / no FSEQs to import; `413` over upload
limit; `503` import failure after upload.

---

### POST /api/ezp/playback-settings

Update playback settings. Updates playback configuration settings including
audio sync, background sequence mode, idle blackout, viewer control, volume
control, sync output (FPP MultiSync master), and advanced overrides.

**Request:**

- Method: POST
- Headers:
    - Content-Type: application/json
- Body: PlaybackSettings object

**Request Body Example:**

```json
{
    "audioSyncAdjust": 50,
    "backgroundSequence": "overlay",
    "viewerControl": {
        "enabled": true,
        "type": "remote-falcon",
        "remoteFalconToken": "token-123",
        "schedule": [
            {
                "id": "vc-1",
                "days": "all",
                "startTime": "18:00",
                "endTime": "22:00",
                "playlist": "viewer-playlist"
            }
        ]
    },
    "volumeControl": {
        "defaultVolume": 75,
        "schedule": [
            {
                "id": "vol-1",
                "days": "weekday-mon-fri",
                "startTime": "08:00",
                "endTime": "18:00",
                "volumeLevel": 50
            }
        ]
    },
    "brightnessControl": {
        "defaultBrightness": 100,
        "defaultColorTemperature": 3000,
        "schedule": [
            {
                "id": "dim-1",
                "days": "all",
                "startTime": "22:00",
                "endTime": "24:00",
                "brightness": 40
            }
        ]
    },
    "sendIdleBlackFrames": true,
    "sync": {
        "multisync": {
            "enabled": false,
            "remotes": ["192.168.1.50", "192.168.1.51:32320"],
            "port": 32320,
            "multicastAddress": "239.70.80.80"
        }
    },
    "advanced": {
        "ddpPort": 4048
    }
}
```

`sendIdleBlackFrames` (default `true`) controls whether black frames are sent
while idle/paused/stopped. `sync.multisync` configures FPP MultiSync master
output (see [FPP compatibility](./fpp-compat.md#multisync-master)); empty
`remotes` means multicast, and `port`/`multicastAddress` are optional
overrides. `advanced.ddpPort` overrides the DDP output port (default 4048)
and takes effect when controllers reopen.

The example is not the whole object: `PlaybackSettings` also carries
`normalizeNewSongs`, `jukebox`, `testSequenceTags`, `mediaFolder`, the
machine-local audio-output choice (`useDefaultAudioOutput`, `audioOutputs`),
the machine-local [audio buses](#audio-injection-apiezpaudiobuses-apiezpaudioleases) (`audioBuses`)
and the machine-local [virtual matrix](../advanced/virtual-matrix.md) outputs
(`virtualMatrixOutputs`).
A POST **replaces** the stored object, so read the current one from the
WebSocket snapshot (`playbackSettings`) and send it back with your changes.

**Response:**

- Status: 200 OK - Settings updated successfully
- Status: 400 Bad Request - Invalid format (expected object)
- Status: 500 Internal Server Error - Server error

**Success Response:**

```json
{
    "success": true
}
```

---

### GET /api/ezp/playback-settings

The current `PlaybackSettings` object, as the player holds it: the same value
the WebSocket snapshot carries under `playbackSettings`. Read it before a
whole-object POST so unrelated settings survive the round trip.

**Response:**

- Status: 200 OK - the `PlaybackSettings` object
- Status: 503 Service Unavailable - the player has not loaded settings yet (still starting)

---

### GET /api/ezp/playback-settings/:path

### POST /api/ezp/playback-settings/:path

One part of the settings, addressed by its path in the object with `/`
between levels: `sync`, `sync/multisync`, `sync/multisync/remotes`,
`volumeControl/defaultVolume`, `brightnessControl/defaultBrightness`,
`sendIdleBlackFrames`. The first segment must
be a `PlaybackSettings` key.

GET returns the value at that path as JSON. POST replaces just that value
and leaves every other setting as it is, so an integration can configure its
own block without reading and resending the whole object. Missing parents are
created, so `sync/multisync` works before `sync` exists. The body is any JSON
value; `null` unsets an optional part. `viewerControl` and `volumeControl`
cannot be unset.

**Example — turn on MultiSync master, unicast to a connector on the same
machine, leaving everything else alone:**

```bash
curl -X POST http://127.0.0.1:8080/api/ezp/playback-settings/sync/multisync \
  -H 'Content-Type: application/json' \
  -d '{ "enabled": true, "remotes": ["127.0.0.1:32320"], "mediaSync": true }'
```

```bash
curl http://127.0.0.1:8080/api/ezp/playback-settings/sync/multisync
# {"enabled":true,"remotes":["127.0.0.1:32320"],"mediaSync":true}
```

**Response:**

- Status: 200 OK - GET: the value; POST: `{ "success": true }`
- Status: 400 Bad Request - no JSON body, an intermediate segment is not an object, or unsetting a required part
- Status: 404 Not Found - the first segment is not a settings key, or (GET) the part is not set
- Status: 503 Service Unavailable - settings not loaded yet; POST the whole object first

---

### GET /api/ezp/volume

Volume as the player automates it: for each output, the **default volume**,
its **scheduled windows**, the window in effect right now (if any), and the
live level the slew has reached. In `default` mode there is one target,
`default` (the system default output, governed by `volumeControl`); in
`outputs` mode there is one per named output in `audioOutputs`, keyed by that
output's id. These ids are how the writes below address an output, which the
`playback-settings/:path` route cannot do for the `audioOutputs` array.

```json
{
    "mode": "outputs",
    "targets": [
        {
            "id": "o1",
            "label": "Yard speakers",
            "deviceId": "7c1b…",
            "defaultVolume": 80,
            "schedule": [{ "id": "w1", "days": "all", "startTime": "20:00", "endTime": "22:00", "volumeLevel": 40 }],
            "activeWindow": { "id": "w1", "days": "all", "startTime": "20:00", "endTime": "22:00", "volumeLevel": 40 },
            "level": 40
        },
        { "id": "o2", "label": "Porch", "deviceId": "e9a0…", "defaultVolume": 60, "schedule": [], "activeWindow": null, "level": 60 }
    ]
}
```

- Status: 200 OK - the overview
- Status: 503 Service Unavailable - settings not loaded yet

### POST /api/ezp/volume

Set the default volume: `{ "volume": 65 }` writes every output's default,
`{ "volume": 65, "target": "o2" }` just that output's. The value is clamped to
0–100 and persisted; the player ramps to it when its default is in effect.
Windows are left alone, so an output inside one keeps that level until it
ends. The `setvolume` player command is this call without a `target`.

```json
{
    "success": true,
    "defaultInEffect": false,
    "warning": "A scheduled volume window is in effect (Yard speakers: 20:00-22:00 at 40%); the default applies when it ends",
    "volume": { "mode": "outputs", "targets": ["… as GET …"] }
}
```

- Status: 200 OK - written; `defaultInEffect` is false and `warning` present when any output is inside a window
- Status: 400 Bad Request - `volume` is not a number
- Status: 404 Not Found - unknown `target`
- Status: 503 Service Unavailable - settings not loaded yet

### GET /api/ezp/volume/:target/schedule

That output's windows, the `schedule` array from the overview. `:target` is
`default` or an output id.

### POST /api/ezp/volume/:target/schedule

Replace that output's windows with the posted array. Each entry needs `days`
(`all`, `weekday-mon-fri`, `weekday-sun-thu`, `weekend-fri-sat`,
`weekend-sat-sun`, or a day name), `startTime` and `endTime` as `HH:MM`
(`endTime` may pass `24:00` for a window that crosses midnight) and
`volumeLevel` 0–100; `id` is kept when given and generated otherwise. Later
entries win where windows overlap. An empty array clears the schedule, after
which the default applies at all times. Answers like `POST /api/ezp/volume`.

```bash
curl -X POST http://127.0.0.1:8080/api/ezp/volume/default/schedule \
  -H 'Content-Type: application/json' \
  -d '[{ "days": "all", "startTime": "21:00", "endTime": "23:00", "volumeLevel": 35 }]'
```

- Status: 200 OK - replaced
- Status: 400 Bad Request - not an array, or an entry is malformed (the error names the field)
- Status: 404 Not Found - unknown target
- Status: 503 Service Unavailable - settings not loaded yet

---

### GET /api/ezp/brightness

:::note
Requires EZPlayer 0.7 or later.
:::

Output brightness as the player automates it (see
[Brightness](../advanced/brightness.md)): the **default brightness** and
**default color temperature**, the **scheduled windows**, the window in effect
right now (if any), and the live values the slew has reached. There is one
control for the whole display, so unlike volume there is no target id.

```json
{
    "defaultBrightness": 80,
    "defaultColorTemperature": 6500,
    "schedule": [{ "id": "b1", "days": "all", "startTime": "22:00", "endTime": "24:00", "brightness": 40, "colorTemperature": 2700 }],
    "activeWindow": { "id": "b1", "days": "all", "startTime": "22:00", "endTime": "24:00", "brightness": 40, "colorTemperature": 2700 },
    "level": 40,
    "colorTemperature": 2700
}
```

- Status: 200 OK - the overview
- Status: 503 Service Unavailable - settings not loaded yet

### POST /api/ezp/brightness

Set the defaults: `{ "brightness": 65 }`, `{ "colorTemperature": 3000 }`, or
both. Brightness is clamped to 0–100 and color temperature to 2000–12000 K
(6500 K is neutral and stored as "unset"). The values are persisted and the
player ramps to them when its defaults are in effect; windows are left alone,
so inside one the window's values hold until it ends. The `setbrightness`
player command is this call.

```json
{
    "success": true,
    "defaultInEffect": false,
    "warning": "A scheduled brightness window is in effect (22:00-24:00 at 40%, 2700 K); the default applies when it ends",
    "brightness": { "defaultBrightness": 65, "defaultColorTemperature": 6500, "schedule": ["…"], "activeWindow": { "…": "…" }, "level": 40, "colorTemperature": 2700 }
}
```

- Status: 200 OK - written; `defaultInEffect` is false and `warning` present while a window is in effect
- Status: 400 Bad Request - neither field given, or a field is not a number
- Status: 503 Service Unavailable - settings not loaded yet

### GET /api/ezp/brightness/schedule

The windows, the `schedule` array from the overview.

### POST /api/ezp/brightness/schedule

Replace the windows with the posted array. Each entry needs `days` (as for
volume), `startTime` and `endTime` as `HH:MM` (`endTime` may pass `24:00`)
and `brightness` 0–100; `colorTemperature` in kelvin is optional and, when
absent, the window keeps the default color temperature. `id` is kept when
given and generated otherwise. Later entries win where windows overlap. An
empty array clears the schedule. Answers like `POST /api/ezp/brightness`.

```bash
curl -X POST http://127.0.0.1:8080/api/ezp/brightness/schedule \
  -H 'Content-Type: application/json' \
  -d '[{ "days": "all", "startTime": "22:00", "endTime": "24:00", "brightness": 40, "colorTemperature": 2700 }]'
```

- Status: 200 OK - replaced
- Status: 400 Bad Request - not an array, or an entry is malformed (the error names the field)
- Status: 503 Service Unavailable - settings not loaded yet

---

### GET /api/ezp/model-coordinates

Get model coordinates for the Show View. Returns coordinate data used to render the 3D light layout preview.

**Request:**

- Method: GET
- Headers: None required

**Response:**

- Status: 200 OK - Model coordinates object
- Status: 500 Internal Server Error - Failed to get model coordinates

**Error Response (500):**

```json
{
    "error": "Failed to get model coordinates"
}
```

---

### GET /api/ezp/model-coordinates-2d

Get model coordinates for 2D preview. Returns coordinate data used to render the 2D light layout preview.

**Request:**

- Method: GET
- Headers: None required

**Response:**

- Status: 200 OK - 2D model coordinates object
- Status: 500 Internal Server Error - Failed to get 2D model coordinates

**Error Response (500):**

```json
{
    "error": "Failed to get 2D model coordinates"
}
```

---

### GET /api/ezp/frames

Get binary frame data for the live 3D viewer. Returns the latest frame of light channel data as a binary `application/octet-stream` response.

**Request:**

- Method: GET
- Headers: None required

**Response:**

- Status: 200 OK - Binary frame data (`application/octet-stream`)
- Status: 204 No Content - No frame data available yet

**Response Binary Format:**

| Offset | Size    | Type      | Description         |
| ------ | ------- | --------- | ------------------- |
| 0      | 4 bytes | uint32 LE | Frame size in bytes |
| 4      | 4 bytes | uint32 LE | Sequence number     |
| 8      | N bytes | raw       | Frame data          |

**Response Headers:**

- `Cache-Control: no-store`
- `Content-Type: application/octet-stream`
- `Access-Control-Allow-Origin: *`

---

### GET /api/ezp/frames-zstd

Get ZSTD-compressed binary frame data for the live 3D viewer. Same semantics as `/api/ezp/frames` but the frame payload is compressed with ZSTD at level 1 (fastest). Useful for remote/embedded clients on bandwidth-constrained links.

**Request:**

- Method: GET
- Headers: None required

**Response:**

- Status: 200 OK - Compressed binary frame data (`application/octet-stream`)
- Status: 204 No Content - No frame data available yet
- Status: 503 Service Unavailable - ZSTD codec not yet initialized

**Response Binary Format:**

| Offset | Size    | Type      | Description                          |
| ------ | ------- | --------- | ------------------------------------ |
| 0      | 4 bytes | uint32 LE | Uncompressed frame size in bytes     |
| 4      | 4 bytes | uint32 LE | Sequence number                      |
| 8      | N bytes | raw       | ZSTD-compressed frame data (level 1) |

The 8-byte header is **not** compressed. Decompress the payload starting at offset 8 to recover the original frame bytes.

**Response Headers:**

- `Cache-Control: no-store`
- `Content-Type: application/octet-stream`
- `Access-Control-Allow-Origin: *`

---

### Overlay leases (`/api/ezp/overlays`)

:::note
Requires EZPlayer 0.7 or later.
:::

An overlay lease lets an external program paint a model (or the whole display) while the player runs. The player composites the latest complete overlay payload into every frame it sends, on top of the sequence that is playing (or on top of black while idle), until the lease expires. Games, test tools, and GPU renderers on another machine all use the same path.

A lease targets a **model** by name, or one of its **submodels** as `Model/Submodel`. Grid models (matrices, trees) take an RGB grid `width` x `height`, top row first; any target can take one RGB triple per node (`format: "nodes"`). A grid smaller or larger than the model's own grid is resampled nearest-neighbour.

Any model or submodel can also be painted through its own xLights render buffer (`format: "buffer"`): a `width` x `height` picture, top row first, in which each node reads the cell it sits in and cells with no node are ignored. This is how a custom model such as a spinner is addressed as a sparse grid, and it is the default for a submodel. A submodel's buffer is the one xLights builds for it: one row per strand (one column per strand when it is vertical), or the parent's own shape for "Keep XY" and sub-buffer submodels.

Submodels are overlay targets only. They are not in the frame pool manifest and cannot be shown as a virtual matrix.

Payloads travel over UDP (fast, lossy, meant for animation) or as a raw `PUT` (simple clients). Either one also renews the lease. A lease with no traffic for `ttlMs` is dropped.

Cells are RGB by default. With `channels: 4` they are RGBA: a cell's alpha scales it before it blends, and under the default `over` blend also fades the frame beneath it by the same amount, so a sprite with a transparent background runs across a matrix that keeps playing its sequence.

A lease can also cover **several targets** at once (`models`, or an xLights `group`), and a lease can carry no pixels at all: a **pattern** lease names a program the player evaluates for every node from its position and the time, on the GPU when the player has one. See [Pattern leases](#pattern-leases) below.

A lease is **exclusive** or a **layer**. An exclusive lease is refused while another exclusive lease holds any of the same nodes, so two games cannot fight over one tree: a lease on a model covers its submodels, and a lease on the whole display covers everything. A layer blends over whatever is there and never blocks anything, which is what a background effect wants. Every lease carries a `name`; an app that sends its `x-ezp-app-token` holds the lease under its instance title, and a refused client is told who has the model.

#### GET /api/ezp/overlays/targets

Models that can take an overlay, with their grid sizes. `type` is what xLights draws the model as (its DisplayAs), when the player knows it; `subModels` is how many submodels a model has, when it has any.

```json
{ "ok": true, "layoutVersion": 4232670734, "targets": [{ "model": "Matrix", "type": "Matrix", "nodeCount": 2048, "width": 64, "height": 32 }] }
```

A layout can hold thousands of submodels, so more is sent only when asked for:

| Query              | Adds                                                                                  |
| ------------------ | ------------------------------------------------------------------------------------- |
| `model=NAME`       | Only that model, or only that `Model/Submodel`                                        |
| `detail=submodels` | A row per submodel, and the shape of every row (below)                                |
| `detail=nodes`     | The same plus per-node coordinates; needs `model=NAME`                                |
| `groups=1`         | `groups`: the show's xLights model groups as `{ name, models, subModels }`, flattened to the models listed here and to submodel members (as `Model/Submodel`) whose model is not itself a member; a group that reaches none is left out |

```json
{
  "model": "Spinner", "subModel": "Arms", "target": "Spinner/Arms", "nodeCount": 96,
  "kind": "multiEqual", "strands": [12, 12, 12, 12, 12, 12, 12, 12],
  "buffer": { "width": 12, "height": 8 }, "overlaps": 0, "vertical": false, "bufferStyle": "Default"
}
```

| Field         | Meaning                                                                                          |
| ------------- | ------------------------------------------------------------------------------------------------ |
| `target`      | The name to open a lease with                                                                    |
| `kind`        | `single` (one strand), `multi` (strands of different lengths), `multiEqual` (strands of one length), or `area` (a crop of the parent's buffer, which has no strands) |
| `strands`     | Nodes on each strand, as the submodel lists them                                                 |
| `buffer`      | Size of the render buffer, which is the default size of a `buffer` lease                         |
| `overlaps`    | Nodes that sit in more than one buffer cell (a strand that crosses itself or another)            |
| `vertical`    | Submodels: strands run up the buffer's columns instead of along its rows                         |
| `bufferStyle` | Submodels: the xLights buffer style, such as `Default`, `Keep XY` or `Stacked Strands`           |

With `detail=nodes` each row also has `nodes`, three flat arrays in `nodes` payload order:

- `world`: x, y, z of each node in the layout's world coordinates.
- `local`: x, y, z of each node in its model's own coordinates.
- `cells`: node, x, y for every buffer cell that has a node; y counts up from the bottom row, so the payload row is `height - 1 - y`. A node in several cells appears once for each, in the order the submodel lists them.

A client can use these to draw by position: compute a color for each node from where it is and send it with `format: "nodes"`.

#### POST /api/ezp/overlays

Open a lease. Body (`mode` and `name` are required; a grid also needs a size when the model has none):

| Field     | Meaning                                                          |
| --------- | ---------------------------------------------------------------- |
| `mode`    | `exclusive` (a game: refused while another exclusive lease holds any of the nodes) or `layer` (an effect: blends over anything, blocks nothing) |
| `name`    | Who is painting, shown in the lease list and in "in use" errors  |
| `model`   | Model name or `Model/Submodel`; the whole display when omitted   |
| `subModel` | Submodel of `model`, as an alternative to naming it in `model`  |
| `models`  | Several targets at once, as a list of names; the payload lists their nodes in this order (`nodes` and `pattern` formats) |
| `group`   | An xLights model group; the player resolves it to `models` (its models that can take an overlay, then its submodel members whose model is not already listed, in group order) |
| `format`  | `grid` (default for grid models), `nodes`, `buffer` (default for submodels), or `pattern` (default when `pattern` is given) |
| `channels` | Bytes per cell: `3` (RGB, default) or `4` (RGBA, straight alpha) |
| `pattern` | `format: "pattern"`: `{ preset, uniforms }` or `{ program, uniforms }`, see below |
| `width`   | Picture width; defaults to the target's grid or buffer           |
| `height`  | Picture height                                                   |
| `overlap` | `buffer` only: which cell colors a node that sits in several. `last` (default) takes the cell listed latest, as xLights does, so later passes of a strand lie on top; `first` takes the earliest; `max` takes the brightest of them, channel by channel |
| `blend`   | `replace` (default for RGB), `over` (default for RGBA and patterns: alpha fades the frame beneath), `max`, `underlay`, `add`, `subtract`, `multiply`, `screen`, `alpha` (same as `over`), `min` |
| `opacity` | 0..1, default 1; multiplies every cell's alpha                   |
| `ttlMs`   | Expiry after the last payload, default 30000                     |

An app process sends its `x-ezp-app-token` header too; the lease then carries `owner` (`instance` and `title`) and the title is what other clients are told.

Response:

```json
{
  "ok": true,
  "udpPort": 4049,
  "lease": { "id": 3, "token": 2810465117, "name": "tetris", "mode": "exclusive",
             "owner": { "instance": "tetris-front", "title": "Tetris Front Tree" },
             "model": "Matrix", "format": "grid", "width": 64, "height": 32,
             "nodeStart": 4096, "nodeCount": 2048, "frameBytes": 6144, "blend": "replace", "opacity": 1,
             "ttlMs": 30000, "expiresAt": 1789357165034, "frames": 0 }
}
```

`frameBytes` is the exact payload size the lease expects (`width * height * channels`, or `nodeCount * channels`; 0 for a pattern lease, whose payload is JSON). The `token` must accompany every payload and every later call. A lease on a submodel also reports `subModel`, and its `nodeStart` is -1 when the submodel's nodes are not next to each other in the frame. A multi-target lease reports `models` (and `group` when it was opened by group); a pattern lease reports `pattern` with the preset, the evaluator in use (`gpu` or `js`) and the current uniform values, plus `renders` (output frames it has painted, so two reads a second apart give the player's frame rate) and `renderMs` (how long one paint takes, smoothed). Every lease carries `channels` and `openedAt`; `frames` counts the payloads a client has sent.

When an exclusive lease is refused the status is `409` and the body names the holder, so a game can tell its players who has the lights and try again when that lease closes or expires:

```json
{ "ok": false, "error": "Matrix is in use by Race Front Tree", "code": "conflict",
  "heldBy": { "id": 2, "name": "race-to-the-star", "mode": "exclusive", "owner": { "instance": "race-front", "title": "Race Front Tree" }, "model": "Matrix", "expiresAt": 1789357165034 } }
```

A bad request (a missing `mode` or `name`, an unknown model) is `400`.

With `format: "nodes"` a model takes its nodes in frame order and a submodel takes them in the order its lines list them, each node once. With `format: "grid"` a target that has no dense grid is treated as one strip in that same order.

#### Pattern leases

A pattern lease sends no pixels. It names a program, and the player computes every node's color itself, from the node's position, the time since the lease opened, and a block of **uniforms** the client may update at any rate it likes with a payload of a few dozen bytes. On a player with a GPU the program runs there, one point per node, in well under a millisecond for a whole yard; without one it runs in JavaScript. A pattern is RGBA and blends `over` by default; `add` suits a light beam.

```json
{ "mode": "layer", "name": "wand", "group": "Beam Coverage", "blend": "add",
  "pattern": { "preset": "beam",
               "uniforms": { "origin": [120, 60, 900], "dir": [0, 0, -1], "halfAngle": 0.15, "range": 1200, "color": "#fff0c0" } } }
```

Presets and their uniforms (a color is `"#rrggbb"` or `[r, g, b]` in 0..1; positions are in the layout's world units):

| Preset      | Uniforms                                                                 | Paints                                                     |
| ----------- | ------------------------------------------------------------------------ | ---------------------------------------------------------- |
| `beam`      | `origin`, `dir`, `halfAngle` (radians), `softness` (0..1 of the rim), `range`, `color`, `noise` (0..1 cloudiness) | A flashlight cone, fading with distance |
| `shockwave` | `center`, `radius`, `thickness`, `color`                                 | A ring of light; animate `radius`                          |
| `wipe`      | `dir`, `offset`, `width`, `color`                                        | A band across the plane `dot(pos, dir) = offset`           |
| `fire`      | `base` (y), `height`, `speed`, `scale`, `intensity`                      | Flames rising from `base`                                  |
| `snow`      | `cell`, `speed`, `size`, `density`, `color`                              | Flakes drifting down, one per cell of space                |
| `meteors`   | `cell`, `speed`, `length`, `height`, `density`, `color`                  | Streaks falling through columns `cell` apart               |
| `solid`     | `color`, `opacity`                                                       | One color everywhere                                       |
| `rainbow`   | `dir`, `period`, `speed`                                                 | Hue by position along `dir`, drifting                      |

A client can also send its own `program`: an expression graph in JSON with a `color` (vec3 or vec4) and an optional `alpha` (float), over the inputs `pos` (world x, y, z), `local` (model-local x, y, z), `t` (seconds), `i` (node index in the lease), `n` (nodes in the lease), `u` (`i / (n - 1)`) and the program's declared `uniforms` as `$name`; any of them takes a swizzle such as `pos.xz`. Numbers and `[x, y, z]` are constants, `"#rrggbb"` is a color, and `{ "op": ..., "args": [...] }` applies an operation: `add sub mul div min max mod pow step atan2`, `neg abs floor ceil fract sqrt exp log sin cos tan asin acos atan sign saturate`, `clamp mix smoothstep`, `vec2 vec3 vec4 swizzle dot length distance normalize cross angle`, `hash noise fbm hsv`, and `ramp` (a float through color `stops`). Every uniform a program reads must be declared in `uniforms` with a default, which fixes its type. A program that does not compile is refused with the reason.

```json
{ "mode": "layer", "name": "plane", "models": ["Arch 1", "Arch 2"],
  "pattern": { "program": {
    "uniforms": { "y": 50, "tint": "#40c0ff" },
    "color": "$tint",
    "alpha": { "op": "sub", "args": [1, { "op": "saturate", "args": [{ "op": "div", "args": [{ "op": "abs", "args": [{ "op": "sub", "args": ["pos.y", "$y"] }] }, 20] }] }] } } } }
```

The payload of a pattern lease is a JSON object of uniform values, over UDP or `PUT` like any other payload, at most 16384 bytes. Names the program does not declare are ignored; a value of the wrong shape refuses the whole update. The open response and `GET /api/ezp/overlays` show the values in force.

#### PUT /api/ezp/overlays/:id/frame?token=T[&seq=N]

Whole payload as `application/octet-stream`, exactly `frameBytes` long (a pattern lease: the JSON uniform object). Commits immediately.

#### POST /api/ezp/overlays/:id/keepalive?token=T

Renew without sending pixels.

#### DELETE /api/ezp/overlays/:id?token=T

Close the lease; the model returns to the sequence.

#### GET /api/ezp/overlays

Open leases.

#### UDP payload packets

Sent to the player's overlay port (`udpPort` in the open response; `advanced.overlayPort` in playback settings, default 4049). One payload may span several packets; the packet with the `last` flag commits the frame. All integers are big-endian.

| Offset | Size | Field                                    |
| ------ | ---- | ---------------------------------------- |
| 0      | 4    | Magic `EZO1`                             |
| 4      | 4    | Lease id                                 |
| 8      | 4    | Token                                    |
| 12     | 4    | Frame sequence (increment per payload)   |
| 16     | 1    | Flags: bit 0 = last packet of this frame |
| 17     | 4    | Byte offset of this data in the payload  |
| 21     | 2    | Data length (at most 1400)               |
| 23     | 1    | Reserved                                 |
| 24     | N    | Payload bytes                            |

Packets for a frame may arrive in any order; a packet for a new sequence number starts a new payload. `packetizeOverlayFrame` in `@ezplayer/epp` builds these, and `src/tools/overlay-tetris.ts` in that package is a complete example client.

---

### Virtual matrix (`/matrix`, `/api/ezp/pool`)

:::note
Requires EZPlayer 0.7 or later.
:::

A [virtual matrix](../advanced/virtual-matrix.md) shows one model's pixels as a picture. The player's own windows and any browser use the same page and the same frame route.

#### GET /matrix?model=NAME

The viewer page. It fills the browser window with the model's picture and follows the sequence's frame rate.

| Query    | Meaning                                                                             |
| -------- | ----------------------------------------------------------------------------------- |
| `model`  | Model name. Required                                                                |
| `smooth` | `1` blends between pixels; default is crisp blocks                                  |
| `fit`    | `contain` (default) keeps the model's proportions; `fill` stretches it to the page |
| `bg`     | Background color as `rrggbb`, default `000000`                                      |

#### GET /api/ezp/pool/model/:name

One frame of one model as bytes: a 12-byte header, then the pixels.

| Offset | Type | Meaning                                         |
| ------ | ---- | ----------------------------------------------- |
| 0      | u16  | Width (the node count for a model with no grid) |
| 2      | u16  | Height (1 for a model with no grid)             |
| 4      | u32  | Frame number (`seq`)                            |
| 8      | u8   | Bytes per pixel; the first three are R, G, B    |
| 9      | u8   | Flags; bit 0 set means the bottom row is first  |
| 10     | u16  | Reserved                                        |

All numbers are little-endian. Pixels follow row by row.

| Query     | Meaning                                                                                    |
| --------- | ------------------------------------------------------------------------------------------ |
| `after`   | The `seq` already held. The answer is `204` when there is nothing newer                    |
| `wait`    | With `after`: wait up to this many milliseconds (at most 2000) for a newer frame           |
| `client`  | An id the reader makes up, so two readers at one address are counted separately            |
| `painted` | How many frames the reader has drawn since it started; reported back as its painted rate  |

To follow a model at the sequence's frame rate, ask for `?after=<last seq>&wait=1000` in a loop: each answer arrives as soon as the next frame exists. `404` means there is no pixel model of that name, and `204` with no wait means the player has no frames yet.

`GET /api/ezp/pool/manifest` lists every model with its place in the frame and its grid size, and `GET /api/ezp/overlays/targets` lists the models with their sizes.

#### GET /api/ezp/matrix/status

Who is reading model frames, and how fast.

```json
{
    "readers": [
        {
            "model": "Matrix",
            "output": "vm-mb2k1x",
            "address": "local",
            "idleMs": 21,
            "sourceFps": 40,
            "servedFps": 40,
            "paintedFps": 40
        }
    ],
    "lanUrls": ["http://192.168.1.50:3000"]
}
```

`output` is set for the player's own windows. `address` is `local` for a reader on the player computer. `sourceFps` is what the player made, `servedFps` what it sent to this reader, and `paintedFps` what the reader says it drew (absent when the reader does not report it). A reader that has been silent for 30 seconds is dropped. `lanUrls` are the addresses other computers can reach the player at.

#### GET /api/ezp/displays

The displays attached to the player computer, as the Virtual Matrix settings list them: `index`, `id`, `label`, `width`, `height`, `x`, `y`, `primary`.

---

### Scene objects (`/api/ezp/objects`)

:::note
Requires EZPlayer 0.7 or later.
:::

Scene objects let an external program put things into the Show View: a pointer beam, a cloud of sparkles, a prop mesh, a picture, or a group of those. They are display only. They never reach the controllers and never change what is playing. Every viewer of the Show View sees them, in the app, on the LAN web page, and through the cloud.

Each object lives under a **key** and a **lease**. If the player hears nothing about an object for `ttlMs`, the object disappears. Any write renews the lease, so a program that keeps moving its object needs no separate keepalive.

Coordinates are xLights world units, the same space the layout is drawn in. The 2D view looks at the X/Y plane from the front and still honors Z: a solid object hides the lights and objects behind it, and lights in front of it draw over it. See-through objects (images, beams, points, anything with `opacity` below 1) draw over the lights.

Write routes are served on the web port only, not on the kiosk port.

#### Keys and tokens

- `PUT /api/ezp/objects/:key` creates or replaces the object with that key. A program that restarts simply carries on under the same key.
- `POST /api/ezp/objects` creates an object under the body's `name`, or under a made-up key when there is no `name`.
- A **token** protects an object from other writers. Supply your own as `token` in the create body, or let the player make one up (it does whenever it makes up the key). The create response shows it once. Later writes pass it as `?token=T` or an `x-ezp-token` header; without it they get `403`.
- An object created with a key and no token is open: anyone who knows the key may change it.

Keys are 1-64 characters from `A-Z a-z 0-9 . _ ~ -`, starting with a letter or digit.

#### Object body

| Field        | Meaning                                                                    |
| ------------ | -------------------------------------------------------------------------- |
| `content`    | What to draw (below). Required on create.                                  |
| `placement`  | Where it sits                                                              |
| `appearance` | Visibility, color, opacity                                                 |
| `ttlMs`      | Lease length, default 30000 (250 to 86400000)                              |
| `view`       | `both` (default), `2d` or `3d`                                             |
| `smoothMs`   | How quickly the drawn object follows a new placement, default 120; 0 snaps |
| `name`       | Key, for `POST` only                                                       |
| `token`      | Write token to set, on create only                                         |

`placement`:

| Field        | Meaning                                                                           |
| ------------ | --------------------------------------------------------------------------------- |
| `position`   | `[x, y, z]`                                                                       |
| `rotation`   | `[x, y, z]` degrees, applied in xLights order (Z, then Y, then X)                 |
| `quaternion` | `[x, y, z, w]`; used instead of `rotation`                                        |
| `direction`  | `[x, y, z]`; aims the object's local +Z axis along it. Used instead of `rotation` |
| `scale`      | A number, or `[x, y, z]`                                                          |
| `matrix`     | 16 numbers, column-major; replaces all of the above                               |

`appearance`:

| Field      | Meaning                                                             |
| ---------- | ------------------------------------------------------------------- |
| `visible`  | `false` hides the object without ending its lease                   |
| `color`    | `#rrggbb`. Tints meshes and images; colors shapes, beams and points |
| `opacity`  | 0..1                                                                |
| `additive` | Blend as light. Beams default to `true`                             |

`content` is one of:

| `type`   | Fields                                                                                                                                  |
| -------- | --------------------------------------------------------------------------------------------------------------------------------------- |
| `points` | `positions` (flat `x, y, z` per point), `colors` (flat `r, g, b`, 0-255, optional), `size` (diameter, default 4), `smooth` (soft edges) |
| `beam`   | `length`, `angle` (half-angle in degrees, default 3), `radius` (at the origin, default 0). Runs along local +Z and fades with distance  |
| `shape`  | `shape` (`sphere`, `box`, `cylinder`, `cone`, `plane`), `size` (number or `[x, y, z]`), `wireframe`                                     |
| `mesh`   | `file` (an OBJ in the show folder) or `asset` (an uploaded OBJ)                                                                         |
| `image`  | `file` or `asset`, `width`, `height` (either alone keeps the image's proportions)                                                       |
| `group`  | `children`: a list of `{ name, placement, appearance, content }`, placed relative to the group                                          |

Cylinders and cones stand along their local Y axis. A plane and an image face local +Z. A group child takes its parent's color unless it sets its own, and its opacity multiplies its parent's. Groups nest up to 4 deep; one object holds up to 512 nodes and 100000 points. The player holds up to 256 objects.

#### Routes

| Route                                       | Does                                                                 |
| ------------------------------------------- | -------------------------------------------------------------------- |
| `GET /api/ezp/objects`                      | List live objects                                                    |
| `GET /api/ezp/objects/:key`                 | One object                                                           |
| `POST /api/ezp/objects`                     | Create (`201`), or replace when `name` exists                        |
| `PUT /api/ezp/objects/:key`                 | Create (`201`) or replace (`200`). Uploaded assets are kept          |
| `PATCH /api/ezp/objects/:key`               | Change some of it. `404` once the lease has run out: create it again |
| `POST /api/ezp/objects/:key/keepalive`      | Renew the lease and change nothing                                   |
| `DELETE /api/ezp/objects/:key`              | Remove it now                                                        |
| `PUT /api/ezp/objects/:key/assets/:name`    | Upload a file to keep with the object                                |
| `GET /api/ezp/objects/:key/assets/:name`    | Read it back                                                         |
| `DELETE /api/ezp/objects/:key/assets/:name` | Remove it                                                            |
| `GET /api/ezp/scene`                        | The viewer feed (below)                                              |

A `PATCH` body takes `placement`, `appearance`, `content`, `ttlMs`, `view` and `smoothMs`. `placement` and `appearance` merge field by field, and a `null` clears a field; `content` replaces the whole content. Errors come back as `{ "ok": false, "error": "..." }` with `400` (bad body), `403` (token), `404` (no such object) or `429` (too many).

```bash
# A cyan pointer beam
curl -X PUT http://localhost:3000/api/ezp/objects/wand -H 'Content-Type: application/json' -d '{
  "ttlMs": 2000,
  "content": { "type": "beam", "length": 600, "angle": 4 },
  "placement": { "position": [200, 20, 300], "direction": [0, 0.2, -1] },
  "appearance": { "color": "#00d0ff" }
}'

# Aim it somewhere else; this also renews the lease
curl -X PATCH http://localhost:3000/api/ezp/objects/wand -H 'Content-Type: application/json' \
  -d '{ "placement": { "direction": [0.4, 0.3, -1] }, "appearance": { "color": "#ffb020" } }'
```

`scripts/scene-objects-demo.mjs` in the source tree is a runnable example that animates a few objects. `scripts/scene-flashlight-tag.mjs` is a larger one: a game of flashlight tag that uploads its own meshes and images.

#### Uploaded assets

A mesh or image can name a file in the show folder (`file`, served like `/api/ezp/show-file`) or a file uploaded under the object's own key (`asset`). Uploaded files live in memory with the object and go away with it.

Send the bytes as `application/octet-stream`. The name's extension must be one of `.obj .mtl .png .jpg .jpeg .gif .webp .bmp .tga .dds`. An OBJ finds its material file and textures among the same object's assets by file name, so upload `house.obj`, `house.mtl` and the textures the MTL names side by side. One file may be 32 MB; an object holds up to 32 files.

```bash
curl -X PUT http://localhost:3000/api/ezp/objects/sleigh -H 'Content-Type: application/json' \
  -d '{ "content": { "type": "mesh", "asset": "sleigh.obj" }, "placement": { "position": [0, 300, 0] } }'
curl -X PUT http://localhost:3000/api/ezp/objects/sleigh/assets/sleigh.obj \
  -H 'Content-Type: application/octet-stream' --data-binary @sleigh.obj
```

The object is drawn once the file it names has arrived.

#### GET /api/ezp/scene?since=N&epoch=E

What a viewer polls. With no query it returns the whole scene. With the `rev` and `epoch` of the last answer it returns only what changed since, or `204` when nothing did.

```json
{
    "epoch": "9f2c41d07a3e",
    "rev": 42,
    "keys": ["wand", "sleigh"],
    "objects": [
        {
            "key": "wand",
            "rev": 42,
            "contentRev": 17,
            "view": "both",
            "placement": { "position": [200, 20, 300], "direction": [0.4, 0.3, -1] },
            "appearance": { "color": "#ffb020" }
        }
    ]
}
```

`keys` lists every live object, so a key that is missing has gone away. An entry carries `content` and `assets` only when its `contentRev` is newer than `since`; a move or recolor sends just the placement and appearance. `epoch` changes when the player restarts, and a viewer that sees a new one starts over.

---

### GET /api/ezp/time

Server clock for client clock-offset estimation. Returns the server's current `Date.now()` value. Clients can measure the round-trip time of this request and compute the offset between their local clock and the server's clock, enabling accurate audio scheduling on remote devices.

**Request:**

- Method: GET
- Headers: None required

**Response:**

- Status: 200 OK
- Body:

```json
{
    "now": 1704067200000,
    "timeZone": "America/New_York"
}
```

`timeZone` is the player's IANA zone, for clients that render show times in
the player's local time rather than their own.

**Response Headers:**

- `Cache-Control: no-store`
- `Access-Control-Allow-Origin: *`

**Clock Offset Estimation:**

The recommended approach is to take several samples and trust the one with the lowest round-trip time (it had the least scheduling noise, making the "halfway" assumption most accurate). Discard any sample with RTT > 100ms.

```javascript
const t0 = Date.now();
const res = await fetch('/api/ezp/time');
const t1 = Date.now();
const { now: serverNow } = await res.json();
const rtt = t1 - t0;
const clockOffset = serverNow - (t0 + rtt / 2);
// To convert server timestamps to local time: localTime = serverTime - clockOffset
```

---

### GET /api/ezp/audio

Get binary audio chunk data for web client audio streaming. Returns all audio chunks published since a given sequence number. Used by the web UI to stream audio from the player in sync with the live pixel data.

**Request:**

- Method: GET
- Query Parameters:
    - `afterSeq` (number, optional) - Return chunks after this sequence number. Defaults to 0. Use the `latestSeq` from the previous response.

**Response:**

- Status: 200 OK - Binary audio data (`application/octet-stream`)
- Status: 204 No Content - No audio buffer available or no new chunks since `afterSeq`

**Response Binary Format:**

The response is a binary `application/octet-stream` with the following layout:

**Header (8 bytes):**

| Offset | Size    | Type      | Description                                     |
| ------ | ------- | --------- | ----------------------------------------------- |
| 0      | 4 bytes | uint32 LE | Chunk count                                     |
| 4      | 4 bytes | uint32 LE | Latest sequence number (use as next `afterSeq`) |

**Per-chunk (repeated `chunkCount` times):**

| Offset | Size            | Type       | Description                                                                |
| ------ | --------------- | ---------- | -------------------------------------------------------------------------- |
| 0      | 8 bytes         | float64 LE | `playAtRealTime` - server wall-clock time (ms) when chunk should play      |
| 8      | 4 bytes         | uint32 LE  | `incarnation` - increments on song/segment boundaries                      |
| 12     | 4 bytes         | uint32 LE  | `sampleRate` - e.g. 48000                                                  |
| 16     | 4 bytes         | uint32 LE  | `channels` - number of audio channels                                      |
| 20     | 4 bytes         | uint32 LE  | `sampleCount` - total number of Float32 samples (all channels interleaved) |
| 24     | sampleCount × 4 | Float32 LE | Interleaved audio sample data                                              |

**Response Headers:**

- `Cache-Control: no-store`
- `Content-Type: application/octet-stream`
- `Access-Control-Allow-Origin: *`

**Notes:**

- `playAtRealTime` is a server-side `Date.now()` timestamp. Remote clients should use the `/api/ezp/time` endpoint to estimate clock offset and adjust accordingly.
- `incarnation` changes when a new song or audio segment begins. Clients should reset their audio scheduling state when incarnation changes.
- Audio samples are interleaved: for stereo, the pattern is `[L0, R0, L1, R1, ...]`. Clients must deinterleave into per-channel buffers for Web Audio API playback.
- The ring buffer holds approximately 5 seconds of audio. If a client falls behind, the oldest chunks are silently lost. The response will include chunks starting from the oldest still available.
- Polling at ~50ms intervals is recommended for smooth playback.

**Example (curl):**

```bash
# First request - get all available chunks
curl http://localhost:3000/api/ezp/audio?afterSeq=0 --output audio.bin

# Subsequent requests - only get new chunks
curl http://localhost:3000/api/ezp/audio?afterSeq=42 --output audio.bin
```

---

### Audio injection (`/api/ezp/audio/buses`, `/api/ezp/audio/leases`)

:::note
Requires EZPlayer 0.7 or later.
:::

Another program can send sound to the player: a stream of audio, or short clips it uploads once and then plays at times it chooses. Sound goes to a **bus**, through a **lease** the program opens on it.

Two buses always exist:

| Bus         | What it is                                                                                                                                                                      |
| ----------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `main`      | The show audio. Injected sound is mixed with the song, plays on the show's speakers at the show's volume, and is heard by listeners. It is published about 800 ms ahead of time |
| `immediate` | Plays on the show's speakers only, with a short lead (40 ms by default), for sounds that must follow an event at once. Listeners do not hear it                                 |

More buses can be added, each with its own lead, chunk length, volume and output devices: a speaker behind a prop, for instance. Any bus but `main` can also be played by another computer on its own speaker: it connects as a [listener](#listeners-and-subscribers) and buses are sent to it, or it subscribes to one bus by name. Buses are kept in playback settings (`audioBuses`), listeners in `audioListeners`, and both can be changed on the Audio settings page.

All times are on the player's clock, in milliseconds. Every reply carries the clock as `now`, and [`GET /api/ezp/time`](#get-apiezptime) returns it too. Lights follow the same clock, so sound and an [overlay](#overlay-leases-apiezpoverlays) sent for the same time line up.

How soon a sound can play is the bus's lead plus up to one chunk, plus the output device's own delay. A sound asked for sooner than that keeps its time and loses its beginning.

Sound on `main` is only produced while the player is producing show audio; it is not while playback is paused.

#### GET /api/ezp/audio/buses

The buses, with their timing and a level meter.

```json
{
    "ok": true,
    "now": 1795408764340.19,
    "udpPort": 4050,
    "buses": [
        {
            "name": "main",
            "leadMs": 800,
            "chunkMs": 100,
            "volume": 100,
            "outputs": [],
            "builtIn": true,
            "leases": 0,
            "chunks": 0,
            "peak": 0
        },
        {
            "name": "immediate",
            "leadMs": 40,
            "chunkMs": 20,
            "volume": 100,
            "outputs": [],
            "builtIn": true,
            "leases": 1,
            "chunks": 250,
            "peak": 0.5
        }
    ]
}
```

| Field     | Meaning                                                                  |
| --------- | ------------------------------------------------------------------------ |
| `leadMs`  | How far ahead of its play time sound is handed to the outputs            |
| `chunkMs` | Length of the pieces the bus is cut into                                 |
| `volume`  | 0-100. `main` follows the show volume instead                            |
| `outputs` | Devices the bus plays on; empty means the show's outputs                 |
| `listeners` | Names of the listeners the bus is sent to                                |
| `leases`  | Open leases on the bus                                                   |
| `chunks`  | Pieces holding sound sent to the outputs since the player started        |
| `peak`    | Largest sample in the last second of sound, 0-1; 0 when the bus is quiet |

#### POST /api/ezp/audio/buses

Add a bus, or change the fields given on an existing one. Answers like the GET.

```json
{
    "name": "tree",
    "leadMs": 100,
    "chunkMs": 20,
    "volume": 80,
    "outputs": [{ "deviceId": "...", "label": "Speakers (USB Audio)" }]
}
```

| Field         | Meaning                                                                                             |
| ------------- | --------------------------------------------------------------------------------------------------- |
| `name`        | 1-40 letters, digits, spaces, `_`, `.` or `-`. `main` cannot be changed                             |
| `leadMs`      | 10-5000, default 40                                                                                 |
| `chunkMs`     | 5-200, default 20                                                                                   |
| `volume`      | 0-100, default 100                                                                                  |
| `outputs`     | Output devices by `deviceId`, as listed under `audioOutputDevices` in the player state              |
| `playLocally` | `false` keeps the bus off this computer's speakers, for a bus only subscribers play; default `true` |
| `listeners`   | Names of the [listeners](#listeners-and-subscribers) the bus is sent to                             |

A shorter lead plays sooner but leaves less time to deliver each piece; pieces that arrive late are cut short. On a busy player a 40 ms lead is about the least that delivers every piece.

#### DELETE /api/ezp/audio/buses/:name

Remove a bus and end its leases. A built-in bus can only be changed back to its defaults, which this does for `immediate`.

#### POST /api/ezp/audio/leases

Open a lease.

```json
{ "bus": "immediate", "name": "game sounds", "sampleRate": 48000, "channels": 2, "encoding": "s16le", "ttlMs": 30000 }
```

| Field        | Meaning                                                                                       |
| ------------ | --------------------------------------------------------------------------------------------- |
| `bus`        | Bus name; `main` when omitted. A name not seen before adds that bus with default settings     |
| `name`       | A label for listings                                                                          |
| `sampleRate` | Rate of the PCM the lease will send, 8000-192000; default 48000. Other rates are converted    |
| `channels`   | 1-8; default 2. Mono plays on both sides; beyond two, the first two are used                  |
| `encoding`   | `s16le` (default) or `f32le`                                                                  |
| `gain`       | Linear gain of everything on the lease, 0-4; default 1                                        |
| `ttlMs`      | The lease closes after this long with no call or stream packet; default 30000, at most 1 hour |

```json
{
    "ok": true,
    "now": 1795408764340.19,
    "udpPort": 4050,
    "lease": {
        "id": 3,
        "token": 2914471032,
        "bus": "immediate",
        "leadMs": 40,
        "chunkMs": 20,
        "clips": [],
        "voices": 0,
        "bufferedMs": 0,
        "lateMs": 0
    }
}
```

The `token` must accompany every later call, as `?token=` or an `x-ezp-token` header. A wrong id or token answers 404.

An app process sends its `x-ezp-app-token` header too; the lease then carries `owner` (`instance` and `title`), and the time it is held counts as the instance's active time.

#### GET /api/ezp/audio/leases

Open leases, each with its clips, the number of sounds playing (`voices`), stream audio queued ahead (`bufferedMs`) and stream audio that arrived too late to play (`lateMs`, a running total).

#### DELETE /api/ezp/audio/leases/:id

Close the lease. Its sounds stop and its clips are freed.

#### POST /api/ezp/audio/leases/:id/keepalive

Keep an idle lease open.

#### POST /api/ezp/audio/leases/:id/gain

`{ "gain": 0.5 }` sets the lease's gain. The change is spread over one chunk.

#### PUT /api/ezp/audio/leases/:id/clips/:name

Store a clip under a name. The body is a WAV file (8, 16, 24 or 32-bit PCM, or float), or raw PCM in the lease's format. Sending a name again replaces the clip. A clip may be 120 s long and a lease may hold 600 s in all.

```json
{ "ok": true, "now": 1795408764340.19, "clip": { "name": "zap", "durationMs": 200 } }
```

`DELETE` on the same path removes the clip; sounds already playing finish.

#### POST /api/ezp/audio/leases/:id/play

Play a clip.

```json
{ "clip": "zap", "at": 1795408765000, "gain": 0.8, "loop": false }
```

| Field  | Meaning                                                               |
| ------ | --------------------------------------------------------------------- |
| `clip` | Name of a stored clip                                                 |
| `at`   | Player clock time to start at; as soon as the bus allows when omitted |
| `gain` | Linear gain of this sound, 0-4; default 1                             |
| `loop` | Repeat until stopped                                                  |

```json
{ "ok": true, "now": 1795408764340.19, "play": { "voice": 12, "startsAt": 1795408765000, "lateMs": 0 } }
```

`startsAt` is when the sound begins. With `at` too soon, `lateMs` is how much of the clip's start was lost. Up to 64 sounds can play on a lease at once.

#### POST /api/ezp/audio/leases/:id/stop

`{ "voice": 12, "fadeMs": 50 }` fades out one sound; without `voice`, all of the lease's. `fadeMs` defaults to 10. The reply's `stopped` is how many were stopped.

#### PUT /api/ezp/audio/leases/:id/stream

Add PCM to the lease's stream. The body is raw PCM in the lease's format, whole frames.

| Query | Meaning                                                                                             |
| ----- | --------------------------------------------------------------------------------------------------- |
| `at`  | Player clock time of the first frame. Omitted, the chunk follows the previous one                   |
| `seq` | A number that rises with each chunk; a chunk whose number is not above the last one seen is dropped |

```json
{ "ok": true, "now": 1795408764340.19, "stream": { "bufferedMs": 840, "lateMs": 0 } }
```

A chunk whose `at` is within 1.5 ms of the end of the previous chunk joins it exactly, so a client can stamp every chunk from its own count of frames. A chunk timed elsewhere starts a new run there, replacing anything queued after that time. A stream sent with no times starts two chunks later than the bus's lead, to absorb uneven delivery. Audio can be queued up to 60 s ahead.

For listeners to hear a stream on `main`, each part must arrive at least the bus's lead ahead of its time. Send ahead, not as the audio is made.

#### UDP stream packets

Stream chunks can also be sent to the player's audio port (`udpPort` in the replies; `advanced.audioPort` in playback settings, default 4050, 0 to turn it off). Each packet is one chunk. All integers are big-endian.

| Offset | Size | Field                                                                         |
| ------ | ---- | ----------------------------------------------------------------------------- |
| 0      | 4    | Magic `EZA1`                                                                  |
| 4      | 4    | Lease id                                                                      |
| 8      | 4    | Token                                                                         |
| 12     | 4    | Sequence (increment per packet)                                               |
| 16     | 8    | Time of the first frame as a 64-bit float, or 0 to follow the previous packet |
| 24     | N    | PCM in the lease's format, whole frames; keep N to 1400 or less               |

A lost packet leaves a gap of its own length when packets carry times. `scripts/audio-inject-demo.mjs` is a complete example client. The two games in the source tree, `overlay-tetris.ts` and `scripts/scene-flashlight-tag.mjs`, play their sound effects this way; each takes the bus to use as `--bus`, `immediate` by default.

#### Listeners and subscribers

Another computer can play a bus on its own speaker in two ways, both over a WebSocket:

- `ws://<player>/api/ezp/audiostream?listener=NAME` connects as a **listener** with a name of its choosing (the same characters as a bus name). The player remembers the name in settings, and the Audio settings page then offers it under each bus. The listener receives every bus that is sent to it, and plays them all.
- `ws://<player>/api/ezp/audiostream?bus=NAME` **subscribes** to one bus, whatever the settings say.

Add `&format=s16` to either for 16-bit samples instead of floats.

Each binary message is one chunk of 48 kHz stereo sound, sent the bus's lead ahead of its time. Only chunks that hold sound are sent, so a quiet bus sends nothing. A message is a 52-byte header, little-endian, then the samples:

| Offset | Type | Field                                                              |
| ------ | ---- | ------------------------------------------------------------------ |
| 0      | u32  | Magic `EZAU`                                                       |
| 4      | u8   | Version, 2                                                         |
| 5      | u8   | Codec, 0: interleaved 32-bit floats; 3: 16-bit integers            |
| 6      | u16  | Flags, 0                                                           |
| 8      | f64  | `serverNow`: the player clock when the message was sent            |
| 16     | f64  | `playAt`: the player clock time of the first frame                 |
| 24     | u32  | Run number; it changes when a chunk does not follow the one before |
| 28     | u32  | Message sequence                                                   |
| 32     | u32  | Sample rate, 48000                                                 |
| 36     | u16  | Channels, 2                                                        |
| 38     | u16  | Unused, 0                                                          |
| 40     | u32  | Frames in the chunk                                                |
| 44     | u32  | Frames until the next chunk; the same                              |
| 48     | u32  | Payload bytes                                                      |
| 52     | N    | Samples                                                            |

The client plays each chunk at its `playAt` on the player's clock. The bus's lead has to cover the network and the client's own output delay; 150 ms is a comfortable start.

`scripts/audio-bus-listen.py` is a complete listener for a Raspberry Pi or any Linux computer. It needs only Python 3 and `aplay`:

```
python3 audio-bus-listen.py http://<player>:3000 --name "Porch Pi" --device plughw:CARD=S3
```

It connects under that name (the computer's host name when none is given), keeps trying while the player is away, and plays what is sent to it. `--bus NAME` subscribes to one bus instead, and `--delay MS` tells it how long its sound card takes to make a sample heard.

Without `bus` or `listener`, or with `bus=main`, the socket carries the show audio as before.

#### GET /api/ezp/audio/listeners

The listeners the player knows, connected or not.

```json
{ "ok": true, "listeners": [{ "name": "Porch Pi", "connected": true, "addresses": ["192.168.1.40"], "buses": ["tree"] }] }
```

#### DELETE /api/ezp/audio/listeners/:name

Forget a listener and stop sending buses to it. It is listed again the next time it connects.

---

### GET /api/ezp/view-objects

Get view objects for the Show View. Returns the list of view objects (meshes and image planes) parsed from the xLights XML layout. Each entry describes an OBJ mesh or background image with its position, rotation, scale, brightness, and channel mapping.

**Request:**

- Method: GET
- Headers: None required

**Response:**

- Status: 200 OK - Array of ViewObject records (may be empty `[]` when no show is loaded)

**Example Response:**

```json
[
    {
        "name": "House",
        "displayAs": "Mesh",
        "objFile": "HouseModel/house.obj",
        "worldPosX": 0,
        "worldPosY": 0,
        "worldPosZ": 0,
        "scaleX": 1,
        "scaleY": 1,
        "scaleZ": 1,
        "rotateX": 0,
        "rotateY": 0,
        "rotateZ": 0,
        "brightness": 100,
        "active": true
    },
    {
        "name": "Background",
        "displayAs": "Image",
        "imageFile": "images/yard.png",
        "worldPosX": 0,
        "worldPosY": 50,
        "worldPosZ": -100,
        "scaleX": 1,
        "scaleY": 1,
        "scaleZ": 1,
        "rotateX": 0,
        "rotateY": 0,
        "rotateZ": 0,
        "brightness": 100,
        "transparency": 0,
        "active": true
    }
]
```

---

### GET /api/ezp/show-file

Serve a file from the current show folder. Used by the 3D viewer to load OBJ models, MTL materials, and texture images. Only accepts show-folder-relative paths and a restricted set of file extensions for security.

**Request:**

- Method: GET
- Query Parameters:
    - `path` (string, required) - Show-folder-relative file path (e.g., `HouseModel/house.obj`)

**Security Constraints:**

- Absolute paths are rejected (no drive letters or leading `/`)
- Path traversal (`..`) segments are rejected
- Only these file extensions are allowed: `.obj`, `.mtl`, `.png`, `.jpg`, `.jpeg`, `.gif`, `.webp`, `.bmp`, `.tga`, `.dds`
- Resolved path must remain within the show folder

**Response:**

- Status: 200 OK - File contents with inferred MIME type
- Status: 400 Bad Request - Missing path, absolute path, or show folder not set
- Status: 403 Forbidden - Path traversal or disallowed file extension
- Status: 404 Not Found - File does not exist
- Status: 500 Internal Server Error - Server error

**Example:**

```
GET /api/ezp/show-file?path=HouseModel/house.obj
GET /api/ezp/show-file?path=HouseModel/texture_1001.png
```

**Error Responses:**

```json
{ "error": "File path is required" }
{ "error": "Absolute paths are not allowed — use show-folder-relative paths" }
{ "error": "Path traversal not allowed" }
{ "error": "File type not allowed: .exe" }
{ "error": "Resolved path outside show folder" }
{ "error": "File not found" }
```

---

### GET /api/ezp/layout-settings

Returns layout-level settings parsed from the xLights `<settings>` element in `xlights_rgbeffects.xml`. Includes background image path, brightness, and preview canvas dimensions.

**Request:**

- Method: GET
- Headers: None required

**Response:**

- Status: 200 OK

```json
{
    "backgroundImage": "PIFar.jpg",
    "backgroundBrightness": 20,
    "previewWidth": 1280,
    "previewHeight": 720
}
```

All fields are optional — the object may be empty if no settings are present in the XML. The `backgroundImage` path is show-folder-relative and can be loaded via `/api/ezp/show-file?path=PIFar.jpg`.

When the layout has an active xLights **Ruler** view object, `ruler` says what a world unit measures:
`{ name, units, unitName, length, from, to, worldLength, unitsPerMeter }`. `units` is xLights' code
(0 m, 1 cm, 2 mm, 3 yd, 4 ft, 5 in), `length` the ruler's real length in that unit, `from`/`to` its
ends in world coordinates, and `unitsPerMeter` the number an app placing real-world things in the
layout needs. Apps should prefer it over asking the owner for a scale.

---

### GET /api/ezp/moving-heads

Get DMX moving head fixture definitions. Returns the list of `DmxMovingHead` and `DmxMovingHeadAdv` fixtures parsed from the xLights XML layout. Each entry contains everything needed to compute beam position, direction, and color from live frame data: motor definitions, color channels, beam geometry, and world transform. Returns an empty array when no show is loaded or no moving head fixtures are present.

**Request:**

- Method: GET
- Headers: None required

**Response:**

- Status: 200 OK - Array of MhFixtureInfo records (may be empty `[]`)

**Example Response:**

```json
[
    {
        "name": "House MH Left",
        "channelOffset": 115084,
        "numChannels": 14,
        "definition": {
            "panMotor": {
                "channelCoarse": 1,
                "channelFine": 2,
                "rangeOfMotion": 540,
                "orientZero": 270,
                "reverse": false
            },
            "tiltMotor": {
                "channelCoarse": 3,
                "channelFine": 4,
                "rangeOfMotion": 270,
                "orientZero": 90,
                "reverse": false
            },
            "color": {
                "colorType": "RGBW",
                "redChannel": 5,
                "greenChannel": 6,
                "blueChannel": 7,
                "whiteChannel": 8
            },
            "dimmer": { "channel": 9 },
            "shutter": { "channel": 10, "openThreshold": 128 }
        },
        "beamParams": {
            "dmxBeamWidth": 1.0,
            "dmxBeamLength": 20.0,
            "dmxBeamYOffset": 17.0,
            "dmxBeamLimit": 0,
            "meshWidth": 50.0,
            "meshHeight": 100.0,
            "meshDepth": 50.0
        },
        "worldTransform": {
            "worldPosX": 300,
            "worldPosY": 600,
            "worldPosZ": 0,
            "rotateX": 0,
            "rotateY": 0,
            "rotateZ": 0,
            "scaleX": 1,
            "scaleY": 1,
            "scaleZ": 1
        }
    }
]
```

**Field Reference:**

| Field                               | Description                                                                                                                                                                                                      |
| ----------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `name`                              | Model name as defined in xLights                                                                                                                                                                                 |
| `channelOffset`                     | 0-based start channel of this fixture in the frame buffer                                                                                                                                                        |
| `numChannels`                       | Number of DMX channels for this fixture (from `parm1`)                                                                                                                                                           |
| `definition.panMotor`               | Pan motor: coarse/fine channels, range of motion (degrees), orient-zero offset, reverse flag                                                                                                                     |
| `definition.tiltMotor`              | Tilt motor: same fields as panMotor                                                                                                                                                                              |
| `definition.color.colorType`        | One of `"RGBW"`, `"CMY"`, `"ColorWheel"`, `"None"`                                                                                                                                                               |
| `definition.dimmer.channel`         | 1-based dimmer channel (0 = no dimmer, fixture always full)                                                                                                                                                      |
| `definition.shutter.openThreshold`  | DMX value at or above which the shutter is considered open                                                                                                                                                       |
| `beamParams.dmxBeamWidth`           | Beam cone half-angle in degrees                                                                                                                                                                                  |
| `beamParams.dmxBeamLength`          | Beam length in model-space units (multiply by `sbl` for world length — see below)                                                                                                                                |
| `beamParams.dmxBeamYOffset`         | Y offset of beam emission point from fixture origin                                                                                                                                                              |
| `beamParams.dmxBeamLimit`           | Maximum world beam length cap (0 = no limit)                                                                                                                                                                     |
| `beamParams.meshWidth/Height/Depth` | Controlling mesh bounding box dimensions — used to compute world beam length: `sbl = max(meshWidth × \|scaleX\|, meshHeight × \|scaleY\|, meshDepth × \|scaleZ\|)`, then `worldBeamLength = dmxBeamLength × sbl` |
| `worldTransform`                    | Position, rotation (degrees), and scale of the fixture in world coordinates                                                                                                                                      |

**Usage:**

To render a live beam, slice `channelOffset … channelOffset + numChannels` bytes from the current frame buffer, then pass that slice along with `definition`, `beamParams`, and `worldTransform` to the `xllayoutcalcs` functions `mhChannelsToState` and `computeBeamDescriptor`. The resulting `MhBeamDescriptor` gives world-space `origin`, `direction`, `length`, `coneHalfAngle`, and color.

---

### POST /api/ezp/shell/reload

Re-read the remote-access configuration (remote shell / file manager enable
flags and password) without restarting the player. The `EZPlayer shell` CLI
calls this after changing the password so a running player picks it up.

**Request:**

- Method: POST
- Body: none

**Response:**

- Status: 200 OK — the new `RemoteAccessAvailability` state
- Status: 403 Forbidden — `{"error": "this endpoint is loopback-only"}`

This endpoint is **loopback-only**: any client that is not on
`127.0.0.1`/`::1` is refused. Disabling a tile takes
effect on sessions already in flight — an open remote shell or file-manager
session is closed rather than left running.

---

### GET /api/ezp/debug-show-folder

Diagnostic endpoint. Returns the current show folder path and a dump of all cached server state. Intended for development and troubleshooting only.

**Request:**

- Method: GET
- Headers: None required

**Response:**

- Status: 200 OK

```json
{
    "showFolder": "/path/to/show",
    "hasShowFolder": true,
    "allStateKeys": ["showFolder", "sequences", "playlists", "..."],
    "state": { "...full cached state..." }
}
```

---

### /proxy/\<target-url\>

HTTP and WebSocket proxy for multi-NIC bridging. Forwards requests to a target URL extracted from the path. Allows the browser-based UI to reach devices on networks that are only reachable from the server host (e.g., a light controller on a dedicated NIC).

**URL Pattern:**

```
/proxy/<full-target-URL>
```

The protocol prefix is optional; `http://` is assumed when omitted.

**Examples:**

```
GET  /proxy/http://192.168.1.50:8080/api/status
POST /proxy/192.168.1.50/api/config
WS   /proxy/ws://192.168.1.50:9090/ws
```

**Behavior:**

- All HTTP methods are forwarded (GET, POST, PUT, DELETE, PATCH, etc.)
- Request headers are forwarded with hop-by-hop headers stripped
- Request body is streamed through for POST/PUT/PATCH
- WebSocket upgrade requests are proxied transparently
- 30-second request timeout

**Response:**

- Status and headers from the target are returned as-is
- Status: 400 Bad Request - Invalid or missing target URL in path

---

### Player apps (`/api/ezp/apps`)

:::note
Requires EZPlayer 0.7 or later.
:::

Apps are programs the player installs into the show folder, starts and supervises. The player serves
their pages, keeps their documents and delivers events to them. Everything an app does to the show
goes through the other APIs on this page: overlays, scene objects, audio buses. See
[Apps](../advanced/apps.md) for the owner's view.

#### The package

A package is a directory with `ezapp.json` at its root:

```json
{
    "id": "tetris",
    "name": "Tetris",
    "version": "1",
    "description": "Play on a matrix from your phone",
    "icon": "🧱",
    "runtime": "node",
    "start": ["tetris.mjs"],
    "page": "page/",
    "config": "config/",
    "inputs": [{ "name": "left", "kind": "event" }],
    "platforms": ["win32", "darwin", "linux"],
    "events": { "perMinute": 1200, "perClientPerSecond": 15 }
}
```

| Field       | Meaning                                                                                                                                  |
| ----------- | ---------------------------------------------------------------------------------------------------------------------------------------- |
| `id`        | Lower-case letters, digits and dashes, up to 40. Also the directory name under `<show>/apps/`.                                           |
| `runtime`   | `node` (the player's own Node), `python3` (found on the PATH or set on the Apps card) or `binary`.                                        |
| `start`     | Arguments after the runtime. For `binary`, the first is the executable, relative to the package.                                         |
| `page`      | The visitors' page: a directory inside the package served as static files, or `{"proxy": true}` to forward to the app's own HTTP server. |
| `config`    | The owner's settings page, same forms. Served even while the instance is stopped.                                                        |
| `inputs`    | Show inputs the app accepts: `kind` is `event` (a press), `value` (a level or open/closed), `text` or `object` (a structured value, such as a pose). The Apps card offers a sender to an input only when what it sends fits the kind. |
| `platforms` | `process.platform` values the app runs on; absent means all.                                                                             |
| `events`    | The event rate the app needs: `perMinute` across every phone (default 600, at most 6000) and `perClientPerSecond` for one phone (default 10, at most 60). A game that sends every tap asks here; a game that adds taps up on the phone and sends one number a second does not need to. The owner can still change an instance's per-minute rate on the Apps card. |

Packages install from a folder, from an `https` `.tar.gz` (every directory with a manifest becomes an
app) or from the contrib repository, with `POST /api/ezp/apps/command`.

#### The process

Each enabled instance is one process, started with the package directory as its working directory and
this environment:

| Variable           | Value                                                                       |
| ------------------ | --------------------------------------------------------------------------- |
| `EZP_API_URL`      | `http://127.0.0.1:<port>`, the player's web API                             |
| `EZP_APP_ID`       | The package id                                                              |
| `EZP_APP_INSTANCE` | The instance name                                                           |
| `EZP_APP_TOKEN`    | A secret, new on every start, for the routes only the process may call      |
| `EZP_APP_DATA_DIR` | `<show>/apps-data/<instance>`; the data API is the portable way to use it   |
| `EZP_APP_PORT`     | A free port to bind, for an app that serves its own page                    |
| `EZP_SHOW_FOLDER`  | The show folder                                                             |

stdout and stderr go to `apps/<instance>.log` in the player's logs directory (rotating, and in the
support bundle). The process is restarted with backoff after it exits (1, 5, 15, 60 s), then left
failed. It is stopped with SIGTERM (the whole tree on Windows) and killed after 5 s. Outside the
instance's availability window it is not running.

#### Events in

`POST /api/ezp/apps/:instance/events` — anyone. JSON `{ "client": "<id>", "data": <any> }`, up to 64 KB.
The player stamps the event and answers `{ "ok": true, "id": n }`. Refused with 429 when the sender or
the instance is over its rate (600 per minute per instance and ten a second per sender unless the manifest's
`events` asks for more; the owner can set the per-minute rate on the Apps card; a sender gets a burst of
three seconds' worth, never under 30), 503 when the instance is not running.

`GET /api/ezp/apps/:instance/events?since=<id>&wait=<seconds>` — the process, with `x-ezp-app-token`
(or `?token=`). Long poll: answers at once when events newer than `since` exist, otherwise holds up to
`wait` seconds (60 at most) and answers `{ "events": [] }`. Events:

```json
{ "events": [{ "id": 12, "ts": 1700000000000, "source": "cloud", "client": "k3j2…", "data": { "type": "left" } }] }
```

`source` is `cloud` (through the show's cloud page), `lan`, `card`, or `input:<source>` for a show
input. The last 1000 events of the current run are kept; a new process starts with an empty feed.

#### Status out

`PUT /api/ezp/apps/:instance/status` — the process, with the token. Any JSON up to 4 MB. The player
numbers it and pushes it to every subscriber.

`GET /api/ezp/apps/:instance/status` — anyone. `{ "seq": n, "at": ms, "state": <the JSON> }`, `seq` 0
before the first.

`WS /api/ezp/apps/:instance/live` — anyone. Push only: `{ "type": "status", "seq", "at", "state" }` on
connect (when there is one) and after every change. Inbound frames are ignored.

#### Documents

`GET /api/ezp/apps/:instance/data/:scope` lists keys; `GET`, `PUT`, `DELETE
/api/ezp/apps/:instance/data/:scope/:key` read, write and remove one. `scope` is `public` (anyone may
read) or `private` (the process and the owner). Keys are letters, digits, dot, dash and underscore, up
to 64. A document is stored as sent, with its content type; up to 4 MB each and 16 MB per instance. On
the LAN both scopes are open, like the rest of the API; through the cloud only `public` reads are
offered to visitors.

#### Pages

- `_sdk.js`, next to every page at any depth under an instance, loaded with a relative
  `<script src="_sdk.js">`. `EZApp.connect()` gives an object with `ready` (a promise), `send(data)`,
  `onStatus(cb)`, `status()`, `get(scope, key)`, `put(scope, key, value)`, `remove(scope, key)`,
  `clientId`, and `apiBase` (`''` on the LAN, meaning the player is this origin; `null` through the
  cloud). The SDK asks `_context.json` beside itself whether the page is on the LAN
  (`{mode:'lan', instance}`, answered by the player) or on the show's cloud page
  (`{mode:'cloud', slug, instance}`, answered by the cloud), and picks the endpoints.
- `/apps/:instance/…` — the visitors' page. 503 with a short HTML page while the instance is not
  running.
- `/apps/:instance/config/…` — the owner's settings page.

A `{"proxy": true}` page is forwarded to the instance's port with the original method, path and body
(2 MB in, 8 MB out, 30 s), buffered; the app sees the mount path in `x-ezp-app-base`.

#### Show inputs

`POST /api/ezp/inputs/:source/:name` (or `GET`, for boards that cannot post) with an optional
`{ "value": … }` body or `?value=`. The Apps card's mapping table says which instance inputs each one
drives; the app receives `{ "type": "input", "input": "<name>", "source", "name", "value" }` as an
event with source `input:<source>`. Answers `{ "ok": true, "delivered": n }`.

#### Owner

`GET /api/ezp/apps` returns the apps state: installed packages, instances with state, startup report
and log tail, default schedule, Python path, input mappings, `recentInputs` and `usage`.
`recentInputs` lists the last fifty senders heard at `/api/ezp/inputs`, newest first, each with its
post count, last time, how many instances the last post reached, a short rendering of the last value
and its `shape` (`none`, `boolean`, `number`, `text` or `object`). `usage` is by instance name:
`runs`, `runMs`, `activeMs` while it held an overlay or audio lease, `requests` from visitors and
the `events` among them, `firstRunAt`, `lastRunAt`, `lastActiveAt`; counted by the player, kept in
`.ezplayer/apps-usage.json`. `POST /api/ezp/apps/command` takes one
of: `rescan`, `install` (`source`: `{kind:"folder",path}`, `{kind:"url",url}` or `{kind:"contrib"}`),
`uninstall`, `createInstance`, `removeInstance`, `setInstance` (patch `enabled`, `schedule`, `title`,
`eventsPerMinute`), `start`, `stop`, `restart`, `setDefaultSchedule`, `setPythonPath`,
`setInputMappings`, `resetUsage`. The same state is in the WebSocket snapshot under `apps`, and the latest status of
every instance under `appStatuses`.

---

## WebSocket API

### Connection

- Endpoint: `ws://localhost:{port}/ws`
- Protocol: WebSocket (ws:// or wss://)

**Connection Behavior:**

- Server sends initial state snapshot on connection
- Heartbeat ping every 5 seconds
- Client must respond with pong within 15 seconds
- Maximum buffer: 8MB per connection
- Automatic reconnection supported (client-side)

### Server-to-Client Messages

#### snapshot

State update broadcast. Broadcasts player state updates. Contains version numbers for each state key and partial state data.

**Message Format:**

```json
{
  "type": "snapshot",
  "v": { "<key>": <version_number>, ... },
  "data": { "<key>": <value>, ... }
}
```

**Example:**

```json
{
    "type": "snapshot",
    "v": {
        "showFolder": 1,
        "sequences": 5,
        "playlists": 3,
        "schedule": 2,
        "user": 1,
        "show": 1,
        "cStatus": 10,
        "pStatus": 25,
        "nStatus": 8,
        "playbackSettings": 2,
        "playbackStatistics": 15,
        "versions": 1
    },
    "data": {
        "pStatus": {
            "ptype": "EZP",
            "status": "Playing",
            "reported_time": 1704067200000,
            "now_playing": {
                "type": "Scheduled",
                "item": "Playlist",
                "title": "Christmas Songs",
                "at": 1704067200000
            },
            "volume": {
                "level": 75,
                "muted": false
            },
            "brightness": {
                "level": 100,
                "colorTemperature": 6500,
                "scheduled": false
            }
        }
    }
}
```

**When `pStatus` is pushed:** the playback engine publishes it about once a
second while running, and immediately on every playback event — a song
starting or ending on its own, a play/skip/stop command, pause and resume, and
queue changes — so a song-to-song change reaches clients within a frame rather
than on the next tick. While playing, `position` gives where the song is:
`content_ms` into the sequence at `sampled_at` (player epoch ms, the engine
clock — the time of the frame being output, within a frame of `reported_time`),
and `audio_ms`, the audio file position as heard on the player, i.e. with the
audio sync adjust applied. Clients that follow playback should extrapolate from
the latest `position` using their measured clock offset to the player (the
`serverNow` in REST responses helps measure it) rather than from
`reported_time`.

**State Keys (FullPlayerState):**

| Key                  | Type                 | Description                  |
| -------------------- | -------------------- | ---------------------------- |
| `showFolder`         | string               | Current show folder path     |
| `sequences`          | SequenceRecord[]     | Array of sequences           |
| `playlists`          | PlaylistRecord[]     | Array of playlists           |
| `schedule`           | ScheduledPlaylist[]  | Array of scheduled playlists |
| `cStatus`            | PlayerCStatusContent | Controller status            |
| `pStatus`            | PlayerPStatusContent | Playback status              |
| `nStatus`            | PlayerNStatusContent | Network status               |
| `playbackSettings`   | PlaybackSettings     | Playback settings            |
| `playbackStatistics` | PlaybackStatistics   | Playback statistics          |
| `versions`           | EZPlayerVersions     | Version info                 |
| `cloudConfig`        | CloudConfig          | Cloud connection settings    |
| `cloudStatus`        | CloudStatus          | Cloud link status            |
| `controllerops`      | ControllerOpsState   | Controller discovery, operations, known controllers and network policies — one atomic snapshot |
| `remoteAccess`       | RemoteAccessAvailability | Which password-gated remote-access tiles this player offers |
| `autoUpdateOps`      | AutoUpdateOpsState   | Update settings, status and available releases |
| `audioOutputDevices` | AudioDevice[]        | Physical audio outputs on the player machine |
| `appSettings`        | AppSettingsState     | Machine-wide settings: diagnostics consent, start at sign-in |

**Behavior:**

- Version numbers increment on each update
- Only changed keys are included in `data`
- Multiple updates to the same key are coalesced (latest wins)
- Client receives full snapshot on initial connection

#### ping

Heartbeat ping. Server sends ping every 5 seconds to check connection health. Client must respond with pong.

**Message Format:**

```json
{
    "type": "ping",
    "now": 1704067200000
}
```

Client must send a `pong` message with the same `now` value within 15 seconds.

Timeout: If no pong received within 15 seconds, server disconnects with a `kick` message.

#### kick

Server-initiated disconnection. Server sends this before disconnecting a client. Reasons include heartbeat timeout or excessive buffering.

**Message Format:**

```json
{
    "type": "kick",
    "reason": "heartbeat timeout"
}
```

**Common Reasons:**

- `"heartbeat timeout"` - Client didn't respond to pings within 15 seconds
- `"backpressure: buffered={bytes}"` - Client buffer exceeded 8MB limit

#### bridgeStatus

Sent by the **cloud bridge only**, never by a player's own WebSocket: it tells
cloud viewers whether the player↔cloud socket is currently up. Viewers get one
on connect with the current state, and one whenever the player connects or
disconnects at the bridge. A client talking straight to a player will never
see it.

**Message Format:**

```json
{
    "type": "bridgeStatus",
    "playerConnected": true
}
```
- `"socket closed"` - Connection closed
- `"socket error"` - Connection error
- `"send failed"` - Failed to send message

After sending kick, the server closes the connection.

### Client-to-Server Messages

#### pong

Response to server ping. Client must respond to server ping messages to maintain the connection.

**Message Format:**

```json
{
    "type": "pong",
    "now": 1704067200000
}
```

**Requirements:**

- Must be sent within 15 seconds of receiving ping
- Must use the same `now` value from the ping message
- Failure to respond results in disconnection

#### subscribe (defined but not yet implemented)

> **Note:** The `subscribe` message type is defined in the TypeScript types (`PlayerClientWebSocketMessage`) but the server does not currently process it. All clients receive updates for all state keys. This may be implemented in a future release.

**Message Format:**

```json
{
    "type": "subscribe",
    "keys": ["pStatus", "cStatus", "playbackSettings"]
}
```

**Valid Keys:** All keys from FullPlayerState (see State Keys table above).

---

### WebSocket Features

#### Heartbeat Mechanism

- Server sends ping every 5 seconds
- Client must respond with pong within 15 seconds
- Timeout results in kick and disconnection

#### Backpressure Management

- Maximum buffer: 8MB per connection
- Server monitors `bufferedAmount`
- If buffer exceeds limit, server sends kick and disconnects
- Prevents memory issues with slow clients

#### State Versioning

- Each state key has a version number
- Versions increment on each update
- Client can track which updates it has received
- Enables efficient state synchronization

#### Update Coalescing

- Multiple rapid updates to the same key are coalesced
- Only the latest value is sent
- Reduces network traffic
- Prevents client from being overwhelmed

---

## Error Handling

### HTTP Error Responses

All REST API endpoints may return the following error responses:

**400 Bad Request:**

```json
{
    "error": "Error description"
}
```

**404 Not Found:**

```json
{
    "error": "Resource not found"
}
```

**500 Internal Server Error:**

```json
{
    "error": "Internal server error"
}
```

**503 Service Unavailable:**

```json
{
    "error": "Service unavailable description"
}
```

### WebSocket Error Handling

- Connection errors: Client should attempt reconnection
- Parse errors: Invalid JSON messages are ignored
- Timeout errors: Server disconnects after timeout
- Buffer overflow: Server disconnects when buffer exceeds limit

---

## Complete WebSocket Workflow Example

```javascript
// Connect to WebSocket
const ws = new WebSocket('ws://localhost:3000/ws');

// Handle connection
ws.onopen = () => {
    console.log('Connected');
};

// Handle messages
ws.onmessage = (event) => {
    const message = JSON.parse(event.data);

    switch (message.type) {
        case 'snapshot':
            console.log('State update:', message.data);
            break;
        case 'ping':
            // Respond to ping
            ws.send(
                JSON.stringify({
                    type: 'pong',
                    now: message.now,
                }),
            );
            break;
        case 'kick':
            console.log('Kicked:', message.reason);
            ws.close();
            break;
    }
};

// Handle errors
ws.onerror = (error) => {
    console.error('WebSocket error:', error);
};

// Handle close
ws.onclose = () => {
    console.log('Disconnected');
};
```
