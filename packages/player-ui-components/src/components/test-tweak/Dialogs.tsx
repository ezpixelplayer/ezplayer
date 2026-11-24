import React, { useEffect, useState } from 'react';
import { Box } from '../box/Box';
import {
    Button,
    Checkbox,
    Dialog,
    DialogActions,
    DialogContent,
    DialogTitle,
    Divider,
    List,
    ListItemButton,
    ListSubheader,
    Menu,
    MenuItem,
    Stack,
    TextField,
    Typography,
    useMediaQuery,
    useTheme,
} from '@mui/material';
import PlaylistAddIcon from '@mui/icons-material/PlaylistAdd';
import {
    assignProfile,
    effectiveTweak,
    ownTweakKeys,
    profileMembers,
    setModelTweak,
    type TestGroup,
    type TestTweakDoc,
    type TweakModelInfo,
    type XlModelGroup,
} from '@ezplayer/ezplayer-core';
import { ModelChecklist } from './ModelChecklist';
import { TweakFields, tweakChips } from './TweakFields';
import { newId } from './useTestTweak';

type UpdateDoc = (change: (doc: TestTweakDoc) => TestTweakDoc) => void;

/** Models and submodels picked in one go from somewhere else. */
export interface Members {
    models: string[];
    subModels: string[];
}

const count = (n: number, word: string) => `${n} ${word}${n === 1 ? '' : 's'}`;

/**
 * "Add from…": take the members of a test group, a profile or an xLights
 * group.  This is how lists are combined and how a profile is filled in bulk.
 */
export const AddFromMenu: React.FC<{
    doc: TestTweakDoc;
    loadXlGroups: () => Promise<XlModelGroup[]>;
    onPick: (members: Members, from: string) => void;
    /** A group or profile not to offer (the one being edited). */
    exceptId?: string;
    label?: string;
}> = ({ doc, loadXlGroups, onPick, exceptId, label = 'Add from…' }) => {
    const [anchor, setAnchor] = useState<HTMLElement | null>(null);
    const [xl, setXl] = useState<XlModelGroup[] | 'loading' | 'failed'>('loading');
    const open = (el: HTMLElement) => {
        setAnchor(el);
        setXl('loading');
        loadXlGroups().then(setXl, () => setXl('failed'));
    };
    const pick = (members: Members, from: string) => {
        setAnchor(null);
        onPick(members, from);
    };
    const groups = doc.groups.filter((g) => g.id !== exceptId);
    const profiles = doc.profiles.filter((p) => p.id !== exceptId);
    return (
        <>
            <Button size="small" startIcon={<PlaylistAddIcon />} onClick={(e) => open(e.currentTarget)}>
                {label}
            </Button>
            <Menu
                anchorEl={anchor}
                open={!!anchor}
                onClose={() => setAnchor(null)}
                slotProps={{ paper: { sx: { maxHeight: 420, minWidth: 240 } } }}
            >
                <ListSubheader sx={{ lineHeight: '32px' }}>Test groups</ListSubheader>
                {groups.map((g) => (
                    <MenuItem
                        key={g.id}
                        dense
                        onClick={() => pick({ models: g.models, subModels: g.subModels ?? [] }, g.name)}
                    >
                        {g.name} ({g.models.length + (g.subModels?.length ?? 0)})
                    </MenuItem>
                ))}
                {!groups.length && (
                    <MenuItem dense disabled>
                        None
                    </MenuItem>
                )}
                <Divider />
                <ListSubheader sx={{ lineHeight: '32px' }}>Profiles</ListSubheader>
                {profiles.map((p) => {
                    const members = profileMembers(doc, p.id);
                    return (
                        <MenuItem key={p.id} dense onClick={() => pick({ models: members, subModels: [] }, p.name)}>
                            {p.name} ({members.length})
                        </MenuItem>
                    );
                })}
                {!profiles.length && (
                    <MenuItem dense disabled>
                        None
                    </MenuItem>
                )}
                <Divider />
                <ListSubheader sx={{ lineHeight: '32px' }}>xLights groups</ListSubheader>
                {xl === 'loading' && (
                    <MenuItem dense disabled>
                        Loading…
                    </MenuItem>
                )}
                {xl === 'failed' && (
                    <MenuItem dense disabled>
                        The player did not answer
                    </MenuItem>
                )}
                {Array.isArray(xl) &&
                    xl.map((g) => (
                        <MenuItem
                            key={g.name}
                            dense
                            onClick={() => pick({ models: g.models, subModels: g.subModels }, g.name)}
                        >
                            {g.name} ({g.models.length + g.subModels.length})
                        </MenuItem>
                    ))}
                {Array.isArray(xl) && !xl.length && (
                    <MenuItem dense disabled>
                        The layout has none
                    </MenuItem>
                )}
            </Menu>
        </>
    );
};

