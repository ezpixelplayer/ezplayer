/**
 * Comparing our FPP-compat payloads with a real FPP's (test helper; see
 * __fixtures__/fpp-10.1). Only the structure is compared — key names and
 * JSON types — since times, ids and counts naturally differ.
 */

/** Key names and JSON types, recursively; arrays by their first element. */
export function shape(v: unknown): unknown {
    if (v === null) return 'null';
    if (Array.isArray(v)) return v.length ? [shape(v[0])] : [];
    if (typeof v === 'object') {
        return Object.fromEntries(
            Object.keys(v as object)
                .sort()
                .map((k) => [k, shape((v as Record<string, unknown>)[k])]),
        );
    }
    return typeof v;
}

/**
 * Fields FPP sends that ours lacks or types differently. Extra fields of ours
 * are fine — clients ignore what they don't read — and so is a `null` from FPP.
 */
export function gaps(ours: unknown, theirs: unknown): string[] {
    const walk = (a: unknown, b: unknown, path: string): string[] => {
        if (b === 'null') return [];
        if (typeof b === 'string' || typeof a === 'string')
            return a === b ? [] : [`${path}: FPP ${String(b)} vs EZPlayer ${JSON.stringify(a)}`];
        if (Array.isArray(b)) {
            if (!Array.isArray(a)) return [`${path}: FPP array vs EZPlayer ${JSON.stringify(a)}`];
            return b.length && a.length ? walk(a[0], b[0], `${path}[0]`) : [];
        }
        return Object.entries(b as Record<string, unknown>).flatMap(([k, v]) =>
            k in (a as Record<string, unknown>)
                ? walk((a as Record<string, unknown>)[k], v, `${path}.${k}`)
                : [`${path}.${k}: missing`],
        );
    };
    return walk(shape(ours), shape(theirs), '$');
}
