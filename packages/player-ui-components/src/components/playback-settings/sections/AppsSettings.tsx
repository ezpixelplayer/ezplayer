import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
    Alert,
    Autocomplete,
    Button,
    Chip,
    CircularProgress,
    Collapse,
    Dialog,
    DialogActions,
    DialogContent,
    DialogTitle,
    Divider,
    FormControl,
    FormControlLabel,
    IconButton,
    InputLabel,
    MenuItem,
    Paper,
    Radio,
    RadioGroup,
    Select,
    Stack,
    Switch,
    Table,
    TableBody,
    TableCell,
    TableHead,
    TableRow,
    TextField,
    Tooltip,
    Typography,
} from '@mui/material';
import DeleteIcon from '@mui/icons-material/Delete';
import DownloadIcon from '@mui/icons-material/Download';
import ExpandMoreIcon from '@mui/icons-material/ExpandMore';
import ExpandLessIcon from '@mui/icons-material/ExpandLess';
import FolderOpenIcon from '@mui/icons-material/FolderOpen';
import OpenInNewIcon from '@mui/icons-material/OpenInNew';
import PlayArrowIcon from '@mui/icons-material/PlayArrow';
import RefreshIcon from '@mui/icons-material/Refresh';
import SettingsIcon from '@mui/icons-material/Settings';
import StopIcon from '@mui/icons-material/Stop';
import UpdateIcon from '@mui/icons-material/Update';
import type {
    AppInputDecl,
    AppInputMapping,
    AppInputSender,
    AppRecentInput,
    AppInstallSource,
    AppInstanceStatus,
    AppsCommand,
    AppsState,
    AppUsage,
    CloudPollScheduleEntry,
    InstalledApp,
} from '@ezplayer/ezplayer-core';
import { inputAccepts } from '@ezplayer/ezplayer-core';
import { Box } from '../../box/Box';
import { useFrameServerUrl } from '../../../hooks/useFrameServerUrl';
import { WindowListEditor } from './WindowListEditor';

export const APPS_SETTINGS_SECTION_KEY = 'apps';

const EMPTY: AppsState = { apps: [], instances: [], defaultSchedule: [], inputMappings: [] };
const POLL_MS = 3000;
const NAME_RE = /^[a-z0-9][a-z0-9-]{0,39}$/;

/** "Front Tree" becomes `front-tree`, the same way the player does it. */
function slugify(title: string): string {
    return title
        .normalize('NFKD')
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-+|-+$/g, '')
        .slice(0, 40);
}

const STATE_COLOR: Record<AppInstanceStatus['state'], 'default' | 'success' | 'warning' | 'error' | 'info'> = {
    running: 'success',
    starting: 'info',
    stopped: 'default',
    disabled: 'default',
    unavailable: 'warning',
    failed: 'error',
    missing: 'error',
};

// Only the state whose name does not say what to do about it gets a label.
const STATE_LABEL: Partial<Record<AppInstanceStatus['state'], string>> = { unavailable: 'not scheduled now' };

type Command = (cmd: AppsCommand, label?: string) => Promise<void>;

/**
 * The Apps tile: installed app packages, their instances, and what each process is doing.
 * State comes from `GET /api/ezp/apps` and changes go through `POST /api/ezp/apps/command`,
 * so the same card works in the desktop app, on the LAN page and through the cloud.
 */
export const AppsSettings: React.FC = () => {
    const { url } = useFrameServerUrl();
    const [state, setState] = useState<AppsState>(EMPTY);
    const [loaded, setLoaded] = useState(false);
    const [busy, setBusy] = useState<string | null>(null);
    const [error, setError] = useState<string | null>(null);

    const refresh = useCallback(async () => {
        if (!url) return;
        try {
            const res = await fetch(`${url}/api/ezp/apps`, { cache: 'no-store' });
            if (res.ok) {
                setState((await res.json()) as AppsState);
                setLoaded(true);
            }
        } catch {
            /* the player is away; the next poll will say so */
        }
    }, [url]);

    useEffect(() => {
        void refresh();
        const t = setInterval(() => void refresh(), POLL_MS);
        return () => clearInterval(t);
    }, [refresh]);

    const command = useCallback<Command>(
        async (cmd, label: string = cmd.op) => {
            if (!url) return;
            setBusy(label);
            setError(null);
            try {
                const res = await fetch(`${url}/api/ezp/apps/command`, {
                    method: 'POST',
                    headers: { 'content-type': 'application/json' },
                    body: JSON.stringify(cmd),
                });
                if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);
                const next = (await res.json()) as AppsState;
                setState(next);
                if (next.lastError) setError(next.lastError);
            } catch (err) {
                setError((err as Error).message);
            } finally {
                setBusy(null);
            }
        },
        [url],
    );

    const appsById = useMemo(() => new Map(state.apps.map((a) => [a.id, a])), [state.apps]);

    if (!loaded) {
        return (
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 2, p: 2 }}>
                <CircularProgress size={20} />
                <Typography>Reading the player's apps…</Typography>
            </Box>
        );
    }

    return (
        <Box sx={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
            {error && (
                <Alert severity="error" onClose={() => setError(null)}>
                    {error}
                </Alert>
            )}

            <InstancesSection state={state} appsById={appsById} busy={busy} playerUrl={url ?? ''} command={command} />
            <Divider />
            <AvailabilitySection state={state} busy={busy} command={command} />
            <Divider />
            <InstalledAppsSection state={state} busy={busy} command={command} />
            <Divider />
            <AddAppsSection state={state} busy={busy} command={command} />
            <Divider />
            <InputsSection state={state} busy={busy} playerUrl={url ?? ''} command={command} />
            <Divider />
            <RuntimeSection state={state} busy={busy} command={command} />
            <Divider />
            <UsageSection state={state} appsById={appsById} busy={busy} command={command} />
        </Box>
    );
};

// -- instances ---------------------------------------------------------------------

