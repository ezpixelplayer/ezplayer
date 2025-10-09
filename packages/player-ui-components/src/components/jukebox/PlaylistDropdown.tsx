import { FC } from 'react';
import { FormControl, Select, MenuItem, InputLabel, SelectChangeEvent } from '@mui/material';

export interface Playlist {
    id: string;
    name: string;
}

interface PlaylistDropdownProps {
    value: string;
    onChange: (value: string) => void;
    playlists: Playlist[];
    label?: string;
}

export const PlaylistDropdown: FC<PlaylistDropdownProps> = ({
    value,
    onChange,
    playlists,
    label = 'Select Playlist',
}) => {
    const handleChange = (event: SelectChangeEvent<string>) => {
        onChange(event.target.value);
    };

    return (
        <FormControl
            sx={{
                minWidth: 200,
            }}
        >
            <InputLabel id="playlist-select-label">{label}</InputLabel>
            <Select
                labelId="playlist-select-label"
                value={value}
                label={label}
                onChange={handleChange}
                sx={{
                    borderRadius: 2,
                }}
            >
                <MenuItem value="all">All Songs</MenuItem>
                {playlists.map((playlist) => (
                    <MenuItem key={playlist.id} value={playlist.id}>
                        {playlist.name}
                    </MenuItem>
                ))}
            </Select>
        </FormControl>
    );
};
