/**
 * `play` — play one sequence on a running EZPlayer (windowed or `headless`)
 * and report the playback statistics while it runs: a trace line per sample
 * and a summary at the end. The measurement tool behind "it drops frames":
 *
 *   EZPlayer headless --show-folder=<dir> --web-port=3123 &
 *   EZPlayer play "My Song" --host 127.0.0.1:3123 --no-output
 *
 * Pure HTTP against the app's API (/api/ezp/current-show, player-command,
 * playback-stats); nothing here touches electron.
 */

import { randomUUID } from 'node:crypto';
import type { PlayerPStatusContent, SequenceRecord } from '@ezplayer/ezplayer-core';
import {
    findSequence,
    getCurrentShow,
    getPlaybackStats,
    postPlayerCommand,
    resolveHost,
    unreachableHint,
} from '../ezp-client.js';
import { formatSummary, formatTraceLine, summarize, type StatsSample } from '../playback-stats.js';

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

interface Options {
    target?: string;
    hostFlag?: string;
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

function isOurPlay(p: PlayerPStatusContent | undefined, seq: SequenceRecord): boolean {
    return p?.status === 'Playing' && p.now_playing?.sequence_id === seq.id;
}

export async function run(args: string[]): Promise<number> {
    const parsed = parseArgs(args);
    if (typeof parsed === 'string') {
        console.error(`play: ${parsed}`);
        return 2;
    }
    const o = parsed;
    const host = resolveHost(o.hostFlag);
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

    // Default run length: the sequence itself plus a little tail to see it end.
    const seqLenS = seq.work?.length;
    const durationS = o.durationS ?? (seqLenS ? seqLenS + 2 : 60);
    log(
        `Playing "${seq.work?.title ?? seq.id}" on ${host} for ${durationS.toFixed(0)}s` +
            (o.noOutput ? ' (controller output suppressed)' : '') +
            `; sampling every ${o.intervalS}s`,
    );

    const requestId = `cli-play-${randomUUID()}`;
    let outputSuppressed = false;
    const samples: StatsSample[] = [];
    const t0 = Date.now();
    let exit = 0;
    try {
        if (o.noOutput) {
            await postPlayerCommand(host, { command: 'suppressoutput' });
            outputSuppressed = true;
        }
        await postPlayerCommand(host, { command: 'resetstats' });
        await postPlayerCommand(host, {
            command: 'playsong',
            songId: seq.id,
            immediate: true,
            priority: 1,
            requestId,
        });

        // Take a baseline right away so cumulative deltas start at the play.
        let prev: StatsSample | undefined;
        let sawPlaying = false;
        let idleAfterPlay = 0;
        const deadline = t0 + durationS * 1000;
        while (Date.now() < deadline) {
            await sleep(o.intervalS * 1000);
            const r = await getPlaybackStats(host);
            if (!r) {
                log('(no playback statistics yet)');
                continue;
            }
            const sample: StatsSample = { t: Date.now() - t0, stats: r.stats };
            samples.push(sample);
            if (!o.quiet) process.stderr.write(formatTraceLine(sample, prev) + '\n');
            prev = sample;

            // Stop early once the sequence has finished (status back to idle after
            // we saw it play), rather than sitting out a long --duration.
            const ours = isOurPlay(r.pStatus, seq);
            if (ours) {
                sawPlaying = true;
                idleAfterPlay = 0;
            } else if (sawPlaying && ++idleAfterPlay >= 2) {
                log('Sequence finished.');
                break;
            }
        }
        if (!sawPlaying) {
            console.error(`play: the player never reported "${seq.work?.title ?? seq.id}" as playing (check its log)`);
            exit = 1;
        }
    } catch (e) {
        console.error(`play: ${(e as Error).message}`);
        exit = 1;
    } finally {
        try {
            if (!o.keepPlaying) {
                const r = await getPlaybackStats(host).catch(() => undefined);
                if (isOurPlay(r?.pStatus, seq)) await postPlayerCommand(host, { command: 'endsong', songId: seq.id });
            }
            if (outputSuppressed) await postPlayerCommand(host, { command: 'activateoutput' });
        } catch (e) {
            console.error(`play: cleanup failed: ${(e as Error).message}`);
        }
    }

    const summary = summarize(samples);
    if (o.json) {
        process.stdout.write(
            JSON.stringify(
                {
                    host,
                    sequence: { id: seq.id, title: seq.work?.title, fseq: seq.files?.fseq },
                    outputSuppressed: o.noOutput,
                    summary,
                    samples,
                },
                null,
                2,
            ) + '\n',
        );
    } else if (summary) {
        console.log('');
        for (const line of formatSummary(summary)) console.log(line);
    } else {
        console.log('No statistics were collected.');
    }
    return exit;
}
