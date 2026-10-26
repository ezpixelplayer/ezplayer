/**
 * FPP MultiSync master. Sends the UDP control packets FPP and xSchedule
 * remotes follow: OPEN/START when a sequence begins, periodic SYNC frames,
 * STOP at end/pause/idle. Wire format per FPP src/MultiSync.h (all LE):
 *   ControlPkt { char fppd[4]="FPPD"; u8 pktType; u16 extraDataLen }
 *   SyncPkt    { u8 action; u8 fileType; u32 frameNumber; f32 secondsElapsed;
 *                char filename[] NUL-terminated }
 *
 * Media sync packets (fileType 1) go out alongside the sequence packets, as
 * FPP and xSchedule masters send them: OPEN/START when the audio file begins,
 * a SYNC every ~500 ms carrying the audio playback position as heard on this
 * player (the audio sync adjust folded in, which the sequence packets do not
 * reflect), and STOP when it ends. Remotes without the file ignore them;
 * listeners that play the show audio themselves (phone apps) follow them.
 *
 * Packets describe the frame being output *now*: the playback loop calls
 * `onFrame` at the frame's deadline, not when it starts preparing the frame.
 */

import dgram from 'node:dgram';

const FPP_CTRL_PORT = 32320;
const MULTISYNC_ADDR = '239.70.80.80';
const CTRL_PKT_SYNC = 1;

// FPP's own codes (src/MultiSync.h SYNC_PKT_*), which are not in flow
// order: START is 0, OPEN is 3.
const SYNC_START = 0;
const SYNC_STOP = 1;
const SYNC_SYNC = 2;
const SYNC_OPEN = 3;
const FILE_SEQ = 0;
const FILE_MEDIA = 1;

/** Send every frame early so remotes lock on fast, then back off. Remotes
 *  re-sync on every packet, so the exact cadence is not protocol-critical. */
const EARLY_FRAMES = 3;
const SYNC_EVERY_FRAMES = 16;
/** Media SYNC cadence, by time: audio has no frames. FPP sends about one a
 *  second; half that gives audio-playing listeners a tighter lock. */
export const MEDIA_SYNC_INTERVAL_MS = 500;

interface Remote {
    host: string;
    port: number;
}

/** What is being output at this instant. Either part may be absent: no `seq`
 *  in a lead/trail pad, no `media` when the song has no audio or the audio
 *  has not started (or has ended) relative to the lights. */
export interface SyncFrameInfo {
    seq?: { file: string; frameNumber: number; secondsElapsed: number };
    media?: { file: string; secondsElapsed: number };
}

export interface MultiSyncConfig {
    enabled?: boolean;
    remotes?: string[];
    port?: number;
    multicastAddress?: string;
    /** Send media (audio) sync packets too. Default on. */
    mediaSync?: boolean;
}

export class MultiSyncSender {
    private socket: dgram.Socket | undefined;
    private remotes: Remote[] = [];
    private mediaSync = true;
    private curFile: string | undefined;
    private lastSyncFrame = -1;
    private curMedia: string | undefined;
    private lastMediaSyncAt = -Infinity;

    configure(settings: MultiSyncConfig | undefined): void {
        const enabled = !!settings?.enabled;
        if (!enabled) {
            this.onIdle();
            // The STOPs just queued must reach the wire: close once they have.
            const sock = this.socket;
            this.socket = undefined;
            this.remotes = [];
            if (sock) {
                this.draining = sock;
                this.closeIfDrained();
            }
            return;
        }
        this.mediaSync = settings?.mediaSync !== false;
        if (!this.mediaSync) this.stopMedia();
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
                } catch {
                    /* not fatal without multicast */
                }
            });
            this.socket = sock;
        }
    }

    /** Per-frame hook from the playback loop, called as the frame goes out.
     *  Handles file changes and cadence for both the sequence and its audio.
     *  `now` is a monotonic ms clock (performance.now()), for the media cadence. */
    onFrame(info: SyncFrameInfo, now: number = performance.now()): void {
        if (!this.socket) return;
        const seq = info.seq;
        if (!seq) {
            this.stopSeq();
        } else {
            if (seq.file !== this.curFile) {
                this.stopSeq();
                this.curFile = seq.file;
                this.lastSyncFrame = -1;
                this.send(SYNC_OPEN, FILE_SEQ, 0, 0, seq.file);
                this.send(SYNC_START, FILE_SEQ, seq.frameNumber, seq.secondsElapsed, seq.file);
            }
            if (seq.frameNumber <= EARLY_FRAMES || seq.frameNumber - this.lastSyncFrame >= SYNC_EVERY_FRAMES) {
                this.lastSyncFrame = seq.frameNumber;
                this.send(SYNC_SYNC, FILE_SEQ, seq.frameNumber, seq.secondsElapsed, seq.file);
            }
        }

        const media = this.mediaSync ? info.media : undefined;
        if (!media) {
            this.stopMedia();
            return;
        }
        if (media.file !== this.curMedia) {
            this.stopMedia();
            this.curMedia = media.file;
            // FPP puts no frame number on media packets.
            this.send(SYNC_OPEN, FILE_MEDIA, 0, 0, media.file);
            this.send(SYNC_START, FILE_MEDIA, 0, media.secondsElapsed, media.file);
            this.lastMediaSyncAt = now;
        } else if (now - this.lastMediaSyncAt >= MEDIA_SYNC_INTERVAL_MS) {
            this.lastMediaSyncAt = now;
            this.send(SYNC_SYNC, FILE_MEDIA, 0, media.secondsElapsed, media.file);
        }
    }

    /** Idle/pause/stop hook — closes out the current sequence and audio, if any. */
    onIdle(): void {
        this.stopSeq();
        this.stopMedia();
    }

    private stopSeq(): void {
        if (this.socket && this.curFile) {
            this.send(SYNC_STOP, FILE_SEQ, 0, 0, this.curFile);
        }
        this.curFile = undefined;
        this.lastSyncFrame = -1;
    }

    private stopMedia(): void {
        if (this.socket && this.curMedia) {
            this.send(SYNC_STOP, FILE_MEDIA, 0, 0, this.curMedia);
        }
        this.curMedia = undefined;
        this.lastMediaSyncAt = -Infinity;
    }

    private send(
        action: number,
        fileType: number,
        frameNumber: number,
        secondsElapsed: number,
        fileName: string,
    ): void {
        const name = Buffer.from(fileName, 'utf8');
        const payload = Buffer.alloc(10 + name.length + 1);
        payload[0] = action;
        payload[1] = fileType;
        payload.writeUInt32LE(frameNumber >>> 0, 2);
        payload.writeFloatLE(secondsElapsed, 6);
        name.copy(payload, 10);
        const hdr = Buffer.alloc(7);
        hdr.write('FPPD', 0, 'latin1');
        hdr[4] = CTRL_PKT_SYNC;
        hdr.writeUInt16LE(payload.length, 5);
        const pkt = Buffer.concat([hdr, payload]);
        for (const r of this.remotes) {
            ++this.pendingSends;
            this.socket!.send(pkt, r.port, r.host, () => {
                --this.pendingSends;
                this.closeIfDrained();
            });
        }
    }

    private pendingSends = 0;
    private draining: dgram.Socket | undefined;

    private closeIfDrained(): void {
        if (!this.draining || this.pendingSends > 0) return;
        const sock = this.draining;
        this.draining = undefined;
        try {
            sock.close();
        } catch {
            /* already closed */
        }
    }
}
