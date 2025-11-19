import type { PlayingItem, PlaylistRecord, ScheduledPlaylist, ScheduleEndPolicy, SequenceRecord } from '../types/DataTypes';

// Module goals:
//   Deep understanding of the schedule - simulate a run
//     Provide a multi-granularity map for the UI of what happens and why in simulation
//   Actual execution
//     Make provision for interruptions, schedule changes, etc.; I/E incrementally
//     Show the user the internal thinking of the thing too, for interaction
//     Make prefetch requests during execution
//     Less granularity on things that are in the far future
//
// Things to do:
//   Support a start mid-schedule (this can be 2 flavors - simulate from that point, or simulate a late start)
//   List out everything that will happen (up to some end time)
//     This is a stack of all playlists that are now going or upcoming and where we are in them

// Note:
// FSEQ and audio are always aligned... but audio can be longer or shorter.
// Does the frame alignment matter?
//   No.  The time we have was computed from the number of frames.
//   If the audio doesn't all play, or there's a little time, meh.

// This seems like a lot of repetitive data structures, but:
//  ScheduledPlaylist / PlaylistRecord / SequenceRecord - what we're asked to do (UI edits these)
//  PlaybackItem - what we're considering doing (heap) or will soon consider (upcoming list)
//    This is created when a time range is loaded in.
//    This is a snapshot, it includes the expansion of shuffles.
//  PlaybackStateEntry - what we're actually doing within the candidate
//    This tracks an individual schedule's PlaybackItem.  Taken together within PlayerRunState
//  PlayAction - a thing to do from within a PlaybackStateEntry, not taking into account any others
//  PlayerRunState - Overall state w:
//    Stack of preempting playlists
//    Heap of prioritized ready events
//    Sorted list of future events
//  PlaybackLogDetail - what actually happened, item by item
//  PlayerStateSnapshot[] - current state, [0] is the top element

// TODO: Predictor of what's coming next, that sees ahead a bit into the schedule

// What is the manner by which it works?
//  There's a time-ordered list of things that will get considered
//    We obvs look at them a wee bit early... for prefetch, and for "up next"
//         ... that means materializing them.  When they become schedule candiates
//      They could be overridden or cancelled, however what if they are not?
//         The best info we have is that those should be prefetched, with priority based on time
//  There's a heap of things that could get started ... presence in the heap is based on the current time, priority selects
//  There's a stack of things that are occurring now, based on preemption.
//    Preempted ones don't actually start... they don't get inserted into the stack
//  There are occasions when it is decision time.
//    When a new thing comes off the heap and onto the stack
//    When a song / playlist finishes
//    At the end time of a playlist (in case of hard stop)
//    When an immediate request is received
//    When we are told to recalculate
//  Stack items recompute when they are pushed, resumed (popped), or recalculated

// xoroshiro128+ implementation in TypeScript
// Used below for shuffle playlists
export class Xoroshiro128Plus {
    private s0: bigint;
    private s1: bigint;

    static uuidToseed(uuid: string): bigint {
        if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(uuid)) return 0n;

        // Remove hyphens and lowercase (in case input varies)
        const hex = uuid.replace(/-/g, '').toLowerCase();

        // Take the full 128 bits (32 hex chars = 16 bytes)
        return BigInt('0x' + hex);
    }

    constructor(seed: bigint | number = Date.now()) {
        const seeded = this.seedSplit(seed);
        this.s0 = seeded[0];
        this.s1 = seeded[1];
    }

    private rotl(x: bigint, k: bigint): bigint {
        return ((x << k) | (x >> (64n - k))) & 0xffffffffffffffffn;
    }

    private seedSplit(seed: bigint | number): [bigint, bigint] {
        // Simple SplitMix64-like hash to split the seed
        let z = BigInt(seed) + 0x9e3779b97f4a7c15n;
        z = (z ^ (z >> 30n)) * 0xbf58476d1ce4e5b9n;
        z = (z ^ (z >> 27n)) * 0x94d049bb133111ebn;
        const s0 = z ^ (z >> 31n);

        z = s0 + 0x9e3779b97f4a7c15n;
        z = (z ^ (z >> 30n)) * 0xbf58476d1ce4e5b9n;
        z = (z ^ (z >> 27n)) * 0x94d049bb133111ebn;
        const s1 = z ^ (z >> 31n);

        return [s0 & 0xffffffffffffffffn, s1 & 0xffffffffffffffffn];
    }

    public nextBigInt(): bigint {
        const result = (this.s0 + this.s1) & 0xffffffffffffffffn;

        const s1 = this.s1 ^ this.s0;
        this.s0 = this.rotl(this.s0, 55n) ^ s1 ^ (s1 << 14n); // a, b
        this.s1 = this.rotl(s1, 36n); // c

        return result;
    }

    public next(): number {
        // Convert to a float in [0, 1)
        const result = this.nextBigInt();
        return Number(result >> 11n) / 9007199254740992; // 2^53
    }

    public nextInt(max: number): number {
        return Math.floor(this.next() * max);
    }

    public nextRange(min: number, max: number): number {
        return min + this.nextInt(max - min);
    }
}

export const priorityToNumber = {
    highest: 1,
    vhigh: 2,
    high: 3,
    medhigh: 4,
    medium: 5,
    normal: 5,
    medlow: 6,
    low: 7,
    vlow: 8,
    lowest: 9,
};

export interface SchedulerHeapItem {
    priorityTier: number;
    timeBasedPri: number; // If you want the playlist that is currently playing to continue, leave real time.
    // If you want the playlist that is up next to take over on time, negate these (via cutOffPrevious)
    cutOffPrevious: boolean;
}

export class SchedulerMinHeap<T extends SchedulerHeapItem> {
    private heap: T[];

    constructor() {
        this.heap = [];
    }

    findIndex(func: (e: T)=>boolean) {
        for (let i=0; i<this.heap.length; ++i) {
            if (func(this.heap[i])) return i;
        }
        return undefined;
    }

    findMatching(func: (e: T)=>boolean) {
        const res: T[] = [];
        for (let i=0; i<this.heap.length; ++i) {
            if (func(this.heap[i])) res.push(this.heap[i]);
        }
        return res;
    }

    get top(): T | undefined {
        return this.heap[0]; // Peek at the top element
    }

    static compare(i1: SchedulerHeapItem, i2: SchedulerHeapItem) {
        if (i1.priorityTier > i2.priorityTier) return 1;
        if (i1.priorityTier < i2.priorityTier) return -1;

        let i1t = i1.timeBasedPri;
        let i2t = i2.timeBasedPri;
        if (i1.cutOffPrevious) {
            i1t = -i1t;
        }
        if (i2.cutOffPrevious) {
            i2t = -i2t;
        }

        if (i1t > i2t) return 1;
        if (i1t < i2t) return -1;

        return 0;
    }

    updateTop(updateFn: (item: T) => void): void {
        if (this.heap.length === 0) return;

        updateFn(this.heap[0]); // Modify the top element
        this.bubbleDown(0); // Restore heap order
    }

    deleteTop(): T | undefined {
        if (this.heap.length === 0) return undefined;
        const top = this.heap[0];
        const last = this.heap.pop();
        if (this.heap.length > 0 && last !== undefined) {
            this.heap[0] = last;
            this.bubbleDown(0);
        }
        return top;
    }

    deleteAt(index: number): T | undefined {
        const n = this.heap.length;
        if (index < 0 || index >= n) return undefined;

        const removed = this.heap[index];
        const last = this.heap.pop()!; // n > 0

        if (index < this.heap.length) {
            // Put last element into the hole
            this.heap[index] = last;

            // Decide whether to bubble up or down
            const parentIndex = index > 0 ? Math.floor((index - 1) / 2) : -1;
            if (
                parentIndex >= 0 &&
                SchedulerMinHeap.compare(this.heap[index], this.heap[parentIndex]) < 0
            ) {
                this.bubbleUp(index);
            } else {
                this.bubbleDown(index);
            }
        }

        return removed;
    }

    insert(item: T): void {
        this.heap.push(item);
        this.bubbleUp(this.heap.length - 1);
    }

    private bubbleUp(index: number): void {
        while (index > 0) {
            const parentIndex = Math.floor((index - 1) / 2);
            if (SchedulerMinHeap.compare(this.heap[index], this.heap[parentIndex]) >= 0) break;
            [this.heap[index], this.heap[parentIndex]] = [this.heap[parentIndex], this.heap[index]];
            index = parentIndex;
        }
    }

