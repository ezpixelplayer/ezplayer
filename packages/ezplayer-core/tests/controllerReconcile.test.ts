import { describe, it, expect } from 'vitest';
import {
    reconcileControllers,
    reconcilePorts,
    hasPortDrift,
    reconcileInputs,
    overlayHealth,
    healthNeedsAttention,
    applyOverrides,
} from '../src/util/controllerReconcile';
import type { KnownController, DiscoveredController, EzpControllerRecord } from '../src/types/ControllerOps';

const now = '2026-01-01T00:00:00.000Z';

/** Minimal scanned device. */
function dev(partial: Partial<DiscoveredController> & { ip: string }): DiscoveredController {
    return {
        id: `${partial.ip}|direct`,
        source: { via: 'direct' },
        seenAt: now,
        ...partial,
    };
}

function known(partial: Partial<KnownController> & { name: string }): KnownController {
    return { source: 'xlights', ...partial };
}

describe('reconcileControllers', () => {
    it('marks a known record present when its IP address matches a scan', () => {
        const rows = reconcileControllers(
            [known({ name: 'Roof', address: '192.168.1.50', model: 'F48V4' })],
            [dev({ ip: '192.168.1.50', driverType: 'Falcon', model: 'F48V4' })],
        );
        expect(rows).toHaveLength(1);
        expect(rows[0].state).toBe('present');
        expect(rows[0].name).toBe('Roof');
        expect(rows[0].device?.ip).toBe('192.168.1.50');
    });

    it('matches by hostname when the address is a host, not an IP', () => {
        const rows = reconcileControllers(
            [known({ name: 'Arch', address: 'arch-lab' })],
            [dev({ ip: '192.168.1.51', hostname: 'Arch-Lab' })], // case-insensitive
        );
        expect(rows[0].state).toBe('present');
        expect(rows[0].device?.ip).toBe('192.168.1.51');
    });

    it('marks a known record absent when nothing on the network matches', () => {
        const rows = reconcileControllers(
            [known({ name: 'Garage', address: '192.168.1.99' })],
            [dev({ ip: '192.168.1.50' })],
        );
        expect(rows[0].state).toBe('absent');
        expect(rows[0].device).toBeUndefined();
    });

    it('marks a record with no address absent (unjoinable)', () => {
        const rows = reconcileControllers([known({ name: 'Planned' })], [dev({ ip: '192.168.1.50' })]);
        const planned = rows.find((r) => r.name === 'Planned');
        expect(planned?.state).toBe('absent');
    });

    it('emits an unregistered ghost for a scanned device matching no record', () => {
        const rows = reconcileControllers([], [dev({ ip: '192.168.1.77', driverType: 'WLED', model: 'QuinLED' })]);
        expect(rows).toHaveLength(1);
        expect(rows[0].state).toBe('unregistered');
        expect(rows[0].name).toBeUndefined();
        expect(rows[0].key).toContain('192.168.1.77');
        expect(rows[0].model).toBe('QuinLED');
    });

    it('absorbs a same-IP proxy duplicate into the one present record (no phantom ghost)', () => {
        const direct: DiscoveredController = dev({ ip: '192.168.1.50' });
        const viaProxy: DiscoveredController = {
            id: '192.168.1.50|via:10.0.0.1',
            ip: '192.168.1.50',
            source: { via: 'fpp-proxy', proxy: '10.0.0.1' },
            seenAt: now,
        };
        const rows = reconcileControllers([known({ name: 'Roof', address: '192.168.1.50' })], [direct, viaProxy]);
        expect(rows.filter((r) => r.state === 'unregistered')).toHaveLength(0);
        expect(rows.filter((r) => r.state === 'present')).toHaveLength(1);
    });

    it('produces the full mixed set: present + absent + unregistered', () => {
        const rows = reconcileControllers(
            [known({ name: 'Roof', address: '192.168.1.50' }), known({ name: 'Garage', address: '192.168.1.99' })],
            [dev({ ip: '192.168.1.50' }), dev({ ip: '192.168.1.200' })],
        );
        const byState = (s: string) => rows.filter((r) => r.state === s).length;
        expect(byState('present')).toBe(1);
        expect(byState('absent')).toBe(1);
        expect(byState('unregistered')).toBe(1);
    });
});

