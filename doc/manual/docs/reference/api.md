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
- Body: FullPlayerState object

```json
{
  "showFolder": "/path/to/show",
  "sequences": [...],
  "playlists": [...],
  "schedule": [...],
  "user": {...},
  "show": {...},
  "pStatus": {...},
  "cStatus": {...},
  "nStatus": {...}
}
```

---

### GET /api/ezp/getimage/:sequenceId

Get sequence thumbnail image. Serves thumbnail images for sequences by sequence ID. Supports multiple image formats (PNG, JPG, JPEG, GIF, WEBP, SVG, ICO, BMP).

**Request:**

- Method: GET
- Path Parameters:
    - `sequenceId` (string, required) - Sequence identifier (alphanumeric, hyphens, underscores only)

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
| `suppressoutput`    | Continue playback but suppress audio/video output                                    |                                                    |
| `activateoutput`    | Re-enable audio/video output                                                         |                                                    |
| `playsong`          | Play or enqueue a song                                                               | `songId`, `immediate`, `priority`, `requestId`     |
| `playplaylist`      | Play or enqueue a playlist                                                           | `playlistId`, `immediate`, `priority`, `requestId` |
| `deleterequest`     | Cancel a pending song or playlist request                                            | `requestId`                                        |
| `clearrequests`     | Clear all pending requests                                                           |                                                    |
| `setvolume`         | Set volume level and/or mute                                                         | `volume?`, `mute?`                                 |

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

**Response:**

- Status: 200 OK - Command sent successfully
- Status: 400 Bad Request - Invalid command format
- Status: 503 Service Unavailable - Playback worker not available
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
work unchanged. EZPlayer show folders are flat, so every logical directory maps
to the show folder root with an extension filter:

| `:dirName`  | Contents                                              |
| ----------- | ----------------------------------------------------- |
| `sequences` | `*.fseq`                                              |
| `music`     | `*.mp3 *.m4a *.aac *.wav *.ogg *.flac *.wma`          |
| `videos`    | `*.mp4 *.mkv *.avi *.mov *.mpg *.mpeg`                |
| `images`    | `*.gif *.jpg *.jpeg *.png *.webp *.bmp`               |
| `uploads`   | everything (minus protected/dot files)                |

| Method   | Path                        | Purpose                                                                                      |
| -------- | --------------------------- | -------------------------------------------------------------------------------------------- |
| `GET`    | `/api/files/:dirName`       | List: `{status:"ok", files:[{name,mtime,sizeBytes,sizeHuman,playtimeSeconds}]}`; `?nameOnly=1` returns a plain name array |
| `GET`    | `/api/file/:dirName/:name`  | Download (attachment); `?play=1` streams inline with a media content type                     |
| `POST`   | `/api/file/:dirName/:name`  | Single-shot upload, file bytes as the raw request body                                        |
| `POST`   | `/api/file/:dirName`        | Chunked-upload init; returns an id (plain text)                                               |
| `PATCH`  | `/api/file/:dirName`        | Upload one chunk; headers `Upload-Name`, `Upload-Offset`, `Upload-Length` (raw body = chunk)  |
| `DELETE` | `/api/file/:dirName/:name`  | Delete a file                                                                                 |
| `GET`    | `/api/media`                | Music + video file names (array)                                                              |
| `GET`    | `/api/sequence`             | Sequence base names, no `.fseq` extension (array)                                             |
| `GET`    | `/api/sequence/:name`       | Download `<name>.fseq`                                                                        |
| `POST`   | `/api/sequence/:name`       | Upload `<name>.fseq` (raw body) → `{"Status":"OK","Message":""}`                              |

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
  "networkPolicies": [ { "cidr": "192.168.1.0/24", "allow": false } ]
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
| `upload`            | Push xLights config: `{ "cmd": "upload", "id": "…", "scope": "inputs"\|"strings"\|"full", "fullControl": true\|false }`. |
| `record`            | Create/update a persisted controller record: `{ "cmd": "record", "name": "…", "patch": { … } }`. |
| `network`           | Update a per-network policy: `{ "cmd": "network", "cidr": "…", "patch": { "allow": false } }`. |
| `refreshInterfaces` | Re-enumerate this host's networks.                                 |

Verbs other than `scan` return `{"ok":true}` immediately; results and progress
ride the shared `controllerops` state (WebSocket broadcast, or re-poll the GET).
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

### GET /api/ezp/model-coordinates

Get model coordinates for 3D preview. Returns coordinate data used to render the 3D light layout preview.

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
    "now": 1704067200000
}
```

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

### GET /api/ezp/view-objects

Get view objects for the 3D preview. Returns the list of view objects (meshes and image planes) parsed from the xLights XML layout. Each entry describes an OBJ mesh or background image with its position, rotation, scale, brightness, and channel mapping.

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

To render a live beam, slice `channelOffset … channelOffset + numChannels` bytes from the current frame buffer, then pass that slice along with `definition`, `beamParams`, and `worldTransform` to the `xllayoutcalcs` functions `mhChannelsToState` and `computeBeamDescriptor`. The resulting `MhBeamDescriptor` gives world-space `origin`, `direction`, `length`, `coneHalfAngle`, and colour.

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
            }
        }
    }
}
```

**State Keys (FullPlayerState):**

| Key                  | Type                 | Description                  |
| -------------------- | -------------------- | ---------------------------- |
| `showFolder`         | string               | Current show folder path     |
| `sequences`          | SequenceRecord[]     | Array of sequences           |
| `playlists`          | PlaylistRecord[]     | Array of playlists           |
| `schedule`           | ScheduledPlaylist[]  | Array of scheduled playlists |
| `user`               | EndUser              | User object                  |
| `show`               | EndUserShowSettings  | Show settings object         |
| `cStatus`            | PlayerCStatusContent | Controller status            |
| `pStatus`            | PlayerPStatusContent | Playback status              |
| `nStatus`            | PlayerNStatusContent | Network status               |
| `playbackSettings`   | PlaybackSettings     | Playback settings            |
| `playbackStatistics` | PlaybackStatistics   | Playback statistics          |
| `versions`           | EZPlayerVersions     | Version info                 |

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
