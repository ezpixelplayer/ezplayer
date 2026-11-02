import { useEffect, useMemo, useRef, useState } from 'react';
import { useDispatch, useSelector } from 'react-redux';

import {
    Alert,
    Button,
    Checkbox,
    CircularProgress,
    Dialog,
    DialogActions,
    DialogContent,
    DialogTitle,
    FormControlLabel,
    List,
    ListItem,
    ListItemText,
    Stack,
    Typography,
} from '@mui/material';
import FolderOpenIcon from '@mui/icons-material/FolderOpen';
import NoteAddIcon from '@mui/icons-material/NoteAdd';

import type { BatchImportSummary } from '@ezplayer/ezplayer-core';
import { AppDispatch, RootState } from '../..';
import { batchUploadImportShowSequences, listShowFiles } from '../../store/slices/SequenceStore';
import { getFSEQAudioNameBrowser } from '../../util/fsequtil';
import {
    AUDIO_EXTENSIONS,
    FSEQ_EXTENSIONS,
    IMAGE_EXTENSIONS,
    kindOf,
    planBulkUpload,
    type BulkUploadPlan,
    type FseqPlan,
    type PlayerFiles,
    type StagedFile,
} from './bulkUploadPlan';
import { UploadProgressDialog, type UploadProgress } from './UploadProgressDialog';

export interface BulkUploadDialogProps {
    open: boolean;
    onClose: () => void;
    /** The player's result plus the files this upload stored without adding a song. */
    onDone: (summary: BatchImportSummary, stored: { name: string; reason: string }[]) => void;
}

interface Staged {
    file: File;
    info: StagedFile;
}

const baseName = (p: string | undefined): string => {
    if (!p) return '';
    const norm = p.replace(/\\/g, '/');
    return norm.slice(norm.lastIndexOf('/') + 1);
};

function formatBytes(n: number): string {
    if (n < 1024 * 1024) return `${Math.max(1, Math.round(n / 1024))} KB`;
    if (n < 1024 * 1024 * 1024) return `${(n / (1024 * 1024)).toFixed(1)} MB`;
    return `${(n / (1024 * 1024 * 1024)).toFixed(2)} GB`;
}

function copyNote(existsOnPlayer: boolean, upload: boolean): string {
    if (!existsOnPlayer) return '';
    return upload ? ' Replaces the copy on the player.' : ' Keeps the copy on the player.';
}

function describeFseq(p: FseqPlan): string {
    switch (p.outcome) {
        case 'add': {
            const from =
                p.audio!.source === 'selection'
                    ? 'from this upload'
                    : p.audio!.source === 'player'
                      ? 'already on the player'
                      : 'in the media folder';
            return `Audio ${p.audio!.name} ${from}.${copyNote(p.existsOnPlayer, p.upload)}`;
        }
        case 'animation':
            return `No audio named in the sequence; plays as an animation.${copyNote(p.existsOnPlayer, p.upload)}`;
        case 'missingAudio':
            return `Needs ${p.wanted}. Add that file here, or put it in the media folder, to add the song.${copyNote(p.existsOnPlayer, p.upload)}`;
        case 'alreadyImported':
            return `Already in the song list.${copyNote(p.existsOnPlayer, p.upload)}`;
        case 'unreadable':
            return 'Could not read the sequence header; not uploaded.';
    }
}

/** Stage files from this computer, show what each will become on the player,
 *  then upload the batch and add the songs that are complete. Files with no
 *  match are stored in the show folder so a later upload can finish the job. */
