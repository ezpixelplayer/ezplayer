import { Add, Delete, ExpandMore } from '@mui/icons-material';
import {
    Accordion,
    AccordionDetails,
    AccordionSummary,
    Button,
    Checkbox,
    Chip,
    Dialog,
    DialogContent,
    DialogTitle,
    Divider,
    FormControl,
    FormControlLabel,
    IconButton,
    List,
    ListItem,
    ListItemSecondaryAction,
    ListItemText,
    Radio,
    RadioGroup,
    Slider,
    Switch,
    Typography,
} from '@mui/material';
import React, { useCallback, useEffect, useState } from 'react';
import { useDispatch, useSelector } from 'react-redux';
import { Select, isElectron } from '@ezplayer/shared-ui-components';
import type { AudioDevice, VolumeScheduleEntry } from '@ezplayer/ezplayer-core';
import { Box } from '../../box/Box';
import { playbackSettingsActions } from '../../../store/slices/PlaybackSettingsStore';
import type { AppDispatch, RootState } from '../../../store/Store';
import {
    DAY_OPTIONS,
    DayKey,
    formatTime24Hour,
    generateId,
    getDaysDisplayName,
    isValidExtendedTimeFormat,
    isValidTimeFormat,
    TimeInput,
} from './sectionHelpers';

const FRESH_ENTRY: Partial<VolumeScheduleEntry> = {
    days: 'all',
    startTime: '00:00',
    endTime: '23:59',
    volumeLevel: 100,
};

/** Prefer real sinks; Chromium's synthetic "default"/"communications" entries
 *  often duplicate a physical device and would double-play if both are used. */
function isPhysicalOutput(d: AudioDevice): boolean {
    return d.deviceId !== 'default' && d.deviceId !== 'communications';
}

/** Additional outputs must be real device ids — never the system-default sink. */
function isPhysicalAdditionalDevice(d: { id: string; name: string }): boolean {
    if (!d.id || d.id === 'default' || d.id === 'communications') return false;
    if (/^default$/i.test(d.name.trim())) return false;
    return true;
}

/** Chromium's synthetic `default` sink shares groupId with the OS default speaker. */
function isSystemDefaultRouteDevice(device: AudioDevice, systemDefaultGroupId?: string): boolean {
    if (systemDefaultGroupId && device.groupId === systemDefaultGroupId) return true;
    if (/^default\b/i.test(device.label?.trim() ?? '')) return true;
    if (/\bdefault\s*[-–—]/i.test(device.label ?? '')) return true;
    return false;
}

type ScheduleDialogTarget =
    | { kind: 'primary' }
    | { kind: 'additional'; outputId: string };

