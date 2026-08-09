import ChevronRightIcon from '@mui/icons-material/ChevronRight';
import DeleteIcon from '@mui/icons-material/Delete';
import DriveFileRenameOutlineIcon from '@mui/icons-material/DriveFileRenameOutline';
import ExpandMoreIcon from '@mui/icons-material/ExpandMore';
import FolderIcon from '@mui/icons-material/Folder';
import InsertDriveFileIcon from '@mui/icons-material/InsertDriveFile';
import LockIcon from '@mui/icons-material/Lock';
import FileDownloadIcon from '@mui/icons-material/FileDownload';
import { alpha, Button, Checkbox, CircularProgress, Tooltip, Typography, type Theme } from '@mui/material';
import React from 'react';
import { Box } from '../box/Box';
import type { FileEntry } from '../../services/fileManagerClient';

/**
 * Lazy directory tree for the show folder (Children are fetched only when a folder is opened).
 *
 * Deliberately built from plain MUI primitives.
 */

export interface FileTreeProps {
    /** Children by parent path; '' is the root. Absent = not loaded yet. */
    childrenByPath: Map<string, FileEntry[]>;
    expanded: Set<string>;
    loading: Set<string>;
    selected: Set<string>;
    focused?: string;
    /** Disables the per-row actions while an operation is in flight. */
    busy?: boolean;
    /** Folder new uploads will land in ('' = the show folder root) */
    uploadTarget: string;
    /** Folder currently under a drag, highlighted as the drop destination. */
    dragOverPath?: string;
    onToggleExpand: (path: string) => void;
    onFocus: (entry: FileEntry) => void;
    onToggleSelect: (entry: FileEntry, selected: boolean) => void;
    /** Act on this one row. The tick-boxes are for bulk actions only. */
    onRename: (entry: FileEntry) => void;
    onDelete: (entry: FileEntry) => void;
    onDragOverFolder: (path: string | undefined) => void;
    onDropFiles: (path: string, files: FileList) => void;
}

/** Icon-only action button, matching the row actions used in the other lists. */
const ROW_ACTION_SX = { minWidth: 'auto', padding: '4px', '& .MuiButton-startIcon': { m: 0 } };

const ROW_HEIGHT = 34;
const INDENT = 18;

export const FileTree: React.FC<FileTreeProps> = (props) => (
    <Box role="tree" aria-label="Show folder" sx={{ py: 0.5 }}>
        <TreeLevel {...props} parentPath="" depth={0} />
    </Box>
);

