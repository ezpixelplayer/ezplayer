import { FC, useMemo } from 'react';
import { Box, Typography, Button, Card, useTheme, useMediaQuery } from '@mui/material';
import { MusicNote } from '@mui/icons-material';
import { getImageUrl } from '../../util/imageUtils';

interface SongCardButton {
    label: string;
    action: (id: string) => void;
    variant?: 'text' | 'outlined' | 'contained';
    color?: 'inherit' | 'primary' | 'secondary' | 'success' | 'error' | 'info' | 'warning';
    isDisabled?: (id: string) => boolean;
}

interface SongCardProps {
    id: string;
    title: string;
    artist: string;
    artwork?: string;
    localImagePath?: string;
    // Buttons to render
    buttons: SongCardButton[];
}

export const SongCard: FC<SongCardProps> = ({ id, title, artist, artwork, localImagePath, buttons }) => {
    const theme = useTheme();
    const isMobile = useMediaQuery(theme.breakpoints.down('sm'));

    // Get the appropriate image URL (local image takes priority) - memoized to prevent unnecessary re-renders
    const imageUrl = useMemo(() => getImageUrl(artwork, localImagePath), [artwork, localImagePath]);

    // Force re-render when image changes by using the imageUrl as a dependency
    const imageKey = useMemo(() => `${id}-${imageUrl}`, [id, imageUrl]);

    return (
        <Card
            sx={{
                display: 'flex',
                flexDirection: 'column',
                height: '100%',
                borderRadius: 2,
                overflow: 'hidden',
                transition: 'transform 0.2s ease-in-out',
                '&:hover': {
                    transform: 'scale(1.02)',
                },
            }}
        >
            {/* Artwork Section */}
            <Box
                sx={{
                    position: 'relative',
                    paddingTop: '100%', // 1:1 Aspect ratio
                    backgroundColor: theme.palette.grey[200],
                    overflow: 'hidden',
                }}
            >
                {imageUrl ? (
                    <img
                        key={imageKey} // Force re-render when image changes
                        src={imageUrl}
                        alt={`${title} artwork`}
                        style={{
                            position: 'absolute',
                            top: 0,
                            left: 0,
                            width: '100%',
                            height: '100%',
                            objectFit: 'cover',
                        }}
                    />
                ) : (
                    <Box
                        sx={{
                            position: 'absolute',
                            top: 0,
                            left: 0,
                            width: '100%',
                            height: '100%',
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'center',
                        }}
                    >
                        <MusicNote
                            sx={{
                                fontSize: 60,
                                color: theme.palette.grey[400],
                            }}
                        />
                    </Box>
                )}
            </Box>

            {/* Content Section */}
            <Box
                sx={{
                    p: 2,
                    flexGrow: 1,
                    display: 'flex',
                    flexDirection: 'column',
                }}
            >
                <Typography
                    variant="h6"
                    component="h2"
                    sx={{
                        fontWeight: 'bold',
                        mb: 0.5,
                        overflow: 'hidden',
                        textOverflow: 'ellipsis',
                        display: '-webkit-box',
                        WebkitLineClamp: 2,
                        WebkitBoxOrient: 'vertical',
                    }}
                >
                    {title}
                </Typography>
                <Typography
                    variant="body1"
                    color="text.secondary"
                    sx={{
                        mb: 2,
                        overflow: 'hidden',
                        textOverflow: 'ellipsis',
                        whiteSpace: 'nowrap',
                    }}
                >
                    {artist}
                </Typography>

                {/* Action Buttons */}
                <Box
                    sx={{
                        display: 'flex',
                        gap: 1,
                        mt: 'auto',
                        flexWrap: 'wrap',
                    }}
                >
                    {buttons.map((button, index) => {
                        const isDisabled = button.isDisabled ? button.isDisabled(id) : false;
                        return (
                            <Button
                                key={`${button.label}-${index}`}
                                variant={button.variant || 'outlined'}
                                color={button.color || 'primary'}
                                disabled={isDisabled}
                                onClick={() => !isDisabled && button.action(id)}
                                sx={{
                                    flex: '1 1 auto',
                                    minWidth: isMobile ? '100%' : 'auto',
                                }}
                            >
                                {button.label}
                            </Button>
                        );
                    })}
                </Box>
            </Box>
        </Card>
    );
};
