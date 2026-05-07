import {
    Button,
    Card,
    Chip,
    Collapse,
    IconButton,
    LinearProgress,
    Stack,
    Table,
    TableBody,
    TableCell,
    TableHead,
    TableRow,
    ToggleButton,
    ToggleButtonGroup,
    Typography,
} from '@mui/material';
import KeyboardArrowDownIcon from '@mui/icons-material/KeyboardArrowDown';
import KeyboardArrowRightIcon from '@mui/icons-material/KeyboardArrowRight';
import SyncIcon from '@mui/icons-material/Sync';
import DownloadIcon from '@mui/icons-material/Download';
import UploadIcon from '@mui/icons-material/Upload';
import PauseIcon from '@mui/icons-material/Pause';
import PlayArrowIcon from '@mui/icons-material/PlayArrow';
import EditIcon from '@mui/icons-material/Edit';
import HowToRegIcon from '@mui/icons-material/HowToReg';
import ContentCopyIcon from '@mui/icons-material/ContentCopy';
import Tooltip from '@mui/material/Tooltip';
import { PlayerCloudRegistrationDialog } from '../player-cloud-registration/PlayerCloudRegistrationDialog';
import React, { useState } from 'react';
import { useDispatch, useSelector } from 'react-redux';
import { PageHeader } from '@ezplayer/shared-ui-components';
import { Box } from '../box/Box';
import type { AppDispatch, RootState } from '../../store/Store';
import { issueCloudCommand } from '../../store/slices/CloudStatusStore';
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

/** Defensive timestamp formatter — file_time can arrive as a string (cloud serializes
 *  bigints as strings) or a number, and we want a clean blank when it's missing or
 *  unparseable instead of "Invalid Date". */
function fmtFileTime(v?: number | string | null): string {
    if (v == null || v === '') return '';
    let n = typeof v === 'number' ? v : Number(v);
    if (!Number.isFinite(n)) {
        const t = Date.parse(String(v));
        if (!Number.isFinite(t)) return '';
        n = t;
    }
    if (n === 0) return '';
    const d = new Date(n);
    if (Number.isNaN(d.getTime())) return '';
    return d.toLocaleString();
}

async function copyToClipboard(text: string): Promise<void> {
    try {
        await navigator.clipboard.writeText(text);
    } catch (e) {
        console.warn('[CloudPage] clipboard write failed:', e);
    }
}

