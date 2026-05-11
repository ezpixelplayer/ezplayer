import { useState, useEffect } from 'react';
import { EZPElectronAPI } from '@ezplayer/ezplayer-core';
import { useApiBase } from '../util/ApiBaseProvider';

export interface UseFrameServerUrlOptions {
    /** Optional override URL — if provided the auto-detection is skipped. */
    frameServerUrl?: string;
}

export interface UseFrameServerUrlResult {
    url: string | undefined;
}

/**
 * Resolves the frame server base URL, either from an explicit prop or by
 * auto-detecting the running environment:
 *  • Cloud SPA — `useApiBase()` is non-empty; use it directly so
 *    `${url}/api/…` routes through the HTTP-over-WS proxy.
 *  • Electron — queries `electronAPI.getServerStatus()` for the dynamic port.
 *  • LAN browser — falls back to `window.location.origin` (same-origin server).
 */
export function useFrameServerUrl({ frameServerUrl }: UseFrameServerUrlOptions = {}): UseFrameServerUrlResult {
    const apiBase = useApiBase();
    const [url, setUrl] = useState<string | undefined>(frameServerUrl || (apiBase || undefined));

    useEffect(() => {
        if (frameServerUrl) {
            setUrl(frameServerUrl);
            return;
        }
        if (apiBase) {
            // Cloud SPA: every `/api/...` fetch must go through the proxy prefix.
            setUrl(apiBase);
            return;
        }

        const detectUrl = async () => {
            const electronAPI = (window as any).electronAPI as EZPElectronAPI;

            if (electronAPI?.getServerStatus) {
                try {
                    const status = await electronAPI.getServerStatus();
                    if (status?.port && status.status === 'listening') {
                        setUrl(`http://localhost:${status.port}`);
                        return;
                    }
                } catch (err) {
                    console.error('[useFrameServerUrl] Failed to get server status:', err);
                }
            }

            if (typeof window !== 'undefined' && window.location?.origin?.startsWith('http')) {
                setUrl(window.location.origin);
            }
        };

        detectUrl();
    }, [frameServerUrl, apiBase]);

    return { url };
}