const InstancesSection: React.FC<{
    state: AppsState;
    appsById: Map<string, InstalledApp>;
    busy: string | null;
    playerUrl: string;
    command: Command;
}> = ({ state, appsById, busy, playerUrl, command }) => {
    const [creating, setCreating] = useState(false);
    const [newTitle, setNewTitle] = useState('');
    const [newApp, setNewApp] = useState('');
    const usable = state.apps.filter((a) => a.manifest);
    const slug = slugify(newTitle);
    const taken = state.instances.some((i) => i.name === slug);

    return (
        <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1.5 }}>
            <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                <Typography variant="h6">Instances</Typography>
                <Button
                    variant="contained"
                    size="small"
                    disabled={usable.length === 0}
                    onClick={() => {
                        setNewApp(usable.length === 1 ? usable[0].id : '');
                        setCreating(true);
                    }}
                >
                    Add instance
                </Button>
            </Box>
            {state.instances.length === 0 && (
                <Typography color="text.secondary">
                    An instance is one configured copy of an app, with its own name, page and data. Install an app
                    below, then add an instance of it.
                </Typography>
            )}
            {state.instances.map((inst) => (
                <InstanceRow
                    key={inst.name}
                    inst={inst}
                    app={appsById.get(inst.appId)}
                    state={state}
                    busy={busy}
                    playerUrl={playerUrl}
                    command={command}
                />
            ))}

            <Dialog open={creating} onClose={() => setCreating(false)} fullWidth maxWidth="xs">
                <DialogTitle>Add an instance</DialogTitle>
                <DialogContent>
                    {/* The title's rule zeroes the content's top padding, so the padding sits on an inner box or the labels clip. */}
                    <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2, pt: 1 }}>
                        <FormControl fullWidth size="small">
                            <InputLabel id="apps-new-app">App</InputLabel>
                            <Select
                                labelId="apps-new-app"
                                label="App"
                                value={newApp}
                                onChange={(e) => setNewApp(e.target.value)}
                            >
                                {usable.map((a) => (
                                    <MenuItem key={a.id} value={a.id}>
                                        {a.manifest!.icon ? `${a.manifest!.icon} ` : ''}
                                        {a.manifest!.name} ({a.manifest!.version})
                                    </MenuItem>
                                ))}
                            </Select>
                        </FormControl>
                        <TextField
                            size="small"
                            label="Name"
                            value={newTitle}
                            onChange={(e) => setNewTitle(e.target.value)}
                            placeholder="Front Tree"
                            helperText={
                                slug
                                    ? taken
                                        ? `There is already an instance at /apps/${slug}/`
                                        : `Visitors see this name. Its page will be /apps/${slug}/`
                                    : 'Visitors see this name; the page address is made from it.'
                            }
                            error={taken}
                            autoFocus
                        />
                    </Box>
                </DialogContent>
                <DialogActions>
                    <Button onClick={() => setCreating(false)}>Cancel</Button>
                    <Button
                        variant="contained"
                        disabled={!newApp || !NAME_RE.test(slug) || taken}
                        onClick={async () => {
                            await command({ op: 'createInstance', name: slug, appId: newApp, title: newTitle.trim() });
                            setCreating(false);
                            setNewTitle('');
                        }}
                    >
                        Add
                    </Button>
                </DialogActions>
            </Dialog>
        </Box>
    );
};

