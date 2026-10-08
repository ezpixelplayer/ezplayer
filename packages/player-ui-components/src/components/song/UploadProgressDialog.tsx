import { Dialog, DialogContent, DialogTitle, LinearProgress, Typography } from '@mui/material';

export interface UploadProgress {
    name: string;
    loaded: number;
    total: number;
}

/** Stays open through both transfer and the player's final save/import. */
export function UploadProgressDialog({ open, progress }: { open: boolean; progress: UploadProgress | null }) {
    const transferring = !!progress && progress.loaded < progress.total;
    const percent = progress?.total ? Math.min(100, Math.round((100 * progress.loaded) / progress.total)) : 0;
    return (
        <Dialog open={open} disableEscapeKeyDown maxWidth="xs" fullWidth>
            <DialogTitle>{transferring ? 'Uploading to player' : 'Saving on player'}</DialogTitle>
            <DialogContent>
                <Typography sx={{ mb: 2, overflowWrap: 'anywhere' }}>{progress?.name ?? 'Preparing files…'}</Typography>
                <LinearProgress variant={transferring ? 'determinate' : 'indeterminate'} value={percent} />
                <Typography sx={{ mt: 1 }} variant="body2">
                    {transferring ? `${percent}% uploaded` : 'Finishing upload and saving. Please wait…'}
                </Typography>
                <Typography sx={{ mt: 1 }} variant="body2" color="text.secondary">
                    Keep this page open until the save finishes.
                </Typography>
            </DialogContent>
        </Dialog>
    );
}
