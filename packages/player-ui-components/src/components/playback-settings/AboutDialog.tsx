import { EZPElectronAPI } from '@ezplayer/ezplayer-core';
import { SimpleDialog, isElectron } from '@ezplayer/shared-ui-components';
import { Box, Button, Divider, Link, Typography } from '@mui/material';
import React from 'react';

// Extend Window interface to include electronAPI
declare global {
    interface Window {
        electronAPI?: EZPElectronAPI;
    }
}

interface AboutDialogProps {
    open: boolean;
    onClose: () => void;
    playerVersion?: string;
    cloudVersion?: string;
}

export const AboutDialog: React.FC<AboutDialogProps> = ({ open, onClose, playerVersion, cloudVersion }) => {
    const handleClose = () => {
        onClose();
    };

    return (
        <SimpleDialog
            open={open}
            onClose={handleClose}
            model_title={
                <Typography variant="h5" sx={{ fontWeight: 'bold' }}>
                    About EZPlayer
                </Typography>
            }
            model_content={
                <Box
                    sx={{
                        display: 'flex',
                        flexDirection: 'column',
                        gap: 2,
                        minWidth: '350px',
                        maxWidth: '400px',
                        py: 1,
                    }}
                >
                    {/* Authors Section */}
                    <Box>
                        <Typography variant="subtitle2" sx={{ mb: 0.5, fontWeight: 600 }}>
                            Authors
                        </Typography>
                        <Typography variant="body2" color="text.secondary">
                            Crafted by Aakanksha Thokare
                        </Typography>
                    </Box>

                    <Divider />

                    {/* Community Links */}
                    <Box>
                        <Typography variant="subtitle2" sx={{ mb: 1, fontWeight: 600 }}>
                            Community & Support
                        </Typography>

                        <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1.5 }}>
                            {/* Discord Server */}
                            <Box>
                                <Typography variant="body2" sx={{ fontWeight: 500, mb: 0.5 }}>
                                    Discord Server
                                </Typography>
                                {isElectron() ? (
                                    <Link
                                        component="button"
                                        underline="hover"
                                        sx={{
                                            cursor: 'pointer',
                                            textAlign: 'left',
                                            color: 'primary.main',
                                            textDecoration: 'none',
                                            '&:hover': {
                                                textDecoration: 'underline',
                                            },
                                        }}
                                        onClick={() => window.electronAPI?.openExternal('https://discord.gg/3Qwz79MN')}
                                    >
                                        Join our Discord community
                                    </Link>
                                ) : (
                                    <Link
                                        href="https://discord.gg/3Qwz79MN"
                                        target="_blank"
                                        rel="noopener noreferrer"
                                        sx={{
                                            color: 'primary.main',
                                            textDecoration: 'none',
                                            '&:hover': {
                                                textDecoration: 'underline',
                                            },
                                        }}
                                    >
                                        Join our Discord community
                                    </Link>
                                )}
                            </Box>

                            {/* GitHub Repository */}
                            <Box>
                                <Typography variant="body2" sx={{ fontWeight: 500, mb: 0.5 }}>
                                    GitHub Repository
                                </Typography>
                                {isElectron() ? (
                                    <Link
                                        component="button"
                                        underline="hover"
                                        sx={{
                                            cursor: 'pointer',
                                            textAlign: 'left',
                                            color: 'primary.main',
                                            textDecoration: 'none',
                                            '&:hover': {
                                                textDecoration: 'underline',
                                            },
                                        }}
                                        onClick={() => window.electronAPI?.openExternal('https://github.com/ezpixelplayer/ezplayer')}
                                    >
                                        View source code and contribute
                                    </Link>
                                ) : (
                                    <Link
                                        href="https://github.com/ezpixelplayer/ezplayer"
                                        target="_blank"
                                        rel="noopener noreferrer"
                                        sx={{
                                            color: 'primary.main',
                                            textDecoration: 'none',
                                            '&:hover': {
                                                textDecoration: 'underline',
                                            },
                                        }}
                                    >
                                        View source code and contribute
                                    </Link>
                                )}
                            </Box>
                        </Box>
                    </Box>

                    {/* Version Information */}
                    <Box sx={{ mt: 1, pt: 1, borderTop: '1px solid #e0e0e0' }}>
                        <Typography variant="subtitle2" sx={{ mb: 1, fontWeight: 600 }}>
                            Version Information
                        </Typography>
                        <Box sx={{ display: 'flex', justifyContent: 'space-between', mb: 0.5 }}>
                            <Typography variant="body2" color="text.secondary">
                                Player Version:
                            </Typography>
                            <Typography variant="body2">{playerVersion || 'N/A'}</Typography>
                        </Box>
                    </Box>

                    {/* Close Button */}
                    <Box
                        sx={{
                            display: 'flex',
                            justifyContent: 'flex-end',
                            mt: 1,
                            pt: 1,
                            borderTop: '1px solid',
                            borderColor: 'divider',
                        }}
                    >
                        <Button
                            variant="contained"
                            onClick={handleClose}
                            size="small"
                            sx={{ minWidth: 80 }}
                        >
                            Close
                        </Button>
                    </Box>
                </Box>
            }
        />
    );
};
