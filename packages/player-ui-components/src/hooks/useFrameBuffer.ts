import { useState, useEffect, useRef } from 'react';
import { LatestFrameRingBuffer } from '@ezplayer/ezplayer-core';

export interface UseFrameBufferOptions {
    baseUrl: string | undefined;
    pollIntervalMs?: number;
    enabled?: boolean;
}

export interface UseFrameBufferResult {
    buffer: LatestFrameRingBuffer | undefined;
}

const DEFAULT_POLL_INTERVAL = 16; // Target ~60fps, actual rate limited by network
const DEFAULT_SLOT_COUNT = 4;

export function useFrameBuffer(options: UseFrameBufferOptions): UseFrameBufferResult {
    const { baseUrl, pollIntervalMs = DEFAULT_POLL_INTERVAL, enabled = true } = options;

    // Buffer reference - only set once when created
    const [buffer, setBuffer] = useState<LatestFrameRingBuffer | undefined>();

    // Refs for mutable state in polling loop
    const bufferRef = useRef<ArrayBuffer | undefined>();
    const ringRef = useRef<LatestFrameRingBuffer | undefined>();
    const frameSizeRef = useRef(0);
    const shouldStopRef = useRef(false);

    useEffect(() => {
        if (!baseUrl || !enabled) {
            shouldStopRef.current = true;
            return;
        }

        shouldStopRef.current = false;

        // Poll loop - waits for previous request to complete before starting next
        const runPollLoop = async () => {
            while (!shouldStopRef.current) {
                try {
                    const response = await fetch(`${baseUrl}/api/frames`);

                    if (shouldStopRef.current) return;

                    if (response.status === 204 || !response.ok) {
                        // No data or error - just continue polling
                        await new Promise(resolve => setTimeout(resolve, pollIntervalMs));
                        continue;
                    }

                    const data = await response.arrayBuffer();
                    if (data.byteLength < 8) {
                        await new Promise(resolve => setTimeout(resolve, pollIntervalMs));
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

                    // Write frame data to ring buffer - Viewer3D reads from here
                    const frameData = new Uint8Array(data, 8);
                    ringRef.current?.publishFrom(frameData);

                } catch {
                    // Silently continue on errors
                }

                await new Promise(resolve => setTimeout(resolve, pollIntervalMs));
            }
        };

        runPollLoop();

        return () => {
            shouldStopRef.current = true;
        };
    }, [baseUrl, enabled, pollIntervalMs]);

    return { buffer };
}
