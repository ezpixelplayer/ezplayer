import { useFrameServerUrl } from './useFrameServerUrl';

/**
 * WebSocket URL for one of the player's password-gated remote-access endpoints,
 * for whichever environment we're in. The environments differ
 * only in how you *reach* the player: the endpoint, the handshake and the
 * password check are identical, so the UI needs no environment-specific code.
 *
 *  • Cloud SPA — the base is `/api/enduserspa/proxy/<token>`, and the cloud
 *    relays a browser socket onto the player's own endpoint over the existing
 *    proxy bridge.
 *  • Electron / LAN browser — dial the player directly.
 */
export type RemoteAccessFeature = 'shell' | 'files';

/** Player-side path, and the cloud-relay path that maps onto it. */
const ENDPOINTS: Record<RemoteAccessFeature, { local: string; cloud: string }> = {
    shell: { local: '/terminal', cloud: 'term' },
    files: { local: '/filemanager', cloud: 'files' },
};

export function toRemoteAccessWsUrl(baseUrl: string | undefined, feature: RemoteAccessFeature): string | undefined {
    if (!baseUrl || typeof window === 'undefined') return undefined;
    const endpoint = ENDPOINTS[feature];

    const cloud = baseUrl.match(/^(.*?)\/api\/enduserspa\/proxy\/([^/]+)\/?$/);
    if (cloud) {
        const origin = cloud[1] || window.location.origin;
        return `${toWsScheme(origin)}/api/enduserspa/${endpoint.cloud}/${cloud[2]}`;
    }

    // A path-only base that isn't the cloud prefix still means "same origin".
    const origin = /^https?:/i.test(baseUrl) ? baseUrl.replace(/\/+$/, '') : window.location.origin;
    return `${toWsScheme(origin)}${endpoint.local}`;
}

function toWsScheme(origin: string): string {
    return origin.replace(/^https:/i, 'wss:').replace(/^http:/i, 'ws:');
}

/** Hook form: resolves the player's base URL, then the endpoint on it. */
export function useRemoteAccessWsUrl(feature: RemoteAccessFeature): string | undefined {
    const { url } = useFrameServerUrl();
    return toRemoteAccessWsUrl(url, feature);
}
