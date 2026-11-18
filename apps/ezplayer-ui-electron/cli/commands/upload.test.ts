import { describe, expect, it } from 'vitest';
import { parseArgs } from './upload.js';

describe('upload arguments', () => {
    it('joins the name back up and leaves the full-control choice to the player', () => {
        expect(parseArgs(['Mega', 'Tree', '--scope', 'strings'])).toEqual({
            name: 'Mega Tree',
            host: undefined,
            scope: 'strings',
            fullControl: undefined,
        });
    });

    it('takes either full-control flag as the answer', () => {
        expect(parseArgs(['Roof', '--full-control'])).toMatchObject({ fullControl: true, scope: 'full' });
        expect(parseArgs(['Roof', '--no-full-control'])).toMatchObject({ fullControl: false });
    });

    it('refuses a bad scope, an unknown option and no name', () => {
        expect(parseArgs(['Roof', '--scope', 'outputs'])).toHaveProperty('error');
        expect(parseArgs(['Roof', '--bogus'])).toHaveProperty('error');
        expect(parseArgs(['--full-control'])).toHaveProperty('error');
    });
});
