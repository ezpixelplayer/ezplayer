import * as Routes from './constants/routes';

export { Routes };

export { Box } from './components/box/Box';
export { Header } from './components/header/Header';
export { SidebarLayout } from './components/side-bar/SidebarLayout';
export { ConfigsButton } from './components/header/ConfigsButton';
export { Schedule } from './components/schedule/Schedule';
export { SchedulePreview } from './components/schedule-preview/SchedulePreview';
export { SchedulePreviewDialog } from './components/schedule-preview/SchedulePreviewDialog';
export { CreateEditPlaylist } from './components/playlist/CreateEditPlaylist';
export { PlaylistList } from './components/playlist/PlaylistList';
export { SongList } from './components/song/SongList';
export { AddSongDialogBrowser } from './components/song/AddSongDialogBrowser';
export { ControlButton } from './components/player/ControlButton';
export { PlaybackControls } from './components/player/PlaybackControls';
export { PlayerScreen } from './components/player/PlayerScreen';
export { JukeboxArea, JukeboxFullScreen, JukeboxScreen } from './components/jukebox/JukeboxScreen';
export { ShowStatusScreen } from './components/status/ShowStatusScreen';
export { StatsDialog } from './components/status/StatsDialog';
export { SettingsDrawer } from './components/playback-settings/SettingsDrawer';
export type { SettingsSection } from './components/playback-settings/SettingsDrawer';
export { ShowFolderSettings } from './components/playback-settings/sections/ShowFolderSettings';
export { UISettings } from './components/playback-settings/sections/UISettings';
export { ViewerSettings } from './components/playback-settings/sections/ViewerSettings';
export { JukeboxSettings } from './components/playback-settings/sections/JukeboxSettings';
export { AudioSettings } from './components/playback-settings/sections/AudioSettings';
export { PlayerSettings } from './components/playback-settings/sections/PlayerSettings';
export { PlayerCloudRegistrationDialog } from './components/player-cloud-registration/PlayerCloudRegistrationDialog';
export { PlayerCloudRegistrationPanel } from './components/player-cloud-registration/PlayerCloudRegistrationPanel';
export { PlayerCloudWelcomePanel } from './components/player-cloud-registration/PlayerCloudWelcomePanel';
export { CloudPage } from './components/cloud/CloudPage';
export { ColorPaletteDialog } from './components/theme/ColorPaletteDialog';
export { ConnectivityStatus } from './components/status/ConnectivityStatus';
export { BridgeStatusOverlay } from './components/status/BridgeStatusOverlay';
export { Preview3D } from './components/preview-3d/Preview3D';
export type { Preview3DProps, ViewMode, ViewPlane } from './components/preview-3d/Preview3D';
export { Preview3DPage, PREVIEW_3D_PAGE_STORAGE_KEY } from './components/preview-3d/Preview3DPage';
export type { Preview3DPageProps } from './components/preview-3d/Preview3DPage';
export { Viewer3D } from './components/preview-3d/Viewer3D';
export type { Viewer3DProps } from './components/preview-3d/Viewer3D';
export { Viewer2D } from './components/preview-3d/Viewer2D';
export type { Viewer2DProps } from './components/preview-3d/Viewer2D';
export { ModelList } from './components/preview-3d/ModelList';
export type { ModelListProps } from './components/preview-3d/ModelList';
export type { Model3DData, ModelMetadata, Point3D, Shape3D, SelectionState, LayoutSettings, ViewObject } from './types/model3d';
export type { MenuRoute } from './types/menuRoute';
export { toRouteChildren } from './types/menuRoute';
export { convertXmlCoordinatesToModel3D } from './services/model3dLoader';

export type { AuthState } from './store/slices/AuthStore';
export type { RuntimeState } from './store/slices/RuntimeStore';
export type { PlaybackSettingsState } from './store/slices/PlaybackSettingsStore';
export type { PlaylistState } from './store/slices/PlaylistStore';
export type { ScheduleState } from './store/slices/ScheduleStore';
export type { SequenceState } from './store/slices/SequenceStore';

export { CloudDataStorageAPI } from './store/api/cloud/CloudDataStorageAPI';
export type {
    DataStorageAPI,
    UserLoginBody,
    UserRegisterBody,
    CloudLayoutFileUpload,
    CloudFileUploadResponse,
    DownloadFileResponse,
    CloudFileDownloadResponse,
    CloudFileUpload,
    DownloadFile,
} from './store/api/DataStorageAPI';
export { API_ENDPOINTS } from './store/api/ApiEndpoints';
export { createAppStore, playerReducers } from './store/Store';
export type { RootState, AppDispatch } from './store/Store';
export { playerSettingsAutoSaveMiddleware } from './store/slices/PlayerStatusMiddleware';
export { InitialDataProvider } from './store/InitialDataProvider';
export { RouteBaseProvider, useRouteBase } from './util/RouteBaseProvider';

export {
    fetchSequences,
    postSequenceData,
    setSequenceData,
    setSequenceTags,
} from './store/slices/SequenceStore';

export { setPlaylists, fetchPlaylists, postPlaylistData, addTag } from './store/slices/PlaylistStore';

export { fetchScheduledPlaylists, postScheduledPlaylists, setScheduledPlaylists } from './store/slices/ScheduleStore';

export {
    callImmediateCommand,
    fetchPlayerStatus,
    setPlayerStatus,
    setCStatus,
    setNStatus,
    setPStatus,
    setPlaybackStatistics,
    setBridgeConnected,
    setPlayerConnected,
    runtimeActions,
} from './store/slices/RuntimeStore';

export {
    hydratePlaybackSettings,
    savePlayerSettings,
    playbackSettingsActions,
} from './store/slices/PlaybackSettingsStore';

export {
    authSliceActions,
    createAuthSlice,
    applyPlayerAuthExtraReducers,
    postSetCloudUrl,
    postSetPlayerIdToken,
    setShowDirectoryPath,
} from './store/slices/AuthStore';

export { cloudConfigActions } from './store/slices/CloudConfigStore';
export { cloudStatusActions, issueCloudCommand } from './store/slices/CloudStatusStore';

export { themeCreator, ezrgbThemeOptions, useThemeContext, ThemeProviderWrapper } from './theme/ThemeBase';

export { initI18N } from './i18n/i18n';

export { getImageUrl } from './util/imageUtils';

export { useFrameBuffer } from './hooks/useFrameBuffer';
export type { UseFrameBufferOptions, UseFrameBufferResult } from './hooks/useFrameBuffer';

export { useFrameServerUrl } from './hooks/useFrameServerUrl';
export type { UseFrameServerUrlOptions, UseFrameServerUrlResult } from './hooks/useFrameServerUrl';
