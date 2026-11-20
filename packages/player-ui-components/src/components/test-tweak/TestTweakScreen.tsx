import React, { useMemo, useState } from 'react';
import { Box } from '../box/Box';
import { useSelector } from 'react-redux';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { Alert, Paper, Stack, Tab, Tabs, Typography, useTheme } from '@mui/material';
import { PageHeader, ExtendedTheme } from '@ezplayer/shared-ui-components';
import type { TestTargets } from '@ezplayer/ezplayer-core';
import { Preview3D } from '../preview-3d/Preview3D';
import { useFrameServerUrl } from '../../hooks/useFrameServerUrl';
import { useFrameBuffer } from '../../hooks/useFrameBuffer';
import { CONTROLLERS } from '../../constants/routes';
import type { RootState } from '../../store/Store';
import { TargetPanel } from './TargetPanel';
import { TestPanel } from './TestPanel';
import { TweakPanel } from './TweakPanel';
import { WiringPanel } from './WiringPanel';
import { useTestTweak } from './useTestTweak';

/** Its own preview settings, so the camera here does not move the Show View's. */
export const TEST_TWEAK_PREVIEW_STORAGE_KEY = 'previewSettingsTestTweak';

export interface TestTweakScreenProps {
    title: string;
    statusArea?: React.ReactNode[];
    /** Fetch compressed preview frames (remote / embedded UIs). */
    compressed?: boolean;
}

const Card: React.FC<{ title: string; children: React.ReactNode }> = ({ title, children }) => (
    <Paper variant="outlined" sx={{ p: 1.5 }}>
        <Typography variant="subtitle2" sx={{ mb: 1 }}>
            {title}
        </Typography>
        {children}
    </Paper>
);

/**
 * Test + Tweak: pick models or a group on the left, watch them in the layout
 * (or edit their wiring) in the middle, and run test patterns and adjust
 * color order, brightness, gamma and color temperature on the right.
 */
