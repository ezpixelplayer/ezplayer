import { createAppStore } from '@ezplayer/player-ui-components';
import { LocalWebDataStorageAPI } from './LocalWebDataStorageAPI';

// Use LocalWebDataStorageAPI for accessing electron app
export const storeApi = new LocalWebDataStorageAPI(window.location.origin);

export const store = createAppStore(storeApi);
