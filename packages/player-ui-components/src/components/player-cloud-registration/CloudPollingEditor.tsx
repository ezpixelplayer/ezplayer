import { Add, Delete } from '@mui/icons-material';
import {
    Button,
    Chip,
    Dialog,
    DialogActions,
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
    TextField,
    Typography,
} from '@mui/material';
import React, { useEffect, useState } from 'react';
import { useDispatch, useSelector } from 'react-redux';
import { Select } from '@ezplayer/shared-ui-components';
import type { CloudPollScheduleEntry } from '@ezplayer/ezplayer-core';
import { Box } from '../box/Box';
import { issueCloudCommand } from '../../store/slices/CloudStatusStore';
import {
    DAY_OPTIONS,
    DayKey,
    formatTime24Hour,
    generateId,
    getDaysDisplayName,
    isValidExtendedTimeFormat,
    isValidTimeFormat,
    TimeInput,
} from '../playback-settings/sections/sectionHelpers';
import type { AppDispatch, RootState } from '../../store/Store';

// Mirror the cloud-poll worker defaults (cloudpoll.ts). These are the values the
// editor shows — and persists on Save — when no override is set, so they must match
// the worker or saving would silently change the unedited field.
const DEFAULT_REGISTRATION_SEC = 5;
const DEFAULT_MANIFEST_SEC = 300;
const FRESH_WINDOW: Partial<CloudPollScheduleEntry> = {
    days: 'all',
    startTime: '00:00',
    endTime: '23:59',
};

/**
 * Polling-schedule section of the cloud registration dialog: always-vs-scheduled
 * mode plus the allowed-windows list. Surfaced as its own prominent section since
 * users tune their schedule far more often than they touch the cadence in seconds.
 *
 * The cadence (registration + manifest poll seconds) lives in
 * `CloudPollingIntervalEditor` and belongs in the Advanced accordion.
 */
