export const DEFAULT_JUKEBOX_EXCLUDED_TAGS = ['nojukebox'] as const;

export function normalizeTag(tag: string): string {
    return tag.trim().toLowerCase();
}

export function normalizeTagList(tags: string[] | undefined | null, fallback: string[] = []): string[] {
    if (!tags || tags.length === 0) return fallback;
    const normalized = tags.map(normalizeTag).filter(Boolean);
    return Array.from(new Set(normalized));
}

export function songMatchesAnyTag(songTags: string[] | undefined, matchTags: string[]): boolean {
    if (!songTags || songTags.length === 0) return false;
    const songTagSet = new Set(songTags.map(normalizeTag));
    return matchTags.some((t) => songTagSet.has(normalizeTag(t)));
}

export function isSongAllowedForJukebox(args: {
    songTags: string[] | undefined;
    excludedTags: string[] | undefined;
    includedTags: string[] | undefined;
}): boolean {
    // Always enforce 'nojukebox' exclusion (even if user adds/removes other tags).
    const excluded = Array.from(
        new Set([...DEFAULT_JUKEBOX_EXCLUDED_TAGS, ...normalizeTagList(args.excludedTags, [])]),
    );
    const included = normalizeTagList(args.includedTags, []);

    if (songMatchesAnyTag(args.songTags, excluded)) return false;
    if (included.length === 0) return true;
    return songMatchesAnyTag(args.songTags, included);
}
