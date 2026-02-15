# EZPlayer API Documentation

## Koa Server REST APIs

### 1. GET /api/hello

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

### 2. GET /api/current-show

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

### 3. GET /api/getimage/:sequenceId

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

### 4. POST /api/player-command

Send player command. Sends a command to control player playback, volume, or request playback of songs/playlists.

**Request:**
- Method: POST
- Headers:
  - Content-Type: application/json
- Body: EZPlayerCommand object

**Available Commands:**

| Command | Description | Additional Fields |
|---------|-------------|-------------------|
| `stopnow` | Stop all playing immediately | |
| `stopgraceful` | Stop all playing at a convenient spot | |
| `pause` | Pause all playback | |
| `resume` | Resume playback | |
| `reloadcontrollers` | Reset playback from current show folder, reloading network and reopening controllers | |
| `resetplayback` | Reread and reset playback from current schedule items | |
| `resetstats` | Reset cumulative stats counters | |
| `suppressoutput` | Continue playback but suppress audio/video output | |
| `activateoutput` | Re-enable audio/video output | |
| `playsong` | Play or enqueue a song | `songId`, `immediate`, `priority`, `requestId` |
| `playplaylist` | Play or enqueue a playlist | `playlistId`, `immediate`, `priority`, `requestId` |
| `deleterequest` | Cancel a pending song or playlist request | `requestId` |
| `clearrequests` | Clear all pending requests | |
| `setvolume` | Set volume level and/or mute | `volume?`, `mute?` |

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

### 5. POST /api/playlists

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

### 6. POST /api/schedules

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

### 7. POST /api/playback-settings

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

### 8. GET /api/model-coordinates

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

### 9. GET /api/model-coordinates-2d

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

### 10. GET /api/frames

Get binary frame data for the live 3D viewer. Returns the latest frame of light channel data as a binary `application/octet-stream` response.

**Request:**
- Method: GET
- Headers: None required

**Response:**
- Status: 200 OK - Binary frame data (`application/octet-stream`)
- Status: 204 No Content - No frame data available yet

**Response Binary Format:**

| Offset | Size | Type | Description |
|--------|------|------|-------------|
| 0 | 4 bytes | uint32 LE | Frame size in bytes |
| 4 | 4 bytes | uint32 LE | Sequence number |
| 8 | N bytes | raw | Frame data |

**Response Headers:**
- `Cache-Control: no-store`
- `Content-Type: application/octet-stream`
- `Access-Control-Allow-Origin: *`

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

#### 1. snapshot

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

| Key | Type | Description |
|-----|------|-------------|
| `showFolder` | string | Current show folder path |
| `sequences` | SequenceRecord[] | Array of sequences |
| `playlists` | PlaylistRecord[] | Array of playlists |
| `schedule` | ScheduledPlaylist[] | Array of scheduled playlists |
| `user` | EndUser | User object |
| `show` | EndUserShowSettings | Show settings object |
| `cStatus` | PlayerCStatusContent | Controller status |
| `pStatus` | PlayerPStatusContent | Playback status |
| `nStatus` | PlayerNStatusContent | Network status |
| `playbackSettings` | PlaybackSettings | Playback settings |
| `playbackStatistics` | PlaybackStatistics | Playback statistics |
| `versions` | EZPlayerVersions | Version info |

**Behavior:**
- Version numbers increment on each update
- Only changed keys are included in `data`
- Multiple updates to the same key are coalesced (latest wins)
- Client receives full snapshot on initial connection

#### 2. ping

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

#### 3. kick

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

#### 1. pong

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

#### 2. subscribe (defined but not yet implemented)

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
      ws.send(JSON.stringify({
        type: 'pong',
        now: message.now
      }));
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
