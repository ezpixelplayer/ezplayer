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
    hydratePlaybackSettings,
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
    PlaybackSettings,
} from '@ezplayer/ezplayer-core';
import { wsService } from '../services/websocket';

interface WebSocketProviderProps {
    children: React.ReactNode;
}

export const WebSocketProvider: React.FC<WebSocketProviderProps> = ({ children }) => {
    const dispatch = useDispatch();

    useEffect(() => {
        // Check if we're in Electron - if so, don't use WebSocket
        // @ts-ignore - window.electronAPI might not exist in web version
        if (typeof window !== 'undefined' && window.electronAPI) {
            return;
        }

        const bootstrapInitialData = async () => {
            const baseUrl = wsService.getHttpBaseUrl();
            if (!baseUrl) {
                return;
            }
            try {
                const response = await fetch(`${baseUrl}/api/current-show`);
                if (!response.ok) {
                    throw new Error(`Failed to fetch current show data (${response.status})`);
                }
                const payload = await response.json();
                if (payload?.showFolder) {
                    dispatch(authSliceActions.setShowDirectory(payload.showFolder));
                }
                if (Array.isArray(payload?.sequences)) {
                    dispatch(setSequenceData(payload.sequences));
                }
                if (Array.isArray(payload?.playlists)) {
                    dispatch(setPlaylists(payload.playlists));
                }
                if (Array.isArray(payload?.schedule)) {
                    dispatch(setScheduledPlaylists(payload.schedule));
                }
                if (payload?.show) {
                    dispatch(setShowProfile(payload.show));
                }
                if (payload?.user) {
                    dispatch(setEndUser(payload.user));
                }
                if (payload?.status) {
                    dispatch(setPlayerStatus(payload.status));
                }
            } catch (error) {
                console.warn('Unable to bootstrap show data from Electron API:', error);
            }
        };

        // Subscribe to all WebSocket message types before connecting so we don't miss initial payloads
        const unsubscribeShowFolder = wsService.subscribe('update:showFolder', (data: string) => {
            dispatch(authSliceActions.setShowDirectory(data));
        });

        const unsubscribeSequences = wsService.subscribe('update:sequences', (data: SequenceRecord[]) => {
            dispatch(setSequenceData(data));
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

        const unsubscribePlaybackSettings = wsService.subscribe('update:playbacksettings', (data: PlaybackSettings) => {
            dispatch(hydratePlaybackSettings(data));
        });

        // Connect after handlers are registered to avoid dropping initial messages
        wsService.connect();
        bootstrapInitialData();

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
            unsubscribePlaybackSettings();
            wsService.disconnect();
        };
    }, [dispatch]);

    return <>{children}</>;
};
