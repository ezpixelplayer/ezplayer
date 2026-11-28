import React, { useEffect, useMemo, useState } from 'react';
import { Box } from '../box/Box';
import {
    Alert,
    Button,
    Checkbox,
    Dialog,
    DialogActions,
    DialogContent,
    DialogTitle,
    FormControlLabel,
    IconButton,
    List,
    ListItemButton,
    MenuItem,
    Radio,
    Stack,
    TextField,
    Tooltip,
    Typography,
    useMediaQuery,
    useTheme,
} from '@mui/material';
import AddIcon from '@mui/icons-material/Add';
import DeleteOutlineIcon from '@mui/icons-material/DeleteOutline';
import TuneIcon from '@mui/icons-material/Tune';
import {
    assignProfile,
    createProfile,
    deleteProfile,
    freeProfileName,
    ownTweakKeys,
    profileCandidates,
    profileMembers,
    suggestProfiles,
    suggestionForModel,
    type ActiveTest,
    type OutputProfile,
    type ProfileSuggestion,
    type TestTweakDoc,
    type TweakModelInfo,
    type XlModelGroup,
} from '@ezplayer/ezplayer-core';
import { AddFromMenu } from './Dialogs';
import { ModelChecklist } from './ModelChecklist';
import { loadPattern } from './TestPanel';
import { TweakFields, tweakChips } from './TweakFields';
import { newId } from './useTestTweak';

type UpdateDoc = (change: (doc: TestTweakDoc) => TestTweakDoc) => void;

const count = (n: number, word: string) => `${n} ${word}${n === 1 ? '' : 's'}`;
const some = (names: string[], n = 4) => `${names.slice(0, n).join(', ')}${names.length > n ? '…' : ''}`;
const KEY_NAMES = {
    colorOrder: 'color order',
    brightness: 'brightness',
    gamma: 'gamma',
    colorTempK: 'color temperature',
};

const BLANK = '';

/**
 * Start a profile.  The settings are not typed in: they are taken from how
 * models are set up now (what xLights has for them, or what they set here),
 * and the models set up that way can go straight into the profile.
 *
 * With `fromModel` the profile is that model's; without, every set of models
 * in no profile that share their settings is offered, and a blank one.
 */
