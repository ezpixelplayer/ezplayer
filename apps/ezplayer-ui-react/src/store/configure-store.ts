import { createAppStore, CloudDataStorageAPI } from '@ezplayer/player-ui-components';

export const EZP_SERVER_API_URL_BASE = import.meta.env.VITE_EZP_CLOUD_API_URL;

export const storeApi = new CloudDataStorageAPI(EZP_SERVER_API_URL_BASE);
export const store = createAppStore(storeApi);
