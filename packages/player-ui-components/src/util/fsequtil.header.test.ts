import { describe, expect, it } from 'vitest';
import { audioNameFromFseqHeaders, getFSEQAudioNameBrowser } from './fsequtil';

/** A minimal v2 FSEQ: the 32-byte fixed header, then one variable header. */
function fseqWithHeader(code: string, value: string): File {
    const data = new TextEncoder().encode(value);
    const variable = new Uint8Array(4 + data.length);
    new DataView(variable.buffer).setUint16(0, variable.length, true);
    variable.set(new TextEncoder().encode(code), 2);
    variable.set(data, 4);
    const fixed = new Uint8Array(32);
    const view = new DataView(fixed.buffer);
    fixed.set(new TextEncoder().encode('PSEQ'), 0);
    view.setUint16(4, 32 + variable.length, true); // channel data offset
    view.setUint8(6, 0); // minor version
    view.setUint8(7, 2); // major version
    view.setUint16(8, 32, true); // fixed header length
    view.setUint32(10, 100, true); // channels
    view.setUint32(14, 10, true); // frames
    view.setUint8(18, 50); // ms per frame
    const bytes = new Uint8Array(fixed.length + variable.length + 100);
    bytes.set(fixed, 0);
    bytes.set(variable, fixed.length);
    return new File([bytes], 'Show.fseq');
}

describe('audioNameFromFseqHeaders', () => {
    it('takes the file name from a Windows path', () => {
        expect(audioNameFromFseqHeaders({ mf: 'C:\\Users\\me\\Music\\song.mp3' })).toBe('song.mp3');
    });
    it('ignores non-audio values and missing headers', () => {
        expect(audioNameFromFseqHeaders({ mf: 'notes.txt' })).toBeUndefined();
        expect(audioNameFromFseqHeaders(undefined)).toBeUndefined();
    });
});

describe('getFSEQAudioNameBrowser', () => {
    it('reads the media header from a file', async () => {
        await expect(getFSEQAudioNameBrowser(fseqWithHeader('mf', '/home/me/Song.wav'))).resolves.toBe('Song.wav');
    });
    it('reports no audio for an animation', async () => {
        await expect(getFSEQAudioNameBrowser(fseqWithHeader('sp', 'xLights'))).resolves.toBeUndefined();
    });
    it('rejects a file that is not an FSEQ', async () => {
        await expect(getFSEQAudioNameBrowser(new File([new Uint8Array(64)], 'x.fseq'))).rejects.toThrow(/PSEQ/);
    });
});
