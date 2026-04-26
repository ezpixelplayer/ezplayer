import { useState, useEffect } from 'react';
import { EZPElectronAPI } from '@ezplayer/ezplayer-core';

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
 *  • Electron — queries `electronAPI.getServerStatus()` for the dynamic port.
 *  • Browser  — falls back to `window.location.origin` (same-origin server).
 */
export function useFrameServerUrl({ frameServerUrl }: UseFrameServerUrlOptions = {}): UseFrameServerUrlResult {
    const [url, setUrl] = useState<string | undefined>(frameServerUrl);

    useEffect(() => {
        if (frameServerUrl) {
            setUrl(frameServerUrl);
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
    }, [frameServerUrl]);

    return { url };
}
