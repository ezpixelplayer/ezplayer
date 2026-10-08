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
 *   - re-syncs the clock and re-anchors the schedule after a wake-up;
 *   - starts warm: `prewarm()` compiles the decoder and takes a clock sample
 *     before the tap, and the first chunk is not scheduled until the
 *     AudioContext is really running, the decoder is up and a clock sample
 *     is in (see warmStart.ts). Stop keeps the warmed pieces for a restart.
 */

import { parseAudioWireFrame, type AudioWireFrame } from '@ezplayer/ezplayer-core';

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
    type ClockRoundTrip,
} from './clockSync';
import { WARMUP_MAX_PENDING_FRAMES, stillPlayable, warmupReady } from './warmStart';

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
    /** Time from start() until the first chunk was scheduled (warm-up gate). */
    warmupMs?: number;
    /** Frames held back by the warm-up gate on this start. */
    warmupHeld?: number;
    /** Chain playing later than the stamps because the device's output latency exceeds
     *  the stream lead; 0 when in sync. */
    lateShiftMs?: number;
    updatedAt: number;
}

/** `?audiodebug=1` in the URL or localStorage ezpAudioDebug=1: verbose console breadcrumbs. */
function audioDebugEnabled(): boolean {
    if (typeof window === 'undefined') return false;
    try {
        return /[?&]audiodebug=1/.test(window.location.search) || localStorage.getItem('ezpAudioDebug') === '1';
    } catch {
        return false;
    }
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
    private debugTimer?: ReturnType<typeof setInterval>;
    // warm-up gate (see warmStart.ts)
    private startedAt = 0;
    private gateOpen = false;
    private pendingFrames: AudioWireFrame[] = [];
    private warmupMs?: number;
    private warmupHeld = 0;

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
            warmupMs: this.warmupMs,
            warmupHeld: this.warmupHeld,
            lateShiftMs: this.player?.lateShiftMs,
            updatedAt: Date.now(),
        };
    }

    /**
     * Get the slow pieces ready before the user taps Listen, so the first
     * start is as clean as a restart: compile the decoder, take a clock
     * sample and — once the page has had any user activation, so the
     * browser will let it run — open the AudioContext. Idempotent; call it
     * whenever a Listen control is shown and again on first touch.
     */
    prewarm(): void {
        if (this.wanted) return;
        if (!this.decoder) {
            this.decoder = new ChunkDecoder();
            void this.decoder.init();
        }
        if (this.offsetRef.httpSample === undefined && !this.clockAbort) void this.syncClock(true);
        if (!this.player && hasUserActivation()) this.player = this.makePlayer();
    }

    /** Must be called from a user gesture the first time (autoplay policy). */
    start(): void {
        if (this.wanted) {
            void this.player?.resume();
            return;
        }
        this.wanted = true;
        // Keep the learned clock offset across stop/start; only the one-way
        // chunk samples are stale.
        resetClockWindow(this.offsetRef);
        this.startedAt = Date.now();
        this.gateOpen = false;
        this.pendingFrames = [];
        this.warmupMs = undefined;
        this.warmupHeld = 0;
        this.chunksReceived = 0;
        this.chunksDropped = 0;
        this.chunksTrimmed = 0;
        this.chunksSnapped = 0;
        this.timerPrecisionMs = measureTimerPrecision();
        this.reconnects = 0;
        this.httpAttempts = 0;
        this.lastChunk = undefined;
        this.reconnectDelay = RECONNECT_MIN_MS;

        // Reuse what prewarm() or a previous listen left ready.
        if (!this.player) this.player = this.makePlayer();
        this.player.reanchor();
        void this.player.resume();
        if (!this.decoder) {
            this.decoder = new ChunkDecoder();
            void this.decoder.init();
        }

        this.startKeepalive();
        this.attachPageListeners();
        void this.requestWakeLock();
        this.startDebugLog();

        this.setStatus('connecting');
        // Don't abort a prewarm sample that is about to land.
        if (!this.clockAbort) void this.syncClock();
        this.clockTimer = setInterval(() => void this.syncClock(), CLOCK_REFRESH_INTERVAL_MS);
        this.connect();
    }

    private makePlayer(): RealTimeChunkPlayer {
        const player = new RealTimeChunkPlayer(this.offsetRef, (ev) => {
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
        player.context.onstatechange = () => {
            if (audioDebugEnabled()) console.debug(`[audio] context state -> ${player.context.state}`);
            if (!this.wanted || this.player !== player) return;
            const state = player.context.state as string;
            if (state === 'suspended' || state === 'interrupted') void player.resume();
        };
        return player;
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
        this.pendingFrames = [];
        this.gateOpen = false;
        // Keep the context (suspended, so it costs nothing) and the compiled
        // decoder: a restart then needs no device open or wasm compile.
        this.player?.reanchor();
        void this.player?.context.suspend().catch(() => undefined);
        this.stopKeepalive();
        this.releaseWakeLock();
        this.detachPageListeners();
        this.stopDebugLog();
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
            if (audioDebugEnabled()) console.debug(`[audio] reconnect #${this.reconnects} to ${this.opts.wsUrl}`);
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
        if (!this.gateOpen) {
            // Hold frames until the clocks can be trusted (see warmStart.ts);
            // tryOpenGate() plays the ones still worth playing, this one included.
            this.pendingFrames.push(frame);
            if (this.pendingFrames.length > WARMUP_MAX_PENDING_FRAMES) this.pendingFrames.shift();
            this.tryOpenGate();
            return;
        }
        this.play(frame);
    }

    private play(frame: AudioWireFrame): void {
        const chunk = this.decoder?.decode(frame);
        if (!chunk) return;
        this.player?.handleChunk(chunk);
    }

    private tryOpenGate(): void {
        const ctx = this.player?.context;
        const ok = warmupReady({
            contextState: ctx?.state,
            contextTime: ctx?.currentTime ?? 0,
            decoderReady: this.decoder?.ready ?? false,
            haveClockSample: this.offsetRef.httpSample !== undefined,
            elapsedMs: Date.now() - this.startedAt,
        });
        if (!ok) return;
        this.gateOpen = true;
        this.warmupMs = Date.now() - this.startedAt;
        this.warmupHeld = this.pendingFrames.length;
        const playable = stillPlayable(this.pendingFrames, Date.now() + this.offsetRef.value);
        this.pendingFrames = [];
        if (audioDebugEnabled()) {
            console.debug(
                `[audio] warm-up gate open after ${this.warmupMs}ms: held ${this.warmupHeld} frames, ${playable.length} still playable; ` +
                    `ctx=${ctx?.state} ctxTime=${(ctx?.currentTime ?? 0).toFixed(3)} outLat=${Math.round((ctx?.outputLatency || 0) * 1000)}ms ` +
                    `decoder=${this.decoder?.ready ? 'ready' : 'not ready'} http=${this.offsetRef.httpSample === undefined ? 'MISSING (deadline)' : 'ok'} ` +
                    `offset=${this.offsetRef.value.toFixed(1)}ms`,
            );
        }
        for (const f of playable) this.play(f);
    }

    // -- clock ---------------------------------------------------------------

    private async syncClock(prewarm = false): Promise<void> {
        if (!this.wanted && !prewarm) return;
        this.clockAbort?.abort();
        const abort = new AbortController();
        this.clockAbort = abort;
        this.httpAttempts++;
        const debug = audioDebugEnabled();
        const onRoundTrip = debug
            ? (rt: ClockRoundTrip) =>
                  console.debug(
                      `[audio] clock rt#${rt.index}: t0=${rt.t0} t1=${rt.t1} rtt=${rt.rtt}ms player.now=${rt.now} ` +
                          `offset=${rt.offset.toFixed(1)}ms (player - browser)` +
                          (prewarm ? ' [prewarm]' : ''),
                  )
            : undefined;
        const sample = await estimateClockOffset(this.opts.timeUrl, abort.signal, undefined, onRoundTrip);
        if (this.clockAbort === abort) this.clockAbort = undefined;
        if (abort.signal.aborted || !sample) {
            if (debug) console.debug(`[audio] clock: no usable sample from ${this.opts.timeUrl}`);
            return;
        }
        const before = this.offsetRef.value;
        const snapsBefore = this.offsetRef.snaps ?? 0;
        applyHttpClockOffset(this.offsetRef, sample);
        if (debug) {
            const ref = this.offsetRef;
            const floor = ref.chunkCandidates.length ? Math.max(...ref.chunkCandidates) : undefined;
            console.debug(
                `[audio] clock applied: best rtt=${sample.rtt}ms http=${sample.offset.toFixed(1)} ` +
                    `chunkFloor=${floor === undefined ? '-' : floor.toFixed(1)} (${ref.chunkCandidates.length} samples) ` +
                    `estimate=${ref.estimate.toFixed(1)} value ${before.toFixed(1)} -> ${ref.value.toFixed(1)}` +
                    ((ref.snaps ?? 0) > snapsBefore
                        ? ' SNAPPED'
                        : ref.value === before
                          ? ' (held: within threshold)'
                          : ''),
            );
        }
    }

    // -- page lifecycle --------------------------------------------------------

    private readonly onVisibility = (): void => {
        if (audioDebugEnabled() && typeof document !== 'undefined') {
            console.debug(`[audio] visibility -> ${document.visibilityState}, socket ${this.ws?.readyState ?? 'none'}`);
        }
        if (!this.wanted || document.visibilityState !== 'visible') return;
        void this.player?.resume();
        void this.requestWakeLock();
        // A backgrounded phone usually froze the socket; don't wait out the backoff.
        if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
            this.reconnectDelay = RECONNECT_MIN_MS;
            this.closeSocket();
            this.scheduleReconnect(true);
        } else {
            // Fresh clock samples only. The chained schedule is kept: the scheduler's drift
            // detector re-anchors if it has really drifted, and an unconditional re-anchor
            // is audible.
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

    // -- diagnostics breadcrumb -----------------------------------------------------

    /** With `?audiodebug=1` in the URL (or localStorage ezpAudioDebug=1) print one compact
     *  diagnostics line every 10 s. Works on every page, including the LAN ones that have no
     *  overlay, and keeps logging while the tab is in the background. */
    private startDebugLog(): void {
        if (this.debugTimer || typeof window === 'undefined') return;
        if (!audioDebugEnabled()) return;
        const line = () => {
            const d = this.getDiagnostics();
            const c = d.lastChunk;
            console.debug(
                '[audio] ' +
                    `${d.status} vis=${typeof document !== 'undefined' ? document.visibilityState : '?'} ` +
                    `ctx=${d.contextState ?? '?'} outLat=${d.outputLatencyMs ?? '?'}ms map=${d.mapping ?? '?'} ` +
                    `offset=${d.offsetValue.toFixed(0)}ms rtt=${d.httpRtt ?? '?'} ` +
                    `rx=${d.chunksReceived} trim=${d.chunksTrimmed} drop=${d.chunksDropped} snaps=${d.chunksSnapped}/${d.offsetSnaps} ` +
                    `warmup=${d.warmupMs ?? '-'}ms shift=${d.lateShiftMs === undefined ? '-' : d.lateShiftMs.toFixed(0)}ms ` +
                    (c
                        ? `last: late=${c.lateBy.toFixed(0)} dev=${c.deviationMs.toFixed(0)} trim=${c.trimmedMs.toFixed(0)}`
                        : ''),
            );
        };
        line();
        this.debugTimer = setInterval(line, 10_000);
    }

    private stopDebugLog(): void {
        if (this.debugTimer) clearInterval(this.debugTimer);
        this.debugTimer = undefined;
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

/** The page has seen a user gesture, so an AudioContext created now may run. */
function hasUserActivation(): boolean {
    if (typeof navigator === 'undefined') return false;
    const ua = (navigator as unknown as { userActivation?: { hasBeenActive?: boolean } }).userActivation;
    return ua?.hasBeenActive === true;
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
