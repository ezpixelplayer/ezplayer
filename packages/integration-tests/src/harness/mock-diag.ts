/**
 * Stand-in for the cloud's crash-report endpoint (POST /api/diag/crashreport).
 * Records every attempt, including ones it answers with a failure status.
 */

import http from 'node:http';
import type net from 'node:net';

export interface DiagReport {
    kind: string;
    message: string;
    stack?: string;
    /** JSON text, as the app sends it. */
    extra?: string;
    appVersion: string;
    /** Status this attempt was answered with. */
    answered: number;
}

export interface MockDiag {
    url: string;
    reports: DiagReport[];
    /** Status for the next attempts; 200 by default. */
    status: number;
    waitFor(kind: string, messageIncludes?: string, timeoutMs?: number): Promise<DiagReport>;
    close(): Promise<void>;
}

export async function startMockDiag(): Promise<MockDiag> {
    const reports: DiagReport[] = [];
    const mock = { status: 200 } as MockDiag;
    const server = http.createServer((req, res) => {
        let body = '';
        req.on('data', (c: Buffer) => (body += c.toString('utf8')));
        req.on('end', () => {
            if (req.method === 'POST' && req.url === '/api/diag/crashreport') {
                try {
                    reports.push({ ...(JSON.parse(body) as DiagReport), answered: mock.status });
                } catch {
                    /* malformed: recorded as nothing */
                }
                res.writeHead(mock.status).end();
            } else {
                res.writeHead(404).end();
            }
        });
    });
    await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
    const port = (server.address() as net.AddressInfo).port;

    mock.url = `http://127.0.0.1:${port}/`;
    mock.reports = reports;
    mock.waitFor = async (kind, messageIncludes = '', timeoutMs = 30_000) => {
        const deadline = Date.now() + timeoutMs;
        for (;;) {
            const hit = reports.find((r) => r.kind === kind && r.message.includes(messageIncludes));
            if (hit) return hit;
            if (Date.now() > deadline) {
                const seen = reports.map((r) => `${r.kind}: ${r.message}`).join('; ') || 'none';
                throw new Error(`no ${kind} report containing "${messageIncludes}" in ${timeoutMs} ms (seen: ${seen})`);
            }
            await new Promise((r) => setTimeout(r, 200));
        }
    };
    mock.close = () =>
        new Promise<void>((r) => {
            server.close(() => r());
            server.closeAllConnections();
        });
    return mock;
}
