/**
 * Viewer Activity — what the show's audience is doing with the viewer page.
 *
 * Renders the `viewerStats` summary the player computes from the activity
 * events it pulls off its player_server: the live request line, today's and
 * the month's counts, a per-day bar strip, the most requested songs, refusal
 * reasons and a recent-activity feed. Pure MUI + inline boxes; no chart lib.
 */

import type { VcSelectionReason, VcStatsEvent, ViewerStatsDay, ViewerStatsSummary } from '@ezplayer/ezplayer-core';
import { PageHeader } from '@ezplayer/shared-ui-components';
import {
    Alert,
    Card,
    CardContent,
    Chip,
    Grid,
    Stack,
    Table,
    TableBody,
    TableCell,
    TableHead,
    TableRow,
    Tooltip,
    Typography,
    useTheme,
} from '@mui/material';
import { useEffect, useMemo, useState } from 'react';
import { useSelector } from 'react-redux';

import { Box } from '../box/Box';
import type { RootState } from '../../store/Store';

export interface ViewerStatsScreenProps {
    title: string;
    statusArea: React.ReactNode[];
}

const REASON_TEXT: Record<VcSelectionReason | 'unknown', string> = {
    'mode-off': 'Requests closed',
    'unknown-song': 'Unknown song',
    'anonymous-not-allowed': 'Sign-in required',
    'already-selected': 'Already playing / next',
    'in-cooldown': 'Played recently',
    duplicate: 'Duplicate',
    'viewer-limit': 'Per-viewer limit',
    'queue-full': 'Queue full',
    unknown: 'Other',
};

function ago(ts: number | undefined, now: number): string {
    if (!ts) return '—';
    const s = Math.max(0, Math.round((now - ts) / 1000));
    if (s < 60) return `${s}s ago`;
    const m = Math.round(s / 60);
    if (m < 60) return `${m} min ago`;
    const h = Math.round(m / 60);
    if (h < 48) return `${h} h ago`;
    return `${Math.round(h / 24)} d ago`;
}

function clock(ts: number, tz: string): string {
    try {
        return new Intl.DateTimeFormat(undefined, {
            timeZone: tz,
            month: 'short',
            day: 'numeric',
            hour: 'numeric',
            minute: '2-digit',
        }).format(new Date(ts));
    } catch {
        return new Date(ts).toLocaleString();
    }
}

function dayLabel(day: string): string {
    // day is YYYY-MM-DD; show M/D without timezone games.
    const [, m, d] = day.split('-');
    return `${Number(m)}/${Number(d)}`;
}

