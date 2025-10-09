import { SendJobState } from "./SenderJob";

export async function sendPartial(state?: SendJobState): Promise<number> {
    if (!state?.job) return -1;
    // TODO EZP the whole scheduling thing
    for (let i = 0; i < state.states.length; ++i) {
        const sender = state.job.senders[i];
        if (!sender || !sender.sender) continue;
        await sender.sender.sendPortion(state.job, sender, state.states[i]);
    }
    return -1; // Done!
}

export async function sendFull(state: SendJobState | undefined, sleepfn: (sleepUntil: number) => Promise<void>): Promise<void> {
    if (!state?.job) return;
    while (true) {
        const st = await sendPartial(state);
        if (st < 0) return;
        await sleepfn(st);
    }
}
