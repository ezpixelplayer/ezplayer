import { useState, useEffect, useRef, useMemo } from 'react';
import { Box, Button, Typography, Popover, useTheme, useMediaQuery, Autocomplete, TextField } from '@mui/material';
import { MusicNote, Lightbulb } from '@mui/icons-material';
import { PageHeader } from '@ezplayer/shared-ui-components';
import { useDispatch, useSelector } from 'react-redux';
import { AppDispatch, RootState } from '../../store/Store';
import { callImmediateCommand } from '../../store/slices/PlayerStatusStore';
import { SearchBar } from './SearchBar';
import { SortDropdown } from './SortDropdown';
import { SongCard } from './SongCard';
import { PlaylistDropdown } from './PlaylistDropdown';
import { PlaylistRecord, PlaylistItem } from '@ezplayer/ezplayer-core';
import { getImageUrl } from '../../util/imageUtils';
import { QueueAndControlStack } from '../player/QueueAndControlStack';

interface Song {
    isMusical: boolean;
    title: string;
    artist: string;
    vendor: string;
    urlPart: string;
    id: string;
    artwork?: string;
    localImagePath?: string;
    playlistIds?: string[];
}

interface SequenceItem {
    id: string;
    work?: {
        music_url?: string;
        title?: string;
        artist?: string;
        artwork?: string;
    };
    files?: {
        fseq?: string;
        thumb?: string;
    };
    settings?: {
        tags?: string[];
    };
    sequence?: {
        vendor?: string;
    };
}

export interface JukeboxAreaProps {
    onInteract?: () => void;
}

export function uuidv4(): string {
    if (typeof crypto !== "undefined" && crypto.randomUUID) {
        return crypto.randomUUID();
    }

    // RFC 4122 v4 fallback
    const bytes = new Uint8Array(16);
    crypto.getRandomValues(bytes);

    bytes[6] = (bytes[6] & 0x0f) | 0x40;
    bytes[8] = (bytes[8] & 0x3f) | 0x80;

    return [...bytes].map((b, i) =>
        ([4, 6, 8, 10].includes(i) ? "-" : "") +
        b.toString(16).padStart(2, "0")
    ).join("");
}

// New component to handle thumbnail display with fallback
function SongThumbnail({
    id,
    artwork,
    localImagePath,
    isMusical,
    size,
    theme,
}: {
    id?: string;
    artwork?: string;
    localImagePath?: string;
    isMusical: boolean;
    size: string;
    theme: any;
}) {
    const [imageError, setImageError] = useState(false);
    const [imageLoading, setImageLoading] = useState(true);

    // Get the appropriate image URL (local image takes priority) - memoized to prevent unnecessary re-renders
    const imageUrl = useMemo(() => getImageUrl(id, artwork, localImagePath), [id, artwork, localImagePath]);

    // Force re-render when image changes by using the imageUrl as a dependency
    const imageKey = useMemo(() => `thumb-${imageUrl}`, [imageUrl]);

    // Reset error state when image URL changes
    useEffect(() => {
        if (imageUrl) {
            setImageError(false);
            setImageLoading(true);
        }
    }, [imageUrl]);

    // If no image URL or image failed to load, show icon
    if (!imageUrl || imageError) {
        return isMusical ? (
            <MusicNote
                sx={{
                    display: 'block',
                    width: size,
                    height: size,
                    objectFit: 'contain',
                    color: theme.palette.primary.main,
                }}
                viewBox="0 0 24 24"
            />
        ) : (
            <Lightbulb
                sx={{
                    display: 'block',
                    width: size,
                    height: size,
                    objectFit: 'contain',
                    color: theme.palette.secondary.main,
                }}
                viewBox="0 0 24 24"
            />
        );
    }

    // Show artwork thumbnail
    return (
        <Box
            sx={{
                position: 'relative',
                width: size,
                height: size,
                display: 'flex',
                justifyContent: 'center',
                alignItems: 'center',
            }}
        >
            {imageLoading && (
                <Box
                    sx={{
                        position: 'absolute',
                        display: 'flex',
                        justifyContent: 'center',
                        alignItems: 'center',
                        width: '100%',
                        height: '100%',
                        zIndex: 1,
                    }}
                >
                    {isMusical ? (
                        <MusicNote
                            sx={{
                                width: size,
                                height: size,
                                color: theme.palette.primary.main,
                                opacity: 0.5,
                            }}
                            viewBox="0 0 24 24"
                        />
                    ) : (
                        <Lightbulb
                            sx={{
                                width: size,
                                height: size,
                                color: theme.palette.secondary.main,
                                opacity: 0.5,
                            }}
                            viewBox="0 0 24 24"
                        />
                    )}
                </Box>
            )}
            <img
                key={imageKey} // Force re-render when image changes
                src={imageUrl}
                alt="Song artwork"
                onLoad={() => setImageLoading(false)}
                onError={() => {
                    setImageError(true);
                    setImageLoading(false);
                }}
                style={{
                    width: size,
                    height: size,
                    objectFit: 'cover',
                    borderRadius: '8px',
                    display: imageLoading ? 'none' : 'block',
                }}
            />
        </Box>
    );
}

