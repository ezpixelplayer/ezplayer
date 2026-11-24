import { describe, expect, it } from 'vitest';
import { readTar } from './tar-extract';

/** Build one ustar header block. */
function header(name: string, size: number, type: string, prefix = ''): Buffer {
    const h = Buffer.alloc(512);
    h.write(name, 0, 'utf8');
    h.write('0000644\0', 100);
    h.write('0000000\0', 108);
    h.write('0000000\0', 116);
    h.write(size.toString(8).padStart(11, '0') + '\0', 124);
    h.write('00000000000\0', 136);
    h.write(type, 156);
    h.write('ustar\0', 257);
    h.write('00', 263);
    if (prefix) h.write(prefix, 345);
    // checksum over the header with the checksum field as spaces
    h.fill(0x20, 148, 156);
    let sum = 0;
    for (const b of h) sum += b;
    h.write(sum.toString(8).padStart(6, '0') + '\0 ', 148);
    return h;
}

function entry(name: string, data: string, type = '0', prefix = ''): Buffer {
    const body = Buffer.from(data, 'utf8');
    const padded = Buffer.alloc(Math.ceil(body.length / 512) * 512);
    body.copy(padded);
    return Buffer.concat([header(name, body.length, type, prefix), padded]);
}

const END = Buffer.alloc(1024);

describe('readTar', () => {
    it('reads files and directories with ustar prefixes', () => {
        const tar = Buffer.concat([
            entry('pkg-main/', '', '5'),
            entry('pkg-main/ezapp.json', '{"id":"x"}'),
            entry('deep/file.txt', 'hello', '0', 'pkg-main/sub'),
            END,
        ]);
        const got = [...readTar(tar)];
        expect(got.map((e) => [e.path, e.type])).toEqual([
            ['pkg-main', 'dir'],
            ['pkg-main/ezapp.json', 'file'],
            ['pkg-main/sub/deep/file.txt', 'file'],
        ]);
        expect(got[1].data.toString()).toBe('{"id":"x"}');
        expect(got[2].data.toString()).toBe('hello');
    });

    it('takes long names from pax and GNU headers and skips the global header', () => {
        const long = 'a'.repeat(120) + '/page/index.html';
        const rec = `path=${long}\n`;
        const paxRecord = `${rec.length + String(rec.length + 2).length + 1} ${rec}`;
        const tar = Buffer.concat([
            entry('pax_global_header', '52 comment=abc\n', 'g'),
            entry('PaxHeader/x', paxRecord, 'x'),
            entry('short', 'body'),
            entry('././@LongLink', `${long}2\0`, 'L'),
            entry('truncated', 'body2'),
            END,
        ]);
        const got = [...readTar(tar)];
        expect(got.map((e) => e.path)).toEqual([long, `${long}2`]);
        expect(got[0].data.toString()).toBe('body');
        expect(got[1].data.toString()).toBe('body2');
    });

    it('skips links', () => {
        const tar = Buffer.concat([entry('link', '', '2'), entry('f', 'x'), END]);
        expect([...readTar(tar)].map((e) => e.path)).toEqual(['f']);
    });
});
