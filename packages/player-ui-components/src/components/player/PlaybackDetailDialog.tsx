import { useEffect, useRef, useState } from 'react';
import {
    Button,
    Chip,
    Dialog,
    DialogContent,
    DialogTitle,
    Divider,
    IconButton,
    LinearProgress,
    List,
    ListItem,
    ListItemText,
    Tooltip,
    Typography,
} from '@mui/material';
import { Close, Stop } from '@mui/icons-material';
import { useDispatch, useSelector } from 'react-redux';
import type { PlaybackItemOrder, PlaybackOrderEntry, PlaybackStackEntry, PlayingItem } from '@ezplayer/ezplayer-core';

import { Box } from '../box/Box';
import { AppDispatch, RootState } from '../../store/Store';
import { callImmediateCommand } from '../../store/slices/RuntimeStore';
import { useFrameServerUrl } from '../../hooks/useFrameServerUrl';
import { PlaybackControls } from './PlaybackControls';

interface PlaybackDetailDialogProps {
    open: boolean;
    onClose: () => void;
    /** When false (kiosk), nothing here can stop or remove anything. Defaults to true. */
    allowStopControls?: boolean;
}

const formatClock = (ts?: number) =>
    ts
        ? new Date(ts).toLocaleString('en-GB', { hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false })
        : '—';

const formatSpan = (ms: number) => {
    const s = Math.max(0, Math.round(ms / 1000));
    return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
};

const ORIGIN_LABEL: Record<PlaybackStackEntry['origin'], string> = {
    Scheduled: 'Scheduled',
    Immediate: 'Request',
    Queued: 'Request',
};

const STATE_LABEL: Record<PlaybackStackEntry['state'], string> = {
    playing: 'Playing',
    paused: 'Paused',
    ending: 'Ending',
    suspended: 'Interrupted',
};

const SECTION_LABEL = { intro: 'Intro', main: 'Main', outro: 'Outro' } as const;

/** "Song 3 of 12" plus the section when the item has more than one. */
function cursorText(e: PlaybackStackEntry): string | undefined {
    if (!e.position || !e.section) return undefined;
    const where = `Song ${e.position.index + 1} of ${e.position.count}`;
    const part =
        e.section === 'main' && !e.position.loop
            ? ''
            : ` (${SECTION_LABEL[e.section]}${e.position.loop ? ', looping' : ''})`;
    return where + part;
}

/**
 * The detailed playback view: what is on, with its cursor and song order; what it
 * interrupted; what waits; and what comes next — the engine's own structure, with
 * controls that act on one item at a time.
 */
