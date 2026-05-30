import { Add, Delete } from '@mui/icons-material';
import {
    Button,
    Chip,
    Dialog,
    DialogContent,
    DialogTitle,
    Divider,
    FormControl,
    IconButton,
    List,
    ListItem,
    ListItemSecondaryAction,
    ListItemText,
    TextField,
    Typography,
} from '@mui/material';
import React, { useState } from 'react';
import { useDispatch, useSelector } from 'react-redux';
import { Select } from '@ezplayer/shared-ui-components';
import type { ViewerControlScheduleEntry } from '@ezplayer/ezplayer-core';
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

const FRESH_ENTRY: Partial<ViewerControlScheduleEntry> = {
    days: 'all',
    startTime: '00:00',
    endTime: '23:59',
    playlist: '',
};

export const ViewerSettings: React.FC = () => {
    const dispatch = useDispatch<AppDispatch>();
    const settings = useSelector((s: RootState) => s.playbackSettings.settings);
    const playlists = useSelector((s: RootState) => s.playlists.playlists);

    const [addOpen, setAddOpen] = useState(false);
    const [newEntry, setNewEntry] = useState<Partial<ViewerControlScheduleEntry>>(FRESH_ENTRY);
    const [pendingDeleteId, setPendingDeleteId] = useState<string | null>(null);

    // The schedule config is backend-agnostic; `'ezplayer'` reuses the same
    // schedule UI. Only the token field below is backend-specific.
    const vcType = settings.viewerControl.type;
    const showSchedule = vcType === 'remote-falcon' || vcType === 'ezplayer';

    const openAdd = () => {
        setNewEntry(FRESH_ENTRY);
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
                id: generateId(),
                days: newEntry.days,
                startTime: formatTime24Hour(newEntry.startTime),
                endTime: formatTime24Hour(newEntry.endTime),
                playlist: newEntry.playlist,
            };
            dispatch(playbackSettingsActions.addViewerControlScheduleEntry(entry));
            setNewEntry(FRESH_ENTRY);
            setAddOpen(false);
        }
    };

    const confirmDelete = () => {
        if (pendingDeleteId) {
            dispatch(playbackSettingsActions.removeViewerControlScheduleEntry(pendingDeleteId));
        }
        setPendingDeleteId(null);
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
            <FormControl fullWidth size="small" sx={{ mb: 2 }}>
                <Select
                    options={[
                        { id: 'disabled', name: 'Disabled' },
                        { id: 'remote-falcon', name: 'Remote Falcon' },
                        { id: 'ezplayer', name: 'EZPlayer (built-in)' },
                    ]}
                    itemText="name"
                    itemValue="id"
                    onChange={(e) => {
                        const type = (e.target as HTMLSelectElement).value as 'disabled' | 'remote-falcon' | 'ezplayer';
                        dispatch(playbackSettingsActions.setViewerControlType(type));
                        dispatch(playbackSettingsActions.setViewerControlEnabled(type !== 'disabled'));
                    }}
                    label="Viewer Control Type"
                    value={settings.viewerControl.type}
                />
            </FormControl>

            {settings.viewerControl.type === 'remote-falcon' && (
                <TextField
                    fullWidth
                    size="small"
                    label="Remote Falcon Token"
                    value={settings.viewerControl.remoteFalconToken}
                    onChange={(e) => dispatch(playbackSettingsActions.setRemoteFalconToken(e.target.value))}
                    placeholder="Enter your Remote Falcon token"
                    sx={{ mb: 3 }}
                />
            )}

            {showSchedule && (
                <Box>
                    <Typography variant="subtitle2" sx={{ mb: 2 }}>
                        Schedule Configuration
                    </Typography>
                    <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
                        Configure when viewers can control the playlist. Last entry takes priority for overlapping
                        times.
                    </Typography>

                    {settings.viewerControl.schedule.length > 0 && (
                        <Box sx={{ mb: 2 }}>
                            <Typography variant="subtitle2" sx={{ mb: 1 }}>
                                Current Schedule ({settings.viewerControl.schedule.length} entries)
                            </Typography>
                            <List dense>
                                {settings.viewerControl.schedule.map((entry, index) => (
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
                                                        <Typography variant="body2" fontWeight="medium">
                                                            {entry.playlist}
                                                        </Typography>
                                                    </Box>
                                                }
                                                secondary={`Priority: ${settings.viewerControl.schedule.length - index}`}
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
                                        {index < settings.viewerControl.schedule.length - 1 && <Divider />}
                                    </React.Fragment>
                                ))}
                            </List>
                        </Box>
                    )}

                    <Button variant="contained" startIcon={<Add />} onClick={openAdd} sx={{ mb: 2 }}>
                        Add Schedule Entry
                    </Button>
                </Box>
            )}

            <Dialog open={addOpen} onClose={() => setAddOpen(false)}>
                <DialogTitle>
                    <Typography variant="h5">Add Schedule Entry</Typography>
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
                                startIcon={<Add />}
                                onClick={submitAdd}
                                disabled={!isAddValid}
                                sx={{ minWidth: 140 }}
                            >
                                Add Schedule Entry
                            </Button>
                        </Box>
                    </Box>
                </DialogContent>
            </Dialog>

            <Dialog open={!!pendingDeleteId} onClose={() => setPendingDeleteId(null)}>
                <DialogTitle>
                    <Typography variant="h5">Delete Schedule Entry</Typography>
                </DialogTitle>
                <DialogContent>
                    <Box sx={{ display: 'flex', flexDirection: 'column', gap: 3, minWidth: '400px' }}>
                        <Typography variant="body1" color="text.secondary">
                            Are you sure you want to delete this schedule entry?
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
