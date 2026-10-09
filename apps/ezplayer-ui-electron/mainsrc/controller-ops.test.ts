import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// Controller reads resolve when a test says so, and never touch the network.
const probe = vi.hoisted(() => ({
    pending: [] as ((result: { success: boolean; error?: string; report?: unknown; noWebService?: boolean }) => void)[],
    options: [] as ({ expectController?: boolean } | undefined)[],
}));

vi.mock('@ezplayer/epp-controllers', async (importOriginal) => {
    const actual = await importOriginal<typeof import('@ezplayer/epp-controllers')>();
    return {
        ...actual,
        probeController: vi.fn((_ip: string, _proxy: string | undefined, opts?: { expectController?: boolean }) => {
            probe.options.push(opts);
            return new Promise((resolve) => probe.pending.push(resolve));
        }),
    };
});

const {
    cancelQueuedAutomaticReads,
    dispatchControllerCommand,
    setControllerDataHold,
    getControllerOpsState,
    hasRunningControllerOps,
    resetControllerOps,
    setKnownControllers,
} = await import('./controller-ops.js');

/** Start a status read against a never-scanned address; returns its settle promise. */
function startRead(address: string): Promise<unknown> {
    return dispatchControllerCommand({ cmd: 'status', id: `${address}|direct`, address, depth: 'full' }, 'lan').catch(
        (e: Error) => e,
    );
}

/** Start a status read the player asked for itself. */
function startAutomaticRead(address: string): Promise<unknown> {
    return dispatchControllerCommand({ cmd: 'status', id: `${address}|direct`, address, depth: 'full' }, 'auto').catch(
        (e: Error) => e,
    );
}

/** Settle the oldest pending read, once the probe has been called (it starts
 *  after the op takes its slot, a microtask after the command). */
async function settleRead(result: { success: boolean; error?: string; noWebService?: boolean }): Promise<void> {
    await vi.waitFor(() => expect(probe.pending.length).toBeGreaterThan(0));
    probe.pending.shift()!(result);
}

/** Wait until the probe for the latest read has been called. */
const probeCalled = (count: number) => vi.waitFor(() => expect(probe.options.length).toBeGreaterThanOrEqual(count));

const opsFor = (target: string) => Object.values(getControllerOpsState().operations).filter((o) => o.target === target);

beforeEach(() => {
    probe.pending.length = 0;
    probe.options.length = 0;
    setKnownControllers([]);
    resetControllerOps();
});

describe('dismiss', () => {
    it('removes a failed operation from the shared state', async () => {
        const done = startRead('10.9.0.1');
        await settleRead({ success: false, error: 'boom' });
        await done;
        const [failed] = opsFor('10.9.0.1|direct');
        expect(failed).toMatchObject({ status: 'error', error: 'boom' });

        await dispatchControllerCommand({ cmd: 'dismiss', opId: failed.id }, 'lan');
        expect(opsFor('10.9.0.1|direct')).toEqual([]);
        // Another client dismissing the same failure is not an error.
        await expect(dispatchControllerCommand({ cmd: 'dismiss', opId: failed.id }, 'cloud')).resolves.toBeUndefined();
    });

    it('refuses to dismiss an operation that is still running', async () => {
        const done = startRead('10.9.0.2');
        const [running] = opsFor('10.9.0.2|direct');
        await expect(dispatchControllerCommand({ cmd: 'dismiss', opId: running.id }, 'lan')).rejects.toThrow(
            /has not finished/,
        );
        await settleRead({ success: false, error: 'late' });
        await done;
    });
});

