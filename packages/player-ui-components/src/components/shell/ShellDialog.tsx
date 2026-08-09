import CloseIcon from '@mui/icons-material/Close';
import TerminalIcon from '@mui/icons-material/Terminal';
import {
    Alert,
    Button,
    Dialog,
    DialogActions,
    DialogContent,
    DialogTitle,
    IconButton,
    TextField,
    Tooltip,
    Typography,
} from '@mui/material';
import { FitAddon } from '@xterm/addon-fit';
import { Terminal } from '@xterm/xterm';
import '@xterm/xterm/css/xterm.css';
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { useRemoteAccessWsUrl } from '../../hooks/useRemoteAccessWsUrl';
import { Box } from '../box/Box';

/**
 * The remote shell. Only rendered when the player advertises the shell as available.
 *
 * The dialog is a password prompt first and a terminal second. Nothing is
 * spawned on the player until the password is accepted.
 *
 * Only one terminal exists player-wide: opening another displaces this one.
 */

type Phase = 'password' | 'connecting' | 'ready';

export interface ShellDialogProps {
    open: boolean;
    onClose: () => void;
}

export const ShellDialog: React.FC<ShellDialogProps> = ({ open, onClose }) => {
    const wsUrl = useRemoteAccessWsUrl('shell');
    const [phase, setPhase] = useState<Phase>('password');
    const [password, setPassword] = useState('');
    const [error, setError] = useState<string | undefined>();
    const [notice, setNotice] = useState<string | undefined>();

    const wsRef = useRef<WebSocket | undefined>(undefined);
    const termRef = useRef<Terminal | undefined>(undefined);
    const fitRef = useRef<FitAddon | undefined>(undefined);
    const hostRef = useRef<HTMLDivElement | null>(null);
    const resizeObsRef = useRef<ResizeObserver | undefined>(undefined);
    const rafRef = useRef<number | undefined>(undefined);

    const teardown = useCallback(() => {
        resizeObsRef.current?.disconnect();
        resizeObsRef.current = undefined;
        if (rafRef.current) cancelAnimationFrame(rafRef.current);
        rafRef.current = undefined;
        wsRef.current?.close();
        wsRef.current = undefined;
        termRef.current?.dispose();
        termRef.current = undefined;
        fitRef.current = undefined;
    }, []);

    // Closing the dialog must drop the socket.
    useEffect(() => {
        if (open) return;
        teardown();
        setPhase('password');
        setPassword('');
        setError(undefined);
        setNotice(undefined);
    }, [open, teardown]);

    // For unmount (e.g. navigating away with the dialog open).
    useEffect(() => () => teardown(), [teardown]);

    /**
     * Re-measure and tell the pty. The send is unconditional rather than driven
     * by xterm's resize event: full-screen programs draw against the size the
     * pty reports, so if a fit lands back on the size already sent, the event
     * never fires and the two silently disagree.
     */
    const syncSize = useCallback(() => {
        const term = termRef.current;
        const ws = wsRef.current;
        if (!term || !fitRef.current) return;
        try {
            fitRef.current.fit();
        } catch {
            return; // pane not laid out yet; the observer fires again when it is
        }
        if (ws?.readyState === WebSocket.OPEN) {
            ws.send(JSON.stringify({ type: 'resize', cols: term.cols, rows: term.rows }));
        }
    }, []);

    /** Attach xterm once the terminal pane is actually in the DOM. */
    const attachTerminal = useCallback(
        (node: HTMLDivElement | null) => {
            hostRef.current = node;
            if (!node || termRef.current) return;

            const term = new Terminal({
                convertEol: false,
                cursorBlink: true,
                fontFamily: 'Consolas, "Courier New", monospace',
                fontSize: 13,
                theme: { background: '#101418' },
            });
            const fit = new FitAddon();
            term.loadAddon(fit);
            term.open(node);
            term.focus();
            termRef.current = term;
            fitRef.current = fit;

            term.onData((data) => {
                const ws = wsRef.current;
                if (ws?.readyState === WebSocket.OPEN) ws.send(JSON.stringify({ type: 'input', data }));
            });

            // Watch the pane, not the window: the dialog also changes size when
            // a notice appears, and the first correct measurement only exists
            // once its open transition has settled.
            const observer = new ResizeObserver(() => {
                if (rafRef.current) cancelAnimationFrame(rafRef.current);
                rafRef.current = requestAnimationFrame(syncSize);
            });
            observer.observe(node);
            resizeObsRef.current = observer;
        },
        [syncSize],
    );

    const connect = useCallback(() => {
        if (!wsUrl) {
            setError('Could not work out how to reach this player.');
            return;
        }
        setError(undefined);
        setNotice(undefined);
        setPhase('connecting');

        let ws: WebSocket;
        try {
            ws = new WebSocket(wsUrl);
        } catch {
            setError('Could not open a connection to the player.');
            setPhase('password');
            return;
        }
        wsRef.current = ws;
        // Tracked here rather than off `phase`: this closure captures the phase
        // as it was when we dialled, so a socket error after a successful login
        // would otherwise look like a failed one and wipe the terminal.
        let authenticated = false;

        ws.onopen = () => {
            // The terminal pane isn't mounted yet, so send the size we'll most
            // likely end up with; the fit() after mount corrects it.
            ws.send(JSON.stringify({ type: 'auth', password, cols: 100, rows: 30 }));
        };

        ws.onmessage = (event) => {
            let msg: { type?: string; data?: string; reason?: string; code?: number };
            try {
                msg = JSON.parse(event.data as string);
            } catch {
                return;
            }
            switch (msg.type) {
                case 'authOk':
                    authenticated = true;
                    setPassword('');
                    setPhase('ready');
                    // The pane mounts on this render; the observer fires once it
                    // has a real size and reports it.
                    window.setTimeout(syncSize, 0);
                    break;
                case 'authFail':
                    setError(msg.reason || 'The player refused the connection.');
                    setPhase('password');
                    wsRef.current = undefined;
                    ws.close();
                    break;
                case 'data':
                    if (typeof msg.data === 'string') termRef.current?.write(msg.data);
                    break;
                case 'exit':
                    setNotice(`The shell exited (code ${msg.code ?? 0}).`);
                    break;
                case 'superseded':
                    setNotice('Someone opened a terminal elsewhere, so this one was closed.');
                    break;
                case 'closed':
                    setNotice(msg.reason || 'The player closed this terminal.');
                    break;
            }
        };

        ws.onerror = () => {
            if (authenticated) {
                setNotice('The connection to the player was lost.');
                return;
            }
            setError('Could not reach the player.');
            setPhase('password');
        };

        ws.onclose = () => {
            if (wsRef.current === ws) wsRef.current = undefined;
        };
    }, [password, syncSize, wsUrl]);

    const onSubmit = (e: React.FormEvent) => {
        e.preventDefault();
        if (password.length > 0) connect();
    };

    return (
        <Dialog open={open} onClose={onClose} maxWidth="lg" fullWidth PaperProps={{ sx: { height: '80vh' } }}>
            <DialogTitle sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                    <TerminalIcon />
                    <Typography variant="h5">Shell</Typography>
                </Box>
                <Tooltip title="Close">
                    <IconButton onClick={onClose} size="small" aria-label="close">
                        <CloseIcon />
                    </IconButton>
                </Tooltip>
            </DialogTitle>

            <DialogContent dividers sx={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
                {notice && <Alert severity="info">{notice}</Alert>}

                {phase === 'ready' ? (
                    <Box
                        ref={attachTerminal}
                        sx={{ flexGrow: 1, minHeight: 0, backgroundColor: '#101418', p: 1, borderRadius: 1 }}
                    />
                ) : (
                    <form
                        onSubmit={onSubmit}
                        style={{ display: 'flex', flexDirection: 'column', gap: 16, maxWidth: 420 }}
                    >
                        <Typography variant="body2" color="text.secondary">
                            This opens a command prompt on the machine running EZPlayer. Enter the shell password set
                            with <code>EZPlayer shell</code> on that machine.
                        </Typography>
                        {error && <Alert severity="error">{error}</Alert>}
                        <TextField
                            label="Shell password"
                            type="password"
                            value={password}
                            autoFocus
                            autoComplete="off"
                            disabled={phase === 'connecting'}
                            onChange={(e) => setPassword(e.target.value)}
                            inputProps={{ 'aria-label': 'shell password' }}
                        />
                        <Box>
                            <Button
                                type="submit"
                                variant="contained"
                                disabled={phase === 'connecting' || password.length === 0}
                            >
                                {phase === 'connecting' ? 'Connecting…' : 'Connect'}
                            </Button>
                        </Box>
                    </form>
                )}
            </DialogContent>

            <DialogActions>
                <Typography variant="caption" color="text.secondary" sx={{ mr: 'auto', pl: 2 }}>
                    One terminal at a time — opening another elsewhere closes this one.
                </Typography>
                <Button onClick={onClose}>Close</Button>
            </DialogActions>
        </Dialog>
    );
};
