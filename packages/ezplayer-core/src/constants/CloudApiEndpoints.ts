/**
 * Cloud endpoint paths shared across the player surface (renderer + node main + workers).
 * The `player/...` group is the player-side API. `REGISTER_PLAYER` is the user-facing
 * landing URL that a player surfaces via QR/link for out-of-band registration.
 */
export const CLOUD_API_ENDPOINTS = {
    IS_PLAYER_REGISTERED: 'player/isregistered/',
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
} as const;
