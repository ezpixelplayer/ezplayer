import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { FSEQReaderAsync, FSEQReaderSync } from './FSeqUtil';
import { buildExtendedHeaders, compressExtended, readExtendedText, XL_NETWORKS_HEADER, XL_RGBEFFECTS_HEADER } from './FSeqExtended';
import { decodeDescriptorHeader, descriptorFromEmbeddedXlights, encodeDescriptorHeader, EZ_DESCRIPTOR_HEADER, peekDescriptorPrefix } from '../pipeline/Descriptor';
import { compileInputMap, applyInputMap, inputMapProgram, descriptorHash, ChannelDescriptor } from '../pipeline/InputMap';
import { compileLayout, LayoutModelSpec } from '../pipeline/Layout';
import { FSeqPrefetchCache } from './FSeqPrefetcher';

const RGBEFFECTS = `<?xml version="1.0" encoding="UTF-8"?>
<xrgb>
  <models>
    <model name="Line1" DisplayAs="Single Line" StringType="GRB Nodes" parm1="1" parm2="10" parm3="1" StartChannel="!Moc:1" Dir="L" LayoutGroup="Default" Controller="Moc" WorldPosX="0" WorldPosY="0" WorldPosZ="0" ScaleX="1" ScaleY="1" ScaleZ="1" RotateX="0" RotateY="0" RotateZ="0" versionNumber="7" StartSide="B"/>
    <model name="Line2" DisplayAs="Single Line" StringType="RGB Nodes" parm1="1" parm2="5" parm3="1" StartChannel="!Moc:31" Dir="L" LayoutGroup="Default" Controller="Moc" WorldPosX="0" WorldPosY="1" WorldPosZ="0" ScaleX="1" ScaleY="1" ScaleZ="1" RotateX="0" RotateY="0" RotateZ="0" versionNumber="7" StartSide="B"/>
  </models>
  <layoutGroups/>
  <viewpoints/>
  <colors/>
  <view_objects/>
</xrgb>
`;
const NETWORKS = `<?xml version="1.0" encoding="UTF-8"?>
<Networks computer="test" GlobalFPPProxy="" GlobalForceLocalIP="" AutoUpdateFromBase="0" BaseShowDir="">
  <Controller Id="1" Name="Moc" Description="" Type="Ethernet" Vendor="FPP" Model="" Variant="" AutoSize="1" FromBase="0" ActiveState="Active" AutoLayout="1" AutoUpload="0" SuppressDuplicates="0" Monitor="0" IP="127.0.0.1" Protocol="DDP" FPPProxy="" Priority="100" Version="1" Expanded="FALSE" UPS="FALSE" ForceLocalIP="">
    <network ChannelsPerPacket="1440" KeepChannelNumbers="1" ComPort="127.0.0.1" BaudRate="1" NetworkType="DDP" MaxChannels="48"/>
  </Controller>
</Networks>
`;

/** FSEQ v2 with uncompressed frames and extended headers after the channel data, as xLights lays it out. */
function writeFseqWithExtended(file: string, channels: number, frames: number, extended: { code: string; data: Uint8Array }[], fill: (f: number, ch: Uint8Array) => void) {
    const stepSize = channels; // frames are never padded

    const inlineBytes = 18 * extended.length;
    const headerLen = Math.ceil((32 + 8 + inlineBytes) / 4) * 4;
    const dataStart = headerLen + frames * stepSize;
    const { inline, tail } = buildExtendedHeaders(extended, dataStart);
    const hdr = Buffer.alloc(headerLen);
    hdr.write('PSEQ', 0, 'ascii');
    hdr.writeUInt16LE(headerLen, 4);
    hdr.writeUInt8(2, 6); // minor 2: extended data allowed
    hdr.writeUInt8(2, 7);
    hdr.writeUInt16LE(40, 8);
    hdr.writeUInt32LE(channels, 10);
    hdr.writeUInt32LE(frames, 14);
    hdr.writeUInt8(50, 18);
    hdr.writeUInt8(0, 19);
    hdr.writeUInt8(0, 20);
    hdr.writeUInt8(1, 21);
    hdr.writeUInt8(0, 22);
    hdr.writeUInt8(0, 23);
    hdr.writeUInt32LE(0x11, 24);
    hdr.writeUInt32LE(0x22, 28);
    hdr.writeUInt32LE(0, 32);
    hdr.writeUInt32LE(frames * stepSize, 36);
    hdr.set(inline, 40);
    const data = Buffer.alloc(frames * stepSize);
    const ch = new Uint8Array(channels);
    for (let f = 0; f < frames; ++f) {
        ch.fill(0);
        fill(f, ch);
        data.set(ch, f * stepSize);
    }
    fs.writeFileSync(file, Buffer.concat([hdr, data, Buffer.from(tail)]));
}