/** Edit one test group: its name and, as a list to tick, what is in it. Changes are saved as they are made. */
export const GroupEditorDialog: React.FC<{
    group: TestGroup | undefined;
    onClose: () => void;
    doc: TestTweakDoc;
    updateDoc: UpdateDoc;
    models: TweakModelInfo[];
    baseUrl?: string;
    loadXlGroups: () => Promise<XlModelGroup[]>;
}> = ({ group, onClose, doc, updateDoc, models, baseUrl, loadXlGroups }) => {
    const theme = useTheme();
    const small = useMediaQuery(theme.breakpoints.down('sm'));
    const [name, setName] = useState('');
    useEffect(() => setName(group?.name ?? ''), [group?.id]); // eslint-disable-line react-hooks/exhaustive-deps
    if (!group) return null;

    const edit = (change: (g: TestGroup) => TestGroup) =>
        updateDoc((d) => ({ ...d, groups: d.groups.map((g) => (g.id === group.id ? change(g) : g)) }));
    const setSubModels = (subs: string[]) =>
        edit(({ subModels: _, ...g }) => (subs.length ? { ...g, subModels: subs } : g));
    const commitName = () => {
        const n = name.trim();
        if (n && n !== group.name) edit((g) => ({ ...g, name: n }));
        else setName(group.name);
    };
    const known = new Set(models.map((m) => m.name));
    const gone = group.models.filter((m) => !known.has(m));

    return (
        <Dialog open onClose={onClose} fullScreen={small} fullWidth maxWidth="sm">
            <DialogTitle sx={{ pb: 1 }}>
                <TextField
                    fullWidth
                    size="small"
                    label="Test group"
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    onBlur={commitName}
                    onKeyDown={(e) => e.key === 'Enter' && commitName()}
                />
            </DialogTitle>
            <DialogContent sx={{ p: 0, display: 'flex', flexDirection: 'column', height: small ? 'auto' : '60vh' }}>
                <Typography variant="body2" color="text.secondary" sx={{ px: 2 }}>
                    Tick what belongs to the group: {count(group.models.length, 'model')}
                    {group.subModels?.length ? ` and ${count(group.subModels.length, 'submodel')}` : ''} so far. Groups
                    are only for aiming tests; they change no settings.
                    {gone.length
                        ? ` ${count(gone.length, 'member')} not in this layout (${gone.slice(0, 3).join(', ')}${gone.length > 3 ? '…' : ''}) are kept.`
                        : ''}
                </Typography>
                <Box sx={{ flex: 1, minHeight: 0 }}>
                    <ModelChecklist
                        key={group.id}
                        models={models}
                        baseUrl={baseUrl}
                        checkedFirst
                        checked={new Set(group.models)}
                        onChange={(next) =>
                            edit((g) => ({
                                ...g,
                                // Members the layout no longer has are not on the list to untick: keep them.
                                models: [...new Set([...g.models.filter((m) => !known.has(m)), ...next])].sort(),
                            }))
                        }
                        checkedSubModels={new Set(group.subModels ?? [])}
                        onChangeSubModels={(next) => setSubModels([...next].sort())}
                        toolbar={
                            <AddFromMenu
                                doc={doc}
                                loadXlGroups={loadXlGroups}
                                exceptId={group.id}
                                onPick={(m) => {
                                    edit((g) => ({ ...g, models: [...new Set([...g.models, ...m.models])].sort() }));
                                    if (m.subModels.length)
                                        setSubModels([...new Set([...(group.subModels ?? []), ...m.subModels])].sort());
                                }}
                            />
                        }
                    />
                </Box>
            </DialogContent>
            <DialogActions>
                <Button variant="contained" onClick={onClose}>
                    Done
                </Button>
            </DialogActions>
        </Dialog>
    );
};

