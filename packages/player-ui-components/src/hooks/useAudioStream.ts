import { useState, useEffect, useRef, useCallback } from 'react';

export interface UseAudioStreamOptions {
    baseUrl: string | undefined;
    pollIntervalMs?: number;
    enabled?: boolean;
}

export interface UseAudioStreamResult {
    audioEnabled: boolean;
    toggleAudio: () => void;
    isPlaying: boolean;
}

const DEFAULT_POLL_INTERVAL = 50;
const MAX_CONSECUTIVE_ERRORS = 5;

export function useAudioStream(options: UseAudioStreamOptions): UseAudioStreamResult {
    const { baseUrl, pollIntervalMs = DEFAULT_POLL_INTERVAL, enabled = false } = options;

    const [audioEnabled, setAudioEnabled] = useState(enabled);
    const [isPlaying, setIsPlaying] = useState(false);

    const audioCtxRef = useRef<AudioContext | undefined>(undefined);
    const shouldStopRef = useRef(false);
    const afterSeqRef = useRef(0);
    const consecutiveErrorsRef = useRef(0);

    // Scheduling state (mirrors RealTimeChunkPlayer logic)
    const incarnationRef = useRef<number | undefined>(undefined);
    const playAtNextRealTimeRef = useRef<number | undefined>(undefined);
    const playAtNextACTRef = useRef<number | undefined>(undefined);

    const resetSchedulingState = useCallback(() => {
        incarnationRef.current = undefined;
        playAtNextRealTimeRef.current = undefined;
        playAtNextACTRef.current = undefined;
    }, []);

    const toggleAudio = useCallback(() => {
        setAudioEnabled((prev) => {
            const next = !prev;
            if (next) {
                // Create AudioContext inside user gesture
                if (!audioCtxRef.current || audioCtxRef.current.state === 'closed') {
                    const AC = window.AudioContext || (window as any).webkitAudioContext;
                    audioCtxRef.current = new AC();
                }
                afterSeqRef.current = 0;
                consecutiveErrorsRef.current = 0;
                resetSchedulingState();
            } else {
                // Close AudioContext
                audioCtxRef.current?.close();
                audioCtxRef.current = undefined;
                setIsPlaying(false);
                resetSchedulingState();
            }
            return next;
        });
    }, [resetSchedulingState]);

    useEffect(() => {
        if (!baseUrl || !audioEnabled) {
            shouldStopRef.current = true;
            return;
        }

        shouldStopRef.current = false;

        const runPollLoop = async () => {
            while (!shouldStopRef.current) {
                const ctx = audioCtxRef.current;
                if (!ctx || ctx.state === 'closed') {
                    shouldStopRef.current = true;
                    return;
                }

                try {
                    const response = await fetch(`${baseUrl}/api/audio?afterSeq=${afterSeqRef.current}`);
                    if (shouldStopRef.current) return;

                    if (response.status === 204) {
                        consecutiveErrorsRef.current = 0;
                        await new Promise((r) => setTimeout(r, pollIntervalMs));
                        continue;
                    }

                    if (!response.ok) {
                        consecutiveErrorsRef.current++;
                        if (consecutiveErrorsRef.current >= MAX_CONSECUTIVE_ERRORS) {
                            console.warn(`[useAudioStream] Stopping after ${MAX_CONSECUTIVE_ERRORS} consecutive errors.`);
                            shouldStopRef.current = true;
                            return;
                        }
                        await new Promise((r) => setTimeout(r, pollIntervalMs * 5));
                        continue;
                    }

                    consecutiveErrorsRef.current = 0;

                    const data = await response.arrayBuffer();
                    if (data.byteLength < 8) {
                        await new Promise((r) => setTimeout(r, pollIntervalMs));
                        continue;
                    }

                    const view = new DataView(data);
                    const chunkCount = view.getUint32(0, true);
                    const latestSeq = view.getUint32(4, true);
                    afterSeqRef.current = latestSeq;

                    let offset = 8;
                    let didSchedule = false;

                    for (let i = 0; i < chunkCount; i++) {
                        const playAtRealTime = view.getFloat64(offset, true); offset += 8;
                        const incarnation = view.getUint32(offset, true); offset += 4;
                        const sampleRate = view.getUint32(offset, true); offset += 4;
                        const channels = view.getUint32(offset, true); offset += 4;
                        const sampleCount = view.getUint32(offset, true); offset += 4;

                        const floatArray = new Float32Array(data, offset, sampleCount);
                        offset += sampleCount * 4;

                        const numSamples = sampleCount / channels;
                        if (numSamples <= 0) continue;

                        const audioLenMs = (1000 * numSamples) / sampleRate;
                        const dn = Date.now();
                        const actNow = ctx.currentTime * 1000;

                        let startTimeMs: number;

                        // Fresh song/segment?
                        if (incarnation !== incarnationRef.current || playAtRealTime !== playAtNextRealTimeRef.current) {
                            incarnationRef.current = incarnation;
                            playAtNextRealTimeRef.current = playAtRealTime;

                            startTimeMs = actNow + (playAtRealTime - dn);
                            playAtNextACTRef.current = startTimeMs;
                        } else {
                            startTimeMs = playAtNextACTRef.current!;
                        }

                        // Drift correction: snap back if >50ms off
                        const idealStart = actNow + (playAtRealTime - dn);
                        if (Math.abs(startTimeMs - idealStart) > 50) {
                            startTimeMs = idealStart;
                            playAtNextRealTimeRef.current = playAtRealTime;
                            playAtNextACTRef.current = startTimeMs;
                        }

                        // Advance scheduling state
                        playAtNextRealTimeRef.current! += audioLenMs;
                        playAtNextACTRef.current = startTimeMs + audioLenMs;

                        // Drop late chunks
                        if (playAtRealTime < dn) continue;

                        // Deinterleave into Web Audio buffer
                        const audioBuffer = ctx.createBuffer(channels, numSamples, sampleRate);
                        for (let ch = 0; ch < channels; ch++) {
                            const channelData = audioBuffer.getChannelData(ch);
                            for (let s = 0; s < numSamples; s++) {
                                channelData[s] = floatArray[s * channels + ch];
                            }
                        }

                        const source = ctx.createBufferSource();
                        source.buffer = audioBuffer;
                        source.connect(ctx.destination);
                        source.start(Math.max(0, startTimeMs / 1000));
                        didSchedule = true;
                    }

                    if (didSchedule) setIsPlaying(true);
                } catch (error) {
                    consecutiveErrorsRef.current++;
                    if (consecutiveErrorsRef.current >= MAX_CONSECUTIVE_ERRORS) {
                        console.warn(`[useAudioStream] Stopping after ${MAX_CONSECUTIVE_ERRORS} consecutive network errors.`);
                        shouldStopRef.current = true;
                        return;
                    }
                    await new Promise((r) => setTimeout(r, pollIntervalMs * 5));
                    continue;
                }

                await new Promise((r) => setTimeout(r, pollIntervalMs));
            }
        };

        runPollLoop();

        return () => {
            shouldStopRef.current = true;
        };
    }, [baseUrl, audioEnabled, pollIntervalMs]);

    return { audioEnabled, toggleAudio, isPlaying };
}
