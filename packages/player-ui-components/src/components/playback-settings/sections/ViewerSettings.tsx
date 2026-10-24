import { Add, Save, Visibility, VisibilityOff } from '@mui/icons-material';
import {
    Button,
    Chip,
    Dialog,
    DialogContent,
    DialogTitle,
    Divider,
    FormControl,
    FormControlLabel,
    IconButton,
    InputAdornment,
    List,
    ListItem,
    ListItemSecondaryAction,
    ListItemText,
    Switch,
    TextField,
    Typography,
} from '@mui/material';
import React, { useEffect, useState } from 'react';
import { useDispatch, useSelector } from 'react-redux';
import { Select } from '@ezplayer/shared-ui-components';
import type {
    ViewerControlBackend,
    ViewerControlScheduleEntry,
    ViewerControlScheduleList,
} from '@ezplayer/ezplayer-core';
import { viewerControlBackends } from '@ezplayer/ezplayer-core';
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

const FRESH_ENTRY: Partial<ViewerControlScheduleEntry> = {
    days: 'all',
    startTime: '00:00',
    endTime: '23:59',
    playlist: '',
};

/** Whole-number field that commits on blur; empty (or 0) means off and shows as blank. */
const RepeatSpacingField: React.FC<{
    value: number;
    onCommit: (value: number) => void;
    helperText: string;
}> = ({ value, onCommit, helperText }) => {
    const shown = value > 0 ? String(value) : '';
    const [local, setLocal] = useState(shown);
    useEffect(() => setLocal(shown), [shown]);
    return (
        <TextField
            size="small"
            label="Songs between repeats"
            value={local}
            placeholder="0 (off)"
            helperText={helperText}
            InputLabelProps={{ shrink: true }}
            inputProps={{ inputMode: 'numeric' }}
            onChange={(e) => setLocal(e.target.value.replace(/[^0-9]/g, ''))}
            onBlur={() => {
                const n = Number(local);
                const next = local !== '' && Number.isInteger(n) && n > 0 ? n : 0;
                onCommit(next);
                setLocal(next > 0 ? String(next) : ''); // normalizes "007" and "00"
            }}
            sx={{ mb: 3, maxWidth: 480 }}
        />
    );
};

/** Short name of each schedule list, used in section and dialog titles when the lists are separate. */
const LIST_NAME: Record<ViewerControlScheduleList, string> = {
    schedule: 'Viewer Page',
    remoteFalconSchedule: 'Remote Falcon',
};

const PRIORITY_NOTE = 'Last entry takes priority for overlapping times.';

/** One schedule list with its entries, reorder/edit/delete actions and an add button. */
const ScheduleList: React.FC<{
    title: string;
    description: string;
    entries: ViewerControlScheduleEntry[];
    onAdd: () => void;
    onEdit: (entry: ViewerControlScheduleEntry) => void;
    onMove: (entryId: string, delta: number) => void;
    onDelete: (entryId: string) => void;
}> = ({ title, description, entries, onAdd, onEdit, onMove, onDelete }) => {
    return (
        <Box>
            <Typography variant="subtitle2" sx={{ mb: 2 }}>
                {title}
            </Typography>
            <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
                {description}
            </Typography>

            {entries.length > 0 && (
                <Box sx={{ mb: 2 }}>
                    <Typography variant="subtitle2" sx={{ mb: 1 }}>
                        Current Schedule ({entries.length} entries)
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
                                                <Typography variant="body2" fontWeight="medium">
                                                    {entry.playlist}
                                                </Typography>
                                            </Box>
                                        }
                                        secondary={`Priority: ${index + 1}`}
                                    />
                                    <ListItemSecondaryAction>
                                        <ScheduleEntryActions
                                            index={index}
                                            count={entries.length}
                                            onEdit={() => onEdit(entry)}
                                            onMove={(delta) => onMove(entry.id, delta)}
                                            onDelete={() => onDelete(entry.id)}
                                        />
                                    </ListItemSecondaryAction>
                                </ListItem>
                                {index < entries.length - 1 && <Divider />}
                            </React.Fragment>
                        ))}
                    </List>
                </Box>
            )}

            <Button variant="contained" startIcon={<Add />} onClick={onAdd} sx={{ mb: 2 }}>
                Add Schedule Entry
            </Button>
        </Box>
    );
};

