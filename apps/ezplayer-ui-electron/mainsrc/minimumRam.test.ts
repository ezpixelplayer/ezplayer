import { describe, expect, it } from 'vitest';
import { hasMinimumRam, insufficientRamMessage } from './minimumRam';

describe('hasMinimumRam', () => {
    it('accepts a 2 GB board after firmware and GPU reservations', () => {
        expect(hasMinimumRam(1.9e9)).toBe(true);
        expect(hasMinimumRam(1.5e9)).toBe(true);
    });
    it('refuses a 1 GB board', () => {
        expect(hasMinimumRam(0.95e9)).toBe(false);
    });
});

describe('insufficientRamMessage', () => {
    it('states the requirement and what the system reports', () => {
        expect(insufficientRamMessage(0.95e9)).toBe('EZPlayer needs at least 2 GB of RAM; this system reports 0.9 GB.');
    });
});