export const PlaybackDetailDialog = ({ open, onClose, allowStopControls = true }: PlaybackDetailDialogProps) => {
    const dispatch = useDispatch<AppDispatch>();
    const player = useSelector((s: RootState) => s.runtime.combined?.player);
    // Local time the status arrived; progress is interpolated from it, so clock
    // skew between this device and the player does not matter.
    const receivedAt = useSelector((s: RootState) => s.runtime.combined?.player_updated);
    const { url: apiUrl } = useFrameServerUrl();

    const view = player?.view;
    const top = view?.stack[0];

    // The song order is fetched once per baking and cached by its key.
    const [orders, setOrders] = useState<Record<string, PlaybackItemOrder | null>>({});
    const topOrderKey = top?.order_key;
    useEffect(() => {
        if (!open || !top || !topOrderKey || !apiUrl || topOrderKey in orders) return;
        let cancelled = false;
        (async () => {
            try {
                const res = await fetch(`${apiUrl}/api/ezp/playback-item/${encodeURIComponent(top.key)}`);
                const order = res.ok ? ((await res.json()) as PlaybackItemOrder) : null;
                if (!cancelled) setOrders((o) => ({ ...o, [topOrderKey]: order }));
            } catch {
                if (!cancelled) setOrders((o) => ({ ...o, [topOrderKey]: null }));
            }
        })();
        return () => {
            cancelled = true;
        };
    }, [open, top, topOrderKey, apiUrl, orders]);

    // Tick while open so the progress bar moves between status pushes.
    const [, setTick] = useState(0);
    useEffect(() => {
        if (!open) return;
        const t = setInterval(() => setTick((n) => n + 1), 500);
        return () => clearInterval(t);
    }, [open]);

    const stopItem = (key: string, graceful: boolean) =>
        void dispatch(callImmediateCommand({ command: 'stopitem', key, graceful }));
    const removeRequest = (requestId: string) =>
        void dispatch(callImmediateCommand({ command: 'deleterequest', requestId }));

    const song = top?.song;
    const advancing = top?.state === 'playing' || top?.state === 'ending';
    const elapsed = song ? song.offset_ms + (advancing && receivedAt ? Date.now() - receivedAt : 0) : 0;
    const order = topOrderKey ? orders[topOrderKey] : undefined;
    const below = view?.stack.slice(1) ?? [];

    return (
        <Dialog open={open} onClose={onClose} maxWidth="sm" fullWidth PaperProps={{ sx: { maxHeight: '90vh' } }}>
            <DialogTitle sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 1 }}>
                <Typography variant="h5" component="span">
                    Playback
                </Typography>
                <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                    {top && (
                        <Chip
                            size="small"
                            label={STATE_LABEL[top.state]}
                            color={top.state === 'playing' ? 'success' : top.state === 'paused' ? 'warning' : 'info'}
                        />
                    )}
                    <Tooltip title="Close">
                        <IconButton onClick={onClose} size="small" aria-label="close">
                            <Close />
                        </IconButton>
                    </Tooltip>
                </Box>
            </DialogTitle>
            <DialogContent dividers>
                {/* Transport: acts on what is on. Renders nothing while idle. */}
                <Box sx={{ mb: 2 }}>
                    <PlaybackControls allowStopControls={allowStopControls} />
                </Box>

                {/* On now */}
                <Typography variant="overline" color="primary">
                    On now
                </Typography>
                {top ? (
                    <Box sx={{ mb: 2 }}>
                        <Box sx={{ display: 'flex', alignItems: 'baseline', gap: 1, flexWrap: 'wrap' }}>
                            <Typography variant="h6" sx={{ flexGrow: 1, minWidth: 0 }} noWrap title={top.title}>
                                {top.title}
                            </Typography>
                            <Chip size="small" variant="outlined" label={ORIGIN_LABEL[top.origin]} />
                            {allowStopControls && top.request_id && (
                                <Button
                                    size="small"
                                    color="error"
                                    startIcon={<Stop />}
                                    onClick={() => removeRequest(top.request_id!)}
                                >
                                    Stop request
                                </Button>
                            )}
                        </Box>
                        {song && (
                            <>
                                <Typography variant="body2" sx={{ mt: 0.5 }} noWrap title={song.title}>
                                    {cursorText(top) ? `${cursorText(top)}: ` : ''}
                                    {song.title}
                                </Typography>
                                <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mt: 0.5 }}>
                                    <LinearProgress
                                        variant="determinate"
                                        value={song.duration_ms ? Math.min(100, (100 * elapsed) / song.duration_ms) : 0}
                                        sx={{ flexGrow: 1, height: 8, borderRadius: 4 }}
                                    />
                                    <Typography
                                        variant="caption"
                                        color="text.secondary"
                                        sx={{ fontVariantNumeric: 'tabular-nums' }}
                                    >
                                        {formatSpan(elapsed)} / {formatSpan(song.duration_ms)}
                                    </Typography>
                                </Box>
                            </>
                        )}
                        {top.ends_at && (
                            <Typography variant="caption" color="text.secondary">
                                Scheduled until {formatClock(top.ends_at)}
                            </Typography>
                        )}
                        <SongOrder order={order} entry={top} />
                    </Box>
                ) : (
                    <Typography variant="body2" color="text.secondary" fontStyle="italic" sx={{ mb: 2 }}>
                        Nothing is playing
                    </Typography>
                )}

                {/* Interrupted: resumes when what is above it ends */}
                {below.length > 0 && (
                    <>
                        <Divider sx={{ my: 1 }} />
                        <Typography variant="overline" color="text.secondary">
                            Interrupted
                        </Typography>
                        <List dense disablePadding>
                            {below.map((e) => (
                                <ListItem
                                    key={e.key}
                                    disableGutters
                                    sx={{ opacity: 0.8 }}
                                    secondaryAction={
                                        allowStopControls ? (
                                            <Tooltip title="Do not resume this">
                                                <IconButton
                                                    edge="end"
                                                    size="small"
                                                    aria-label="stop"
                                                    onClick={() => stopItem(e.key, false)}
                                                >
                                                    <Stop fontSize="small" />
                                                </IconButton>
                                            </Tooltip>
                                        ) : undefined
                                    }
                                >
                                    <ListItemText
                                        primary={e.title}
                                        secondary={
                                            e.song
                                                ? `Resumes ${cursorText(e) ? `at ${cursorText(e)!.toLowerCase()}: ` : ''}${e.song.title}` +
                                                  (e.song.offset_ms > 0 ? ` (${formatSpan(e.song.offset_ms)} in)` : '')
                                                : 'Resumes when the above ends'
                                        }
                                    />
                                </ListItem>
                            ))}
                        </List>
                    </>
                )}

                {/* Waiting / deferred */}
                {(view?.pending.length ?? 0) > 0 && (
                    <>
                        <Divider sx={{ my: 1 }} />
                        <Typography variant="overline" color="text.secondary">
                            Waiting
                        </Typography>
                        <List dense disablePadding>
                            {view!.pending.map((p, i) => (
                                <ListItem
                                    key={p.request_id ?? p.schedule_id ?? i}
                                    disableGutters
                                    secondaryAction={
                                        allowStopControls ? (
                                            <Tooltip title="Remove">
                                                <IconButton
                                                    edge="end"
                                                    size="small"
                                                    aria-label="remove"
                                                    onClick={() =>
                                                        p.request_id
                                                            ? removeRequest(p.request_id)
                                                            : p.schedule_id && stopItem(p.schedule_id, false)
                                                    }
                                                >
                                                    <Close fontSize="small" />
                                                </IconButton>
                                            </Tooltip>
                                        ) : undefined
                                    }
                                >
                                    <ListItemText
                                        primary={p.title}
                                        secondary={
                                            p.why === 'deferred'
                                                ? 'Due, but outranked by what is on'
                                                : p.type === 'Immediate'
                                                  ? 'Starting'
                                                  : 'Request in line'
                                        }
                                    />
                                </ListItem>
                            ))}
                        </List>
                    </>
                )}

                {/* Up next */}
                <Divider sx={{ my: 1 }} />
                <Typography variant="overline" color="secondary">
                    Up next
                </Typography>
                {view?.upcoming.length ? (
                    <List dense disablePadding>
                        {view.upcoming.slice(0, 12).map((u: PlayingItem, i) => (
                            <ListItem key={`${u.sequence_id ?? u.schedule_id}-${u.at}-${i}`} disableGutters>
                                <ListItemText
                                    primary={u.item === 'Schedule' ? `Show: ${u.title}` : u.title}
                                    secondary={`Starts ${formatClock(u.at)}${u.request_id ? ' (request)' : ''}`}
                                />
                            </ListItem>
                        ))}
                    </List>
                ) : (
                    <Typography variant="body2" color="text.secondary" fontStyle="italic">
                        Nothing scheduled
                    </Typography>
                )}
            </DialogContent>
        </Dialog>
    );
};

