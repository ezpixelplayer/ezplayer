import { useRef } from 'react';
import { useSelector } from 'react-redux';
import { Alert, Backdrop, CircularProgress, Stack, Typography } from '@mui/material';

import type { RuntimeState } from '../../store/slices/RuntimeStore';

interface OverlayState {
    runtime: RuntimeState;
}

/** Backdrop shown when the data link is down. Drives off two flags in
 *  RuntimeStore: `bridgeConnected` (browser↔cloud WS — cloud only; LAN
 *  leaves it undefined) and `playerConnected` (player↔server WS hop).
 *  Undefined means "not yet known" and is treated as connected so the
 *  overlay doesn't flash on first mount. */
export const BridgeStatusOverlay = () => {
    const bridgeConnected = useSelector((s: OverlayState) => s.runtime.bridgeConnected);
    const playerConnected = useSelector((s: OverlayState) => s.runtime.playerConnected);

    // Once we've seen the player connect, subsequent drops use the firmer
    // "Player is offline" wording instead of "Connecting…".
    const everSawPlayer = useRef(false);
    if (playerConnected === true) everSawPlayer.current = true;

    const bridgeDown = bridgeConnected === false;
    const playerDown = playerConnected === false;
    if (!bridgeDown && !playerDown) return null;

    const message = bridgeDown
        ? 'Reconnecting…'
        : everSawPlayer.current
        ? 'Player is offline'
        : 'Connecting to player…';
    const detail = bridgeDown
        ? 'Lost connection to the cloud server. Data shown is stale and commands will not reach the player until the link is restored.'
        : everSawPlayer.current
        ? 'The player has stopped responding. Data shown is the last known state; commands will queue but will not take effect until the player reconnects.'
        : 'Waiting for the player to come online. This usually takes a few seconds after the player starts up.';

    return (
        <Backdrop open sx={{ zIndex: (t) => t.zIndex.drawer + 1, color: '#fff' }}>
            <Stack spacing={2} alignItems="center" sx={{ maxWidth: 480, p: 3 }}>
                <CircularProgress color="inherit" />
                <Typography variant="h5">{message}</Typography>
                <Alert severity={bridgeDown ? 'warning' : 'info'} variant="filled" sx={{ width: '100%' }}>
                    {detail}
                </Alert>
            </Stack>
        </Backdrop>
    );
};
