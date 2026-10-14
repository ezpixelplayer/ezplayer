import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import * as fsp from 'fs/promises';
import * as os from 'os';
import * as path from 'path';
import type { AddressInfo } from 'net';
import type { Server } from 'http';
import Koa from 'koa';
import type { SequenceRecord } from '@ezplayer/ezplayer-core';
import { createFileApiRouter } from './file-api';

// A show folder whose songs keep their files in several places, as imports
// and media-folder settings leave them:
//   <show>/Root.fseq, Root.mp3                 the flat layout
//   <show>/MyShow/Sub.fseq, Sub.mp3            a registered song in a subfolder
//   <show>/MyShow/Loose.mp3                    unregistered, in a subfolder
//   <show>/Backup/Sub.mp3                      a stale copy that must not win
//   <media>/Media.mp3                          audio from the media folder
describe('file API: where downloads are found', () => {
    let tmp: string;
    let show: string;
    let media: string;
    let server: Server;
    let base: string;

    const write = async (p: string, body: string) => {
        await fsp.mkdir(path.dirname(p), { recursive: true });
        await fsp.writeFile(p, body);
    };
    const song = (id: string, fseq: string, audio?: string): SequenceRecord => ({
        id,
        instanceId: id,
        work: { title: id, artist: '', length: 10 },
        files: { fseq, audio },
    });

    beforeAll(async () => {
        tmp = await fsp.mkdtemp(path.join(os.tmpdir(), 'ezp-file-api-'));
        show = path.join(tmp, 'show');
        media = path.join(tmp, 'media');
        await write(path.join(show, 'Root.fseq'), 'root-fseq');
        await write(path.join(show, 'Root.mp3'), 'root-mp3');
        await write(path.join(show, 'MyShow', 'Sub.fseq'), 'sub-fseq');
        await write(path.join(show, 'MyShow', 'Sub.mp3'), 'sub-mp3');
        await write(path.join(show, 'MyShow', 'Loose.mp3'), 'loose-mp3');
        await write(path.join(show, 'Backup', 'Sub.mp3'), 'stale-backup');
        await write(path.join(show, 'MediaSong.fseq'), 'media-song-fseq');
        await write(path.join(media, 'Media.mp3'), 'media-mp3');
        await write(path.join(tmp, 'Outside.mp3'), 'outside');

        const sequences = [
            song('root', path.join(show, 'Root.fseq'), path.join(show, 'Root.mp3')),
            song('sub', path.join(show, 'MyShow', 'Sub.fseq'), path.join(show, 'MyShow', 'Sub.mp3')),
            song('media', path.join(show, 'MediaSong.fseq'), path.join(media, 'Media.mp3')),
        ];
        const router = createFileApiRouter({
            getShowFolder: () => show,
            getMediaFolder: () => media,
            getSequences: () => sequences,
            putSequences: async (r) => r,
        });
        const app = new Koa();
        app.use(router.routes());
        server = app.listen(0, '127.0.0.1');
        await new Promise((r) => server.once('listening', r));
        base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
    });

    afterAll(async () => {
        await new Promise((r) => server.close(r));
        await fsp.rm(tmp, { recursive: true, force: true });
    });

    const get = async (p: string) => {
        const res = await fetch(`${base}${p}`);
        return { status: res.status, text: await res.text() };
    };

    it('serves files in the show root', async () => {
        expect(await get('/api/file/music/Root.mp3')).toEqual({ status: 200, text: 'root-mp3' });
        expect(await get('/api/file/sequences/Root.fseq')).toEqual({ status: 200, text: 'root-fseq' });
    });

    it('serves a registered song’s files from a subfolder, not a stale copy', async () => {
        expect(await get('/api/file/music/Sub.mp3')).toEqual({ status: 200, text: 'sub-mp3' });
        expect(await get('/api/file/sequences/Sub.fseq')).toEqual({ status: 200, text: 'sub-fseq' });
        expect(await get('/api/sequence/Sub')).toEqual({ status: 200, text: 'sub-fseq' });
    });

    it('serves a registered song’s audio from the media folder', async () => {
        expect(await get('/api/file/music/Media.mp3')).toEqual({ status: 200, text: 'media-mp3' });
    });

    it('finds unregistered files in show subfolders', async () => {
        expect(await get('/api/file/music/Loose.mp3')).toEqual({ status: 200, text: 'loose-mp3' });
    });

    it('answers media meta for files outside the root', async () => {
        expect((await get('/api/media/Sub.mp3/meta')).status).toBe(200);
        expect((await get('/api/media/Media.mp3/duration')).status).toBe(200);
    });

    it('lists the files songs play wherever they are', async () => {
        const music = JSON.parse((await get('/api/files/music?nameOnly=1')).text) as string[];
        expect(music).toEqual(expect.arrayContaining(['Root.mp3', 'Sub.mp3', 'Media.mp3']));
        const seqs = JSON.parse((await get('/api/sequence')).text) as string[];
        expect(seqs).toEqual(expect.arrayContaining(['Root', 'Sub', 'MediaSong']));
        const all = JSON.parse((await get('/api/media')).text) as string[];
        expect(all).toEqual(expect.arrayContaining(['Sub.mp3', 'Media.mp3']));
    });

    it('still refuses names outside the show and media folders', async () => {
        expect((await get('/api/file/music/Outside.mp3')).status).toBe(404);
        expect((await get('/api/file/music/..%2FOutside.mp3')).status).toBe(400);
        expect((await get('/api/file/music/MyShow%2FSub.mp3')).status).toBe(400);
    });
});
