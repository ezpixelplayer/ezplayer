import { Checkbox, Divider, FormControl, FormControlLabel, Switch, TextField, Typography } from '@mui/material';
import React from 'react';
import { useDispatch, useSelector } from 'react-redux';
import { isElectron, Select } from '@ezplayer/shared-ui-components';
import type { EZPElectronAPI } from '@ezplayer/ezplayer-core';
import { Box } from '../../box/Box';
import { TagListInput } from '../../tag-list-input/TagListInput';
import { playbackSettingsActions } from '../../../store/slices/PlaybackSettingsStore';
import type { AppDispatch, RootState } from '../../../store/Store';

declare global {
    interface Window {
        electronAPI?: EZPElectronAPI;
    }
}

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
    const onDesktop = isElectron();
    // Treat as Partial so we can detect older preload builds missing login-item APIs.
    const loginItemApi = window.electronAPI as Partial<EZPElectronAPI> | undefined;
    const [loginItemSupported, setLoginItemSupported] = React.useState(false);
    const canControlLoginItem = Boolean(
        loginItemApi?.isLoginItemSupported && loginItemApi.getOpenAtLogin && loginItemApi.setOpenAtLogin,
    );
    const [openAtLogin, setOpenAtLogin] = React.useState(false);
    const [openAtLoginLoading, setOpenAtLoginLoading] = React.useState(onDesktop && canControlLoginItem);
    const [openAtLoginSaving, setOpenAtLoginSaving] = React.useState(false);

    React.useEffect(() => {
        if (!onDesktop || !canControlLoginItem || !loginItemApi?.isLoginItemSupported) {
            setLoginItemSupported(false);
            setOpenAtLoginLoading(false);
            return;
        }
        let cancelled = false;
        setOpenAtLoginLoading(true);
        loginItemApi
            .isLoginItemSupported()
            .then((supported) => {
                if (cancelled) return;
                setLoginItemSupported(supported);
                if (!supported || !loginItemApi.getOpenAtLogin) return;
                return loginItemApi.getOpenAtLogin();
            })
            .then((enabled) => {
                if (!cancelled && typeof enabled === 'boolean') setOpenAtLogin(enabled);
            })
            .catch((error) => console.error('Failed to read login-item settings:', error))
            .finally(() => {
                if (!cancelled) setOpenAtLoginLoading(false);
            });
        return () => {
            cancelled = true;
        };
    }, [onDesktop, canControlLoginItem, loginItemApi]);

    const handleOpenAtLoginChange = async (_event: React.ChangeEvent<HTMLInputElement>, checked: boolean) => {
        if (!loginItemApi?.setOpenAtLogin) return;
        const previous = openAtLogin;
        setOpenAtLogin(checked);
        setOpenAtLoginSaving(true);
        try {
            const actual = await loginItemApi.setOpenAtLogin(checked);
            setOpenAtLogin(actual);
        } catch (error) {
            console.error('Failed to update login-item settings:', error);
            setOpenAtLogin(previous);
        } finally {
            setOpenAtLoginSaving(false);
        }
    };

    return (
        <Box>
            <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
                Player runtime behaviors.
            </Typography>
            {onDesktop && canControlLoginItem && loginItemSupported && (
                <Box sx={{ mb: 2 }}>
                    <FormControlLabel
                        control={
                            <Checkbox
                                checked={openAtLogin}
                                onChange={(_e, checked) => void handleOpenAtLoginChange(_e, checked)}
                                disabled={openAtLoginLoading || openAtLoginSaving}
                            />
                        }
                        label="Start EZPlayer when I sign in"
                    />
                    <Typography variant="body2" color="text.secondary">
                        Launch EZPlayer automatically when you sign in to Windows.
                    </Typography>
                </Box>
            )}
            {onDesktop && canControlLoginItem && !loginItemSupported && !openAtLoginLoading && (
                <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
                    Start at sign-in is available in the installed EZPlayer app, not while running from development
                    mode.
                </Typography>
            )}
            {onDesktop && !canControlLoginItem && (
                <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
                    Restart EZPlayer to enable the sign-in startup setting.
                </Typography>
            )}
            <FormControl fullWidth size="small">
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
                            onChange={(e) =>
                                dispatch(playbackSettingsActions.setSendIdleBlackFrames(e.target.checked))
                            }
                        />
                    }
                    label="Blackout when idle"
                />
                <Typography variant="body2" color="text.secondary">
                    Send black frames while nothing is playing so lights go dark. Turn off when another player
                    drives the same controllers — lights then hold their last frame when playback stops.
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

            <Divider sx={{ my: 3 }} />
            <Typography variant="subtitle2" sx={{ mb: 0.5 }}>
                Test Sequences
            </Typography>
            <Typography variant="body2" color="text.secondary" sx={{ mb: 1 }}>
                Sequences carrying any of these tags are offered in the Show Status test area. Clear the list to
                hide the test area.
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
