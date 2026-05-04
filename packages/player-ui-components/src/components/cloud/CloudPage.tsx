import { Card, Typography } from '@mui/material';
import React from 'react';
import { useSelector } from 'react-redux';
import { PageHeader } from '@ezplayer/shared-ui-components';
import { Box } from '../box/Box';
import type { RootState } from '../../store/Store';

interface CloudPageProps {
    title: string;
    statusArea?: React.ReactNode[];
}

const formatTimestamp = (ms?: number) => {
    if (!ms) return '(never)';
    return new Date(ms).toLocaleString();
};

const fieldRowSx = {
    display: 'flex',
    alignItems: 'baseline',
    gap: 2,
    mb: 1,
    '& .label': { minWidth: '160px', color: 'text.secondary' },
    '& .value': { fontFamily: 'monospace', wordBreak: 'break-all' },
};

const Field: React.FC<{ label: string; value: string }> = ({ label, value }) => (
    <Box sx={fieldRowSx}>
        <Typography className="label" variant="body2">
            {label}
        </Typography>
        <Typography className="value" variant="body2">
            {value}
        </Typography>
    </Box>
);

export const CloudPage: React.FC<CloudPageProps> = ({ title, statusArea }) => {
    const cloudConfig = useSelector((s: RootState) => s.cloudConfig);
    const cloudStatus = useSelector((s: RootState) => s.cloudStatus);

    // Reachability is derived from the last poll: a clean reply means we reached the cloud,
    // an error means we didn't, no checks yet means we don't know.
    const reachableLabel =
        cloudStatus.lastCheckedAt === undefined
            ? '(unknown)'
            : cloudStatus.lastError
              ? 'no'
              : 'yes';

    return (
        <Box
            sx={{
                height: '100vh',
                display: 'flex',
                flexDirection: 'column',
                overflow: 'hidden',
            }}
        >
            <Box sx={{ flexShrink: 0, padding: 2 }}>
                <PageHeader heading={title} children={statusArea} />
            </Box>
            <Box sx={{ padding: 2, overflowY: 'auto', flexGrow: 1 }}>
                <Card sx={{ maxWidth: '720px', p: 4, mb: 3 }}>
                    <Typography variant="h6" sx={{ mb: 2, color: 'primary.main' }}>
                        Cloud Configuration
                    </Typography>
                    <Field label="Cloud Service URL" value={cloudConfig.cloudServiceUrl || '(not set)'} />
                    <Field label="Player ID Token" value={cloudConfig.playerIdToken || '(not set)'} />
                </Card>

                <Card sx={{ maxWidth: '720px', p: 4, mb: 3 }}>
                    <Typography variant="h6" sx={{ mb: 2, color: 'primary.main' }}>
                        Cloud Status
                    </Typography>
                    <Field label="Cloud Reachable" value={reachableLabel} />
                    <Field
                        label="Player Registered"
                        value={cloudStatus.playerIdIsRegistered ? 'yes' : 'no'}
                    />
                    <Field label="Cloud Version" value={cloudStatus.cloudVersion ?? '(unknown)'} />
                    <Field label="Last Checked" value={formatTimestamp(cloudStatus.lastCheckedAt)} />
                    <Field label="Last Error" value={cloudStatus.lastError ?? '(none)'} />
                </Card>
            </Box>
        </Box>
    );
};
