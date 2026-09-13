import { Checkbox, Divider, FormControl, FormControlLabel, Switch, TextField, Typography } from '@mui/material';
import React from 'react';
import { useDispatch, useSelector } from 'react-redux';
import { Select } from '@ezplayer/shared-ui-components';
import type { AppSettingsCommand, DiagnosticsConsent } from '@ezplayer/ezplayer-core';
import { Box } from '../../box/Box';
import { TagListInput } from '../../tag-list-input/TagListInput';
import { playbackSettingsActions } from '../../../store/slices/PlaybackSettingsStore';
import { sendAppSettingsCommand } from '../../../store/slices/AppSettingsStore';
import type { AppDispatch, RootState } from '../../../store/Store';

/** Number field that commits on blur; empty commits `undefined` (use default). */
const PortField: React.FC<{
    label: string;
    value: number | undefined;
    placeholder: string;
    onCommit: (value: number | undefined) => void;
    helperText?: string;
    disabled?: boolean;
}> = ({ label, value, placeholder, onCommit, helperText, disabled }) => {
    const [local, setLocal] = React.useState(value === undefined ? '' : String(value));
    React.useEffect(() => setLocal(value === undefined ? '' : String(value)), [value]);
    return (
        <TextField
            size="small"
            label={label}
            value={local}
            placeholder={placeholder}
            helperText={helperText}
            disabled={disabled}
            InputLabelProps={{ shrink: true }}
            inputProps={{ inputMode: 'numeric' }}
            onChange={(e) => setLocal(e.target.value.replace(/[^0-9]/g, ''))}
            onBlur={() => {
                const n = Number(local);
                onCommit(local !== '' && Number.isInteger(n) && n > 0 && n < 65536 ? n : undefined);
            }}
        />
    );
};

