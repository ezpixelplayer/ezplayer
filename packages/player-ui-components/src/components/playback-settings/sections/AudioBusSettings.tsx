import { Add, Delete, RestartAlt } from '@mui/icons-material';
import {
    Button,
    Checkbox,
    Chip,
    FormControlLabel,
    IconButton,
    Slider,
    Switch,
    TextField,
    Tooltip,
    Typography,
} from '@mui/material';
import React, { useState } from 'react';
import { useDispatch, useSelector } from 'react-redux';
import type { AudioBusOutput, ResolvedAudioBus } from '@ezplayer/ezplayer-core';
import {
    AUDIO_BUS_MAIN,
    MAX_AUDIO_BUSES,
    audioListenerNames,
    cleanAudioBus,
    isPhysicalAudioOutput,
    resolveAudioBuses,
} from '@ezplayer/ezplayer-core';
import { Box } from '../../box/Box';
import { playbackSettingsActions } from '../../../store/slices/PlaybackSettingsStore';
import type { AppDispatch, RootState } from '../../../store/Store';

/** A whole number typed into a box, sent on when the box is left or Enter is pressed. */
const NumberBox: React.FC<{ label: string; value: number; onCommit: (v: number) => void }> = ({
    label,
    value,
    onCommit,
}) => {
    const [draft, setDraft] = useState<string | null>(null);
    const commit = () => {
        const n = Number(draft);
        if (draft !== null && draft.trim() !== '' && Number.isFinite(n) && n !== value) onCommit(n);
        setDraft(null);
    };
    return (
        <TextField
            label={label}
            size="small"
            type="number"
            value={draft ?? String(value)}
            onChange={(e) => setDraft(e.target.value)}
            onBlur={commit}
            onKeyDown={(e) => {
                if (e.key === 'Enter') commit();
            }}
            sx={{ width: 110 }}
        />
    );
};

