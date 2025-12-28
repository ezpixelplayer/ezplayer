export function maxUint8(out: Uint8Array, in1: Uint8Array, in2: Uint8Array): void {
    const len = Math.min(in1.length, in2.length, out.length);

    for (let i = 0; i < len; i++) {
        const av = in1[i];
        const bv = in2[i];
        out[i] = av > bv ? av : bv;
    }
}
