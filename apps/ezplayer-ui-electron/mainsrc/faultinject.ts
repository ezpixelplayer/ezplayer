/**
 * Test-only fault injection. EZP_FAULT=<name>[,<name>...] makes the app fail
 * in a known way so integration tests can check that the failure reaches the
 * log and the crash reporter. Inert when unset. No electron import: workers
 * use this too.
 */

export type FaultName =
    // main process
    | 'main-throw'
    | 'main-reject'
    // worker threads
    | 'playback-worker-throw'
    | 'server-worker-throw'
    // main window, before the app is up
    | 'bundle-throw'
    | 'bundle-empty'
    | 'preload-throw'
    | 'bad-url'
    // main window, once the app is up
    | 'renderer-throw'
    | 'renderer-reject'
    | 'renderer-hang'
    | 'renderer-crash'
    | 'gpu-crash';

export function parseFaults(v: string | undefined): Set<string> {
    return new Set(
        (v ?? '')
            .split(',')
            .map((s) => s.trim())
            .filter(Boolean),
    );
}

const faults = parseFaults(process.env.EZP_FAULT);

export function hasFault(name: FaultName): boolean {
    return faults.has(name);
}

export function anyFaults(): boolean {
    return faults.size > 0;
}

/** Throw from a timer, where nothing catches it. */
export function throwLater(name: FaultName, ms: number): void {
    if (!hasFault(name)) return;
    setTimeout(() => {
        throw new Error(`ezp-fault: ${name}`);
    }, ms);
}
