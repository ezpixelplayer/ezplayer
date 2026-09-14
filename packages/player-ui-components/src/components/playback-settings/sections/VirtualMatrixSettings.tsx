import { Add, Delete } from '@mui/icons-material';
import { Button, FormControl, FormControlLabel, IconButton, Switch, TextField, Typography } from '@mui/material';
import React, { useEffect, useState } from 'react';
import { useDispatch, useSelector } from 'react-redux';
import { Select } from '@ezplayer/shared-ui-components';
import type { VirtualMatrixOutput } from '@ezplayer/ezplayer-core';
import { Box } from '../../box/Box';
import { playbackSettingsActions } from '../../../store/slices/PlaybackSettingsStore';
import type { AppDispatch, RootState } from '../../../store/Store';
import { useFrameServerUrl } from '../../../hooks/useFrameServerUrl';

interface DisplayInfo {
    index: number;
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

/**
 * Virtual matrix outputs: a model shown full-screen on one of the player
 * computer's displays. Models and displays come from the player, so the list
 * is empty until it is reachable.
 */
export const VirtualMatrixSettings: React.FC = () => {
    const dispatch = useDispatch<AppDispatch>();
    const outputs = useSelector((s: RootState) => s.playbackSettings.settings.virtualMatrixOutputs ?? []);
    const { url } = useFrameServerUrl();
    const [displays, setDisplays] = useState<DisplayInfo[]>([]);
    const [targets, setTargets] = useState<TargetInfo[]>([]);

    useEffect(() => {
        if (!url) return;
        let cancelled = false;
        (async () => {
            try {
                const d = await fetch(`${url}/api/ezp/displays`);
                if (d.ok && !cancelled) setDisplays(((await d.json()) as { displays?: DisplayInfo[] }).displays ?? []);
            } catch {
                /* not an Electron player, or not reachable: the index field still works */
            }
            try {
                const t = await fetch(`${url}/api/ezp/overlays/targets`);
                if (t.ok && !cancelled) setTargets(((await t.json()) as { targets?: TargetInfo[] }).targets ?? []);
            } catch {
                /* model name can still be typed */
            }
        })();
        return () => {
            cancelled = true;
        };
    }, [url]);

    const update = (id: string, patch: Partial<VirtualMatrixOutput>) =>
        dispatch(playbackSettingsActions.updateVirtualMatrixOutput({ id, patch }));

    const modelOptions = targets.map((t) => ({
        id: t.model,
        name: t.width && t.height ? `${t.model} (${t.width}×${t.height})` : `${t.model} (${t.nodeCount} px)`,
    }));
    const displayOptions = displays.map((d) => ({
        id: String(d.index),
        name: `${d.index + 1}: ${d.label} ${d.width}×${d.height}${d.primary ? ' (primary)' : ''}`,
    }));

    return (
        <Box>
            <Typography variant="subtitle2" sx={{ mb: 0.5 }}>
                Virtual matrix outputs
            </Typography>
            <Typography variant="body2" color="text.secondary" sx={{ mb: 1 }}>
                Show a model full-screen on a display of the player computer, for a projector, a panel, or a TV over
                HDMI. Any browser can show the same picture at <code>{url ? `${url}/matrix?model=NAME` : '/matrix?model=NAME'}</code>.
            </Typography>
            {outputs.map((o) => (
                <Box
                    key={o.id}
                    sx={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 1, mb: 1, p: 1, border: 1, borderColor: 'divider', borderRadius: 1 }}
                >
                    <FormControl size="small" sx={{ minWidth: 200, flex: 1 }}>
                        {modelOptions.length ? (
                            <Select
                                options={modelOptions.some((m) => m.id === o.model) || !o.model ? modelOptions : [{ id: o.model, name: o.model }, ...modelOptions]}
                                itemText="name"
                                itemValue="id"
                                label="Model"
                                value={o.model}
                                onChange={(e) => update(o.id, { model: (e.target as HTMLSelectElement).value })}
                            />
                        ) : (
                            <TextField
                                size="small"
                                label="Model"
                                value={o.model}
                                onChange={(e) => update(o.id, { model: e.target.value })}
                            />
                        )}
                    </FormControl>
                    <FormControl size="small" sx={{ minWidth: 200, flex: 1 }}>
                        {displayOptions.length ? (
                            <Select
                                options={displayOptions}
                                itemText="name"
                                itemValue="id"
                                label="Display"
                                value={String(o.display ?? 0)}
                                onChange={(e) => update(o.id, { display: Number((e.target as HTMLSelectElement).value) })}
                            />
                        ) : (
                            <TextField
                                size="small"
                                label="Display number"
                                value={String((o.display ?? 0) + 1)}
                                inputProps={{ inputMode: 'numeric' }}
                                onChange={(e) => {
                                    const n = Number(e.target.value.replace(/[^0-9]/g, ''));
                                    if (n >= 1) update(o.id, { display: n - 1 });
                                }}
                            />
                        )}
                    </FormControl>
                    <FormControlLabel
                        control={<Switch checked={!!o.smooth} onChange={(e) => update(o.id, { smooth: e.target.checked })} />}
                        label="Smooth"
                    />
                    <FormControlLabel
                        control={<Switch checked={o.enabled} onChange={(e) => update(o.id, { enabled: e.target.checked })} />}
                        label="Enabled"
                    />
                    <IconButton aria-label="Remove output" onClick={() => dispatch(playbackSettingsActions.removeVirtualMatrixOutput(o.id))}>
                        <Delete />
                    </IconButton>
                </Box>
            ))}
            <Button
                size="small"
                startIcon={<Add />}
                onClick={() =>
                    dispatch(
                        playbackSettingsActions.addVirtualMatrixOutput({
                            id: `vm-${Date.now().toString(36)}`,
                            model: targets.find((t) => t.width && t.height)?.model ?? targets[0]?.model ?? '',
                            display: 0,
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
