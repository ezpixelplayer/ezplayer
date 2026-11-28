import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Box } from '../box/Box';
import {
    Badge,
    Button,
    Checkbox,
    Chip,
    IconButton,
    InputAdornment,
    List,
    ListItemButton,
    MenuItem,
    Popover,
    Stack,
    TextField,
    Tooltip,
    Typography,
} from '@mui/material';
import ExpandLessIcon from '@mui/icons-material/ExpandLess';
import ExpandMoreIcon from '@mui/icons-material/ExpandMore';
import FilterListIcon from '@mui/icons-material/FilterList';
import SearchIcon from '@mui/icons-material/Search';
import type { TweakModelInfo } from '@ezplayer/ezplayer-core';

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

/** Something to narrow the list by, picked from the values the models have. */
export interface ModelFacet {
    label: string;
    of: (m: TweakModelInfo) => string | undefined;
}

const BUILT_IN_FACETS: ModelFacet[] = [
    { label: 'Type', of: (m) => m.type },
    { label: 'Controller', of: (m) => m.controller || 'No controller' },
];

export interface ModelChecklistProps {
    models: TweakModelInfo[];
    /** Ticked models. */
    checked: Set<string>;
    onChange: (next: Set<string>) => void;
    /** Ticked submodels as "Model/Submodel". Leave out, with `onChangeSubModels`, where submodels do not apply. */
    checkedSubModels?: Set<string>;
    onChangeSubModels?: (next: Set<string>) => void;
    /** The player, for listing a model's submodels when it is opened. */
    baseUrl?: string;
    /** One model at a time, picked by clicking its row; no tick boxes. */
    single?: boolean;
    /** List the ticked models first. */
    checkedFirst?: boolean;
    /** Extra words under a model's name, e.g. the profile it is in. */
    note?: (m: TweakModelInfo) => string | undefined;
    /** Something to do with one model, shown at the end of its row. */
    action?: (m: TweakModelInfo) => React.ReactNode;
    /** Models and submodels a running test is painting. */
    testing?: Set<string>;
    /** Shown above the list, beside the count. */
    toolbar?: React.ReactNode;
    /** More to narrow the list by, after type and controller (e.g. the profile). */
    facets?: ModelFacet[];
    /** A model to bring into view and mark, e.g. the one just clicked in the layout. */
    focus?: string | null;
    emptyText?: string;
}

/**
 * Every model of the show as a list to tick, with a filter and "all shown /
 * none shown".  Group members, profile members and the models to test are
 * all picked with this.
 */
