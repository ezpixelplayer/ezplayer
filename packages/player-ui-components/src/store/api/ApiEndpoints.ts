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
};
