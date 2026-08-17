import React, { useEffect, useRef, useState } from 'react';
import { useDispatch, useSelector } from 'react-redux';
import {
    Box as MuiBox,
    Button,
    Card,
    Checkbox,
    Chip,
    Collapse,
    Dialog,
    DialogActions,
    DialogContent,
    DialogTitle,
    FormControlLabel,
    IconButton,
    LinearProgress,
    ListItemIcon,
    ListItemText,
    Menu,
    MenuItem,
    Stack,
    Table,
    TableBody,
    TableCell,
    TableHead,
    TableRow,
    TableSortLabel,
    TextField,
    ToggleButton,
    ToggleButtonGroup,
    Typography,
} from '@mui/material';
import KeyboardArrowDownIcon from '@mui/icons-material/KeyboardArrowDown';
import KeyboardArrowRightIcon from '@mui/icons-material/KeyboardArrowRight';
import RefreshIcon from '@mui/icons-material/Refresh';
import RadarIcon from '@mui/icons-material/Radar';
import RestartAltIcon from '@mui/icons-material/RestartAlt';
import StopIcon from '@mui/icons-material/Stop';
import OpenInNewIcon from '@mui/icons-material/OpenInNew';
import WarningAmberIcon from '@mui/icons-material/WarningAmber';
import SyncProblemIcon from '@mui/icons-material/SyncProblem';
import FiberManualRecordIcon from '@mui/icons-material/FiberManualRecord';
import MoreVertIcon from '@mui/icons-material/MoreVert';
import EditIcon from '@mui/icons-material/Edit';
import DeleteOutlineIcon from '@mui/icons-material/DeleteOutline';
import PublishIcon from '@mui/icons-material/Publish';
import PowerSettingsNewIcon from '@mui/icons-material/PowerSettingsNew';
import AddIcon from '@mui/icons-material/Add';
import CompareArrowsIcon from '@mui/icons-material/CompareArrows';
import AccountTreeIcon from '@mui/icons-material/AccountTree';
import CheckCircleOutlineIcon from '@mui/icons-material/CheckCircleOutline';
import { PageHeader } from '@ezplayer/shared-ui-components';
import { Box } from '../box/Box';
import { CompactDialog } from '../dialog/CompactDialog';
import { PortVisualizerDialog } from './PortVisualizerDialog';
import type { AppDispatch, RootState } from '../../store/Store';
import { issueControllerCommand } from '../../store/slices/ControllerOpsStore';
import { useFrameServerUrl } from '../../hooks/useFrameServerUrl';
import {
    reconcileControllers,
    reconcilePorts,
    hasPortDrift,
    reconcileInputs,
    overlayHealth,
} from '@ezplayer/ezplayer-core';
import type {
    ControllerCommand,
    ControllerDetailNode,
    ControllerDeviceAction,
    ControllerGridRow,
    ControllerHealth,
    ControllerOp,
    ControllerRecordState,
    DiscoveredController,
    EzpControllerRecordPatch,
    PortReconcile,
    PortDriftKind,
} from '@ezplayer/ezplayer-core';

type Depth = 'sweep' | 'identify' | 'full';
type SortKey = 'state' | 'name' | 'ip' | 'type';

/** Sort order for the State column: what you're most likely acting on first. */
const STATE_RANK: Record<ControllerRecordState, number> = { present: 0, unregistered: 1, absent: 2 };

const ipKey = (ip: string): number => ip.split('.').reduce((acc, o) => acc * 256 + (Number(o) || 0), 0);
const sourceRank = (d: DiscoveredController): number => (d.source.via === 'direct' ? 0 : 1);

function provenance(d: DiscoveredController): string {
    if (d.source.via === 'fpp-proxy') return `via ${d.source.proxy}`;
    if (d.source.via === 'ezp') return `via ezp ${d.source.host}`;
    return '';
}

/** Electron renderer — runs on the player, so it reaches controllers directly. */
const isDesktop = (): boolean => typeof window !== 'undefined' && !!window.electronAPI;

/** URL to the controller's own web UI. Desktop goes direct; web/cloud routes
 *  through the player's `/proxy/<ip>/` bridge; ezp-federated devices have no link. */
function controllerUrl(d: DiscoveredController, serverBase: string | undefined): string | undefined {
    if (isDesktop()) {
        if (d.source.via === 'direct') return `http://${d.ip}/`;
        if (d.source.via === 'fpp-proxy') return `http://${d.source.proxy}/proxy/${d.ip}/`;
        return undefined;
    }
    if (!serverBase) return undefined;
    const base = serverBase.replace(/\/$/, '');
    if (d.source.via === 'fpp-proxy') return `${base}/proxy/${d.source.proxy}/proxy/${d.ip}/`;
    if (d.source.via === 'ezp') return undefined;
    return `${base}/proxy/${d.ip}/`;
}

/** URL for a known record's address when no scanned device backs the row. */
function addressUrl(address: string, serverBase: string | undefined): string | undefined {
    if (!address) return undefined;
    if (isDesktop()) return `http://${address}/`;
    if (!serverBase) return undefined;
    return `${serverBase.replace(/\/$/, '')}/proxy/${address}/`;
}

function openUrl(url: string): void {
    if (window.electronAPI?.openExternal) window.electronAPI.openExternal(url);
    else window.open(url, '_blank', 'noopener,noreferrer');
}

/** One row action, rendered as a kebab menu item. */
interface RowAction {
    key: string;
    label: string;
    icon: React.ReactNode;
    onClick: () => void;
    color?: 'warning' | 'error';
    disabled?: boolean;
    /** Hover text, for actions whose consequences aren't obvious. */
    title?: string;
}

/** Renders any driver's detail tree. */
const DetailTree: React.FC<{ nodes: ControllerDetailNode[]; depth?: number }> = ({ nodes, depth = 0 }) => (
    <MuiBox component="ul" sx={{ listStyle: 'none', pl: depth ? 2 : 0, m: 0 }}>
        {nodes.map((n, i) => (
            <MuiBox component="li" key={`${n.label}-${i}`} sx={{ py: 0.25 }}>
                <Typography variant="body2" component="span" sx={{ color: 'text.secondary' }}>
                    {n.label}
                </Typography>
                {n.value !== undefined && n.value !== '' && (
                    <Typography variant="body2" component="span" sx={{ ml: 1, fontFamily: 'monospace' }}>
                        {String(n.value)}
                    </Typography>
                )}
                {n.children?.length ? <DetailTree nodes={n.children} depth={depth + 1} /> : null}
            </MuiBox>
        ))}
    </MuiBox>
);

/** Canonical section order for the detail fold-out. */
const SECTION_ORDER = ['Basic', 'Operational', 'Show stats', 'Models & Ports', 'Errors', 'Other'];

/** Label → section fallback for detail trees without `kind: 'section'`. */
const LABEL_SECTION: Record<string, string> = {
    Vendor: 'Basic',
    Model: 'Basic',
    Driver: 'Basic',
    Firmware: 'Basic',
    'Firmware available': 'Basic',
    Hostname: 'Basic',
    IP: 'Basic',
    Mode: 'Operational',
    Operation: 'Operational',
    'Uptime (s)': 'Operational',
    Uptime: 'Operational',
    CPU: 'Operational',
    Temperature: 'Operational',
    Voltage: 'Operational',
    Memory: 'Operational',
    Fans: 'Operational',
    Storage: 'Operational',
    Network: 'Show stats',
    Streaming: 'Show stats',
    Boards: 'Models & Ports',
    'Pixel Ports': 'Models & Ports',
    Models: 'Models & Ports',
    Errors: 'Errors',
};