export const TestTweakScreen: React.FC<TestTweakScreenProps> = ({ title, statusArea, compressed = false }) => {
    const theme = useTheme<ExtendedTheme>();
    const navigate = useNavigate();
    const showDirectory = useSelector((state: RootState) => state.auth.showDirectory);
    const { url } = useFrameServerUrl();
    const { buffer: liveData } = useFrameBuffer({ baseUrl: url, enabled: !!url, compressed, resetKey: showDirectory });
    const { snapshot, doc, updateDoc, startTest, stopTest, error, saving } = useTestTweak(url);

    // Other screens link here with ?model=Name (repeatable) and ?view=wiring.
    const [params] = useSearchParams();
    const [selectedModels, setSelectedModels] = useState<Set<string>>(() => new Set(params.getAll('model')));
    const [selectedGroup, setSelectedGroup] = useState<string | null>(null);
    const [view, setView] = useState<'layout' | 'wiring'>(params.get('view') === 'wiring' ? 'wiring' : 'layout');

    const models = snapshot?.models ?? [];
    const group = selectedGroup ? doc.groups.find((g) => g.id === selectedGroup) : undefined;
    const selectedList = useMemo(() => [...selectedModels].sort(), [selectedModels]);

    const targets: TestTargets = group ? { groups: [group.id] } : { models: selectedList };
    const targetLabel = group
        ? group.models.length
            ? `group ${group.name} (${group.models.length} model${group.models.length === 1 ? '' : 's'})`
            : ''
        : selectedList.length === 1
          ? selectedList[0]
          : selectedList.length
            ? `${selectedList.length} models`
            : '';

    const selectOne = (name: string) => {
        setSelectedModels(new Set([name]));
        setSelectedGroup(null);
    };

    return (
        <Box
            sx={{
                display: 'flex',
                flexDirection: 'column',
                height: '100vh',
                width: '100%',
                overflow: 'hidden',
                position: 'fixed',
                top: 0,
                left: 0,
                right: 0,
                bottom: 0,
                [theme.breakpoints.up('lg')]: {
                    left: theme.sidebar?.width || '252px',
                    width: `calc(100% - ${theme.sidebar?.width || '252px'})`,
                },
            }}
        >
            <Box sx={{ padding: 2, paddingBottom: 0, flexShrink: 0 }}>
                <PageHeader heading={title} children={statusArea} />
            </Box>
            {(error || snapshot?.status.unknownModels?.length) && (
                <Stack spacing={1} sx={{ px: 2, pt: 1, flexShrink: 0 }}>
                    {error && <Alert severity="error">{error}</Alert>}
                    {!!snapshot?.status.unknownModels?.length && (
                        <Alert severity="info">
                            Saved tweaks name models this layout does not have:{' '}
                            {snapshot.status.unknownModels.slice(0, 6).join(', ')}
                            {snapshot.status.unknownModels.length > 6 ? '…' : ''}. They are kept in case the models come
                            back.
                        </Alert>
                    )}
                </Stack>
            )}
            <Box sx={{ flex: 1, minHeight: 0, display: 'flex', gap: 2, p: 2, overflow: 'hidden' }}>
                <Paper
                    sx={{
                        width: 320,
                        flexShrink: 0,
                        minHeight: 0,
                        overflow: 'hidden',
                        display: { xs: 'none', sm: 'block' },
                    }}
                >
                    <TargetPanel
                        doc={doc}
                        updateDoc={updateDoc}
                        models={models}
                        rewired={snapshot?.rewired ?? []}
                        testing={snapshot?.status.activeModels ?? []}
                        selectedModels={selectedModels}
                        onSelectModels={setSelectedModels}
                        selectedGroup={selectedGroup}
                        onSelectGroup={setSelectedGroup}
                    />
                </Paper>

                <Paper
                    sx={{
                        flex: 1,
                        minWidth: 0,
                        minHeight: 0,
                        display: 'flex',
                        flexDirection: 'column',
                        overflow: 'hidden',
                    }}
                >
                    <Stack
                        direction="row"
                        alignItems="center"
                        sx={{ borderBottom: 1, borderColor: 'divider', flexShrink: 0, pr: 2 }}
                    >
                        <Tabs value={view} onChange={(_, v) => setView(v)}>
                            <Tab value="layout" label="Layout" />
                            <Tab
                                value="wiring"
                                label={`Wiring${snapshot?.rewired.length ? ` (${snapshot.rewired.length})` : ''}`}
                            />
                        </Tabs>
                        <Box sx={{ flex: 1 }} />
                        <Typography variant="caption" color="text.secondary">
                            {saving ? 'Saving…' : snapshot ? 'Saved with the show' : 'Connecting to the player…'}
                        </Typography>
                    </Stack>
                    {view === 'layout' && (
                        <Box sx={{ flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column' }}>
                            <Preview3D
                                mode="embedded"
                                selectableModels
                                selectedModelName={selectedList.length === 1 && !group ? selectedList[0] : null}
                                onSelectedModelChange={(name) => name && selectOne(name)}
                                showList={false}
                                showControls={true}
                                frameServerUrl={url}
                                liveData={liveData}
                                compact={compressed}
                                previewSettingsStorageKey={TEST_TWEAK_PREVIEW_STORAGE_KEY}
                                defaultViewMode="2d"
                            />
                        </Box>
                    )}
                    {view === 'wiring' && (
                        <Box sx={{ flex: 1, minHeight: 0, overflow: 'auto' }}>
                            <WiringPanel
                                doc={doc}
                                updateDoc={updateDoc}
                                models={models}
                                controllers={snapshot?.controllers ?? []}
                                selectedModels={group ? [] : selectedList}
                                problems={snapshot?.problems ?? []}
                                rewired={snapshot?.rewired ?? []}
                                onSelectModel={selectOne}
                                onOpenControllers={() => navigate(CONTROLLERS)}
                            />
                        </Box>
                    )}
                </Paper>

                <Stack spacing={2} sx={{ width: 340, flexShrink: 0, minHeight: 0, overflowY: 'auto', pr: 0.5 }}>
                    <Card title="Test pattern">
                        <TestPanel
                            doc={doc}
                            updateDoc={updateDoc}
                            targets={targets}
                            targetLabel={targetLabel}
                            status={snapshot?.status}
                            onStart={startTest}
                            onStop={stopTest}
                        />
                    </Card>
                    <Card title="Tweak">
                        <TweakPanel
                            doc={doc}
                            updateDoc={updateDoc}
                            models={models}
                            selectedModels={group ? [] : selectedList}
                            group={group}
                        />
                    </Card>
                </Stack>
            </Box>
        </Box>
    );
};
