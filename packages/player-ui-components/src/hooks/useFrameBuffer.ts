import { useState, useEffect, useRef, useCallback } from 'react';
import { LatestFrameRingBuffer } from '@ezplayer/ezplayer-core';

export interface UseFrameBufferOptions {
    baseUrl: string | undefined;
    pollIntervalMs?: number;
    enabled?: boolean;
}

export interface UseFrameBufferResult {
    buffer: LatestFrameRingBuffer | undefined;
    isConnected: boolean;
    frameSize: number;
    lastSeq: number;
    error: string | null;
}

const DEFAULT_POLL_INTERVAL = 33; // ~30fps
const DEFAULT_SLOT_COUNT = 4;

export function useFrameBuffer(options: UseFrameBufferOptions): UseFrameBufferResult {
    const { baseUrl, pollIntervalMs = DEFAULT_POLL_INTERVAL, enabled = true } = options;

    const [isConnected, setIsConnected] = useState(false);
    const [frameSize, setFrameSize] = useState(0);
    const [lastSeq, setLastSeq] = useState(0);
    const [error, setError] = useState<string | null>(null);

    // Refs for mutable state in polling loop
    const bufferRef = useRef<ArrayBuffer | undefined>();
    const ringRef = useRef<LatestFrameRingBuffer | undefined>();
    const abortRef = useRef<AbortController | undefined>();
    const frameSizeRef = useRef(0);

    // Stable reference for the result buffer
    const [buffer, setBuffer] = useState<LatestFrameRingBuffer | undefined>();

    const poll = useCallback(async () => {
        if (!baseUrl || !enabled) return;

        try {
            abortRef.current = new AbortController();
            const response = await fetch(`${baseUrl}/api/frames`, {
                signal: abortRef.current.signal,
            });

            if (response.status === 204) {
                // No data available
                setIsConnected(true);
                return;
            }

            if (!response.ok) {
                throw new Error(`HTTP ${response.status}`);
            }

            const data = await response.arrayBuffer();
            if (data.byteLength < 8) {
                throw new Error('Response too small');
            }

            // Parse header
            const view = new DataView(data);
            const newFrameSize = view.getUint32(0, true);
            const seq = view.getUint32(4, true);

            // Allocate/reallocate buffer if frame size changed
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
                setFrameSize(newFrameSize);
                setBuffer(ringRef.current);
            }

            // Write frame data to local buffer
            const frameData = new Uint8Array(data, 8);
            ringRef.current?.publishFrom(frameData);
            console.log(`Published: ${seq}`);

            setLastSeq(seq);
            setIsConnected(true);
            setError(null);
        } catch (err) {
            if (err instanceof Error && err.name === 'AbortError') return;
            const errMsg = err instanceof Error ? err.message : 'Unknown error';
            console.error(`[useFrameBuffer] Fetch error: ${errMsg}`, err);
            setError(errMsg);
            setIsConnected(false);
        }
    }, [baseUrl, enabled]);

    useEffect(() => {
        if (!baseUrl || !enabled) {
            setIsConnected(false);
            return;
        }

        // Start polling
        const intervalId = setInterval(poll, pollIntervalMs);
        poll(); // Initial fetch

        return () => {
            clearInterval(intervalId);
            abortRef.current?.abort();
        };
    }, [baseUrl, enabled, pollIntervalMs, poll]);

    return { buffer, isConnected, frameSize, lastSeq, error };
}
