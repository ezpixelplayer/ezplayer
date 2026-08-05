import { useEffect, useState } from 'react';
import { useDispatch } from 'react-redux';

import {
    Button,
    CircularProgress,
    Dialog,
    DialogActions,
    DialogContent,
    DialogTitle,
    List,
    ListItemButton,
    ListItemText,
    Typography,
} from '@mui/material';

import { AppDispatch, listShowFiles } from '../..';

export interface ServerFilePickerProps {
    open: boolean;
    onClose: () => void;
    title: string;
    /** Logical show-folder directory: sequences | music | images */
    dir: string;
    onSelect: (fileName: string) => void;
}

/** Pick a file that already exists in the player's show folder (web flow —
 *  the browser can't see the player's filesystem, but the file API can). */
export function ServerFilePickerDialog({ open, onClose, title, dir, onSelect }: ServerFilePickerProps) {
    const dispatch = useDispatch<AppDispatch>();
    const [files, setFiles] = useState<string[] | undefined>(undefined);
    const [error, setError] = useState<string | undefined>(undefined);

    useEffect(() => {
        if (!open) return;
        setFiles(undefined);
        setError(undefined);
        dispatch(listShowFiles(dir))
            .unwrap()
            .then(setFiles)
            .catch((e) => setError(String(e?.message ?? e)));
    }, [open, dir, dispatch]);

    return (
        <Dialog open={open} onClose={onClose} maxWidth="xs" fullWidth>
            <DialogTitle>{title}</DialogTitle>
            <DialogContent dividers sx={{ minHeight: 200, maxHeight: 400 }}>
                {error ? (
                    <Typography color="error">{error}</Typography>
                ) : files === undefined ? (
                    <CircularProgress size={24} />
                ) : files.length === 0 ? (
                    <Typography color="text.secondary">No files found in the show folder.</Typography>
                ) : (
                    <List dense>
                        {files.map((name) => (
                            <ListItemButton
                                key={name}
                                onClick={() => {
                                    onSelect(name);
                                    onClose();
                                }}
                            >
                                <ListItemText primary={name} />
                            </ListItemButton>
                        ))}
                    </List>
                )}
            </DialogContent>
            <DialogActions>
                <Button onClick={onClose}>Cancel</Button>
            </DialogActions>
        </Dialog>
    );
}