const InstanceRow: React.FC<{
    inst: AppInstanceStatus;
    app: InstalledApp | undefined;
    state: AppsState;
    busy: string | null;
    playerUrl: string;
    command: Command;
}> = ({ inst, app, state, busy, playerUrl, command }) => {
    const [open, setOpen] = useState(false);
    const [confirmRemove, setConfirmRemove] = useState(false);
    const manifest = app?.manifest;
    const running = inst.state === 'running' || inst.state === 'starting';
    const base = `${playerUrl}/apps/${encodeURIComponent(inst.name)}/`;

    return (
        <Paper variant="outlined" sx={{ p: 1.5 }}>
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, flexWrap: 'wrap' }}>
                <Typography sx={{ fontWeight: 600 }}>
                    {manifest?.icon ? `${manifest.icon} ` : ''}
                    {inst.title ?? manifest?.name ?? inst.appId}
                </Typography>
                <Typography color="text.secondary" variant="body2">
                    /apps/{inst.name}/
                </Typography>
                <Chip size="small" label={STATE_LABEL[inst.state] ?? inst.state} color={STATE_COLOR[inst.state]} />
                {inst.restarts > 0 && <Chip size="small" variant="outlined" label={`${inst.restarts} restarts`} />}
                <Box sx={{ flex: 1 }} />
                <Tooltip title="Enabled: start when the show opens and the schedule allows">
                    <Switch
                        size="small"
                        checked={inst.enabled}
                        disabled={busy !== null || !manifest}
                        onChange={(e) =>
                            void command({ op: 'setInstance', name: inst.name, patch: { enabled: e.target.checked } })
                        }
                    />
                </Tooltip>
                {running ? (
                    <Tooltip title="Stop (and disable)">
                        <IconButton
                            size="small"
                            disabled={busy !== null}
                            onClick={() => void command({ op: 'stop', name: inst.name })}
                        >
                            <StopIcon />
                        </IconButton>
                    </Tooltip>
                ) : (
                    <Tooltip title="Start now (and enable)">
                        <IconButton
                            size="small"
                            disabled={busy !== null || !manifest}
                            onClick={() => void command({ op: 'start', name: inst.name })}
                        >
                            <PlayArrowIcon />
                        </IconButton>
                    </Tooltip>
                )}
                <Tooltip title="Restart">
                    <IconButton
                        size="small"
                        disabled={busy !== null || !running}
                        onClick={() => void command({ op: 'restart', name: inst.name })}
                    >
                        <RefreshIcon />
                    </IconButton>
                </Tooltip>
                {manifest?.config !== undefined && (
                    <Tooltip title="Open the settings page of this instance">
                        <IconButton size="small" component="a" href={`${base}config/`} target="_blank" rel="noopener">
                            <SettingsIcon />
                        </IconButton>
                    </Tooltip>
                )}
                {manifest?.page !== undefined && (
                    <Tooltip title="Open the visitors' page">
                        <IconButton size="small" component="a" href={base} target="_blank" rel="noopener">
                            <OpenInNewIcon />
                        </IconButton>
                    </Tooltip>
                )}
                <Tooltip title="Remove this instance">
                    <IconButton size="small" disabled={busy !== null} onClick={() => setConfirmRemove(true)}>
                        <DeleteIcon />
                    </IconButton>
                </Tooltip>
                <IconButton size="small" onClick={() => setOpen((o) => !o)} aria-label="details">
                    {open ? <ExpandLessIcon /> : <ExpandMoreIcon />}
                </IconButton>
            </Box>
            <UsageLine usage={state.usage?.[inst.name]} />
            <Collapse in={open}>
                <Stack spacing={1} sx={{ mt: 1.5 }}>
                    {!manifest && (
                        <Alert severity="error">
                            The app <code>{inst.appId}</code> is not installed{app?.error ? `: ${app.error}` : ''}.
                        </Alert>
                    )}
                    <TextField
                        size="small"
                        label="Name shown to visitors"
                        defaultValue={inst.title ?? ''}
                        placeholder={manifest?.name}
                        onBlur={(e) => {
                            if ((e.target.value || '') !== (inst.title ?? '')) {
                                void command({ op: 'setInstance', name: inst.name, patch: { title: e.target.value } });
                            }
                        }}
                    />
                    <TextField
                        size="small"
                        multiline
                        minRows={2}
                        label="Description shown to visitors"
                        defaultValue={inst.description ?? ''}
                        placeholder={manifest?.description}
                        helperText="Say where to go to play, like “Tetris on the big tree by the nutcracker”. If left blank, the app's default will be used."
                        inputProps={{ maxLength: 300 }}
                        onBlur={(e) => {
                            if ((e.target.value || '') !== (inst.description ?? '')) {
                                void command({
                                    op: 'setInstance',
                                    name: inst.name,
                                    patch: { description: e.target.value },
                                });
                            }
                        }}
                    />
                    <InstanceAvailability inst={inst} busy={busy} command={command} />
                    <Typography variant="subtitle2">Event Rate Limit</Typography>
                    <TextField
                        size="small"
                        type="number"
                        label="Events per minute accepted"
                        defaultValue={inst.eventsPerMinute ?? manifest?.events?.perMinute ?? 600}
                        inputProps={{ min: 1, max: 6000 }}
                        helperText="Event rate limiting may help protect your app from overload. When setting the event limit, consider actions taken by all users simultaneously, not just one."
                        onBlur={(e) => {
                            const n = Number(e.target.value);
                            if (n !== (inst.eventsPerMinute ?? manifest?.events?.perMinute ?? 600)) {
                                void command({ op: 'setInstance', name: inst.name, patch: { eventsPerMinute: n } });
                            }
                        }}
                        sx={{ maxWidth: 260 }}
                    />
                    {manifest?.inputs && manifest.inputs.length > 0 && (
                        <InstanceInputs
                            inst={inst}
                            inputs={manifest.inputs}
                            state={state}
                            playerUrl={playerUrl}
                            busy={busy}
                            command={command}
                        />
                    )}
                    <Report inst={inst} />
                </Stack>
            </Collapse>

            <Dialog open={confirmRemove} onClose={() => setConfirmRemove(false)}>
                <DialogTitle>Remove {inst.title ?? inst.name}?</DialogTitle>
                <DialogContent>
                    <Typography>
                        The instance stops and its settings are forgotten. Its stored data (scores, uploads) is deleted
                        too unless you keep it.
                    </Typography>
                </DialogContent>
                <DialogActions>
                    <Button onClick={() => setConfirmRemove(false)}>Cancel</Button>
                    <Button
                        onClick={async () => {
                            await command({ op: 'removeInstance', name: inst.name, keepData: true });
                            setConfirmRemove(false);
                        }}
                    >
                        Remove, keep data
                    </Button>
                    <Button
                        color="error"
                        variant="contained"
                        onClick={async () => {
                            await command({ op: 'removeInstance', name: inst.name });
                            setConfirmRemove(false);
                        }}
                    >
                        Remove
                    </Button>
                </DialogActions>
            </Dialog>
        </Paper>
    );
};

const Report: React.FC<{ inst: AppInstanceStatus }> = ({ inst }) => {
    const r = inst.report;
    const when = (t?: number) => (t ? new Date(t).toLocaleTimeString() : '—');
    return (
        <Box>
            <Typography variant="subtitle2">Startup report</Typography>
            <Typography variant="body2" color="text.secondary" component="div">
                Runtime: {r.runtime ?? '—'}
                {r.runtimeVersion ? ` (${r.runtimeVersion})` : ''}
                <br />
                Port: {r.port ?? '—'} · Started: {when(r.startedAt)} · First status: {when(r.firstStatusAt)}
                {inst.pid ? ` · pid ${inst.pid}` : ''}
                {r.lastExit ? <br /> : null}
                {r.lastExit ? `Last exit: ${r.lastExit}` : ''}
            </Typography>
            {r.logTail.length > 0 && (
                <Typography
                    component="pre"
                    variant="body2"
                    sx={{
                        mt: 1,
                        p: 1,
                        maxHeight: 220,
                        overflow: 'auto',
                        fontSize: 12,
                        fontFamily: 'monospace',
                        color: 'text.primary',
                        bgcolor: 'background.default',
                        border: 1,
                        borderColor: 'divider',
                        borderRadius: 1,
                        whiteSpace: 'pre-wrap',
                    }}
                >
                    {r.logTail.join('\n')}
                </Typography>
            )}
        </Box>
    );
};

