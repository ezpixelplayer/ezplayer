import { SequenceRecord, PlaylistRecord, ScheduledPlaylist } from '../types/DataTypes';

// Note this code is temporary and will

export function mergePlaylists(ourRecs: PlaylistRecord[], serverRec: PlaylistRecord[]) {
    const newlist: PlaylistRecord[] = [];
    for (const r of ourRecs) {
        if (!serverRec.find((sr) => sr.id == r.id)) {
            newlist.push(r);
        }
    }
    for (const sr of serverRec) {
        const r = ourRecs.find((r) => r.id == sr.id);
        if (!r || !r.updatedAt || (sr.updatedAt && r.updatedAt < sr.updatedAt)) {
            newlist.push(sr);
        } else {
            newlist.push(r);
        }
    }
    return newlist;
}

export function mergeSequences(ourRecs: SequenceRecord[], serverRec: SequenceRecord[]) {
    const newlist: SequenceRecord[] = [];
    for (const r of ourRecs) {
        if (!serverRec.find((sr) => sr.id == r.id)) {
            newlist.push(r);
        }
    }
    for (const sr of serverRec) {
        const r = ourRecs.find((r) => r.id == sr.id);
        if (!r || !r.updatedAt || (sr.updatedAt && r.updatedAt < sr.updatedAt)) {
            newlist.push(sr);
        } else {
            newlist.push(r);
        }
    }
    return newlist;
}

export function mergeSchedule(ourRecs: ScheduledPlaylist[], serverRec: ScheduledPlaylist[]) {
    const newlist: ScheduledPlaylist[] = [];
    for (const r of ourRecs) {
        if (!serverRec.find((sr) => sr.id == r.id)) {
            newlist.push(r);
        }
    }
    for (const sr of serverRec) {
        const r = ourRecs.find((r) => r.id == sr.id);
        if (!r || !r.updatedAt || (sr.updatedAt && r.updatedAt < sr.updatedAt)) {
            newlist.push(sr);
        } else {
            newlist.push(r);
        }
    }
    return newlist;
}
