import { CLOUD_API_ENDPOINTS } from '@ezplayer/ezplayer-core';

export function playerRegistrationUrl(base: string, playerId: string): string {
    if (!base || !playerId) throw new Error('Enable cloud registration before setting up Wi-Fi from your phone.');
    const url = new URL(base);
    if (url.protocol !== 'https:') throw new Error('Phone registration requires an HTTPS cloud service.');
    return new URL(
        CLOUD_API_ENDPOINTS.REGISTER_PLAYER + encodeURIComponent(playerId),
        url.href.endsWith('/') ? url : url.href + '/',
    ).href;
}
