import React, { useMemo, useState } from 'react';
import { Box } from '../box/Box';
import { useSelector } from 'react-redux';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { Alert, Badge, IconButton, Stack, Tooltip, useMediaQuery, useTheme } from '@mui/material';
import PaletteOutlinedIcon from '@mui/icons-material/PaletteOutlined';
import ScienceOutlinedIcon from '@mui/icons-material/ScienceOutlined';
import StopCircleIcon from '@mui/icons-material/StopCircle';
import { PageHeader, ExtendedTheme } from '@ezplayer/shared-ui-components';
import type { TestTargets, TweakModelInfo } from '@ezplayer/ezplayer-core';
import { Preview3D } from '../preview-3d/Preview3D';
import { useFrameServerUrl } from '../../hooks/useFrameServerUrl';
import { useFrameBuffer } from '../../hooks/useFrameBuffer';
import { CONTROLLERS } from '../../constants/routes';
import type { RootState } from '../../store/Store';
import { ModelSettingsDialog } from './Dialogs';
import { NewProfileDialog, ProfilesDialog } from './ProfileDialogs';
import { SelectionPanel, type SelectionTab } from './SelectionPanel';
import { TestPatternDialog } from './TestPatternDialog';
import { WiringDialog } from './WiringDialog';
import { useTestTweak } from './useTestTweak';

/** Its own preview settings, so the camera here does not move the Show View's. */
export const TEST_TWEAK_PREVIEW_STORAGE_KEY = 'previewSettingsTestTweak';

export interface TestTweakScreenProps {
    title: string;
    statusArea?: React.ReactNode[];
    /** Fetch compressed preview frames (remote / embedded UIs). */
    compressed?: boolean;
}

const count = (n: number, word: string) => `${n} ${word}${n === 1 ? '' : 's'}`;

/**
 * Test + Tweak.  The layout fills the screen and stays there; everything
 * else comes to it:
 *  - what to test, in a panel that opens at the right from its tool button;
 *  - the test pattern, in a panel floating over the bottom;
 *  - output profiles, one model's settings and a model's wiring, in dialogs.
 */
