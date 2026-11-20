import React from 'react';
import { Box } from '../box/Box';
import { Button, IconButton, MenuItem, Slider, Stack, TextField, Tooltip, Typography } from '@mui/material';
import RestartAltIcon from '@mui/icons-material/RestartAlt';
import {
    COLOR_ORDERS,
    effectiveTweak,
    MAX_COLOR_TEMP_K,
    MIN_COLOR_TEMP_K,
    NEUTRAL_COLOR_TEMP_K,
    type OutputTweak,
    type TestTweakDoc,
    type TweakGroup,
    type TweakModelInfo,
} from '@ezplayer/ezplayer-core';
import { tweakChips } from './TargetPanel';

export interface TweakPanelProps {
    doc: TestTweakDoc;
    updateDoc: (change: (doc: TestTweakDoc) => TestTweakDoc) => void;
    models: TweakModelInfo[];
    /** Models being tweaked, when no group is. */
    selectedModels: string[];
    /** The group being tweaked as a whole. */
    group?: TweakGroup;
}

type Field = keyof OutputTweak;

/** The value the selected models share for a field; `mixed` when they differ. */
function shared<K extends Field>(
    tweaks: (OutputTweak | undefined)[],
    field: K,
): { value: OutputTweak[K]; mixed: boolean } {
    const first = tweaks[0]?.[field];
    return { value: first, mixed: tweaks.some((t) => t?.[field] !== first) };
}

const Row: React.FC<{
    label: string;
    value: string;
    isSet: boolean;
    onReset: () => void;
    children: React.ReactNode;
}> = ({ label, value, isSet, onReset, children }) => (
    <Box>
        <Stack direction="row" alignItems="center" justifyContent="space-between">
            <Typography variant="caption" color="text.secondary">
                {label}
            </Typography>
            <Stack direction="row" alignItems="center" spacing={0.5}>
                <Typography variant="caption" sx={{ fontWeight: isSet ? 700 : 400 }}>
                    {value}
                </Typography>
                <Tooltip title="Stop changing this">
                    <span>
                        <IconButton
                            size="small"
                            disabled={!isSet}
                            onClick={onReset}
                            aria-label={`Reset ${label}`}
                            sx={{ p: 0.25 }}
                        >
                            <RestartAltIcon sx={{ fontSize: 16 }} />
                        </IconButton>
                    </span>
                </Tooltip>
            </Stack>
        </Stack>
        {children}
    </Box>
);

