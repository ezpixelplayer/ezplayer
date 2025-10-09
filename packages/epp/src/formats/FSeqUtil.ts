import { promises as fsp } from 'fs';
import { ZSTDDecoder } from 'zstddec';
import { FileReadRequest, FileReadWorker } from '../util/ReadFileWorkers';
import { readUInt24LE, toDataView, toUint8Array } from '../util/Utils';

const utfDecoder = new TextDecoder('utf-8');

//
// This is a very top-heavy view of fseq files.  It reads and calls back with data.
// A better architecture is needed for streaming the file / seeking on demand / real time
//

interface CompBlock {
    framenum: number;
    blocksize: number;
}

interface SparseRange {
    startch: number;
    chcount: number;
}

export class ModelRec {
    name: string;
    startch: number;
    nch: number;
    typ: string;
    r: number; // Ch offset int
    g: number;
    b: number;
    gamma: number;
    brightness: number;

    constructor(name: string, mtype: string, startch: number, nch: number) {
        this.name = name;
        this.startch = startch;
        this.nch = nch;
        this.typ = mtype;
        this.r = 0; // Red channel offset
        this.g = 1; // Green channel offset
        this.b = 2; // Blue channel offset
        this.gamma = 1; // Default gamma value
        this.brightness = 1; // Default brightness value
    }

    toString(): string {
        return `${this.name}:${this.startch},${this.nch}`;
    }
}

export class FSEQHeader
{
    hdr4: string = "";
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

    headers: {[key:string]: string} = {};
}

class CompBlockIndex {
    startFrame: number = 0; // Note that this is 0-based and inclusive
    endFrame: number = 0; // Note this is exclusive, so endFrame - startFrame = num frames
    fileOffset: number = 0;
    fileSize: number = 0;
}


class CompBlockCacheEntry {
    decompBuf?: Uint8Array;
}

export class CompBlockCache {
    index: CompBlockIndex[] = [];
    entries: CompBlockCacheEntry[] = [];

    findChunk(frame: number): number | undefined {
        let low = 0;
        let high = this.index.length - 1;
          
        while (low <= high) {
            const mid = (low + high) >>> 1;
            const range = this.index[mid];
        
            if (frame < range.startFrame) {
                high = mid - 1;
            } else if (frame >= range.endFrame) {
                low = mid + 1;
            } else {
                return mid;
            }
        }

        return undefined;
    }
}

////////////////
// Sync reader
////////////////

export class FSEQReaderSync
{
    filename: string;
    fd?: fsp.FileHandle;
    fdo: number = 0;
    header?: FSEQHeader;

    async read(n: number) {
        if (!this.fd) throw new Error("Not open");
        const pos = null;
        const len = n;
        const boff = 0;
        const buffer = new DataView(new ArrayBuffer(n));
        await this.fd.read(buffer, boff, len, pos);
        this.fdo += n;
        return buffer;
    }

    async readAt(n: number, at: number) {
        if (!this.fd) throw new Error("Not open");
        const pos = at;
        const len = n;
        const boff = 0;
        const buffer = new DataView(new ArrayBuffer(n));
        await this.fd.read(buffer, boff, len, pos);
        this.fdo = at + n;
        return buffer;
    }

    async read8bit() : Promise<number> {
        const arr = await this.read(1);
        return arr.getUint8(0);
    }

    async read16bit()  : Promise<number> {
        const arr = await this.read(2);
        return arr.getUint16(0, true);
    }

    async read24bit() : Promise<number> {
        const arr = await this.read(3);
        return arr.getUint8(0) + arr.getUint8(1)*256 + arr.getUint8(2)*65536;
    }

    async read32bit() : Promise<number> {
        const arr = await this.read(4);
        return arr.getUint32(0, true);
    }

    constructor(fn: string) {
        this.filename = fn;
    }

    async open() {
        if (this.fd) {
            throw new Error("Already open");
        }
        this.fdo = 0;
        this.fd = await fsp.open(this.filename, 'r');
    }

    async close() {
        try {
            await this.fd?.close();
        }
        catch (e)
        {
        }
        this.fd = undefined;
    }