// -- availability -------------------------------------------------------------------

/** The default time windows every instance follows unless it has its own. */
const AvailabilitySection: React.FC<{ state: AppsState; busy: string | null; command: Command }> = ({
    state,
    busy,
    command,
}) => (
    <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1 }}>
        <Typography variant="h6">Default Availability Schedule</Typography>
        <Typography color="text.secondary" variant="body2">
            When enabled instances run. Outside these time windows an instance is stopped and the show page does not
            list it. Each instance follows this schedule unless it has its own.
        </Typography>
        <WindowListEditor
            schedule={state.defaultSchedule}
            noun="time window"
            emptyText="Always, whenever the instance is enabled. Add a time window to limit that."
            disabled={busy !== null}
            onChange={(schedule) => void command({ op: 'setDefaultSchedule', schedule })}
        />
    </Box>
);

/** One instance's choice: the default time windows, or its own (none means always). */
const InstanceAvailability: React.FC<{ inst: AppInstanceStatus; busy: string | null; command: Command }> = ({
    inst,
    busy,
    command,
}) => {
    const own = inst.schedule !== undefined;
    const set = (schedule: CloudPollScheduleEntry[] | null) =>
        void command({ op: 'setInstance', name: inst.name, patch: { schedule } });
    return (
        <Box>
            <Typography variant="subtitle2">Availability Schedule</Typography>
            <RadioGroup row value={own ? 'own' : 'default'} onChange={(e) => set(e.target.value === 'own' ? [] : null)}>
                <FormControlLabel
                    value="default"
                    control={<Radio size="small" />}
                    label="Default (below)"
                    disabled={busy !== null}
                />
                <FormControlLabel
                    value="own"
                    control={<Radio size="small" />}
                    label="Its own time windows"
                    disabled={busy !== null}
                />
            </RadioGroup>
            {own && (
                <WindowListEditor
                    schedule={inst.schedule ?? []}
                    noun="time window"
                    emptyText="Always, whenever enabled. Add a time window to limit that."
                    disabled={busy !== null}
                    onChange={set}
                />
            )}
        </Box>
    );
};

// -- installed apps ----------------------------------------------------------------

function describeSource(app: InstalledApp): string | undefined {
    switch (app.source?.kind) {
        case 'contrib':
            return 'from ezplayer-contrib';
        case 'url':
            return `from ${app.source.url}`;
        case 'folder':
            return `from ${app.source.path}`;
        case 'examples':
            return 'bundled example';
        default:
            return undefined;
    }
}

const InstalledAppsSection: React.FC<{ state: AppsState; busy: string | null; command: Command }> = ({
    state,
    busy,
    command,
}) => (
    <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1.5 }}>
        <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
            <Typography variant="h6">Installed apps</Typography>
            <Tooltip title="Re-read the apps folder">
                <IconButton size="small" disabled={busy !== null} onClick={() => void command({ op: 'rescan' })}>
                    <RefreshIcon />
                </IconButton>
            </Tooltip>
        </Box>
        {state.apps.length === 0 && (
            <Typography color="text.secondary">
                No apps yet. Apps are small programs that run next to the player: games on a matrix, messages from
                visitors' phones, props they can light up. Add some below.
            </Typography>
        )}
        {state.apps.map((a) => (
            <Paper
                key={a.id}
                variant="outlined"
                sx={{ p: 1.5, display: 'flex', alignItems: 'center', gap: 1, flexWrap: 'wrap' }}
            >
                <Box sx={{ flex: 1, minWidth: 200 }}>
                    <Typography sx={{ fontWeight: 600 }}>
                        {a.manifest?.icon ? `${a.manifest.icon} ` : ''}
                        {a.manifest?.name ?? a.id}
                        {a.manifest && (
                            <Typography component="span" variant="body2" color="text.secondary">
                                {' '}
                                {a.manifest.version} · {a.manifest.runtime}
                            </Typography>
                        )}
                    </Typography>
                    {a.manifest?.description && (
                        <Typography variant="body2" color="text.secondary">
                            {a.manifest.description}
                        </Typography>
                    )}
                    {describeSource(a) && (
                        <Typography variant="body2" color="text.secondary" sx={{ fontSize: 12 }}>
                            {describeSource(a)}
                        </Typography>
                    )}
                    {a.error && (
                        <Typography variant="body2" color="error">
                            {a.error}
                        </Typography>
                    )}
                </Box>
                {a.source && (
                    <Tooltip title="Stop its instances, fetch the package again from where it came, start them again">
                        <span>
                            <Button
                                size="small"
                                startIcon={busy === `update:${a.id}` ? <CircularProgress size={14} /> : <UpdateIcon />}
                                disabled={busy !== null}
                                onClick={() => void command({ op: 'update', appId: a.id }, `update:${a.id}`)}
                            >
                                Update
                            </Button>
                        </span>
                    </Tooltip>
                )}
                <Tooltip title="Uninstall the package. Its instances stay listed until you remove them.">
                    <IconButton
                        size="small"
                        disabled={busy !== null}
                        onClick={() => void command({ op: 'uninstall', appId: a.id })}
                    >
                        <DeleteIcon />
                    </IconButton>
                </Tooltip>
            </Paper>
        ))}
    </Box>
);

// -- add apps -------------------------------------------------------------------------