export const ModelChecklist: React.FC<ModelChecklistProps> = ({
    models,
    checked,
    onChange,
    checkedSubModels,
    onChangeSubModels,
    baseUrl,
    single,
    checkedFirst,
    note,
    action,
    testing,
    toolbar,
    facets,
    focus,
    emptyText,
}) => {
    const withSubs = !!checkedSubModels && !!onChangeSubModels && !single;
    const [search, setSearch] = useState('');
    const [filters, setFilters] = useState<Record<string, string>>({});
    const [filterAnchor, setFilterAnchor] = useState<HTMLElement | null>(null);
    const allFacets = useMemo(() => [...BUILT_IN_FACETS, ...(facets ?? [])], [facets]);
    const rows = useRef(new Map<string, HTMLElement>());
    const [open, setOpen] = useState<Set<string>>(() => new Set());
    const [subModels, setSubModels] = useState<Record<string, SubModelList>>({});

    // A model with a ticked submodel starts open, so the tick can be seen.
    useEffect(() => {
        if (!withSubs || !checkedSubModels.size) return;
        setOpen((prev) => {
            const next = new Set(prev);
            for (const m of models) {
                if (!m.subModels || next.has(m.name)) continue;
                for (const s of checkedSubModels) {
                    if (s.startsWith(`${m.name}/`)) {
                        next.add(m.name);
                        break;
                    }
                }
            }
            return next.size === prev.size ? prev : next;
        });
    }, [withSubs, checkedSubModels, models]);

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

    const shown = useMemo(() => {
        const q = search.trim().toLowerCase();
        const active = allFacets.filter((f) => filters[f.label]);
        const hit = models.filter(
            (m) =>
                active.every((f) => f.of(m) === filters[f.label]) &&
                (!q ||
                    m.name.toLowerCase().includes(q) ||
                    m.type.toLowerCase().includes(q) ||
                    m.controller.toLowerCase().includes(q) ||
                    (note?.(m) ?? '').toLowerCase().includes(q)),
        );
        if (!checkedFirst) return hit;
        // Stable: members keep their order among themselves, as do the rest.
        return [...hit.filter((m) => checked.has(m.name)), ...hit.filter((m) => !checked.has(m.name))];
        // The order is settled when the filter changes, not on every tick, so a row does not jump from under the pointer.
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [models, search, checkedFirst, filters, allFacets]);

    // The model to mark is scrolled to; a filter that hides it is dropped first.
    useEffect(() => {
        if (!focus) return;
        if (!shown.some((m) => m.name === focus)) {
            if (models.some((m) => m.name === focus) && (search || Object.keys(filters).length)) {
                setSearch('');
                setFilters({});
            }
            return;
        }
        rows.current.get(focus)?.scrollIntoView({ block: 'nearest' });
        // Only when the model to mark changes, or the list it is in does.
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [focus, shown]);

    const narrowed = !!search.trim() || Object.keys(filters).length > 0;

    const pickable = shown.filter((m) => m.pixel);
    const shownChecked = pickable.filter((m) => checked.has(m.name)).length;

    const toggle = (name: string) => {
        if (single) {
            onChange(new Set([name]));
            return;
        }
        const next = new Set(checked);
        if (next.has(name)) next.delete(name);
        else next.add(name);
        onChange(next);
    };
    const setShown = (on: boolean) => {
        const next = new Set(checked);
        for (const m of pickable) {
            if (on) next.add(m.name);
            else next.delete(m.name);
        }
        onChange(next);
    };
    const toggleOpen = (model: string) => {
        const next = new Set(open);
        if (next.has(model)) next.delete(model);
        else next.add(model);
        // A list that failed to load is asked for again the next time the model is opened.
        if (subModels[model] === 'failed') setSubModels(({ [model]: _, ...rest }) => rest);
        setOpen(next);
    };
    const toggleSub = (target: string) => {
        if (!withSubs) return;
        const next = new Set(checkedSubModels);
        if (next.has(target)) next.delete(target);
        else next.add(target);
        onChangeSubModels(next);
    };

    return (
        <Box sx={{ display: 'flex', flexDirection: 'column', minHeight: 0, height: '100%' }}>
            <Box sx={{ px: 1, pt: 1, flexShrink: 0 }}>
                <TextField
                    size="small"
                    fullWidth
                    placeholder="Find a model"
                    value={search}
                    onChange={(e) => setSearch(e.target.value)}
                    InputProps={{
                        startAdornment: (
                            <InputAdornment position="start">
                                <SearchIcon fontSize="small" />
                            </InputAdornment>
                        ),
                        endAdornment: (
                            <InputAdornment position="end">
                                <Tooltip title="Narrow the list by type, controller…">
                                    <IconButton
                                        size="small"
                                        edge="end"
                                        aria-label="Narrow the list"
                                        onClick={(e) => setFilterAnchor(e.currentTarget)}
                                    >
                                        <Badge color="primary" variant="dot" invisible={!Object.keys(filters).length}>
                                            <FilterListIcon fontSize="small" />
                                        </Badge>
                                    </IconButton>
                                </Tooltip>
                            </InputAdornment>
                        ),
                    }}
                />
                <Popover
                    open={!!filterAnchor}
                    anchorEl={filterAnchor}
                    onClose={() => setFilterAnchor(null)}
                    anchorOrigin={{ vertical: 'bottom', horizontal: 'right' }}
                    transformOrigin={{ vertical: 'top', horizontal: 'right' }}
                >
                    <Stack spacing={1.5} sx={{ p: 2, width: 260 }}>
                        {allFacets.map((f) => {
                            const values = [
                                ...new Set(models.map((m) => f.of(m)).filter((v): v is string => !!v)),
                            ].sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));
                            return (
                                <TextField
                                    key={f.label}
                                    select
                                    size="small"
                                    label={f.label}
                                    value={filters[f.label] ?? ''}
                                    onChange={(e) =>
                                        setFilters(({ [f.label]: _old, ...rest }) =>
                                            e.target.value ? { ...rest, [f.label]: e.target.value } : rest,
                                        )
                                    }
                                    SelectProps={{ displayEmpty: true }}
                                    InputLabelProps={{ shrink: true }}
                                >
                                    <MenuItem value="">Any</MenuItem>
                                    {values.map((v) => (
                                        <MenuItem key={v} value={v}>
                                            {v}
                                        </MenuItem>
                                    ))}
                                </TextField>
                            );
                        })}
                        <Stack direction="row" justifyContent="flex-end" spacing={1}>
                            <Button size="small" disabled={!Object.keys(filters).length} onClick={() => setFilters({})}>
                                Clear
                            </Button>
                            <Button size="small" variant="contained" onClick={() => setFilterAnchor(null)}>
                                Done
                            </Button>
                        </Stack>
                    </Stack>
                </Popover>
                {Object.keys(filters).length > 0 && (
                    <Stack direction="row" spacing={0.5} sx={{ flexWrap: 'wrap', rowGap: 0.5, mt: 0.5 }}>
                        {Object.entries(filters).map(([label, value]) => (
                            <Chip
                                key={label}
                                size="small"
                                label={`${label}: ${value}`}
                                onDelete={() => setFilters(({ [label]: _old, ...rest }) => rest)}
                            />
                        ))}
                    </Stack>
                )}
                {!single && (
                    <Stack
                        direction="row"
                        alignItems="center"
                        spacing={0.5}
                        sx={{ flexWrap: 'wrap', rowGap: 0.5, mt: 0.5 }}
                    >
                        <Typography variant="body2" color="text.secondary" sx={{ fontSize: 12, mr: 'auto' }}>
                            {checked.size} ticked{narrowed ? `, ${shownChecked} of ${pickable.length} shown` : ''}
                        </Typography>
                        <Button size="small" disabled={shownChecked === pickable.length} onClick={() => setShown(true)}>
                            {narrowed ? 'Tick shown' : 'Tick all'}
                        </Button>
                        <Button size="small" disabled={!shownChecked} onClick={() => setShown(false)}>
                            {narrowed ? 'Clear shown' : 'Clear all'}
                        </Button>
                        {toolbar}
                    </Stack>
                )}
            </Box>
            <List dense disablePadding sx={{ flex: 1, minHeight: 0, overflowY: 'auto' }}>
                {shown.map((m) => {
                    const isOn = checked.has(m.name);
                    const subs = withSubs && open.has(m.name) ? subModels[m.name] : undefined;
                    const extra = note?.(m);
                    const isTesting = testing?.has(m.name);
                    return (
                        <React.Fragment key={m.name}>
                            <ListItemButton
                                dense
                                disabled={!m.pixel}
                                selected={(!!single && isOn) || focus === m.name}
                                onClick={() => toggle(m.name)}
                                ref={(el: HTMLElement | null) => {
                                    if (el) rows.current.set(m.name, el);
                                    else rows.current.delete(m.name);
                                }}
                                sx={{ py: 0.25, pl: 1, pr: 0.5 }}
                            >
                                {!single && (
                                    <Checkbox
                                        size="small"
                                        edge="start"
                                        tabIndex={-1}
                                        disableRipple
                                        checked={isOn}
                                        sx={{ py: 0.5 }}
                                    />
                                )}
                                <Box sx={{ minWidth: 0, flex: 1 }}>
                                    <Typography
                                        variant="body2"
                                        noWrap
                                        title={m.name}
                                        sx={{ fontWeight: isTesting ? 700 : 400 }}
                                    >
                                        {m.name}
                                    </Typography>
                                    <Typography
                                        variant="body2"
                                        color="text.secondary"
                                        noWrap
                                        component="div"
                                        sx={{ fontSize: 12 }}
                                    >
                                        {m.type} · {m.nodeCount} {m.pixel ? 'px' : 'nodes, not pixels'}
                                        {extra ? ` · ${extra}` : ''}
                                        {isTesting ? ' · testing' : ''}
                                    </Typography>
                                </Box>
                                {action?.(m)}
                                {withSubs && (
                                    <Tooltip
                                        title={
                                            m.subModels && m.pixel
                                                ? `${m.subModels} submodel${m.subModels === 1 ? '' : 's'}`
                                                : ''
                                        }
                                    >
                                        <span>
                                            <IconButton
                                                size="small"
                                                disabled={!m.subModels || !m.pixel}
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
                                        </span>
                                    </Tooltip>
                                )}
                            </ListItemButton>
                            {subs === 'loading' && (
                                <Typography
                                    variant="body2"
                                    color="text.secondary"
                                    sx={{ fontSize: 12, pl: 6 }}
                                    component="div"
                                >
                                    Loading submodels…
                                </Typography>
                            )}
                            {subs === 'failed' && (
                                <Typography variant="body2" color="error" sx={{ fontSize: 12, pl: 6 }} component="div">
                                    The player did not list the submodels. Close and open to try again.
                                </Typography>
                            )}
                            {Array.isArray(subs) &&
                                subs.map((sm) => (
                                    <ListItemButton
                                        key={sm.target}
                                        dense
                                        onClick={() => toggleSub(sm.target)}
                                        sx={{ py: 0, pl: 4 }}
                                    >
                                        <Checkbox
                                            size="small"
                                            edge="start"
                                            tabIndex={-1}
                                            disableRipple
                                            checked={checkedSubModels!.has(sm.target)}
                                            sx={{ py: 0.5 }}
                                        />
                                        <Box sx={{ minWidth: 0, flex: 1 }}>
                                            <Typography
                                                variant="body2"
                                                noWrap
                                                title={sm.target}
                                                sx={{ fontWeight: testing?.has(sm.target) ? 700 : 400 }}
                                            >
                                                {sm.name}
                                            </Typography>
                                            <Typography
                                                variant="body2"
                                                color="text.secondary"
                                                noWrap
                                                component="div"
                                                sx={{ fontSize: 12 }}
                                            >
                                                submodel · {sm.nodeCount} px
                                                {sm.strands > 1 ? ` · ${sm.strands} strands` : ''}
                                                {testing?.has(sm.target) ? ' · testing' : ''}
                                            </Typography>
                                        </Box>
                                    </ListItemButton>
                                ))}
                        </React.Fragment>
                    );
                })}
                {!shown.length && (
                    <Typography variant="body2" color="text.secondary" sx={{ p: 2 }}>
                        {models.length
                            ? 'No models match.'
                            : (emptyText ?? 'No models: the player has not loaded a layout yet.')}
                    </Typography>
                )}
            </List>
        </Box>
    );
};
