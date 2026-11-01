import { describe, expect, it } from 'vitest';
import type { ControllerState } from '@ezplayer/epp';
import { applyDirectPiControllerOutput } from './pi-controller-output';

describe('Pi direct controller output', () => {
    it('ignores resolved global and per-controller proxies without changing the source records', () => {
        const records = [
            { address: '192.168.2.100', fppProxy: '192.168.88.30', startch: 50821, keepChannelNumbers: true },
            { address: '192.168.2.54', fppProxy: '192.168.88.31', startch: 71841, keepChannelNumbers: false },
        ];
        const originals = structuredClone(records);
        const controllers = records.map((xlRecord) => ({
            setup: { address: xlRecord.address, proto: 'DDP' },
            xlRecord,
        })) as unknown as ControllerState[];
        expect(applyDirectPiControllerOutput(controllers, true)).toBe(2);
        for (const [i, controller] of controllers.entries()) {
            expect(controller.xlRecord).toEqual({ ...originals[i], fppProxy: undefined });
            expect(controller.setup.address).toBe(originals[i].address);
        }
        expect(records).toEqual(originals);
        expect(applyDirectPiControllerOutput(controllers, true)).toBe(0);
    });

    it('preserves proxies outside the Pi appliance and accepts controllers without a record', () => {
        const record = { address: '192.168.2.100', fppProxy: '192.168.88.30' };
        const controllers = [{ xlRecord: record }, {}] as unknown as ControllerState[];
        expect(applyDirectPiControllerOutput(controllers, false)).toBe(0);
        expect(controllers[0].xlRecord).toBe(record);
        expect(applyDirectPiControllerOutput([controllers[1]], true)).toBe(0);
    });
});
