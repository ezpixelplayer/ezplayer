import { Add, Delete, ExpandMore, Refresh } from '@mui/icons-material';
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
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { useDispatch, useSelector } from 'react-redux';
import { Select, isElectron } from '@ezplayer/shared-ui-components';
import type { AudioDevice, AudioOutputConfig, VolumeScheduleEntry } from '@ezplayer/ezplayer-core';
import { isPhysicalAudioOutput, resolveAudioOutputDevice } from '@ezplayer/ezplayer-core';
import { Box } from '../../box/Box';
import { playbackSettingsActions } from '../../../store/slices/PlaybackSettingsStore';
import type { AppDispatch, RootState } from '../../../store/Store';
import { supportsLocalAudioRouting } from '../../../store/api/DataStorageAPI';
import { useDataStorageAPI } from '../../../store/DataStorageAPIProvider';
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

type ScheduleDialogTarget = { kind: 'primary' } | { kind: 'output'; outputId: string };

/** A stored output, a connected device, or both (stored output currently connected). */
interface OutputRow {
    key: string;
    label: string;
    config?: AudioOutputConfig;
    device?: AudioDevice;
}

/** Pair stored outputs with connected devices; leftovers become unconfigured rows. */
function buildOutputRows(configs: AudioOutputConfig[], devices: AudioDevice[]): OutputRow[] {
    const taken = new Set<string>();
    const rows: OutputRow[] = configs.map((config) => {
        const device = resolveAudioOutputDevice(config, devices, taken);
        if (device) taken.add(device.deviceId);
        return { key: config.id, label: device?.label || config.label, config, device };
    });
    for (const device of devices) {
        if (taken.has(device.deviceId)) continue;
        rows.push({ key: device.deviceId, label: device.label || `Output (${device.deviceId.slice(0, 8)})`, device });
    }
    return rows;
}

