import { createAppStore, LocalWebDataStorageAPI } from '@ezplayer/player-ui-components';

// Use LocalWebDataStorageAPI for accessing electron app
export const storeApi = new LocalWebDataStorageAPI(window.location.origin)

export const store = createAppStore(storeApi);
