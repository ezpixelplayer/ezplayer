import type { AudioListenOptions } from './audioListenSession';

function wsScheme(httpOrigin: string): string {
    return httpOrigin.replace(/^https:/i, 'wss:').replace(/^http:/i, 'ws:');
}

/**
 * Where to get audio for a player API base URL.
 *
 *  - Cloud ezpui: the base is the proxy prefix `…/api/enduserspa/proxy/<token>`;
 *    audio comes from the relay's `/api/enduserspa/audioBridge/<token>` socket
 *    and the clock from the proxied player `/api/ezp/time`.
 *  - LAN / Electron: the player's own `/api/ezp/audiostream` socket and
 *    `/api/ezp/time`.
 *
 * Returns undefined when there is no base (embedded previews that own audio).
 */
export function deriveAudioStreamOptions(baseUrl: string | undefined, title?: string): AudioListenOptions | undefined {
    if (!baseUrl || typeof window === 'undefined') return undefined;
    const base = baseUrl.replace(/\/+$/, '');
    const proxy = base.match(/^(.*?)\/api\/enduserspa\/proxy\/([^/]+)$/);
    if (proxy) {
        const origin = proxy[1] || window.location.origin;
        return {
            wsUrl: `${wsScheme(origin)}/api/enduserspa/audioBridge/${proxy[2]}`,
            timeUrl: `${base}/api/ezp/time`,
            title,
        };
    }
    const origin = /^https?:\/\//i.test(base) ? base : window.location.origin + base;
    return {
        wsUrl: `${wsScheme(origin)}/api/ezp/audiostream`,
        timeUrl: `${origin}/api/ezp/time`,
        title,
    };
}
