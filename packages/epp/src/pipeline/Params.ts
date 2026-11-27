/*
 * Double-buffered parameter block in shared memory.  The conductor stages
 * values and commits once per frame; the frame records which half it used so
 * every worker sees one consistent set.
 */

const H_INTS = 4;
const H_ACTIVE = 0;
const H_GENERATION = 1;
const H_COUNT = 2;

export class ParamsBlock {
    readonly buffer: SharedArrayBuffer;
    readonly count: number;
    private readonly header: Int32Array;
    private readonly halves: [Float32Array, Float32Array];
    private readonly staging: Float32Array;
    private readonly names = new Map<string, number>();
    private dirty = false;

    static allocate(count: number): ParamsBlock {
        const sab = new SharedArrayBuffer(H_INTS * 4 + count * 4 * 2);
        const h = new Int32Array(sab, 0, H_INTS);
        h[H_COUNT] = count;
        return new ParamsBlock(sab);
    }

    constructor(buffer: SharedArrayBuffer) {
        this.buffer = buffer;
        this.header = new Int32Array(buffer, 0, H_INTS);
        this.count = this.header[H_COUNT];
        this.halves = [new Float32Array(buffer, H_INTS * 4, this.count), new Float32Array(buffer, H_INTS * 4 + this.count * 4, this.count)];
        this.staging = new Float32Array(this.count);
    }

    /** Register a name for an index (conductor side; workers get the same table by message). */
    define(name: string, index: number, initial = 0): number {
        if (index < 0 || index >= this.count) throw new Error(`param index ${index} out of range`);
        this.names.set(name, index);
        this.staging[index] = initial;
        this.dirty = true;
        return index;
    }

    indexOf(name: string): number {
        const i = this.names.get(name);
        if (i === undefined) throw new Error(`unknown param ${name}`);
        return i;
    }

    /** Stage a value; visible to frames after the next commit. */
    set(index: number, value: number): void {
        if (this.staging[index] !== value) {
            this.staging[index] = value;
            this.dirty = true;
        }
    }

    setByName(name: string, value: number): void {
        this.set(this.indexOf(name), value);
    }

    /** Publish staged values into the inactive half and flip. Returns the slot frames should record. */
    commit(): number {
        const active = Atomics.load(this.header, H_ACTIVE);
        if (!this.dirty) return active;
        const next = active ^ 1;
        this.halves[next].set(this.staging);
        Atomics.store(this.header, H_ACTIVE, next);
        Atomics.add(this.header, H_GENERATION, 1);
        this.dirty = false;
        return next;
    }

    /** Read a committed value from a given slot (any thread). */
    read(slot: number, index: number): number {
        return this.halves[slot & 1][index];
    }

    /** The active slot right now (any thread). */
    activeSlot(): number {
        return Atomics.load(this.header, H_ACTIVE);
    }

    generation(): number {
        return Atomics.load(this.header, H_GENERATION);
    }

    /** Staged value (conductor side), whether or not committed. */
    staged(index: number): number {
        return this.staging[index];
    }
}