/** Copy xLights model groups into test groups, flattened to the models and submodels they reach. */
export const XlGroupImportDialog: React.FC<{
    open: boolean;
    onClose: () => void;
    doc: TestTweakDoc;
    updateDoc: UpdateDoc;
    loadXlGroups: () => Promise<XlModelGroup[]>;
}> = ({ open, onClose, doc, updateDoc, loadXlGroups }) => {
    const theme = useTheme();
    const small = useMediaQuery(theme.breakpoints.down('sm'));
    const [xl, setXl] = useState<XlModelGroup[] | 'loading' | 'failed'>('loading');
    const [picked, setPicked] = useState<Set<string>>(new Set());
    useEffect(() => {
        if (!open) return;
        setPicked(new Set());
        setXl('loading');
        loadXlGroups().then(setXl, () => setXl('failed'));
    }, [open, loadXlGroups]);

    const existing = new Set(doc.groups.map((g) => g.name));
    const list = Array.isArray(xl) ? xl : [];
    const toggle = (name: string) => {
        const next = new Set(picked);
        if (next.has(name)) next.delete(name);
        else next.add(name);
        setPicked(next);
    };
    const copy = () => {
        updateDoc((d) => {
            const groups = [...d.groups];
            for (const g of list) {
                if (!picked.has(g.name)) continue;
                const members = {
                    models: [...g.models].sort(),
                    ...(g.subModels.length ? { subModels: [...g.subModels].sort() } : {}),
                };
                const at = groups.findIndex((x) => x.name === g.name);
                if (at >= 0) groups[at] = { id: groups[at].id, name: g.name, ...members };
                else groups.push({ id: newId(), name: g.name, ...members });
            }
            return { ...d, groups };
        });
        onClose();
    };

    return (
        <Dialog open={open} onClose={onClose} fullScreen={small} fullWidth maxWidth="sm">
            <DialogTitle>Copy groups from xLights</DialogTitle>
            <DialogContent sx={{ p: 0 }}>
                <Typography variant="body2" color="text.secondary" sx={{ px: 3, pb: 1 }}>
                    Each becomes a test group holding the models and submodels it reaches, groups inside it included. A
                    copy does not follow later changes in xLights; copy again to refresh it.
                </Typography>
                {xl === 'loading' && <Typography sx={{ px: 3, py: 2 }}>Loading…</Typography>}
                {xl === 'failed' && (
                    <Typography color="error" sx={{ px: 3, py: 2 }}>
                        The player did not answer.
                    </Typography>
                )}
                {Array.isArray(xl) && !xl.length && (
                    <Typography sx={{ px: 3, py: 2 }}>This layout has no model groups.</Typography>
                )}
                {!!list.length && (
                    <>
                        <Stack direction="row" spacing={1} sx={{ px: 2 }}>
                            <Button size="small" onClick={() => setPicked(new Set(list.map((g) => g.name)))}>
                                Tick all
                            </Button>
                            <Button size="small" disabled={!picked.size} onClick={() => setPicked(new Set())}>
                                Clear all
                            </Button>
                        </Stack>
                        <List dense disablePadding>
                            {list.map((g) => (
                                <ListItemButton key={g.name} dense onClick={() => toggle(g.name)} sx={{ py: 0 }}>
                                    <Checkbox size="small" edge="start" checked={picked.has(g.name)} tabIndex={-1} />
                                    <Box sx={{ minWidth: 0 }}>
                                        <Typography variant="body2" noWrap>
                                            {g.name}
                                        </Typography>
                                        <Typography
                                            variant="body2"
                                            color="text.secondary"
                                            noWrap
                                            component="div"
                                            sx={{ fontSize: 12 }}
                                        >
                                            {count(g.models.length, 'model')}
                                            {g.subModels.length ? `, ${count(g.subModels.length, 'submodel')}` : ''}
                                            {existing.has(g.name) ? ' · replaces the test group of this name' : ''}
                                        </Typography>
                                    </Box>
                                </ListItemButton>
                            ))}
                        </List>
                    </>
                )}
            </DialogContent>
            <DialogActions>
                <Button onClick={onClose}>Cancel</Button>
                <Button variant="contained" disabled={!picked.size} onClick={copy}>
                    Copy {picked.size || ''}
                </Button>
            </DialogActions>
        </Dialog>
    );
};