const AddAppsSection: React.FC<{ state: AppsState; busy: string | null; command: Command }> = ({
    state,
    busy,
    command,
}) => {
    const [folder, setFolder] = useState('');
    const [url, setUrl] = useState('');
    const canBrowse = typeof window !== 'undefined' && typeof window.electronAPI?.selectDirectory === 'function';
    const install = (source: AppInstallSource, label: string) => void command({ op: 'install', source }, label);
    const spinner = (label: string) => (busy === label ? <CircularProgress size={14} /> : <DownloadIcon />);
    const urlOk = /^https:\/\/\S+/i.test(url.trim());

    return (
        <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1.5 }}>
            <Typography variant="h6">Add apps</Typography>
            <Stack spacing={1.5}>
                <Paper
                    variant="outlined"
                    sx={{ p: 1.5, display: 'flex', gap: 2, alignItems: 'center', flexWrap: 'wrap' }}
                >
                    <Box sx={{ flex: 1, minWidth: 220 }}>
                        <Typography sx={{ fontWeight: 600 }}>Example apps</Typography>
                        <Typography variant="body2" color="text.secondary">
                            {state.hasExamples
                                ? 'The samples that ship with the player: Tetris on a matrix, and small demos of the overlay, scene and audio APIs.'
                                : 'This player has no bundled examples.'}
                        </Typography>
                    </Box>
                    <Button
                        variant="outlined"
                        startIcon={spinner('install:examples')}
                        disabled={busy !== null || !state.hasExamples}
                        onClick={() => install({ kind: 'examples' }, 'install:examples')}
                    >
                        Install all examples
                    </Button>
                </Paper>

                <Paper
                    variant="outlined"
                    sx={{ p: 1.5, display: 'flex', gap: 2, alignItems: 'center', flexWrap: 'wrap' }}
                >
                    <Box sx={{ flex: 1, minWidth: 220 }}>
                        <Typography sx={{ fontWeight: 600 }}>ezplayer-contrib</Typography>
                        <Typography variant="body2" color="text.secondary">
                            Apps shared by other show owners, fetched from the contrib repository. Update later with the
                            Update button on each app.
                        </Typography>
                    </Box>
                    <Button
                        variant="outlined"
                        startIcon={spinner('install:contrib')}
                        disabled={busy !== null}
                        onClick={() => install({ kind: 'contrib' }, 'install:contrib')}
                    >
                        Install from contrib
                    </Button>
                </Paper>

                <Paper variant="outlined" sx={{ p: 1.5 }}>
                    <Typography sx={{ fontWeight: 600 }}>A folder on the player computer</Typography>
                    <Typography variant="body2" color="text.secondary" sx={{ mb: 1 }}>
                        A folder holding an <code>ezapp.json</code>. The player copies it into the show folder.
                    </Typography>
                    <Box sx={{ display: 'flex', gap: 1, alignItems: 'center', flexWrap: 'wrap' }}>
                        <TextField
                            size="small"
                            sx={{ flex: 1, minWidth: 240 }}
                            label="Folder"
                            value={folder}
                            onChange={(e) => setFolder(e.target.value)}
                            placeholder={canBrowse ? 'Browse, or type a path' : 'A path on the player computer'}
                        />
                        {canBrowse && (
                            <Button
                                variant="outlined"
                                startIcon={<FolderOpenIcon />}
                                disabled={busy !== null}
                                onClick={async () => {
                                    const picked = await window.electronAPI!.selectDirectory({
                                        title: 'Pick the app folder',
                                    });
                                    if (picked?.[0]) setFolder(picked[0]);
                                }}
                            >
                                Browse
                            </Button>
                        )}
                        <Button
                            variant="outlined"
                            startIcon={spinner('install:folder')}
                            disabled={busy !== null || folder.trim() === ''}
                            onClick={() => install({ kind: 'folder', path: folder.trim() }, 'install:folder')}
                        >
                            Install
                        </Button>
                    </Box>
                </Paper>

                <Paper variant="outlined" sx={{ p: 1.5 }}>
                    <Typography sx={{ fontWeight: 600 }}>A GitHub repository or .tar.gz link</Typography>
                    <Typography variant="body2" color="text.secondary" sx={{ mb: 1 }}>
                        Paste the repository address (a <code>/tree/branch</code> link picks that branch) or a direct
                        archive link. Every app found in it is installed, and Update fetches it again later.
                    </Typography>
                    <Box sx={{ display: 'flex', gap: 1, alignItems: 'center', flexWrap: 'wrap' }}>
                        <TextField
                            size="small"
                            sx={{ flex: 1, minWidth: 240 }}
                            label="https://github.com/owner/repo"
                            value={url}
                            onChange={(e) => setUrl(e.target.value)}
                            error={url.trim() !== '' && !urlOk}
                        />
                        <Button
                            variant="outlined"
                            startIcon={spinner('install:url')}
                            disabled={busy !== null || !urlOk}
                            onClick={() => install({ kind: 'url', url: url.trim() }, 'install:url')}
                        >
                            Install
                        </Button>
                    </Box>
                </Paper>
            </Stack>
        </Box>
    );
};

// -- usage --------------------------------------------------------------------------

/** "20 s", "48 min", "3 h 12 min", "2.5 days". */
function fmtDuration(ms: number): string {
    const s = Math.round(ms / 1000);
    if (s < 60) return `${s} s`;
    const m = Math.round(s / 60);
    if (m < 60) return `${m} min`;
    const h = Math.floor(m / 60);
    if (h < 48) return `${h} h ${m % 60} min`;
    return `${(h / 24).toFixed(1)} days`;
}

function fmtAgo(at: number): string {
    const s = Math.max(0, Math.round((Date.now() - at) / 1000));
    if (s < 60) return 'just now';
    const m = Math.round(s / 60);
    if (m < 90) return `${m} min ago`;
    const h = Math.round(m / 60);
    if (h < 48) return `${h} h ago`;
    return `${Math.round(h / 24)} days ago`;
}

const plural = (n: number, one: string, many = `${one}s`) => `${n.toLocaleString()} ${n === 1 ? one : many}`;

