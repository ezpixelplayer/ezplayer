// Runs in the hidden audio window (renderer) to avoid long renders causing audio disruptions
import type { AudioChunk, AudioDevice, AudioOutputTarget } from '@ezplayer/ezplayer-core';
import { resolveAudioOutputDevice } from '@ezplayer/ezplayer-core';

interface AudioWindowAPI {
    getAudioOutput?: () => AudioOutputTarget;
    isAudioProbe?: () => boolean;
    reportAudioOutputDevices?: (devices: AudioDevice[]) => void;
    onAudioChunk?: (callback: (data: AudioChunk) => void) => void;
    onAudioGain?: (callback: (gain: number, bus?: string) => void) => void;
}

declare global {
    interface Window {
        electronAPI?: AudioWindowAPI;
    }
}

type AudioContextWithSink = AudioContext & {
    setSinkId?: (sinkId: string) => Promise<void>;
    sinkId?: string;
};

export class RealTimeChunkPlayer {
    private audioCtx?: AudioContextWithSink;
    private gainNode?: GainNode;
    private audioCtxIncarnation = 1;
    private gain = 1;
    /** False while a named output device is absent; output is muted. */
    private routed = true;
    private boundDeviceId = '';
    private rebindPending = false;
    private pollTimer: number | undefined;

    // scheduling state
    private audioCleanBreakInterval: number | undefined = undefined;
    private audioPlayAtNextRealTime: number | undefined = undefined;
    private audioPlayAtNextACT: number | undefined = undefined;

