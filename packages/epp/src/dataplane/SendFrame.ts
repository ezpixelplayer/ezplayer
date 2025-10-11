import { SendBatch } from "./protocols/UDP";
import { SendJobState } from "./SenderJob";

export function startBatch(state?: SendJobState) {
    if (!state?.job) return -1;
    for (let i = 0; i < state.states.length; ++i) {
        const sender = state.job.senders[i];
        if (!sender || !sender.sender) continue;
        sender.sender.startBatch();
    }
}

export function endBatch(state?: SendJobState): SendBatch [] {
    if (!state?.job) return [];
    const b: SendBatch[] = [];
    for (let i = 0; i < state.states.length; ++i) {
        const sender = state.job.senders[i];
        if (!sender || !sender.sender) continue;
        const batch = sender.sender.endBatch();
        if (batch) b.push(batch);
    }
    return b;
}

export function sendPartial(state?: SendJobState): number {
    if (!state?.job) return -1;
    // TODO EZP the whole scheduling thing
    for (let i = 0; i < state.states.length; ++i) {
        const sender = state.job.senders[i];
        if (!sender || !sender.sender) continue;
        sender.sender.sendPortion(state.job, sender, state.states[i]);
    }
    return -1; // Done!
}

export async function sendFull(state: SendJobState | undefined, sleepfn: (sleepUntil: number) => Promise<void>): Promise<void> {
    if (!state?.job) return;
    while (true) {
        const st = sendPartial(state);
        if (st < 0) return;
        await sleepfn(st);
    }
}