export const TestTweakScreen: React.FC<TestTweakScreenProps> = ({ title, statusArea, compressed = false }) => {
    const theme = useTheme<ExtendedTheme>();
    const navigate = useNavigate();
    // The list starts open, except on a phone, where it would cover the layout. Asked without the
    // server-render pass, so the very first render already knows.
    const roomForList = useMediaQuery(theme.breakpoints.up('sm'), { noSsr: true });
    const showDirectory = useSelector((state: RootState) => state.auth.showDirectory);
    const { url } = useFrameServerUrl();
    const { snapshot, doc, updateDoc, startTest, stopTest, loadXlGroups, error, saving } = useTestTweak(url);

    // Other screens link here with ?model=Name and ?submodel=Model/Sub (both repeatable), ?group=id, ?profile=id
    // and ?view= one of pattern, profiles, newprofile, settings (of the first model) and wiring (of the first model).
    const [params] = useSearchParams();
    const linked = params.getAll('model');
    const view = params.get('view');
    const [tab, setTab] = useState<SelectionTab>(params.get('group') ? 'groups' : 'models');
    const [selectedModels, setSelectedModels] = useState<Set<string>>(() => new Set(linked));
    const [selectedSubModels, setSelectedSubModels] = useState<Set<string>>(() => new Set(params.getAll('submodel')));
    const [selectedGroup, setSelectedGroup] = useState<string | null>(params.get('group'));
    const [selectedProfile, setSelectedProfile] = useState<string | null>(params.get('profile'));
    const [focus, setFocus] = useState<string | null>(linked[0] ?? null);

    const [patternOpen, setPatternOpen] = useState(view === 'pattern');
    const [profilesOpen, setProfilesOpen] = useState(view === 'profiles' || !!params.get('profile'));
    const [settingsFor, setSettingsFor] = useState<string | null>(view === 'settings' ? (linked[0] ?? null) : null);
    // undefined: closed. null: open with no model picked yet.
    const [wiringFor, setWiringFor] = useState<string | null | undefined>(
        view === 'wiring' ? (linked[0] ?? null) : undefined,
    );
    const [newProfile, setNewProfile] = useState<{ from?: TweakModelInfo } | null>(null);
    const [linkedNewProfile, setLinkedNewProfile] = useState(view === 'newprofile');

    const { buffer: liveData } = useFrameBuffer({
        baseUrl: url,
        enabled: !!url,
        compressed,
        resetKey: showDirectory,
    });

    const models = useMemo(() => snapshot?.models ?? [], [snapshot?.models]);
    const rewired = useMemo(() => new Set(snapshot?.rewired ?? []), [snapshot?.rewired]);
    const active = snapshot?.status.active;
    const activeNames = snapshot?.status.activeModels ?? [];
    const single = selectedModels.size === 1 && !selectedSubModels.size ? [...selectedModels][0] : null;

    // What a test runs on follows the list in view: the chosen group, or the ticked models.
    const group = selectedGroup ? doc.groups.find((g) => g.id === selectedGroup) : undefined;
    const modelList = useMemo(() => [...selectedModels].sort(), [selectedModels]);
    const subList = useMemo(() => [...selectedSubModels].sort(), [selectedSubModels]);
    const useGroup = tab === 'groups' && !!group;
    const picked = modelList.length + subList.length;
    const targets: TestTargets = useGroup
        ? { groups: [group.id] }
        : { models: modelList, ...(subList.length ? { subModels: subList } : {}) };
    const targetLabel = useGroup
        ? group.models.length + (group.subModels?.length ?? 0)
            ? `group ${group.name}`
            : ''
        : tab === 'groups' || !picked
          ? ''
          : picked === 1
            ? (modelList[0] ?? subList[0])
            : !subList.length
              ? count(modelList.length, 'model')
              : !modelList.length
                ? count(subList.length, 'submodel')
                : `${count(modelList.length, 'model')} and ${count(subList.length, 'submodel')}`;

    const pickInLayout = (name: string | null) => {
        if (!name) return;
        setSelectedModels(new Set([name]));
        setSelectedSubModels(new Set());
        setTab('models');
        setFocus(name);
    };

    const toolbarExtras = (
        <>
            {active && (
                <Tooltip
                    title={`Stop the test on ${
                        activeNames.length <= 3
                            ? activeNames.join(', ')
                            : `${activeNames.slice(0, 2).join(', ')} and ${activeNames.length - 2} more`
                    }`}
                >
                    <IconButton size="small" color="warning" aria-label="Stop the test" onClick={() => void stopTest()}>
                        <StopCircleIcon />
                    </IconButton>
                </Tooltip>
            )}
            <Tooltip title={patternOpen ? 'Hide the test pattern controls' : 'Test pattern'}>
                <IconButton
                    size="small"
                    aria-label="Test pattern"
                    color={patternOpen ? 'primary' : 'default'}
                    onClick={() => setPatternOpen((o) => !o)}
                >
                    <Badge color="warning" variant="dot" invisible={!active}>
                        <ScienceOutlinedIcon />
                    </Badge>
                </IconButton>
            </Tooltip>
            <Tooltip title="Output profiles: color order, brightness, gamma and color temperature per kind of pixel">
                <IconButton size="small" aria-label="Output profiles" onClick={() => setProfilesOpen(true)}>
                    <PaletteOutlinedIcon />
                </IconButton>
            </Tooltip>
        </>
    );

    const settingsModel = settingsFor ? models.find((m) => m.name === settingsFor) : undefined;

    // A link to "new profile" waits for the player's model list, which the suggestions are made from.
    if (linkedNewProfile && snapshot) {
        setLinkedNewProfile(false);
        setNewProfile({ from: models.find((m) => m.name === linked[0]) });
    }

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
            {(error || !!snapshot?.status.unknownModels?.length) && (
                <Stack spacing={1} sx={{ px: 2, pt: 1, flexShrink: 0 }}>
                    {error && <Alert severity="error">{error}</Alert>}
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

            {/* Gap lives inside the clipping box so the panel's top shadow isn't cut off. */}
            <Box sx={{ flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column', p: 2, overflow: 'hidden' }}>
                <Box
                    sx={{
                        flex: 1,
                        minHeight: 0,
                        display: 'flex',
                        flexDirection: 'column',
                        backgroundColor: 'background.paper',
                        borderRadius: 2,
                        overflow: 'hidden',
                        boxShadow: 3,
                        border: (t) => `1px solid ${t.palette.divider}`,
                    }}
                >
                    <Preview3D
                        mode="embedded"
                        allowExpand
                        selectableModels
                        selectedModelName={single}
                        onSelectedModelChange={pickInLayout}
                        // A selected model is painted over and has its wiring drawn; while a test runs, let the test show.
                        selectionStrength={active ? 0.25 : 1}
                        // The pattern here is the real one, on the lights.
                        hideRainbowToggle
                        showList
                        initialShowList={roomForList}
                        sidePanelLabel="what to test"
                        renderSidePanel={({ close }) => (
                            <SelectionPanel
                                doc={doc}
                                updateDoc={updateDoc}
                                snapshot={snapshot}
                                baseUrl={url}
                                loadXlGroups={loadXlGroups}
                                tab={tab}
                                onTab={setTab}
                                selectedModels={selectedModels}
                                onSelectModels={setSelectedModels}
                                selectedSubModels={selectedSubModels}
                                onSelectSubModels={setSelectedSubModels}
                                selectedGroup={selectedGroup}
                                onSelectGroup={setSelectedGroup}
                                focus={focus}
                                onModelSettings={setSettingsFor}
                                onClose={close}
                            />
                        )}
                        toolbarExtras={toolbarExtras}
                        showControls={true}
                        frameServerUrl={url}
                        liveData={liveData}
                        compact={compressed}
                        previewSettingsStorageKey={TEST_TWEAK_PREVIEW_STORAGE_KEY}
                        defaultViewMode="2d"
                    />
                </Box>
            </Box>

            <TestPatternDialog
                open={patternOpen}
                onClose={() => setPatternOpen(false)}
                doc={doc}
                updateDoc={updateDoc}
                targets={targets}
                targetLabel={targetLabel}
                status={snapshot?.status}
                onStart={startTest}
                onStop={stopTest}
            />
            <ProfilesDialog
                open={profilesOpen}
                onClose={() => setProfilesOpen(false)}
                doc={doc}
                updateDoc={updateDoc}
                models={models}
                loadXlGroups={loadXlGroups}
                startTest={startTest}
                selectedProfile={selectedProfile}
                onSelectProfile={setSelectedProfile}
                onNewProfile={() => setNewProfile({})}
                onModelSettings={setSettingsFor}
            />
            <ModelSettingsDialog
                model={settingsModel}
                onClose={() => setSettingsFor(null)}
                doc={doc}
                updateDoc={updateDoc}
                rewired={!!settingsModel && rewired.has(settingsModel.name)}
                onNewProfile={(m) => setNewProfile({ from: m })}
                onEditProfile={(id) => {
                    setSelectedProfile(id);
                    setSettingsFor(null);
                    setProfilesOpen(true);
                }}
                onRewire={(m) => {
                    setSettingsFor(null);
                    setWiringFor(m.name);
                }}
            />
            <NewProfileDialog
                open={!!newProfile}
                onClose={() => setNewProfile(null)}
                onCreated={setSelectedProfile}
                doc={doc}
                updateDoc={updateDoc}
                models={models}
                fromModel={newProfile?.from}
            />
            <WiringDialog
                open={wiringFor !== undefined}
                onClose={() => setWiringFor(undefined)}
                model={wiringFor}
                doc={doc}
                updateDoc={updateDoc}
                snapshot={snapshot}
                onOpenControllers={() => navigate(CONTROLLERS)}
            />
            {saving && (
                <Box
                    sx={{
                        position: 'absolute',
                        left: 24,
                        bottom: 22,
                        px: 1,
                        borderRadius: 1,
                        fontSize: 12,
                        color: 'text.secondary',
                        backgroundColor: 'background.paper',
                        opacity: 0.85,
                        pointerEvents: 'none',
                    }}
                >
                    Saving…
                </Box>
            )}
        </Box>
    );
};