const TreeLevel: React.FC<FileTreeProps & { parentPath: string; depth: number }> = (props) => {
    const { childrenByPath, expanded, loading, selected, focused, uploadTarget, dragOverPath, parentPath, depth } =
        props;
    const entries = childrenByPath.get(parentPath);

    if (loading.has(parentPath) && !entries) {
        return (
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, pl: `${depth * INDENT + 34}px`, height: ROW_HEIGHT }}>
                <CircularProgress size={14} />
                <Typography variant="caption" color="text.secondary">
                    Loading…
                </Typography>
            </Box>
        );
    }
    if (!entries) return null;
    if (entries.length === 0) {
        return (
            <Typography
                variant="caption"
                color="text.secondary"
                sx={{ display: 'block', pl: `${depth * INDENT + 34}px`, height: ROW_HEIGHT, lineHeight: `${ROW_HEIGHT}px` }}
            >
                Empty folder
            </Typography>
        );
    }

    return (
        <>
            {entries.map((entry) => {
                const isOpen = expanded.has(entry.path);
                const isDir = entry.kind === 'directory';
                const isDropTarget = isDir && dragOverPath === entry.path;
                const isUploadTarget = isDir && uploadTarget === entry.path;
                return (
                    <React.Fragment key={entry.path}>
                        <Box
                            role="treeitem"
                            aria-expanded={isDir ? isOpen : undefined}
                            aria-selected={focused === entry.path}
                            onClick={() => props.onFocus(entry)}
                            sx={{
                                display: 'flex',
                                alignItems: 'center',
                                gap: 0.5,
                                height: ROW_HEIGHT,
                                pl: `${depth * INDENT + 4}px`,
                                pr: 1,
                                cursor: 'pointer',
                                borderRadius: 1,
                                backgroundColor: isDropTarget
                                    ? (theme: Theme) => alpha(theme.palette.primary.main, 0.32)
                                    : focused === entry.path
                                      ? (theme: Theme) => alpha(theme.palette.primary.main, 0.22)
                                      : undefined,
                                outline: isDropTarget ? '2px solid' : undefined,
                                outlineColor: 'primary.main',
                                '&:hover': {
                                    backgroundColor: (theme: Theme) => alpha(theme.palette.action.selected, 0.4),
                                },
                                transition: (theme: Theme) => theme.transitions.create(['background-color']),
                            }}
                            onDragOver={(e: React.DragEvent) => {
                                if (!isDir) return;
                                // Dropping onto a folder should mean "into this one",
                                // regardless of what happens to be selected.
                                e.preventDefault();
                                e.stopPropagation();
                                props.onDragOverFolder(entry.path);
                            }}
                            onDragLeave={(e: React.DragEvent) => {
                                if (!isDir) return;
                                e.stopPropagation();
                                props.onDragOverFolder(undefined);
                            }}
                            onDrop={(e: React.DragEvent) => {
                                if (!isDir) return;
                                e.preventDefault();
                                e.stopPropagation();
                                props.onDragOverFolder(undefined);
                                if (e.dataTransfer.files?.length) props.onDropFiles(entry.path, e.dataTransfer.files);
                            }}
                        >
                            <Checkbox
                                size="small"
                                sx={{ p: 0.25 }}
                                checked={selected.has(entry.path)}
                                disabled={entry.protected}
                                onClick={(e) => e.stopPropagation()}
                                onChange={(e) => props.onToggleSelect(entry, e.target.checked)}
                                inputProps={{ 'aria-label': `Select ${entry.name}` }}
                            />
                            <span
                                onClick={(e: React.MouseEvent) => {
                                    if (!isDir) return;
                                    e.stopPropagation();
                                    props.onToggleExpand(entry.path);
                                }}
                                style={{ display: 'flex', width: 20, justifyContent: 'center' }}
                            >
                                {isDir ? (
                                    isOpen ? (
                                        <ExpandMoreIcon fontSize="small" />
                                    ) : (
                                        <ChevronRightIcon fontSize="small" />
                                    )
                                ) : null}
                            </span>
                            {isDir ? (
                                <FolderIcon fontSize="small" sx={{ color: 'warning.light' }} />
                            ) : (
                                <InsertDriveFileIcon fontSize="small" sx={{ color: 'text.disabled' }} />
                            )}
                            <Typography variant="body2" noWrap sx={{ flexGrow: 1, minWidth: 0 }}>
                                {entry.name}
                            </Typography>
                            {isUploadTarget && (
                                <Tooltip title="Uploads and dropped files land in this folder">
                                    <FileDownloadIcon fontSize="inherit" sx={{ color: 'primary.main', flexShrink: 0 }} />
                                </Tooltip>
                            )}
                            {entry.protected && (
                                <Tooltip title="Required by xLights — cannot be changed here">
                                    <LockIcon fontSize="inherit" sx={{ color: 'text.disabled' }} />
                                </Tooltip>
                            )}
                            {!isDir && (
                                <Typography variant="caption" color="text.secondary" sx={{ flexShrink: 0 }}>
                                    {formatSize(entry.sizeBytes)}
                                </Typography>
                            )}
                            <Box sx={{ display: 'flex', gap: 0.5, flexShrink: 0 }}>
                                <Button
                                    aria-label={`rename ${entry.name}`}
                                    title={entry.protected ? 'Required by xLights' : 'Rename'}
                                    startIcon={<DriveFileRenameOutlineIcon />}
                                    size="small"
                                    disabled={entry.protected || props.busy}
                                    onClick={(e) => {
                                        e.stopPropagation();
                                        props.onRename(entry);
                                    }}
                                    sx={ROW_ACTION_SX}
                                />
                                <Button
                                    aria-label={`delete ${entry.name}`}
                                    title={entry.protected ? 'Required by xLights' : 'Delete'}
                                    startIcon={<DeleteIcon />}
                                    size="small"
                                    color="error"
                                    disabled={entry.protected || props.busy}
                                    onClick={(e) => {
                                        e.stopPropagation();
                                        props.onDelete(entry);
                                    }}
                                    sx={ROW_ACTION_SX}
                                />
                            </Box>
                        </Box>
                        {isDir && isOpen && <TreeLevel {...props} parentPath={entry.path} depth={depth + 1} />}
                    </React.Fragment>
                );
            })}
        </>
    );
};

export function formatSize(bytes: number): string {
    if (bytes < 1024) return `${bytes} B`;
    const units = ['KB', 'MB', 'GB', 'TB'];
    let value = bytes / 1024;
    let unit = 0;
    while (value >= 1024 && unit < units.length - 1) {
        value /= 1024;
        unit++;
    }
    return `${value < 10 ? value.toFixed(1) : Math.round(value)} ${units[unit]}`;
}

export function formatWhen(epochMs: number): string {
    if (!epochMs) return '—';
    return new Date(epochMs).toLocaleString();
}