/** One line of what the player counted for an instance; nothing until it has run or been visited. */
const UsageLine: React.FC<{ usage: AppUsage | undefined }> = ({ usage }) => {
    if (!usage || (usage.runs === 0 && usage.requests === 0 && usage.sent === 0)) return null;
    const share = usage.runMs > 0 ? Math.round((100 * usage.activeMs) / usage.runMs) : 0;
    return (
        <Typography variant="body2" color="text.secondary" sx={{ mt: 0.5 }}>
            Ran {fmtDuration(usage.runMs)} over {plural(usage.runs, 'start')} · active {fmtDuration(usage.activeMs)} (
            {share}%) · {plural(usage.requests, 'visitor request')}, {plural(usage.events, 'event')} received
            {usage.sent > 0 ? `, ${plural(usage.sent, 'input')} sent` : ''}
            {usage.lastActiveAt ? ` · last active ${fmtAgo(usage.lastActiveAt)}` : ''}
        </Typography>
    );
};

interface UsageRow extends AppUsage {
    instance: string;
    /** The instance's title, or its name once it is removed. */
    name: string;
    app: string;
    removed: boolean;
}

/** Every instance's counts, removed ones included, most active first. */
const UsageSection: React.FC<{
    state: AppsState;
    appsById: Map<string, InstalledApp>;
    busy: string | null;
    command: Command;
}> = ({ state, appsById, busy, command }) => {
    const [confirm, setConfirm] = useState(false);
    const rows = useMemo(() => {
        const out: UsageRow[] = [];
        for (const [instance, u] of Object.entries(state.usage ?? {})) {
            const inst = state.instances.find((i) => i.name === instance);
            const m = appsById.get(u.appId)?.manifest;
            out.push({
                ...u,
                instance,
                name: inst?.title ?? instance,
                app: m ? `${m.icon ? `${m.icon} ` : ''}${m.name}` : u.appId,
                removed: !inst,
            });
        }
        return out.sort(
            (a, b) => b.activeMs - a.activeMs || b.requests + b.sent - (a.requests + a.sent) || b.runMs - a.runMs,
        );
    }, [state.usage, state.instances, appsById]);

    return (
        <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1 }}>
            <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                <Typography variant="h6">App activity</Typography>
                {rows.length > 0 &&
                    (confirm ? (
                        <Box sx={{ display: 'flex', gap: 1 }}>
                            <Button size="small" onClick={() => setConfirm(false)}>
                                Keep
                            </Button>
                            <Button
                                size="small"
                                color="error"
                                variant="contained"
                                disabled={busy !== null}
                                onClick={() => {
                                    setConfirm(false);
                                    void command({ op: 'resetUsage' });
                                }}
                            >
                                Reset every count
                            </Button>
                        </Box>
                    ) : (
                        <Button size="small" disabled={busy !== null} onClick={() => setConfirm(true)}>
                            Reset
                        </Button>
                    ))}
            </Box>
            {rows.length === 0 ? (
                <Typography color="text.secondary" variant="body2">
                    Nothing has run yet.
                </Typography>
            ) : (
                <Table size="small">
                    <TableHead>
                        <TableRow>
                            <TableCell>Instance</TableCell>
                            <TableCell align="right">Active</TableCell>
                            <TableCell align="right">Ran</TableCell>
                            <TableCell align="right">Starts</TableCell>
                            <TableCell align="right">Visitor requests</TableCell>
                            <TableCell align="right">Events received</TableCell>
                            <TableCell align="right">Inputs sent</TableCell>
                        </TableRow>
                    </TableHead>
                    <TableBody>
                        {rows.map((r) => (
                            <TableRow key={r.instance}>
                                <TableCell>
                                    {r.name}
                                    {r.removed ? ' (removed)' : ''}{' '}
                                    <Typography component="span" variant="caption" color="text.secondary">
                                        {r.app}
                                    </Typography>
                                </TableCell>
                                <TableCell align="right">{fmtDuration(r.activeMs)}</TableCell>
                                <TableCell align="right">{fmtDuration(r.runMs)}</TableCell>
                                <TableCell align="right">{r.runs.toLocaleString()}</TableCell>
                                <TableCell align="right">{r.requests.toLocaleString()}</TableCell>
                                <TableCell align="right">{r.events.toLocaleString()}</TableCell>
                                <TableCell align="right">{r.sent.toLocaleString()}</TableCell>
                            </TableRow>
                        ))}
                    </TableBody>
                </Table>
            )}
        </Box>
    );
};

// -- inputs -------------------------------------------------------------------------

/** "just now", "40 s ago", "3 min ago". */
function ago(ms: number): string {
    const s = Math.max(0, Math.round((Date.now() - ms) / 1000));
    if (s < 5) return 'just now';
    if (s < 90) return `${s} s ago`;
    const m = Math.round(s / 60);
    if (m < 90) return `${m} min ago`;
    return `${Math.round(m / 60)} h ago`;
}

const FEED_RE = /^[a-z0-9][a-z0-9-]{0,39}\/[a-z0-9][a-z0-9-]{0,39}$/;
const feedKey = (m: { source: string; name: string }) => `${m.source}/${m.name}`;
/** Where senders post, spelled out with this player's address. */
const inputsUrl = (playerUrl: string) => `${playerUrl}/api/ezp/inputs/<source>/<name>`;

/** Pick lists read best in name order, "Arch 2" before "Arch 10". */
const byName = (a: string, b: string) => a.localeCompare(b, undefined, { numeric: true, sensitivity: 'base' });

/** What a sender sends, in words. */
const SHAPE_WORDS: Record<AppRecentInput['shape'], string> = {
    none: 'no value',
    boolean: 'on/off',
    number: 'a number',
    text: 'text',
    object: 'an object',
};
/** What an input takes, in words. */
const KIND_WORDS: Record<AppInputDecl['kind'], string> = {
    event: 'a press',
    value: 'a level',
    text: 'text',
    object: 'an object',
};

/** A heard feed that sends what the input takes, as the picker offers it. */
interface FeedOption {
    key: string;
}

