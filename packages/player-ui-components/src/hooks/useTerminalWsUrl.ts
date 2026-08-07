import { useFrameServerUrl } from './useFrameServerUrl';

/**
 * WebSocket URL for the player's remote shell, for whichever of the three
 * environments we're in. The three differ only in how you *reach* the player:
 * the endpoint, the handshake, and the password check are identical, so the
 * terminal UI itself needs no environment-specific code.
 *
 *  • Cloud SPA — the base is `/api/enduserspa/proxy/<token>`, and the cloud
 *    relays a browser socket at `…/term/<token>` onto the player's own
 *    `/terminal` over the existing proxy bridge.
 *  • Electron / LAN browser — dial `/terminal` on the player directly.
 *
 * Mirrors `deriveAudioBridgeWsUrl` in useAudioStream.ts, which does the same
 * trick for the audio bridge.
 */
export function toTerminalWsUrl(baseUrl: string | undefined): string | undefined {
    if (!baseUrl || typeof window === 'undefined') return undefined;

    const cloud = baseUrl.match(/^(.*?)\/api\/enduserspa\/proxy\/([^/]+)\/?$/);
    if (cloud) {
        const origin = cloud[1] || window.location.origin;
        return `${toWsScheme(origin)}/api/enduserspa/term/${cloud[2]}`;
    }

    // A path-only base that isn't the cloud prefix still means "same origin".
    const origin = /^https?:/i.test(baseUrl) ? baseUrl.replace(/\/+$/, '') : window.location.origin;
    return `${toWsScheme(origin)}/terminal`;
}

function toWsScheme(origin: string): string {
    return origin.replace(/^https:/i, 'wss:').replace(/^http:/i, 'ws:');
}

/** Hook form: resolves the player's base URL, then the terminal socket on it. */
export function useTerminalWsUrl(): string | undefined {
    const { url } = useFrameServerUrl();
    return toTerminalWsUrl(url);
}
