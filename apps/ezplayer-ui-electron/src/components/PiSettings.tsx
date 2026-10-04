import React, { useEffect, useState } from 'react';
import { Alert, Box, Button, Checkbox, FormControlLabel, MenuItem, TextField, Typography } from '@mui/material';

type Device = { name: string; type: string; state: number; addresses: string[]; gateway: string; dns: string[] };
type Status = {
    devices: Device[];
    pending: { token: string; seconds: number } | null;
    hostname: string;
    freeBytes: number;
    timezone: string;
};
type Network = { ssid: string; signal: number; security: string };
const request = async <T,>(value: Record<string, unknown>): Promise<T> => {
    if (!window.electronAPI?.piRequest) throw new Error('Pi service is unavailable.');
    return (await window.electronAPI.piRequest(value)) as T;
};

export function PiSettings({ system = false }: { system?: boolean }) {
    const [status, setStatus] = useState<Status | null>(null);
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState('');
    const [notice, setNotice] = useState('');
    const [iface, setIface] = useState('');
    const [networks, setNetworks] = useState<Network[]>([]);
    const [networkIndex, setNetworkIndex] = useState('');
    const [password, setPassword] = useState('');
    const [method, setMethod] = useState('auto');
    const [address, setAddress] = useState('');
    const [gateway, setGateway] = useState('');
    const [dns, setDns] = useState('');
    const [controllerOnly, setControllerOnly] = useState(true);
    const [zone, setZone] = useState('America/New_York');
    const [powerAction, setPowerAction] = useState('');
    const refresh = async () => setStatus(await request<Status>({ action: 'status' }));
    useEffect(() => {
        let active = true;
        const poll = () =>
            request<Status>({ action: 'status' })
                .then((s) => {
                    if (active) setStatus(s);
                })
                .catch((e) => {
                    if (active) setError(String(e.message));
                });
        void poll();
        const timer = window.setInterval(() => void poll(), 5000);
        return () => {
            active = false;
            window.clearInterval(timer);
        };
    }, []);
    const run = async (fn: () => Promise<void>) => {
        setBusy(true);
        setError('');
        setNotice('');
        try {
            await fn();
            await refresh();
        } catch (e) {
            setError(e instanceof Error ? e.message : String(e));
        } finally {
            setBusy(false);
        }
    };
    const device = status?.devices.find((d) => d.name === iface);
    const network = networks[Number(networkIndex)];
    const pending = status?.pending;
    return (
        <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
            {error && <Alert severity="error">{error}</Alert>}
            {notice && <Alert severity="success">{notice}</Alert>}
            {pending && (
                <Alert severity="warning">
                    Network settings are temporary. Check that the connection works, then keep it. Automatic rollback in
                    approximately {pending.seconds} seconds.
                    <Box sx={{ display: 'flex', gap: 1, mt: 1 }}>
                        <Button
                            disabled={busy}
                            onClick={() =>
                                void run(async () => {
                                    await request({ action: 'confirm', token: pending.token });
                                    setNotice('Network settings saved.');
                                })
                            }
                        >
                            Keep connection
                        </Button>
                        <Button
                            disabled={busy}
                            onClick={() =>
                                void run(async () => {
                                    await request({ action: 'revert', token: pending.token });
                                })
                            }
                        >
                            Revert
                        </Button>
                    </Box>
                </Alert>
            )}
            {system ? (
                <>
                    <Typography>Player: {status?.hostname ?? 'Loading…'}</Typography>
                    <Typography>
                        Free space on home filesystem: {status ? (status.freeBytes / 1073741824).toFixed(1) : '…'} GB
                    </Typography>
                    <Typography>Current time zone: {status?.timezone}</Typography>
                    <TextField
                        label="Time zone (IANA name)"
                        value={zone}
                        onChange={(e) => setZone(e.target.value)}
                        helperText="Example: America/New_York"
                    />
                    <Button
                        disabled={busy || !!pending}
                        onClick={() =>
                            void run(async () => {
                                await request({ action: 'timezone', timezone: zone });
                                setNotice('Time zone saved. Restart EZPlayer before relying on the updated schedule.');
                            })
                        }
                    >
                        Save time zone
                    </Button>
                    <Alert severity="info">
                        Stop the show before rebooting or shutting down. A shutdown requires switching the Pi power off
                        and on to start it again.
                    </Alert>
                    <Box sx={{ display: 'flex', gap: 2 }}>
                        <Button disabled={busy || !!pending} onClick={() => setPowerAction('restartPlayer')}>
                            Restart EZPlayer
                        </Button>
                        <Button disabled={busy || !!pending} onClick={() => setPowerAction('reboot')}>
                            Reboot Pi
                        </Button>
                        <Button disabled={busy || !!pending} onClick={() => setPowerAction('shutdown')}>
                            Shut down Pi
                        </Button>
                    </Box>
                    {powerAction && (
                        <Alert severity="warning">
                            Confirm {powerAction === 'restartPlayer' ? 'restart EZPlayer' : powerAction}?
                            <Button
                                disabled={busy}
                                onClick={() =>
                                    void run(async () => {
                                        await request({ action: powerAction });
                                        setPowerAction('');
                                        setNotice('Power action requested.');
                                    })
                                }
                            >
                                Confirm
                            </Button>
                            <Button onClick={() => setPowerAction('')}>Cancel</Button>
                        </Alert>
                    )}
                </>
            ) : (
                <>
                    <Alert severity="info">
                        Use Wi-Fi for internet and Ethernet for controllers. Controller-only Ethernet has no default
                        route. Stop the show before changing network settings.
                    </Alert>
                    {status?.devices.map((d) => (
                        <Typography key={d.name}>
                            {d.name} ({d.type}): {d.state === 100 ? 'Connected' : 'Not connected'} ·{' '}
                            {d.addresses.join(', ') || 'No IPv4 address'}
                            {d.gateway ? ` · Gateway ${d.gateway}` : ''}
                        </Typography>
                    ))}
                    <TextField
                        select
                        label="Interface"
                        value={iface}
                        disabled={busy || !!pending}
                        onChange={(e) => {
                            setIface(e.target.value);
                            setNetworks([]);
                            setNetworkIndex('');
                            setPassword('');
                        }}
                    >
                        {status?.devices.map((d) => (
                            <MenuItem key={d.name} value={d.name}>
                                {d.name} ({d.type})
                            </MenuItem>
                        ))}
                    </TextField>
                    {device?.type === 'wifi' && (
                        <>
                            <Button
                                disabled={busy || !!pending}
                                onClick={() =>
                                    void run(async () => {
                                        setNetworks(await request<Network[]>({ action: 'scan', interface: iface }));
                                        setNetworkIndex('');
                                    })
                                }
                            >
                                Scan / refresh Wi-Fi
                            </Button>
                            <Typography variant="caption">
                                Scan results may take a few seconds to update. Refresh again if needed. This build
                                supports open and WPA/WPA2 personal networks.
                            </Typography>
                            <TextField
                                select
                                label="Wi-Fi network"
                                value={networkIndex}
                                disabled={busy || !!pending}
                                onChange={(e) => {
                                    setNetworkIndex(e.target.value);
                                    setPassword('');
                                }}
                            >
                                {networks.map((n, i) => (
                                    <MenuItem key={i} value={String(i)} disabled={n.security === 'unsupported'}>
                                        {n.ssid} · {n.signal}% · {n.security}
                                    </MenuItem>
                                ))}
                            </TextField>
                            {network?.security === 'personal' && (
                                <TextField
                                    label="Wi-Fi password"
                                    type="password"
                                    value={password}
                                    disabled={busy || !!pending}
                                    onChange={(e) => setPassword(e.target.value)}
                                />
                            )}
                            <Button
                                disabled={
                                    busy ||
                                    !!pending ||
                                    networkIndex === '' ||
                                    !network ||
                                    network.security === 'unsupported'
                                }
                                onClick={() =>
                                    void run(async () => {
                                        await request({
                                            action: 'wifi',
                                            interface: iface,
                                            ssid: network.ssid,
                                            security: network.security,
                                            password,
                                        });
                                        setPassword('');
                                    })
                                }
                            >
                                Connect
                            </Button>
                        </>
                    )}
                    {device?.type === 'ethernet' && (
                        <>
                            <TextField
                                select
                                label="IPv4 mode"
                                value={method}
                                disabled={busy || !!pending}
                                onChange={(e) => setMethod(e.target.value)}
                            >
                                <MenuItem value="auto">DHCP</MenuItem>
                                <MenuItem value="manual">Static IP</MenuItem>
                            </TextField>
                            {method === 'manual' && (
                                <TextField
                                    label="IPv4 address / prefix"
                                    placeholder="192.168.50.2/24"
                                    value={address}
                                    disabled={busy || !!pending}
                                    onChange={(e) => setAddress(e.target.value)}
                                />
                            )}
                            <FormControlLabel
                                label="Controller-only network (no internet default route)"
                                control={
                                    <Checkbox
                                        checked={controllerOnly}
                                        disabled={busy || !!pending}
                                        onChange={(e) => {
                                            setControllerOnly(e.target.checked);
                                            setGateway('');
                                            setDns('');
                                        }}
                                    />
                                }
                            />
                            {!controllerOnly && (
                                <>
                                    <TextField
                                        label="Gateway (optional)"
                                        value={gateway}
                                        disabled={busy || !!pending}
                                        onChange={(e) => setGateway(e.target.value)}
                                    />
                                    <TextField
                                        label="DNS IPv4 addresses (comma-separated, optional)"
                                        value={dns}
                                        disabled={busy || !!pending}
                                        onChange={(e) => setDns(e.target.value)}
                                    />
                                </>
                            )}
                            <Button
                                disabled={busy || !!pending}
                                onClick={() =>
                                    void run(async () => {
                                        await request({
                                            action: 'ethernet',
                                            interface: iface,
                                            method,
                                            address,
                                            gateway,
                                            dns: dns
                                                .split(',')
                                                .map((v) => v.trim())
                                                .filter(Boolean),
                                            controllerOnly,
                                        });
                                    })
                                }
                            >
                                Apply Ethernet settings
                            </Button>
                        </>
                    )}
                </>
            )}
            {busy && <Typography>Applying settings…</Typography>}
        </Box>
    );
}

