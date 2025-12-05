/// <reference path="../global.d.ts" />
import { useEffect } from 'react';
import { useNavigate } from 'react-router-dom';

/**
 * Component that listens for navigation events from the Electron menu
 * and navigates the React Router accordingly.
 */
export const MenuNavigationListener = () => {
    const navigate = useNavigate();

    useEffect(() => {
        // Check if we're in Electron
        if (typeof window !== 'undefined' && window.electronAPI) {
            const handleNavigate = (path: string) => {
                navigate(path);
            };

            window.electronAPI.onNavigate(handleNavigate);

            // Cleanup: Note that Electron IPC listeners are automatically cleaned up
            // when the window is destroyed, but we can't easily remove them here
            // since the API doesn't expose a remove method. This is fine as the
            // component will unmount when the app closes.
        }
    }, [navigate]);

    return null; // This component doesn't render anything
};

