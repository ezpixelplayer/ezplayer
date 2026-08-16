import { SendBatch } from './protocols/UDP';
import { SendJobState } from './SenderJob';

export function startFrame(state?: SendJobState) {
    if (!state?.job) return -1;
    for (let i = 0; i < state.states.length; ++i) {
        const sender = state.job.senders[i];
        if (!sender || !sender.sender || state.states[i].skippingThisFrame) continue;
        sender.sender.startFrame();
    }
}

export function endFrame(state?: SendJobState) {
    if (!state?.job) return -1;
    for (let i = 0; i < state.states.length; ++i) {
        const sender = state.job.senders[i];
        if (!sender || !sender.sender || state.states[i].skippingThisFrame) continue;
        sender.sender.endFrame();
    }
}

export function startBatch(state?: SendJobState) {
    if (!state?.job) return -1;
    for (let i = 0; i < state.states.length; ++i) {
        const sender = state.job.senders[i];
        if (!sender || !sender.sender || state.states[i].skippingThisFrame) continue;
        sender.sender.startBatch();
    }
}

export function endBatch(state?: SendJobState): SendBatch[] {
    if (!state?.job) return [];
    const b: SendBatch[] = [];
    for (let i = 0; i < state.states.length; ++i) {
        const sender = state.job.senders[i];
        if (!sender || !sender.sender || state.states[i].skippingThisFrame) continue;
        const batch = sender.sender.endBatch();
        if (batch) b.push(batch);
    }
    return b;
}

/** Don't bother sleeping for gaps smaller than this (sleep granularity). */
const SEND_DUE_EPSILON_MS = 0.1;
/** If we fall behind schedule (event loop hiccup), catch up at most this much
 *  as an immediate burst; older debt is forgiven to avoid a compensating blast. */
const SEND_CATCHUP_LIMIT_MS = 5;

/**
 * Run the send: pop the earliest-due sender off the heap, send one burst
 * (up to its SenderJob.burstSize), and advance its nextTime by bytes/rate so
 * each controller's packets are spread across the send slot, interleaved with
 * all the others.
 *
 * Past state.sendDeadline the pacing stops and everything still owed is flushed
 * as fast as it can be enqueued: the slot is over, and holding the caller past
 * it costs the next frame more than the spreading is worth.
 *
 * Returns the time (performance.now() basis) the caller should sleep until
 * before calling again, or -1 when every sender has finished the frame.
 */
export function sendPartial(state?: SendJobState): number {
    if (!state?.job) return -1;
    const heap = state.sendHeap;
    while (true) {
        const top = heap.top;
        if (!top || top.nextTime === Infinity) return -1; // All done
        const now = performance.now();
        if (top.nextTime > now + SEND_DUE_EPSILON_MS && now < state.sendDeadline) {
            // Never sleep past the deadline: wake there and flush what's left.
            return Math.min(top.nextTime, state.sendDeadline);
        }

        const senderJob = state.job.senders[top.senderIdx];
        if (!senderJob?.sender) {
            heap.updateTop((t) => (t.nextTime = Infinity));
            continue;
        }
        const before = top.wireBytesSent;
        const done = senderJob.sender.sendPortion(state.job, senderJob, top);
        const sent = top.wireBytesSent - before;
        if (done || sent <= 0) {
            // sent <= 0 without done should not happen; treat it as done rather than spin.
            if (done) senderJob.sender.sendPush(state.job, senderJob, top);
            heap.updateTop((t) => (t.nextTime = Infinity));
        } else {
            const rate = top.sendRate > 0 ? top.sendRate : Number.MAX_SAFE_INTEGER;
            const base = Math.max(top.nextTime, now - SEND_CATCHUP_LIMIT_MS);
            heap.updateTop((t) => (t.nextTime = base + sent / rate));
        }
    }
}

export interface SendFullResult {
    /** Time spent actually packetizing/enqueueing sends. */
    activeMs: number;
    /** Time spent sleeping between paced bursts. */
    waitMs: number;
    /** How far past the slot deadline the send ran; nonzero means the frame
     *  ate into the next one's budget. */
    overrunMs: number;
}

export async function sendFull(
    state: SendJobState | undefined,
    sleepfn: (sleepUntil: number) => Promise<void>,
): Promise<SendFullResult> {
    const result: SendFullResult = { activeMs: 0, waitMs: 0, overrunMs: 0 };
    if (!state?.job) return result;
    while (true) {
        const t0 = performance.now();
        const st = sendPartial(state);
        const t1 = performance.now();
        result.activeMs += t1 - t0;
        if (st < 0) {
            result.overrunMs = Math.max(0, t1 - state.sendDeadline);
            break;
        }
        await sleepfn(st);
        result.waitMs += performance.now() - t1;
    }
    return result;
}
