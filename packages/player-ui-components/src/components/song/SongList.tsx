import { useEffect, useRef, useState } from 'react';
import { useDispatch, useSelector } from 'react-redux';
import { v4 as uuidv4 } from 'uuid';

import { PageHeader, TextField, ToastMsgs, isElectron } from '@ezplayer/shared-ui-components';

import type { BatchImportSummary, SequenceSettings } from '@ezplayer/ezplayer-core';
import { isSequencePlayable } from '@ezplayer/ezplayer-core';
import { AppDispatch, RootState } from '../..';
import {
    batchUploadImportShowSequences,
} from '../../store/slices/SequenceStore';
import { savePlayerSettings, setMediaFolder } from '../../store/slices/PlaybackSettingsStore';
import { callImmediateCommand } from '../../store/slices/RuntimeStore';

import {
    Autocomplete,
    alpha,
    Button,
    Card,
    CircularProgress,
    Menu,
    MenuItem,
    Typography,
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
import { Box } from '../box/Box';

import AddIcon from '@mui/icons-material/Add';
import DeleteIcon from '@mui/icons-material/Delete';
import EditIcon from '@mui/icons-material/Edit';
import LibraryAddIcon from '@mui/icons-material/LibraryAdd';
import PlayArrowIcon from '@mui/icons-material/PlayArrow';

import { AddSongProps } from './AddSongDialogBrowser';
import { BulkImportSummaryDialog } from './BulkImportSummaryDialog';
import { DeleteSongDialog } from './DeleteSongDialog';
import { EditSongDetailsDialog } from './EditSongDetailsDialog';

export interface SongListProps {
    title: string;
    AddSongDialog?: React.ComponentType<AddSongProps>;
    statusArea: React.ReactNode[];
    showPlayAction?: boolean;
    showEditAction?: boolean;
    showDeleteAction?: boolean;
    showAddSongButton?: boolean;
    /** Show Bulk Import (multi-file / folder). Electron uses native dialogs; LAN/web uploads then imports. */
    showBulkImportButton?: boolean;
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

export function SongList({
    title,
    AddSongDialog,
    statusArea,
    showPlayAction = true,
    showEditAction = true,
    showDeleteAction = true,
    showAddSongButton = true,
    showBulkImportButton = false,
}: SongListProps) {
    const dispatch = useDispatch<AppDispatch>();
    const [openAddDialog, setOpenAddDialog] = useState(false);
    const [openEditDialog, setOpenEditDialog] = useState(false);
    const [rows, setRows] = useState<SongListRow[]>([]);
    const [selectedSongId, setSelectedSongId] = useState<string | null>(null);
    const [searchQuery, setSearchQuery] = useState('');
    const [filterTags, setFilterTags] = useState<string[]>([]);
    const [tagInputValue, setTagInputValue] = useState('');
    const [bulkMenuAnchor, setBulkMenuAnchor] = useState<null | HTMLElement>(null);
    const [bulkImporting, setBulkImporting] = useState(false);
    const [bulkSummary, setBulkSummary] = useState<BatchImportSummary | null>(null);
    const [bulkSummaryOpen, setBulkSummaryOpen] = useState(false);
    const [choosingMediaFolder, setChoosingMediaFolder] = useState(false);
    /** LAN: companion audio names from the last selection (allowlist for retry). */
    const lanCompanionAudioRef = useRef<string[]>([]);

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

    const runBulkImport = async (runner: () => Promise<BatchImportSummary | undefined>) => {
        setBulkImporting(true);
        try {
            const summary = await runner();
            if (!summary) return; // user cancelled picker
            setBulkSummary(summary);
            setBulkSummaryOpen(true);
        } catch (error) {
            console.error('[BulkImport] failed:', error);
            setBulkSummary({
                total: 1,
                imported: 0,
                failed: 1,
                successes: [],
                failures: [
                    {
                        fseqPath: '',
                        fseqName: 'Bulk import',
                        reason: error instanceof Error ? error.message : 'Bulk import failed',
                    },
                ],
            });
            setBulkSummaryOpen(true);
        } finally {
            setBulkImporting(false);
        }
    };

    /** Close the MUI menu first, then open the native dialog. Opening a modal
     *  dialog while the menu is still tearing down often fails silently on Windows. */
    const startBulkImportAfterMenuClose = (runner: () => Promise<BatchImportSummary | undefined>) => {
        setBulkMenuAnchor(null);
        window.setTimeout(() => {
            void runBulkImport(runner);
        }, 100);
    };

    const collectFseqUploadFiles = (files: FileList | File[]): File[] => {
        const byName = new Map<string, File>();
        for (const file of files) {
            if (!file.name.toLowerCase().endsWith('.fseq')) continue;
            byName.set(file.name, file);
        }
        return [...byName.values()];
    };

    const AUDIO_UPLOAD_EXTS = new Set(['.mp3', '.wav', '.m4a', '.aac', '.flac', '.ogg', '.wma']);
    const IMAGE_UPLOAD_EXTS = new Set(['.jpg', '.jpeg', '.png', '.gif', '.webp', '.bmp']);

    const pathExt = (name: string) => {
        const i = name.lastIndexOf('.');
        return i >= 0 ? name.slice(i).toLowerCase() : '';
    };

    /** Companion media from the same browser selection (folder pick includes them).
     *  Mirrors Electron colocated-search: audio/image next to the fseq can be used. */
    const collectCompanionUploadFiles = (files: FileList | File[]): File[] => {
        const byName = new Map<string, File>();
        for (const file of files) {
            const ext = pathExt(file.name);
            if (!AUDIO_UPLOAD_EXTS.has(ext) && !IMAGE_UPLOAD_EXTS.has(ext)) continue;
            byName.set(file.name, file);
        }
        return [...byName.values()];
    };

    const uploadAndBatchImportBrowser = async (files: File[]): Promise<BatchImportSummary | undefined> => {
        const fseqFiles = collectFseqUploadFiles(files);
        if (!fseqFiles.length) {
            return {
                total: 0,
                imported: 0,
                failed: 1,
                successes: [],
                failures: [
                    {
                        fseqPath: '',
                        fseqName: '(selection)',
                        reason: 'No .fseq files found in the selection',
                    },
                ],
            };
        }
        const companions = collectCompanionUploadFiles(files);
        const companionAudio = companions.filter((f) => AUDIO_UPLOAD_EXTS.has(pathExt(f.name)));
        const companionAudioNames = companionAudio.map((f) => f.name);
        lanCompanionAudioRef.current = companionAudioNames;
        // One HTTP request: write all companions + fseqs, then import once.
        const toUpload = [...companions, ...fseqFiles].map((f) => ({ name: f.name, data: f as Blob }));
        console.log(
            `[BulkImport] Uploading+importing ${fseqFiles.length} fseq(s), ${companionAudioNames.length} companion audio(s) in one request…`,
        );
        return dispatch(
            batchUploadImportShowSequences({ files: toUpload, companionAudioNames }),
        ).unwrap();
    };

    const handleChooseMediaFolderAndRetry = async () => {
        // LAN embedded UI always mounts this input. Prefer it over any Electron
        // dialog so a remote browser never triggers the player PC picker.
        const lanInput = document.getElementById('ezplayer-bulk-media-folder') as HTMLInputElement | null;
        if (lanInput) {
            lanInput.click();
            return;
        }
        if (!isElectron()) {
            console.warn('[BulkImport] LAN media-folder input missing; rebuild ui-embedded');
            return;
        }
        setChoosingMediaFolder(true);
        try {
            const api = (window as any).electronAPI;
            if (!api?.selectDirectory) {
                console.warn('[BulkImport] selectDirectory unavailable');
                return;
            }
            const dirs: string[] =
                (await api.selectDirectory({
                    title: 'Select Media Folder',
                    buttonLabel: 'Use Folder',
                })) ?? [];
            const chosen = dirs[0];
            if (!chosen) return;
            dispatch(setMediaFolder(chosen));
            await dispatch(savePlayerSettings()).unwrap();

            const missingAudio = (bulkSummary?.failures ?? []).filter((f) =>
                /audio file not found/i.test(f.reason),
            );
            if (!missingAudio.length) return;

            setBulkSummaryOpen(false);
            await runBulkImport(async () => {
                const paths = missingAudio.map((f) => f.fseqPath).filter(Boolean);
                if (!paths.length || !api?.batchImportSequences) return undefined;
                console.log(`[BulkImport] Retrying ${paths.length} sequence(s) after media folder set…`);
                return api.batchImportSequences(paths);
            });
        } catch (error) {
            console.error('[BulkImport] choose media folder / retry failed:', error);
        } finally {
            setChoosingMediaFolder(false);
        }
    };

    /** LAN: browser folder picker for companion MP3s, then upload + retry failed FSEQs. */
    const handleLanMediaFolderInputChange = async (event: React.ChangeEvent<HTMLInputElement>) => {
        const fileArray = event.target.files ? Array.from(event.target.files) : [];
        event.target.value = '';
        if (!fileArray.length) return;

        const companions = collectCompanionUploadFiles(fileArray).filter((f) =>
            AUDIO_UPLOAD_EXTS.has(pathExt(f.name)),
        );
        if (!companions.length) {
            ToastMsgs.showErrorMessage('No audio files found in the selected folder', {
                theme: 'colored',
                position: 'bottom-right',
                autoClose: 3000,
            });
            return;
        }

        const missingAudio = (bulkSummary?.failures ?? []).filter((f) =>
            /audio file not found/i.test(f.reason),
        );
        const importFseqNames = missingAudio.map((f) => f.fseqName).filter(Boolean);
        if (!importFseqNames.length) return;

        const companionAudioNames = [
            ...new Set([...lanCompanionAudioRef.current, ...companions.map((f) => f.name)]),
        ];
        lanCompanionAudioRef.current = companionAudioNames;

        setChoosingMediaFolder(true);
        setBulkSummaryOpen(false);
        try {
            await runBulkImport(async () => {
                console.log(
                    `[BulkImport] LAN media folder: uploading ${companions.length} audio(s), retrying ${importFseqNames.length} sequence(s)…`,
                );
                return dispatch(
                    batchUploadImportShowSequences({
                        files: companions.map((f) => ({ name: f.name, data: f as Blob })),
                        companionAudioNames,
                        importFseqNames,
                    }),
                ).unwrap();
            });
        } finally {
            setChoosingMediaFolder(false);
        }
    };

    const handleBulkFilesInputChange = async (event: React.ChangeEvent<HTMLInputElement>) => {
        // Copy BEFORE clearing — FileList is live; setting value='' empties it.
        const fileArray = event.target.files ? Array.from(event.target.files) : [];
        event.target.value = '';
        setBulkMenuAnchor(null);
        if (!fileArray.length) return;
        console.log(`[BulkImport] Browser selected ${fileArray.length} file(s)`);
        await runBulkImport(() => uploadAndBatchImportBrowser(fileArray));
    };

    const handleBulkFolderInputChange = async (event: React.ChangeEvent<HTMLInputElement>) => {
        const fileArray = event.target.files ? Array.from(event.target.files) : [];
        event.target.value = '';
        setBulkMenuAnchor(null);
        if (!fileArray.length) return;
        console.log(`[BulkImport] Browser folder selected ${fileArray.length} file(s)`);
        await runBulkImport(() => uploadAndBatchImportBrowser(fileArray));
    };

    const handleBulkImportFiles = () => {
        startBulkImportAfterMenuClose(async () => {
            const api = (window as any).electronAPI;
            if (!api?.selectFiles) {
                console.warn('[BulkImport] electronAPI.selectFiles is unavailable');
                return undefined;
            }
            if (!api?.batchImportSequences) {
                console.warn('[BulkImport] electronAPI.batchImportSequences is unavailable — restart the app');
                return undefined;
            }
            console.log('[BulkImport] Opening multi-file .fseq picker…');
            const paths: string[] =
                (await api.selectFiles({
                    title: 'Select .fseq files to import',
                    buttonLabel: 'Import',
                    multi: true,
                    types: [{ name: 'FSEQ Sequence', extensions: ['fseq'] }],
                })) ?? [];
            console.log(`[BulkImport] Selected ${paths.length} file(s)`);
            if (!paths.length) return undefined;
            return api.batchImportSequences(paths);
        });
    };

    const handleBulkImportFolder = () => {
        startBulkImportAfterMenuClose(async () => {
            const api = (window as any).electronAPI;
            if (!api?.selectDirectory) {
                console.warn('[BulkImport] electronAPI.selectDirectory is unavailable');
                return undefined;
            }
            if (!api?.batchImportSequencesFromFolder) {
                console.warn(
                    '[BulkImport] electronAPI.batchImportSequencesFromFolder is unavailable — restart the app',
                );
                return undefined;
            }
            console.log('[BulkImport] Opening folder picker…');
            const dirs: string[] =
                (await api.selectDirectory({
                    title: 'Select folder containing .fseq files',
                    buttonLabel: 'Import Folder',
                })) ?? [];
            const folder = dirs[0];
            console.log(`[BulkImport] Selected folder: ${folder ?? '(none)'}`);
            if (!folder) return undefined;
            return api.batchImportSequencesFromFolder(folder);
        });
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
        const allSongs = (sequenceData || []).filter(isSequencePlayable);

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

                const artist =
                    (song?.work?.artist || 'Unknown Artist') +
                    `${song?.sequence?.vendor ? '(' + song.sequence.vendor + ')' : ''}`;

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

    // Same command the jukebox Play button sends (JukeboxScreen.handlePlay).
    const handlePlayClick = async (row: SongListRow) => {
        try {
            await dispatch(
                callImmediateCommand({
                    command: 'playsong',
                    songId: row.id,
                    immediate: true,
                    priority: 5,
                    requestId: uuidv4(),
                }),
            ).unwrap();
            ToastMsgs.showSuccessMessage(`Playing "${row.title}"`, {
                theme: 'colored',
                position: 'bottom-right',
                autoClose: 2000,
            });
        } catch (error) {
            console.error('Error starting playback:', error);
            ToastMsgs.showErrorMessage('Failed to start playback', {
                theme: 'colored',
                position: 'bottom-right',
                autoClose: 2000,
            });
        }
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
    const baseColumns = [
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
    ];

    const actionColumn =
        showPlayAction || showEditAction || showDeleteAction
            ? {
                  field: 'actions',
                  headerName: '',
                  flex: 0.8,
                  minWidth: 140,
                  renderCell: (params: any) => {
                      const canShowPlay = showPlayAction;
                      const canShowEdit = showEditAction;
                      const canShowDelete = showDeleteAction && params.row.isDeletableSong;

                      if (!canShowPlay && !canShowEdit && !canShowDelete) {
                          return null;
                      }

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
                              {canShowPlay && (
                                  <Button
                                      aria-label="play"
                                      title="Play immediately"
                                      startIcon={<PlayArrowIcon />}
                                      size="small"
                                      color="success"
                                      onClick={() => handlePlayClick(params.row)}
                                      sx={{ minWidth: 'auto', padding: '6px', '& .MuiButton-startIcon': { m: 0 } }}
                                  />
                              )}
                              {canShowEdit && (
                                  <Button
                                      aria-label="edit"
                                      startIcon={<EditIcon />}
                                      size="small"
                                      onClick={() => handleSongSetupClick(params.row)}
                                      sx={{ minWidth: 'auto', padding: '6px', '& .MuiButton-startIcon': { m: 0 } }}
                                  />
                              )}
                              {canShowDelete && (
                                  <Button
                                      aria-label="delete"
                                      startIcon={<DeleteIcon />}
                                      size="small"
                                      color="error"
                                      onClick={() => handleDeleteClick(params.row.id)}
                                      sx={{ minWidth: 'auto', padding: '6px', '& .MuiButton-startIcon': { m: 0 } }}
                                  />
                              )}
                          </Box>
                      );
                  },
              }
            : null;

    const columns = actionColumn ? [...baseColumns, actionColumn] : baseColumns;

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

                    <Box sx={{ display: 'flex', gap: 1, alignItems: 'center' }}>
                        {showAddSongButton && AddSongDialog && (
                            <Button
                                size={'small'}
                                sx={{ pt: 1, pb: 1 }}
                                className="letter-spacing"
                                variant={'contained'}
                                onClick={handleAddClick}
                                startIcon={<AddIcon />}
                            >
                                Add Song
                            </Button>
                        )}
                        {showBulkImportButton && (
                            <>
                                <Button
                                    size={'small'}
                                    sx={{ pt: 1, pb: 1 }}
                                    className="letter-spacing"
                                    variant={'outlined'}
                                    onClick={(e) => setBulkMenuAnchor(e.currentTarget)}
                                    startIcon={
                                        bulkImporting ? (
                                            <CircularProgress size={16} color="inherit" />
                                        ) : (
                                            <LibraryAddIcon />
                                        )
                                    }
                                    disabled={bulkImporting}
                                >
                                    Bulk Import
                                </Button>
                                <Menu
                                    anchorEl={bulkMenuAnchor}
                                    open={Boolean(bulkMenuAnchor)}
                                    onClose={() => setBulkMenuAnchor(null)}
                                    anchorOrigin={{ vertical: 'bottom', horizontal: 'right' }}
                                    transformOrigin={{ vertical: 'top', horizontal: 'right' }}
                                    PaperProps={{ sx: { mt: 1.5 } }}
                                >
                                    {isElectron() ? (
                                        <>
                                            <MenuItem onClick={handleBulkImportFiles}>Select .fseq files…</MenuItem>
                                            <MenuItem onClick={handleBulkImportFolder}>Select folder…</MenuItem>
                                        </>
                                    ) : (
                                        <>
                                            <MenuItem
                                                onClick={() => {
                                                    const el = document.getElementById(
                                                        'ezplayer-bulk-fseq-files',
                                                    ) as HTMLInputElement | null;
                                                    el?.click();
                                                    setBulkMenuAnchor(null);
                                                }}
                                            >
                                                Select .fseq files…
                                            </MenuItem>
                                            <MenuItem
                                                onClick={() => {
                                                    const el = document.getElementById(
                                                        'ezplayer-bulk-fseq-folder',
                                                    ) as HTMLInputElement | null;
                                                    el?.click();
                                                    setBulkMenuAnchor(null);
                                                }}
                                            >
                                                Select folder…
                                            </MenuItem>
                                        </>
                                    )}
                                </Menu>
                                {/* LAN only: inputs stay outside Menu so closing it does not cancel the dialog. */}
                                {!isElectron() && (
                                    <>
                                        <input
                                            id="ezplayer-bulk-fseq-files"
                                            type="file"
                                            accept=".fseq,application/octet-stream"
                                            multiple
                                            style={{ display: 'none' }}
                                            disabled={bulkImporting}
                                            onChange={handleBulkFilesInputChange}
                                        />
                                        <input
                                            id="ezplayer-bulk-fseq-folder"
                                            ref={(el) => {
                                                if (el) {
                                                    el.setAttribute('webkitdirectory', '');
                                                    el.setAttribute('directory', '');
                                                }
                                            }}
                                            type="file"
                                            multiple
                                            style={{ display: 'none' }}
                                            disabled={bulkImporting}
                                            onChange={handleBulkFolderInputChange}
                                        />
                                        <input
                                            id="ezplayer-bulk-media-folder"
                                            ref={(el) => {
                                                if (el) {
                                                    el.setAttribute('webkitdirectory', '');
                                                    el.setAttribute('directory', '');
                                                }
                                            }}
                                            type="file"
                                            multiple
                                            style={{ display: 'none' }}
                                            disabled={bulkImporting || choosingMediaFolder}
                                            onChange={handleLanMediaFolderInputChange}
                                        />
                                    </>
                                )}
                            </>
                        )}
                    </Box>
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

            <BulkImportSummaryDialog
                open={bulkSummaryOpen}
                summary={bulkSummary}
                onClose={() => setBulkSummaryOpen(false)}
                onChooseMediaFolderAndRetry={handleChooseMediaFolderAndRetry}
                choosingMediaFolder={choosingMediaFolder}
            />

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
