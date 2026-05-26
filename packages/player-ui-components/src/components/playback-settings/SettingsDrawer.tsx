import { PageHeader } from '@ezplayer/shared-ui-components';
import CloseIcon from '@mui/icons-material/Close';
import {
    Card,
    Dialog,
    DialogContent,
    DialogTitle,
    IconButton,
    Tooltip,
    Typography,
} from '@mui/material';
import React, { useState } from 'react';
import { Box } from '../box/Box';
import { LegalFooter } from './LegalFooter';

/**
 * A tile in the SettingsDrawer gallery. Two shapes:
 * - `content`: dialog body the drawer wraps in its uniform SectionDialog frame.
 * - `onClick`: caller-owned action (e.g. opens a self-contained dialog elsewhere).
 */
export type SettingsSection =
    | {
          key: string;
          label: string;
          icon: React.ReactNode;
          available?: boolean;
          /** Title shown in the dialog header; falls back to `label`. */
          title?: string;
          /** JSX shown inside the dialog. Wrapped by the drawer's SectionDialog. */
          content: React.ReactNode;
      }
    | {
          key: string;
          label: string;
          icon: React.ReactNode;
          available?: boolean;
          /** Caller handles the click (e.g. opens its own self-contained dialog). */
          onClick: () => void;
      };

interface SettingsDrawerProps {
    title: string;
    statusArea?: React.ReactNode[];
    /** Section tiles to render. Apps assemble their own list from the exported section
     *  components (or any custom sections of their own). */
    sections: SettingsSection[];
}

export const SettingsDrawer: React.FC<SettingsDrawerProps> = ({ title, statusArea, sections }) => {
    const [activeDialog, setActiveDialog] = useState<string | null>(null);
    const closeActiveDialog = () => setActiveDialog(null);

    const effectiveSections = sections.filter((s) => s.available !== false);

    // Wraps each section's content in a uniform Dialog frame with a close button.
    const SectionDialog: React.FC<{ open: boolean; title: string; children: React.ReactNode }> = ({
        open,
        title,
        children,
    }) => (
        <Dialog
            open={open}
            onClose={closeActiveDialog}
            maxWidth="md"
            fullWidth
            PaperProps={{ sx: { maxHeight: '90vh' } }}
        >
            <DialogTitle sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                <Typography variant="h5">{title}</Typography>
                <Tooltip title="Close">
                    <IconButton onClick={closeActiveDialog} size="small" aria-label="close">
                        <CloseIcon />
                    </IconButton>
                </Tooltip>
            </DialogTitle>
            <DialogContent dividers>{children}</DialogContent>
        </Dialog>
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
            <Box sx={{ flexShrink: 0, padding: 2 }}>
                <PageHeader heading={title} children={statusArea} />
            </Box>

            {/* Scrollable gallery */}
            <Box sx={{ overflowY: 'auto', flexGrow: 1, padding: 2 }}>
                <Box
                    sx={{
                        display: 'grid',
                        gridTemplateColumns: 'repeat(auto-fill, minmax(160px, 1fr))',
                        gap: 2,
                        maxWidth: '1000px',
                    }}
                >
                    {effectiveSections.map((s) => {
                        const onClick = 'onClick' in s ? s.onClick : () => setActiveDialog(s.key);
                        return (
                            <Card
                                key={s.key}
                                onClick={onClick}
                                sx={{
                                    cursor: 'pointer',
                                    p: 3,
                                    aspectRatio: '1 / 1',
                                    display: 'flex',
                                    flexDirection: 'column',
                                    alignItems: 'center',
                                    justifyContent: 'center',
                                    gap: 1,
                                    color: 'primary.main',
                                    transition: 'transform 0.1s, box-shadow 0.1s',
                                    '&:hover': { transform: 'translateY(-2px)', boxShadow: 6 },
                                }}
                            >
                                {s.icon}
                                <Typography variant="subtitle1" sx={{ color: 'text.primary' }}>
                                    {s.label}
                                </Typography>
                            </Card>
                        );
                    })}
                </Box>
            </Box>

            <LegalFooter />

            {/* Section dialogs (one per content-bearing section) */}
            {effectiveSections.map((s) =>
                'content' in s ? (
                    <SectionDialog
                        key={s.key}
                        open={activeDialog === s.key}
                        title={s.title ?? s.label}
                    >
                        {s.content}
                    </SectionDialog>
                ) : null,
            )}
        </Box>
    );
};
