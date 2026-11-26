import { describe, expect, it } from 'vitest';
import { compileLayout, LayoutModelSpec } from './Layout';
import { OverlayManager, PatternLeaseSpec } from './Overlays';

const RGB = [
    { offset: 0, kind: 'red' as const },
    { offset: 1, kind: 'green' as const },
    { offset: 2, kind: 'blue' as const },
];

/** Two strips along x: A at x = 0..40, B at x = 100..140, five nodes each, ten units apart. */
function specs(): LayoutModelSpec[] {
    const world = (x0: number) => Float32Array.from([0, 1, 2, 3, 4].flatMap((i) => [x0 + i * 10, 0, 0]));
    return [
        { name: 'A', startChannel: 0, nodeCount: 5, channelsPerNode: 3, roles: RGB, world: world(0) },
        { name: 'B', startChannel: 15, nodeCount: 5, channelsPerNode: 3, roles: RGB, world: world(100) },
    ];
}

// Nodes pack by channel, so B starts at canonical node 16 and the frame holds 32 nodes.
const layout = () => compileLayout(specs(), { keepWorld: true });
const B0 = 16;
const frameOf = (fill = 0) => new Uint8Array(32 * 3).fill(fill);
const L = { mode: 'layer' as const, name: 'test' };
const uniforms = (u: object) => new TextEncoder().encode(JSON.stringify(u));