    constructor(private readonly target: AudioOutputTarget) {
        const AC =
            window.AudioContext ||
            (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
        // Pin the context to 48 kHz so it matches the curated/normalized audio rate.
        // Source PCM already at 48 kHz then needs no per-chunk resampling (clean seams);
        // any stray 44.1 kHz content is resampled here but masked by the chunk crossfade.
        // Sink is applied via setSinkId; a bad sink in the constructor throws.
        this.audioCtx = new AC({ sampleRate: 48000 }) as AudioContextWithSink;
        this.gainNode = this.audioCtx.createGain();
        this.gainNode.connect(this.audioCtx.destination);
        this.audioCtxIncarnation++;
        this.resetSchedulingState();
        if (target.deviceId) {
            this.routed = false;
            this.applyGain();
            // Hidden windows may not receive devicechange; poll while the device is missing.
            navigator.mediaDevices?.addEventListener?.('devicechange', () => void this.rebind());
            this.audioCtx.addEventListener('error', () => this.onSinkLost('render error'));
            this.audioCtx.addEventListener('statechange', () => {
                if (this.audioCtx?.state === 'suspended' && this.routed) void this.rebind();
            });
            void this.rebind();
        }
        void this.audioCtx.resume().catch((err) => console.warn('[audio-window] AudioContext.resume failed', err));
    }

    /** The context injected-audio buses play through, on the same device. */
    public context(): AudioContext | undefined {
        return this.audioCtx;
    }

    /** False while nothing can sound: the device is absent or the context is stopped. */
    public live(): boolean {
        return this.routed && this.audioCtx?.state === 'running';
    }

    /** Linear amplitude 0..1 from main. */
    public setGain(gain: number): void {
        this.gain = Number.isFinite(gain) ? Math.max(0, Math.min(1, gain)) : 1;
        this.applyGain();
    }

    private applyGain(): void {
        if (this.gainNode) this.gainNode.gain.value = this.routed ? this.gain : 0;
    }

    private onSinkLost(reason: string): void {
        if (this.routed) console.warn(`[audio-window] ${this.target.label}: ${reason}, muted`);
        this.routed = false;
        this.boundDeviceId = '';
        this.applyGain();
        this.schedulePoll();
    }

    private schedulePoll(): void {
        if (this.pollTimer !== undefined) return;
        this.pollTimer = window.setTimeout(() => {
            this.pollTimer = undefined;
            void this.rebind();
        }, 2000);
    }

    /** Locate the named device among connected outputs and bind the sink to it. */
    private async rebind(): Promise<void> {
        if (!this.audioCtx?.setSinkId) {
            console.warn('[audio-window] AudioContext.setSinkId unavailable; output muted');
            return;
        }
        if (this.rebindPending) return;
        this.rebindPending = true;
        try {
            const devices = await navigator.mediaDevices.enumerateDevices();
            const found = resolveAudioOutputDevice(this.target, devices);
            if (!found) {
                this.onSinkLost('device gone');
                return;
            }
            if (found.deviceId !== this.boundDeviceId) {
                await this.audioCtx.setSinkId(found.deviceId);
                this.boundDeviceId = found.deviceId;
                console.log(`[audio-window] ${this.target.label}: bound to ${found.label || found.deviceId}`);
            }
            if (this.audioCtx.state === 'suspended') await this.audioCtx.resume();
            this.routed = true;
            this.resetSchedulingState();
            this.applyGain();
        } catch (err) {
            console.error(`[audio-window] ${this.target.label}: setSinkId failed`, err);
            this.onSinkLost('setSinkId failed');
        } finally {
            this.rebindPending = false;
        }
    }

    private resetSchedulingState() {
        this.audioCleanBreakInterval = undefined;
        this.audioPlayAtNextRealTime = undefined;
        this.audioPlayAtNextACT = undefined;
    }

    /**
     * Feed one decoded PCM chunk.
     * Behavior matches your original implementation:
     * - Uses incarnation + playAtRealTime to decide whether to reset scheduling.
     * - Schedules contiguous playback via ACT timeline.
     * PCM arrives at unity gain; volume is applied by the GainNode.
     */
    public handleChunk(msg: AudioChunk): void {
        const { incarnation, playAtRealTime, sampleRate, channels, buffer, advanceSamples } = msg;

        if (!this.audioCtx || !this.gainNode) return;
        // Nothing is rendering; queued sources would all fire at once on resume.
        if (!this.routed || this.audioCtx.state !== 'running') {
            this.resetSchedulingState();
            return;
        }

        const floatArray = new Float32Array(buffer);
        const numSamples = floatArray.length / channels;
        if (numSamples <= 0) return;

        // The buffer may carry a trailing crossfade overlap, so advance the schedule
        // by the advertised hop (advanceSamples), not the full buffer length. All
        // numSamples are still rendered; adjacent chunks overlap and sum.
        const advanceFrames = advanceSamples && advanceSamples > 0 ? advanceSamples / channels : numSamples;
        const audioLenMs = (1000 * advanceFrames) / sampleRate;

        // The stamp is in the player's RTC; compare it with the same clock.
        const dn = Math.round(Date.now() + (msg.rtcOffsetMs ?? 0));
        const actNow = Math.round(this.audioCtx.currentTime * 1000); // audio clock, ms

        let startTimeMs: number | undefined;

        // Fresh song/segment?
        if (incarnation !== this.audioCleanBreakInterval || playAtRealTime !== this.audioPlayAtNextRealTime) {
            //console.log(`Starting new song/audio segment`);
            this.audioCleanBreakInterval = incarnation;
            this.audioPlayAtNextRealTime = playAtRealTime;

            startTimeMs = actNow + (playAtRealTime - dn);
            this.audioPlayAtNextACT = startTimeMs;
            // Audio runs well ahead of the lights; whatever the previous segment had queued
            // from here on must not sound under the new one.
            this.cutQueuedFrom(startTimeMs / 1000);
        } else {
            startTimeMs = this.audioPlayAtNextACT;
        }

        // Sanity check: if we drift too far, snap back to real-time alignment
        const idealStart = actNow + (playAtRealTime - dn);
        if (Math.abs(startTimeMs! - idealStart) > 50) {
            // One line every few seconds: a chain that cannot stay within 50 ms of the wall
            // clock snaps on every chunk, and what matters then is whether the context's
            // clock is advancing at all (state, currentTime) and what it claims as latency.
            const nowMs = Date.now();
            if (nowMs - this.lastSnapLogAt > 5000) {
                this.lastSnapLogAt = nowMs;
                console.log(
                    `Audio chain ${startTimeMs! - idealStart > 0 ? 'ahead of' : 'behind'} wall by ${Math.abs(startTimeMs! - idealStart)} ms, snapping ` +
                        `(ctx ${this.audioCtx.state} t=${this.audioCtx.currentTime.toFixed(3)} outLat=${Math.round((this.audioCtx.outputLatency || 0) * 1000)}ms ` +
                        `rtcOffset=${msg.rtcOffsetMs ?? 0}ms, ${this.snapsSinceLog + 1} snaps since last line)`,
                );
                this.snapsSinceLog = 0;
            } else {
                this.snapsSinceLog++;
            }
            startTimeMs = idealStart;
            this.audioPlayAtNextRealTime = playAtRealTime;
            this.audioPlayAtNextACT = startTimeMs;
            this.cutQueuedFrom(startTimeMs / 1000);
        }

        // Advance scheduling state
        this.audioPlayAtNextRealTime! += audioLenMs;
        this.audioPlayAtNextACT = startTimeMs! + audioLenMs;

        // Too late? Drop this chunk.
        if (playAtRealTime < dn) {
            // TODO: stats / logging if you want
            return;
        }

        // Deinterleave into Web Audio buffer
        const audioBuffer = this.audioCtx.createBuffer(channels, numSamples, sampleRate);

        for (let ch = 0; ch < channels; ch++) {
            const channelData = audioBuffer.getChannelData(ch);
            for (let i = 0; i < numSamples; i++) {
                channelData[i] = floatArray[i * channels + ch];
            }
        }

        const source = this.audioCtx.createBufferSource();
        source.buffer = audioBuffer;
        source.connect(this.gainNode);

        // Web Audio time is in seconds
        const startSec = startTimeMs! / 1000;
        source.start(startSec);
        this.queued.push({ source, start: startSec, end: startSec + numSamples / sampleRate });
        if (this.queued.length > 64) this.queued = this.queued.filter((q) => q.end > this.audioCtx!.currentTime);
    }

    private queued: Array<{ source: AudioBufferSourceNode; start: number; end: number }> = [];
    private lastSnapLogAt = 0;
    private snapsSinceLog = 0;

    /** Stop queued sources at `at` seconds: not-yet-started ones are cancelled, one playing
     *  across `at` ends there. */
    private cutQueuedFrom(at: number): void {
        if (!this.audioCtx) return;
        const now = this.audioCtx.currentTime;
        const keep: typeof this.queued = [];
        for (const q of this.queued) {
            if (q.end <= at) {
                if (q.end > now) keep.push(q);
                continue;
            }
            try {
                q.source.stop(Math.max(at, now));
            } catch {
                /* already stopped */
            }
        }
        this.queued = keep;
    }
}

/**
 * Where an audio context's clock stands against this computer's. The context
 * clock moves a device buffer at a time (about 10 ms), so one reading is low
 * by up to that much; the highest recent reading is the true one.
 */
export class ContextClock {
    private offset?: number;
    private readAt = 0;

