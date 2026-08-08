import {
    Alert,
    Button,
    Dialog,
    DialogActions,
    DialogContent,
    DialogTitle,
    Divider,
    List,
    ListItem,
    ListItemText,
    Typography,
} from '@mui/material';
import FolderOpenIcon from '@mui/icons-material/FolderOpen';
import { useSelector } from 'react-redux';
import { isElectron } from '@ezplayer/shared-ui-components';
import type { BatchImportFailure, BatchImportSuccess, BatchImportSummary } from '@ezplayer/ezplayer-core';
import type { RootState } from '../..';

export interface BulkImportSummaryDialogProps {
    open: boolean;
    summary: BatchImportSummary | null;
    onClose: () => void;
    /** Choose media folder then retry failed imports (native path on desktop; browser folder on LAN). */
    onChooseMediaFolderAndRetry?: () => void | Promise<void>;
    choosingMediaFolder?: boolean;
}

function isMissingAudioFailure(reason: string): boolean {
    return /audio file not found/i.test(reason);
}

export function BulkImportSummaryDialog({
    open,
    summary,
    onClose,
    onChooseMediaFolderAndRetry,
    choosingMediaFolder = false,
}: BulkImportSummaryDialogProps) {
    const mediaFolder = useSelector((s: RootState) => s.playbackSettings.settings.mediaFolder);
    const onDesktop = isElectron();

    if (!summary) return null;

    const missingAudioFailures = summary.failures.filter((f) => isMissingAudioFailure(f.reason));
    const showMediaFolderHint = missingAudioFailures.length > 0 && !!onChooseMediaFolderAndRetry;

    return (
        <Dialog open={open} onClose={choosingMediaFolder ? undefined : onClose} maxWidth="sm" fullWidth>
            <DialogTitle>
                <Typography variant="h5">Bulk Import Summary</Typography>
            </DialogTitle>
            <Divider />
            <DialogContent>
                <Typography sx={{ mb: 1 }}>
                    Imported <strong>{summary.imported}</strong> of <strong>{summary.total}</strong> sequence
                    {summary.total === 1 ? '' : 's'}.
                </Typography>
                {summary.failed > 0 && (
                    <Typography color="error" sx={{ mb: 1 }}>
                        Failed: {summary.failed}
                    </Typography>
                )}

                {showMediaFolderHint && (
                    <Alert severity="info" sx={{ mb: 2 }} icon={<FolderOpenIcon />}>
                        <Typography variant="body2" sx={{ mb: 1 }}>
                            Some sequences failed because companion audio was not found.{' '}
                            {onDesktop ? (
                                <>
                                    Choose a <strong>Media Folder</strong> on this PC that contains the matching MP3
                                    files — import will retry automatically for the failed sequences.
                                </>
                            ) : (
                                <>
                                    Choose a folder <strong>on this device</strong> that contains the matching MP3
                                    files. They will be uploaded to the player and import will retry for the failed
                                    sequences.
                                </>
                            )}
                        </Typography>
                        <Button
                            size="small"
                            variant="contained"
                            startIcon={<FolderOpenIcon />}
                            disabled={choosingMediaFolder}
                            onClick={() => void onChooseMediaFolderAndRetry?.()}
                        >
                            {choosingMediaFolder ? 'Working…' : 'Choose Media Folder'}
                        </Button>
                        {onDesktop && mediaFolder ? (
                            <Typography variant="caption" display="block" sx={{ mt: 1 }} color="text.secondary">
                                Current media folder: {mediaFolder}
                            </Typography>
                        ) : null}
                    </Alert>
                )}

                {summary.successes.length > 0 && (
                    <>
                        <Typography variant="subtitle2" sx={{ mt: 2, mb: 0.5 }} color="success.main">
                            Imported
                        </Typography>
                        <List dense disablePadding>
                            {summary.successes.map((s: BatchImportSuccess) => (
                                <ListItem key={s.fseqPath} alignItems="flex-start" sx={{ px: 0 }}>
                                    <ListItemText
                                        primary={s.fseqName}
                                        secondary={`${s.title} — ${s.artist}${s.mediaFound ? '' : ' (no media)'}`}
                                        primaryTypographyProps={{ fontWeight: 600 }}
                                    />
                                </ListItem>
                            ))}
                        </List>
                    </>
                )}

                {summary.failures.length > 0 && (
                    <>
                        <Typography variant="subtitle2" sx={{ mt: 2, mb: 0.5 }} color="error">
                            Failures
                        </Typography>
                        <List dense disablePadding>
                            {summary.failures.map((f: BatchImportFailure) => (
                                <ListItem key={f.fseqPath || f.fseqName} alignItems="flex-start" sx={{ px: 0 }}>
                                    <ListItemText
                                        primary={f.fseqName}
                                        secondary={f.reason}
                                        primaryTypographyProps={{ fontWeight: 600 }}
                                    />
                                </ListItem>
                            ))}
                        </List>
                    </>
                )}
            </DialogContent>
            <DialogActions>
                <Button variant="contained" onClick={onClose} disabled={choosingMediaFolder}>
                    Close
                </Button>
            </DialogActions>
        </Dialog>
    );
}