describe('pattern leases', () => {
    it('paints a wipe over two models from their world coordinates and takes uniform updates', () => {
        const ov = new OverlayManager(layout());
        const lease = ov.open(
            {
                ...L,
                models: ['A', 'B'],
                pattern: { preset: 'wipe', uniforms: { offset: 120, width: 15, color: '#ff0000' } },
            },
            1000,
        );
        expect(lease.format).toBe('pattern');
        expect(lease.channels).toBe(4);
        expect(lease.models).toEqual(['A', 'B']);
        expect(lease.nodeCount).toBe(10);
        expect(lease.nodeStart).toBe(-1);
        expect(lease.frameBytes).toBe(0);
        expect(lease.blend).toBe('over');
        expect(lease.pattern).toMatchObject({ preset: 'wipe', backend: 'js' });
        expect(lease.pattern!.uniforms.offset).toBe(120);
        const frame = frameOf();
        ov.composite(frame, 3, 1000);
        // Only B's node at x = 120 is at the band's center; 110 and 130 are two thirds faded.
        const red = (node: number) => frame[node * 3];
        expect(red(B0 + 2)).toBe(255);
        expect(red(B0 + 1)).toBe(Math.round(255 / 3));
        expect(red(B0 + 3)).toBe(Math.round(255 / 3));
        expect(red(0)).toBe(0);
        expect(red(4)).toBe(0);
        // Move the band onto A with a uniform update; B goes dark.
        expect(ov.write(lease.id, lease.token, 1, 0, uniforms({ offset: 20 }), true, 2000)).toBe(true);
        expect(lease.frames).toBe(1);
        frame.fill(0);
        ov.composite(frame, 3, 2000);
        expect(red(2)).toBe(255);
        expect(red(B0 + 2)).toBe(0);
        // Bad JSON and a wrong shape are refused and change nothing.
        expect(ov.write(lease.id, lease.token, 2, 0, new TextEncoder().encode('{nope'), true, 2000)).toBe(false);
        expect(ov.write(lease.id, lease.token, 3, 0, uniforms({ offset: [1, 2] }), true, 2000)).toBe(false);
        expect(lease.pattern!.uniforms.offset).toBe(20);
    });

    it('blends with alpha: over fades the frame, add brightens it, and a zero-alpha node leaves it alone', () => {
        const ov = new OverlayManager(layout());
        const over = ov.open(
            { ...L, model: 'A', pattern: { preset: 'solid', uniforms: { color: '#ffffff', opacity: 0.5 } } },
            0,
        );
        const frame = frameOf(100);
        ov.composite(frame, 3, 0);
        // 100 * 0.5 + 255 * 0.5
        expect(frame[0]).toBe(178);
        expect(frame[B0 * 3]).toBe(100);
        ov.close(over.id);
        ov.open(
            {
                ...L,
                model: 'A',
                blend: 'add',
                pattern: { preset: 'solid', uniforms: { color: '#ffffff', opacity: 0.5 } },
            },
            0,
        );
        frame.fill(100);
        ov.composite(frame, 3, 0);
        expect(frame[0]).toBe(228);
        ov.close(ov.list()[0].id);
        ov.open({ ...L, model: 'A', pattern: { preset: 'solid', uniforms: { opacity: 0 } } }, 0);
        frame.fill(100);
        ov.composite(frame, 3, 0);
        expect(frame[0]).toBe(100);
    });

    it('takes RGBA payloads on grid and nodes leases', () => {
        const ov = new OverlayManager(layout());
        const lease = ov.open({ ...L, model: 'A', format: 'nodes', channels: 4 }, 0);
        expect(lease.frameBytes).toBe(20);
        expect(lease.blend).toBe('over');
        const payload = new Uint8Array(20);
        payload.set([255, 0, 0, 255], 0); // node 0 opaque red
        payload.set([0, 0, 255, 128], 4); // node 1 half blue
        // nodes 2..4 transparent
        expect(ov.write(lease.id, lease.token, 1, 0, payload, true, 0)).toBe(true);
        const frame = frameOf(60);
        ov.composite(frame, 3, 0);
        expect([...frame.subarray(0, 3)]).toEqual([255, 0, 0]);
        expect([...frame.subarray(3, 6)]).toEqual([30, 30, 158]);
        expect([...frame.subarray(6, 9)]).toEqual([60, 60, 60]);
        // An RGB payload on the same lease shape is still 15 bytes and replaces.
        const rgb = ov.open({ ...L, model: 'B', format: 'nodes' }, 0);
        expect(rgb.frameBytes).toBe(15);
        expect(rgb.channels).toBe(3);
        expect(rgb.blend).toBe('replace');
    });

    it('hands the backend the node coordinates and disposes it with the lease', () => {
        const seen: PatternLeaseSpec[] = [];
        let disposed = 0;
        const ov = new OverlayManager(layout(), undefined, {
            patternBackend: (spec) => {
                seen.push(spec);
                return { backend: 'fake', render: (_u, _t, out) => out.fill(255), dispose: () => disposed++ };
            },
        });
        const lease = ov.open({ ...L, model: 'B', pattern: { preset: 'solid' } }, 0);
        expect(lease.pattern!.backend).toBe('fake');
        expect(seen).toHaveLength(1);
        expect(seen[0].nodeCount).toBe(5);
        expect([...seen[0].world.subarray(0, 6)]).toEqual([100, 0, 0, 110, 0, 0]);
        const frame = frameOf();
        ov.composite(frame, 3, 0);
        expect(frame[B0 * 3]).toBe(255);
        expect(frame[0]).toBe(0);
        ov.expire(100_000);
        expect(disposed).toBe(1);
        expect(ov.size).toBe(0);
    });

    it('refuses what it cannot do', () => {
        const ov = new OverlayManager(layout());
        expect(() => ov.open({ ...L, model: 'A', format: 'pattern' }, 0)).toThrow(/needs pattern/);
        expect(() => ov.open({ ...L, model: 'A', pattern: { preset: 'lava' } }, 0)).toThrow(/unknown preset/);
        expect(() => ov.open({ ...L, models: [], pattern: { preset: 'solid' } }, 0)).toThrow(/at least one/);
        expect(() => ov.open({ ...L, models: ['A', 'Nope'] }, 0)).toThrow(/no pixel model named Nope/);
        expect(() => ov.open({ ...L, models: ['A', 'B'], format: 'grid' }, 0)).toThrow(/one target/);
        expect(() => ov.open({ ...L, model: 'A', channels: 2 as never }, 0)).toThrow(/channels/);
        const noWorld = new OverlayManager(compileLayout(specs()));
        expect(() => noWorld.open({ ...L, model: 'A', pattern: { preset: 'solid' } }, 0)).toThrow(
            /no node coordinates/,
        );
    });

    it('keeps exclusive conflicts across multi-target leases', () => {
        const ov = new OverlayManager(layout());
        ov.open({ mode: 'exclusive', name: 'sprite', model: 'B' }, 0);
        expect(() => ov.open({ mode: 'exclusive', name: 'both', models: ['A', 'B'] }, 0)).toThrow(
            /B is in use by sprite/,
        );
        // A layer over both is fine.
        expect(ov.open({ ...L, models: ['A', 'B'], pattern: { preset: 'solid' } }, 0).nodeCount).toBe(10);
    });
});