function describe(ev: VcStatsEvent): string {
    const title = ev.title ?? ev.songId ?? '';
    switch (ev.kind) {
        case 'request':
            return `Requested “${title}”${ev.count ? ` (queue #${ev.count})` : ''}`;
        case 'vote':
            return `Voted for “${title}”${ev.count ? ` (${ev.count} vote${ev.count === 1 ? '' : 's'})` : ''}`;
        case 'refused':
            return `Refused “${title}” — ${REASON_TEXT[ev.reason ?? 'unknown']}`;
        case 'pick':
            return `Picked “${title}” to play next (${ev.mode === 'vote' ? 'vote winner' : 'from queue'})`;
        case 'play':
            return `Now playing “${title}”`;
        case 'viewers':
            return `${ev.count} viewer${ev.count === 1 ? '' : 's'} on the page`;
        case 'listeners':
            return `${ev.count} listening`;
        default:
            return ev.kind;
    }
}

const KIND_COLOR: Record<string, 'primary' | 'secondary' | 'success' | 'warning' | 'error' | 'default' | 'info'> = {
    request: 'primary',
    vote: 'secondary',
    refused: 'warning',
    pick: 'success',
    play: 'info',
};

function StatTile({ label, value, hint }: { label: string; value: React.ReactNode; hint?: string }) {
    return (
        <Box sx={{ minWidth: 110, flex: '1 1 110px' }}>
            <Typography variant="caption" color="text.secondary" sx={{ display: 'block' }}>
                {label}
            </Typography>
            <Typography variant="h4" fontWeight="bold" sx={{ lineHeight: 1.2 }}>
                {value}
            </Typography>
            {hint ? (
                <Typography variant="caption" color="text.secondary">
                    {hint}
                </Typography>
            ) : null}
        </Box>
    );
}

function DayBars({ days }: { days: ViewerStatsDay[] }) {
    const theme = useTheme();
    const max = Math.max(1, ...days.map((d) => d.requests + d.votes));
    const H = 96;
    return (
        <Box>
            <Box sx={{ display: 'flex', alignItems: 'flex-end', gap: '3px', height: H }}>
                {days.map((d) => {
                    const total = d.requests + d.votes;
                    const hReq = Math.round((d.requests / max) * H);
                    const hVote = Math.round((d.votes / max) * H);
                    return (
                        <Tooltip
                            key={d.day}
                            title={`${d.day}: ${d.requests} requests, ${d.votes} votes, ${d.picks} picks, ${d.uniqueViewers} viewers, peak ${d.peakViewers} on page / ${d.peakListeners} listening`}
                        >
                            <Box
                                sx={{
                                    flex: 1,
                                    minWidth: 4,
                                    height: H,
                                    display: 'flex',
                                    flexDirection: 'column',
                                    justifyContent: 'flex-end',
                                    borderRadius: '2px 2px 0 0',
                                    backgroundColor: total === 0 ? theme.palette.action.hover : 'transparent',
                                }}
                            >
                                <Box sx={{ height: hVote, backgroundColor: theme.palette.secondary.main }} />
                                <Box sx={{ height: hReq, backgroundColor: theme.palette.primary.main }} />
                            </Box>
                        </Tooltip>
                    );
                })}
            </Box>
            <Box sx={{ display: 'flex', justifyContent: 'space-between', mt: 0.5 }}>
                <Typography variant="caption" color="text.secondary">
                    {days[0] ? dayLabel(days[0].day) : ''}
                </Typography>
                <Typography variant="caption" color="text.secondary">
                    today
                </Typography>
            </Box>
            <Stack direction="row" spacing={2} sx={{ mt: 0.5 }}>
                <Legend color={theme.palette.primary.main} label="requests" />
                <Legend color={theme.palette.secondary.main} label="votes" />
            </Stack>
        </Box>
    );
}

function Legend({ color, label }: { color: string; label: string }) {
    return (
        <Stack direction="row" spacing={0.5} alignItems="center">
            <Box sx={{ width: 10, height: 10, borderRadius: '2px', backgroundColor: color }} />
            <Typography variant="caption" color="text.secondary">
                {label}
            </Typography>
        </Stack>
    );
}

function LiveCard({ summary, now }: { summary: ViewerStatsSummary; now: number }) {
    const theme = useTheme();
    const live = summary.live;
    const stale = summary.lastPullAt ? now - summary.lastPullAt > 120_000 : true;
    return (
        <Card>
            <CardContent>
                <Stack direction="row" alignItems="center" spacing={1} flexWrap="wrap" sx={{ mb: 1 }}>
                    <Typography variant="h3" fontWeight="bold" color={theme.palette.secondary.main}>
                        Right now
                    </Typography>
                    <Box sx={{ flex: 1 }} />
                    {live ? (
                        <>
                            <Chip
                                size="small"
                                color={live.online ? 'success' : 'default'}
                                label={live.online ? 'Player online' : 'Player offline'}
                            />
                            <Chip
                                size="small"
                                color={live.mode === 'off' ? 'default' : 'primary'}
                                label={
                                    live.mode === 'off'
                                        ? 'Requests closed'
                                        : live.mode === 'vote'
                                          ? 'Voting open'
                                          : 'Requests open'
                                }
                            />
                        </>
                    ) : null}
                    <Typography variant="caption" color={stale ? 'warning.main' : 'text.secondary'}>
                        {summary.lastPullAt ? `updated ${ago(summary.lastPullAt, now)}` : 'not synced yet'}
                    </Typography>
                </Stack>
                {summary.lastPullError ? (
                    <Alert severity="warning" sx={{ mb: 1 }}>
                        Could not reach the player server for stats: {summary.lastPullError}
                    </Alert>
                ) : null}
                {live ? (
                    <>
                        <Stack direction="row" spacing={3} flexWrap="wrap" useFlexGap sx={{ mb: 1.5 }}>
                            <StatTile label="On the page" value={live.viewers} />
                            <StatTile label="Listening" value={live.listeners} />
                            <StatTile label="In queue" value={live.queue.length} />
                            <StatTile label="Songs with votes" value={live.votes.length} />
                        </Stack>
                        {live.queue.length > 0 ? (
                            <Box sx={{ mb: 1 }}>
                                <Typography variant="subtitle2">Request queue</Typography>
                                {live.queue.map((q) => (
                                    <Typography key={`${q.position}-${q.songId}`} variant="body2">
                                        #{q.position} {q.title ?? q.songId}
                                        <Typography component="span" variant="caption" color="text.secondary">
                                            {' '}
                                            · {ago(q.requestedAt, now)}
                                            {q.viewer ? ` · viewer ${q.viewer.slice(0, 6)}` : ''}
                                        </Typography>
                                    </Typography>
                                ))}
                            </Box>
                        ) : null}
                        {live.votes.length > 0 ? (
                            <Box>
                                <Typography variant="subtitle2">Votes</Typography>
                                {[...live.votes]
                                    .sort((a, b) => b.votes - a.votes)
                                    .map((v) => (
                                        <Typography key={v.songId} variant="body2">
                                            {v.votes} × {v.title ?? v.songId}
                                        </Typography>
                                    ))}
                            </Box>
                        ) : null}
                        {live.queue.length === 0 && live.votes.length === 0 ? (
                            <Typography variant="body2" color="text.secondary">
                                No pending requests or votes.
                            </Typography>
                        ) : null}
                    </>
                ) : (
                    <Typography variant="body2" color="text.secondary">
                        No live data yet. The player pulls viewer activity from its player server every 30 seconds once
                        it is registered with the cloud.
                    </Typography>
                )}
            </CardContent>
        </Card>
    );
}

export function ViewerStatsScreen({ title, statusArea }: ViewerStatsScreenProps) {
    const theme = useTheme();
    const summary = useSelector((s: RootState) => s.viewerStats.summary);
    const [now, setNow] = useState(() => Date.now());
    useEffect(() => {
        const id = setInterval(() => setNow(Date.now()), 15_000);
        return () => clearInterval(id);
    }, []);

    const empty = useMemo(() => !summary || (summary.storedEvents === 0 && !summary.live), [summary]);

    return (
        <Box sx={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
            <Box sx={{ padding: 2, flexShrink: 0 }}>
                <PageHeader heading={title} children={statusArea} />
            </Box>
            <Box sx={{ flex: 1, overflow: 'auto' }}>
                <Grid container spacing={2} sx={{ p: 2, pt: 0 }}>
                    {!summary ? (
                        <Grid item xs={12}>
                            <Typography color="text.secondary">Waiting for the player…</Typography>
                        </Grid>
                    ) : (
                        <>
                            {summary.gap ? (
                                <Grid item xs={12}>
                                    <Alert severity="info">
                                        Some activity was dropped by the player server before it could be collected, so
                                        recent counts may be incomplete.
                                    </Alert>
                                </Grid>
                            ) : null}
                            <Grid item xs={12}>
                                <LiveCard summary={summary} now={now} />
                            </Grid>
                            <Grid item xs={12} md={6}>
                                <Card sx={{ height: '100%' }}>
                                    <CardContent>
                                        <Typography
                                            variant="h3"
                                            fontWeight="bold"
                                            color={theme.palette.secondary.main}
                                            sx={{ mb: 1 }}
                                        >
                                            Today
                                        </Typography>
                                        <Stack direction="row" spacing={3} flexWrap="wrap" useFlexGap>
                                            <StatTile label="Requests" value={summary.today.requests} />
                                            <StatTile label="Votes" value={summary.today.votes} />
                                            <StatTile label="Played from picks" value={summary.today.picks} />
                                            <StatTile label="Viewers who acted" value={summary.today.uniqueViewers} />
                                            <StatTile label="Peak on page" value={summary.today.peakViewers} />
                                            <StatTile label="Peak listening" value={summary.today.peakListeners} />
                                            <StatTile label="Refused" value={summary.today.refused} />
                                        </Stack>
                                    </CardContent>
                                </Card>
                            </Grid>
                            <Grid item xs={12} md={6}>
                                <Card sx={{ height: '100%' }}>
                                    <CardContent>
                                        <Typography
                                            variant="h3"
                                            fontWeight="bold"
                                            color={theme.palette.secondary.main}
                                            sx={{ mb: 1 }}
                                        >
                                            Last {summary.windowDays} days
                                        </Typography>
                                        <Stack direction="row" spacing={3} flexWrap="wrap" useFlexGap sx={{ mb: 1.5 }}>
                                            <StatTile label="Requests" value={summary.window.requests} />
                                            <StatTile label="Votes" value={summary.window.votes} />
                                            <StatTile label="Played from picks" value={summary.window.picks} />
                                            <StatTile label="Viewers who acted" value={summary.window.uniqueViewers} />
                                            <StatTile label="Peak on page" value={summary.window.peakViewers} />
                                            <StatTile label="Peak listening" value={summary.window.peakListeners} />
                                        </Stack>
                                        <DayBars days={summary.days} />
                                    </CardContent>
                                </Card>
                            </Grid>
                            {empty ? (
                                <Grid item xs={12}>
                                    <Alert severity="info">
                                        No viewer activity recorded yet. Activity appears here once the viewer page is
                                        enabled in your show settings and viewers start requesting or voting.
                                    </Alert>
                                </Grid>
                            ) : null}
                            <Grid item xs={12} md={7}>
                                <Card sx={{ height: '100%' }}>
                                    <CardContent>
                                        <Typography
                                            variant="h3"
                                            fontWeight="bold"
                                            color={theme.palette.secondary.main}
                                            sx={{ mb: 1 }}
                                        >
                                            Most requested
                                        </Typography>
                                        {summary.songs.length === 0 ? (
                                            <Typography variant="body2" color="text.secondary">
                                                Nothing yet.
                                            </Typography>
                                        ) : (
                                            <Table size="small">
                                                <TableHead>
                                                    <TableRow>
                                                        <TableCell>Song</TableCell>
                                                        <TableCell align="right">Requests</TableCell>
                                                        <TableCell align="right">Votes</TableCell>
                                                        <TableCell align="right">Picked</TableCell>
                                                        <TableCell align="right">Plays</TableCell>
                                                        <TableCell align="right">Refused</TableCell>
                                                    </TableRow>
                                                </TableHead>
                                                <TableBody>
                                                    {summary.songs.map((s) => (
                                                        <TableRow key={s.songId}>
                                                            <TableCell>{s.title ?? s.songId}</TableCell>
                                                            <TableCell align="right">{s.requests}</TableCell>
                                                            <TableCell align="right">{s.votes}</TableCell>
                                                            <TableCell align="right">{s.picks}</TableCell>
                                                            <TableCell align="right">{s.plays}</TableCell>
                                                            <TableCell align="right">{s.refused}</TableCell>
                                                        </TableRow>
                                                    ))}
                                                </TableBody>
                                            </Table>
                                        )}
                                        {summary.refusals.length > 0 ? (
                                            <Box sx={{ mt: 2 }}>
                                                <Typography variant="subtitle2">Why requests were refused</Typography>
                                                <Stack
                                                    direction="row"
                                                    spacing={1}
                                                    flexWrap="wrap"
                                                    useFlexGap
                                                    sx={{ mt: 0.5 }}
                                                >
                                                    {summary.refusals.map((r) => (
                                                        <Chip
                                                            key={r.reason}
                                                            size="small"
                                                            variant="outlined"
                                                            label={`${REASON_TEXT[r.reason]}: ${r.count}`}
                                                        />
                                                    ))}
                                                </Stack>
                                            </Box>
                                        ) : null}
                                    </CardContent>
                                </Card>
                            </Grid>
                            <Grid item xs={12} md={5}>
                                <Card sx={{ height: '100%' }}>
                                    <CardContent>
                                        <Typography
                                            variant="h3"
                                            fontWeight="bold"
                                            color={theme.palette.secondary.main}
                                            sx={{ mb: 1 }}
                                        >
                                            Recent activity
                                        </Typography>
                                        {summary.recent.length === 0 ? (
                                            <Typography variant="body2" color="text.secondary">
                                                Nothing yet.
                                            </Typography>
                                        ) : (
                                            <Stack spacing={0.75}>
                                                {summary.recent.map((ev) => (
                                                    <Stack
                                                        key={`${ev.ts}-${ev.seq}`}
                                                        direction="row"
                                                        spacing={1}
                                                        alignItems="flex-start"
                                                    >
                                                        <Chip
                                                            size="small"
                                                            color={KIND_COLOR[ev.kind] ?? 'default'}
                                                            label={ev.kind}
                                                            sx={{ minWidth: 68, textTransform: 'capitalize' }}
                                                        />
                                                        <Box sx={{ minWidth: 0, flex: 1 }}>
                                                            <Typography variant="body2" noWrap title={describe(ev)}>
                                                                {describe(ev)}
                                                            </Typography>
                                                            <Typography variant="caption" color="text.secondary">
                                                                {clock(ev.ts, summary.tz)}
                                                                {ev.viewer ? ` · viewer ${ev.viewer.slice(0, 6)}` : ''}
                                                            </Typography>
                                                        </Box>
                                                    </Stack>
                                                ))}
                                            </Stack>
                                        )}
                                    </CardContent>
                                </Card>
                            </Grid>
                            <Grid item xs={12}>
                                <Typography variant="caption" color="text.secondary">
                                    Days are counted in {summary.tz}. Viewers are identified by an anonymous hash, never
                                    an address. {summary.storedEvents} events stored on this player.
                                </Typography>
                            </Grid>
                        </>
                    )}
                </Grid>
            </Box>
        </Box>
    );
}