/** Group a detail tree into canonically ordered top-level sections. */
function toSections(nodes: ControllerDetailNode[]): ControllerDetailNode[] {
    const out: ControllerDetailNode[] = [];
    const buckets = new Map<string, ControllerDetailNode>();
    for (const n of nodes) {
        if (n.kind === 'section') {
            out.push(n);
            continue;
        }
        const name = LABEL_SECTION[n.label] ?? 'Other';
        let sec = buckets.get(name);
        if (!sec) {
            sec = { label: name, icon: name === 'Errors' ? 'error' : 'group', kind: 'section', children: [] };
            buckets.set(name, sec);
            out.push(sec);
        }
        sec.children!.push(n);
    }
    const rank = (s: ControllerDetailNode) => {
        const i = SECTION_ORDER.indexOf(s.label);
        return i === -1 ? SECTION_ORDER.length : i;
    };
    return out.sort((a, b) => rank(a) - rank(b));
}

/** One collapsible detail section; Basic and Errors start open. */
const DetailSection: React.FC<{ node: ControllerDetailNode }> = ({ node }) => {
    const [open, setOpen] = useState(node.label === 'Basic' || node.icon === 'error');
    const count = node.children?.length ?? 0;
    return (
        <Box sx={{ mb: 0.25 }}>
            <Box
                onClick={() => setOpen((o) => !o)}
                sx={{ display: 'flex', alignItems: 'center', cursor: 'pointer', userSelect: 'none', py: 0.25 }}
            >
                {open ? <KeyboardArrowDownIcon fontSize="small" /> : <KeyboardArrowRightIcon fontSize="small" />}
                <Typography variant="subtitle2" sx={{ color: node.icon === 'error' ? 'error.main' : undefined }}>
                    {node.label}
                </Typography>
                {!open && (
                    <Typography variant="caption" sx={{ ml: 1, color: 'text.secondary' }}>
                        {node.value !== undefined && node.value !== ''
                            ? String(node.value)
                            : `${count} item${count === 1 ? '' : 's'}`}
                    </Typography>
                )}
            </Box>
            <Collapse in={open} timeout="auto" unmountOnExit>
                <Box sx={{ pl: 3 }}>
                    <DetailTree nodes={node.children ?? []} />
                </Box>
            </Collapse>
        </Box>
    );
};

const DetailSections: React.FC<{ nodes: ControllerDetailNode[] }> = ({ nodes }) => (
    <Box>
        {toSections(nodes).map((s, i) => (
            <DetailSection key={`${s.label}-${i}`} node={s} />
        ))}
    </Box>
);

const STATE_META: Record<ControllerRecordState, { label: string; color: 'success' | 'default' | 'warning' }> = {
    present: { label: 'Present', color: 'success' },
    absent: { label: 'Absent', color: 'default' },
    unregistered: { label: 'Unregistered', color: 'warning' },
};

/** Live ping connectivity → dot color (theme tokens). */
const CONN_COLOR: Record<NonNullable<ControllerHealth['connectivity']>, string> = {
    Up: 'success.main',
    Down: 'error.main',
    Pending: 'warning.main',
    'N/A': 'text.disabled',
};

const PORT_DRIFT_LABEL: Record<PortDriftKind, string> = {
    ok: 'in sync',
    missing: 'not on controller',
    unexpected: 'not in xLights',
    count: 'count differs',
};

/** One model name per line; names in `flagged` render amber. `labels` is the
 *  optional annotated display form parallel to `names` ("Tree [2/4]"). */
const PortModelList: React.FC<{ names: string[]; labels?: string[]; flagged?: string[]; flagTitle: string }> = ({
    names,
    labels,
    flagged,
    flagTitle,
}) => {
    const flaggedSet = new Set((flagged ?? []).map((m) => m.toLowerCase()));
    return (
        <>
            {names.map((name, i) => {
                const isFlagged = flaggedSet.has(name.toLowerCase());
                return (
                    <Typography
                        key={`${name}-${i}`}
                        variant="body2"
                        title={isFlagged ? flagTitle : undefined}
                        sx={{ lineHeight: 1.4, color: isFlagged ? 'warning.main' : undefined }}
                    >
                        {labels?.[i] ?? name}
                    </Typography>
                );
            })}
        </>
    );
};

/** Per-port xLights-intent vs. controller-actual. */
const PortReconcileTable: React.FC<{ rows: PortReconcile[] }> = ({ rows }) => (
    <Table size="small">
        <TableHead>
            <TableRow>
                <TableCell>Port</TableCell>
                <TableCell>xLights (intended)</TableCell>
                <TableCell>Controller (actual)</TableCell>
                <TableCell>Status</TableCell>
            </TableRow>
        </TableHead>
        <TableBody>
            {rows.map((r) => (
                <TableRow key={r.port}>
                    <TableCell
                        sx={{
                            borderLeft: '3px solid',
                            borderLeftColor: r.drift !== 'ok' ? 'warning.main' : 'transparent',
                        }}
                    >
                        {r.port}
                    </TableCell>
                    <TableCell>
                        {r.intendedModels.length ? (
                            <>
                                <PortModelList
                                    names={r.intendedModels}
                                    labels={r.intendedModelLabels}
                                    flagged={r.missingModels}
                                    flagTitle="not on controller"
                                />
                                <Typography variant="caption" sx={{ color: 'text.secondary' }}>
                                    {r.intendedPixels ?? 0} px
                                </Typography>
                            </>
                        ) : (
                            '—'
                        )}
                    </TableCell>
                    <TableCell>
                        {r.actualPixels !== undefined ? (
                            <>
                                {(r.actualModels?.length ?? 0) > 0 && (
                                    <PortModelList
                                        names={r.actualModels!}
                                        flagged={r.extraModels}
                                        flagTitle="not in xLights"
                                    />
                                )}
                                <Typography variant="caption" sx={{ color: 'text.secondary' }}>
                                    {r.actualPixels} px
                                </Typography>
                            </>
                        ) : (
                            '—'
                        )}
                    </TableCell>
                    <TableCell>
                        <Chip
                            size="small"
                            color={r.drift === 'ok' ? 'success' : 'warning'}
                            variant={r.drift === 'ok' ? 'outlined' : 'filled'}
                            label={PORT_DRIFT_LABEL[r.drift]}
                        />
                    </TableCell>
                </TableRow>
            ))}
        </TableBody>
    </Table>
);

