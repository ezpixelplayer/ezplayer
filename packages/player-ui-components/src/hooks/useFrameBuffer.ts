import { useState, useEffect, useRef } from 'react';
import { LatestFrameRingBuffer } from '@ezplayer/ezplayer-core';
import { ZSTDDecoder } from '../util/zstd-decoder';

export interface UseFrameBufferOptions {
    baseUrl: string | undefined;
    pollIntervalMs?: number;
    enabled?: boolean;
    compressed?: boolean;
}

export interface UseFrameBufferResult {
    buffer: LatestFrameRingBuffer | undefined;
}

const DEFAULT_POLL_INTERVAL = 16; // Target ~60fps, actual rate limited by network
const DEFAULT_SLOT_COUNT = 4;

export function useFrameBuffer(options: UseFrameBufferOptions): UseFrameBufferResult {
    const { baseUrl, pollIntervalMs = DEFAULT_POLL_INTERVAL, enabled = true, compressed = false } = options;

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
    
    // Track consecutive errors to stop polling on persistent failures
    const consecutiveErrorsRef = useRef(0);
    const lastErrorTimeRef = useRef(0);
    const MAX_CONSECUTIVE_ERRORS = 5; // Stop after 5 consecutive 404s
    const ERROR_RESET_INTERVAL = 5000; // Reset error count after 5 seconds of success

    useEffect(() => {
        if (!baseUrl || !enabled) {
            shouldStopRef.current = true;
            return;
        }

        shouldStopRef.current = false;

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

                    // Handle 404 errors - stop polling if endpoint doesn't exist
                    if (response.status === 404) {
                        consecutiveErrorsRef.current++;
                        if (consecutiveErrorsRef.current === 1) {
                            // Only log once to avoid spam
                            console.warn(`[useFrameBuffer] Endpoint not found: ${baseUrl}${endpoint}. This is normal if the server isn't running or frame data isn't available.`);
                        }
                        if (consecutiveErrorsRef.current >= MAX_CONSECUTIVE_ERRORS) {
                            console.warn(`[useFrameBuffer] Stopping polling after ${MAX_CONSECUTIVE_ERRORS} consecutive 404 errors. The endpoint ${baseUrl}${endpoint} is not available.`);
                            shouldStopRef.current = true;
                            return;
                        }
                        // Use longer interval for 404s to reduce spam
                        await new Promise((resolve) => setTimeout(resolve, pollIntervalMs * 10));
                        continue;
                    }

                    if (response.status === 204) {
                        // No data available - reset error count on successful connection
                        consecutiveErrorsRef.current = 0;
                        await new Promise((resolve) => setTimeout(resolve, pollIntervalMs));
                        continue;
                    }

                    if (!response.ok) {
                        // Other errors - log and continue with backoff
                        consecutiveErrorsRef.current++;
                        if (consecutiveErrorsRef.current <= 3) {
                            console.warn(`[useFrameBuffer] Error fetching frames: ${response.status} ${response.statusText}`);
                        }
                        if (consecutiveErrorsRef.current >= MAX_CONSECUTIVE_ERRORS) {
                            console.warn(`[useFrameBuffer] Stopping polling after ${MAX_CONSECUTIVE_ERRORS} consecutive errors.`);
                            shouldStopRef.current = true;
                            return;
                        }
                        await new Promise((resolve) => setTimeout(resolve, pollIntervalMs * 5));
                        continue;
                    }

                    // Success - reset error count
                    consecutiveErrorsRef.current = 0;
                    lastErrorTimeRef.current = Date.now();

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
                    // Network errors or other exceptions
                    consecutiveErrorsRef.current++;
                    if (consecutiveErrorsRef.current <= 3) {
                        console.warn(`[useFrameBuffer] Network error:`, error instanceof Error ? error.message : String(error));
                    }
                    if (consecutiveErrorsRef.current >= MAX_CONSECUTIVE_ERRORS) {
                        console.warn(`[useFrameBuffer] Stopping polling after ${MAX_CONSECUTIVE_ERRORS} consecutive network errors.`);
                        shouldStopRef.current = true;
                        return;
                    }
                    // Use longer interval for network errors
                    await new Promise((resolve) => setTimeout(resolve, pollIntervalMs * 5));
                    continue;
                }

                await new Promise((resolve) => setTimeout(resolve, pollIntervalMs));
            }
        };

        runPollLoop();

        return () => {
            shouldStopRef.current = true;
        };
    }, [baseUrl, enabled, pollIntervalMs, compressed]);

    return { buffer };
}