/** The buses that programs send sound to through the audio API: see, adjust, route and remove them. */
export const AudioBusSettings: React.FC = () => {
    const dispatch = useDispatch<AppDispatch>();
    const settings = useSelector((s: RootState) => s.playbackSettings.settings);
    /** null when the player has no local audio to route. */
    const devices = useSelector((s: RootState) => s.audioDevices.outputs);
    const [newName, setNewName] = useState('');
    const [draftVolumes, setDraftVolumes] = useState<Record<string, number | null>>({});

    const buses = resolveAudioBuses(settings);
    const stored = new Set((Array.isArray(settings.audioBuses) ? settings.audioBuses : []).map((b) => b?.name));
    const physical = (devices ?? []).filter(isPhysicalAudioOutput);
    const listeners = audioListenerNames(settings);
    const full = buses.length >= MAX_AUDIO_BUSES;
    const candidate = cleanAudioBus({ name: newName.trim() });
    const nameTaken = buses.some((b) => b.name === newName.trim());

    const set = (
        bus: ResolvedAudioBus,
        change: { leadMs?: number; chunkMs?: number; volume?: number; playLocally?: boolean },
    ) => {
        const r = cleanAudioBus({ name: bus.name, ...change });
        if (r.ok) dispatch(playbackSettingsActions.upsertAudioBus(r.bus));
    };

    const setOutputs = (bus: ResolvedAudioBus, ids: string[]) => {
        const outputs: AudioBusOutput[] = ids.map((id) => {
            const d = physical.find((p) => p.deviceId === id);
            const had = bus.outputs.find((o) => o.deviceId === id);
            return { deviceId: id, label: d?.label ?? had?.label ?? '', groupId: d?.groupId ?? had?.groupId };
        });
        dispatch(playbackSettingsActions.setAudioBusOutputs({ name: bus.name, outputs }));
    };

    /** `list` with `item` in it or not. */
    const toggled = (list: string[], item: string, on: boolean) =>
        on ? [...list.filter((x) => x !== item), item] : list.filter((x) => x !== item);

    const renderBus = (bus: ResolvedAudioBus) => {
        const volume = draftVolumes[bus.name] ?? bus.volume;
        // Chosen devices stay listed while unplugged.
        const options = [
            ...physical.map((d) => ({ id: d.deviceId, label: d.label || d.deviceId })),
            ...bus.outputs
                .filter((o) => !physical.some((d) => d.deviceId === o.deviceId))
                .map((o) => ({ id: o.deviceId, label: `${o.label || o.deviceId} (not connected)` })),
        ];
        const chosen = bus.outputs.map((o) => o.deviceId);
        // A listener a bus names stays listed after it is forgotten.
        const listenerOptions = [...listeners, ...bus.listeners.filter((n) => !listeners.includes(n))];
        return (
            <Box key={bus.name} sx={{ mb: 2, p: 2, border: 1, borderColor: 'divider', borderRadius: 1 }}>
                <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 1.5 }}>
                    <Typography variant="subtitle1" sx={{ fontWeight: 600, flexGrow: 1 }}>
                        {bus.name}
                    </Typography>
                    {bus.builtIn && <Chip size="small" label="Built in" />}
                    {bus.builtIn && stored.has(bus.name) && (
                        <Tooltip title="Back to its defaults">
                            <IconButton
                                size="small"
                                aria-label={`Reset ${bus.name}`}
                                onClick={() => dispatch(playbackSettingsActions.removeAudioBus(bus.name))}
                            >
                                <RestartAlt fontSize="small" />
                            </IconButton>
                        </Tooltip>
                    )}
                    {!bus.builtIn && (
                        <Tooltip title="Remove this bus; leases on it end">
                            <IconButton
                                size="small"
                                aria-label={`Remove ${bus.name}`}
                                onClick={() => dispatch(playbackSettingsActions.removeAudioBus(bus.name))}
                            >
                                <Delete fontSize="small" />
                            </IconButton>
                        </Tooltip>
                    )}
                </Box>
                <Box sx={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 2 }}>
                    <Box sx={{ flex: '1 1 220px', minWidth: 200, px: 1 }}>
                        <Typography variant="caption" color="text.secondary">
                            Volume: {volume}%
                        </Typography>
                        <Slider
                            size="small"
                            value={volume}
                            min={0}
                            max={100}
                            step={1}
                            onChange={(_, v) => setDraftVolumes((d) => ({ ...d, [bus.name]: v as number }))}
                            onChangeCommitted={(_, v) => {
                                setDraftVolumes((d) => ({ ...d, [bus.name]: null }));
                                set(bus, { volume: v as number });
                            }}
                        />
                    </Box>
                    <NumberBox label="Lead (ms)" value={bus.leadMs} onCommit={(leadMs) => set(bus, { leadMs })} />
                    <NumberBox label="Chunk (ms)" value={bus.chunkMs} onCommit={(chunkMs) => set(bus, { chunkMs })} />
                </Box>
                <Box sx={{ mt: 1 }}>
                    <FormControlLabel
                        control={
                            <Switch
                                size="small"
                                checked={bus.playLocally}
                                onChange={(e) => set(bus, { playLocally: e.target.checked })}
                            />
                        }
                        label="Play on this computer"
                    />
                    {devices !== null && bus.playLocally && (
                        <Box sx={{ ml: 4 }}>
                            <Typography variant="body2" color={chosen.length ? 'text.secondary' : 'text.primary'}>
                                {chosen.length
                                    ? 'Playing only on the devices checked.'
                                    : 'Playing on the show outputs. Check devices to play on those instead.'}
                            </Typography>
                            <Box sx={{ display: 'flex', flexDirection: 'column' }}>
                                {options.map((o) => (
                                    <FormControlLabel
                                        key={o.id}
                                        control={
                                            <Checkbox
                                                size="small"
                                                checked={chosen.includes(o.id)}
                                                onChange={(e) =>
                                                    setOutputs(bus, toggled(chosen, o.id, e.target.checked))
                                                }
                                            />
                                        }
                                        label={o.label}
                                    />
                                ))}
                            </Box>
                            {options.length === 0 && (
                                <Typography variant="body2" color="text.secondary">
                                    No audio output devices found.
                                </Typography>
                            )}
                        </Box>
                    )}
                </Box>
                {listenerOptions.length > 0 && (
                    <Box sx={{ mt: 1 }}>
                        <Typography variant="body2">Send to listeners</Typography>
                        <Box sx={{ display: 'flex', flexDirection: 'column', ml: 4 }}>
                            {listenerOptions.map((name) => (
                                <FormControlLabel
                                    key={name}
                                    control={
                                        <Checkbox
                                            size="small"
                                            checked={bus.listeners.includes(name)}
                                            onChange={(e) =>
                                                dispatch(
                                                    playbackSettingsActions.setAudioBusListeners({
                                                        name: bus.name,
                                                        listeners: toggled(bus.listeners, name, e.target.checked),
                                                    }),
                                                )
                                            }
                                        />
                                    }
                                    label={name}
                                />
                            ))}
                        </Box>
                    </Box>
                )}
            </Box>
        );
    };

    return (
        <Box>
            <Typography variant="h6" sx={{ mb: 1, color: 'primary.main' }}>
                Audio Buses
            </Typography>
            <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
                Other programs can send sound to the player through its audio API. Each bus is a place that sound can
                go. Sound sent to <b>{AUDIO_BUS_MAIN}</b> joins the show audio and is heard by listeners. Every other
                bus plays on this computer, with its own volume, timing and speakers, and can be picked up by a program
                that subscribes to it. A shorter lead plays sooner but leaves less time to deliver each piece. A bus
                that a program asks for by a new name is added here. A listener is a program on another computer, next
                to a speaker, that connects to the player by name; once it has connected, any bus can be sent to it.
            </Typography>
            {buses.filter((b) => b.name !== AUDIO_BUS_MAIN).map(renderBus)}
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                <TextField
                    size="small"
                    label="New bus name"
                    value={newName}
                    onChange={(e) => setNewName(e.target.value)}
                    error={newName.trim() !== '' && (!candidate.ok || nameTaken)}
                    helperText={
                        full
                            ? `The player takes ${MAX_AUDIO_BUSES - 1} buses besides the show audio; remove one first`
                            : newName.trim() === ''
                              ? undefined
                              : nameTaken
                                ? 'That name is in use'
                                : candidate.ok
                                  ? undefined
                                  : candidate.error
                    }
                />
                <Button
                    variant="contained"
                    startIcon={<Add />}
                    disabled={!candidate.ok || nameTaken || full}
                    onClick={() => {
                        if (!candidate.ok) return;
                        dispatch(playbackSettingsActions.upsertAudioBus(candidate.bus));
                        setNewName('');
                    }}
                >
                    Add Bus
                </Button>
            </Box>
            {listeners.length > 0 && (
                <Box sx={{ mt: 2 }}>
                    <Typography variant="subtitle2">Listeners</Typography>
                    {listeners.map((name) => (
                        <Box key={name} sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                            <Typography variant="body2">{name}</Typography>
                            <Tooltip title="Forget this listener; it is listed again when it next connects">
                                <IconButton
                                    size="small"
                                    aria-label={`Forget ${name}`}
                                    onClick={() => dispatch(playbackSettingsActions.removeAudioListener(name))}
                                >
                                    <Delete fontSize="small" />
                                </IconButton>
                            </Tooltip>
                        </Box>
                    ))}
                </Box>
            )}
        </Box>
    );
};
