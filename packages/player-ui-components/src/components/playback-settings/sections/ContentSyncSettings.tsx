/**
 * Content Sync settings: everything about keeping other players in step with
 * this one — the files they hold (content distribution) and the timing they
 * follow (FPP MultiSync output).
 *
 * The distribution half also carries the actions, so the settings and the
 * "do it now" live in one place; the Show Status card deep-links here.
 */

import { Add, Delete, Edit, FactCheck, ListAlt, Send } from '@mui/icons-material';
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
    LinearProgress,
    List,
    ListItem,
    ListItemSecondaryAction,
    ListItemText,
    Radio,
    RadioGroup,
    Switch,
    TextField,
    Typography,
} from '@mui/material';
import React, { useMemo, useState } from 'react';
import { useDispatch, useSelector } from 'react-redux';
import { Select } from '@ezplayer/shared-ui-components';
import type { CloudPollScheduleEntry } from '@ezplayer/ezplayer-core';
import { Box } from '../../box/Box';
import { ContentDistributionDialog } from '../../content-dist/ContentDistributionDialog';
import { contentDistSummary, contentTargets, formatBytes } from '../../content-dist/contentDistHelpers';
import { playbackSettingsActions } from '../../../store/slices/PlaybackSettingsStore';
import { issueControllerCommand } from '../../../store/slices/ControllerOpsStore';
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

/** Section key apps use for the Content Sync tile, so other screens can deep-link to it. */
export const CONTENT_SYNC_SETTINGS_SECTION_KEY = 'contentSync';

const FRESH_WINDOW: Partial<CloudPollScheduleEntry> = { days: 'all', startTime: '00:00', endTime: '23:59' };

/** Number field that commits on blur; empty commits `undefined` (use default). */
const NumberField: React.FC<{
    label: string;
    value: number | undefined;
    placeholder: string;
    onCommit: (value: number | undefined) => void;
    helperText?: string;
    disabled?: boolean;
    max?: number;
}> = ({ label, value, placeholder, onCommit, helperText, disabled, max = 65535 }) => {
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
                onCommit(local !== '' && Number.isInteger(n) && n > 0 && n <= max ? n : undefined);
            }}
        />
    );
};

