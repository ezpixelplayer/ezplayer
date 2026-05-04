import {
    Button,
    Card,
    Chip,
    Collapse,
    IconButton,
    LinearProgress,
    Table,
    TableBody,
    TableCell,
    TableHead,
    TableRow,
    Typography,
} from '@mui/material';
import KeyboardArrowDownIcon from '@mui/icons-material/KeyboardArrowDown';
import KeyboardArrowRightIcon from '@mui/icons-material/KeyboardArrowRight';
import SyncIcon from '@mui/icons-material/Sync';
import DownloadIcon from '@mui/icons-material/Download';
import React, { useState } from 'react';
import { useDispatch, useSelector } from 'react-redux';
import { PageHeader } from '@ezplayer/shared-ui-components';
import { Box } from '../box/Box';
import type { AppDispatch, RootState } from '../../store/Store';
import { triggerCloudSyncNow, triggerLayoutFetch } from '../../store/slices/CloudStatusStore';
import type {
    CloudFileEntry,
    CloudFileStatus,
    CloudSequenceProgress,
} from '@ezplayer/ezplayer-core';

interface CloudPageProps {
    title: string;
    statusArea?: React.ReactNode[];
}

const formatTimestamp = (ms?: number) => {
    if (!ms) return '(never)';
    return new Date(ms).toLocaleString();
};

const fieldRowSx = {
    display: 'flex',
    alignItems: 'baseline',
    gap: 2,
    mb: 1,
    '& .label': { minWidth: '160px', color: 'text.secondary' },
    '& .value': { fontFamily: 'monospace', wordBreak: 'break-all' },
};

const Field: React.FC<{ label: string; value: string }> = ({ label, value }) => (
    <Box sx={fieldRowSx}>
        <Typography className="label" variant="body2">
            {label}
        </Typography>
        <Typography className="value" variant="body2">
            {value}
        </Typography>
    </Box>
);

type RolledUpStatus = 'known' | 'downloading' | 'pending' | 'installed' | 'error';

const STATUS_COLOR: Record<
    RolledUpStatus | CloudFileStatus,
    'default' | 'info' | 'warning' | 'success' | 'error'
> = {
    known: 'default',
    downloading: 'info',
    staged: 'warning',
    pending: 'warning',
    installed: 'success',
    error: 'error',
};

function rollUpStatus(files: CloudFileEntry[]): RolledUpStatus {
    if (files.length === 0) return 'known';
    if (files.some((f) => f.status === 'error')) return 'error';
    if (files.some((f) => f.status === 'downloading')) return 'downloading';
    if (files.every((f) => f.status === 'installed')) return 'installed';
    if (files.every((f) => f.status === 'installed' || f.status === 'staged')) return 'pending';
    return 'known';
}

function fmtBytes(n?: number): string {
    if (!n) return '';
    if (n < 1024) return `${n} B`;
    if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
    if (n < 1024 * 1024 * 1024) return `${(n / 1024 / 1024).toFixed(1)} MB`;
    return `${(n / 1024 / 1024 / 1024).toFixed(2)} GB`;
}

function describeSequence(seq: CloudSequenceProgress): string {
    const parts = [seq.title || seq.vseq_id, seq.artist, seq.vendor].filter(Boolean);
    return parts.join(' - ');
}

