/**
 * WebSocket Provider Component
 * Integrates WebSocket messages with Redux store
 */

import React, { useEffect } from 'react';
import { useDispatch } from 'react-redux';
import {
    setSequenceData,
    setPlaylists,
    setScheduledPlaylists,
    setShowProfile,
    setEndUser,
    setPlayerStatus,
    setPlaybackStatistics,
    setCStatus,
    setNStatus,
    setPStatus,
    authSliceActions,
} from '@ezplayer/player-ui-components';
import type {
    SequenceRecord,
    PlaylistRecord,
    ScheduledPlaylist,
    EndUserShowSettings,
    EndUser,
    CombinedPlayerStatus,
    PlaybackStatistics,
    PlayerCStatusContent,
    PlayerNStatusContent,
    PlayerPStatusContent,
} from '@ezplayer/ezplayer-core';
import { wsService } from '../services/websocket';
import { useWebSocketConnection } from '../hooks/useWebSocket';

interface WebSocketProviderProps {
    children: React.ReactNode;
}

function normalizeAssetUrl(url: string | undefined, baseUrl: string): string | undefined {
    if (!url) return url;
    const sanitizedBase = baseUrl.replace(/\/+$/, '');
    try {
        if (/^https?:\/\//i.test(url)) {
            const parsed = new URL(url);
            if (parsed.hostname === 'localhost' || parsed.hostname === '127.0.0.1') {
                const baseParsed = new URL(`${sanitizedBase}/`);
                parsed.protocol = baseParsed.protocol;
                parsed.host = baseParsed.host;
                return parsed.toString();
            }
            return url;
        }
        if (url.startsWith('/')) {
            return `${sanitizedBase}${url}`;
        }
        return url;
    } catch {
        return url;
    }
}

function normalizeSequenceAssets(records: SequenceRecord[], baseUrl?: string): SequenceRecord[] {
    if (!baseUrl) {
        return records;
    }
    return records.map((seq) => {
        let mutated = false;
        let nextFiles = seq.files;
        if (seq.files?.thumbPublicUrl) {
            const updatedThumb = normalizeAssetUrl(seq.files.thumbPublicUrl, baseUrl);
            if (updatedThumb !== seq.files.thumbPublicUrl) {
                nextFiles = { ...(nextFiles ?? seq.files), thumbPublicUrl: updatedThumb };
                mutated = true;
            }
        }
        let nextWork = seq.work;
        if (seq.work?.artwork) {
            const updatedArtwork = normalizeAssetUrl(seq.work.artwork, baseUrl);
            if (updatedArtwork !== seq.work.artwork) {
                nextWork = { ...seq.work, artwork: updatedArtwork };
                mutated = true;
            }
        }
        if (!mutated) {
            return seq;
        }
        return {
            ...seq,
            files: nextFiles,
            work: nextWork,
        };
    });
}

export const WebSocketProvider: React.FC<WebSocketProviderProps> = ({ children }) => {
    const dispatch = useDispatch();

    // Initialize WebSocket connection (only if not in Electron)
    useWebSocketConnection();

    useEffect(() => {
        // Check if we're in Electron - if so, don't use WebSocket
        // @ts-ignore - window.electronAPI might not exist in web version
        if (typeof window !== 'undefined' && window.electronAPI) {
            return;
        }

        // Subscribe to all WebSocket message types and dispatch Redux actions
        const unsubscribeShowFolder = wsService.subscribe('update:showFolder', (data: string) => {
            dispatch(authSliceActions.setShowDirectory(data));
        });

        const unsubscribeSequences = wsService.subscribe('update:sequences', (data: SequenceRecord[]) => {
            dispatch(setSequenceData(normalizeSequenceAssets(data, wsService.getHttpBaseUrl())));
        });

        const unsubscribePlaylists = wsService.subscribe('update:playlist', (data: PlaylistRecord[]) => {
            dispatch(setPlaylists(data));
        });

        const unsubscribeSchedule = wsService.subscribe('update:schedule', (data: ScheduledPlaylist[]) => {
            dispatch(setScheduledPlaylists(data));
        });

        const unsubscribeShow = wsService.subscribe('update:show', (data: EndUserShowSettings) => {
            dispatch(setShowProfile(data));
        });

        const unsubscribeUser = wsService.subscribe('update:user', (data: EndUser) => {
            dispatch(setEndUser(data));
        });

        const unsubscribeStatus = wsService.subscribe('update:combinedstatus', (data: CombinedPlayerStatus) => {
            dispatch(setPlayerStatus(data));
        });

        const unsubscribeStats = wsService.subscribe('playback:stats', (data: PlaybackStatistics) => {
            dispatch(setPlaybackStatistics(data));
        });

        const unsubscribeCStatus = wsService.subscribe('playback:cstatus', (data: PlayerCStatusContent) => {
            dispatch(setCStatus(data));
        });

        const unsubscribeNStatus = wsService.subscribe('playback:nstatus', (data: PlayerNStatusContent) => {
            dispatch(setNStatus(data));
        });

        const unsubscribePStatus = wsService.subscribe('playback:pstatus', (data: PlayerPStatusContent) => {
            dispatch(setPStatus(data));
        });

        return () => {
            unsubscribeShowFolder();
            unsubscribeSequences();
            unsubscribePlaylists();
            unsubscribeSchedule();
            unsubscribeShow();
            unsubscribeUser();
            unsubscribeStatus();
            unsubscribeStats();
            unsubscribeCStatus();
            unsubscribeNStatus();
            unsubscribePStatus();
        };
    }, [dispatch]);

    return <>{children}</>;
};

