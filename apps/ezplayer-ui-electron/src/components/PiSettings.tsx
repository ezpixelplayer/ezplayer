import { useEffect, useState } from 'react';
import { useDispatch, useSelector } from 'react-redux';
import { v4 as uuidv4 } from 'uuid';
import { postSetPlayerIdToken, type AppDispatch, type RootState } from '@ezplayer/player-ui-components';
import { playerRegistrationUrl } from './piRegistration';
import { Alert, Box, Button, Checkbox, FormControlLabel, MenuItem, TextField, Typography } from '@mui/material';

type Device = { name: string; type: string; state: number; addresses: string[]; gateway: string; dns: string[] };
type Status = {
    devices: Device[];
    pending: { token: string; seconds: number } | null;
    hostname: string;
    freeBytes: number;
    timezone: string;
    hotspot?: {
        mode: string;
        ssid: string;
        password: string;
        active: boolean;
        interface: string;
        url: string;
        error: string;
        setup: { state: string; ssid: string; error?: string } | null;
    } | null;
};
type Network = { ssid: string; signal: number; security: string };
function ipv4Octets(value: string): number[] | null {
    const parts = value.trim().split('.');
    if (parts.length !== 4 || parts.some((part) => !/^(0|[1-9]\d{0,2})$/.test(part) || Number(part) > 255)) {
        return null;
    }
    return parts.map(Number);
}

function subnetMaskPrefix(value: string): number | null {
    const octets = ipv4Octets(value);
    if (!octets) return null;
    const bits = octets.map((octet) => octet.toString(2).padStart(8, '0')).join('');
    if (!/^1*0*$/.test(bits)) return null;
    return bits.indexOf('0') === -1 ? 32 : bits.indexOf('0');
}

const request = async <T,>(value: Record<string, unknown>): Promise<T> => {
    const api = (
        window as Window & { electronAPI?: { piRequest?: (value: Record<string, unknown>) => Promise<unknown> } }
    ).electronAPI;
    if (api?.piRequest) return (await api.piRequest(value)) as T;
    const response = await fetch('/api/ezp/pi', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-EZPlayer-Pi': '1' },
        body: JSON.stringify(value),
    });
    const result = await response.json();
    if (!response.ok) throw new Error(result.error || 'Pi service is unavailable.');
    return result as T;
};

