import { Add, Save } from '@mui/icons-material';
import {
    Button,
    Chip,
    Dialog,
    DialogContent,
    DialogTitle,
    Divider,
    FormControl,
    FormControlLabel,
    List,
    ListItem,
    ListItemSecondaryAction,
    ListItemText,
    Slider,
    Switch,
    Typography,
} from '@mui/material';
import React, { useState } from 'react';
import { useDispatch, useSelector } from 'react-redux';
import { Select } from '@ezplayer/shared-ui-components';
import type { BrightnessScheduleEntry } from '@ezplayer/ezplayer-core';
import { COLOR_TEMPERATURE_MAX_K, COLOR_TEMPERATURE_MIN_K, COLOR_TEMPERATURE_NEUTRAL_K } from '@ezplayer/ezplayer-core';
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
    ScheduleEntryActions,
    TimeInput,
} from './sectionHelpers';

const FRESH_ENTRY: Partial<BrightnessScheduleEntry> = {
    days: 'all',
    startTime: '00:00',
    endTime: '23:59',
    brightness: 100,
};

const LEVEL_MARKS = [
    { value: 0, label: '0' },
    { value: 25, label: '25' },
    { value: 50, label: '50' },
    { value: 75, label: '75' },
    { value: 100, label: '100' },
];

const TEMPERATURE_MARKS = [
    { value: COLOR_TEMPERATURE_MIN_K, label: 'Warm' },
    { value: COLOR_TEMPERATURE_NEUTRAL_K, label: 'Neutral' },
    { value: COLOR_TEMPERATURE_MAX_K, label: 'Cool' },
];

const sliderSx = {
    '& .MuiSlider-thumb': { width: 20, height: 20 },
    '& .MuiSlider-track': { height: 6 },
    '& .MuiSlider-rail': { height: 6 },
};

export function describeColorTemperature(kelvin: number | undefined): string {
    const k = kelvin ?? COLOR_TEMPERATURE_NEUTRAL_K;
    if (k === COLOR_TEMPERATURE_NEUTRAL_K) return 'Neutral';
    return `${k} K (${k < COLOR_TEMPERATURE_NEUTRAL_K ? 'warm' : 'cool'})`;
}

/**
 * Output brightness and color temperature: a default and schedule windows on
 * top of it, the same shape as the audio volume section. Color temperature
 * only dims channels (warm dims blue and green, cool dims red), so full
 * brightness stays full.
 */
