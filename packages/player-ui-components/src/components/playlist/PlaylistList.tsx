import { getPlaylistDurationMS, PlaylistRecord } from '@ezplayer/ezplayer-core';
import {
    Autocomplete,
    Button,
    Card,
    PageHeader,
    SimpleDialog,
    TextField,
    ToastMsgs,
    Typography,
} from '@ezplayer/shared-ui-components';
import ContentCopyIcon from '@mui/icons-material/ContentCopy';
import DeleteIcon from '@mui/icons-material/Delete';
import EditIcon from '@mui/icons-material/Edit';
import Divider from '@mui/material/Divider';
import { Box } from '../box/Box';
import {
    alpha,
    useTheme,
    Table,
    TableBody,
    TableCell,
    TableContainer,
    TableHead,
    TableRow,
    Paper,
    TableSortLabel,
} from '@mui/material';
import { useEffect, useState } from 'react';
import { useDispatch, useSelector } from 'react-redux';
import { useNavigate } from 'react-router-dom';
import { v4 as uuidv4 } from 'uuid';
import { AppDispatch, postPlaylistData, RootState, Routes as ROUTES } from '../..';
interface PlaylistRow {
    id: string;
    title: string;
    tags: string;
    items: number;
}

export interface PlaylistListProps {
    title: string;
    statusArea: React.ReactNode[];
}

type PlaylistTableColumn = {
    field: string;
    headerName: string;
    flex?: number;
    minWidth?: number;
    renderCell?: (params: { row: PlaylistRow; value: any }) => React.ReactNode;
    sortable?: boolean;
    renderHeader?: () => React.ReactNode;
};

type PlaylistTableProps = {
    rows: PlaylistRow[];
    columns: PlaylistTableColumn[];
    onRowDoubleClick?: (params: { row: PlaylistRow }) => void;
    getRowId?: (row: PlaylistRow) => string | number;
};

function PlaylistTable({ rows, columns, onRowDoubleClick, getRowId }: PlaylistTableProps) {
    const theme = useTheme();
    const [sortState, setSortState] = useState<{ field: string; direction: 'asc' | 'desc' } | null>(null);

    const resolveRowId = (row: PlaylistRow) => {
        if (getRowId) return getRowId(row);
        return row.id;
    };

    const handleSort = (col: PlaylistTableColumn) => {
        if (col.sortable === false) return;
        setSortState((prev) => {
            if (!prev || prev.field !== col.field) return { field: col.field, direction: 'asc' };
            if (prev.direction === 'asc') return { field: col.field, direction: 'desc' };
            return null;
        });
    };

    const sortedRows = (() => {
        if (!sortState) return rows;
        const { field, direction } = sortState;
        const copy = [...rows];
        copy.sort((a, b) => {
            const av = (a as any)?.[field];
            const bv = (b as any)?.[field];
            if (av === bv) return 0;
            if (av === undefined || av === null) return 1;
            if (bv === undefined || bv === null) return -1;
            if (typeof av === 'number' && typeof bv === 'number') return direction === 'asc' ? av - bv : bv - av;
            return direction === 'asc' ? String(av).localeCompare(String(bv)) : String(bv).localeCompare(String(av));
        });
        return copy;
    })();

    return (
        <TableContainer component={Paper} sx={{ width: '100%', overflow: 'auto' }}>
            <Table size="small" stickyHeader>
                <TableHead>
                    <TableRow>
                        {columns.map((col) => {
                            const isActive = sortState?.field === col.field;
                            const direction = isActive ? sortState?.direction : 'asc';
                            const headerContent = col.renderHeader ? col.renderHeader() : col.headerName;
                            return (
                                <TableCell
                                    key={col.field}
                                    padding="normal"
                                    onClick={() => handleSort(col)}
                                    sortDirection={isActive ? direction : false}
                                    sx={{
                                        minWidth: col.minWidth ?? 120,
                                        width: col.flex ? `${col.flex * 100}px` : 'auto',
                                        cursor: col.sortable === false ? 'default' : 'pointer',
                                        userSelect: 'none',
                                        fontWeight: 'bold',
                                        backgroundColor: alpha(theme.palette.action.disabledBackground, 0.2),
                                    }}
                                >
                                    {col.sortable === false ? (
                                        <Typography variant="body2" fontWeight="bold" noWrap>
                                            {headerContent}
                                        </Typography>
                                    ) : (
                                        <TableSortLabel
                                            active={isActive}
                                            direction={direction}
                                            hideSortIcon={!isActive}
                                        >
                                            <Typography variant="body2" fontWeight="bold" noWrap>
                                                {headerContent}
                                            </Typography>
                                        </TableSortLabel>
                                    )}
                                </TableCell>
                            );
                        })}
                    </TableRow>
                </TableHead>
                <TableBody>
                    {sortedRows.map((row) => {
                        const rowId = resolveRowId(row);
                        return (
                            <TableRow
                                key={rowId}
                                hover
                                sx={{
                                    cursor: onRowDoubleClick ? 'pointer' : 'default',
                                }}
                                onDoubleClick={() => onRowDoubleClick?.({ row })}
                            >
                                {columns.map((col) => {
                                    const value = (row as any)?.[col.field];
                                    return (
                                        <TableCell
                                            key={`${rowId}-${col.field}`}
                                            padding="normal"
                                            sx={{
                                                minWidth: col.minWidth ?? 120,
                                                width: col.flex ? `${col.flex * 100}px` : 'auto',
                                                maxWidth: col.minWidth ?? undefined,
                                                overflow: 'hidden',
                                                textOverflow: 'ellipsis',
                                                whiteSpace: 'nowrap',
                                            }}
                                        >
                                            {col.renderCell ? (
                                                col.renderCell({ row, value })
                                            ) : (
                                                <Typography variant="body2" noWrap>
                                                    {value}
                                                </Typography>
                                            )}
                                        </TableCell>
                                    );
                                })}
                            </TableRow>
                        );
                    })}
                </TableBody>
            </Table>
        </TableContainer>
    );
}