describe('reconcilePorts', () => {
    it('ok when intended and actual pixel counts match on a port', () => {
        const rows = reconcilePorts(
            [{ port: 1, models: ['Tree'], pixels: 50 }],
            [{ port: 1, model: 'Tree', pixels: 50 }],
        );
        expect(rows).toEqual([
            {
                port: 1,
                intendedModels: ['Tree'],
                intendedPixels: 50,
                actualModel: 'Tree',
                actualModels: ['Tree'],
                missingModels: [],
                extraModels: [],
                actualPixels: 50,
                drift: 'ok',
            },
        ]);
    });

    it('compares multi-model ports as sets: order-insensitive, case-preserving', () => {
        const rows = reconcilePorts(
            [{ port: 1, models: ['Arch', 'Tree'], modelLabels: ['Arch [A]', 'Tree [B]'], pixels: 80 }],
            [{ port: 1, models: ['tree', 'Arch'], pixels: 80 }],
        );
        expect(rows[0].drift).toBe('ok');
        expect(rows[0].intendedModelLabels).toEqual(['Arch [A]', 'Tree [B]']);
        expect(rows[0].actualModels).toEqual(['tree', 'Arch']);
        expect(rows[0].actualModel).toBe('tree + Arch'); // joined back-compat display
        expect(rows[0].missingModels).toEqual([]);
        expect(rows[0].extraModels).toEqual([]);
    });

    it('reports per-model set drift: missing on the device, extra on the device', () => {
        const rows = reconcilePorts(
            [{ port: 2, models: ['Tree', 'Star'], pixels: 100 }],
            [{ port: 2, models: ['Tree', 'Stale'], pixels: 100 }],
        );
        expect(rows[0].missingModels).toEqual(['Star']);
        expect(rows[0].extraModels).toEqual(['Stale']);
        expect(rows[0].drift).toBe('ok'); // pixels still the drift yardstick
    });

    it('matches "-str-N" suffixed device names against the bare intent name', () => {
        // Multi-string models upload as "<model>-str-<n>"; those must not read
        // as missing+extra when the bare model is intended on the port.
        const rows = reconcilePorts(
            [{ port: 1, models: ['Matrix'], pixels: 100 }],
            [{ port: 1, models: ['Matrix-str-2'], pixels: 100 }],
        );
        expect(rows[0].missingModels).toEqual([]);
        expect(rows[0].extraModels).toEqual([]);
        expect(rows[0].drift).toBe('ok');
    });

    it('falls back to the single joined model string when no models array is given', () => {
        const rows = reconcilePorts(
            [{ port: 1, models: ['Tree'], pixels: 50 }],
            [{ port: 1, model: 'Tree', pixels: 50 }],
        );
        expect(rows[0].actualModels).toEqual(['Tree']);
        expect(rows[0].actualModel).toBe('Tree');
    });

    it('leaves the model-set diff unset when the device reports no model names', () => {
        const rows = reconcilePorts([{ port: 1, models: ['Tree'], pixels: 50 }], [{ port: 1, pixels: 50 }]);
        expect(rows[0].actualModels).toBeUndefined();
        expect(rows[0].missingModels).toBeUndefined();
        expect(rows[0].extraModels).toBeUndefined();
    });

    it('marks every device model extra on an unexpected port', () => {
        const rows = reconcilePorts([], [{ port: 7, models: ['Old1', 'Old2'], pixels: 100 }]);
        expect(rows[0].drift).toBe('unexpected');
        expect(rows[0].actualModels).toEqual(['Old1', 'Old2']);
        expect(rows[0].extraModels).toEqual(['Old1', 'Old2']);
        expect(rows[0].actualModel).toBe('Old1 + Old2');
    });

    it('missing when xLights expects a port the controller has empty', () => {
        const rows = reconcilePorts([{ port: 3, models: ['Arch'], pixels: 30 }], [{ port: 3, pixels: 0 }]);
        expect(rows[0].drift).toBe('missing');
        expect(rows[0].intendedPixels).toBe(30);
        expect(rows[0].actualPixels).toBe(0);
    });

    it('missing when the controller has no entry for an intended port at all', () => {
        const rows = reconcilePorts([{ port: 5, models: ['X'], pixels: 10 }], []);
        expect(rows[0].drift).toBe('missing');
    });

    it('unexpected when the controller has pixels xLights assigns nowhere', () => {
        const rows = reconcilePorts([], [{ port: 7, model: 'stale', pixels: 100 }]);
        expect(rows[0].drift).toBe('unexpected');
        expect(rows[0].intendedModels).toEqual([]);
    });

    it('count when both present but pixel counts differ', () => {
        const rows = reconcilePorts([{ port: 1, models: ['Tree'], pixels: 50 }], [{ port: 1, pixels: 100 }]);
        expect(rows[0].drift).toBe('count');
    });

    it('sorts by port and hasPortDrift flags any non-ok', () => {
        const rows = reconcilePorts(
            [
                { port: 2, models: ['B'], pixels: 20 },
                { port: 1, models: ['A'], pixels: 10 },
            ],
            [
                { port: 1, pixels: 10 },
                { port: 2, pixels: 99 },
            ],
        );
        expect(rows.map((r) => r.port)).toEqual([1, 2]);
        expect(hasPortDrift(rows)).toBe(true);
        expect(
            hasPortDrift([{ port: 1, intendedModels: ['A'], intendedPixels: 10, actualPixels: 10, drift: 'ok' }]),
        ).toBe(false);
    });
});

