// Runs in the hidden audio window (renderer) to avoid long renders causing audio disruptions
import type { AudioChunk, EZPElectronAPI } from '@ezplayer/ezplayer-core';

declare global {
    interface Window {
        electronAPI?: Partial<EZPElectronAPI> & { getAudioSinkId?: () => string };
    }
}

type AudioContextWithSink = AudioContext & {
    setSinkId?: (sinkId: string) => Promise<void>;
    sinkId?: string;
};

export class RealTimeChunkPlayer {
    private audioCtx?: AudioContextWithSink;
    private audioCtxIncarnation = 1;

    // scheduling state
    private audioCleanBreakInterval: number | undefined = undefined;
    private audioPlayAtNextRealTime: number | undefined = undefined;
    private audioPlayAtNextACT: number | undefined = undefined;

    constructor(sinkId = '') {
        const AC =
            window.AudioContext ||
            (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
        // Pin the context to 48 kHz so it matches the curated/normalized audio rate.
        // Source PCM already at 48 kHz then needs no per-chunk resampling (clean seams);
        // any stray 44.1 kHz content is resampled here but masked by the chunk crossfade.
        // Do NOT pass sinkId into the constructor: an invalid/unpermitted sink throws
        // and aborts this whole script (no onAudioChunk listener → silent playback).
        // Route via setSinkId below, which is try/caught and falls back to default.
        this.audioCtx = new AC({ sampleRate: 48000 }) as AudioContextWithSink;
        this.audioCtxIncarnation++;
        this.resetSchedulingState();
        void this.applySinkId(sinkId);
    }

    private async applySinkId(sinkId: string): Promise<void> {
        if (!this.audioCtx) return;

        try {
            if (this.audioCtx.state === 'suspended') {
                await this.audioCtx.resume();
            }
        } catch (err) {
            console.warn('[audio-window] AudioContext.resume failed', err);
        }

        if (!sinkId) {
            console.log('[audio-window] using system default sink');
            return;
        }

        if (!this.audioCtx.setSinkId) {
            console.warn('[audio-window] AudioContext.setSinkId unavailable; using default sink');
            return;
        }

        // Already bound?
        if (this.audioCtx.sinkId === sinkId) {
            console.log(`[audio-window] sink already ${sinkId}`);
            return;
        }

        try {
            await this.audioCtx.setSinkId(sinkId);
            console.log(`[audio-window] sink set to ${sinkId} (ctx.sinkId=${this.audioCtx.sinkId ?? '?'})`);
        } catch (err) {
            const name = err instanceof DOMException ? err.name : 'Error';
            console.error(
                `[audio-window] setSinkId(${sinkId}) failed (${name}); staying on system default.`,
                err,
            );
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
     */
    public handleChunk(msg: AudioChunk): void {
        const { incarnation, playAtRealTime, sampleRate, channels, buffer, advanceSamples } = msg;

        if (!this.audioCtx) return;

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
        source.connect(this.audioCtx.destination);

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

const sinkId =
    window.electronAPI?.getAudioSinkId?.() ??
    new URLSearchParams(window.location.search).get('sinkId') ??
    '';

// Create the player bound to this window's sink
const player = new RealTimeChunkPlayer(sinkId);
log(`Audio engine ready (TS) sink=${sinkId || '(default)'}`);

function handleAudioChunk(chunk: AudioChunk) {
    player.handleChunk(chunk);
}

const api = window.electronAPI;
if (api?.onAudioChunk) {
    api.onAudioChunk(handleAudioChunk);
}