export function PlaylistList({ title, statusArea }: PlaylistListProps) {
    const [openDialog, setOpenDialog] = useState(false);
    const [selectedPlaylistId, setSelectedPlaylistId] = useState<string | null>(null);
    const [rows, setRows] = useState<PlaylistRow[]>([]);
    const [searchQuery, setSearchQuery] = useState('');
    const [selectedFilterTags, setSelectedFilterTags] = useState<string[]>([]);
    const [tagInputValue, setTagInputValue] = useState('');

    const navigate = useNavigate();
    const dispatch = useDispatch<AppDispatch>();
    const playlistRecords = useSelector((s: RootState) => s.playlists.playlists);
    const sequenceData = useSelector((state: RootState) => state.sequences.sequenceData);
    const availableTags = useSelector((state: RootState) => state.playlists.tags || []);

    const deletePlaylist = async (id: string) => {
        const item = playlistRecords.find((e) => e.id == id);
        if (!item) return;
        await dispatch(postPlaylistData([{ ...item, deleted: true }])).unwrap();
    };

    const clonePlaylist = async (id: string) => {
        const originalPlaylist = playlistRecords.find((e) => e.id === id);
        if (!originalPlaylist) return;

        try {
            // Find the next available number for cloning
            const baseTitle = originalPlaylist.title;
            let cloneNumber = 1;
            let newTitle = `${baseTitle}-${cloneNumber}`;

            // Check if a playlist with this name already exists
            while (playlistRecords.some((playlist) => playlist.title === newTitle)) {
                cloneNumber++;
                newTitle = `${baseTitle}-${cloneNumber}`;
            }

            // Create a new playlist with sequential numbering
            const clonedPlaylist: PlaylistRecord = {
                ...originalPlaylist,
                id: uuidv4(), // Generate new ID
                title: newTitle,
                createdAt: Date.now(),
                updatedAt: Date.now(),
            };

            await dispatch(postPlaylistData([clonedPlaylist])).unwrap();

            ToastMsgs.showSuccessMessage('Playlist cloned successfully', {
                theme: 'colored',
                position: 'bottom-right',
                autoClose: 2000,
            });
        } catch (error) {
            console.error('Error cloning playlist:', error);
            ToastMsgs.showErrorMessage('Failed to clone playlist', {
                theme: 'colored',
                position: 'bottom-right',
                autoClose: 2000,
            });
        }
    };

    const toPascalCase = (tags: string[]) => {
        return tags.map((tag) => tag.charAt(0).toUpperCase() + tag.slice(1).toLowerCase()).join(',');
    };

    const handleConfirmDelete = async () => {
        if (!selectedPlaylistId) return;

        try {
            await deletePlaylist(selectedPlaylistId);

            ToastMsgs.showSuccessMessage('Playlist deleted successfully', {
                theme: 'colored',
                position: 'bottom-right',
                autoClose: 2000,
            });

            setOpenDialog(false);
        } catch (error) {
            console.error('Error deleting playlist:', error);
            setOpenDialog(false);
            ToastMsgs.showErrorMessage('Failed to delete playlist', {
                theme: 'colored',
                position: 'bottom-right',
                autoClose: 2000,
            });
        }
    };

    const handleEditPlaylistClick = (playlistId: PlaylistRow) => {
        // Navigate to create-edit-playlist with the playlist ID
        navigate(`${ROUTES.CREATE_EDIT_PLAYLIST}/${playlistId}`);
    };

    const formatDuration = (seconds: number): string => {
        const totalSeconds = Math.round(seconds);
        const hours = Math.floor(totalSeconds / 3600);
        const minutes = Math.floor((totalSeconds % 3600) / 60);
        const remainingSeconds = totalSeconds % 60;

        if (hours > 0) {
            return `${hours}h ${minutes}m ${remainingSeconds}s`;
        }
        return `${minutes}m ${remainingSeconds}s`;
    };

    const RowWrapper = ({ row, children }: { row: PlaylistRow; children: React.ReactNode }) => {
        return (
            <Box
                sx={{
                    width: '100%',
                    cursor: 'pointer',
                    userSelect: 'none',
                }}
                onDoubleClick={() => navigate(`${ROUTES.CREATE_EDIT_PLAYLIST}/${row.id}`)}
            >
                {children}
            </Box>
        );
    };

    const columns: PlaylistTableColumn[] = [
        {
            field: 'title',
            headerName: 'PLAYLIST',
            flex: 1,
            minWidth: 200,
            renderCell: (params: any) => <RowWrapper row={params.row}>{params.row.title}</RowWrapper>,
        },
        {
            field: 'tags',
            headerName: 'TAGS',
            flex: 1,
            minWidth: 150,
            renderCell: (params: any) => (
                <RowWrapper row={params.row}>
                    <Box sx={{ display: 'flex', gap: 0.5, flexWrap: 'wrap' }}>
                        {params.value && params.value.length > 0
                            ? params.value.split(',').map((tag: string, index: number) => (
                                  <Typography
                                      key={`${params.row.id}-tag-${index}-${tag}`}
                                      variant="body2"
                                      sx={{
                                          backgroundColor: 'primary.light',
                                          color: 'primary.contrastText',
                                          padding: '2px 8px',
                                          borderRadius: '12px',
                                          fontSize: '0.75rem',
                                          fontWeight: 500,
                                      }}
                                  >
                                      {tag}
                                  </Typography>
                              ))
                            : null}
                    </Box>
                </RowWrapper>
            ),
        },
        {
            field: 'duration',
            headerName: 'DURATION',
            flex: 0.4,
            minWidth: 80,
            renderCell: (params: any) => <RowWrapper row={params.row}>{params.row.duration}</RowWrapper>,
        },
        {
            field: 'items',
            headerName: 'SONGS COUNT',
            flex: 0.4,
            minWidth: 80,
            renderCell: (params: any) => <RowWrapper row={params.row}>{params.row.items}</RowWrapper>,
        },
        {
            field: 'actions',
            headerName: '',
            flex: 0.7,
            minWidth: 150,
            renderCell: (params: any) => (
                <Box sx={{ display: 'flex', justifyContent: 'space-between', gap: 1 }}>
                    <Button
                        aria-label="edit"
                        icon={<EditIcon />}
                        onClick={() => handleEditPlaylistClick(params.row.id)}
                        size="small"
                    />
                    <Button
                        aria-label="clone"
                        icon={<ContentCopyIcon />}
                        onClick={() => clonePlaylist(params.row.id)}
                        size="small"
                        color="primary"
                    />
                    <Button
                        aria-label="delete"
                        icon={<DeleteIcon />}
                        color="error"
                        onClick={() => handleDeleteClick(params.row.id)}
                        size="small"
                    />
                </Box>
            ),
        },
    ];

    const handleSearchChange = (value: string) => {
        setSearchQuery(value);
    };
    const handleCreatePlaylistClick = () => {
        navigate(`${ROUTES.CREATE_EDIT_PLAYLIST}/-1`); // Navigate to create-edit-playlist with -1 as param
    };

    useEffect(() => {
        const calculatePlaylistDuration = (playlist: PlaylistRecord): number => {
            if (!playlist?.items) return 0;

            return getPlaylistDurationMS(sequenceData ?? [], playlist, []).totalMS / 1000;
        };

        const getPlaylists = async () => {
            const playlistsRows = playlistRecords.map((playlist: PlaylistRecord) => ({
                id: playlist.id,
                title: playlist.title,
                tags: toPascalCase(playlist.tags),
                duration: formatDuration(calculatePlaylistDuration(playlist)),
                items: playlist.items.length,
            }));

            // Filter by both title and tags
            const filteredRows = playlistsRows.filter((playlist) => {
                const matchesTitle = playlist.title.toLowerCase().includes(searchQuery.toLowerCase());

                // Tag filtering logic
                let matchesTags = true;
                if (selectedFilterTags.length > 0) {
                    // Check if playlist has ANY of the selected tags
                    matchesTags = selectedFilterTags.some((filterTag) =>
                        playlist.tags.toLowerCase().includes(filterTag.toLowerCase()),
                    );
                } else if (tagInputValue) {
                    // If there's tag input text but no selected tags, search for partial matches
                    matchesTags = playlist.tags.toLowerCase().includes(tagInputValue.toLowerCase());
                }

                return matchesTitle && matchesTags;
            });

            setRows(filteredRows);
        };
        getPlaylists();
    }, [searchQuery, selectedFilterTags, tagInputValue, playlistRecords, sequenceData]);

    const handleClose = () => {
        setOpenDialog(false);
        setSelectedPlaylistId(null);
    };

    const handleDeleteClick = (playlistId: string) => {
        setSelectedPlaylistId(playlistId);
        setOpenDialog(true);
    };

    const dialogContent = (
        <Box
            sx={{
                display: 'flex',
                flexDirection: 'column',
                justifyContent: 'center',
            }}
        >
            <Typography>{`Are you sure you want to delete this playlist?`}</Typography>
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
                ></Button>
                <Button
                    btnText={'Cancel'}
                    type="button"
                    variant="outlined"
                    color="secondary"
                    onClick={handleClose}
                ></Button>
            </Box>
        </Box>
    );

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

            <Card
                sx={{
                    marginX: 2,
                    flex: 1,
                    display: 'flex',
                    flexDirection: 'column',
                    overflow: 'hidden', // Prevent card scrolling
                }}
            >
                <Box
                    sx={{
                        padding: 2,
                        display: 'flex',
                        justifyContent: 'space-between',
                        gap: 2,
                        flexShrink: 0, // Keep search controls static
                    }}
                >
                    <Box sx={{ display: 'flex', gap: 2, flex: 1 }}>
                        <TextField
                            size={'small'}
                            id="outlined-search"
                            label={`Search By Playlist Title`}
                            type="search"
                            onChange={(e) => handleSearchChange(e.target.value)}
                        />
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
                            renderInput={(params) => <TextField {...params} placeholder="Filter by tags" />}
                            sx={{ minWidth: 250 }}
                        />
                    </Box>

                    <Button
                        size={'small'}
                        sx={{ pt: 1, pb: 1 }}
                        className="letter-spacing"
                        variant={'contained'}
                        onClick={handleCreatePlaylistClick}
                        btnText="Create Playlist"
                    />
                </Box>

                <Box
                    sx={{
                        flex: 1,
                        overflow: 'auto',
                        padding: 2,
                    }}
                >
                    <PlaylistTable rows={rows} columns={columns} getRowId={(row: PlaylistRow) => row.id} />
                </Box>
            </Card>
            <SimpleDialog
                open={openDialog}
                onClose={handleClose}
                model_title={
                    <>
                        <Typography variant="h5">Confirm Delete Playlist </Typography>
                        <Divider />
                    </>
                }
                model_content={<> {dialogContent}</>}
            />
        </Box>
    );
}