describe('overlayHealth', () => {
    it('overlays live health onto a row matched by IP address', () => {
        const rows = reconcileControllers(
            [{ name: 'Roof', address: '192.168.1.50', source: 'xlights' }],
            [{ id: '192.168.1.50|direct', ip: '192.168.1.50', source: { via: 'direct' }, seenAt: now }],
        );
        const [row] = overlayHealth(rows, [
            {
                name: 'Roof',
                address: '192.168.1.50',
                connectivity: 'Up',
                pingSummary: '9 out of 10 pings',
                status: 'open',
            },
        ]);
        expect(row.health?.connectivity).toBe('Up');
        expect(row.health?.pingSummary).toBe('9 out of 10 pings');
        expect(healthNeedsAttention(row.health)).toBe(false);
    });

    it('matches by name when the address does not line up, and flags Down as attention', () => {
        const rows = reconcileControllers([{ name: 'Garage', address: '10.0.0.9', source: 'xlights' }], []);
        const [row] = overlayHealth(rows, [{ name: 'Garage', connectivity: 'Down', errors: ['no route'] }]);
        expect(row.health?.connectivity).toBe('Down');
        expect(healthNeedsAttention(row.health)).toBe(true);
    });

    it('promotes a known absent record to present when it pings Up (scan-independent liveness)', () => {
        const rows = reconcileControllers([{ name: 'Roof', address: '192.168.1.50', source: 'xlights' }], []);
        expect(rows[0].state).toBe('absent'); // no scan device
        const [row] = overlayHealth(rows, [
            { name: 'Roof', address: '192.168.1.50', connectivity: 'Up', pingSummary: '10 of 10' },
        ]);
        expect(row.state).toBe('present');
        expect(row.health?.connectivity).toBe('Up');
    });

    it('does not promote a Down or Pending absent record, nor an unregistered ghost', () => {
        const known = reconcileControllers([{ name: 'Garage', address: '10.0.0.9', source: 'xlights' }], []);
        expect(overlayHealth(known, [{ name: 'Garage', connectivity: 'Pending' }])[0].state).toBe('absent');
        const ghost = reconcileControllers([], [dev({ ip: '10.0.0.9' })]);
        expect(overlayHealth(ghost, [{ address: '10.0.0.9', connectivity: 'Up' }])[0].state).toBe('unregistered');
    });

    it('leaves rows unchanged when nothing matches or statuses are empty', () => {
        const rows = reconcileControllers([{ name: 'X', address: '1.2.3.4', source: 'xlights' }], []);
        expect(overlayHealth(rows, [])).toBe(rows);
        expect(
            overlayHealth(rows, [{ name: 'Other', address: '9.9.9.9', connectivity: 'Up' }])[0].health,
        ).toBeUndefined();
    });
});

function rec(partial: Partial<EzpControllerRecord> & { name: string }): EzpControllerRecord {
    return { ...partial };
}

describe('applyOverrides', () => {
    it('passes an untouched xLights controller through unchanged', () => {
        const xl = [known({ name: 'Roof', address: '192.168.1.50' })];
        expect(applyOverrides(xl, [])).toEqual(xl);
    });

    it('overrides address/active on a matching record and marks provenance both', () => {
        const out = applyOverrides(
            [known({ name: 'Roof', address: '192.168.1.50', active: true })],
            [rec({ name: 'Roof', address: '192.168.1.60', active: false })],
        );
        expect(out).toHaveLength(1);
        expect(out[0].address).toBe('192.168.1.60');
        expect(out[0].active).toBe(false);
        expect(out[0].source).toBe('both');
    });

    it('associate: an address-only record binds the xLights controller to a found IP', () => {
        const out = applyOverrides([known({ name: 'Roof' })], [rec({ name: 'Roof', address: '192.168.1.70' })]);
        expect(out[0].address).toBe('192.168.1.70');
        expect(out[0].source).toBe('both');
    });

    it('soft-deletes: a record with deleted drops the controller from the set', () => {
        const out = applyOverrides(
            [known({ name: 'Roof', address: '1.1.1.1' }), known({ name: 'Garage', address: '2.2.2.2' })],
            [rec({ name: 'Roof', deleted: true })],
        );
        expect(out.map((k) => k.name)).toEqual(['Garage']);
    });

    it('adds an own record (no xLights backing) as an ezp-sourced known', () => {
        const out = applyOverrides([], [rec({ name: 'Spare', address: '192.168.1.80', own: true })]);
        expect(out).toHaveLength(1);
        expect(out[0]).toMatchObject({ name: 'Spare', address: '192.168.1.80', active: true, source: 'ezp' });
    });

    it('promote: an own record from a ghost is added; an unrelated xLights one stays', () => {
        const out = applyOverrides(
            [known({ name: 'Roof', address: '192.168.1.50' })],
            [rec({ name: 'New Prop', address: '192.168.1.90', own: true })],
        );
        expect(out.map((k) => k.name).sort()).toEqual(['New Prop', 'Roof']);
        expect(out.find((k) => k.name === 'New Prop')?.source).toBe('ezp');
        expect(out.find((k) => k.name === 'Roof')?.source).toBe('xlights');
    });

    it('does not resurrect a soft-deleted own record', () => {
        const out = applyOverrides([], [rec({ name: 'Gone', own: true, deleted: true })]);
        expect(out).toHaveLength(0);
    });
});

