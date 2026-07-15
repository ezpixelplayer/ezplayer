import { describe, expect, it } from 'vitest';
import type { EZPlayerCommand, PlaylistRecord, SequenceRecord } from '@ezplayer/ezplayer-core';
import { runFppCommand, type FppCommandDeps } from './fpp-commands';

function makeDeps(volume = 70): { deps: FppCommandDeps; sent: EZPlayerCommand[] } {
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
        getPStatus: () => ({ ptype: 'EZP', status: 'Playing', reported_time: 0, volume: { level: volume } }),
        getPlaylists: () => playlists,
        getSequences: () => sequences,
    };
    return { deps, sent };
}

describe('runFppCommand', () => {
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
        expect((sent[0] as any).requestId).toBeTruthy();
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

    it('volume set/increase/decrease clamp and use cached level', async () => {
        const { deps, sent } = makeDeps(95);
        await runFppCommand('Volume Set', ['150'], deps);
        await runFppCommand('Volume Increase', ['10'], deps);
        await runFppCommand('Volume Decrease', ['200'], deps);
        expect(sent).toEqual([
            { command: 'setvolume', volume: 100 },
            { command: 'setvolume', volume: 100 }, // 95+10 clamped
            { command: 'setvolume', volume: 0 }, // 95-200 clamped
        ]);
    });

    it('unknown command 404s, Prev is a 500 not-supported', async () => {
        const { deps } = makeDeps();
        expect((await runFppCommand('Launch Confetti', [], deps)).status).toBe(404);
        expect((await runFppCommand('Prev Playlist Item', [], deps)).status).toBe(500);
    });

    it('All Lights Off maps to stopnow', async () => {
        const { deps, sent } = makeDeps();
        await runFppCommand('All Lights Off', [], deps);
        expect(sent[0]).toEqual({ command: 'stopnow' });
    });
});
