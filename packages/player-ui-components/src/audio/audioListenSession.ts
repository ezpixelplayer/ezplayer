/**
 * One live-audio listening session: WebSocket in, synced Web Audio out.
 *
 * Shared by every browser listener (LAN jukebox / preview, cloud ezpui, the
 * public viewer page). Lives outside React so re-renders and remounts can't
 * yank the audio: components look a session up by URL and subscribe to its
 * status. Handles the things phones do to a page:
 *
 *   - reconnects the socket (with backoff) while the listener wants audio;
 *   - resumes the AudioContext when the OS suspends/interrupts it;
 *   - keeps a looping silent <audio> element playing with Media Session
 *     metadata, so iOS/Android treat the tab as active media and keep it
 *     alive when the screen locks (and show a lock-screen pause button);
 *   - holds a screen wake lock while listening, where supported;
 *   - re-syncs the clock and re-anchors the schedule after a wake-up.
 */

import { parseAudioWireFrame } from '@ezplayer/ezplayer-core';

import { ChunkDecoder } from './chunkDecoder';
import { RealTimeChunkPlayer, type ChunkPlaybackEvent } from './chunkScheduler';
import {
    CLOCK_REFRESH_INTERVAL_MS,
    applyHttpClockOffset,
    createClockOffsetRef,
    estimateClockOffset,
    refineClockOffset,
    resetClockWindow,
    type ClockOffsetRef,
} from './clockSync';

export type AudioListenStatus = 'idle' | 'connecting' | 'listening' | 'reconnecting' | 'error';

export interface AudioListenOptions {
    /** Binary audio stream WebSocket URL. */
    wsUrl: string;
    /** HTTP endpoint answering `{ now }` in the PLAYER's clock, reached over
     *  the same path as the audio so the round trip measures the right thing. */
    timeUrl: string;
    /** Media Session title (lock screen). */
    title?: string;
}

export interface AudioListenDiagnostics {
    status: AudioListenStatus;
    offsetValue: number;
    offsetEstimate: number;
    chunkSamples: number;
    chunksReceived: number;
    chunksDropped: number;
    chunksTrimmed: number;
    /** Chained schedule abandoned for the ideal start (audible as a chop). */
    chunksSnapped: number;
    /** Applied clock offset re-snapped. */
    offsetSnaps: number;
    /** Where the wall↔AudioContext mapping comes from. */
    mapping?: 'outputTimestamp' | 'currentTime';
    /** Smallest observed step of `performance.now()` in ms (100 under Firefox
     *  resistFingerprinting; ~0.1 or less normally). */
    timerPrecisionMs?: number;
    decodeErrors: number;
    reconnects: number;
    httpAttempts: number;
    httpRtt?: number;
    lastHttpSample?: number;
    lastChunk?: ChunkPlaybackEvent;
    contextState?: AudioContextState;
    outputLatencyMs?: number;
    wakeLock: boolean;
    updatedAt: number;
}

const RECONNECT_MIN_MS = 1_000;
const RECONNECT_MAX_MS = 30_000;
/** No chunk for this long while listening → status shows reconnecting-ish silence. */
const PLAYING_HOLD_MS = 2_000;

export class AudioListenSession {
    private opts: AudioListenOptions;
    private wanted = false;
    private ws?: WebSocket;
    private player?: RealTimeChunkPlayer;
    private decoder?: ChunkDecoder;
    private offsetRef: ClockOffsetRef = createClockOffsetRef();
    private clockTimer?: ReturnType<typeof setInterval>;
    private clockAbort?: AbortController;
    private reconnectTimer?: ReturnType<typeof setTimeout>;
    private reconnectDelay = RECONNECT_MIN_MS;
    private currentStatus: AudioListenStatus = 'idle';
    private listeners = new Set<(s: AudioListenStatus) => void>();
    private keepalive?: HTMLAudioElement;
    private wakeLock?: WakeLockSentinel;
    private lastChunkAt = 0;
    private listenersAttached = false;

    // diagnostics
    private chunksReceived = 0;
    private chunksDropped = 0;
    private chunksTrimmed = 0;
    private chunksSnapped = 0;
    private lastSnapLogAt = 0;
    private timerPrecisionMs?: number;
    private reconnects = 0;
    private httpAttempts = 0;
    private lastChunk?: ChunkPlaybackEvent;

    constructor(opts: AudioListenOptions) {
        this.opts = opts;
    }

    get status(): AudioListenStatus {
        return this.currentStatus;
    }

