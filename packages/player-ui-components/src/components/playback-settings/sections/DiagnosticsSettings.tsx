import { Download } from '@mui/icons-material';
import { Button, Checkbox, Divider, FormControl, FormControlLabel, Typography } from '@mui/material';
import React from 'react';
import { useDispatch, useSelector } from 'react-redux';
import { Select } from '@ezplayer/shared-ui-components';
import type { AppSettingsCommand, DiagnosticsConsent, SupportBundleLevel } from '@ezplayer/ezplayer-core';
import { Box } from '../../box/Box';
import { sendAppSettingsCommand } from '../../../store/slices/AppSettingsStore';
import type { AppDispatch, RootState } from '../../../store/Store';
import { useFrameServerUrl } from '../../../hooks/useFrameServerUrl';
import { useApiBase } from '../../../util/ApiBaseProvider';

/** Section key apps use for the Diagnostics tile, so other screens can deep-link to it. */
export const DIAGNOSTICS_SETTINGS_SECTION_KEY = 'diagnostics';

const BUNDLE_OPTIONS: { id: SupportBundleLevel; name: string; help: string }[] = [
    {
        id: 'logs',
        name: 'Logs',
        help: 'Recent logs, crash information, versions, system details, and settings changed from their defaults.',
    },
    {
        id: 'setup',
        name: 'Logs and player setup',
        help: 'Adds network addresses, the xLights controller setup, and your songs, playlists, and schedule. No audio or sequence files.',
    },
    {
        id: 'layout',
        name: 'Logs, player setup, and layout',
        help: 'Adds the xLights layout file as well.',
    },
];

export const DiagnosticsSettings: React.FC = () => {
    const dispatch = useDispatch<AppDispatch>();

    // Diagnostics consent is app-global, pushed by the player like any other
    // state; null until the first snapshot arrives.
    const appSettings = useSelector((s: RootState) => s.appSettings.state);
    const sendAppSettings = (cmd: AppSettingsCommand) => void dispatch(sendAppSettingsCommand(cmd));

    const diag: DiagnosticsConsent = appSettings?.diagnostics ?? { uploadEnabled: true, includePlayerId: false };
    const diagInteractive = appSettings !== null;

    // The logs route is on the player's own web server; the cloud proxy does not carry it.
    const apiBase = useApiBase();
    const { url: playerUrl } = useFrameServerUrl();
    const logsUrl = !apiBase && playerUrl ? `${playerUrl}/api/ezp/support/logs.zip` : undefined;
    const [bundleLevel, setBundleLevel] = React.useState<SupportBundleLevel>('logs');
    const [bundleSaved, setBundleSaved] = React.useState(false);

    return (
        <Box>
            <Typography variant="subtitle2" sx={{ mb: 0.5 }}>
                Crash reports
            </Typography>
            <Box>
                <FormControlLabel
                    control={
                        <Checkbox
                            checked={diag.uploadEnabled}
                            disabled={!diagInteractive}
                            onChange={(_e, checked) =>
                                sendAppSettings({ type: 'setDiagnosticsConsent', patch: { uploadEnabled: checked } })
                            }
                        />
                    }
                    label="Send anonymous crash reports"
                />
                <Typography variant="body2" color="text.secondary">
                    Help improve EZPlayer by sending anonymous crash and error reports. No show data, files, or personal
                    information is included.
                </Typography>
            </Box>
            <Box sx={{ mt: 1 }}>
                <FormControlLabel
                    control={
                        <Checkbox
                            checked={diag.includePlayerId}
                            disabled={!diagInteractive || !diag.uploadEnabled}
                            onChange={(_e, checked) =>
                                sendAppSettings({
                                    type: 'setDiagnosticsConsent',
                                    patch: { includePlayerId: checked },
                                })
                            }
                        />
                    }
                    label="Include my Player ID with reports"
                />
                <Typography variant="body2" color="text.secondary">
                    Lets support connect reports to your player when you ask for help. Off by default.
                </Typography>
            </Box>

            {logsUrl && (
                <>
                    <Divider sx={{ my: 3 }} />
                    <Typography variant="subtitle2" sx={{ mb: 0.5 }}>
                        Support bundle
                    </Typography>
                    <Typography variant="body2" color="text.secondary" sx={{ mb: 1.5 }}>
                        A zip of information about the player computer, to send when asking for help. Passwords and
                        tokens are removed.
                    </Typography>
                    <Box sx={{ display: 'flex', gap: 1, alignItems: 'center', flexWrap: 'wrap' }}>
                        <FormControl size="small" sx={{ minWidth: 260 }}>
                            <Select
                                options={BUNDLE_OPTIONS}
                                itemText="name"
                                itemValue="id"
                                onChange={(e) => {
                                    setBundleLevel((e.target as HTMLSelectElement).value as SupportBundleLevel);
                                    setBundleSaved(false);
                                }}
                                label="Include"
                                value={bundleLevel}
                            />
                        </FormControl>
                        <Button
                            variant="outlined"
                            size="small"
                            startIcon={<Download />}
                            href={`${logsUrl}?level=${bundleLevel}`}
                            onClick={() => setBundleSaved(true)}
                        >
                            Download
                        </Button>
                    </Box>
                    <Typography variant="body2" color="text.secondary" sx={{ mt: 1 }}>
                        {BUNDLE_OPTIONS.find((o) => o.id === bundleLevel)?.help}
                    </Typography>
                    {bundleSaved && (
                        <Typography variant="body2" sx={{ mt: 1 }}>
                            The download is an ordinary zip file. Open it and look through it before you send it, and
                            remove anything you would rather not share.
                        </Typography>
                    )}
                </>
            )}
        </Box>
    );
};