    private bubbleDown(index: number): void {
        const lastIndex = this.heap.length - 1;
        while (true) {
            const left = 2 * index + 1;
            const right = 2 * index + 2;
            let smallest = index;

            if (left <= lastIndex && SchedulerMinHeap.compare(this.heap[left], this.heap[smallest]) < 0) {
                smallest = left;
            }
            if (right <= lastIndex && SchedulerMinHeap.compare(this.heap[right], this.heap[smallest]) < 0) {
                smallest = right;
            }
            if (smallest === index) break;

            [this.heap[index], this.heap[smallest]] = [this.heap[smallest], this.heap[index]];
            index = smallest;
        }
    }
}

type Item = { id: string };

// The idea here is if you sync the playlist (nonshuffled), and it was edited, this is where you are now
export function mapCursorEfficient<I extends Item>(original: I[], target: I[], cursorIndex: number): number {
    const m = original.length;
    const n = target.length;

    // Trivial Case 1: Prefix is unchanged
    let prefixUnchanged = true;
    for (let i = 0; i < cursorIndex && i < n; i++) {
        if (original[i].id !== target[i].id) {
            prefixUnchanged = false;
            break;
        }
    }
    if (prefixUnchanged && cursorIndex <= n) {
        return cursorIndex;
    }

    // Trivial Case 2: Suffix is unchanged
    const suffixLen = m - cursorIndex;
    if (suffixLen <= n) {
        let suffixUnchanged = true;
        for (let i = 0; i < suffixLen; i++) {
            if (original[cursorIndex + i]?.id !== target[n - suffixLen + i]?.id) {
                suffixUnchanged = false;
                break;
            }
        }
        if (suffixUnchanged) {
            return n - suffixLen;
        }
    }

    let prev = Array(n + 1).fill(0);
    let curr = Array(n + 1).fill(0);

    // Initialize base case
    for (let j = 0; j <= n; j++) {
        prev[j] = j;
    }

    // Cursor tracking
    let cursorInTarget = cursorIndex <= m ? cursorIndex : n;

    for (let i = 1; i <= m; i++) {
        curr[0] = i;
        for (let j = 1; j <= n; j++) {
            if (original[i - 1].id === target[j - 1].id) {
                curr[j] = prev[j - 1];
            } else {
                curr[j] =
                    1 +
                    Math.min(
                        prev[j], // delete from original
                        curr[j - 1], // insert to original
                        prev[j - 1], // substitute
                    );
            }
        }

        // If we're at the cursor's row, update its position in target
        if (i === cursorIndex) {
            // Find the column (j) in this row that led to minimum cost
            let bestJ = 0;
            let bestCost = Infinity;
            for (let j = 0; j <= n; j++) {
                if (curr[j] < bestCost) {
                    bestCost = curr[j];
                    bestJ = j;
                }
            }
            cursorInTarget = bestJ;
        }

        // Swap rows for next iteration
        [prev, curr] = [curr, prev];
    }

    return cursorInTarget;
}

export function getTotalSeqTimeMS(rec: SequenceRecord) {
    return Math.round(
        Math.max(
            0,
            rec.work.length * 1000 + (rec.settings?.lead_time ?? 0) * 1000 + (rec.settings?.trail_time ?? 0) * 1000,
        ),
    );
}

export function getSeqTimesMS(rec: SequenceRecord) {
    const lead = rec.settings?.lead_time ?? 0;
    const trail = rec.settings?.trail_time ?? 0;

    return {
        startLeadToSeqMS: lead > 0 ? Math.round(lead * 1000) : 0,
        endTrailFromSeqMS: trail > 0 ? Math.round(trail * 1000) : 0,
        startTrimOffSeqMS: lead < 0 ? Math.round(lead * -1000) : 0,
        endTrimOffSeqMS: trail < 0 ? Math.round(trail * -1000) : 0,
        totalSeqTimeMS: getTotalSeqTimeMS(rec),
    };
}

export function seqsToMap(seqs: SequenceRecord[], errs: string[]) {
    const seqMap: Map<string, SequenceRecord> = new Map();
    for (const s of seqs) {
        if (s.deleted) continue;
        if (seqMap.has(s.id)) {
            errs.push(`Duplicate sequence ID in library: ${s.id}`);
            continue;
        }
        seqMap.set(s.id, s);
    }
    return seqMap;
}

export function playlistsToMap(pls: PlaylistRecord[], errs: string[], sMap: Map<string, SequenceRecord>) {
    const plMap: Map<string, PlaylistRecord> = new Map();
    for (const p of pls) {
        if (p.deleted) continue;
        if (plMap.has(p.id)) {
            errs.push(`Duplicate playlist ID in library: ${p.id}`);
            continue;
        }
        for (const s of p.items) {
            if (!sMap.has(s.id)) {
                errs.push(`Playlist ${p.title}(${p.id}) references nonexistent sequence ID ${s.id}`);
            }
        }
        plMap.set(p.id, p);
    }
    return plMap;
}

export function scheduleToMap(sched: ScheduledPlaylist[], errs: string[], plMap: Map<string, PlaylistRecord>) {
    const schedMap: Map<string, ScheduledPlaylist> = new Map();

    for (const s of sched) {
        if (s.deleted) continue;
        if (schedMap.has(s.id)) {
            errs.push(`Duplicate schedule ID in library: ${s.id}`);
            continue;
        }

        if (!plMap.has(s.playlistId)) {
            errs.push(`Schedule ${s.title}(${s.id}) references nonexistent playlist ID ${s.playlistId}`);
        }

        schedMap.set(s.id, s);
    }

    return schedMap;
}

/**
 * This is the total time of the playlist if played linearly.
 *   Real time can depend on how it is scheduled
 */
export function getPlaylistDurationMS(
    seqs: SequenceRecord[],
    pl: PlaylistRecord,
    errs: string[],
    smap?: Map<string, SequenceRecord>,
) {
    if (!smap) smap = seqsToMap(seqs, errs);
    let totalMS = 0,
        longestMS = 0;
    for (const sid of pl.items) {
        const seq = smap.get(sid.id);
        if (!seq) {
            errs.push(`In playlist ${pl.title}: Sequence library does not contain id ${sid.id}`);
            continue;
        }
        const stime = getTotalSeqTimeMS(seq);
        totalMS += stime;
        longestMS = Math.max(longestMS, stime);
    }
    return {
        totalMS,
        longestMS,
    };
}

/**
 * Get scheduled duration
 * (currently gross)
 */
export function getScheduleTimes(sched: ScheduledPlaylist) {
    const baseDate = new Date(sched.date);

    // Handle extended time format (e.g., 25:00, 26:30)
    const parseExtendedTime = (timeString: string): Date => {
        const [hours, minutes, seconds = 0] = timeString.split(':').map(Number);
        const totalHours = hours;
        const normalizedHours = totalHours % 24;
        const daysOffset = Math.floor(totalHours / 24);

        const resultDate = new Date(baseDate);
        resultDate.setDate(resultDate.getDate() + daysOffset);
        resultDate.setHours(normalizedHours, minutes, seconds, 0);

        return resultDate;
    };

    const startDate = parseExtendedTime(sched.fromTime);
    const untilDate = parseExtendedTime(sched.toTime);

    return {
        startTimeMS: startDate.getTime(),
        endTimeMS: untilDate.getTime(), // This can be ignored in many cases (calculated)
    };
}

/**
 * Get time of a playlist as scheduled
 */
export function getScheduleDurationMS(
    seqs: SequenceRecord[],
    plists: PlaylistRecord[],
    schedule: ScheduledPlaylist,
    errs: string[],
    smap?: Map<string, SequenceRecord>,
    pmap?: Map<string, PlaylistRecord>,
) {
    if (!smap) smap = seqsToMap(seqs, errs);
    if (!pmap) pmap = playlistsToMap(plists, errs, smap);

    const pl = pmap.get(schedule.playlistId);
    if (!pl) {
        errs.push(`Playlist ${schedule.playlistId} does not exist.`);
    }
    const ipl = schedule.prePlaylistId ? pmap.get(schedule.prePlaylistId) : undefined;
    const opl = schedule.postPlaylistId ? pmap.get(schedule.postPlaylistId) : undefined;

    // schedule id should match pl id...
    if (schedule.playlistId !== pl?.id) {
        errs.push(`Calculating time for playlist ${pl?.id}, but schedule says ${schedule.playlistId}`);
    }
    const ptime = pl ? getPlaylistDurationMS(seqs, pl, errs, smap) : { longestMS: 0, totalMS: 0 };
    const introTime = ipl ? getPlaylistDurationMS(seqs, ipl, errs, smap).totalMS : 0;
    const outtroTime = opl ? getPlaylistDurationMS(seqs, opl, errs, smap).totalMS : 0;

    const stime = getScheduleTimes(schedule);

    // schedule id should match pl id...
    if (schedule.playlistId !== pl?.id) {
        errs.push(`Calculating time for playlist ${pl?.id}, but schedule says ${schedule.playlistId}`);
    }

    const nominalEndTimeMS = stime.endTimeMS; // When schedule says to end
    let expectedEndMS = stime.endTimeMS; // For non-looping / nonshuffle, this is when it would naturally end unless abridged
    let earlyEndMS = stime.endTimeMS; // When we'd end if stopping on song boundary early
    let lateEndMS = stime.endTimeMS; // When we'd end if stopping on song boundary late

    const sp = schedule.endPolicy ?? 'seqboundnearest';

    if (!schedule.loop && !schedule.shuffle) {
        expectedEndMS = Math.max(nominalEndTimeMS, stime.startTimeMS + ptime.totalMS + introTime + outtroTime);
    }
    if (sp === 'seqboundearly') {
        earlyEndMS = expectedEndMS - ptime.longestMS;
    } else if (sp === 'seqboundlate') {
        lateEndMS = nominalEndTimeMS + ptime.longestMS;
    } else if (sp === 'seqboundnearest') {
        earlyEndMS = expectedEndMS - ptime.longestMS / 2;
        lateEndMS = nominalEndTimeMS + ptime.longestMS / 2;
    }

    return {
        startTimeMS: stime.startTimeMS,
        hardStart: schedule.hardCutIn ?? false,
        hardEnd: schedule.endPolicy === 'hardcut',
        nominalEndTimeMS,
        expectedEndMS,
        earlyEndMS, // With preemption or looping or whatever, this could happen
        lateEndMS, // With preemption or looping or whatever this could happen

        totalPLMS: ptime.totalMS + introTime + outtroTime,
        longestPLItemMS: ptime.longestMS,
    };
}