const SequenceRow: React.FC<{
    seq: CloudSequenceProgress;
    files: CloudFileEntry[];
}> = ({ seq, files }) => {
    const [open, setOpen] = useState(false);
    const status = rollUpStatus(files);
    const totalBytes = files.reduce((s, f) => s + (f.totalBytes ?? 0), 0);
    const doneBytes = files.reduce((s, f) => s + (f.bytes ?? 0), 0);

    return (
        <>
            <TableRow hover sx={{ '& > *': { borderBottom: 'unset' } }}>
                <TableCell sx={{ width: 32 }}>
                    <IconButton size="small" onClick={() => setOpen((o) => !o)}>
                        {open ? <KeyboardArrowDownIcon /> : <KeyboardArrowRightIcon />}
                    </IconButton>
                </TableCell>
                <TableCell sx={{ wordBreak: 'break-word' }}>{describeSequence(seq)}</TableCell>
                <TableCell>
                    <Chip label={status} color={STATUS_COLOR[status]} size="small" />
                </TableCell>
                <TableCell>{fmtBytes(totalBytes || doneBytes)}</TableCell>
            </TableRow>
            <TableRow>
                <TableCell colSpan={4} sx={{ p: 0, border: 0 }}>
                    <Collapse in={open} timeout="auto" unmountOnExit>
                        <Box sx={{ p: 2, pl: 6, bgcolor: 'background.default' }}>
                            <Table size="small">
                                <TableHead>
                                    <TableRow>
                                        <TableCell>Filename</TableCell>
                                        <TableCell>Kind</TableCell>
                                        <TableCell>Status</TableCell>
                                        <TableCell>Progress</TableCell>
                                        <TableCell>Size</TableCell>
                                    </TableRow>
                                </TableHead>
                                <TableBody>
                                    {files.map((f) => {
                                        const pct =
                                            f.status === 'downloading' && f.totalBytes
                                                ? Math.min(
                                                      100,
                                                      ((f.bytes ?? 0) / f.totalBytes) * 100,
                                                  )
                                                : undefined;
                                        return (
                                            <TableRow key={f.file_id}>
                                                <TableCell
                                                    sx={{
                                                        fontFamily: 'monospace',
                                                        wordBreak: 'break-all',
                                                        maxWidth: 360,
                                                    }}
                                                >
                                                    {f.filename ?? f.file_id}
                                                </TableCell>
                                                <TableCell>{f.kind}</TableCell>
                                                <TableCell>
                                                    <Chip
                                                        label={f.status}
                                                        color={STATUS_COLOR[f.status]}
                                                        size="small"
                                                    />
                                                    {f.error && (
                                                        <Typography
                                                            variant="caption"
                                                            color="error"
                                                            sx={{ display: 'block' }}
                                                        >
                                                            {f.error}
                                                        </Typography>
                                                    )}
                                                </TableCell>
                                                <TableCell sx={{ minWidth: 140 }}>
                                                    {f.status === 'downloading' ? (
                                                        pct !== undefined ? (
                                                            <Box>
                                                                <LinearProgress
                                                                    variant="determinate"
                                                                    value={pct}
                                                                />
                                                                <Typography variant="caption">
                                                                    {pct.toFixed(0)}%
                                                                </Typography>
                                                            </Box>
                                                        ) : (
                                                            <LinearProgress />
                                                        )
                                                    ) : null}
                                                </TableCell>
                                                <TableCell>
                                                    {fmtBytes(f.totalBytes ?? f.bytes)}
                                                </TableCell>
                                            </TableRow>
                                        );
                                    })}
                                </TableBody>
                            </Table>
                        </Box>
                    </Collapse>
                </TableCell>
            </TableRow>
        </>
    );
};

