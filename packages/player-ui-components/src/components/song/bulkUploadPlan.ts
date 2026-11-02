/** Reconciles a browser selection against what the player already has, before
 *  any bytes move. Mirrors the server's exact-name audio match: the header's
 *  file, then its stem with any audio extension, then the FSEQ's own stem. */

export type StagedKind = 'fseq' | 'audio' | 'image' | 'other';

export interface StagedFile {
    name: string;
    size: number;
    kind: StagedKind;
    /** Audio name from the FSEQ header; undefined for animations, null when the header could not be read. */
    headerAudio?: string | null;
}

export interface PlayerFiles {
    /** Show folder listings by directory name. */
    sequences: string[];
    music: string[];
    /** Media folder audio; usable by imports but never written to. */
    media: string[];
}

export type AudioSource = 'selection' | 'player' | 'media';

export type FseqOutcome = 'add' | 'animation' | 'alreadyImported' | 'missingAudio' | 'unreadable';

export interface FseqPlan {
    name: string;
    outcome: FseqOutcome;
    audio?: { name: string; source: AudioSource };
    /** The audio name the header asks for, when the outcome is missingAudio. */
    wanted?: string;
    existsOnPlayer: boolean;
    upload: boolean;
}

export interface CompanionPlan {
    name: string;
    kind: 'audio' | 'image';
    /** FSEQs in this selection that use the file. */
    claimedBy: string[];
    existsOnPlayer: boolean;
    upload: boolean;
}

export interface BulkUploadPlan {
    fseqs: FseqPlan[];
    companions: CompanionPlan[];
    ignored: { name: string; reason: string }[];
    /** Names to send, in manifest order. */
    uploadNames: string[];
    /** FSEQs to add as songs once the files are on the player. */
    importFseqNames: string[];
    /** Audio the server may use for these imports (selection plus matched player files). */
    companionAudioNames: string[];
    /** Files written now but not attached to a song. */
    stored: { name: string; reason: string }[];
}

export const FSEQ_EXTENSIONS = ['.fseq'];
export const AUDIO_EXTENSIONS = ['.mp3', '.wav', '.m4a', '.aac', '.flac', '.ogg', '.wma', '.mp4'];
export const IMAGE_EXTENSIONS = ['.jpg', '.jpeg', '.png', '.gif', '.webp', '.bmp'];

export function extensionOf(name: string): string {
    const dot = name.lastIndexOf('.');
    return dot >= 0 ? name.slice(dot).toLowerCase() : '';
}

export function stemOf(name: string): string {
    const dot = name.lastIndexOf('.');
    return (dot >= 0 ? name.slice(0, dot) : name).toLowerCase();
}

export function kindOf(name: string): StagedKind {
    const ext = extensionOf(name);
    if (FSEQ_EXTENSIONS.includes(ext)) return 'fseq';
    if (AUDIO_EXTENSIONS.includes(ext)) return 'audio';
    if (IMAGE_EXTENSIONS.includes(ext)) return 'image';
    return 'other';
}

/** Case-insensitive lookup by full name and by stem, keeping the first spelling seen. */
class NameIndex {
    private byName = new Map<string, string>();
    private byStem = new Map<string, string>();
    constructor(names: Iterable<string>, filter: (name: string) => boolean = () => true) {
        for (const name of names) {
            if (!filter(name)) continue;
            const lower = name.toLowerCase();
            if (!this.byName.has(lower)) this.byName.set(lower, name);
            const stem = stemOf(name);
            if (!this.byStem.has(stem)) this.byStem.set(stem, name);
        }
    }
    exact(name: string): string | undefined {
        return this.byName.get(name.toLowerCase());
    }
    stem(stem: string): string | undefined {
        return this.byStem.get(stem.toLowerCase());
    }
    has(name: string): boolean {
        return this.byName.has(name.toLowerCase());
    }
}

function findAudio(
    wantedName: string | undefined,
    fseqStem: string,
    sources: { source: AudioSource; index: NameIndex }[],
): { name: string; source: AudioSource } | undefined {
    if (wantedName) {
        for (const { source, index } of sources) {
            const hit = index.exact(wantedName);
            if (hit) return { name: hit, source };
        }
        const wantedStem = stemOf(wantedName);
        for (const { source, index } of sources) {
            const hit = index.stem(wantedStem);
            if (hit) return { name: hit, source };
        }
    }
    for (const { source, index } of sources) {
        const hit = index.stem(fseqStem);
        if (hit) return { name: hit, source };
    }
    return undefined;
}

