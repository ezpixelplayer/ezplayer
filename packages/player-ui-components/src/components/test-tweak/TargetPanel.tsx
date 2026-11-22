import React, { useEffect, useMemo, useState } from 'react';
import { Box } from '../box/Box';
import {
    Button,
    Checkbox,
    Chip,
    IconButton,
    InputAdornment,
    List,
    ListItemButton,
    Stack,
    Tab,
    Tabs,
    TextField,
    Tooltip,
    Typography,
} from '@mui/material';
import AddIcon from '@mui/icons-material/Add';
import CheckIcon from '@mui/icons-material/Check';
import DeleteOutlineIcon from '@mui/icons-material/DeleteOutline';
import EditIcon from '@mui/icons-material/Edit';
import ExpandLessIcon from '@mui/icons-material/ExpandLess';
import ExpandMoreIcon from '@mui/icons-material/ExpandMore';
import SearchIcon from '@mui/icons-material/Search';
import {
    effectiveTweak,
    isNeutralTweak,
    NEUTRAL_COLOR_TEMP_K,
    type OutputTweak,
    type TestTweakDoc,
    type TweakGroup,
    type TweakModelInfo,
} from '@ezplayer/ezplayer-core';
import { newId } from './useTestTweak';

export interface TargetPanelProps {
    doc: TestTweakDoc;
    updateDoc: (change: (doc: TestTweakDoc) => TestTweakDoc) => void;
    models: TweakModelInfo[];
    /** Models whose wiring comes from the tweak document. */
    rewired: string[];
    /** Models a running test is painting. */
    testing: string[];
    selectedModels: Set<string>;
    onSelectModels: (names: Set<string>) => void;
    /** Submodels picked for testing, as "Model/Submodel". */
    selectedSubModels: Set<string>;
    onSelectSubModels: (names: Set<string>) => void;
    /** The player, for listing a model's submodels when it is opened. */
    baseUrl?: string;
    /** The group being tested or tweaked as a whole; null when working on models. */
    selectedGroup: string | null;
    onSelectGroup: (id: string | null) => void;
}

/** Short labels for what a tweak changes, e.g. "70%", "GRB", "γ 2.2", "3000 K". */
export function tweakChips(
    t: { colorOrder?: string; brightness?: number; gamma?: number; colorTempK?: number },
    brightnessIsFraction = false,
): string[] {
    const out: string[] = [];
    if (t.brightness !== undefined) {
        const pct = brightnessIsFraction ? t.brightness * 100 : t.brightness;
        if (Math.round(pct) !== 100) out.push(`${Math.round(pct)}%`);
    }
    if (t.colorOrder) out.push(t.colorOrder);
    if (t.gamma !== undefined && t.gamma !== 1) out.push(`γ ${t.gamma.toFixed(1)}`);
    if (t.colorTempK !== undefined && t.colorTempK !== NEUTRAL_COLOR_TEMP_K) out.push(`${Math.round(t.colorTempK)} K`);
    return out;
}

const hasTweak = (t: OutputTweak | undefined) => !!t && Object.keys(t).length > 0;

/** A submodel as the player's target list describes it. */
interface SubModelRow {
    /** "Model/Submodel". */
    target: string;
    name: string;
    nodeCount: number;
    strands: number;
}

/** A model's submodels, fetched when the model is first opened; 'failed' when the player did not answer. */
type SubModelList = SubModelRow[] | 'loading' | 'failed';

async function fetchSubModels(baseUrl: string, model: string): Promise<SubModelRow[]> {
    const res = await fetch(`${baseUrl}/api/ezp/overlays/targets?detail=submodels&model=${encodeURIComponent(model)}`);
    const body = (await res.json()) as {
        ok?: boolean;
        targets?: { model: string; subModel?: string; target?: string; nodeCount: number; strands?: number[] }[];
    };
    if (!res.ok || !body.ok) throw new Error('no submodel list');
    return (body.targets ?? [])
        .filter((t) => t.model === model && !!t.subModel)
        .map((t) => ({
            target: t.target ?? `${t.model}/${t.subModel}`,
            name: t.subModel!,
            nodeCount: t.nodeCount,
            strands: t.strands?.length ?? 0,
        }));
}

