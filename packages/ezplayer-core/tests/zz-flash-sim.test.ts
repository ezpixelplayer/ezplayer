// TEMPORARY investigation harness (not for commit): drive PlayerRunState the way
// playbackmaster's loop does and look for a sequence that is shown for only a
// frame or two and then replaced/stopped well before its end.
import { describe, it, expect } from 'vitest';

import { PlaylistRecord, ScheduledPlaylist, SequenceRecord, ScheduleEndPolicy } from '../src/types/DataTypes';
import { PlayerRunState } from '../src/util/schedulecomp';

function rng(seed: number) {
    let s = seed >>> 0 || 1;
    return () => {
        s ^= s << 13;
        s >>>= 0;
        s ^= s >>> 17;
        s ^= s << 5;
        s >>>= 0;
        return s / 0x100000000;
    };
}

const FRAME = 50;
const IDLE = 200;
const DAY = 24 * 3600_000;

interface Shown {
    t: number;
    key: string; // seqId + item identity
    seqId?: string;
    offsetMS?: number;
    durationMS?: number;
}

function hhmm(min: number) {
    const h = Math.floor(min / 60);
    const m = min % 60;
    return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
}

function runScenario(seed: number, verbose = false) {
    const r = rng(seed);
    const pick = <T,>(a: T[]) => a[Math.floor(r() * a.length)];

    const seqs: SequenceRecord[] = [];
    const nSeq = 3 + Math.floor(r() * 6);
    for (let i = 0; i < nSeq; ++i) {
        const len = pick([2, 5, 10, 30, 60, 120, 180]) + Math.floor(r() * 3);
        seqs.push({
            id: `S${i}`,
            instanceId: `S${i}`,
            work: { length: len, artist: 'x', title: `S${i}` },
            files: { fseq: `s${i}.fseq` },
        });
    }
    const pls: PlaylistRecord[] = [];
    const nPl = 1 + Math.floor(r() * 4);
    for (let i = 0; i < nPl; ++i) {
        const n = 1 + Math.floor(r() * nSeq);
        const items = [];
        for (let j = 0; j < n; ++j) items.push({ id: pick(seqs).id, sequence: j + 1 });
        pls.push({ id: `P${i}`, title: `P${i}`, tags: [], createdAt: 0, items });
    }

    const d = new Date(0);
    d.setHours(0, 0, 0, 0);
    const bt = d.getTime();

    const scheds: ScheduledPlaylist[] = [];
    const nSched = 1 + Math.floor(r() * 5);
    for (let i = 0; i < nSched; ++i) {
        const from = 18 * 60 + Math.floor(r() * 50);
        const to = from + 1 + Math.floor(r() * 20);
        scheds.push({
            id: `sch${i}`,
            scheduleType: 'main',
            title: `sch${i}`,
            playlistId: pick(pls).id,
            prePlaylistId: r() < 0.2 ? pick(pls).id : undefined,
            postPlaylistId: r() < 0.2 ? pick(pls).id : undefined,
            playlistTitle: '',
            date: bt,
            fromTime: hhmm(from),
            toTime: hhmm(to),
            duration: 0,
            loop: r() < 0.6,
            shuffle: r() < 0.3,
            hardCutIn: r() < 0.3,
            preferHardCutIn: r() < 0.3,
            keepToScheduleWhenPreempted: r() < 0.3,
            endPolicy: pick<ScheduleEndPolicy | undefined>([
                undefined,
                'seqboundearly',
                'seqboundlate',
                'seqboundnearest',
                'hardcut',
            ]),
            priority: pick<ScheduledPlaylist['priority']>([undefined, 'high', 'normal', 'low']),
        });
    }

    const plr = new PlayerRunState(bt + 17 * 3600_000 + 59 * 60_000);
    const errs: string[] = [];
    plr.setUpSequences(seqs, pls, scheds, errs);
    plr.repeatGuard.spacing = pick([0, 0, 2, 5]);
    plr.addTimeRangeToSchedule(plr.currentTime, plr.currentTime + DAY);

    // Interactive commands at random times
    const cmds: { at: number; immediate: boolean; seqId?: string; playlistId?: string }[] = [];
    const nCmd = Math.floor(r() * 6);
    for (let i = 0; i < nCmd; ++i) {
        cmds.push({
            at: bt + 18 * 3600_000 + Math.floor(r() * 70 * 60_000),
            immediate: r() < 0.5,
            seqId: r() < 0.7 ? pick(seqs).id : undefined,
            playlistId: undefined,
        });
        if (!cmds[i].seqId) cmds[i].playlistId = pick(pls).id;
    }
    cmds.sort((a, b) => a.at - b.at);

    let t = plr.currentTime;
    const end = bt + 19 * 3600_000 + 30 * 60_000;
    const shown: Shown[] = [];
    let reqN = 0;
    while (t < end) {
        while (cmds.length && cmds[0].at <= t) {
            const c = cmds.shift()!;
            plr.addInteractiveCommand({
                immediate: c.immediate,
                requestId: `r${reqN++}`,
                startTime: plr.currentTime + 500,
                seqId: c.seqId,
                playlistId: c.playlistId,
            });
        }
        // Mirror playbackmaster's runUntil loop
        for (let guard = 0; guard < 1000; ++guard) {
            const plog: { eventType: string }[] = [];
            plr.runUntil(t, 1, plog as never);
            let found = plog.length === 0;
            for (const l of plog) {
                if (l.eventType === 'Sequence Started' || l.eventType === 'Sequence Resumed') {
                    t = plr.currentTime;
                    found = true;
                    break;
                }
            }
            if (found) break;
        }
        const up = plr.getUpcomingItems(2000, 25 * 3600_000);
        const a = up.curPLActions?.actions?.[0];
        if (!a?.seqId) {
            shown.push({ t, key: '' });
            t += IDLE;
            continue;
        }
        const len = (plr.sequencesById.get(a.seqId)?.work.length ?? 0) * 1000;
        const off = a.offsetMS ?? 0;
        const ident =
            up.curPLActions?.type === 'scheduled' ? up.curPLActions.scheduleId : up.curPLActions?.requestId;
        // A start is identified by when the action began (atTime - offset)
        const startedAt = Math.round(a.atTime - off);
        shown.push({ t, key: `${ident}/${a.seqId}@${startedAt}`, seqId: a.seqId, offsetMS: off, durationMS: len });
        if (off < 0 || off >= len) {
            t += FRAME; // pad: black
        } else {
            t += FRAME;
        }
    }

    // Find runs
    const flashes: string[] = [];
    let i = 0;
    while (i < shown.length) {
        let j = i;
        while (j + 1 < shown.length && shown[j + 1].key === shown[i].key) ++j;
        const s = shown[i];
        if (s.key && j - i + 1 <= 2) {
            const last = shown[j];
            const remaining = (last.durationMS ?? 0) - (last.offsetMS ?? 0);
            if (remaining > 3 * FRAME) {
                const prev = i > 0 ? shown[i - 1].key || 'BLACK' : 'START';
                const next = j + 1 < shown.length ? shown[j + 1].key || 'BLACK' : 'END';
                flashes.push(
                    `seed ${seed}: ${j - i + 1} frame(s) of ${s.key} at ${new Date(s.t).toISOString().slice(11, 23)} ` +
                        `off=${s.offsetMS} len=${s.durationMS}; prev=${prev} next=${next}`,
                );
            }
        }
        i = j + 1;
    }
    if (verbose) for (const f of flashes) console.log(f);
    return { flashes, scheds, cmds: nCmd, spacing: plr.repeatGuard.spacing };
}

describe('flash sim', () => {
    it('looks for 1-2 frame sequence flashes', () => {
        const all: string[] = [];
        const N = Number(process.env.FLASH_N ?? 300);
        for (let seed = 1; seed <= N; ++seed) {
            const res = runScenario(seed);
            if (res.flashes.length) {
                all.push(...res.flashes.slice(0, 3));
            }
        }
        console.log(`flashes found: ${all.length}\n` + all.slice(0, 60).join('\n'));
        expect(true).toBe(true);
    }, 600_000);
});