export type PlaybackLogDetailType =
    | 'Schedule Started'
    | 'Schedule Ended'
    | 'Schedule Stopped'
    | 'Schedule Suspended'
    | 'Schedule Resumed'
    | 'Schedule Deferred'
    | 'Schedule Prevented'
    | 'Playlist Started'
    | 'Playlist Ended'
    | 'Sequence Started'
    | 'Sequence Ended'
    | 'Sequence Paused'
    | 'Sequence Resumed';

export interface PlaybackLogDetail {
    // What happened
    eventType: PlaybackLogDetailType;

    // Time this happened
    eventTime: number;
    // Push depth, in case it is interrupting something
    stackDepth: number;

    // If this is part of a scheduled item, this will be set
    //   If it is not set, it must be an override command or something
    scheduleId?: string;
    // If this is part of a playlist, this will be set, otherwise it may be immediate
    playlistId?: string;
    // If this is a sequence, this will be set.  Maybe other things get done sometime
    //   or this represents the start/end and no sequence is there now
    sequenceId?: string;

    ////
    //// Progress base point (interpret relative to actualStartTime)
    ////
    // If this is a playlist, this is the section + entry index (0-based)
    entryIntoPlaylist?: [number, number];
    // If this is a resume, this will be nonzero
    timeIntoSeqMS?: number;
}

export interface PlayAction {
    end: boolean;
    atTime: number;
    seqId?: string;
    offsetMS?: number;
    durationMS?: number;
}

interface PlaybackCursor {
    itemCursor: number;
    itemPart: number;
    endingPartEarly: boolean;
    baseTime: number;
    offsetInto: number;
    item: PlaybackItem;
}

// State entry of playback as it goes
class PlaybackStateEntry {
    constructor(pi: PlaybackItem, itemId: string) {
        this.item = pi;
        this.itemId = itemId;
        this.schedStartTime = pi.schedStart;
        this.schedEndTime = pi.schedEnd;
        this.seqIds = [pi.preSectionIds, pi.mainSectionIds, pi.postSectionIds];
        this.seqDurs = [pi.preSectionDurs, pi.mainSectionDurs, pi.postSectionDurs];
    }

    schedStartTime: number = 0; // Time when this was supposed to start
    schedEndTime: number = 0; // Time when this was supposed to end
    startTimeAdjust: number = 0; // If > 0, we started late / are running late / have been paused, if < 0 we are early

    suspendTime?: number = undefined; // Time when suspended, indicates suspended, and will adjust startTimeAdjust

    item: PlaybackItem; // The expanded item, full instructions
    itemId: string = '';

    seqIds: [string[], string[], string[]];
    seqDurs: [number[], number[], number[]];

    // We make a lot of state transitions, one by one.  This means itemPart / itemCursor start at -1 and go to length
    // The state transition for sequence end is when we set offsetInto to 0 / item is ended / cursor goes up in a valid way
    //  Sequence start is when offset into goes up from 0, or the whole thing occurs, or it gets truncated
    itemPart: number = -1; // 0, 1, 2 = pre / main / post
    itemCursor: number = -1; // Entry number
    endingPartEarly: boolean = false; // If part is cut off so next can go

    // Time alignment - in case things got delayed since start
    baseTime: number = 0; // Time when this playlist item was started / resumed
    offsetInto: number = 0; // Offset into item at baseTime

    // When does outro start?
    //  'hardcut' - exactly when
    //  'seqboundearly' - if there is not time for one sequence
    //  'seqboundlate' - if there is
    // Return undefined if this should play
    // Return 0 if outro should start now
    // Return >0 if outro should start part way into seq
    shouldStartOutro(currentTime: number, nextSeqLen: number): number | undefined {
        if (this.item.endPolicy === 'hardcut') {
            if (currentTime + nextSeqLen > this.item.schedEnd - this.item.postSectionTotal) {
                return this.item.schedEnd - currentTime - this.item.postSectionTotal;
            }
            return undefined;
        }
        if (this.item.endPolicy === 'seqboundearly') {
            if (currentTime + nextSeqLen > this.item.schedEnd - this.item.postSectionTotal) {
                return 0;
            }
            return undefined;
        }
        if (this.item.endPolicy === 'seqboundnearest') {
            if (currentTime + this.item.mainSectionLongest / 2 > this.item.schedEnd - this.item.postSectionTotal) {
                return 0;
            }
            return undefined;
        }
        return currentTime >= this.item.schedEnd - this.item.postSectionTotal ? 0 : undefined;
    }

    getCursor(): PlaybackCursor {
        return {
            itemCursor: this.itemCursor,
            itemPart: this.itemPart,
            endingPartEarly: this.endingPartEarly,
            baseTime: this.baseTime,
            offsetInto: this.offsetInto,
            item: this.item,
        };
    }

    setCursor(c: PlaybackCursor) {
        this.itemCursor = c.itemCursor;
        this.itemPart = c.itemPart;
        this.endingPartEarly = c.endingPartEarly;
        this.baseTime = c.baseTime;
        this.offsetInto = c.offsetInto;
        this.item = c.item;
    }

    addLog(depth: number, et: PlaybackLogDetailType, ctime: number, c: PlaybackCursor, log?: PlaybackLogDetail[]) {
        log?.push({
            eventType: et,
            eventTime: ctime,
            scheduleId: c.item.scheduleId,
            playlistId: c.item.playlistIds?.[c.itemPart],
            stackDepth: depth,
            sequenceId: this.seqIds[c.itemPart]?.[c.itemCursor % (this.seqIds[c.itemPart].length || 1)],
            entryIntoPlaylist: [c.itemPart, c.itemCursor],
            timeIntoSeqMS: c.offsetInto,
        });
    }

    nextItem(depth: number, c: PlaybackCursor, ctime: number, loop: boolean, log?: PlaybackLogDetail[]) {
        if (c.itemPart >= 0 && c.itemPart <= 2 && c.itemCursor >= 0) {
            this.addLog(depth, 'Sequence Ended', ctime, c, log);
        }
        ++c.itemCursor;
        if (loop && c.itemCursor >= this.seqIds[c.itemPart].length) c.itemCursor = 0;
        c.offsetInto = 0;
    }

    endCurrentPart(depth: number, c: PlaybackCursor, ctime: number, log?: PlaybackLogDetail[]) {
        if (c.itemPart >= 0 && c.itemPart <= 2 && this.seqIds[c.itemPart]?.length) {
            this.addLog(depth, 'Playlist Ended', ctime, c, log);
        }
        ++c.itemPart;
        c.itemCursor = -1;
        c.offsetInto = 0;
        c.endingPartEarly = false;
    }

