import {
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
import type { BatchImportFailure, BatchImportSuccess, BatchImportSummary } from '@ezplayer/ezplayer-core';

export interface BulkImportSummaryDialogProps {
    open: boolean;
    summary: BatchImportSummary | null;
    onClose: () => void;
}

export function BulkImportSummaryDialog({ open, summary, onClose }: BulkImportSummaryDialogProps) {
    if (!summary) return null;

    return (
        <Dialog open={open} onClose={onClose} maxWidth="sm" fullWidth>
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
                                <ListItem key={f.fseqPath} alignItems="flex-start" sx={{ px: 0 }}>
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
                <Button variant="contained" onClick={onClose}>
                    Close
                </Button>
            </DialogActions>
        </Dialog>
    );
}
