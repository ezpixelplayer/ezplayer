// Runs in the hidden audio window (renderer) to avoid long renders causing audio disruptions
import { AudioChunk } from '@ezplayer/ezplayer-core';

export class RealTimeChunkPlayer {
    private audioCtx?: AudioContext;
    private audioCtxIncarnation = 1;

    // scheduling state
    private audioCleanBreakInterval: number | undefined = undefined;
    private audioPlayAtNextRealTime: number | undefined = undefined;
    private audioPlayAtNextACT: number | undefined = undefined;

    constructor() {
        const AC = window.AudioContext || (window as any).webkitAudioContext;
        this.audioCtx = new AC();
        this.audioCtxIncarnation++;
        this.resetSchedulingState();
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
        const { incarnation, playAtRealTime, sampleRate, channels, buffer } = msg;

        if (!this.audioCtx) return;

        const floatArray = new Float32Array(buffer);
        const numSamples = floatArray.length / channels;
        if (numSamples <= 0) return;

        const audioLenMs = (1000 * numSamples) / sampleRate;

        const dn = Math.round(Date.now()); // real clock, ms
        const actNow = Math.round(this.audioCtx.currentTime * 1000); // audio clock, ms

        let startTimeMs: number | undefined;

        // Fresh song/segment?
        if (
            incarnation !== this.audioCleanBreakInterval ||
            playAtRealTime !== this.audioPlayAtNextRealTime
        ) {
            console.log(`Starting new song/audio segment`);
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
            console.log(
                `Start time way off: ${startTimeMs} vs ${idealStart}, snapping back`
            );
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
        const audioBuffer = this.audioCtx.createBuffer(
            channels,
            numSamples,
            sampleRate
        );

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
        // eslint-disable-next-line no-console
        console.log(`[audio-window] ${msg}`);
    }
}

// Create the player
const player = new RealTimeChunkPlayer();
log('Audio engine ready (TS)');

function handleAudioChunk(chunk: AudioChunk) {
    player.handleChunk(chunk);
}

window.electronAPI?.onAudioChunk(handleAudioChunk);