export const NewProfileDialog: React.FC<{
    open: boolean;
    onClose: () => void;
    /** Called with the new profile's id once it is made. */
    onCreated?: (profileId: string) => void;
    doc: TestTweakDoc;
    updateDoc: UpdateDoc;
    models: TweakModelInfo[];
    fromModel?: TweakModelInfo;
}> = ({ open, onClose, onCreated, doc, updateDoc, models, fromModel }) => {
    const theme = useTheme();
    const small = useMediaQuery(theme.breakpoints.down('sm'));
    const suggestions = useMemo<ProfileSuggestion[]>(
        () => (!open ? [] : fromModel ? [suggestionForModel(doc, models, fromModel)] : suggestProfiles(doc, models)),
        // What is offered is settled when the dialog opens, not as it is used.
        // eslint-disable-next-line react-hooks/exhaustive-deps
        [open, fromModel?.name],
    );
    const [picked, setPicked] = useState(BLANK);
    const [name, setName] = useState('');
    const [named, setNamed] = useState(false);
    const [addAll, setAddAll] = useState(true);
    const suggestion = suggestions.find((s) => s.key === picked);
    const suggestedName = (s: ProfileSuggestion | undefined) =>
        freeProfileName(doc, s ? s.label.replace(/ · /g, ' ') : `Profile ${doc.profiles.length + 1}`);

    useEffect(() => {
        if (!open) return;
        const first = suggestions[0];
        setPicked(first?.key ?? BLANK);
        setName(suggestedName(first));
        setNamed(false);
        setAddAll(true);
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [open, suggestions]);

    const pick = (key: string) => {
        setPicked(key);
        if (!named) setName(suggestedName(suggestions.find((s) => s.key === key)));
    };
    const others = suggestion && fromModel ? suggestion.models.filter((m) => m !== fromModel.name) : [];
    const members = !suggestion
        ? []
        : fromModel
          ? [fromModel.name, ...(addAll ? others : [])]
          : addAll
            ? suggestion.models
            : [];
    const create = () => {
        const id = newId();
        const profile: OutputProfile = {
            id,
            name: name.trim() || suggestedName(suggestion),
            ...(suggestion?.settings ?? {}),
        };
        updateDoc((d) => createProfile(d, profile, members));
        onCreated?.(id);
        onClose();
    };

    return (
        <Dialog open={open} onClose={onClose} fullScreen={small} fullWidth maxWidth="sm">
            <DialogTitle sx={{ pb: 1 }}>{fromModel ? `New profile from ${fromModel.name}` : 'New profile'}</DialogTitle>
            <DialogContent>
                <Stack spacing={2} sx={{ pt: 1 }}>
                    <Typography variant="body2" color="text.secondary">
                        {fromModel
                            ? 'The profile starts with what this model is sent with now: what xLights has for it (string type, dimming curve), or what it sets here.'
                            : 'Models in no profile, by how they are set up now: what xLights has for them (string type, dimming curve), or what they set here. Pick a set to make its profile.'}
                    </Typography>
                    <List dense disablePadding sx={{ border: 1, borderColor: 'divider', borderRadius: 1 }}>
                        {suggestions.map((s) => (
                            <ListItemButton key={s.key} dense selected={picked === s.key} onClick={() => pick(s.key)}>
                                <Radio size="small" edge="start" checked={picked === s.key} tabIndex={-1} />
                                <Box sx={{ minWidth: 0 }}>
                                    <Typography variant="body2">{s.label}</Typography>
                                    <Typography
                                        variant="body2"
                                        color="text.secondary"
                                        noWrap
                                        component="div"
                                        sx={{ fontSize: 12 }}
                                        title={s.models.join(', ')}
                                    >
                                        {count(s.models.length, 'model')}: {some(s.models)}
                                    </Typography>
                                </Box>
                            </ListItemButton>
                        ))}
                        {!fromModel && (
                            <ListItemButton dense selected={picked === BLANK} onClick={() => pick(BLANK)}>
                                <Radio size="small" edge="start" checked={picked === BLANK} tabIndex={-1} />
                                <Box>
                                    <Typography variant="body2">Blank</Typography>
                                    <Typography
                                        variant="body2"
                                        color="text.secondary"
                                        component="div"
                                        sx={{ fontSize: 12 }}
                                    >
                                        Sets nothing until you set it; no models in it yet.
                                    </Typography>
                                </Box>
                            </ListItemButton>
                        )}
                    </List>
                    <TextField
                        size="small"
                        label="Name"
                        helperText="What kind of pixel this is, e.g. 12V bullets."
                        value={name}
                        onChange={(e) => {
                            setName(e.target.value);
                            setNamed(true);
                        }}
                    />
                    {suggestion && (fromModel ? others.length > 0 : true) && (
                        <FormControlLabel
                            control={
                                <Checkbox size="small" checked={addAll} onChange={(e) => setAddAll(e.target.checked)} />
                            }
                            label={
                                <Typography variant="body2">
                                    {fromModel
                                        ? `Also put the ${count(others.length, 'other model')} set up the same way in it (${some(others, 3)})`
                                        : `Put ${suggestion.models.length === 1 ? 'that model' : `those ${suggestion.models.length} models`} in it`}
                                </Typography>
                            }
                        />
                    )}
                    {suggestion && fromModel && !others.length && (
                        <Typography variant="body2" color="text.secondary">
                            No other model in no profile is set up the same way.
                        </Typography>
                    )}
                </Stack>
            </DialogContent>
            <DialogActions>
                <Button onClick={onClose}>Cancel</Button>
                <Button variant="contained" onClick={create}>
                    Create{members.length ? ` with ${count(members.length, 'model')}` : ''}
                </Button>
            </DialogActions>
        </Dialog>
    );
};

/**
 * Output profiles: named sets of color order, brightness, gamma and color
 * temperature (a pixel type, in practice), and the models assigned to each.
 * A model is in one profile at most.
 */
export const ProfilesDialog: React.FC<{
    open: boolean;
    onClose: () => void;
    doc: TestTweakDoc;
    updateDoc: UpdateDoc;
    models: TweakModelInfo[];
    loadXlGroups: () => Promise<XlModelGroup[]>;
    startTest: (test: ActiveTest) => Promise<void>;
    selectedProfile: string | null;
    onSelectProfile: (id: string | null) => void;
    /** Start a new profile (the suggestions dialog). */
    onNewProfile: () => void;
    /** Open one model's own settings. */
    onModelSettings: (model: string) => void;
}> = ({
    open,
    onClose,
    doc,
    updateDoc,
    models,
    loadXlGroups,
    startTest,
    selectedProfile,
    onSelectProfile,
    onNewProfile,
    onModelSettings,
}) => {
    const theme = useTheme();
    const small = useMediaQuery(theme.breakpoints.down('md'));
    const profile =
        (selectedProfile ? doc.profiles.find((p) => p.id === selectedProfile) : undefined) ?? doc.profiles[0];
    const [name, setName] = useState(profile?.name ?? '');
    const [nameFor, setNameFor] = useState(profile?.id);
    if (nameFor !== profile?.id) {
        setNameFor(profile?.id);
        setName(profile?.name ?? '');
    }
    const [note, setNote] = useState('');
    useEffect(() => setNote(''), [profile?.id]);

    const members = useMemo(() => (profile ? profileMembers(doc, profile.id) : []), [doc, profile]);
    const memberSet = useMemo(() => new Set(members), [members]);
    const pixelNames = useMemo(() => new Set(models.filter((m) => m.pixel).map((m) => m.name)), [models]);
    const unassigned = models.filter((m) => m.pixel && !doc.models[m.name]?.profile).length;
    const fitting = useMemo(() => (profile ? profileCandidates(doc, models, profile) : []), [doc, models, profile]);

    const edit = (change: (p: OutputProfile) => OutputProfile) =>
        profile && updateDoc((d) => ({ ...d, profiles: d.profiles.map((p) => (p.id === profile.id ? change(p) : p)) }));
    const commitName = () => {
        const n = name.trim();
        if (profile && n && n !== profile.name) edit((p) => ({ ...p, name: n }));
        else setName(profile?.name ?? '');
    };
    const makeGroup = () => {
        if (!profile) return;
        updateDoc((d) => {
            const at = d.groups.findIndex((g) => g.name === profile.name);
            const groups = [...d.groups];
            if (at >= 0) groups[at] = { id: groups[at].id, name: profile.name, models: members };
            else groups.push({ id: newId(), name: profile.name, models: members });
            return { ...d, groups };
        });
        setNote(`Test group "${profile.name}" now holds these ${count(members.length, 'model')}.`);
    };

    return (
        <Dialog open={open} onClose={onClose} fullScreen={small} fullWidth maxWidth="md">
            <DialogTitle sx={{ pb: 1 }}>
                <Stack direction="row" spacing={1} alignItems="center" sx={{ flexWrap: 'wrap', rowGap: 1 }}>
                    <TextField
                        select
                        size="small"
                        label="Profile"
                        value={profile?.id ?? ''}
                        onChange={(e) => onSelectProfile(e.target.value || null)}
                        disabled={!doc.profiles.length}
                        SelectProps={{ displayEmpty: true }}
                        InputLabelProps={{ shrink: true }}
                        sx={{ minWidth: 220, flex: { xs: 1, sm: 'none' } }}
                    >
                        {!doc.profiles.length && <MenuItem value="">None yet</MenuItem>}
                        {doc.profiles.map((p) => (
                            <MenuItem key={p.id} value={p.id}>
                                {p.name} ({profileMembers(doc, p.id).length})
                            </MenuItem>
                        ))}
                    </TextField>
                    <Button size="small" variant="outlined" startIcon={<AddIcon />} onClick={onNewProfile}>
                        New profile…
                    </Button>
                    <Typography variant="body2" color="text.secondary" sx={{ fontSize: 12, ml: { sm: 'auto' } }}>
                        {unassigned
                            ? `${count(unassigned, 'model')} of ${pixelNames.size} in no profile`
                            : pixelNames.size
                              ? 'Every model is in a profile'
                              : ''}
                    </Typography>
                </Stack>
            </DialogTitle>
            <DialogContent
                dividers
                sx={{
                    p: 0,
                    display: 'flex',
                    flexDirection: { xs: 'column', md: 'row' },
                    height: { md: profile ? '62vh' : 'auto' },
                    overflow: { xs: 'auto', md: 'hidden' },
                }}
            >
                {!profile && (
                    <Typography color="text.secondary" sx={{ p: 3 }}>
                        A profile is a set of output settings for one kind of pixel: its color order, brightness, gamma
                        and color temperature. A model with no profile is sent as xLights has it. New profile suggests
                        one for each set of models xLights sets up alike.
                    </Typography>
                )}
                {profile && (
                    <>
                        <Stack
                            spacing={1.5}
                            sx={{
                                p: 2,
                                width: { xs: '100%', md: 380 },
                                flexShrink: 0,
                                overflowY: { md: 'auto' },
                                borderRight: { md: 1 },
                                borderColor: { md: 'divider' },
                            }}
                        >
                            <Stack direction="row" spacing={1} alignItems="center">
                                <TextField
                                    fullWidth
                                    size="small"
                                    label="Name"
                                    value={name}
                                    onChange={(e) => setName(e.target.value)}
                                    onBlur={commitName}
                                    onKeyDown={(e) => e.key === 'Enter' && commitName()}
                                />
                                <Tooltip title="Delete the profile; its models go back to no profile">
                                    <IconButton
                                        aria-label={`Delete ${profile.name}`}
                                        onClick={() => {
                                            updateDoc((d) => deleteProfile(d, profile.id));
                                            onSelectProfile(null);
                                        }}
                                    >
                                        <DeleteOutlineIcon />
                                    </IconButton>
                                </Tooltip>
                            </Stack>
                            <TweakFields
                                value={profile}
                                onLabel="Set on every member"
                                offLabel="As xLights has each member"
                                onChange={(key, value) =>
                                    edit((p) => {
                                        const { [key]: _old, ...rest } = p;
                                        return (
                                            value === undefined ? rest : { ...rest, [key]: value }
                                        ) as OutputProfile;
                                    })
                                }
                            />
                            <Stack direction="row" spacing={1} sx={{ flexWrap: 'wrap', rowGap: 1 }}>
                                <Tooltip title="Run the pattern last set up on this profile's models, to watch the settings take effect">
                                    <span>
                                        <Button
                                            size="small"
                                            variant="outlined"
                                            disabled={!members.length}
                                            onClick={() =>
                                                void startTest({
                                                    targets: { models: members },
                                                    pattern: loadPattern(),
                                                    ttlMs: 15 * 60_000,
                                                })
                                            }
                                        >
                                            Test on its models
                                        </Button>
                                    </span>
                                </Tooltip>
                                <Button size="small" disabled={!members.length} onClick={makeGroup}>
                                    Make a test group of them
                                </Button>
                            </Stack>
                            {note && (
                                <Typography variant="body2" color="text.secondary" sx={{ fontSize: 12 }}>
                                    {note}
                                </Typography>
                            )}
                        </Stack>
                        <Box
                            sx={{
                                flex: 1,
                                minWidth: 0,
                                minHeight: { xs: 380, md: 0 },
                                display: 'flex',
                                flexDirection: 'column',
                            }}
                        >
                            <Typography variant="subtitle2" sx={{ px: 2, pt: 1.5 }}>
                                Models that use it ({members.length})
                            </Typography>
                            <Typography variant="body2" color="text.secondary" sx={{ fontSize: 12, px: 2 }}>
                                Ticking a model that is in another profile moves it here.
                            </Typography>
                            {fitting.length > 0 && (
                                <Alert
                                    severity="info"
                                    sx={{ mx: 1, mt: 1, py: 0, alignItems: 'center' }}
                                    action={
                                        <Button
                                            color="inherit"
                                            size="small"
                                            onClick={() => {
                                                updateDoc((d) => createProfile(d, profile, fitting));
                                                setNote(`${count(fitting.length, 'model')} added.`);
                                            }}
                                        >
                                            Add {fitting.length === 1 ? 'it' : 'them'}
                                        </Button>
                                    }
                                >
                                    {count(fitting.length, 'model')} in no profile {fitting.length === 1 ? 'is' : 'are'}{' '}
                                    already sent this way: {some(fitting, 3)}
                                </Alert>
                            )}
                            <Box sx={{ flex: 1, minHeight: 0 }}>
                                <ModelChecklist
                                    key={profile.id}
                                    models={models}
                                    checkedFirst
                                    checked={memberSet}
                                    onChange={(next) =>
                                        updateDoc((d) => {
                                            const added = [...next].filter((m) => !memberSet.has(m));
                                            const removed = members.filter((m) => !next.has(m));
                                            return assignProfile(
                                                assignProfile(d, added, profile.id),
                                                removed,
                                                undefined,
                                            );
                                        })
                                    }
                                    note={(m) => {
                                        const own = doc.models[m.name];
                                        const other =
                                            own?.profile && own.profile !== profile.id
                                                ? doc.profiles.find((p) => p.id === own.profile)?.name
                                                : undefined;
                                        const keys = ownTweakKeys(own);
                                        return (
                                            [
                                                other ? `in ${other}` : undefined,
                                                keys.length
                                                    ? `own ${keys.map((k) => KEY_NAMES[k]).join(', ')}`
                                                    : undefined,
                                            ]
                                                .filter(Boolean)
                                                .join(' · ') || undefined
                                        );
                                    }}
                                    action={(m) =>
                                        m.pixel && (
                                            <Tooltip title="Settings just for this model, over the profile's">
                                                <IconButton
                                                    size="small"
                                                    aria-label={`Settings of ${m.name}`}
                                                    onClick={(e) => {
                                                        e.stopPropagation();
                                                        onModelSettings(m.name);
                                                    }}
                                                >
                                                    <TuneIcon fontSize="small" />
                                                </IconButton>
                                            </Tooltip>
                                        )
                                    }
                                    toolbar={
                                        <AddFromMenu
                                            doc={doc}
                                            loadXlGroups={loadXlGroups}
                                            exceptId={profile.id}
                                            onPick={(m, from) => {
                                                const add = m.models.filter((x) => pixelNames.has(x));
                                                updateDoc((d) => assignProfile(d, add, profile.id));
                                                setNote(
                                                    `${count(add.length, 'model')} of ${from} now use${add.length === 1 ? 's' : ''} this profile.`,
                                                );
                                            }}
                                        />
                                    }
                                />
                            </Box>
                        </Box>
                    </>
                )}
            </DialogContent>
            <DialogActions>
                <Typography variant="body2" color="text.secondary" sx={{ fontSize: 12, mr: 'auto', pl: 1 }}>
                    {profile ? `${profile.name} sets ${tweakChips(profile).join(', ') || 'nothing yet'}.` : ''}
                </Typography>
                <Button variant="contained" onClick={onClose}>
                    Done
                </Button>
            </DialogActions>
        </Dialog>
    );
};
