/** EZPlayer's FPP-compat API against a real FPP, side by side.
 *
 *  `runCompatScenario` drives one session against both targets; the two
 *  transcripts must match on HTTP status, response structure (every field FPP
 *  sends, same JSON type — extra fields are fine) and the values that should
 *  agree. Anything else belongs in DIVERGENCES below, with a reason.
 *
 *  Opt-in: set FPP_URL to a disposable FPP in *player* mode, e.g. the Docker
 *  one in docker/fpp (`FPP_URL=http://localhost:8090`). Skipped otherwise. */

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { startMockController, type MockController } from '@ezplayer/epp-mock-controller';
import { startEzPlayer, type EzPlayerProc } from '../harness/ezplayer-proc.js';
import { FppClient } from '../harness/fpp-client.js';
import { compareTranscripts, runCompatScenario, type ScenarioFiles, type Step } from '../harness/compat-scenario.js';
import { createFixtureShow, type FixtureShow } from '../fixtures/showfolder.js';
import { buildFseq } from '../fixtures/fseq.js';
import { sineWav } from '../fixtures/wav.js';

const FPP_URL = process.env.FPP_URL;

const FILES: ScenarioFiles = {
    song: 'CompatSong.fseq',
    fseq: buildFseq({ channels: 150, frames: 1200, value: 42 }), // 60 s
    audio: 'CompatSong.wav',
    wav: sineWav({ seconds: 2 }),
    scratch: 'CompatScratch.wav',
    show: 'CompatShow',
};

/** Every accepted difference between the two transcripts, with why. Anything
 *  not matched here is a compatibility bug in one of the two. */
interface Divergence {
    /** Matches a difference line from compareTranscripts. */
    match: RegExp;
    why: string;
    /** Only accepted against FPP releases older than this major version. */
    beforeMajor?: number;
    /** Only accepted from this major version on (the release that introduced
     *  the field or behaviour). */
    fromMajor?: number;
}

const DIVERGENCES: Divergence[] = [
    {
        match: /\.streamSlots: missing$/,
        why: "FPP's media stream slots are its own media pipeline; EZPlayer has no counterpart",
        fromMajor: 10,
    },
    {
        match: /^media meta\./,
        why: 'EZPlayer does not run ffprobe: it answers format.size and format.duration, not streams/programs/chapters or codec detail',
    },
    {
        match: /^volume write: status ours=500 theirs=200$/,
        why: 'EZPlayer volume is settings/schedule-driven; a one-shot override would be reverted at the next schedule change, so it is declined with a reason',
    },
    {
        match: /^volume write\./,
        why: "the declined write answers with an error body, not FPP's echo of the new volume",
    },
    // --- older releases: EZPlayer presents itself as a current FPP (v8-10),
    //     so where an older release differs we follow the modern one.
    {
        match: /^paused player status: currentState ours="paused" theirs="playing"$/,
        why: 'before 10.x currentState stayed "playing" while paused (only the numeric status said 5); EZPlayer follows 10.x',
        beforeMajor: 10,
    },
    {
        match: /^commands: command Start Playlist(?: At Item)? ours=/,
        why: 'EZPlayer advertises the current argument list, which gained a trailing optional scheduleProtected after this release',
        beforeMajor: 9,
    },
    {
        match: /: absent in this FPP release$/,
        why: 'the endpoint postdates this FPP (e.g. /api/player/current and raw file upload arrived in 6.x)',
        beforeMajor: 6,
    },
    {
        match: /sizeBytes: FPP sends "number"/,
        why: '5.x reported file sizes as numbers; 6.x made them strings',
        beforeMajor: 6,
    },
    {
        match: /^(media meta|list media|upload media|upload scratch media|delete scratch media|list media after delete|list sequence files): /,
        why: 'no raw media upload before 6.x, so the media never arrives and nothing downstream of it can match',
        beforeMajor: 6,
    },
    {
        match: /^commands: command /,
        why: 'command arguments gained names and further optional arguments after 5.x; EZPlayer follows the current set',
        beforeMajor: 6,
    },
];

describe.skipIf(!FPP_URL)('FPP-compat API vs a real FPP', () => {
    let mock: MockController;
    let show: FixtureShow;
    let app: EzPlayerProc;
    let fppMajor = 0;
    let ours: Step[] = [];
    let theirs: Step[] = [];

    beforeAll(async () => {
        mock = await startMockController({ channels: 150, ddpPort: 4048, multisyncPort: 0 });
        show = await createFixtureShow({ channels: 150 });
        app = await startEzPlayer(show.dir);
        const ezp = new FppClient(app.base);
        const fpp = new FppClient(FPP_URL!);

        const version = (await (await fetch(`${FPP_URL}/api/fppd/version`)).json()) as { majorVersion?: string };
        fppMajor = Number(version.majorVersion);

        // A player left in remote mode (e.g. by multisync-live.test.ts on a
        // release where switching back wedges fppd) plays nothing, which
        // would show up here as a pile of confusing playback failures.
        const mode = (await fpp.status()).mode_name;
        expect(mode, `${FPP_URL} must be in player mode (send "Switch To Player Mode", then restart it)`).toBe(
            'player',
        );

        // The same session, run against each target in turn.
        ours = await runCompatScenario(ezp, FILES);
        theirs = await runCompatScenario(fpp, FILES);
    }, 300_000);

    afterAll(async () => {
        await fetch(`${FPP_URL}/api/playlists/stop`).catch(() => undefined);
        await app?.stop();
        await mock?.stop();
        await show?.cleanup();
    });

    /** The divergences that apply to the FPP release under test. */
    const accepted = () =>
        DIVERGENCES.filter(
            (d) =>
                (d.beforeMajor === undefined || fppMajor < d.beforeMajor) &&
                (d.fromMajor === undefined || fppMajor >= d.fromMajor),
        );

    it('answers the same session the same way', () => {
        const unexplained = compareTranscripts(ours, theirs).filter((d) => !accepted().some((a) => a.match.test(d)));
        expect(unexplained).toEqual([]);
    });

    it('runs the session as the same sequence of calls against both', () => {
        // One scenario function, so this breaks only if a target's answers
        // send the run down another path.
        expect(ours.map((s) => `${s.method} ${s.label}`)).toEqual(theirs.map((s) => `${s.method} ${s.label}`));
        expect(ours.length).toBeGreaterThan(30);
    });

    it('keeps the divergence list honest', () => {
        // An entry that no longer matches claims a difference that is gone.
        const diffs = compareTranscripts(ours, theirs);
        const stale = accepted().filter((d) => !diffs.some((x) => d.match.test(x)));
        expect(stale.map((d) => d.match.source)).toEqual([]);
    });
});
