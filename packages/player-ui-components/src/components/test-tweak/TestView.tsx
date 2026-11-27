import React, { useMemo, useState } from 'react';
import { Box } from '../box/Box';
import {
    Button,
    Collapse,
    IconButton,
    List,
    ListItemButton,
    Paper,
    Stack,
    Tab,
    Tabs,
    TextField,
    Tooltip,
    Typography,
} from '@mui/material';
import AddIcon from '@mui/icons-material/Add';
import DeleteOutlineIcon from '@mui/icons-material/DeleteOutline';
import EditIcon from '@mui/icons-material/Edit';
import ExpandLessIcon from '@mui/icons-material/ExpandLess';
import ExpandMoreIcon from '@mui/icons-material/ExpandMore';
import TuneIcon from '@mui/icons-material/Tune';
import {
    effectiveTweak,
    isNeutralTweak,
    type ActiveTest,
    type TestTargets,
    type TestTweakDoc,
    type TestTweakSnapshot,
    type TweakModelInfo,
    type XlModelGroup,
} from '@ezplayer/ezplayer-core';
import { GroupEditorDialog, ModelSettingsDialog, XlGroupImportDialog } from './Dialogs';
import { ModelChecklist } from './ModelChecklist';
import { TestPanel } from './TestPanel';
import { tweakChips } from './TweakFields';
import { newId } from './useTestTweak';

export interface TestViewProps {
    doc: TestTweakDoc;
    updateDoc: (change: (doc: TestTweakDoc) => TestTweakDoc) => void;
    snapshot?: TestTweakSnapshot;
    baseUrl?: string;
    loadXlGroups: () => Promise<XlModelGroup[]>;
    startTest: (test: ActiveTest) => Promise<void>;
    stopTest: () => Promise<void>;
    selectedModels: Set<string>;
    onSelectModels: (names: Set<string>) => void;
    selectedSubModels: Set<string>;
    onSelectSubModels: (names: Set<string>) => void;
    /** The group being tested as a whole; null when testing the ticked models. */
    selectedGroup: string | null;
    onSelectGroup: (id: string | null) => void;
    /** The layout preview, which this view places above the pattern controls. */
    preview: React.ReactNode;
}

const count = (n: number, word: string) => `${n} ${word}${n === 1 ? '' : 's'}`;

/**
 * Testing: on the left what to test (a group, or models and submodels ticked
 * one by one), on the right the layout with the pattern controls under it.
 */