export function BulkUploadDialog({ open, onClose, onDone }: BulkUploadDialogProps) {
    const dispatch = useDispatch<AppDispatch>();
    const sequenceData = useSelector((state: RootState) => state.sequences.sequenceData);
    const [staged, setStaged] = useState<Map<string, Staged>>(new Map());
    const [reading, setReading] = useState(0);
    const [player, setPlayer] = useState<PlayerFiles | null>(null);
    const [playerError, setPlayerError] = useState<string | null>(null);
    const [overwrite, setOverwrite] = useState(true);
    const [busy, setBusy] = useState(false);
    const [progress, setProgress] = useState<UploadProgress | null>(null);
    const [error, setError] = useState<string | null>(null);
    const filesInput = useRef<HTMLInputElement>(null);
    const folderInput = useRef<HTMLInputElement>(null);

    const catalogFseqs = useMemo(() => {
        const names: string[] = [];
        for (const rec of sequenceData ?? []) {
            if (rec.deleted) continue;
            const base = baseName(rec.files?.fseq);
            if (base) names.push(base);
        }
        return names;
    }, [sequenceData]);

    useEffect(() => {
        if (!open) return;
        setStaged(new Map());
        setPlayer(null);
        setPlayerError(null);
        setError(null);
        setOverwrite(true);
        let cancelled = false;
        void (async () => {
            try {
                const [sequences, music, media] = await Promise.all(
                    ['sequences', 'music', 'media'].map((dir) => dispatch(listShowFiles(dir)).unwrap()),
                );
                if (!cancelled) setPlayer({ sequences, music, media });
            } catch (e) {
                if (!cancelled) setPlayerError(e instanceof Error ? e.message : String(e));
            }
        })();
        return () => {
            cancelled = true;
        };
    }, [open, dispatch]);

    const plan: BulkUploadPlan | null = useMemo(() => {
        if (!player) return null;
        return planBulkUpload(
            [...staged.values()].map((s) => s.info),
            player,
            catalogFseqs,
            overwrite,
        );
    }, [staged, player, catalogFseqs, overwrite]);

    const addFiles = async (list: FileList | null) => {
        const files = list ? Array.from(list) : [];
        if (!files.length) return;
        setReading((n) => n + 1);
        try {
            const next = new Map(staged);
            for (const file of files) {
                const kind = kindOf(file.name);
                const info: StagedFile = { name: file.name, size: file.size, kind };
                if (kind === 'fseq') {
                    try {
                        info.headerAudio = await getFSEQAudioNameBrowser(file);
                    } catch {
                        info.headerAudio = null;
                    }
                }
                // A later pick of the same name replaces the earlier one.
                next.set(file.name.toLowerCase(), { file, info });
            }
            setStaged(next);
        } finally {
            setReading((n) => n - 1);
        }
    };

    const handleInput = (event: React.ChangeEvent<HTMLInputElement>) => {
        // Copy before clearing: the FileList is live and empties with the value.
        const list = event.target.files;
        const files = list ? Array.from(list) : [];
        event.target.value = '';
        void addFiles(files.length ? (files as unknown as FileList) : null);
    };

    const uploadSize = plan
        ? plan.uploadNames.reduce((n, name) => n + (staged.get(name.toLowerCase())?.file.size ?? 0), 0)
        : 0;
    const canUpload =
        !!plan && !busy && reading === 0 && (plan.uploadNames.length > 0 || plan.importFseqNames.length > 0);

    const handleUpload = async () => {
        if (!plan) return;
        setBusy(true);
        setError(null);
        const files = plan.uploadNames.map((name) => ({ name, data: staged.get(name.toLowerCase())!.file as Blob }));
        const label = `${files.length} file${files.length === 1 ? '' : 's'}`;
        setProgress({ name: label, loaded: 0, total: uploadSize });
        try {
            const summary = await dispatch(
                batchUploadImportShowSequences({
                    files,
                    companionAudioNames: plan.companionAudioNames,
                    importFseqNames: plan.importFseqNames,
                    onProgress: (loaded, total) => setProgress({ name: label, loaded, total }),
                }),
            ).unwrap();
            onDone({ ...summary, uploadedFiles: summary.uploadedFiles ?? plan.uploadNames }, plan.stored);
        } catch (e) {
            setError(e instanceof Error ? e.message : String(e));
        } finally {
            setBusy(false);
            setProgress(null);
        }
    };

    const songs = plan?.fseqs.filter((p) => p.outcome === 'add' || p.outcome === 'animation') ?? [];
    const waiting = plan?.fseqs.filter((p) => p.outcome === 'missingAudio') ?? [];
    const skippedFseqs = plan?.fseqs.filter((p) => p.outcome === 'alreadyImported' || p.outcome === 'unreadable') ?? [];
    const looseCompanions = plan?.companions.filter((c) => !c.claimedBy.length) ?? [];
    const claimedCompanions = plan?.companions.filter((c) => c.claimedBy.length) ?? [];

    const section = (title: string, items: { key: string; primary: string; secondary: string }[]) =>
        items.length ? (
            <>
                <Typography variant="subtitle2" sx={{ mt: 2, mb: 0.5 }}>
                    {title} ({items.length})
                </Typography>
                <List dense disablePadding>
                    {items.map((item) => (
                        <ListItem key={item.key} sx={{ px: 0 }} alignItems="flex-start">
                            <ListItemText
                                primary={item.primary}
                                secondary={item.secondary}
                                primaryTypographyProps={{ fontWeight: 600, sx: { overflowWrap: 'anywhere' } }}
                            />
                        </ListItem>
                    ))}
                </List>
            </>
        ) : null;

    return (
        <Dialog open={open} onClose={busy ? undefined : onClose} maxWidth="md" fullWidth>
            <DialogTitle>Bulk Upload</DialogTitle>
            <DialogContent dividers sx={{ minHeight: 320 }}>
                <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
                    Choose sequences, audio, and artwork from this computer. Nothing is sent until you click Upload.
                    Audio already on the player or in its media folder counts as found. Files that match nothing are
                    stored in the show folder so a later upload can complete them.
                </Typography>
                <Stack direction="row" spacing={1} alignItems="center" flexWrap="wrap" useFlexGap>
                    <Button
                        variant="outlined"
                        size="small"
                        startIcon={<NoteAddIcon />}
                        disabled={busy}
                        onClick={() => filesInput.current?.click()}
                    >
                        Add files
                    </Button>
                    <Button
                        variant="outlined"
                        size="small"
                        startIcon={<FolderOpenIcon />}
                        disabled={busy}
                        onClick={() => folderInput.current?.click()}
                    >
                        Add folder
                    </Button>
                    <Button size="small" disabled={busy || staged.size === 0} onClick={() => setStaged(new Map())}>
                        Clear
                    </Button>
                    <FormControlLabel
                        sx={{ ml: 'auto' }}
                        control={
                            <Checkbox
                                checked={overwrite}
                                disabled={busy}
                                onChange={(e) => setOverwrite(e.target.checked)}
                            />
                        }
                        label="Replace files already on the player"
                    />
                </Stack>
                <input
                    ref={filesInput}
                    type="file"
                    multiple
                    accept={[...FSEQ_EXTENSIONS, ...AUDIO_EXTENSIONS, ...IMAGE_EXTENSIONS].join(',')}
                    style={{ display: 'none' }}
                    aria-label="Add files"
                    onChange={handleInput}
                />
                <input
                    ref={folderInput}
                    type="file"
                    multiple
                    style={{ display: 'none' }}
                    aria-label="Add folder"
                    onChange={handleInput}
                    // Folder pickers are not standard; set the attributes directly.
                    {...({ webkitdirectory: '', directory: '' } as Record<string, string>)}
                />

                {playerError ? (
                    <Alert severity="error" sx={{ mt: 2 }}>
                        Could not list the files on the player: {playerError}
                    </Alert>
                ) : !player ? (
                    <Stack direction="row" spacing={1} alignItems="center" sx={{ mt: 2 }}>
                        <CircularProgress size={18} />
                        <Typography variant="body2">Listing files on the player...</Typography>
                    </Stack>
                ) : null}
                {reading > 0 && (
                    <Stack direction="row" spacing={1} alignItems="center" sx={{ mt: 2 }}>
                        <CircularProgress size={18} />
                        <Typography variant="body2">Reading sequence headers...</Typography>
                    </Stack>
                )}
                {error && (
                    <Alert severity="error" sx={{ mt: 2 }}>
                        {error}
                    </Alert>
                )}

                {plan && staged.size === 0 && (
                    <Typography color="text.secondary" sx={{ mt: 3 }}>
                        No files chosen yet.
                    </Typography>
                )}
                {plan &&
                    section(
                        'Songs to add',
                        songs.map((p) => ({ key: p.name, primary: p.name, secondary: describeFseq(p) })),
                    )}
                {plan &&
                    section('Stored for later', [
                        ...waiting.map((p) => ({ key: p.name, primary: p.name, secondary: describeFseq(p) })),
                        ...looseCompanions.map((c) => ({
                            key: c.name,
                            primary: c.name,
                            secondary:
                                (c.kind === 'audio'
                                    ? 'No sequence in this upload names it. A later sequence upload can use it.'
                                    : 'Artwork with no matching sequence or audio here.') +
                                copyNote(c.existsOnPlayer, c.upload),
                        })),
                    ])}
                {plan &&
                    section(
                        'Companion files',
                        claimedCompanions.map((c) => ({
                            key: c.name,
                            primary: c.name,
                            secondary: `Used by ${c.claimedBy.join(', ')}.${copyNote(c.existsOnPlayer, c.upload)}`,
                        })),
                    )}
                {plan &&
                    section('Not added', [
                        ...skippedFseqs.map((p) => ({ key: p.name, primary: p.name, secondary: describeFseq(p) })),
                        ...plan.ignored.map((i) => ({ key: i.name, primary: i.name, secondary: i.reason })),
                    ])}
            </DialogContent>
            <DialogActions>
                {plan && staged.size > 0 && (
                    <Typography variant="body2" color="text.secondary" sx={{ mr: 'auto', ml: 1 }}>
                        Upload {plan.uploadNames.length} file{plan.uploadNames.length === 1 ? '' : 's'}
                        {uploadSize ? ` (${formatBytes(uploadSize)})` : ''}, add {plan.importFseqNames.length} song
                        {plan.importFseqNames.length === 1 ? '' : 's'}
                    </Typography>
                )}
                <Button onClick={onClose} disabled={busy}>
                    Cancel
                </Button>
                <Button variant="contained" disabled={!canUpload} onClick={() => void handleUpload()}>
                    Upload
                </Button>
            </DialogActions>
            <UploadProgressDialog open={busy} progress={progress} />
        </Dialog>
    );
}
