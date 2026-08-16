import React from 'react';
import { alpha, Chip, Typography, useTheme } from '@mui/material';
import type { Theme } from '@mui/material';
import { Box } from '../box/Box';
import { CompactDialog } from '../dialog/CompactDialog';
import { buildPortMap } from '@ezplayer/ezplayer-core';
import type { ControllerModelIntent, ControllerPort, ControllerPortIntent, PortMapBox } from '@ezplayer/ezplayer-core';

/** Smart-remote slot number → xLights letter (1 = A, 2 = B, …). */
const srLetter = (n: number): string => String.fromCharCode(64 + n);

/** One prop box on the CSS grid (row = physical port, span = ports its strings cover). */
const PropBox: React.FC<{ box: PortMapBox; drifted: boolean; theme: Theme }> = ({ box, drifted, theme }) => {
    const multi = box.strings.length > 1;
    return (
        <div
            style={{
                gridColumn: box.column + 1,
                gridRow: `${box.firstPort} / span ${box.span}`,
                border: `1px solid ${drifted ? theme.palette.warning.main : alpha(theme.palette.primary.main, 0.4)}`,
                borderRadius: theme.shape.borderRadius,
                // Low-alpha tint keeps text readable in either color scheme.
                background: alpha(drifted ? theme.palette.warning.main : theme.palette.primary.main, 0.1),
                padding: '4px 8px',
                minWidth: 130,
                maxWidth: 240,
                display: 'flex',
                flexDirection: 'column',
                justifyContent: box.span > 1 ? 'space-between' : 'center',
            }}
        >
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5, minWidth: 0 }}>
                {box.smartRemotes.length > 0 && (
                    <Chip
                        size="small"
                        color="info"
                        variant="outlined"
                        title={box.smartRemoteType ? `smart remote (${box.smartRemoteType})` : 'smart remote'}
                        label={box.smartRemotes.map(srLetter).join('')}
                        sx={{ height: 18, '& .MuiChip-label': { px: 0.5, fontSize: 11 } }}
                    />
                )}
                <Typography
                    variant="body2"
                    title={box.model}
                    sx={{ fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}
                >
                    {box.model}
                </Typography>
            </Box>
            <Typography variant="caption" sx={{ color: 'text.secondary' }}>
                {[
                    box.totalPixels !== undefined ? `${box.totalPixels} px` : undefined,
                    box.protocol,
                    box.span > 1 ? `spans ${box.span} ports` : undefined,
                ]
                    .filter(Boolean)
                    .join(' · ') || '—'}
            </Typography>
            {multi &&
                box.strings.map((s) => (
                    <Typography key={s.stringIndex} variant="caption" sx={{ color: 'text.secondary', lineHeight: 1.4 }}>
                        str {s.stringIndex} → port {s.port}
                        {s.smartRemote > 0 ? ` ${srLetter(s.smartRemote)}` : ''}
                        {s.nodeCount !== undefined ? ` · ${s.nodeCount} px` : ''}
                    </Typography>
                ))}
        </div>
    );
};

/** xLights-visualizer-style port map: ports down the left, props as boxes in
 *  data-chain order, with the device's actual pixel counts overlaid per port. */
export const PortVisualizerDialog: React.FC<{
    title: string;
    modelIntents?: ControllerModelIntent[];
    intent?: ControllerPortIntent[];
    actual?: ControllerPort[];
    onClose: () => void;
}> = ({ title, modelIntents, intent, actual, onClose }) => {
    const theme = useTheme();
    const map = buildPortMap(modelIntents, intent, actual);
    const driftedPorts = new Set(map.rows.filter((r) => r.drift).map((r) => r.port));
    const boxDrifted = (b: PortMapBox) =>
        Array.from({ length: b.span }, (_, i) => b.firstPort + i).some((p) => driftedPorts.has(p));
    const haveActual = (actual?.length ?? 0) > 0;

    return (
        <CompactDialog title={`Port map — ${title}`} onClose={onClose} fullScreen>
                {map.rows.length === 0 ? (
                    <Typography variant="body2" sx={{ color: 'text.secondary' }}>
                        No port configuration known for this controller yet — no xLights models are assigned to it and no
                        device port config has been read.
                    </Typography>
                ) : (
                    <>
                        <Box sx={{ overflowX: 'auto', pb: 1 }}>
                            <div
                                style={{
                                    display: 'grid',
                                    gridTemplateColumns: `max-content repeat(${Math.max(1, map.columns)}, max-content)`,
                                    gap: 6,
                                    alignItems: 'stretch',
                                    width: 'max-content',
                                }}
                            >
                                {map.rows.map((r) => (
                                    <div
                                        key={r.port}
                                        style={{
                                            gridColumn: 1,
                                            gridRow: r.port,
                                            padding: '4px 12px 4px 6px',
                                            borderLeft: `3px solid ${r.drift ? theme.palette.warning.main : 'transparent'}`,
                                            minWidth: 96,
                                        }}
                                    >
                                        <Typography variant="body2" sx={{ fontWeight: 600, whiteSpace: 'nowrap' }}>
                                            Port {r.port}
                                        </Typography>
                                        {r.intendedPixels !== undefined && (
                                            <Typography variant="caption" sx={{ display: 'block', color: 'text.secondary' }}>
                                                plan {r.intendedPixels} px
                                            </Typography>
                                        )}
                                        {haveActual && (
                                            <Typography
                                                variant="caption"
                                                title={r.actualModel ? `device model: ${r.actualModel}` : undefined}
                                                sx={{
                                                    display: 'block',
                                                    // amber = drift, green = matches plan, neutral = no plan.
                                                    color: r.drift
                                                        ? 'warning.main'
                                                        : r.intendedPixels !== undefined
                                                          ? 'success.main'
                                                          : 'text.secondary',
                                                }}
                                            >
                                                device {r.actualPixels ?? 0} px
                                            </Typography>
                                        )}
                                    </div>
                                ))}
                                {map.boxes.map((b) => (
                                    <PropBox key={b.model} box={b} drifted={boxDrifted(b)} theme={theme} />
                                ))}
                            </div>
                        </Box>
                        <Typography variant="caption" sx={{ color: 'text.secondary', display: 'block', mt: 1 }}>
                            Boxes read left→right in data-chain order per port; a tall box is one prop whose strings span
                            those ports. A/B/C marks smart-remote slots.
                            {haveActual
                                ? ' "device" is the port config actually read from the controller; amber marks ports where it differs from the xLights plan.'
                                : ' Run a full status read to overlay the device’s actual port config.'}
                        </Typography>
                    </>
                )}
        </CompactDialog>
    );
};
