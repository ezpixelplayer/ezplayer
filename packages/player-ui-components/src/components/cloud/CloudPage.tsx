import {
    Button,
    Card,
    Chip,
    Collapse,
    Dialog,
    DialogActions,
    DialogContent,
    DialogContentText,
    DialogTitle,
    IconButton,
    LinearProgress,
    Stack,
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
import UploadIcon from '@mui/icons-material/Upload';
import PauseIcon from '@mui/icons-material/Pause';
import PlayArrowIcon from '@mui/icons-material/PlayArrow';
import EditIcon from '@mui/icons-material/Edit';
import HowToRegIcon from '@mui/icons-material/HowToReg';
import ContentCopyIcon from '@mui/icons-material/ContentCopy';
import CheckCircleIcon from '@mui/icons-material/CheckCircle';
import HelpOutlineIcon from '@mui/icons-material/HelpOutline';
import PauseCircleIcon from '@mui/icons-material/PauseCircle';
import LinkOffIcon from '@mui/icons-material/LinkOff';
import SwapHorizIcon from '@mui/icons-material/SwapHoriz';
import Tooltip from '@mui/material/Tooltip';
import { PlayerCloudRegistrationDialog } from '../player-cloud-registration/PlayerCloudRegistrationDialog';
import React, { useState } from 'react';
import { useDispatch, useSelector } from 'react-redux';
import { PageHeader } from '@ezplayer/shared-ui-components';
import { Box } from '../box/Box';
import type { AppDispatch, RootState } from '../../store/Store';
import { issueCloudCommand } from '../../store/slices/CloudStatusStore';
import { postSetPlayerIdToken } from '../../store/slices/AuthStore';
import type { CloudFileEntry, CloudFileStatus, CloudSequenceProgress } from '@ezplayer/ezplayer-core';

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

const STATUS_COLOR: Record<RolledUpStatus | CloudFileStatus, 'default' | 'info' | 'warning' | 'success' | 'error'> = {
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
    const newestFileTime = files.reduce((acc, f) => (f.file_time && f.file_time > acc ? f.file_time : acc), 0);

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
                                                ? Math.min(100, ((f.bytes ?? 0) / f.totalBytes) * 100)
                                                : undefined;
                                        const fullPath =
                                            f.filename && showFolder
                                                ? `${showFolder}/${f.filename}`
                                                : (f.filename ?? '');
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
                                                                <LinearProgress variant="determinate" value={pct} />
                                                                <Typography variant="caption">
                                                                    {pct.toFixed(0)}%
                                                                </Typography>
                                                            </Box>
                                                        ) : (
                                                            <LinearProgress />
                                                        )
                                                    ) : null}
                                                </TableCell>
                                                <TableCell>{fmtBytes(f.totalBytes ?? f.bytes)}</TableCell>
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
    const cStatus = useSelector((s: RootState) => s.runtime.combined.content);
    const showFolder = useSelector((s: RootState) => s.auth.showDirectory);

    // Reachability is derived from the last poll: a clean reply means we reached the cloud,
    // an error means we didn't, no checks yet means we don't know.
    const reachableLabel = cloudStatus.lastCheckedAt === undefined ? '(unknown)' : cloudStatus.lastError ? 'no' : 'yes';

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
    const layoutSource: 'xlights' | 'cloud' = cloudConfig.layoutSource === 'cloud' ? 'cloud' : 'xlights';

    // Cloud worker active (false = retained settings, paused).
    const cloudActive = cloudConfig.cloudEnabled !== false;
    const handlePause = () => void dispatch(issueCloudCommand({ type: 'setCloudEnabled', enabled: false }));
    const handleResume = () => void dispatch(issueCloudCommand({ type: 'setCloudEnabled', enabled: true }));

    // Registration dialog (single instance, shared between top-card "Register" and
    // bottom-card "Edit"). Same `PlayerCloudRegistrationDialog` is the more thorough
    // panel — manual ID entry, URL editing, generate/clear.
    const [regDialogOpen, setRegDialogOpen] = useState(false);
    const [disconnectOpen, setDisconnectOpen] = useState(false);

    // Cloud-master "sync now" pulls layout AND content. xLights-master has the
    // user push the layout explicitly via the "Push Layout" button.
    const handleSyncCloudMaster = async () => {
        setSyncing(true);
        try {
            await dispatch(issueCloudCommand({ type: 'fetchLayoutNow' })).unwrap();
            await dispatch(issueCloudCommand({ type: 'syncNow' })).unwrap();
        } catch (e) {
            console.error('[CloudPage] sync (cloud-master) failed:', e);
        } finally {
            setSyncing(false);
        }
    };

    // Disconnect = clear the player ID token. Cloud URL is retained so re-registering
    // is a one-click affair. The cloud server will eventually deregister the player.
    const handleDisconnect = async () => {
        try {
            await dispatch(postSetPlayerIdToken({ playerIdToken: '' })).unwrap();
        } catch (e) {
            console.error('[CloudPage] disconnect failed:', e);
        } finally {
            setDisconnectOpen(false);
        }
    };

    const isRegistered = cloudStatus.playerIdIsRegistered;
    const anyDownloading = Object.values(cStatus?.files ?? {}).some((f) => f.status === 'downloading');
    const totalSeq = Object.keys(cStatus?.sequences ?? {}).length;
    const installedSeq = Object.values(cStatus?.sequences ?? {}).reduce((acc, s) => {
        const files = s.fileIds.map((id) => cStatus?.files?.[id]).filter(Boolean) as CloudFileEntry[];
        return acc + (files.length > 0 && files.every((f) => f.status === 'installed') ? 1 : 0);
    }, 0);

    // -- Top-card mode + status ---------------------------------------------
    // Four mutually exclusive modes drive the icon, headline, mode chip,
    // description, and which action buttons appear.
    //
    // `paused` is checked BEFORE `!isRegistered`: the cloud worker's
    // reconfigure-on-pause path resets in-memory `playerIdIsRegistered` to
    // false (the worker can't distinguish "paused" from "disconnected" from
    // its arg list — both arrive as empty url/token). The persisted token in
    // cloudConfig is what tells us we're really still registered.
    type TopMode = 'unregistered' | 'paused' | 'xlights-master' | 'cloud-master';
    const topMode: TopMode = !cloudActive
        ? 'paused'
        : !isRegistered
          ? 'unregistered'
          : layoutSource === 'cloud'
            ? 'cloud-master'
            : 'xlights-master';

    const statusIcon =
        topMode === 'unregistered' ? (
            <HelpOutlineIcon color="disabled" sx={{ fontSize: 36 }} />
        ) : topMode === 'paused' ? (
            <PauseCircleIcon color="warning" sx={{ fontSize: 36 }} />
        ) : (
            <CheckCircleIcon color="success" sx={{ fontSize: 36 }} />
        );

    const statusHeadline =
        topMode === 'unregistered'
            ? 'Not connected to cloud'
            : topMode === 'paused'
              ? 'Cloud paused'
              : 'Cloud connected';

    const modeChipLabel =
        topMode === 'xlights-master' || (topMode === 'paused' && layoutSource === 'xlights')
            ? 'xLights master'
            : topMode === 'cloud-master' || (topMode === 'paused' && layoutSource === 'cloud')
              ? 'Cloud master'
              : null;

    const modeDescription =
        topMode === 'unregistered'
            ? 'Connect this player to your EZRGB account to sync layout and sequences.'
            : topMode === 'paused'
              ? 'The cloud worker is paused. Settings are retained — resume to reconnect.'
              : topMode === 'cloud-master'
                ? 'Cloud is the source of truth for both layout and sequences. Local edits will be overwritten by cloud syncs.'
                : 'Your xLights show folder is the source of truth for the layout. Sequences are managed via cloud.';

    // Activity / freshness line shown below the headline.
    let activityLine: React.ReactNode = null;
    if (topMode === 'cloud-master' || topMode === 'xlights-master') {
        if (layoutUploading) {
            activityLine = (
                <Typography variant="body2">
                    Pushing layout
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
                    {/* Status row: green check / pause / help icon + headline + mode chip */}
                    <Box sx={{ display: 'flex', alignItems: 'center', gap: 2, mb: 1 }}>
                        {statusIcon}
                        <Typography variant="h6">{statusHeadline}</Typography>
                        {modeChipLabel && (
                            <Chip
                                label={modeChipLabel}
                                size="small"
                                color={topMode === 'paused' ? 'default' : 'primary'}
                                variant={topMode === 'paused' ? 'outlined' : 'filled'}
                            />
                        )}
                    </Box>

                    {activityLine && <Box sx={{ mb: 1 }}>{activityLine}</Box>}

                    <Typography variant="body2" color="text.secondary" sx={{ mb: 3 }}>
                        {modeDescription}
                    </Typography>

                    {/* Mode 1: not registered → just Register. */}
                    {topMode === 'unregistered' && (
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

                    {/* Mode 2: paused → Resume + Disconnect (mode flip while paused
                        is intentionally hidden — resume first, then change). */}
                    {topMode === 'paused' && (
                        <Stack direction="row" spacing={1.5} alignItems="center" flexWrap="wrap">
                            <Button
                                startIcon={<PlayArrowIcon />}
                                variant="contained"
                                size="small"
                                onClick={handleResume}
                            >
                                Resume Cloud
                            </Button>
                            <Button
                                startIcon={<LinkOffIcon />}
                                variant="outlined"
                                size="small"
                                color="error"
                                onClick={() => setDisconnectOpen(true)}
                            >
                                Disconnect
                            </Button>
                        </Stack>
                    )}

                    {/* Mode 3: xLights master. */}
                    {topMode === 'xlights-master' && (
                        <>
                            <Stack direction="row" spacing={1.5} alignItems="center" flexWrap="wrap" sx={{ mb: 1.5 }}>
                                <Button
                                    startIcon={<SyncIcon />}
                                    variant="contained"
                                    size="small"
                                    onClick={handleSync}
                                    disabled={syncing}
                                >
                                    {syncing ? 'Syncing…' : 'Sync Content Now'}
                                </Button>
                                <Tooltip title="Push layout to cloud">
                                    <span>
                                        <Button
                                            startIcon={<UploadIcon />}
                                            variant="outlined"
                                            size="small"
                                            onClick={handleUploadLayout}
                                            disabled={layoutFetching || layoutUploading}
                                        >
                                            {layoutUploading ? 'Pushing Layout…' : 'Push Layout'}
                                        </Button>
                                    </span>
                                </Tooltip>
                                <Button startIcon={<PauseIcon />} variant="outlined" size="small" onClick={handlePause}>
                                    Pause
                                </Button>
                            </Stack>
                            <Stack direction="row" spacing={1.5} alignItems="center" flexWrap="wrap">
                                <Button
                                    startIcon={<SwapHorizIcon />}
                                    variant="text"
                                    size="small"
                                    onClick={() =>
                                        dispatch(issueCloudCommand({ type: 'setLayoutSource', mode: 'cloud' }))
                                    }
                                >
                                    Switch to Cloud-managed
                                </Button>
                                <Button
                                    startIcon={<LinkOffIcon />}
                                    variant="text"
                                    size="small"
                                    color="error"
                                    onClick={() => setDisconnectOpen(true)}
                                >
                                    Disconnect
                                </Button>
                            </Stack>
                        </>
                    )}

                    {/* Mode 4: cloud master. */}
                    {topMode === 'cloud-master' && (
                        <>
                            <Stack direction="row" spacing={1.5} alignItems="center" flexWrap="wrap" sx={{ mb: 1.5 }}>
                                <Button
                                    startIcon={<SyncIcon />}
                                    variant="contained"
                                    size="small"
                                    onClick={handleSyncCloudMaster}
                                    disabled={syncing || layoutFetching || layoutUploading}
                                >
                                    {syncing || layoutFetching ? 'Syncing…' : 'Sync Layout + Content'}
                                </Button>
                                <Button startIcon={<PauseIcon />} variant="outlined" size="small" onClick={handlePause}>
                                    Pause
                                </Button>
                            </Stack>
                            <Stack direction="row" spacing={1.5} alignItems="center" flexWrap="wrap">
                                <Button
                                    startIcon={<SwapHorizIcon />}
                                    variant="text"
                                    size="small"
                                    onClick={() =>
                                        dispatch(issueCloudCommand({ type: 'setLayoutSource', mode: 'xlights' }))
                                    }
                                >
                                    Switch to xLights-managed
                                </Button>
                                <Button
                                    startIcon={<LinkOffIcon />}
                                    variant="text"
                                    size="small"
                                    color="error"
                                    onClick={() => setDisconnectOpen(true)}
                                >
                                    Disconnect
                                </Button>
                            </Stack>
                        </>
                    )}
                </Card>

                <Card sx={{ maxWidth: '720px', p: 4, mb: 3 }}>
                    <Typography variant="h6" sx={{ mb: 2, color: 'primary.main' }}>
                        Cloud Status
                    </Typography>
                    <Field label="Cloud Reachable" value={reachableLabel} />
                    <Field label="Player Registered" value={cloudStatus.playerIdIsRegistered ? 'yes' : 'no'} />
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
                            <Tooltip title="Push layout to cloud">
                                <span>
                                    <Button
                                        startIcon={<UploadIcon />}
                                        variant="outlined"
                                        size="small"
                                        onClick={handleUploadLayout}
                                        disabled={layoutFetching || layoutUploading}
                                    >
                                        {layoutUploading ? 'Pushing…' : 'Push Layout'}
                                    </Button>
                                </span>
                            </Tooltip>
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
                                value={Math.min(100, ((layout.bytes ?? 0) / layout.totalBytes) * 100)}
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
                        {cStatus?.halted && <Chip label="halted" color="error" size="small" />}
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
            <PlayerCloudRegistrationDialog open={regDialogOpen} onClose={() => setRegDialogOpen(false)} />
            <Dialog open={disconnectOpen} onClose={() => setDisconnectOpen(false)}>
                <DialogTitle>Disconnect from cloud?</DialogTitle>
                <DialogContent>
                    <DialogContentText>
                        This clears the Player ID token. The cloud server will eventually deregister this player. Your
                        show folder and Cloud URL are retained — re-registering is one click on the Welcome / Register
                        screen.
                    </DialogContentText>
                </DialogContent>
                <DialogActions>
                    <Button onClick={() => setDisconnectOpen(false)}>Cancel</Button>
                    <Button color="error" variant="contained" onClick={handleDisconnect}>
                        Disconnect
                    </Button>
                </DialogActions>
            </Dialog>
        </Box>
    );
};
