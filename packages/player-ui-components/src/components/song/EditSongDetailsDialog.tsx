import { useEffect, useState } from 'react';
import { useDispatch, useSelector } from 'react-redux';

import { Autocomplete, Box, Divider, Grid } from '@mui/material';

import { Button, isElectron, SimpleDialog, TextField, ToastMsgs, Typography } from '@ezplayer/shared-ui-components';

import type { SequenceFiles, SequenceRecord } from '@ezplayer/ezplayer-core';
import { AppDispatch, postSequenceData, RootState, setSequenceTags } from '../..';

// Component to handle file selection in Electron context
const FileSelectButton = ({
    fileType,
    onFileSelect,
}: {
    fileType: 'fseq' | 'mp3' | 'image';
    onFileSelect: (file: string | undefined) => void;
}) => {
    const handleFileSelect = async () => {
        if (typeof window !== 'undefined' && (window as any).electronAPI) {
            try {
                const options = {
                    types: [
                        {
                            name: fileType === 'fseq' ? 'FSEQ Sequence' : fileType === 'mp3' ? 'Audio' : 'Images',
                            extensions:
                                fileType === 'fseq'
                                    ? ['.fseq']
                                    : fileType === 'mp3'
                                        ? ['.mp3']
                                        : ['jpg', 'jpeg', 'png', 'gif', 'webp'],
                        },
                    ],
                    multi: false,
                };

                const filePaths = await (window as any).electronAPI.selectFiles(options);
                if (filePaths && filePaths.length > 0) {
                    onFileSelect(filePaths[0]);
                }
            } catch (error) {
                console.error('Error selecting file:', error);
            }
        } else {
            console.log('Electron API not available');
        }
    };

    return <Button btnText="Select another file" variant="outlined" size="small" onClick={handleFileSelect} />;
};

export interface EditSongDetailsProps {
    title: string;
    open: boolean;
    onClose: (event?: object, reason?: string) => void;
    selectedSongId: string | null;
}

