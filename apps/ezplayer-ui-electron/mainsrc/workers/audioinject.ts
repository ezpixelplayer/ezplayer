/**
 * Audio injection in the playback worker: owns the bus engine, takes commands
 * from the HTTP API and stream packets from UDP, and hands finished chunks of
 * the pushed buses to the outputs.
 */

import dgram from 'node:dgram';
import { resolveAudioBuses, upsertAudioBus, type PlaybackSettings } from '@ezplayer/ezplayer-core';
import { AudioBusEngine, decodeAudioPacket, type BusChunk } from './audiobus';
import type { AudioCommand, AudioResult } from './audiotypes';

/** How often pushed buses are serviced while a lease is open. */
const PUMP_INTERVAL_MS = 5;
const SWEEP_INTERVAL_MS = 1000;

export interface AudioInjectOptions {
    /** How far ahead of the clock the show audio is published. */
    mainLeadMs: number;
    /** The player clock, ms. */
    now: () => number;
    /** A chunk of a pushed bus is due at the outputs. `gain` is the bus volume, 0-1. */
    emit: (chunk: BusChunk, gain: number) => void;
    log: (level: 'info' | 'warn', msg: string) => void;
}

export class AudioInject {
    readonly engine: AudioBusEngine;
    private settings: Pick<PlaybackSettings, 'audioBuses'> | undefined;
    private timer?: NodeJS.Timeout;
    private lastSweep = 0;
    private socket?: dgram.Socket;
    private port = 0;
    private wantPort = 0;
    /** A port that could not be opened; not tried again until the setting changes. */
    private failedPort = 0;
    private volumes = new Map<string, number>();

    constructor(private readonly opts: AudioInjectOptions) {
        this.engine = new AudioBusEngine(opts.mainLeadMs);
        this.configure(undefined, 0);
    }

    /** Apply the buses in settings and the speaker trim. */
    configure(settings: Pick<PlaybackSettings, 'audioBuses'> | undefined, adjustMs: number): void {
        this.settings = settings;
        const buses = resolveAudioBuses(settings);
        this.engine.configure(buses);
        this.engine.setTimeAdjust(adjustMs);
        this.volumes = new Map(buses.map((b) => [b.name, b.volume / 100]));
    }

    /** Receive stream packets on `port`; reopens when the port changes. */
    listen(port: number): void {
        if (port === this.wantPort && (this.socket || this.failedPort === port)) return;
        this.wantPort = port;
        this.failedPort = 0;
        this.closeSocket();
        if (!port) return;
        const sock = dgram.createSocket({ type: 'udp4', reuseAddr: true });
        sock.on('error', (e) => {
            this.opts.log('warn', `[audio] UDP receiver on port ${port} failed: ${e.message}`);
            if (this.socket === sock) {
                this.closeSocket();
                this.failedPort = port;
            }
        });
        sock.on('message', (buf) => {
            const p = decodeAudioPacket(buf);
            if (!p) return;
            try {
                this.engine.stream(p.id, p.token, p.data, p.playAt || undefined, p.seq, this.opts.now());
                this.pump();
            } catch {
                /* a stray or stale packet */
            }
        });
        sock.bind(port, () => {
            this.port = port;
            this.opts.log('info', `[audio] receiving stream packets on UDP ${port}`);
        });
        this.socket = sock;
    }

    private closeSocket(): void {
        try {
            this.socket?.close();
        } catch {
            /* already closed */
        }
        this.socket = undefined;
        this.port = 0;
    }

    close(): void {
        this.closeSocket();
        if (this.timer) clearInterval(this.timer);
        this.timer = undefined;
    }

    /** Send on whatever the pushed buses owe; drop expired leases now and then. */
    pump(): void {
        const now = this.opts.now();
        for (const chunk of this.engine.pump(now)) this.opts.emit(chunk, this.volumes.get(chunk.bus) ?? 1);
        if (now - this.lastSweep >= SWEEP_INTERVAL_MS) {
            this.lastSweep = now;
            for (const id of this.engine.sweep(now)) this.opts.log('info', `[audio] lease ${id} expired`);
            if (this.timer && this.engine.list(now).length === 0) {
                clearInterval(this.timer);
                this.timer = undefined;
            }
        }
    }

    command(cmd: AudioCommand): AudioResult {
        const now = this.opts.now();
        const e = this.engine;
        try {
            switch (cmd.op) {
                case 'buses':
                    return { ok: true, now, buses: e.busStatus(now), udpPort: this.port };
                case 'list':
                    return { ok: true, now, leases: e.list(now) };
                case 'open': {
                    // A bus registered with this call is in force before its settings arrive.
                    if (cmd.newBus) this.configure(upsertAudioBus(this.settings ?? {}, cmd.newBus), e.timeAdjust);
                    const lease = e.open(cmd.request, now);
                    this.timer ??= setInterval(() => this.pump(), PUMP_INTERVAL_MS);
                    this.opts.log(
                        'info',
                        `[audio] lease ${lease.id} opened on ${lease.bus}${lease.name ? ` (${lease.name})` : ''}`,
                    );
                    return { ok: true, now, lease, udpPort: this.port };
                }
                case 'close':
                    e.close(cmd.id, cmd.token || undefined, now);
                    this.opts.log('info', `[audio] lease ${cmd.id} closed`);
                    return { ok: true, now };
                case 'keepalive':
                    return { ok: true, now, lease: e.keepalive(cmd.id, cmd.token, now), udpPort: this.port };
                case 'gain':
                    return { ok: true, now, lease: e.setGain(cmd.id, cmd.token, cmd.gain, now), udpPort: this.port };
                case 'stream': {
                    const stream = e.stream(cmd.id, cmd.token, cmd.data, cmd.at, cmd.seq, now);
                    this.pump();
                    return { ok: true, now, stream };
                }
                case 'clip':
                    return { ok: true, now, clip: e.addClip(cmd.id, cmd.token, cmd.name, cmd.data, now) };
                case 'unclip':
                    e.removeClip(cmd.id, cmd.token, cmd.name, now);
                    return { ok: true, now };
                case 'play': {
                    const play = e.play(cmd.id, cmd.token, cmd.request, now);
                    this.pump();
                    return { ok: true, now, play };
                }
                case 'stop': {
                    const stopped = e.stop(cmd.id, cmd.token, cmd.voice, cmd.fadeMs, now);
                    this.pump();
                    return { ok: true, now, stopped };
                }
            }
        } catch (err) {
            return { ok: false, error: (err as Error).message };
        }
        return { ok: false, error: 'unknown op' };
    }
}