export const BrightnessSettings: React.FC = () => {
    const dispatch = useDispatch<AppDispatch>();
    const settings = useSelector((state: RootState) => state.playbackSettings.settings);
    const control = settings.brightnessControl ?? { defaultBrightness: 100, schedule: [] };
    const entries = control.schedule ?? [];

    const [draftBrightness, setDraftBrightness] = useState<number | null>(null);
    const [draftTemperature, setDraftTemperature] = useState<number | null>(null);
    const [addOpen, setAddOpen] = useState(false);
    const [editingId, setEditingId] = useState<string | null>(null);
    const [newEntry, setNewEntry] = useState<Partial<BrightnessScheduleEntry>>(FRESH_ENTRY);
    const [pendingDelete, setPendingDelete] = useState<string | null>(null);

    const openAdd = () => {
        setNewEntry(FRESH_ENTRY);
        setEditingId(null);
        setAddOpen(true);
    };
    const openEdit = (entry: BrightnessScheduleEntry) => {
        setNewEntry(entry);
        setEditingId(entry.id);
        setAddOpen(true);
    };

    const isAddValid =
        newEntry.days &&
        newEntry.startTime &&
        newEntry.endTime &&
        newEntry.brightness !== undefined &&
        isValidTimeFormat(newEntry.startTime) &&
        isValidExtendedTimeFormat(newEntry.endTime);

    const submitAdd = () => {
        if (!isAddValid) return;
        const entry: BrightnessScheduleEntry = {
            id: editingId ?? generateId(),
            days: newEntry.days!,
            startTime: formatTime24Hour(newEntry.startTime!),
            endTime: formatTime24Hour(newEntry.endTime!),
            brightness: newEntry.brightness!,
        };
        if (newEntry.colorTemperature !== undefined) entry.colorTemperature = newEntry.colorTemperature;
        dispatch(
            editingId
                ? playbackSettingsActions.updateBrightnessScheduleEntry(entry)
                : playbackSettingsActions.addBrightnessScheduleEntry(entry),
        );
        setNewEntry(FRESH_ENTRY);
        setAddOpen(false);
    };

    const confirmDelete = () => {
        if (!pendingDelete) return;
        dispatch(playbackSettingsActions.removeBrightnessScheduleEntry(pendingDelete));
        setPendingDelete(null);
    };

    const defaultTemperature = draftTemperature ?? control.defaultColorTemperature ?? COLOR_TEMPERATURE_NEUTRAL_K;

    return (
        <Box>
            <Typography variant="h6" sx={{ mb: 2, color: 'primary.main' }}>
                Brightness
            </Typography>
            <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
                Dims every light on the way out, without changing the sequences. The player ramps to the default, or to
                the schedule window in effect, over about a second.
            </Typography>
            <Box sx={{ mb: 3 }}>
                <Typography variant="subtitle2" sx={{ mb: 2 }}>
                    Default Brightness
                </Typography>
                <Box sx={{ px: 2 }}>
                    <Slider
                        value={draftBrightness ?? control.defaultBrightness}
                        onChange={(_, value) => setDraftBrightness(value as number)}
                        onChangeCommitted={(_, value) => {
                            setDraftBrightness(null);
                            dispatch(playbackSettingsActions.setDefaultBrightness(value as number));
                        }}
                        min={0}
                        max={100}
                        step={1}
                        marks={LEVEL_MARKS}
                        valueLabelDisplay="auto"
                        valueLabelFormat={(value) => `${value}%`}
                        sx={sliderSx}
                    />
                </Box>
                <Typography variant="body2" sx={{ mt: 1, fontWeight: 'medium' }}>
                    Default Brightness: {draftBrightness ?? control.defaultBrightness}%
                </Typography>
            </Box>

            <Box sx={{ mb: 3 }}>
                <Typography variant="subtitle2" sx={{ mb: 1 }}>
                    Default Color Temperature
                </Typography>
                <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
                    Warm pulls the whole display toward amber by dimming blue and green; cool dims red. Nothing is ever
                    boosted, so white stays as bright as the brightness setting allows.
                </Typography>
                <Box sx={{ px: 2 }}>
                    <Slider
                        value={defaultTemperature}
                        onChange={(_, value) => setDraftTemperature(value as number)}
                        onChangeCommitted={(_, value) => {
                            setDraftTemperature(null);
                            dispatch(playbackSettingsActions.setDefaultColorTemperature(value as number));
                        }}
                        min={COLOR_TEMPERATURE_MIN_K}
                        max={COLOR_TEMPERATURE_MAX_K}
                        step={100}
                        marks={TEMPERATURE_MARKS}
                        valueLabelDisplay="auto"
                        valueLabelFormat={(value) => `${value} K`}
                        sx={sliderSx}
                    />
                </Box>
                <Typography variant="body2" sx={{ mt: 1, fontWeight: 'medium' }}>
                    Default Color Temperature: {describeColorTemperature(defaultTemperature)}
                </Typography>
            </Box>

            <Box>
                <Typography variant="subtitle2" sx={{ mb: 2 }}>
                    Brightness Schedule Overrides
                </Typography>
                <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
                    While a window is in effect its brightness (and color temperature, when set) replaces the defaults.
                    Later entries take priority when windows overlap.
                </Typography>
                {entries.length > 0 && (
                    <Box sx={{ mb: 2 }}>
                        <Typography variant="subtitle2" sx={{ mb: 1 }}>
                            Current Brightness Overrides ({entries.length} entries)
                        </Typography>
                        <List dense>
                            {entries.map((entry, index) => (
                                <React.Fragment key={entry.id}>
                                    <ListItem sx={{ pr: 20 }}>
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
                                                        label={`${entry.brightness}%`}
                                                        size="small"
                                                        color="primary"
                                                        variant="outlined"
                                                    />
                                                    {entry.colorTemperature !== undefined && (
                                                        <Chip
                                                            label={describeColorTemperature(entry.colorTemperature)}
                                                            size="small"
                                                            variant="outlined"
                                                        />
                                                    )}
                                                </Box>
                                            }
                                            secondary={`Priority: ${index + 1}`}
                                        />
                                        <ListItemSecondaryAction>
                                            <ScheduleEntryActions
                                                index={index}
                                                count={entries.length}
                                                onEdit={() => openEdit(entry)}
                                                onMove={(delta) =>
                                                    dispatch(
                                                        playbackSettingsActions.moveBrightnessScheduleEntry({
                                                            entryId: entry.id,
                                                            delta,
                                                        }),
                                                    )
                                                }
                                                onDelete={() => setPendingDelete(entry.id)}
                                            />
                                        </ListItemSecondaryAction>
                                    </ListItem>
                                    {index < entries.length - 1 && <Divider />}
                                </React.Fragment>
                            ))}
                        </List>
                    </Box>
                )}
                <Button variant="outlined" startIcon={<Add />} onClick={openAdd}>
                    Add Brightness Override
                </Button>
            </Box>

            <Dialog open={addOpen} onClose={() => setAddOpen(false)}>
                <DialogTitle>
                    <Typography variant="h5">{editingId ? 'Edit' : 'Add'} Brightness Override</Typography>
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
                                Brightness
                            </Typography>
                            <Box sx={{ px: 2 }}>
                                <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
                                    Set brightness: {newEntry.brightness ?? 100}%
                                </Typography>
                                <Slider
                                    value={newEntry.brightness ?? 100}
                                    onChangeCommitted={(_, value) =>
                                        setNewEntry({ ...newEntry, brightness: value as number })
                                    }
                                    min={0}
                                    max={100}
                                    marks={LEVEL_MARKS}
                                    step={1}
                                    size="small"
                                    sx={sliderSx}
                                />
                            </Box>
                        </Box>

                        <Box>
                            <FormControlLabel
                                control={
                                    <Switch
                                        checked={newEntry.colorTemperature !== undefined}
                                        onChange={(_, on) =>
                                            setNewEntry(
                                                on
                                                    ? { ...newEntry, colorTemperature: COLOR_TEMPERATURE_NEUTRAL_K }
                                                    : { ...newEntry, colorTemperature: undefined },
                                            )
                                        }
                                    />
                                }
                                label="Also set color temperature"
                            />
                            {newEntry.colorTemperature !== undefined && (
                                <Box sx={{ px: 2 }}>
                                    <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
                                        {describeColorTemperature(newEntry.colorTemperature)}
                                    </Typography>
                                    <Slider
                                        value={newEntry.colorTemperature}
                                        onChangeCommitted={(_, value) =>
                                            setNewEntry({ ...newEntry, colorTemperature: value as number })
                                        }
                                        min={COLOR_TEMPERATURE_MIN_K}
                                        max={COLOR_TEMPERATURE_MAX_K}
                                        step={100}
                                        marks={TEMPERATURE_MARKS}
                                        size="small"
                                        sx={sliderSx}
                                    />
                                </Box>
                            )}
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
                                startIcon={editingId ? <Save /> : <Add />}
                                onClick={submitAdd}
                                disabled={!isAddValid}
                                sx={{ minWidth: 140 }}
                            >
                                {editingId ? 'Save' : 'Add Brightness Override'}
                            </Button>
                        </Box>
                    </Box>
                </DialogContent>
            </Dialog>

            <Dialog open={!!pendingDelete} onClose={() => setPendingDelete(null)}>
                <DialogTitle>
                    <Typography variant="h5">Delete Brightness Override</Typography>
                </DialogTitle>
                <DialogContent>
                    <Box sx={{ display: 'flex', flexDirection: 'column', gap: 3, minWidth: '400px' }}>
                        <Typography variant="body1" color="text.secondary">
                            Are you sure you want to delete this brightness override?
                        </Typography>
                        <Box sx={{ display: 'flex', justifyContent: 'flex-end', gap: 2 }}>
                            <Button variant="outlined" onClick={() => setPendingDelete(null)} sx={{ minWidth: 100 }}>
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