export const TargetPanel: React.FC<TargetPanelProps> = ({
    doc,
    updateDoc,
    models,
    rewired,
    testing,
    selectedModels,
    onSelectModels,
    selectedSubModels,
    onSelectSubModels,
    baseUrl,
    selectedGroup,
    onSelectGroup,
}) => {
    const [tab, setTab] = useState<'models' | 'groups'>('models');
    const [search, setSearch] = useState('');
    const [newName, setNewName] = useState('');
    const [renaming, setRenaming] = useState<{ id: string; name: string } | null>(null);
    const [open, setOpen] = useState<Set<string>>(() => new Set([...selectedSubModels].map((s) => s.split('/')[0])));
    const [subModels, setSubModels] = useState<Record<string, SubModelList>>({});

    // Submodel lists can be long and most are never looked at: fetch one when its model is opened.
    useEffect(() => {
        if (!baseUrl) return;
        for (const model of open) {
            if (subModels[model] !== undefined) continue;
            setSubModels((s) => ({ ...s, [model]: 'loading' }));
            fetchSubModels(baseUrl, model).then(
                (rows) => setSubModels((s) => ({ ...s, [model]: rows })),
                () => setSubModels((s) => ({ ...s, [model]: 'failed' })),
            );
        }
    }, [open, baseUrl, subModels]);

    const toggleOpen = (model: string) => {
        const next = new Set(open);
        if (next.has(model)) next.delete(model);
        else next.add(model);
        // A list that failed to load is asked for again the next time the model is opened.
        if (subModels[model] === 'failed') setSubModels(({ [model]: _, ...rest }) => rest);
        setOpen(next);
    };
    const toggleSubModel = (target: string) => {
        const next = new Set(selectedSubModels);
        if (next.has(target)) next.delete(target);
        else next.add(target);
        onSelectSubModels(next);
        onSelectGroup(null);
    };

    const rewiredSet = useMemo(() => new Set(rewired), [rewired]);
    const testingSet = useMemo(() => new Set(testing), [testing]);
    const filtered = useMemo(() => {
        const q = search.trim().toLowerCase();
        if (!q) return models;
        return models.filter(
            (m) =>
                m.name.toLowerCase().includes(q) ||
                m.type.toLowerCase().includes(q) ||
                m.controller.toLowerCase().includes(q),
        );
    }, [models, search]);
    const selectable = filtered.filter((m) => m.pixel);
    const allSelected = selectable.length > 0 && selectable.every((m) => selectedModels.has(m.name));
    const someSelected = selectable.some((m) => selectedModels.has(m.name));

    const toggleModel = (name: string) => {
        const next = new Set(selectedModels);
        if (next.has(name)) next.delete(name);
        else next.add(name);
        onSelectModels(next);
        onSelectGroup(null);
    };
    const toggleAll = () => {
        const next = new Set(selectedModels);
        for (const m of selectable) {
            if (allSelected) next.delete(m.name);
            else next.add(m.name);
        }
        onSelectModels(next);
        onSelectGroup(null);
    };

    const editGroup = (id: string, change: (g: TweakGroup) => TweakGroup) =>
        updateDoc((d) => ({ ...d, groups: d.groups.map((g) => (g.id === id ? change(g) : g)) }));
    const addGroup = () => {
        const name = newName.trim();
        if (!name) return;
        const id = newId();
        updateDoc((d) => ({ ...d, groups: [...d.groups, { id, name, models: [...selectedModels].sort() }] }));
        setNewName('');
        onSelectGroup(id);
    };
    const deleteGroup = (id: string) => {
        updateDoc((d) => ({ ...d, groups: d.groups.filter((g) => g.id !== id) }));
        if (selectedGroup === id) onSelectGroup(null);
    };

    return (
        <Box sx={{ display: 'flex', flexDirection: 'column', height: '100%', minHeight: 0 }}>
            <Tabs
                value={tab}
                onChange={(_, v) => setTab(v)}
                variant="fullWidth"
                sx={{ flexShrink: 0, borderBottom: 1, borderColor: 'divider' }}
            >
                <Tab
                    value="models"
                    label={`Models${selectedModels.size + selectedSubModels.size ? ` (${selectedModels.size + selectedSubModels.size})` : ''}`}
                />
                <Tab value="groups" label={`Groups${doc.groups.length ? ` (${doc.groups.length})` : ''}`} />
            </Tabs>

            {tab === 'models' && (
                <>
                    <Stack direction="row" alignItems="center" sx={{ px: 1, py: 1, flexShrink: 0 }}>
                        <Tooltip title={allSelected ? 'Clear these' : 'Select all shown'}>
                            <Checkbox
                                size="small"
                                checked={allSelected}
                                indeterminate={!allSelected && someSelected}
                                onChange={toggleAll}
                            />
                        </Tooltip>
                        <TextField
                            size="small"
                            fullWidth
                            placeholder="Find a model, type or controller"
                            value={search}
                            onChange={(e) => setSearch(e.target.value)}
                            InputProps={{
                                startAdornment: (
                                    <InputAdornment position="start">
                                        <SearchIcon fontSize="small" />
                                    </InputAdornment>
                                ),
                            }}
                        />
                    </Stack>
                    <List dense disablePadding sx={{ flex: 1, minHeight: 0, overflowY: 'auto' }}>
                        {filtered.map((m) => {
                            const eff = effectiveTweak(doc, m.name);
                            const chips = isNeutralTweak(eff) ? [] : tweakChips(eff, true);
                            const wiredHere = rewiredSet.has(m.name);
                            const subs = open.has(m.name) ? subModels[m.name] : undefined;
                            return (
                                <React.Fragment key={m.name}>
                                    <ListItemButton
                                        dense
                                        disabled={!m.pixel}
                                        selected={selectedModels.has(m.name) && !selectedGroup}
                                        onClick={() => toggleModel(m.name)}
                                        sx={{ py: 0.25, pl: 1 }}
                                    >
                                        <Checkbox
                                            size="small"
                                            edge="start"
                                            tabIndex={-1}
                                            disableRipple
                                            checked={selectedModels.has(m.name)}
                                            sx={{ py: 0.5 }}
                                        />
                                        <Box sx={{ minWidth: 0, flex: 1 }}>
                                            <Typography
                                                variant="body2"
                                                noWrap
                                                title={m.name}
                                                sx={{ fontWeight: testingSet.has(m.name) ? 700 : 400 }}
                                            >
                                                {m.name}
                                            </Typography>
                                            <Typography variant="caption" color="text.secondary" noWrap component="div">
                                                {m.type} · {m.nodeCount} {m.pixel ? 'px' : 'nodes, not pixels'}
                                                {m.controller
                                                    ? ` · ${m.controller}${m.port ? `:${m.port}` : ''}`
                                                    : ' · no controller'}
                                            </Typography>
                                            {(testingSet.has(m.name) || chips.length > 0 || wiredHere) && (
                                                <Stack
                                                    direction="row"
                                                    spacing={0.5}
                                                    sx={{ flexWrap: 'wrap', rowGap: 0.5, mt: 0.25 }}
                                                >
                                                    {testingSet.has(m.name) && (
                                                        <Chip
                                                            size="small"
                                                            color="warning"
                                                            label="testing"
                                                            sx={{ height: 18 }}
                                                        />
                                                    )}
                                                    {chips.map((c) => (
                                                        <Chip
                                                            key={c}
                                                            size="small"
                                                            variant="outlined"
                                                            color="primary"
                                                            label={c}
                                                            sx={{ height: 18 }}
                                                        />
                                                    ))}
                                                    {wiredHere && (
                                                        <Chip
                                                            size="small"
                                                            variant="outlined"
                                                            color="secondary"
                                                            label="rewired"
                                                            sx={{ height: 18 }}
                                                        />
                                                    )}
                                                </Stack>
                                            )}
                                        </Box>
                                        {!!m.subModels && m.pixel && (
                                            <Tooltip title={`${m.subModels} submodel${m.subModels === 1 ? '' : 's'}`}>
                                                <IconButton
                                                    size="small"
                                                    aria-label={`${open.has(m.name) ? 'Hide' : 'Show'} the submodels of ${m.name}`}
                                                    onClick={(e) => {
                                                        e.stopPropagation();
                                                        toggleOpen(m.name);
                                                    }}
                                                >
                                                    {open.has(m.name) ? (
                                                        <ExpandLessIcon fontSize="small" />
                                                    ) : (
                                                        <ExpandMoreIcon fontSize="small" />
                                                    )}
                                                </IconButton>
                                            </Tooltip>
                                        )}
                                    </ListItemButton>
                                    {subs === 'loading' && (
                                        <Typography
                                            variant="caption"
                                            color="text.secondary"
                                            sx={{ pl: 6 }}
                                            component="div"
                                        >
                                            Loading submodels…
                                        </Typography>
                                    )}
                                    {subs === 'failed' && (
                                        <Typography variant="caption" color="error" sx={{ pl: 6 }} component="div">
                                            The player did not list the submodels. Close and open to try again.
                                        </Typography>
                                    )}
                                    {Array.isArray(subs) &&
                                        subs.map((sm) => (
                                            <ListItemButton
                                                key={sm.target}
                                                dense
                                                selected={selectedSubModels.has(sm.target) && !selectedGroup}
                                                onClick={() => toggleSubModel(sm.target)}
                                                sx={{ py: 0, pl: 4 }}
                                            >
                                                <Checkbox
                                                    size="small"
                                                    edge="start"
                                                    tabIndex={-1}
                                                    disableRipple
                                                    checked={selectedSubModels.has(sm.target)}
                                                    sx={{ py: 0.5 }}
                                                />
                                                <Box sx={{ minWidth: 0, flex: 1 }}>
                                                    <Typography
                                                        variant="body2"
                                                        noWrap
                                                        title={sm.target}
                                                        sx={{ fontWeight: testingSet.has(sm.target) ? 700 : 400 }}
                                                    >
                                                        {sm.name}
                                                    </Typography>
                                                    <Typography
                                                        variant="caption"
                                                        color="text.secondary"
                                                        noWrap
                                                        component="div"
                                                    >
                                                        submodel · {sm.nodeCount} px
                                                        {sm.strands > 1 ? ` · ${sm.strands} strands` : ''}
                                                        {testingSet.has(sm.target) ? ' · testing' : ''}
                                                    </Typography>
                                                </Box>
                                            </ListItemButton>
                                        ))}
                                </React.Fragment>
                            );
                        })}
                        {!filtered.length && (
                            <Typography variant="body2" color="text.secondary" sx={{ p: 2 }}>
                                {models.length
                                    ? 'No models match.'
                                    : 'No models: the player has not loaded a layout yet.'}
                            </Typography>
                        )}
                    </List>
                </>
            )}

            {tab === 'groups' && (
                <>
                    <Stack direction="row" spacing={1} sx={{ p: 1, flexShrink: 0 }}>
                        <TextField
                            size="small"
                            fullWidth
                            placeholder={
                                selectedModels.size ? `New group of ${selectedModels.size} selected` : 'New group name'
                            }
                            value={newName}
                            onChange={(e) => setNewName(e.target.value)}
                            onKeyDown={(e) => e.key === 'Enter' && addGroup()}
                        />
                        <Button
                            variant="contained"
                            size="small"
                            startIcon={<AddIcon />}
                            disabled={!newName.trim()}
                            onClick={addGroup}
                        >
                            Add
                        </Button>
                    </Stack>
                    <Typography variant="body2" color="text.secondary" sx={{ px: 1.5, pb: 1 }}>
                        A group is a set of models to test or tweak together. It is not an xLights group.
                    </Typography>
                    <List dense disablePadding sx={{ flex: 1, minHeight: 0, overflowY: 'auto' }}>
                        {doc.groups.map((g) => {
                            const isSel = selectedGroup === g.id;
                            const chips = hasTweak(g.tweak) ? tweakChips(g.tweak!) : [];
                            return (
                                <Box key={g.id} sx={{ borderBottom: 1, borderColor: 'divider' }}>
                                    <ListItemButton
                                        dense
                                        selected={isSel}
                                        onClick={() => onSelectGroup(isSel ? null : g.id)}
                                        sx={{ pr: 0.5 }}
                                    >
                                        <Box sx={{ minWidth: 0, flex: 1 }}>
                                            {renaming?.id === g.id ? (
                                                <TextField
                                                    fullWidth
                                                    size="small"
                                                    autoFocus
                                                    value={renaming.name}
                                                    onClick={(e) => e.stopPropagation()}
                                                    onChange={(e) => setRenaming({ id: g.id, name: e.target.value })}
                                                    onKeyDown={(e) => {
                                                        if (e.key === 'Enter') {
                                                            const name = renaming.name.trim();
                                                            if (name) editGroup(g.id, (x) => ({ ...x, name }));
                                                            setRenaming(null);
                                                        } else if (e.key === 'Escape') setRenaming(null);
                                                    }}
                                                />
                                            ) : (
                                                <Stack direction="row" spacing={0.5} alignItems="center">
                                                    <Typography variant="body2" noWrap>
                                                        {g.name}
                                                    </Typography>
                                                    {chips.map((c) => (
                                                        <Chip
                                                            key={c}
                                                            size="small"
                                                            variant="outlined"
                                                            color="primary"
                                                            label={c}
                                                            sx={{ height: 18 }}
                                                        />
                                                    ))}
                                                </Stack>
                                            )}
                                            <Typography variant="caption" color="text.secondary" noWrap component="div">
                                                {g.models.length} model{g.models.length === 1 ? '' : 's'}
                                                {g.models.length
                                                    ? `: ${g.models.slice(0, 4).join(', ')}${g.models.length > 4 ? '…' : ''}`
                                                    : ''}
                                            </Typography>
                                        </Box>
                                        {renaming?.id === g.id ? (
                                            <IconButton
                                                size="small"
                                                onClick={(e) => {
                                                    e.stopPropagation();
                                                    const name = renaming.name.trim();
                                                    if (name) editGroup(g.id, (x) => ({ ...x, name }));
                                                    setRenaming(null);
                                                }}
                                            >
                                                <CheckIcon fontSize="small" />
                                            </IconButton>
                                        ) : (
                                            <Tooltip title="Rename">
                                                <IconButton
                                                    size="small"
                                                    onClick={(e) => {
                                                        e.stopPropagation();
                                                        setRenaming({ id: g.id, name: g.name });
                                                    }}
                                                >
                                                    <EditIcon fontSize="small" />
                                                </IconButton>
                                            </Tooltip>
                                        )}
                                        <Tooltip title="Delete the group (its models keep their own tweaks)">
                                            <IconButton
                                                size="small"
                                                onClick={(e) => {
                                                    e.stopPropagation();
                                                    deleteGroup(g.id);
                                                }}
                                            >
                                                <DeleteOutlineIcon fontSize="small" />
                                            </IconButton>
                                        </Tooltip>
                                    </ListItemButton>
                                    {isSel && (
                                        <Stack
                                            direction="row"
                                            spacing={0.5}
                                            sx={{ px: 1, pb: 1, flexWrap: 'wrap', rowGap: 0.5 }}
                                        >
                                            <Button
                                                size="small"
                                                disabled={!selectedModels.size}
                                                onClick={() =>
                                                    editGroup(g.id, (x) => ({
                                                        ...x,
                                                        models: [...new Set([...x.models, ...selectedModels])].sort(),
                                                    }))
                                                }
                                            >
                                                Add selected
                                            </Button>
                                            <Button
                                                size="small"
                                                disabled={!g.models.some((m) => selectedModels.has(m))}
                                                onClick={() =>
                                                    editGroup(g.id, (x) => ({
                                                        ...x,
                                                        models: x.models.filter((m) => !selectedModels.has(m)),
                                                    }))
                                                }
                                            >
                                                Remove selected
                                            </Button>
                                            <Button
                                                size="small"
                                                disabled={!g.models.length}
                                                onClick={() => onSelectModels(new Set(g.models))}
                                            >
                                                Select its models
                                            </Button>
                                        </Stack>
                                    )}
                                </Box>
                            );
                        })}
                        {!doc.groups.length && (
                            <Typography variant="body2" color="text.secondary" sx={{ p: 2 }}>
                                No groups yet. Select some models, then name a group above.
                            </Typography>
                        )}
                    </List>
                </>
            )}
        </Box>
    );
};
