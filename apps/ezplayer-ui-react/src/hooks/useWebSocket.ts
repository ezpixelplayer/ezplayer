/**
 * React hook for WebSocket subscriptions
 */

import React, { useEffect, useRef } from 'react';
import { wsService, type MessageHandler } from '../services/websocket';

/**
 * Hook to subscribe to WebSocket messages
 * @param type - Message type to subscribe to
 * @param handler - Handler function to call when message is received
 * @param deps - Dependencies array (like useEffect)
 */
export function useWebSocket<T = any>(type: string, handler: MessageHandler<T>, deps: React.DependencyList = []): void {
    const handlerRef = useRef(handler);

    // Update handler ref when it changes
    useEffect(() => {
        handlerRef.current = handler;
    }, [handler]);

    useEffect(() => {
        // Create a stable wrapper that uses the latest handler
        const wrappedHandler: MessageHandler = (data: any) => {
            handlerRef.current(data);
        };

        const unsubscribe = wsService.subscribe(type, wrappedHandler);

        return () => {
            unsubscribe();
        };
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [type, ...deps]);
}

/**
 * Hook to get WebSocket connection status
 */
export function useWebSocketStatus(): boolean {
    const [isConnected, setIsConnected] = React.useState(false);

    useEffect(() => {
        const checkStatus = () => {
            setIsConnected(wsService.getConnectionStatus());
        };

        // Check initial status
        checkStatus();

        // Subscribe to connection events
        const unsubscribeConnect = wsService.onConnect(() => {
            setIsConnected(true);
        });

        // Check status periodically (fallback)
        const interval = setInterval(checkStatus, 1000);

        return () => {
            unsubscribeConnect();
            clearInterval(interval);
        };
    }, []);

    return isConnected;
}

/**
 * Hook to initialize WebSocket connection
 * Call this once at the app level
 */
export function useWebSocketConnection(): void {
    useEffect(() => {
        wsService.connect();

        return () => {
            wsService.disconnect();
        };
    }, []);
}
