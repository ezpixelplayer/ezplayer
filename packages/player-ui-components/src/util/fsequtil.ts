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

// The sparse range count is one byte, and xLights has written tables of more
// than 255 ranges with only the low byte. Take the count implied by the header
// length (offset to the variable headers) when its low byte matches, the table
// fits before the channel data, and the ranges add up to the channel count.
function sparseRangeCount(hdr: DataView): number {
    const n = hdr.getUint8(22);
    const off2chdata = hdr.getUint16(4, true);
    const shdrlen = hdr.getUint16(8, true);
    const blks = ((hdr.getUint8(20) & 240) << 4) + hdr.getUint8(21);
    const tableStart = 32 + blks * 8;
    if (shdrlen <= tableStart + n * 6 || shdrlen > off2chdata || shdrlen > hdr.byteLength) return n;
    if ((shdrlen - tableStart) % 6) return n;
    const full = (shdrlen - tableStart) / 6;
    if ((full & 255) !== n) return n;
    let sum = 0;
    for (let i = 0; i < full; ++i) {
        const p = tableStart + i * 6 + 3;
        sum += hdr.getUint8(p) + hdr.getUint8(p + 1) * 256 + hdr.getUint8(p + 2) * 65536;
    }
    return sum === hdr.getUint32(10, true) ? full : n;
}

// FSEQ 2.3 keeps the first 255 ranges in the header with byte 22 = 255, so 255
// is not a count either, and stores the whole table in an 'SR' variable header
// (normally extended data after the frames). Take it only when it extends the
// header's 255 and adds up to the channel count; a stale copy carried along by
// an older writer fails that.
function extendedSparseRanges(sr: Uint8Array, header: SparseRange[], channels: number): SparseRange[] | undefined {
    if (sr.length % 6 || sr.length / 6 <= 255 || header.length !== 255) return undefined;
    const ranges: SparseRange[] = [];
    let sum = 0;
    for (let p = 0; p < sr.length; p += 6) {
        const r = {
            startch: sr[p] + sr[p + 1] * 256 + sr[p + 2] * 65536,
            chcount: sr[p + 3] + sr[p + 4] * 256 + sr[p + 5] * 65536,
        };
        const h = header[ranges.length];
        if (h && (h.startch !== r.startch || h.chcount !== r.chcount)) return undefined;
        ranges.push(r);
        sum += r.chcount;
    }
    return sum === channels ? ranges : undefined;
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

        let nframes: number;
        let stepsz: number;
        const compblocklist: CompBlock[] = [];
        const chrangelist: SparseRange[] = [];
        const v1headers: { [key: string]: string } = {};
        let comp = 0;
        let ccount: number;
        let stepms = 50;
        let off2chdata: number;
        let minver: number;
        let majver: number;
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
            stepsz = ccount;
            nframes = this.read32bit();
            stepms = this.read8bit();
            reserved = this.read8bit();

            if (majver === 1) {
                univcnt = this.read16bit();
                univsz = this.read16bit();
                gamma = this.read8bit();
                colorenc = this.read8bit();
                reserved2 = this.read16bit();

                compblocklist.push({ framenum: 0, blocksize: nframes * stepsz });
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

                    nranges = sparseRangeCount(this.buffer);
                    for (let i = 0; i < nranges; ++i) {
                        const startch = this.read24bit();
                        const chcount = this.read24bit();
                        chrangelist.push({ startch, chcount });
                    }

                    // Uncompressed files may have no block entries: the frames are one contiguous run.
                    if (comp === 0 && !compblocklist.length) {
                        compblocklist.push({ framenum: 0, blocksize: nframes * stepsz });
                    }
                }
            }

            if (!chrangelist.length) {
                chrangelist.push({ startch: 1, chcount: ccount });
            }

            if (full) {
                let srTable: Uint8Array | undefined;
                while (this.offset + 4 <= off2chdata) {
                    const hlen = this.read16bit() - 4;
                    if (hlen < 0) break; // corrupt; a zero length would never advance
                    const hname = new TextDecoder().decode(this.read(2));
                    const hdata = this.read(hlen);
                    if (hname === 'ED') {
                        // Extended data: the code, then the u64 file offset and u32 length of the data,
                        // which is only here when the whole file was handed in.
                        const at = this.offset - hlen;
                        if (hlen >= 14 && new TextDecoder().decode(hdata.subarray(0, 2)) === 'SR') {
                            const pos =
                                this.buffer.getUint32(at + 2, true) + this.buffer.getUint32(at + 6, true) * 2 ** 32;
                            const len = this.buffer.getUint32(at + 10, true);
                            if (pos + len <= this.buffer.byteLength) srTable = this.readAt(len, pos);
                        }
                        continue;
                    }
                    if (hname === 'SR') {
                        srTable = hdata;
                        continue;
                    }
                    // xLights NUL-terminates text headers; drop it as the Node reader does.
                    v1headers[hname] = new TextDecoder().decode(hdata).replace(/\0+$/, '');
                }
                const fullRanges = srTable && extendedSparseRanges(srTable, chrangelist, ccount);
                if (fullRanges) {
                    chrangelist.splice(0, chrangelist.length, ...fullRanges);
                    nranges = fullRanges.length;
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

const HEADER_AUDIO_EXTENSIONS = ['.mp3', '.wav', '.m4a', '.aac', '.flac', '.ogg', '.wma', '.mp4'];

/** Audio file name an FSEQ header asks for, from its media variable headers.
 *  xLights on Windows writes a full backslash path; only the file name matters. */
export function audioNameFromFseqHeaders(headers: Record<string, string> | undefined): string | undefined {
    if (!headers) return undefined;
    for (const key of ['mf', 'mu', 'md']) {
        const val = headers[key]?.trim();
        if (!val) continue;
        const name = val.replace(/\\/g, '/').split('/').pop() ?? '';
        const dot = name.lastIndexOf('.');
        if (dot >= 0 && HEADER_AUDIO_EXTENSIONS.includes(name.slice(dot).toLowerCase())) return name;
    }
    return undefined;
}

/** The audio name named by a browser File's FSEQ header, or undefined when it
 *  names none (an animation). Throws when the file is not an FSEQ. */
export async function getFSEQAudioNameBrowser(file: File): Promise<string | undefined> {
    const fixed = new DataView(await file.slice(0, 32).arrayBuffer());
    if (fixed.byteLength < 32) throw new Error('Not a PSEQ file');
    const magic = new TextDecoder().decode(new Uint8Array(fixed.buffer, 0, 4));
    if (magic === 'ESEQ') return undefined;
    if (magic !== 'PSEQ' && magic !== 'FSEQ') throw new Error('Not a PSEQ file');
    // The variable headers end where channel data starts.
    const headerLength = fixed.getUint16(4, true);
    const reader = new FSEQReaderBrowser(await file.slice(0, headerLength).arrayBuffer());
    await reader.readHeader(true);
    return audioNameFromFseqHeaders(reader.header?.headers);
}
