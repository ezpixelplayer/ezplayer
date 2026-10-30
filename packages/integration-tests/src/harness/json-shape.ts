/**
 * Key names and JSON types of a payload, recursively: what a client parsing
 * it depends on. Arrays are described by their first element. Used to compare
 * EZPlayer's FPP-compat responses with a real FPP's.
 */
export function jsonShape(v: unknown): unknown {
    if (v === null) return 'null';
    if (Array.isArray(v)) return v.length ? [jsonShape(v[0])] : [];
    if (typeof v === 'object') {
        return Object.fromEntries(
            Object.keys(v as object)
                .sort()
                .map((k) => [k, jsonShape((v as Record<string, unknown>)[k])]),
        );
    }
    return typeof v;
}

/**
 * Paths where `ours` falls short of `theirs`: a field FPP sends that we lack
 * or type differently. Extra fields of ours are fine, and so is a `null` from
 * FPP. Arrays are compared by their first element.
 */
export function shapeGaps(ours: unknown, theirs: unknown, at = '$'): string[] {
    const t = jsonShape(theirs);
    const o = jsonShape(ours);
    const walk = (a: unknown, b: unknown, path: string): string[] => {
        if (b === 'null') return [];
        if (typeof b === 'string' || typeof a === 'string') {
            return a === b ? [] : [`${path}: FPP sends ${JSON.stringify(b)}, EZPlayer ${JSON.stringify(a)}`];
        }
        if (Array.isArray(b)) {
            if (!Array.isArray(a)) return [`${path}: FPP sends an array, EZPlayer ${JSON.stringify(a)}`];
            return b.length && a.length ? walk(a[0], b[0], `${path}[0]`) : [];
        }
        const out: string[] = [];
        for (const [k, v] of Object.entries(b as Record<string, unknown>)) {
            if (!(k in (a as Record<string, unknown>))) out.push(`${path}.${k}: missing`);
            else out.push(...walk((a as Record<string, unknown>)[k], v, `${path}.${k}`));
        }
        return out;
    };
    return walk(o, t, at);
}
