import React, { useMemo, useState } from 'react';
import { Box } from '../box/Box';
import {
    Alert,
    Button,
    Checkbox,
    IconButton,
    MenuItem,
    Stack,
    Table,
    TableBody,
    TableCell,
    TableHead,
    TableRow,
    TextField,
    Tooltip,
    Typography,
} from '@mui/material';
import CallMergeIcon from '@mui/icons-material/CallMerge';
import ContentCutIcon from '@mui/icons-material/ContentCut';
import {
    duplicateOrders,
    mergeChunkWithNext,
    nextOrderOnPort,
    portChains,
    splitChunkAt,
    splitIntoStrings,
    validateChunks,
    type ChunkProblem,
    type ModelPortChunk,
    type TestTweakDoc,
    type TweakControllerInfo,
    type TweakModelInfo,
} from '@ezplayer/ezplayer-core';

export interface WiringPanelProps {
    doc: TestTweakDoc;
    updateDoc: (change: (doc: TestTweakDoc) => TestTweakDoc) => void;
    models: TweakModelInfo[];
    controllers: TweakControllerInfo[];
    selectedModels: string[];
    /** Problems the player found with the overrides. */
    problems: ChunkProblem[];
    /** Models whose wiring currently comes from here. */
    rewired: string[];
    onSelectModel: (name: string) => void;
    /** Go to the Controllers screen, where configuration is uploaded. */
    onOpenControllers?: () => void;
}

const Num: React.FC<{ value: number; min?: number; onChange: (v: number) => void; width?: number; label: string }> = ({
    value,
    min = 0,
    onChange,
    width = 58,
    label,
}) => (
    <TextField
        size="small"
        type="number"
        value={value}
        onChange={(e) => onChange(Math.max(min, Math.round(Number(e.target.value) || 0)))}
        inputProps={{ min, 'aria-label': label, style: { padding: '4px 6px' } }}
        sx={{ width }}
    />
);

