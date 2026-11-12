import { describe, expect, it } from 'vitest';
import * as fsp from 'fs/promises';
import * as os from 'os';
import * as path from 'path';
import { readControllerRecordOverrides } from './XLControllerRecords';

async function showWith(records: Record<string, unknown>[]): Promise<string> {
    const show = await fsp.mkdtemp(path.join(os.tmpdir(), 'ezp-records-'));
    const dir = path.join(show, '.ezplayer', 'controllers');
    await fsp.mkdir(dir, { recursive: true });
    for (const r of records) await fsp.writeFile(path.join(dir, `${String(r.name)}.json`), JSON.stringify(r));
    return show;
}

describe('what the controller records add to the layout', () => {
    it('reads the frame-rate override and the role', async () => {
        const show = await showWith([
            { name: 'Slow', fpsOverride: 20 },
            { name: 'Far', forceLocalIP: ' 10.0.0.7 ' },
            { name: 'Near', forceLocalIP: '' },
            { name: 'Remote', active: 'remote' },
            { name: 'Off', active: false },
            { name: 'Plain', active: true },
            { name: 'Gone', active: 'player', deleted: true },
        ]);
        expect(await readControllerRecordOverrides(show)).toEqual({
            fpsOverrides: { Slow: 20 },
            // `true` is a plain controller with no part of its own to give.
            roles: { Remote: 'remote', Off: 'disabled' },
            forceLocalIPs: { Far: '10.0.0.7' },
        });
    });

    it('contributes nothing for a show without records', async () => {
        const show = await fsp.mkdtemp(path.join(os.tmpdir(), 'ezp-norecords-'));
        expect(await readControllerRecordOverrides(show)).toEqual({ fpsOverrides: {}, roles: {}, forceLocalIPs: {} });
    });
});
