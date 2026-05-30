import React, { useState } from 'react';
import { Button, Dialog, DialogActions, DialogContent, DialogTitle, Tab, Tabs, Typography } from '@mui/material';
import { TERMS_LETTER_TEXT, TERMS_SPIRIT_TEXT } from './termsContent';

type TermsTab = 'spirit' | 'letter';

export interface TermsDialogProps {
    open: boolean;
    onClose: () => void;
}

export const TermsDialog: React.FC<TermsDialogProps> = ({ open, onClose }) => {
    const [tab, setTab] = useState<TermsTab>('spirit');

    return (
        <Dialog open={open} onClose={onClose} maxWidth="md" fullWidth scroll="paper">
            <DialogTitle>
                <Typography variant="h5" sx={{ fontWeight: 'bold' }}>
                    Terms of Use
                </Typography>
                <Tabs value={tab} onChange={(_, v) => setTab(v as TermsTab)} sx={{ mt: 1, minHeight: 36 }}>
                    <Tab value="spirit" label="Spirit" sx={{ minHeight: 36, py: 0.5 }} />
                    <Tab value="letter" label="Letter" sx={{ minHeight: 36, py: 0.5 }} />
                </Tabs>
            </DialogTitle>
            <DialogContent dividers>
                <Typography variant="body2" component="div" sx={{ whiteSpace: 'pre-wrap', fontFamily: 'inherit' }}>
                    {tab === 'spirit' ? TERMS_SPIRIT_TEXT : TERMS_LETTER_TEXT}
                </Typography>
            </DialogContent>
            <DialogActions>
                <Button onClick={onClose}>Close</Button>
            </DialogActions>
        </Dialog>
    );
};

export default TermsDialog;
