import { Add, ContentCopy, Delete } from '@mui/icons-material';
import {
    Autocomplete,
    Button,
    Checkbox,
    FormControl,
    FormControlLabel,
    IconButton,
    Switch,
    TextField,
    Tooltip,
    Typography,
} from '@mui/material';
import React, { useEffect, useMemo, useState } from 'react';
import { useDispatch, useSelector } from 'react-redux';
import { Select } from '@ezplayer/shared-ui-components';
import type { VirtualMatrixMode, VirtualMatrixOutput, VirtualMatrixStatus } from '@ezplayer/ezplayer-core';
import { Box } from '../../box/Box';
import { playbackSettingsActions } from '../../../store/slices/PlaybackSettingsStore';
import type { AppDispatch, RootState } from '../../../store/Store';
import { useFrameServerUrl } from '../../../hooks/useFrameServerUrl';

export const VIRTUAL_MATRIX_SETTINGS_SECTION_KEY = 'virtualMatrix';

interface DisplayInfo {
    index: number;
    id: number;
    label: string;
    width: number;
    height: number;
    primary: boolean;
}

interface TargetInfo {
    model: string;
    nodeCount: number;
    width?: number;
    height?: number;
}

const MODE_OPTIONS: { id: VirtualMatrixMode; name: string }[] = [
    { id: 'fullscreen', name: 'Full screen' },
    { id: 'window', name: 'Floating window' },
    { id: 'url', name: 'HTTP URL only' },
];

const FIT_OPTIONS = [
    { id: 'contain', name: 'Keep aspect ratio' },
    { id: 'fill', name: 'Scale to fit' },
];

const SIZE_OPTIONS = [
    { id: 'native', name: '1:1 (one screen pixel per model pixel)' },
    { id: 'custom', name: 'Custom size' },
];

/** The link another computer opens to show an output's picture. */
export function virtualMatrixLink(base: string, o: Pick<VirtualMatrixOutput, 'model' | 'smooth' | 'fit'>): string {
    const q = new URLSearchParams({ model: o.model });
    if (o.smooth) q.set('smooth', '1');
    if (o.fit === 'fill') q.set('fit', 'fill');
    return `${base}/matrix?${q.toString()}`;
}

const isLocalhost = (url: string) => /^https?:\/\/(localhost|127\.0\.0\.1)(:|\/|$)/.test(url);

/** A whole number of pixels that may be typed slowly; only valid values are reported. */
const PixelField: React.FC<{ label: string; value: number | undefined; onChange: (n: number) => void }> = ({
    label,
    value,
    onChange,
}) => {
    const [text, setText] = useState(value === undefined ? '' : String(value));
    useEffect(() => setText(value === undefined ? '' : String(value)), [value]);
    return (
        <TextField
            label={label}
            value={text}
            sx={{ width: 110 }}
            inputProps={{ inputMode: 'numeric' }}
            onChange={(e) => {
                const digits = e.target.value.replace(/[^0-9]/g, '').slice(0, 5);
                setText(digits);
                const n = Number(digits);
                if (n >= 1) onChange(n);
            }}
        />
    );
};

/**
 * Virtual matrix outputs: a model's pixels shown as a picture on a display of
 * the player computer, in a floating window, or only by URL. Models and
 * displays come from the player, so the lists are empty until it is reachable.
 */