    /** Listening and chunks are actually arriving. */
    get isPlaying(): boolean {
        return this.currentStatus === 'listening' && Date.now() - this.lastChunkAt < PLAYING_HOLD_MS;
    }

    get active(): boolean {
        return this.wanted;
    }

    get options(): AudioListenOptions {
        return this.opts;
    }

    /** Update the time endpoint / title without restarting. A changed wsUrl
     *  is a different session — callers key sessions by it. */
    updateOptions(opts: AudioListenOptions): void {
        this.opts = opts;
    }

    subscribe(cb: (s: AudioListenStatus) => void): () => void {
        this.listeners.add(cb);
        cb(this.currentStatus);
        return () => {
            this.listeners.delete(cb);
        };
    }

    getDiagnostics(): AudioListenDiagnostics {
        const ctx = this.player?.context;
        return {
            status: this.currentStatus,
            offsetValue: this.offsetRef.value,
            offsetEstimate: this.offsetRef.estimate,
            chunkSamples: this.offsetRef.chunkCandidates.length,
            chunksReceived: this.chunksReceived,
            chunksDropped: this.chunksDropped,
            chunksTrimmed: this.chunksTrimmed,
            chunksSnapped: this.chunksSnapped,
            offsetSnaps: this.offsetRef.snaps ?? 0,
            mapping: this.player?.mapping,
            timerPrecisionMs: this.timerPrecisionMs,
            decodeErrors: this.decoder?.decodeErrors ?? 0,
            reconnects: this.reconnects,
            httpAttempts: this.httpAttempts,
            httpRtt: this.offsetRef.httpRtt,
            lastHttpSample: this.offsetRef.httpSample,
            lastChunk: this.lastChunk,
            contextState: ctx?.state,
            outputLatencyMs: ctx ? Math.round((ctx.outputLatency || 0) * 1000) : undefined,
            wakeLock: !!this.wakeLock && !this.wakeLock.released,
            updatedAt: Date.now(),
        };
    }

    /** Must be called from a user gesture the first time (autoplay policy). */
    start(): void {
        if (this.wanted) {
            void this.player?.resume();
            return;
        }
        this.wanted = true;
        this.offsetRef = createClockOffsetRef();
        this.chunksReceived = 0;
        this.chunksDropped = 0;
        this.chunksTrimmed = 0;
        this.chunksSnapped = 0;
        this.timerPrecisionMs = measureTimerPrecision();
        this.reconnects = 0;
        this.httpAttempts = 0;
        this.lastChunk = undefined;
        this.reconnectDelay = RECONNECT_MIN_MS;

        this.player = new RealTimeChunkPlayer(this.offsetRef, (ev) => {
            this.lastChunk = ev;
            if (ev.dropped) this.chunksDropped++;
            else if (ev.trimmedMs > 0) this.chunksTrimmed++;
            if (ev.snapped) {
                this.chunksSnapped++;
                // Breadcrumb for the LAN pages, which have no debug overlay.
                const now = Date.now();
                if (now - this.lastSnapLogAt > 1000) {
                    this.lastSnapLogAt = now;
                    console.debug(
                        `[audio] schedule snap: deviation ${ev.deviationMs.toFixed(0)} ms, offset ${ev.offsetValue.toFixed(0)} ms, mapping ${ev.mapping}, timer precision ${this.timerPrecisionMs ?? '?'} ms`,
                    );
                }
            }
        });
        void this.player.resume();
        this.player.context.onstatechange = () => {
            if (!this.wanted || !this.player) return;
            const state = this.player.context.state as string;
            if (state === 'suspended' || state === 'interrupted') void this.player.resume();
        };
        this.decoder = new ChunkDecoder();
        void this.decoder.init();

        this.startKeepalive();
        this.attachPageListeners();
        void this.requestWakeLock();

        this.setStatus('connecting');
        void this.syncClock();
        this.clockTimer = setInterval(() => void this.syncClock(), CLOCK_REFRESH_INTERVAL_MS);
        this.connect();
    }

    stop(): void {
        if (!this.wanted && this.currentStatus === 'idle') return;
        this.wanted = false;
        this.clearReconnect();
        this.closeSocket();
        if (this.clockTimer) clearInterval(this.clockTimer);
        this.clockTimer = undefined;
        this.clockAbort?.abort();
        this.clockAbort = undefined;
        this.player?.close();
        this.player = undefined;
        this.decoder?.free();
        this.decoder = undefined;
        this.stopKeepalive();
        this.releaseWakeLock();
        this.detachPageListeners();
        this.setStatus('idle');
    }

    toggle(): void {
        if (this.wanted) this.stop();
        else this.start();
    }

