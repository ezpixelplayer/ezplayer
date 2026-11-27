import React from 'react';
import { Box } from '../box/Box';
import { Checkbox, MenuItem, Slider, Stack, TextField, Typography } from '@mui/material';
import {
    COLOR_ORDERS,
    MAX_COLOR_TEMP_K,
    MIN_COLOR_TEMP_K,
    NEUTRAL_COLOR_TEMP_K,
    type OutputTweak,
    type TweakKey,
} from '@ezplayer/ezplayer-core';

/** Short labels for what a set of output settings changes, e.g. "70%", "GRB", "γ 2.2", "3000 K". */
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

export interface TweakFieldsProps {
    /** The settings made here; a missing one is "off". */
    value: OutputTweak;
    onChange: <K extends TweakKey>(key: K, value: OutputTweak[K] | undefined) => void;
    /** What a setting that is off here falls back to (a model's profile), for showing it. */
    inherited?: OutputTweak;
    /** Says what a ticked box means, e.g. "Set on every member". */
    onLabel: string;
    /** Says what an unticked box means, e.g. "Leave each member's as it is". */
    offLabel: string;
}

const DEFAULTS: Required<OutputTweak> = {
    colorOrder: 'RGB',
    brightness: 100,
    gamma: 1,
    colorTempK: NEUTRAL_COLOR_TEMP_K,
};

const NAMES: Record<TweakKey, string> = {
    colorOrder: 'Color order',
    brightness: 'Brightness',
    gamma: 'Gamma',
    colorTempK: 'Color temperature',
};

function describe(key: TweakKey, v: OutputTweak): string {
    switch (key) {
        case 'colorOrder':
            return v.colorOrder ?? '';
        case 'brightness':
            return `${Math.round(v.brightness ?? 100)}%`;
        case 'gamma':
            return (v.gamma ?? 1).toFixed(1);
        case 'colorTempK':
            return `${Math.round(v.colorTempK ?? NEUTRAL_COLOR_TEMP_K)} K`;
    }
}

/**
 * The four output settings, each with a tick box that says whether it is set
 * here at all.  Ticked: this value is used.  Unticked: nothing is set here,
 * and the slider shows what applies instead.
 */
export const TweakFields: React.FC<TweakFieldsProps> = ({ value, onChange, inherited, onLabel, offLabel }) => {
    const row = (key: TweakKey, control: (v: Required<OutputTweak>, on: boolean) => React.ReactNode) => {
        const on = value[key] !== undefined;
        const fallback = inherited?.[key];
        const live = { ...DEFAULTS, ...(inherited ?? {}), ...value } as Required<OutputTweak>;
        return (
            <Box key={key}>
                <Stack direction="row" alignItems="center">
                    <Checkbox
                        size="small"
                        edge="start"
                        checked={on}
                        inputProps={{ 'aria-label': `${onLabel}: ${NAMES[key]}` }}
                        onChange={(e) =>
                            onChange(key, e.target.checked ? (live[key] as OutputTweak[typeof key]) : undefined)
                        }
                    />
                    <Typography variant="body2" sx={{ fontWeight: on ? 600 : 400, mr: 1 }}>
                        {NAMES[key]}
                    </Typography>
                    <Typography
                        variant="body2"
                        color="text.secondary"
                        sx={{ fontSize: 12, ml: 'auto', textAlign: 'right' }}
                    >
                        {on
                            ? `${onLabel}: ${describe(key, value)}`
                            : fallback !== undefined
                              ? `${offLabel} (${describe(key, inherited!)})`
                              : offLabel}
                    </Typography>
                </Stack>
                <Box sx={{ pl: 4, pr: 1 }}>{control(live, on)}</Box>
            </Box>
        );
    };

    return (
        <Stack spacing={1}>
            {row('colorOrder', (v, on) => (
                <TextField
                    select
                    size="small"
                    disabled={!on}
                    value={v.colorOrder}
                    onChange={(e) => onChange('colorOrder', e.target.value)}
                    inputProps={{ 'aria-label': 'Color order' }}
                    sx={{ minWidth: 110 }}
                >
                    {COLOR_ORDERS.map((o) => (
                        <MenuItem key={o} value={o}>
                            {o}
                        </MenuItem>
                    ))}
                </TextField>
            ))}
            {row('brightness', (v, on) => (
                <Slider
                    size="small"
                    disabled={!on}
                    min={0}
                    max={100}
                    step={1}
                    value={v.brightness}
                    aria-label="Brightness"
                    onChange={(_, x) => onChange('brightness', x as number)}
                />
            ))}
            {row('gamma', (v, on) => (
                <Slider
                    size="small"
                    disabled={!on}
                    min={0.5}
                    max={4}
                    step={0.1}
                    value={v.gamma}
                    aria-label="Gamma"
                    onChange={(_, x) => onChange('gamma', x as number)}
                />
            ))}
            {row('colorTempK', (v, on) => (
                <Slider
                    size="small"
                    disabled={!on}
                    min={MIN_COLOR_TEMP_K}
                    max={MAX_COLOR_TEMP_K}
                    step={100}
                    value={v.colorTempK}
                    aria-label="Color temperature"
                    onChange={(_, x) => onChange('colorTempK', x as number)}
                    marks={[{ value: NEUTRAL_COLOR_TEMP_K }]}
                    sx={{
                        '& .MuiSlider-rail': {
                            opacity: on ? 1 : 0.4,
                            background: 'linear-gradient(90deg, #ffb46b, #fff 45%, #c9d9ff)',
                        },
                        '& .MuiSlider-track': { opacity: 0 },
                    }}
                />
            ))}
            <Typography variant="body2" color="text.secondary" sx={{ fontSize: 12 }}>
                Color temperature: lower is warmer, higher is cooler, {NEUTRAL_COLOR_TEMP_K} K leaves white alone; it
                only ever dims a channel. The player applies these as it sends, on top of whatever the controller does.
            </Typography>
        </Stack>
    );
};