export const VirtualMatrixSettings: React.FC = () => {
    const dispatch = useDispatch<AppDispatch>();
    const outputs = useSelector((s: RootState) => s.playbackSettings.settings.virtualMatrixOutputs ?? []);
    const { url } = useFrameServerUrl();
    const [displays, setDisplays] = useState<DisplayInfo[]>([]);
    const [targets, setTargets] = useState<TargetInfo[]>([]);
    const [lanUrls, setLanUrls] = useState<string[]>([]);
    const [matrixOnly, setMatrixOnly] = useState(true);
    const [copied, setCopied] = useState<string | null>(null);

    useEffect(() => {
        if (!url) return;
        let cancelled = false;
        const get = async <T,>(path: string): Promise<T | undefined> => {
            try {
                const res = await fetch(`${url}${path}`);
                return res.ok ? ((await res.json()) as T) : undefined;
            } catch {
                // Not reachable: the fields below still take typed values.
                return undefined;
            }
        };
        (async () => {
            const [d, t, s] = await Promise.all([
                get<{ displays?: DisplayInfo[] }>('/api/ezp/displays'),
                get<{ targets?: TargetInfo[] }>('/api/ezp/overlays/targets'),
                get<VirtualMatrixStatus>('/api/ezp/matrix/status'),
            ]);
            if (cancelled) return;
            setDisplays(d?.displays ?? []);
            setTargets(t?.targets ?? []);
            setLanUrls(s?.lanUrls ?? []);
        })();
        return () => {
            cancelled = true;
        };
    }, [url]);

    const update = (id: string, patch: Partial<VirtualMatrixOutput>) =>
        dispatch(playbackSettingsActions.updateVirtualMatrixOutput({ id, patch }));

    const sorted = useMemo(
        () =>
            [...targets].sort((a, b) =>
                a.model.localeCompare(b.model, undefined, { numeric: true, sensitivity: 'base' }),
            ),
        [targets],
    );
    const byName = useMemo(() => new Map(targets.map((t) => [t.model, t])), [targets]);
    const modelNames = useMemo(
        () => sorted.filter((t) => !matrixOnly || (t.width && t.height)).map((t) => t.model),
        [sorted, matrixOnly],
    );
    const describe = (name: string) => {
        const t = byName.get(name);
        if (!t) return name;
        return t.width && t.height ? `${name} (${t.width}x${t.height})` : `${name} (${t.nodeCount} px)`;
    };
    const displayOptions = displays.map((d) => ({
        id: String(d.index),
        name: `${d.index + 1}: ${d.label} ${d.width}x${d.height}${d.primary ? ' (primary)' : ''}`,
    }));

    // A link has to work from another computer, which this computer's own name for itself does not.
    const linkBase = lanUrls[0] ?? (url && /^https?:/.test(url) && !isLocalhost(url) ? url : '');

    const copy = async (id: string, link: string) => {
        try {
            await navigator.clipboard.writeText(link);
        } catch {
            // Pages served over plain http have no clipboard API.
            const el = document.createElement('textarea');
            el.value = link;
            document.body.appendChild(el);
            el.select();
            document.execCommand('copy');
            el.remove();
        }
        setCopied(id);
        setTimeout(() => setCopied((c) => (c === id ? null : c)), 1500);
    };

    return (
        <Box>
            <Typography variant="body2" color="text.secondary" sx={{ mb: 1 }}>
                Show a model as a picture: full screen on a display of the player computer (a projector, a panel, a TV
                over HDMI), in a floating window for LED panel software that captures part of the screen, or only at a
                link that any browser on the network can open.
            </Typography>
            <FormControlLabel
                control={<Checkbox checked={matrixOnly} onChange={(e) => setMatrixOnly(e.target.checked)} />}
                label="List matrix models only"
                sx={{ mb: 1 }}
            />
            {outputs.map((o) => {
                const mode: VirtualMatrixMode = o.mode ?? 'fullscreen';
                const custom = o.windowWidth !== undefined && o.windowHeight !== undefined;
                const grid = byName.get(o.model);
                const link = virtualMatrixLink(linkBase, o);
                return (
                    <Box key={o.id} sx={{ mb: 1.5, p: 1.5, border: 1, borderColor: 'divider', borderRadius: 1 }}>
                        <Box sx={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 1 }}>
                            <Autocomplete
                                // With no model list from the player the name is typed.
                                freeSolo={!targets.length}
                                disableClearable
                                sx={{ minWidth: 260, flex: 2 }}
                                // Keep the chosen model selectable even when the filter hides it.
                                options={
                                    o.model && !modelNames.includes(o.model) ? [o.model, ...modelNames] : modelNames
                                }
                                getOptionLabel={describe}
                                value={o.model}
                                onChange={(_e, v) => update(o.id, { model: v ?? '' })}
                                onInputChange={(_e, v, reason) => {
                                    if (reason === 'input' && !targets.length) update(o.id, { model: v });
                                }}
                                renderInput={(params) => <TextField {...params} label="Model" />}
                            />
                            <FormControl size="small" sx={{ minWidth: 180, flex: 1 }}>
                                <Select
                                    options={MODE_OPTIONS}
                                    itemText="name"
                                    itemValue="id"
                                    label="Show"
                                    value={mode}
                                    onChange={(e) =>
                                        update(o.id, {
                                            mode: (e.target as HTMLSelectElement).value as VirtualMatrixMode,
                                        })
                                    }
                                />
                            </FormControl>
                            {mode !== 'url' && (
                                <FormControlLabel
                                    control={
                                        <Switch
                                            checked={o.enabled}
                                            onChange={(e) => update(o.id, { enabled: e.target.checked })}
                                        />
                                    }
                                    label="Enabled"
                                />
                            )}
                            <IconButton
                                aria-label="Remove output"
                                onClick={() => dispatch(playbackSettingsActions.removeVirtualMatrixOutput(o.id))}
                            >
                                <Delete />
                            </IconButton>
                        </Box>

                        <Box sx={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 1, mt: 1.5 }}>
                            {mode === 'fullscreen' && (
                                <>
                                    <FormControl size="small" sx={{ minWidth: 260, flex: 2 }}>
                                        {displayOptions.length ? (
                                            <Select
                                                options={displayOptions}
                                                itemText="name"
                                                itemValue="id"
                                                label="Display"
                                                value={String(
                                                    displays.find((d) => d.id === o.displayId)?.index ?? o.display ?? 0,
                                                )}
                                                onChange={(e) => {
                                                    const index = Number((e.target as HTMLSelectElement).value);
                                                    update(o.id, { display: index, displayId: displays[index]?.id });
                                                }}
                                            />
                                        ) : (
                                            <PixelField
                                                label="Display number"
                                                value={(o.display ?? 0) + 1}
                                                onChange={(n) => update(o.id, { display: n - 1, displayId: undefined })}
                                            />
                                        )}
                                    </FormControl>
                                    <FormControl size="small" sx={{ minWidth: 180, flex: 1 }}>
                                        <Select
                                            options={FIT_OPTIONS}
                                            itemText="name"
                                            itemValue="id"
                                            label="Picture"
                                            value={o.fit ?? 'contain'}
                                            onChange={(e) =>
                                                update(o.id, {
                                                    fit: (e.target as HTMLSelectElement).value as 'contain' | 'fill',
                                                })
                                            }
                                        />
                                    </FormControl>
                                </>
                            )}
                            {mode === 'window' && (
                                <>
                                    <FormControl size="small" sx={{ minWidth: 260, flex: 2 }}>
                                        <Select
                                            options={SIZE_OPTIONS}
                                            itemText="name"
                                            itemValue="id"
                                            label="Window size"
                                            value={custom ? 'custom' : 'native'}
                                            onChange={(e) =>
                                                update(
                                                    o.id,
                                                    (e.target as HTMLSelectElement).value === 'custom'
                                                        ? {
                                                              windowWidth: grid?.width ?? 320,
                                                              windowHeight: grid?.height ?? 180,
                                                          }
                                                        : { windowWidth: undefined, windowHeight: undefined },
                                                )
                                            }
                                        />
                                    </FormControl>
                                    {custom && (
                                        <>
                                            <PixelField
                                                label="Width"
                                                value={o.windowWidth}
                                                onChange={(n) => update(o.id, { windowWidth: n })}
                                            />
                                            <PixelField
                                                label="Height"
                                                value={o.windowHeight}
                                                onChange={(n) => update(o.id, { windowHeight: n })}
                                            />
                                        </>
                                    )}
                                    <Typography variant="body2" color="text.secondary" sx={{ flex: 1, minWidth: 180 }}>
                                        {o.windowX !== undefined && o.windowY !== undefined
                                            ? `At ${o.windowX}, ${o.windowY}. Drag the window to move it.`
                                            : 'Drag the window to where it belongs; its place is remembered.'}
                                    </Typography>
                                </>
                            )}
                            <FormControlLabel
                                control={
                                    <Switch
                                        checked={!!o.smooth}
                                        onChange={(e) => update(o.id, { smooth: e.target.checked })}
                                    />
                                }
                                label="Smooth"
                            />
                        </Box>

                        {o.model && (
                            <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5, mt: 1 }}>
                                <Typography
                                    variant="body2"
                                    color="text.secondary"
                                    sx={{ fontFamily: 'monospace', overflowWrap: 'anywhere', userSelect: 'all' }}
                                >
                                    {link}
                                </Typography>
                                <Tooltip title={copied === o.id ? 'Copied' : 'Copy link'}>
                                    <IconButton size="small" aria-label="Copy link" onClick={() => copy(o.id, link)}>
                                        <ContentCopy fontSize="small" />
                                    </IconButton>
                                </Tooltip>
                            </Box>
                        )}
                    </Box>
                );
            })}
            <Button
                size="small"
                startIcon={<Add />}
                onClick={() =>
                    dispatch(
                        playbackSettingsActions.addVirtualMatrixOutput({
                            id: `vm-${Date.now().toString(36)}`,
                            model: modelNames[0] ?? sorted[0]?.model ?? '',
                            mode: 'fullscreen',
                            display: 0,
                            displayId: displays[0]?.id,
                            enabled: false,
                        }),
                    )
                }
            >
                Add output
            </Button>
        </Box>
    );
};