/** On an instance card: what drives each input the app declares, with a picker for one more feed. */
const InstanceInputs: React.FC<{
    inst: AppInstanceStatus;
    inputs: AppInputDecl[];
    state: AppsState;
    playerUrl: string;
    busy: string | null;
    command: Command;
}> = ({ inst, inputs, state, playerUrl, busy, command }) => {
    const mappings = state.inputMappings;
    const heard = state.recentInputs ?? [];
    const save = (next: AppInputMapping[]) => void command({ op: 'setInputMappings', mappings: next });
    return (
        <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1 }}>
            <Typography variant="subtitle2">Show inputs</Typography>
            <Typography color="text.secondary" variant="body2">
                Some apps allow inputs from other apps or external sources (sent to <code>{inputsUrl(playerUrl)}</code>
                ). This app accepts the following events:
            </Typography>
            {inputs.map((inp) => {
                const feeds = mappings.filter((m) => m.instance === inst.name && m.input === inp.name);
                const have = new Set(feeds.map(feedKey));
                // Only feeds that send what this input takes are offered.
                const options = heard
                    .filter((r) => !have.has(feedKey(r)) && inputAccepts(inp.kind, r.shape, r.lastValue))
                    .map((r) => ({ key: feedKey(r) }));
                return (
                    <Box key={inp.name} sx={{ display: 'flex', alignItems: 'center', gap: 1, flexWrap: 'wrap' }}>
                        <Typography variant="body2" sx={{ minWidth: 110 }}>
                            <code>{inp.name}</code>{' '}
                            <Typography component="span" variant="caption" color="text.secondary">
                                {inp.kind}
                            </Typography>
                        </Typography>
                        <FeedPicker
                            options={options}
                            disabled={busy !== null}
                            onPick={(k) => {
                                const [source, name] = k.split('/');
                                save([...mappings, { source, name, instance: inst.name, input: inp.name }]);
                            }}
                        />
                        {feeds.map((m) => (
                            <Chip
                                key={feedKey(m)}
                                size="small"
                                label={feedKey(m)}
                                disabled={busy !== null}
                                onDelete={() => save(mappings.filter((x) => x !== m))}
                            />
                        ))}
                        {feeds.length === 0 && <Chip size="small" variant="outlined" label="not wired" />}
                    </Box>
                );
            })}
        </Box>
    );
};

/** A `source/name` box with the fitting feeds the player has heard as suggestions; Enter or a pick adds the feed. */
const FeedPicker: React.FC<{ options: FeedOption[]; disabled: boolean; onPick: (key: string) => void }> = ({
    options,
    disabled,
    onPick,
}) => {
    const [text, setText] = useState('');
    const valid = FEED_RE.test(text);
    const sorted = [...options].sort((a, b) => byName(a.key, b.key));
    const pick = (key: string) => {
        if (!FEED_RE.test(key)) return;
        onPick(key);
        setText('');
    };
    return (
        <Autocomplete
            freeSolo
            size="small"
            disabled={disabled}
            options={sorted}
            getOptionLabel={(o) => (typeof o === 'string' ? o : o.key)}
            value={null}
            inputValue={text}
            onInputChange={(_, v) => setText((v ?? '').toLowerCase())}
            onChange={(_, v) => {
                if (typeof v === 'string') pick(v);
                else if (v) pick(v.key);
            }}
            renderOption={(props, o) => (
                <li {...props} key={o.key}>
                    <code>{o.key}</code>
                </li>
            )}
            sx={{ width: 230 }}
            renderInput={(params) => (
                <TextField {...params} label="Add a feed" placeholder="source/name" error={text !== '' && !valid} />
            )}
        />
    );
};

