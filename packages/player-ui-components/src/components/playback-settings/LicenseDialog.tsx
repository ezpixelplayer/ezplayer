import React, { useState } from 'react';
import {
    Button,
    Dialog,
    DialogContent,
    DialogTitle,
    Typography,
    Divider,
    List,
    ListItem,
    ListItemText,
    Collapse,
} from '@mui/material';
import { Box } from '../box/Box';

export interface LicenseEntry {
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

    // Use package name(s) as unique identifier instead of license name
    const getUniqueKey = (packages: string[]) => packages.join(',');

    const handleReproduceClick = (uniqueKey: string) => {
        setExpanded(uniqueKey === expanded ? null : uniqueKey);
    };

    return (
        <Dialog open={open} onClose={onClose}>
            <DialogTitle>
                <Typography variant="h5" sx={{ fontWeight: 'bold' }}>
                    Open-source Licenses
                </Typography>
            </DialogTitle>
            <DialogContent>
                <Box sx={{ minWidth: 350, maxWidth: 600 }}>
                    <Typography variant="body2" color="text.secondary" sx={{ mb: 1 }}>
                        This project uses the following open-source licenses:
                    </Typography>
                    <List dense>
                        {licenses.map((lic) => {
                            const uniqueKey = getUniqueKey(lic.packages);
                            return (
                                <React.Fragment key={uniqueKey}>
                                    <ListItem sx={{ alignItems: 'flex-start' }}>
                                        <ListItemText
                                            primary={
                                                <Typography fontWeight={600}>{lic.packages.join(', ')}</Typography>
                                            }
                                        />
                                        <Button
                                            size="small"
                                            variant="outlined"
                                            sx={{ ml: 1 }}
                                            onClick={() => handleReproduceClick(uniqueKey)}
                                        >
                                            Reproduce License
                                        </Button>
                                    </ListItem>
                                    <Collapse in={expanded === uniqueKey} timeout="auto" unmountOnExit>
                                        <Box sx={{ ml: 3, mb: 2, borderRadius: 1 }}>
                                            <Typography variant="subtitle2" sx={{ mb: 1, p: 1, pb: 0 }}>
                                                License Text:
                                            </Typography>
                                            <Box
                                                sx={{
                                                    p: 1,
                                                    pt: 0.5,
                                                    maxHeight: '400px',
                                                    overflowY: 'auto',
                                                    overflowX: 'hidden',
                                                    fontFamily: 'monospace',
                                                    fontSize: '0.8rem',
                                                    whiteSpace: 'pre-line',
                                                }}
                                            >
                                                <Typography
                                                    variant="body2"
                                                    sx={{
                                                        fontFamily: 'monospace',
                                                        fontSize: '0.8rem',
                                                        whiteSpace: 'pre-line',
                                                        margin: 0,
                                                    }}
                                                >
                                                    {lic.text}
                                                </Typography>
                                            </Box>
                                        </Box>
                                    </Collapse>
                                    <Divider />
                                </React.Fragment>
                            );
                        })}
                    </List>
                    <Box sx={{ mt: 2, textAlign: 'right' }}>
                        <Button variant="contained" sx={{ minWidth: 80 }} onClick={onClose}>
                            Close
                        </Button>
                    </Box>
                </Box>
            </DialogContent>
        </Dialog>
    );
};
