import {
    closestCenter,
    DndContext,
    DragEndEvent,
    DragOverEvent,
    DragOverlay,
    DragStartEvent,
    MeasuringStrategy,
    useDroppable,
} from '@dnd-kit/core';
import { SortableContext, verticalListSortingStrategy } from '@dnd-kit/sortable';
import type { PlaylistRecord, SequenceDetails, SequenceRecord } from '@ezplayer/ezplayer-core';
import { PageHeader, ToastMsgs } from '@ezplayer/shared-ui-components';
import SearchIcon from '@mui/icons-material/Search';
import ShuffleIcon from '@mui/icons-material/Shuffle';
import {
    Autocomplete,
    Button,
    Card,
    CircularProgress,
    Dialog,
    DialogActions,
    DialogContent,
    DialogContentText,
    DialogTitle,
    Grid,
    InputAdornment,
    MenuItem,
    Select,
    TextField,
    Typography,
} from '@mui/material';
import { Box } from '@mui/system';
import React, { useEffect, useMemo, useState } from 'react';
import { useDispatch, useSelector } from 'react-redux';
import { useNavigate, useParams } from 'react-router-dom';
import { v4 as uuidv4 } from 'uuid';
import { Routes as ROUTES } from '../..';
import { addTag, AppDispatch, postPlaylistData, RootState } from '../../';
import { SortableItem } from './SortableItem';

interface PlaylistSongInstance extends SequenceRecord {
    instanceId: string; // Unique identifier for each instance
}

// Helper function to format duration in seconds to MM:SS
const formatDuration = (durationInSeconds: number) => {
    if (!durationInSeconds) return '';
    const minutes = Math.floor(durationInSeconds / 60);
    const seconds = Math.floor(durationInSeconds % 60);
    return `${minutes}:${seconds < 10 ? '0' : ''}${seconds}`;
};

// Props for AvailableSongsContainer
interface AvailableSongsContainerProps {
    sequenceData: SequenceRecord[] | undefined;
    searchQuery: string;
    onSearchQueryChange: (query: string) => void;
    availableSortOrder: 'asc' | 'desc';
    onAvailableSortOrderChange: (order: 'asc' | 'desc') => void;
    selectedFilterTags: string[];
    onSelectedFilterTagsChange: (tags: string[]) => void;
    tagInputValue: string;
    onTagInputValueChange: (value: string) => void;
    usedSongIds: Set<string>;
    onAddSong: (id: string) => void;
    filteredAndSortedSongs: SequenceRecord[];
}