    // -- transport ------------------------------------------------------------

    private connect(): void {
        if (!this.wanted) return;
        this.clearReconnect();
        let ws: WebSocket;
        try {
            ws = new WebSocket(this.opts.wsUrl);
        } catch (err) {
            console.warn('[audio] dial failed:', err);
            this.scheduleReconnect();
            return;
        }
        ws.binaryType = 'arraybuffer';
        this.ws = ws;
        ws.onopen = () => {
            if (this.ws !== ws) return;
            this.reconnectDelay = RECONNECT_MIN_MS;
            this.setStatus('listening');
        };
        ws.onmessage = (ev) => {
            if (this.ws !== ws || !(ev.data instanceof ArrayBuffer)) return;
            this.onFrame(ev.data);
        };
        ws.onerror = () => {
            /* close follows */
        };
        ws.onclose = () => {
            if (this.ws !== ws) return;
            this.ws = undefined;
            if (this.wanted) this.scheduleReconnect();
        };
    }

    private closeSocket(): void {
        const ws = this.ws;
        this.ws = undefined;
        if (!ws) return;
        ws.onclose = null;
        ws.onmessage = null;
        try {
            ws.close();
        } catch {
            /* ignore */
        }
    }

    private scheduleReconnect(immediate = false): void {
        if (!this.wanted) return;
        this.clearReconnect();
        this.setStatus('reconnecting');
        const delay = immediate ? 0 : this.reconnectDelay * (0.75 + Math.random() * 0.5);
        this.reconnectDelay = Math.min(this.reconnectDelay * 2, RECONNECT_MAX_MS);
        this.reconnectTimer = setTimeout(() => {
            this.reconnectTimer = undefined;
            this.reconnects++;
            this.player?.reanchor();
            resetClockWindow(this.offsetRef);
            void this.syncClock();
            this.connect();
        }, delay);
    }

    private clearReconnect(): void {
        if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
        this.reconnectTimer = undefined;
    }

    private onFrame(data: ArrayBuffer): void {
        const frame = parseAudioWireFrame(data);
        if (!frame) return;
        this.chunksReceived++;
        this.lastChunkAt = Date.now();
        refineClockOffset(this.offsetRef, frame.serverNow);
        const chunk = this.decoder?.decode(frame);
        if (!chunk) return;
        this.player?.handleChunk(chunk);
    }

    // -- clock ---------------------------------------------------------------

    private async syncClock(): Promise<void> {
        if (!this.wanted) return;
        this.clockAbort?.abort();
        const abort = new AbortController();
        this.clockAbort = abort;
        this.httpAttempts++;
        const sample = await estimateClockOffset(this.opts.timeUrl, abort.signal);
        if (abort.signal.aborted || !this.wanted || !sample) return;
        applyHttpClockOffset(this.offsetRef, sample);
    }

    // -- page lifecycle --------------------------------------------------------

