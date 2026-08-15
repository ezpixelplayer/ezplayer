import { useEffect, useMemo, useState } from 'react';
import { useDispatch, useSelector } from 'react-redux';

import {
    Button,
    Checkbox,
    CircularProgress,
    Dialog,
    DialogActions,
    DialogContent,
    DialogTitle,
    List,
    ListItem,
    ListItemButton,
    ListItemIcon,
    ListItemText,
    Typography,
} from '@mui/material';

import { AppDispatch, RootState } from '../..';
import { listShowFiles } from '../../store/slices/SequenceStore';

export interface ShowFolderImportDialogProps {
    open: boolean;
    onClose: () => void;
    /** Run the import (caller owns progress + summary UI). */
    onImport: (fseqNames: string[]) => void | Promise<void>;
}

/** Basename of a path that may use either separator (records written by the
 *  desktop app hold absolute Windows/POSIX player paths). */
const baseName = (p: string | undefined): string => {
    if (!p) return '';
    const norm = p.replace(/\\/g, '/');
    return norm.slice(norm.lastIndexOf('/') + 1);
};

/** Pick FSEQs that already exist in the player's show folder and import them —
 *  the no-upload bulk-import variant for LAN/cloud. Files get there via
 *  xLights, cloud sync, or the file manager; this just registers them. */
export function ShowFolderImportDialog({ open, onClose, onImport }: ShowFolderImportDialogProps) {
    const dispatch = useDispatch<AppDispatch>();
    const sequenceData = useSelector((state: RootState) => state.sequences.sequenceData);
    const [fseqs, setFseqs] = useState<string[] | undefined>(undefined);
    const [error, setError] = useState<string | undefined>(undefined);
    const [selected, setSelected] = useState<Set<string>>(new Set());

    /** Basenames of FSEQs already registered in the catalog — re-importing one
     *  would create a duplicate song, so those rows are shown disabled. */
    const importedBasenames = useMemo(() => {
        const set = new Set<string>();
        for (const rec of sequenceData ?? []) {
            if (rec.deleted) continue;
            const base = baseName(rec.files?.fseq).toLowerCase();
            if (base) set.add(base);
        }
        return set;
    }, [sequenceData]);

    useEffect(() => {
        if (!open) return;
        setFseqs(undefined);
        setError(undefined);
        setSelected(new Set());
        void (async () => {
            try {
                const seqListing = await dispatch(listShowFiles('sequences')).unwrap();
                const fseqOnly = seqListing.filter((n) => n.toLowerCase().endsWith('.fseq'));
                setFseqs(fseqOnly);
                setSelected(new Set(fseqOnly.filter((n) => !importedBasenames.has(n.toLowerCase()))));
            } catch (e) {
                setError(e instanceof Error ? e.message : String(e));
            }
        })();
        // importedBasenames is intentionally not a dependency: the selection is
        // a snapshot taken when the dialog opens.
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [open, dispatch]);

    const newFseqs = (fseqs ?? []).filter((n) => !importedBasenames.has(n.toLowerCase()));
    const allNewSelected = newFseqs.length > 0 && newFseqs.every((n) => selected.has(n));

    const toggle = (name: string) => {
        setSelected((prev) => {
            const next = new Set(prev);
            if (next.has(name)) next.delete(name);
            else next.add(name);
            return next;
        });
    };

    return (
        <Dialog open={open} onClose={onClose} maxWidth="sm" fullWidth>
            <DialogTitle>Import from Show Folder</DialogTitle>
            <DialogContent dividers sx={{ minHeight: 240, maxHeight: 440 }}>
                <Typography variant="body2" color="text.secondary" sx={{ mb: 1 }}>
                    Sequences already in the player&apos;s show folder. Each import needs matching audio in the show
                    folder or the configured Media Folder.
                </Typography>
                {error ? (
                    <Typography color="error">{error}</Typography>
                ) : fseqs === undefined ? (
                    <CircularProgress size={24} />
                ) : fseqs.length === 0 ? (
                    <Typography color="text.secondary">No .fseq files found in the show folder.</Typography>
                ) : (
                    <List dense disablePadding>
                        <ListItem disablePadding>
                            <ListItemButton
                                onClick={() => setSelected(allNewSelected ? new Set() : new Set(newFseqs))}
                                disabled={!newFseqs.length}
                            >
                                <ListItemIcon>
                                    <Checkbox
                                        edge="start"
                                        checked={allNewSelected}
                                        indeterminate={selected.size > 0 && !allNewSelected}
                                        tabIndex={-1}
                                        disableRipple
                                    />
                                </ListItemIcon>
                                <ListItemText primary={`Select all new (${newFseqs.length})`} />
                            </ListItemButton>
                        </ListItem>
                        {fseqs.map((name) => {
                            const alreadyImported = importedBasenames.has(name.toLowerCase());
                            return (
                                <ListItem key={name} disablePadding>
                                    <ListItemButton onClick={() => toggle(name)} disabled={alreadyImported}>
                                        <ListItemIcon>
                                            <Checkbox
                                                edge="start"
                                                checked={selected.has(name)}
                                                tabIndex={-1}
                                                disableRipple
                                                disabled={alreadyImported}
                                            />
                                        </ListItemIcon>
                                        <ListItemText
                                            primary={name}
                                            secondary={alreadyImported ? 'Already imported' : undefined}
                                        />
                                    </ListItemButton>
                                </ListItem>
                            );
                        })}
                    </List>
                )}
            </DialogContent>
            <DialogActions>
                <Button onClick={onClose}>Cancel</Button>
                <Button
                    variant="contained"
                    disabled={selected.size === 0}
                    onClick={() => {
                        void onImport([...selected]);
                    }}
                >
                    Import {selected.size || ''}
                </Button>
            </DialogActions>
        </Dialog>
    );
}
