import { describe, expect, it } from 'vitest';
import type { EZPlayerCommand, PlaylistRecord, SequenceRecord } from '@ezplayer/ezplayer-core';
import { fppCommandDescriptors, runFppCommand, type FppCommandDeps } from './fpp-commands';

function makeDeps(): { deps: FppCommandDeps; sent: EZPlayerCommand[] } {
    const sent: EZPlayerCommand[] = [];
    const playlists: PlaylistRecord[] = [
        { id: 'pl1', title: 'Main Show', tags: [], createdAt: 0, items: [{ id: 'seq1', sequence: 1 }] },
    ];
    const sequences: SequenceRecord[] = [
        {
            id: 'seq1',
            instanceId: 'i1',
            work: { title: 'Carol', artist: '', length: 60 },
            files: { fseq: 'C:\\show\\Carol.fseq' },
        },
    ];
    const deps: FppCommandDeps = {
        sendPlayerCommand: (cmd) => void sent.push(cmd),
        getPlaylists: () => playlists,
        getSequences: () => sequences,
    };
    return { deps, sent };
}

describe('runFppCommand', () => {
    it('Insert Playlist Immediate reads FPP’s arguments: name, start item, end item, if-not-running', async () => {
        const { deps, sent } = makeDeps();
        const res = await runFppCommand('Insert Playlist Immediate', ['Main Show', '3', '0', '0'], deps);
        expect(res.status).toBe(200);
        expect(res.message).toMatch(/start item not supported/);
        // The second argument is a start item, never a repeat flag.
        expect(sent[0]).toMatchObject({ command: 'playplaylist', loop: false });
    });

    it('honors "if not running" on Start Playlist and Insert Playlist Immediate', async () => {
        const { deps, sent } = makeDeps();
        deps.getPStatus = () => ({ ptype: 'EZP', status: 'Playing', reported_time: 0 });
        expect((await runFppCommand('Start Playlist', ['Main Show', '0', '1'], deps)).status).toBe(200);
        expect((await runFppCommand('Insert Playlist Immediate', ['Main Show', '0', '0', '1'], deps)).status).toBe(200);
        expect(sent).toEqual([]);
        await runFppCommand('Start Playlist', ['Main Show', '0', '0'], deps);
        expect(sent).toHaveLength(1);
    });

    it('Start Playlist resolves by title (case-insensitive) and maps repeat', async () => {
        const { deps, sent } = makeDeps();
        const res = await runFppCommand('Start Playlist', ['main show', '1', '0', '0'], deps);
        expect(res.status).toBe(200);
        expect(sent[0]).toMatchObject({
            command: 'playplaylist',
            playlistId: 'pl1',
            immediate: true,
            loop: true,
            priority: 1,
        });
        expect((sent[0] as { requestId?: unknown }).requestId).toBeTruthy();
    });

    it('Start Playlist falls back to a bare sequence name (fseq basename)', async () => {
        const { deps, sent } = makeDeps();
        const res = await runFppCommand('Start Playlist', ['Carol.fseq', '0'], deps);
        expect(res.status).toBe(200);
        expect(sent[0]).toMatchObject({ command: 'playsong', songId: 'seq1', immediate: true });
    });

    it('Start Playlist errors on unknown target', async () => {
        const { deps, sent } = makeDeps();
        const res = await runFppCommand('Start Playlist', ['Nope'], deps);
        expect(res.status).toBe(500);
        expect(sent.length).toBe(0);
    });

    it('maps stop/pause/resume/next', async () => {
        const { deps, sent } = makeDeps();
        expect((await runFppCommand('Stop Now', [], deps)).status).toBe(200);
        expect((await runFppCommand('Stop Gracefully', ['true'], deps)).status).toBe(200);
        expect((await runFppCommand('Pause Playlist', [], deps)).status).toBe(200);
        expect((await runFppCommand('Resume Playlist', [], deps)).status).toBe(200);
        expect((await runFppCommand('Next Playlist Item', [], deps)).status).toBe(200);
        expect(sent.map((c) => c.command)).toEqual(['stopnow', 'stopgraceful', 'pause', 'resume', 'endsong']);
    });

    describe('volume commands write the default volume', () => {
        function withVolume(defaultVolume: number, activeWindows: string[] = []) {
            const { deps, sent } = makeDeps();
            const written: number[] = [];
            deps.volume = {
                getVolume: () => ({ defaultVolume, activeWindows }),
                setDefaultVolume: async (level) => void written.push(level),
            };
            return { deps, sent, written };
        }

        it('Volume Set writes the default and never sends a player command', async () => {
            const { deps, sent, written } = withVolume(70);
            const res = await runFppCommand('Volume Set', ['50'], deps);
            expect(res.status).toBe(200);
            expect(written).toEqual([50]);
            expect(sent).toEqual([]);
        });

        it('Increase/Decrease/Adjust are relative to the default and clamp to 0-100', async () => {
            const { deps, written } = withVolume(95);
            await runFppCommand('Volume Increase', ['10'], deps);
            await runFppCommand('Volume Decrease', ['20'], deps);
            await runFppCommand('Volume Adjust', ['-100'], deps);
            await runFppCommand('Volume Adjust', ['+3'], deps);
            expect(written).toEqual([100, 75, 0, 98]);
        });

        it('is declined with the reason while a scheduled window is in effect', async () => {
            const { deps, written } = withVolume(70, ['System default: 20:00-22:00 at 40%']);
            const res = await runFppCommand('Volume Set', ['50'], deps);
            expect(res.status).toBe(500);
            expect(res.message).toMatch(/20:00-22:00 at 40%/);
            expect(written).toEqual([]);
        });

        it('rejects a non-numeric level and reports unloaded settings', async () => {
            const { deps } = withVolume(70);
            expect((await runFppCommand('Volume Set', ['loud'], deps)).status).toBe(400);
            expect((await runFppCommand('Volume Set', [], deps)).status).toBe(400);
            const { deps: bare } = makeDeps();
            expect((await runFppCommand('Volume Set', ['50'], bare)).status).toBe(500);
        });
    });

    it('unknown command 404s, Prev is a 500 not-supported', async () => {
        const { deps } = makeDeps();
        expect((await runFppCommand('Launch Confetti', [], deps)).status).toBe(404);
        expect((await runFppCommand('Prev Playlist Item', [], deps)).status).toBe(500);
    });

    it('descriptors come from the same table as the handlers', async () => {
        const { deps } = makeDeps();
        for (const d of fppCommandDescriptors()) {
            expect((await runFppCommand(d.name, ['Main Show'], deps)).status).not.toBe(404);
        }
    });

    it('All Lights Off maps to stopnow', async () => {
        const { deps, sent } = makeDeps();
        await runFppCommand('All Lights Off', [], deps);
        expect(sent[0]).toEqual({ command: 'stopnow' });
    });
});
