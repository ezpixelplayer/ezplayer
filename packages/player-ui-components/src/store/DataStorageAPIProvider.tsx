import { createContext, useContext, type ReactNode } from 'react';
import type { DataStorageAPI } from './api/DataStorageAPI';

const DataStorageAPIContext = createContext<DataStorageAPI | null>(null);

export function DataStorageAPIProvider({
    api,
    children,
}: {
    api: DataStorageAPI;
    children: ReactNode;
}) {
    return <DataStorageAPIContext.Provider value={api}>{children}</DataStorageAPIContext.Provider>;
}

export function useDataStorageAPI(): DataStorageAPI {
    const api = useContext(DataStorageAPIContext);
    if (!api) {
        throw new Error('useDataStorageAPI must be used within DataStorageAPIProvider');
    }
    return api;
}
