import { Box } from '@mui/material';
import { PageHeader } from '@ezplayer/shared-ui-components';
import PlaylistScheduler from './PlaylistScheduler';
import { ScheduledPlaylist } from '@ezplayer/ezplayer-core';
import { postScheduledPlaylists } from '../../store/slices/ScheduleStore';
import { useDispatch, useSelector } from 'react-redux';
import { AppDispatch, RootState } from '../../store/Store';

interface ScheduleProps {
    title: string;
    statusArea: React.ReactNode[];
    scheduleType?: 'main' | 'background';
}

export const Schedule = ({ title, statusArea, scheduleType = 'main' }: ScheduleProps) => {
    const allScheduledPlaylists = useSelector((state: RootState) => state.schedule.scheduledPlaylists || []);

    // Filter schedules based on scheduleType
    const scheduledPlaylists =
        scheduleType === 'background'
            ? allScheduledPlaylists.filter((playlist) => playlist.scheduleType === 'background')
            : allScheduledPlaylists.filter((playlist) => playlist.scheduleType !== 'background');

    const loading = useSelector((state: RootState) => state.schedule.loading);
    const playlists = useSelector((state: RootState) => state.playlists.playlists);

    const dispatch = useDispatch<AppDispatch>();

    const postUpdatedSchedules = async (spls: ScheduledPlaylist[]) => {
        try {
            await dispatch(postScheduledPlaylists(spls)).unwrap();
        } catch (error) {
            console.error('Error refreshing scheduled playlists', error);
            throw error; // Optional: Re-throw for higher-level handling
        }
    };

    const handleScheduleSubmit = async (scheduleData: ScheduledPlaylist[]) => {
        try {
            // Ensure all submitted schedules are marked with the correct scheduleType
            const typedScheduleData = scheduleData.map((schedule) => ({
                ...schedule,
                scheduleType: scheduleType,
            }));
            await postUpdatedSchedules(typedScheduleData);
        } catch (error) {
            console.error(`Error saving ${scheduleType} schedule:`, error);
        }
    };

    return (
        <Box
            sx={{
                height: '100vh',
                display: 'flex',
                flexDirection: 'column',
                overflow: 'hidden', // Prevent outer scrolling
            }}
        >
            <Box sx={{ padding: 2, flexShrink: 0 }}>
                <PageHeader heading={title} children={statusArea} />
            </Box>
            <Box
                sx={{
                    flex: 1,
                    overflow: 'auto', // Enable scrolling for content
                }}
            >
                <PlaylistScheduler
                    availablePlaylists={playlists.map((playlist) => ({
                        id: playlist.id,
                        title: playlist.title,
                        items: playlist.items,
                        tags: playlist.tags,
                        createdAt: playlist.createdAt,
                    }))}
                    onScheduleSubmit={handleScheduleSubmit}
                    initialSchedules={scheduledPlaylists}
                    loading={loading}
                    scheduleType={scheduleType}
                />
            </Box>
        </Box>
    );
};
