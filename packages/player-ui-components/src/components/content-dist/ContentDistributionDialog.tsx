/**
 * Content distribution, in detail: what each device is doing right now, and
 * what the last run did to every file. Opened from the Show Status card, the
 * Content Sync settings, and the controllers screen, so it reads the broadcast
 * state rather than taking a snapshot as a prop.
 */

import {
    Alert,
    Button,
    Chip,
    Dialog,
    DialogActions,
    DialogContent,
    DialogTitle,
    IconButton,
    LinearProgress,
    Table,
    TableBody,
    TableCell,
    TableHead,
    TableRow,
    Tooltip,
    Typography,
} from '@mui/material';
import CloseIcon from '@mui/icons-material/Close';
import SendIcon from '@mui/icons-material/Send';
import FactCheckIcon from '@mui/icons-material/FactCheck';
import React from 'react';
import { useDispatch, useSelector } from 'react-redux';
import type { ContentDistItem } from '@ezplayer/ezplayer-core';
import { Box } from '../box/Box';
import { issueControllerCommand } from '../../store/slices/ControllerOpsStore';
import type { AppDispatch, RootState } from '../../store/Store';
import { contentTargets, failedTargets, formatBytes, formatDuration, itemRows } from './contentDistHelpers';

const ACTION_CHIP: Record<
    ContentDistItem['action'],
    { label: string; color: 'success' | 'default' | 'error' | 'info' }
> = {
    uploaded: { label: 'sent', color: 'success' },
    skipped: { label: 'current', color: 'default' },
    failed: { label: 'failed', color: 'error' },
    planned: { label: 'to send', color: 'info' },
};

