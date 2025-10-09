import { promises as fsp } from 'fs';

// Why even have this?
//   This did not live up to original intent and is bein phased out, see PrefetchCache.ts

//  To deal with the fact that there are potentially very many outstanding requests, that need prioritized
//   To deal with not honoring them if there are many results already ready
//  To keep things from getting lost
//  To allow a worker thread to be doing it(*)
//   Use of a worker thread means transfer lists
//   This becomes a bit messy.
//   The temptation then is for the worker thread with the next stage (e.g. decompression, or decode) to do this.
//   There would not be pipeline parallelism, but how much CPU work is here anyway?

interface FileOpen {
    clientid: number;
    fileid: number;
    path: string;
}

interface FileClose {
    clientid: number;
    fileid: number;
}

interface ClientOpen {
    clientid: number;
}

interface ClientClose {
    clientid: number;
}

export interface FileReadRequest {
    clientid: number,
    fileid: number,
    reqid: number,
    offset: number,
    length: number,
    buf?: Uint8Array,
    bufoffset?: number;

    callback?: (status: boolean, err?: Error)=>void;
    cancel?: ()=>void;    
}

class FRRequest {
    req: FileReadRequest;

    constructor(req: FileReadRequest) {
        this.req = req;
    }
}

class FRFile {
    requests: Map<number, FRRequest> = new Map();    

    handle: fsp.FileHandle;

    constructor(handle: fsp.FileHandle, readonly details: FileOpen) {
        this.handle = handle;
    }
}

class FRClient {
    files: Map<number, FRFile> = new Map();
}

export class FileReadWorker {
    clients: Map<number, FRClient> = new Map();

    openClient(client: ClientOpen) {
        if (this.clients.has(client.clientid)) throw new Error(`FileReader client ${client.clientid} is already open`);
        this.clients.set(client.clientid, new FRClient());
    }

    // TODO: Make this support callbacks?
    async asyncOpenFile(file: FileOpen) {
        const client = this.clients.get(file.clientid);
        if (!client) throw new Error(`FileReader client ${file.clientid} is not open`);
        if (client.files.has(file.fileid)) throw new Error(`FileReader client ${file.clientid} already has file ${file.fileid}`);
        const fh = await fsp.open(file.path);
        const f = new FRFile(fh, {...file});
        client.files.set(file.fileid, f);
    }

    async asyncCloseFile(file: FileClose) {
        const client = this.clients.get(file.clientid);
        if (!client) throw new Error(`FileReader client ${file.clientid} is not open`);
        const fr = client.files.get(file.fileid);
        if (!fr) throw new Error(`FileReader client ${file.clientid} does not have file ${file.fileid}`);
        // TODO: Cancel and await all requests.
        await fr.handle.close();
        client.files.delete(file.fileid);
    }

    async asyncCloseClient(client: ClientClose) {
        const c = this.clients.get(client.clientid);
        if (!c) throw new Error(`FileReader client ${client.clientid} is not open`);
        const fids = c.files.keys();
        for (const f of fids) {
            await this.asyncCloseFile({clientid: client.clientid, fileid: f});
        }
        this.clients.delete(client.clientid);
    }

    async asyncRead(req: FileReadRequest) {
        // TODO: Actually schedule and all that
        const client = this.clients.get(req.clientid);
        if (!client) throw new Error(`FileReader client ${req.clientid} is not open`);
        const fr = client.files.get(req.fileid);
        if (!fr) throw new Error(`FileReader client ${req.clientid} does not have file ${req.fileid}`);

        if (!req.buf) {
            req.buf = new Uint8Array(req.length);
            req.bufoffset = 0;
        }
        const r = await FileReadWorker.readFull(fr.handle, req);
        return {readBytes: r};
    }

    async asyncClose() {
        const cl = this.clients.keys();
        for (const cid of cl) {
            await this.asyncCloseClient({clientid: cid});
        }
    }

    static async readFull(handle: fsp.FileHandle, req: FileReadRequest) {
        let totalBytesRead = 0;
        while (totalBytesRead < req.length) {
            const { bytesRead } = await handle.read(
                req.buf!,
                req.bufoffset! + totalBytesRead,
                req.length - totalBytesRead,
                req.offset + totalBytesRead,
            );
    
            if (bytesRead === 0) {
                // EOF
                break;
            }
    
            totalBytesRead += bytesRead;
        }
        return totalBytesRead;
    }

    // Release buffer (if applicable) (is that our job)
}