/** One grid row: a known record (present/absent) or a scan-only ghost (unregistered). */
const GridRow: React.FC<{
    row: ControllerGridRow;
    busy: boolean;
    serverBase: string | undefined;
    onStatus: (id: string, address?: string) => void;
    onAction: (id: string, action: ControllerDeviceAction) => void;
    onUpload: (id: string, fullControl: boolean) => void;
    onActivate: (name: string, active: boolean) => void;
    onEdit: (row: ControllerGridRow) => void;
    onPromote: (row: ControllerGridRow) => void;
    onDelete: (name: string) => void;
}> = ({ row, busy, serverBase, onStatus, onAction, onUpload, onActivate, onEdit, onPromote, onDelete }) => {
    const [open, setOpen] = useState(false);
    const [menuAnchor, setMenuAnchor] = useState<HTMLElement | null>(null);
    const [portDialog, setPortDialog] = useState<'compare' | 'map' | null>(null);
    const [uploadOpen, setUploadOpen] = useState(false);
    const d = row.device;
    const meta = STATE_META[row.state];
    const ghost = row.state === 'unregistered';
    const known = !ghost && !!row.name;
    const hasDetail = !!d?.detail?.length;
    // Drift is only meaningful once the device's port config has actually been
    // read (depth=full); before that every intended port would read "missing".
    const portsRead = d?.pixelPorts !== undefined;
    const portRows = reconcilePorts(row.intent ?? [], d?.pixelPorts ?? []);
    const portDrift = portsRead && hasPortDrift(portRows);
    // Same gating for the data-input side (protocol / universe map / DDP window).
    const inputsRead = d?.inputs !== undefined;
    const inputRec = reconcileInputs(row.outputs, d?.inputs);
    const inputDrift = inputsRead && inputRec.drift;
    const anyDrift = portDrift || inputDrift;
    // Port knowledge on either side is enough for the port-map visualizer.
    const hasPortData = portRows.length > 0 || (row.modelIntents?.length ?? 0) > 0 || (d?.pixelPorts?.length ?? 0) > 0;
    const hasInputData = (row.outputs?.length ?? 0) > 0 || inputsRead;
    const health = row.health;
    const hasHealthDetail = !!(
        health &&
        (health.pingSummary || health.errors?.length || health.notices?.length || health.status)
    );
    const expandable = hasDetail || hasPortData || hasInputData || hasHealthDetail;
    // Fall back to the record's address so an unscanned row still gets Open.
    const url = (d ? controllerUrl(d, serverBase) : undefined) ?? addressUrl(row.address ?? '', serverBase);
    const canReboot = !!d?.driverType && d.driverType !== 'EZPlayer';
    const ip = d?.ip ?? row.address;
    const typeLabel = [d?.vendor ?? row.vendor, d?.model ?? row.model].filter(Boolean).join(' ') || d?.driverType;
    const via = d ? provenance(d) : '';

    // Ordered most- to least-reached-for; the kebab menu and the expansion's
    // button row share this list.
    const actions: RowAction[] = [];
    if (hasPortData)
        actions.push({
            key: 'portmap',
            label: 'Port map',
            icon: <AccountTreeIcon fontSize="small" />,
            onClick: () => setPortDialog('map'),
        });
    // Status reads target a device id, or "<addr>|direct" for unscanned records.
    const statusId = d?.id ?? (row.address ? `${row.address}|direct` : undefined);
    if (statusId)
        actions.push({
            key: 'refresh',
            label: 'Refresh Details',
            icon: <RefreshIcon fontSize="small" />,
            onClick: () => onStatus(statusId, d ? undefined : row.address),
            disabled: busy,
        });
    if (url)
        actions.push({
            key: 'open',
            label: 'Open',
            icon: <OpenInNewIcon fontSize="small" />,
            onClick: () => openUrl(url),
        });
    // Driver-enumerated actions, or reboot-only fallback when no deep read has run.
    const deviceActions: ControllerDeviceAction[] =
        d?.actions ?? (canReboot && d ? [{ id: 'reboot', label: 'Reboot', dangerous: true }] : []);
    if (d)
        for (const da of deviceActions)
            actions.push({
                key: `act-${da.id}`,
                label: da.label,
                icon: <RestartAltIcon fontSize="small" />,
                color: da.dangerous ? 'warning' : undefined,
                onClick: () => onAction(d.id, da),
                disabled: busy,
            });
    // Upload needs a live identified non-player device plus xLights intent.
    if (known && d?.driverType && d.driverType !== 'EZPlayer' && (row.intent?.length ?? 0) > 0) {
        actions.push({
            key: 'upload',
            label: 'Upload config…',
            icon: <PublishIcon fontSize="small" />,
            color: 'warning',
            onClick: () => setUploadOpen(true),
            disabled: busy,
        });
    }
    if (known) {
        const enable = row.active === false;
        actions.push({
            key: 'active',
            label: enable ? 'Enable' : 'Disable',
            icon: <PowerSettingsNewIcon fontSize="small" />,
            onClick: () => onActivate(row.name!, enable),
        });
        actions.push({
            key: 'edit',
            label: 'Edit record',
            icon: <EditIcon fontSize="small" />,
            onClick: () => onEdit(row),
        });
        actions.push({
            key: 'delete',
            label: 'Delete record',
            icon: <DeleteOutlineIcon fontSize="small" />,
            color: 'error',
            onClick: () => onDelete(row.name!),
        });
    }
    if (ghost)
        actions.push({
            key: 'promote',
            label: 'Promote…',
            icon: <PublishIcon fontSize="small" />,
            onClick: () => onPromote(row),
        });

    const runAction = (a: RowAction) => {
        setMenuAnchor(null);
        a.onClick();
    };

    return (
        <>
            <TableRow hover sx={{ '& > *': { borderBottom: 'unset' } }}>
                {/* Left accent bar marks unregistered ghosts. */}
                <TableCell
                    sx={{ width: 32, borderLeft: '3px solid', borderLeftColor: ghost ? 'warning.main' : 'transparent' }}
                >
                    {expandable && (
                        <IconButton size="small" onClick={() => setOpen((o) => !o)}>
                            {open ? <KeyboardArrowDownIcon /> : <KeyboardArrowRightIcon />}
                        </IconButton>
                    )}
                </TableCell>
                <TableCell sx={{ whiteSpace: 'nowrap' }}>
                    {/* Dot always renders (alignment); gray = no ping data. */}
                    <FiberManualRecordIcon
                        titleAccess={
                            health?.connectivity
                                ? `ping ${health.connectivity}${health.pingSummary ? ` — ${health.pingSummary}` : ''}`
                                : 'no ping data'
                        }
                        sx={{
                            mr: 0.5,
                            verticalAlign: 'middle',
                            fontSize: 12,
                            color: health?.connectivity ? CONN_COLOR[health.connectivity] : 'text.disabled',
                        }}
                    />
                    <Chip size="small" color={meta.color} label={meta.label} variant={ghost ? 'filled' : 'outlined'} />
                    {anyDrift && (
                        <IconButton
                            size="small"
                            onClick={() => setPortDialog('compare')}
                            title={`${[portDrift && 'ports', inputDrift && 'input config'].filter(Boolean).join(' and ')} differ from xLights — reconfiguration needed (click to compare)`}
                            sx={{ ml: 0.25, p: 0.25, verticalAlign: 'middle' }}
                        >
                            <SyncProblemIcon color="warning" fontSize="small" />
                        </IconButton>
                    )}
                </TableCell>
                <TableCell sx={{ wordBreak: 'break-word' }}>
                    {row.name ? (
                        row.name
                    ) : (
                        <Typography
                            component="span"
                            variant="body2"
                            sx={{ fontStyle: 'italic', color: 'text.secondary' }}
                        >
                            {d?.hostname ?? 'unregistered'}
                        </Typography>
                    )}
                    {known &&
                        (() => {
                            const es = row.enableState ?? (row.active === false ? 'disabled' : 'enabled');
                            const meta: Record<string, { label: string; color: 'success' | 'default' | 'info' }> = {
                                enabled: { label: 'enabled', color: 'success' },
                                disabled: { label: 'disabled', color: 'default' },
                                xlightsOnly: { label: 'xLights only', color: 'info' },
                            };
                            const m = meta[es];
                            return (
                                <Chip
                                    size="small"
                                    variant="outlined"
                                    color={m.color}
                                    label={m.label}
                                    title={
                                        es === 'xlightsOnly'
                                            ? 'Defined for xLights’ own use; players don’t output to it'
                                            : undefined
                                    }
                                    sx={{ ml: 1, opacity: es === 'enabled' ? 0.8 : 1 }}
                                />
                            );
                        })()}
                </TableCell>
                <TableCell sx={{ fontFamily: 'monospace', whiteSpace: 'nowrap' }}>
                    {ip ?? '—'}
                    {via && (
                        <Typography
                            variant="caption"
                            sx={{ display: 'block', color: 'text.secondary', fontFamily: 'inherit' }}
                        >
                            {via}
                        </Typography>
                    )}
                </TableCell>
                <TableCell sx={{ whiteSpace: 'nowrap' }}>
                    {typeLabel ?? '—'}
                    {d?.error && (
                        <WarningAmberIcon
                            color="warning"
                            fontSize="small"
                            titleAccess={d.error}
                            sx={{ ml: 0.5, verticalAlign: 'middle' }}
                        />
                    )}
                </TableCell>
                <TableCell sx={{ whiteSpace: 'nowrap', textAlign: 'right' }}>
                    {actions.length > 0 && (
                        <>
                            <IconButton
                                size="small"
                                aria-label="actions"
                                onClick={(e) => setMenuAnchor(e.currentTarget)}
                            >
                                <MoreVertIcon fontSize="small" />
                            </IconButton>
                            <Menu
                                anchorEl={menuAnchor}
                                open={!!menuAnchor}
                                onClose={() => setMenuAnchor(null)}
                                // Right-anchored: the kebab sits in the right-most column.
                                anchorOrigin={{ vertical: 'bottom', horizontal: 'right' }}
                                transformOrigin={{ vertical: 'top', horizontal: 'right' }}
                            >
                                {actions.map((a) => (
                                    <MenuItem
                                        key={a.key}
                                        onClick={() => runAction(a)}
                                        disabled={a.disabled}
                                        title={a.title}
                                    >
                                        <ListItemIcon sx={{ color: a.color ? `${a.color}.main` : undefined }}>
                                            {a.icon}
                                        </ListItemIcon>
                                        <ListItemText
                                            primaryTypographyProps={{ color: a.color ? `${a.color}.main` : undefined }}
                                        >
                                            {a.label}
                                        </ListItemText>
                                    </MenuItem>
                                ))}
                            </Menu>
                        </>
                    )}
                </TableCell>
            </TableRow>
            {expandable && (
                <TableRow>
                    <TableCell colSpan={6} sx={{ p: 0, border: 0 }}>
                        <Collapse in={open} timeout="auto" unmountOnExit>
                            <Box sx={{ p: 2, pl: 6, borderBottom: '1px solid', borderColor: 'divider' }}>
                                {hasHealthDetail && health && (
                                    <Box sx={{ mb: 2 }}>
                                        <Typography variant="subtitle2" sx={{ mb: 0.5 }}>
                                            Health
                                        </Typography>
                                        <Typography variant="body2" sx={{ color: 'text.secondary' }}>
                                            {[
                                                health.status,
                                                health.connectivity && `ping ${health.connectivity}`,
                                                health.pingSummary,
                                            ]
                                                .filter(Boolean)
                                                .join(' · ')}
                                        </Typography>
                                        {health.errors?.map((e, i) => (
                                            <Typography key={`e${i}`} variant="body2" sx={{ color: 'error.main' }}>
                                                {e}
                                            </Typography>
                                        ))}
                                        {health.notices?.map((n, i) => (
                                            <Typography
                                                key={`n${i}`}
                                                variant="caption"
                                                sx={{ display: 'block', color: 'text.secondary' }}
                                            >
                                                {n}
                                            </Typography>
                                        ))}
                                    </Box>
                                )}
                                {hasPortData && (
                                    <Stack
                                        direction="row"
                                        spacing={1}
                                        alignItems="center"
                                        sx={{ mb: hasInputData ? 1 : hasDetail ? 2 : 0, flexWrap: 'wrap' }}
                                    >
                                        <Typography variant="subtitle2">Ports</Typography>
                                        {portRows.length > 0 &&
                                            (!portsRead ? (
                                                <Typography variant="caption" sx={{ color: 'text.secondary' }}>
                                                    device config not read yet
                                                </Typography>
                                            ) : portDrift ? (
                                                <SyncProblemIcon
                                                    color="warning"
                                                    fontSize="small"
                                                    titleAccess="ports differ from xLights — reconfiguration needed"
                                                />
                                            ) : (
                                                <CheckCircleOutlineIcon
                                                    color="success"
                                                    fontSize="small"
                                                    titleAccess="ports match xLights"
                                                />
                                            ))}
                                        {portRows.length > 0 && (
                                            <Button
                                                size="small"
                                                startIcon={<CompareArrowsIcon />}
                                                onClick={() => setPortDialog('compare')}
                                            >
                                                Compare
                                            </Button>
                                        )}
                                    </Stack>
                                )}
                                {hasInputData && (
                                    <Stack
                                        direction="row"
                                        spacing={1}
                                        alignItems="center"
                                        sx={{ mb: hasDetail ? 2 : 0, flexWrap: 'wrap' }}
                                    >
                                        <Typography variant="subtitle2">Input</Typography>
                                        {!inputsRead ? (
                                            <Typography variant="caption" sx={{ color: 'text.secondary' }}>
                                                device config not read yet
                                            </Typography>
                                        ) : inputDrift ? (
                                            <SyncProblemIcon
                                                color="warning"
                                                fontSize="small"
                                                titleAccess={inputRec.notes.join('; ')}
                                            />
                                        ) : (
                                            <CheckCircleOutlineIcon
                                                color="success"
                                                fontSize="small"
                                                titleAccess="input config matches xLights"
                                            />
                                        )}
                                        <Typography variant="caption" sx={{ color: 'text.secondary' }}>
                                            {inputsRead && inputRec.actualSummary
                                                ? inputRec.actualSummary
                                                : inputRec.intentSummary}
                                        </Typography>
                                    </Stack>
                                )}
                                {hasDetail && <DetailSections nodes={d!.detail!} />}
                            </Box>
                        </Collapse>
                    </TableCell>
                </TableRow>
            )}
            {portDialog === 'compare' && (
                <CompactDialog
                    title={`Ports — xLights vs controller${row.name ? ` · ${row.name}` : ''}`}
                    onClose={() => setPortDialog(null)}
                    fullScreen
                >
                    <PortReconcileTable rows={portRows} />
                    {hasInputData && (
                        <Box sx={{ mt: 2 }}>
                            <Typography variant="subtitle2" sx={{ mb: 0.5 }}>
                                Input config
                            </Typography>
                            <Typography variant="body2">xLights: {inputRec.intentSummary}</Typography>
                            <Typography variant="body2">
                                Controller: {inputsRead ? inputRec.actualSummary || '—' : 'not read yet'}
                            </Typography>
                            {inputRec.notes.map((n, i) => (
                                <Typography key={i} variant="body2" sx={{ color: 'warning.main' }}>
                                    {n}
                                </Typography>
                            ))}
                            {inputsRead && !inputDrift && (
                                <Typography variant="caption" sx={{ color: 'success.main' }}>
                                    in sync
                                </Typography>
                            )}
                        </Box>
                    )}
                </CompactDialog>
            )}
            {portDialog === 'map' && (
                <PortVisualizerDialog
                    title={row.name ?? d?.hostname ?? ip ?? ''}
                    modelIntents={row.modelIntents}
                    intent={row.intent}
                    actual={d?.pixelPorts}
                    onClose={() => setPortDialog(null)}
                />
            )}
            {uploadOpen && d && (
                <UploadDialog
                    name={row.name ?? d.hostname ?? ip ?? 'this controller'}
                    onClose={() => setUploadOpen(false)}
                    onSubmit={(fullControl) => {
                        setUploadOpen(false);
                        onUpload(d.id, fullControl);
                    }}
                />
            )}
        </>
    );
};

