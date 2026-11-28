import { describe, expect, it } from 'vitest';
import { inputAccepts, inputShapeOf } from './appInputs';

describe('show input shapes', () => {
    it('classifies what a post carries', () => {
        expect(inputShapeOf(undefined)).toBe('none');
        expect(inputShapeOf('')).toBe('none');
        expect(inputShapeOf(true)).toBe('boolean');
        expect(inputShapeOf(0.5)).toBe('number');
        expect(inputShapeOf('1')).toBe('text');
        expect(inputShapeOf({ x: 1, yaw: 0 })).toBe('object');
        expect(inputShapeOf([1, 2])).toBe('object');
    });

    it('offers a sender only to inputs that take what it sends', () => {
        // A button: GET with no value, or a 1.
        expect(inputAccepts('event', 'none')).toBe(true);
        expect(inputAccepts('event', 'number')).toBe(true);
        expect(inputAccepts('event', 'object')).toBe(false);
        expect(inputAccepts('event', 'text')).toBe(false);
        // A level or a switch, also as a GET's text.
        expect(inputAccepts('value', 'number')).toBe(true);
        expect(inputAccepts('value', 'boolean')).toBe(true);
        expect(inputAccepts('value', 'text', '0.75')).toBe(true);
        expect(inputAccepts('value', 'text', 'off')).toBe(true);
        expect(inputAccepts('value', 'text', 'hello')).toBe(false);
        expect(inputAccepts('value', 'none')).toBe(false);
        expect(inputAccepts('value', 'object')).toBe(false);
        // Text takes anything printable.
        expect(inputAccepts('text', 'text')).toBe(true);
        expect(inputAccepts('text', 'number')).toBe(true);
        expect(inputAccepts('text', 'none')).toBe(false);
        expect(inputAccepts('text', 'object')).toBe(false);
        // A pose.
        expect(inputAccepts('object', 'object')).toBe(true);
        expect(inputAccepts('object', 'number')).toBe(false);
    });
});