describe('reset', () => {
    it('tracks whether any controller operation is running', async () => {
        expect(hasRunningControllerOps()).toBe(false);
        const done = startRead('10.9.0.3');
        expect(hasRunningControllerOps()).toBe(true);
        await settleRead({ success: false, error: 'x' });
        await done;
        expect(hasRunningControllerOps()).toBe(false);
    });

    it('clears devices and finished operations but lets running ones finish', async () => {
        const first = startRead('10.9.0.4');
        await settleRead({ success: false, error: 'old failure' });
        await first;
        const second = startRead('10.9.0.5');

        resetControllerOps();

        const state = getControllerOpsState();
        expect(state.devices).toEqual({});
        expect(opsFor('10.9.0.4|direct')).toEqual([]);
        expect(opsFor('10.9.0.5|direct')).toMatchObject([{ status: 'running' }]);

        await settleRead({ success: false, error: 'finished after reset' });
        await second;
        expect(opsFor('10.9.0.5|direct')).toMatchObject([{ status: 'error', error: 'finished after reset' }]);
    });
});

describe('history per controller', () => {
    it('keeps only the latest result of a kind for each controller', async () => {
        for (const error of ['first', 'second']) {
            const done = startRead('10.9.0.6');
            await settleRead({ success: false, error });
            await done;
        }
        const other = startRead('10.9.0.7');
        await settleRead({ success: false, error: 'other controller' });
        await other;

        expect(opsFor('10.9.0.6|direct')).toMatchObject([{ status: 'error', error: 'second' }]);
        expect(opsFor('10.9.0.7|direct')).toMatchObject([{ status: 'error', error: 'other controller' }]);
    });

    it('lets a newer successful read replace an older failure', async () => {
        const failed = startRead('10.9.0.8');
        await settleRead({ success: false, error: 'timed out' });
        await failed;
        const ok = startRead('10.9.0.8');
        // An ordinary host finishes as done, which is enough to replace the failure.
        await settleRead({ success: false, noWebService: true, error: 'no web service' });
        await ok;
        expect(opsFor('10.9.0.8|direct')).toMatchObject([{ status: 'done' }]);
    });
});

describe('ping answers but no web service', () => {
    it('is not a failure when nothing says a controller is at the address', async () => {
        const done = startRead('10.9.0.9');
        await probeCalled(1);
        expect(probe.options.at(-1)?.expectController).toBe(false);
        await settleRead({ success: false, noWebService: true, error: '10.9.0.9 answers ping but nothing answers' });
        await done;
        expect(opsFor('10.9.0.9|direct')).toMatchObject([{ status: 'done' }]);
        expect(getControllerOpsState().devices['10.9.0.9|direct']).toMatchObject({
            error: '10.9.0.9 answers ping but nothing answers',
        });
    });

    it('expects a controller where xLights names one at the address', async () => {
        setKnownControllers([
            { name: 'Tree', address: '10.9.0.10', vendor: 'Falcon', model: 'F16V4', active: true, source: 'xlights' },
        ]);
        const done = startRead('10.9.0.10');
        await probeCalled(1);
        expect(probe.options.at(-1)?.expectController).toBe(true);
        await settleRead({ success: false, error: 'web service did not answer within 30 s' });
        await done;
        expect(opsFor('10.9.0.10|direct')).toMatchObject([{ status: 'error' }]);
    });
});

describe('queue', () => {
    const statusOf = (n: number) => opsFor(`10.9.1.${n}|direct`)[0]?.status;

    it('runs eight reads at a time and queues the rest', async () => {
        const done = Array.from({ length: 10 }, (_, i) => startRead(`10.9.1.${i}`));
        expect(Array.from({ length: 10 }, (_, i) => statusOf(i))).toEqual([
            ...Array<string>(8).fill('running'),
            'queued',
            'queued',
        ]);
        await vi.waitFor(() => expect(probe.pending.length).toBe(8));

        // A read finishing hands its slot to the oldest queued read.
        await settleRead({ success: false, error: 'first done' });
        await vi.waitFor(() => expect(statusOf(8)).toBe('running'));
        expect(statusOf(9)).toBe('queued');

        for (let i = 0; i < 9; i++) await settleRead({ success: false, error: 'done' });
        await Promise.all(done);
        expect(hasRunningControllerOps()).toBe(false);
    });

    it('drops queued reads on reset and on cancel, without starting them', async () => {
        const done = Array.from({ length: 10 }, (_, i) => startRead(`10.9.1.${i}`));
        const queued = opsFor('10.9.1.9|direct')[0];
        expect(queued.status).toBe('queued');
        await dispatchControllerCommand({ cmd: 'cancel', opId: queued.id }, 'lan');
        expect(opsFor('10.9.1.9|direct')).toMatchObject([{ status: 'cancelled' }]);

        resetControllerOps();
        expect(opsFor('10.9.1.8|direct')).toEqual([]);
        expect(hasRunningControllerOps()).toBe(true); // the eight running ones finish

        for (let i = 0; i < 8; i++) await settleRead({ success: false, error: 'done' });
        await Promise.all(done);
        // The cancelled and reset reads never reached the controller.
        expect(probe.options.length).toBe(8);
        expect(hasRunningControllerOps()).toBe(false);
    });
});

