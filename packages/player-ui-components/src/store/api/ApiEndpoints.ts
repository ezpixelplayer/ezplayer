/** Player-side cloud endpoint paths: the `player/...` API surface. */
export const API_ENDPOINTS = {
    IS_PLAYER_REGISTERED: `player/isregistered/`,
    GET_PLAYLIST: `player/getplaylistsforplayer/`,
    UPDATE_PLAYLIST: `player/postplaylistsforplayer`,
    GET_SCHEDULE: `player/getscheduleforplayer/`,
    UPDATE_SCHEDULE: `player/postscheduleforplayer`,
    GET_SEQUENCE: `player/getseqforplayer/`,
    UPDATE_SEQUENCE: `player/postseqsforplayer`,
    GET_STATUS: `player/getstat/`,

    /**
     * User-facing URL for registering a player to a cloud account. The player builds
     * `${cloudUrl}${REGISTER_PLAYER}<playerId>` and surfaces it as a QR code / link;
     * the user opens it on a logged-in browser to claim the player.
     */
    REGISTER_PLAYER: `enduser/registerplayer/`,
};
