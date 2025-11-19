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