    // Advance to time
    advanceToTime(
        c: PlaybackCursor,
        depth: number,
        runToTime: number, // We should finish everything up to here, not start anything
        out?: PlayAction[],
        paLimit?: number,
        log?: PlaybackLogDetail[],
    ) {
        const pthis = this;

        /*
        We start at -1, -1
        The transition to 0, -1 is trivial.
        The transition to 0, 0 is trivial IF the list is empty
        The transition to 0, 0 is not trivial if the list has stuff

        -1, -1 means we have not started at all
        0, -1 means that we have not started the playlist
        0,  0 means that we are in the item
        0,  1 means that we are done the whole list (assuming 1 thing)
        1, -1 means that we have not started the playlist

        Ending a part means we go to the next part but -1
        Starting a part means we go to index 0
        */

        function startNextPart(ctime: number) {
            c.itemCursor = 0;
            c.offsetInto = 0;
            if (c.itemPart <= 2 && pthis.seqIds[c.itemPart]?.length) {
                pthis.addLog(depth, 'Playlist Started', ctime, c, log);
            }
        }

        while (true) {
            const curTime = c.baseTime + c.offsetInto;
            if (curTime > runToTime) break;

            // Do any finish transitions, always
            if (
                c.itemPart >= 0 &&
                c.itemPart <= 2 &&
                (c.itemCursor >= this.seqIds[c.itemPart].length || c.endingPartEarly)
            ) {
                this.endCurrentPart(depth, c, curTime, log);
                continue;
            }
            if (c.itemPart >= 3) {
                // This is over.
                out?.push({
                    end: true,
                    atTime: curTime,
                });
                break;
            }

            // Do any trivial transitions, always
            if (!this.seqIds[c.itemPart]?.length) {
                startNextPart(curTime);
                this.endCurrentPart(depth, c, curTime, log);
                continue;
            }

            // See if we're at end time
            if (curTime >= runToTime) break;
            // Limit output
            if (out !== undefined) {
                if (paLimit && out.length >= paLimit) break;
            }

            // Look for start transitions
            if (c.itemCursor < 0) {
                startNextPart(curTime);
            }

            const left = runToTime - curTime;

            if (c.itemPart === 0) {
                // Pre list
                const itime = c.item.preSectionDurs[c.itemCursor];
                if (c.offsetInto === 0) {
                    this.addLog(depth, 'Sequence Started', c.baseTime, c, log);
                }
                if (itime - c.offsetInto > left) {
                    // Enough time in this to cover it
                    out?.push({
                        end: false,
                        atTime: curTime,
                        seqId: c.item.preSectionIds[c.itemCursor],
                        offsetMS: c.offsetInto,
                        durationMS: itime - c.offsetInto,
                    });
                    c.offsetInto += left;
                    break; // Have exceeded
                }

                // Advance, use whole sequence
                out?.push({
                    end: false,
                    atTime: curTime,
                    seqId: c.item.preSectionIds[c.itemCursor],
                    offsetMS: c.offsetInto,
                    durationMS: itime - c.offsetInto,
                });

                this.nextItem(depth, c, c.baseTime + itime, false, log);
                c.baseTime += itime;

                continue;
            } else if (c.itemPart === 1) {
                // Main (loop?)
                const itime = c.item.mainSectionDurs[c.itemCursor % c.item.mainSectionDurs.length];
                const itemleft = itime - c.offsetInto;

                // Advanced outro calculation
                const shouldStartOutro = this.shouldStartOutro(c.baseTime + c.offsetInto, itemleft);
                if (shouldStartOutro === undefined) {
                    // No effect from outro yet
                    if (c.offsetInto === 0) {
                        this.addLog(depth, 'Sequence Started', c.baseTime, c, log);
                    }

                    out?.push({
                        end: false,
                        atTime: curTime,
                        seqId: c.item.mainSectionIds[c.itemCursor],
                        offsetMS: c.offsetInto,
                        durationMS: itime - c.offsetInto,
                    });

                    if (itime - c.offsetInto > left) {
                        // Enough time in c to cover it
                        c.offsetInto += left;
                        break;
                    }

                    // Advance
                    this.nextItem(depth, c, c.baseTime + itime, c.item.mainSectionLoop, log);
                    c.baseTime += itime; // Use whole thing
                } else if (shouldStartOutro < 1) {
                    // NOW!  (Do not indicate play sequence)
                    c.endingPartEarly = true;
                    c.baseTime += c.offsetInto;
                    if (c.offsetInto !== 0) {
                        c.offsetInto = 0;
                        this.nextItem(depth, c, c.baseTime + c.offsetInto, c.item.mainSectionLoop, log);
                    }
                    c.offsetInto = 0;
                    this.endCurrentPart(depth, c, curTime, log);
                    continue;
                } else {
                    // Outro is going to cut into this seq
                    if (c.offsetInto === 0) {
                        this.addLog(depth, 'Sequence Started', c.baseTime, c, log);
                    }
                    // Use up to outro
                    if (shouldStartOutro >= left) {
                        // We just adjust, no outro yet
                        out?.push({
                            end: false,
                            atTime: curTime,
                            seqId: c.item.mainSectionIds[c.itemCursor],
                            offsetMS: c.offsetInto,
                            durationMS: shouldStartOutro,
                        });
                        c.offsetInto += left;
                    } else {
                        // Use up the time until outro
                        const useOutro = Math.max(0, shouldStartOutro);
                        if (useOutro > 0) {
                            out?.push({
                                end: false,
                                atTime: curTime,
                                seqId: c.item.mainSectionIds[c.itemCursor],
                                offsetMS: c.offsetInto,
                                durationMS: useOutro,
                            });
                            c.offsetInto += useOutro;
                        }
                        this.nextItem(depth, c, c.baseTime + c.offsetInto, c.item.mainSectionLoop, log);
                        c.endingPartEarly = true;
                    }
                }
            } else if (c.itemPart === 2) {
                // Post
                if (c.offsetInto === 0) {
                    this.addLog(depth, 'Sequence Started', c.baseTime, c, log);
                }

                // Advance, use this sequence
                const itime = c.item.postSectionDurs[c.itemCursor];
                out?.push({
                    end: false,
                    atTime: curTime,
                    seqId: c.item.postSectionIds[c.itemCursor],
                    offsetMS: c.offsetInto,
                    durationMS: itime - c.offsetInto,
                });
                if (itime - c.offsetInto > left) {
                    // Enough time in c to cover it
                    c.offsetInto += left;
                    break;
                }
                // Advance
                this.nextItem(depth, c, c.baseTime + itime, false, log);
                c.baseTime += itime; // Use whole thing
            }
        }
    }

    noteScheduleEvent(
        depth: number,
        st: PlaybackCursor,
        currentTime: number,
        eventType: PlaybackLogDetailType,
        log?: PlaybackLogDetail[],
    ) {
        log?.push({
            eventType: eventType,
            scheduleId: st.item.scheduleId,
            playlistId: st.item.playlistIds?.[st.itemPart],
            eventTime: currentTime,
            stackDepth: depth,
            entryIntoPlaylist: [st.itemPart, st.itemCursor],
            timeIntoSeqMS: st.offsetInto,
        });
    }

    // Set to time, when created
    // Note that actualStart can be used as currentTime, for current or deferred start
    //  actualTime can be set to scheduled time and current to now, to pretend it started on time
    // How to represent a future time:
    //  actualStart will be in the future.  Current time is whatever.
    //  advanceToTime will do nothing
    initializeToTime(depth: number, actualStart: number, currentTime: number) {
        this.startTimeAdjust = actualStart - this.schedStartTime;
        this.baseTime = actualStart;
        this.offsetInto = 0;

        // Skip ahead
        this.advanceToTime(this, depth, currentTime);
    }

    // This is called to abort
    stopAtTime(depth: number, currentTime: number, log?: PlaybackLogDetail[]) {
        let aborted = false;
        if (this.offsetInto > 0) {
            this.nextItem(depth, this, currentTime, false, log);
            aborted = true;
        }
        if (this.itemCursor >= 0) {
            this.endCurrentPart(depth, this, currentTime, log);
            aborted = true;
        }

        this.addLog(depth, aborted ? 'Schedule Stopped' : 'Schedule Ended', currentTime, this, log);
    }

    // This is called when another item is pushed over it
    suspendAtTime(depth: number, currentTime: number, logs?: PlaybackLogDetail[]) {
        this.advanceToTime(this, depth, currentTime);
        // Not sure if there is anything to do
        this.suspendTime = currentTime;
        if (this.offsetInto > 0) {
            this.addLog(depth, 'Sequence Paused', currentTime, this, logs);
        }
        this.noteScheduleEvent(depth, this, currentTime, 'Schedule Suspended', logs);
    }

    advancePausedTime(depth: number, currentTime: number, _logs?: PlaybackLogDetail[]) {
        const st = this.suspendTime ?? currentTime;
        this.suspendTime = currentTime;
        const delta = currentTime - st;

        if (this.item.keepToScheduleWhenPreempted) {
            // As if we kept going
            this.advanceToTime(this, depth, currentTime);
        } else {
            // As if we lost time
            this.baseTime += delta;
            this.startTimeAdjust += delta;
            this.advanceToTime(this, depth, currentTime);
        }
    }