export function JukeboxArea({ onInteract }: JukeboxAreaProps) {
    const [index, setIndex] = useState(0);
    const [anchorEl, setAnchorEl] = useState<HTMLElement | null>(null);
    const theme = useTheme();
    const sequenceData = useSelector((state: RootState) => state.sequences.sequenceData);

    // Media queries for responsive design
    const isMobile = useMediaQuery(theme.breakpoints.down('sm'));
    const isTablet = useMediaQuery(theme.breakpoints.between('sm', 'md'));

    // Transform sequenceData into the format needed for the jukebox
    const songs =
        sequenceData?.map((song: SequenceItem) => ({
            isMusical: song.work?.music_url ? true : false,
            title: song.work?.title || '',
            artist: song.work?.artist || '',
            urlPart: song.files?.fseq || '', // Using fseq file name as the URL part
            id: song.id,
            artwork: song.work?.artwork, // Add artwork field
            localImagePath: song.files?.thumb, // Add local image path field
            vendor: song.sequence?.vendor || '',
        })) || [];

    const song: Song | undefined = songs[index];
    const timeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
    const dispatch = useDispatch<AppDispatch>();

    useEffect(() => {
        onInteract?.();

        return () => {
            if (timeoutRef.current) {
                clearTimeout(timeoutRef.current);
                timeoutRef.current = null;
            }
        };
    }, [index, onInteract]);

    const playSong = async () => {
        if (!song?.id) return;
        onInteract?.();
        await dispatch(
            callImmediateCommand({
                command: 'playsong',
                songId: song.id,
                immediate: true,
                priority: 5,
                requestId: uuidv4(),
            }),
        ).unwrap();
    };

    // Calculate responsive sizes
    const getIconSize = () => {
        if (isMobile) return '180px';
        if (isTablet) return '240px';
        return '300px';
    };

    const getIconContainerSize = () => {
        if (isMobile) return '160px';
        if (isTablet) return '220px';
        return '300px';
    };

    return (
        <Box
            sx={{
                display: 'flex',
                flexDirection: 'column',
                flexGrow: 1,
                height: '100%',
                position: 'relative', // Add relative positioning
                overflow: 'hidden', // Prevent overflow
            }}
        >
            {/* Icon Container - Fixed Position */}
            <Box
                sx={{
                    position: 'absolute', // Position absolutely
                    top: isMobile ? '10%' : '12%', // Position higher to avoid text overlap
                    left: '50%', // Center horizontally
                    transform: 'translateX(-50%)', // Center the element
                    width: getIconContainerSize(),
                    height: getIconContainerSize(),
                    display: 'flex',
                    justifyContent: 'center',
                    alignItems: 'center',
                    border: '2px solid white',
                    borderRadius: '12px',
                    zIndex: 1, // Ensure it stays above other elements
                    marginBottom: '20px', // Add more space below
                }}
            >
                <SongThumbnail
                    artwork={song?.artwork}
                    localImagePath={song?.localImagePath}
                    isMusical={song?.isMusical || false}
                    size={getIconSize()}
                    theme={theme}
                />
            </Box>

            {/* Content Container - Below Icon */}
            <Box
                sx={{
                    display: 'flex',
                    flexDirection: 'column',
                    alignItems: 'center',
                    justifyContent: 'flex-end',
                    height: '100%',
                    paddingBottom: isMobile ? '10px' : '20px',
                    marginTop: isMobile ? '220px' : isTablet ? '300px' : '380px', // Increased margin to avoid overlap
                    position: 'relative', // Add relative positioning
                    zIndex: 2, // Ensure content is above the icon
                }}
            >
                {/* Song Title (Large) */}
                <Typography
                    variant="h3"
                    sx={{
                        fontSize: isMobile ? '1.5rem' : isTablet ? '1.8rem' : '2rem',
                        fontWeight: 'bold',
                        marginBottom: isMobile ? 0.5 : 1,
                        color: theme.palette.primary.main,
                        textAlign: 'center',
                        maxWidth: '90%',
                        margin: '0 auto',
                        wordWrap: 'break-word',
                        position: 'relative', // Add relative positioning
                        zIndex: 2, // Ensure text is above the icon
                    }}
                >
                    {song?.title}
                </Typography>

                {/* Artist Name (Slightly Smaller) */}
                <Typography
                    variant="h4"
                    sx={{
                        fontSize: isMobile ? '1.2rem' : isTablet ? '1.4rem' : '1.5rem',
                        marginBottom: isMobile ? '10px' : '20px',
                        color: theme.palette.primary.dark,
                        textAlign: 'center',
                        maxWidth: '90%',
                        wordWrap: 'break-word',
                        position: 'relative', // Add relative positioning
                        zIndex: 2, // Ensure text is above the icon
                    }}
                >
                    {song?.artist + `${song?.vendor ? '(' + song + ')' : ''}`}
                </Typography>

                {/* Control Buttons */}
                <Box
                    sx={{
                        display: 'flex',
                        gap: isMobile ? 1 : 2,
                        justifyContent: 'center',
                        width: '100%',
                        maxWidth: isMobile ? '100%' : '600px',
                        margin: '0 auto',
                        padding: isMobile ? '0 10px' : 0,
                    }}
                >
                    <Button
                        variant="contained"
                        color="secondary"
                        sx={{
                            fontSize: isMobile ? '1.5rem' : '2rem',
                            padding: isMobile ? '5px 15px' : '10px 20px',
                            height: isMobile ? '50px' : '60px',
                            minWidth: isMobile ? '70px' : '100px',
                            flex: '0 0 auto',
                        }}
                        onClick={() => {
                            setIndex((prev: number) => (prev === 0 ? songs.length - 1 : prev - 1));
                            onInteract?.();
                        }}
                    >
                        ⬅️
                    </Button>

                    <Button
                        variant="contained"
                        color="primary"
                        sx={{
                            fontSize: isMobile ? '1.8rem' : '2.3rem',
                            padding: isMobile ? '5px 15px' : '10px 30px',
                            height: isMobile ? '50px' : '60px',
                            minWidth: isMobile ? '120px' : '150px',
                            flex: '0 0 auto',
                        }}
                        onClick={playSong}
                    >
                        ▶ Play
                    </Button>

                    <Button
                        variant="contained"
                        color="secondary"
                        sx={{
                            fontSize: isMobile ? '1.5rem' : '2rem',
                            padding: isMobile ? '5px 15px' : '10px 20px',
                            height: isMobile ? '50px' : '60px',
                            minWidth: isMobile ? '70px' : '100px',
                            flex: '0 0 auto',
                        }}
                        onClick={() => {
                            setIndex((prev: number) => (prev + 1) % songs.length);
                            onInteract?.();
                        }}
                    >
                        ➡️
                    </Button>
                </Box>
            </Box>

            {/* Popover Logo (Screensaver) */}
            <Popover
                open={Boolean(anchorEl)}
                anchorEl={document.body}
                onClose={() => setAnchorEl(null)}
                anchorOrigin={{
                    vertical: 'top',
                    horizontal: 'left',
                }}
                transformOrigin={{
                    vertical: 'top',
                    horizontal: 'left',
                }}
                slotProps={{
                    paper: {
                        sx: {
                            width: '100vw',
                            height: '100vh',
                            display: 'flex',
                            justifyContent: 'center',
                            alignItems: 'center',
                        },
                    },
                }}
                onClick={() => setAnchorEl(null)} // Dismiss on click
            >
                <Box sx={{ padding: 2 }}>
                    <img
                        src="/ezplay.png"
                        alt="Jukebox Logo"
                        onClick={() => setAnchorEl(null)} // Dismiss on click
                        style={{
                            height: '90vh', // Makes the image fill the viewport height
                            width: 'auto', // Maintains aspect ratio
                            maxWidth: '90vw', // Prevents overflow on wider screens
                            objectFit: 'contain', // Ensures the entire image fits within the screen
                            cursor: 'pointer',
                        }}
                    />
                </Box>
            </Popover>
        </Box>
    );
}