/** One running op's progress line; `onCancel` adds a Stop button. */
const OpProgress: React.FC<{ op: ControllerOp; onCancel?: (opId: string) => void }> = ({ op, onCancel }) => {
    const p = op.progress;
    const value = p && p.total > 0 ? Math.min(100, (p.scanned / p.total) * 100) : undefined;
    return (
        <Box sx={{ mb: 1 }}>
            <Box sx={{ display: 'flex', gap: 1, alignItems: 'center', mb: 0.5 }}>
                <Typography variant="body2">{op.label}</Typography>
                {p && (
                    <Typography variant="caption" sx={{ color: 'text.secondary' }}>
                        {p.phase} · {p.scanned}/{p.total} scanned · {p.alive} alive · {p.identified} identified
                    </Typography>
                )}
                <Box sx={{ flexGrow: 1 }} />
                {onCancel && (
                    <Button
                        size="small"
                        startIcon={<StopIcon />}
                        onClick={() => onCancel(op.id)}
                        sx={{ flexShrink: 0 }}
                    >
                        Stop
                    </Button>
                )}
            </Box>
            <LinearProgress variant={value === undefined ? 'indeterminate' : 'determinate'} value={value} />
        </Box>
    );
};

/** Per-string settings stamped to a default when "set all settings" is on;
 *  otherwise the controller keeps whatever it already has for these. */
