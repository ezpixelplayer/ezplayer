# EZPlayer API Documentation

## Koa Server REST APIs

### GET /api/hello

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

### GET /api/current-show

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

### GET /api/getimage/:sequenceId

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
GET /api/getimage/seq-123-abc
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

### POST /api/player-command

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

### POST /api/playlists

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

### POST /api/schedules

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

### POST /api/playback-settings

Update playback settings. Updates playback configuration settings including audio sync, background sequence mode, viewer control, and volume control.

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
    }
}
```

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

### GET /api/model-coordinates

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

### GET /api/model-coordinates-2d

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

### GET /api/frames

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

### GET /api/frames-zstd

Get ZSTD-compressed binary frame data for the live 3D viewer. Same semantics as `/api/frames` but the frame payload is compressed with ZSTD at level 1 (fastest). Useful for remote/embedded clients on bandwidth-constrained links.

**Request:**

- Method: GET
- Headers: None required

**Response:**

- Status: 200 OK - Compressed binary frame data (`application/octet-stream`)
- Status: 204 No Content - No frame data available yet
- Status: 503 Service Unavailable - ZSTD codec not yet initialized

**Response Binary Format:**

| Offset | Size    | Type      | Description                         |
| ------ | ------- | --------- | ----------------------------------- |
| 0      | 4 bytes | uint32 LE | Uncompressed frame size in bytes    |
| 4      | 4 bytes | uint32 LE | Sequence number                     |
| 8      | N bytes | raw       | ZSTD-compressed frame data (level 1)|

The 8-byte header is **not** compressed. Decompress the payload starting at offset 8 to recover the original frame bytes.

**Response Headers:**

- `Cache-Control: no-store`
- `Content-Type: application/octet-stream`
- `Access-Control-Allow-Origin: *`

---

### GET /api/time

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
const res = await fetch('/api/time');
const t1 = Date.now();
const { now: serverNow } = await res.json();
const rtt = t1 - t0;
const clockOffset = serverNow - (t0 + rtt / 2);
// To convert server timestamps to local time: localTime = serverTime - clockOffset
```

---

### GET /api/audio

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

| Offset | Size    | Type      | Description                          |
| ------ | ------- | --------- | ------------------------------------ |
| 0      | 4 bytes | uint32 LE | Chunk count                          |
| 4      | 4 bytes | uint32 LE | Latest sequence number (use as next `afterSeq`) |

**Per-chunk (repeated `chunkCount` times):**

| Offset | Size             | Type      | Description                                  |
| ------ | ---------------- | --------- | -------------------------------------------- |
| 0      | 8 bytes          | float64 LE | `playAtRealTime` - server wall-clock time (ms) when chunk should play |
| 8      | 4 bytes          | uint32 LE | `incarnation` - increments on song/segment boundaries |
| 12     | 4 bytes          | uint32 LE | `sampleRate` - e.g. 48000                    |
| 16     | 4 bytes          | uint32 LE | `channels` - number of audio channels        |
| 20     | 4 bytes          | uint32 LE | `sampleCount` - total number of Float32 samples (all channels interleaved) |
| 24     | sampleCount × 4  | Float32 LE | Interleaved audio sample data                |

**Response Headers:**

- `Cache-Control: no-store`
- `Content-Type: application/octet-stream`
- `Access-Control-Allow-Origin: *`

**Notes:**

- `playAtRealTime` is a server-side `Date.now()` timestamp. Remote clients should use the `/api/time` endpoint to estimate clock offset and adjust accordingly.
- `incarnation` changes when a new song or audio segment begins. Clients should reset their audio scheduling state when incarnation changes.
- Audio samples are interleaved: for stereo, the pattern is `[L0, R0, L1, R1, ...]`. Clients must deinterleave into per-channel buffers for Web Audio API playback.
- The ring buffer holds approximately 5 seconds of audio. If a client falls behind, the oldest chunks are silently lost. The response will include chunks starting from the oldest still available.
- Polling at ~50ms intervals is recommended for smooth playback.

**Example (curl):**

```bash
# First request - get all available chunks
curl http://localhost:3000/api/audio?afterSeq=0 --output audio.bin

# Subsequent requests - only get new chunks
curl http://localhost:3000/api/audio?afterSeq=42 --output audio.bin
```

---

### GET /api/view-objects

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
        "worldPosX": 0, "worldPosY": 0, "worldPosZ": 0,
        "scaleX": 1, "scaleY": 1, "scaleZ": 1,
        "rotateX": 0, "rotateY": 0, "rotateZ": 0,
        "brightness": 100,
        "active": true
    },
    {
        "name": "Background",
        "displayAs": "Image",
        "imageFile": "images/yard.png",
        "worldPosX": 0, "worldPosY": 50, "worldPosZ": -100,
        "scaleX": 1, "scaleY": 1, "scaleZ": 1,
        "rotateX": 0, "rotateY": 0, "rotateZ": 0,
        "brightness": 100,
        "transparency": 0,
        "active": true
    }
]
```

---

### GET /api/show-file

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
GET /api/show-file?path=HouseModel/house.obj
GET /api/show-file?path=HouseModel/texture_1001.png
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

### GET /api/layout-settings

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

All fields are optional — the object may be empty if no settings are present in the XML. The `backgroundImage` path is show-folder-relative and can be loaded via `/api/show-file?path=PIFar.jpg`.

---

### GET /api/moving-heads

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

| Field | Description |
| --- | --- |
| `name` | Model name as defined in xLights |
| `channelOffset` | 0-based start channel of this fixture in the frame buffer |
| `numChannels` | Number of DMX channels for this fixture (from `parm1`) |
| `definition.panMotor` | Pan motor: coarse/fine channels, range of motion (degrees), orient-zero offset, reverse flag |
| `definition.tiltMotor` | Tilt motor: same fields as panMotor |
| `definition.color.colorType` | One of `"RGBW"`, `"CMY"`, `"ColorWheel"`, `"None"` |
| `definition.dimmer.channel` | 1-based dimmer channel (0 = no dimmer, fixture always full) |
| `definition.shutter.openThreshold` | DMX value at or above which the shutter is considered open |
| `beamParams.dmxBeamWidth` | Beam cone half-angle in degrees |
| `beamParams.dmxBeamLength` | Beam length in model-space units (multiply by `sbl` for world length — see below) |
| `beamParams.dmxBeamYOffset` | Y offset of beam emission point from fixture origin |
| `beamParams.dmxBeamLimit` | Maximum world beam length cap (0 = no limit) |
| `beamParams.meshWidth/Height/Depth` | Controlling mesh bounding box dimensions — used to compute world beam length: `sbl = max(meshWidth × \|scaleX\|, meshHeight × \|scaleY\|, meshDepth × \|scaleZ\|)`, then `worldBeamLength = dmxBeamLength × sbl` |
| `worldTransform` | Position, rotation (degrees), and scale of the fixture in world coordinates |

**Usage:**

To render a live beam, slice `channelOffset … channelOffset + numChannels` bytes from the current frame buffer, then pass that slice along with `definition`, `beamParams`, and `worldTransform` to the `xllayoutcalcs` functions `mhChannelsToState` and `computeBeamDescriptor`. The resulting `MhBeamDescriptor` gives world-space `origin`, `direction`, `length`, `coneHalfAngle`, and colour.

---

### GET /api/debug-show-folder

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