describe('reconcileInputs', () => {
    const e131 = (universe: number, channels = 510, startChannel = 1) => ({
        type: 'e131',
        universe,
        startChannel,
        channels,
    });

    it('no drift when the device matches the intended universe map', () => {
        const r = reconcileInputs([e131(100), e131(101), e131(102)], {
            protocol: 'e131',
            universes: [
                { universe: 100, channels: 510 },
                { universe: 101, channels: 510 },
                { universe: 102, channels: 510 },
            ],
        });
        expect(r.drift).toBe(false);
        expect(r.notes).toEqual([]);
    });

    it('flags missing, extra, and resized universes', () => {
        const r = reconcileInputs([e131(100), e131(101)], {
            protocol: 'e131',
            universes: [
                { universe: 100, channels: 512 },
                { universe: 7, channels: 510 },
            ],
        });
        expect(r.drift).toBe(true);
        expect(r.notes.join(' | ')).toContain('missing on device: 101');
        expect(r.notes.join(' | ')).toContain('not in xLights: 7');
        expect(r.notes.join(' | ')).toContain('universe 100 size: xLights 510 vs device 512');
    });

    it('protocol mismatch short-circuits the finer checks', () => {
        const r = reconcileInputs([e131(1)], { protocol: 'ddp', startChannel: 999 });
        expect(r.drift).toBe(true);
        expect(r.notes).toHaveLength(1);
        expect(r.notes[0]).toContain('protocol');
    });

    it('treats E1.31 aliases as the same protocol', () => {
        const r = reconcileInputs([{ type: 'E131', universe: 5, startChannel: 1, channels: 510 }], {
            protocol: 'e1.31',
            universes: [{ universe: 5, channels: 510 }],
        });
        expect(r.drift).toBe(false);
    });

    it('DDP tolerates device start of 1 or the absolute start, flags others', () => {
        const intent = [{ type: 'ddp', startChannel: 5001, channels: 3000 }];
        expect(reconcileInputs(intent, { protocol: 'ddp', startChannel: 1 }).drift).toBe(false);
        expect(reconcileInputs(intent, { protocol: 'ddp', startChannel: 5001 }).drift).toBe(false);
        const bad = reconcileInputs(intent, { protocol: 'ddp', startChannel: 777 });
        expect(bad.drift).toBe(true);
        expect(bad.notes[0]).toContain('DDP start');
    });

    it('DDP flags only a too-small device channel window', () => {
        const intent = [{ type: 'ddp', startChannel: 1, channels: 3000 }];
        expect(reconcileInputs(intent, { protocol: 'ddp', startChannel: 1, channelCount: 3000 }).drift).toBe(false);
        expect(reconcileInputs(intent, { protocol: 'ddp', startChannel: 1, channelCount: 6000 }).drift).toBe(false);
        const small = reconcileInputs(intent, { protocol: 'ddp', startChannel: 1, channelCount: 300 });
        expect(small.drift).toBe(true);
        expect(small.notes[0]).toContain('DDP channels');
    });

    it('partial devices compare only the first universe and size', () => {
        const intent = [e131(100), e131(101), e131(102)];
        expect(
            reconcileInputs(intent, {
                universes: [{ universe: 100, channels: 510 }],
                partial: true,
            }).drift,
        ).toBe(false);
        const wrong = reconcileInputs(intent, {
            universes: [{ universe: 55, channels: 512 }],
            partial: true,
        });
        expect(wrong.drift).toBe(true);
        expect(wrong.notes.join(' | ')).toContain('start universe');
    });

    it('an unread device or an empty intent never alarms', () => {
        expect(reconcileInputs([e131(1)], undefined).drift).toBe(false);
        expect(reconcileInputs([], { protocol: 'e131' }).drift).toBe(false);
        expect(reconcileInputs(undefined, { protocol: 'e131' }).drift).toBe(false);
        // Device that reports no protocol and no map (nothing to contradict).
        expect(reconcileInputs([e131(1)], {}).drift).toBe(false);
    });
});
