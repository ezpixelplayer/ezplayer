import tls from 'node:tls';

/**
 * Merge the OS certificate store into Node's default CA set (runtime `--use-system-ca`).
 * Node's TLS ignores the OS store by default, so an OS-trusted proxy/self-signed root that
 * the browser accepts still fails Node-side cloud calls with "self signed certificate in
 * chain". No verification is disabled. Per-Node-environment, so call once at the top of
 * each thread doing outbound TLS. Feature-detected (APIs are Node ≥ 22.15); on older
 * runtimes it no-ops and NODE_EXTRA_CA_CERTS / NODE_TLS_REJECT_UNAUTHORIZED remain fallbacks.
 */
let applied = false;

export function trustSystemCAs(): void {
    if (applied) return;
    applied = true;

    try {
        const t = tls as unknown as {
            getCACertificates?: (type: 'default' | 'system' | 'bundled' | 'extra') => string[];
            setDefaultCACertificates?: (certs: ReadonlyArray<string>) => void;
        };
        if (typeof t.getCACertificates !== 'function' || typeof t.setDefaultCACertificates !== 'function') return;

        const system = t.getCACertificates('system') ?? [];
        if (system.length === 0) return;

        const current = t.getCACertificates('default') ?? [];
        t.setDefaultCACertificates(Array.from(new Set([...current, ...system])));
    } catch {
        /* env-var fallbacks cover anything this couldn't */
    }
}
