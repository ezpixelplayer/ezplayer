import {
    Alert,
    Button,
    Dialog,
    DialogActions,
    DialogContent,
    DialogContentText,
    DialogTitle,
    FormControl,
    LinearProgress,
    Typography,
} from '@mui/material';
import React from 'react';
import { useSelector } from 'react-redux';
import { Select } from '@ezplayer/shared-ui-components';
import type { AutoUpdateMode, AutoUpdateSettings, EZPElectronAPI } from '@ezplayer/ezplayer-core';
import { Box } from '../../box/Box';
import type { RootState } from '../../../store/Store';

declare global {
    interface Window {
        electronAPI?: EZPElectronAPI;
    }
}

/** In-UI software update pane. All update interaction lives here; main pops no
 *  native dialogs. Electron-only — gate the settings tile on `canControlUpdates`. */
export const canControlUpdates = (): boolean => {
    const api = window.electronAPI as Partial<EZPElectronAPI> | undefined;
    return Boolean(api?.getAutoUpdateSettings && api.setAutoUpdateMode && api.installUpdateNow);
};

export const SoftwareUpdateSettings: React.FC = () => {
    const api = window.electronAPI as Partial<EZPElectronAPI> | undefined;
    const status = useSelector((s: RootState) => s.autoUpdate.status);
    const [settings, setSettings] = React.useState<AutoUpdateSettings | null>(null);
    const [confirmForceOpen, setConfirmForceOpen] = React.useState(false);
    const [installOnQuitArmed, setInstallOnQuitArmed] = React.useState(false);

    React.useEffect(() => {
        if (!api?.getAutoUpdateSettings) return;
        let cancelled = false;
        api.getAutoUpdateSettings()
            .then((s) => {
                if (!cancelled) setSettings(s);
            })
            .catch((error: unknown) => console.error('Failed to read auto-update settings:', error));
        return () => {
            cancelled = true;
        };
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    const handleModeChange = async (mode: AutoUpdateMode) => {
        if (!api?.setAutoUpdateMode) return;
        try {
            setSettings(await api.setAutoUpdateMode(mode));
        } catch (error) {
            console.error('Failed to set auto-update mode:', error);
        }
    };

    const availableVersion =
        status?.state === 'available' || status?.state === 'downloaded' ? status.version : undefined;
    const isSkipped = Boolean(
        settings && availableVersion && settings.skippedVersions.includes(availableVersion),
    );

    const handleSkip = async () => {
        if (!api?.skipUpdateVersion || !availableVersion) return;
        try {
            setSettings(await api.skipUpdateVersion(availableVersion));
        } catch (error) {
            console.error('Failed to skip version:', error);
        }
    };

    const handleClearSkipped = async () => {
        if (!api?.clearSkippedUpdateVersions) return;
        try {
            setSettings(await api.clearSkippedUpdateVersions());
        } catch (error) {
            console.error('Failed to clear skipped versions:', error);
        }
    };

    const handleInstallNow = async (force: boolean) => {
        if (!api?.installUpdateNow) return;
        try {
            const result = await api.installUpdateNow(force);
            if (result === 'deferred') {
                // Non-forced call already armed install-on-quit; ask about restarting anyway.
                setInstallOnQuitArmed(true);
                setConfirmForceOpen(true);
            }
        } catch (error) {
            console.error('Failed to install update:', error);
        }
    };

    const handleInstallOnQuit = () => {
        api?.installUpdateOnQuit?.();
        setInstallOnQuitArmed(true);
    };

    return (
        <Box>
            <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
                EZPlayer {settings?.currentVersion ?? ''} is installed. Updates come from the official EZPlayer
                releases; the player never restarts on its own.
            </Typography>

            <FormControl fullWidth size="small" sx={{ mb: 2 }}>
                <Select
                    options={[
                        { id: 'auto-check', name: 'Check automatically and remind me' },
                        { id: 'manual', name: 'Manual — only check when I ask' },
                    ]}
                    itemText="name"
                    itemValue="id"
                    label="Update Mode"
                    value={settings?.mode ?? 'auto-check'}
                    onChange={(e) =>
                        void handleModeChange((e.target as HTMLSelectElement).value as AutoUpdateMode)
                    }
                />
            </FormControl>

            <Box sx={{ display: 'flex', gap: 1, mb: 2, flexWrap: 'wrap' }}>
                <Button
                    variant="outlined"
                    size="small"
                    disabled={status?.state === 'checking' || status?.state === 'downloading'}
                    onClick={() => void api?.checkForUpdates?.()}
                >
                    Check for Updates
                </Button>
                {status?.state === 'available' && (
                    <Button variant="contained" size="small" onClick={() => void api?.downloadUpdate?.()}>
                        Download {status.version}
                    </Button>
                )}
                {status?.state === 'available' && !isSkipped && (
                    <Button size="small" onClick={() => void handleSkip()}>
                        Skip This Version
                    </Button>
                )}
                {status?.state === 'downloaded' && !installOnQuitArmed && (
                    <>
                        <Button variant="contained" size="small" onClick={() => void handleInstallNow(false)}>
                            Install &amp; Restart
                        </Button>
                        <Button size="small" onClick={handleInstallOnQuit}>
                            Install on Quit
                        </Button>
                    </>
                )}
            </Box>

            {(!status || status.state === 'checking') && (
                <Typography variant="body2" color="text.secondary">
                    {status ? 'Checking for updates…' : 'No update check has run yet.'}
                </Typography>
            )}
            {status?.state === 'not-available' && (
                <Typography variant="body2" color="text.secondary">
                    You&apos;re up to date.
                </Typography>
            )}
            {status?.state === 'available' && (
                <Typography variant="body2">
                    Version {status.version} is available.
                    {isSkipped && ' You chose to skip this version.'}
                </Typography>
            )}
            {status?.state === 'downloading' && (
                <Box>
                    <Typography variant="body2" color="text.secondary" sx={{ mb: 0.5 }}>
                        Downloading… {status.percent.toFixed(0)}% ({(status.bytesPerSecond / 1024).toFixed(0)}{' '}
                        KB/s)
                    </Typography>
                    <LinearProgress variant="determinate" value={status.percent} />
                </Box>
            )}
            {status?.state === 'downloaded' && (
                <Typography variant="body2">
                    Version {status.version} is downloaded and ready to install.
                    {installOnQuitArmed && ' It will install when you quit EZPlayer.'}
                </Typography>
            )}
            {status?.state === 'error' && (
                <Alert severity="error" sx={{ mt: 1 }}>
                    {status.message}
                </Alert>
            )}

            {settings && settings.skippedVersions.length > 0 && (
                <Box sx={{ mt: 2, display: 'flex', alignItems: 'center', gap: 1 }}>
                    <Typography variant="body2" color="text.secondary">
                        Skipped: {settings.skippedVersions.join(', ')}
                    </Typography>
                    <Button size="small" onClick={() => void handleClearSkipped()}>
                        Clear
                    </Button>
                </Box>
            )}

            <Dialog open={confirmForceOpen} onClose={() => setConfirmForceOpen(false)}>
                <DialogTitle>Schedule Is Running</DialogTitle>
                <DialogContent>
                    <DialogContentText>
                        A show schedule is active right now. Restarting will interrupt playback until EZPlayer
                        comes back up. If you wait, the update installs automatically when you quit.
                    </DialogContentText>
                </DialogContent>
                <DialogActions>
                    <Button onClick={() => setConfirmForceOpen(false)}>Install on Quit</Button>
                    <Button
                        color="error"
                        onClick={() => {
                            setConfirmForceOpen(false);
                            void handleInstallNow(true);
                        }}
                    >
                        Restart Anyway
                    </Button>
                </DialogActions>
            </Dialog>
        </Box>
    );
};
