import { Add, Delete } from '@mui/icons-material';
import {
    Button,
    Checkbox,
    Chip,
    Dialog,
    DialogContent,
    DialogTitle,
    Divider,
    FormControl,
    FormControlLabel,
    FormGroup,
    IconButton,
    List,
    ListItem,
    ListItemSecondaryAction,
    ListItemText,
    Slider,
    Typography,
} from '@mui/material';
import React, { useEffect, useState } from 'react';
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
 *  often duplicate a physical device and would double-play if both are checked. */
function isPhysicalOutput(d: AudioDevice): boolean {
    return d.deviceId !== 'default' && d.deviceId !== 'communications';
}

export const AudioSettings: React.FC = () => {
    const dispatch = useDispatch<AppDispatch>();
    const settings = useSelector((s: RootState) => s.playbackSettings.settings);

    const [addOpen, setAddOpen] = useState(false);
    const [newEntry, setNewEntry] = useState<Partial<VolumeScheduleEntry>>(FRESH_ENTRY);
    const [pendingDeleteId, setPendingDeleteId] = useState<string | null>(null);
    const [outputDevices, setOutputDevices] = useState<AudioDevice[]>([]);

    // Slider values while dragging. The store is only updated on commit
    const [draftVolume, setDraftVolume] = useState<number | null>(null);
    const [draftSyncAdjust, setDraftSyncAdjust] = useState<number | null>(null);

    const selectedOutputIds = settings.audioOutputDeviceIds ?? [];
    const electronDesktop = isElectron();

    useEffect(() => {
        if (!electronDesktop || !navigator.mediaDevices?.enumerateDevices) return;

        let cancelled = false;
        const refresh = async () => {
            try {
                const devices = await navigator.mediaDevices.enumerateDevices();
                if (cancelled) return;
                setOutputDevices(
                    devices
                        .filter((d) => d.kind === 'audiooutput')
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

    const toggleOutputDevice = (deviceId: string, checked: boolean) => {
        const next = new Set(selectedOutputIds);
        if (checked) {
            next.add(deviceId);
        } else {
            next.delete(deviceId);
        }
        dispatch(playbackSettingsActions.setAudioOutputDeviceIds([...next]));
    };

    const openAdd = () => {
        setNewEntry(FRESH_ENTRY);
        setAddOpen(true);
    };

    const submitAdd = () => {
        if (
            newEntry.days &&
            newEntry.startTime &&
            newEntry.endTime &&
            newEntry.volumeLevel !== undefined &&
            isValidTimeFormat(newEntry.startTime) &&
            isValidExtendedTimeFormat(newEntry.endTime)
        ) {
            const entry: VolumeScheduleEntry = {
                id: generateId(),
                days: newEntry.days,
                startTime: formatTime24Hour(newEntry.startTime),
                endTime: formatTime24Hour(newEntry.endTime),
                volumeLevel: newEntry.volumeLevel,
            };
            dispatch(playbackSettingsActions.addVolumeScheduleEntry(entry));
            setNewEntry(FRESH_ENTRY);
            setAddOpen(false);
        }
    };

    const confirmDelete = () => {
        if (pendingDeleteId) {
            dispatch(playbackSettingsActions.removeVolumeScheduleEntry(pendingDeleteId));
        }
        setPendingDeleteId(null);
    };

    const isAddValid =
        newEntry.days &&
        newEntry.startTime &&
        newEntry.endTime &&
        newEntry.volumeLevel !== undefined &&
        isValidTimeFormat(newEntry.startTime) &&
        isValidExtendedTimeFormat(newEntry.endTime);

    return (
        <Box>
            {electronDesktop && (
                <>
                    <Typography variant="h6" sx={{ mb: 2, color: 'primary.main' }}>
                        Audio Outputs
                    </Typography>
                    <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
                        Play to one or more speakers at once. Each selected device gets its own audio
                        engine (one AudioContext per window). With none selected, the system default
                        output is used.
                    </Typography>
                    {selectedOutputIds.length >= 2 &&
                        outputDevices.filter(
                            (d) =>
                                selectedOutputIds.includes(d.deviceId) &&
                                /bluetooth|headset|earbuds|buds/i.test(d.label),
                        ).length >= 2 && (
                            <Typography
                                variant="body2"
                                color="warning.main"
                                sx={{ mb: 2, fontWeight: 600 }}
                            >
                                Two Bluetooth earphones usually cannot play at the same time. Classic
                                Bluetooth only keeps one high-quality audio stream active. Use wired/USB
                                speakers, or Windows 11 Quick Settings → Shared Audio (requires Bluetooth
                                LE Audio on the PC and both headsets).
                            </Typography>
                        )}
                    {outputDevices.length === 0 ? (
                        <Typography variant="body2" color="text.secondary" sx={{ mb: 3 }}>
                            No audio output devices found.
                        </Typography>
                    ) : (
                        <FormGroup sx={{ mb: 3 }}>
                            {outputDevices.map((d) => (
                                <FormControlLabel
                                    key={d.deviceId}
                                    control={
                                        <Checkbox
                                            checked={selectedOutputIds.includes(d.deviceId)}
                                            onChange={(_, isChecked) =>
                                                toggleOutputDevice(d.deviceId, isChecked)
                                            }
                                        />
                                    }
                                    label={d.label || `Output (${d.deviceId.slice(0, 8)}…)`}
                                />
                            ))}
                        </FormGroup>
                    )}
                    <Divider sx={{ my: 3 }} />
                </>
            )}

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

                {(settings.volumeControl?.schedule?.length ?? 0) > 0 && (
                    <Box sx={{ mb: 2 }}>
                        <Typography variant="subtitle2" sx={{ mb: 1 }}>
                            Current Volume Overrides ({settings.volumeControl?.schedule?.length ?? 0} entries)
                        </Typography>
                        <List dense>
                            {(settings.volumeControl?.schedule ?? []).map((entry, index) => (
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
                                            secondary={`Priority: ${(settings.volumeControl?.schedule?.length ?? 0) - index}`}
                                        />
                                        <ListItemSecondaryAction>
                                            <IconButton
                                                edge="end"
                                                onClick={() => setPendingDeleteId(entry.id)}
                                                size="small"
                                                color="error"
                                            >
                                                <Delete />
                                            </IconButton>
                                        </ListItemSecondaryAction>
                                    </ListItem>
                                    {index < (settings.volumeControl?.schedule?.length ?? 0) - 1 && <Divider />}
                                </React.Fragment>
                            ))}
                        </List>
                    </Box>
                )}

                <Button variant="contained" startIcon={<Add />} onClick={openAdd} sx={{ mb: 2 }}>
                    Add Volume Override
                </Button>
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
                                onClick={submitAdd}
                                disabled={!isAddValid}
                                sx={{ minWidth: 140 }}
                            >
                                Add Volume Override
                            </Button>
                        </Box>
                    </Box>
                </DialogContent>
            </Dialog>

            <Dialog open={!!pendingDeleteId} onClose={() => setPendingDeleteId(null)}>
                <DialogTitle>
                    <Typography variant="h5">Delete Volume Override</Typography>
                </DialogTitle>
                <DialogContent>
                    <Box sx={{ display: 'flex', flexDirection: 'column', gap: 3, minWidth: '400px' }}>
                        <Typography variant="body1" color="text.secondary">
                            Are you sure you want to delete this volume override?
                        </Typography>
                        <Box sx={{ display: 'flex', justifyContent: 'flex-end', gap: 2 }}>
                            <Button variant="outlined" onClick={() => setPendingDeleteId(null)} sx={{ minWidth: 100 }}>
                                Cancel
                            </Button>
                            <Button variant="contained" color="error" onClick={confirmDelete} sx={{ minWidth: 100 }}>
                                Delete
                            </Button>
                        </Box>
                    </Box>
                </DialogContent>
            </Dialog>
        </Box>
    );
};