    async readHeader() {
        if (!this.fd) throw new Error("Not open");
        const hdr = await this.read(4);
        const shdr = utfDecoder.decode(hdr);
        const isEseq = (shdr === 'ESEQ');
        if (shdr !== 'PSEQ' && shdr !== 'ESEQ' && shdr !== 'FSEQ') {
            throw new Error("Not a PSEQ file");
        }

        // Things we will need to read the frames
        let nframes = 0; // Number of frames
        let stepsz = 0; // Size of uncompressed frame
        const compblocklist : CompBlock[] = []; // Bit about reading the file and decompressing
        const chrangelist: SparseRange[] = [];
        const v1headers: {[key:string]: string} = {};
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
        let uuid1 = 0, uuid2 = 0;
        let blks = 0;
        let nranges = 0;

        if (isEseq) {
            off2chdata = 20;
            minver = 0;
            majver = 2;

            modelcnt = await this.read32bit();
            stepsz = await this.read32bit();
            modelstart = await this.read32bit();
            ccount = await this.read32bit();
            modelsize = ccount;

            //Noting the lack of // of frames, frame timing, or any compression.  This format sucks.
            const flen = (await this.fd.stat()).size;
            nframes = Math.floor((flen - off2chdata) / stepsz);
            compblocklist.push({framenum: 0, blocksize: nframes * stepsz});
            chrangelist.push({startch: modelstart, chcount: modelsize});
        }
        else {
            off2chdata = await this.read16bit();
            minver = await this.read8bit();
            majver = await this.read8bit();

            const isv1 = (majver === 1);

            //console.log("offset to channel data: "+str(off2chdata))
            //console.log("Version "+str(majver)+'.'+str(minver))

            shdrlen = await this.read16bit();
            ccount = await this.read32bit();
            stepsz = Math.floor((ccount + 3) / 4) * 4;
            nframes = await this.read32bit();
            stepms = await this.read8bit();
            reserved = await this.read8bit();

            if (isv1) {
                univcnt = await this.read16bit();
                univsz = await this.read16bit();
                gamma = await this.read8bit();
                colorenc = await this.read8bit();
                reserved2 = await this.read16bit();

                // Double check this math, is it rounded up?
                compblocklist.push({framenum: 0, blocksize: nframes*ccount});
            }
            else {
                const compandblks = await this.read8bit();
                comp = compandblks & 15;
                blks = (compandblks & 240) * 16;
                blks += await this.read8bit();
                //console.log ("blocks: "+str(blks))
                nranges = await this.read8bit();
                reserved2 = await this.read8bit();
                uuid1 = await this.read32bit();
                uuid2 = await this.read32bit();

                // Compression blocks
                // Compress block index: 4 frame num, 4 length
                let seenEmpty = false;
                for (let i=0; i<blks; ++i) {
                    const framenum = await this.read32bit();
                    const blocksize = await this.read32bit();
                    if (!blocksize) {
                        seenEmpty = true;
                        if (framenum) {
                            throw new Error(`Empty block (${i}) with frame number (${framenum}) assigned`);
                        }
                        continue;
                    }
                    if (seenEmpty) {
                        throw new Error("Empty blocks followed by nonempty blocks "+i.toString());
                    }
                    compblocklist.push({framenum, blocksize});
                }

                // Sparse range map
                // Sparse ranges: 3 ch num, 3 num ch
                for (let i=0; i<nranges; ++i) {
                    const startnum = await this.read24bit();
                    const chcount = await this.read24bit();
                    chrangelist.push({startch:startnum, chcount:chcount});
                }
            }

            if (!chrangelist.length) {
                chrangelist.push({startch: 1, chcount: ccount});
            }

            while (this.fdo + 4 <= off2chdata) {
                //console.log ("At "+str(fh.tell())+" vs " + str(shdrlen))
                const hlen = await this.read16bit() - 4;
                const hname = utfDecoder.decode(await this.read(2));
                //console.log ("Header "+hname+": "+str(hlen))
                const hval = utfDecoder.decode(await this.read(hlen));
                v1headers[hname] = hval; // TODO: Does it need to chop 1 off the end for trailing \0?
            }
        }
        this.header = {
            hdr4: shdr,
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

    async processFrames(visitframe: (param: {frame: Uint8Array, fnum: number, ftime: number, hdr: FSEQHeader})=>void) {
        if (!this.fd || !this.header) {
            throw new Error("Not open");
        }

        //console.log("Decode "+str(nframes)+" frames")
        let curframe = 0;
        let curms = 0;

        let foff = this.header.chdata_offset;
        let cn = 0;
        for (const blk of this.header.compblocklist)
        {
            const {framenum: sframe, blocksize: dsz} = blk;
            if (sframe !== curframe) {
                throw new Error(`Unexpected start frame ${sframe} vs ${curframe} ; ${dsz} / ${this.header.compblocklist.length}`);
            }

            let raw: Uint8Array = toUint8Array(await this.readAt(dsz, foff));
            let lenraw = dsz;
            //console.log("Read of " + str(dsz) + " got "+str(len(raw)))
            foff += dsz;
            if (this.header.compression === 1) {
                let nframes = this.header.frames - curframe;
                if (cn < this.header.compblocklist.length - 1) {
                    nframes = this.header.compblocklist[cn+1].framenum-curframe;
                }
                lenraw = nframes*this.header.stepsize;
                const decoder = new ZSTDDecoder();
                await decoder.init();
                //console.log(`${dsz} - ${lenraw} - ${nframes} - ${this.header.stepsize} - ${cn} - ${curframe}`);
                raw = decoder.decode(raw, lenraw);
            }
            else if (this.header.compression === 2) {
                throw new Error("Need to implement zlib");
            }

            let frmoffset = 0;
            //console.log("Raw len: "+str(len(raw))+"; step size "+str(stepsz))
            while (frmoffset < lenraw)
            {
                const frame = raw.subarray(frmoffset, frmoffset+this.header.stepsize);
                // At this point we have:
                // frame, curms, curframe, etc.
                visitframe({frame, fnum:curframe, ftime: curms, hdr: this.header});

                //console.log('Frame '+str(curframe)+' done')
                //console.log ("Frame //"+str(len(frames))+"/"+str(curms)+" done")
                frmoffset += this.header.stepsize;
                ++curframe;
                curms = curms + this.header.msperframe;
            }
            if (frmoffset !== lenraw) {
                throw new Error("Partial frame");
            }
            ++cn;
        }
        if (curframe !== this.header.frames) {
            throw new Error("Frame count mismatch");
        }
    }

    async processFrameModels(models: ModelRec[], srcmodels: string[],
        visitmodel:(param:{model:ModelRec, frame:Uint8Array, fnum: number, ftime: number, hdr: FSEQHeader})=>void,
        frameEnd?:(param: {frame: Uint8Array, fnum: number, ftime: number, hdr: FSEQHeader})=>void,
        frameStart?:(param: {frame: Uint8Array, fnum: number, ftime: number, hdr: FSEQHeader})=>void)
    {
        return this.processFrames((param) => {
            if (frameStart) frameStart(param);
            // Go through each model and visit it
            for (const m of models) {
                if (srcmodels && srcmodels.length && !srcmodels.includes(m.name)) {
                    continue;
                }
                const sch = m.startch;
                const ech = m.nch >= 0 ? m.startch + m.nch : param.hdr.channels; // TODO One of these is off by 1 if this is 1-based

                // See if we have data for the model, considering sparse range
                let curoff = 0;
                //console.log("Model channel range "+str(sch)+"-"+str(ech))
                for (const schrng of param.hdr.chranges) {
                    const {startch: rstart, chcount: rcnt} = schrng;
                    //console.log("Seq channel range "+str(rstart)+"-"+str(rstart+rcnt))
                    if (sch >= rstart && ech <= rstart+rcnt) {
                        //console.log("Using it... @"+str(sch-rstart))
                        const msub = param.frame.subarray(curoff + sch - rstart, curoff + ech - rstart + 1);
                        //console.log("Starting model "+m.name)
                        visitmodel({model:m, frame:msub, fnum:param.fnum, ftime:param.ftime, hdr:param.hdr});
                        //console.log("Finished model "+m.name)
                    }
                    curoff += rcnt;
                }
            }
            if (frameEnd) frameEnd(param);
        });
    }
}

////////////////
// Async reader
////////////////

export class FSEQReaderAsync
{
    static async readFixedHeaderAsync(fr: FileReadWorker, clientid: number, fileid: number, reqid: number) : Promise<FSEQHeader> {
        const hreq1: FileReadRequest = {
            clientid,
            fileid,
            reqid,
            offset: 0,
            length: 32,
        };
        const {readBytes: readBytes1} = await fr.asyncRead(hreq1);
        if (readBytes1 !== 32) throw new Error(`Did not read 32 bytes from purported FSEQ file`);

        const baseHdr = FSEQReaderAsync.decodeFSEQHeader(hreq1.buf!, hreq1.bufoffset!, true);
        const realhlen = baseHdr.chdata_offset;

        const hreq2: FileReadRequest = {
            clientid,
            fileid,
            reqid,
            offset: 0,
            length: realhlen,
        };
        const {readBytes: readBytes2} = await fr.asyncRead(hreq2);
        if (readBytes2 !== realhlen) throw new Error(`Did not read full proper header from purported FSEQ file`);
        return FSEQReaderAsync.decodeFSEQHeader(hreq2.buf!, hreq2.bufoffset!, false);
    }

    static decodeFSEQHeader(ibuf: Uint8Array, off: number, fixed: boolean, flen?: number): FSEQHeader {
        const origoff = off;
    
        const buf = toDataView(ibuf);
        const shdr = utfDecoder.decode(ibuf.subarray(off, off+4)); off += 4;
        const isEseq = (shdr === 'ESEQ');
        if (shdr !== 'PSEQ' && shdr !== 'ESEQ' && shdr !== 'FSEQ') {
            throw new Error("Not an xSEQ file");
        }

        // Things we will need to read the frames
        let nframes = 0; // Number of frames
        let stepsz = 0; // Size of uncompressed frame
        const compblocklist : CompBlock[] = []; // Bit about reading the file and decompressing
        const chrangelist: SparseRange[] = [];
        const v1headers: {[key:string]: string} = {};
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
        let uuid1 = 0, uuid2 = 0;
        let blks = 0;
        let nranges = 0;
        
        if (isEseq) {
            off2chdata = 20;
            minver = 0;
            majver = 2;

            modelcnt = buf.getUint32(off, true); off += 4;
            stepsz = buf.getUint32(off, true); off += 4;
            modelstart = buf.getUint32(off, true); off += 4;
            ccount = buf.getUint32(off, true); off += 4;
            modelsize = ccount;

            // Noting the lack of #frames, frame timing, or any compression.  This format sucks.
            nframes = Math.floor(((flen ?? 0) - off2chdata) / stepsz);
            compblocklist.push({framenum: 0, blocksize: nframes * stepsz});
            chrangelist.push({startch: modelstart, chcount: modelsize});
        }
        else {
            off2chdata = buf.getUint16(off, true); off += 2;
            minver = buf.getUint8(off); off += 1;
            majver = buf.getUint8(off); off += 1;

            const isv1 = (majver === 1);

            shdrlen = buf.getUint16(off, true); off += 2;
            ccount = buf.getUint32(off, true); off += 4;
            stepsz = Math.floor((ccount + 3) / 4) * 4;
            nframes = buf.getUint32(off, true); off += 4;
            stepms = buf.getUint8(off); off += 1;
            reserved = buf.getUint8(off); off += 1;

            if (isv1) {
                univcnt = buf.getUint16(off, true); off += 2;
                univsz = buf.getUint16(off, true); off += 2;
                gamma = buf.getUint8(off); off += 1;
                colorenc = buf.getUint8(off); off += 1;
                reserved2 = buf.getUint16(off, true); off += 2;

                // Double check this math, is it rounded up?
                compblocklist.push({framenum: 0, blocksize: nframes*ccount});
            }
            else {
                const compandblks = buf.getUint8(off); off += 1;
                comp = compandblks & 15;
                blks = (compandblks & 240) * 16;
                blks += buf.getUint8(off); off += 1;
                nranges = buf.getUint8(off); off += 1;
                reserved2 = buf.getUint8(off); off += 1;
                uuid1 = buf.getUint32(off, true); off += 4;
                uuid2 = buf.getUint32(off, true); off += 4;

                if (!fixed) {
                    // Compression blocks
                    // Compress block index: 4 frame num, 4 length
                    let seenEmpty = false;
                    for (let i=0; i<blks; ++i) {
                        const framenum = buf.getUint32(off, true); off += 4;
                        const blocksize = buf.getUint32(off, true); off += 4;
                        if (!blocksize) {
                            seenEmpty = true;
                            if (framenum) {
                                throw new Error(`Empty block (${i}) with frame number (${framenum}) assigned`);
                            }
                            continue;
                        }
                        if (seenEmpty) {
                            throw new Error("Empty blocks followed by nonempty blocks "+i.toString());
                        }
                        compblocklist.push({framenum, blocksize});
                    }

                    // Sparse range map
                    // Sparse ranges: 3 ch num, 3 num ch
                    for (let i=0; i<nranges; ++i) {
                        const startnum = buf.getUint32(off, true); off += 4;
                        const chcount = readUInt24LE(buf, off); off += 3;
                        chrangelist.push({startch:startnum, chcount:chcount});
                    }
                }
            }

            if (!chrangelist.length) {
                chrangelist.push({startch: 1, chcount: ccount});
            }

            if (!fixed) {
                while (off + 4 - origoff <= off2chdata) {
                    //console.log ("At "+str(fh.tell())+" vs " + str(shdrlen))
                    const hlen = buf.getUint16(off, true); - 4; off += 2;
                    const hname = utfDecoder.decode(ibuf.subarray(off, off+2)); off += 2;
                    //console.log ("Header "+hname+": "+str(hlen))
                    const hval = utfDecoder.decode(ibuf.subarray(off, off+hlen)); off += hlen;
                    v1headers[hname] = hval; // TODO: Does it need subarray(-1) off the end for trailing \0;
                }
            }
        }

        const header: FSEQHeader = {
            hdr4: shdr,
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
        return header;
    }

    static async readFSEQHeaderFRAsync(fr: FileReadWorker, path: string, clientid = 0, fileid = 0) {
        fr.openClient({clientid});
        await fr.asyncOpenFile({clientid, fileid, path});

        try {
            return await FSEQReaderAsync.readFixedHeaderAsync(fr, clientid, fileid, 0);
        }
        finally {
            await fr.asyncCloseFile({clientid, fileid});
            await fr.asyncCloseClient({clientid});
        }
    }

    static async readFSEQHeaderAsync(path: string) {
        const fr = new FileReadWorker();
        try {
            return await FSEQReaderAsync.readFSEQHeaderFRAsync(fr, path);
        }
        finally {
            await fr.asyncClose();
        }
    }

    async readFrame(frame: number): Promise<Uint8Array> {
        if (!this.header) throw new Error("Not open");
        const chunknum = this.cache.findChunk(frame);
        const cpf = this.header.stepsize;
        if (chunknum === undefined) throw new Error(`Invalid frame number ${frame} / ${this.header.frames}`); // Could go *all black*
        const chunk = this.cache.entries[chunknum];
        const cidx = this.cache.index[chunknum];
        if (chunk.decompBuf) {
            return chunk.decompBuf.subarray(cpf * (frame-cidx.startFrame), cpf * (1+frame-cidx.startFrame));
        }

        const clientid=0;
        const fileid=0;

        const req: FileReadRequest = {
            clientid,
            fileid,
            reqid: chunknum,
            offset: cidx.fileOffset,
            length: cidx.fileSize,
        };

        const {readBytes} = await this.filereader.asyncRead(req);
        if (readBytes !== cidx.fileSize) throw new Error(`Incomplete read on ${this.filename} @ ${req.offset}:${req.length}`);
        const nframes = cidx.endFrame-cidx.startFrame;
        const lenraw = nframes*this.header.stepsize;

        if (this.header.compression === 1) {
            const decoder = new ZSTDDecoder();
            await decoder.init();
            //console.log(`${dsz} - ${lenraw} - ${nframes} - ${this.header.stepsize} - ${cn} - ${curframe}`);
            chunk.decompBuf = decoder.decode(req.buf!, lenraw);
        }
        else if (this.header.compression === 2) {
            throw new Error("Need to implement zlib");
        }
        else {
            chunk.decompBuf = req.buf!;
        }

        return chunk.decompBuf.subarray(cpf * (frame-cidx.startFrame), cpf * (1+frame-cidx.startFrame));
    }

    filename: string;
    filereader: FileReadWorker = new FileReadWorker();
    header?: FSEQHeader;
    cache = new CompBlockCache();

    constructor(fn: string) {
        this.filename = fn;
    }

    async open() {
        this.header = await FSEQReaderAsync.readFSEQHeaderFRAsync(this.filereader, this.filename);
        FSEQReaderAsync.createCompBlockCache(this.header, this.cache);

        this.filereader.openClient({clientid: 0});
        await this.filereader.asyncOpenFile({clientid: 0, fileid: 0, path: this.filename});
    }

    static createCompBlockCache(header: FSEQHeader, cache: CompBlockCache) {
        let foff = header.chdata_offset;
        for (let i = 0; i < header.compblocklist.length; ++i) {
            const cb = header.compblocklist[i];

            cache.entries.push({});
            const ci = {
                startFrame: cb.framenum,
                endFrame: i < header.compblocklist.length - 1 ? header.compblocklist[i + 1].framenum : header.frames,
                fileOffset: foff,
                fileSize: cb.blocksize,
            };
            cache.index.push(ci);

            foff += cb.blocksize;
        }
    }

    async close() {
        await this.filereader.asyncCloseFile({clientid: 0, fileid: 0});
        await this.filereader.asyncCloseClient({clientid: 0});
    }
}
