/**
 * Player-side cloud endpoint paths. The Electron player only registers itself and uses
 * `player/...` API calls; everything else (login, account management, layout uploads,
 * entitlement listing, file downloads, show/user profile, etc.) lives in
 * `BUILDER_API_ENDPOINTS` in `@ezplayer/show-builder-components`.
 */
export const API_ENDPOINTS = {
    REGISTER_PLAYER: `enduser/registerplayer/`,

    IS_PLAYER_REGISTERED: `player/isregistered/`,
    GET_PLAYLIST: `player/getplaylistsforplayer/`,
    UPDATE_PLAYLIST: `player/postplaylistsforplayer`,
    GET_SCHEDULE: `player/getscheduleforplayer/`,
    UPDATE_SCHEDULE: `player/postscheduleforplayer`,
    GET_SEQUENCE: `player/getseqforplayer/`,
    UPDATE_SEQUENCE: `player/postseqsforplayer`,
    GET_STATUS: `player/getstat/`,
};
