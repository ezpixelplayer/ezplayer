import dgram from 'dgram';
import { describe, expect, it } from 'vitest';
import { UdpClient } from './UDP';

/** A loopback port with nothing listening on it. */
async function closedPort(): Promise<number> {
    const s = dgram.createSocket('udp4');
    await new Promise<void>((resolve) => s.bind(0, '127.0.0.1', resolve));
    const port = s.address().port;
    await new Promise<void>((resolve) => s.close(resolve));
    return port;
}

describe('UdpClient', () => {
    it('records socket errors after connect instead of throwing them', async () => {
        const client = new UdpClient('udp4', '127.0.0.1', await closedPort());
        await client.connect();
        try {
            const socket = (client as unknown as { socket: dgram.Socket }).socket;
            expect(() => socket.emit('error', new Error('recvmsg ECONNREFUSED'))).not.toThrow();
            expect(client.getStats()).toMatchObject({ nErrors: 1, lastError: 'recvmsg ECONNREFUSED' });
        } finally {
            await client.disconnect();
        }
    });

    it('survives sending to a port nobody is listening on', async () => {
        const client = new UdpClient('udp4', '127.0.0.1', await closedPort());
        await client.connect();
        try {
            // Linux and macOS deliver the ICMP port-unreachable as a socket error.
            for (let i = 0; i < 3; ++i) {
                await client.send(new Uint8Array(16)).catch(() => 0);
                await new Promise((r) => setTimeout(r, 50));
            }
            expect(client.isConnected()).toBe(true);
            if (process.platform !== 'win32') expect(client.lastError).toMatch(/ECONNREFUSED/);
        } finally {
            await client.disconnect();
        }
    });
});
