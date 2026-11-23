import { describe, expect, it } from 'vitest';
import { compileLayout, LayoutModelSpec } from './Layout';
import { decodeOverlayPacket, OverlayManager, packetizeOverlayFrame } from './Overlays';

const RGB = [
    { offset: 0, kind: 'red' as const },
    { offset: 1, kind: 'green' as const },
    { offset: 2, kind: 'blue' as const },
];

function show() {
    const specs: LayoutModelSpec[] = [
        { name: 'Strip', startChannel: 0, nodeCount: 10, channelsPerNode: 3, roles: RGB },
        {
            name: 'Matrix',
            startChannel: 30,
            nodeCount: 6,
            channelsPerNode: 3,
            roles: RGB,
            // 3 wide, 2 high, wired vertically: node i -> (x = i/2, y = i%2)
            grid: { width: 3, height: 2, xy: Int32Array.from([0, 0, 0, 1, 1, 0, 1, 1, 2, 0, 2, 1]) },
        },
    ];
    return compileLayout(specs);
}

describe('OverlayManager', () => {
    it('opens a grid lease on a matrix and composites top-first rows into bottom-first canonical order', () => {
        const layout = show();
        const ov = new OverlayManager(layout);
        expect(ov.targets()).toEqual([
            { model: 'Strip', nodeCount: 10, width: undefined, height: undefined },
            { model: 'Matrix', nodeCount: 6, width: 3, height: 2 },
        ]);
        const lease = ov.open({ model: 'Matrix' }, 1000);
        expect(lease.format).toBe('grid');
        expect(lease.width).toBe(3);
        expect(lease.height).toBe(2);
        expect(lease.frameBytes).toBe(18);
        // Top row red, bottom row blue.
        const payload = new Uint8Array(18);
        for (let x = 0; x < 3; ++x) {
            payload[x * 3] = 255; // top row
            payload[9 + x * 3 + 2] = 255; // bottom row
        }
        expect(ov.write(lease.id, lease.token, 1, 0, payload, true, 1001)).toBe(true);
        const frame = new Uint8Array(layout.frameBytes);
        ov.composite(frame, layout.pixelStride);
        const m = layout.models[1];
        const node = (n: number) => Array.from(frame.subarray((m.nodeStart + n) * 3, (m.nodeStart + n) * 3 + 3));
        // canonical row 0 is the bottom row (blue), row 1 the top (red)
        expect(node(0)).toEqual([0, 0, 255]);
        expect(node(2)).toEqual([0, 0, 255]);
        expect(node(3)).toEqual([255, 0, 0]);
        expect(node(5)).toEqual([255, 0, 0]);
        // Strip untouched
        expect(frame[0]).toBe(0);
    });

    it('rejects a bad token, expires, and blends with opacity', () => {
        const layout = show();
        const ov = new OverlayManager(layout);
        const lease = ov.open({ model: 'Strip', format: 'nodes', blend: 'max', opacity: 0.5, ttlMs: 1000 }, 0);
        const payload = new Uint8Array(30).fill(200);
        expect(ov.write(lease.id, lease.token ^ 1, 1, 0, payload, true, 10)).toBe(false);
        expect(ov.write(lease.id, lease.token, 1, 0, payload, true, 10)).toBe(true);
        const frame = new Uint8Array(layout.frameBytes);
        frame[0] = 150; // brighter than the 50% overlay
        ov.composite(frame, 3);
        expect(frame[0]).toBe(150);
        expect(frame[1]).toBe(100);
        expect(ov.expire(500)).toEqual([]);
        expect(ov.expire(1011)).toEqual([lease.id]);
        expect(ov.size).toBe(0);
    });

    it('resamples a grid onto a strip and assembles fragments', () => {
        const layout = show();
        const ov = new OverlayManager(layout);
        const lease = ov.open({ model: 'Strip', format: 'grid', width: 5, height: 1 }, 0);
        const payload = new Uint8Array(15);
        for (let x = 0; x < 5; ++x) payload[x * 3 + 1] = (x + 1) * 40;
        const packets = packetizeOverlayFrame(lease.id, lease.token, 7, payload);
        expect(packets.length).toBe(1);
        const p = decodeOverlayPacket(packets[0])!;
        expect(p.last).toBe(true);
        expect(p.seq).toBe(7);
        // Deliver as two fragments.
        expect(ov.write(lease.id, lease.token, 7, 0, payload.subarray(0, 6), false, 1)).toBe(false);
        expect(ov.write(lease.id, lease.token, 7, 6, payload.subarray(6), true, 1)).toBe(true);
        const frame = new Uint8Array(layout.frameBytes);
        ov.composite(frame, 3);
        // 5 cells over 10 nodes: each cell lights two nodes.
        expect(frame[1]).toBe(40);
        expect(frame[4]).toBe(40);
        expect(frame[7]).toBe(80);
        expect(frame[28]).toBe(200);
    });

    it('resamples a coarse grid over a matrix, top row first', () => {
        const layout = show();
        const ov = new OverlayManager(layout);
        // 1x2 payload on the 3x2 matrix: top cell red, bottom cell green.
        const lease = ov.open({ model: 'Matrix', width: 1, height: 2 }, 0);
        expect(ov.write(lease.id, lease.token, 1, 0, Uint8Array.from([255, 0, 0, 0, 255, 0]), true, 0)).toBe(true);
        const frame = new Uint8Array(layout.frameBytes);
        ov.composite(frame, 3);
        const m = layout.models[1];
        const node = (n: number) => Array.from(frame.subarray((m.nodeStart + n) * 3, (m.nodeStart + n) * 3 + 3));
        expect(node(0)).toEqual([0, 255, 0]); // bottom row
        expect(node(4)).toEqual([255, 0, 0]); // top row
    });

    it('packetizes large payloads with the commit flag on the last packet', () => {
        const payload = new Uint8Array(3000);
        const packets = packetizeOverlayFrame(3, 9, 1, payload);
        expect(packets.length).toBe(3);
        const decoded = packets.map((p) => decodeOverlayPacket(p)!);
        expect(decoded.map((d) => d.last)).toEqual([false, false, true]);
        expect(decoded.map((d) => d.offset)).toEqual([0, 1400, 2800]);
        expect(decoded[2].data.length).toBe(200);
    });
});
