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
    GET_PLAYLIST: 'player/getplaylistsforplayer/',
    UPDATE_PLAYLIST: 'player/postplaylistsforplayer',
    GET_SCHEDULE: 'player/getscheduleforplayer/',
    UPDATE_SCHEDULE: 'player/postscheduleforplayer',
    GET_SEQUENCE: 'player/getseqforplayer/',
    UPDATE_SEQUENCE: 'player/postseqsforplayer',
    GET_STATUS: 'player/getstat/',

    /** User-facing browser URL: ${cloudUrl}${REGISTER_PLAYER}<playerId> opens the
     *  cloud-side claim flow on a logged-in browser. */
    REGISTER_PLAYER: 'enduser/registerplayer/',

    // Cloud content sync — `/ezpapi/...` (formerly `/fppapi/...`). These are NOT
    // prefixed with /api/ — append directly: `${cloudUrl}${endpoint}<args>`.
    /** GET ${cloudUrl}ezpapi/player/getseqforplayer/<token> -> { sequences: EzpSeqRec[] } */
    EZP_GET_SEQ_LIST: 'ezpapi/player/getseqforplayer/',
    /** GET ${cloudUrl}ezpapi/player/getseqfile/<token>/<file_id> -> { url, filename } */
    EZP_GET_SEQ_FILE: 'ezpapi/player/getseqfile/',
    /** GET ${cloudUrl}ezpapi/player/getmediafile/<token>/<file_id> -> { url, filename } */
    EZP_GET_MEDIA_FILE: 'ezpapi/player/getmediafile/',
    /** GET ${cloudUrl}ezpapi/player/getlatestlayout/<token>
     *   -> { zip?, rgbeffects?, networks?: { url, filename, file_id, file_time } } */
    EZP_GET_LATEST_LAYOUT: 'ezpapi/player/getlatestlayout/',
} as const;
