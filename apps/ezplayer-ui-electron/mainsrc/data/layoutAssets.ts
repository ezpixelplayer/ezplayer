import * as fsp from 'fs/promises';
import * as path from 'path';

/**
 * Attribute names in xLights XML that carry filesystem references we need to bundle
 * with a layout upload. Conservative set; expand as we discover more.
 *
 * Case-insensitive: the regex below uses /i so `ObjFile` and `objFile` both match.
 */
const REF_ATTRS = [
    'objFile', // mesh OBJ for view_objects (DisplayAs="Mesh"); xLights writes `ObjFile`
    'imageFile', // texture / image for view_objects (DisplayAs="Image" or Mesh-with-texture)
    'previewBackgroundFile', // 2D / 3D preview background
    'backgroundImage', // alternate background reference name
    'Image', // image-model and submodel face references — `Image="Images\foo.png"`
    'Picture', // legacy picture-effect ref
    'EyesOpen', // face-matrix state image (open eyes)
    'EyesClosed', // face-matrix state image (closed eyes)
] as const;

/**
 * Walk an XML body for our known reference attributes. Returns the raw string
 * values, normalized (forward slashes, trimmed), de-duplicated. Empty strings,
 * URLs (http/https/file), and `..`-traversal paths are dropped.
 */
export function extractAssetRefs(xmlText: string): string[] {
    const seen = new Set<string>();
    for (const attr of REF_ATTRS) {
        const re = new RegExp(`\\b${attr}\\s*=\\s*("([^"]*)"|'([^']*)')`, 'gi');
        let m: RegExpExecArray | null;
        while ((m = re.exec(xmlText)) !== null) {
            const raw = (m[2] ?? m[3] ?? '').trim();
            if (!raw) continue;
            if (/^[a-z]+:\/\//i.test(raw)) continue; // http://, https://, file:// — out of scope
            if (raw.split(/[/\\]/).some((seg) => seg === '..')) continue;
            seen.add(raw.replace(/\\/g, '/'));
        }
    }
    return Array.from(seen);
}

/**
 * Resolve a raw reference (which may be relative to the show folder, or absolute
 * pointing somewhere inside it) to a forward-slashed path relative to the show
 * folder. Returns `null` for refs that escape the folder or are unresolvable
 * directly. Does NOT do basename rebasing — see `resolveRefWithIndex` for that.
 */
export function refToShowFolderRelative(ref: string, showFolder: string): string | null {
    const norm = ref.replace(/\\/g, '/');
    if (path.isAbsolute(norm)) {
        const rel = path.relative(showFolder, norm);
        if (!rel || rel.startsWith('..') || path.isAbsolute(rel)) return null;
        return rel.replace(/\\/g, '/');
    }
    return norm;
}

/** A basename → list of show-folder-relative paths. Lets us locate files referenced
 *  by a stale absolute path from another machine, when a same-named file exists
 *  somewhere in the local show folder. */
export type BasenameIndex = Map<string, string[]>;

/** Walk the show folder and index every file by its lowercased basename. Skips
 *  `.ezplayer/` (our internal staging area) and any other dotted directories. */
export async function buildBasenameIndex(showFolder: string): Promise<BasenameIndex> {
    const index: BasenameIndex = new Map();
    async function walk(dir: string): Promise<void> {
        let entries: { name: string; isFile(): boolean; isDirectory(): boolean }[];
        try {
            entries = await fsp.readdir(dir, { withFileTypes: true });
        } catch {
            return;
        }
        for (const e of entries) {
            if (e.name.startsWith('.')) continue; // .ezplayer, .git, etc.
            const full = path.join(dir, e.name);
            if (e.isDirectory()) {
                await walk(full);
            } else if (e.isFile()) {
                const base = e.name.toLowerCase();
                const rel = path.relative(showFolder, full).replace(/\\/g, '/');
                const arr = index.get(base) ?? [];
                arr.push(rel);
                index.set(base, arr);
            }
        }
    }
    await walk(showFolder);
    return index;
}

/** Pick the best candidate path from the basename index for a given raw ref.
 *  Used when the absolute path doesn't exist in our show folder (common: XML
 *  written on another machine). Strategy: longest matching path suffix wins;
 *  shallowest tie-breaker. */
function chooseFromIndex(ref: string, index: BasenameIndex): string | null {
    const norm = ref.replace(/\\/g, '/');
    const base = path.posix.basename(norm).toLowerCase();
    const candidates = index.get(base);
    if (!candidates || candidates.length === 0) return null;
    if (candidates.length === 1) return candidates[0];

    const refLower = norm.toLowerCase();
    let best = candidates[0];
    let bestSuffixLen = 0;
    let bestDepth = best.split('/').length;
    for (const c of candidates) {
        const cLower = c.toLowerCase();
        let i = 1;
        while (
            i <= cLower.length &&
            i <= refLower.length &&
            cLower[cLower.length - i] === refLower[refLower.length - i]
        ) {
            i++;
        }
        const matchLen = i - 1;
        const depth = c.split('/').length;
        if (matchLen > bestSuffixLen || (matchLen === bestSuffixLen && depth < bestDepth)) {
            best = c;
            bestSuffixLen = matchLen;
            bestDepth = depth;
        }
    }
    return best;
}

/** Resolve a raw ref to a show-folder-relative path. First tries the direct path
 *  (file at the literal location, in-folder absolute, or in-folder relative).
 *  Falls back to basename lookup in the index — this handles the very common case
 *  where xLights XML carries an absolute path from another machine. */
async function resolveRef(
    ref: string,
    showFolder: string,
    index: BasenameIndex,
): Promise<string | null> {
    const direct = refToShowFolderRelative(ref, showFolder);
    if (direct) {
        try {
            const st = await fsp.stat(path.join(showFolder, direct));
            if (st.isFile()) return direct;
        } catch {
            /* fall through to basename rebase */
        }
    }
    return chooseFromIndex(ref, index);
}

/** OBJ files reference companion `.mtl` materials via `mtllib` directives. The MTL
 *  in turn references texture images via `map_Kd` / `map_Ka` / `map_Ks` / `map_d`
 *  / `map_Bump` / `bump` / `disp` / `decal`. This walks the chain so a mesh
 *  referenced from XML brings its full visual setup with it. */
const MTL_TEXTURE_DIRECTIVES = ['map_Kd', 'map_Ka', 'map_Ks', 'map_Ns', 'map_d', 'map_Bump', 'bump', 'disp', 'decal'];

async function expandObjMtlChain(
    showFolder: string,
    initial: Set<string>,
    index: BasenameIndex,
): Promise<void> {
    const objRels = Array.from(initial).filter((r) => r.toLowerCase().endsWith('.obj'));

    for (const objRel of objRels) {
        let objText: string;
        try {
            objText = await fsp.readFile(path.join(showFolder, objRel), 'utf-8');
        } catch {
            continue;
        }
        const objDir = path.posix.dirname(objRel);

        const mtlRefs: string[] = [];
        const mtlRe = /^\s*mtllib\s+(.+?)\s*$/gim;
        let mm: RegExpExecArray | null;
        while ((mm = mtlRe.exec(objText)) !== null) {
            // mtllib can list multiple files separated by whitespace
            for (const item of mm[1].split(/\s+/).filter(Boolean)) {
                mtlRefs.push(item);
            }
        }

        for (const mtlRef of mtlRefs) {
            const mtlNorm = mtlRef.replace(/\\/g, '/');
            // Try directory-relative first, then index fallback
            const tryRel = path.isAbsolute(mtlNorm) ? null : path.posix.join(objDir, mtlNorm);
            let mtlRel: string | null = null;
            if (tryRel) {
                try {
                    const st = await fsp.stat(path.join(showFolder, tryRel));
                    if (st.isFile()) mtlRel = tryRel;
                } catch {
                    /* fall through */
                }
            }
            if (!mtlRel) mtlRel = chooseFromIndex(mtlRef, index);
            if (!mtlRel || initial.has(mtlRel)) continue;

            initial.add(mtlRel);

            // Parse the MTL for texture directives
            let mtlText: string;
            try {
                mtlText = await fsp.readFile(path.join(showFolder, mtlRel), 'utf-8');
            } catch {
                continue;
            }
            const mtlDir = path.posix.dirname(mtlRel);

            const directiveRe = new RegExp(
                `^\\s*(${MTL_TEXTURE_DIRECTIVES.join('|')})\\b\\s+(.+?)\\s*$`,
                'gim',
            );
            let tm: RegExpExecArray | null;
            while ((tm = directiveRe.exec(mtlText)) !== null) {
                // The argument may include MTL options (e.g. `-clamp on tex.png`).
                // Take the last whitespace-separated token as the filename.
                const tokens = tm[2].split(/\s+/).filter(Boolean);
                const texRef = tokens[tokens.length - 1];
                if (!texRef) continue;
                const texNorm = texRef.replace(/\\/g, '/');
                const tryTex = path.isAbsolute(texNorm) ? null : path.posix.join(mtlDir, texNorm);
                let texRel: string | null = null;
                if (tryTex) {
                    try {
                        const st = await fsp.stat(path.join(showFolder, tryTex));
                        if (st.isFile()) texRel = tryTex;
                    } catch {
                        /* fall through */
                    }
                }
                if (!texRel) texRel = chooseFromIndex(texRef, index);
                if (texRel) initial.add(texRel);
            }
        }
    }
}

/**
 * Scan one or more XML files in the show folder, collect all referenced asset paths,
 * and return only those that resolve to existing files inside the show folder. When
 * the XML carries a stale absolute path (very common — xLights writes machine-local
 * paths and the show folder may have moved), we fall back to basename matching
 * against an index of the show folder. Includes the OBJ→MTL→texture chain so
 * meshes bring their materials and textures along.
 */
export async function collectReferencedAssets(
    showFolder: string,
    xmlAbsPaths: string[],
): Promise<string[]> {
    const index = await buildBasenameIndex(showFolder);
    const result = new Set<string>();

    for (const xmlPath of xmlAbsPaths) {
        let text: string;
        try {
            text = await fsp.readFile(xmlPath, 'utf-8');
        } catch {
            continue;
        }
        for (const ref of extractAssetRefs(text)) {
            const rel = await resolveRef(ref, showFolder, index);
            if (rel) result.add(rel);
        }
    }

    await expandObjMtlChain(showFolder, result, index);

    return Array.from(result).sort();
}
