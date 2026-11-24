import React, { useMemo, useState } from 'react';
import { Box } from '../box/Box';
import { Button, IconButton, List, ListItemButton, Paper, Stack, TextField, Tooltip, Typography } from '@mui/material';
import AddIcon from '@mui/icons-material/Add';
import DeleteOutlineIcon from '@mui/icons-material/DeleteOutline';
import TuneIcon from '@mui/icons-material/Tune';
import {
    assignProfile,
    deleteProfile,
    ownTweakKeys,
    profileMembers,
    type ActiveTest,
    type OutputProfile,
    type TestTweakDoc,
    type TestTweakSnapshot,
    type TweakModelInfo,
    type XlModelGroup,
} from '@ezplayer/ezplayer-core';
import { AddFromMenu, ModelSettingsDialog } from './Dialogs';
import { ModelChecklist } from './ModelChecklist';
import { loadPattern } from './TestPanel';
import { TweakFields, tweakChips } from './TweakFields';
import { newId } from './useTestTweak';

export interface ProfilesViewProps {
    doc: TestTweakDoc;
    updateDoc: (change: (doc: TestTweakDoc) => TestTweakDoc) => void;
    snapshot?: TestTweakSnapshot;
    loadXlGroups: () => Promise<XlModelGroup[]>;
    startTest: (test: ActiveTest) => Promise<void>;
    selectedProfile: string | null;
    onSelectProfile: (id: string | null) => void;
}

const count = (n: number, word: string) => `${n} ${word}${n === 1 ? '' : 's'}`;
const KEY_NAMES = {
    colorOrder: 'color order',
    brightness: 'brightness',
    gamma: 'gamma',
    colorTempK: 'color temperature',
};

/**
 * Output profiles: named sets of color order, brightness, gamma and color
 * temperature (a pixel type, in practice), and the models assigned to each.
 * A model is in one profile at most.
 */
