import CloseIcon from '@mui/icons-material/Close';
import CreateNewFolderIcon from '@mui/icons-material/CreateNewFolder';
import DeleteIcon from '@mui/icons-material/Delete';
import FolderOpenIcon from '@mui/icons-material/FolderOpen';
import RefreshIcon from '@mui/icons-material/Refresh';
import UploadFileIcon from '@mui/icons-material/UploadFile';
import {
    Alert,
    Button,
    CircularProgress,
    Dialog,
    DialogActions,
    DialogContent,
    DialogTitle,
    Divider,
    IconButton,
    LinearProgress,
    TextField,
    Tooltip,
    Typography,
} from '@mui/material';
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Box } from '../box/Box';
import { useRemoteAccessWsUrl } from '../../hooks/useRemoteAccessWsUrl';
import { FileManagerClient, type FileEntry } from '../../services/fileManagerClient';
import { DownloadButton, FilePreview, previewKindFor } from './FilePreview';
import { FileTree, formatSize, formatWhen } from './FileTree';

/**
 * Browse and edit the player's show folder.
 *
 * Only rendered when the player advertises the file manager.
 */

type Phase = 'password' | 'connecting' | 'ready';

interface Confirm {
    title: string;
    body: string;
    confirmLabel: string;
    run: () => Promise<void>;
}

export interface FileManagerDialogProps {
    open: boolean;
    onClose: () => void;
}