export const PlayerSettings: React.FC = () => {
    const dispatch = useDispatch<AppDispatch>();
    const settings = useSelector((s: RootState) => s.playbackSettings.settings);
    const multisync = settings.sync?.multisync;

    // App-global settings (diagnostics consent, start at sign-in) are pushed by
    // the player like any other state; null until the first snapshot arrives.
    const appSettings = useSelector((s: RootState) => s.appSettings.state);
    const sendAppSettings = (cmd: AppSettingsCommand) => void dispatch(sendAppSettingsCommand(cmd));

    const loginItem = appSettings?.loginItem;
    const startupInteractive = loginItem?.availability === 'ok';
    const startupHelp = !loginItem
        ? 'Start at sign-in is available in the EZPlayer desktop app on Windows and macOS.'
        : loginItem.availability === 'dev-mode'
          ? 'Start at sign-in is available in the installed EZPlayer app, not while running from development mode.'
          : loginItem.availability === 'unsupported-platform'
            ? 'Start at sign-in is available on Windows and macOS.'
            : 'Launch EZPlayer automatically at sign-in on the player computer.';

    const diag: DiagnosticsConsent = appSettings?.diagnostics ?? { uploadEnabled: true, includePlayerId: false };
    const diagInteractive = appSettings !== null;

    return (
        <Box>
            <Typography variant="subtitle2" sx={{ mb: 0.5 }}>
                Startup
            </Typography>
            <Box sx={{ mb: 2 }}>
                <FormControlLabel
                    control={
                        <Checkbox
                            checked={loginItem?.openAtLogin ?? false}
                            disabled={!startupInteractive}
                            onChange={(_e, checked) =>
                                sendAppSettings({ type: 'setOpenAtLogin', openAtLogin: checked })
                            }
                        />
                    }
                    label="Start EZPlayer at sign-in"
                />
                <Typography variant="body2" color="text.secondary">
                    {startupHelp}
                </Typography>
            </Box>
            <Divider sx={{ my: 3 }} />

            <Typography variant="subtitle2" sx={{ mb: 0.5 }}>
                Playback behavior
            </Typography>
            <FormControl fullWidth size="small" sx={{ mt: 1 }}>
                <Select
                    options={[
                        { id: 'overlay', name: 'Overlay' },
                        { id: 'underlay', name: 'Underlay' },
                    ]}
                    itemText="name"
                    itemValue="id"
                    onChange={(e) =>
                        dispatch(
                            playbackSettingsActions.setBackgroundSequence(
                                (e.target as HTMLSelectElement).value as 'overlay' | 'underlay',
                            ),
                        )
                    }
                    label="Background Sequence"
                    value={settings.backgroundSequence}
                />
            </FormControl>
            <Box sx={{ mt: 1 }}>
                <FormControlLabel
                    control={
                        <Switch
                            checked={settings.sendIdleBlackFrames !== false}
                            onChange={(e) => dispatch(playbackSettingsActions.setSendIdleBlackFrames(e.target.checked))}
                        />
                    }
                    label="Blackout when idle"
                />
                <Typography variant="body2" color="text.secondary">
                    Send black frames while nothing is playing so lights go dark. Turn off when another player drives
                    the same controllers — lights then hold their last frame when playback stops.
                </Typography>
            </Box>

            <Divider sx={{ my: 3 }} />
            <Typography variant="subtitle2" sx={{ mb: 0.5 }}>
                Diagnostics
            </Typography>
            <Typography variant="body2" color="text.secondary" sx={{ mb: 1 }}>
                Help improve EZPlayer by sending anonymous crash and error reports. No show data, files, or personal
                information is included.
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
            </Box>
            <Box>
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

            <Divider sx={{ my: 3 }} />
            <Typography variant="subtitle2" sx={{ mb: 0.5 }}>
                Sync Output
            </Typography>
            <Typography variant="body2" color="text.secondary" sx={{ mb: 1 }}>
                Let other players follow this one. FPP and xSchedule remotes understand FPP MultiSync.
            </Typography>
            <FormControlLabel
                control={
                    <Switch
                        checked={!!multisync?.enabled}
                        onChange={(e) => dispatch(playbackSettingsActions.setMultisyncEnabled(e.target.checked))}
                    />
                }
                label="FPP MultiSync master"
            />
            <TextField
                size="small"
                fullWidth
                sx={{ mt: 1 }}
                label="Remotes"
                disabled={!multisync?.enabled}
                value={(multisync?.remotes ?? []).join(', ')}
                placeholder="host[:port], host[:port], …"
                helperText="Comma-separated host[:port]. Empty sends to the FPP multicast group so all listening remotes follow."
                InputLabelProps={{ shrink: true }}
                onChange={(e) =>
                    dispatch(
                        playbackSettingsActions.setMultisyncRemotes(
                            e.target.value
                                .split(',')
                                .map((r) => r.trim())
                                .filter((r) => r.length > 0),
                        ),
                    )
                }
            />
            <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2, mt: 2 }}>
                <PortField
                    label="MultiSync port"
                    value={multisync?.port}
                    placeholder="32320"
                    disabled={!multisync?.enabled}
                    onCommit={(v) => dispatch(playbackSettingsActions.setMultisyncPort(v))}
                />
                <TextField
                    size="small"
                    label="MultiSync multicast address"
                    value={multisync?.multicastAddress ?? ''}
                    placeholder="239.70.80.80"
                    disabled={!multisync?.enabled}
                    InputLabelProps={{ shrink: true }}
                    onChange={(e) =>
                        dispatch(playbackSettingsActions.setMultisyncMulticastAddress(e.target.value.trim()))
                    }
                />
            </Box>

            <Divider sx={{ my: 3 }} />
            <Typography variant="subtitle2" sx={{ mb: 0.5 }}>
                Test Sequences
            </Typography>
            <Typography variant="body2" color="text.secondary" sx={{ mb: 1 }}>
                Sequences carrying any of these tags are offered in the Show Status test area. Clear the list to hide
                the test area.
            </Typography>
            <TagListInput
                label="Test Sequence Tags"
                value={settings.testSequenceTags ?? []}
                onChange={(next) => dispatch(playbackSettingsActions.setTestSequenceTags(next))}
                placeholder='Type a tag and press Enter (e.g., "test")'
            />

            <Divider sx={{ my: 3 }} />
            <Typography variant="subtitle2" sx={{ mb: 0.5 }}>
                Advanced
            </Typography>
            <Typography variant="body2" color="text.secondary" sx={{ mb: 1 }}>
                Overrides for testing and unusual networks. Leave blank for standard behavior.
            </Typography>
            <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
                <PortField
                    label="DDP output port"
                    value={settings.advanced?.ddpPort}
                    placeholder="4048"
                    helperText="Takes effect when the show folder reloads or the player restarts."
                    onCommit={(v) => dispatch(playbackSettingsActions.setAdvancedDdpPort(v))}
                />
            </Box>
        </Box>
    );
};
