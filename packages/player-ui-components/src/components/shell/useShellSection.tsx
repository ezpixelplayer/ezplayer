import TerminalIcon from '@mui/icons-material/Terminal';
import React, { useState } from 'react';
import { useSelector } from 'react-redux';
import type { RootState } from '../../store/Store';
import type { SettingsSection } from '../playback-settings/SettingsDrawer';
import { ShellDialog } from './ShellDialog';

/**
 * The Shell tile for the Settings gallery, plus the dialog it opens.
 *
 * The tile is `available` only when the player reports the shell as on.
 */
export function useShellSection(): { section: SettingsSection; dialog: React.ReactNode } {
    const available = useSelector((state: RootState) => state.remoteAccess.shell);
    const [open, setOpen] = useState(false);

    const section: SettingsSection = {
        key: 'shell',
        label: 'Shell',
        icon: <TerminalIcon sx={{ fontSize: 56 }} />,
        available,
        onClick: () => setOpen(true),
    };

    return {
        section,
        dialog: <ShellDialog open={open} onClose={() => setOpen(false)} />,
    };
}
