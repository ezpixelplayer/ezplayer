/** Just the fields `isSequencePlayable` reads — a structural subset of
 *  `SequenceRecord` so callers with leaner local types (e.g. `SequenceItem`
 *  inside `JukeboxScreen`) don't need a cast at every call site. */
export interface PlayableSequenceFields {
    deleted?: boolean;
    render_enabled?: boolean;
    files?: { fseq?: string };
}

/** Single source of truth for "is this sequence offerable to the user as a
 *  playable song." All UI surfaces (jukebox, playlist builder, song list,
 *  schedule baker) MUST use this — every condition added here updates them
 *  all at once.
 *
 *  Conditions, in order of cheapness:
 *  - not soft-deleted
 *  - render_enabled !== false (cloud-side master toggle, mirrored on the record)
 *  - has a real fseq file path (i.e. render has produced a playable artifact). */
export function isSequencePlayable(s: PlayableSequenceFields): boolean {
    if (s.deleted) return false;
    if (s.render_enabled === false) return false;
    if (!s.files?.fseq) return false;
    return true;
}
