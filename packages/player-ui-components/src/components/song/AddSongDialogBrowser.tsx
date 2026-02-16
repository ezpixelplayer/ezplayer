import { useEffect, useState } from 'react';

import { Autocomplete, Button, Dialog, DialogContent, DialogTitle, Divider, Grid, Typography } from '@mui/material';
import { Box } from '../box/Box';

import { FileButton, TextField, ToastMsgs } from '@ezplayer/shared-ui-components';

import type { SequenceFiles, SequenceRecord } from '@ezplayer/ezplayer-core';
import { AppDispatch, postSequenceData, RootState, setSequenceTags } from '../..';

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
        setMp3File(null);
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

    const handleFileChange = async (event: React.ChangeEvent<HTMLInputElement>, type: 'fseq' | 'mp3') => {
        const file = event.target.files?.[0];
        if (file) {
            if (type === 'fseq') {
                if (file.name.endsWith('.fseq')) {
                    setFseqFile(file);
                    setNeedValidFseqFile(false);

                    // Get duration from the FSEQ file
                    try {
                        const durationMs = await getFSEQDurationMSBrowser(file);
                        const durationSeconds = Number((durationMs / 1000).toFixed(3));

                        // Update the new song data with the duration
                        setNewSongData((prev) => ({
                            ...prev,
                            length: durationSeconds,
                        }));
                    } catch (error) {
                        console.error('Error getting FSEQ duration:', error);
                    }
                } else {
                    setNeedValidFseqFile(true);
                    setFseqFile(null);
                }
            } else if (type === 'mp3' || type === 'mp4') {
                if (file.name.endsWith('.mp3') || file.name.endsWith('.mp4')) {
                    setMp3File(file);
                    setNeedValidMp3File(false);
                } else {
                    setNeedValidMp3File(true);
                    setMp3File(null);
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
            files.fseq = fseqFile?.name;
            files.audio = mp3File?.name;

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
                            <FileButton
                                fileType={['.fseq']}
                                isMultipleFile={false}
                                onChange={(e) => handleFileChange(e as React.ChangeEvent<HTMLInputElement>, 'fseq')}
                            />
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
                            <FileButton
                                fileType={['.mp3']}
                                isMultipleFile={false}
                                onChange={(e) => handleFileChange(e as React.ChangeEvent<HTMLInputElement>, 'mp3')}
                            />
                            {needValidMp3File && (
                                <Typography color="error" sx={{ mt: 1 }}>
                                    Please upload a valid .mp3 file
                                </Typography>
                            )}
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
