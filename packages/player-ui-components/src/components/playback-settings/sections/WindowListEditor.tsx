import React, { useState } from 'react';
import { Add, Delete, Edit } from '@mui/icons-material';
import {
    Button,
    Chip,
    Dialog,
    DialogActions,
    DialogContent,
    DialogTitle,
    Divider,
    FormControl,
    IconButton,
    List,
    ListItem,
    ListItemSecondaryAction,
    ListItemText,
    Typography,
} from '@mui/material';
import { Select } from '@ezplayer/shared-ui-components';
import type { CloudPollScheduleEntry } from '@ezplayer/ezplayer-core';
import { Box } from '../../box/Box';
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

const FRESH_WINDOW: Partial<CloudPollScheduleEntry> = { days: 'all', startTime: '17:00', endTime: '22:00' };

/**
 * A list of payload-less time windows (days, start, end) with add, edit and delete.
 * The caller owns the list; every change comes back whole through `onChange`.
 */
export const WindowListEditor: React.FC<{
    schedule: CloudPollScheduleEntry[];
    onChange: (next: CloudPollScheduleEntry[]) => void;
    /** What one entry is called in buttons and titles, like "availability window". */
    noun: string;
    /** Shown in place of the list when it is empty. */
    emptyText: string;
    disabled?: boolean;
}> = ({ schedule, onChange, noun, emptyText, disabled }) => {
    const [open, setOpen] = useState(false);
    const [editingId, setEditingId] = useState<string | null>(null);
    const [draft, setDraft] = useState<Partial<CloudPollScheduleEntry>>(FRESH_WINDOW);
    const [pendingDeleteId, setPendingDeleteId] = useState<string | null>(null);

    const valid =
        !!draft.days &&
        !!draft.startTime &&
        !!draft.endTime &&
        isValidTimeFormat(draft.startTime) &&
        isValidExtendedTimeFormat(draft.endTime);

    const submit = () => {
        if (!valid) return;
        const entry: CloudPollScheduleEntry = {
            id: editingId ?? generateId(),
            days: draft.days!,
            startTime: formatTime24Hour(draft.startTime!),
            endTime: formatTime24Hour(draft.endTime!),
        };
        onChange(editingId ? schedule.map((e) => (e.id === editingId ? entry : e)) : [...schedule, entry]);
        setOpen(false);
    };

    return (
        <Box>
            {schedule.length === 0 ? (
                <Typography variant="body2" color="text.secondary" sx={{ mb: 1 }}>
                    {emptyText}
                </Typography>
            ) : (
                <List dense disablePadding sx={{ mb: 1 }}>
                    {schedule.map((entry, index) => (
                        <React.Fragment key={entry.id}>
                            <ListItem sx={{ pr: 10 }}>
                                <ListItemText
                                    primary={
                                        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, flexWrap: 'wrap' }}>
                                            <Chip label={getDaysDisplayName(entry.days)} size="small" />
                                            <Typography variant="body2">
                                                {formatTime24Hour(entry.startTime)} - {formatTime24Hour(entry.endTime)}
                                            </Typography>
                                        </Box>
                                    }
                                />
                                <ListItemSecondaryAction>
                                    <IconButton
                                        size="small"
                                        disabled={disabled}
                                        onClick={() => {
                                            setDraft(entry);
                                            setEditingId(entry.id);
                                            setOpen(true);
                                        }}
                                    >
                                        <Edit />
                                    </IconButton>
                                    <IconButton
                                        edge="end"
                                        size="small"
                                        color="error"
                                        disabled={disabled}
                                        onClick={() => setPendingDeleteId(entry.id)}
                                    >
                                        <Delete />
                                    </IconButton>
                                </ListItemSecondaryAction>
                            </ListItem>
                            {index < schedule.length - 1 && <Divider />}
                        </React.Fragment>
                    ))}
                </List>
            )}
            <Button
                variant="outlined"
                size="small"
                startIcon={<Add />}
                disabled={disabled}
                onClick={() => {
                    setDraft(FRESH_WINDOW);
                    setEditingId(null);
                    setOpen(true);
                }}
            >
                Add {noun}
            </Button>

            <Dialog open={open} onClose={() => setOpen(false)}>
                <DialogTitle>
                    {editingId ? 'Edit' : 'Add'} {noun}
                </DialogTitle>
                <DialogContent>
                    <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2, pt: 1, minWidth: 360 }}>
                        <FormControl fullWidth size="small">
                            <Select
                                options={DAY_OPTIONS}
                                itemText="name"
                                itemValue="id"
                                onChange={(e) =>
                                    setDraft({ ...draft, days: (e.target as HTMLSelectElement).value as DayKey })
                                }
                                label="Days"
                                value={draft.days}
                            />
                        </FormControl>
                        <Box sx={{ display: 'flex', gap: 2 }}>
                            <TimeInput
                                size="small"
                                label="Start time"
                                value={draft.startTime || ''}
                                onChange={(v) => setDraft({ ...draft, startTime: v })}
                                isFromTime={true}
                                sx={{ flex: 1 }}
                            />
                            <TimeInput
                                size="small"
                                label="End time"
                                value={draft.endTime || ''}
                                onChange={(v) => setDraft({ ...draft, endTime: v })}
                                isFromTime={false}
                                sx={{ flex: 1 }}
                            />
                        </Box>
                    </Box>
                </DialogContent>
                <DialogActions>
                    <Button onClick={() => setOpen(false)}>Cancel</Button>
                    <Button variant="contained" onClick={submit} disabled={!valid}>
                        {editingId ? 'Save' : 'Add'}
                    </Button>
                </DialogActions>
            </Dialog>

            <Dialog open={pendingDeleteId !== null} onClose={() => setPendingDeleteId(null)}>
                <DialogTitle>Remove this {noun}?</DialogTitle>
                <DialogActions>
                    <Button onClick={() => setPendingDeleteId(null)}>Cancel</Button>
                    <Button
                        color="error"
                        variant="contained"
                        onClick={() => {
                            onChange(schedule.filter((e) => e.id !== pendingDeleteId));
                            setPendingDeleteId(null);
                        }}
                    >
                        Remove
                    </Button>
                </DialogActions>
            </Dialog>
        </Box>
    );
};
