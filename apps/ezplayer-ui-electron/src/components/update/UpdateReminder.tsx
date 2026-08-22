import React from 'react';
import { useSelector } from 'react-redux';
import { ToastMsgs } from '@ezplayer/shared-ui-components';
import type { RootState } from '@ezplayer/player-ui-components';

/** Renders nothing; shows a one-per-version toast when an update is available.
 *  Only fires in auto-check mode and never for a skipped version — the in-UI
 *  replacement for the old native "Update Available" dialog. */
export const UpdateReminder: React.FC = () => {
    const ops = useSelector((s: RootState) => s.autoUpdate.ops);
    const remindedRef = React.useRef<Set<string>>(new Set());

    React.useEffect(() => {
        if (!ops || ops.status?.state !== 'available') return;
        const version = ops.status.version;
        if (remindedRef.current.has(version)) return;
        if (ops.settings.mode !== 'auto-check') return;
        if (ops.settings.skippedVersions.includes(version)) return;
        remindedRef.current.add(version);
        ToastMsgs.showSuccessMessage(`EZPlayer ${version} is available — see Settings → Software Update.`, {
            autoClose: 10000,
        });
    }, [ops]);

    return null;
};
