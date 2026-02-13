# Koa Server API’s

**Koa Server API’s**

### **1\. GET /api/hello**

Health check endpoint.Description: Simple endpoint to verify the server is running.Request:

* Method: GET  
* Headers: None required

Response:

* Status: 200 OK  
* Body:  
  {  
    "message": "Hello from Koa \+ Electron\!"

}

---

### **2\. GET /api/current-show**

Get current show data.Description: Returns the complete current show state, including sequences, playlists, schedules, user info, and status.Request:

* Method: GET  
* Headers: None required

Response:

* Status: 200 OK  
* Body: FullPlayerState object


  


  


  {

    "showFolder": "/path/to/show",

    "sequences": \[*...*\],

    "playlists": \[*...*\],

    "schedule": \[*...*\],

    "user": {*...*},

    "show": {*...*},

    "pStatus": {*...*},

    "cStatus": {*...*},

    "nStatus": {*...*}

  }

---

### **3\. GET /api/getimage/:sequenceId**

Get sequence thumbnail image.Description: Serves thumbnail images for sequences by sequence ID. Supports multiple image formats (PNG, JPG, JPEG, GIF, WEBP, SVG, ICO, BMP).Request:

* Method: GET  
* Path Parameters:  
* sequenceId (string, required) \- Sequence identifier (alphanumeric, hyphens, underscores only)

Response:

* Status: 200 OK \- Image file with appropriate MIME type  
* Status: 400 Bad Request \- Invalid or missing sequence ID  
* Status: 404 Not Found \- Image not found for sequence ID

Example:

GET /api/getimage/seq-123-abc

Error Response (400):

{

  "error": "Invalid sequence ID"

}

Error Response (404):

{

  "error": "Image not found for sequence ID"

}

---

### **4\. POST /api/player-command**

Send player command.Description: Sends a command to control player playback, volume, or request playback of songs/playlists.Request:

* Method: POST  
* Headers:  
* Content-Type: application/json  
* Body: EZPlayerCommand object

Request Body Examples:Stop playback immediately:

{

  "command": "stopnow"

}

Play a song immediately:

{

  "command": "playsong",

  "songId": "seq-123",

  "immediate": true,

  "priority": 1,

  "requestId": "req-456"

}

Set volume:

{

  "command": "setvolume",

  "volume": 75,

  "mute": false

}

Response:

* Status: 200 OK \- Command sent successfully  
* Status: 400 Bad Request \- Invalid command format  
* Status: 503 Service Unavailable \- Playback worker not available  
* Status: 500 Internal Server Error \- Server error

Success Response:

{

  "success": true,

  "message": "Command sent"

}

Error Response (400):

{

  "error": "Invalid command format"

}

Error Response (503):

{

  "error": "Playback worker not available"

}

---

### 

### **5\. POST /api/playlists**

Update playlists.Description: Updates or creates playlists. Accepts an array of playlist records. Updates updatedAt timestamp automatically.Request:

* Method: POST  
* Headers:  
* Content-Type: application/json  
* Body: Array of PlaylistRecord objects

Request Body Example:

