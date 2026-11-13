import { describe, expect, it } from 'vitest';
import { DDPSender } from '../dataplane/protocols/DDP';
import { E131Sender } from '../dataplane/protocols/E131';
import {
    ControllerState,
    applyControllerRoles,
    openControllerForDataSend,
    syncRemotesFromXlights,
} from './XLControllerSetup';
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

async function openE131(forceLocalIP?: string) {
    const xlRecord = new ControllerRec();
    xlRecord.name = 'C';
    xlRecord.forceLocalIP = forceLocalIP;
    xlRecord.universeNumbers = [1];
    xlRecord.universeSizes = [150];
    const c: ControllerState = {
        setup: {
            usable: true,
            skipped: false,
            summary: '',
            name: 'C',
            address: '127.0.0.1',
            startCh: 1,
            nCh: 150,
            proto: 'E131',
        },
        xlRecord,
    };
    await openControllerForDataSend(c);
    const sender = c.sender as E131Sender;
    await sender.client?.disconnect();
    return { report: c.report, localAddress: sender.localAddress };
}

describe('the address a controller is sent from', () => {
    it('is the forced local address when this computer has it', async () => {
        const { report, localAddress } = await openE131('127.0.0.1');
        expect(report?.status).toBe('open');
        expect(report?.notice).toBeUndefined();
        expect(localAddress).toBe('127.0.0.1');
    });

    it('falls back to the default interface when the forced address is not on this computer', async () => {
        // TEST-NET-3: never an address of the machine running this.
        const { report, localAddress } = await openE131('203.0.113.9');
        expect(report?.status).toBe('open');
        expect(report?.notice).toMatch(/203\.0\.113\.9 is not assigned to any network interface/);
        expect(localAddress).toBeUndefined();
    });
});

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

    it('takes the part from our own record over the layout', () => {
        const [remote, player, back] = applyControllerRoles(
            [
                rec({ name: 'R' }).xlRecord!,
                rec({ name: 'P' }).xlRecord!,
                rec({ name: 'Back', activeState: 'xLights Only' }).xlRecord!,
            ],
            { R: 'remote', P: 'player', Back: 'enabled' },
        );
        expect(remote.activeState).toBe('xLights Only');
        expect(player.activeState).toBe('xLights Only');
        expect(back.activeState).toBe('Active');
        // A player holds its own copy and runs it itself; only the remote follows sync.
        const remotes = syncRemotesFromXlights([
            { ...rec({ name: 'R' }), xlRecord: remote },
            { ...rec({ name: 'P' }), xlRecord: player },
        ]);
        expect(remotes.map((r) => r.name)).toEqual(['R']);
    });

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

    it('leaves out the show player, which has no channels of its own', () => {
        // An FPP player/proxy is "xLights Only" because nothing should send it
        // pixels -- sending it sync would drive the wrong device.
        expect(
            syncRemotesFromXlights([
                rec({
                    name: 'fpp4-lab',
                    address: '192.168.1.23',
                    activeState: 'xLights Only',
                    protocol: 'Player Only',
                    model: 'FPP Player Only',
                    maxch: 0,
                }),
                rec({ name: 'Real remote', address: '10.0.0.9', activeState: 'xLights Only', maxch: 9600 }),
            ]),
        ).toEqual([{ name: 'Real remote', address: '10.0.0.9' }]);
    });

    it('leaves out a family that cannot follow our sync', () => {
        // A HinksPix SLAVE follows a HinksPix master, not the show's sync, so
        // it is given content and left to play it rather than sent sync it
        // will never hear.
        expect(
            syncRemotesFromXlights([
                rec({
                    name: 'hinks pro v3',
                    address: '10.0.0.57',
                    activeState: 'xLights Only',
                    vendor: 'HinksPix',
                    maxch: 2550,
                }),
                rec({ name: 'Real remote', address: '10.0.0.9', activeState: 'xLights Only', maxch: 9600 }),
            ]),
        ).toEqual([{ name: 'Real remote', address: '10.0.0.9' }]);
    });

    it('leaves out a controller that owns no channels', () => {
        expect(
            syncRemotesFromXlights([
                rec({ name: 'Empty', address: '10.0.0.5', activeState: 'xLights Only', maxch: 0 }),
            ]),
        ).toEqual([]);
    });

    it('leaves out anything with no address to send to', () => {
        expect(syncRemotesFromXlights([rec({ name: 'Nowhere', address: '', activeState: 'xLights Only' })])).toEqual(
            [],
        );
        expect(syncRemotesFromXlights([rec({ name: 'Null', type: 'Null', activeState: 'xLights Only' })])).toEqual([]);
    });
});
