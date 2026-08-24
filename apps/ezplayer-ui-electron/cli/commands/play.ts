/**
 * `play` — play one sequence on a running EZPlayer and report the playback
 * statistics while it runs. Thin CLI over @ezplayer/ezplayer-client.
 */

import { randomUUID } from 'node:crypto';
import {
    findSequence,
    formatSummary,
    formatTraceLine,
    getCurrentShow,
    measurePlayback,
} from '@ezplayer/ezplayer-client';
import { resolveLocalPlayerHost, unreachableHint } from '../ezp-client.js';

interface Options {
    target?: string;
    hostFlag?: string;
    showFolderFlag?: string;
    durationS?: number;
    intervalS: number;
    noOutput: boolean;
    json: boolean;
    quiet: boolean;
    keepPlaying: boolean;
}

function parseArgs(args: string[]): Options | string {
    const o: Options = { intervalS: 1, noOutput: false, json: false, quiet: false, keepPlaying: false };
    for (let i = 0; i < args.length; i++) {
        const a = args[i];
        const num = (name: string) => {
            const v = Number(args[++i]);
            if (!Number.isFinite(v) || v <= 0) throw new Error(`${name} needs a positive number`);
            return v;
        };
        try {
            if (a === '--host') o.hostFlag = args[++i];
            else if (a === '--show-folder' || a === '-s') o.showFolderFlag = args[++i];
            else if (a === '--duration' || a === '-d') o.durationS = num(a);
            else if (a === '--interval' || a === '-i') o.intervalS = num(a);
            else if (a === '--no-output') o.noOutput = true;
            else if (a === '--json') o.json = true;
            else if (a === '--quiet' || a === '-q') o.quiet = true;
            else if (a === '--keep-playing') o.keepPlaying = true;
            else if (!a.startsWith('-') && !o.target) o.target = a;
            else return `unrecognized argument '${a}'`;
        } catch (e) {
            return (e as Error).message;
        }
    }
    if (!o.target) return 'missing <sequence> (id, title, or fseq file name)';
    return o;
}

export async function run(args: string[]): Promise<number> {
    const parsed = parseArgs(args);
    if (typeof parsed === 'string') {
        console.error(`play: ${parsed}`);
        return 2;
    }
    const o = parsed;
    const { host } = await resolveLocalPlayerHost(o.hostFlag, o.showFolderFlag);
    const log = (s: string) => {
        if (!o.quiet) process.stderr.write(s + '\n');
    };

    let show: Awaited<ReturnType<typeof getCurrentShow>>;
    try {
        show = await getCurrentShow(host);
    } catch {
        console.error(`play: ${unreachableHint(host)}`);
        return 1;
    }
    const seq = findSequence(show.sequences ?? [], o.target!);
    if (!seq) {
        console.error(`play: no sequence matches '${o.target}'. Loaded sequences:`);
        for (const s of (show.sequences ?? []).filter((s) => !s.deleted)) {
            console.error(`  ${s.work?.title ?? '(untitled)'}  [${s.id}]  ${s.files?.fseq ?? ''}`);
        }
        return 1;
    }

    const seqLenS = seq.work?.length;
    const durationS = o.durationS ?? (seqLenS ? seqLenS + 2 : 60);
    log(
        `Playing "${seq.work?.title ?? seq.id}" on ${host} for ${durationS.toFixed(0)}s` +
            (o.noOutput ? ' (controller output suppressed)' : '') +
            `; sampling every ${o.intervalS}s`,
    );

    let exit = 0;
    let result: Awaited<ReturnType<typeof measurePlayback>>;
    try {
        result = await measurePlayback({
            host,
            sequence: seq,
            durationS,
            intervalS: o.intervalS,
            suppressOutput: o.noOutput,
            keepPlaying: o.keepPlaying,
            requestId: `cli-play-${randomUUID()}`,
            onSample: (sample, prev) => {
                if (!o.quiet) process.stderr.write(formatTraceLine(sample, prev) + '\n');
            },
            onInfo: log,
        });
    } catch (e) {
        console.error(`play: ${(e as Error).message}`);
        return 1;
    }
    if (!result.sawPlaying) {
        console.error(`play: the player never reported "${seq.work?.title ?? seq.id}" as playing (check its log)`);
        exit = 1;
    }

    if (o.json) {
        process.stdout.write(
            JSON.stringify(
                {
                    host,
                    sequence: { id: seq.id, title: seq.work?.title, fseq: seq.files?.fseq },
                    outputSuppressed: o.noOutput,
                    summary: result.summary,
                    samples: result.samples,
                },
                null,
                2,
            ) + '\n',
        );
    } else if (result.summary) {
        console.log('');
        for (const line of formatSummary(result.summary)) console.log(line);
    } else {
        console.log('No statistics were collected.');
    }
    return exit;
}
