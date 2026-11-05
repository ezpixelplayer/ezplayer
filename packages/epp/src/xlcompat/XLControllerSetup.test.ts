import { describe, expect, it } from 'vitest';
import { DDPSender } from '../dataplane/protocols/DDP';
import { ControllerState, openControllerForDataSend, syncRemotesFromXlights } from './XLControllerSetup';
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

describe('the show sync remotes', () => {
    function rec(over: Partial<ControllerRec> & { name: string }): ControllerState {
        const xlRecord = new ControllerRec();
        Object.assign(xlRecord, { address: '10.0.0.1', type: 'Ethernet', activeState: 'Active' }, over);
        return {
            setup: {
                usable: false,
                skipped: true,
                summary: '',
                name: over.name,
                address: xlRecord.address,
                startCh: -1,
                nCh: -1,
                proto: undefined,
            },
            xlRecord,
        };
    }

    it('is the controllers the layout marks "xLights Only"', () => {
        expect(
            syncRemotesFromXlights([
                rec({ name: 'Player side', address: '10.0.0.2' }),
                rec({ name: 'Far Side', address: '10.0.0.3', activeState: 'xLights Only' }),
                rec({ name: 'Off', address: '10.0.0.4', activeState: 'Inactive' }),
            ]),
        ).toEqual([{ name: 'Far Side', address: '10.0.0.3' }]);
    });

    it('notes a remote that is only reachable through a proxy', () => {
        expect(
            syncRemotesFromXlights([
                rec({ name: 'Behind', address: '10.0.0.3', activeState: 'xLights Only', fppProxy: 'fpp-lab' }),
            ]),
        ).toEqual([{ name: 'Behind', address: '10.0.0.3', proxy: 'fpp-lab' }]);
    });

    it('leaves out anything with no address to send to', () => {
        expect(syncRemotesFromXlights([rec({ name: 'Nowhere', address: '', activeState: 'xLights Only' })])).toEqual(
            [],
        );
        expect(syncRemotesFromXlights([rec({ name: 'Null', type: 'Null', activeState: 'xLights Only' })])).toEqual([]);
    });
});
