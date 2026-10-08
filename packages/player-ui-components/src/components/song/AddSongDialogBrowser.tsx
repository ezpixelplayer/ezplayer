import { useEffect, useMemo, useState } from 'react';

import {
    Autocomplete,
    Button,
    Checkbox,
    Dialog,
    DialogContent,
    DialogTitle,
    Divider,
    FormControlLabel,
    Grid,
    Typography,
} from '@mui/material';
import { Box } from '../box/Box';

import { FileButton, TextField, ToastMsgs } from '@ezplayer/shared-ui-components';

import type { SequenceFiles, SequenceRecord } from '@ezplayer/ezplayer-core';
import { SUPPORTED_AUDIO_EXTENSIONS, isSupportedAudioName } from '@ezplayer/ezplayer-core';
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
import { saveErrorMessage, SongSaveProgress } from './SongSaveProgress';
import { UploadProgressDialog, type UploadProgress } from './UploadProgressDialog';

const VIDEO_EXTENSIONS = ['.mp4', '.mkv', '.avi', '.mov', '.mpg', '.mpeg'];

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
    const normalizeNewSongs = useSelector((state: RootState) => state.playbackSettings.settings.normalizeNewSongs);
    /** Normalize volume for this song; defaults from Audio Settings each time the dialog opens. */
    const [normalize, setNormalize] = useState(false);
    useEffect(() => {
        if (open) setNormalize(normalizeNewSongs === true);
    }, [open, normalizeNewSongs]);
    /** Save in flight: derived audio is built on the player before the record commits. */
    const [saving, setSaving] = useState(false);

    const [fseqFile, setFseqFile] = useState<File | null>(null);
    const [videoFile, setVideoFile] = useState<File | null>(null);
    const [videoPlayerName, setVideoPlayerName] = useState<string | null>(null);
    const [artworkFile, setArtworkFile] = useState<File | null>(null);
    const [progress, setProgress] = useState<UploadProgress | null>(null);
    const [mp3File, setMp3File] = useState<File | null>(null);
    // Files already in the player's show folder, chosen instead of uploading
    const [fseqPlayerName, setFseqPlayerName] = useState<string | null>(null);
    const [mp3PlayerName, setMp3PlayerName] = useState<string | null>(null);
    const [artworkName, setArtworkName] = useState<string | null>(null);
    const [imageUrl, setImageUrl] = useState('');
    const [pickerFor, setPickerFor] = useState<'fseq' | 'mp3' | 'video' | 'image' | null>(null);
    const [needValidFseqFile, setNeedValidFseqFile] = useState(false);
    const [needValidMp3File, setNeedValidMp3File] = useState(false);

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
        setVideoFile(null);
        setVideoPlayerName(null);
        setArtworkFile(null);
        setProgress(null);
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

    const saveValidationMessages = useMemo(() => {
        const messages: string[] = [];
        if (!newSongData.title.trim()) messages.push('Title is required.');
        if (!newSongData.artist.trim()) messages.push('Artist is required.');
        if (!(fseqFile || fseqPlayerName || mp3File || mp3PlayerName || videoFile || videoPlayerName)) {
            messages.push('Choose a sequence, audio, or video file.');
        }
        return messages;
    }, [
        newSongData.title,
        newSongData.artist,
        fseqFile,
        fseqPlayerName,
        mp3File,
        mp3PlayerName,
        videoFile,
        videoPlayerName,
    ]);

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

    // Selection stays on this computer. Only Save sends bytes to the player.
    const handleFileChange = async (
        event: React.ChangeEvent<HTMLInputElement>,
        type: 'fseq' | 'mp3' | 'video' | 'image',
    ) => {
        const file = event.target.files?.[0];
        event.target.value = '';
        if (!file || saving) return;
        if (type === 'fseq') {
            if (!file.name.toLowerCase().endsWith('.fseq')) {
                setNeedValidFseqFile(true);
                return;
            }
            setFseqFile(file);
            setFseqPlayerName(null);
            setNeedValidFseqFile(false);
            try {
                const durationMs = await getFSEQDurationMSBrowser(file);
                setNewSongData((prev) => ({ ...prev, length: Number((durationMs / 1000).toFixed(3)) }));
            } catch (error) {
                console.error('Error getting FSEQ duration:', error);
            }
        } else if (type === 'mp3') {
            if (!isSupportedAudioName(file.name)) {
                setNeedValidMp3File(true);
                return;
            }
            setMp3File(file);
            setMp3PlayerName(null);
            setNeedValidMp3File(false);
        } else if (type === 'video') {
            if (!VIDEO_EXTENSIONS.some((ext) => file.name.toLowerCase().endsWith(ext))) return;
            setVideoFile(file);
            setVideoPlayerName(null);
        } else {
            setArtworkFile(file);
            setArtworkName(file.name);
        }
        if (type !== 'image') {
            setNewSongData((prev) => ({
                ...prev,
                title: prev.title || file.name.replace(/\.[^.]+$/, ''),
                artist: prev.artist || 'Unknown Artist',
            }));
        }
    };

    const handleNewSongSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        if (saving || saveValidationMessages.length) return;
        setSaving(true);

        try {
            const selected = [fseqFile, mp3File, videoFile, artworkFile].filter((f): f is File => !!f);
            if (new Set(selected.map((f) => f.name)).size !== selected.length) {
                throw new Error('Selected files must have different filenames.');
            }
            for (const file of selected) {
                setProgress({ name: file.name, loaded: 0, total: file.size });
                await dispatch(
                    uploadShowFiles([
                        {
                            name: file.name,
                            data: file,
                            onProgress: (loaded, total) => setProgress({ name: file.name, loaded, total }),
                        },
                    ]),
                ).unwrap();
            }
            setProgress(null);
            // Generate UUID for id and instanceId
            const uuid1 = uuidv4();
            const newId = `${uuid1}`;

            const files: SequenceFiles = {};
            files.fseq = fseqFile?.name ?? fseqPlayerName ?? undefined;
            files.audio = mp3File?.name ?? mp3PlayerName ?? undefined;
            files.video = videoFile?.name ?? videoPlayerName ?? undefined;
            files.thumb = artworkName ?? undefined;

            let detected: { detectedTitle?: string; detectedArtist?: string; durationSecs?: number } = {};
            if (files.fseq) {
                try {
                    const result = await dispatch(autodetectShowSequence(files.fseq)).unwrap();
                    detected = result;
                    files.audio ??= result.audioFile;
                    files.thumb ??= result.imageFile;
                } catch {
                    /* File selection remains usable when optional detection fails. */
                }
            }
            if (files.audio) {
                try {
                    const result = await dispatch(extractShowAudioMetadata(files.audio)).unwrap();
                    detected.detectedTitle ??= result.title;
                    detected.detectedArtist ??= result.artist;
                    files.thumb ??= result.imageFile;
                } catch {
                    /* Tags are optional. */
                }
            }
            const defaultTitle = (fseqFile ?? mp3File ?? videoFile)?.name.replace(/\.[^.]+$/, '');
            // Create the new song object with correct type structure
            const newSong: SequenceRecord = {
                instanceId: newId,
                id: newId,
                work: {
                    title:
                        newSongData.title === defaultTitle
                            ? detected.detectedTitle || newSongData.title
                            : newSongData.title,
                    artist:
                        newSongData.artist === 'Unknown Artist'
                            ? detected.detectedArtist || newSongData.artist
                            : newSongData.artist,
                    length: detected.durationSecs ?? newSongData.length, // Use the length from the FSEQ file
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
                    normalize,
                    tags: newSongData.tags,
                },
            };

            // Commit only after every selected file has reached the player.
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
            ToastMsgs.showErrorMessage(saveErrorMessage(error, 'Failed to add song'), {
                theme: 'colored',
                position: 'bottom-right',
                autoClose: 6000,
            });
        } finally {
            setSaving(false);
            setProgress(null);
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
                    <Typography variant="body2" sx={{ mb: 2 }}>
                        Choose files from this computer, then click Save to upload them to the player. You can save a
                        sequence, audio, or video separately and add matching files later. Light playback requires a
                        sequence file.
                    </Typography>
                    <fieldset disabled={saving} style={{ border: 0, padding: 0, margin: 0 }}>
                        <Grid container spacing={2}>
                            <Grid item xs={12}>
                                <Typography variant="h5" sx={{ mb: 1 }} fontWeight="bold">
                                    Sequence file (optional)
                                </Typography>
                                <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                                    <FileButton
                                        fileType={['.fseq']}
                                        isMultipleFile={false}
                                        onChange={(e) =>
                                            handleFileChange(e as React.ChangeEvent<HTMLInputElement>, 'fseq')
                                        }
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
                                    Audio file{' '}
                                    <Typography component="span" variant="body2" color="text.secondary">
                                        (optional: {SUPPORTED_AUDIO_EXTENSIONS.join(', ')})
                                    </Typography>
                                </Typography>
                                <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                                    <FileButton
                                        fileType={[...SUPPORTED_AUDIO_EXTENSIONS]}
                                        isMultipleFile={false}
                                        onChange={(e) =>
                                            handleFileChange(e as React.ChangeEvent<HTMLInputElement>, 'mp3')
                                        }
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
                                        Please upload a supported audio file ({SUPPORTED_AUDIO_EXTENSIONS.join(', ')})
                                    </Typography>
                                )}
                            </Grid>
                            <Grid item xs={12}>
                                <Typography variant="h5" sx={{ mb: 1 }} fontWeight="bold">
                                    Video file (optional)
                                </Typography>
                                <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                                    <FileButton
                                        fileType={VIDEO_EXTENSIONS}
                                        isMultipleFile={false}
                                        onChange={(e) =>
                                            handleFileChange(e as React.ChangeEvent<HTMLInputElement>, 'video')
                                        }
                                    />
                                    <Button variant="outlined" size="small" onClick={() => setPickerFor('video')}>
                                        Choose on player
                                    </Button>
                                    <Typography variant="body2" color="text.secondary">
                                        {videoFile?.name ?? videoPlayerName ?? ''}
                                    </Typography>
                                </Box>
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
                                    helperText="Required"
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
                                    helperText="Required"
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
                                <FormControlLabel
                                    sx={{ mt: 1 }}
                                    control={
                                        <Checkbox
                                            checked={normalize}
                                            onChange={(e) => {
                                                const next = e.target.checked;
                                                setNormalize(next);
                                                // Normalized audio makes a manual offset redundant; start from 0.
                                                if (next) setNewSongData((prev) => ({ ...prev, volume_adj: '0' }));
                                            }}
                                        />
                                    }
                                    label="Normalize volume"
                                />
                            </Grid>
                        </Grid>
                    </fieldset>
                    {saveValidationMessages.length > 0 && (
                        <Box sx={{ mt: 2 }} role="alert">
                            {saveValidationMessages.map((message) => (
                                <Typography key={message} variant="body2" color="error">
                                    {message}
                                </Typography>
                            ))}
                            {saveValidationMessages.length > 1 && (
                                <Typography variant="body2" color="error" sx={{ mt: 0.5 }}>
                                    Please complete all required fields before saving.
                                </Typography>
                            )}
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
                                saving ||
                                !(
                                    fseqFile ||
                                    fseqPlayerName ||
                                    mp3File ||
                                    mp3PlayerName ||
                                    videoFile ||
                                    videoPlayerName
                                ) ||
                                !newSongData.title ||
                                !newSongData.artist
                            }
                        >
                            Save
                        </Button>
                        <Button type="button" variant="outlined" color="secondary" onClick={onClose} disabled={saving}>
                            Cancel
                        </Button>
                    </Box>
                    <SongSaveProgress saving={saving} audio={mp3File?.name ?? mp3PlayerName} normalize={normalize} />
                </form>
            </>
            <UploadProgressDialog open={saving} progress={progress} />
            <ServerFilePickerDialog
                open={pickerFor !== null}
                onClose={() => setPickerFor(null)}
                title={
                    pickerFor === 'fseq'
                        ? 'Choose a sequence on the player'
                        : pickerFor === 'mp3'
                          ? 'Choose audio on the player'
                          : pickerFor === 'video'
                            ? 'Choose video on the player'
                            : 'Choose artwork on the player'
                }
                dir={
                    pickerFor === 'fseq'
                        ? 'sequences'
                        : pickerFor === 'mp3'
                          ? 'music'
                          : pickerFor === 'video'
                            ? 'videos'
                            : 'images'
                }
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
                    } else if (pickerFor === 'video') {
                        setVideoPlayerName(name);
                        setVideoFile(null);
                    } else {
                        setArtworkFile(null);
                        setArtworkName(name);
                    }
                }}
            />
        </Box>
    );

    return (
        <Dialog open={open} onClose={saving ? undefined : onClose}>
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