const SETTABLE_SETTINGS = 'brightness, gamma, colour order, start/end null pixels, grouping, zig-zag and direction';

/** Upload confirmation. The checkbox is xLights' FullxLightsControl. */
const UploadDialog: React.FC<{
    name: string;
    onClose: () => void;
    onSubmit: (fullControl: boolean) => void;
}> = ({ name, onClose, onSubmit }) => {
    const [setAll, setSetAll] = useState(false);
    return (
        <Dialog open onClose={onClose} maxWidth="sm" fullWidth>
            <DialogTitle>Upload configuration to {name}?</DialogTitle>
            <DialogContent>
                <Typography variant="body2" sx={{ mb: 2 }}>
                    Sends this show&rsquo;s xLights port configuration to the controller. The controller stops
                    outputting for a moment while it applies the change.
                </Typography>
                <FormControlLabel
                    control={<Checkbox checked={setAll} onChange={(e) => setSetAll(e.target.checked)} />}
                    label={`Set all settings (${SETTABLE_SETTINGS})`}
                />
                <Typography variant="caption" sx={{ display: 'block', color: 'text.secondary', mt: 0.5 }}>
                    {setAll
                        ? 'Anything xLights does not specify is reset to this controller’s defaults — settings changed on the controller itself are overwritten.'
                        : 'Anything xLights does not specify is left exactly as it is on the controller.'}
                </Typography>
            </DialogContent>
            <DialogActions>
                <Button onClick={onClose}>Cancel</Button>
                <Button color="warning" variant="contained" onClick={() => onSubmit(setAll)}>
                    Upload
                </Button>
            </DialogActions>
        </Dialog>
    );
};

type DialogMode = 'edit' | 'promote' | 'new';
const DIALOG_TITLE: Record<DialogMode, string> = {
    edit: 'Edit controller record',
    promote: 'Promote to a named record',
    new: 'New controller record',
};

/** Create/edit/promote dialog. The name is the record key, so it's read-only
 *  when editing an existing record. */
const RecordDialog: React.FC<{
    mode: DialogMode;
    initialName: string;
    initialAddress: string;
    initialVendor?: string;
    initialModel?: string;
    initialVariant?: string;
    onClose: () => void;
    onSubmit: (name: string, patch: EzpControllerRecordPatch) => void;
}> = ({ mode, initialName, initialAddress, initialVendor, initialModel, initialVariant, onClose, onSubmit }) => {
    const [name, setName] = useState(initialName);
    const [address, setAddress] = useState(initialAddress);
    const [vendor, setVendor] = useState(initialVendor ?? '');
    const [model, setModel] = useState(initialModel ?? '');
    const [variant, setVariant] = useState(initialVariant ?? '');
    const nameLocked = mode === 'edit';
    const canSave = name.trim().length > 0;
    const submit = () => {
        const patch: EzpControllerRecordPatch = { address: address.trim() || undefined };
        patch.vendor = vendor.trim() || undefined;
        patch.model = model.trim() || undefined;
        patch.variant = variant.trim() || undefined;
        onSubmit(name.trim(), patch);
    };
    return (
        <Dialog open onClose={onClose} maxWidth="xs" fullWidth>
            <DialogTitle>{DIALOG_TITLE[mode]}</DialogTitle>
            <DialogContent>
                <Stack spacing={2} sx={{ mt: 1 }}>
                    <TextField
                        label="Name"
                        value={name}
                        onChange={(e) => setName(e.target.value)}
                        disabled={nameLocked}
                        autoFocus={!nameLocked}
                        fullWidth
                        size="small"
                        helperText={
                            nameLocked
                                ? 'The name is the record key and is fixed here.'
                                : 'Must match the xLights controller name to bind to it.'
                        }
                    />
                    <TextField
                        label="IP / hostname"
                        value={address}
                        onChange={(e) => setAddress(e.target.value)}
                        autoFocus={nameLocked}
                        fullWidth
                        size="small"
                        placeholder="192.168.1.50"
                    />
                    <Typography variant="caption" sx={{ color: 'text.secondary' }}>
                        Identity override (optional) — corrects the vendor/model/variant used for capability lookup when
                        xLights/detection has it wrong or incomplete.
                    </Typography>
                    <Stack direction="row" spacing={1}>
                        <TextField
                            label="Vendor"
                            value={vendor}
                            onChange={(e) => setVendor(e.target.value)}
                            size="small"
                        />
                        <TextField
                            label="Model"
                            value={model}
                            onChange={(e) => setModel(e.target.value)}
                            size="small"
                        />
                        <TextField
                            label="Variant"
                            value={variant}
                            onChange={(e) => setVariant(e.target.value)}
                            size="small"
                        />
                    </Stack>
                </Stack>
            </DialogContent>
            <DialogActions>
                <Button onClick={onClose}>Cancel</Button>
                <Button variant="contained" disabled={!canSave} onClick={submit}>
                    Save
                </Button>
            </DialogActions>
        </Dialog>
    );
};