\[

  {

    "id": "playlist-1",

    "title": "Christmas Songs",

    "tags": \["holiday", "christmas"\],

    "items": \[

      {

        "id": "seq-1",

        "sequence": 0

      },

      {

        "id": "seq-2",

        "sequence": 1

      }

    \],

    "cr

Response:

* Status: 200 OK \- Playlists updated successfully  
* Status: 400 Bad Request \- Invalid format (expected array)  
* Status: 500 Internal Server Error \- Server error

Success Response:

{

  "success": true,

  "playlists": \[

    {

      "id": "playlist-1",

      "title": "Christmas Songs",

      "tags": \["holiday", "christmas"\],

      "items": \[*...*\],

      "createdAt": 1609459200000,

      "updatedAt": 1704067200000

    }

  \]

}

Note: The response includes only non-deleted playlists (deleted \!== true).

---

### **6\. POST /api/schedules**

Update schedules.Description: Updates or creates scheduled playlists. Accepts an array of scheduled playlist records. Updates updatedAt timestamp automatically.Request:

* Method: POST  
* Headers:  
* Content-Type: application/json  
* Body: Array of ScheduledPlaylist objects

Request Body Example:

\[

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

\]

Response:

* Status: 200 OK \- Schedules updated successfully  
* Status: 400 Bad Request \- Invalid format (expected array)  
* Status: 500 Internal Server Error \- Server error

Success Response:

{

  "success": true,

  "schedules": \[

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

  \]

}

Note: The response includes only non-deleted schedules (deleted \!== true).

---

### **7\. POST /api/playback-settings**

Update playback settings.Description: Updates playback configuration settings including audio sync, background sequence mode, viewer control, and volume control.Request:

* Method: POST  
* Headers:  
* Content-Type: application/json  
* Body: PlaybackSettings object

Request Body Example:

{

  "audioSyncAdjust": 50,

  "backgroundSequence": "overlay",

  "viewerControl": {

    "enabled": true,

    "type": "remote-falcon",

    "remoteFalconToken": "token-123",

    "schedule": \[

      {

        "id": "vc-1",

        "days": "all",

        "startTime": "18:00",

        "endTime": "22:00",

        "playlist": "viewer-playlist"

      }

    \]

  },

  "volumeControl": {

    "defaultVolume": 75,

    "schedule": \[

      {

        "id": "vol-1",

        "days": "weekday-mon-fri",

        "startTime": "08:00",

        "endTime": "18:00",

        "volumeLevel": 50

      }

    \]

  }

}

Response:

* Status: 200 OK \- Settings updated successfully  
* Status: 400 Bad Request \- Invalid format (expected object)  
* Status: 500 Internal Server Error \- Server error

Success Response:

{

  "success": true

}

# Web-Socket Api’s

Web-Socket Api’s

### **Connection**

Endpoint: ws://localhost:{port}/wsProtocol: WebSocket (ws:// or wss://)Connection Behavior:

* Server sends initial snapshot on connection  
* Heartbeat ping every 5 seconds  
* Client must respond with pong within 15 seconds  
* Maximum buffer: 8MB per connection  
* Automatic reconnection supported (client-side)

### **Server-to-Client Messages**

#### **1\. snapshot Message**

State update broadcast.Message Type: snapshot Description: Broadcasts player state updates. Contains version numbers for each state key and partial state data.Message Format:

{

  type: 'snapshot',

  v: { \[K in keyof FullPlayerState\]: number },  *// Version numbers*

  data: Partial\<FullPlayerState\>                *// State updates*

}

Example:

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

      "reported\_time": 1704067200000,

      "now\_playing": {

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

State Keys (FullPlayerState):

* showFolder \- Current show folder path  
* sequences \- Array of SequenceRecord  
* playlists \- Array of PlaylistRecord  
* schedule \- Array of ScheduledPlaylist  
* user \- EndUser object  
* show \- EndUserShowSettings object  
* cStatus \- PlayerCStatusContent object  
* pStatus \- PlayerPStatusContent object  
* nStatus \- PlayerNStatusContent object  
* playbackSettings \- PlaybackSettings object  
* playbackStatistics \- PlaybackStatistics object  
* versions \- EZPlayerVersions object

Behavior:

* Version numbers increment on each update  
* Only changed keys are included in data  
* Multiple updates to the same key are coalesced (latest wins)  
* Client receives full snapshot on initial connection

#### **2\. ping Message**

Heartbeat ping.Message Type: ping Description: Server sends ping every 5 seconds to check connection health. Client must respond with pong.Message Format:

{

  type: 'ping',

  now: number  *// Timestamp*

}

Example:

{

  "type": "ping",

  "now": 1704067200000

}

Client Response Required: Client must send pong message with the same now value within 15 seconds.Timeout: If no pong received within 15 seconds, server disconnects with kick message.

#### **3\. kick Message**

Server-initiated disconnection.Message Type: kick Description: Server sends this before disconnecting a client. Reasons include heartbeat timeout or excessive buffering.Message Format:

{

  type: 'kick',

  reason: string  *// Disconnection reason*

}

Example:

{

  "type": "kick",

  "reason": "heartbeat timeout"

}

Common Reasons:

* "heartbeat timeout" \- Client didn't respond to pings within 15 seconds  
* "backpressure: buffered={bytes}" \- Client buffer exceeded 8MB limit  
* "socket closed" \- Connection closed  
* "socket error" \- Connection error  
* "send failed" \- Failed to send message

Behavior: After sending kick, server closes the connection.

### **Client-to-Server Messages**

#### **1\. pong Message**

Response to server ping. Message Type: pong Description: Client must respond to server ping messages to maintain connection.Message Format:

{

  type: 'pong',

  now: number  *// Timestamp from ping message*

}

Example:

{

  "type": "pong",

  "now": 1704067200000

}

Requirements:

* Must be sent within 15 seconds of receiving ping  
* Must use the same now value from the ping message  
* Failure to respond results in disconnection

#### **2\. Subscribe Message**

Subscribe to specific state keys.Message Type: subscribe Description: Optionally subscribe to specific state keys instead of all updates. If not sent, client subscribes to all keys by default.Message Format:

{

  type: 'subscribe',

  keys: (keyof FullPlayerState)\[\]  *// Array of state keys*

}

Example:

{

  "type": "subscribe",

  "keys": \["pStatus", "cStatus", "playbackSettings"\]

}

Valid Keys:

* "showFolder"  
* "sequences"  
* "playlists"  
* "schedule"  
* "user"  
* "show"  
* "cStatus"  
* "pStatus"  
* "nStatus"  
* "playbackSettings"  
* "playbackStatistics"  
* "versions"

Behavior:

* If not sent, client receives all state updates  
* If sent, client receives only updates for specified keys  
* Can be sent multiple times to change subscription

### 

### 

### **WebSocket Features**

#### **Heartbeat Mechanism**

* Server sends ping every 5 seconds  
* Client must respond with pong within 15 seconds  
* Timeout results in kick and disconnection

#### **Backpressure Management**

* Maximum buffer: 8MB per connection  
* Server monitors bufferedAmount  
* If buffer exceeds limit, server sends kick and disconnects  
* Prevents memory issues with slow clients

#### **State Versioning**

* Each state key has a version number  
* Versions increment on each update  
* Client can track which updates it has received  
* Enables efficient state synchronization

#### **Update Coalescing**

* Multiple rapid updates to the same key are coalesced  
* Only the latest value is sent  
* Reduces network traffic  
* Prevents client from being overwhelmed

#### **Automatic Reconnection**

* Client automatically attempts reconnection on disconnect  
* Maximum 10 reconnection attempts  
* Exponential backoff (starts at 1 second, max 30 seconds)  
* Port rotation supported for multiple server instances

## **Error Handling**

### **HTTP Error Responses**

All REST API endpoints may return the following error responses:400 Bad Request:

{

  "error": "Error description"

}

404 Not Found:

{

  "error": "Resource not found"

}

500 Internal Server Error:

{

  "error": "Internal server error"

}

503 Service Unavailable:

{

  "error": "Service unavailable description"

}

### **WebSocket Error Handling**

* Connection errors: Client should attempt reconnection  
* Parse errors: Invalid JSON messages are ignored  
* Timeout errors: Server disconnects after timeout  
* Buffer overflow: Server disconnects when buffer exceeds limit

## 

### **Complete WebSocket Workflow**

*// Connect to WebSocket*

const ws \= new WebSocket('ws://localhost:3000/ws');

*// Handle connection*

ws.onopen \= () \=\> {

  console.log('Connected');


  *// Optionally subscribe to specific keys*

  ws.send(JSON.stringify({

    type: 'subscribe',

    keys: \['pStatus', 'cStatus'\]

  }));

};

*// Handle messages*

ws.onmessage \= (event) \=\> {

  const message \= JSON.parse(event.data);


  switch(message.type) {

    case 'snapshot':

      console.log('State update:', message.data);

      break;

    case 'ping':

      *// Respond to ping*

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

*// Handle errors*

ws.onerror \= (error) \=\> {

  console.error('WebSocket error:', error);

};

*// Handle close*

ws.onclose \= () \=\> {

  console.log('Disconnected');

}