/** One model's output settings: which profile it is in, and what it sets for itself over that profile. */
export const ModelSettingsDialog: React.FC<{
    model: TweakModelInfo | undefined;
    onClose: () => void;
    doc: TestTweakDoc;
    updateDoc: UpdateDoc;
}> = ({ model, onClose, doc, updateDoc }) => {
    const theme = useTheme();
    const small = useMediaQuery(theme.breakpoints.down('sm'));
    if (!model) return null;
    const own = doc.models[model.name] ?? {};
    const profile = own.profile ? doc.profiles.find((p) => p.id === own.profile) : undefined;
    const eff = tweakChips(effectiveTweak(doc, model.name), true);
    const xl = [
        model.xlColorOrder,
        model.xlBrightness !== undefined ? `${model.xlBrightness}%` : undefined,
        model.xlGamma !== undefined ? `γ ${model.xlGamma}` : undefined,
    ].filter(Boolean);
    return (
        <Dialog open onClose={onClose} fullScreen={small} fullWidth maxWidth="xs">
            <DialogTitle>{model.name}</DialogTitle>
            <DialogContent>
                <Stack spacing={2} sx={{ pt: 1 }}>
                    <TextField
                        select
                        size="small"
                        label="Profile"
                        value={profile?.id ?? ''}
                        onChange={(e) => updateDoc((d) => assignProfile(d, [model.name], e.target.value || undefined))}
                        helperText={
                            profile
                                ? `${profile.name} sets ${tweakChips(profile).join(', ') || 'nothing yet'}.`
                                : 'A model is in one profile at most.'
                        }
                        SelectProps={{ displayEmpty: true }}
                        InputLabelProps={{ shrink: true }}
                    >
                        <MenuItem value="">None</MenuItem>
                        {doc.profiles.map((p) => (
                            <MenuItem key={p.id} value={p.id}>
                                {p.name}
                            </MenuItem>
                        ))}
                    </TextField>
                    <Typography variant="subtitle2">Just for this model</Typography>
                    <TweakFields
                        value={own}
                        inherited={profile}
                        onLabel="Set for this model"
                        offLabel={profile ? "Use the profile's" : 'Leave as it is'}
                        onChange={(key, value) => updateDoc((d) => setModelTweak(d, model.name, key, value))}
                    />
                    <Typography variant="body2" color="text.secondary">
                        In effect: {eff.length ? eff.join(', ') : 'no change'}
                        {ownTweakKeys(own).length && profile ? ' (this model overrides its profile)' : ''}.
                        {xl.length ? ` xLights has ${xl.join(', ')} on this model's controller connection.` : ''}
                    </Typography>
                </Stack>
            </DialogContent>
            <DialogActions>
                <Button variant="contained" onClick={onClose}>
                    Done
                </Button>
            </DialogActions>
        </Dialog>
    );
};