    // This is called when the item is resumed
    resumeAtTime(depth: number, currentTime: number, logs?: PlaybackLogDetail[]) {
        this.advancePausedTime(depth, currentTime, logs);
        this.suspendTime = undefined;
        this.noteScheduleEvent(depth, this, currentTime, 'Schedule Resumed', logs);
        if (this.offsetInto > 0) {
            this.addLog(depth, 'Sequence Resumed', currentTime, this, logs);
        }
    }

    // List of things occurring next
    getUpcomingItems(depth: number, currentTime: number, readDuration: number, readNActions: number): PlayAction[] {
        this.advanceToTime(this, depth, currentTime);
        const pa: PlayAction[] = [];
        this.advanceToTime(this.getCursor(), depth, currentTime + readDuration, pa, readNActions);
        return pa;
    }

    getCurDur() {
        if (this.itemPart > 2) return 0;
        return this.seqDurs[this.itemPart]?.[this.itemCursor] ?? 0;
    }

    // Next things, next interruption time
    getNextGracefulInterruptionTime(depth: number, currentTime: number) {
        this.advanceToTime(this, depth, currentTime);
        if (this.item.preferHardCutIn) return currentTime;
        if (this.offsetInto === 0) return this.baseTime;
        return this.baseTime + this.getCurDur();
    }

    getNextDecisionTime(depth: number, currentTime: number) {
        // Based on an item?
        const sdur = this.getUpcomingItems(depth, currentTime, 1, 1)[0]?.durationMS;
        if (sdur === undefined) return currentTime; // This is it

        // Based on hard cut out?
        let nextDecisionTime = currentTime + sdur;
        if (this.item.endPolicy === 'hardcut') {
            nextDecisionTime = Math.min(nextDecisionTime, this.item.schedEnd);
        }
        return nextDecisionTime;
    }

    shouldAbort(depth: number, currentTime: number) {
        const pa = this.getUpcomingItems(depth, currentTime, 1, 1);
        if (!pa.length || pa[0].end) {
            return true;
        }
        if (this.item.endPolicy === 'hardcut' && currentTime >= this.item.schedEnd) {
            return true;
        }
        return false;
    }

    // TODO: Reset the item and update
}

// Track items that we may start
class PlaybackItem implements SchedulerHeapItem {
    itemType?: 'Scheduled' | 'Immediate' | 'Queued';
    priorityTier: number = 10;
    timeBasedPri: number = 0;
    cutOffPrevious: boolean = false; // Tie breaker, which wins, existing (false) or new (true)?

    schedStart: number = 0;
    schedEnd: number = 0;

    endPolicy?: ScheduleEndPolicy; // For schedules over alotted time, how to end?
    keepToScheduleWhenPreempted?: boolean; // Keep "running" when overriden

    hardCutIn?: boolean; // Should interrupt lower priority immediately
    preferHardCutIn?: boolean; // Set on, say, static, to allow others to preempt immediately
    itemId: string = ''; // This is for internal tracking, either the request ID or the schedule ID
    requestId?: string; // If it is a request

    scheduleId?: string = ''; // If this correlates to such
    playlistIds?: (string | undefined)[] = undefined; // If this correlates to such

    preSectionIds: string[] = [];
    preSectionDurs: number[] = [];
    preSectionTotal: number = 0;
    postSectionIds: string[] = [];
    postSectionDurs: number[] = [];
    postSectionTotal: number = 0;
    mainSectionIds: string[] = [];
    mainSectionDurs: number[] = [];
    mainSectionTotal: number = 0;
    mainSectionLongest: number = 0;
    mainSectionLoop: boolean = false;
}

// Loop a schedule for time
export function createShuffleList(
    plist: PlaylistRecord,
    seed: number,
    minMS: number,
    smap: Map<string, SequenceRecord>,
): string[] {
    const rng = new Xoroshiro128Plus(BigInt(seed).valueOf() + Xoroshiro128Plus.uuidToseed(plist.id));
    for (let i = 0; i < 10; ++i) rng.nextInt(100);

    // TODO: Check for no way of getting any time... no choices with > 0 time.

    if (!plist.items.length) return [];

    const nitems = plist.items.length;
    const ndontuse = Math.floor(nitems / 2);
    const doNotUse: Set<string> = new Set(); // Keeps random from being too random

    const sellist = plist.items.map((e) => e.id);

    const selections: string[] = [];
    let totalMS = 0;
    while (totalMS < minMS) {
        // Put back in the mix
        while (doNotUse.size > ndontuse) {
            doNotUse.delete(selections[selections.length - doNotUse.size]);
        }
        if (!sellist.length) {
            sellist.push(...plist.items.map((e) => e.id)); // Repopulate the list
        }
        while (true) {
            const pick = rng.nextInt(sellist.length);
            const sid = sellist[pick];
            if (doNotUse.has(sid)) {
                continue;
            }
            doNotUse.add(sid);
            selections.push(sid);
            if (pick < sellist.length - 1) {
                sellist[pick] = sellist.pop()!;
            } else {
                sellist.pop();
            }
            const s = smap.get(sid);
            const len = s ? getSeqTimesMS(s).totalSeqTimeMS || 1000 : 1000;
            totalMS += len;
            break;
        }
    }
    return selections;
}

export interface PlaybackStateSnapshot {
    scheduleId?: string; // Which schedule it is
    itemId: string;

    // Which of the playlists, and supporting evidence
    playlistNumber: number; // 0 for head, 1 for main, 2 for tail
    playlistIds: string[];
    playlistDurations: number[];

    seqIdx: number; // Index into the sequences, -1 and off the end can occur
    offsetInto: number; // ms into the sequence

    atTime: number; // Current time or suspend time
}

export type PlaybackActions =
    | {
          type: 'scheduled';
          actions: PlayAction[];
          schedStart: number;
          schedEnd: number;
          scheduleId: string;
      }
    | {
          type: 'interactive';
          actions: PlayAction[];
          requestId: string;
          startTime: number;
          seqId?: string;
          playlistId?: string;
          scheduleId?: string;
      };

export interface InteractivePlayCommand {
    immediate: boolean;
    startTime: number;
    seqId?: string;
    playlistId?: string;
    scheduleId?: string;
    requestId: string;
}

export interface UpcomingPlaybackActions {
    // Actions for current playlist
    curPLActions?: PlaybackActions;
    stackedPLActions?: PlaybackActions[];
    heapSchedules?: PlaybackActions[];

    upcomingSchedules?: PlaybackActions[];

    interactive?: PlaybackActions[];
}

export class PlayerRunState {
    currentTime: number = 0;

    stack: PlaybackStateEntry[] = []; // This is what's currently in process
    stackById: Map<string, PlaybackStateEntry> = new Map();

    // This heap is just a way to prioritize things to update the stack when the stack is at a good spot to do it...
    //   Items that are in the future are not in this heap, just ones that are current but not running.
    heap: SchedulerMinHeap<PlaybackItem> = new SchedulerMinHeap(); // This is things to choose from when something ends
    heapById: Map<string, PlaybackItem> = new Map();

    upcomingOccurrences: PlaybackItem[] = []; // Things to add as time passes
    upcomingById: Map<string, PlaybackItem> = new Map();

    sequences: SequenceRecord[] = [];
    sequencesById: Map<string, SequenceRecord> = new Map();
    playlists: PlaylistRecord[] = [];
    playlistsById: Map<string, PlaylistRecord> = new Map();
    schedules: ScheduledPlaylist[] = [];
    schedulesById: Map<string, ScheduledPlaylist> = new Map();

    interactiveQueue: InteractivePlayCommand[] = [];
    immediateItem?: InteractivePlayCommand = undefined;

    constructor(currentTime: number) {
        this.currentTime = currentTime;
    }

    setUpSequences(
        seqs: SequenceRecord[],
        playlists: PlaylistRecord[],
        schedules: ScheduledPlaylist[],
        errs: string[],
    ) {
        this.sequences = seqs
            .filter((s) => s.deleted !== true)
            .map((s) => {
                return { ...s };
            });
        this.sequencesById = seqsToMap(this.sequences, errs);
        this.playlists = playlists
            .filter((p) => p.deleted !== true)
            .map((p) => {
                return { ...p };
            });
        this.playlistsById = playlistsToMap(this.playlists, errs, this.sequencesById);
        this.schedules = schedules
            .filter((s) => s.deleted !== true)
            .map((s) => {
                return { ...s };
            });
        this.schedules.sort((a, b) => getScheduleTimes(a).startTimeMS - getScheduleTimes(b).startTimeMS);
        this.schedulesById = scheduleToMap(this.schedules, errs, this.playlistsById);

        // TODO CRAZ: If this is an update, go back the stack and update playing things if needed
    }

