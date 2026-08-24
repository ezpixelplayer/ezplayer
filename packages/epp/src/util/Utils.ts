export const sleepms = (ms: number) => new Promise((r) => setTimeout(r, ms));

export async function busySleep(nextTime: number): Promise<void> {
    while (performance.now() < nextTime) {
        //await Promise.resolve();
        await new Promise((resolve) => setImmediate(resolve));
    }
}

export async function sleepSleep(nextTime: number): Promise<void> {
    const curTime = performance.now();
    if (nextTime > curTime - 2) {
        await sleepms(nextTime - curTime - 1);
    }
}

export function printBufferHex(buffer: Uint8Array) {
    for (let i = 0; i < buffer.length; i += 16) {
        const part = buffer.subarray(i, i + 16); // Get up to 16 bytes
        const hexValues = Array.from(part)
            .map((b) => b.toString(16).padStart(2, '0'))
            .join(' ');
        console.log(hexValues);
    }
}

export function toUint8Array(view: DataView) {
    return new Uint8Array(view.buffer, view.byteOffset, view.byteLength);
}

export function toDataView(buf: Uint8Array) {
    return new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
}

export function readUInt24LE(buffer: DataView, offset: number) {
    return buffer.getUint8(offset) | (buffer.getUint8(offset + 1) << 8) | (buffer.getInt8(offset + 2) << 16);
}

const unsharedSharedBuffer = new SharedArrayBuffer(1024);
const int32USB = new Int32Array(unsharedSharedBuffer);
export async function atomicSleep(nextTime: number) {
    const st = nextTime - performance.now();
    if (st <= 0) return;
    await Atomics.waitAsync(int32USB, 0, 0, st).value;
}

/** Learned overshoot of a timed Atomics.wait (~15.6 ms on Windows without a
 *  1 ms multimedia timer, ~1 ms with one). Same approach as the playback
 *  loop's xbusySleep: wait coarsely while safe, spin-yield the remainder so
 *  the wake lands on time. setImmediate keeps I/O completions flowing. */
let lpWaitOvershootMs = 0.5;

export async function lpBusySleep(nextTime: number) {
    while (true) {
        const nt = performance.now();
        const remaining = nextTime - nt;
        if (remaining <= 0.05) return;
        if (remaining > lpWaitOvershootMs + 0.3) {
            const req = Math.min(1, remaining - lpWaitOvershootMs);
            Atomics.wait(int32USB, 0, 0, req);
            const overshoot = Math.max(0, performance.now() - nt - req);
            lpWaitOvershootMs =
                overshoot > lpWaitOvershootMs ? overshoot : lpWaitOvershootMs * 0.999 + overshoot * 0.001;
        }
        await new Promise((resolve) => setImmediate(resolve));
    }
}
