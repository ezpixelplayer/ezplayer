/*
 * Named counters and gauges in shared memory, so workers report without
 * messages and the conductor snapshots without asking.
 */

export class StatsBlock {
    readonly buffer: SharedArrayBuffer;
    readonly counterNames: string[];
    readonly gaugeNames: string[];
    private readonly counters: Int32Array;
    private readonly gauges: Float64Array;
    private readonly counterIndex = new Map<string, number>();
    private readonly gaugeIndex = new Map<string, number>();

    static allocate(counterNames: string[], gaugeNames: string[] = []): StatsBlock {
        const counterBytes = Math.ceil((counterNames.length * 4) / 8) * 8;
        const sab = new SharedArrayBuffer(8 + counterBytes + gaugeNames.length * 8);
        const h = new Int32Array(sab, 0, 2);
        h[0] = counterNames.length;
        h[1] = gaugeNames.length;
        return new StatsBlock(sab, counterNames, gaugeNames);
    }

    constructor(buffer: SharedArrayBuffer, counterNames: string[], gaugeNames: string[] = []) {
        this.buffer = buffer;
        const h = new Int32Array(buffer, 0, 2);
        if (h[0] !== counterNames.length || h[1] !== gaugeNames.length) {
            throw new Error('stats block does not match the name tables');
        }
        this.counterNames = counterNames;
        this.gaugeNames = gaugeNames;
        const counterBytes = Math.ceil((counterNames.length * 4) / 8) * 8;
        this.counters = new Int32Array(buffer, 8, counterNames.length);
        this.gauges = new Float64Array(buffer, 8 + counterBytes, gaugeNames.length);
        counterNames.forEach((n, i) => this.counterIndex.set(n, i));
        gaugeNames.forEach((n, i) => this.gaugeIndex.set(n, i));
    }

    counter(name: string): number {
        const i = this.counterIndex.get(name);
        if (i === undefined) throw new Error(`unknown counter ${name}`);
        return i;
    }

    gauge(name: string): number {
        const i = this.gaugeIndex.get(name);
        if (i === undefined) throw new Error(`unknown gauge ${name}`);
        return i;
    }

    inc(index: number, n = 1): void {
        Atomics.add(this.counters, index, n);
    }

    get(index: number): number {
        return Atomics.load(this.counters, index);
    }

    /** Non-atomic Float64 gauge; a torn read is tolerable for a display value. */
    setGauge(index: number, v: number): void {
        this.gauges[index] = v;
    }

    /** Keep the larger of the current and new value. */
    maxGauge(index: number, v: number): void {
        if (v > this.gauges[index]) this.gauges[index] = v;
    }

    getGauge(index: number): number {
        return this.gauges[index];
    }

    snapshot(): { counters: Record<string, number>; gauges: Record<string, number> } {
        const counters: Record<string, number> = {};
        const gauges: Record<string, number> = {};
        this.counterNames.forEach((n, i) => (counters[n] = Atomics.load(this.counters, i)));
        this.gaugeNames.forEach((n, i) => (gauges[n] = this.gauges[i]));
        return { counters, gauges };
    }

    resetGauges(): void {
        this.gauges.fill(0);
    }
}