export const ContentDistributionDialog: React.FC<{ open: boolean; onClose: () => void }> = ({ open, onClose }) => {
    const dispatch = useDispatch<AppDispatch>();
    const devices = useSelector((s: RootState) => s.controllerOps.devices);
    const contentDist = useSelector((s: RootState) => s.controllerOps.contentDist);
    const operations = useSelector((s: RootState) => s.controllerOps.operations);

    const run = contentDist?.run;
    const report = contentDist?.lastReport;
    const targets = contentTargets(devices);
    const rows = itemRows(report);
    // Report columns come from the report itself: a device may have been
    // removed from the grid since, and its result still means something.
    const columns = report?.targets ?? [];
    const failed = failedTargets(report);
    const runningOp = Object.values(operations).find((o) => o.kind === 'distribute' && o.status === 'running');

    const distribute = (checkOnly: boolean) =>
        void dispatch(issueControllerCommand({ cmd: 'distribute', ...(checkOnly ? { checkOnly: true } : {}) }));

    return (
        <Dialog open={open} onClose={onClose} maxWidth="lg" fullWidth PaperProps={{ sx: { maxHeight: '90vh' } }}>
            <DialogTitle sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                <Typography variant="h5">Content Distribution</Typography>
                <Tooltip title="Close">
                    <IconButton onClick={onClose} size="small" aria-label="close">
                        <CloseIcon />
                    </IconButton>
                </Tooltip>
            </DialogTitle>
            <DialogContent dividers>
                {/* Live run — per device, so a slow one is obvious. */}
                {run && (
                    <Box sx={{ mb: 3 }}>
                        <Typography variant="subtitle2" sx={{ mb: 1 }}>
                            {run.checkOnly ? 'Checking' : 'Sending'}
                            {run.bytesTotal > 0 && ` — ${formatBytes(run.bytesSent)} of ${formatBytes(run.bytesTotal)}`}
                        </Typography>
                        <LinearProgress variant="determinate" value={Math.round(run.fraction * 100)} sx={{ mb: 2 }} />
                        <Table size="small">
                            <TableBody>
                                {run.targets.map((t) => (
                                    <TableRow key={t.id}>
                                        <TableCell sx={{ width: '30%' }}>{t.label}</TableCell>
                                        <TableCell sx={{ width: 110 }}>
                                            <Chip size="small" label={t.phase} variant="outlined" />
                                        </TableCell>
                                        <TableCell sx={{ width: '30%' }}>
                                            <LinearProgress
                                                variant="determinate"
                                                value={Math.round(t.fraction * 100)}
                                            />
                                        </TableCell>
                                        <TableCell>
                                            <Typography variant="caption" color="text.secondary">
                                                {t.message ??
                                                    t.item ??
                                                    (t.itemsTotal > 0 ? `${t.itemsDone} of ${t.itemsTotal}` : '')}
                                            </Typography>
                                        </TableCell>
                                    </TableRow>
                                ))}
                            </TableBody>
                        </Table>
                    </Box>
                )}

                {!run && !report && (
                    <Typography variant="body2" color="text.secondary">
                        Nothing has been distributed yet. “Check what’s needed” reads each device’s own file list and
                        reports what a send would transfer, without sending anything.
                    </Typography>
                )}

                {contentDist?.queued?.length ? (
                    <Alert severity="info" sx={{ mb: 2 }}>
                        Waiting to be sent: {contentDist.queued.join(', ')}
                    </Alert>
                ) : null}

                {/* Last run */}
                {report && (
                    <>
                        <Typography variant="subtitle2" sx={{ mb: 0.5 }}>
                            {report.checkOnly ? 'Last check' : 'Last distribution'}
                            {report.cancelled && ' (cancelled)'}
                        </Typography>
                        <Typography variant="body2" color="text.secondary" sx={{ mb: 1.5 }}>
                            {new Date(report.startedAt).toLocaleString()} ·{' '}
                            {formatDuration(
                                new Date(report.finishedAt).getTime() - new Date(report.startedAt).getTime(),
                            )}{' '}
                            ·{' '}
                            {report.checkOnly
                                ? `${report.totals.planned} to send, ${report.totals.skipped} current`
                                : `${report.totals.uploaded} sent, ${report.totals.skipped} already current`}
                            {report.totals.failed > 0 && `, ${report.totals.failed} failed`}
                            {report.totals.bytes > 0 && ` · ${formatBytes(report.totals.bytes)}`}
                            {report.trigger !== 'manual' &&
                                ` · started ${report.trigger === 'songs' ? 'by a song being added' : 'on schedule'}`}
                        </Typography>

                        {failed.length > 0 && (
                            <Alert severity="warning" sx={{ mb: 2 }}>
                                Behind the show: {failed.join(', ')}. Running again sends only what is still missing.
                            </Alert>
                        )}

                        {/* Per-device notes, which a file-by-file table cannot carry. */}
                        {columns.some((c) => c.note) && (
                            <Box sx={{ mb: 2 }}>
                                {columns
                                    .filter((c) => c.note)
                                    .map((c) => (
                                        <Typography key={c.id} variant="body2" color="text.secondary">
                                            {c.label}: {c.note}
                                        </Typography>
                                    ))}
                            </Box>
                        )}

                        {rows.length > 0 && (
                            <Box sx={{ overflowX: 'auto' }}>
                                <Table size="small" stickyHeader>
                                    <TableHead>
                                        <TableRow>
                                            <TableCell>File</TableCell>
                                            {columns.map((c) => (
                                                <TableCell key={c.id} sx={{ whiteSpace: 'nowrap' }}>
                                                    {c.hostName}
                                                    {c.version && (
                                                        <Typography
                                                            variant="caption"
                                                            color="text.secondary"
                                                            sx={{ display: 'block' }}
                                                        >
                                                            FPP {c.version}
                                                        </Typography>
                                                    )}
                                                </TableCell>
                                            ))}
                                        </TableRow>
                                    </TableHead>
                                    <TableBody>
                                        {rows.map((row) => (
                                            <TableRow key={`${row.kind}-${row.name}`} hover>
                                                <TableCell sx={{ whiteSpace: 'nowrap' }}>
                                                    {row.name}
                                                    <Typography variant="caption" color="text.secondary" sx={{ ml: 1 }}>
                                                        {row.kind}
                                                    </Typography>
                                                </TableCell>
                                                {columns.map((c) => {
                                                    const item = row.byTarget.get(c.id);
                                                    if (!item) {
                                                        return (
                                                            <TableCell key={c.id}>
                                                                <Typography variant="caption" color="text.disabled">
                                                                    —
                                                                </Typography>
                                                            </TableCell>
                                                        );
                                                    }
                                                    const chip = ACTION_CHIP[item.action];
                                                    return (
                                                        <TableCell key={c.id}>
                                                            <Tooltip
                                                                title={`${item.reason}${
                                                                    item.bytes > 0
                                                                        ? ` — ${formatBytes(item.bytes)} in ${formatDuration(item.ms)}`
                                                                        : ''
                                                                }`}
                                                            >
                                                                <Chip
                                                                    size="small"
                                                                    label={chip.label}
                                                                    color={chip.color}
                                                                    variant={
                                                                        item.action === 'skipped'
                                                                            ? 'outlined'
                                                                            : 'filled'
                                                                    }
                                                                />
                                                            </Tooltip>
                                                        </TableCell>
                                                    );
                                                })}
                                            </TableRow>
                                        ))}
                                    </TableBody>
                                </Table>
                            </Box>
                        )}
                    </>
                )}
            </DialogContent>
            <DialogActions>
                <Button
                    startIcon={<FactCheckIcon />}
                    onClick={() => distribute(true)}
                    disabled={!!run || !targets.length}
                >
                    Check what’s needed
                </Button>
                <Button
                    variant="contained"
                    startIcon={<SendIcon />}
                    onClick={() => distribute(false)}
                    disabled={!!run || !targets.length}
                >
                    Distribute now
                </Button>
                {run && runningOp && (
                    <Button
                        color="warning"
                        onClick={() => void dispatch(issueControllerCommand({ cmd: 'cancel', opId: runningOp.id }))}
                    >
                        Stop
                    </Button>
                )}
                <Button onClick={onClose}>Close</Button>
            </DialogActions>
        </Dialog>
    );
};
