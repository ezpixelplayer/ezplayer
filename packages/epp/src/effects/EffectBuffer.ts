// This code is copyrighted.  The copyright holder is determined as documented in the Github repository history.
// This code is licensed under the Affero General Public License, version 3.0 or later.  Other licenses may be available from the copyright holders.

export class EffectBufferRGB
{
    width: number;
    height: number;
    buf: Uint8Array;
    xch: number;

    constructor(w: number, h: number, buf?:Uint8Array, xch?:number) {
        this.width = w;
        this.height = h;
        this.xch = xch ?? 0;
        this.buf = buf ?? new Uint8Array(w*h*3 + (xch ?? 0));
    }

    get nBytes() { return this.buf.length; }

    fill(r: number, g: number, b: number) {
        const xch = this.xch;
        const buf = this.buf;
        const n = this.width * this.height;

        for (let i=0; i<n; ++i) {
            buf[i*3 + 0 + xch] = r;
            buf[i*3 + 1 + xch] = g;
            buf[i*3 + 2 + xch] = b;
        }
    }

    fillColumn(c: number, r: number, g: number, b: number) {
        if (this.width <= 0) return;
        const xch = this.xch;
        const w = this.width;
        const buf = this.buf;
        for (let row = 0; row<this.height; ++row) {
            buf[(row * w + c)*3 + 0 + xch] = r;
            buf[(row * w + c)*3 + 1 + xch] = g;
            buf[(row * w + c)*3 + 2 + xch] = b;
        }
    }

    // TODO: Linearize as matrix (no-op often...)
    // TODO: Linearize as matrix (zigzag)
    // TODO: Linearize as matrix (other)
}