export const AudioSettings: React.FC = () => {
    const dispatch = useDispatch<AppDispatch>();
    const api = useDataStorageAPI();
    const settings = useSelector((s: RootState) => s.playbackSettings.settings);

    const [addOpen, setAddOpen] = useState(false);
    const [scheduleTarget, setScheduleTarget] = useState<ScheduleDialogTarget>({ kind: 'primary' });
    const [newEntry, setNewEntry] = useState<Partial<VolumeScheduleEntry>>(FRESH_ENTRY);
    const [pendingDelete, setPendingDelete] = useState<
        { kind: 'primary'; entryId: string } | { kind: 'output'; outputId: string; entryId: string } | null
    >(null);
    const [outputDevices, setOutputDevices] = useState<AudioDevice[]>([]);
    const [outputsExpanded, setOutputsExpanded] = useState(true);

    // Slider values while dragging. The store is only updated on commit
    const [draftVolume, setDraftVolume] = useState<number | null>(null);
    const [draftSyncAdjust, setDraftSyncAdjust] = useState<number | null>(null);
    const [draftOutputVolumes, setDraftOutputVolumes] = useState<Record<string, number | null>>({});

    const audioOutputs = useMemo(() => settings.audioOutputs ?? [], [settings.audioOutputs]);
    const useDefaultAudioOutput = settings.useDefaultAudioOutput !== false;
    const localAudioRouting = supportsLocalAudioRouting(api);

    const refreshOutputDevices = useCallback(async () => {
        if (!api.getAudioOutputDevices) return;
        try {
            const devices = await api.getAudioOutputDevices();
            setOutputDevices(devices.filter(isPhysicalAudioOutput));
        } catch (err) {
            console.warn('[AudioSettings] audio output device refresh failed', err);
        }
    }, [api]);

    useEffect(() => {
        if (!localAudioRouting) return;
        void refreshOutputDevices();
        // Only the desktop renderer sees the player machine's own device changes.
        if (!isElectron() || !navigator.mediaDevices?.addEventListener) return;
        const onDeviceChange = () => void refreshOutputDevices();
        navigator.mediaDevices.addEventListener('devicechange', onDeviceChange);
        return () => navigator.mediaDevices.removeEventListener('devicechange', onDeviceChange);
    }, [localAudioRouting, refreshOutputDevices]);

    const outputRows = useMemo(() => buildOutputRows(audioOutputs, outputDevices), [audioOutputs, outputDevices]);

    // A stored output matched by label/groupId gets its deviceId refreshed.
    useEffect(() => {
        for (const row of outputRows) {
            if (row.config && row.device && row.device.deviceId !== row.config.deviceId) {
                dispatch(
                    playbackSettingsActions.setAudioOutputDevice({
                        id: row.config.id,
                        deviceId: row.device.deviceId,
                        label: row.device.label,
                        groupId: row.device.groupId,
                    }),
                );
            }
        }
    }, [outputRows, dispatch]);

    const openAddSchedule = (target: ScheduleDialogTarget) => {
        setScheduleTarget(target);
        setNewEntry(FRESH_ENTRY);
        setAddOpen(true);
    };

    const isAddValid =
        newEntry.days &&
        newEntry.startTime &&
        newEntry.endTime &&
        newEntry.volumeLevel !== undefined &&
        isValidTimeFormat(newEntry.startTime) &&
        isValidExtendedTimeFormat(newEntry.endTime);

    const submitAddSchedule = () => {
        if (!isAddValid) return;
        const entry: VolumeScheduleEntry = {
            id: generateId(),
            days: newEntry.days!,
            startTime: formatTime24Hour(newEntry.startTime!),
            endTime: formatTime24Hour(newEntry.endTime!),
            volumeLevel: newEntry.volumeLevel!,
        };
        if (scheduleTarget.kind === 'primary') {
            dispatch(playbackSettingsActions.addVolumeScheduleEntry(entry));
        } else {
            dispatch(playbackSettingsActions.addAudioOutputScheduleEntry({ id: scheduleTarget.outputId, entry }));
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
                playbackSettingsActions.removeAudioOutputScheduleEntry({
                    id: pendingDelete.outputId,
                    entryId: pendingDelete.entryId,
                }),
            );
        }
        setPendingDelete(null);
    };

    const setOutputEnabled = (row: OutputRow, enabled: boolean) => {
        if (enabled) {
            if (row.config || !row.device) return;
            dispatch(
                playbackSettingsActions.addAudioOutput({
                    deviceId: row.device.deviceId,
                    label: row.device.label,
                    groupId: row.device.groupId,
                }),
            );
        } else if (row.config) {
            dispatch(playbackSettingsActions.removeAudioOutput(row.config.id));
        }
    };

    const sliderSx = {
        '& .MuiSlider-thumb': { width: 20, height: 20 },
        '& .MuiSlider-track': { height: 6 },
        '& .MuiSlider-rail': { height: 6 },
    };

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
                                        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, flexWrap: 'wrap' }}>
                                            <Chip label={getDaysDisplayName(entry.days)} size="small" />
                                            <Typography variant="body2">
                                                {formatTime24Hour(entry.startTime)} - {formatTime24Hour(entry.endTime)}
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

    const renderOutputRow = (row: OutputRow) => {
        const output = row.config;
        const draft = output ? draftOutputVolumes[output.id] : null;
        const volume = draft ?? output?.volumeControl.defaultVolume ?? 100;

        return (
            <Box key={row.key} sx={{ mb: 2, p: 2, border: '1px solid', borderColor: 'divider', borderRadius: 1 }}>
                <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, flexWrap: 'wrap' }}>
                    <FormControlLabel
                        control={
                            <Checkbox checked={!!output} onChange={(_, checked) => setOutputEnabled(row, checked)} />
                        }
                        label={
                            <Typography variant="subtitle1" sx={{ fontWeight: 600 }}>
                                {row.label}
                            </Typography>
                        }
                        sx={{ mb: output ? 1 : 0 }}
                    />
                    {output && !row.device && <Chip label="Not connected" size="small" color="warning" />}
                </Box>

                {output && (
                    <>
                        <Typography variant="subtitle2" sx={{ mb: 1 }}>
                            Volume
                        </Typography>
                        <Box sx={{ px: 2, mb: 1 }}>
                            <Slider
                                value={volume}
                                onChange={(_, value) =>
                                    setDraftOutputVolumes((prev) => ({ ...prev, [output.id]: value as number }))
                                }
                                onChangeCommitted={(_, value) => {
                                    setDraftOutputVolumes((prev) => ({ ...prev, [output.id]: null }));
                                    dispatch(
                                        playbackSettingsActions.setAudioOutputVolume({
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
                                sx={sliderSx}
                            />
                        </Box>
                        <Typography variant="body2" sx={{ mb: 2, fontWeight: 'medium' }}>
                            Volume: {volume}%
                        </Typography>

                        <Typography variant="subtitle2" sx={{ mb: 1 }}>
                            Volume Schedule
                        </Typography>
                        <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
                            Overrides for this device only. Last entry takes priority for overlapping times.
                        </Typography>
                        {renderVolumeScheduleList(output.volumeControl.schedule, (entryId) =>
                            setPendingDelete({ kind: 'output', outputId: output.id, entryId }),
                        )}
                        <Button
                            variant="outlined"
                            size="small"
                            startIcon={<Add />}
                            onClick={() => openAddSchedule({ kind: 'output', outputId: output.id })}
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
            {localAudioRouting && (
                <>
                    <Typography variant="h6" sx={{ mb: 2, color: 'primary.main' }}>
                        Audio Output
                    </Typography>
                    <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
                        Play through whatever the system default output is, or through specific devices chosen below.
                    </Typography>
                    <FormControl sx={{ mb: 3 }}>
                        <Typography variant="subtitle2" sx={{ mb: 1 }}>
                            Use default audio output?
                        </Typography>
                        <RadioGroup
                            row
                            value={useDefaultAudioOutput ? 'yes' : 'no'}
                            onChange={(_, value) => {
                                dispatch(playbackSettingsActions.setUseDefaultAudioOutput(value === 'yes'));
                                if (value === 'no') setOutputsExpanded(true);
                            }}
                        >
                            <FormControlLabel value="yes" control={<Radio />} label="Yes" />
                            <FormControlLabel value="no" control={<Radio />} label="No" />
                        </RadioGroup>
                    </FormControl>
                    <Divider sx={{ my: 3 }} />
                </>
            )}

            {(!localAudioRouting || useDefaultAudioOutput) && (
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
                                sx={sliderSx}
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
                            Configure volume overrides for specific times. Last entry takes priority for overlapping
                            times.
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

            {localAudioRouting && !useDefaultAudioOutput && (
                <Accordion
                    disableGutters
                    elevation={0}
                    expanded={outputsExpanded}
                    onChange={(_, expanded) => setOutputsExpanded(expanded)}
                    sx={{ bgcolor: 'transparent', '&:before': { display: 'none' }, mb: 1 }}
                >
                    <AccordionSummary
                        expandIcon={<ExpandMore />}
                        sx={{ px: 0, minHeight: 40, '& .MuiAccordionSummary-content': { my: 1 } }}
                    >
                        <Box>
                            <Typography variant="h6" sx={{ color: 'primary.main' }}>
                                Audio Devices
                            </Typography>
                            <Typography variant="body2" color="text.secondary">
                                {audioOutputs.length === 0
                                    ? 'No devices selected; nothing will play locally'
                                    : `${audioOutputs.length} selected`}
                            </Typography>
                        </Box>
                    </AccordionSummary>
                    <AccordionDetails sx={{ px: 0, pt: 1 }}>
                        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 2 }}>
                            <Typography variant="body2" color="text.secondary" sx={{ flex: 1 }}>
                                Check a device to play to it with its own volume and schedule. Selected devices stay
                                selected while unplugged and resume when they return.
                            </Typography>
                            <IconButton
                                size="small"
                                onClick={() => void refreshOutputDevices()}
                                title="Refresh devices"
                            >
                                <Refresh />
                            </IconButton>
                        </Box>
                        {outputRows.length === 0 ? (
                            <Typography variant="body2" color="text.secondary">
                                No audio output devices found.
                            </Typography>
                        ) : (
                            outputRows.map(renderOutputRow)
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
