import { describe, expect, it } from 'vitest';

import { errorDetail } from './errorDetail.js';

function withCode(msg: string, code: string): Error {
    return Object.assign(new Error(msg), { code });
}

describe('errorDetail', () => {
    it('returns the plain message when there is no cause', () => {
        expect(errorDetail(new Error('boom'))).toBe('boom');
    });

    it('stringifies non-Error values', () => {
        expect(errorDetail('nope')).toBe('nope');
    });

    it('includes a TLS cause code and message', () => {
        const e = new TypeError('fetch failed', {
            cause: withCode('self-signed certificate in certificate chain', 'SELF_SIGNED_CERT_IN_CHAIN'),
        });
        expect(errorDetail(e)).toBe(
            'fetch failed: SELF_SIGNED_CERT_IN_CHAIN self-signed certificate in certificate chain',
        );
    });

    it('does not repeat a code already in the message', () => {
        const e = new TypeError('fetch failed', {
            cause: withCode('getaddrinfo ENOTFOUND api.example.com', 'ENOTFOUND'),
        });
        expect(errorDetail(e)).toBe('fetch failed: getaddrinfo ENOTFOUND api.example.com');
    });

    it('expands an empty-message AggregateError cause', () => {
        const agg = Object.assign(
            new AggregateError(
                [new Error('connect ECONNREFUSED ::1:443'), new Error('connect ECONNREFUSED 127.0.0.1:443')],
                '',
            ),
            { code: 'ECONNREFUSED' },
        );
        const e = new TypeError('fetch failed', { cause: agg });
        expect(errorDetail(e)).toBe('fetch failed: connect ECONNREFUSED ::1:443; connect ECONNREFUSED 127.0.0.1:443');
    });

    it('follows nested causes', () => {
        const e = new Error('outer', { cause: new Error('middle', { cause: withCode('inner', 'EX') }) });
        expect(errorDetail(e)).toBe('outer: middle: EX inner');
    });
});
