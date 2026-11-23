/*
 * What the Show Status card says about virtual matrix outputs: each configured
 * output matched to whoever is reading it, then readers nobody configured.
 */

import type { VirtualMatrixOutput, VirtualMatrixReader } from '@ezplayer/ezplayer-core';

export type MatrixRowState = 'showing' | 'slow' | 'idle' | 'unread' | 'off';

export interface MatrixRow {
    key: string;
    model: string;
    /** How it is shown, or where the viewer is. */
    where: string;
    state: MatrixRowState;
    detail: string;
}

/** A reader this far behind the frames being made is called slow. */
const SLOW_BELOW = 0.9;
/** A reader silent this long is not reading. */
const READING_WITHIN_MS = 5000;

const fps = (n: number) => (Math.round(n * 10) / 10).toString();

/** The slowest reader decides how a row with several readers is doing. */
function rate(readers: VirtualMatrixReader[]): { state: MatrixRowState; detail: string } {
    const made = Math.max(...readers.map((r) => r.sourceFps));
    if (made <= 0) return { state: 'idle', detail: 'No frames are being made' };
    const shown = Math.min(...readers.map((r) => r.paintedFps ?? r.servedFps));
    const painted = readers.every((r) => r.paintedFps !== undefined);
    return {
        state: shown < made * SLOW_BELOW ? 'slow' : 'showing',
        detail: `${fps(shown)} of ${fps(made)} fps ${painted ? 'shown' : 'sent'}`,
    };
}

export function matrixRows(outputs: VirtualMatrixOutput[], readers: VirtualMatrixReader[]): MatrixRow[] {
    const live = readers.filter((r) => r.idleMs < READING_WITHIN_MS);
    const claimed = new Set<VirtualMatrixReader>();
    const rows: MatrixRow[] = [];

    for (const o of outputs) {
        if (!o.model) continue;
        const mode = o.mode ?? 'fullscreen';
        if (mode === 'url') {
            // A link has no window of its own: anyone reading the model without one is its audience.
            const mine = live.filter((r) => !r.output && r.model === o.model && !claimed.has(r));
            mine.forEach((r) => claimed.add(r));
            const viewers = mine.length === 1 ? '1 viewer' : `${mine.length} viewers`;
            rows.push({
                key: o.id,
                model: o.model,
                where: 'Link',
                ...(mine.length
                    ? { ...rate(mine), detail: `${viewers}, ${rate(mine).detail}` }
                    : { state: 'unread' as const, detail: 'Nobody is reading it' }),
            });
            continue;
        }
        const where = mode === 'window' ? 'Floating window' : 'Full screen';
        const mine = live.filter((r) => r.output === o.id);
        mine.forEach((r) => claimed.add(r));
        if (!o.enabled) rows.push({ key: o.id, model: o.model, where, state: 'off', detail: '' });
        else if (!mine.length) rows.push({ key: o.id, model: o.model, where, state: 'unread', detail: 'Not showing' });
        else rows.push({ key: o.id, model: o.model, where, ...rate(mine) });
    }

    live.filter((r) => !claimed.has(r)).forEach((r, i) =>
        rows.push({
            key: `reader-${i}-${r.model}-${r.address}`,
            model: r.model,
            where: r.address === 'local' ? 'Viewer on this computer' : `Viewer at ${r.address}`,
            ...rate([r]),
        }),
    );
    return rows;
}
