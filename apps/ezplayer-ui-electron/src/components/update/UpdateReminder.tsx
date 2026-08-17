import React from 'react';
import { useSelector } from 'react-redux';
import { ToastMsgs } from '@ezplayer/shared-ui-components';
import type { EZPElectronAPI } from '@ezplayer/ezplayer-core';
import type { RootState } from '@ezplayer/player-ui-components';

/** Renders nothing; shows a one-per-version toast when an update is available.
 *  Only fires in auto-check mode and never for a skipped version — the in-UI
 *  replacement for the old native "Update Available" dialog. */
export const UpdateReminder: React.FC = () => {
    const status = useSelector((s: RootState) => s.autoUpdate.status);
    const remindedRef = React.useRef<Set<string>>(new Set());

    React.useEffect(() => {
        if (status?.state !== 'available') return;
        const version = status.version;
        if (remindedRef.current.has(version)) return;
        const api = window.electronAPI as Partial<EZPElectronAPI> | undefined;
        if (!api?.getAutoUpdateSettings) return;
        let cancelled = false;
        api.getAutoUpdateSettings()
            .then((settings) => {
                if (cancelled || remindedRef.current.has(version)) return;
                if (settings.mode !== 'auto-check') return;
                if (settings.skippedVersions.includes(version)) return;
                remindedRef.current.add(version);
                ToastMsgs.showSuccessMessage(`EZPlayer ${version} is available — see Settings → Software Update.`, {
                    autoClose: 10000,
                });
            })
            .catch(() => {});
        return () => {
            cancelled = true;
        };
    }, [status]);

    return null;
};
