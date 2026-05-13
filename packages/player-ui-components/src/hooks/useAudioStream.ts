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
const CLOCK_SYNC_SAMPLES = 6;
/** Re-bootstrap clockOffset via /api/time every this often. Backstop for the
 *  running-max-on-WS-arrival refinement, in case the network's one-way
 *  asymmetry drifts (cellular handover, etc.). */
const CLOCK_REFRESH_INTERVAL_MS = 30_000;

/**
 * Estimate the offset between this client's clock and the server's clock.
 * offset = serverNow - clientNow  (positive means server is ahead).
 * Trusts the sample with the lowest RTT — it had the least scheduling noise,
 * so the "halfway" assumption is most accurate.
 */
async function estimateClockOffset(baseUrl: string): Promise<number> {
    let bestOffset = 0;
    let bestRtt = Infinity;
    for (let i = 0; i < CLOCK_SYNC_SAMPLES; i++) {
        const t0 = Date.now();
        try {
            const res = await fetch(`${baseUrl}/api/time`);
            const t1 = Date.now();
            if (!res.ok) continue;
            const { now: serverNow } = await res.json();
            const rtt = t1 - t0;
            if (rtt < bestRtt) {
                bestRtt = rtt;
                bestOffset = serverNow - (t0 + rtt / 2);
            }
        } catch {
            // ignore individual failures
        }
    }
    return bestOffset;
}

/** If `baseUrl` is the cloud proxy prefix `/api/enduserspa/proxy/<token>` (or
 *  an absolute URL ending in that), return the matching audio-bridge WS URL.
 *  Otherwise `undefined` and the hook falls back to HTTP polling. */
function deriveAudioBridgeWsUrl(baseUrl: string | undefined): string | undefined {
    if (!baseUrl || typeof window === 'undefined') return undefined;
    const m = baseUrl.match(/^(.*?)\/api\/enduserspa\/proxy\/([^/]+)\/?$/);
    if (!m) return undefined;
    const origin = m[1] || window.location.origin;
    const token = m[2];
    const wsOrigin = origin.replace(/^https:/i, 'wss:').replace(/^http:/i, 'ws:');
    return `${wsOrigin}/api/enduserspa/audioBridge/${token}`;
}

