import { Autocomplete, Box, TextField, Typography } from '@mui/material';

/** What a schedule plays as its intro, outro or interstitial: a playlist or one song. */
export interface ScheduleSectionOption {
    kind: 'playlist' | 'sequence';
    id: string;
    label: string;
    /** Shown after the label, e.g. the artist of a song. */
    detail?: string;
    durationText: string;
}

export interface ScheduleSectionValue {
    playlistId: string;
    sequenceId: string;
}

interface ScheduleSectionPickerProps {
    label: string;
    /** Playlists first, then songs: the list is shown grouped in the order given. */
    options: ScheduleSectionOption[];
    value: ScheduleSectionValue;
    onChange: (value: ScheduleSectionValue) => void;
}

/** Searchable choice of a playlist or a single song; cleared means none. */
export function ScheduleSectionPicker({ label, options, value, onChange }: ScheduleSectionPickerProps) {
    const selected =
        options.find((o) =>
            value.playlistId
                ? o.kind === 'playlist' && o.id === value.playlistId
                : o.kind === 'sequence' && o.id === value.sequenceId,
        ) ?? null;
    const hasValue = !!(value.playlistId || value.sequenceId);

    return (
        <Autocomplete
            fullWidth
            options={options}
            value={hasValue ? selected : null}
            onChange={(_e, o) =>
                onChange({
                    playlistId: o?.kind === 'playlist' ? o.id : '',
                    sequenceId: o?.kind === 'sequence' ? o.id : '',
                })
            }
            groupBy={(o) => (o.kind === 'playlist' ? 'Playlists' : 'Songs')}
            getOptionLabel={(o) => o.label}
            getOptionKey={(o) => `${o.kind}:${o.id}`}
            isOptionEqualToValue={(a, b) => a.kind === b.kind && a.id === b.id}
            renderOption={(props, o) => {
                const { key, ...rest } = props as typeof props & { key: string };
                return (
                    <Box component="li" key={key} {...rest} sx={{ display: 'flex', gap: 1 }}>
                        <Box component="span" sx={{ flex: 1, minWidth: 0 }}>
                            {o.label}
                            {o.detail && (
                                <Typography component="span" variant="body2" color="text.secondary">
                                    {` – ${o.detail}`}
                                </Typography>
                            )}
                        </Box>
                        <Typography variant="body2" color="text.secondary">
                            {o.durationText}
                        </Typography>
                    </Box>
                );
            }}
            renderInput={(params) => (
                <TextField
                    {...params}
                    label={label}
                    placeholder="None"
                    InputLabelProps={{ ...params.InputLabelProps, shrink: true }}
                    // The chosen playlist or song is no longer in the library
                    helperText={hasValue && !selected ? 'The saved choice is no longer available.' : undefined}
                />
            )}
        />
    );
}
