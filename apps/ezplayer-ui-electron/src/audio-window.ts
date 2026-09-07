// Runs in the hidden audio window (renderer) to avoid long renders causing audio disruptions
import type { AudioChunk, AudioOutputTarget } from '@ezplayer/ezplayer-core';
import { resolveAudioOutputDevice } from '@ezplayer/ezplayer-core';

interface AudioWindowAPI {
    getAudioOutput?: () => AudioOutputTarget;
    onAudioChunk?: (callback: (data: AudioChunk) => void) => void;
    onAudioGain?: (callback: (gain: number) => void) => void;
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
            void this.rebind();
            navigator.mediaDevices?.addEventListener?.('devicechange', () => void this.rebind());
        }
        void this.audioCtx.resume().catch((err) => console.warn('[audio-window] AudioContext.resume failed', err));
    }

    /** Linear amplitude 0..1 from main. */
    public setGain(gain: number): void {
        this.gain = Number.isFinite(gain) ? Math.max(0, Math.min(1, gain)) : 1;
        this.applyGain();
    }

    private applyGain(): void {
        if (this.gainNode) this.gainNode.gain.value = this.routed ? this.gain : 0;
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
                if (this.routed) console.warn(`[audio-window] ${this.target.label}: device gone, muted`);
                this.routed = false;
                this.applyGain();
                return;
            }
            if (found.deviceId !== this.boundDeviceId) {
                await this.audioCtx.setSinkId(found.deviceId);
                this.boundDeviceId = found.deviceId;
                console.log(`[audio-window] ${this.target.label}: bound to ${found.label || found.deviceId}`);
            }
            this.routed = true;
            this.applyGain();
        } catch (err) {
            this.routed = false;
            this.boundDeviceId = '';
            this.applyGain();
            console.error(`[audio-window] ${this.target.label}: setSinkId failed, muted`, err);
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

        const floatArray = new Float32Array(buffer);
        const numSamples = floatArray.length / channels;
        if (numSamples <= 0) return;

        // The buffer may carry a trailing crossfade overlap, so advance the schedule
        // by the advertised hop (advanceSamples), not the full buffer length. All
        // numSamples are still rendered; adjacent chunks overlap and sum.
        const advanceFrames = advanceSamples && advanceSamples > 0 ? advanceSamples / channels : numSamples;
        const audioLenMs = (1000 * advanceFrames) / sampleRate;

        const dn = Math.round(Date.now()); // real clock, ms
        const actNow = Math.round(this.audioCtx.currentTime * 1000); // audio clock, ms

        let startTimeMs: number | undefined;

        // Fresh song/segment?
        if (incarnation !== this.audioCleanBreakInterval || playAtRealTime !== this.audioPlayAtNextRealTime) {
            //console.log(`Starting new song/audio segment`);
            this.audioCleanBreakInterval = incarnation;
            this.audioPlayAtNextRealTime = playAtRealTime;

            startTimeMs = actNow + (playAtRealTime - dn);
            this.audioPlayAtNextACT = startTimeMs;
        } else {
            startTimeMs = this.audioPlayAtNextACT;
        }

        // Sanity check: if we drift too far, snap back to real-time alignment
        const idealStart = actNow + (playAtRealTime - dn);
        if (Math.abs(startTimeMs! - idealStart) > 50) {
            console.log(`Start time way off: ${startTimeMs} vs ${idealStart}, snapping back`);
            startTimeMs = idealStart;
            this.audioPlayAtNextRealTime = playAtRealTime;
            this.audioPlayAtNextACT = startTimeMs;
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
        source.start(startTimeMs! / 1000);
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

const api = window.electronAPI;
const target: AudioOutputTarget = api?.getAudioOutput?.() ?? { deviceId: '', label: '' };

const player = new RealTimeChunkPlayer(target);
log(`Audio engine ready (TS) output=${target.label || '(default)'}`);

api?.onAudioChunk?.((chunk) => player.handleChunk(chunk));
api?.onAudioGain?.((gain) => player.setGain(gain));