export function JukeboxFullScreen() {
    const [anchorEl, setAnchorEl] = useState<HTMLElement | null>(null);
    const theme = useTheme();

    const timeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null); // Store timeout reference

    const resetScreensaver = () => {
        if (timeoutRef.current) {
            clearTimeout(timeoutRef.current); // Clear any existing timeout
        }
        timeoutRef.current = setTimeout(() => {
            setAnchorEl(document.body); // Show screensaver
        }, 30000);
    };

    useEffect(() => {
        resetScreensaver(); // Set up the initial timeout when screen loads

        return () => {
            if (timeoutRef.current) {
                clearTimeout(timeoutRef.current); // Cleanup on unmount
            }
            timeoutRef.current = null;
        };
    }); // Reset timeout when song changes

    return (
        <Box
            sx={{
                position: 'fixed', // Ensures no extra height
                top: 0,
                left: 0,
                width: '100vw',
                height: '100vh',
                display: 'flex',
                flexDirection: 'column',
                justifyContent: 'center',
                alignItems: 'center',
                backgroundColor: theme.palette.background.paper,
                color: theme.palette.divider,
                textAlign: 'center',
                overflow: 'hidden', // Extra safety against unwanted scrollbars
                padding: theme.spacing(2), // Use theme spacing for consistency
                boxSizing: 'border-box', // Ensures padding doesn't affect width/height
            }}
        >
            <JukeboxArea onInteract={resetScreensaver} />

            {/* Popover Logo (Screensaver) */}
            <Popover
                open={Boolean(anchorEl)}
                anchorEl={document.body}
                onClose={() => setAnchorEl(null)}
                anchorOrigin={{
                    vertical: 'top',
                    horizontal: 'left',
                }}
                transformOrigin={{
                    vertical: 'top',
                    horizontal: 'left',
                }}
                slotProps={{
                    paper: {
                        sx: {
                            width: '100vw',
                            height: '100vh',
                            display: 'flex',
                            justifyContent: 'center',
                            alignItems: 'center',
                        },
                    },
                }}
                onClick={() => setAnchorEl(null)} // Dismiss on click
            >
                <Box sx={{ padding: 2 }}>
                    <img
                        src="/ezplay.png"
                        alt="Jukebox Logo"
                        onClick={() => setAnchorEl(null)} // Dismiss on click
                        style={{
                            height: '90vh', // Makes the image fill the viewport height
                            width: 'auto', // Maintains aspect ratio
                            maxWidth: '90vw', // Prevents overflow on wider screens
                            objectFit: 'contain', // Ensures the entire image fits within the screen
                            cursor: 'pointer',
                        }}
                    />
                </Box>
            </Popover>
        </Box>
    );
}