/** The item's baked song order with the cursor marked, scrolled into view. */
function SongOrder({ order, entry }: { order: PlaybackItemOrder | null | undefined; entry: PlaybackStackEntry }) {
    const currentRef = useRef<HTMLLIElement | null>(null);
    const index = entry.position?.index;
    const section = entry.section;
    useEffect(() => {
        currentRef.current?.scrollIntoView({ block: 'nearest' });
    }, [index, section, order]);

    if (order === undefined) return null;
    if (order === null) {
        return (
            <Typography variant="caption" color="text.secondary">
                Song order unavailable
            </Typography>
        );
    }
    const parts: Array<[keyof typeof SECTION_LABEL, PlaybackOrderEntry[]]> = [
        ['intro', order.intro],
        ['main', order.main],
        ['outro', order.outro],
    ];
    const sections = parts.filter(([, list]) => list.length > 0);
    if (sections.length === 0) return null;
    const sectionRank = { intro: 0, main: 1, outro: 2 } as const;

    return (
        <Box
            sx={{
                mt: 1,
                maxHeight: 220,
                overflowY: 'auto',
                border: '1px solid',
                borderColor: 'divider',
                borderRadius: 1,
            }}
        >
            <List dense disablePadding>
                {sections.map(([name, list]) => (
                    <Box key={name}>
                        {sections.length > 1 && (
                            <Typography
                                variant="caption"
                                color="text.secondary"
                                sx={{ px: 1, pt: 0.5, display: 'block' }}
                            >
                                {SECTION_LABEL[name]}
                            </Typography>
                        )}
                        {list.map((s, i) => {
                            const isCurrent = section === name && index === i;
                            // Earlier sections, and earlier songs in this one, have played.
                            const played =
                                section !== undefined &&
                                (sectionRank[name] < sectionRank[section] ||
                                    (section === name && index !== undefined && i < index));
                            return (
                                <ListItem
                                    key={`${name}-${i}`}
                                    ref={isCurrent ? currentRef : undefined}
                                    dense
                                    sx={{
                                        py: 0,
                                        bgcolor: isCurrent ? 'action.selected' : undefined,
                                        opacity: played && !entry.position?.loop ? 0.5 : 1,
                                    }}
                                >
                                    <ListItemText
                                        primary={`${i + 1}. ${s.title}`}
                                        primaryTypographyProps={{
                                            variant: 'body2',
                                            noWrap: true,
                                            fontWeight: isCurrent ? 'bold' : undefined,
                                        }}
                                        secondary={formatSpan(s.duration_ms)}
                                        secondaryTypographyProps={{ variant: 'caption' }}
                                        sx={{ my: 0 }}
                                    />
                                </ListItem>
                            );
                        })}
                    </Box>
                ))}
            </List>
        </Box>
    );
}