export const TweakPanel: React.FC<TweakPanelProps> = ({ doc, updateDoc, models, selectedModels, group }) => {
    const tweaks: (OutputTweak | undefined)[] = group ? [group.tweak] : selectedModels.map((m) => doc.models[m]);
    if (!group && !selectedModels.length) {
        return (
            <Typography variant="body2" color="text.secondary">
                Select models or a group to adjust their color order, brightness, gamma and color temperature.
            </Typography>
        );
    }

    /** Set (or with undefined, clear) a field on the group or on every selected model. */
    const apply = <K extends Field>(field: K, value: OutputTweak[K] | undefined) =>
        updateDoc((d) => {
            const put = <T extends OutputTweak>(t: T | undefined): T => {
                const next = { ...(t ?? {}) } as T;
                if (value === undefined) delete next[field];
                else next[field] = value as T[K];
                return next;
            };
            if (group) {
                return {
                    ...d,
                    groups: d.groups.map((g) => {
                        if (g.id !== group.id) return g;
                        const tweak = put(g.tweak);
                        const { tweak: _old, ...rest } = g;
                        return Object.keys(tweak).length ? { ...rest, tweak } : rest;
                    }),
                };
            }
            const nextModels = { ...d.models };
            for (const name of selectedModels) {
                const next = put(nextModels[name]);
                if (Object.keys(next).length) nextModels[name] = next;
                else delete nextModels[name];
            }
            return { ...d, models: nextModels };
        });

    const clearAll = () => {
        apply('colorOrder', undefined);
        apply('brightness', undefined);
        apply('gamma', undefined);
        apply('colorTempK', undefined);
    };

    const order = shared(tweaks, 'colorOrder');
    const bright = shared(tweaks, 'brightness');
    const gamma = shared(tweaks, 'gamma');
    const temp = shared(tweaks, 'colorTempK');
    const anySet = tweaks.some(
        (t) =>
            t &&
            (t.colorOrder !== undefined ||
                t.brightness !== undefined ||
                t.gamma !== undefined ||
                t.colorTempK !== undefined),
    );
    const show = (s: { value: unknown; mixed: boolean }, text: string) =>
        s.mixed ? 'mixed' : s.value === undefined ? 'unchanged' : text;

    const single = !group && selectedModels.length === 1 ? models.find((m) => m.name === selectedModels[0]) : undefined;
    const eff = single ? effectiveTweak(doc, single.name) : undefined;
    const effChips = eff ? tweakChips(eff, true) : [];
    const fromGroups = eff ? doc.groups.filter((g) => eff.fromGroups.includes(g.id)).map((g) => g.name) : [];
    const xl = single
        ? [
              single.xlColorOrder,
              single.xlBrightness !== undefined ? `${single.xlBrightness}%` : undefined,
              single.xlGamma !== undefined ? `γ ${single.xlGamma}` : undefined,
          ].filter(Boolean)
        : [];

    return (
        <Stack spacing={1.5}>
            <Stack direction="row" alignItems="center" justifyContent="space-between">
                <Typography variant="body2" color="text.secondary" noWrap>
                    {group
                        ? `Group ${group.name} (${group.models.length} models)`
                        : selectedModels.length === 1
                          ? selectedModels[0]
                          : `${selectedModels.length} models`}
                </Typography>
                <Button size="small" disabled={!anySet} onClick={clearAll}>
                    Clear
                </Button>
            </Stack>

            <TextField
                select
                size="small"
                label="Color order"
                value={order.mixed ? '__mixed' : (order.value ?? '')}
                onChange={(e) =>
                    apply('colorOrder', e.target.value && e.target.value !== '__mixed' ? e.target.value : undefined)
                }
                helperText="The order the player sends red, green and blue in. Check it with the Color cycle pattern."
                SelectProps={{ displayEmpty: true }}
                InputLabelProps={{ shrink: true }}
            >
                <MenuItem value="">Unchanged</MenuItem>
                {order.mixed && (
                    <MenuItem value="__mixed" disabled>
                        Mixed
                    </MenuItem>
                )}
                {COLOR_ORDERS.map((o) => (
                    <MenuItem key={o} value={o}>
                        {o}
                    </MenuItem>
                ))}
            </TextField>

            <Row
                label="Brightness"
                value={show(bright, `${Math.round(bright.value ?? 100)}%`)}
                isSet={bright.mixed || bright.value !== undefined}
                onReset={() => apply('brightness', undefined)}
            >
                <Slider
                    size="small"
                    min={0}
                    max={100}
                    step={1}
                    value={bright.value ?? 100}
                    onChange={(_, v) => apply('brightness', v as number)}
                />
            </Row>

            <Row
                label="Gamma"
                value={show(gamma, (gamma.value ?? 1).toFixed(1))}
                isSet={gamma.mixed || gamma.value !== undefined}
                onReset={() => apply('gamma', undefined)}
            >
                <Slider
                    size="small"
                    min={0.5}
                    max={4}
                    step={0.1}
                    value={gamma.value ?? 1}
                    onChange={(_, v) => apply('gamma', v as number)}
                />
            </Row>

            <Row
                label="Color temperature"
                value={show(temp, `${Math.round(temp.value ?? NEUTRAL_COLOR_TEMP_K)} K`)}
                isSet={temp.mixed || temp.value !== undefined}
                onReset={() => apply('colorTempK', undefined)}
            >
                <Slider
                    size="small"
                    min={MIN_COLOR_TEMP_K}
                    max={MAX_COLOR_TEMP_K}
                    step={100}
                    value={temp.value ?? NEUTRAL_COLOR_TEMP_K}
                    onChange={(_, v) => apply('colorTempK', v as number)}
                    marks={[{ value: NEUTRAL_COLOR_TEMP_K }]}
                    sx={{
                        '& .MuiSlider-rail': {
                            opacity: 1,
                            background: 'linear-gradient(90deg, #ffb46b, #fff 45%, #c9d9ff)',
                        },
                        '& .MuiSlider-track': { opacity: 0 },
                    }}
                />
                <Typography variant="body2" color="text.secondary" sx={{ fontSize: 12 }}>
                    Lower is warmer, higher is cooler; {NEUTRAL_COLOR_TEMP_K} K leaves white alone. Only ever dims a
                    channel.
                </Typography>
            </Row>

            {group && (
                <Typography variant="body2" color="text.secondary" sx={{ fontSize: 12 }}>
                    Group brightness multiplies with each model's own. A model's own color order, gamma and color
                    temperature win over the group's.
                </Typography>
            )}
            {single && (
                <Typography variant="body2" color="text.secondary" sx={{ fontSize: 12 }}>
                    In effect: {effChips.length ? effChips.join(', ') : 'no change'}
                    {fromGroups.length ? ` (with group ${fromGroups.join(', ')})` : ''}.
                    {xl.length ? ` xLights has ${xl.join(', ')} on this model's controller connection.` : ''}
                </Typography>
            )}
            <Typography variant="body2" color="text.secondary" sx={{ fontSize: 12 }}>
                Tweaks are applied by the player as it sends, on top of whatever the controller does. They are saved
                with the show and take effect at once; the preview shows the picture before tweaks.
            </Typography>
        </Stack>
    );
};
