import { describe, expect, it, vi } from 'vitest';
import {
    APP_VERBS,
    appVerbSummary,
    CONTROLLER_SUBCOMMANDS,
    isAppVerbName,
    isToolVerbName,
    parseResetArgs,
    TOOL_VERBS,
    toolVerbSummary,
    runCli,
} from './dispatch.js';

/** Run the CLI with console.log/error captured; returns the exit code and all output. */
async function runCaptured(args: string[]): Promise<{ code: number; out: string }> {
    const lines: string[] = [];
    const log = vi.spyOn(console, 'log').mockImplementation((...a: unknown[]) => void lines.push(a.join(' ')));
    const err = vi.spyOn(console, 'error').mockImplementation((...a: unknown[]) => void lines.push(a.join(' ')));
    try {
        return { code: await runCli(args), out: lines.join('\n') };
    } finally {
        log.mockRestore();
        err.mockRestore();
    }
}

describe('app-only verbs (headless, reset)', () => {
    it('are known by name, distinct from the tool verbs, and have summaries', () => {
        for (const verb of APP_VERBS) {
            expect(isAppVerbName(verb)).toBe(true);
            expect(isToolVerbName(verb)).toBe(false);
            expect(appVerbSummary(verb), `no summary for "${verb}"`).toBeTruthy();
        }
        expect(isAppVerbName('play')).toBe(false);
    });

    it('appear in the top-level help', async () => {
        const { out } = await runCaptured(['help']);
        for (const verb of APP_VERBS) expect(out, `"${verb}" missing from help output`).toContain(verb);
    });

    it('are refused by the pure-Node entry with a pointer to the app binary', async () => {
        for (const verb of APP_VERBS) {
            const { code, out } = await runCaptured([verb]);
            expect(code, `"${verb}" should be refused`).toBe(2);
            expect(out).toContain('desktop app');
        }
    });

    it('still answer --help in the pure-Node entry', async () => {
        const { code, out } = await runCaptured(['reset', '--help']);
        expect(code).toBe(0);
        expect(out).toContain('EZPlayer reset');
        expect(out).toContain('--no-cloud');
    });

    it('parses the reset options', () => {
        expect(parseResetArgs([])).toEqual({ showCloud: true });
        expect(parseResetArgs(['--cloud'])).toEqual({ showCloud: true });
        expect(parseResetArgs(['--no-cloud'])).toEqual({ showCloud: false });
        expect(parseResetArgs(['--nocloud'])).toEqual({ showCloud: false });
        expect(parseResetArgs(['--user-data-dir=C:\\tmp\\p', '--no-cloud'])).toEqual({ showCloud: false });
        expect(parseResetArgs(['--help'])).toBe('help');
        expect(parseResetArgs(['-h'])).toBe('help');
        expect(parseResetArgs(['--bogus'])).toMatchObject({ error: expect.stringContaining('--bogus') });
        // A stray positional is an error too, not silently ignored.
        expect(parseResetArgs(['everything'])).toMatchObject({ error: expect.stringContaining('everything') });
    });
});

describe('help <verb>', () => {
    it('prints the named command\'s detail rather than the top-level list', async () => {
        const { code, out } = await runCaptured(['help', 'discover']);
        expect(code).toBe(0);
        expect(out).toContain('EZPlayer discover');
        expect(out).not.toContain('Commands:');
    });

    it('works for app-only verbs and controller subcommands', async () => {
        expect((await runCaptured(['help', 'reset'])).out).toContain('EZPlayer reset');
        expect((await runCaptured(['help', 'headless'])).out).toContain('EZPlayer headless');
        expect((await runCaptured(['help', 'controller', 'status'])).out).toContain('EZPlayer controller status');
        expect((await runCaptured(['help', 'controller'])).out).toContain('Subcommands:');
        expect((await runCaptured(['--help', 'stats'])).out).toContain('EZPlayer stats');
    });

    it('rejects an unknown verb name', async () => {
        const { code, out } = await runCaptured(['help', 'bogusverb']);
        expect(code).toBe(2);
        expect(out).toContain('bogusverb');
    });
});

