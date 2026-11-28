/**
 * Show inputs: what a post carries, and which declared input kinds can take it. The Apps card
 * uses this to offer a sender only to inputs that fit, and the player to label what it heard.
 */

import type { AppInputDecl, AppInputShape } from '../types/DataTypes';

/** The shape of a posted value. A GET's `?value=` is text even when it looks like a number. */
export function inputShapeOf(value: unknown): AppInputShape {
    if (value === undefined || value === null || value === '') return 'none';
    if (typeof value === 'boolean') return 'boolean';
    if (typeof value === 'number') return 'number';
    if (typeof value === 'string') return 'text';
    return 'object';
}

const NUMERIC = /^\s*[-+]?(\d+\.?\d*|\.\d+)([eE][-+]?\d+)?\s*$/;
const ONOFF = /^\s*(true|false|on|off|0|1)\s*$/i;

/**
 * Whether an input of `kind` can take a post of `shape`. A press needs no value and ignores a
 * flag or a number; a level takes a number or an on/off, also as text; text takes anything
 * printable; an object only an object. `lastValue` lets numeric or on/off text count as such.
 */
export function inputAccepts(kind: AppInputDecl['kind'], shape: AppInputShape, lastValue?: string): boolean {
    switch (kind) {
        case 'event':
            return shape !== 'object' && shape !== 'text';
        case 'value':
            if (shape === 'number' || shape === 'boolean') return true;
            return shape === 'text' && lastValue !== undefined && (NUMERIC.test(lastValue) || ONOFF.test(lastValue));
        case 'text':
            return shape === 'text' || shape === 'number' || shape === 'boolean';
        case 'object':
            return shape === 'object';
        default:
            return true;
    }
}
