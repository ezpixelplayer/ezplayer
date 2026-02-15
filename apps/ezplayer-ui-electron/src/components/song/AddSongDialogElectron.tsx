import React, { useEffect, useState } from 'react';

import { Autocomplete, Box, Button, Dialog, DialogContent, DialogTitle, Divider, Grid, Typography } from '@mui/material';

import { TextField, ToastMsgs } from '@ezplayer/shared-ui-components';

import { AppDispatch, postSequenceData, RootState, setSequenceTags } from '@ezplayer/player-ui-components';

import { SequenceFiles, SequenceRecord } from '@ezplayer/ezplayer-core';

import { ElectronFileButton } from './ElectronSelectFileButton';

import { useDispatch, useSelector } from 'react-redux';
import { v4 as uuidv4 } from 'uuid';

export interface AddSongProps {
    title: string;
    open: boolean;
    onClose: () => void;
}

export function AddSongDialogElectron({ onClose, open, title }: AddSongProps) {
    const dispatch = useDispatch<AppDispatch>();

    const availableTags = useSelector((state: RootState) => state.sequences.tags);

    const [fseqFile, setFseqFile] = useState<string | undefined>(undefined);
    const [mp3File, setMp3File] = useState<string | undefined>(undefined);
    const [imageFile, setImageFile] = useState<string | undefined>(undefined);
    const [imageUrl, setImageUrl] = useState<string>('');
    const [needValidFseqFile, setNeedValidFseqFile] = useState(false);

    const [newSongData, setNewSongData] = useState({
        title: '',
        artist: '',
        vendor: '',
        lead_time: '',
        trail_time: '',
        volume_adj: '',
        tags: [] as string[],
        length: 0,
    });

    useEffect(() => {
        setFseqFile(undefined);
        setMp3File(undefined);
        setImageFile(undefined);
        setImageUrl('');
        setNewSongData({
            title: '',
            artist: '',
            vendor: '',
            lead_time: '',
            trail_time: '',
            volume_adj: '',
            tags: [],
            length: 0,
        });
    }, [open]);

    const handleNewSongDataChange = (e: React.ChangeEvent<HTMLInputElement>) => {
        const { name, value } = e.target;
        setNewSongData((prev) => ({ ...prev, [name]: value }));
    };

    const handleFileChange = async (file: string | undefined, type: 'fseq' | 'mp3' | 'image') => {
        if (file) {
            if (type === 'fseq') {
                if (file.endsWith('.fseq')) {
                    setFseqFile(file);
                    setNeedValidFseqFile(false);

                    // TODO CRAZ Get duration from the FSEQ file on electron side
                    // TODO CRAZ this belongs in main process side
                    try {
                        // Update the new song data with the duration
                        setNewSongData((prev) => ({
                            ...prev,
                        }));
                    } catch (error) {
                        console.error('Error getting FSEQ duration:', error);
                    }
                } else {
                    setNeedValidFseqFile(true);
                    setFseqFile(undefined);
                }
            } else if (type === 'mp3') {
                if (file.endsWith('.mp3')) {
                    setMp3File(file);
                } else {
                    setMp3File(undefined);
                }
            } else if (type === 'image') {
                const lowerFile = file.toLowerCase();
                if (
                    lowerFile.endsWith('.jpg') ||
                    lowerFile.endsWith('.jpeg') ||
                    lowerFile.endsWith('.png') ||
                    lowerFile.endsWith('.gif')
                ) {
                    setImageFile(file);
                } else {
                    setImageFile(undefined);
                }
            }
        }
    };

    const handleNewSongSubmit = async (e: React.FormEvent) => {
        e.preventDefault();

        try {
            // Generate UUID for id and instanceId
            const uuid1 = uuidv4();
            const newId = `${uuid1}`;

            const files: SequenceFiles = {};
            files.fseq = fseqFile;
            files.audio = mp3File;
            files.thumb = imageFile;

            // Create the new song object with correct type structure
            const newSong: SequenceRecord = {
                instanceId: newId,
                id: newId,
                work: {
                    title: newSongData.title,
                    artist: newSongData.artist,
                    length: newSongData.length, // Use the length from the FSEQ file
                    description: '',
                    tags: [],
                    genre: '',
                    music_url: '',
                    artwork: imageUrl || undefined, // Add image URL to work.artwork
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

            // Submit to redux
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
                            <ElectronFileButton
                                fileType={{ name: 'FSEQ Sequence', extensions: ['.fseq'] }}
                                isMultipleFile={false}
                                onChange={(e) => handleFileChange(e?.target?.files[0]?.path, 'fseq')}
                            />
                            {needValidFseqFile && (
                                <Typography color="error" sx={{ mt: 1 }}>
                                    Please choose a valid .fseq file
                                </Typography>
                            )}
                            {fseqFile && <Typography sx={{ mt: 1 }}>{fseqFile}</Typography>}
                        </Grid>
                        <Grid item xs={12}>
                            <Typography variant="h5" sx={{ mb: 1 }} fontWeight="bold">
                                Upload .mp3 File
                            </Typography>
                            <ElectronFileButton
                                fileType={{ name: 'Audio', extensions: ['.mp3'] }}
                                isMultipleFile={false}
                                onChange={(e) => handleFileChange(e?.target?.files[0]?.path, 'mp3')}
                            />
                            {mp3File && <Typography sx={{ mt: 1 }}>{mp3File}</Typography>}
                        </Grid>
                        <Grid item xs={12}>
                            <Typography variant="h5" sx={{ mb: 1 }} fontWeight="bold">
                                Song Image
                            </Typography>
                            <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
                                {/* Local Image File Selection */}
                                <Box>
                                    <Typography variant="body2" sx={{ mb: 1 }} color="text.secondary">
                                        Local Image File (Electron only)
                                    </Typography>
                                    <ElectronFileButton
                                        fileType={{ name: 'Images', extensions: ['jpg', 'jpeg', 'png', 'gif', 'webp'] }}
                                        isMultipleFile={false}
                                        onChange={(e) => handleFileChange(e?.target?.files[0]?.path, 'image')}
                                    />
                                    {imageFile && <Typography sx={{ mt: 1 }}>{imageFile}</Typography>}
                                </Box>
                                {/* Image URL Input */}
                                <Box>
                                    <Typography variant="body2" sx={{ mb: 1 }} color="text.secondary">
                                        Or use Image URL (works in web and Electron)
                                    </Typography>
                                    <TextField
                                        label="Image URL"
                                        name="imageUrl"
                                        value={imageUrl}
                                        onChange={(e) => setImageUrl(e.target.value)}
                                        fullWidth
                                        placeholder="https://example.com/image.jpg"
                                    />
                                </Box>
                            </Box>
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
                            disabled={!fseqFile || !newSongData.title || !newSongData.artist}
                        >
                            Save
                        </Button>
                        <Button type="button" variant="outlined" color="secondary" onClick={onClose}>
                            Cancel
                        </Button>
                    </Box>
                </form>
            </>
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
