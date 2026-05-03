import { useState } from 'react';
import { Box } from '../box/Box';
import { PageHeader } from '@ezplayer/shared-ui-components';
import PlaylistScheduler from './PlaylistScheduler';
import { ScheduledPlaylist } from '@ezplayer/ezplayer-core';
import { postScheduledPlaylists } from '../../store/slices/ScheduleStore';
import { useDispatch, useSelector } from 'react-redux';
import { AppDispatch, RootState } from '../../store/Store';
import { SchedulePreviewDialog } from '../schedule-preview/SchedulePreviewDialog';

type ScheduleType = 'main' | 'background';

interface ScheduleProps {
    title: string;
    statusArea: React.ReactNode[];
    initialScheduleType?: ScheduleType;
}

export const Schedule = ({ title, statusArea, initialScheduleType = 'main' }: ScheduleProps) => {
    const [scheduleType, setScheduleType] = useState<ScheduleType>(initialScheduleType);
    const [previewOpen, setPreviewOpen] = useState(false);
    const allScheduledPlaylists = useSelector((state: RootState) => state.schedule.scheduledPlaylists || []);

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
            throw error;
        }
    };

    const handleScheduleSubmit = async (scheduleData: ScheduledPlaylist[]) => {
        try {
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
                overflow: 'hidden',
            }}
        >
            <Box sx={{ padding: 2, flexShrink: 0 }}>
                <PageHeader heading={title} children={statusArea} />
            </Box>
            <Box
                sx={{
                    flex: 1,
                    overflow: 'auto',
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
                    onScheduleTypeChange={setScheduleType}
                    onOpenPreview={() => setPreviewOpen(true)}
                />
            </Box>
            <SchedulePreviewDialog open={previewOpen} onClose={() => setPreviewOpen(false)} />
        </Box>
    );
};
