import { createAppStore } from '@ezplayer/player-ui-components';
import { ElectronDataStorageAPI } from './local/ElectronDataStorageAPI';

export const EZP_SERVER_API_URL_BASE = import.meta.env.VITE_EZP_CLOUD_API_URL;

export const storeApi = new ElectronDataStorageAPI(EZP_SERVER_API_URL_BASE);

export const store = createAppStore(storeApi);
