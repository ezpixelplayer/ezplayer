import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
    Alert,
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
    AppInputMapping,
    AppInstallSource,
    AppInstanceStatus,
    AppsCommand,
    AppsState,
    CloudPollScheduleEntry,
    InstalledApp,
} from '@ezplayer/ezplayer-core';
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
            <InputsSection state={state} busy={busy} command={command} />
            <Divider />
            <RuntimeSection state={state} busy={busy} command={command} />
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
                    busy={busy}
                    playerUrl={playerUrl}
                    command={command}
                />
            ))}

            <Dialog open={creating} onClose={() => setCreating(false)} fullWidth maxWidth="xs">
                <DialogTitle>Add an instance</DialogTitle>
                <DialogContent sx={{ display: 'flex', flexDirection: 'column', gap: 2, pt: 1 }}>
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
    busy: string | null;
    playerUrl: string;
    command: Command;
}> = ({ inst, app, busy, playerUrl, command }) => {
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
                <Chip size="small" label={inst.state} color={STATE_COLOR[inst.state]} />
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
                        helperText="Say where to go to play, like “Tetris on the big tree by the nutcracker”. Blank uses the app's own words."
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
                    <TextField
                        size="small"
                        type="number"
                        label="Events per minute accepted"
                        defaultValue={inst.eventsPerMinute ?? manifest?.events?.perMinute ?? 600}
                        inputProps={{ min: 1, max: 6000 }}
                        helperText={`Taps from every phone together, ${
                            manifest?.events?.perMinute
                                ? `${manifest.events.perMinute} asked for by the app`
                                : '600 unless the app asks for more'
                        }. Each phone on its own is held to ${manifest?.events?.perClientPerSecond ?? 10} a second.`}
                        onBlur={(e) => {
                            const n = Number(e.target.value);
                            if (n !== (inst.eventsPerMinute ?? manifest?.events?.perMinute ?? 600)) {
                                void command({ op: 'setInstance', name: inst.name, patch: { eventsPerMinute: n } });
                            }
                        }}
                        sx={{ maxWidth: 260 }}
                    />
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

/** The default windows every instance follows unless it has its own. */
const AvailabilitySection: React.FC<{ state: AppsState; busy: string | null; command: Command }> = ({
    state,
    busy,
    command,
}) => (
    <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1 }}>
        <Typography variant="h6">Availability</Typography>
        <Typography color="text.secondary" variant="body2">
            When enabled instances run. Outside these windows an instance is stopped and the show page does not
            list it. Each instance can follow this default or have its own windows.
        </Typography>
        <WindowListEditor
            schedule={state.defaultSchedule}
            noun="availability window"
            emptyText="Always, whenever the instance is enabled. Add a window to limit that."
            disabled={busy !== null}
            onChange={(schedule) => void command({ op: 'setDefaultSchedule', schedule })}
        />
    </Box>
);

/** One instance's choice: the default windows, or its own (none means always). */
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
            <Typography variant="subtitle2">Availability</Typography>
            <RadioGroup row value={own ? 'own' : 'default'} onChange={(e) => set(e.target.value === 'own' ? [] : null)}>
                <FormControlLabel
                    value="default"
                    control={<Radio size="small" />}
                    label="The Apps default"
                    disabled={busy !== null}
                />
                <FormControlLabel
                    value="own"
                    control={<Radio size="small" />}
                    label="Its own windows"
                    disabled={busy !== null}
                />
            </RadioGroup>
            {own && (
                <WindowListEditor
                    schedule={inst.schedule ?? []}
                    noun="availability window"
                    emptyText="Always, whenever enabled. Add a window to limit that."
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

// -- inputs -------------------------------------------------------------------------

const InputsSection: React.FC<{ state: AppsState; busy: string | null; command: Command }> = ({
    state,
    busy,
    command,
}) => {
    const [draft, setDraft] = useState<AppInputMapping>({ source: '', name: '', instance: '', input: '' });
    const appsById = useMemo(() => new Map(state.apps.map((a) => [a.id, a])), [state.apps]);
    const inputsOf = (instance: string) => {
        const inst = state.instances.find((i) => i.name === instance);
        return appsById.get(inst?.appId ?? '')?.manifest?.inputs ?? [];
    };
    const save = (mappings: AppInputMapping[]) => void command({ op: 'setInputMappings', mappings });
    const ok = NAME_RE.test(draft.source) && NAME_RE.test(draft.name) && draft.instance && draft.input;

    return (
        <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1.5 }}>
            <Typography variant="h6">Show inputs</Typography>
            <Typography color="text.secondary" variant="body2">
                A button or sensor posts to <code>/api/ezp/inputs/&lt;source&gt;/&lt;name&gt;</code> on this player.
                Each row sends one of those to an input of an app instance, as if a visitor had tapped it.
            </Typography>
            {state.inputMappings.map((m, i) => (
                <Box key={i} sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                    <Typography variant="body2">
                        <code>
                            {m.source}/{m.name}
                        </code>{' '}
                        → {m.instance} · {m.input}
                    </Typography>
                    <IconButton
                        size="small"
                        disabled={busy !== null}
                        onClick={() => save(state.inputMappings.filter((_, j) => j !== i))}
                    >
                        <DeleteIcon fontSize="small" />
                    </IconButton>
                </Box>
            ))}
            <Box sx={{ display: 'flex', gap: 1, flexWrap: 'wrap', alignItems: 'center' }}>
                <TextField
                    size="small"
                    label="Source"
                    value={draft.source}
                    sx={{ width: 140 }}
                    onChange={(e) => setDraft({ ...draft, source: e.target.value.toLowerCase() })}
                />
                <TextField
                    size="small"
                    label="Name"
                    value={draft.name}
                    sx={{ width: 140 }}
                    onChange={(e) => setDraft({ ...draft, name: e.target.value.toLowerCase() })}
                />
                <FormControl size="small" sx={{ minWidth: 160 }}>
                    <InputLabel id="apps-map-inst">Instance</InputLabel>
                    <Select
                        labelId="apps-map-inst"
                        label="Instance"
                        value={draft.instance}
                        onChange={(e) => setDraft({ ...draft, instance: e.target.value, input: '' })}
                    >
                        {state.instances.map((i) => (
                            <MenuItem key={i.name} value={i.name}>
                                {i.title ?? i.name}
                            </MenuItem>
                        ))}
                    </Select>
                </FormControl>
                <FormControl size="small" sx={{ minWidth: 160 }} disabled={!draft.instance}>
                    <InputLabel id="apps-map-input">Input</InputLabel>
                    <Select
                        labelId="apps-map-input"
                        label="Input"
                        value={draft.input}
                        onChange={(e) => setDraft({ ...draft, input: e.target.value })}
                    >
                        {inputsOf(draft.instance).map((inp) => (
                            <MenuItem key={inp.name} value={inp.name}>
                                {inp.name} ({inp.kind})
                            </MenuItem>
                        ))}
                        {inputsOf(draft.instance).length === 0 && (
                            <MenuItem disabled>This app declares no inputs</MenuItem>
                        )}
                    </Select>
                </FormControl>
                <Button
                    variant="outlined"
                    disabled={busy !== null || !ok}
                    onClick={() => {
                        save([...state.inputMappings, draft]);
                        setDraft({ source: '', name: '', instance: '', input: '' });
                    }}
                >
                    Add
                </Button>
            </Box>
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
