import React, { useMemo, useState } from 'react';
import { Box } from '../box/Box';
import { useSelector } from 'react-redux';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { Alert, Button, Paper, Stack, Tab, Tabs, Typography, useTheme } from '@mui/material';
import StopIcon from '@mui/icons-material/Stop';
import { PageHeader, ExtendedTheme } from '@ezplayer/shared-ui-components';
import { Preview3D } from '../preview-3d/Preview3D';
import { useFrameServerUrl } from '../../hooks/useFrameServerUrl';
import { useFrameBuffer } from '../../hooks/useFrameBuffer';
import { CONTROLLERS } from '../../constants/routes';
import type { RootState } from '../../store/Store';
import { ModelChecklist } from './ModelChecklist';
import { ProfilesView } from './ProfilesView';
import { TestView } from './TestView';
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

type Mode = 'test' | 'profiles' | 'wiring';

/**
 * Test + Tweak, one job at a time:
 *  - Test: pick a group or models, watch them in the layout, run a pattern.
 *  - Profiles: output settings per kind of pixel, and which models use each.
 *  - Wiring: how one model is cut into strings and put on controller ports.
 * A bar under the tabs always says what is being tested and can stop it.
 */
export const TestTweakScreen: React.FC<TestTweakScreenProps> = ({ title, statusArea, compressed = false }) => {
    const theme = useTheme<ExtendedTheme>();
    const navigate = useNavigate();
    const showDirectory = useSelector((state: RootState) => state.auth.showDirectory);
    const { url } = useFrameServerUrl();
    const { snapshot, doc, updateDoc, startTest, stopTest, loadXlGroups, error, saving } = useTestTweak(url);

    // Other screens link here with ?model=Name and ?submodel=Model/Sub (both repeatable) ?view=wiring|profiles, ?group=id and ?profile=id.
    const [params] = useSearchParams();
    const linked = params.getAll('model');
    const view = params.get('view');
    const [mode, setMode] = useState<Mode>(view === 'wiring' ? 'wiring' : view === 'profiles' ? 'profiles' : 'test');
    const [selectedModels, setSelectedModels] = useState<Set<string>>(() => new Set(linked));
    const [selectedSubModels, setSelectedSubModels] = useState<Set<string>>(() => new Set(params.getAll('submodel')));
    const [selectedGroup, setSelectedGroup] = useState<string | null>(params.get('group'));
    const [selectedProfile, setSelectedProfile] = useState<string | null>(params.get('profile'));
    const [wiringModel, setWiringModel] = useState<string | null>(linked[0] ?? null);

    // The preview is only fed while it is on screen.
    const { buffer: liveData } = useFrameBuffer({
        baseUrl: url,
        enabled: !!url && mode === 'test',
        compressed,
        resetKey: showDirectory,
    });

    const models = snapshot?.models ?? [];
    const rewired = useMemo(() => new Set(snapshot?.rewired ?? []), [snapshot?.rewired]);
    const active = snapshot?.status.active;
    const activeNames = snapshot?.status.activeModels ?? [];
    const bar = !!active && mode !== 'test';
    const single = selectedModels.size === 1 && !selectedSubModels.size ? [...selectedModels][0] : null;

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
            <Stack
                direction="row"
                alignItems="center"
                sx={{ px: 2, flexShrink: 0, borderBottom: 1, borderColor: 'divider', flexWrap: 'wrap' }}
            >
                <Tabs value={mode} onChange={(_, v) => setMode(v)} variant="scrollable" scrollButtons="auto">
                    <Tab value="test" label="Test" />
                    <Tab value="profiles" label={`Profiles${doc.profiles.length ? ` (${doc.profiles.length})` : ''}`} />
                    <Tab value="wiring" label={`Wiring${rewired.size ? ` (${rewired.size})` : ''}`} />
                </Tabs>
                <Box sx={{ flex: 1 }} />
                <Typography variant="body2" color="text.secondary" sx={{ fontSize: 12 }}>
                    {saving ? 'Saving…' : snapshot ? 'Saved with the show' : 'Connecting to the player…'}
                </Typography>
            </Stack>
            {(error || bar || !!snapshot?.status.unknownModels?.length) && (
                <Stack spacing={1} sx={{ px: 2, pt: 1, flexShrink: 0 }}>
                    {error && <Alert severity="error">{error}</Alert>}
                    {bar && (
                        <Alert
                            severity="warning"
                            icon={false}
                            sx={{ py: 0, alignItems: 'center' }}
                            action={
                                <Button
                                    color="inherit"
                                    size="small"
                                    startIcon={<StopIcon />}
                                    onClick={() => void stopTest()}
                                >
                                    Stop
                                </Button>
                            }
                        >
                            Test running on{' '}
                            {activeNames.length <= 3
                                ? activeNames.join(', ')
                                : `${activeNames.slice(0, 2).join(', ')} and ${activeNames.length - 2} more`}
                            .
                        </Alert>
                    )}
                    {!!snapshot?.status.unknownModels?.length && (
                        <Alert severity="info" sx={{ py: 0 }}>
                            Saved settings name models this layout does not have:{' '}
                            {snapshot.status.unknownModels.slice(0, 6).join(', ')}
                            {snapshot.status.unknownModels.length > 6 ? '…' : ''}. They are kept in case the models come
                            back.
                        </Alert>
                    )}
                </Stack>
            )}

            <Box sx={{ flex: 1, minHeight: 0, display: 'flex', p: 2, overflow: 'hidden' }}>
                {mode === 'test' && (
                    <TestView
                        doc={doc}
                        updateDoc={updateDoc}
                        snapshot={snapshot}
                        baseUrl={url}
                        loadXlGroups={loadXlGroups}
                        startTest={startTest}
                        stopTest={stopTest}
                        selectedModels={selectedModels}
                        onSelectModels={setSelectedModels}
                        selectedSubModels={selectedSubModels}
                        onSelectSubModels={setSelectedSubModels}
                        selectedGroup={selectedGroup}
                        onSelectGroup={setSelectedGroup}
                        preview={
                            <Preview3D
                                mode="embedded"
                                selectableModels
                                selectedModelName={single}
                                onSelectedModelChange={(name) => {
                                    if (!name) return;
                                    setSelectedModels(new Set([name]));
                                    setSelectedSubModels(new Set());
                                }}
                                showList={false}
                                showControls={true}
                                frameServerUrl={url}
                                liveData={liveData}
                                compact={compressed}
                                previewSettingsStorageKey={TEST_TWEAK_PREVIEW_STORAGE_KEY}
                                defaultViewMode="2d"
                            />
                        }
                    />
                )}

                {mode === 'profiles' && (
                    <ProfilesView
                        doc={doc}
                        updateDoc={updateDoc}
                        snapshot={snapshot}
                        loadXlGroups={loadXlGroups}
                        startTest={startTest}
                        selectedProfile={selectedProfile}
                        onSelectProfile={setSelectedProfile}
                    />
                )}

                {mode === 'wiring' && (
                    <Box
                        sx={{
                            flex: 1,
                            minHeight: 0,
                            display: 'flex',
                            flexDirection: { xs: 'column', md: 'row' },
                            gap: 2,
                            overflow: 'hidden',
                        }}
                    >
                        <Paper
                            sx={{
                                width: { xs: '100%', md: 280 },
                                height: { xs: '35%', md: 'auto' },
                                flexShrink: 0,
                                minHeight: 0,
                                overflow: 'hidden',
                            }}
                        >
                            <ModelChecklist
                                single
                                models={models}
                                checked={new Set(wiringModel ? [wiringModel] : [])}
                                onChange={(next) => setWiringModel([...next][0] ?? null)}
                                note={(m) =>
                                    [
                                        m.controller ? `${m.controller}${m.port ? `:${m.port}` : ''}` : 'no controller',
                                        rewired.has(m.name) ? 'rewired here' : undefined,
                                    ]
                                        .filter(Boolean)
                                        .join(' · ')
                                }
                            />
                        </Paper>
                        <Paper sx={{ flex: 1, minWidth: 0, minHeight: 0, overflow: 'auto' }}>
                            <WiringPanel
                                doc={doc}
                                updateDoc={updateDoc}
                                models={models}
                                controllers={snapshot?.controllers ?? []}
                                selectedModels={wiringModel ? [wiringModel] : []}
                                problems={snapshot?.problems ?? []}
                                rewired={snapshot?.rewired ?? []}
                                onSelectModel={setWiringModel}
                                onOpenControllers={() => navigate(CONTROLLERS)}
                            />
                        </Paper>
                    </Box>
                )}
            </Box>
        </Box>
    );
};
