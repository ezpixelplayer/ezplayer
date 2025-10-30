import React, { useState } from 'react';
import { Box, Button, Typography, Divider, List, ListItem, ListItemText, Collapse } from '@mui/material';
import { SimpleDialog } from '@ezplayer/shared-ui-components';

export interface LicenseEntry {
    license: string;
    packages: string[];
    text: string;
}

export interface LicenseDialogProps {
    open: boolean;
    onClose: () => void;
    licenses: LicenseEntry[];
}

export const LicenseDialog: React.FC<LicenseDialogProps> = ({ open, onClose, licenses }) => {
    const [expanded, setExpanded] = useState<string | null>(null);

    const handleReproduceClick = (license: string) => {
        setExpanded(license === expanded ? null : license);
    };

    return (
        <SimpleDialog
            open={open}
            onClose={onClose}
            model_title={
                <Typography variant="h5" sx={{ fontWeight: 'bold' }}>
                    Open-source Licenses
                </Typography>
            }
            model_content={
                <Box sx={{ minWidth: 350, maxWidth: 600 }}>
                    <Typography variant="body2" color="text.secondary" sx={{ mb: 1 }}>
                        This project uses the following open-source licenses:
                    </Typography>
                    <List dense>
                        {licenses.map((lic) => (
                            <React.Fragment key={lic.license}>
                                <ListItem sx={{ alignItems: 'flex-start' }}>
                                    <ListItemText
                                        primary={<Typography fontWeight={600}>{lic.license}</Typography>}
                                        secondary={<Typography variant="caption">Packages: {lic.packages.join(', ')}</Typography>}
                                    />
                                    <Button size="small" variant="outlined" sx={{ ml: 1 }} onClick={() => handleReproduceClick(lic.license)}>
                                        Reproduce License
                                    </Button>
                                </ListItem>
                                <Collapse in={expanded === lic.license} timeout="auto" unmountOnExit>
                                    <Box sx={{ ml: 3, mb: 2, p: 1, borderRadius: 1, bgcolor: 'action.hover', fontFamily: 'monospace', fontSize: '0.8rem', whiteSpace: 'pre-line' }}>
                                        <Typography variant="subtitle2" sx={{ mb: 1 }}>License Text ({lic.license}):</Typography>
                                        <Typography variant="body2" sx={{ fontFamily: 'monospace', fontSize: '0.8rem', whiteSpace: 'pre-line' }}>{lic.text}</Typography>
                                    </Box>
                                </Collapse>
                                <Divider />
                            </React.Fragment>
                        ))}
                    </List>
                    <Box sx={{ mt: 2, textAlign: 'right' }}>
                        <Button variant="contained" sx={{ minWidth: 80 }} onClick={onClose}>Close</Button>
                    </Box>
                </Box>
            }
        />
    );
};