function newOutputId(): string {
    return `aaudio-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
}

export const AudioSettings: React.FC = () => {
    const dispatch = useDispatch<AppDispatch>();
    const settings = useSelector((s: RootState) => s.playbackSettings.settings);

    const [addOpen, setAddOpen] = useState(false);
    const [scheduleTarget, setScheduleTarget] = useState<ScheduleDialogTarget>({ kind: 'primary' });
    const [newEntry, setNewEntry] = useState<Partial<VolumeScheduleEntry>>(FRESH_ENTRY);
    const [pendingDelete, setPendingDelete] = useState<
        { kind: 'primary'; entryId: string } | { kind: 'additional'; outputId: string; entryId: string } | null
    >(null);
    const [outputDevices, setOutputDevices] = useState<AudioDevice[]>([]);
    /** groupId shared by Chromium's synthetic `default` audiooutput and the OS default speaker. */
    const [systemDefaultGroupId, setSystemDefaultGroupId] = useState<string | undefined>();
    const [additionalExpanded, setAdditionalExpanded] = useState(false);

    // Slider values while dragging. The store is only updated on commit
    const [draftVolume, setDraftVolume] = useState<number | null>(null);
    const [draftSyncAdjust, setDraftSyncAdjust] = useState<number | null>(null);
    const [draftAdditionalVolumes, setDraftAdditionalVolumes] = useState<Record<string, number | null>>({});

    const additionalOutputs = settings.additionalAudioOutputs ?? [];
    const primaryDeviceId = settings.primaryAudioOutputDeviceId ?? '';
    const systemDefaultOutputDeviceId = settings.systemDefaultOutputDeviceId ?? '';
    const useDefaultAudioOutput = settings.useDefaultAudioOutput !== false;
    const electronDesktop = isElectron();

    useEffect(() => {
        if (!electronDesktop || !navigator.mediaDevices?.enumerateDevices) return;

        let cancelled = false;
        const refresh = async () => {
            try {
                const devices = await navigator.mediaDevices.enumerateDevices();
                if (cancelled) return;
                const audioOutputs = devices.filter((d) => d.kind === 'audiooutput');
                const defaultSink = audioOutputs.find((d) => d.deviceId === 'default');
                setSystemDefaultGroupId(defaultSink?.groupId || undefined);
                setOutputDevices(
                    audioOutputs
                        .filter((d) => isPhysicalOutput(d as AudioDevice))
                        .map(
                            (d) =>
                                ({
                                    label: d.label,
                                    deviceId: d.deviceId,
                                    kind: d.kind,
                                    groupId: d.groupId,
                                }) satisfies AudioDevice,
                        ),
                );
            } catch (err) {
                console.warn('[AudioSettings] enumerateDevices failed', err);
            }
        };

        void refresh();
        navigator.mediaDevices.addEventListener?.('devicechange', refresh);
        return () => {
            cancelled = true;
            navigator.mediaDevices.removeEventListener?.('devicechange', refresh);
        };
    }, [electronDesktop]);

    // Remember which physical device is the OS default route (for exclusion when default output is off).
    useEffect(() => {
        if (!electronDesktop || !systemDefaultGroupId) return;
        const defaultPhysical = outputDevices.find((d) => d.groupId === systemDefaultGroupId);
        const id = defaultPhysical?.deviceId;
        if (id && id !== systemDefaultOutputDeviceId) {
            dispatch(playbackSettingsActions.setSystemDefaultOutputDeviceId(id));
        }
    }, [
        electronDesktop,
        systemDefaultGroupId,
        outputDevices,
        systemDefaultOutputDeviceId,
        dispatch,
    ]);

    /** Connected physical outputs only. */
    const connectedDeviceOptions = outputDevices.map((d) => ({
        id: d.deviceId,
        name: d.label || `Output (${d.deviceId.slice(0, 8)}…)`,
    }));

    const isExcludedFromAdditionalList = useCallback(
        (deviceId: string): boolean => {
            if (!isPhysicalAdditionalDevice({ id: deviceId, name: '' })) return true;
            if (!useDefaultAudioOutput) {
                if (systemDefaultOutputDeviceId && deviceId === systemDefaultOutputDeviceId) {
                    return true;
                }
                const dev = outputDevices.find((d) => d.deviceId === deviceId);
                if (dev && isSystemDefaultRouteDevice(dev, systemDefaultGroupId)) return true;
            }
            if (useDefaultAudioOutput && deviceId === primaryDeviceId) return true;
            return false;
        },
        [
            outputDevices,
            useDefaultAudioOutput,
            systemDefaultGroupId,
            systemDefaultOutputDeviceId,
            primaryDeviceId,
        ],
    );

    /** Connected physical outputs for additional picks (never system Default). */
    const selectableAdditionalDevices = connectedDeviceOptions.filter(
        (d) => !isExcludedFromAdditionalList(d.id),
    );

    const additionalByDeviceId = new Map(
        additionalOutputs.filter((o) => o.deviceId).map((o) => [o.deviceId, o]),
    );

    // If primary moves onto a device that was additional, drop that duplicate only.
    useEffect(() => {
        if (!electronDesktop || !useDefaultAudioOutput) return;
        const withoutPrimaryDup = additionalOutputs.filter((o) => o.deviceId !== primaryDeviceId);
        if (withoutPrimaryDup.length !== additionalOutputs.length) {
            dispatch(playbackSettingsActions.setAdditionalAudioOutputs(withoutPrimaryDup));
        }
    }, [electronDesktop, useDefaultAudioOutput, primaryDeviceId, additionalOutputs, dispatch]);

    useEffect(() => {
        if (!electronDesktop || useDefaultAudioOutput) return;
        if (additionalOutputs.length > 0) {
            setAdditionalExpanded(true);
        }
    }, [electronDesktop, useDefaultAudioOutput, additionalOutputs.length]);

    // Default output off: drop rows for the system-default route (same groupId as Chromium `default`).
    useEffect(() => {
        if (!electronDesktop || useDefaultAudioOutput) return;
        const kept = additionalOutputs.filter((o) => !isExcludedFromAdditionalList(o.deviceId));
        if (kept.length !== additionalOutputs.length) {
            dispatch(playbackSettingsActions.setAdditionalAudioOutputs(kept));
        }
    }, [
        electronDesktop,
        useDefaultAudioOutput,
        additionalOutputs,
        isExcludedFromAdditionalList,
        dispatch,
    ]);

    const openAddSchedule = (target: ScheduleDialogTarget) => {
        setScheduleTarget(target);
        setNewEntry(FRESH_ENTRY);
        setAddOpen(true);
    };

    const submitAddSchedule = () => {
        if (
            !(
                newEntry.days &&
                newEntry.startTime &&
                newEntry.endTime &&
                newEntry.volumeLevel !== undefined &&
                isValidTimeFormat(newEntry.startTime) &&
                isValidExtendedTimeFormat(newEntry.endTime)
            )
        ) {
            return;
        }
        const entry: VolumeScheduleEntry = {
            id: generateId(),
            days: newEntry.days,
            startTime: formatTime24Hour(newEntry.startTime),
            endTime: formatTime24Hour(newEntry.endTime),
            volumeLevel: newEntry.volumeLevel,
        };
        if (scheduleTarget.kind === 'primary') {
            dispatch(playbackSettingsActions.addVolumeScheduleEntry(entry));
        } else {
            dispatch(
                playbackSettingsActions.addAdditionalAudioOutputScheduleEntry({
                    id: scheduleTarget.outputId,
                    entry,
                }),
            );
        }
        setNewEntry(FRESH_ENTRY);
        setAddOpen(false);
    };

    const confirmDeleteSchedule = () => {
        if (!pendingDelete) return;
        if (pendingDelete.kind === 'primary') {
            dispatch(playbackSettingsActions.removeVolumeScheduleEntry(pendingDelete.entryId));
        } else {
            dispatch(
                playbackSettingsActions.removeAdditionalAudioOutputScheduleEntry({
                    id: pendingDelete.outputId,
                    entryId: pendingDelete.entryId,
                }),
            );
        }
        setPendingDelete(null);
    };

    const setAdditionalEnabled = (deviceId: string, enabled: boolean) => {
        if (enabled && isExcludedFromAdditionalList(deviceId)) return;
        const existing = additionalByDeviceId.get(deviceId);
        if (enabled) {
            if (existing) return;
            dispatch(
                playbackSettingsActions.addAdditionalAudioOutput({
                    id: newOutputId(),
                    deviceId,
                    volumeControl: { defaultVolume: 100, schedule: [] },
                }),
            );
            setAdditionalExpanded(true);
            return;
        }
        if (existing) {
            dispatch(playbackSettingsActions.removeAdditionalAudioOutput(existing.id));
        }
    };

    const isAddValid =
        newEntry.days &&
        newEntry.startTime &&
        newEntry.endTime &&
        newEntry.volumeLevel !== undefined &&
        isValidTimeFormat(newEntry.startTime) &&
        isValidExtendedTimeFormat(newEntry.endTime);

    const renderVolumeScheduleList = (
        schedule: VolumeScheduleEntry[] | undefined,
        onDelete: (entryId: string) => void,
    ) => {
        const entries = schedule ?? [];
        if (entries.length === 0) return null;
        return (
            <Box sx={{ mb: 2 }}>
                <Typography variant="subtitle2" sx={{ mb: 1 }}>
                    Current Volume Overrides ({entries.length} entries)
                </Typography>
                <List dense>
                    {entries.map((entry, index) => (
                        <React.Fragment key={entry.id}>
                            <ListItem>
                                <ListItemText
                                    primary={
                                        <Box
                                            sx={{
                                                display: 'flex',
                                                alignItems: 'center',
                                                gap: 1,
                                                flexWrap: 'wrap',
                                            }}
                                        >
                                            <Chip label={getDaysDisplayName(entry.days)} size="small" />
                                            <Typography variant="body2">
                                                {formatTime24Hour(entry.startTime)} -{' '}
                                                {formatTime24Hour(entry.endTime)}
                                            </Typography>
                                            <Chip
                                                label={`${entry.volumeLevel}%`}
                                                size="small"
                                                color="primary"
                                                variant="outlined"
                                            />
                                        </Box>
                                    }
                                    secondary={`Priority: ${entries.length - index}`}
                                />
                                <ListItemSecondaryAction>
                                    <IconButton
                                        edge="end"
                                        onClick={() => onDelete(entry.id)}
                                        size="small"
                                        color="error"
                                    >
                                        <Delete />
                                    </IconButton>
                                </ListItemSecondaryAction>
                            </ListItem>
                            {index < entries.length - 1 && <Divider />}
                        </React.Fragment>
                    ))}
                </List>
            </Box>
        );
    };

    const renderConnectedAdditionalDevice = (device: { id: string; name: string }) => {
        const output = additionalByDeviceId.get(device.id);
        const enabled = !!output;
        const draft = output ? draftAdditionalVolumes[output.id] : null;
        const volume = draft ?? output?.volumeControl?.defaultVolume ?? 100;

        return (
            <Box
                key={device.id}
                sx={{
                    mb: 2,
                    p: 2,
                    border: '1px solid',
                    borderColor: 'divider',
                    borderRadius: 1,
                }}
            >
                <FormControlLabel
                    control={
                        <Checkbox
                            checked={enabled}
                            onChange={(_, checked) => setAdditionalEnabled(device.id, checked)}
                        />
                    }
                    label={
                        <Typography variant="subtitle1" sx={{ fontWeight: 600 }}>
                            {device.name}
                        </Typography>
                    }
                    sx={{ mb: enabled ? 1 : 0 }}
                />

                {enabled && output && (
                    <>
                        <Typography variant="subtitle2" sx={{ mb: 1 }}>
                            Volume
                        </Typography>
                        <Box sx={{ px: 2, mb: 1 }}>
                            <Slider
                                value={volume}
                                onChange={(_, value) =>
                                    setDraftAdditionalVolumes((prev) => ({
                                        ...prev,
                                        [output.id]: value as number,
                                    }))
                                }
                                onChangeCommitted={(_, value) => {
                                    setDraftAdditionalVolumes((prev) => ({
                                        ...prev,
                                        [output.id]: null,
                                    }));
                                    dispatch(
                                        playbackSettingsActions.setAdditionalAudioOutputVolume({
                                            id: output.id,
                                            volume: value as number,
                                        }),
                                    );
                                }}
                                min={0}
                                max={100}
                                step={1}
                                marks={[
                                    { value: 0, label: '0' },
                                    { value: 50, label: '50' },
                                    { value: 100, label: '100' },
                                ]}
                                valueLabelDisplay="auto"
                                valueLabelFormat={(v) => `${v}%`}
                                sx={{
                                    '& .MuiSlider-thumb': { width: 20, height: 20 },
                                    '& .MuiSlider-track': { height: 6 },
                                    '& .MuiSlider-rail': { height: 6 },
                                }}
                            />
                        </Box>
                        <Typography variant="body2" sx={{ mb: 2, fontWeight: 'medium' }}>
                            Volume: {volume}%
                        </Typography>

                        <Typography variant="subtitle2" sx={{ mb: 1 }}>
                            Volume Schedule
                        </Typography>
                        <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
                            Independent overrides for this device. Last entry takes priority for
                            overlapping times.
                        </Typography>
                        {renderVolumeScheduleList(output.volumeControl?.schedule, (entryId) =>
                            setPendingDelete({
                                kind: 'additional',
                                outputId: output.id,
                                entryId,
                            }),
                        )}
                        <Button
                            variant="outlined"
                            size="small"
                            startIcon={<Add />}
                            onClick={() =>
                                openAddSchedule({ kind: 'additional', outputId: output.id })
                            }
                        >
                            Add Volume Override
                        </Button>
                    </>
                )}
            </Box>
        );
    };

    return (
        <Box>
            {electronDesktop && (
                <>
                    <Typography variant="h6" sx={{ mb: 2, color: 'primary.main' }}>
                        Audio Output
                    </Typography>
                    <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
                        Choose whether audio plays through the system default output or only
                        through specific devices you select below.
                    </Typography>
                    <FormControl sx={{ mb: 3 }}>
                        <Typography variant="subtitle2" sx={{ mb: 1 }}>
                            Use default audio output?
                        </Typography>
                        <RadioGroup
                            row
                            value={useDefaultAudioOutput ? 'yes' : 'no'}
                            onChange={(_, value) => {
                                dispatch(
                                    playbackSettingsActions.setUseDefaultAudioOutput(value === 'yes'),
                                );
                                if (value === 'no') {
                                    setAdditionalExpanded(true);
                                }
                            }}
                        >
                            <FormControlLabel value="yes" control={<Radio />} label="Yes" />
                            <FormControlLabel value="no" control={<Radio />} label="No" />
                        </RadioGroup>
                    </FormControl>
                    <Divider sx={{ my: 3 }} />
                </>
            )}

            {(!electronDesktop || useDefaultAudioOutput) && (
                <>
                    <Typography variant="h6" sx={{ mb: 2, color: 'primary.main' }}>
                        Volume Control
                    </Typography>
                    <Box sx={{ mb: 3 }}>
                        <Typography variant="subtitle2" sx={{ mb: 2 }}>
                            Default Volume
                        </Typography>
                        <Box sx={{ px: 2 }}>
                            <Slider
                                value={draftVolume ?? settings.volumeControl.defaultVolume}
                                onChange={(_, value) => setDraftVolume(value as number)}
                                onChangeCommitted={(_, value) => {
                                    setDraftVolume(null);
                                    dispatch(playbackSettingsActions.setDefaultVolume(value as number));
                                }}
                                min={0}
                                max={100}
                                step={1}
                                marks={[
                                    { value: 0, label: '0' },
                                    { value: 25, label: '25' },
                                    { value: 50, label: '50' },
                                    { value: 75, label: '75' },
                                    { value: 100, label: '100' },
                                ]}
                                valueLabelDisplay="auto"
                                valueLabelFormat={(value) => `${value}%`}
                                sx={{
                                    '& .MuiSlider-thumb': { width: 20, height: 20 },
                                    '& .MuiSlider-track': { height: 6 },
                                    '& .MuiSlider-rail': { height: 6 },
                                }}
                            />
                        </Box>
                        <Typography variant="body2" sx={{ mt: 1, fontWeight: 'medium' }}>
                            Default Volume: {draftVolume ?? settings.volumeControl.defaultVolume}%
                        </Typography>
                    </Box>

                    <Box>
                        <Typography variant="subtitle2" sx={{ mb: 2 }}>
                            Volume Schedule Overrides
                        </Typography>
                        <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
                            Configure volume overrides for specific times. Last entry takes priority for overlapping times.
                        </Typography>

                        {renderVolumeScheduleList(settings.volumeControl?.schedule, (entryId) =>
                            setPendingDelete({ kind: 'primary', entryId }),
                        )}

                        <Button
                            variant="contained"
                            startIcon={<Add />}
                            onClick={() => openAddSchedule({ kind: 'primary' })}
                            sx={{ mb: 2 }}
                        >
                            Add Volume Override
                        </Button>
                    </Box>
                </>
            )}

            {electronDesktop && !useDefaultAudioOutput && (
                <Accordion
                    disableGutters
                    elevation={0}
                    expanded={additionalExpanded}
                    onChange={(_, expanded) => setAdditionalExpanded(expanded)}
                    sx={{
                        bgcolor: 'transparent',
                        '&:before': { display: 'none' },
                        mb: 1,
                    }}
                >
                    <AccordionSummary
                        expandIcon={<ExpandMore />}
                        sx={{
                            px: 0,
                            minHeight: 40,
                            '& .MuiAccordionSummary-content': { my: 1 },
                        }}
                    >
                        <Box>
                            <Typography variant="h6" sx={{ color: 'primary.main' }}>
                                Additional Audio Devices
                            </Typography>
                            <Typography variant="body2" color="text.secondary">
                                {selectableAdditionalDevices.length === 0
                                    ? 'No connected outputs available'
                                    : `${selectableAdditionalDevices.length} connected output${selectableAdditionalDevices.length === 1 ? '' : 's'} — check to play here`}
                            </Typography>
                        </Box>
                    </AccordionSummary>
                    <AccordionDetails sx={{ px: 0, pt: 1 }}>
                        <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
                            System default output is disabled. Only currently connected devices are
                            listed. Check a device to play to it with its own volume and schedule.
                        </Typography>
                        {selectableAdditionalDevices.filter((d) =>
                            /bluetooth|headset|earbuds|buds/i.test(d.name),
                        ).length >= 2 &&
                            additionalOutputs.filter((o) =>
                                /bluetooth|headset|earbuds|buds/i.test(
                                    connectedDeviceOptions.find((d) => d.id === o.deviceId)?.name ??
                                        '',
                                ),
                            ).length >= 2 && (
                                <Typography
                                    variant="body2"
                                    color="warning.main"
                                    sx={{ mb: 2, fontWeight: 600 }}
                                >
                                    Two Bluetooth earphones usually cannot play at the same time.
                                    Classic Bluetooth only keeps one high-quality audio stream active.
                                    Prefer wired/USB speakers, or Windows 11 Quick Settings → Shared
                                    Audio (Bluetooth LE Audio).
                                </Typography>
                            )}
                        {selectableAdditionalDevices.length === 0 ? (
                            <Typography variant="body2" color="text.secondary">
                                No audio output devices found.
                            </Typography>
                        ) : (
                            selectableAdditionalDevices.map((device) =>
                                renderConnectedAdditionalDevice(device),
                            )
                        )}
                    </AccordionDetails>
                </Accordion>
            )}

            <Divider sx={{ my: 3 }} />

            <Typography variant="h6" sx={{ mb: 2, color: 'primary.main' }}>
                Loudness Normalization
            </Typography>
            <Box sx={{ mt: 1 }}>
                <FormControlLabel
                    control={
                        <Switch
                            checked={settings.normalizeNewSongs === true}
                            onChange={(e) => dispatch(playbackSettingsActions.setNormalizeNewSongs(e.target.checked))}
                        />
                    }
                    label="Normalize volume of new songs by default"
                />
                <Typography variant="body2" color="text.secondary">
                    Songs you add get "Normalize volume" turned on, so they play at a consistent loudness (EBU R128, -16
                    LUFS). The original audio file is never changed; the derived copy lives in the show folder. Cloud
                    songs already arrive normalized. Change it per song in Edit Song.
                </Typography>
            </Box>

            <Divider sx={{ my: 3 }} />

            <Typography variant="h6" sx={{ mb: 2, color: 'primary.main' }}>
                Audio Sync Adjust
            </Typography>
            <Box sx={{ px: 2 }}>
                <Slider
                    value={draftSyncAdjust ?? settings.audioSyncAdjust}
                    onChange={(_, value) => setDraftSyncAdjust(value as number)}
                    onChangeCommitted={(_, value) => {
                        setDraftSyncAdjust(null);
                        dispatch(playbackSettingsActions.setAudioSyncAdjust(value as number));
                    }}
                    min={-100}
                    max={100}
                    step={1}
                    marks={[
                        { value: -100, label: '-100' },
                        { value: -50, label: '-50' },
                        { value: 0, label: '0' },
                        { value: 50, label: '50' },
                        { value: 100, label: '100' },
                    ]}
                    valueLabelDisplay="auto"
                    valueLabelFormat={(value) => `${value}ms`}
                    sx={{
                        '& .MuiSlider-thumb': { width: 20, height: 20 },
                        '& .MuiSlider-track': { height: 6 },
                        '& .MuiSlider-rail': { height: 6 },
                    }}
                />
            </Box>
            <Typography variant="caption" color="text.secondary" sx={{ mt: 1, display: 'block' }}>
                Adjust audio synchronization. Negative values sync earlier, positive values sync later.
            </Typography>
            <Typography variant="body2" sx={{ mt: 1, fontWeight: 'medium' }}>
                Current value: {draftSyncAdjust ?? settings.audioSyncAdjust}ms
            </Typography>

            <Dialog open={addOpen} onClose={() => setAddOpen(false)}>
                <DialogTitle>
                    <Typography variant="h5">Add Volume Override</Typography>
                </DialogTitle>
                <DialogContent>
                    <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2, pt: 1, minWidth: '500px' }}>
                        <Box>
                            <Typography variant="subtitle2" sx={{ mb: 1, fontWeight: 600 }}>
                                Select Days
                            </Typography>
                            <FormControl fullWidth size="small">
                                <Select
                                    options={DAY_OPTIONS}
                                    itemText="name"
                                    itemValue="id"
                                    onChange={(e) =>
                                        setNewEntry({
                                            ...newEntry,
                                            days: (e.target as HTMLSelectElement).value as DayKey,
                                        })
                                    }
                                    label="Select Days"
                                    value={newEntry.days}
                                />
                            </FormControl>
                        </Box>

                        <Box>
                            <Typography variant="subtitle2" sx={{ mb: 1, fontWeight: 600 }}>
                                Time Range
                            </Typography>
                            <Box sx={{ display: 'flex', gap: 3, alignItems: 'flex-start' }}>
                                <TimeInput
                                    size="small"
                                    label="Start Time"
                                    value={newEntry.startTime || ''}
                                    onChange={(value) => setNewEntry({ ...newEntry, startTime: value })}
                                    isFromTime={true}
                                    sx={{ flex: 1 }}
                                />
                                <TimeInput
                                    size="small"
                                    label="End Time"
                                    value={newEntry.endTime || ''}
                                    onChange={(value) => setNewEntry({ ...newEntry, endTime: value })}
                                    isFromTime={false}
                                    sx={{ flex: 1 }}
                                />
                            </Box>
                        </Box>

                        <Box>
                            <Typography variant="subtitle2" sx={{ mb: 1, fontWeight: 600 }}>
                                Volume Level
                            </Typography>
                            <Box sx={{ px: 2 }}>
                                <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
                                    Set volume level: {newEntry.volumeLevel ?? 100}%
                                </Typography>
                                <Slider
                                    value={newEntry.volumeLevel ?? 100}
                                    onChangeCommitted={(_, value) =>
                                        setNewEntry({ ...newEntry, volumeLevel: value as number })
                                    }
                                    min={0}
                                    max={100}
                                    marks={[
                                        { value: 0, label: '0' },
                                        { value: 25, label: '25' },
                                        { value: 50, label: '50' },
                                        { value: 75, label: '75' },
                                        { value: 100, label: '100' },
                                    ]}
                                    step={1}
                                    size="small"
                                    sx={{
                                        '& .MuiSlider-thumb': { width: 20, height: 20 },
                                        '& .MuiSlider-track': { height: 6 },
                                        '& .MuiSlider-rail': { height: 6 },
                                    }}
                                />
                            </Box>
                        </Box>

                        <Box
                            sx={{
                                display: 'flex',
                                justifyContent: 'flex-end',
                                gap: 2,
                                mt: 2,
                                pt: 2,
                                borderTop: '1px solid',
                                borderColor: 'divider',
                            }}
                        >
                            <Button variant="outlined" onClick={() => setAddOpen(false)} sx={{ minWidth: 100 }}>
                                Cancel
                            </Button>
                            <Button
                                variant="contained"
                                startIcon={<Add />}
                                onClick={submitAddSchedule}
                                disabled={!isAddValid}
                                sx={{ minWidth: 140 }}
                            >
                                Add Volume Override
                            </Button>
                        </Box>
                    </Box>
                </DialogContent>
            </Dialog>

            <Dialog open={!!pendingDelete} onClose={() => setPendingDelete(null)}>
                <DialogTitle>
                    <Typography variant="h5">Delete Volume Override</Typography>
                </DialogTitle>
                <DialogContent>
                    <Box sx={{ display: 'flex', flexDirection: 'column', gap: 3, minWidth: '400px' }}>
                        <Typography variant="body1" color="text.secondary">
                            Are you sure you want to delete this volume override?
                        </Typography>
                        <Box sx={{ display: 'flex', justifyContent: 'flex-end', gap: 2 }}>
                            <Button variant="outlined" onClick={() => setPendingDelete(null)} sx={{ minWidth: 100 }}>
                                Cancel
                            </Button>
                            <Button
                                variant="contained"
                                color="error"
                                onClick={confirmDeleteSchedule}
                                sx={{ minWidth: 100 }}
                            >
                                Delete
                            </Button>
                        </Box>
                    </Box>
                </DialogContent>
            </Dialog>
        </Box>
    );
};