export function planBulkUpload(
    staged: StagedFile[],
    player: PlayerFiles,
    catalogFseqNames: Iterable<string>,
    overwrite: boolean,
): BulkUploadPlan {
    const isAudio = (n: string) => kindOf(n) === 'audio';
    const selectionAudio = new NameIndex(
        staged.filter((f) => f.kind === 'audio').map((f) => f.name),
        isAudio,
    );
    const playerAudio = new NameIndex(player.music, isAudio);
    const mediaAudio = new NameIndex(player.media, isAudio);
    const onPlayer = new NameIndex([...player.sequences, ...player.music]);
    const catalog = new NameIndex(catalogFseqNames);
    const sources = [
        { source: 'selection' as const, index: selectionAudio },
        { source: 'player' as const, index: playerAudio },
        { source: 'media' as const, index: mediaAudio },
    ];

    const uploadable = (name: string) => overwrite || !onPlayer.has(name);
    const claims = new Map<string, string[]>();
    const claim = (fileName: string, fseqName: string) => {
        const key = fileName.toLowerCase();
        claims.set(key, [...(claims.get(key) ?? []), fseqName]);
    };

    const fseqs: FseqPlan[] = [];
    for (const f of staged) {
        if (f.kind !== 'fseq') continue;
        const existsOnPlayer = onPlayer.has(f.name);
        const base = { name: f.name, existsOnPlayer, upload: uploadable(f.name) };
        if (catalog.has(f.name)) {
            fseqs.push({ ...base, outcome: 'alreadyImported' });
            continue;
        }
        if (f.headerAudio === null) {
            fseqs.push({ ...base, outcome: 'unreadable' });
            continue;
        }
        // Headers written on Windows carry a full path; only the file name can match.
        const wanted = f.headerAudio ? f.headerAudio.replace(/\\/g, '/').split('/').pop() : undefined;
        const audio = findAudio(wanted, stemOf(f.name), sources);
        if (audio) {
            if (audio.source === 'selection') claim(audio.name, f.name);
            fseqs.push({ ...base, outcome: 'add', audio });
        } else if (wanted) {
            fseqs.push({ ...base, outcome: 'missingAudio', wanted });
        } else {
            fseqs.push({ ...base, outcome: 'animation' });
        }
    }

    const fseqStems = new NameIndex(staged.filter((f) => f.kind === 'fseq').map((f) => f.name));
    const companions: CompanionPlan[] = [];
    const ignored: { name: string; reason: string }[] = [];
    for (const f of staged) {
        if (f.kind === 'fseq') continue;
        if (f.kind === 'other') {
            ignored.push({ name: f.name, reason: 'Not a sequence, audio, or image file' });
            continue;
        }
        let claimedBy = claims.get(f.name.toLowerCase()) ?? [];
        if (f.kind === 'image') {
            // Artwork is matched by stem to a sequence or its audio, as the server does.
            const stem = stemOf(f.name);
            const owner = fseqStems.stem(stem);
            const viaAudio = fseqs.filter((p) => p.audio && stemOf(p.audio.name) === stem).map((p) => p.name);
            claimedBy = owner ? [owner] : viaAudio;
        }
        companions.push({
            name: f.name,
            kind: f.kind,
            claimedBy,
            existsOnPlayer: onPlayer.has(f.name),
            upload: uploadable(f.name),
        });
    }

    const uploadNames = [
        ...companions.filter((c) => c.upload).map((c) => c.name),
        ...fseqs.filter((p) => p.upload && p.outcome !== 'unreadable').map((p) => p.name),
    ];
    const importFseqNames = fseqs.filter((p) => p.outcome === 'add' || p.outcome === 'animation').map((p) => p.name);
    const companionAudioNames = [
        ...new Set(fseqs.filter((p) => p.audio && p.audio.source !== 'media').map((p) => p.audio!.name)),
    ];
    const stored: { name: string; reason: string }[] = [];
    for (const p of fseqs) {
        if (p.outcome === 'missingAudio' && p.upload) stored.push({ name: p.name, reason: `Needs ${p.wanted}` });
    }
    for (const c of companions) {
        if (c.upload && !c.claimedBy.length) {
            stored.push({
                name: c.name,
                reason: c.kind === 'audio' ? 'No sequence in this upload uses it' : 'Artwork',
            });
        }
    }
    return { fseqs, companions, ignored, uploadNames, importFseqNames, companionAudioNames, stored };
}