export const CloudPollingScheduleEditor: React.FC = () => {
    const dispatch = useDispatch<AppDispatch>();
    const cfg = useSelector((s: RootState) => s.cloudConfig);
    const mode: 'always' | 'scheduled' = cfg.cloudPollMode === 'scheduled' ? 'scheduled' : 'always';
    const schedule: CloudPollScheduleEntry[] = cfg.cloudPollSchedule ?? [];

    const [addOpen, setAddOpen] = useState(false);
    const [pendingDeleteId, setPendingDeleteId] = useState<string | null>(null);
    const [newWindow, setNewWindow] = useState<Partial<CloudPollScheduleEntry>>(FRESH_WINDOW);

    const handleModeChange = (e: React.ChangeEvent<HTMLInputElement>) => {
        const v = e.target.value === 'scheduled' ? 'scheduled' : 'always';
        void dispatch(issueCloudCommand({ type: 'setCloudPolling', mode: v }));
    };

    const submitAddWindow = () => {
        if (
            !newWindow.days ||
            !newWindow.startTime ||
            !newWindow.endTime ||
            !isValidTimeFormat(newWindow.startTime) ||
            !isValidExtendedTimeFormat(newWindow.endTime)
        ) {
            return;
        }
        const entry: CloudPollScheduleEntry = {
            id: generateId(),
            days: newWindow.days,
            startTime: formatTime24Hour(newWindow.startTime),
            endTime: formatTime24Hour(newWindow.endTime),
        };
        void dispatch(
            issueCloudCommand({
                type: 'setCloudPolling',
                schedule: [...schedule, entry],
            }),
        );
        setNewWindow(FRESH_WINDOW);
        setAddOpen(false);
    };

    const confirmDelete = () => {
        if (!pendingDeleteId) return;
        void dispatch(
            issueCloudCommand({
                type: 'setCloudPolling',
                schedule: schedule.filter((e) => e.id !== pendingDeleteId),
            }),
        );
        setPendingDeleteId(null);
    };

    const isAddValid =
        !!newWindow.days &&
        !!newWindow.startTime &&
        !!newWindow.endTime &&
        isValidTimeFormat(newWindow.startTime) &&
        isValidExtendedTimeFormat(newWindow.endTime);

    return (
        <Box>
            <Typography variant="subtitle1" sx={{ mb: 1 }}>
                Polling Schedule
            </Typography>
            <Typography variant="caption" sx={{ display: 'block', mb: 2, color: 'text.secondary' }}>
                Registration heartbeat always runs while cloud is enabled. The schedule below gates content polling
                (sequence list, downloads, layout fetch).
            </Typography>

            {/* Mode */}
            <FormControl sx={{ mb: 2 }}>
                <RadioGroup row value={mode} onChange={handleModeChange}>
                    <FormControlLabel value="always" control={<Radio />} label="Always" />
                    <FormControlLabel value="scheduled" control={<Radio />} label="During scheduled times" />
                </RadioGroup>
            </FormControl>

            {/* Schedule list (only meaningful in scheduled mode, but always shown so the
                user can prepare windows before flipping the switch). */}
            <Typography variant="subtitle2" sx={{ mb: 1 }}>
                Allowed Times ({schedule.length})
            </Typography>
            {schedule.length === 0 ? (
                <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
                    No allowed times defined.
                    {mode === 'scheduled' && ' In scheduled mode with no allowed times, content polling is suspended.'}
                </Typography>
            ) : (
                <List dense sx={{ mb: 2 }}>
                    {schedule.map((entry, index) => (
                        <React.Fragment key={entry.id}>
                            <ListItem>
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
                                        edge="end"
                                        onClick={() => setPendingDeleteId(entry.id)}
                                        size="small"
                                        color="error"
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
                onClick={() => {
                    setNewWindow(FRESH_WINDOW);
                    setAddOpen(true);
                }}
            >
                Add Sync Time Window to Schedule
            </Button>

            {/* Add window dialog */}
            <Dialog open={addOpen} onClose={() => setAddOpen(false)}>
                <DialogTitle>Add Sync Time Window</DialogTitle>
                <DialogContent>
                    <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2, pt: 1, minWidth: 420 }}>
                        <FormControl fullWidth size="small">
                            <Select
                                options={DAY_OPTIONS}
                                itemText="name"
                                itemValue="id"
                                onChange={(e) =>
                                    setNewWindow({
                                        ...newWindow,
                                        days: (e.target as HTMLSelectElement).value as DayKey,
                                    })
                                }
                                label="Select Days"
                                value={newWindow.days}
                            />
                        </FormControl>
                        <Box sx={{ display: 'flex', gap: 2 }}>
                            <TimeInput
                                size="small"
                                label="Start Time"
                                value={newWindow.startTime || ''}
                                onChange={(v) => setNewWindow({ ...newWindow, startTime: v })}
                                isFromTime={true}
                                sx={{ flex: 1 }}
                            />
                            <TimeInput
                                size="small"
                                label="End Time"
                                value={newWindow.endTime || ''}
                                onChange={(v) => setNewWindow({ ...newWindow, endTime: v })}
                                isFromTime={false}
                                sx={{ flex: 1 }}
                            />
                        </Box>
                    </Box>
                </DialogContent>
                <DialogActions>
                    <Button onClick={() => setAddOpen(false)}>Cancel</Button>
                    <Button variant="contained" onClick={submitAddWindow} disabled={!isAddValid}>
                        Add
                    </Button>
                </DialogActions>
            </Dialog>

            {/* Delete confirmation */}
            <Dialog open={pendingDeleteId !== null} onClose={() => setPendingDeleteId(null)}>
                <DialogTitle>Remove Polling Window?</DialogTitle>
                <DialogContent>
                    <Typography>Outside the remaining windows, content polling will be suspended.</Typography>
                </DialogContent>
                <DialogActions>
                    <Button onClick={() => setPendingDeleteId(null)}>Cancel</Button>
                    <Button color="error" variant="contained" onClick={confirmDelete}>
                        Remove
                    </Button>
                </DialogActions>
            </Dialog>
        </Box>
    );
};

/**
 * Polling-cadence section of the cloud registration dialog: registration heartbeat
 * and manifest-poll cadence in seconds. Belongs in the Advanced accordion — most
 * users will leave the defaults alone.
 */
export const CloudPollingIntervalEditor: React.FC = () => {
    const dispatch = useDispatch<AppDispatch>();
    const cfg = useSelector((s: RootState) => s.cloudConfig);
    const regSecondsSaved = Math.round(
        (cfg.cloudPollIntervals?.registrationMs ?? DEFAULT_REGISTRATION_SEC * 1000) / 1000,
    );
    const manSecondsSaved = Math.round((cfg.cloudPollIntervals?.manifestMs ?? DEFAULT_MANIFEST_SEC * 1000) / 1000);

    const [regSeconds, setRegSeconds] = useState<string>(String(regSecondsSaved));
    const [manSeconds, setManSeconds] = useState<string>(String(manSecondsSaved));
    useEffect(() => setRegSeconds(String(regSecondsSaved)), [regSecondsSaved]);
    useEffect(() => setManSeconds(String(manSecondsSaved)), [manSecondsSaved]);
    const intervalsDirty = Number(regSeconds) !== regSecondsSaved || Number(manSeconds) !== manSecondsSaved;
    const intervalsValid =
        Number.isFinite(Number(regSeconds)) &&
        Number(regSeconds) >= 1 &&
        Number.isFinite(Number(manSeconds)) &&
        Number(manSeconds) >= 1;

    const handleSave = () => {
        if (!intervalsValid) return;
        void dispatch(
            issueCloudCommand({
                type: 'setCloudPolling',
                intervals: {
                    registrationMs: Number(regSeconds) * 1000,
                    manifestMs: Number(manSeconds) * 1000,
                },
            }),
        );
    };

    return (
        <Box>
            <Typography variant="subtitle2" sx={{ mb: 1, color: 'text.secondary' }}>
                Polling Interval
            </Typography>
            <Box sx={{ display: 'flex', gap: 2, alignItems: 'flex-start' }}>
                <TextField
                    size="small"
                    type="number"
                    label="Registration poll (sec)"
                    value={regSeconds}
                    onChange={(e) => setRegSeconds(e.target.value)}
                    inputProps={{ min: 1 }}
                    sx={{ flex: 1 }}
                />
                <TextField
                    size="small"
                    type="number"
                    label="Manifest poll (sec)"
                    value={manSeconds}
                    onChange={(e) => setManSeconds(e.target.value)}
                    inputProps={{ min: 1 }}
                    sx={{ flex: 1 }}
                />
                <Button
                    variant="contained"
                    size="small"
                    onClick={handleSave}
                    disabled={!intervalsDirty || !intervalsValid}
                >
                    Save Intervals
                </Button>
            </Box>
        </Box>
    );
};
