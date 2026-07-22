import { useEffect, useState } from 'react';

import {
    Autocomplete,
    Button,
    Dialog,
    DialogContent,
    DialogTitle,
    Divider,
    Grid,
    LinearProgress,
    Typography,
} from '@mui/material';
import { Box } from '../box/Box';

import { FileButton, TextField, ToastMsgs } from '@ezplayer/shared-ui-components';

import type { SequenceFiles, SequenceRecord } from '@ezplayer/ezplayer-core';
import {
    AppDispatch,
    autodetectShowSequence,
    extractShowAudioMetadata,
    postSequenceData,
    RootState,
    setSequenceTags,
    uploadShowFiles,
} from '../..';
import { ServerFilePickerDialog } from './ServerFilePickerDialog';

import { useDispatch, useSelector } from 'react-redux';
import { v4 as uuidv4 } from 'uuid';
import { getFSEQDurationMSBrowser } from '../../util/fsequtil';

export interface AddSongProps {
    title: string;
    open: boolean;
    onClose: () => void;
}

export function AddSongDialogBrowser({ onClose, open, title }: AddSongProps) {
    const dispatch = useDispatch<AppDispatch>();

    const availableTags = useSelector((state: RootState) => state.sequences.tags);

    const [fseqFile, setFseqFile] = useState<File | null>(null);
    const [mp3File, setMp3File] = useState<File | null>(null);
    // Files already in the player's show folder, chosen instead of uploading
    const [fseqPlayerName, setFseqPlayerName] = useState<string | null>(null);
    const [mp3PlayerName, setMp3PlayerName] = useState<string | null>(null);
    const [artworkName, setArtworkName] = useState<string | null>(null);
    const [imageUrl, setImageUrl] = useState('');
    const [pickerFor, setPickerFor] = useState<'fseq' | 'mp3' | 'image' | null>(null);
    const [needValidFseqFile, setNeedValidFseqFile] = useState(false);
    const [needValidMp3File, setNeedValidMp3File] = useState(false);
    const [uploading, setUploading] = useState(false);
    const [uploadingName, setUploadingName] = useState<string | null>(null);

    const [newSongData, setNewSongData] = useState({
        title: '',
        artist: '',
        lead_time: '',
        trail_time: '',
        vendor: '',
        volume_adj: '',
        tags: [] as string[],
        length: 0,
    });

    useEffect(() => {
        setFseqFile(null);
        setMp3File(null);
        setFseqPlayerName(null);
        setMp3PlayerName(null);
        setArtworkName(null);
        setImageUrl('');
        setNewSongData({
            title: '',
            artist: '',
            lead_time: '',
            trail_time: '',
            vendor: '',
            volume_adj: '',
            tags: [],
            length: 0,
        });
    }, [open]);

    const handleNewSongDataChange = (e: React.ChangeEvent<HTMLInputElement>) => {
        const { name, value } = e.target;
        setNewSongData((prev) => ({ ...prev, [name]: value }));
    };

    /** Fill from server-side detection: metadata only where the user has not
     *  typed, matching audio only where none is chosen, artwork if found. */
    const runAutodetect = async (fseqName: string) => {
        try {
            const detected = await dispatch(autodetectShowSequence(fseqName)).unwrap();
            setNewSongData((prev) => ({
                ...prev,
                title: prev.title || detected.detectedTitle || '',
                artist: prev.artist || detected.detectedArtist || '',
                length: detected.durationSecs ?? prev.length,
            }));
            if (detected.audioFile) {
                setMp3PlayerName((prev) => (prev || mp3File ? prev : detected.audioFile!));
            }
            if (detected.imageFile) {
                setArtworkName((prev) => prev ?? detected.imageFile!);
            }
        } catch (error) {
            console.error('Autodetect failed:', error);
        }
    };

    /** Tags from a specific audio file the user just picked or chose. */
    const applyAudioMetadata = async (audioName: string) => {
        try {
            const meta = await dispatch(extractShowAudioMetadata(audioName)).unwrap();
            setNewSongData((prev) => ({
                ...prev,
                title: prev.title || meta.title || '',
                artist: prev.artist || meta.artist || '',
            }));
            if (meta.imageFile) {
                setArtworkName((prev) => prev ?? meta.imageFile!);
            }
        } catch (error) {
            console.error('Audio metadata failed:', error);
        }
    };

    /** Push picked bytes to the player right away so server-side detection can
     *  run and Save is a pure metadata commit. */
    const uploadPicked = async (file: File): Promise<boolean> => {
        setUploading(true);
        setUploadingName(file.name);
        try {
            await dispatch(uploadShowFiles([{ name: file.name, data: file }])).unwrap();
            return true;
        } catch (error) {
            console.error('Upload failed:', error);
            ToastMsgs.showErrorMessage(`Failed to upload ${file.name}`, {
                theme: 'colored',
                position: 'bottom-right',
                autoClose: 2000,
            });
            return false;
        } finally {
            setUploading(false);
            setUploadingName(null);
        }
    };

    const handleFileChange = async (event: React.ChangeEvent<HTMLInputElement>, type: 'fseq' | 'mp3' | 'image') => {
        const file = event.target.files?.[0];
        if (!file) return;
        if (type === 'fseq') {
            if (!file.name.endsWith('.fseq')) {
                setNeedValidFseqFile(true);
                setFseqFile(null);
                return;
            }
            if (!(await uploadPicked(file))) return;
            setFseqFile(file);
            setFseqPlayerName(null);
            setNeedValidFseqFile(false);
            try {
                const durationMs = await getFSEQDurationMSBrowser(file);
                setNewSongData((prev) => ({ ...prev, length: Number((durationMs / 1000).toFixed(3)) }));
            } catch (error) {
                console.error('Error getting FSEQ duration:', error);
            }
            await runAutodetect(file.name);
        } else if (type === 'mp3') {
            if (!(file.name.endsWith('.mp3') || file.name.endsWith('.mp4'))) {
                setNeedValidMp3File(true);
                setMp3File(null);
                return;
            }
            if (!(await uploadPicked(file))) return;
            setMp3File(file);
            setMp3PlayerName(null);
            setNeedValidMp3File(false);
            await applyAudioMetadata(file.name);
        } else {
            if (!(await uploadPicked(file))) return;
            setArtworkName(file.name);
        }
    };

    const handleNewSongSubmit = async (e: React.FormEvent) => {
        e.preventDefault();

        try {
            // Generate UUID for id and instanceId
            const uuid1 = uuidv4();
            const newId = `${uuid1}`;

            const files: SequenceFiles = {};
            files.fseq = fseqFile?.name ?? fseqPlayerName ?? undefined;
            files.audio = mp3File?.name ?? mp3PlayerName ?? undefined;
            files.thumb = artworkName ?? undefined;

            // Create the new song object with correct type structure
            const newSong: SequenceRecord = {
                instanceId: newId,
                id: newId,
                work: {
                    title: newSongData.title,
                    artist: newSongData.artist,
                    length: newSongData.length, // Use the length from the FSEQ file
                    artwork: imageUrl.trim() || undefined,
                    description: '',
                    tags: [],
                    genre: '',
                    music_url: '',
                },
                sequence: {
                    vendor: newSongData.vendor.trim(),
                    variant: '',
                    sku: '',
                    vendor_url: '',
                    preview_url: '',
                },
                files,
                updatedAt: Date.now(),
                deleted: false,
                settings: {
                    lead_time: parseFloat(newSongData.lead_time) || 0,
                    trail_time: parseFloat(newSongData.trail_time) || 0,
                    volume_adj: parseFloat(newSongData.volume_adj) || 0,
                    tags: newSongData.tags,
                },
            };

            // Picked files were uploaded at selection time; this is metadata-only.
            await dispatch(postSequenceData([newSong])).unwrap();

            ToastMsgs.showSuccessMessage('Song added successfully', {
                theme: 'colored',
                position: 'bottom-right',
                autoClose: 2000,
            });

            // Close the dialog
            onClose();
        } catch (error) {
            console.error('Error adding song:', error);
            ToastMsgs.showErrorMessage('Failed to add song', {
                theme: 'colored',
                position: 'bottom-right',
                autoClose: 2000,
            });
        }
    };

    const addDialogContent = (
        <Box
            sx={{
                display: 'flex',
                flexDirection: 'column',
                justifyContent: 'center',
                padding: 4,
                width: '500px',
                minWidth: '500px',
                maxWidth: '500px',
            }}
        >
            <>
                <form style={{ width: '100%', maxWidth: 600 }} onSubmit={handleNewSongSubmit}>
                    <Grid container spacing={2}>
                        <Grid item xs={12}>
                            <Typography variant="h5" sx={{ mb: 1 }} fontWeight="bold">
                                Upload .fseq File{' '}
                                <Typography component="span" color="error">
                                    *
                                </Typography>
                            </Typography>
                            <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                                <FileButton
                                    fileType={['.fseq']}
                                    isMultipleFile={false}
                                    onChange={(e) => handleFileChange(e as React.ChangeEvent<HTMLInputElement>, 'fseq')}
                                />
                                <Button variant="outlined" size="small" onClick={() => setPickerFor('fseq')}>
                                    Choose on player
                                </Button>
                                <Typography variant="body2" color="text.secondary">
                                    {fseqFile?.name ?? fseqPlayerName ?? ''}
                                </Typography>
                            </Box>
                            {needValidFseqFile && (
                                <Typography color="error" sx={{ mt: 1 }}>
                                    Please upload a valid .fseq file
                                </Typography>
                            )}
                        </Grid>
                        <Grid item xs={12}>
                            <Typography variant="h5" sx={{ mb: 1 }} fontWeight="bold">
                                Upload .mp3 File
                            </Typography>
                            <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                                <FileButton
                                    fileType={['.mp3']}
                                    isMultipleFile={false}
                                    onChange={(e) => handleFileChange(e as React.ChangeEvent<HTMLInputElement>, 'mp3')}
                                />
                                <Button variant="outlined" size="small" onClick={() => setPickerFor('mp3')}>
                                    Choose on player
                                </Button>
                                <Typography variant="body2" color="text.secondary">
                                    {mp3File?.name ?? mp3PlayerName ?? ''}
                                </Typography>
                            </Box>
                            {needValidMp3File && (
                                <Typography color="error" sx={{ mt: 1 }}>
                                    Please upload a valid .mp3 file
                                </Typography>
                            )}
                        </Grid>
                        <Grid item xs={12}>
                            <Typography variant="h5" sx={{ mb: 1 }} fontWeight="bold">
                                Artwork
                            </Typography>
                            <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 1 }}>
                                <FileButton
                                    fileType={['.jpg', '.jpeg', '.png', '.gif', '.webp']}
                                    isMultipleFile={false}
                                    onChange={(e) =>
                                        handleFileChange(e as React.ChangeEvent<HTMLInputElement>, 'image')
                                    }
                                />
                                <Button variant="outlined" size="small" onClick={() => setPickerFor('image')}>
                                    Choose on player
                                </Button>
                                <Typography variant="body2" color="text.secondary">
                                    {artworkName ?? ''}
                                </Typography>
                            </Box>
                            <TextField
                                label="Image URL (optional)"
                                value={imageUrl}
                                onChange={(e) => setImageUrl(e.target.value)}
                                fullWidth
                                placeholder="https://example.com/image.jpg"
                            />
                        </Grid>
                        <Grid item xs={6}>
                            <TextField
                                label="Song Title"
                                name="title"
                                value={newSongData.title}
                                onChange={handleNewSongDataChange}
                                fullWidth
                                required
                            />
                        </Grid>
                        <Grid item xs={6}>
                            <TextField
                                label="Artist"
                                name="artist"
                                value={newSongData.artist}
                                onChange={handleNewSongDataChange}
                                fullWidth
                                required
                            />
                        </Grid>
                        <Grid item xs={6}>
                            <TextField
                                label="Vendor"
                                name="vendor"
                                value={newSongData.vendor}
                                onChange={handleNewSongDataChange}
                                fullWidth
                                placeholder="e.g., Local, xLights, etc."
                            />
                        </Grid>
                        <Grid item xs={6}>
                            <TextField
                                label="Lead Time"
                                name="lead_time"
                                type="number"
                                value={newSongData.lead_time}
                                onChange={handleNewSongDataChange}
                                inputProps={{ min: -5, max: 5 }}
                                fullWidth
                            />
                        </Grid>
                        <Grid item xs={6}>
                            <TextField
                                label="Trail Time"
                                name="trail_time"
                                type="number"
                                value={newSongData.trail_time}
                                onChange={handleNewSongDataChange}
                                inputProps={{ min: -5, max: 5 }}
                                fullWidth
                            />
                        </Grid>
                        <Grid item xs={6}>
                            <TextField
                                label="Volume Adjustment"
                                name="volume_adj"
                                type="number"
                                value={newSongData.volume_adj}
                                onChange={handleNewSongDataChange}
                                inputProps={{ min: -100, max: 100 }}
                                fullWidth
                            />
                        </Grid>
                        <Grid item xs={6}>
                            <Autocomplete
                                multiple
                                freeSolo
                                options={availableTags}
                                value={newSongData.tags}
                                onChange={(_, newValue) => {
                                    setNewSongData((prev) => ({ ...prev, tags: newValue }));
                                    newValue.forEach((tag) => {
                                        if (tag && !availableTags.includes(tag)) {
                                            dispatch(setSequenceTags([...availableTags, tag]));
                                        }
                                    });
                                }}
                                renderInput={(params) => <TextField {...params} label="Tags" fullWidth />}
                            />
                        </Grid>
                    </Grid>
                    {uploading && (
                        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, marginTop: 2 }}>
                            <LinearProgress sx={{ flex: 1 }} />
                            <Typography variant="caption" color="text.secondary">
                                Uploading {uploadingName}…
                            </Typography>
                        </Box>
                    )}
                    <Box
                        sx={{
                            display: 'flex',
                            justifyContent: 'space-between',
                            marginTop: 2,
                        }}
                    >
                        <Button
                            type="submit"
                            variant="contained"
                            color="primary"
                            onClick={handleNewSongSubmit}
                            disabled={
                                uploading || !(fseqFile || fseqPlayerName) || !newSongData.title || !newSongData.artist
                            }
                        >
                            Save
                        </Button>
                        <Button type="button" variant="outlined" color="secondary" onClick={onClose}>
                            Cancel
                        </Button>
                    </Box>
                </form>
            </>
            <ServerFilePickerDialog
                open={pickerFor !== null}
                onClose={() => setPickerFor(null)}
                title={
                    pickerFor === 'fseq'
                        ? 'Choose a sequence on the player'
                        : pickerFor === 'mp3'
                          ? 'Choose audio on the player'
                          : 'Choose artwork on the player'
                }
                dir={pickerFor === 'fseq' ? 'sequences' : pickerFor === 'mp3' ? 'music' : 'images'}
                onSelect={(name) => {
                    if (pickerFor === 'fseq') {
                        setFseqPlayerName(name);
                        setFseqFile(null);
                        setNeedValidFseqFile(false);
                        void runAutodetect(name); // fills title/artist/length/audio/artwork
                    } else if (pickerFor === 'mp3') {
                        setMp3PlayerName(name);
                        setMp3File(null);
                        setNeedValidMp3File(false);
                        void applyAudioMetadata(name);
                    } else {
                        setArtworkName(name);
                    }
                }}
            />
        </Box>
    );

    return (
        <Dialog open={open} onClose={onClose}>
            <DialogTitle>
                <Typography variant="h3" fontWeight="bold">
                    {title}
                </Typography>
                <Divider />
            </DialogTitle>
            <DialogContent>{addDialogContent}</DialogContent>
        </Dialog>
    );
}