export function useAudioStream(options: UseAudioStreamOptions): UseAudioStreamResult {
    const { baseUrl, pollIntervalMs = DEFAULT_POLL_INTERVAL, enabled = false } = options;

    const [audioEnabled, setAudioEnabled] = useState(enabled);
    const [isPlaying, setIsPlaying] = useState(false);

    const audioCtxRef = useRef<AudioContext | undefined>(undefined);
    const shouldStopRef = useRef(false);
    const afterSeqRef = useRef(0);
    const consecutiveErrorsRef = useRef(0);

    // Clock offset: serverNow - clientNow. To convert serverTime to localTime,
    // subtract: localTime = serverTime - clockOffset.
    const clockOffsetRef = useRef(0);

    // Scheduling state
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
                if (!audioCtxRef.current || audioCtxRef.current.state === 'closed') {
                    const AC = window.AudioContext || (window as any).webkitAudioContext;
                    audioCtxRef.current = new AC();
                }
                afterSeqRef.current = 0;
                consecutiveErrorsRef.current = 0;
                resetSchedulingState();
            } else {
                audioCtxRef.current?.close();
                audioCtxRef.current = undefined;
                setIsPlaying(false);
                resetSchedulingState();
            }
            return next;
        });
    }, [resetSchedulingState]);

    /** Schedule one audio chunk into the AudioContext. Returns true if anything
     *  was queued. Mutates scheduling refs. */
    const scheduleChunk = useCallback(
        (
            ctx: AudioContext,
            playAtServerTime: number,
            incarnation: number,
            sampleRate: number,
            channels: number,
            sampleCount: number,
            floatArray: Float32Array,
        ): boolean => {
            const numSamples = sampleCount / channels;
            if (numSamples <= 0) return false;

            const playAtRealTime = playAtServerTime - clockOffsetRef.current;
            const audioLenMs = (1000 * numSamples) / sampleRate;
            const dn = Date.now();
            const actNow = ctx.currentTime * 1000;

            let startTimeMs: number;
            if (incarnation !== incarnationRef.current || playAtRealTime !== playAtNextRealTimeRef.current) {
                incarnationRef.current = incarnation;
                playAtNextRealTimeRef.current = playAtRealTime;
                startTimeMs = actNow + (playAtRealTime - dn);
                playAtNextACTRef.current = startTimeMs;
            } else {
                startTimeMs = playAtNextACTRef.current!;
            }

            const idealStart = actNow + (playAtRealTime - dn);
            if (Math.abs(startTimeMs - idealStart) > 50) {
                startTimeMs = idealStart;
                playAtNextRealTimeRef.current = playAtRealTime;
                playAtNextACTRef.current = startTimeMs;
            }

            playAtNextRealTimeRef.current! += audioLenMs;
            playAtNextACTRef.current = startTimeMs + audioLenMs;

            if (playAtRealTime < dn) return false; // already past — drop

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
            return true;
        },
        [],
    );

    useEffect(() => {
        if (!baseUrl || !audioEnabled) {
            shouldStopRef.current = true;
            return;
        }

        shouldStopRef.current = false;

        const audioBridgeUrl = deriveAudioBridgeWsUrl(baseUrl);

        // WS path: server pushes binary chunk frames; we refine clockOffset
        // from each arrival as a running max(serverNow - browserNow).
        if (audioBridgeUrl) {
            const ctxAtMount = audioCtxRef.current;
            if (!ctxAtMount) return;

            let ws: WebSocket | null = null;
            let clockRefreshTimer: ReturnType<typeof setInterval> | null = null;

            // Bootstrap clockOffset via /api/time so the first few chunks land
            // close to schedule even before the running-max has settled.
            void estimateClockOffset(baseUrl).then((o) => {
                clockOffsetRef.current = o;
            });
            clockRefreshTimer = setInterval(async () => {
                if (shouldStopRef.current) return;
                const o = await estimateClockOffset(baseUrl);
                if (!shouldStopRef.current) clockOffsetRef.current = o;
            }, CLOCK_REFRESH_INTERVAL_MS);

            try {
                ws = new WebSocket(audioBridgeUrl);
                ws.binaryType = 'arraybuffer';
            } catch (err) {
                console.warn('[useAudioStream] WS dial failed:', err);
                shouldStopRef.current = true;
                return;
            }

            ws.onmessage = (ev) => {
                if (shouldStopRef.current) return;
                const ctx = audioCtxRef.current;
                if (!ctx || ctx.state === 'closed') return;
                const data = ev.data;
                if (!(data instanceof ArrayBuffer) || data.byteLength < 32) return;

                const view = new DataView(data);
                const serverNow = view.getFloat64(0, true);
                const playAtServerTime = view.getFloat64(8, true);
                const incarnation = view.getUint32(16, true);
                const sampleRate = view.getUint32(20, true);
                const channels = view.getUint32(24, true);
                const sampleCount = view.getUint32(28, true);
                const floatArray = new Float32Array(data, 32, sampleCount);

                // Refine clockOffset: serverNow - browserNow on arrival is at most
                // clockOffset (when one-way delay is ~0). Running max approaches
                // true clockOffset over many samples.
                const candidate = serverNow - Date.now();
                if (candidate > clockOffsetRef.current) {
                    clockOffsetRef.current = candidate;
                }

                if (scheduleChunk(ctx, playAtServerTime, incarnation, sampleRate, channels, sampleCount, floatArray)) {
                    setIsPlaying(true);
                }
            };
            ws.onerror = (err) => {
                console.warn('[useAudioStream] WS error:', err);
            };
            ws.onclose = () => {
                // Don't auto-reconnect from inside the hook — user can re-toggle.
            };

            return () => {
                shouldStopRef.current = true;
                if (clockRefreshTimer) clearInterval(clockRefreshTimer);
                ws?.close();
            };
        }

        // HTTP poll fallback (LAN / no audio bridge derivable).
        const runPollLoop = async () => {
            clockOffsetRef.current = await estimateClockOffset(baseUrl);

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
                        const playAtServerTime = view.getFloat64(offset, true); offset += 8;
                        const incarnation = view.getUint32(offset, true); offset += 4;
                        const sampleRate = view.getUint32(offset, true); offset += 4;
                        const channels = view.getUint32(offset, true); offset += 4;
                        const sampleCount = view.getUint32(offset, true); offset += 4;
                        const floatArray = new Float32Array(data, offset, sampleCount);
                        offset += sampleCount * 4;
                        if (scheduleChunk(ctx, playAtServerTime, incarnation, sampleRate, channels, sampleCount, floatArray)) {
                            didSchedule = true;
                        }
                    }

                    if (didSchedule) setIsPlaying(true);
                    continue;
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
            }
        };

        runPollLoop();

        return () => {
            shouldStopRef.current = true;
        };
    }, [baseUrl, audioEnabled, pollIntervalMs, scheduleChunk]);

    return { audioEnabled, toggleAudio, isPlaying };
}