const AvailableSongsContainer = ({
    searchQuery,
    onSearchQueryChange,
    availableSortOrder,
    onAvailableSortOrderChange,
    selectedFilterTags,
    onSelectedFilterTagsChange,
    tagInputValue,
    onTagInputValueChange,
    usedSongIds,
    onAddSong,
    sequenceData,
    filteredAndSortedSongs,
}: AvailableSongsContainerProps) => {
    const { setNodeRef: setAvailableRef } = useDroppable({
        id: 'available',
    });

    // Extract all unique tags from songs for the filter dropdown
    const availableSongTags = useMemo(() => {
        const allTags = new Set<string>();
        (sequenceData || []).forEach((song) => {
            song.settings?.tags?.forEach((tag) => {
                allTags.add(tag);
            });
        });
        return Array.from(allTags);
    }, [sequenceData]);

    return (
        <Box sx={{ height: '100%', display: 'flex', flexDirection: 'column' }}>
            <Box sx={{ mb: 2 }}>
                <Grid container spacing={1}>
                    <Grid item xs={12} md={4}>
                        <TextField
                            size="small"
                            placeholder="Search songs..."
                            value={searchQuery}
                            onChange={(e) => onSearchQueryChange(e.target.value)}
                            fullWidth
                            InputProps={{
                                startAdornment: (
                                    <InputAdornment position="start">
                                        <SearchIcon />
                                    </InputAdornment>
                                ),
                            }}
                        />
                    </Grid>
                    <Grid item xs={12} md={4}>
                        <Autocomplete
                            multiple
                            size="small"
                            options={availableSongTags}
                            value={selectedFilterTags}
                            inputValue={tagInputValue}
                            onInputChange={(_, newInputValue) => {
                                onTagInputValueChange(newInputValue);
                            }}
                            onChange={(_, newValue) => {
                                onSelectedFilterTagsChange(newValue);
                                if (newValue.length > 0) {
                                    onTagInputValueChange('');
                                }
                            }}
                            renderInput={(params) => <TextField {...params} placeholder="Filter by tags" />}
                            sx={{ minWidth: 150 }}
                        />
                    </Grid>
                    <Grid item xs={6} md={2}>
                        <Select
                            size="small"
                            value={availableSortOrder}
                            onChange={(e) => onAvailableSortOrderChange(e.target.value as 'asc' | 'desc')}
                            fullWidth
                        >
                            <MenuItem value="asc">A-Z</MenuItem>
                            <MenuItem value="desc">Z-A</MenuItem>
                        </Select>
                    </Grid>
                    <Grid item xs={6} md={2}>
                        <Button
                            variant="outlined"
                            size="small"
                            fullWidth
                            onClick={() => {
                                filteredAndSortedSongs?.forEach((song) => {
                                    if (!usedSongIds.has(song.id)) {
                                        onAddSong(song.id);
                                    }
                                });
                            }}
                            disabled={!filteredAndSortedSongs?.some((song) => !usedSongIds.has(song.id))}
                        >
                            Add All
                        </Button>
                    </Grid>
                </Grid>
            </Box>
            <Box
                ref={setAvailableRef}
                sx={{
                    flexGrow: 1,
                    padding: 2,
                    border: '1px solid #ccc',
                    overflowY: 'auto',
                    '&::-webkit-scrollbar': {
                        width: '8px',
                    },
                    '&::-webkit-scrollbar-track': {
                        background: '#f1f1f1',
                    },
                    '&::-webkit-scrollbar-thumb': {
                        background: '#888',
                        borderRadius: '5px',
                    },
                    '&::-webkit-scrollbar-thumb:hover': {
                        background: '#555',
                    },
                }}
            >
                {filteredAndSortedSongs && filteredAndSortedSongs.length > 0 ? (
                    filteredAndSortedSongs.map((song) => (
                        <SortableItem
                            key={song.id}
                            id={song.id}
                            songName={`${song.work?.title} ${song.work?.artist && song.work?.artist !== '' ? `- ${song.work?.artist}` : ''}`}
                            containerId="available"
                            showRemove={false}
                            isInPlaylist={usedSongIds.has(song.id)}
                            showAdd={true}
                            onAddSong={onAddSong}
                            tags={song.settings?.tags}
                            duration={song.work?.length ? formatDuration(song.work.length) : undefined}
                        />
                    ))
                ) : (
                    <Box sx={{ p: 2, textAlign: 'center', color: 'text.secondary' }}>No songs match your filters</Box>
                )}
            </Box>
        </Box>
    );
};

interface PlaylistContainerProps {
    playlistSongs: PlaylistSongInstance[];
    dragOverItemId: string | null;
    onRemoveSong: (instanceId: string) => void;
    sortOrder: 'asc' | 'desc' | null;
    onSort: (order: 'asc' | 'desc') => void;
    setSortOrder: (order: 'asc' | 'desc' | null) => void;
    onShuffle: () => void;
}