export function PiAudioTest() {
    const [sink, setSink] = useState('');
    const [outputs, setOutputs] = useState<MediaDeviceInfo[]>([]);
    useEffect(() => {
        void navigator.mediaDevices
            .enumerateDevices()
            .then((ds) => setOutputs(ds.filter((d) => d.kind === 'audiooutput')))
            .catch(() => {});
    }, []);
    const [error, setError] = useState('');
    const [busy, setBusy] = useState(false);
    const play = async () => {
        setBusy(true);
        setError('');
        let context: AudioContext | undefined;
        try {
            context = new AudioContext();
            if (sink) {
                const routed = context as AudioContext & { setSinkId?: (id: string) => Promise<void> };
                if (!routed.setSinkId) throw new Error('Audio device routing is unavailable on this build.');
                await routed.setSinkId(sink);
            }
            await context.resume();
            const tone = context.createOscillator();
            const gain = context.createGain();
            gain.gain.value = 0.05;
            tone.frequency.value = 440;
            tone.connect(gain);
            gain.connect(context.destination);
            tone.start();
            tone.stop(context.currentTime + 1);
            await new Promise<void>((resolve) => {
                tone.onended = () => resolve();
            });
        } catch (e) {
            setError(e instanceof Error ? e.message : String(e));
        } finally {
            await context?.close();
            setBusy(false);
        }
    };
    return (
        <Box sx={{ mt: 2 }}>
            <TextField
                select
                fullWidth
                label="Test audio output"
                value={sink}
                disabled={busy}
                onChange={(e) => setSink(e.target.value)}
            >
                <MenuItem value="">System default</MenuItem>
                {outputs
                    .filter((d) => d.deviceId !== 'default' && d.deviceId !== 'communications')
                    .map((d) => (
                        <MenuItem key={d.deviceId} value={d.deviceId}>
                            {d.label || d.deviceId}
                        </MenuItem>
                    ))}
            </TextField>
            <Button disabled={busy} onClick={() => void play()}>
                Play test sound
            </Button>
            <Typography variant="caption" display="block">
                Plays a quiet tone through the chosen output. This tests the device; use a sequence to check playback
                routing and synchronization.
            </Typography>
            {error && <Alert severity="error">{error}</Alert>}
        </Box>
    );
}