export const ProfilesView: React.FC<ProfilesViewProps> = ({
    doc,
    updateDoc,
    snapshot,
    loadXlGroups,
    startTest,
    selectedProfile,
    onSelectProfile,
}) => {
    const models: TweakModelInfo[] = useMemo(() => snapshot?.models ?? [], [snapshot?.models]);
    const profile = selectedProfile ? doc.profiles.find((p) => p.id === selectedProfile) : undefined;
    const [name, setName] = useState(profile?.name ?? '');
    const [nameFor, setNameFor] = useState(profile?.id);
    if (nameFor !== profile?.id) {
        setNameFor(profile?.id);
        setName(profile?.name ?? '');
    }
    const [settingsFor, setSettingsFor] = useState<string | null>(null);
    const [note, setNote] = useState('');

    const members = useMemo(() => (profile ? profileMembers(doc, profile.id) : []), [doc, profile]);
    const memberSet = useMemo(() => new Set(members), [members]);
    const pixelNames = useMemo(() => new Set(models.filter((m) => m.pixel).map((m) => m.name)), [models]);
    const unassigned = models.filter((m) => m.pixel && !doc.models[m.name]?.profile).length;

    const edit = (change: (p: OutputProfile) => OutputProfile) =>
        profile && updateDoc((d) => ({ ...d, profiles: d.profiles.map((p) => (p.id === profile.id ? change(p) : p)) }));
    const commitName = () => {
        const n = name.trim();
        if (profile && n && n !== profile.name) edit((p) => ({ ...p, name: n }));
        else setName(profile?.name ?? '');
    };
    const addProfile = () => {
        const id = newId();
        updateDoc((d) => ({ ...d, profiles: [...d.profiles, { id, name: `Profile ${d.profiles.length + 1}` }] }));
        onSelectProfile(id);
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
        <Box
            sx={{
                flex: 1,
                minHeight: 0,
                display: 'flex',
                flexDirection: { xs: 'column', md: 'row' },
                gap: 2,
                overflow: 'hidden',
            }}
        >
            <Paper
                sx={{
                    width: { xs: '100%', md: 280 },
                    maxHeight: { xs: '30%', md: 'none' },
                    flexShrink: 0,
                    minHeight: 0,
                    display: 'flex',
                    flexDirection: 'column',
                    overflow: 'hidden',
                }}
            >
                <Stack spacing={0.5} alignItems="flex-start" sx={{ p: 1, flexShrink: 0 }}>
                    <Button
                        size="small"
                        variant="outlined"
                        startIcon={<AddIcon />}
                        onClick={addProfile}
                        sx={{ whiteSpace: 'nowrap' }}
                    >
                        New profile
                    </Button>
                    <Typography variant="body2" color="text.secondary" sx={{ fontSize: 12 }}>
                        {unassigned
                            ? `${count(unassigned, 'model')} of ${pixelNames.size} in no profile`
                            : pixelNames.size
                              ? 'Every model is in a profile'
                              : ''}
                    </Typography>
                </Stack>
                <List dense disablePadding sx={{ flex: 1, minHeight: 0, overflowY: 'auto' }}>
                    {doc.profiles.map((p) => {
                        const chips = tweakChips(p);
                        return (
                            <ListItemButton
                                key={p.id}
                                dense
                                selected={p.id === selectedProfile}
                                onClick={() => onSelectProfile(p.id)}
                            >
                                <Box sx={{ minWidth: 0, flex: 1 }}>
                                    <Typography variant="body2" noWrap title={p.name}>
                                        {p.name}
                                    </Typography>
                                    <Typography
                                        variant="body2"
                                        color="text.secondary"
                                        noWrap
                                        component="div"
                                        sx={{ fontSize: 12 }}
                                    >
                                        {count(profileMembers(doc, p.id).length, 'model')} ·{' '}
                                        {chips.length ? chips.join(' ') : 'sets nothing yet'}
                                    </Typography>
                                </Box>
                            </ListItemButton>
                        );
                    })}
                    {!doc.profiles.length && (
                        <Typography variant="body2" color="text.secondary" sx={{ p: 2 }}>
                            A profile is a set of output settings for one kind of pixel: its color order, brightness,
                            gamma and color temperature. Make one, set it up, then tick the models that use it.
                        </Typography>
                    )}
                </List>
            </Paper>

            <Paper
                sx={{
                    flex: 1,
                    minWidth: 0,
                    minHeight: 0,
                    display: 'flex',
                    flexDirection: 'column',
                    overflow: 'hidden',
                }}
            >
                {!profile && (
                    <Typography color="text.secondary" sx={{ p: 3 }}>
                        {doc.profiles.length ? 'Pick a profile to set it up.' : 'No profiles yet.'}
                    </Typography>
                )}
                {profile && (
                    <Box
                        sx={{
                            flex: 1,
                            minHeight: 0,
                            display: 'flex',
                            flexDirection: { xs: 'column', lg: 'row' },
                            overflow: { xs: 'auto', lg: 'hidden' },
                        }}
                    >
                        <Stack
                            spacing={1.5}
                            sx={{
                                p: 2,
                                width: { xs: '100%', lg: 380 },
                                flexShrink: 0,
                                overflowY: { lg: 'auto' },
                                borderRight: { lg: 1 },
                                borderColor: { lg: 'divider' },
                            }}
                        >
                            <Stack direction="row" spacing={1} alignItems="center">
                                <TextField
                                    fullWidth
                                    size="small"
                                    label="Profile"
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
                                offLabel="Leave each member's as it is"
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
                                <Tooltip title="Run the pattern last set up on the Test tab on this profile's models, to watch the settings take effect">
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
                                minHeight: { xs: 360, lg: 0 },
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
                                                    aria-label={`Output settings of ${m.name}`}
                                                    onClick={(e) => {
                                                        e.stopPropagation();
                                                        setSettingsFor(m.name);
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
                    </Box>
                )}
            </Paper>

            <ModelSettingsDialog
                model={settingsFor ? models.find((m) => m.name === settingsFor) : undefined}
                onClose={() => setSettingsFor(null)}
                doc={doc}
                updateDoc={updateDoc}
            />
        </Box>
    );
};