    #addToHeap(sc: PlaybackItem) {
        this.heapById.set(sc.itemId, sc);
        this.heap.insert(sc);
    }

    get #stackTop() {
        if (!this.depth) return undefined;
        return this.stack[this.depth - 1];
    }
    #stackPop() {
        const e = this.stack.pop();
        if (e) {
            this.stackById.delete(e.itemId);
        }
        return;
    }
    #stackPush(e: PlaybackStateEntry) {
        this.stackById.set(e.itemId, e);
        this.stack.push(e);
    }

    #populatePlaybackScheduleItem(sc: PlaybackItem, s: ScheduledPlaylist) {
        const times = getScheduleTimes(s);
        sc.itemType = 'Scheduled';
        sc.priorityTier = priorityToNumber[s.priority ?? 'medium'];
        sc.timeBasedPri = times.startTimeMS;
        sc.schedStart = times.startTimeMS;
        sc.schedEnd = times.endTimeMS;
        sc.scheduleId = s.id;
        sc.itemId = s.id;
        sc.playlistIds = [s.prePlaylistId, s.playlistId, s.postPlaylistId];

        sc.preferHardCutIn = s.preferHardCutIn;
        sc.hardCutIn = s.hardCutIn;
        sc.endPolicy = s.endPolicy;
        sc.keepToScheduleWhenPreempted = s.keepToScheduleWhenPreempted;

        sc.preSectionIds = [];
        sc.preSectionTotal = 0;
        sc.postSectionIds = [];
        sc.postSectionTotal = 0;

        const prepl = s.prePlaylistId ? this.playlistsById.get(s.prePlaylistId) : undefined;
        if (prepl) {
            for (let i = 0; i < prepl.items.length; ++i) {
                const seq = this.sequencesById.get(prepl.items[i].id);
                if (!seq) continue;
                sc.preSectionIds.push(seq.id);
                const it = getSeqTimesMS(seq).totalSeqTimeMS || 1000;
                sc.preSectionDurs.push(it);
                sc.preSectionTotal += it;
            }
        }
        const postl = s.postPlaylistId ? this.playlistsById.get(s.postPlaylistId) : undefined;
        if (postl) {
            for (let i = 0; i < postl.items.length; ++i) {
                const seq = this.sequencesById.get(postl.items[i].id);
                if (!seq) continue;
                sc.postSectionIds.push(seq.id);
                const it = getSeqTimesMS(seq).totalSeqTimeMS || 1000;
                sc.postSectionDurs.push(it);
                sc.postSectionTotal += it;
            }
        }

        sc.mainSectionIds = [];
        sc.mainSectionLoop = !!(s.loop || s.shuffle);
        sc.mainSectionTotal = 0;
        sc.mainSectionLongest = 0;

        const mainpl = this.playlistsById.get(s.playlistId);
        if (mainpl) {
            const mainTimes = getPlaylistDurationMS(this.sequences, mainpl, [], this.sequencesById);
            sc.mainSectionTotal = mainTimes.totalMS;
            sc.mainSectionLongest = mainTimes.longestMS;

            if (s.shuffle) {
                sc.mainSectionIds = createShuffleList(
                    mainpl,
                    sc.schedStart,
                    sc.schedEnd - sc.schedStart,
                    this.sequencesById,
                );
            } else {
                for (let i = 0; i < mainpl.items.length; ++i) {
                    const seq = this.sequencesById.get(mainpl.items[i].id);
                    if (!seq) continue;
                    sc.mainSectionIds.push(seq.id);
                    const it = getSeqTimesMS(seq).totalSeqTimeMS || 1000;
                    sc.mainSectionDurs.push(it);
                }
            }
        }
    }

    #populatePlaybackInteractiveItem(sc: PlaybackItem, ipc: InteractivePlayCommand, ct: number) {
        sc.schedStart = ipc.startTime <= 0 ? ct : ipc.startTime;
        sc.schedEnd = sc.schedStart + 24 * 3600 * 1000; // Maybe calculate; maybe a setting
        if (ipc.scheduleId) {
            sc.scheduleId = ipc.scheduleId;
            const s = this.schedulesById.get(ipc.scheduleId);
            if (!s) return;
            this.#populatePlaybackScheduleItem(sc, s);
            const dur = sc.schedEnd - sc.schedStart;
            sc.schedStart = ipc.startTime <= 0 ? ct : ipc.startTime;
            sc.schedEnd = sc.schedStart + dur;
        } else if (ipc.playlistId) {
            sc.playlistIds = [undefined, ipc.playlistId, undefined];
            sc.mainSectionIds = [];
            sc.mainSectionLoop = false;
            sc.mainSectionTotal = 0;
            sc.mainSectionLongest = 0;

            const mainpl = this.playlistsById.get(ipc.playlistId);
            if (mainpl) {
                const mainTimes = getPlaylistDurationMS(this.sequences, mainpl, [], this.sequencesById);
                sc.mainSectionTotal = mainTimes.totalMS;
                sc.mainSectionLongest = mainTimes.longestMS;

                for (let i = 0; i < mainpl.items.length; ++i) {
                    const seq = this.sequencesById.get(mainpl.items[i].id);
                    if (!seq) continue;
                    sc.mainSectionIds.push(seq.id);
                    const it = getSeqTimesMS(seq).totalSeqTimeMS || 1000;
                    sc.mainSectionDurs.push(it);
                }
            }
        } else if (ipc.seqId) {
            sc.playlistIds = [undefined, undefined, undefined];
            sc.mainSectionIds = [];
            sc.mainSectionLoop = false;
            sc.mainSectionTotal = 0;
            sc.mainSectionLongest = 0;

            const seq = this.sequencesById.get(ipc.seqId);
            if (seq) {
                sc.mainSectionIds.push(seq.id);
                const it = getSeqTimesMS(seq).totalSeqTimeMS || 1000;
                sc.mainSectionDurs.push(it);
                sc.mainSectionTotal = it;
                sc.mainSectionLongest = it;
            }
        }
        sc.cutOffPrevious = ipc.immediate ? true : false;
        sc.hardCutIn = ipc.immediate ? true : false;
        sc.priorityTier = ipc.immediate ? 1 : 2;
        sc.timeBasedPri = ipc.startTime;
        sc.itemId = ipc.requestId;
        sc.requestId = ipc.requestId;
        sc.itemType = ipc.immediate ? 'Immediate' : 'Queued';
    }

    //  Feeding in the whole schedule and a time range to update the relevant part
    addTimeRangeToSchedule(start: number, end: number, preferStartingNew: boolean = true) {
        // Filter to time window
        const itemsToAdd: ScheduledPlaylist[] = [];
        for (const s of this.schedules) {
            if (s.deleted) continue;
            const times = getScheduleTimes(s);
            if (times.startTimeMS >= end) break;
            if (times.endTimeMS <= start) continue;
            itemsToAdd.push(s);
        }

        // See if this is past, future, or current based on our currentTime
        for (const s of itemsToAdd) {
            if (this.heapById.has(s.id)) continue;

            const times = getScheduleTimes(s);

            if (times.endTimeMS <= this.currentTime) {
                continue;
            }

            const pi = new PlaybackItem();
            this.#populatePlaybackScheduleItem(pi, s);
            pi.itemType = 'Scheduled';
            pi.cutOffPrevious = preferStartingNew;

            if (pi.schedStart > this.currentTime) {
                if (!this.upcomingById.has(pi.itemId)) {
                    this.upcomingOccurrences.push(pi);
                    this.upcomingById.set(pi.itemId, pi);
                }
            } else {
                if (!this.heapById.has(pi.itemId)) {
                    this.#addToHeap(pi);
                }
            }
        }
    }

    get depth() {
        return this.stack.length;
    }

    // Read the schedule out...
    readOutScheduleUntil(et: number, limit: number): PlaybackLogDetail[] {
        const log: PlaybackLogDetail[] = [];
        this.addTimeRangeToSchedule(this.currentTime, et);

        this.runUntil(et, limit, log);
        return log;
    }

    runUntil(et: number, limit?: number, log?: PlaybackLogDetail[]): number {
        // Drive the loop
        let iterLimit = (limit || 1000) * 10 + 100;
        if (iterLimit < 0) iterLimit = 10000;

        while (!log || !limit || log.length < limit) {
            if (this.currentTime > et) {
                break;
            }

            // Make sure everything up to the current time is represented correctly in the heap
            // First, discard obsolete items
            while (this.heap.top && this.heap.top.schedEnd <= this.currentTime) {
                // This is a prevented event - never ran
                log?.push({
                    eventTime: this.currentTime,
                    eventType: 'Schedule Prevented',
                    stackDepth: this.depth,
                    scheduleId: this.heap.top.scheduleId,
                });
                this.heap.deleteTop();
            }

            // Then see if there are relevant upcoming items to add to it
            const heapUntil = this.currentTime;
            let nti = 0;
            while (nti < this.upcomingOccurrences.length) {
                const add = this.upcomingOccurrences[nti];
                if (add.schedStart > heapUntil) break;
                this.upcomingById.delete(add.itemId);
                if (this.heapById.has(add.itemId)) continue;
                this.#addToHeap(add);
                ++nti;
            }
            if (nti > 0) this.upcomingOccurrences = this.upcomingOccurrences.slice(nti);

            // See if there is an immediate item
            if (this.immediateItem && this.immediateItem.startTime <= this.currentTime) {
                if (!this.heapById.has(this.immediateItem.requestId)) {
                    const qi = new PlaybackItem();
                    this.#populatePlaybackInteractiveItem(qi, this.immediateItem, this.currentTime);
                    this.#addToHeap(qi);
                }
                this.immediateItem = undefined;
            }

            // Then see if there are relevant upcoming queue items to add
            const queueUntil = this.currentTime;
            let nqi = 0;
            while (nqi < this.interactiveQueue.length) {
                const add = this.interactiveQueue[nqi];
                if (add.startTime > queueUntil) break;
                if (this.heapById.has(add.requestId)) continue;
                const qi = new PlaybackItem();
                this.#populatePlaybackInteractiveItem(qi, add, this.currentTime);
                this.#addToHeap(qi);
                ++nqi;
            }
            if (nqi > 0) this.interactiveQueue = this.interactiveQueue.slice(nqi);

            // We now have everything organized for the current time, that is,
            //  Heap, stack, (eventually immediate)
            //  So what, we need a next time.  End->upcoming->heap item/stack item
            // The thought is, run the stack up to current time.
            //   Then see if there is anything to push
            //   Then pick a next time to come through the loop

            // Make decisions if the stack / heap says to do so?
            //   Pop stack items that are done, and log it
            while (this.#stackTop) {
                const st = this.#stackTop;
                if (st.shouldAbort(this.depth, this.currentTime)) {
                    st.stopAtTime(this.depth, this.currentTime, log);
                    this.#stackPop();

                    const nst = this.#stackTop;
                    if (nst) {
                        nst.advancePausedTime(this.depth, this.currentTime, log);
                    }

                    continue;
                }
                break;
            }

            // We have completed ends, see if loop should stop
            if (this.currentTime >= et) {
                break;
            }
            if (iterLimit-- < 0) {
                break;
            }

            // At this point, there either is no stack top, or we have one until a time we just grabbed
            let nextDecisionTime = et;

            // Check for heap / interruptions
            //   If there is something new in the heap
            let heapCutIn: number | undefined = undefined;
            const ht = this.heap.top;
            if (ht) {
                //     See if heap item is supposed to preempt this
                //         either in the middle or not
                // Event for the preemption, or lack thereof
                let shouldPush = false;
                const st = this.#stackTop;
                if (!st) {
                    shouldPush = true;
                } else if (SchedulerMinHeap.compare(ht, st.item) < 0) {
                    if (
                        st.item.preferHardCutIn ||
                        ht.hardCutIn ||
                        st.getNextGracefulInterruptionTime(this.depth, this.currentTime) === this.currentTime
                    ) {
                        shouldPush = true;
                    } else {
                        heapCutIn = st.getNextGracefulInterruptionTime(this.depth, this.currentTime);
                    }
                } else if (ht.schedStart === this.currentTime) {
                    log?.push({
                        eventTime: this.currentTime,
                        eventType: 'Schedule Deferred',
                        stackDepth: this.depth,
                        scheduleId: ht.scheduleId,
                    });
                }

                if (shouldPush) {
                    const shouldKeep = st?.item.itemType !== 'Immediate';
                    if (st) {
                        if (shouldKeep) {
                            st.suspendAtTime(this.depth, this.currentTime, log);
                        }
                        else {
                            st.stopAtTime(this.depth, this.currentTime, log);
                        }
                    }

                    this.heap.deleteTop();
                    this.heapById.delete(ht.itemId);

                    const nst = new PlaybackStateEntry(ht, ht.itemId);
                    nst.initializeToTime(this.depth, this.currentTime, this.currentTime);

                    if (shouldKeep) {
                        this.#stackPush(nst);
                    }

                    nst.noteScheduleEvent(this.depth, nst, this.currentTime, 'Schedule Started', log);
                }
            }

            // What will be next decision time - recalculate from heap push
            nextDecisionTime = et;

            //  Something ends off the stack? / Stack says to do that?  Check that.
            const se = this.#stackTop;
            if (se) {
                if (se.suspendTime !== undefined) {
                    se.resumeAtTime(this.depth, this.currentTime, log);
                }
                nextDecisionTime = Math.min(se.getNextDecisionTime(this.depth, this.currentTime), nextDecisionTime);
            }

            // The heap says do something?
            if (heapCutIn !== undefined) {
                nextDecisionTime = Math.min(heapCutIn, nextDecisionTime);
            }

            //  The upcoming items says to do something?
            const ue = this.upcomingOccurrences[0];
            if (ue && ue.schedStart < nextDecisionTime) {
                nextDecisionTime = ue.schedStart;
            }

            //  Immediates / commands say to do something / schedule gets modified?
            const im = this.immediateItem;
            if (im && im.startTime < nextDecisionTime) {
                nextDecisionTime = im.startTime;
            }
            /*
            const ic = this.interactiveQueue[0];
            if (ic && ic.startTime < nextDecisionTime) {
                nextDecisionTime = ic.startTime;
            }
            */

            // Run advance
            const nextTime = Math.max(nextDecisionTime, this.currentTime);
            if (this.depth && nextTime > this.currentTime) {
                this.#stackTop?.advanceToTime(this.#stackTop, this.depth, nextTime, undefined, undefined, log);
            }
            this.currentTime = nextTime;
            if (log && limit && log.length >= limit) break;
        }

        return this.currentTime; // TODO: We may limit / want to go back?
    }

    stopAll(ct: number, log?: PlaybackLogDetail[]) {
        this.runUntil(ct, undefined, log);
        while (this.#stackTop) {
            const i = this.#stackTop;
            i.stopAtTime(this.depth, this.currentTime, log);
            this.#stackPop();
        }
    }

    pause(ct: number, log?: PlaybackLogDetail[]) {
        this.runUntil(ct, undefined, log);
        if (this.#stackTop) {
            const i = this.#stackTop;
            i.suspendAtTime(this.depth, this.currentTime, log);
        }
    }

    resume(ct: number, log?: PlaybackLogDetail[]) {
        this.currentTime = ct;
        if (this.#stackTop) {
            const i = this.#stackTop;
            i.resumeAtTime(this.depth, ct, log);
        }
    }

    // Dump stack and upcoming
    getStatusSnapshot(): PlaybackStateSnapshot[] {
        const pss: PlaybackStateSnapshot[] = [];
        for (let i = this.stack.length - 1; i >= 0; --i) {
            const s = this.stack[i];
            const spl = s.itemPart;
            const spi = s.itemCursor;
            pss.push({
                scheduleId: s.item.scheduleId,
                itemId: s.item.itemId,
                playlistNumber: spl,
                playlistIds: s.seqIds[spl] ?? [],
                playlistDurations: s.seqDurs[spl] ?? [],
                seqIdx: spi,
                offsetInto: s.offsetInto,
                atTime: s.baseTime + s.offsetInto,
            });
        }
        return pss;
    }

    actionsForItem(
        item: PlaybackItem,
        st: PlaybackStateEntry,
        readahead: number,
        maxItems: number = 10,
    ): PlaybackActions {
        return item.scheduleId
            ? {
                  type: 'scheduled',
                  schedStart: item.schedStart,
                  schedEnd: item.schedEnd,
                  scheduleId: item.scheduleId,
                  actions: st.getUpcomingItems(this.depth, this.currentTime, readahead, maxItems),
              }
            : {
                  type: 'interactive',
                  requestId: item.itemId,
                  startTime: item.schedStart,
                  scheduleId: item.scheduleId,
                  actions: st.getUpcomingItems(this.depth, this.currentTime, readahead, maxItems),
              };
    }

    // Peek aheads for telling player core what to fetch / also what's up next
    getUpcomingItems(readahead: number, schedahead: number, maxItems: number = 10): UpcomingPlaybackActions {
        const upcoming: UpcomingPlaybackActions = {};
        if (this.#stackTop) {
            const item = this.#stackTop.item;
            upcoming.curPLActions = this.actionsForItem(item, this.#stackTop, readahead, maxItems);
        }

        upcoming.stackedPLActions = [];
        for (let i = 0; i < this.stack.length - 1; ++i) {
            const item = this.stack[i].item;
            upcoming.stackedPLActions.push(this.actionsForItem(item, this.stack[i], readahead, maxItems));
        }

        upcoming.heapSchedules = [];
        for (const item of this.heapById.values()) {
            const nst = new PlaybackStateEntry(item, item.itemId);
            nst.initializeToTime(this.depth, this.currentTime, this.currentTime);
            upcoming.heapSchedules.push({
                type: 'scheduled',
                schedStart: item.schedStart,
                schedEnd: item.schedEnd,
                scheduleId: item.scheduleId!,
                actions: nst.getUpcomingItems(this.depth, this.currentTime, readahead, maxItems),
            });
        }

        upcoming.upcomingSchedules = [];
        for (const item of this.upcomingOccurrences) {
            if (item.schedStart >= this.currentTime + schedahead) continue;
            const ha: PlaybackActions = {
                type: 'scheduled',
                schedStart: item.schedStart,
                schedEnd: item.schedEnd,
                scheduleId: item.scheduleId!,
                actions: [],
            };
            if (item.schedStart < this.currentTime + readahead) {
                const nst = new PlaybackStateEntry(item, item.itemId);
                nst.initializeToTime(this.depth, item.schedStart, this.currentTime);
                ha.actions = nst.getUpcomingItems(this.depth, this.currentTime, readahead, maxItems);
            }
            upcoming.upcomingSchedules.push(ha);
        }

        upcoming.interactive = [];
        for (const item of this.interactiveQueue) {
            if (item.startTime >= this.currentTime + schedahead) continue;
            const ha: PlaybackActions = {
                type: 'interactive',
                requestId: item.requestId,
                startTime: item.startTime,
                scheduleId: item.scheduleId,
                playlistId: item.playlistId,
                seqId: item.seqId,
                actions: [],
            };
            if (item.startTime < this.currentTime + readahead) {
                const pbi = new PlaybackItem();
                this.#populatePlaybackInteractiveItem(pbi, item, this.currentTime);
                const nst = new PlaybackStateEntry(pbi, pbi.itemId);
                nst.initializeToTime(this.depth, this.currentTime, this.currentTime);
                ha.actions = nst.getUpcomingItems(this.depth, this.currentTime, readahead, maxItems);
            }
            upcoming.upcomingSchedules.push(ha);
        }

        return upcoming;
    }

    // Interactive cmd to consider?
    addInteractiveCommand(cmd: InteractivePlayCommand) {
        if (cmd.immediate) {
            this.immediateItem = cmd;
        }
        else {
            this.interactiveQueue.push(cmd);
            this.interactiveQueue.sort((a, b) => a.startTime - b.startTime);
        }
    }

    // TODO This should really be at a time
    removeInteractiveCommand(id: string) {
        this.interactiveQueue = this.interactiveQueue.filter((q) => q.requestId !== id);
        if (this.immediateItem?.requestId === id) this.immediateItem = undefined;

        // Search the schedule
        this.upcomingOccurrences = this.upcomingOccurrences.filter((i) => i.itemId !== id);
        const nmap = new Map<string, PlaybackItem>();
        for (const i of this.upcomingOccurrences) {nmap.set(i.itemId, i)}
        this.upcomingById = nmap;

        // Search the stack
        for (let i=0; i<this.stack.length;) {
            if (this.stack[i].itemId === id) {
                this.stack = [...this.stack.slice(0, i), ...this.stack.slice(i+1)];
            }
            else {
                ++i;
            }
        }
        const nsid = new Map<string, PlaybackStateEntry>();
        for (const i of this.stack) nsid.set(i.itemId, i);
        this.stackById = nsid;

        // Search the heap
        if (this.heapById.has(id)) {
            console.log (`Looking in heap!`)
            this.heapById.delete(id);
            const idx = this.heap.findIndex((s)=>s.itemId === id);
            if (idx !== undefined) {
                console.log(`Taken out of heap`);
                this.heap.deleteAt(idx);
            }
        }
    }

    removeInteractiveCommands() {
        // TODO This should really be at a time
        this.immediateItem = undefined;
        this.interactiveQueue = [];
        // TODO clobber the heap and stack items?
    }

    titleForIds(seqId?: string, plId?: string, schedId?: string) {
        if (seqId) {
            const nps = this.sequencesById.get(seqId);
            return `${nps?.work?.title} - ${nps?.work?.artist}${nps?.sequence?.vendor ? ' - ' + nps?.sequence?.vendor : ''}`;
        } else if (plId) {
            const npl = this.playlistsById.get(plId);
            return `${npl?.title ?? 'unknown playlist'}`;
        } else if (schedId) {
            const nsc = this.schedulesById.get(schedId);
            return `${nsc?.title ?? 'unknown sched'}`;
        } else {
            return "<Command>";
        }
    }

    getQueueItems(): PlayingItem[] {
        const items: PlayingItem[] = [];
        const ia = [...(this.immediateItem ? [this.immediateItem]: []), ...this.interactiveQueue];
        for (const q of ia) {
            items.push({
                type: q.immediate ? 'Immediate' : 'Queued',
                item: q.seqId ? 'Song' : (q.playlistId ? 'Playlist' : (q.scheduleId ? 'Schedule' : 'Command')),
                sequence_id: q.seqId,
                playlist_id: q.playlistId,
                schedule_id: q.scheduleId,
                request_id: q.requestId,
                //at: q.startTime,
                //until: q.
                title: this.titleForIds(q.seqId, q.playlistId, q.scheduleId),
            } as PlayingItem);
        }
        for (const s of this.heapById.values()) {
            if (s.itemType === 'Scheduled') continue;
            if (s.scheduleId) {
                items.push({
                    type: s.itemType,
                    item: 'Schedule',
                    schedule_id: s.scheduleId,
                    at: s.schedStart,
                    until: s.schedEnd,
                    request_id: s.requestId,
                    title: this.titleForIds(undefined, undefined, s.scheduleId),
                } as PlayingItem);
            }
            else if (s.playlistIds?.[1]) {
                items.push({
                    type: s.itemType,
                    item: 'Playlist',
                    playlist_id: s.playlistIds?.[1],
                    request_id: s.requestId,
                    title: this.titleForIds(undefined, s.playlistIds?.[1], undefined),
                } as PlayingItem);
            }
            else if (s.mainSectionIds?.[0]) {
                items.push({
                    type: s.itemType,
                    item: 'Song',
                    sequence_id: s.mainSectionIds[0],
                    request_id: s.requestId,
                    title: this.titleForIds(s.mainSectionIds[0], undefined, undefined),
                } as PlayingItem);
            }
        }
        return items.sort((a,b)=>(b.at ?? 0) - (a.at ?? 0));
    }

    getUpcomingSchedules(): PlayingItem[] {
        const items: PlayingItem[] = [];
        for (const s of this.upcomingOccurrences) {
            items.push({
                type: 'Scheduled',
                item: 'Schedule',
                schedule_id: s.scheduleId,
                at: s.schedStart,
                until: s.schedEnd,
                request_id: s.requestId,
                title: this.titleForIds(undefined, undefined, s.scheduleId),
            } as PlayingItem);
        }
        return items;
    }

    getHeapItems(): PlayingItem[] {
        const items: PlayingItem[] = [];
        for (const s of this.heapById.values()) {
            if (s.itemType === 'Queued') continue;
            if (s.scheduleId) {
                items.push({
                    type: 'Scheduled',
                    item: 'Schedule',
                    schedule_id: s.scheduleId,
                    at: s.schedStart,
                    until: s.schedEnd,
                    request_id: s.requestId,
                    title: this.titleForIds(undefined, undefined, s.scheduleId),
                } as PlayingItem);
            }
            else if (s.playlistIds?.[1]) {
                items.push({
                    type: 'Immediate',
                    item: 'Playlist',
                    playlist_id: s.playlistIds?.[1],
                    request_id: s.requestId,
                    title: this.titleForIds(undefined, s.playlistIds?.[1], undefined),
                } as PlayingItem);
            }
            else if (s.mainSectionIds?.[0]) {
                items.push({
                    type: 'Immediate',
                    item: 'Song',
                    sequence_id: s.mainSectionIds[0],
                    request_id: s.requestId,
                    title: this.titleForIds(s.mainSectionIds[0], undefined, undefined),
                } as PlayingItem);
            }
        }
        return items;
    }

    getStackItems(): PlayingItem[] {
        const items: PlayingItem[] = [];
        const stk = this.getStatusSnapshot().slice(1);
        for (const s of stk) {
            items.push({
                type: 'Immediate',
                item: 'Song',
                schedule_id: s.scheduleId,
                sequence_id: s.playlistIds?.[Math.max(s.seqIdx, 0)],
                title: this.titleForIds(s.playlistIds?.[s.seqIdx], undefined, s.scheduleId),
            })
        }
        return items;
    }

    // TODO: Take update to the schedules, playlists, items
}
