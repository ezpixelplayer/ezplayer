import React, { useMemo, useState } from 'react';
import { Box } from '../box/Box';
import {
    Button,
    IconButton,
    List,
    ListItemButton,
    Stack,
    Tab,
    Tabs,
    TextField,
    Tooltip,
    Typography,
} from '@mui/material';
import AddIcon from '@mui/icons-material/Add';
import CloseIcon from '@mui/icons-material/Close';
import DeleteOutlineIcon from '@mui/icons-material/DeleteOutline';
import EditIcon from '@mui/icons-material/Edit';
import LightbulbOutlinedIcon from '@mui/icons-material/LightbulbOutlined';
import TuneIcon from '@mui/icons-material/Tune';
import WorkspacesOutlinedIcon from '@mui/icons-material/WorkspacesOutlined';
import {
    effectiveTweak,
    isNeutralTweak,
    type TestTweakDoc,
    type TestTweakSnapshot,
    type TweakModelInfo,
    type XlModelGroup,
} from '@ezplayer/ezplayer-core';
import { GroupEditorDialog, XlGroupImportDialog } from './Dialogs';
import { ModelChecklist, type ModelFacet } from './ModelChecklist';
import { tweakChips } from './TweakFields';
import { newId } from './useTestTweak';

export type SelectionTab = 'groups' | 'models';

export interface SelectionPanelProps {
    doc: TestTweakDoc;
    updateDoc: (change: (doc: TestTweakDoc) => TestTweakDoc) => void;
    snapshot?: TestTweakSnapshot;
    baseUrl?: string;
    loadXlGroups: () => Promise<XlModelGroup[]>;
    /** Which list is in view; a test runs on what that list has picked. */
    tab: SelectionTab;
    onTab: (tab: SelectionTab) => void;
    selectedModels: Set<string>;
    onSelectModels: (names: Set<string>) => void;
    selectedSubModels: Set<string>;
    onSelectSubModels: (names: Set<string>) => void;
    /** The group being tested as a whole; null for none. */
    selectedGroup: string | null;
    onSelectGroup: (id: string | null) => void;
    /** The model last picked in the layout, to bring into view. */
    focus?: string | null;
    /** Open a model's profile, output settings and wiring. */
    onModelSettings: (model: string) => void;
    onClose?: () => void;
}

const count = (n: number, word: string) => `${n} ${word}${n === 1 ? '' : 's'}`;

/**
 * What to test: a group, or models and submodels ticked one by one.  Sits at
 * the right of the layout and opens and closes from its tool button.
 */
export const SelectionPanel: React.FC<SelectionPanelProps> = ({
    doc,
    updateDoc,
    snapshot,
    baseUrl,
    loadXlGroups,
    tab,
    onTab,
    selectedModels,
    onSelectModels,
    selectedSubModels,
    onSelectSubModels,
    selectedGroup,
    onSelectGroup,
    focus,
    onModelSettings,
    onClose,
}) => {
    const models: TweakModelInfo[] = snapshot?.models ?? [];
    const [editing, setEditing] = useState<string | null>(null);
    const [importing, setImporting] = useState(false);
    const [saveName, setSaveName] = useState('');

    const modelList = useMemo(() => [...selectedModels].sort(), [selectedModels]);
    const subList = useMemo(() => [...selectedSubModels].sort(), [selectedSubModels]);
    const testing = useMemo(() => new Set(snapshot?.status.activeModels ?? []), [snapshot?.status.activeModels]);
    const picked = modelList.length + subList.length;
    const profileName = (id: string | undefined) => (id ? doc.profiles.find((p) => p.id === id)?.name : undefined);
    const facets = useMemo<ModelFacet[]>(
        () => [
            {
                label: 'Profile',
                of: (m) => {
                    const id = doc.models[m.name]?.profile;
                    return (id && doc.profiles.find((p) => p.id === id)?.name) || 'No profile';
                },
            },
        ],
        [doc.models, doc.profiles],
    );

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
        onTab('groups');
    };
    const deleteGroup = (id: string) => {
        updateDoc((d) => ({ ...d, groups: d.groups.filter((g) => g.id !== id) }));
        if (selectedGroup === id) onSelectGroup(null);
    };

    return (
        <Box sx={{ display: 'flex', flexDirection: 'column', height: '100%', minHeight: 0 }}>
            <Stack direction="row" alignItems="center" sx={{ flexShrink: 0, borderBottom: 1, borderColor: 'divider' }}>
                <Tabs
                    value={tab}
                    onChange={(_, v) => onTab(v)}
                    variant="fullWidth"
                    sx={{ flex: 1, minHeight: 44, '& .MuiTab-root': { minHeight: 44, textTransform: 'none' } }}
                >
                    <Tab
                        value="groups"
                        icon={<WorkspacesOutlinedIcon fontSize="small" />}
                        iconPosition="start"
                        label={`Groups (${doc.groups.length})`}
                    />
                    <Tab
                        value="models"
                        icon={<LightbulbOutlinedIcon fontSize="small" />}
                        iconPosition="start"
                        label={`Models${picked ? ` (${picked})` : ''}`}
                    />
                </Tabs>
                {onClose && (
                    <IconButton size="small" aria-label="Close the list" onClick={onClose} sx={{ mx: 0.5 }}>
                        <CloseIcon fontSize="small" />
                    </IconButton>
                )}
            </Stack>

            {tab === 'groups' && (
                <>
                    <Stack direction="row" spacing={0.5} sx={{ p: 1, flexShrink: 0, flexWrap: 'wrap', rowGap: 0.5 }}>
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
                            Add group
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
                                A group is a list of models and submodels to test together. Add one here, copy them from
                                xLights, or tick models on the other tab and save the selection.
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
                            focus={focus}
                            facets={facets}
                            note={(m) => {
                                const eff = effectiveTweak(doc, m.name);
                                const chips = isNeutralTweak(eff) ? [] : tweakChips(eff, true);
                                return [profileName(eff.profile), ...chips].filter(Boolean).join(' ') || undefined;
                            }}
                            action={(m) =>
                                m.pixel && (
                                    <Tooltip title="This model's profile, output settings and wiring">
                                        <IconButton
                                            size="small"
                                            aria-label={`Settings of ${m.name}`}
                                            onClick={(e) => {
                                                e.stopPropagation();
                                                onModelSettings(m.name);
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
        </Box>
    );
};
