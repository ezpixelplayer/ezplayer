import * as React from 'react';
import { Card, CardHeader, CardContent, Box, Typography, IconButton, Stack } from '@mui/material';
import CloseIcon from '@mui/icons-material/Close';
import { PlayingItem } from '@ezplayer/ezplayer-core';

interface QueueCardProps {
    title?: string;
    queue: PlayingItem[];
    onRemoveItem?: (item: PlayingItem, index: number) => void;
    sx?: React.ComponentProps<typeof Card>['sx'];
}

export const QueueCard: React.FC<QueueCardProps> = ({ title = 'Queue', queue, onRemoveItem, sx }) => {
    if (!queue || queue.length === 0) return null;

    return (
        <Card sx={{ mb: 2, ...sx }}>
            <CardHeader
                title={
                    <Typography variant="subtitle1" fontWeight="bold">
                        {title} ({queue.length})
                    </Typography>
                }
            />
            <CardContent sx={{ pt: 0 }}>
                <Stack spacing={1}>
                    {queue.map((qi, index) => (
                        <Box
                            key={qi.request_id ?? index}
                            sx={{
                                display: 'flex',
                                alignItems: 'center',
                                justifyContent: 'space-between',
                                border: '1px solid',
                                borderColor: 'divider',
                                borderRadius: 1,
                                px: 1,
                                py: 0.5,
                            }}
                        >
                            <Typography variant="body2" sx={{ fontWeight: 500, mr: 1 }}>
                                {qi.title}
                            </Typography>

                            {onRemoveItem && (
                                <IconButton
                                    size="small"
                                    aria-label="remove from queue"
                                    onClick={() => {
                                        onRemoveItem(qi, index);
                                    }}
                                >
                                    <CloseIcon fontSize="small" />
                                </IconButton>
                            )}
                        </Box>
                    ))}
                </Stack>
            </CardContent>
        </Card>
    );
};
