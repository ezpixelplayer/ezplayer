import { describe, expect, it } from 'vitest';
import { DDPSender } from '../dataplane/protocols/DDP';
import { ControllerState, openControllerForDataSend } from './XLControllerSetup';
import { ControllerRec } from './XLXmlUtil';

async function openDdp(channelsPerPacket?: number) {
    const xlRecord = new ControllerRec();
    xlRecord.name = 'C';
    xlRecord.channelsPerPacket = channelsPerPacket;
    const c: ControllerState = {
        setup: {
            usable: true,
            skipped: false,
            summary: '',
            name: 'C',
            address: '127.0.0.1',
            startCh: 1,
            nCh: 150,
            proto: 'DDP',
        },
        xlRecord,
    };
    await openControllerForDataSend(c);
    const sender = c.sender as DDPSender;
    await sender.client?.disconnect();
    return sender.channelsPerPacket;
}

describe('DDP Channels Per Packet', () => {
    it('uses the size from xLights', async () => {
        expect(await openDdp(512)).toBe(512);
    });

    it('stays within what fits in a packet', async () => {
        expect(await openDdp(9000)).toBe(1440);
    });

    it('keeps the default when unset or nonsense', async () => {
        expect(await openDdp(undefined)).toBe(1440);
        expect(await openDdp(0)).toBe(1440);
    });
});
