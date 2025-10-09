import { useEffect } from 'react';
import { useDispatch } from 'react-redux';
import { AppDispatch, DataStorageAPI } from '..';

interface IDPProps {
    children: React.ReactNode;
    api: DataStorageAPI;
}

export const InitialDataProvider = ({ children, api }: IDPProps) => {
    const dispatch = useDispatch<AppDispatch>();

    useEffect(() => {
        api.connect(dispatch);
        return () => {
            api.disconnect();
        };
    }, [dispatch, api]); // Runs once when the component mounts

    return <>{children}</>;
};
