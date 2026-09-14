/*
 * Layout descriptors in fseq files.
 *
 * `EZ` extended header: a 16-byte prefix followed by the descriptor as
 * zstd-compressed JSON. The prefix is enough to pick a cached Input Map.
 *
 *   0  'EZLD'          4   magic
 *   4  u8 version      1   descriptor format (1)
 *   5  u8 flags        1   bit0 curvesApplied, bit1 colorOrderApplied, bit2 canonical node order
 *   6  u16 reserved
 *   8  u32 fingerprint     descriptorHash of the model table
 *   12 u32 modelCount
 *   16 ...              zstd(JSON ChannelDescriptor)
 */

import { DOMParser } from '@xmldom/xmldom';
import { getAllModelCoordinates, getControllersAndModelChannels, migrateToFormat, type GetNodeResult, type ModelParseOptions } from 'xllayoutcalcs';
import { compressExtended, decompressExtended } from '../formats/FSeqExtended';
import { ChannelDescriptor, descriptorHash } from './InputMap';
import { descriptorFromSpecs, layoutSpecsFromXlights } from './xlAdapter';

export const EZ_DESCRIPTOR_HEADER = 'EZ';
export const EZ_DESCRIPTOR_VERSION = 1;
export const EZ_PREFIX_BYTES = 16;
const EZ_MAGIC = 0x455a4c44; // 'EZLD'

export interface DescriptorPrefix {
    version: number;
    curvesApplied: boolean;
    colorOrderApplied: boolean;
    nodeOrder: 'xlights' | 'canonical';
    fingerprint: number;
    modelCount: number;
}

export function encodeDescriptorHeader(desc: ChannelDescriptor): Uint8Array {
    const json = new TextEncoder().encode(JSON.stringify(stripForHeader(desc)));
    const body = compressExtended(json);
    const out = new Uint8Array(EZ_PREFIX_BYTES + body.length);
    const dv = new DataView(out.buffer);
    dv.setUint32(0, EZ_MAGIC);
    dv.setUint8(4, EZ_DESCRIPTOR_VERSION);
    dv.setUint8(5, (desc.curvesApplied ? 1 : 0) | (desc.colorOrderApplied ? 2 : 0) | (desc.nodeOrder === 'canonical' ? 4 : 0));
    dv.setUint16(6, 0);
    dv.setUint32(8, descriptorHash(desc));
    dv.setUint32(12, desc.models.length);
    out.set(body, EZ_PREFIX_BYTES);
    return out;
}

function stripForHeader(desc: ChannelDescriptor): ChannelDescriptor {
    // Keep the header self-contained but free of per-player bookkeeping.
    const { source: _source, fingerprint: _fp, ...rest } = desc;
    return rest;
}

/** Read the prefix only; undefined when the bytes are not an EZ descriptor. */
export function peekDescriptorPrefix(bytes: Uint8Array): DescriptorPrefix | undefined {
    if (bytes.length < EZ_PREFIX_BYTES) return undefined;
    const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    if (dv.getUint32(0) !== EZ_MAGIC) return undefined;
    const flags = dv.getUint8(5);
    return {
        version: dv.getUint8(4),
        curvesApplied: (flags & 1) !== 0,
        colorOrderApplied: (flags & 2) !== 0,
        nodeOrder: flags & 4 ? 'canonical' : 'xlights',
        fingerprint: dv.getUint32(8),
        modelCount: dv.getUint32(12),
    };
}

export function decodeDescriptorHeader(bytes: Uint8Array): ChannelDescriptor | undefined {
    const prefix = peekDescriptorPrefix(bytes);
    if (!prefix || prefix.version !== EZ_DESCRIPTOR_VERSION) return undefined;
    try {
        const json = new TextDecoder('utf-8').decode(decompressExtended(bytes.subarray(EZ_PREFIX_BYTES)));
        const d = JSON.parse(json) as ChannelDescriptor;
        if (!d || !Array.isArray(d.models) || typeof d.totalChannels !== 'number') return undefined;
        d.source = 'header';
        d.fingerprint = prefix.fingerprint;
        d.curvesApplied = prefix.curvesApplied;
        d.colorOrderApplied = prefix.colorOrderApplied;
        d.nodeOrder = prefix.nodeOrder;
        return d;
    } catch {
        return undefined;
    }
}

/**
 * Derive a descriptor from the xLights show files a file carries (`XR` and
 * `XN`). The data was rendered by xLights: curves and color order applied,
 * xLights node order.
 */
export function descriptorFromEmbeddedXlights(
    rgbeffectsXml: string,
    networksXml: string,
    opts?: ModelParseOptions & { logger?: (msg: string) => void },
): ChannelDescriptor {
    const parser = new DOMParser();
    const xrgb = parser.parseFromString(rgbeffectsXml, 'text/xml');
    const xnet = parser.parseFromString(networksXml, 'text/xml');
    if (xrgb.documentElement?.tagName !== 'xrgb') throw new Error('embedded rgbeffects: root is not xrgb');
    if (xnet.documentElement?.tagName !== 'Networks') throw new Error('embedded networks: root is not Networks');
    migrateToFormat(xrgb, 'x2026_3');
    const parseOpts: ModelParseOptions = { warnUnusedAttrs: false, ...opts };
    const parsed = getControllersAndModelChannels(xrgb, xnet, parseOpts);
    const coords = new Map<string, GetNodeResult>();
    try {
        const all = getAllModelCoordinates(xrgb, xnet, false, parseOpts);
        for (const [name, m] of all.models) coords.set(name, m.nodeResult);
    } catch (e) {
        opts?.logger?.(`embedded layout: node geometry unavailable (${(e as Error).message}); using channel info only`);
    }
    const specs = layoutSpecsFromXlights(parsed.models, coords);
    let totalChannels = 0;
    for (const c of parsed.controllers) totalChannels = Math.max(totalChannels, c.startChannel - 1 + c.maxChannels);
    for (const s of specs) totalChannels = Math.max(totalChannels, s.startChannel + s.nodeCount * s.channelsPerNode);
    const desc = descriptorFromSpecs(specs, totalChannels, 'xlights');
    desc.curvesApplied = true;
    desc.colorOrderApplied = true;
    desc.nodeOrder = 'xlights';
    desc.fingerprint = descriptorHash(desc);
    return desc;
}