    constructor(private readonly ctx: AudioContext) {}

    /** Context time minus Date.now(), ms. */
    read(): number {
        const wall = Date.now();
        const seen = this.ctx.currentTime * 1000 - wall;
        // An old high reading is let go at 1 ms a second, faster than a sound card drifts.
        const held = this.offset === undefined ? -Infinity : this.offset - (wall - this.readAt) / 1000;
        // Far above every new reading: the context stopped for a while.
        if (seen >= held || held - seen > 100) {
            this.offset = seen;
            this.readAt = wall;
            return seen;
        }
        return held;
    }
}

/** A chunk cut short because it came late fades in over this many frames. */
const LATE_FADE_FRAMES = 96;

/**
 * One injected-audio bus on this device. Its chunks are 48 kHz with no
 * overlap, so they are placed on whole frames of the context: the first chunk
 * of a run fixes where the run sits and the rest follow it exactly.
 */
export class BusChannel {
    private readonly gainNode: GainNode;
    private anchor?: { playAt: number; frame: number; incarnation: number };
    private stats = { chunks: 0, late: 0, marginMin: Infinity, marginSum: 0 };
    private lastLogAt = 0;
    private readonly clock: ContextClock;

    constructor(
        private readonly ctx: AudioContext,
        private readonly name: string,
    ) {
        this.gainNode = ctx.createGain();
        this.gainNode.connect(ctx.destination);
        this.clock = new ContextClock(ctx);
        // Read often, so the clock is known when a sound starts.
        window.setInterval(() => this.clock.read(), 200);
    }

    public setGain(gain: number): void {
        this.gainNode.gain.value = Number.isFinite(gain) ? Math.max(0, Math.min(1, gain)) : 1;
    }

    public handleChunk(msg: AudioChunk, live: boolean): void {
        const { playAtRealTime, sampleRate, channels, incarnation } = msg;
        if (!live) {
            this.anchor = undefined;
            return;
        }
        const samples = new Float32Array(msg.buffer);
        const frames = samples.length / channels;
        if (frames <= 0) return;
        const rate = this.ctx.sampleRate;
        const margin = playAtRealTime - (Date.now() + (msg.rtcOffsetMs ?? 0));
        const nowFrame = this.ctx.currentTime * rate;
        const ideal = ((playAtRealTime - (msg.rtcOffsetMs ?? 0) + this.clock.read()) * rate) / 1000;
        const a = this.anchor;
        const placed = a ? a.frame + Math.round(((playAtRealTime - a.playAt) * rate) / 1000) : ideal;
        // A new run, or the clocks have drifted 20 ms apart: fix the place again.
        let start = placed;
        if (!a || a.incarnation !== incarnation || Math.abs(placed - ideal) > rate / 50) {
            start = Math.round(ideal);
            this.anchor = { playAt: playAtRealTime, frame: start, incarnation };
        }
        this.note(margin, start < nowFrame);
        const lateFrames = Math.max(0, Math.ceil(nowFrame - start));
        if (lateFrames >= frames) return;

        const buffer = this.ctx.createBuffer(channels, frames, sampleRate);
        for (let ch = 0; ch < channels; ch++) {
            const data = buffer.getChannelData(ch);
            for (let i = 0; i < frames; i++) data[i] = samples[i * channels + ch];
        }
        const source = this.ctx.createBufferSource();
        source.buffer = buffer;
        source.connect(this.gainNode);
        if (lateFrames > 0) {
            // Late: play what is left at its own time, not the whole chunk shifted,
            // and ease into it so the cut does not click.
            const n = Math.min(LATE_FADE_FRAMES, frames - lateFrames);
            for (let ch = 0; ch < channels; ch++) {
                const data = buffer.getChannelData(ch);
                for (let i = 0; i < n; i++) data[lateFrames + i] *= i / n;
            }
            source.start(0, lateFrames / sampleRate);
        } else source.start(start / rate);
    }