describe('automatic reads', () => {
    it('drops the queued ones when playback starts, keeping the running ones', async () => {
        const done = Array.from({ length: 10 }, (_, i) => startAutomaticRead(`10.9.2.${i}`));
        await vi.waitFor(() => expect(probe.pending.length).toBe(8));

        // Eight are with the controllers already; the last two never start.
        expect(cancelQueuedAutomaticReads()).toBe(2);
        expect(opsFor('10.9.2.8|direct')).toMatchObject([{ status: 'cancelled' }]);
        expect(opsFor('10.9.2.9|direct')).toMatchObject([{ status: 'cancelled' }]);
        expect(opsFor('10.9.2.0|direct')).toMatchObject([{ status: 'running' }]);

        for (let i = 0; i < 8; i++) await settleRead({ success: false, error: 'done' });
        await Promise.all(done);
        expect(probe.options.length).toBe(8);
        expect(hasRunningControllerOps()).toBe(false);
    });

    it('leaves a read the user asked for queued', async () => {
        const auto = Array.from({ length: 8 }, (_, i) => startAutomaticRead(`10.9.3.${i}`));
        await vi.waitFor(() => expect(probe.pending.length).toBe(8));
        const mine = startRead('10.9.3.9');
        expect(opsFor('10.9.3.9|direct')).toMatchObject([{ status: 'queued' }]);

        expect(cancelQueuedAutomaticReads()).toBe(0);
        expect(opsFor('10.9.3.9|direct')).toMatchObject([{ status: 'queued' }]);

        for (let i = 0; i < 9; i++) await settleRead({ success: false, error: 'done' });
        await Promise.all([...auto, mine]);
    });
});

describe('holding data while a controller is read', () => {
    /** Records hold/release pairs the way the playback worker would see them. */
    function recordHolds() {
        const events: string[] = [];
        setControllerDataHold((address: string) => {
            events.push(`hold ${address}`);
            return () => events.push(`release ${address}`);
        });
        return events;
    }

    afterEach(() => {
        // Leave the hook inert for the other suites.
        setControllerDataHold(() => undefined);
    });

    it('holds for the read and releases after it', async () => {
        const events = recordHolds();
        const done = startRead('10.9.4.1');
        await probeCalled(1);
        expect(events).toEqual(['hold 10.9.4.1']);

        await settleRead({ success: true });
        await done;
        expect(events).toEqual(['hold 10.9.4.1', 'release 10.9.4.1']);
    });

    it('releases when the read fails', async () => {
        const events = recordHolds();
        const done = startRead('10.9.4.2');
        await probeCalled(1);
        await settleRead({ success: false, error: 'refused' });
        await done;
        expect(events).toEqual(['hold 10.9.4.2', 'release 10.9.4.2']);
    });

    it('holds only the controller being read', async () => {
        const events = recordHolds();
        const a = startRead('10.9.4.3');
        const b = startRead('10.9.4.4');
        await probeCalled(2);
        expect(events).toEqual(['hold 10.9.4.3', 'hold 10.9.4.4']);

        await settleRead({ success: true });
        await settleRead({ success: true });
        await Promise.all([a, b]);
        expect(events.filter((e) => e.startsWith('release')).sort()).toEqual(['release 10.9.4.3', 'release 10.9.4.4']);
    });
});
