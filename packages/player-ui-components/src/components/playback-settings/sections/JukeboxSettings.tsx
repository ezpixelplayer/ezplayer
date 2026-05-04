import React from 'react';
import { useDispatch, useSelector } from 'react-redux';
import { Box } from '../../box/Box';
import { TagListInput } from '../../tag-list-input/TagListInput';
import { playerStatusActions } from '../../../store/slices/PlayerStatusStore';
import type { AppDispatch, RootState } from '../../../store/Store';

export const JukeboxSettings: React.FC = () => {
    const dispatch = useDispatch<AppDispatch>();
    const settings = useSelector((s: RootState) => s.playerStatus.playbackSettings);

    return (
        <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
            <TagListInput
                label="Excluded Tags (Always Filtered Out)"
                value={settings.jukebox?.excludedTags || ['nojukebox']}
                onChange={(next) => dispatch(playerStatusActions.setJukeboxExcludedTags(next))}
                placeholder='Type a tag and press Enter (e.g., "nojukebox")'
                helperText="Songs containing any of these tags will always be excluded from the jukebox."
            />
            <TagListInput
                label="Included Tags (Optional Filter)"
                value={settings.jukebox?.includedTags || []}
                onChange={(next) => dispatch(playerStatusActions.setJukeboxIncludedTags(next))}
                placeholder='Leave empty to allow all (except excluded). Add tags to restrict.'
                helperText="If empty: no filtering is applied. If one or more tags are present: only songs matching at least one tag are allowed."
            />
        </Box>
    );
};