const SequenceRow: React.FC<{
    seq: CloudSequenceProgress;
    files: CloudFileEntry[];
    showFolder?: string;
}> = ({ seq, files, showFolder }) => {
    const [open, setOpen] = useState(false);
    const status = rollUpStatus(files);
    const totalBytes = files.reduce((s, f) => s + (f.totalBytes ?? 0), 0);
    const doneBytes = files.reduce((s, f) => s + (f.bytes ?? 0), 0);
    // Per-sequence "last updated" = newest cloud file_time across the sequence's files.
    const newestFileTime = files.reduce(
        (acc, f) => (f.file_time && f.file_time > acc ? f.file_time : acc),
        0,
    );

    return (
        <>
            <TableRow hover sx={{ '& > *': { borderBottom: 'unset' } }}>
                <TableCell sx={{ width: 32 }}>
                    <IconButton size="small" onClick={() => setOpen((o) => !o)}>
                        {open ? <KeyboardArrowDownIcon /> : <KeyboardArrowRightIcon />}
                    </IconButton>
                </TableCell>
                <TableCell sx={{ wordBreak: 'break-word' }}>{describeSequence(seq)}</TableCell>
                <TableCell sx={{ whiteSpace: 'nowrap', color: 'text.secondary' }}>
                    {fmtFileTime(newestFileTime) || 'Never'}
                </TableCell>
                <TableCell>
                    <Chip label={status} color={STATUS_COLOR[status]} size="small" />
                </TableCell>
                <TableCell>{fmtBytes(totalBytes || doneBytes)}</TableCell>
            </TableRow>
            <TableRow>
                <TableCell colSpan={5} sx={{ p: 0, border: 0 }}>
                    <Collapse in={open} timeout="auto" unmountOnExit>
                        <Box sx={{ p: 2, pl: 6, bgcolor: 'background.default' }}>
                            <Table size="small">
                                <TableHead>
                                    <TableRow>
                                        <TableCell>Kind</TableCell>
                                        <TableCell>File Time</TableCell>
                                        <TableCell>Status</TableCell>
                                        <TableCell>Progress</TableCell>
                                        <TableCell>Size</TableCell>
                                        <TableCell sx={{ width: 32 }} />
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
                                        const fullPath =
                                            f.filename && showFolder
                                                ? `${showFolder}/${f.filename}`
                                                : f.filename ?? '';
                                        return (
                                            <TableRow key={f.file_id}>
                                                <TableCell>{f.kind}</TableCell>
                                                <TableCell sx={{ whiteSpace: 'nowrap', color: 'text.secondary' }}>
                                                    {fmtFileTime(f.file_time) || 'Never'}
                                                </TableCell>
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
                                                <TableCell>
                                                    {fullPath && (
                                                        <Tooltip title={`Copy: ${fullPath}`}>
                                                            <IconButton
                                                                size="small"
                                                                onClick={() => void copyToClipboard(fullPath)}
                                                            >
                                                                <ContentCopyIcon fontSize="small" />
                                                            </IconButton>
                                                        </Tooltip>
                                                    )}
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
    const showFolder = useSelector((s: RootState) => s.auth.showDirectory);

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
            await dispatch(issueCloudCommand({ type: 'syncNow' })).unwrap();
        } catch (e) {
            console.error('[CloudPage] sync now failed:', e);
        } finally {
            setSyncing(false);
        }
    };
    const layout = cStatus?.layout;
    const layoutFetching = layout?.status === 'fetching' || layout?.status === 'unpacking';
    const layoutUploading = layout?.status === 'uploading';
    const handleFetchLayout = async () => {
        try {
            await dispatch(issueCloudCommand({ type: 'fetchLayoutNow' })).unwrap();
        } catch (e) {
            console.error('[CloudPage] fetch layout failed:', e);
        }
    };
    const handleUploadLayout = async () => {
        try {
            await dispatch(issueCloudCommand({ type: 'uploadLayoutNow' })).unwrap();
        } catch (e) {
            console.error('[CloudPage] upload layout failed:', e);
        }
    };

    // Mode is the persisted layoutSource. Absent / unknown defaults to xLights —
    // matches the loader's read-side default.
    const layoutSource: 'xlights' | 'cloud' =
        cloudConfig.layoutSource === 'cloud' ? 'cloud' : 'xlights';
    const handleSetMode = (_: unknown, value: 'xlights' | 'cloud' | null) => {
        if (!value || value === layoutSource) return;
        void dispatch(issueCloudCommand({ type: 'setLayoutSource', mode: value }));
    };

    // Cloud worker active (false = retained settings, paused).
    const cloudActive = cloudConfig.cloudEnabled !== false;
    const handlePause = () =>
        void dispatch(issueCloudCommand({ type: 'setCloudEnabled', enabled: false }));
    const handleResume = () =>
        void dispatch(issueCloudCommand({ type: 'setCloudEnabled', enabled: true }));

    // Registration dialog (single instance, shared between top-card "Register" and
    // bottom-card "Edit"). Same `PlayerCloudRegistrationDialog` is the more thorough
    // panel — manual ID entry, URL editing, generate/clear.
    const [regDialogOpen, setRegDialogOpen] = useState(false);
    const isRegistered = cloudStatus.playerIdIsRegistered;
    const anyDownloading = Object.values(cStatus?.files ?? {}).some(
        (f) => f.status === 'downloading',
    );
    const totalSeq = Object.keys(cStatus?.sequences ?? {}).length;
    const installedSeq = Object.values(cStatus?.sequences ?? {}).reduce((acc, s) => {
        const files = s.fileIds.map((id) => cStatus?.files?.[id]).filter(Boolean) as CloudFileEntry[];
        return acc + (files.length > 0 && files.every((f) => f.status === 'installed') ? 1 : 0);
    }, 0);

    // -- Cascading summary line -----------------------------------------------
    let summaryLine: React.ReactNode = null;
    let activityLine: React.ReactNode = null;
    if (!cloudActive) {
        summaryLine = <Typography variant="h6">Cloud paused. Settings retained.</Typography>;
    } else if (!isRegistered) {
        summaryLine = <Typography variant="h6">Not registered.</Typography>;
    } else {
        const modeLabel =
            layoutSource === 'cloud'
                ? 'Cloud-managed: layout and sequences from cloud.'
                : 'xLights layout, cloud sequences.';
        summaryLine = <Typography variant="h6">{modeLabel}</Typography>;

        if (layoutUploading) {
            activityLine = (
                <Typography variant="body2">
                    Uploading layout
                    {layout?.totalBytes ? ` (${fmtBytes(layout.totalBytes)})` : ''}…
                </Typography>
            );
        } else if (layoutFetching) {
            activityLine = (
                <Typography variant="body2">
                    {layout?.status === 'unpacking' ? 'Unpacking layout…' : 'Pulling layout…'}
                </Typography>
            );
        } else if (anyDownloading) {
            activityLine = (
                <Typography variant="body2">
                    Downloading sequences ({installedSeq} of {totalSeq} installed)
                </Typography>
            );
        } else if (cStatus?.lastManifestAt) {
            activityLine = (
                <Typography variant="body2" color="text.secondary">
                    Up to date as of {new Date(cStatus.lastManifestAt).toLocaleTimeString()}.
                </Typography>
            );
        } else if (cloudStatus.lastCheckedAt) {
            activityLine = (
                <Typography variant="body2" color="text.secondary">
                    Last cloud contact: {new Date(cloudStatus.lastCheckedAt).toLocaleTimeString()}.
                </Typography>
            );
        }
    }

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
                {/* Top summary + state-driven actions. */}
                <Card sx={{ maxWidth: '720px', p: 4, mb: 3 }}>
                    <Stack spacing={1} sx={{ mb: 3 }}>
                        {summaryLine}
                        {activityLine}
                    </Stack>
                    {/* State 1: not registered → only "Register" matters. */}
                    {cloudActive && !isRegistered && (
                        <Stack direction="row" spacing={2} alignItems="center" flexWrap="wrap">
                            <Button
                                startIcon={<HowToRegIcon />}
                                variant="contained"
                                size="small"
                                onClick={() => setRegDialogOpen(true)}
                            >
                                Register Player
                            </Button>
                        </Stack>
                    )}
                    {/* State 2: paused → only "Resume" matters. */}
                    {!cloudActive && (
                        <Stack direction="row" spacing={2} alignItems="center" flexWrap="wrap">
                            <Button
                                startIcon={<PlayArrowIcon />}
                                variant="contained"
                                size="small"
                                onClick={handleResume}
                            >
                                Resume Cloud
                            </Button>
                        </Stack>
                    )}
                    {/* State 3: registered + active → mode toggle, Sync Now, Pause. */}
                    {cloudActive && isRegistered && (
                        <Stack direction="row" spacing={2} alignItems="center" flexWrap="wrap">
                            <ToggleButtonGroup
                                exclusive
                                size="small"
                                value={layoutSource}
                                onChange={handleSetMode}
                                sx={{
                                    '& .MuiToggleButton-root.Mui-selected': {
                                        color: 'primary.contrastText',
                                        backgroundColor: 'primary.main',
                                        '&:hover': { backgroundColor: 'primary.dark' },
                                    },
                                }}
                            >
                                <ToggleButton value="cloud">Cloud-managed</ToggleButton>
                                <ToggleButton value="xlights">xLights-managed</ToggleButton>
                            </ToggleButtonGroup>
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
                            <Button
                                startIcon={<PauseIcon />}
                                variant="outlined"
                                size="small"
                                onClick={handlePause}
                            >
                                Pause Cloud
                            </Button>
                        </Stack>
                    )}
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
                        {cloudActive && isRegistered && layoutSource === 'cloud' && (
                            <Button
                                startIcon={<DownloadIcon />}
                                variant="outlined"
                                size="small"
                                onClick={handleFetchLayout}
                                disabled={layoutFetching || layoutUploading}
                            >
                                {layoutFetching ? 'Fetching…' : 'Fetch Layout'}
                            </Button>
                        )}
                        {cloudActive && isRegistered && layoutSource === 'xlights' && (
                            <Button
                                startIcon={<UploadIcon />}
                                variant="outlined"
                                size="small"
                                onClick={handleUploadLayout}
                                disabled={layoutFetching || layoutUploading}
                            >
                                {layoutUploading ? 'Uploading…' : 'Upload Layout'}
                            </Button>
                        )}
                    </Box>
                    <Field label="Status" value={layout?.status ?? 'idle'} />
                    <Field label="Direction" value={layout?.direction ?? '(none)'} />
                    <Field label="Last Downloaded" value={formatTimestamp(layout?.lastFetchedAt)} />
                    <Field label="Last Uploaded" value={formatTimestamp(layout?.lastUploadedAt)} />
                    <Field label="Last Error" value={layout?.error ?? '(none)'} />
                    {(layoutFetching || layoutUploading) && layout?.totalBytes ? (
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
                    ) : layoutFetching || layoutUploading ? (
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
                                    <TableCell>Last Updated</TableCell>
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
                                        <SequenceRow
                                            key={seq.vseq_id}
                                            seq={seq}
                                            files={files}
                                            showFolder={showFolder}
                                        />
                                    );
                                })}
                            </TableBody>
                        </Table>
                    )}
                </Card>

                {/* Configuration last — stable reference info plus an Edit entry into
                    the same dialog the top-card "Register" uses. */}
                <Card sx={{ maxWidth: '720px', p: 4, mb: 3 }}>
                    <Box sx={{ display: 'flex', alignItems: 'center', gap: 2, mb: 2 }}>
                        <Typography variant="h6" sx={{ color: 'primary.main' }}>
                            Cloud Configuration
                        </Typography>
                        <Box sx={{ flexGrow: 1 }} />
                        <Button
                            startIcon={<EditIcon />}
                            variant="outlined"
                            size="small"
                            onClick={() => setRegDialogOpen(true)}
                        >
                            Edit
                        </Button>
                    </Box>
                    <Field label="Cloud Service URL" value={cloudConfig.cloudServiceUrl || '(not set)'} />
                    <Field label="Player ID Token" value={cloudConfig.playerIdToken || '(not set)'} />
                </Card>
            </Box>
            <PlayerCloudRegistrationDialog
                open={regDialogOpen}
                onClose={() => setRegDialogOpen(false)}
            />
        </Box>
    );
};
