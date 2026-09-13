import { beforeEach, describe, expect, it, vi } from 'vitest';

// Controller reads resolve when a test says so, and never touch the network.
const probe = vi.hoisted(() => ({
    pending: [] as ((result: { success: boolean; error?: string; report?: unknown }) => void)[],
}));

vi.mock('@ezplayer/epp-controllers', async (importOriginal) => {
    const actual = await importOriginal<typeof import('@ezplayer/epp-controllers')>();
    return {
        ...actual,
        probeController: vi.fn(() => new Promise((resolve) => probe.pending.push(resolve))),
    };
});

const { dispatchControllerCommand, getControllerOpsState, hasRunningControllerOps, resetControllerOps } =
    await import('./controller-ops.js');

/** Start a status read against a never-scanned address; returns its settle promise. */
function startRead(address: string): Promise<unknown> {
    return dispatchControllerCommand({ cmd: 'status', id: `${address}|direct`, address, depth: 'full' }, 'lan').catch(
        (e: Error) => e,
    );
}

/** Settle the oldest pending read. */
function settleRead(result: { success: boolean; error?: string }): void {
    probe.pending.shift()!(result);
}

const opsFor = (target: string) => Object.values(getControllerOpsState().operations).filter((o) => o.target === target);

beforeEach(() => {
    probe.pending.length = 0;
    resetControllerOps();
});

describe('dismiss', () => {
    it('removes a failed operation from the shared state', async () => {
        const done = startRead('10.9.0.1');
        settleRead({ success: false, error: 'boom' });
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
            /still running/,
        );
        settleRead({ success: false, error: 'late' });
        await done;
    });
});

describe('reset', () => {
    it('tracks whether any controller operation is running', async () => {
        expect(hasRunningControllerOps()).toBe(false);
        const done = startRead('10.9.0.3');
        expect(hasRunningControllerOps()).toBe(true);
        settleRead({ success: false, error: 'x' });
        await done;
        expect(hasRunningControllerOps()).toBe(false);
    });

    it('clears devices and finished operations but lets running ones finish', async () => {
        const first = startRead('10.9.0.4');
        settleRead({ success: false, error: 'old failure' });
        await first;
        const second = startRead('10.9.0.5');

        resetControllerOps();

        const state = getControllerOpsState();
        expect(state.devices).toEqual({});
        expect(opsFor('10.9.0.4|direct')).toEqual([]);
        expect(opsFor('10.9.0.5|direct')).toMatchObject([{ status: 'running' }]);

        settleRead({ success: false, error: 'finished after reset' });
        await second;
        expect(opsFor('10.9.0.5|direct')).toMatchObject([{ status: 'error', error: 'finished after reset' }]);
    });
});
