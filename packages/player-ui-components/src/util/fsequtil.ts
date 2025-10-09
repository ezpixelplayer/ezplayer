interface CompBlock {
    framenum: number;
    blocksize: number;
}

interface SparseRange {
    startch: number;
    chcount: number;
}

export class FSEQHeader {
    hdr4: string = '';
    modelcount: number = 0;
    stepsize: number = 0;
    modelstart: number = 0;
    modelsize: number = 0;
    chdata_offset: number = 0;
    majver: number = 0;
    minver: number = 0;
    fixedhdr: number = 0;
    channels: number = 0;
    frames: number = 0;
    msperframe: number = 0;
    univcnt: number = 0;
    universesize: number = 0;
    gamma: number = 0;
    colorenc: number = 0;
    reserved2: number = 0;
    reserved1: number = 0;
    compression: number = 0;
    compblks: number = 0;
    nsparseranges: number = 0;
    uuid1: number = 0;
    uuid2: number = 0;
    compblocklist: CompBlock[] = [];
    chranges: SparseRange[] = [];
    headers: { [key: string]: string } = {};
}

export class FSEQReaderBrowser {
    private buffer: DataView;
    private offset = 0;
    header?: FSEQHeader;

    constructor(arrayBuffer: ArrayBuffer) {
        this.buffer = new DataView(arrayBuffer);
    }

    read(n: number): Uint8Array {
        const val = new Uint8Array(this.buffer.buffer, this.offset, n);
        this.offset += n;
        return val;
    }

    readAt(n: number, at: number): Uint8Array {
        return new Uint8Array(this.buffer.buffer, at, n);
    }

    read8bit(): number {
        const val = this.buffer.getUint8(this.offset);
        this.offset += 1;
        return val;
    }

    read16bit(): number {
        const val = this.buffer.getUint16(this.offset, true);
        this.offset += 2;
        return val;
    }

    read24bit(): number {
        const b1 = this.read8bit();
        const b2 = this.read8bit();
        const b3 = this.read8bit();
        return b1 + b2 * 256 + b3 * 65536;
    }

    read32bit(): number {
        const val = this.buffer.getUint32(this.offset, true);
        this.offset += 4;
        return val;
    }

    async readHeader(full?: boolean) {
        const hdr4 = new TextDecoder().decode(this.read(4));
        const isEseq = hdr4 === 'ESEQ';
        if (hdr4 !== 'PSEQ' && hdr4 !== 'ESEQ' && hdr4 !== 'FSEQ') {
            throw new Error('Not a PSEQ file');
        }

        let nframes = 0;
        let stepsz = 0;
        const compblocklist: CompBlock[] = [];
        const chrangelist: SparseRange[] = [];
        const v1headers: { [key: string]: string } = {};
        let comp = 0;
        let ccount = 0;
        let stepms = 50;
        let off2chdata = 0;
        let minver = 0;
        let majver = 0;
        let modelcnt = 0;
        let modelstart = 0;
        let modelsize = 0;
        let shdrlen = 0;
        let reserved = 0;
        let univcnt = 0;
        let univsz = 0;
        let gamma = 0;
        let colorenc = 0;
        let reserved2 = 0;
        let uuid1 = 0,
            uuid2 = 0;
        let blks = 0;
        let nranges = 0;

        if (isEseq) {
            off2chdata = 20;
            minver = 0;
            majver = 2;

            modelcnt = this.read32bit();
            stepsz = this.read32bit();
            modelstart = this.read32bit();
            ccount = this.read32bit();
            modelsize = ccount;

            const flen = this.buffer.byteLength;
            nframes = Math.floor((flen - off2chdata) / stepsz);
            compblocklist.push({ framenum: 0, blocksize: nframes * stepsz });
            chrangelist.push({ startch: modelstart, chcount: modelsize });
        } else {
            off2chdata = this.read16bit();
            minver = this.read8bit();
            majver = this.read8bit();

            shdrlen = this.read16bit();
            ccount = this.read32bit();
            stepsz = Math.floor((ccount + 3) / 4) * 4;
            nframes = this.read32bit();
            stepms = this.read8bit();
            reserved = this.read8bit();

            if (majver === 1) {
                univcnt = this.read16bit();
                univsz = this.read16bit();
                gamma = this.read8bit();
                colorenc = this.read8bit();
                reserved2 = this.read16bit();

                compblocklist.push({ framenum: 0, blocksize: nframes * ccount });
            } else {
                const compandblks = this.read8bit();
                comp = compandblks & 15;
                blks = ((compandblks & 240) << 4) + this.read8bit();
                nranges = this.read8bit();
                reserved2 = this.read8bit();
                uuid1 = this.read32bit();
                uuid2 = this.read32bit();

                if (full) {
                    for (let i = 0; i < blks; ++i) {
                        const framenum = this.read32bit();
                        const blocksize = this.read32bit();
                        compblocklist.push({ framenum, blocksize });
                    }

                    for (let i = 0; i < nranges; ++i) {
                        const startch = this.read24bit();
                        const chcount = this.read24bit();
                        chrangelist.push({ startch, chcount });
                    }
                }
            }

            if (!chrangelist.length) {
                chrangelist.push({ startch: 1, chcount: ccount });
            }

            if (full) {
                while (this.offset + 4 <= off2chdata) {
                    const hlen = this.read16bit() - 4;
                    const hname = new TextDecoder().decode(this.read(2));
                    const hval = new TextDecoder().decode(this.read(hlen));
                    v1headers[hname] = hval;
                }
            }
        }

        this.header = {
            hdr4,
            modelcount: modelcnt,
            stepsize: stepsz,
            modelstart: modelstart,
            modelsize: modelsize,
            chdata_offset: off2chdata,
            majver: majver,
            minver: minver,
            fixedhdr: shdrlen,
            channels: ccount,
            frames: nframes,
            msperframe: stepms,
            reserved1: reserved,
            univcnt: univcnt,
            universesize: univsz,
            gamma: gamma,
            colorenc: colorenc,
            reserved2: reserved2,
            compression: comp,
            compblks: blks,
            nsparseranges: nranges,
            uuid1: uuid1,
            uuid2: uuid2,
            compblocklist: compblocklist,
            chranges: chrangelist,
            headers: v1headers,
        };
    }
}

export async function getFSEQHeaderBytes(file: File): Promise<ArrayBuffer> {
    // Request first 1024 bytes which should be more than enough for any FSEQ header
    const headerBytes = await file.slice(0, 1024).arrayBuffer();
    return headerBytes;
}

export async function getFSEQDurationMSBrowser(file: File): Promise<number> {
    const headerBytes = await getFSEQHeaderBytes(file);
    const reader = new FSEQReaderBrowser(headerBytes);
    await reader.readHeader(false);
    return reader.header!.frames * reader.header!.msperframe;
}
