import { useEffect } from 'react';
import { useDispatch } from 'react-redux';
import { AppDispatch, authSliceActions, DataStorageAPI } from '..';

interface IDPProps {
    children: React.ReactNode;
    api: DataStorageAPI;
}

export const InitialDataProvider = ({ children, api }: IDPProps) => {
    const dispatch = useDispatch<AppDispatch>();
    let alive = false;

    useEffect(() => {
        api.connect(dispatch);
        alive = true;
        return () => {
            alive = false;
            api.disconnect();
        };
    }, [dispatch, api]); // Runs once when the component mounts

    useEffect(() => {
        (async () => {
            try {
                const vers = await window.electronAPI?.getVersions(); // assume always defined
                    if (alive && vers) {
                        dispatch(authSliceActions.setPlayerVersion(vers));
                    }
                } catch (err) {
                console.error("getVersions failed:", err);
            }
        })();
    });
    return <>{children}</>;
};