/**
 * The type system covers most of the verb registry; these cover the runtime
 * surfaces it cannot — the summaries, the name check, and the help output.
 */
describe('CLI verb registry', () => {
    it('gives every verb a usage summary', () => {
        for (const verb of TOOL_VERBS) {
            expect(toolVerbSummary(verb), `no summary for "${verb}"`).toBeTruthy();
        }
    });

    it('recognizes every verb it lists, and nothing else', () => {
        for (const verb of TOOL_VERBS) expect(isToolVerbName(verb)).toBe(true);
        expect(isToolVerbName('bogusverb')).toBe(false);
        expect(isToolVerbName('gui')).toBe(false);
    });

    it('lists every verb in the top-level help', async () => {
        const lines: string[] = [];
        const spy = vi.spyOn(console, 'log').mockImplementation((...a: unknown[]) => void lines.push(a.join(' ')));
        try {
            expect(await runCli(['help'])).toBe(0);
        } finally {
            spy.mockRestore();
        }
        const printed = lines.join('\n');
        for (const verb of TOOL_VERBS) {
            expect(printed, `"${verb}" missing from help output`).toContain(verb);
        }
    });

    it('lists every controller subcommand in the top-level help', async () => {
        const lines: string[] = [];
        const spy = vi.spyOn(console, 'log').mockImplementation((...a: unknown[]) => void lines.push(a.join(' ')));
        try {
            await runCli(['help']);
        } finally {
            spy.mockRestore();
        }
        const printed = lines.join('\n');
        for (const sub of CONTROLLER_SUBCOMMANDS) {
            expect(printed, `"${sub}" missing from help output`).toContain(sub);
        }
    });

    it('treats the controller-only names as unknown at the top level', async () => {
        // They live under `controller` now; a bare one must not silently work.
        for (const stale of ['controllers', 'status', 'action', 'upload']) {
            const out: string[] = [];
            const log = vi.spyOn(console, 'log').mockImplementation((...a: unknown[]) => void out.push(a.join(' ')));
            const err = vi.spyOn(console, 'error').mockImplementation((...a: unknown[]) => void out.push(a.join(' ')));
            try {
                expect(await runCli([stale]), `"${stale}" should be rejected`).toBe(2);
            } finally {
                log.mockRestore();
                err.mockRestore();
            }
            expect(out.join('\n')).toContain('controller');
        }
    });

    it('rejects an unknown controller subcommand without running anything', async () => {
        const out: string[] = [];
        const log = vi.spyOn(console, 'log').mockImplementation((...a: unknown[]) => void out.push(a.join(' ')));
        const err = vi.spyOn(console, 'error').mockImplementation((...a: unknown[]) => void out.push(a.join(' ')));
        try {
            expect(await runCli(['controller', 'bogus'])).toBe(2);
            expect(await runCli(['controller'])).toBe(2);
        } finally {
            log.mockRestore();
            err.mockRestore();
        }
        const printed = out.join('\n');
        expect(printed).toContain('bogus');
        expect(printed).toContain('list');
    });

    it('prints subcommand detail for --help without running it', async () => {
        const lines: string[] = [];
        const spy = vi.spyOn(console, 'log').mockImplementation((...a: unknown[]) => void lines.push(a.join(' ')));
        try {
            expect(await runCli(['controller', 'status', '--help'])).toBe(0);
        } finally {
            spy.mockRestore();
        }
        expect(lines.join('\n')).toContain('EZPlayer controller status');
    });

    it('rejects an unknown verb with a usage dump rather than running anything', async () => {
        const out: string[] = [];
        const log = vi.spyOn(console, 'log').mockImplementation((...a: unknown[]) => void out.push(a.join(' ')));
        const err = vi.spyOn(console, 'error').mockImplementation((...a: unknown[]) => void out.push(a.join(' ')));
        try {
            expect(await runCli(['bogusverb'])).toBe(2);
        } finally {
            log.mockRestore();
            err.mockRestore();
        }
        const printed = out.join('\n');
        expect(printed).toContain('bogusverb');
        expect(printed).toContain('shell');
        expect(printed).toContain('files');
    });
});
