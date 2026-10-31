/** Per-channel max. Sparse sequences end at their last model, so an input
 *  shorter than the other reads as black past its end. */
export function maxUint8(out: Uint8Array, in1: Uint8Array, in2: Uint8Array): void {
    const len = Math.min(in1.length, in2.length, out.length);

    for (let i = 0; i < len; i++) {
        const av = in1[i];
        const bv = in2[i];
        out[i] = av > bv ? av : bv;
    }

    const longer = in1.length > in2.length ? in1 : in2;
    const end = Math.min(longer.length, out.length);
    if (end > len) out.set(longer.subarray(len, end), len);
    out.fill(0, end);
}
