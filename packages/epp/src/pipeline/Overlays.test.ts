import { describe, expect, it } from 'vitest';
import { compileLayout, LayoutModelSpec } from './Layout';
import { decodeOverlayPacket, OverlayConflictError, OverlayManager, packetizeOverlayFrame } from './Overlays';

const RGB = [
    { offset: 0, kind: 'red' as const },
    { offset: 1, kind: 'green' as const },
    { offset: 2, kind: 'blue' as const },
];

/** The strip's even nodes 0, 2 and 4 as a submodel, so its nodes are not one run. */
const EVENS = {
    name: 'Evens',
    nodes: Int32Array.from([0, 2, 4]),
    strands: [3],
    vertical: false,
    bufferStyle: 'Default',
    buffer: { width: 3, height: 1, cells: Int32Array.from([0, 0, 0, 1, 1, 0, 2, 2, 0]) },
};

function specs(): LayoutModelSpec[] {
    return [
        { name: 'Strip', startChannel: 0, nodeCount: 10, channelsPerNode: 3, roles: RGB, subModels: [EVENS] },
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
}

function show() {
    return compileLayout(specs());
}

const X = { mode: 'exclusive' as const, name: 'test' };

describe('OverlayManager', () => {
    it('opens a grid lease on a matrix and composites top-first rows into bottom-first canonical order', () => {
        const layout = show();
        const ov = new OverlayManager(layout);
        expect(ov.targets()).toEqual([
            { model: 'Strip', nodeCount: 10, width: undefined, height: undefined },
            { model: 'Matrix', nodeCount: 6, width: 3, height: 2 },
        ]);
        const lease = ov.open({ ...X, model: 'Matrix' }, 1000);
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
        const lease = ov.open({ ...X, model: 'Strip', format: 'nodes', blend: 'max', opacity: 0.5, ttlMs: 1000 }, 0);
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
        const lease = ov.open({ ...X, model: 'Strip', format: 'grid', width: 5, height: 1 }, 0);
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
        const lease = ov.open({ ...X, model: 'Matrix', width: 1, height: 2 }, 0);
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

describe('exclusive leases', () => {
    it('needs a mode and a name', () => {
        const ov = new OverlayManager(show());
        expect(() => ov.open({ model: 'Strip', name: 'x' } as never, 0)).toThrow(/mode/);
        expect(() => ov.open({ model: 'Strip', mode: 'exclusive', name: '  ' }, 0)).toThrow(/name/);
        expect(ov.size).toBe(0);
    });

    it('refuses a second exclusive lease on the model and names the holder', () => {
        const ov = new OverlayManager(show());
        const race = ov.open(
            { model: 'Matrix', mode: 'exclusive', name: 'race-to-the-star', owner: { instance: 'race-front', title: 'Race Front Tree' } },
            0,
        );
        let err: unknown;
        try {
            ov.open({ model: 'Matrix', mode: 'exclusive', name: 'tetris' }, 0);
        } catch (e) {
            err = e;
        }
        expect(err).toBeInstanceOf(OverlayConflictError);
        const conflict = err as OverlayConflictError;
        expect(conflict.heldBy.id).toBe(race.id);
        expect(conflict.target).toBe('Matrix');
        // The instance title names the holder; without an owner it would be the lease name.
        expect(conflict.message).toBe('Matrix is in use by Race Front Tree');
        expect(ov.size).toBe(1);
        // Another model is free, and so is this one once the holder is gone.
        ov.open({ model: 'Strip', mode: 'exclusive', name: 'other' }, 0);
        ov.close(race.id);
        const tetris = ov.open({ model: 'Matrix', mode: 'exclusive', name: 'tetris' }, 0);
        expect(tetris.mode).toBe('exclusive');
        expect(tetris.owner).toBeUndefined();
        expect(() => ov.open({ model: 'Matrix', mode: 'exclusive', name: 'another' }, 0)).toThrow('Matrix is in use by tetris');
    });

    it('frees the nodes when the holder expires', () => {
        const ov = new OverlayManager(show());
        ov.open({ model: 'Matrix', mode: 'exclusive', name: 'crashed game', ttlMs: 1000 }, 0);
        expect(() => ov.open({ model: 'Matrix', mode: 'exclusive', name: 'next' }, 500)).toThrow(OverlayConflictError);
        expect(ov.expire(1001).length).toBe(1);
        ov.open({ model: 'Matrix', mode: 'exclusive', name: 'next' }, 1001);
    });

    it('lets layers through in both directions', () => {
        const ov = new OverlayManager(show());
        ov.open({ model: 'Matrix', mode: 'layer', name: 'glow' }, 0);
        ov.open({ model: 'Matrix', mode: 'exclusive', name: 'tetris' }, 0);
        ov.open({ model: 'Matrix', mode: 'layer', name: 'sparkle' }, 0);
        ov.open({ mode: 'layer', name: 'whole display wash' }, 0);
        expect(ov.size).toBe(4);
    });

    it('counts the display, a model and its submodel as the same nodes', () => {
        const layout = show();
        const ov = new OverlayManager(layout, specs());
        const evens = ov.open({ model: 'Strip/Evens', mode: 'exclusive', name: 'evens' }, 0);
        expect(evens.nodeStart).toBe(-1);
        expect(() => ov.open({ model: 'Strip', mode: 'exclusive', name: 'strip' }, 0)).toThrow('Strip is in use by evens');
        expect(() => ov.open({ mode: 'exclusive', name: 'all' }, 0)).toThrow('The display is in use by evens');
        // The matrix shares no node with the submodel.
        const matrix = ov.open({ model: 'Matrix', mode: 'exclusive', name: 'matrix' }, 0);
        ov.close(evens.id);
        expect(() => ov.open({ mode: 'exclusive', name: 'all' }, 0)).toThrow('The display is in use by matrix');
        ov.close(matrix.id);
        ov.open({ mode: 'exclusive', name: 'all' }, 0);
        expect(() => ov.open({ model: 'Strip/Evens', mode: 'exclusive', name: 'evens' }, 0)).toThrow('Strip/Evens is in use by all');
    });
});
