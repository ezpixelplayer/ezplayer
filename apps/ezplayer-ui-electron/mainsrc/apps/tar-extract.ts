// A small tar reader for app packages: GitHub archive tarballs and `tar czf` output.
// Handles ustar/pax headers (long paths come as pax `path=` records or GNU 'L' entries).
// Not a general tar library: links, devices and sparse files are skipped.

export interface TarEntry {
    /** Path inside the archive, forward slashes, no leading `./`. */
    path: string;
    type: 'file' | 'dir';
    data: Buffer;
    mode: number;
}

const BLOCK = 512;

function str(buf: Buffer, off: number, len: number): string {
    const end = buf.indexOf(0, off);
    return buf.subarray(off, end === -1 || end > off + len ? off + len : end).toString('utf8');
}

function octal(buf: Buffer, off: number, len: number): number {
    const s = str(buf, off, len).trim();
    return s === '' ? 0 : parseInt(s, 8);
}

/** Parse pax extended-header records: "<len> <key>=<value>\n". */
function paxRecords(data: Buffer): Record<string, string> {
    const out: Record<string, string> = {};
    let pos = 0;
    while (pos < data.length) {
        const sp = data.indexOf(0x20, pos);
        if (sp === -1) break;
        const len = parseInt(data.subarray(pos, sp).toString('ascii'), 10);
        if (!Number.isFinite(len) || len <= 0) break;
        const rec = data.subarray(sp + 1, pos + len - 1).toString('utf8');
        const eq = rec.indexOf('=');
        if (eq !== -1) out[rec.slice(0, eq)] = rec.slice(eq + 1);
        pos += len;
    }
    return out;
}

export function* readTar(tar: Buffer): Generator<TarEntry> {
    let pos = 0;
    let longName: string | undefined;
    let paxPath: string | undefined;
    while (pos + BLOCK <= tar.length) {
        const h = tar.subarray(pos, pos + BLOCK);
        if (h.every((b) => b === 0)) break; // end-of-archive blocks
        const size = octal(h, 124, 12);
        const type = String.fromCharCode(h[156] || 0x30);
        let name = str(h, 0, 100);
        const prefix = str(h, 345, 155);
        if (prefix && str(h, 257, 6).startsWith('ustar')) name = `${prefix}/${name}`;
        const dataStart = pos + BLOCK;
        const data = tar.subarray(dataStart, dataStart + size);
        pos = dataStart + Math.ceil(size / BLOCK) * BLOCK;

        if (type === 'L') {
            longName = str(data, 0, data.length);
            continue;
        }
        if (type === 'x') {
            paxPath = paxRecords(data).path;
            continue;
        }
        if (type === 'g') continue; // pax global header (GitHub puts the commit id here)
        const full = (paxPath ?? longName ?? name).replace(/\\/g, '/').replace(/^(\.\/)+/, '');
        longName = undefined;
        paxPath = undefined;
        if (full === '' || full === '.') continue;
        if (type === '0' || type === '\0' || type === '7') {
            yield { path: full.replace(/\/+$/, ''), type: 'file', data: Buffer.from(data), mode: octal(h, 100, 8) };
        } else if (type === '5') {
            yield { path: full.replace(/\/+$/, ''), type: 'dir', data: Buffer.alloc(0), mode: octal(h, 100, 8) };
        }
        // Links, devices and anything else are not part of an app package.
    }
}
