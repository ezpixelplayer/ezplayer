import * as Routes from './constants/routes';

export { Routes };

export { Header } from './components/header/Header';
export { SidebarLayout } from './components/side-bar/SidebarLayout';
export { ConfigsButton } from './components/header/ConfigsButton';
export { Schedule } from './components/schedule/Schedule';
export { SchedulePreview } from './components/schedule-preview/SchedulePreview';
export { CreateEditPlaylist } from './components/playlist/CreateEditPlaylist';
export { PlaylistList } from './components/playlist/PlaylistList';
export { SongList } from './components/song/SongList';
export { AddSongDialogBrowser } from './components/song/AddSongDialogBrowser';
export { ControlButton } from './components/player/ControlButton';
export { PlayerScreen } from './components/player/PlayerScreen';
export { JukeboxArea, JukeboxFullScreen, JukeboxScreen } from './components/jukebox/JukeboxScreen';
export { ShowStatusScreen } from './components/status/ShowStatusScreen';
export { StatsDialog } from './components/status/StatsDialog';
export { PlaybackSettingsDrawer } from './components/playback-settings/PlaybackSettingsDrawer';
export { ConnectivityStatus } from './components/status/ConnectivityStatus';

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
} from './store/api/DataStorageAPI';
export { createAppStore } from './store/Store';
export type { RootState, AppDispatch } from './store/Store';
export { InitialDataProvider } from './store/InitialDataProvider';

export {
    fetchSequences,
    postSequenceData,
    setSequenceData,
    setUpdatedSequenceData,
    setSequenceTags,
} from './store/slices/SequenceStore';

export { setPlaylists, fetchPlaylists, postPlaylistData, addTag } from './store/slices/PlaylistStore';

export { fetchScheduledPlaylists, postScheduledPlaylists, setScheduledPlaylists } from './store/slices/ScheduleStore';

export { fetchLayoutOptions, loadLayoutHints, uploadLayoutHints, clearLayoutOptions } from './store/slices/LayoutStore';

export {
    callImmediateCommand,
    fetchPlayerStatus,
    setPlayerStatus,
    setCStatus,
    setNStatus,
    setPStatus,
    setPlaybackStatistics,
    hydratePlaybackSettings,
    playerStatusActions,
} from './store/slices/PlayerStatusStore';

export { fetchShowProfile, postShowProfile, setShowProfile } from './store/slices/ShowProfileStore';

export { fetchUserProfile, setEndUser } from './store/slices/UserProfileStore';

export { getCloudUploadedFiles } from './store/slices/HomeStore';

export {
    authSliceActions,
    postLoginData,
    requestLogout,
    postChangePassword,
    postRegisterData,
    postRegisterPlayer,
    postRequestPasswordReset,
    setShowDirectoryPath,
} from './store/slices/AuthStore';

export { themeCreator, ezrgbThemeOptions, useThemeContext, ThemeProviderWrapper } from './theme/ThemeBase';

export { initI18N } from './i18n/i18n';

export { getImageUrl } from './util/imageUtils';
