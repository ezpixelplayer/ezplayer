// This code is copyrighted.  The copyright holder is determined as documented in the Github repository history.
// This code is licensed under the Affero General Public License, version 3.0 or later.  Other licenses may be available from the copyright holders.

/**
 * DDP frame-delivery tester.
 *
 * Sends a synthetic pattern at a fixed rate so delivery can be judged
 * optically: the background cycles through hues while a single white column
 * marches along the strand, one position per frame.  Filmed with a high-speed
 * camera, a dropped or late frame shows up as the column stalling, jumping two
 * positions, or tearing — which counters cannot reveal, because a controller
 * can accept every packet and still render unevenly.
 *
 * The sender also reports its own timing (ahead/behind the target frame time,
 * and time spent inside the send), so host-side jitter can be told apart from
 * controller-side jitter before blaming the device.
 *
 * Usage:
 *   tsx src/tools/ddp-frame-test.ts --address <ip> [--fps 100] [--width 300]
 *                                   [--height 16] [--start-channel 0]
 *                                   [--seconds 30] [--quiet]
 *
 * Ported from the pre-monorepo EPP tree (test/SendSomeStuffDDP.ts), which was
 * run at 100 FPS against a Baldrick to characterise delivery.
 */

import { DDPSender } from '../dataplane/protocols/DDP';
import { SenderJob, SendJob, SendJobState } from '../dataplane/SenderJob';
import { sendFull } from '../dataplane/SendFrame';
import { getColorCycle } from '../effects/ColorUtil';
import { EffectBufferRGB } from '../effects/EffectBuffer';
import { busySleep } from '../util/Utils';

interface Args {
    address: string;
    fps: number;
    width: number;
    height: number;
    startChannel: number;
    seconds: number;
    quiet: boolean;
}

function parseArgs(argv: string[]): Args {
    const args: Args = {
        address: '',
        fps: 100,
        width: 300,
        height: 16,
        startChannel: 0,
        seconds: 0,
        quiet: false,
    };
    for (let i = 0; i < argv.length; i++) {
        const a = argv[i];
        const next = (): string => argv[++i] ?? '';
        if (a === '--address') args.address = next();
        else if (a === '--fps') args.fps = Number(next());
        else if (a === '--width') args.width = Number(next());
        else if (a === '--height') args.height = Number(next());
        else if (a === '--start-channel') args.startChannel = Number(next());
        else if (a === '--seconds') args.seconds = Number(next());
        else if (a === '--quiet') args.quiet = true;
    }
    return args;
}

async function main(): Promise<void> {
    const args = parseArgs(process.argv.slice(2));
    if (!args.address || !Number.isFinite(args.fps) || args.fps <= 0) {
        console.error('Usage: ddp-frame-test --address <ip> [--fps 100] [--width 300] [--height 16]');
        console.error('                      [--start-channel 0] [--seconds 30] [--quiet]');
        process.exit(1);
    }

    const frameTime = 1000 / args.fps;
    const channels = args.width * args.height * 3;
    /** Below this, sleeping costs more than it saves; busy-wait instead. */
    const dontSleep = 1;

    const mtx = new EffectBufferRGB(args.width, args.height);
    const job = new SendJob();
    job.dataBuffers.push(mtx.buf);

    const sender = new DDPSender();
    sender.address = args.address;
    sender.pushAtEnd = false;
    // DDP addresses the device's own channel space, so the offset is the
    // device's, not the show's.
    sender.startChNum = 0;
    await sender.connect();

    const jobSender = new SenderJob();
    jobSender.parts.push({ bufIdx: 0, bufStart: args.startChannel, bufLen: channels });
    jobSender.sender = sender;
    job.senders.push(jobSender);

    const state = new SendJobState();
    console.log(
        `DDP → ${args.address}: ${args.width}x${args.height} (${channels} ch) ` +
            `at ${args.fps} FPS (${frameTime.toFixed(2)}ms/frame)` +
            (args.seconds ? `, ${args.seconds}s` : ', until Ctrl-C'),
    );

    let frame = 0;
    let worstLag = 0;
    let worstAdvance = 0;
    let maxSendTime = 0;
    let lateFrames = 0;
    const baseTime = performance.now();
    const endTime = args.seconds ? baseTime + args.seconds * 1000 : Infinity;

    const report = (): void => {
        const elapsed = (performance.now() - baseTime) / 1000;
        console.log(
            `\n${frame} frames in ${elapsed.toFixed(1)}s (${(frame / elapsed).toFixed(1)} FPS actual)\n` +
                `  worst behind : ${worstLag.toFixed(2)}ms\n` +
                `  worst ahead  : ${worstAdvance.toFixed(2)}ms\n` +
                `  max send time: ${maxSendTime.toFixed(2)}ms\n` +
                `  late frames  : ${lateFrames} (${((lateFrames / Math.max(1, frame)) * 100).toFixed(2)}%)`,
        );
    };
    process.on('SIGINT', () => {
        report();
        process.exit(0);
    });

    while (performance.now() < endTime) {
        job.frameNumber = frame;
        const nowTime = performance.now();
        state.initialize(nowTime, job);

        const targetTime = baseTime + frame * frameTime;
        if (nowTime < targetTime - dontSleep) {
            worstAdvance = Math.max(worstAdvance, targetTime - nowTime);
        } else if (nowTime > targetTime + 1) {
            worstLag = Math.max(worstLag, nowTime - targetTime);
            lateFrames++;
            if (!args.quiet) console.log(`frame ${frame}: behind by ${(nowTime - targetTime).toFixed(2)}ms`);
        }

        const [r, g, b] = getColorCycle(frame, 1, 0.02);
        mtx.fill(r, g, b);
        mtx.fillColumn(frame % args.width, 255, 255, 255);

        await sendFull(state, busySleep);

        const postSendTime = performance.now();
        const sendTime = postSendTime - nowTime;
        if (sendTime > maxSendTime) {
            maxSendTime = sendTime;
            if (!args.quiet && sendTime > 2) console.log(`frame ${frame}: send took ${sendTime.toFixed(2)}ms`);
        }

        frame++;
        const nextTargetTime = baseTime + frame * frameTime;
        if (nextTargetTime - postSendTime > dontSleep) await busySleep(nextTargetTime);
    }
    report();
}

void main().catch((e) => {
    console.error(e);
    process.exit(1);
});