export const TestView: React.FC<TestViewProps> = ({
    doc,
    updateDoc,
    snapshot,
    baseUrl,
    loadXlGroups,
    startTest,
    stopTest,
    selectedModels,
    onSelectModels,
    selectedSubModels,
    onSelectSubModels,
    selectedGroup,
    onSelectGroup,
    preview,
}) => {
    const models: TweakModelInfo[] = snapshot?.models ?? [];
    const [tab, setTab] = useState<'groups' | 'models'>(selectedGroup ? 'groups' : 'models');
    const [editing, setEditing] = useState<string | null>(null);
    const [importing, setImporting] = useState(false);
    const [settingsFor, setSettingsFor] = useState<string | null>(null);
    const [saveName, setSaveName] = useState('');
    const [controlsOpen, setControlsOpen] = useState(true);

    const group = selectedGroup ? doc.groups.find((g) => g.id === selectedGroup) : undefined;
    const modelList = useMemo(() => [...selectedModels].sort(), [selectedModels]);
    const subList = useMemo(() => [...selectedSubModels].sort(), [selectedSubModels]);
    const testing = useMemo(() => new Set(snapshot?.status.activeModels ?? []), [snapshot?.status.activeModels]);
    const profileName = (id: string | undefined) => (id ? doc.profiles.find((p) => p.id === id)?.name : undefined);

    // What the test runs on follows the tab in view: the chosen group, or the ticked models.
    const useGroup = tab === 'groups' && !!group;
    const picked = modelList.length + subList.length;
    const targets: TestTargets = useGroup
        ? { groups: [group.id] }
        : { models: modelList, ...(subList.length ? { subModels: subList } : {}) };
    const targetLabel = useGroup
        ? group.models.length + (group.subModels?.length ?? 0)
            ? `group ${group.name}`
            : ''
        : tab === 'groups'
          ? ''
          : picked === 1
            ? (modelList[0] ?? subList[0])
            : !picked
              ? ''
              : !subList.length
                ? count(modelList.length, 'model')
                : !modelList.length
                  ? count(subList.length, 'submodel')
                  : `${count(modelList.length, 'model')} and ${count(subList.length, 'submodel')}`;

    const newGroup = (name: string, members?: { models: string[]; subModels: string[] }) => {
        const id = newId();
        updateDoc((d) => ({
            ...d,
            groups: [
                ...d.groups,
                {
                    id,
                    name,
                    models: members?.models ?? [],
                    ...(members?.subModels.length ? { subModels: members.subModels } : {}),
                },
            ],
        }));
        return id;
    };
    const saveSelection = () => {
        const name = saveName.trim();
        if (!name) return;
        onSelectGroup(newGroup(name, { models: modelList, subModels: subList }));
        setSaveName('');
        setTab('groups');
    };
    const deleteGroup = (id: string) => {
        updateDoc((d) => ({ ...d, groups: d.groups.filter((g) => g.id !== id) }));
        if (selectedGroup === id) onSelectGroup(null);
    };

    return (
        <Box
            sx={{
                flex: 1,
                minHeight: 0,
                display: 'flex',
                flexDirection: { xs: 'column', md: 'row' },
                gap: 2,
                overflowX: 'hidden',
                overflowY: { xs: 'auto', md: 'hidden' },
            }}
        >
            <Paper
                sx={{
                    width: { xs: '100%', md: 320 },
                    height: { xs: 300, md: 'auto' },
                    flexShrink: 0,
                    minHeight: 0,
                    display: 'flex',
                    flexDirection: 'column',
                    overflow: 'hidden',
                }}
            >
                <Tabs
                    value={tab}
                    onChange={(_, v) => setTab(v)}
                    variant="fullWidth"
                    sx={{ flexShrink: 0, borderBottom: 1, borderColor: 'divider', minHeight: 40 }}
                >
                    <Tab value="groups" label={`Groups (${doc.groups.length})`} sx={{ minHeight: 40 }} />
                    <Tab value="models" label={`Models${picked ? ` (${picked})` : ''}`} sx={{ minHeight: 40 }} />
                </Tabs>

                {tab === 'groups' && (
                    <>
                        <Stack
                            direction="row"
                            spacing={0.5}
                            sx={{ p: 1, flexShrink: 0, flexWrap: 'wrap', rowGap: 0.5 }}
                        >
                            <Button
                                size="small"
                                variant="outlined"
                                startIcon={<AddIcon />}
                                onClick={() => {
                                    const id = newGroup(`Group ${doc.groups.length + 1}`);
                                    onSelectGroup(id);
                                    setEditing(id);
                                }}
                            >
                                New group
                            </Button>
                            <Button size="small" onClick={() => setImporting(true)}>
                                From xLights…
                            </Button>
                        </Stack>
                        <List dense disablePadding sx={{ flex: 1, minHeight: 0, overflowY: 'auto' }}>
                            {doc.groups.map((g) => (
                                <ListItemButton
                                    key={g.id}
                                    dense
                                    selected={selectedGroup === g.id}
                                    onClick={() => onSelectGroup(selectedGroup === g.id ? null : g.id)}
                                    sx={{ pr: 0.5 }}
                                >
                                    <Box sx={{ minWidth: 0, flex: 1 }}>
                                        <Typography variant="body2" noWrap title={g.name}>
                                            {g.name}
                                        </Typography>
                                        <Typography
                                            variant="body2"
                                            color="text.secondary"
                                            noWrap
                                            component="div"
                                            sx={{ fontSize: 12 }}
                                        >
                                            {count(g.models.length, 'model')}
                                            {g.subModels?.length ? `, ${count(g.subModels.length, 'submodel')}` : ''}
                                        </Typography>
                                    </Box>
                                    <Tooltip title="Change what is in it, or its name">
                                        <IconButton
                                            size="small"
                                            aria-label={`Edit ${g.name}`}
                                            onClick={(e) => {
                                                e.stopPropagation();
                                                setEditing(g.id);
                                            }}
                                        >
                                            <EditIcon fontSize="small" />
                                        </IconButton>
                                    </Tooltip>
                                    <Tooltip title="Delete the group; its models are not touched">
                                        <IconButton
                                            size="small"
                                            aria-label={`Delete ${g.name}`}
                                            onClick={(e) => {
                                                e.stopPropagation();
                                                deleteGroup(g.id);
                                            }}
                                        >
                                            <DeleteOutlineIcon fontSize="small" />
                                        </IconButton>
                                    </Tooltip>
                                </ListItemButton>
                            ))}
                            {!doc.groups.length && (
                                <Typography variant="body2" color="text.secondary" sx={{ p: 2 }}>
                                    A group is a list of models and submodels to test together. Make one here, copy them
                                    from xLights, or tick models on the other tab and save the selection.
                                </Typography>
                            )}
                        </List>
                    </>
                )}

                {tab === 'models' && (
                    <>
                        <Box sx={{ flex: 1, minHeight: 0 }}>
                            <ModelChecklist
                                models={models}
                                baseUrl={baseUrl}
                                checked={selectedModels}
                                onChange={onSelectModels}
                                checkedSubModels={selectedSubModels}
                                onChangeSubModels={onSelectSubModels}
                                testing={testing}
                                note={(m) => {
                                    const eff = effectiveTweak(doc, m.name);
                                    const chips = isNeutralTweak(eff) ? [] : tweakChips(eff, true);
                                    return [profileName(eff.profile), ...chips].filter(Boolean).join(' ') || undefined;
                                }}
                                action={(m) =>
                                    m.pixel && (
                                        <Tooltip title="This model's profile and output settings">
                                            <IconButton
                                                size="small"
                                                aria-label={`Output settings of ${m.name}`}
                                                onClick={(e) => {
                                                    e.stopPropagation();
                                                    setSettingsFor(m.name);
                                                }}
                                            >
                                                <TuneIcon fontSize="small" />
                                            </IconButton>
                                        </Tooltip>
                                    )
                                }
                            />
                        </Box>
                        <Stack
                            direction="row"
                            spacing={1}
                            sx={{ p: 1, flexShrink: 0, borderTop: 1, borderColor: 'divider' }}
                        >
                            <TextField
                                size="small"
                                fullWidth
                                disabled={!picked}
                                placeholder={picked ? 'Save these as a group named…' : 'Tick models to save a group'}
                                value={saveName}
                                onChange={(e) => setSaveName(e.target.value)}
                                onKeyDown={(e) => e.key === 'Enter' && saveSelection()}
                            />
                            <Button
                                size="small"
                                variant="outlined"
                                disabled={!picked || !saveName.trim()}
                                onClick={saveSelection}
                            >
                                Save
                            </Button>
                        </Stack>
                    </>
                )}
            </Paper>

            <Paper
                sx={{
                    flex: { xs: 'none', md: 1 },
                    minWidth: 0,
                    minHeight: 0,
                    display: 'flex',
                    flexDirection: 'column',
                    overflow: 'hidden',
                }}
            >
                <Box
                    sx={{
                        flex: { xs: 'none', md: 1 },
                        height: { xs: 320, md: 'auto' },
                        minHeight: 160,
                        display: 'flex',
                        flexDirection: 'column',
                    }}
                >
                    {preview}
                </Box>
                <Stack
                    direction="row"
                    alignItems="center"
                    sx={{ borderTop: 1, borderColor: 'divider', flexShrink: 0, pl: 1.5 }}
                >
                    <Typography variant="subtitle2" sx={{ flex: 1 }}>
                        Test pattern
                    </Typography>
                    <IconButton
                        size="small"
                        aria-label={controlsOpen ? 'Hide the pattern controls' : 'Show the pattern controls'}
                        onClick={() => setControlsOpen((o) => !o)}
                    >
                        {controlsOpen ? <ExpandMoreIcon /> : <ExpandLessIcon />}
                    </IconButton>
                </Stack>
                <Collapse in={controlsOpen} sx={{ flexShrink: 0 }}>
                    <Box sx={{ maxHeight: { xs: 'none', md: '38vh' }, overflowY: 'auto', p: 1.5, pt: 0.5 }}>
                        <TestPanel
                            doc={doc}
                            updateDoc={updateDoc}
                            targets={targets}
                            targetLabel={targetLabel}
                            status={snapshot?.status}
                            onStart={startTest}
                            onStop={stopTest}
                        />
                    </Box>
                </Collapse>
            </Paper>

            <GroupEditorDialog
                group={editing ? doc.groups.find((g) => g.id === editing) : undefined}
                onClose={() => setEditing(null)}
                doc={doc}
                updateDoc={updateDoc}
                models={models}
                baseUrl={baseUrl}
                loadXlGroups={loadXlGroups}
            />
            <XlGroupImportDialog
                open={importing}
                onClose={() => setImporting(false)}
                doc={doc}
                updateDoc={updateDoc}
                loadXlGroups={loadXlGroups}
            />
            <ModelSettingsDialog
                model={settingsFor ? models.find((m) => m.name === settingsFor) : undefined}
                onClose={() => setSettingsFor(null)}
                doc={doc}
                updateDoc={updateDoc}
            />
        </Box>
    );
};