export const ViewerSettings: React.FC = () => {
    const dispatch = useDispatch<AppDispatch>();
    const settings = useSelector((s: RootState) => s.playbackSettings.settings);
    const playlists = useSelector((s: RootState) => s.playlists.playlists);

    const [addOpen, setAddOpen] = useState(false);
    const [newEntry, setNewEntry] = useState<Partial<ViewerControlScheduleEntry>>(FRESH_ENTRY);
    /** Id of the entry the dialog is editing; null when adding. */
    const [editingId, setEditingId] = useState<string | null>(null);
    /** Which schedule list the add/edit dialog writes to. */
    const [dialogList, setDialogList] = useState<ViewerControlScheduleList>('schedule');
    const [pendingDelete, setPendingDelete] = useState<{ list: ViewerControlScheduleList; id: string } | null>(null);
    const [showRemoteFalconToken, setShowRemoteFalconToken] = useState(false);

    // Both backends share `schedule` unless Remote Falcon is given its own.
    const backends = viewerControlBackends(settings.viewerControl);
    const showSchedule = backends.length > 0;
    const ezOn = backends.includes('ezplayer');
    const rfOn = backends.includes('remote-falcon');
    const separate = !!settings.viewerControl.separateRemoteFalconSchedule;
    // Offered when both backends are on; stays visible while on so it can be turned off.
    const showSeparateToggle = (rfOn && ezOn) || separate;
    const showMainSchedule = showSchedule && (ezOn || !separate);
    const showRfSchedule = rfOn && separate;
    /** "Schedule Entry" or, with separate lists, e.g. "Remote Falcon Schedule Entry". */
    const entryName = (list: ViewerControlScheduleList) =>
        separate ? `${LIST_NAME[list]} Schedule Entry` : 'Schedule Entry';
    const setBackend = (backend: ViewerControlBackend, on: boolean) =>
        dispatch(
            playbackSettingsActions.setViewerControlBackends(
                on ? [...backends, backend] : backends.filter((b) => b !== backend),
            ),
        );

    const openAdd = (list: ViewerControlScheduleList) => {
        setDialogList(list);
        setNewEntry(FRESH_ENTRY);
        setEditingId(null);
        setAddOpen(true);
    };

    const openEdit = (list: ViewerControlScheduleList, entry: ViewerControlScheduleEntry) => {
        setDialogList(list);
        setNewEntry(entry);
        setEditingId(entry.id);
        setAddOpen(true);
    };

    const submitAdd = () => {
        if (
            newEntry.days &&
            newEntry.startTime &&
            newEntry.endTime &&
            newEntry.playlist &&
            isValidTimeFormat(newEntry.startTime) &&
            isValidExtendedTimeFormat(newEntry.endTime)
        ) {
            const entry: ViewerControlScheduleEntry = {
                id: editingId ?? generateId(),
                days: newEntry.days,
                startTime: formatTime24Hour(newEntry.startTime),
                endTime: formatTime24Hour(newEntry.endTime),
                playlist: newEntry.playlist,
            };
            dispatch(
                editingId
                    ? playbackSettingsActions.updateViewerControlScheduleEntry({ list: dialogList, entry })
                    : playbackSettingsActions.addViewerControlScheduleEntry({ list: dialogList, entry }),
            );
            setNewEntry(FRESH_ENTRY);
            setAddOpen(false);
        }
    };

    const moveEntry = (list: ViewerControlScheduleList, entryId: string, delta: number) =>
        dispatch(playbackSettingsActions.moveViewerControlScheduleEntry({ list, entryId, delta }));

    const confirmDelete = () => {
        if (pendingDelete) {
            dispatch(
                playbackSettingsActions.removeViewerControlScheduleEntry({
                    list: pendingDelete.list,
                    entryId: pendingDelete.id,
                }),
            );
        }
        setPendingDelete(null);
    };

    const isAddValid =
        newEntry.days &&
        newEntry.startTime &&
        newEntry.endTime &&
        newEntry.playlist &&
        isValidTimeFormat(newEntry.startTime) &&
        isValidExtendedTimeFormat(newEntry.endTime);

    return (
        <Box>
            <Typography variant="body2" color="text.secondary" sx={{ mb: 1 }}>
                Where viewers can pick songs from. Both can run at once: requests from the EZPlayer viewer page are
                played before Remote Falcon suggestions.
            </Typography>
            <FormControlLabel
                sx={{ display: 'flex', mb: 0.5 }}
                control={
                    <Switch checked={backends.includes('ezplayer')} onChange={(_e, on) => setBackend('ezplayer', on)} />
                }
                label="EZPlayer viewer page (built-in)"
            />
            <FormControlLabel
                sx={{ display: 'flex', mb: 2 }}
                control={
                    <Switch
                        checked={backends.includes('remote-falcon')}
                        onChange={(_e, on) => setBackend('remote-falcon', on)}
                    />
                }
                label="Remote Falcon"
            />

            {backends.includes('remote-falcon') && (
                <TextField
                    fullWidth
                    size="small"
                    type={showRemoteFalconToken ? 'text' : 'password'}
                    label="Remote Falcon Token"
                    value={settings.viewerControl.remoteFalconToken}
                    onChange={(e) => dispatch(playbackSettingsActions.setRemoteFalconToken(e.target.value))}
                    placeholder="Enter your Remote Falcon token"
                    autoComplete="off"
                    sx={{ mb: 3 }}
                    InputProps={{
                        endAdornment: (
                            <InputAdornment position="end">
                                <IconButton
                                    aria-label={showRemoteFalconToken ? 'Hide token' : 'Show token'}
                                    onClick={() => setShowRemoteFalconToken((visible) => !visible)}
                                    edge="end"
                                    size="small"
                                >
                                    {showRemoteFalconToken ? <VisibilityOff /> : <Visibility />}
                                </IconButton>
                            </InputAdornment>
                        ),
                    }}
                />
            )}

            {showSeparateToggle && (
                <FormControlLabel
                    sx={{ display: 'flex', mb: 2 }}
                    control={
                        <Switch
                            checked={separate}
                            onChange={(_e, on) => dispatch(playbackSettingsActions.setSeparateRemoteFalconSchedule(on))}
                        />
                    }
                    label="Separate Remote Falcon schedule and playlists"
                />
            )}

            {showMainSchedule && (
                <ScheduleList
                    title={separate ? `${LIST_NAME.schedule} Schedule` : 'Schedule Configuration'}
                    description={
                        separate
                            ? `When the viewer page takes requests, and from which playlist. ${PRIORITY_NOTE}`
                            : `Configure when viewers can control the playlist. ${PRIORITY_NOTE}`
                    }
                    entries={settings.viewerControl.schedule ?? []}
                    onAdd={() => openAdd('schedule')}
                    onEdit={(entry) => openEdit('schedule', entry)}
                    onMove={(entryId, delta) => moveEntry('schedule', entryId, delta)}
                    onDelete={(id) => setPendingDelete({ list: 'schedule', id })}
                />
            )}

            {showRfSchedule && (
                <ScheduleList
                    title={`${LIST_NAME.remoteFalconSchedule} Schedule`}
                    description={`When Remote Falcon takes requests, and from which playlist. ${PRIORITY_NOTE}`}
                    entries={settings.viewerControl.remoteFalconSchedule ?? []}
                    onAdd={() => openAdd('remoteFalconSchedule')}
                    onEdit={(entry) => openEdit('remoteFalconSchedule', entry)}
                    onMove={(entryId, delta) => moveEntry('remoteFalconSchedule', entryId, delta)}
                    onDelete={(id) => setPendingDelete({ list: 'remoteFalconSchedule', id })}
                />
            )}

            {showSchedule && (
                <RepeatSpacingField
                    value={settings.viewerControl.minSongsBetweenRepeats ?? 0}
                    onCommit={(n) => dispatch(playbackSettingsActions.setMinSongsBetweenRepeats(n))}
                    helperText="Viewer picks of a song that is playing, up next, already requested, or among this many recent songs are skipped, and playlists pass over a song a viewer just played. Leave blank for off."
                />
            )}

            <Dialog open={addOpen} onClose={() => setAddOpen(false)}>
                <DialogTitle>
                    <Typography variant="h5">{`${editingId ? 'Edit' : 'Add'} ${entryName(dialogList)}`}</Typography>
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
                                Playlist Selection
                            </Typography>
                            <FormControl fullWidth size="small">
                                <Select
                                    options={playlists.map((p) => ({ id: p.title, name: p.title }))}
                                    itemText="name"
                                    itemValue="id"
                                    onChange={(e) =>
                                        setNewEntry({
                                            ...newEntry,
                                            playlist: (e.target as HTMLSelectElement).value as string,
                                        })
                                    }
                                    label="Select Playlist"
                                    value={newEntry.playlist || ''}
                                />
                            </FormControl>
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
                                {editingId ? 'Save' : 'Add Schedule Entry'}
                            </Button>
                        </Box>
                    </Box>
                </DialogContent>
            </Dialog>

            <Dialog open={!!pendingDelete} onClose={() => setPendingDelete(null)}>
                <DialogTitle>
                    <Typography variant="h5">{`Delete ${entryName(pendingDelete?.list ?? 'schedule')}`}</Typography>
                </DialogTitle>
                <DialogContent>
                    <Box sx={{ display: 'flex', flexDirection: 'column', gap: 3, minWidth: '400px' }}>
                        <Typography variant="body1" color="text.secondary">
                            Are you sure you want to delete this schedule entry?
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