describe('extended fseq headers', () => {
    let dir: string;
    beforeAll(() => {
        dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ezp-ext-'));
    });
    afterAll(() => {
        fs.rmSync(dir, { recursive: true, force: true });
    });

    it('parses ED entries with both readers and reads the embedded xLights files back', async () => {
        const file = path.join(dir, 'xl.fseq');
        writeFseqWithExtended(
            file,
            48,
            3,
            [
                { code: XL_RGBEFFECTS_HEADER, data: compressExtended(new TextEncoder().encode(RGBEFFECTS)) },
                { code: XL_NETWORKS_HEADER, data: compressExtended(new TextEncoder().encode(NETWORKS)) },
            ],
            (f, ch) => ch.fill(f + 1),
        );
        const hdr = await FSEQReaderAsync.readFSEQHeaderAsync(file);
        expect(Object.keys(hdr.extendedHeaders).sort()).toEqual(['XN', 'XR']);
        expect(hdr.headers).toEqual({});
        expect(await readExtendedText(file, hdr, 'XR')).toBe(RGBEFFECTS);
        expect(await readExtendedText(file, hdr, 'XN')).toBe(NETWORKS);

        const sync = new FSEQReaderSync(file);
        await sync.open();
        await sync.readHeader();
        expect(sync.header!.extendedHeaders.XR).toEqual(hdr.extendedHeaders.XR);
        await sync.close();

        // Frames are untouched by the tail.
        const rdr = new FSEQReaderAsync(file);
        await rdr.open();
        expect((await rdr.readFrame(2))[0]).toBe(3);
        await rdr.close();
    });

    it('derives a descriptor from embedded XR/XN and decodes GRB accordingly', () => {
        const desc = descriptorFromEmbeddedXlights(RGBEFFECTS, NETWORKS);
        expect(desc.source).toBe('xlights');
        expect(desc.curvesApplied).toBe(true);
        expect(desc.totalChannels).toBe(48);
        expect(desc.models.map((m) => [m.name, m.startChannel, m.nodeCount])).toEqual([
            ['Line1', 0, 10],
            ['Line2', 30, 5],
        ]);
        const line1 = desc.models[0];
        expect(line1.roles.find((r) => r.kind === 'red')!.offset).toBe(1);

        // Current layout has Line1 as RGB: the file's GRB must be swapped on ingest.
        const layoutSpecs: LayoutModelSpec[] = [
            { name: 'Line1', startChannel: 0, nodeCount: 10, channelsPerNode: 3, roles: [{ offset: 0, kind: 'red' }, { offset: 1, kind: 'green' }, { offset: 2, kind: 'blue' }] },
        ];
        const layout = compileLayout(layoutSpecs, { channelCeiling: 48 });
        const map = inputMapProgram(compileInputMap(desc, layout));
        const src = new Uint8Array(48);
        src.set([10, 20, 30], 0);
        const dst = new Uint8Array(layout.frameBytes);
        applyInputMap(map, src, 0, dst, 0);
        expect(Array.from(dst.subarray(0, 3))).toEqual([20, 10, 30]);
    });

    it('round-trips an EZ descriptor header and honors its flags', () => {
        const desc: ChannelDescriptor = {
            totalChannels: 30,
            models: [{ name: 'M', startChannel: 0, nodeCount: 10, channelsPerNode: 3, roles: [{ offset: 0, kind: 'green' }, { offset: 1, kind: 'red' }, { offset: 2, kind: 'blue' }], gamma: 2.2 }],
            curvesApplied: false,
            colorOrderApplied: false,
            nodeOrder: 'canonical',
        };
        const bytes = encodeDescriptorHeader(desc);
        const prefix = peekDescriptorPrefix(bytes)!;
        expect(prefix.fingerprint).toBe(descriptorHash(desc));
        expect(prefix.modelCount).toBe(1);
        expect(prefix.curvesApplied).toBe(false);
        expect(prefix.colorOrderApplied).toBe(false);
        expect(prefix.nodeOrder).toBe('canonical');
        const back = decodeDescriptorHeader(bytes)!;
        expect(back.models).toEqual(desc.models);
        expect(back.source).toBe('header');
        expect(peekDescriptorPrefix(new Uint8Array(20))).toBeUndefined();

        // Flags: plain RGB despite the GRB string type, no curve inversion, no grid permutation.
        const layout = compileLayout([
            { name: 'M', startChannel: 0, nodeCount: 10, channelsPerNode: 3, roles: desc.models[0].roles, grid: { width: 5, height: 2, xy: Int32Array.from([0, 0, 0, 1, 1, 0, 1, 1, 2, 0, 2, 1, 3, 0, 3, 1, 4, 0, 4, 1]) } },
        ]);
        const map = compileInputMap(back, layout);
        expect(map.inverted).toEqual([]);
        const src = new Uint8Array(30);
        src.set([1, 2, 3, 4, 5, 6], 0);
        const dst = new Uint8Array(layout.frameBytes);
        applyInputMap(inputMapProgram(map), src, 0, dst, 0);
        expect(Array.from(dst.subarray(0, 6))).toEqual([1, 2, 3, 4, 5, 6]);
        // Same descriptor with defaults: GRB is honored and the grid is permuted.
        const plain = compileInputMap({ totalChannels: 30, models: desc.models }, layout);
        expect(plain.inverted).toEqual(['M']);
        expect(plain.id).not.toBe(map.id);
    });

    it('serves canonical frames from a file carrying EZ, and notices a rewrite', async () => {
        const file = path.join(dir, 'ez.fseq');
        const desc: ChannelDescriptor = {
            totalChannels: 12,
            models: [{ name: 'A', startChannel: 0, nodeCount: 4, channelsPerNode: 3, roles: [{ offset: 0, kind: 'red' }, { offset: 1, kind: 'green' }, { offset: 2, kind: 'blue' }] }],
        };
        const write = (v: number) =>
            writeFseqWithExtended(file, 12, 2, [{ code: EZ_DESCRIPTOR_HEADER, data: encodeDescriptorHeader(desc) }], (_f, ch) => ch.fill(v));
        write(7);
        const layout = compileLayout([{ name: 'A', startChannel: 0, nodeCount: 4, channelsPerNode: 3, roles: desc.models[0].roles }]);
        let seenSource = '';
        const cache = new FSeqPrefetchCache(
            {
                now: 0,
                canonicalizer: async (f, hdr) => {
                    const ref = hdr.extendedHeaders[EZ_DESCRIPTOR_HEADER];
                    const { readExtendedHeader } = await import('./FSeqExtended');
                    const d = decodeDescriptorHeader(await readExtendedHeader(f, ref))!;
                    seenSource = d.source!;
                    return (await import('../pipeline/InputMap')).sharedInputMapProgram(compileInputMap(d, layout));
                },
            },
            (m) => {
                throw new Error(m);
            },
            () => {},
        );
        const settle = async (ms: number) => {
            const t0 = Date.now();
            while (Date.now() - t0 < ms) {
                cache.dispatch();
                await new Promise((r) => setTimeout(r, 10));
            }
        };
        cache.prefetchSeqFrames({ fseqfile: file, startFrame: 0, nFrames: 2, needByTime: 0 });
        await settle(800);
        cache.prefetchSeqFrames({ fseqfile: file, startFrame: 0, nFrames: 2, needByTime: 0 });
        await settle(300);
        let f = cache.getFrame(file, { num: 1 });
        expect(f?.ref?.frame?.[0]).toBe(7);
        expect(seenSource).toBe('header');
        f!.ref!.release();

        // Re-render under the same name: the identity check drops the stale frames.
        await new Promise((r) => setTimeout(r, 20));
        write(9);
        fs.utimesSync(file, new Date(), new Date(Date.now() + 5000));
        cache.setNow(10_000);
        cache.checkFileIdentity(file, 0);
        await settle(300);
        cache.prefetchSeqFrames({ fseqfile: file, startFrame: 0, nFrames: 2, needByTime: 0 });
        await settle(800);
        cache.prefetchSeqFrames({ fseqfile: file, startFrame: 0, nFrames: 2, needByTime: 0 });
        await settle(300);
        f = cache.getFrame(file, { num: 1 });
        expect(f?.ref?.frame?.[0]).toBe(9);
        f!.ref!.release();
        await cache.shutdown();
    });
});
