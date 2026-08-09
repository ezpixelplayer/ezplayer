import { describe, expect, it } from 'vitest';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const launcher = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'bin', 'ezplayer.cmd');

/**
 * The Windows console launcher fails obscurely when malformed: cmd.exe
 * mis-parses an LF-only batch file and emits things like "'m' is not
 * recognized" while the script still half-runs.
 */
describe('Windows console launcher', () => {
    const raw = fs.readFileSync(launcher);
    const text = raw.toString('latin1');

    it('uses CRLF line endings throughout', () => {
        const lf = (text.match(/\n/g) ?? []).length;
        const crlf = (text.match(/\r\n/g) ?? []).length;
        expect(lf, 'file has no lines').toBeGreaterThan(0);
        expect(crlf, 'some lines are LF-only; cmd.exe will mis-parse them').toBe(lf);
    });

    it('is ASCII only', () => {
        const offending = [...raw].findIndex((b) => b > 0x7e || (b < 0x20 && b !== 0x09 && b !== 0x0a && b !== 0x0d));
        expect(offending, `non-ASCII byte at offset ${offending}`).toBe(-1);
    });

    it('runs the CLI entry through the app binary in Node mode', () => {
        expect(text).toContain('ELECTRON_RUN_AS_NODE=1');
        expect(text).toContain('%~dp0EZPlayer.exe');
        expect(text).toContain('dist\\cli.js');
        expect(text).toContain('%*');
    });

    it('propagates the exit code past endlocal', () => {
        // `endlocal` resets ERRORLEVEL, so it must be captured first.
        expect(text).toMatch(/set EZP_EXIT=%ERRORLEVEL%/);
        expect(text).toMatch(/endlocal & exit \/b %EZP_EXIT%/);
    });
});
