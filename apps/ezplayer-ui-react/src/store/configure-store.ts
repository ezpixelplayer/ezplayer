import { createAppStore, CloudDataStorageAPI, LocalWebDataStorageAPI } from '@ezplayer/player-ui-components';

export const EZP_SERVER_API_URL_BASE = import.meta.env.VITE_EZP_CLOUD_API_URL;

// Detect if we're running in a local environment (localhost)
const isLocalEnvironment =
    typeof window !== 'undefined' &&
    (window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1');

// Use LocalWebDataStorageAPI for local development, CloudDataStorageAPI for cloud deployment
export const storeApi = isLocalEnvironment
    ? new LocalWebDataStorageAPI(window.location.origin)
    : new CloudDataStorageAPI(EZP_SERVER_API_URL_BASE);

export const store = createAppStore(storeApi);
