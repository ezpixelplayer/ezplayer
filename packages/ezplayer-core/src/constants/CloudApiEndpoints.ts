/**
 * Cloud endpoint paths shared across the player surface (renderer + node main + workers).
 * The `player/...` group is the player-side API. `REGISTER_PLAYER` is the user-facing
 * landing URL that a player surfaces via QR/link for out-of-band registration.
 */
export const CLOUD_API_ENDPOINTS = {
    IS_PLAYER_REGISTERED: 'player/isregistered/',
    /** POST ${cloudUrl}api/player/checkin/<token>  body: PlayerCheckinRequest
     *  Lightweight heartbeat that doubles as a command-poll. Empty body is
     *  valid (just picks up pending OutOfBandCommands). */
    CHECKIN: 'player/checkin/',
    GET_STATUS: 'player/getstat/',
    /** GET ${cloudUrl}api/player/candidateServers/<token> -> CandidateServersResponse.
     *  Player calls this once at startup to discover which player_servers it
     *  should probe for home-server election. */
    CANDIDATE_SERVERS: 'player/candidateServers/',
    /** POST ${cloudUrl}api/player/electHomeServer/<token>  body: ElectHomeServerRequest
     *  Tells the cloud which player_server the player picked. Cloud writes
     *  it onto the user_players row so subsequent checkins return the right
     *  WS URL on `openCloudWS`. */
    ELECT_HOME_SERVER: 'player/electHomeServer/',

    /** User-facing browser URL: ${cloudUrl}${REGISTER_PLAYER}<playerId> opens the
     *  cloud-side claim flow on a logged-in browser. */
    REGISTER_PLAYER: 'enduser/registerplayer/',

    // Cloud content sync — `/ezpapi/...` (formerly `/fppapi/...`). These are NOT
    // prefixed with /api/ — append directly: `${cloudUrl}${endpoint}<args>`.
    /** GET ${cloudUrl}ezpapi/player/getseqforplayer/<token> -> { sequences: EzpSeqRec[] } */
    EZP_GET_SEQ_LIST: 'ezpapi/player/getseqforplayer/',
    /** GET ${cloudUrl}ezpapi/player/getplaylistsforplayer/<token> -> { playlists: PlaylistRecord[] } */
    EZP_GET_PLAYLISTS: 'ezpapi/player/getplaylistsforplayer/',
    /** GET ${cloudUrl}ezpapi/player/getscheduleforplayer/<token> -> { schedule: ScheduledPlaylist[] } */
    EZP_GET_SCHEDULE: 'ezpapi/player/getscheduleforplayer/',
    /** GET ${cloudUrl}ezpapi/player/getseqfile/<token>/<file_id> -> { url, filename } */
    EZP_GET_SEQ_FILE: 'ezpapi/player/getseqfile/',
    /** GET ${cloudUrl}ezpapi/player/getmediafile/<token>/<file_id> -> { url, filename } */
    EZP_GET_MEDIA_FILE: 'ezpapi/player/getmediafile/',
    /** GET ${cloudUrl}ezpapi/player/getlatestlayout/<token>
     *   -> { zip?, rgbeffects?, networks?: { url, filename, file_id, file_time } } */
    EZP_GET_LATEST_LAYOUT: 'ezpapi/player/getlatestlayout/',
    /** GET ${cloudUrl}ezpapi/player/getsettingsforplayer/<token> -> CloudPlayerSettings */
    EZP_GET_SETTINGS: 'ezpapi/player/getsettingsforplayer/',
} as const;
