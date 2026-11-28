import React, { useEffect, useState } from 'react';
import {
    Alert,
    Autocomplete,
    Button,
    Dialog,
    DialogActions,
    DialogContent,
    DialogTitle,
    Stack,
    TextField,
    Typography,
    useMediaQuery,
    useTheme,
} from '@mui/material';
import type { TestTweakDoc, TestTweakSnapshot } from '@ezplayer/ezplayer-core';
import { useFrameServerUrl } from '../../hooks/useFrameServerUrl';
import { WiringPanel } from './WiringPanel';
import { useTestTweak } from './useTestTweak';

export interface WiringDialogProps {
    open: boolean;
    onClose: () => void;
    /** The model to start on; the dialog can move to another. */
    model?: string | null;
    doc: TestTweakDoc;
    updateDoc: (change: (doc: TestTweakDoc) => TestTweakDoc) => void;
    snapshot?: TestTweakSnapshot;
    /** Shown when the player has not answered, or refused something. */
    error?: string;
    /** Go to the Controllers screen, where configuration is uploaded. Leave out when already there. */
    onOpenControllers?: () => void;
}

/**
 * Rewire one model: move it to another port, split it into chunks, put the
 * chunks where they are plugged in.  Reached from a model's settings and
 * from a controller's port map.
 */
export const WiringDialog: React.FC<WiringDialogProps> = ({
    open,
    onClose,
    model,
    doc,
    updateDoc,
    snapshot,
    error,
    onOpenControllers,
}) => {
    const theme = useTheme();
    const small = useMediaQuery(theme.breakpoints.down('md'));
    const [name, setName] = useState<string | null>(model ?? null);
    useEffect(() => {
        if (open) setName(model ?? null);
    }, [open, model]);
    const models = snapshot?.models ?? [];
    const pixel = models.filter((m) => m.pixel).map((m) => m.name);

    return (
        <Dialog open={open} onClose={onClose} fullScreen={small} fullWidth maxWidth="lg">
            <DialogTitle sx={{ pb: 1 }}>
                <Stack direction="row" spacing={2} alignItems="center" sx={{ flexWrap: 'wrap', rowGap: 1 }}>
                    <Typography variant="h6" component="span">
                        Rewire
                    </Typography>
                    <Autocomplete
                        size="small"
                        options={pixel}
                        value={name && pixel.includes(name) ? name : null}
                        onChange={(_, v) => setName(v)}
                        renderInput={(params) => <TextField {...params} label="Model" />}
                        sx={{ minWidth: 260, flex: { xs: 1, sm: 'none' } }}
                    />
                </Stack>
            </DialogTitle>
            <DialogContent dividers sx={{ p: 0 }}>
                {error && (
                    <Alert severity="error" sx={{ m: 2, mb: 0 }}>
                        {error}
                    </Alert>
                )}
                <WiringPanel
                    doc={doc}
                    updateDoc={updateDoc}
                    models={models}
                    controllers={snapshot?.controllers ?? []}
                    selectedModels={name ? [name] : []}
                    problems={snapshot?.problems ?? []}
                    rewired={snapshot?.rewired ?? []}
                    onSelectModel={setName}
                    onOpenControllers={onOpenControllers}
                />
            </DialogContent>
            <DialogActions>
                <Button variant="contained" onClick={onClose}>
                    Done
                </Button>
            </DialogActions>
        </Dialog>
    );
};

/**
 * The wiring dialog for screens that do not otherwise hold the Test + Tweak
 * state (the controller port map): it talks to the player itself while open.
 */
export const RewireDialog: React.FC<{ model?: string | null; onClose: () => void }> = ({ model, onClose }) => {
    const { url } = useFrameServerUrl();
    const { snapshot, doc, updateDoc, error } = useTestTweak(url);
    return (
        <WiringDialog
            open
            onClose={onClose}
            model={model}
            doc={doc}
            updateDoc={updateDoc}
            snapshot={snapshot}
            error={error}
        />
    );
};