export const FileManagerDialog: React.FC<FileManagerDialogProps> = ({ open, onClose }) => {
    const wsUrl = useRemoteAccessWsUrl('files');
    const [phase, setPhase] = useState<Phase>('password');
    const [password, setPassword] = useState('');
    const [error, setError] = useState<string | undefined>();
    const [notice, setNotice] = useState<string | undefined>();
    const [busy, setBusy] = useState<string | undefined>();
    const [progress, setProgress] = useState<{ label: string; pct: number } | undefined>();

    const [childrenByPath, setChildrenByPath] = useState<Map<string, FileEntry[]>>(new Map());
    const [expanded, setExpanded] = useState<Set<string>>(new Set());
    const [loadingPaths, setLoadingPaths] = useState<Set<string>>(new Set());
    const [selected, setSelected] = useState<Set<string>>(new Set());
    const [focused, setFocused] = useState<FileEntry | undefined>();
    const [renaming, setRenaming] = useState<{ entry: FileEntry; value: string } | undefined>();
    const [confirm, setConfirm] = useState<Confirm | undefined>();
    /** Folder under an in-progress drag, and whether a drag is happening at all. */
    const [dragOverPath, setDragOverPath] = useState<string | undefined>();
    const [draggingFiles, setDraggingFiles] = useState(false);

    const clientRef = useRef<FileManagerClient | undefined>(undefined);
    const fileInputRef = useRef<HTMLInputElement | null>(null);

    const teardown = useCallback(() => {
        clientRef.current?.disconnect();
        clientRef.current = undefined;
    }, []);

    useEffect(() => {
        if (open) return;
        teardown();
        setPhase('password');
        setPassword('');
        setError(undefined);
        setNotice(undefined);
        setChildrenByPath(new Map());
        setExpanded(new Set());
        setSelected(new Set());
        setFocused(undefined);
        setRenaming(undefined);
        setConfirm(undefined);
        setProgress(undefined);
    }, [open, teardown]);

    useEffect(() => () => teardown(), [teardown]);

    /** (Re)load one directory's children. */
    const loadDir = useCallback(async (path: string) => {
        const client = clientRef.current;
        if (!client) return;
        setLoadingPaths((prev) => new Set(prev).add(path));
        try {
            const entries = await client.list(path);
            setChildrenByPath((prev) => new Map(prev).set(path, entries));
        } catch (e) {
            setNotice((e as Error).message);
        } finally {
            setLoadingPaths((prev) => {
                const next = new Set(prev);
                next.delete(path);
                return next;
            });
        }
    }, []);

    const connect = useCallback(async () => {
        if (!wsUrl) {
            setError('Could not work out how to reach this player.');
            return;
        }
        setError(undefined);
        setPhase('connecting');
        const client = new FileManagerClient();
        client.onClosed = (reason) => {
            setNotice(reason);
            setPhase('password');
            clientRef.current = undefined;
        };
        try {
            await client.connect(wsUrl, password);
        } catch (e) {
            setError((e as Error).message);
            setPhase('password');
            return;
        }
        clientRef.current = client;
        setPassword('');
        setPhase('ready');
        await loadDir('');
    }, [loadDir, password, wsUrl]);

    const onToggleExpand = useCallback(
        (path: string) => {
            setExpanded((prev) => {
                const next = new Set(prev);
                if (next.has(path)) next.delete(path);
                else {
                    next.add(path);
                    if (!childrenByPath.has(path)) void loadDir(path);
                }
                return next;
            });
        },
        [childrenByPath, loadDir],
    );

    const onToggleSelect = useCallback((entry: FileEntry, isSelected: boolean) => {
        setSelected((prev) => {
            const next = new Set(prev);
            if (isSelected) next.add(entry.path);
            else next.delete(entry.path);
            return next;
        });
    }, []);

    /** All loaded entries, so selection can be resolved back to entries. */
    const entriesByPath = useMemo(() => {
        const map = new Map<string, FileEntry>();
        for (const list of childrenByPath.values()) for (const e of list) map.set(e.path, e);
        return map;
    }, [childrenByPath]);

    const selectedEntries = useMemo(
        () => [...selected].map((p) => entriesByPath.get(p)).filter((e): e is FileEntry => !!e),
        [entriesByPath, selected],
    );

    const withBusy = useCallback(async (label: string, run: () => Promise<void>) => {
        setBusy(label);
        setNotice(undefined);
        try {
            await run();
        } catch (e) {
            setNotice((e as Error).message);
        } finally {
            setBusy(undefined);
            setProgress(undefined);
        }
    }, []);

    const currentFolder = useCallback((): string => {
        if (!focused) return '';
        if (focused.kind === 'directory') return focused.path;
        return focused.path.includes('/') ? focused.path.slice(0, focused.path.lastIndexOf('/')) : '';
    }, [focused]);

    const doUpload = useCallback(
        async (files: FileList, destination?: string) => {
            const client = clientRef.current;
            if (!client) return;
            const dir = destination ?? currentFolder();
            await withBusy('upload', async () => {
                for (let i = 0; i < files.length; i++) {
                    const file = files[i];
                    const target = dir ? `${dir}/${file.name}` : file.name;
                    await client.upload(target, file, (loaded, total) =>
                        setProgress({
                            label: `Uploading ${file.name}${files.length > 1 ? ` (${i + 1}/${files.length})` : ''}`,
                            pct: total ? (loaded / total) * 100 : 0,
                        }),
                    );
                }
                await loadDir(dir);
            });
        },
        [currentFolder, loadDir, withBusy],
    );

    const fetchBlob = useCallback(async (path: string): Promise<Blob> => {
        const client = clientRef.current;
        if (!client) throw new Error('Not connected to the player.');
        return client.download(path);
    }, []);

    const doDownload = useCallback(
        async (entry: FileEntry) => {
            const client = clientRef.current;
            if (!client) return;
            await withBusy('download', async () => {
                const blob = await client.download(entry.path, (loaded, total) =>
                    setProgress({ label: `Downloading ${entry.name}`, pct: total ? (loaded / total) * 100 : 0 }),
                );
                const url = URL.createObjectURL(blob);
                const a = document.createElement('a');
                a.href = url;
                a.download = entry.name;
                document.body.appendChild(a);
                a.click();
                a.remove();
                URL.revokeObjectURL(url);
            });
        },
        [withBusy],
    );

    /** One delete path for both the per-row button and the toolbar's bulk action */
    const confirmDelete = useCallback(
        (targets: FileEntry[]) => {
            const deletable = targets.filter((e) => !e.protected);
            if (deletable.length === 0) return;
            const hasFolder = deletable.some((e) => e.kind === 'directory');
            setConfirm({
                title: `Delete ${deletable.length === 1 ? `“${deletable[0].name}”` : `${deletable.length} items`}?`,
                body: hasFolder
                    ? 'Folders are deleted with everything inside them. This cannot be undone.'
                    : 'This cannot be undone.',
                confirmLabel: 'Delete',
                run: async () => {
                    const client = clientRef.current;
                    if (!client) return;
                    await withBusy('delete', async () => {
                        const gone = new Set(deletable.map((e) => e.path));
                        for (const entry of deletable) {
                            await client.remove(entry.path, entry.kind === 'directory');
                        }
                        // Only drop what actually went away — a bulk delete
                        // should not clear ticks the user still wants.
                        setSelected((prev) => new Set([...prev].filter((p) => !gone.has(p))));
                        setFocused((prev) => (prev && gone.has(prev.path) ? undefined : prev));
                        for (const p of new Set(deletable.map((e) => parentOf(e.path)))) await loadDir(p);
                    });
                },
            });
        },
        [loadDir, withBusy],
    );

    const doRename = useCallback(async () => {
        const client = clientRef.current;
        if (!client || !renaming) return;
        const trimmed = renaming.value.trim();
        const target = renaming.entry;
        setRenaming(undefined);
        if (!trimmed || trimmed === target.name) return;
        await withBusy('rename', async () => {
            const parent = parentOf(target.path);
            await client.move(target.path, parent ? `${parent}/${trimmed}` : trimmed);
            setSelected(new Set());
            setFocused(undefined);
            await loadDir(parent);
        });
    }, [loadDir, renaming, withBusy]);

    const doMove = useCallback(async () => {
        const client = clientRef.current;
        if (!client) return;
        const dest = currentFolder();
        const targets = selectedEntries.filter((e) => !e.protected && parentOf(e.path) !== dest);
        if (targets.length === 0) {
            setNotice('Select the items to move, then click the folder to move them into.');
            return;
        }
        await withBusy('move', async () => {
            const touched = new Set<string>([dest]);
            for (const entry of targets) {
                await client.move(entry.path, dest ? `${dest}/${entry.name}` : entry.name);
                touched.add(parentOf(entry.path));
            }
            setSelected(new Set());
            for (const p of touched) await loadDir(p);
        });
    }, [currentFolder, loadDir, selectedEntries, withBusy]);

    const doMkdir = useCallback(async () => {
        const client = clientRef.current;
        if (!client) return;
        const dir = currentFolder();
        const name = window.prompt('New folder name');
        if (!name?.trim()) return;
        await withBusy('mkdir', async () => {
            await client.mkdir(dir ? `${dir}/${name.trim()}` : name.trim());
            await loadDir(dir);
        });
    }, [currentFolder, loadDir, withBusy]);

    const previewKind = focused ? previewKindFor(focused) : 'none';
    const anyBusy = busy !== undefined;
    /** Where uploads go. One label for every place the destination is shown. */
    const destinationLabel = currentFolder() || 'Show folder';

    return (
        <Dialog open={open} onClose={onClose} maxWidth="lg" fullWidth PaperProps={{ sx: { height: '85vh' } }}>
            <DialogTitle sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                    <FolderOpenIcon />
                    <Typography variant="h5">Files</Typography>
                </Box>
                <Tooltip title="Close">
                    <IconButton onClick={onClose} size="small" aria-label="close">
                        <CloseIcon />
                    </IconButton>
                </Tooltip>
            </DialogTitle>

            <DialogContent dividers sx={{ display: 'flex', flexDirection: 'column', gap: 1, minHeight: 0 }}>
                {notice && (
                    <Alert severity="info" onClose={() => setNotice(undefined)}>
                        {notice}
                    </Alert>
                )}

                {phase !== 'ready' ? (
                    <form
                        onSubmit={(e) => {
                            e.preventDefault();
                            if (password) void connect();
                        }}
                        style={{ display: 'flex', flexDirection: 'column', gap: 16, maxWidth: 420 }}
                    >
                        <Typography variant="body2" color="text.secondary">
                            This browses the show folder on the machine running EZPlayer. Enter the file-manager
                            password set with <code>EZPlayer files</code> on that machine.
                        </Typography>
                        {error && <Alert severity="error">{error}</Alert>}
                        <TextField
                            label="File manager password"
                            type="password"
                            value={password}
                            autoFocus
                            autoComplete="off"
                            disabled={phase === 'connecting'}
                            onChange={(e) => setPassword(e.target.value)}
                            inputProps={{ 'aria-label': 'file manager password' }}
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
                ) : (
                    <>
                        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, flexWrap: 'wrap' }}>
                            <Tooltip title={`Add files to ${destinationLabel}`}>
                                <span>
                                    <Button
                                        size="small"
                                        startIcon={<UploadFileIcon />}
                                        onClick={() => fileInputRef.current?.click()}
                                        disabled={anyBusy}
                                    >
                                        Upload to {destinationLabel}
                                    </Button>
                                </span>
                            </Tooltip>
                            <Button size="small" startIcon={<CreateNewFolderIcon />} onClick={doMkdir} disabled={anyBusy}>
                                New folder
                            </Button>
                            {/* Only actions inherently about the ticked set belong here. */}
                            <Button size="small" onClick={doMove} disabled={anyBusy || selected.size === 0}>
                                {selected.size ? `Move ${selected.size} here` : 'Move here'}
                            </Button>
                            <Button
                                size="small"
                                color="error"
                                startIcon={<DeleteIcon />}
                                onClick={() => confirmDelete(selectedEntries)}
                                disabled={anyBusy || selected.size === 0}
                            >
                                Delete selected{selected.size ? ` (${selected.size})` : ''}
                            </Button>
                            <Box sx={{ flexGrow: 1 }} />
                            <Tooltip title="Refresh">
                                <span>
                                    <IconButton size="small" onClick={() => void loadDir(currentFolder())} disabled={anyBusy}>
                                        <RefreshIcon fontSize="small" />
                                    </IconButton>
                                </span>
                            </Tooltip>
                        </Box>

                        <input
                            ref={fileInputRef}
                            type="file"
                            multiple
                            hidden
                            onChange={(e) => {
                                if (e.target.files?.length) void doUpload(e.target.files);
                                e.target.value = '';
                            }}
                        />

                        {progress && (
                            <Box>
                                <Typography variant="caption">{progress.label}</Typography>
                                <LinearProgress variant="determinate" value={Math.min(100, progress.pct)} />
                            </Box>
                        )}

                        <Box sx={{ display: 'flex', gap: 1, flexGrow: 1, minHeight: 0 }}>
                            <Box
                                onDragOver={(e: React.DragEvent) => {
                                    e.preventDefault();
                                    setDragOverPath(undefined);
                                    setDraggingFiles(true);
                                }}
                                onDragLeave={() => setDraggingFiles(false)}
                                onDrop={(e: React.DragEvent) => {
                                    // Reached only when the drop missed a folder row,
                                    // in which case the marked destination applies.
                                    e.preventDefault();
                                    setDraggingFiles(false);
                                    setDragOverPath(undefined);
                                    if (e.dataTransfer.files?.length) void doUpload(e.dataTransfer.files);
                                }}
                                sx={{
                                    flex: '1 1 55%',
                                    overflow: 'auto',
                                    border: 1,
                                    borderStyle: draggingFiles ? 'dashed' : 'solid',
                                    borderColor: draggingFiles ? 'primary.main' : 'divider',
                                    borderRadius: 1,
                                }}
                            >
                                <FileTree
                                    childrenByPath={childrenByPath}
                                    expanded={expanded}
                                    loading={loadingPaths}
                                    selected={selected}
                                    focused={focused?.path}
                                    busy={anyBusy}
                                    onToggleExpand={onToggleExpand}
                                    onFocus={setFocused}
                                    onToggleSelect={onToggleSelect}
                                    onRename={(entry) => setRenaming({ entry, value: entry.name })}
                                    onDelete={(entry) => confirmDelete([entry])}
                                    uploadTarget={currentFolder()}
                                    dragOverPath={dragOverPath}
                                    onDragOverFolder={(path) => {
                                        setDragOverPath(path);
                                        setDraggingFiles(true);
                                    }}
                                    onDropFiles={(path, files) => {
                                        setDraggingFiles(false);
                                        setDragOverPath(undefined);
                                        void doUpload(files, path);
                                    }}
                                />
                            </Box>

                            <Box sx={{ flex: '1 1 45%', overflow: 'auto', px: 1 }}>
                                {focused ? (
                                    <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1 }}>
                                        <Typography variant="subtitle1" sx={{ wordBreak: 'break-all' }}>
                                            {focused.name}
                                        </Typography>
                                        <Typography variant="caption" color="text.secondary">
                                            {focused.kind === 'directory' ? 'Folder' : formatSize(focused.sizeBytes)} ·
                                            modified {formatWhen(focused.modified)}
                                        </Typography>
                                        <Typography variant="caption" color="text.secondary" sx={{ wordBreak: 'break-all' }}>
                                            {focused.path}
                                        </Typography>
                                        {focused.kind === 'file' && (
                                            <Box>
                                                <DownloadButton
                                                    onClick={() => void doDownload(focused)}
                                                    busy={busy === 'download'}
                                                />
                                            </Box>
                                        )}
                                        <Divider />
                                        {focused.kind === 'file' && (
                                            <FilePreview entry={focused} kind={previewKind} fetchBlob={fetchBlob} />
                                        )}
                                    </Box>
                                ) : (
                                    <Typography variant="body2" color="text.secondary">
                                        Select a file to see its details and preview. Drag files onto the tree to
                                        upload them.
                                    </Typography>
                                )}
                            </Box>
                        </Box>
                    </>
                )}
            </DialogContent>

            <DialogActions>
                {anyBusy && <CircularProgress size={18} sx={{ mr: 1 }} />}
                <Button onClick={onClose}>Close</Button>
            </DialogActions>

            <Dialog open={!!renaming} onClose={() => setRenaming(undefined)} maxWidth="xs" fullWidth>
                <DialogTitle>Rename</DialogTitle>
                <DialogContent>
                    <TextField
                        autoFocus
                        fullWidth
                        margin="dense"
                        label="New name"
                        value={renaming?.value ?? ''}
                        onChange={(e) => setRenaming((r) => (r ? { ...r, value: e.target.value } : r))}
                        onKeyDown={(e) => {
                            if (e.key === 'Enter') void doRename();
                        }}
                    />
                </DialogContent>
                <DialogActions>
                    <Button onClick={() => setRenaming(undefined)}>Cancel</Button>
                    <Button variant="contained" onClick={() => void doRename()}>
                        Rename
                    </Button>
                </DialogActions>
            </Dialog>

            <Dialog open={!!confirm} onClose={() => setConfirm(undefined)} maxWidth="xs" fullWidth>
                <DialogTitle>{confirm?.title}</DialogTitle>
                <DialogContent>
                    <Typography variant="body2">{confirm?.body}</Typography>
                </DialogContent>
                <DialogActions>
                    <Button onClick={() => setConfirm(undefined)}>Cancel</Button>
                    <Button
                        color="error"
                        variant="contained"
                        onClick={() => {
                            const action = confirm;
                            setConfirm(undefined);
                            void action?.run();
                        }}
                    >
                        {confirm?.confirmLabel}
                    </Button>
                </DialogActions>
            </Dialog>
        </Dialog>
    );
};

function parentOf(path: string): string {
    return path.includes('/') ? path.slice(0, path.lastIndexOf('/')) : '';
}
