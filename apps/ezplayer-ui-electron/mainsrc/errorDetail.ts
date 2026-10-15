/**
 * Error text for logs / status fields that keeps the `cause` chain.
 * Node's fetch throws a bare "fetch failed" and hides the real reason
 * (SELF_SIGNED_CERT_IN_CHAIN, ENOTFOUND, ECONNREFUSED, ...) in `cause`, so
 * `err.message` alone can't tell a TLS-intercepting proxy from a DNS or
 * firewall problem. Non-fetch errors come out as their plain message.
 */
export function errorDetail(e: unknown): string {
    if (!(e instanceof Error)) return String(e);
    const parts = [e.message];
    let c: unknown = e.cause;
    for (let depth = 0; c !== undefined && c !== null && depth < 4; depth++) {
        parts.push(describeCause(c));
        c = c instanceof Error ? c.cause : undefined;
    }
    return parts.filter(Boolean).join(': ');
}

function describeCause(c: unknown): string {
    if (!(c instanceof Error)) return String(c);
    const code = (c as { code?: unknown }).code;
    let msg = c.message;
    // Dual-stack connect failures arrive as an AggregateError with an empty message.
    if (!msg && c instanceof AggregateError) {
        msg = c.errors
            .map((x) => (x instanceof Error ? x.message : String(x)))
            .filter(Boolean)
            .join('; ');
    }
    if (typeof code === 'string' && code && !msg.includes(code)) return msg ? `${code} ${msg}` : code;
    return msg;
}
