import React, { useEffect, useRef, useState } from 'react';
import { Box } from '../box/Box';
import {
    Button,
    Checkbox,
    FormControlLabel,
    IconButton,
    MenuItem,
    Slider,
    Stack,
    TextField,
    Tooltip,
    Typography,
} from '@mui/material';
import AddIcon from '@mui/icons-material/Add';
import CloseIcon from '@mui/icons-material/Close';
import DeleteOutlineIcon from '@mui/icons-material/DeleteOutline';
import PlayArrowIcon from '@mui/icons-material/PlayArrow';
import SaveIcon from '@mui/icons-material/Save';
import StopIcon from '@mui/icons-material/Stop';
import type {
    ActiveTest,
    TestPatternKind,
    TestPatternSpec,
    TestTargets,
    TestTweakDoc,
    TestTweakStatus,
} from '@ezplayer/ezplayer-core';
import { newId } from './useTestTweak';

export interface TestPanelProps {
    doc: TestTweakDoc;
    updateDoc: (change: (doc: TestTweakDoc) => TestTweakDoc) => void;
    /** What the test would run on, from the selection. */
    targets: TestTargets;
    /** e.g. "3 models" or "group Roof"; empty when nothing is selected. */
    targetLabel: string;
    status?: TestTweakStatus;
    onStart: (test: ActiveTest) => Promise<void>;
    onStop: () => Promise<void>;
}

const KINDS: { kind: TestPatternKind; label: string; hint: string }[] = [
    { kind: 'solid', label: 'Solid color', hint: 'One color everywhere: for brightness, gamma and color balance.' },
    {
        kind: 'colorCycle',
        label: 'Color cycle',
        hint: 'Steps through the colors: red must look red, green green, blue blue.',
    },
    {
        kind: 'bars',
        label: 'Bars',
        hint: 'Stripes moving across the layout at an angle: wrong placement shows as a broken stripe.',
    },
    { kind: 'rainbow', label: 'Rainbow', hint: 'A hue sweep across the layout.' },
    {
        kind: 'chase',
        label: 'Chase',
        hint: 'A lit run travelling along the wiring: shows direction and where each string starts.',
    },
    {
        kind: 'markers',
        label: 'Count markers',
        hint: 'First pixel green, last red, every Nth white: for counting pixels.',
    },
    { kind: 'strobe', label: 'Flash', hint: 'On and off: for finding a prop in the yard.' },
];

const DEFAULT_COLORS: Record<TestPatternKind, string[]> = {
    solid: ['#ffffff'],
    colorCycle: ['#ff0000', '#00ff00', '#0000ff', '#ffffff'],
    bars: ['#ff0000', '#00ff00', '#0000ff'],
    rainbow: [],
    chase: ['#ffffff'],
    markers: [],
    strobe: ['#ffffff'],
};

/** Which controls a pattern kind has. */
const FIELDS: Record<
    TestPatternKind,
    {
        colors?: 'one' | 'many';
        angle?: boolean;
        width?: boolean;
        speed?: boolean;
        period?: boolean;
        every?: boolean;
        space?: boolean;
    }
> = {
    solid: { colors: 'one' },
    colorCycle: { colors: 'many', period: true },
    bars: { colors: 'many', angle: true, width: true, speed: true, space: true },
    rainbow: { angle: true, width: true, speed: true, space: true },
    chase: { colors: 'one', angle: true, width: true, speed: true, space: true },
    markers: { every: true },
    strobe: { colors: 'one', period: true },
};

const STORAGE_KEY = 'ezpTestTweakPattern';
/** Marks the pass on which the controls are being set from a test found running. */
const ADOPTING = '\u0000adopting';
const DEFAULT_PATTERN: TestPatternSpec = { kind: 'solid', colors: ['#ffffff'], intensity: 0.5 };

function loadPattern(): TestPatternSpec {
    try {
        const raw = localStorage.getItem(STORAGE_KEY);
        if (raw) {
            const p = JSON.parse(raw) as TestPatternSpec;
            if (p && KINDS.some((k) => k.kind === p.kind)) return p;
        }
    } catch {
        /* no storage, or not ours: use the default */
    }
    return DEFAULT_PATTERN;
}

const Labeled: React.FC<{ label: string; value: string; children: React.ReactNode }> = ({ label, value, children }) => (
    <Box>
        <Stack direction="row" justifyContent="space-between">
            <Typography variant="caption" color="text.secondary">
                {label}
            </Typography>
            <Typography variant="caption">{value}</Typography>
        </Stack>
        {children}
    </Box>
);

