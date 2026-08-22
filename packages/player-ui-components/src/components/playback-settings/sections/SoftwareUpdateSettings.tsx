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
import { useDispatch, useSelector } from 'react-redux';
import { Select } from '@ezplayer/shared-ui-components';
import type { AutoUpdateMode, EZPElectronAPI, UpdateCommand } from '@ezplayer/ezplayer-core';
import { Box } from '../../box/Box';
import type { AppDispatch, RootState } from '../../../store/Store';
import { sendUpdateCommand } from '../../../store/slices/AutoUpdateStore';

declare global {
    interface Window {
        electronAPI?: EZPElectronAPI;
    }
}

/** Electron-router tile gate. LAN/cloud surfaces gate on the pushed
 *  `autoUpdateOps` state instead (see the embedded/cloud routers). */
export const canControlUpdates = (): boolean => {
    const api = window.electronAPI as Partial<EZPElectronAPI> | undefined;
    return Boolean(api?.updateCommand && api.getAutoUpdateOps);
};

/** Negative when a < b. Handles '-alpha'-style suffixes: numerically equal
 *  versions rank a suffixed one below the plain release. */
const compareVersions = (a: string, b: string): number => {
    const parse = (v: string) => {
        const [nums, suffix] = v.split(/-(.+)/);
        return { parts: nums.split('.').map((n) => parseInt(n, 10) || 0), suffix: suffix ?? '' };
    };
    const pa = parse(a);
    const pb = parse(b);
    for (let i = 0; i < Math.max(pa.parts.length, pb.parts.length); i++) {
        const d = (pa.parts[i] ?? 0) - (pb.parts[i] ?? 0);
        if (d !== 0) return d;
    }
    if (pa.suffix === pb.suffix) return 0;
    if (!pa.suffix) return 1;
    if (!pb.suffix) return -1;
    return pa.suffix < pb.suffix ? -1 : 1;
};