const PlaylistContainer = ({
    playlistSongs,
    dragOverItemId,
    onRemoveSong,
    sortOrder,
    onSort,
    setSortOrder,
    onShuffle,
}: PlaylistContainerProps) => {
    const { setNodeRef: setPlaylistRef } = useDroppable({
        id: 'playlist',
    });

    // Calculate total duration of all songs in the playlist
    const totalDuration = useMemo(() => {
        return playlistSongs.reduce((total, song) => {
            return total + (song.work?.length || 0);
        }, 0);
    }, [playlistSongs]);

    // Format duration as MM:SS
    const formattedTotalDuration = useMemo(() => {
        const minutes = Math.floor(totalDuration / 60);
        const seconds = totalDuration % 60;
        const secondsWithDecimals = seconds.toFixed(3);
        const [wholeSeconds, decimals] = secondsWithDecimals.split('.');

        // Only show decimals if they're not all zeros
        const formattedSeconds =
            decimals === '000' ? wholeSeconds.padStart(2, '0') : secondsWithDecimals.padStart(6, '0');

        return `${minutes}:${formattedSeconds}`;
    }, [totalDuration]);

    return (
        <Box sx={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
            <Box
                sx={{
                    mb: 2,
                    display: 'flex',
                    gap: 1,
                    alignItems: 'center',
                }}
            >
                <Grid container spacing={1}>
                    <Grid item xs={12} md={4}>
                        <Select
                            size="small"
                            value={sortOrder || ''}
                            onChange={(e) => {
                                const value = e.target.value as 'asc' | 'desc' | '';
                                if (value) {
                                    onSort(value);
                                } else {
                                    setSortOrder(null);
                                }
                            }}
                            fullWidth
                            displayEmpty
                        >
                            <MenuItem value="">Sort by</MenuItem>
                            <MenuItem value="asc">A to Z</MenuItem>
                            <MenuItem value="desc">Z to A</MenuItem>
                        </Select>
                    </Grid>
                    <Grid item xs={12} md={2}>
                        <Button
                            startIcon={<ShuffleIcon />}
                            onClick={onShuffle}
                            variant="outlined"
                            size="small"
                            fullWidth
                        >
                            Shuffle
                        </Button>
                    </Grid>
                    <Grid item xs={12} md={6}>
                        <Typography variant="body1" sx={{ textAlign: 'right', pt: 0.5 }}>
                            Total Duration: {formattedTotalDuration}
                        </Typography>
                    </Grid>
                </Grid>
            </Box>
            <Box
                ref={setPlaylistRef}
                sx={{
                    padding: 2,
                    border: '1px solid #ccc',
                    flexGrow: 1,
                    overflowY: 'auto',
                    overflowX: 'hidden',
                    position: 'relative',
                    '&::-webkit-scrollbar': {
                        width: '8px',
                    },
                    '&::-webkit-scrollbar-track': {
                        background: '#f1f1f1',
                    },
                    '&::-webkit-scrollbar-thumb': {
                        background: '#888',
                        borderRadius: '4px',
                    },
                    '&::-webkit-scrollbar-thumb:hover': {
                        background: '#555',
                    },
                }}
            >
                <SortableContext
                    items={playlistSongs ? playlistSongs.map((song) => song.instanceId) : []}
                    strategy={verticalListSortingStrategy}
                >
                    {playlistSongs?.map((song) => (
                        <Box key={song.instanceId}>
                            {dragOverItemId === song.instanceId && (
                                <Box
                                    sx={{
                                        height: '2px',
                                        backgroundColor: 'primary.main',
                                        transition: 'all 200ms ease',
                                        marginBottom: '4px',
                                    }}
                                />
                            )}
                            <SortableItem
                                id={song.instanceId}
                                songName={`${song.work?.title} ${song.work?.artist && song.work?.artist !== '' ? `- ${song.work?.artist}` : ''}`}
                                containerId="playlist"
                                showRemove={true}
                                onRemoveSong={onRemoveSong}
                                showAdd={false}
                                duration={song.work?.length ? formatDuration(song.work.length) : undefined}
                            />
                        </Box>
                    ))}
                    {dragOverItemId === 'playlist' && (
                        <Box
                            sx={{
                                height: '2px',
                                backgroundColor: 'primary.main',
                                transition: 'all 200ms ease',
                                marginTop: '4px',
                            }}
                        />
                    )}
                </SortableContext>
            </Box>
        </Box>
    );
};

export interface EditPlayListProps {
    title: string;
    statusArea: React.ReactNode[];
}

export function CreateEditPlaylist({ title: _title, statusArea }: EditPlayListProps) {
    const { id } = useParams<{ id: string }>();
    const navigate = useNavigate();
    // const location = useLocation();

    const AVAILABLE_TAGS = useSelector((state: RootState) => state.playlists.tags || []);

    const dispatch = useDispatch<AppDispatch>();
    const sequenceData = useSelector((state: RootState) => state.sequences.sequenceData);
    const playlists = useSelector((state: RootState) => state.playlists);
    const anythingUpdating = useSelector((state: RootState) => state.sequences.loading || state.schedule.loading);

    const [playlistName, setPlaylistName] = useState('');
    const [selectedTags, setSelectedTags] = useState<string[]>([]);
    const [playlistSongs, setPlaylistSongs] = useState<PlaylistSongInstance[]>([]);
    const [usedSongIds, setUsedSongIds] = useState<Set<string>>(new Set());
    const [activeId, setActiveId] = useState<string | null>(null);
    const [dragOverItemId, setDragOverItemId] = useState<string | null>(null);
    const [hasUnsavedChanges, setHasUnsavedChanges] = useState(false);
    const [savePlaylistClicked, setSavePlaylistClicked] = useState(false);
    const [sortOrder, setSortOrder] = useState<'asc' | 'desc' | null>(null);
    const [pendingNavigation, setPendingNavigation] = useState<string | null>(null);
    const [isNavigationDialogOpen, setIsNavigationDialogOpen] = useState(false);
    const [pendingAction, setPendingAction] = useState<'navigate' | 'discard' | null>(null);
    const [searchQuery, setSearchQuery] = useState('');
    const [availableSortOrder, setAvailableSortOrder] = useState<'asc' | 'desc'>('asc');
    const [selectedFilterTags, setSelectedFilterTags] = useState<string[]>([]);
    const [tagInputValue, setTagInputValue] = useState('');

    const savePlaylists = async (s: PlaylistRecord[]) => {
        try {
            await dispatch(postPlaylistData(s)).unwrap(); // Will throw if rejected
        } catch (error) {
            console.error('Error refreshing playlists:', error);
            throw error; // Optional: Re-throw for higher-level handling
        }
    };

    // Update hasUnsavedChanges when user makes changes
    useEffect(() => {
        if (!anythingUpdating && id && id !== '-1') {
            const existingPlaylist = playlists?.playlists?.find((playlist) => playlist.id === id);
            if (existingPlaylist) {
                const hasChanges =
                    playlistName !== existingPlaylist.title ||
                    JSON.stringify(selectedTags) !== JSON.stringify(existingPlaylist.tags) ||
                    JSON.stringify(playlistSongs.map((song) => song.id)) !==
                        JSON.stringify(existingPlaylist.items.map((item) => item.id));

                setHasUnsavedChanges(hasChanges);
            }
        } else if (id === '-1') {
            // For new playlist, check if user has entered any data
            setHasUnsavedChanges(playlistName !== '' || selectedTags.length > 0 || playlistSongs.length > 0);
        }
    }, [playlistName, selectedTags, playlistSongs, id, playlists, anythingUpdating]);

    // Modify the existing useEffect for prefilling data
    useEffect(() => {
        if (!anythingUpdating && id && id !== '-1') {
            const existingPlaylist = playlists?.playlists?.find((playlist) => playlist.id === id);

            if (existingPlaylist) {
                // Prefill playlist name
                setPlaylistName(existingPlaylist.title);

                // Prefill tags
                setSelectedTags(existingPlaylist.tags || []);

                // Prefill selected songs from sequenceData
                const selectedSongs = existingPlaylist.items
                    .map((item) => {
                        // First check in server songs
                        const song = sequenceData?.find((s) => s.id === item.id);

                        return song ? { ...song, sequence: item.sequence } : null;
                    })
                    .filter((song): song is NonNullable<typeof song> => song !== null)
                    .map((song) => ({
                        ...song,
                        sequence: song.sequence as unknown as SequenceDetails,
                        instanceId: `${song.id}_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
                    }));

                setPlaylistSongs(selectedSongs);

                const usedIds = new Set(existingPlaylist.items.map((item) => item.id));
                setUsedSongIds(usedIds);

                // Initially set hasUnsavedChanges to false when loading existing playlist
                setHasUnsavedChanges(false);
            }
        }
    }, [id, sequenceData, anythingUpdating]);

    const handleDragStart = (event: DragStartEvent) => {
        setActiveId(event.active.id as string);
        setDragOverItemId(null);
    };

    const handleDragOver = (event: DragOverEvent) => {
        const { over } = event;

        if (!over) {
            setDragOverItemId(null);
            return;
        }

        // Only show placeholder in playlist container
        if (over.data.current?.containerId === 'playlist') {
            setDragOverItemId(over.id as string);
        } else {
            setDragOverItemId(null);
        }
    };

    const handleSavePlaylist = async () => {
        // Set these states first before any API call
        setSavePlaylistClicked(true);
        setHasUnsavedChanges(false);

        try {
            const playlistData: PlaylistRecord = {
                id: id === '-1' ? uuidv4() : id || '',
                title: playlistName || '',
                tags: selectedTags || [],
                createdAt:
                    id === '-1'
                        ? Date.now()
                        : playlists.playlists.find((p: PlaylistRecord) => p.id === id)?.createdAt || Date.now(),
                updatedAt: Date.now(),
                items: playlistSongs.map((song, index) => ({
                    id: song.id,
                    sequence: index + 1,
                })),
            };

            await savePlaylists([playlistData]);

            // Clear all states
            setPlaylistName('');
            setSelectedTags([]);
            setPlaylistSongs([]);
            setUsedSongIds(new Set());

            ToastMsgs.showSuccessMessage(
                id === '-1' ? 'Playlist created successfully' : 'Playlist updated successfully',
                {
                    theme: 'colored',
                    position: 'bottom-right',
                    autoClose: 2000,
                },
            );

            // Navigate to playlist route
            navigate(ROUTES.PLAYLIST);
        } catch (error) {
            setHasUnsavedChanges(true);
            setSavePlaylistClicked(false);
            console.error('Error saving playlist:', error);
            ToastMsgs.showErrorMessage('Failed to save playlist', {
                theme: 'colored',
                position: 'bottom-right',
                autoClose: 2000,
            });
        }
    };

    const sortSongs = (songs: typeof playlistSongs, order: 'asc' | 'desc') => {
        return [...songs].sort((a, b) => {
            const titleA = (a.work?.title || '').toLowerCase();
            const titleB = (b.work?.title || '').toLowerCase();
            if (order === 'desc') {
                return titleB.localeCompare(titleA); // Z to A
            }
            return titleA.localeCompare(titleB); // A to Z
        });
    };

    const handleSort = (order: 'asc' | 'desc') => {
        setSortOrder(order);
        setPlaylistSongs((prevSongs) => sortSongs(prevSongs, order));
    };

    const handleShuffle = () => {
        setPlaylistSongs((prevSongs) => {
            const shuffledSongs = [...prevSongs];
            for (let i = shuffledSongs.length - 1; i > 0; i--) {
                const j = Math.floor(Math.random() * (i + 1));
                [shuffledSongs[i], shuffledSongs[j]] = [shuffledSongs[j], shuffledSongs[i]];
            }
            return shuffledSongs;
        });
        setSortOrder(null); // Reset sort order when shuffling
    };

    const handleAddSong = (id: string): void => {
        // Try to find the song in sequenceData first
        const songToAdd = sequenceData?.find((song) => song.id === id);

        if (songToAdd) {
            const uniqueInstanceId = `${songToAdd.id}_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;

            setPlaylistSongs((prevSongs) => {
                const newSongs = [
                    ...prevSongs,
                    {
                        ...songToAdd,
                        instanceId: uniqueInstanceId,
                    },
                ];

                // If there's a sort order, use it
                if (sortOrder) {
                    return sortSongs(newSongs, sortOrder);
                }

                // If no sort order, just add to the end
                return newSongs;
            });

            setUsedSongIds((prev) => new Set(prev).add(songToAdd.id));
        }
    };

    const handleDragEnd = (event: DragEndEvent) => {
        setDragOverItemId(null);
        const { active, over } = event;
        if (!over) return;

        const sourceContainerId = active.data.current?.containerId;
        const destinationContainerId =
            over.id === 'available'
                ? 'available'
                : over.id === 'playlist'
                  ? 'playlist'
                  : over.data.current?.containerId;

        // Handle reordering within playlist container
        if (sourceContainerId === 'playlist' && destinationContainerId === 'playlist') {
            const oldIndex = playlistSongs.findIndex((song) => song.instanceId === active.id);
            const newIndex = playlistSongs.findIndex((song) => song.instanceId === over.id);

            if (oldIndex !== -1 && newIndex !== -1) {
                setPlaylistSongs((prevSongs) => {
                    const newSongs = [...prevSongs];
                    const [movedSong] = newSongs.splice(oldIndex, 1);
                    newSongs.splice(newIndex, 0, movedSong);
                    return newSongs;
                });
            }
            return;
        }

        // Handle dragging from available to playlist
        if (sourceContainerId === 'available' && destinationContainerId === 'playlist') {
            // Try to find in server songs first
            const itemToAdd = sequenceData?.find((item) => item.id === active.id);

            if (itemToAdd) {
                const uniqueInstanceId = `${itemToAdd.id}_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;

                setPlaylistSongs((prevSongs) => {
                    const newSongInstance = {
                        ...itemToAdd,
                        instanceId: uniqueInstanceId,
                    };

                    const newSongs = [...prevSongs];

                    // If no sort order is active, insert at the drop position
                    if (!sortOrder) {
                        if (over.id === 'playlist') {
                            // If dropped directly on the playlist container, add to end
                            newSongs.push(newSongInstance);
                        } else {
                            // Insert at the specific position
                            const overIndex = newSongs.findIndex((song) => song.instanceId === over.id);
                            if (overIndex !== -1) {
                                newSongs.splice(overIndex, 0, newSongInstance);
                            } else {
                                newSongs.push(newSongInstance);
                            }
                        }
                        return newSongs;
                    }

                    // If sort order is active, add and sort
                    newSongs.push(newSongInstance);
                    return sortSongs(newSongs, sortOrder);
                });

                setUsedSongIds((prev) => new Set(prev).add(itemToAdd.id));
            }
        }

        // Keep existing drag removal logic
        if (sourceContainerId === 'playlist' && destinationContainerId === 'available') {
            const songToRemove = playlistSongs.find((song) => song.instanceId === active.id);

            if (songToRemove) {
                setPlaylistSongs((prevSongs) => {
                    const newSongs = prevSongs.filter((song) => song.instanceId !== active.id);

                    // Check if this was the last instance of the song
                    if (!newSongs.some((song) => song.id === songToRemove.id)) {
                        setUsedSongIds((prev) => {
                            const newSet = new Set(prev);
                            newSet.delete(songToRemove.id);
                            return newSet;
                        });
                    }

                    return newSongs;
                });
            }
        }
    };

    const handleRemoveSong = (instanceId: string) => {
        const songToRemove = playlistSongs.find((song) => song.instanceId === instanceId);

        setPlaylistSongs((prevSongs) => {
            const newSongs = prevSongs.filter((song) => song.instanceId !== instanceId);

            // If this was the last instance of this song in the playlist,
            // remove it from addedSongIds
            if (songToRemove && !newSongs.some((song) => song.id === songToRemove.id)) {
                setUsedSongIds((prev) => {
                    const newSet = new Set(prev);
                    newSet.delete(songToRemove.id);
                    return newSet;
                });
            }

            return newSongs;
        });
    };

    const filteredAndSortedSongs = useMemo(() => {
        return (sequenceData || [])
            ?.filter((song) => {
                // Text search filter for title/artist
                const matchesSearch =
                    song.work?.title?.toLowerCase().includes(searchQuery.toLowerCase()) ||
                    song.work?.artist?.toLowerCase().includes(searchQuery.toLowerCase());

                // Tag filter - if no tags selected and no input, show all songs
                let matchesTags = true;

                if (selectedFilterTags.length > 0) {
                    // If tags are selected, check if song has any of those tags
                    matchesTags = selectedFilterTags.some((tag) => song.settings?.tags?.includes(tag));
                } else if (tagInputValue) {
                    // If no tags selected but there's input text, filter by that text
                    matchesTags =
                        song.settings?.tags?.some((tag) => tag.toLowerCase().includes(tagInputValue.toLowerCase())) ||
                        false;
                }

                return matchesSearch && matchesTags;
            })
            .sort((a, b) => {
                const titleA = a.work?.title?.toLowerCase() || '';
                const titleB = b.work?.title?.toLowerCase() || '';
                return availableSortOrder === 'asc' ? titleA.localeCompare(titleB) : titleB.localeCompare(titleA);
            });
    }, [searchQuery, availableSortOrder, selectedFilterTags, tagInputValue, sequenceData]);

    const isPlaylistValid = (): { isValid: boolean; error: string } => {
        if (!playlistName || playlistName.trim() === '') {
            return { isValid: false, error: 'Playlist name is required' };
        }
        if (!playlistSongs || playlistSongs.length === 0) {
            return { isValid: false, error: 'At least one song is required' };
        }

        return { isValid: true, error: '' };
    };

    const handleDiscardClick = () => {
        setPendingAction('discard');
        setIsNavigationDialogOpen(true);
    };

    const handleConfirmNavigation = () => {
        setIsNavigationDialogOpen(false);

        if (pendingAction === 'discard') {
            setHasUnsavedChanges(false);
            navigate(ROUTES.PLAYLIST);
        } else if (pendingAction === 'navigate' && pendingNavigation) {
            navigate(pendingNavigation);
        }

        setPendingAction(null);
        setPendingNavigation(null);
    };

    const handleCancelNavigation = () => {
        setIsNavigationDialogOpen(false);
        setPendingAction(null);
        setPendingNavigation(null);
    };

    useEffect(() => {
        // Handle browser refresh/close
        const handleBeforeUnload = (e: BeforeUnloadEvent) => {
            if (hasUnsavedChanges && !savePlaylistClicked) {
                e.preventDefault();
                e.returnValue = '';
            }
        };

        // Handle link clicks
        const handleLinkClick = (e: MouseEvent) => {
            if (!hasUnsavedChanges || savePlaylistClicked) return;

            const target = e.target as HTMLElement;
            const link = target.closest('a');

            if (link && link.getAttribute('href')) {
                const href = link.getAttribute('href') || '';
                if (href.startsWith('/')) {
                    e.preventDefault();
                    setPendingNavigation(href);
                    setPendingAction('navigate');
                    setIsNavigationDialogOpen(true);
                }
            }
        };

        window.addEventListener('beforeunload', handleBeforeUnload);
        document.addEventListener('click', handleLinkClick, true);

        return () => {
            window.removeEventListener('beforeunload', handleBeforeUnload);
            document.removeEventListener('click', handleLinkClick, true);
        };
    }, [hasUnsavedChanges, savePlaylistClicked]);

    // Add loading state to your render
    if (anythingUpdating) {
        return (
            <Box sx={{ display: 'flex', justifyContent: 'center', alignItems: 'center', height: '100vh' }}>
                <CircularProgress />
            </Box>
        );
    }

    return (
        <Box sx={{ height: '100vh', overflow: 'hidden', display: 'flex', flexDirection: 'column' }}>
            <PageHeader
                heading={id === '-1' ? 'Create Playlist' : 'Edit Playlist'}
                children={[
                    <Button key="discard" variant="outlined" color="secondary" onClick={handleDiscardClick}>
                        Discard
                    </Button>,
                    <Button
                        key="save"
                        variant="contained"
                        color="primary"
                        onClick={handleSavePlaylist}
                        disabled={!isPlaylistValid().isValid}
                        sx={{ whiteSpace: 'nowrap', ml: 2 }}
                    >
                        Save Playlist
                    </Button>,
                    ...statusArea,
                ]}
            />

            {/* Unified navigation dialog */}
            <Dialog
                open={isNavigationDialogOpen}
                onClose={handleCancelNavigation}
                aria-labelledby="navigation-dialog-title"
                aria-describedby="navigation-dialog-description"
            >
                <DialogTitle id="navigation-dialog-title">Unsaved Changes</DialogTitle>
                <DialogContent>
                    <DialogContentText id="navigation-dialog-description">
                        You have unsaved changes. Are you sure you want to leave?
                    </DialogContentText>
                </DialogContent>
                <DialogActions>
                    <Button onClick={handleCancelNavigation} color="primary">
                        Stay
                    </Button>
                    <Button onClick={handleConfirmNavigation} color="error">
                        Leave
                    </Button>
                </DialogActions>
            </Dialog>

            {/* Add form controls below the header */}
            <Box sx={{ margin: 2 }}>
                <Grid container spacing={2}>
                    <Grid item xs={6}>
                        <Card sx={{ padding: 1 }}>
                            <TextField
                                fullWidth
                                label="Playlist Name"
                                value={playlistName}
                                onChange={(e) => setPlaylistName(e.target.value)}
                            />
                        </Card>
                    </Grid>
                    <Grid item xs={6}>
                        <Card sx={{ padding: 1 }}>
                            <Autocomplete
                                multiple
                                freeSolo
                                options={AVAILABLE_TAGS}
                                value={selectedTags}
                                onChange={(_, newValue) => {
                                    setSelectedTags([...newValue]);
                                    newValue.forEach((tag) => {
                                        if (tag && !AVAILABLE_TAGS.includes(tag)) {
                                            dispatch(addTag(tag));
                                        }
                                    });
                                }}
                                renderInput={(params) => (
                                    <TextField {...params} label="Tags" placeholder="Type to add new tags" />
                                )}
                            />
                        </Card>
                    </Grid>
                </Grid>
            </Box>
            <Box
                sx={{
                    margin: 2,
                    display: 'flex',
                    flexGrow: 1,
                    minHeight: 0,
                    userSelect: 'none',
                    WebkitUserSelect: 'none',
                    MozUserSelect: 'none',
                    msUserSelect: 'none',
                }}
            >
                <DndContext
                    collisionDetection={closestCenter}
                    onDragStart={handleDragStart}
                    onDragOver={handleDragOver}
                    onDragEnd={handleDragEnd}
                    onDragCancel={() => {
                        setActiveId(null);
                        setDragOverItemId(null);
                    }}
                    measuring={{
                        droppable: {
                            strategy: MeasuringStrategy.Always,
                        },
                    }}
                    autoScroll={{
                        enabled: true,
                        acceleration: 10,
                        interval: 5,
                        threshold: {
                            x: 0,
                            y: 0.2,
                        },
                    }}
                >
                    <Grid container spacing={2} sx={{ flexGrow: 1, minHeight: 0 }}>
                        <Grid item xs={6} sx={{ height: '100%' }}>
                            <Card
                                sx={{
                                    padding: 2,
                                    height: '100%',
                                    display: 'flex',
                                    flexDirection: 'column',
                                }}
                            >
                                <Typography variant="h4" sx={{ mb: 2 }}>
                                    Songs List
                                </Typography>
                                <Box sx={{ flexGrow: 1, minHeight: 0 }}>
                                    <AvailableSongsContainer
                                        sequenceData={sequenceData}
                                        searchQuery={searchQuery}
                                        onSearchQueryChange={setSearchQuery}
                                        availableSortOrder={availableSortOrder}
                                        onAvailableSortOrderChange={setAvailableSortOrder}
                                        selectedFilterTags={selectedFilterTags}
                                        onSelectedFilterTagsChange={setSelectedFilterTags}
                                        tagInputValue={tagInputValue}
                                        onTagInputValueChange={setTagInputValue}
                                        usedSongIds={usedSongIds}
                                        onAddSong={handleAddSong}
                                        filteredAndSortedSongs={filteredAndSortedSongs}
                                    />
                                </Box>
                            </Card>
                        </Grid>
                        <Grid item xs={6} sx={{ height: '100%' }}>
                            <Card
                                sx={{
                                    padding: 2,
                                    height: '100%',
                                    display: 'flex',
                                    flexDirection: 'column',
                                }}
                            >
                                <Typography variant="h4" sx={{ mb: 2 }}>
                                    {id === '-1' ? 'Create Playlist' : 'Edit Playlist'}
                                </Typography>
                                <Box sx={{ flexGrow: 1, minHeight: 0 }}>
                                    <PlaylistContainer
                                        playlistSongs={playlistSongs}
                                        dragOverItemId={dragOverItemId}
                                        onRemoveSong={handleRemoveSong}
                                        sortOrder={sortOrder}
                                        onSort={handleSort}
                                        setSortOrder={setSortOrder}
                                        onShuffle={handleShuffle}
                                    />
                                </Box>
                            </Card>
                        </Grid>
                    </Grid>

                    <DragOverlay dropAnimation={null}>
                        {activeId && (
                            <SortableItem
                                id={activeId}
                                songName={(() => {
                                    // First check in playlist songs
                                    const playlistSong = playlistSongs?.find((s) => s.instanceId === activeId);
                                    if (playlistSong) {
                                        return `${playlistSong.work?.title} ${playlistSong.work?.artist && playlistSong.work?.artist !== '' ? `- ${playlistSong.work?.artist}` : ''}`;
                                    }

                                    // Then check in server songs
                                    const serverSong = sequenceData?.find((s) => s.id === activeId);
                                    if (serverSong) {
                                        return `${serverSong.work?.title} ${serverSong.work?.artist && serverSong.work?.artist !== '' ? `- ${serverSong.work?.artist}` : ''}`;
                                    }

                                    return '';
                                })()}
                                containerId={
                                    playlistSongs?.some((s) => s.instanceId === activeId) ? 'playlist' : 'available'
                                }
                            />
                        )}
                    </DragOverlay>
                </DndContext>
            </Box>
        </Box>
    );
}