export const TestPanel: React.FC<TestPanelProps> = ({
    doc,
    updateDoc,
    targets,
    targetLabel,
    status,
    onStart,
    onStop,
}) => {
    const [pattern, setPattern] = useState<TestPatternSpec>(loadPattern);
    const [minutes, setMinutes] = useState(15);
    const [bypass, setBypass] = useState(false);
    const [presetName, setPresetName] = useState('');
    const running = !!status?.active;
    const hasTargets = !!targetLabel;
    const fields = FIELDS[pattern.kind];
    const space = pattern.space ?? (pattern.kind === 'chase' ? 'node' : 'world');

    const test: ActiveTest = {
        targets,
        pattern,
        ...(bypass ? { bypassTweaks: true } : {}),
        ...(minutes > 0 ? { ttlMs: minutes * 60_000 } : {}),
    };
    const testKey = JSON.stringify(test);

    useEffect(() => {
        try {
            localStorage.setItem(STORAGE_KEY, JSON.stringify(pattern));
        } catch {
            /* nowhere to remember it */
        }
    }, [pattern]);

    // While a test runs it follows the controls and the selection.
    const latest = useRef({ test, onStart });
    latest.current = { test, onStart };
    const sentKey = useRef<string>();
    useEffect(() => {
        if (!running) {
            sentKey.current = undefined;
            return;
        }
        // A test already running when we arrive (started elsewhere, or before a page change) is left as it is
        // until something here changes; the controls take up what it is doing.
        if (sentKey.current === undefined) {
            const active = status?.active;
            if (active) {
                sentKey.current = ADOPTING;
                setPattern(active.pattern);
                setBypass(!!active.bypassTweaks);
            } else {
                sentKey.current = testKey;
            }
            return;
        }
        if (sentKey.current === ADOPTING) {
            sentKey.current = testKey;
            return;
        }
        if (!hasTargets || sentKey.current === testKey) return;
        const id = setTimeout(() => {
            sentKey.current = testKey;
            void latest.current.onStart(latest.current.test);
        }, 120);
        return () => clearTimeout(id);
        // status.active is read only on the pass that first sees the test.
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [running, hasTargets, testKey]);

    const start = () => {
        sentKey.current = testKey;
        void onStart(test);
    };
    const set = (patch: Partial<TestPatternSpec>) => setPattern((p) => ({ ...p, ...patch }));
    const setKind = (kind: TestPatternKind) =>
        setPattern((p) => ({
            kind,
            intensity: p.intensity,
            ...(DEFAULT_COLORS[kind].length ? { colors: DEFAULT_COLORS[kind] } : {}),
        }));
    const colors = pattern.colors ?? DEFAULT_COLORS[pattern.kind];
    const setColor = (i: number, c: string) => set({ colors: colors.map((x, k) => (k === i ? c : x)) });

    const savePreset = () => {
        const name = presetName.trim();
        if (!name) return;
        updateDoc((d) => {
            const existing = d.presets.find((p) => p.name === name);
            return existing
                ? { ...d, presets: d.presets.map((p) => (p === existing ? { ...p, pattern } : p)) }
                : { ...d, presets: [...d.presets, { id: newId(), name, pattern }] };
        });
        setPresetName('');
    };

    return (
        <Stack spacing={1.5}>
            <Stack direction="row" spacing={1} alignItems="center">
                {running ? (
                    <Button
                        variant="contained"
                        color="warning"
                        startIcon={<StopIcon />}
                        onClick={() => void onStop()}
                        sx={{ whiteSpace: 'nowrap', flexShrink: 0 }}
                    >
                        Stop test
                    </Button>
                ) : (
                    <Button
                        variant="contained"
                        startIcon={<PlayArrowIcon />}
                        disabled={!hasTargets}
                        onClick={start}
                        sx={{ whiteSpace: 'nowrap', flexShrink: 0 }}
                    >
                        Start test
                    </Button>
                )}
                <Typography variant="body2" color="text.secondary" sx={{ minWidth: 0 }}>
                    {running
                        ? `Running on ${status?.activeModels?.length ?? 0} model${status?.activeModels?.length === 1 ? '' : 's'}; it follows your selection.`
                        : hasTargets
                          ? `On ${targetLabel}.`
                          : 'Select models or a group to test.'}
                </Typography>
            </Stack>

            <TextField
                select
                size="small"
                label="Pattern"
                value={pattern.kind}
                onChange={(e) => setKind(e.target.value as TestPatternKind)}
                helperText={KINDS.find((k) => k.kind === pattern.kind)?.hint}
            >
                {KINDS.map((k) => (
                    <MenuItem key={k.kind} value={k.kind}>
                        {k.label}
                    </MenuItem>
                ))}
            </TextField>

            {fields.colors && (
                <Stack direction="row" spacing={0.5} alignItems="center" sx={{ flexWrap: 'wrap', rowGap: 0.5 }}>
                    <Typography variant="caption" color="text.secondary" sx={{ mr: 0.5 }}>
                        {fields.colors === 'one' ? 'Color' : 'Colors'}
                    </Typography>
                    {(fields.colors === 'one' ? colors.slice(0, 1) : colors).map((c, i) => (
                        <Box key={i} sx={{ position: 'relative', lineHeight: 0 }}>
                            <input
                                type="color"
                                value={c}
                                aria-label={`Color ${i + 1}`}
                                onChange={(e) => setColor(i, e.target.value)}
                                style={{
                                    width: 36,
                                    height: 28,
                                    padding: 0,
                                    border: 'none',
                                    background: 'none',
                                    cursor: 'pointer',
                                }}
                            />
                            {fields.colors === 'many' && colors.length > 1 && (
                                <IconButton
                                    size="small"
                                    aria-label={`Remove color ${i + 1}`}
                                    onClick={() => set({ colors: colors.filter((_, k) => k !== i) })}
                                    sx={{ position: 'absolute', top: -8, right: -8, p: 0, bgcolor: 'background.paper' }}
                                >
                                    <CloseIcon sx={{ fontSize: 12 }} />
                                </IconButton>
                            )}
                        </Box>
                    ))}
                    {fields.colors === 'many' && colors.length < 8 && (
                        <IconButton
                            size="small"
                            aria-label="Add a color"
                            onClick={() => set({ colors: [...colors, '#ffffff'] })}
                        >
                            <AddIcon fontSize="small" />
                        </IconButton>
                    )}
                    {fields.colors === 'one' &&
                        ['#ffffff', '#ff0000', '#00ff00', '#0000ff'].map((c) => (
                            <Tooltip
                                key={c}
                                title={
                                    c === '#ffffff'
                                        ? 'White'
                                        : c === '#ff0000'
                                          ? 'Red'
                                          : c === '#00ff00'
                                            ? 'Green'
                                            : 'Blue'
                                }
                            >
                                <Box
                                    role="button"
                                    onClick={() => set({ colors: [c] })}
                                    sx={{
                                        width: 20,
                                        height: 20,
                                        borderRadius: '50%',
                                        bgcolor: c,
                                        border: 1,
                                        borderColor: 'divider',
                                        cursor: 'pointer',
                                    }}
                                />
                            </Tooltip>
                        ))}
                </Stack>
            )}

            <Labeled label="Intensity" value={`${Math.round((pattern.intensity ?? 1) * 100)}%`}>
                <Slider
                    size="small"
                    min={0}
                    max={1}
                    step={0.01}
                    value={pattern.intensity ?? 1}
                    onChange={(_, v) => set({ intensity: v as number })}
                />
            </Labeled>

            {fields.space && (
                <TextField
                    select
                    size="small"
                    label="Runs along"
                    value={space}
                    onChange={(e) => set({ space: e.target.value as 'world' | 'node' })}
                >
                    <MenuItem value="world">The layout, as one picture across the selection</MenuItem>
                    <MenuItem value="node">Each model's wiring, first pixel to last</MenuItem>
                </TextField>
            )}
            {fields.angle && space === 'world' && (
                <Labeled label="Direction" value={`${Math.round(pattern.angleDeg ?? 0)}°`}>
                    <Slider
                        size="small"
                        min={0}
                        max={360}
                        step={5}
                        value={pattern.angleDeg ?? 0}
                        onChange={(_, v) => set({ angleDeg: v as number })}
                    />
                </Labeled>
            )}
            {fields.width && (
                <Labeled
                    label={pattern.kind === 'rainbow' ? 'One rainbow spans' : 'Band width'}
                    value={`${Math.round((pattern.width ?? (pattern.kind === 'rainbow' ? 1 : pattern.kind === 'chase' ? 0.05 : 0.1)) * 100)}% of the extent`}
                >
                    <Slider
                        size="small"
                        min={0.01}
                        max={pattern.kind === 'rainbow' ? 2 : 0.5}
                        step={0.01}
                        value={
                            pattern.width ?? (pattern.kind === 'rainbow' ? 1 : pattern.kind === 'chase' ? 0.05 : 0.1)
                        }
                        onChange={(_, v) => set({ width: v as number })}
                    />
                </Labeled>
            )}
            {fields.speed && (
                <Labeled
                    label="Speed"
                    value={`${(pattern.speed ?? (pattern.kind === 'bars' ? 0.5 : pattern.kind === 'chase' ? 0.25 : 0.1)).toFixed(2)} /s`}
                >
                    <Slider
                        size="small"
                        min={-2}
                        max={2}
                        step={0.05}
                        value={pattern.speed ?? (pattern.kind === 'bars' ? 0.5 : pattern.kind === 'chase' ? 0.25 : 0.1)}
                        onChange={(_, v) => set({ speed: v as number })}
                    />
                </Labeled>
            )}
            {fields.period && (
                <Labeled
                    label="Step time"
                    value={`${((pattern.periodMs ?? (pattern.kind === 'strobe' ? 500 : 1000)) / 1000).toFixed(1)} s`}
                >
                    <Slider
                        size="small"
                        min={100}
                        max={5000}
                        step={100}
                        value={pattern.periodMs ?? (pattern.kind === 'strobe' ? 500 : 1000)}
                        onChange={(_, v) => set({ periodMs: v as number })}
                    />
                </Labeled>
            )}
            {fields.every && (
                <TextField
                    size="small"
                    type="number"
                    label="Mark every"
                    value={pattern.every ?? 10}
                    onChange={(e) => set({ every: Math.max(1, Math.round(Number(e.target.value) || 1)) })}
                    helperText="pixels along the wiring"
                    inputProps={{ min: 1 }}
                />
            )}

            <Stack direction="row" spacing={1} alignItems="center">
                <TextField
                    select
                    size="small"
                    label="Stop after"
                    value={minutes}
                    onChange={(e) => setMinutes(Number(e.target.value))}
                    sx={{ minWidth: 130 }}
                >
                    <MenuItem value={1}>1 minute</MenuItem>
                    <MenuItem value={5}>5 minutes</MenuItem>
                    <MenuItem value={15}>15 minutes</MenuItem>
                    <MenuItem value={60}>1 hour</MenuItem>
                    <MenuItem value={0}>Never</MenuItem>
                </TextField>
                <Tooltip title="Send the pattern without the brightness, gamma, color order and color temperature tweaks, to compare.">
                    <FormControlLabel
                        control={
                            <Checkbox size="small" checked={bypass} onChange={(e) => setBypass(e.target.checked)} />
                        }
                        label={<Typography variant="body2">Without tweaks</Typography>}
                    />
                </Tooltip>
            </Stack>

            <Box>
                <Typography variant="caption" color="text.secondary">
                    Saved patterns
                </Typography>
                <Stack direction="row" spacing={0.5} sx={{ flexWrap: 'wrap', rowGap: 0.5, mt: 0.5 }}>
                    {doc.presets.map((p) => (
                        <Stack
                            key={p.id}
                            direction="row"
                            alignItems="center"
                            sx={{ border: 1, borderColor: 'divider', borderRadius: 1, pl: 0.5 }}
                        >
                            <Button
                                size="small"
                                onClick={() => setPattern(p.pattern)}
                                sx={{ minWidth: 0, textTransform: 'none' }}
                            >
                                {p.name}
                            </Button>
                            <IconButton
                                size="small"
                                aria-label={`Delete ${p.name}`}
                                onClick={() =>
                                    updateDoc((d) => ({ ...d, presets: d.presets.filter((x) => x.id !== p.id) }))
                                }
                            >
                                <DeleteOutlineIcon sx={{ fontSize: 16 }} />
                            </IconButton>
                        </Stack>
                    ))}
                    {!doc.presets.length && (
                        <Typography variant="body2" color="text.secondary">
                            None yet.
                        </Typography>
                    )}
                </Stack>
                <Stack direction="row" spacing={1} sx={{ mt: 1 }}>
                    <TextField
                        size="small"
                        fullWidth
                        placeholder="Name this pattern"
                        value={presetName}
                        onChange={(e) => setPresetName(e.target.value)}
                        onKeyDown={(e) => e.key === 'Enter' && savePreset()}
                    />
                    <Button
                        size="small"
                        variant="outlined"
                        startIcon={<SaveIcon />}
                        disabled={!presetName.trim()}
                        onClick={savePreset}
                    >
                        Save
                    </Button>
                </Stack>
            </Box>
        </Stack>
    );
};
