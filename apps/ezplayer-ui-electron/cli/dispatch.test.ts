import { describe, expect, it, vi } from 'vitest';
import { isToolVerbName, TOOL_VERBS, toolVerbSummary, runCli } from './dispatch.js';

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
