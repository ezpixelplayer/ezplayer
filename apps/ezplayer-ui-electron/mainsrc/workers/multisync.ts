/**
 * FPP MultiSync master. Sends the UDP control packets FPP and xSchedule
 * remotes follow: OPEN/START when a sequence begins, periodic SYNC frames,
 * STOP at end/pause/idle. Wire format per FPP src/MultiSync.h (all LE):
 *   ControlPkt { char fppd[4]="FPPD"; u8 pktType; u16 extraDataLen }
 *   SyncPkt    { u8 action; u8 fileType; u32 frameNumber; f32 secondsElapsed;
 *                char filename[] NUL-terminated }
 * Media sync packets are not sent — audio plays on the master.
 */

import dgram from 'node:dgram';

const FPP_CTRL_PORT = 32320;
const MULTISYNC_ADDR = '239.70.80.80';
const CTRL_PKT_SYNC = 1;

const SYNC_OPEN = 0;
const SYNC_START = 1;
const SYNC_STOP = 2;
const SYNC_SYNC = 3;
const FILE_SEQ = 0;

/** Send every frame early so remotes lock on fast, then back off. Remotes
 *  re-sync on every packet, so the exact cadence is not protocol-critical. */
const EARLY_FRAMES = 3;
const SYNC_EVERY_FRAMES = 16;

interface Remote {
    host: string;
    port: number;
}

export class MultiSyncSender {
    private socket: dgram.Socket | undefined;
    private remotes: Remote[] = [];
    private curFile: string | undefined;
    private lastSyncFrame = -1;

    configure(
        settings:
            | { enabled?: boolean; remotes?: string[]; port?: number; multicastAddress?: string }
            | undefined,
    ): void {
        const enabled = !!settings?.enabled;
        if (!enabled) {
            this.stopFile();
            if (this.socket) {
                try {
                    this.socket.close();
                } catch {}
                this.socket = undefined;
            }
            this.remotes = [];
            return;
        }
        const defaultPort = settings?.port ?? FPP_CTRL_PORT;
        const listed = (settings?.remotes ?? [])
            .map((r) => r.trim())
            .filter((r) => r.length > 0)
            .map((r): Remote => {
                const m = r.match(/^(.*?)(?::(\d+))?$/)!;
                return { host: m[1], port: m[2] ? Number(m[2]) : defaultPort };
            });
        this.remotes =
            listed.length > 0 ? listed : [{ host: settings?.multicastAddress || MULTISYNC_ADDR, port: defaultPort }];
        if (!this.socket) {
            const sock = dgram.createSocket('udp4');
            sock.on('error', (err) => console.error('[multisync] socket error:', err.message));
            sock.bind(0, () => {
                try {
                    sock.setMulticastTTL(1);
                } catch {}
            });
            this.socket = sock;
        }
    }

    /** Per-frame hook from the playback loop. Handles file changes and cadence. */
    onFrame(fileName: string, frameNumber: number, secondsElapsed: number): void {
        if (!this.socket) return;
        if (fileName !== this.curFile) {
            this.stopFile();
            this.curFile = fileName;
            this.lastSyncFrame = -1;
            this.send(SYNC_OPEN, 0, 0, fileName);
            this.send(SYNC_START, frameNumber, secondsElapsed, fileName);
        }
        if (frameNumber <= EARLY_FRAMES || frameNumber - this.lastSyncFrame >= SYNC_EVERY_FRAMES) {
            this.lastSyncFrame = frameNumber;
            this.send(SYNC_SYNC, frameNumber, secondsElapsed, fileName);
        }
    }

    /** Idle/pause/stop hook — closes out the current file, if any. */
    onIdle(): void {
        this.stopFile();
    }

    private stopFile(): void {
        if (this.socket && this.curFile) {
            this.send(SYNC_STOP, 0, 0, this.curFile);
        }
        this.curFile = undefined;
        this.lastSyncFrame = -1;
    }

    private send(action: number, frameNumber: number, secondsElapsed: number, fileName: string): void {
        const name = Buffer.from(fileName, 'utf8');
        const payload = Buffer.alloc(10 + name.length + 1);
        payload[0] = action;
        payload[1] = FILE_SEQ;
        payload.writeUInt32LE(frameNumber >>> 0, 2);
        payload.writeFloatLE(secondsElapsed, 6);
        name.copy(payload, 10);
        const hdr = Buffer.alloc(7);
        hdr.write('FPPD', 0, 'latin1');
        hdr[4] = CTRL_PKT_SYNC;
        hdr.writeUInt16LE(payload.length, 5);
        const pkt = Buffer.concat([hdr, payload]);
        for (const r of this.remotes) {
            this.socket!.send(pkt, r.port, r.host, () => {});
        }
    }
}
