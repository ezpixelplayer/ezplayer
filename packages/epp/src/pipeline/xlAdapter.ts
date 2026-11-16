/*
 * Bridges xllayoutcalcs' view of a show (model channel info plus node
 * geometry) into the layout compiler's inputs, and handles the channel
 * descriptor a sequence file is pinned to.
 */

import type { GetNodeResult, XlModelChannelInfo, ChannelRole } from 'xllayoutcalcs';
import { ChannelRoleSpec, LayoutModelSpec, NodeRun } from './Layout';
import { ChannelDescriptor, ChannelDescriptorModel, compareDescriptorModels } from './InputMap';

function rolesFromRgbOffsets(m: XlModelChannelInfo): ChannelRoleSpec[] {
    const cpn = m.nodeCount > 0 ? Math.round(m.channelCount / m.nodeCount) : 3;
    if (m.simple && cpn === 3) {
        return [
            { offset: m.rgbOffsets.r, kind: 'red' },
            { offset: m.rgbOffsets.g, kind: 'green' },
            { offset: m.rgbOffsets.b, kind: 'blue' },
        ];
    }
    return [];
}

function rolesFromChannelRoles(roles: ChannelRole[] | undefined): ChannelRoleSpec[] | undefined {
    if (!roles || !roles.length) return undefined;
    return roles.map((r) => ({ offset: r.offset, kind: r.kind, tint: r.tint }));
}

/** True when a model type is laid out as a 2D grid worth storing row-major. */
function isGridType(displayAs: string | undefined): boolean {
    const d = (displayAs ?? '').toLowerCase();
    return d.includes('matrix') || d.includes('tree');
}

/**
 * Build layout specs from the parsed xLights documents. `coords` (from
 * getAllModelCoordinates) supplies channel roles, node runs, grid geometry
 * and world coordinates when present; without it models are treated by
 * their rgbOffsets alone.
 */
export function layoutSpecsFromXlights(models: XlModelChannelInfo[], coords?: Map<string, GetNodeResult>): LayoutModelSpec[] {
    const specs: LayoutModelSpec[] = [];
    for (const m of models) {
        if (m.channelCount <= 0 || m.nodeCount <= 0) continue;
        const c = coords?.get(m.name);
        const cpn = Math.max(1, Math.round(m.channelCount / m.nodeCount));
        const roles = rolesFromChannelRoles(c?.channelRoles) ?? rolesFromRgbOffsets(m);
        const spec: LayoutModelSpec = {
            name: m.name,
            startChannel: m.startChannel - 1,
            nodeCount: m.nodeCount,
            channelsPerNode: cpn,
            roles,
            gamma: m.gamma,
            brightness: m.brightness,
            outputGamma: m.controllerConnection?.gamma,
            outputBrightness: m.controllerConnection?.brightness !== undefined ? m.controllerConnection.brightness / 100 : undefined,
            outputColorOrder: m.controllerConnection?.colorOrder,
        };
        const mapping = c?.channelMapping;
        if (mapping && mapping.nodeChannelMap.length) {
            const runs: NodeRun[] = mapping.nodeChannelMap.map((r) => ({
                nodeStart: r.nodeStart,
                nodeCount: r.nodeCount,
                channelStart: r.channelStart,
            }));
            const covered = runs.reduce((a, r) => a + r.nodeCount, 0);
            if (covered === m.nodeCount) spec.runs = runs;
        } else if (m.stringStartChannels.length > 1 && m.stringNodeCounts.length === m.stringStartChannels.length) {
            const runs: NodeRun[] = [];
            let node = 0;
            for (let i = 0; i < m.stringStartChannels.length; ++i) {
                runs.push({ nodeStart: node, nodeCount: m.stringNodeCounts[i], channelStart: m.stringStartChannels[i] - 1 });
                node += m.stringNodeCounts[i];
            }
            if (node === m.nodeCount) spec.runs = runs;
        }
        if (c && c.nodes.length === m.nodeCount) {
            if (isGridType(c.modelType ?? m.displayAs) && c.logicalBufferWidth * c.logicalBufferHeight === m.nodeCount) {
                const xy = new Int32Array(m.nodeCount * 2);
                let ok = true;
                for (let i = 0; i < m.nodeCount; ++i) {
                    const n = c.nodes[i];
                    if (n.coords.length !== 1) {
                        ok = false;
                        break;
                    }
                    xy[i * 2] = n.coords[0].bufX;
                    xy[i * 2 + 1] = n.coords[0].bufY;
                }
                if (ok) spec.grid = { width: c.logicalBufferWidth, height: c.logicalBufferHeight, xy };
            }
            const world = new Float32Array(m.nodeCount * 3);
            for (let i = 0; i < m.nodeCount; ++i) {
                const k = c.nodes[i].coords[0];
                if (!k) continue;
                world[i * 3] = k.wX;
                world[i * 3 + 1] = k.wY;
                world[i * 3 + 2] = k.wZ;
            }
            spec.world = world;
        }
        specs.push(spec);
    }
    return specs;
}

/** Runs that only restate the contiguous span carry no information. */
function runsAreContiguous(s: LayoutModelSpec): boolean {
    return !s.runs || s.runs.every((r) => r.channelStart === s.startChannel + r.nodeStart * s.channelsPerNode);
}

/**
 * The descriptor a file rendered against the current layout would carry:
 * pin-on-first-sight. Canonical: models in canonical order, runs only when
 * they differ from contiguous, gamma and brightness only when not 1, so a
 * renderer's body and the player's are byte-identical.
 */
export function descriptorFromSpecs(specs: LayoutModelSpec[], totalChannels: number, source = 'pinned'): ChannelDescriptor {
    const models: ChannelDescriptorModel[] = specs.map((s) => {
        const m: ChannelDescriptorModel = {
            name: s.name,
            startChannel: s.startChannel,
            nodeCount: s.nodeCount,
            channelsPerNode: s.channelsPerNode,
            roles: s.roles,
        };
        if (s.runs && !runsAreContiguous(s)) m.runs = s.runs;
        if (s.gamma !== undefined && s.gamma !== 1) m.gamma = s.gamma;
        if (s.brightness !== undefined && s.brightness !== 1) m.brightness = s.brightness;
        return m;
    });
    models.sort(compareDescriptorModels);
    return { totalChannels, models, source };
}