export const CloudPage: React.FC<CloudPageProps> = ({ title, statusArea }) => {
    const cloudConfig = useSelector((s: RootState) => s.cloudConfig);
    const cloudStatus = useSelector((s: RootState) => s.cloudStatus);
    const cStatus = useSelector(
        (s: RootState) => s.playerStatus.playerStatus.content,
    );

    // Reachability is derived from the last poll: a clean reply means we reached the cloud,
    // an error means we didn't, no checks yet means we don't know.
    const reachableLabel =
        cloudStatus.lastCheckedAt === undefined
            ? '(unknown)'
            : cloudStatus.lastError
              ? 'no'
              : 'yes';

    const sequencesMap = cStatus?.sequences ?? {};
    const filesMap = cStatus?.files ?? {};
    const seqEntries = Object.values(sequencesMap).sort((a, b) =>
        describeSequence(a).localeCompare(describeSequence(b)),
    );

    const dispatch = useDispatch<AppDispatch>();
    const [syncing, setSyncing] = useState(false);
    const handleSync = async () => {
        setSyncing(true);
        try {
            await dispatch(triggerCloudSyncNow()).unwrap();
        } catch (e) {
            console.error('[CloudPage] sync now failed:', e);
        } finally {
            setSyncing(false);
        }
    };
    const layout = cStatus?.layout;
    const layoutFetching = layout?.status === 'fetching' || layout?.status === 'unpacking';
    const handleFetchLayout = async () => {
        try {
            await dispatch(triggerLayoutFetch()).unwrap();
        } catch (e) {
            console.error('[CloudPage] fetch layout failed:', e);
        }
    };

    return (
        <Box
            sx={{
                height: '100vh',
                display: 'flex',
                flexDirection: 'column',
                overflow: 'hidden',
            }}
        >
            <Box sx={{ flexShrink: 0, padding: 2 }}>
                <PageHeader heading={title} children={statusArea} />
            </Box>
            <Box sx={{ padding: 2, overflowY: 'auto', flexGrow: 1 }}>
                <Card sx={{ maxWidth: '720px', p: 4, mb: 3 }}>
                    <Typography variant="h6" sx={{ mb: 2, color: 'primary.main' }}>
                        Cloud Configuration
                    </Typography>
                    <Field label="Cloud Service URL" value={cloudConfig.cloudServiceUrl || '(not set)'} />
                    <Field label="Player ID Token" value={cloudConfig.playerIdToken || '(not set)'} />
                </Card>

                <Card sx={{ maxWidth: '720px', p: 4, mb: 3 }}>
                    <Typography variant="h6" sx={{ mb: 2, color: 'primary.main' }}>
                        Cloud Status
                    </Typography>
                    <Field label="Cloud Reachable" value={reachableLabel} />
                    <Field
                        label="Player Registered"
                        value={cloudStatus.playerIdIsRegistered ? 'yes' : 'no'}
                    />
                    <Field label="Cloud Version" value={cloudStatus.cloudVersion ?? '(unknown)'} />
                    <Field label="Last Checked" value={formatTimestamp(cloudStatus.lastCheckedAt)} />
                    <Field label="Last Error" value={cloudStatus.lastError ?? '(none)'} />
                </Card>

                <Card sx={{ maxWidth: '720px', p: 4, mb: 3 }}>
                    <Box sx={{ display: 'flex', alignItems: 'center', gap: 2, mb: 2 }}>
                        <Typography variant="h6" sx={{ color: 'primary.main' }}>
                            Cloud Layout
                        </Typography>
                        <Box sx={{ flexGrow: 1 }} />
                        <Button
                            startIcon={<DownloadIcon />}
                            variant="outlined"
                            size="small"
                            onClick={handleFetchLayout}
                            disabled={layoutFetching}
                        >
                            {layoutFetching ? 'Fetching…' : 'Fetch Layout'}
                        </Button>
                    </Box>
                    <Field label="Status" value={layout?.status ?? 'idle'} />
                    <Field label="Last Fetched" value={formatTimestamp(layout?.lastFetchedAt)} />
                    <Field label="Last Error" value={layout?.error ?? '(none)'} />
                    {layoutFetching && layout?.totalBytes ? (
                        <Box sx={{ mt: 1 }}>
                            <LinearProgress
                                variant="determinate"
                                value={Math.min(
                                    100,
                                    ((layout.bytes ?? 0) / layout.totalBytes) * 100,
                                )}
                            />
                            <Typography variant="caption">
                                {fmtBytes(layout.bytes)} / {fmtBytes(layout.totalBytes)}
                            </Typography>
                        </Box>
                    ) : layoutFetching ? (
                        <LinearProgress sx={{ mt: 1 }} />
                    ) : null}
                </Card>

                <Card sx={{ p: 4, mb: 3 }}>
                    <Box sx={{ display: 'flex', alignItems: 'center', gap: 2, mb: 2 }}>
                        <Typography variant="h6" sx={{ color: 'primary.main' }}>
                            Cloud Content
                        </Typography>
                        {cStatus?.halted && (
                            <Chip label="halted" color="error" size="small" />
                        )}
                        <Box sx={{ flexGrow: 1 }} />
                        <Button
                            startIcon={<SyncIcon />}
                            variant="outlined"
                            size="small"
                            onClick={handleSync}
                            disabled={syncing}
                        >
                            {syncing ? 'Syncing…' : 'Sync Now'}
                        </Button>
                    </Box>
                    <Field label="Last Manifest" value={formatTimestamp(cStatus?.lastManifestAt)} />
                    <Field label="Last Error" value={cStatus?.lastError ?? '(none)'} />
                    {seqEntries.length === 0 ? (
                        <Typography variant="body2" color="text.secondary" sx={{ mt: 2 }}>
                            No sequences reported yet.
                        </Typography>
                    ) : (
                        <Table size="small" sx={{ mt: 2 }}>
                            <TableHead>
                                <TableRow>
                                    <TableCell sx={{ width: 32 }} />
                                    <TableCell>Sequence</TableCell>
                                    <TableCell>Status</TableCell>
                                    <TableCell>Size</TableCell>
                                </TableRow>
                            </TableHead>
                            <TableBody>
                                {seqEntries.map((seq) => {
                                    const files = seq.fileIds
                                        .map((id) => filesMap[id])
                                        .filter((f): f is CloudFileEntry => Boolean(f));
                                    return (
                                        <SequenceRow key={seq.vseq_id} seq={seq} files={files} />
                                    );
                                })}
                            </TableBody>
                        </Table>
                    )}
                </Card>
            </Box>
        </Box>
    );
};
