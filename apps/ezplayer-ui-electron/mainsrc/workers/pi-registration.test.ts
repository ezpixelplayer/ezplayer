import { describe, expect, it } from 'vitest';
import { playerRegistrationUrl } from '../../src/components/piRegistration';

describe('phone registration handoff', () => {
    it('uses the existing registration route and the original player ID', () => {
        expect(playerRegistrationUrl('https://api.ezplayer.dev/', 'existing-player-id')).toBe(
            'https://api.ezplayer.dev/enduser/registerplayer/existing-player-id',
        );
    });
    it('encodes IDs and preserves configured cloud base paths', () => {
        expect(playerRegistrationUrl('https://cloud.example/base', 'a/b?c')).toBe(
            'https://cloud.example/base/enduser/registerplayer/a%2Fb%3Fc',
        );
    });
    it('rejects missing registration configuration and insecure cloud URLs', () => {
        expect(() => playerRegistrationUrl('', 'id')).toThrow();
        expect(() => playerRegistrationUrl('https://api.ezplayer.dev/', '')).toThrow();
        expect(() => playerRegistrationUrl('http://cloud.example/', 'id')).toThrow();
    });
});
