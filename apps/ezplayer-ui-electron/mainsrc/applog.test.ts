import { EventEmitter } from 'node:events';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

let logsPath = '';
vi.mock('electron', () => ({ app: { getPath: () => logsPath } }));

const { beginSession, captureRendererConsole, hookStream, markSessionEnding, pruneLogs } = await import('./applog.js');

beforeEach(() => {
    logsPath = fs.mkdtempSync(path.join(os.tmpdir(), 'ezp-applog-'));
});
afterEach(() => {
    vi.restoreAllMocks();
    fs.rmSync(logsPath, { recursive: true, force: true });
});

describe('hookStream', () => {
    const fakeStream = (write: (chunk: unknown) => boolean) =>
        Object.assign(new EventEmitter(), { write }) as unknown as NodeJS.WriteStream;

    it('logs whole lines, tags them, strips colors, and still writes through', () => {
        const written: unknown[] = [];
        const stream = fakeStream((chunk) => (written.push(chunk), true));
        const lines: string[] = [];
        hookStream(stream, 'E ', { log: (l: string) => (lines.push(l), true) });

        stream.write('one\ntw');
        stream.write(Buffer.from('o\r\n\x1b[33mthree\x1b[39m\n'));
        stream.write('\n');

        expect(lines).toEqual(['E one', 'E two', 'E three']);
        expect(written).toHaveLength(3);
    });

    it('keeps logging when the real stream throws', () => {
        const stream = fakeStream(() => {
            throw new Error('EBADF');
        });
        const lines: string[] = [];
        hookStream(stream, '', { log: (l: string) => (lines.push(l), true) });
        expect(stream.write('x\n')).toBe(true);
        expect(lines).toEqual(['x']);
    });

    it('stops writing to the real stream after it errors, and keeps logging', () => {
        const written: unknown[] = [];
        const stream = fakeStream((chunk) => (written.push(chunk), true));
        const lines: string[] = [];
        hookStream(stream, '', { log: (l: string) => (lines.push(l), true) });

        stream.write('a\n');
        // Without a listener this emit would throw.
        stream.emit('error', Object.assign(new Error('EPIPE: broken pipe, write'), { code: 'EPIPE' }));
        stream.write('b\n');

        expect(written).toEqual(['a\n']);
        expect(lines).toEqual(['a', 'b']);
    });
});

describe('pruneLogs', () => {
    const old = (file: string) => {
        const t = new Date(Date.now() - 31 * 24 * 3600 * 1000);
        fs.utimesSync(file, t, t);
    };

    it('removes stale log files and caps main-crash.log', () => {
        const p = (n: string) => path.join(logsPath, n);
        fs.writeFileSync(p('scan-debug.log'), 'x');
        old(p('scan-debug.log'));
        fs.writeFileSync(p('ezplayer-main.log.3'), 'x');
        old(p('ezplayer-main.log.3'));
        fs.writeFileSync(p('ezplayer-main.log'), 'fresh');
        fs.writeFileSync(p('session-1.json'), '{}');
        old(p('session-1.json'));
        fs.writeFileSync(p('main-crash.log'), Buffer.alloc(5 * 1024 * 1024 + 1));

        pruneLogs(logsPath);

        expect(fs.readdirSync(logsPath).sort()).toEqual(['ezplayer-main.log', 'main-crash.log.1', 'session-1.json']);
    });
});

describe('beginSession', () => {
    const marker = (pid: number, extra: object = {}) =>
        fs.writeFileSync(
            path.join(logsPath, `session-${pid}.json`),
            JSON.stringify({ pid, version: '0.0.1', startedAt: 'then', ...extra }),
        );

    it('reports markers of dead processes, then writes its own', () => {
        vi.spyOn(process, 'on').mockReturnValue(process);
        vi.spyOn(process, 'kill').mockImplementation((pid) => {
            if (pid === 222) return true;
            throw Object.assign(new Error('gone'), { code: 'ESRCH' });
        });
        marker(111);
        marker(222);
        marker(333, { sessionEnding: true });
        fs.writeFileSync(path.join(logsPath, 'session-444.json'), 'not json');

        const leftovers = beginSession('0.6.11');

        expect(leftovers.map((m) => m.pid).sort()).toEqual([111, 333]);
        expect(leftovers.find((m) => m.pid === 333)?.sessionEnding).toBe(true);
        expect(fs.readdirSync(logsPath).sort()).toEqual(['session-222.json', `session-${process.pid}.json`].sort());
        const mine = JSON.parse(fs.readFileSync(path.join(logsPath, `session-${process.pid}.json`), 'utf8'));
        expect(mine).toMatchObject({ pid: process.pid, version: '0.6.11' });

        markSessionEnding();
        const ending = JSON.parse(fs.readFileSync(path.join(logsPath, `session-${process.pid}.json`), 'utf8'));
        expect(ending).toMatchObject({ startedAt: mine.startedAt, sessionEnding: true });
    });
});

describe('captureRendererConsole', () => {
    it('logs warnings and errors only, at a capped rate', () => {
        const wc = new EventEmitter();
        const log = vi.spyOn(console, 'log').mockImplementation(() => {});
        captureRendererConsole(wc as never, 'main');

        wc.emit('console-message', { level: 'info', message: 'hi', lineNumber: 1, sourceId: '' });
        wc.emit('console-message', { level: 'error', message: 'boom', lineNumber: 7, sourceId: 'app.js' });
        expect(log.mock.calls.map((c) => c[0])).toEqual(['[renderer:main] E boom (app.js:7)']);

        for (let i = 0; i < 100; i++) {
            wc.emit('console-message', { level: 'warning', message: `w${i}`, lineNumber: 0, sourceId: '' });
        }
        expect(log).toHaveBeenCalledTimes(60);
    });

    it('keeps the last few errors for reports, past the rate cap', () => {
        const wc = new EventEmitter();
        vi.spyOn(console, 'log').mockImplementation(() => {});
        const recent = captureRendererConsole(wc as never, 'main');
        for (let i = 0; i < 100; i++) {
            wc.emit('console-message', { level: 'error', message: `e${i}`, lineNumber: 0, sourceId: '' });
        }
        wc.emit('console-message', { level: 'warning', message: 'w', lineNumber: 0, sourceId: '' });
        expect(recent()).toEqual(['e95', 'e96', 'e97', 'e98', 'e99']);
    });
});