/** In-UI software update pane, for all UIs */
export const SoftwareUpdateSettings: React.FC = () => {
    const dispatch = useDispatch<AppDispatch>();
    const ops = useSelector((s: RootState) => s.autoUpdate.ops);
    const [confirmForceOpen, setConfirmForceOpen] = React.useState(false);
    const [selectedTag, setSelectedTag] = React.useState('');
    const [confirmVersionOpen, setConfirmVersionOpen] = React.useState(false);
    // True between our unforced installNow and the resulting state push, so a
    // deferral (schedule active) opens the confirm dialog only on this screen,
    // not on every connected UI.
    const pendingInstallRef = React.useRef(false);

    const send = React.useCallback(
        (cmd: UpdateCommand) => {
            void dispatch(sendUpdateCommand(cmd));
        },
        [dispatch],
    );

    const armed = ops?.installArmedOnQuit ?? false;
    React.useEffect(() => {
        if (armed && pendingInstallRef.current) {
            pendingInstallRef.current = false;
            setConfirmForceOpen(true);
        }
    }, [armed]);

    if (!ops) {
        return (
            <Box>
                <Typography variant="body2" color="text.secondary">
                    Waiting for the player&apos;s update state…
                </Typography>
            </Box>
        );
    }

    const { settings, status } = ops;
    const availableVersion =
        status?.state === 'available' || status?.state === 'downloaded' ? status.version : undefined;
    const isSkipped = Boolean(availableVersion && settings.skippedVersions.includes(availableVersion));

    const handleInstallNow = () => {
        pendingInstallRef.current = true;
        send({ type: 'installNow' });
    };

    const releases = ops.releases;
    const selectedRelease = releases?.find((r) => r.tag === selectedTag);
    const selectedIsDowngrade = Boolean(
        selectedRelease && compareVersions(selectedRelease.version, settings.currentVersion) < 0,
    );
    const busy = status?.state === 'checking' || status?.state === 'downloading';

    return (
        <Box>
            <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
                EZPlayer {settings.currentVersion} is installed. Updates come from the official EZPlayer releases; the
                player never restarts on its own.
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
                    value={settings.mode}
                    onChange={(e) =>
                        send({ type: 'setUpdateMode', mode: (e.target as HTMLSelectElement).value as AutoUpdateMode })
                    }
                />
            </FormControl>

            <Box sx={{ display: 'flex', gap: 1, mb: 2, flexWrap: 'wrap' }}>
                <Button variant="outlined" size="small" disabled={busy} onClick={() => send({ type: 'checkNow' })}>
                    Check for Updates
                </Button>
                {status?.state === 'available' && (
                    <Button variant="contained" size="small" onClick={() => send({ type: 'downloadNow' })}>
                        Download {status.version}
                    </Button>
                )}
                {status?.state === 'available' && !isSkipped && (
                    <Button size="small" onClick={() => send({ type: 'skipVersion', version: status.version })}>
                        Skip This Version
                    </Button>
                )}
                {status?.state === 'downloaded' && (
                    <>
                        <Button variant="contained" size="small" onClick={handleInstallNow}>
                            Install &amp; Restart
                        </Button>
                        {!armed && (
                            <Button size="small" onClick={() => send({ type: 'installOnQuit' })}>
                                Install on Quit
                            </Button>
                        )}
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
                        Downloading… {status.percent.toFixed(0)}% ({(status.bytesPerSecond / 1024).toFixed(0)} KB/s)
                    </Typography>
                    <LinearProgress variant="determinate" value={status.percent} />
                </Box>
            )}
            {status?.state === 'downloaded' && (
                <Typography variant="body2">
                    Version {status.version} is downloaded and ready to install.
                    {armed && ' It will install when the player quits.'}
                </Typography>
            )}
            {status?.state === 'error' && (
                <Alert severity="error" sx={{ mt: 1 }}>
                    {status.message}
                </Alert>
            )}

            {settings.skippedVersions.length > 0 && (
                <Box sx={{ mt: 2, display: 'flex', alignItems: 'center', gap: 1 }}>
                    <Typography variant="body2" color="text.secondary">
                        Skipped: {settings.skippedVersions.join(', ')}
                    </Typography>
                    <Button size="small" onClick={() => send({ type: 'clearSkippedVersions' })}>
                        Clear
                    </Button>
                </Box>
            )}

            {settings.mode === 'manual' && (
                <Box sx={{ mt: 2 }}>
                    {!releases && !ops.releasesError && (
                        <Button size="small" onClick={() => send({ type: 'listReleases' })}>
                            Choose a Specific Version…
                        </Button>
                    )}
                    {ops.releasesError && (
                        <Alert severity="error" sx={{ mt: 1 }}>
                            Couldn&apos;t list releases: {ops.releasesError}
                        </Alert>
                    )}
                    {releases && (
                        <Box sx={{ display: 'flex', gap: 1, alignItems: 'center', flexWrap: 'wrap' }}>
                            <FormControl size="small" sx={{ minWidth: 260 }}>
                                <Select
                                    options={releases.map((r) => ({
                                        id: r.tag,
                                        name:
                                            `${r.version} — ${r.publishedAt.slice(0, 10)}` +
                                            (r.prerelease ? ' (beta)' : '') +
                                            (r.version === settings.currentVersion ? ' (installed)' : ''),
                                    }))}
                                    itemText="name"
                                    itemValue="id"
                                    label="Version"
                                    value={selectedTag}
                                    onChange={(e) => setSelectedTag((e.target as HTMLSelectElement).value)}
                                />
                            </FormControl>
                            <Button
                                variant="outlined"
                                size="small"
                                disabled={
                                    !selectedRelease || selectedRelease.version === settings.currentVersion || busy
                                }
                                onClick={() => setConfirmVersionOpen(true)}
                            >
                                Get This Version
                            </Button>
                        </Box>
                    )}
                </Box>
            )}

            <Dialog open={confirmVersionOpen} onClose={() => setConfirmVersionOpen(false)}>
                <DialogTitle>
                    {selectedIsDowngrade ? 'Downgrade EZPlayer?' : 'Install a Different Version?'}
                </DialogTitle>
                <DialogContent>
                    <DialogContentText>
                        EZPlayer will download version {selectedRelease?.version} and offer to install it.
                        {selectedRelease?.prerelease && ' This is a pre-release (beta) build.'}
                        {selectedIsDowngrade &&
                            ' Settings and show data written by newer versions may not work after downgrading.'}
                    </DialogContentText>
                </DialogContent>
                <DialogActions>
                    <Button onClick={() => setConfirmVersionOpen(false)}>Cancel</Button>
                    <Button
                        color={selectedIsDowngrade ? 'error' : 'primary'}
                        onClick={() => {
                            setConfirmVersionOpen(false);
                            if (selectedRelease) send({ type: 'updateToVersion', tag: selectedRelease.tag });
                        }}
                    >
                        Download
                    </Button>
                </DialogActions>
            </Dialog>

            <Dialog open={confirmForceOpen} onClose={() => setConfirmForceOpen(false)}>
                <DialogTitle>Schedule Is Running</DialogTitle>
                <DialogContent>
                    <DialogContentText>
                        A show schedule is active right now. Restarting will interrupt playback until EZPlayer comes
                        back up. If you wait, the update installs automatically when the player quits.
                    </DialogContentText>
                </DialogContent>
                <DialogActions>
                    <Button onClick={() => setConfirmForceOpen(false)}>Install on Quit</Button>
                    <Button
                        color="error"
                        onClick={() => {
                            setConfirmForceOpen(false);
                            send({ type: 'installNow', force: true });
                        }}
                    >
                        Restart Anyway
                    </Button>
                </DialogActions>
            </Dialog>
        </Box>
    );
};