export const WiringPanel: React.FC<WiringPanelProps> = ({
    doc,
    updateDoc,
    models,
    controllers,
    selectedModels,
    problems,
    rewired,
    onSelectModel,
    onOpenControllers,
}) => {
    const [cutAt, setCutAt] = useState<Record<number, string>>({});
    const model = selectedModels.length === 1 ? models.find((m) => m.name === selectedModels[0]) : undefined;
    const chunks = model ? doc.models[model.name]?.chunks : undefined;
    const chains = useMemo(() => portChains(doc), [doc]);
    const dupes = useMemo(() => duplicateOrders(chains), [chains]);

    const setChunks = (name: string, next: ModelPortChunk[] | undefined) =>
        updateDoc((d) => {
            const { chunks: _old, ...rest } = d.models[name] ?? {};
            const m = next?.length ? { ...rest, chunks: next } : rest;
            const nextModels = { ...d.models };
            if (Object.keys(m).length) nextModels[name] = m;
            else delete nextModels[name];
            return { ...d, models: nextModels };
        });

    /** Chunks that restate the xLights wiring: one per string, on consecutive ports from the model's own. */
    const fromXlights = (m: TweakModelInfo): ModelPortChunk[] =>
        splitIntoStrings(m.stringNodeCounts).map((c, i) => ({
            ...c,
            controller: m.controller,
            port: m.port > 0 ? m.port + i : 0,
            order: 10,
            ...(m.smartRemote ? { smartRemote: m.smartRemote } : {}),
        }));

    const patch = (i: number, p: Partial<ModelPortChunk>) => {
        if (!model || !chunks) return;
        setChunks(
            model.name,
            chunks.map((c, k) => (k === i ? { ...c, ...p } : c)),
        );
    };
    /** Moving a chunk to another port puts it at the end of that port. */
    const move = (i: number, controller: string, port: number) => {
        if (!chunks) return;
        const sr = chunks[i].smartRemote ?? 0;
        patch(i, {
            controller,
            port,
            order: controller && port > 0 ? nextOrderOnPort(doc, controller, port, sr) : chunks[i].order,
        });
    };

    const local = model && chunks ? validateChunks(model.name, chunks, model.nodeCount) : [];
    const fromPlayer = model
        ? problems.filter((p) => p.model === model.name && !local.some((l) => l.message === p.message))
        : [];
    const isRewired = !!model && rewired.includes(model.name);

    return (
        <Stack spacing={2} sx={{ p: 2 }}>
            <Typography variant="body2" color="text.secondary">
                Split a model into chunks and put each on a controller port. Chunks on the same port go out in ascending
                position number; the numbers need not be consecutive, so leave gaps (10, 20, 30) to make room for later.
                Models you do not touch keep their xLights wiring.
            </Typography>

            {!model && (
                <Alert severity="info">
                    {selectedModels.length > 1
                        ? 'Select a single model to edit its wiring.'
                        : 'Select a model on the left to edit its wiring.'}
                </Alert>
            )}

            {model && !model.pixel && (
                <Alert severity="info">{model.name} is not a pixel model; its wiring is not edited here.</Alert>
            )}

            {model && model.pixel && (
                <Box>
                    <Stack direction="row" spacing={1} alignItems="center" sx={{ flexWrap: 'wrap', rowGap: 1, mb: 1 }}>
                        <Typography variant="subtitle2">
                            {model.name} · {model.nodeCount} px
                        </Typography>
                        <Typography variant="body2" color="text.secondary">
                            xLights:{' '}
                            {model.controller ? `${model.controller} port ${model.port || '?'}` : 'no controller'}
                            {model.stringNodeCounts.length > 1 ? `, ${model.stringNodeCounts.length} strings` : ''}
                        </Typography>
                        <Box sx={{ flex: 1 }} />
                        {!chunks && (
                            <Button
                                size="small"
                                variant="contained"
                                onClick={() => setChunks(model.name, fromXlights(model))}
                            >
                                Override wiring
                            </Button>
                        )}
                        {chunks && (
                            <>
                                {model.stringNodeCounts.length > 1 && (
                                    <Button
                                        size="small"
                                        onClick={() =>
                                            setChunks(model.name, splitIntoStrings(model.stringNodeCounts, chunks))
                                        }
                                    >
                                        Split into strings
                                    </Button>
                                )}
                                <Button size="small" onClick={() => setChunks(model.name, fromXlights(model))}>
                                    Reset to xLights
                                </Button>
                                <Button size="small" color="warning" onClick={() => setChunks(model.name, undefined)}>
                                    Remove override
                                </Button>
                            </>
                        )}
                    </Stack>

                    {chunks && (
                        <Box sx={{ overflowX: 'auto' }}>
                            <Table size="small" sx={{ '& td, & th': { px: 0.5 }, minWidth: 600 }}>
                                <TableHead>
                                    <TableRow>
                                        <TableCell>Pixels</TableCell>
                                        <TableCell>Controller</TableCell>
                                        <TableCell>Port</TableCell>
                                        <TableCell>
                                            <Tooltip title="Order on the port: lower goes first. Gaps are fine.">
                                                <span>Position</span>
                                            </Tooltip>
                                        </TableCell>
                                        <TableCell>
                                            <Tooltip title="Smart remote / receiver on the port; 0 for none.">
                                                <span>Remote</span>
                                            </Tooltip>
                                        </TableCell>
                                        <TableCell>
                                            <Tooltip title="Unlit pixels before and after the chunk.">
                                                <span>Nulls</span>
                                            </Tooltip>
                                        </TableCell>
                                        <TableCell>
                                            <Tooltip title="The chunk is wired from its last pixel back to its first.">
                                                <span>Rev</span>
                                            </Tooltip>
                                        </TableCell>
                                        <TableCell>Cut / join</TableCell>
                                    </TableRow>
                                </TableHead>
                                <TableBody>
                                    {chunks.map((c, i) => (
                                        <TableRow key={`${c.nodeStart}-${c.nodeCount}`}>
                                            <TableCell sx={{ whiteSpace: 'nowrap' }}>
                                                {c.nodeStart + 1}–{c.nodeStart + c.nodeCount}
                                                <Typography variant="caption" color="text.secondary">
                                                    {' '}
                                                    ({c.nodeCount})
                                                </Typography>
                                            </TableCell>
                                            <TableCell>
                                                <TextField
                                                    select
                                                    size="small"
                                                    value={
                                                        controllers.some((x) => x.name === c.controller)
                                                            ? c.controller
                                                            : ''
                                                    }
                                                    onChange={(e) => move(i, e.target.value, c.port)}
                                                    SelectProps={{
                                                        displayEmpty: true,
                                                        inputProps: { 'aria-label': 'Controller' },
                                                    }}
                                                    sx={{ minWidth: 110, '& .MuiSelect-select': { py: '4px' } }}
                                                >
                                                    <MenuItem value="">
                                                        <em>None</em>
                                                    </MenuItem>
                                                    {controllers.map((x) => (
                                                        <MenuItem key={x.name} value={x.name}>
                                                            {x.name}
                                                        </MenuItem>
                                                    ))}
                                                </TextField>
                                            </TableCell>
                                            <TableCell>
                                                <Num
                                                    label="Port"
                                                    value={c.port}
                                                    onChange={(v) => move(i, c.controller, v)}
                                                />
                                            </TableCell>
                                            <TableCell>
                                                <Num
                                                    label="Position"
                                                    value={c.order}
                                                    onChange={(v) => patch(i, { order: v })}
                                                    width={68}
                                                />
                                            </TableCell>
                                            <TableCell>
                                                <Num
                                                    label="Smart remote"
                                                    value={c.smartRemote ?? 0}
                                                    onChange={(v) => patch(i, { smartRemote: v || undefined })}
                                                    width={50}
                                                />
                                            </TableCell>
                                            <TableCell sx={{ whiteSpace: 'nowrap' }}>
                                                <Num
                                                    label="Nulls before"
                                                    value={c.nullBefore ?? 0}
                                                    onChange={(v) => patch(i, { nullBefore: v || undefined })}
                                                    width={48}
                                                />{' '}
                                                <Num
                                                    label="Nulls after"
                                                    value={c.nullAfter ?? 0}
                                                    onChange={(v) => patch(i, { nullAfter: v || undefined })}
                                                    width={48}
                                                />
                                            </TableCell>
                                            <TableCell>
                                                <Checkbox
                                                    size="small"
                                                    checked={!!c.reverse}
                                                    onChange={(e) =>
                                                        patch(i, { reverse: e.target.checked || undefined })
                                                    }
                                                    inputProps={{ 'aria-label': 'Reverse' }}
                                                />
                                            </TableCell>
                                            <TableCell sx={{ whiteSpace: 'nowrap' }}>
                                                <TextField
                                                    size="small"
                                                    type="number"
                                                    placeholder="after"
                                                    value={cutAt[i] ?? ''}
                                                    onChange={(e) => setCutAt({ ...cutAt, [i]: e.target.value })}
                                                    inputProps={{
                                                        min: c.nodeStart + 1,
                                                        max: c.nodeStart + c.nodeCount - 1,
                                                        'aria-label': 'Cut after pixel',
                                                        style: { padding: '4px 6px' },
                                                    }}
                                                    sx={{ width: 70 }}
                                                />
                                                <Tooltip title="Cut this chunk in two after that pixel">
                                                    <span>
                                                        <IconButton
                                                            size="small"
                                                            disabled={
                                                                !(
                                                                    Number(cutAt[i]) > c.nodeStart &&
                                                                    Number(cutAt[i]) < c.nodeStart + c.nodeCount
                                                                )
                                                            }
                                                            onClick={() => {
                                                                setChunks(
                                                                    model.name,
                                                                    splitChunkAt(chunks, Math.round(Number(cutAt[i]))),
                                                                );
                                                                setCutAt({});
                                                            }}
                                                        >
                                                            <ContentCutIcon fontSize="small" />
                                                        </IconButton>
                                                    </span>
                                                </Tooltip>
                                                <Tooltip title="Join with the next chunk">
                                                    <span>
                                                        <IconButton
                                                            size="small"
                                                            disabled={i >= chunks.length - 1}
                                                            onClick={() =>
                                                                setChunks(model.name, mergeChunkWithNext(chunks, i))
                                                            }
                                                        >
                                                            <CallMergeIcon fontSize="small" />
                                                        </IconButton>
                                                    </span>
                                                </Tooltip>
                                            </TableCell>
                                        </TableRow>
                                    ))}
                                </TableBody>
                            </Table>
                        </Box>
                    )}

                    {chunks && (
                        <Stack spacing={1} sx={{ mt: 1 }}>
                            {[...local, ...fromPlayer].map((p, k) => (
                                <Alert key={k} severity="warning">
                                    {p.chunk !== undefined && chunks[p.chunk]
                                        ? `Pixels ${chunks[p.chunk].nodeStart + 1}–${chunks[p.chunk].nodeStart + chunks[p.chunk].nodeCount}: `
                                        : ''}
                                    {p.message}
                                </Alert>
                            ))}
                            {!local.length && !fromPlayer.length && (
                                <Alert severity={isRewired ? 'success' : 'info'}>
                                    {isRewired
                                        ? 'The player is sending this model by this wiring. Upload the controller configuration so the ports match.'
                                        : 'Waiting for the player to take this wiring.'}
                                </Alert>
                            )}
                        </Stack>
                    )}
                </Box>
            )}

            {chains.length > 0 && (
                <Box>
                    <Stack direction="row" alignItems="center" spacing={1} sx={{ mb: 0.5 }}>
                        <Typography variant="subtitle2">Overridden ports</Typography>
                        <Box sx={{ flex: 1 }} />
                        {onOpenControllers && (
                            <Button size="small" variant="outlined" onClick={onOpenControllers}>
                                Upload from Controllers
                            </Button>
                        )}
                    </Stack>
                    <Typography variant="body2" color="text.secondary" component="div" sx={{ mb: 1 }}>
                        The player's data already follows these overrides. The controllers do not until their string
                        configuration is uploaded again, which you do from the Controllers screen; its port map shows
                        the same wiring.
                    </Typography>
                    {dupes.map((d, k) => (
                        <Alert key={k} severity="info" sx={{ mb: 1 }}>
                            {d.controller} port {d.port}: {d.models.join(' and ')} share position {d.order}; they go out
                            in name order.
                        </Alert>
                    ))}
                    <Table size="small">
                        <TableHead>
                            <TableRow>
                                <TableCell>Controller</TableCell>
                                <TableCell>Port</TableCell>
                                <TableCell>In wire order</TableCell>
                                <TableCell align="right">Pixels</TableCell>
                            </TableRow>
                        </TableHead>
                        <TableBody>
                            {chains.map((chain) => (
                                <TableRow key={`${chain.controller}/${chain.port}/${chain.smartRemote}`}>
                                    <TableCell>{chain.controller}</TableCell>
                                    <TableCell>
                                        {chain.port}
                                        {chain.smartRemote ? ` (remote ${chain.smartRemote})` : ''}
                                    </TableCell>
                                    <TableCell>
                                        <Stack direction="row" spacing={0.5} sx={{ flexWrap: 'wrap', rowGap: 0.5 }}>
                                            {chain.entries.map((e) => (
                                                <Button
                                                    key={`${e.model}/${e.chunkIndex}`}
                                                    size="small"
                                                    variant={model?.name === e.model ? 'contained' : 'outlined'}
                                                    color={rewired.includes(e.model) ? 'primary' : 'warning'}
                                                    onClick={() => onSelectModel(e.model)}
                                                    sx={{ textTransform: 'none', py: 0, minWidth: 0 }}
                                                >
                                                    {e.chunk.order}: {e.model} {e.chunk.nodeStart + 1}–
                                                    {e.chunk.nodeStart + e.chunk.nodeCount}
                                                </Button>
                                            ))}
                                        </Stack>
                                    </TableCell>
                                    <TableCell align="right">{chain.pixels}</TableCell>
                                </TableRow>
                            ))}
                        </TableBody>
                    </Table>
                    {problems.some((p) => !rewired.includes(p.model)) && (
                        <Typography variant="body2" color="warning.main" component="div" sx={{ mt: 0.5 }}>
                            Models shown in the warning color have a problem and still use their xLights wiring.
                        </Typography>
                    )}
                </Box>
            )}
        </Stack>
    );
};