    private readonly onVisibility = (): void => {
        if (!this.wanted || document.visibilityState !== 'visible') return;
        void this.player?.resume();
        void this.requestWakeLock();
        // A backgrounded phone usually froze the socket; don't wait out the backoff.
        if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
            this.reconnectDelay = RECONNECT_MIN_MS;
            this.closeSocket();
            this.scheduleReconnect(true);
        } else {
            this.player?.reanchor();
            resetClockWindow(this.offsetRef);
            void this.syncClock();
        }
    };

    private readonly onOnline = (): void => {
        if (!this.wanted) return;
        if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
            this.reconnectDelay = RECONNECT_MIN_MS;
            this.closeSocket();
            this.scheduleReconnect(true);
        }
    };

    private attachPageListeners(): void {
        if (this.listenersAttached || typeof document === 'undefined') return;
        document.addEventListener('visibilitychange', this.onVisibility);
        window.addEventListener('pageshow', this.onVisibility);
        window.addEventListener('online', this.onOnline);
        this.listenersAttached = true;
    }

    private detachPageListeners(): void {
        if (!this.listenersAttached) return;
        document.removeEventListener('visibilitychange', this.onVisibility);
        window.removeEventListener('pageshow', this.onVisibility);
        window.removeEventListener('online', this.onOnline);
        this.listenersAttached = false;
    }

    private async requestWakeLock(): Promise<void> {
        if (!this.wanted || typeof navigator === 'undefined' || !('wakeLock' in navigator)) return;
        if (typeof document !== 'undefined' && document.visibilityState !== 'visible') return;
        if (this.wakeLock && !this.wakeLock.released) return;
        try {
            this.wakeLock = await navigator.wakeLock.request('screen');
            this.wakeLock.addEventListener('release', () => {
                if (this.wakeLock?.released) this.wakeLock = undefined;
            });
        } catch {
            /* denied (low battery, not visible) — audio still runs */
        }
    }

    private releaseWakeLock(): void {
        const wl = this.wakeLock;
        this.wakeLock = undefined;
        void wl?.release().catch(() => undefined);
    }

    // -- media session keepalive ----------------------------------------------

    private startKeepalive(): void {
        if (typeof document === 'undefined') return;
        try {
            const el = document.createElement('audio');
            el.src = silentWavDataUri();
            el.loop = true;
            el.preload = 'auto';
            el.setAttribute('playsinline', '');
            el.volume = 0.01;
            this.keepalive = el;
            void el.play().catch(() => undefined);
        } catch {
            /* no keepalive; audio still runs while the page is awake */
        }
        if ('mediaSession' in navigator) {
            try {
                navigator.mediaSession.metadata = new MediaMetadata({
                    title: this.opts.title ?? 'Live show audio',
                    artist: 'EZPlayer',
                });
                navigator.mediaSession.playbackState = 'playing';
                navigator.mediaSession.setActionHandler('pause', () => this.stop());
                navigator.mediaSession.setActionHandler('stop', () => this.stop());
                navigator.mediaSession.setActionHandler('play', () => this.start());
            } catch {
                /* ignore */
            }
        }
    }

    private stopKeepalive(): void {
        const el = this.keepalive;
        this.keepalive = undefined;
        if (el) {
            try {
                el.pause();
                el.removeAttribute('src');
                el.load();
            } catch {
                /* ignore */
            }
        }
        if ('mediaSession' in navigator) {
            try {
                navigator.mediaSession.playbackState = 'paused';
            } catch {
                /* ignore */
            }
        }
    }

    private setStatus(s: AudioListenStatus): void {
        if (s === this.currentStatus) return;
        this.currentStatus = s;
        for (const cb of this.listeners) cb(s);
    }
}

/** Smallest non-zero step `performance.now()` takes in a quick burst of reads. */
function measureTimerPrecision(): number | undefined {
    if (typeof performance === 'undefined') return undefined;
    let min = Infinity;
    let prev = performance.now();
    const deadline = prev + 20;
    let t = prev;
    while (t < deadline) {
        t = performance.now();
        if (t > prev) {
            min = Math.min(min, t - prev);
            prev = t;
        }
    }
    return Number.isFinite(min) ? Math.round(min * 1000) / 1000 : undefined;
}

// -- registry ------------------------------------------------------------------

const sessions = new Map<string, AudioListenSession>();

/** One session per stream URL, shared across components and remounts. */
export function getAudioListenSession(opts: AudioListenOptions): AudioListenSession {
    let s = sessions.get(opts.wsUrl);
    if (!s) {
        s = new AudioListenSession(opts);
        sessions.set(opts.wsUrl, s);
    } else if (s.options.timeUrl !== opts.timeUrl || s.options.title !== opts.title) {
        s.updateOptions(opts);
    }
    return s;
}

// -- silent keepalive clip -----------------------------------------------------

let silentWav: string | undefined;

/** One second of 8 kHz mono 8-bit silence as a WAV data URI. */
function silentWavDataUri(): string {
    if (silentWav) return silentWav;
    const rate = 8000;
    const dataBytes = rate;
    const buf = new Uint8Array(44 + dataBytes);
    const dv = new DataView(buf.buffer);
    const str = (off: number, s: string) => {
        for (let i = 0; i < s.length; i++) buf[off + i] = s.charCodeAt(i);
    };
    str(0, 'RIFF');
    dv.setUint32(4, 36 + dataBytes, true);
    str(8, 'WAVE');
    str(12, 'fmt ');
    dv.setUint32(16, 16, true);
    dv.setUint16(20, 1, true); // PCM
    dv.setUint16(22, 1, true); // mono
    dv.setUint32(24, rate, true);
    dv.setUint32(28, rate, true); // byte rate
    dv.setUint16(32, 1, true); // block align
    dv.setUint16(34, 8, true); // bits
    str(36, 'data');
    dv.setUint32(40, dataBytes, true);
    buf.fill(128, 44); // 8-bit PCM silence is 0x80
    let bin = '';
    for (let i = 0; i < buf.length; i += 0x8000) {
        bin += String.fromCharCode.apply(null, Array.from(buf.subarray(i, i + 0x8000)));
    }
    silentWav = `data:audio/wav;base64,${btoa(bin)}`;
    return silentWav;
}
