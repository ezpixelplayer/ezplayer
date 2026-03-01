import { useState, useEffect, useRef } from 'react';
import { LatestFrameRingBuffer } from '@ezplayer/ezplayer-core';
import { ZSTDDecoder } from '../util/zstd-decoder';

export interface UseFrameBufferOptions {
    baseUrl: string | undefined;
    pollIntervalMs?: number;
    enabled?: boolean;
    compressed?: boolean;
    /** Change this value to force-restart the poll loop (e.g. on show folder change). */
    resetKey?: string | number;
}

export interface UseFrameBufferResult {
    buffer: LatestFrameRingBuffer | undefined;
}

const DEFAULT_POLL_INTERVAL = 16; // Target ~60fps, actual rate limited by network
const DEFAULT_SLOT_COUNT = 4;

export function useFrameBuffer(options: UseFrameBufferOptions): UseFrameBufferResult {
    const { baseUrl, pollIntervalMs = DEFAULT_POLL_INTERVAL, enabled = true, compressed = false, resetKey } = options;

    // Buffer reference - only set once when created
    const [buffer, setBuffer] = useState<LatestFrameRingBuffer | undefined>();

    // Refs for mutable state in polling loop
    const bufferRef = useRef<ArrayBuffer | undefined>();
    const ringRef = useRef<LatestFrameRingBuffer | undefined>();
    const frameSizeRef = useRef(0);
    const shouldStopRef = useRef(false);

    // ZSTD decoder ref - initialized once, reused for zero-alloc decode
    const zstdDecoderRef = useRef<ZSTDDecoder | undefined>(undefined);
    const zstdReadyRef = useRef(false);
    // Reusable decode output buffer - grows as needed, avoids per-frame allocation
    const decodeBufferRef = useRef<Uint8Array | undefined>(undefined);

    // Track consecutive errors for backoff scaling and log spam prevention
    const consecutiveErrorsRef = useRef(0);

    useEffect(() => {
        if (!baseUrl || !enabled) {
            shouldStopRef.current = true;
            return;
        }

        // Reset all mutable state so a fresh poll loop starts clean.
        // This is critical when resetKey changes (e.g. show folder switch) —
        // the previous loop may have stopped due to errors.
        shouldStopRef.current = false;
        consecutiveErrorsRef.current = 0;
        bufferRef.current = undefined;
        ringRef.current = undefined;
        frameSizeRef.current = 0;
        setBuffer(undefined);

        // Initialize ZSTD decoder if compressed mode requested
        if (compressed && !zstdDecoderRef.current) {
            const decoder = new ZSTDDecoder();
            zstdDecoderRef.current = decoder;
            decoder.init().then(() => {
                zstdReadyRef.current = true;
            });
        }

        const endpoint = compressed ? '/api/frames-zstd' : '/api/frames';

        // Poll loop - waits for previous request to complete before starting next
        const runPollLoop = async () => {
            while (!shouldStopRef.current) {
                try {
                    const response = await fetch(`${baseUrl}${endpoint}`);

                    if (shouldStopRef.current) return;

                    // Handle 404 errors — back off but keep trying
                    if (response.status === 404) {
                        consecutiveErrorsRef.current++;
                        if (consecutiveErrorsRef.current === 1) {
                            console.warn(`[useFrameBuffer] Endpoint not found: ${baseUrl}${endpoint}. Will keep retrying.`);
                        }
                        // Back off progressively: 160ms, 320ms, … up to ~5s
                        const backoff = Math.min(pollIntervalMs * 10 * Math.pow(2, Math.min(consecutiveErrorsRef.current - 1, 5)), 5000);
                        await new Promise((resolve) => setTimeout(resolve, backoff));
                        continue;
                    }

                    if (response.status === 204) {
                        // No data available — server frame buffer is empty (e.g. show
                        // folder just changed).  Clear local buffer so viewers stop
                        // rendering stale data.  A new buffer will be created once
                        // the server starts returning frames again.
                        consecutiveErrorsRef.current = 0;
                        if (bufferRef.current) {
                            bufferRef.current = undefined;
                            ringRef.current = undefined;
                            frameSizeRef.current = 0;
                            setBuffer(undefined);
                        }
                        await new Promise((resolve) => setTimeout(resolve, pollIntervalMs));
                        continue;
                    }

                    if (!response.ok) {
                        consecutiveErrorsRef.current++;
                        if (consecutiveErrorsRef.current <= 3) {
                            console.warn(`[useFrameBuffer] Error fetching frames: ${response.status} ${response.statusText}`);
                        }
                        const backoff = Math.min(pollIntervalMs * 5 * Math.pow(2, Math.min(consecutiveErrorsRef.current - 1, 5)), 5000);
                        await new Promise((resolve) => setTimeout(resolve, backoff));
                        continue;
                    }

                    // Success - reset error count
                    consecutiveErrorsRef.current = 0;

                    const data = await response.arrayBuffer();
                    if (data.byteLength < 8) {
                        await new Promise((resolve) => setTimeout(resolve, pollIntervalMs));
                        continue;
                    }

                    // Parse header
                    const view = new DataView(data);
                    const newFrameSize = view.getUint32(0, true);

                    // Allocate buffer if needed (only triggers React state once)
                    if (newFrameSize !== frameSizeRef.current || !bufferRef.current) {
                        const needed = LatestFrameRingBuffer.requiredBytes(newFrameSize, DEFAULT_SLOT_COUNT);
                        bufferRef.current = new ArrayBuffer(needed);
                        ringRef.current = new LatestFrameRingBuffer({
                            buffer: bufferRef.current,
                            frameSize: newFrameSize,
                            slotCount: DEFAULT_SLOT_COUNT,
                            isWriter: true,
                        });
                        frameSizeRef.current = newFrameSize;
                        setBuffer(ringRef.current); // Only React state update - happens once
                    }

                    // Get frame data - decompress if using compressed endpoint
                    let frameData: Uint8Array;
                    if (compressed && zstdReadyRef.current && zstdDecoderRef.current) {
                        const compressedData = new Uint8Array(data, 8);
                        // Reuse decode buffer - grow if frame size changed
                        if (!decodeBufferRef.current || decodeBufferRef.current.byteLength < newFrameSize) {
                            decodeBufferRef.current = new Uint8Array(newFrameSize);
                        }
                        zstdDecoderRef.current.decode(compressedData, decodeBufferRef.current, newFrameSize);
                        frameData = decodeBufferRef.current;
                    } else {
                        frameData = new Uint8Array(data, 8);
                    }

                    // Write frame data to ring buffer - Viewer3D reads from here
                    ringRef.current?.publishFrom(frameData);
                } catch (error) {
                    consecutiveErrorsRef.current++;
                    if (consecutiveErrorsRef.current <= 3) {
                        console.warn(`[useFrameBuffer] Network error:`, error instanceof Error ? error.message : String(error));
                    }
                    const backoff = Math.min(pollIntervalMs * 5 * Math.pow(2, Math.min(consecutiveErrorsRef.current - 1, 5)), 5000);
                    await new Promise((resolve) => setTimeout(resolve, backoff));
                    continue;
                }

                await new Promise((resolve) => setTimeout(resolve, pollIntervalMs));
            }
        };

        runPollLoop();

        return () => {
            shouldStopRef.current = true;
        };
    }, [baseUrl, enabled, pollIntervalMs, compressed, resetKey]);

    return { buffer };
}
