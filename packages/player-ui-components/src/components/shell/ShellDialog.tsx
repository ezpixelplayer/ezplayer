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
// The local Box pins `component="div"`; MUI's own Box widens into a union that
// TypeScript can't represent once `sx` and a ref are both in play.
import { Box } from '../box/Box';

/**
 * The remote shell. Only rendered when the player advertises the shell as
 * available, which happens only when a password has been set from the CLI —
 * there is no way to enable this from the UI.
 *
 * The dialog is a password prompt first and a terminal second. Nothing is
 * spawned on the player until the password is accepted, and only one terminal
 * exists player-wide: opening another displaces this one, which is reported
 * rather than left as a silently dead socket.
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

    const teardown = useCallback(() => {
        wsRef.current?.close();
        wsRef.current = undefined;
        termRef.current?.dispose();
        termRef.current = undefined;
        fitRef.current = undefined;
    }, []);

    // Closing the dialog must drop the socket: the player kills the pty when
    // the viewer disconnects, so a leaked socket would leave a live shell.
    useEffect(() => {
        if (open) return;
        teardown();
        setPhase('password');
        setPassword('');
        setError(undefined);
        setNotice(undefined);
    }, [open, teardown]);

    // Same reasoning for unmount (e.g. navigating away with the dialog open).
    useEffect(() => () => teardown(), [teardown]);

    /** Attach xterm once the terminal pane is actually in the DOM. */
    const attachTerminal = useCallback((node: HTMLDivElement | null) => {
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
        fit.fit();
        term.focus();
        termRef.current = term;
        fitRef.current = fit;

        term.onData((data) => {
            const ws = wsRef.current;
            if (ws?.readyState === WebSocket.OPEN) ws.send(JSON.stringify({ type: 'input', data }));
        });
        term.onResize(({ cols, rows }) => {
            const ws = wsRef.current;
            if (ws?.readyState === WebSocket.OPEN) ws.send(JSON.stringify({ type: 'resize', cols, rows }));
        });
    }, []);

    // Keep the pty's idea of the window in step with the pane.
    useEffect(() => {
        if (phase !== 'ready') return;
        const onResize = () => fitRef.current?.fit();
        window.addEventListener('resize', onResize);
        const id = window.setTimeout(onResize, 0);
        return () => {
            window.removeEventListener('resize', onResize);
            window.clearTimeout(id);
        };
    }, [phase]);

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
                    // Report the real size now that we're about to render.
                    window.setTimeout(() => fitRef.current?.fit(), 0);
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
    }, [password, wsUrl]);

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
