import { useEffect, useState } from 'react';
import { useSelector } from 'react-redux';

import { Button, Card, PageHeader, TextField, Typography } from '@ezplayer/shared-ui-components';

import type { SequenceSettings } from '@ezplayer/ezplayer-core';
import { RootState } from '../..';

import {
    Autocomplete,
    Box,
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

import AddIcon from '@mui/icons-material/Add';
import DeleteIcon from '@mui/icons-material/Delete';
import EditIcon from '@mui/icons-material/Edit';
import ShoppingBagIcon from '@mui/icons-material/ShoppingBag';

import { AddSongProps } from './AddSongDialogBrowser';
import { DeleteSongDialog } from './DeleteSongDialog';
import { EditSongDetailsDialog } from './EditSongDetailsDialog';

export interface SongListProps {
    title: string;
    storeUrl?: string;
    AddSongDialog?: React.ComponentType<AddSongProps>;
    statusArea: React.ReactNode[];
}

interface SongListRow {
    tags: any;
    id: string;
    title: string;
    artist: string;
    vendor: string;
    length: string;
    settings?: SequenceSettings;
    isDeletableSong: boolean;
}

type SongTableColumn = {
    field: string;
    headerName: string;
    flex?: number;
    minWidth?: number;
    renderCell?: (params: { row: SongListRow; value: any }) => React.ReactNode;
    sortable?: boolean;
    renderHeader?: () => React.ReactNode;
};

type SongTableProps = {
    rows: SongListRow[];
    columns: SongTableColumn[];
    onRowDoubleClick?: (params: { row: SongListRow }) => void;
    getRowId?: (row: SongListRow) => string | number;
};

function SongTable({ rows, columns, onRowDoubleClick, getRowId }: SongTableProps) {
    const theme = useTheme();
    const [sortState, setSortState] = useState<{ field: string; direction: 'asc' | 'desc' } | null>(null);

    const resolveRowId = (row: SongListRow) => {
        if (getRowId) return getRowId(row);
        return row.id;
    };

    const handleSort = (col: SongTableColumn) => {
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
            return direction === 'asc'
                ? String(av).localeCompare(String(bv))
                : String(bv).localeCompare(String(av));
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
                                        <TableSortLabel active={isActive} direction={direction} hideSortIcon={!isActive}>
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

export function SongList({ title, storeUrl, AddSongDialog, statusArea }: SongListProps) {
    const [openAddDialog, setOpenAddDialog] = useState(false);
    const [openEditDialog, setOpenEditDialog] = useState(false);
    const [rows, setRows] = useState<SongListRow[]>([]);
    const [selectedSongId, setSelectedSongId] = useState<string | null>(null);
    const [searchQuery, setSearchQuery] = useState('');
    const [filterTags, setFilterTags] = useState<string[]>([]);
    const [tagInputValue, setTagInputValue] = useState('');

    const sequenceData = useSelector((state: RootState) => state.sequences.sequenceData);
    const availableTags = useSelector((state: RootState) => state.sequences.tags || []);

    // Add state for managing delete confirmation dialog
    const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
    const [songIdToDelete, setSongIdToDelete] = useState<string | null>(null);

    /**
     * Handles the click event for adding a new song
     */
    const handleAddClick = () => {
        setOpenAddDialog(true);
    };

    const handleClose = () => {
        setOpenAddDialog(false);
        setOpenEditDialog(false);
    };

    // Replace the direct handleDeleteSong function with this
    const handleDeleteClick = (songId: string) => {
        setSongIdToDelete(songId);
        setDeleteDialogOpen(true);
    };

    // Add function to close the delete dialog
    const handleCloseDeleteDialog = () => {
        setDeleteDialogOpen(false);
        setSongIdToDelete(null);
    };

    // Modify the useEffect that creates the rows data to combine local and server songs
    useEffect(() => {
        // Create nonnull array of server and local songs
        const allSongs = sequenceData || [];

        if (!allSongs.length) {
            setRows([]);
            return;
        }

        const songsRows = allSongs
            .map((song) => {
                // Check if this is a local song / can be deleted
                const isLocalSong = true; // TODO CRAZ song.localSongs.some(localSong => localSong.id === song.id);

                // Ensure song has a valid ID
                if (!song.id) {
                    console.warn('Song missing ID:', song);
                    return null; // Skip songs without ID
                }

                const artist = (song?.work?.artist || 'Unknown Artist') + `${song?.sequence?.vendor ? '(' + song.sequence.vendor + ')' : ''}`;

                return {
                    id: song.id,
                    title: song?.work?.title || 'Untitled',
                    artist,
                    tags: song?.settings?.tags || [],
                    length: formatDuration(song?.work?.length || 0),
                    settings: song?.settings || {},
                    isDeletableSong: isLocalSong, // Flag to determine if we can delete it
                };
            })
            .filter(Boolean) as SongListRow[]; // Filter out null entries

        // Apply existing filtering logic
        let filteredRows = songsRows;

        // Apply search query filter
        if (searchQuery !== '') {
            filteredRows = filteredRows.filter(
                (song) =>
                    song.title.toLowerCase().includes(searchQuery.toLowerCase()) ||
                    song.artist.toLowerCase().includes(searchQuery.toLowerCase()),
            );
        }

        // Apply tag filters
        if (filterTags.length > 0 || tagInputValue) {
            filteredRows = filteredRows.filter((song) => {
                // If no tags on the song, it can't match
                if (!song.tags?.length) return false;

                // Handle selected tags
                const selectedTagsMatch = filterTags.length === 0 || filterTags.some((tag) => song.tags?.includes(tag));

                // Handle tag input text (partial matches)
                const tagTextMatch =
                    !tagInputValue ||
                    song.tags?.some((tag: string) => tag.toLowerCase().includes(tagInputValue.toLowerCase()));

                return selectedTagsMatch && tagTextMatch;
            });
        }

        setRows(filteredRows);
    }, [sequenceData, searchQuery, filterTags, tagInputValue]);

    const formatDuration = (durationInSeconds: number) => {
        const minutes = Math.floor(durationInSeconds / 60);
        const seconds = durationInSeconds % 60;
        const milliseconds = (seconds % 1).toFixed(3).slice(1); // Get 3 decimal places and remove the leading 0
        return `${minutes}:${seconds < 10 ? '0' : ''}${Math.floor(seconds)}${milliseconds}`;
    };

    const handleSongSetupClick = (row: SongListRow) => {
        setSelectedSongId(row?.id);
        setOpenEditDialog(true);
    };

    const handleSearchChange = (value: string) => {
        setSearchQuery(value); // Update search query state
    };

    // Add this type if not already present
    interface RowParams {
        row: SongListRow;
    }

    const RowWrapper = ({ children }: { children: React.ReactNode }) => (
        <Box
            sx={{
                width: '100%',
                height: '100%',
                cursor: 'pointer',
                userSelect: 'none',
                display: 'flex',
                alignItems: 'center',
            }}
        >
            {children}
        </Box>
    );

    /**
     * Returns the columns for the table based on the current path.
     */
    const columns: SongTableColumn[] = [
        {
            field: 'title',
            headerName: 'SONGS',
            flex: 2,
            minWidth: 170,
            renderHeader: () => <Typography fontWeight="bold">SONGS</Typography>,
            renderCell: (params: RowParams) => <RowWrapper>{params.row.title}</RowWrapper>,
        },
        {
            field: 'artist',
            headerName: 'ARTIST',
            flex: 2,
            minWidth: 150,
            renderHeader: () => <Typography fontWeight="bold">ARTIST</Typography>,
            renderCell: (params: RowParams) => <RowWrapper>{params.row.artist}</RowWrapper>,
        },
        {
            field: 'tags',
            headerName: 'TAGS',
            flex: 0.8,
            minWidth: 150,
            renderHeader: () => <Typography fontWeight="bold">TAGS</Typography>,
            renderCell: (params: any) => (
                <RowWrapper>
                    <Box sx={{ display: 'flex', gap: 0.5, flexWrap: 'wrap' }}>
                        {params.value && params.value.length > 0
                            ? params.value.map((tag: string, index: number) => (
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
            field: 'length',
            headerName: 'DURATION',
            flex: 0.8,
            minWidth: 100,
            renderHeader: () => <Typography fontWeight="bold">DURATION</Typography>,
            renderCell: (params: RowParams) => <RowWrapper>{params.row.length}</RowWrapper>,
        },
        {
            field: 'actions',
            headerName: '',
            flex: 0.8,
            minWidth: 120,
            renderCell: (params: any) => {
                return (
                    <Box
                        sx={{
                            display: 'flex',
                            gap: 1,
                            minWidth: '100%',
                            justifyContent: 'flex-end',
                            '@media (max-width: 600px)': {
                                flexDirection: 'column',
                                alignItems: 'flex-end',
                                gap: 0.5,
                            },
                        }}
                    >
                        <Button
                            aria-label="edit"
                            icon={<EditIcon />}
                            size="small"
                            onClick={() => handleSongSetupClick(params.row)}
                            sx={{ minWidth: 'auto' }}
                        />
                        {params.row.isDeletableSong && (
                            <Button
                                aria-label="delete"
                                icon={<DeleteIcon />}
                                size="small"
                                color="error"
                                onClick={() => handleDeleteClick(params.row.id)}
                                sx={{ minWidth: 'auto' }}
                            />
                        )}
                    </Box>
                );
            },
        },
    ];

    return (
        <Box
            sx={{
                height: '100vh',
                display: 'flex',
                flexDirection: 'column',
                overflow: 'hidden', // Prevent outer scrolling
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
                        minWidth: 'fit-content', // Ensure controls have enough space
                    }}
                >
                    <Box sx={{ display: 'flex', gap: 2, flex: 1 }}>
                        <TextField
                            size={'small'}
                            id="outlined-search"
                            label={`Search By Song Title/Artist`}
                            type="search"
                            onChange={(e) => handleSearchChange(e.target.value)}
                        />
                        <Autocomplete
                            multiple
                            size="small"
                            options={availableTags}
                            value={filterTags}
                            inputValue={tagInputValue}
                            onInputChange={(_, newInputValue) => {
                                setTagInputValue(newInputValue);
                            }}
                            onChange={(_, newValue) => setFilterTags(newValue)}
                            renderInput={(params) => <TextField {...params} label="Filter by Tags" />}
                            sx={{ minWidth: 200 }}
                        />
                    </Box>

                    {storeUrl && (
                        <Button
                            size={'small'}
                            sx={{ pt: 1, pb: 1 }}
                            className="letter-spacing"
                            variant={'contained'}
                            href={storeUrl}
                            rel="noopener noreferrer"
                            component="a"
                            btnText="Add Song"
                            startIcon={<ShoppingBagIcon />}
                        />
                    )}
                    {AddSongDialog && (
                        <Button
                            size={'small'}
                            sx={{ pt: 1, pb: 1 }}
                            className="letter-spacing"
                            variant={'contained'}
                            onClick={handleAddClick}
                            btnText="Add Song"
                            icon={<AddIcon />}
                        />
                    )}
                </Box>

                <Box
                    sx={{
                        flex: 1,
                        overflow: 'auto',
                        padding: 2,
                    }}
                >
                    <SongTable
                        rows={rows}
                        columns={columns}
                        getRowId={(row: SongListRow) => row.id}
                        onRowDoubleClick={(params) => handleSongSetupClick(params.row)}
                    />
                </Box>
            </Card>

            {AddSongDialog && <AddSongDialog open={openAddDialog} onClose={handleClose} title="Add New Song" />}

            <EditSongDetailsDialog
                open={openEditDialog}
                onClose={handleClose}
                title="Edit Song Details"
                selectedSongId={selectedSongId}
            />

            <DeleteSongDialog
                open={deleteDialogOpen}
                onClose={handleCloseDeleteDialog}
                title="Confirm Delete Song"
                songIdToDelete={songIdToDelete}
            />
        </Box>
    );
}

export default SongList;
