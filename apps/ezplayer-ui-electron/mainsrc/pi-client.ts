import net from 'node:net';

/** Local bridge only. Browser exposure is restricted separately by pi-api.ts. */
export function requestPi(request: Record<string, unknown>): Promise<unknown> {
    const payload = JSON.stringify(request);
    if (Buffer.byteLength(payload) > 16384) return Promise.reject(new Error('Request too large.'));
    return new Promise((resolve, reject) => {
        const socket = net.createConnection('/run/ezplayer-pi/control.sock');
        let response = '';
        const fail = (error: Error) => {
            socket.destroy();
            reject(error);
        };
        socket.setTimeout(60000, () => fail(new Error('Pi settings service timed out.')));
        socket.on('error', () => fail(new Error('Pi service unavailable. Check installation and restart the Pi.')));
        socket.on('connect', () => socket.write(payload + '\n'));
        socket.on('data', (chunk) => {
            response += chunk.toString();
            if (Buffer.byteLength(response) > 262144) return fail(new Error('Pi service response too large.'));
            if (!response.includes('\n')) return;
            try {
                const result = JSON.parse(response.split('\n')[0]);
                socket.destroy();
                if (result.ok) resolve(result.data);
                else reject(new Error(result.error || 'Pi operation failed.'));
            } catch {
                fail(new Error('Invalid Pi service response.'));
            }
        });
        socket.on('end', () => {
            if (!response.includes('\n')) fail(new Error('Pi service closed unexpectedly.'));
        });
    });
}
