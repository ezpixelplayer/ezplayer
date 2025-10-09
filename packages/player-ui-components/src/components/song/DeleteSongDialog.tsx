import { useDispatch, useSelector } from 'react-redux';

import { Box, Divider } from '@mui/material';

import { Button, SimpleDialog, ToastMsgs, Typography } from '@ezplayer/shared-ui-components';

import { AppDispatch, postPlaylistData, postSequenceData, RootState } from '../..';

export interface DeleteSongProps {
    title: string;
    open: boolean;
    onClose: () => void;
    songIdToDelete: string | null;
}

export function DeleteSongDialog({ onClose, open, title, songIdToDelete }: DeleteSongProps) {
    const dispatch = useDispatch<AppDispatch>();

    const sequenceData = useSelector((state: RootState) => state.sequences.sequenceData);
    const playlists = useSelector((state: RootState) => state.playlists);

    // Handle confirmed deletion
    const handleConfirmDelete = async () => {
        if (!songIdToDelete) return;
        const song = sequenceData?.find((song) => song.id === songIdToDelete);
        if (!song) return;

        try {
            // Tell Redux to do this
            await dispatch(postSequenceData([{ ...song, deleted: true }])).unwrap();

            // Remove the song from any playlists that contain it
            const allPlaylists = playlists?.playlists || [];
            const updatedPlaylists = allPlaylists.map((playlist) => {
                // Check if the playlist contains the deleted song
                const hasDeletedSong = playlist.items.some((item) => item.id === songIdToDelete);

                if (hasDeletedSong) {
                    // Create a new playlist without the deleted song
                    return {
                        ...playlist,
                        items: playlist.items.filter((item) => item.id !== songIdToDelete),
                        updatedAt: Date.now(),
                    };
                }
                return playlist;
            });

            // If any playlists were modified, save them
            // TODO CRAZ Does this belong here or in the redux layer?
            const modifiedPlaylists = updatedPlaylists.filter(
                (playlist, index) => playlist.items.length !== allPlaylists[index].items.length,
            );

            if (modifiedPlaylists.length > 0) {
                dispatch(postPlaylistData(updatedPlaylists))
                    .unwrap()
                    .then(() => {
                        ToastMsgs.showSuccessMessage(
                            `Song removed from ${modifiedPlaylists.length} playlist${modifiedPlaylists.length > 1 ? 's' : ''}`,
                            {
                                theme: 'colored',
                                position: 'bottom-right',
                                autoClose: 2000,
                            },
                        );
                    })
                    .catch((error) => {
                        console.error('Error updating playlists:', error);
                        ToastMsgs.showErrorMessage('Failed to update playlists after song deletion', {
                            theme: 'colored',
                            position: 'bottom-right',
                            autoClose: 2000,
                        });
                    });
            }

            ToastMsgs.showSuccessMessage('Song deleted successfully', {
                theme: 'colored',
                position: 'bottom-right',
                autoClose: 2000,
            });

            // Close the dialog
            onClose();
        } catch (error) {
            console.error('Error deleting song:', error);
            ToastMsgs.showErrorMessage('Failed to delete song', {
                theme: 'colored',
                position: 'bottom-right',
                autoClose: 2000,
            });
            onClose();
        }
    };

    // Add this delete confirmation dialog content
    const deleteDialogContent = (
        <Box
            sx={{
                display: 'flex',
                flexDirection: 'column',
                justifyContent: 'center',
            }}
        >
            <Typography>{`Are you sure you want to delete this song?`}</Typography>
            <Box
                sx={{
                    display: 'flex',
                    margin: 2,
                    justifyContent: 'flex-end',
                }}
            >
                <Button
                    btnText={'Delete'}
                    onClick={handleConfirmDelete}
                    type="submit"
                    variant="contained"
                    color="error"
                    sx={{ marginRight: 2 }}
                />
                <Button btnText={'Cancel'} type="button" variant="outlined" color="secondary" onClick={onClose} />
            </Box>
        </Box>
    );

    return (
        <SimpleDialog
            open={open}
            onClose={onClose}
            model_title={
                <>
                    <Typography variant="h5">{title}</Typography>
                    <Divider />
                </>
            }
            model_content={<>{deleteDialogContent}</>}
        />
    );
}