export const ContentSyncSettings: React.FC = () => {
    const dispatch = useDispatch<AppDispatch>();
    const settings = useSelector((s: RootState) => s.playbackSettings.settings);
    const devices = useSelector((s: RootState) => s.controllerOps.devices);
    const contentDist = useSelector((s: RootState) => s.controllerOps.contentDist);
    const multisync = settings.sync?.multisync;
    const distribution = settings.contentDistribution;
    const mode = distribution?.mode ?? 'off';
    const schedule = distribution?.schedule ?? [];

    const [detailsOpen, setDetailsOpen] = useState(false);
    const [windowOpen, setWindowOpen] = useState(false);
    const [editingId, setEditingId] = useState<string | null>(null);
    const [draft, setDraft] = useState<Partial<CloudPollScheduleEntry>>(FRESH_WINDOW);

    const targets = useMemo(() => contentTargets(devices), [devices]);
    const summary = useMemo(() => contentDistSummary(contentDist, targets), [contentDist, targets]);
    const run = contentDist?.run;

    const setSchedule = (next: CloudPollScheduleEntry[]) =>
        dispatch(playbackSettingsActions.setContentDistributionSchedule(next));

    const draftValid =
        !!draft.days &&
        !!draft.startTime &&
        !!draft.endTime &&
        isValidTimeFormat(draft.startTime) &&
        isValidExtendedTimeFormat(draft.endTime);

    const submitWindow = () => {
        if (!draftValid) return;
        const entry: CloudPollScheduleEntry = {
            id: editingId ?? generateId(),
            days: draft.days!,
            startTime: formatTime24Hour(draft.startTime!),
            endTime: formatTime24Hour(draft.endTime!),
        };
        setSchedule(editingId ? schedule.map((e) => (e.id === editingId ? entry : e)) : [...schedule, entry]);
        setDraft(FRESH_WINDOW);
        setEditingId(null);
        setWindowOpen(false);
    };

    const distribute = (checkOnly: boolean) =>
        void dispatch(issueControllerCommand({ cmd: 'distribute', ...(checkOnly ? { checkOnly: true } : {}) }));

    return (
        <Box>
            <Typography variant="subtitle2" sx={{ mb: 0.5 }}>
                Content Distribution
            </Typography>
            <Typography variant="body2" color="text.secondary" sx={{ mb: 1.5 }}>
                Some players keep their own copy of the show. The player can put this show’s sequences and their audio
                onto each one, and list what it left there in an inventory playlist. FPP players are found by a
                controller scan.
            </Typography>

            {/* What is true right now, so the buttons below have a context. */}
            <Box sx={{ mb: 2 }}>
                <Typography variant="body2">{summary.text}</Typography>
                {run ? (
                    <LinearProgress variant="determinate" value={Math.round(run.fraction * 100)} sx={{ mt: 1 }} />
                ) : null}
                <Box sx={{ display: 'flex', gap: 1, mt: 1.5, flexWrap: 'wrap' }}>
                    <Button
                        variant="contained"
                        size="small"
                        startIcon={<Send />}
                        onClick={() => distribute(false)}
                        disabled={!!run || targets.length === 0}
                    >
                        Distribute now
                    </Button>
                    <Button
                        variant="outlined"
                        size="small"
                        startIcon={<FactCheck />}
                        onClick={() => distribute(true)}
                        disabled={!!run || targets.length === 0}
                    >
                        Check what’s needed
                    </Button>
                    <Button
                        variant="outlined"
                        size="small"
                        startIcon={<ListAlt />}
                        onClick={() => setDetailsOpen(true)}
                    >
                        Report
                    </Button>
                </Box>
                {targets.length === 0 && (
                    <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mt: 1 }}>
                        No FPP players known yet — scan for controllers first.
                    </Typography>
                )}
            </Box>

            <Typography variant="subtitle2" sx={{ mb: 0.5 }}>
                When to send
            </Typography>
            <FormControl sx={{ mb: 1 }}>
                <RadioGroup
                    value={mode}
                    onChange={(e) =>
                        dispatch(
                            playbackSettingsActions.setContentDistributionMode(
                                e.target.value as 'off' | 'scheduled' | 'always',
                            ),
                        )
                    }
                >
                    <FormControlLabel value="off" control={<Radio />} label="Only when I ask" />
                    <FormControlLabel value="scheduled" control={<Radio />} label="During scheduled times" />
                    <FormControlLabel value="always" control={<Radio />} label="Whenever something is missing" />
                </RadioGroup>
            </FormControl>
            <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
                Automatic sends wait for a stopped player: a transfer competes with the show for disk and network.
            </Typography>

            {mode === 'scheduled' && (
                <Box sx={{ mb: 2 }}>
                    <Typography variant="subtitle2" sx={{ mb: 1 }}>
                        Distribution windows ({schedule.length})
                    </Typography>
                    {schedule.length === 0 ? (
                        <Typography variant="body2" color="text.secondary" sx={{ mb: 1 }}>
                            No windows yet. With none, nothing is sent automatically.
                        </Typography>
                    ) : (
                        <List dense>
                            {schedule.map((entry, index) => (
                                <React.Fragment key={entry.id}>
                                    <ListItem sx={{ pr: 10 }}>
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
                                                        {formatTime24Hour(entry.startTime)} –{' '}
                                                        {formatTime24Hour(entry.endTime)}
                                                    </Typography>
                                                </Box>
                                            }
                                        />
                                        <ListItemSecondaryAction>
                                            <IconButton
                                                size="small"
                                                onClick={() => {
                                                    setDraft(entry);
                                                    setEditingId(entry.id);
                                                    setWindowOpen(true);
                                                }}
                                            >
                                                <Edit />
                                            </IconButton>
                                            <IconButton
                                                edge="end"
                                                size="small"
                                                color="error"
                                                onClick={() => setSchedule(schedule.filter((e) => e.id !== entry.id))}
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
                            setDraft(FRESH_WINDOW);
                            setEditingId(null);
                            setWindowOpen(true);
                        }}
                    >
                        Add Distribution Window
                    </Button>
                </Box>
            )}

            {mode !== 'off' && (
                <Box sx={{ mb: 2 }}>
                    <FormControlLabel
                        control={
                            <Switch
                                checked={distribution?.followSongAdds !== false}
                                onChange={(e) =>
                                    dispatch(
                                        playbackSettingsActions.setContentDistributionFollowSongAdds(e.target.checked),
                                    )
                                }
                            />
                        }
                        label="Send new songs as they are added"
                    />
                    <Typography variant="body2" color="text.secondary" sx={{ mb: 1.5 }}>
                        A song you add on the Songs screen, or one the cloud installs, is queued and sent without
                        waiting for the next look round.
                    </Typography>
                    <NumberField
                        label="Look for work every (minutes)"
                        value={distribution?.pollMinutes}
                        placeholder="60"
                        max={10080}
                        helperText="A look with nothing to send costs a few metadata reads per device."
                        onCommit={(v) => dispatch(playbackSettingsActions.setContentDistributionPollMinutes(v))}
                    />
                </Box>
            )}

            <TextField
                size="small"
                fullWidth
                label="Inventory playlist"
                value={distribution?.playlistName ?? ''}
                placeholder="EZPlayer Content"
                helperText="A list of everything we put on each device, so it can be found and played there. It is not a schedule — leave empty to skip it."
                InputLabelProps={{ shrink: true }}
                onChange={(e) =>
                    dispatch(playbackSettingsActions.setContentDistributionPlaylistName(e.target.value || undefined))
                }
            />

            {summary.behind > 0 && (
                <Typography variant="body2" color="text.secondary" sx={{ mt: 1 }}>
                    {formatBytes(targets.reduce((n, d) => n + (d.contentStatus?.missingBytes ?? 0), 0))} would be sent
                    now.
                </Typography>
            )}

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
            <FormControlLabel
                control={
                    <Switch
                        checked={multisync?.mediaSync !== false}
                        disabled={!multisync?.enabled}
                        onChange={(e) => dispatch(playbackSettingsActions.setMultisyncMediaSync(e.target.checked))}
                    />
                }
                label="Send audio sync too"
            />
            <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mb: 1 }}>
                Media packets name the song's audio file and its playback position (with the audio sync adjust applied).
                Remotes holding the same audio file will play it; turn off to keep them silent.
            </Typography>
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
                <NumberField
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

            {/* Add / edit window */}
            <Dialog open={windowOpen} onClose={() => setWindowOpen(false)}>
                <DialogTitle>{editingId ? 'Edit' : 'Add'} Distribution Window</DialogTitle>
                <DialogContent>
                    <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2, pt: 1, minWidth: 420 }}>
                        <FormControl fullWidth size="small">
                            <Select
                                options={DAY_OPTIONS}
                                itemText="name"
                                itemValue="id"
                                onChange={(e) =>
                                    setDraft({ ...draft, days: (e.target as HTMLSelectElement).value as DayKey })
                                }
                                label="Select Days"
                                value={draft.days}
                            />
                        </FormControl>
                        <TimeInput
                            label="Start"
                            value={draft.startTime ?? ''}
                            isFromTime
                            onChange={(v) => setDraft({ ...draft, startTime: v })}
                        />
                        <TimeInput
                            label="End"
                            value={draft.endTime ?? ''}
                            onChange={(v) => setDraft({ ...draft, endTime: v })}
                        />
                    </Box>
                </DialogContent>
                <DialogActions>
                    <Button onClick={() => setWindowOpen(false)}>Cancel</Button>
                    <Button variant="contained" onClick={submitWindow} disabled={!draftValid}>
                        {editingId ? 'Save' : 'Add'}
                    </Button>
                </DialogActions>
            </Dialog>

            <ContentDistributionDialog open={detailsOpen} onClose={() => setDetailsOpen(false)} />
        </Box>
    );
};