    /** One line every few seconds a bus is in use: how much time its chunks arrive with. A warning when some came late. */
    private note(margin: number, late: boolean): void {
        const s = this.stats;
        s.chunks++;
        if (late) s.late++;
        s.marginMin = Math.min(s.marginMin, margin);
        s.marginSum += margin;
        const now = Date.now();
        if (this.lastLogAt === 0) this.lastLogAt = now;
        if (now - this.lastLogAt < 5000) return;
        const ctx = this.ctx as AudioContext & { outputLatency?: number };
        (s.late > 0 ? console.warn : console.log)(
            `[audio-window] bus ${this.name}: ${s.chunks} chunks, ${s.late} late, ` +
                `arrival margin min ${Math.round(s.marginMin)} ms avg ${Math.round(s.marginSum / s.chunks)} ms, ` +
                `device latency ${Math.round(((ctx.outputLatency ?? 0) + ctx.baseLatency) * 1000)} ms`,
        );
        this.lastLogAt = now;
        this.stats = { chunks: 0, late: 0, marginMin: Infinity, marginSum: 0 };
    }
}

const logEl = document.getElementById('log');

function log(msg: string) {
    if (logEl) {
        logEl.textContent += `\n${msg}`;
        console.log(`[audio-window] ${msg}`);
    } else {
        // Fallback if element not found

        console.log(`[audio-window] ${msg}`);
    }
}

/** Audio outputs in the shape the Settings screen lists. */
export async function enumerateAudioOutputs(): Promise<AudioDevice[]> {
    const devices = await navigator.mediaDevices.enumerateDevices();
    return devices
        .filter((d) => d.kind === 'audiooutput')
        .map((d) => ({ label: d.label, deviceId: d.deviceId, kind: d.kind, groupId: d.groupId }) satisfies AudioDevice);
}

export function sameAudioDevices(a: AudioDevice[], b: AudioDevice[]): boolean {
    return (
        a.length === b.length &&
        a.every((d, i) => d.deviceId === b[i].deviceId && d.label === b[i].label && d.groupId === b[i].groupId)
    );
}

/** Reports output changes to main; polls because hidden windows may miss devicechange. */
function runAudioDeviceProbe(api: AudioWindowAPI, pollMs = 10000): void {
    let last: AudioDevice[] | undefined;
    const publish = async () => {
        try {
            const devices = await enumerateAudioOutputs();
            if (last && sameAudioDevices(last, devices)) return;
            last = devices;
            api.reportAudioOutputDevices?.(devices);
            log(`outputs: ${devices.map((d) => d.label || d.deviceId).join(', ') || 'none'}`);
        } catch (err) {
            console.warn('[audio-window] enumerateDevices failed', err);
        }
    };
    navigator.mediaDevices?.addEventListener?.('devicechange', () => void publish());
    window.setInterval(() => void publish(), pollMs);
    void publish();
}

const api = window.electronAPI;
if (api?.isAudioProbe?.()) {
    runAudioDeviceProbe(api);
    log('Audio device probe ready');
} else {
    const target: AudioOutputTarget = api?.getAudioOutput?.() ?? { deviceId: '', label: '' };

    const player = new RealTimeChunkPlayer(target);
    log(`Audio engine ready (TS) output=${target.label || '(default)'}`);

    const buses = new Map<string, BusChannel>();
    const busFor = (name: string): BusChannel | undefined => {
        const ctx = player.context();
        if (!ctx) return undefined;
        let bus = buses.get(name);
        if (!bus) buses.set(name, (bus = new BusChannel(ctx, name)));
        return bus;
    };

    api?.onAudioChunk?.((chunk) => {
        if (chunk.bus) busFor(chunk.bus)?.handleChunk(chunk, player.live());
        else player.handleChunk(chunk);
    });
    api?.onAudioGain?.((gain, bus) => {
        if (bus) busFor(bus)?.setGain(gain);
        else player.setGain(gain);
    });
}