export function JukeboxScreen({ title, statusArea }: { title: string; statusArea: React.ReactNode[] }) {
    const theme = useTheme();
    const isMobile = useMediaQuery(theme.breakpoints.down('sm'));
    const dispatch = useDispatch<AppDispatch>();
    const sequenceData = useSelector((state: RootState) => state.sequences.sequenceData) as SequenceItem[] | undefined;
    const [searchQuery, setSearchQuery] = useState('');
    const [sortBy, setSortBy] = useState('artist');
    const [selectedPlaylist, setSelectedPlaylist] = useState('all');
    const [selectedFilterTags, setSelectedFilterTags] = useState<string[]>([]);
    const [tagInputValue, setTagInputValue] = useState('');

    // Get available tags from the Redux store
    const availableTags = useSelector((state: RootState) => state.sequences.tags || []);

    const playlists = useSelector((state: RootState) =>
        state.playlists.playlists.map((playlist: PlaylistRecord) => ({
            id: playlist.id,
            name: playlist.title,
        })),
    );

    // Get the playlist items (song IDs) for the selected playlist
    const playlistItems = useSelector((state: RootState) =>
        selectedPlaylist !== 'all'
            ? state.playlists.playlists.find((p: PlaylistRecord) => p.id === selectedPlaylist)?.items || []
            : [],
    );

    // Transform sequenceData into songs, filtering by playlist if needed
    const songs = useMemo(() => {
        const allSongs =
            sequenceData?.map(
                (song: SequenceItem): Song => ({
                    isMusical: song.work?.music_url ? true : false,
                    title: song.work?.title || '',
                    artist: song.work?.artist || '',
                    urlPart: song.files?.fseq || '',
                    id: song.id,
                    artwork: song.work?.artwork,
                    localImagePath: song.files?.thumb,
                    vendor: song.sequence?.vendor || '',
                }),
            ) || [];

        if (selectedPlaylist === 'all') {
            return allSongs;
        }

        // Filter songs to only those in the selected playlist
        const playlistSongIds = new Set(playlistItems.map((item: PlaylistItem) => item.id));
        return allSongs.filter((song) => playlistSongIds.has(song.id));
    }, [sequenceData, selectedPlaylist, playlistItems]);

    // Filter and sort songs
    const filteredAndSortedSongs = useMemo(() => {
        return songs
            .filter((song) => {
                // Text search filter for title/artist
                const matchesSearch =
                    song.title.toLowerCase().includes(searchQuery.toLowerCase()) ||
                    song.artist.toLowerCase().includes(searchQuery.toLowerCase());

                // Tag filter - if no tags selected and no input, show all songs
                let matchesTags = true;

                if (selectedFilterTags.length > 0) {
                    // If tags are selected, check if song has any of those tags
                    const songTags = sequenceData?.find((s) => s.id === song.id)?.settings?.tags || [];
                    matchesTags = selectedFilterTags.some((tag) => songTags.includes(tag));
                } else if (tagInputValue) {
                    // If no tags selected but there's input text, filter by that text
                    const songTags = sequenceData?.find((s) => s.id === song.id)?.settings?.tags || [];
                    matchesTags =
                        songTags?.some((tag) => tag.toLowerCase().includes(tagInputValue.toLowerCase())) || false;
                }

                return matchesSearch && matchesTags;
            })
            .sort((a, b) => {
                switch (sortBy) {
                    case 'artist':
                        return a.artist.localeCompare(b.artist);
                    case 'title':
                        return a.title.localeCompare(b.title);
                    default:
                        return 0;
                }
            });
    }, [songs, searchQuery, sortBy, selectedFilterTags, tagInputValue, sequenceData]);

    const handlePlay = async (songId: string) => {
        await dispatch(
            callImmediateCommand({
                command: 'playsong',
                songId,
                immediate: true,
                priority: 5,
                requestId: uuidv4(),
            }),
        ).unwrap();
    };

    const handleQueue = async (songId: string) => {
        await dispatch(
            callImmediateCommand({
                command: 'playsong',
                songId,
                immediate: false,
                priority: 5,
                requestId: uuidv4(),
            }),
        ).unwrap();
    };

    const sortOptions = [
        { value: 'artist', label: 'Artist' },
        { value: 'title', label: 'Title' },
    ];

    return (
        <Box
            sx={{
                height: '100vh',
                display: 'flex',
                flexDirection: 'column',
                overflow: 'hidden',
            }}
        >
            <Box sx={{ padding: 2, flexShrink: 0 }}>
                <PageHeader heading={title} children={statusArea} />
            </Box>
            <Box
                sx={{
                    flexGrow: 1,
                    padding: isMobile ? 1 : 2,
                    overflow: 'auto',
                }}
            >
                {/* Playback Queue Card */}
                <QueueAndControlStack />

                {/* Search and Sort Controls */}
                <Box
                    sx={{
                        mb: 3,
                        display: 'flex',
                        gap: '16px',
                        alignItems: 'center',
                        flexWrap: { xs: 'wrap', md: 'nowrap' },
                        '& .MuiFormControl-root': {
                            margin: 0,
                            width: '100%',
                        },
                        '& .MuiOutlinedInput-root': {
                            margin: 0,
                        },
                    }}
                >
                    <Box
                        sx={{
                            width: { xs: '100%', md: '220px' },
                            margin: '0 !important',
                        }}
                    >
                        <PlaylistDropdown
                            value={selectedPlaylist}
                            onChange={setSelectedPlaylist}
                            playlists={playlists}
                            label="Filter by Playlist"
                        />
                    </Box>
                    <Box
                        sx={{
                            width: { xs: '100%', md: '220px' },
                            margin: '0 !important',
                        }}
                    >
                        <Autocomplete
                            multiple
                            size="small"
                            options={availableTags}
                            value={selectedFilterTags}
                            inputValue={tagInputValue}
                            onInputChange={(_, newInputValue) => {
                                setTagInputValue(newInputValue);
                            }}
                            onChange={(_, newValue) => {
                                setSelectedFilterTags(newValue);
                                if (newValue.length > 0) {
                                    setTagInputValue('');
                                }
                            }}
                            renderInput={(params) => (
                                <TextField
                                    {...params}
                                    placeholder="Filter by tags"
                                    sx={{
                                        '& .MuiInputBase-root': {
                                            padding: '2px 8px',
                                        },
                                    }}
                                />
                            )}
                        />
                    </Box>
                    <Box
                        sx={{
                            width: { xs: '100%', md: '220px' },
                            margin: '0 !important',
                        }}
                    >
                        <SearchBar
                            value={searchQuery}
                            onChange={setSearchQuery}
                            placeholder="Search by name or artist"
                        />
                    </Box>
                    <Box
                        sx={{
                            width: { xs: '100%', md: '220px' },
                            margin: '0 !important',
                        }}
                    >
                        <SortDropdown value={sortBy} onChange={setSortBy} options={sortOptions} label="Sort by" />
                    </Box>
                </Box>

                {/* Songs Grid */}
                <Box
                    sx={{
                        display: 'grid',
                        gridTemplateColumns: {
                            xs: '1fr',
                            sm: 'repeat(2, 1fr)',
                            md: 'repeat(3, 1fr)',
                            lg: 'repeat(4, 1fr)',
                            xl: 'repeat(5, 1fr)',
                        },
                        gap: 2,
                    }}
                >
                    {filteredAndSortedSongs.map((song: Song, index: number) => {
                        // Create buttons configuration for this song
                        const songButtons = [
                            {
                                label: 'Play',
                                action: handlePlay,
                                variant: 'contained' as const,
                                color: 'primary' as const,
                                isDisabled: (id: string) => {
                                    // Example: Disable play button if song is currently playing
                                    return false; // Implement your logic here
                                },
                            },
                            {
                                label: 'Queue',
                                action: handleQueue,
                                variant: 'outlined' as const,
                                color: 'primary' as const,
                                isDisabled: (id: string) => {
                                    // Example: Disable queue button if song is already queued
                                    return false; // Implement your logic here
                                },
                            },
                            /*
                            {
                                label: 'Vote',
                                action: (id: string) => {
                                    // Implement vote functionality with id
                                    console.log('Vote for song:', id);
                                },
                                variant: 'outlined' as const,
                                color: 'primary' as const,
                                isDisabled: (id: string) => {
                                    // Example: Disable vote button for songs that were recently played
                                    return false; // Implement your logic here
                                },
                            },
                            */
                        ];

                        return (
                            <SongCard
                                key={`${song.id}-${index}`}
                                id={song.id}
                                title={song.title}
                                artist={song.artist}
                                artwork={song.artwork}
                                localImagePath={song.localImagePath}
                                buttons={songButtons}
                            />
                        );
                    })}
                </Box>
            </Box>
        </Box>
    );
}