/** The other end: what has posted to this player lately and where each one goes. */
const InputsSection: React.FC<{ state: AppsState; busy: string | null; playerUrl: string; command: Command }> = ({
    state,
    busy,
    playerUrl,
    command,
}) => {
    const recent = state.recentInputs ?? [];
    const appsById = useMemo(() => new Map(state.apps.map((a) => [a.id, a])), [state.apps]);
    const titleOf = (instance: string) => state.instances.find((i) => i.name === instance)?.title ?? instance;
    // An app that posted with its token is named; anything else is known by its address.
    const sentBy = (s: AppInputSender | undefined) =>
        s?.instance ? `, sent by ${titleOf(s.instance)}` : s?.address ? `, from ${s.address}` : '';
    // Every input every instance declares, so a heard post can be wired from here too.
    const targets = state.instances
        .flatMap((i) =>
            (appsById.get(i.appId)?.manifest?.inputs ?? []).map((inp) => ({
                instance: i.name,
                title: i.title ?? i.name,
                input: inp.name,
                kind: inp.kind,
            })),
        )
        .sort((a, b) => byName(a.title, b.title) || byName(a.input, b.input));
    const save = (next: AppInputMapping[]) => void command({ op: 'setInputMappings', mappings: next });

    return (
        <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1.5 }}>
            <Typography variant="h6">Show input events received recently</Typography>
            <Typography color="text.secondary" variant="body2">
                Recent input events received (posted to <code>{inputsUrl(playerUrl)}</code>) are listed below. This
                should help in diagnosing whether EZPlayer is receiving your input events. Once input events have been
                received, you can map them to one or more target apps. (You can also configure inputs on each app's
                configuration card.)
            </Typography>
            {recent.length === 0 && (
                <Typography color="text.secondary" variant="body2">
                    No input events have been received since the player started.
                </Typography>
            )}
            {recent.slice(0, 12).map((r) => {
                const key = feedKey(r);
                const to = state.inputMappings.filter((m) => m.source === r.source && m.name === r.name);
                const wired = new Set(to.map((m) => `${m.instance}/${m.input}`));
                const open = targets.filter((t) => !wired.has(`${t.instance}/${t.input}`));
                return (
                    <Box key={key} sx={{ display: 'flex', alignItems: 'center', gap: 1, flexWrap: 'wrap' }}>
                        <Typography variant="body2">
                            <code>{key}</code> · {r.count} {r.count === 1 ? 'post' : 'posts'}, last {ago(r.lastAt)}
                            {sentBy(r.sender)}
                            {r.lastValue !== undefined && (
                                <Typography component="span" variant="caption" color="text.secondary">
                                    {' '}
                                    {r.lastValue}
                                </Typography>
                            )}
                        </Typography>
                        {to.map((m) => (
                            <Chip
                                key={`${m.instance}/${m.input}`}
                                size="small"
                                label={`→ ${titleOf(m.instance)} · ${m.input}`}
                                disabled={busy !== null}
                                onDelete={() => save(state.inputMappings.filter((x) => x !== m))}
                            />
                        ))}
                        {to.length === 0 && (
                            <Chip size="small" variant="outlined" color="warning" label="nothing listens" />
                        )}
                        {open.length > 0 && !open.some((t) => inputAccepts(t.kind, r.shape, r.lastValue)) && (
                            <Chip
                                size="small"
                                variant="outlined"
                                label={`sends ${SHAPE_WORDS[r.shape] ?? r.shape}; no input takes that`}
                            />
                        )}
                        {open.length > 0 && (
                            <FormControl size="small" sx={{ minWidth: 200 }} disabled={busy !== null}>
                                <InputLabel id={`apps-wire-${key}`}>
                                    {to.length ? 'Also send to…' : 'Send to…'}
                                </InputLabel>
                                <Select
                                    labelId={`apps-wire-${key}`}
                                    label={to.length ? 'Also send to…' : 'Send to…'}
                                    value=""
                                    onChange={(e) => {
                                        const t = open.find((x) => `${x.instance}/${x.input}` === e.target.value);
                                        if (t) {
                                            save([
                                                ...state.inputMappings,
                                                {
                                                    source: r.source,
                                                    name: r.name,
                                                    instance: t.instance,
                                                    input: t.input,
                                                },
                                            ]);
                                        }
                                    }}
                                >
                                    {open.map((t) => {
                                        const fits = inputAccepts(t.kind, r.shape, r.lastValue);
                                        return (
                                            <MenuItem
                                                key={`${t.instance}/${t.input}`}
                                                value={`${t.instance}/${t.input}`}
                                                disabled={!fits}
                                            >
                                                {t.title} · {t.input} ({KIND_WORDS[t.kind] ?? t.kind}
                                                {fits ? '' : `; sends ${SHAPE_WORDS[r.shape] ?? r.shape}`})
                                            </MenuItem>
                                        );
                                    })}
                                </Select>
                            </FormControl>
                        )}
                    </Box>
                );
            })}
        </Box>
    );
};

// -- runtime ------------------------------------------------------------------------

const RuntimeSection: React.FC<{ state: AppsState; busy: string | null; command: Command }> = ({
    state,
    busy,
    command,
}) => {
    const [typed, setTyped] = useState<string | null>(null);
    const value = typed ?? state.pythonPath ?? '';
    const candidates = state.pythonCandidates ?? [];
    const canBrowse = typeof window !== 'undefined' && typeof window.electronAPI?.selectFiles === 'function';
    const save = (p: string) => {
        setTyped(null);
        void command({ op: 'setPythonPath', path: p }, 'python');
    };
    return (
        <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1 }}>
            <Typography variant="h6">Runtimes</Typography>
            <Typography color="text.secondary" variant="body2">
                JavaScript apps run with the player's own Node. Python apps need Python 3 on this computer; the player
                finds one on the PATH unless you point it at a particular one. A path is saved only after it answers as
                a Python 3.
            </Typography>
            <Box sx={{ display: 'flex', gap: 1, alignItems: 'center', flexWrap: 'wrap' }}>
                <TextField
                    size="small"
                    label="Python 3 executable"
                    value={value}
                    placeholder="python3 on the PATH"
                    disabled={busy !== null}
                    onChange={(e) => setTyped(e.target.value)}
                    sx={{ flex: 1, minWidth: 280 }}
                />
                {canBrowse && (
                    <Button
                        variant="outlined"
                        startIcon={<FolderOpenIcon />}
                        disabled={busy !== null}
                        onClick={async () => {
                            const picked = await window.electronAPI!.selectFiles({
                                title: 'Pick the Python executable',
                            });
                            if (picked?.[0]) save(picked[0]);
                        }}
                    >
                        Browse
                    </Button>
                )}
                <Button
                    variant="outlined"
                    disabled={busy !== null}
                    onClick={() => void command({ op: 'findPython' }, 'findPython')}
                >
                    {busy === 'findPython' ? <CircularProgress size={18} /> : 'Find Pythons'}
                </Button>
                <Button variant="contained" disabled={busy !== null || typed === null} onClick={() => save(value)}>
                    {busy === 'python' ? <CircularProgress size={18} /> : 'Save'}
                </Button>
            </Box>
            {state.pythonCandidates && (
                <Box>
                    {candidates.length === 0 ? (
                        <Typography variant="body2" color="text.secondary">
                            No Python 3 was found. Install it from python.org (on Windows, tick "Add python.exe to
                            PATH").
                        </Typography>
                    ) : (
                        <Stack spacing={0.5}>
                            {candidates.map((c) => (
                                <Box key={c.path} sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                                    <Typography variant="body2" sx={{ fontFamily: 'monospace' }}>
                                        {c.path}
                                    </Typography>
                                    <Typography variant="body2" color="text.secondary">
                                        {c.version}
                                    </Typography>
                                    <Button
                                        size="small"
                                        disabled={busy !== null || state.pythonPath === c.path}
                                        onClick={() => save(c.path)}
                                    >
                                        {state.pythonPath === c.path ? 'In use' : 'Use this one'}
                                    </Button>
                                </Box>
                            ))}
                        </Stack>
                    )}
                </Box>
            )}
        </Box>
    );
};