export function EditSongDetailsDialog({ onClose, open, title, selectedSongId }: EditSongDetailsProps) {
    const dispatch = useDispatch<AppDispatch>();
    const sequenceData = useSelector((state: RootState) => state.sequences.sequenceData);
    const availableTags = useSelector((state: RootState) => state.sequences.tags);

    const [selectedSong, setSelectedSong] = useState<SequenceRecord | undefined>(undefined);
    const [selectedTags, setSelectedTags] = useState<string[]>([]);
    const [imageUrl, setImageUrl] = useState<string>('');
    const [formData, setFormData] = useState({
        title: '',
        artist: '',
        vendor: '',
        lead_time: '',
        trail_time: '',
        volume_adj: '',
        tags: [] as string[],
    });
    const [errors, setErrors] = useState({
        title: false,
        artist: false,
        lead_time: false,
        trail_time: false,
        volume_adj: false,
        tags: false,
    });
    const [uploadedFiles, setUploadedFiles] = useState<SequenceFiles>({});
    const [newFiles, setNewFiles] = useState<SequenceFiles>({});

    useEffect(() => {
        if (open && selectedSongId) {
            const selectedSong = sequenceData?.find((s) => s.id === selectedSongId);

            setSelectedSong(selectedSong);
            setSelectedTags(selectedSong?.settings?.tags || []);
            setImageUrl(selectedSong?.work?.artwork || '');
            setFormData({
                title: selectedSong?.work?.title || '',
                artist: selectedSong?.work?.artist || '',
                vendor: selectedSong?.sequence?.vendor || '',
                lead_time: selectedSong?.settings?.lead_time?.toString() || '0',
                trail_time: selectedSong?.settings?.trail_time?.toString() || '0',
                volume_adj: selectedSong?.settings?.volume_adj?.toString() || '0',
                tags: selectedSong?.settings?.tags || [],
            });

            // Only initialize file states in Electron
            if (isElectron()) {
                setUploadedFiles(selectedSong?.files || {});
                setNewFiles({});
            }
        }
    }, [open, selectedSongId, sequenceData]);

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const handleChange = (e: any) => {
        const { name, value } = e.target;
        setFormData((prev) => ({ ...prev, [name]: value }));
        setErrors((prev) => ({ ...prev, [name]: false }));
    };

    const handleFileChange = (file: string | undefined, type: 'fseq' | 'mp3' | 'image') => {
        if (file) {
            const fileKey = type === 'mp3' ? 'audio' : type === 'image' ? 'thumb' : 'fseq';
            setNewFiles((prev) => ({ ...prev, [fileKey]: file }));
        } else {
            // If file is undefined (cleared), remove it from newFiles
            const fileKey = type === 'mp3' ? 'audio' : type === 'image' ? 'thumb' : 'fseq';
            setNewFiles((prev) => {
                const updated = { ...prev };
                delete updated[fileKey];
                return updated;
            });
        }
    };

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const handleSubmit = async (e: any) => {
        e.preventDefault();
        const newErrors = {
            title: formData.title.trim() === '',
            artist: formData.artist.trim() === '',
            lead_time:
                formData.lead_time === '' ||
                isNaN(Number(formData.lead_time)) ||
                Number(formData.lead_time) < -5 ||
                Number(formData.lead_time) > 5,
            trail_time:
                formData.trail_time === '' ||
                isNaN(Number(formData.trail_time)) ||
                Number(formData.trail_time) < -5 ||
                Number(formData.trail_time) > 5,
            volume_adj:
                formData.volume_adj === '' ||
                isNaN(Number(formData.volume_adj)) ||
                Number(formData.volume_adj) < -100 ||
                Number(formData.volume_adj) > 100,
            tags: false,
        };

        setErrors(newErrors);
        if (!Object.values(newErrors).some((error) => error)) {
            // For server songs, use the existing Redux flow
            // Create the updated song object
            const prevSong = sequenceData?.find((song) => song.id === selectedSongId);
            if (prevSong) {
                // Merge existing files with new files (only in Electron)
                const updatedFiles = isElectron()
                    ? {
                        ...prevSong.files,
                        ...newFiles,
                    }
                    : prevSong.files;

                const updatedSong = {
                    ...prevSong,
                    files: updatedFiles,
                    work: {
                        ...prevSong.work,
                        title: formData.title.trim(),
                        artist: formData.artist.trim(),
                        artwork: imageUrl || undefined, // Update image URL
                    },
                    sequence: {
                        ...(prevSong.sequence || {}),
                        vendor: formData.vendor.trim() || 'Local',
                    },
                    settings: {
                        lead_time: parseFloat(formData.lead_time),
                        trail_time: parseFloat(formData.trail_time),
                        volume_adj: parseFloat(formData.volume_adj),
                        update_time: new Date().toISOString(),
                        tags: formData.tags,
                    },
                };

                // Send to the server
                try {
                    await dispatch(postSequenceData([updatedSong])).unwrap();
                    ToastMsgs.showSuccessMessage('Song settings updated successfully', {
                        theme: 'colored',
                        position: 'bottom-right',
                        autoClose: 2000,
                    });
                    onClose();
                } catch (error) {
                    console.error('Error updating song:', error);
                    onClose();
                    ToastMsgs.showErrorMessage('Failed to update song', {
                        theme: 'colored',
                        position: 'bottom-right',
                        autoClose: 2000,
                    });
                }
            }
        }
    };

    const resetFormData = () => {
        // Reset to original song data, not empty values
        const originalSong = sequenceData?.find((s) => s.id === selectedSongId);
        setFormData({
            title: originalSong?.work?.title || '',
            artist: originalSong?.work?.artist || '',
            vendor: originalSong?.sequence?.vendor || '',
            lead_time: originalSong?.settings?.lead_time?.toString() || '0',
            trail_time: originalSong?.settings?.trail_time?.toString() || '0',
            volume_adj: originalSong?.settings?.volume_adj?.toString() || '0',
            tags: originalSong?.settings?.tags || [],
        });
        setSelectedTags(originalSong?.settings?.tags || []);
        setImageUrl(originalSong?.work?.artwork || '');
        setErrors({ title: false, artist: false, lead_time: false, trail_time: false, volume_adj: false, tags: false });
        setNewFiles({});
    };

    const handleCancel = () => {
        resetFormData();
        onClose();
    };

    const handleDialogClose = (event?: object, reason?: string) => {
        // If the dialog is closed by backdrop click, reset the form data
        if (reason === 'backdropClick') {
            resetFormData();
        }
        onClose(event, reason);
    };

    // Helper function for file display
    const getFileName = (filePath?: string) => {
        if (!filePath) return 'No file';
        return filePath.split('\\').pop()?.split('/').pop() || filePath;
    };

    const editDialogContent = (
        <Box
            sx={{
                display: 'flex',
                flexDirection: 'column',
                justifyContent: 'center',
                padding: 4,
                width: '100%',
                maxWidth: isElectron() ? '800px' : '500px',
            }}
        >
            <>


                <Grid container spacing={3} >
                    {/* Song Information */}
                    <Grid item xs={12}>
                        <Typography variant="h6" sx={{ mb: 1, fontWeight: 'bold' }}>
                            Song Information
                        </Typography>
                        <form style={{ width: '100%' }}>
                            <Grid container spacing={2}>
                                <Grid item xs={6}>
                                    <TextField
                                        label="Song Title"
                                        name="title"
                                        value={formData?.title}
                                        onChange={handleChange}
                                        fullWidth
                                        margin="normal"
                                        error={errors.title}
                                        helperText={errors.title ? 'Song title is required.' : ''}
                                        required
                                    />
                                </Grid>
                                <Grid item xs={6}>
                                    <TextField
                                        label="Artist"
                                        name="artist"
                                        value={formData?.artist}
                                        onChange={handleChange}
                                        fullWidth
                                        margin="normal"
                                        error={errors.artist}
                                        helperText={errors.artist ? 'Artist name is required.' : ''}
                                        required
                                    />
                                </Grid>
                                <Grid item xs={6}>
                                    <TextField
                                        label="Vendor"
                                        name="vendor"
                                        value={formData?.vendor}
                                        onChange={handleChange}
                                        fullWidth
                                        margin="normal"
                                        placeholder="e.g., Local, xLights, etc."
                                    />
                                </Grid>
                            </Grid>
                        </form>
                    </Grid>

                    {/* File Management (Electron only) */}
                    {isElectron() && (
                        <Grid item xs={12}>
                            <Typography variant="h6" sx={{ mb: 2, fontWeight: 'bold' }}>
                                Files
                            </Typography>
                            <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
                                {/* FSEQ File */}
                                <Box sx={{ display: 'flex', alignItems: 'center', gap: 2 }}>
                                    <FileSelectButton
                                        fileType="fseq"
                                        onFileSelect={(file) => handleFileChange(file, 'fseq')}
                                    />
                                    <Typography variant="body1">
                                        {getFileName(newFiles?.fseq || uploadedFiles?.fseq) || 'No FSEQ file'}
                                    </Typography>
                                </Box>

                                {/* MP3 File */}
                                <Box sx={{ display: 'flex', alignItems: 'center', gap: 2 }}>
                                    <FileSelectButton
                                        fileType="mp3"
                                        onFileSelect={(file) => handleFileChange(file, 'mp3')}
                                    />
                                    <Typography variant="body1">
                                        {getFileName(newFiles?.audio || uploadedFiles?.audio) || 'No MP3 file'}
                                    </Typography>
                                </Box>

                                {/* Image File */}
                                <Box sx={{ display: 'flex', alignItems: 'center', gap: 2 }}>
                                    <FileSelectButton
                                        fileType="image"
                                        onFileSelect={(file) => handleFileChange(file, 'image')}
                                    />
                                    <Typography variant="body1">
                                        {getFileName(newFiles?.thumb || uploadedFiles?.thumb) || 'No image file'}
                                    </Typography>
                                </Box>
                            </Box>
                        </Grid>
                    )}

                    {/* Image URL (available in both Electron and Web) */}
                    <Grid item xs={12}>
                        <Typography variant="h6" sx={{ mb: 2, fontWeight: 'bold' }}>
                            Image URL
                        </Typography>
                        <TextField
                            label="Image URL"
                            name="imageUrl"
                            value={imageUrl}
                            onChange={(e) => setImageUrl(e.target.value)}
                            fullWidth
                            placeholder="https://example.com/image.jpg"
                            helperText="Enter an image URL that will be used as fallback or primary image source"
                        />
                    </Grid>

                    {/* Song Settings */}
                    <Grid item xs={12}>
                        <form style={{ width: '100%' }}>
                            <Grid container spacing={2}>
                                <Grid item xs={6}>
                                    <TextField
                                        label="Lead Time"
                                        name="lead_time"
                                        type="number"
                                        value={formData?.lead_time}
                                        onChange={handleChange}
                                        inputProps={{ min: -5, max: 5 }}
                                        fullWidth
                                        margin="normal"
                                        error={errors.lead_time}
                                        helperText={
                                            errors.lead_time ? 'Please enter a valid number between -5.0 and 5.0.' : ''
                                        }
                                    />
                                </Grid>
                                <Grid item xs={6}>
                                    <TextField
                                        label="Trail Time"
                                        name="trail_time"
                                        type="number"
                                        value={formData?.trail_time}
                                        onChange={handleChange}
                                        inputProps={{ min: -5, max: 5 }}
                                        fullWidth
                                        margin="normal"
                                        error={errors.trail_time}
                                        helperText={
                                            errors.trail_time ? 'Please enter a valid number between -5.0 and 5.0.' : ''
                                        }
                                    />
                                </Grid>
                                <Grid item xs={6}>
                                    <TextField
                                        label="Volume Adjustment"
                                        name="volume_adj"
                                        type="number"
                                        value={formData?.volume_adj}
                                        onChange={handleChange}
                                        inputProps={{ min: -100, max: 100 }}
                                        fullWidth
                                        margin="normal"
                                        error={errors.volume_adj}
                                        helperText={
                                            errors.volume_adj ? 'Please enter a valid number between -100 and 100.' : ''
                                        }
                                    />
                                </Grid>
                                <Grid item xs={6}>
                                    <Autocomplete
                                        multiple
                                        freeSolo
                                        options={availableTags}
                                        value={selectedTags}
                                        onChange={(_, newValue) => {
                                            setSelectedTags(newValue);
                                            setFormData((prev) => ({ ...prev, tags: newValue }));
                                            setErrors((prev) => ({ ...prev, tags: false }));
                                            newValue.forEach((tag) => {
                                                if (tag && !availableTags.includes(tag)) {
                                                    dispatch(setSequenceTags([...availableTags, tag]));
                                                }
                                            });
                                        }}
                                        onInputChange={(event, newInputValue) => {
                                            // Only create a new tag when Enter is pressed
                                            if (
                                                event?.type === 'keydown' &&
                                                (event as React.KeyboardEvent).key === 'Enter' &&
                                                newInputValue
                                            ) {
                                                if (!availableTags.includes(newInputValue)) {
                                                    dispatch(setSequenceTags([...availableTags, newInputValue]));
                                                }
                                            }
                                        }}
                                        renderInput={(params) => (
                                            <TextField {...params} label="Tags" fullWidth margin="normal" />
                                        )}
                                    />
                                </Grid>
                            </Grid>
                        </form>
                    </Grid>
                </Grid>

                {/* Action Buttons */}
                <Box
                    sx={{
                        display: 'flex',
                        justifyContent: 'space-between',
                        marginTop: 3,
                    }}
                >
                    <Button btnText={'Save'} onClick={handleSubmit} type="button" variant="contained" color="primary" />
                    <Button
                        btnText={'Cancel'}
                        type="button"
                        variant="outlined"
                        color="secondary"
                        onClick={handleCancel}
                    />
                </Box>
            </>
        </Box>
    );

    return (
        <SimpleDialog
            open={open}
            onClose={handleDialogClose}
            model_title={
                <>
                    <Typography variant="h3" fontWeight="bold">
                        {title}
                    </Typography>
                    <Divider />
                </>
            }
            model_content={<> {editDialogContent}</>}
        />
    );
}
