import FolderOpenIcon from '@mui/icons-material/FolderOpen';
import React, { useState } from 'react';
import { useSelector } from 'react-redux';
import type { RootState } from '../../store/Store';
import type { SettingsSection } from '../playback-settings/SettingsDrawer';
import { FileManagerDialog } from './FileManagerDialog';

/**
 * The Files tile for the Settings gallery, plus the dialog it opens.
 *
 * The tile is `available` only when the player reports the file manager as on,
 * which it does only when someone set a password with `EZPlayer files` on the
 * player machine. With no password there is no tile, and no endpoint either.
 *
 * Shared by every settings screen so they cannot drift on the gate.
 */
export function useFilesSection(): { section: SettingsSection; dialog: React.ReactNode } {
    const available = useSelector((state: RootState) => state.remoteAccess.files);
    const [open, setOpen] = useState(false);

    const section: SettingsSection = {
        key: 'files',
        label: 'Files',
        icon: <FolderOpenIcon sx={{ fontSize: 56 }} />,
        available,
        onClick: () => setOpen(true),
    };

    return {
        section,
        dialog: <FileManagerDialog open={open} onClose={() => setOpen(false)} />,
    };
}