export function PiSettings({ system = false }: { system?: boolean }) {
    const dispatch = useDispatch<AppDispatch>();
    const cloudConfig = useSelector((s: RootState) => s.cloudConfig);
    const [handoff, setHandoff] = useState<{ url: string; started: number } | null>(null);
    const [status, setStatus] = useState<Status | null>(null);
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState('');
    const [notice, setNotice] = useState('');
    const [iface, setIface] = useState('');
    const [networks, setNetworks] = useState<Network[]>([]);
    const [networkIndex, setNetworkIndex] = useState('');
    const [manualSsid, setManualSsid] = useState('');
    const [manualSecurity, setManualSecurity] = useState('personal');
    const [hotspotMode, setHotspotMode] = useState('');
    const [setupSsid, setSetupSsid] = useState<string | null>(null);
    const [setupPassword, setSetupPassword] = useState('');
    const [password, setPassword] = useState('');
    const [method, setMethod] = useState('auto');
    const [address, setAddress] = useState('');
    const [subnetMask, setSubnetMask] = useState('255.255.255.0');
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
                    if (active) {
                        setStatus(s);
                        if (s.hotspot?.setup?.state === 'failed') setHandoff(null);
                    }
                    if (active) setIface((current) => current || s.devices.find((d) => d.type === 'wifi')?.name || '');
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
    useEffect(() => {
        if (!handoff) return;
        let cancelled = false;
        const check = async () => {
            // A single radio loses the setup connection before it can report success.
            // Wait for the phone's internet to return; this does not prove Pi connectivity.
            if (Date.now() - handoff.started < 30000) return;
            try {
                await fetch(new URL('/favicon.ico', handoff.url).href, {
                    mode: 'no-cors',
                    credentials: 'omit',
                    cache: 'no-store',
                    signal: AbortSignal.timeout(4000),
                });
                if (!cancelled) window.location.assign(handoff.url);
            } catch {
                // Keep the registration link visible while the phone reconnects.
            }
        };
        const timer = window.setInterval(() => void check(), 5000);
        return () => {
            cancelled = true;
            window.clearInterval(timer);
        };
    }, [handoff]);
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
    const network =
        networkIndex === 'manual'
            ? { ssid: manualSsid.trim(), security: manualSecurity, signal: 0 }
            : networks[Number(networkIndex)];
    const pending = status?.pending;
    const addressValid = ipv4Octets(address) !== null;
    const prefix = subnetMaskPrefix(subnetMask);
    return (
        <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
            {error && <Alert severity="error">{error}</Alert>}
            {notice && <Alert severity="success">{notice}</Alert>}
            {handoff && (
                <Alert severity="info">
                    Wi-Fi setup is in progress. When setup Wi-Fi disconnects, join your home Wi-Fi or use mobile data.
                    This page will try to open registration with your player ID when internet returns. If Wi-Fi setup
                    fails, rejoin the player's setup Wi-Fi and correct the password.
                    <Box sx={{ mt: 1 }}>
                        <Button href={handoff.url}>Open player registration</Button>
                        <Button onClick={() => setHandoff(null)}>Cancel redirect</Button>
                    </Box>
                    If your phone closes this setup window, open this link in your normal browser first.
                </Alert>
            )}
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
                    {status?.hotspot && (
                        <>
                            <TextField
                                select
                                label="Tethering"
                                value={hotspotMode || status.hotspot.mode}
                                disabled={busy || !!pending || status.hotspot.setup?.state === 'connecting'}
                                onChange={(e) => setHotspotMode(e.target.value)}
                                helperText="Auto offers setup Wi-Fi until the player connects to a Wi-Fi network."
                            >
                                <MenuItem value="auto">Auto</MenuItem>
                                <MenuItem value="off">Off</MenuItem>
                            </TextField>
                            <TextField
                                label="Setup Wi-Fi name (SSID)"
                                value={setupSsid ?? status.hotspot.ssid}
                                disabled={busy || !!pending}
                                onChange={(e) => setSetupSsid(e.target.value)}
                                helperText="1–32 bytes. Changing this name disconnects devices using setup Wi-Fi."
                            />
                            <TextField
                                label="New setup Wi-Fi password"
                                type="password"
                                value={setupPassword}
                                disabled={busy || !!pending}
                                onChange={(e) => setSetupPassword(e.target.value)}
                                helperText="8–63 characters. Leave blank to keep the current password. Save the new credentials before applying."
                            />
                            <Button
                                disabled={
                                    busy ||
                                    !!pending ||
                                    (!hotspotMode && setupSsid === null && !setupPassword) ||
                                    status.hotspot.setup?.state === 'connecting'
                                }
                                onClick={() =>
                                    void run(async () => {
                                        await request({
                                            action: 'hotspot',
                                            mode: hotspotMode || status.hotspot!.mode,
                                            ...(setupSsid !== null ? { ssid: setupSsid } : {}),
                                            ...(setupPassword ? { password: setupPassword } : {}),
                                        });
                                        setSetupSsid(null);
                                        setSetupPassword('');
                                        setHotspotMode('');
                                        setNotice(
                                            'Setup Wi-Fi settings saved. If the name or password changed, reconnect using the new credentials. Off disconnects your phone.',
                                        );
                                    })
                                }
                            >
                                Save setup Wi-Fi settings
                            </Button>
                            <Typography>
                                Setup Wi-Fi: {status.hotspot.ssid} · {status.hotspot.active ? 'On' : 'Off'}
                            </Typography>
                            <TextField
                                label="Setup Wi-Fi password"
                                value={status.hotspot.password}
                                InputProps={{ readOnly: true }}
                                helperText={`Connect your phone to this Wi-Fi, then open ${status.hotspot.url} if the setup page does not open automatically.`}
                            />
                            <Typography variant="caption">
                                Auto keeps setup Wi-Fi available while no home Wi-Fi is connected, including when
                                Ethernet is connected to controllers. Connecting to home Wi-Fi turns setup Wi-Fi off.
                                Off disables setup Wi-Fi.
                            </Typography>
                            {status.hotspot.error && <Alert severity="warning">{status.hotspot.error}</Alert>}
                            {status.hotspot.active && (
                                <Alert severity="info">
                                    Select your home Wi-Fi below and enter its password. After a successful connection,
                                    Auto turns setup Wi-Fi off. Your phone will disconnect; reconnect it to your home
                                    Wi-Fi to access the player there. If the connection fails, rejoin setup Wi-Fi and
                                    try again.
                                </Alert>
                            )}
                            {status.hotspot.setup?.state === 'connecting' && (
                                <Alert severity="info">Connecting to Wi-Fi…</Alert>
                            )}
                            {status.hotspot.setup?.state === 'failed' && (
                                <Alert severity="error">{status.hotspot.setup.error}</Alert>
                            )}
                        </>
                    )}
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
                                <MenuItem value="manual">Enter network name manually</MenuItem>
                                {networks.map((n, i) => (
                                    <MenuItem key={i} value={String(i)} disabled={n.security === 'unsupported'}>
                                        {n.ssid} · {n.signal}% · {n.security}
                                    </MenuItem>
                                ))}
                            </TextField>
                            {networkIndex === 'manual' && (
                                <>
                                    <TextField
                                        label="Wi-Fi network name (SSID)"
                                        value={manualSsid}
                                        disabled={busy || !!pending}
                                        onChange={(e) => setManualSsid(e.target.value)}
                                    />
                                    <TextField
                                        select
                                        label="Wi-Fi security"
                                        value={manualSecurity}
                                        disabled={busy || !!pending}
                                        onChange={(e) => setManualSecurity(e.target.value)}
                                    >
                                        <MenuItem value="personal">WPA/WPA2 personal</MenuItem>
                                        <MenuItem value="open">Open network</MenuItem>
                                    </TextField>
                                </>
                            )}
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
                                    !network.ssid ||
                                    status?.hotspot?.setup?.state === 'connecting' ||
                                    network.security === 'unsupported'
                                }
                                onClick={() =>
                                    void run(async () => {
                                        const phoneSetup =
                                            window.location.hostname === '192.168.4.1' ||
                                            window.location.hostname === 'ezplayer.setup';
                                        let registrationUrl = '';
                                        if (phoneSetup && status?.hotspot?.mode === 'auto') {
                                            if (cloudConfig.cloudEnabled === false)
                                                throw new Error(
                                                    'Resume cloud activity before registering from phone setup.',
                                                );
                                            const playerId = cloudConfig.playerIdToken || uuidv4();
                                            registrationUrl = playerRegistrationUrl(
                                                cloudConfig.cloudServiceUrl,
                                                playerId,
                                            );
                                            if (!cloudConfig.playerIdToken)
                                                await dispatch(
                                                    postSetPlayerIdToken({ playerIdToken: playerId }),
                                                ).unwrap();
                                        }
                                        const result = await request<{ connecting?: boolean; message?: string }>({
                                            action: 'wifi',
                                            interface: iface,
                                            ssid: network.ssid,
                                            security: network.security,
                                            password,
                                            hidden: networkIndex === 'manual',
                                        });
                                        setPassword('');
                                        if (result.connecting) {
                                            setNotice(result.message || 'Connecting to Wi-Fi…');
                                            if (registrationUrl)
                                                setHandoff({ url: registrationUrl, started: Date.now() });
                                        }
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
                                <>
                                    <TextField
                                        label="IP address"
                                        placeholder="192.168.50.2"
                                        value={address}
                                        required
                                        error={address !== '' && !addressValid}
                                        helperText={
                                            address !== '' && !addressValid
                                                ? 'Enter a valid IPv4 address, such as 192.168.50.2.'
                                                : 'Example: 192.168.50.2'
                                        }
                                        disabled={busy || !!pending}
                                        onChange={(e) => setAddress(e.target.value)}
                                    />
                                    <TextField
                                        label="Subnet mask"
                                        placeholder="255.255.255.0"
                                        value={subnetMask}
                                        required
                                        error={subnetMask !== '' && prefix === null}
                                        helperText={
                                            subnetMask !== '' && prefix === null
                                                ? 'Enter a valid subnet mask, such as 255.255.255.0.'
                                                : 'Example: 255.255.255.0'
                                        }
                                        disabled={busy || !!pending}
                                        onChange={(e) => setSubnetMask(e.target.value)}
                                    />
                                </>
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
                                disabled={
                                    busy || !!pending || (method === 'manual' && (!addressValid || prefix === null))
                                }
                                onClick={() =>
                                    void run(async () => {
                                        await request({
                                            action: 'ethernet',
                                            interface: iface,
                                            method,
                                            address: method === 'manual' ? `${address.trim()}/${prefix}` : '',
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