interface ControllersScreenProps {
    title: string;
    statusArea?: React.ReactNode[];
}

export const ControllersScreen: React.FC<ControllersScreenProps> = ({ title, statusArea }) => {
    const dispatch = useDispatch<AppDispatch>();
    const { interfaces, devices, operations, known, networkPolicies } = useSelector((s: RootState) => s.controllerOps);
    // Live per-controller health, overlaid onto the grid rows.
    const statusesRaw = useSelector((s: RootState) => s.runtime?.combined?.controller?.controllers);
    // Base URL for the player's /proxy bridge (see controllerUrl).
    const { url: serverBase } = useFrameServerUrl();

    const [selected, setSelected] = useState<Set<string>>(new Set());
    const [depth, setDepth] = useState<Depth>('full');
    const [fppProxy, setFppProxy] = useState(false);
    const [sortKey, setSortKey] = useState<SortKey>('name');
    const [sortDir, setSortDir] = useState<'asc' | 'desc'>('asc');
    const [showUnidentified, setShowUnidentified] = useState(true);
    const [dialog, setDialog] = useState<{
        mode: DialogMode;
        name: string;
        address: string;
        vendor?: string;
        model?: string;
        variant?: string;
    } | null>(null);

    const policyFor = (cidr: string) => (networkPolicies ?? []).find((p) => p.cidr === cidr);
    const isAllowed = (cidr: string) => policyFor(cidr)?.allow !== false;

    // Seed the scan selection once, when networks first arrive; after that it
    // is the user's — including "none checked", which simply disables Scan.
    const seeded = useRef(false);
    useEffect(() => {
        if (!seeded.current && interfaces.length > 0) {
            seeded.current = true;
            const expected = interfaces.filter((i) => policyFor(i.network)?.expectControllers);
            const pool = expected.length > 0 ? expected : interfaces.filter((i) => isAllowed(i.network));
            setSelected(new Set(pool.map((i) => i.network)));
        }
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [interfaces, networkPolicies]);

    const isChecked = (cidr: string) => selected.has(cidr);
    const toggle = (cidr: string) =>
        setSelected((prev) => {
            const next = new Set(prev);
            if (next.has(cidr)) next.delete(cidr);
            else next.add(cidr);
            return next;
        });
    // Drop networks that were disallowed while still selected.
    const effective = [...selected].filter(isAllowed);
    const setNetworkPolicy = (cidr: string, patch: { allow?: boolean; expectControllers?: boolean }) =>
        dispatch(issueControllerCommand({ cmd: 'network', cidr, patch }));

    const ops = Object.values(operations);
    const running = ops.filter((o) => o.status === 'running');
    const scanning = running.some((o) => o.kind === 'scan');
    // Failed ops stay visible until dismissed.
    const [dismissedErrors, setDismissedErrors] = useState<Set<string>>(new Set());
    const errored = ops
        .filter((o) => o.status === 'error' && !dismissedErrors.has(o.id))
        .sort((a, b) => (b.finishedAt ?? '').localeCompare(a.finishedAt ?? ''))
        .slice(0, 5);
    const dismissError = (id: string) => setDismissedErrors((prev) => new Set(prev).add(id));
    const deviceList = Object.values(devices).sort(
        (a, b) => ipKey(a.ip) - ipKey(b.ip) || sourceRank(a) - sourceRank(b),
    );

    const rows = overlayHealth(reconcileControllers(known ?? [], deviceList), statusesRaw ?? []);
    const sortVal = (r: ControllerGridRow): string | number => {
        switch (sortKey) {
            case 'state':
                return STATE_RANK[r.state];
            case 'ip':
                return ipKey(r.device?.ip ?? r.address ?? '');
            case 'type':
                return (r.device?.driverType ?? r.model ?? r.vendor ?? '').toLowerCase();
            case 'name':
            default:
                // Unnamed ghosts sort after named records (the '~' prefix).
                return (r.name ?? `~${r.device?.hostname ?? r.device?.ip ?? ''}`).toLowerCase();
        }
    };
    const sortedRows = [...rows].sort((a, b) => {
        const av = sortVal(a);
        const bv = sortVal(b);
        const cmp = av < bv ? -1 : av > bv ? 1 : 0;
        return sortDir === 'asc' ? cmp : -cmp;
    });
    // A ghost with a driver is a real controller find and always shows.
    const visibleRows = sortedRows.filter(
        (r) => showUnidentified || r.state !== 'unregistered' || !!r.device?.driverType,
    );
    const hiddenCount = sortedRows.length - visibleRows.length;
    const count = (s: ControllerRecordState) => rows.filter((r) => r.state === s).length;
    const toggleSort = (key: SortKey) => {
        if (sortKey === key) setSortDir((d) => (d === 'asc' ? 'desc' : 'asc'));
        else {
            setSortKey(key);
            setSortDir('asc');
        }
    };

    const cancelOp = (opId: string) => dispatch(issueControllerCommand({ cmd: 'cancel', opId }));

    const runScan = () => {
        // A sweep only pings, so show everything; identify/full hide bare hosts.
        setShowUnidentified(depth === 'sweep');
        const command: ControllerCommand = {
            cmd: 'scan',
            networks: effective.map((cidr) => ({ cidr })),
            depth,
            recurseFppProxies: fppProxy,
        };
        dispatch(issueControllerCommand(command));
    };
    const refresh = () => dispatch(issueControllerCommand({ cmd: 'refreshInterfaces' }));

    const busyTargets = new Set(running.map((o) => o.target));
    const loadDetail = (id: string, address?: string) =>
        dispatch(issueControllerCommand({ cmd: 'status', id, address, depth: 'full' }));
    const runDeviceAction = (id: string, a: ControllerDeviceAction) => {
        const blurb = a.description ? ` ${a.description}.` : '';
        if (!a.dangerous || window.confirm(`${a.label} now?${blurb}`)) {
            dispatch(issueControllerCommand({ cmd: 'action', id, action: a.id }));
        }
    };
    // Confirmation lives in the row's UploadDialog.
    const upload = (id: string, fullControl: boolean) => {
        dispatch(issueControllerCommand({ cmd: 'upload', id, scope: 'full', fullControl }));
    };

    // Bulk actions — fan the per-row commands out over reachable known rows.
    const [bulkBusy, setBulkBusy] = useState<'upload' | 'reboot' | null>(null);
    // Latest ops snapshot for the async bulk loop (it outlives any one render).
    const operationsRef = useRef(operations);
    operationsRef.current = operations;

    // Eligible: present, scan-backed, and not known to be Down.
    const bulkRows = rows.filter((r) => r.state === 'present' && !!r.device && r.health?.connectivity !== 'Down');
    // Mirror the per-row Upload gate: identified non-player device + xLights intent.
    const uploadAllRows = bulkRows.filter(
        (r) => !!r.name && !!r.device!.driverType && r.device!.driverType !== 'EZPlayer' && (r.intent?.length ?? 0) > 0,
    );
    // Mirror the per-row reboot gate: the actions list (when present) must offer reboot/restart.
    const rebootAllRows = bulkRows.filter((r) => {
        const d = r.device!;
        if (!d.driverType || d.driverType === 'EZPlayer') return false;
        return d.actions ? d.actions.some((a) => a.id === 'reboot' || a.id === 'restart') : true;
    });
    const rebootActionId = (d: DiscoveredController): string =>
        d.actions?.find((a) => a.id === 'reboot')?.id ?? d.actions?.find((a) => a.id === 'restart')?.id ?? 'reboot';

    const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));
    /** Wait until no op of `kind` runs against `target`, per the broadcast ops state. */
    const waitForOpEnd = async (kind: ControllerOp['kind'], target: string): Promise<void> => {
        const isRunning = () =>
            Object.values(operationsRef.current).some(
                (o) => o.status === 'running' && o.kind === kind && o.target === target,
            );
        if (!isRunning()) {
            await sleep(1000); // grace: the op broadcast may not have landed yet
            if (!isRunning()) return;
        }
        const deadline = Date.now() + 5 * 60_000; // safety valve
        while (isRunning() && Date.now() < deadline) await sleep(400);
    };
    interface BulkTask {
        command: ControllerCommand;
        kind: ControllerOp['kind'];
        target: string;
    }
    const runBulk = async (which: 'upload' | 'reboot', tasks: BulkTask[]): Promise<void> => {
        setBulkBusy(which);
        try {
            let cursor = 0;
            const workers = Array.from({ length: Math.min(2, tasks.length) }, async () => {
                while (cursor < tasks.length) {
                    const t = tasks[cursor++];
                    try {
                        await dispatch(issueControllerCommand(t.command));
                        await waitForOpEnd(t.kind, t.target);
                    } catch {
                        // Per-device failures surface in the ops list; keep going.
                    }
                }
            });
            await Promise.all(workers);
        } finally {
            setBulkBusy(null);
        }
    };
    const uploadAll = () => {
        if (
            window.confirm(
                `Upload the xLights configuration (universes + string outputs) to ${uploadAllRows.length} ` +
                    'reachable controller(s)? This rewrites their port config; current device settings are replaced.',
            )
        ) {
            void runBulk(
                'upload',
                uploadAllRows.map((r) => ({
                    command: { cmd: 'upload', id: r.device!.id, scope: 'full' },
                    kind: 'upload',
                    target: r.device!.id,
                })),
            );
        }
    };
    const rebootAll = () => {
        if (
            window.confirm(
                `Reboot ${rebootAllRows.length} reachable controller(s) now? ` +
                    'They all go dark until they finish booting.',
            )
        ) {
            void runBulk(
                'reboot',
                rebootAllRows.map((r) => ({
                    command: { cmd: 'action', id: r.device!.id, action: rebootActionId(r.device!) },
                    kind: 'action',
                    target: r.device!.id,
                })),
            );
        }
    };

    // Record actions — write name-keyed overrides in the show folder.
    const setRecord = (name: string, patch: EzpControllerRecordPatch) =>
        dispatch(issueControllerCommand({ cmd: 'record', name, patch }));
    const setActive = (name: string, active: boolean) => setRecord(name, { active });
    const deleteRecord = (name: string) => {
        if (
            window.confirm(
                `Remove the EZPlayer record for "${name}"? The controller stays in xLights; this only drops our entry/override.`,
            )
        )
            setRecord(name, { deleted: true });
    };
    const openEdit = (row: ControllerGridRow) =>
        setDialog({
            mode: 'edit',
            name: row.name ?? '',
            address: row.address ?? '',
            vendor: row.vendor,
            model: row.model,
        });
    const openPromote = (row: ControllerGridRow) =>
        setDialog({ mode: 'promote', name: row.device?.hostname ?? '', address: row.device?.ip ?? '' });
    const openNew = () => setDialog({ mode: 'new', name: '', address: '' });
    const submitDialog = (name: string, patch: EzpControllerRecordPatch) => {
        if (dialog && dialog.mode !== 'edit') patch.own = true;
        setRecord(name, patch);
        setDialog(null);
    };

    return (
        <Box sx={{ display: 'flex', flexDirection: 'column', height: '100%', overflow: 'hidden' }}>
            <Box sx={{ flexShrink: 0, padding: 2 }}>
                <PageHeader heading={`${title} (alpha)`} children={statusArea} />
            </Box>
            <Box sx={{ padding: 2, paddingTop: 0, overflowY: 'auto', flexGrow: 1 }}>
                {/* Running operations + undismissed failures */}
                {(running.length > 0 || errored.length > 0) && (
                    <Card sx={{ p: 3, mb: 3, maxWidth: 820 }}>
                        <Typography variant="subtitle1" sx={{ mb: 2 }}>
                            Operations
                        </Typography>
                        {running.map((op) => (
                            <OpProgress key={op.id} op={op} onCancel={op.kind === 'scan' ? cancelOp : undefined} />
                        ))}
                        {errored.map((op) => (
                            <Box key={op.id} sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 0.5 }}>
                                <WarningAmberIcon color="error" fontSize="small" />
                                <Typography variant="body2" sx={{ flexGrow: 1 }}>
                                    {op.label} failed{op.error ? `: ${op.error}` : ''}
                                </Typography>
                                <Button size="small" onClick={() => dismissError(op.id)}>
                                    Dismiss
                                </Button>
                            </Box>
                        ))}
                    </Card>
                )}

                {/* Reconciliation grid */}
                <Card sx={{ p: { xs: 1, sm: 3 }, mb: 3 }}>
                    <Box sx={{ display: 'flex', alignItems: 'center', flexWrap: 'wrap', gap: 1, mb: 2 }}>
                        <Typography variant="subtitle1" sx={{ flexGrow: 1 }}>
                            Controllers
                        </Typography>
                        <Chip size="small" color="success" variant="outlined" label={`${count('present')} present`} />
                        <Chip size="small" label={`${count('absent')} absent`} />
                        <Chip
                            size="small"
                            color="warning"
                            variant="outlined"
                            label={`${count('unregistered')} unregistered`}
                        />
                        <FormControlLabel
                            sx={{ ml: 1 }}
                            control={
                                <Checkbox
                                    size="small"
                                    checked={showUnidentified}
                                    onChange={(e) => setShowUnidentified(e.target.checked)}
                                />
                            }
                            label={
                                <Typography variant="body2">
                                    Show unidentified{hiddenCount > 0 ? ` (${hiddenCount} hidden)` : ''}
                                </Typography>
                            }
                        />
                        <Button size="small" startIcon={<AddIcon />} onClick={openNew}>
                            New record
                        </Button>
                        <Button
                            size="small"
                            color="warning"
                            startIcon={<PublishIcon />}
                            onClick={uploadAll}
                            disabled={bulkBusy !== null || uploadAllRows.length === 0}
                            title="Upload the xLights configuration to every reachable controller with intent"
                        >
                            {bulkBusy === 'upload' ? 'Uploading…' : `Upload all (${uploadAllRows.length})`}
                        </Button>
                        <Button
                            size="small"
                            color="warning"
                            startIcon={<RestartAltIcon />}
                            onClick={rebootAll}
                            disabled={bulkBusy !== null || rebootAllRows.length === 0}
                            title="Reboot every reachable identified controller"
                        >
                            {bulkBusy === 'reboot' ? 'Rebooting…' : `Reboot all (${rebootAllRows.length})`}
                        </Button>
                    </Box>
                    {rows.length === 0 ? (
                        <Typography variant="body2" sx={{ color: 'text.secondary' }}>
                            No controllers known or discovered yet. Load a show layout, or pick networks and run a scan.
                        </Typography>
                    ) : (
                        // The Card clips overflow, which hid the Actions column on small displays.
                        <Box sx={{ overflowX: 'auto' }}>
                            <Table size="small">
                                <TableHead>
                                    <TableRow>
                                        <TableCell sx={{ width: 32 }} />
                                        {(
                                            [
                                                ['state', 'State'],
                                                ['name', 'Name'],
                                                ['ip', 'IP'],
                                                ['type', 'Type'],
                                            ] as [SortKey, string][]
                                        ).map(([key, label]) => (
                                            <TableCell key={key} sortDirection={sortKey === key ? sortDir : false}>
                                                <TableSortLabel
                                                    active={sortKey === key}
                                                    direction={sortKey === key ? sortDir : 'asc'}
                                                    onClick={() => toggleSort(key)}
                                                >
                                                    {label}
                                                </TableSortLabel>
                                            </TableCell>
                                        ))}
                                        <TableCell sx={{ textAlign: 'right' }}>Actions</TableCell>
                                    </TableRow>
                                </TableHead>
                                <TableBody>
                                    {visibleRows.map((row) => (
                                        <GridRow
                                            key={row.key}
                                            row={row}
                                            busy={busyTargets.has(row.device?.id ?? `${row.address ?? ''}|direct`)}
                                            serverBase={serverBase}
                                            onStatus={loadDetail}
                                            onAction={runDeviceAction}
                                            onUpload={upload}
                                            onActivate={setActive}
                                            onEdit={openEdit}
                                            onPromote={openPromote}
                                            onDelete={deleteRecord}
                                        />
                                    ))}
                                </TableBody>
                            </Table>
                        </Box>
                    )}
                </Card>

                {/* Networks + scan — below the grid: finding controllers is the
                     occasional task, reading the grid is the frequent one. */}
                <Card sx={{ p: 3, mb: 3, maxWidth: 820 }}>
                    <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 2 }}>
                        <Typography variant="subtitle1" sx={{ flexGrow: 1 }}>
                            Networks
                        </Typography>
                        <Button size="small" startIcon={<RefreshIcon />} onClick={refresh}>
                            Refresh
                        </Button>
                    </Box>

                    {interfaces.length === 0 ? (
                        <Typography variant="body2" sx={{ color: 'text.secondary', mb: 2 }}>
                            No external networks found on this host.
                        </Typography>
                    ) : (
                        // The Card clips overflow, which hid the right-hand columns on small displays.
                        <Box sx={{ overflowX: 'auto', mb: 2 }}>
                            <Table size="small">
                                <TableHead>
                                    <TableRow>
                                        <TableCell sx={{ width: 48 }}>Scan</TableCell>
                                        <TableCell>Network</TableCell>
                                        <TableCell>Interface</TableCell>
                                        <TableCell sx={{ whiteSpace: 'nowrap' }}>Controllers expected</TableCell>
                                        <TableCell sx={{ whiteSpace: 'nowrap' }}>Proxy Allowed</TableCell>
                                    </TableRow>
                                </TableHead>
                                <TableBody>
                                    {interfaces.map((n) => {
                                        const pol = policyFor(n.network);
                                        const allowed = pol?.allow !== false;
                                        return (
                                            <TableRow key={n.network} sx={{ opacity: allowed ? 1 : 0.55 }}>
                                                <TableCell padding="checkbox">
                                                    <Checkbox
                                                        size="small"
                                                        checked={allowed && isChecked(n.network)}
                                                        disabled={!allowed}
                                                        onChange={() => toggle(n.network)}
                                                    />
                                                </TableCell>
                                                <TableCell sx={{ fontFamily: 'monospace', whiteSpace: 'nowrap' }}>
                                                    {n.network}
                                                </TableCell>
                                                <TableCell sx={{ whiteSpace: 'nowrap' }}>
                                                    {n.name}
                                                    <Typography
                                                        variant="caption"
                                                        sx={{
                                                            display: 'block',
                                                            color: 'text.secondary',
                                                            fontFamily: 'monospace',
                                                        }}
                                                    >
                                                        {n.address}
                                                    </Typography>
                                                </TableCell>
                                                <TableCell>
                                                    <Checkbox
                                                        size="small"
                                                        checked={!!pol?.expectControllers}
                                                        disabled={!allowed}
                                                        onChange={(e) =>
                                                            setNetworkPolicy(n.network, {
                                                                expectControllers: e.target.checked,
                                                            })
                                                        }
                                                        inputProps={{
                                                            'aria-label': 'controllers expected on this network',
                                                        }}
                                                    />
                                                </TableCell>
                                                <TableCell>
                                                    <Checkbox
                                                        size="small"
                                                        checked={allowed}
                                                        onChange={(e) =>
                                                            setNetworkPolicy(n.network, { allow: e.target.checked })
                                                        }
                                                        inputProps={{
                                                            'aria-label': 'allow scanning and proxying to this network',
                                                        }}
                                                    />
                                                </TableCell>
                                            </TableRow>
                                        );
                                    })}
                                </TableBody>
                            </Table>
                        </Box>
                    )}

                    <Stack direction="row" spacing={2} alignItems="center" sx={{ flexWrap: 'wrap', gap: 1 }}>
                        <ToggleButtonGroup
                            size="small"
                            exclusive
                            value={depth}
                            onChange={(_e, v: Depth | null) => v && setDepth(v)}
                        >
                            <ToggleButton value="sweep">Sweep</ToggleButton>
                            <ToggleButton value="identify">Identify</ToggleButton>
                            <ToggleButton value="full">Full</ToggleButton>
                        </ToggleButtonGroup>

                        <FormControlLabel
                            control={<Checkbox checked={fppProxy} onChange={(e) => setFppProxy(e.target.checked)} />}
                            label="Follow FPP proxies"
                        />

                        <Box sx={{ flexGrow: 1 }} />

                        <Button
                            variant="contained"
                            startIcon={<RadarIcon />}
                            onClick={runScan}
                            disabled={scanning || effective.length === 0}
                        >
                            {scanning ? 'Scanning…' : 'Scan'}
                        </Button>
                    </Stack>
                </Card>
            </Box>
            {dialog && (
                <RecordDialog
                    mode={dialog.mode}
                    initialName={dialog.name}
                    initialAddress={dialog.address}
                    initialVendor={dialog.vendor}
                    initialModel={dialog.model}
                    initialVariant={dialog.variant}
                    onClose={() => setDialog(null)}
                    onSubmit={submitDialog}
                />
            )}
        </Box>
    );
};
