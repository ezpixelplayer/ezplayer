/**
 * WebSocket client service for React app
 * Connects to Electron's WebSocket server and manages subscriptions
 */

import { PlayerClientWebSocketMessage, type PlayerWebSocketMessage } from "@ezplayer/ezplayer-core";

export type MessageHandler = (msg: PlayerWebSocketMessage) => void;
type ConnectionHandler = () => void;
type ErrorHandler = (error: Event) => void;

interface WebSocketConfig {
    explicitUrl?: string;
    protocol: string;
    host: string;
    candidatePorts: number[];
}

function toProtocol(specified?: string): string {
    const trimmed = specified?.trim();
    if (!trimmed) {
        return window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    }
    return trimmed.endsWith(':') ? trimmed : `${trimmed}:`;
}

function toHost(specified?: string): string {
    if (specified?.trim()) {
        return specified.trim();
    }
    return window.location.hostname || 'localhost';
}

function toPort(value?: string | number | null | undefined): number | undefined {
    if (value === undefined || value === null) {
        return undefined;
    }
    const parsed = parseInt(`${value}`.trim(), 10);
    return Number.isFinite(parsed) ? parsed : undefined;
}

function buildConfig(): WebSocketConfig {
    const explicitUrlEnv = import.meta.env.VITE_WS_BASE_URL?.trim();
    if (explicitUrlEnv) {
        const sanitized = explicitUrlEnv.replace(/\/+$/, '');
        return {
            explicitUrl: `${sanitized}/ws`,
            protocol: '',
            host: '',
            candidatePorts: [],
        };
    }

    const envPort = toPort(import.meta.env.VITE_WS_PORT);
    const locationPort = typeof window !== 'undefined' ? toPort(window.location.port) : undefined;
    const defaultPort = 3000;
    const candidatePorts = [envPort, locationPort, defaultPort]
        .filter((port): port is number => typeof port === 'number' && port > 0)
        .filter((port, index, arr) => arr.indexOf(port) === index);

    if (candidatePorts.length === 0) {
        candidatePorts.push(defaultPort);
    }

    return {
        protocol: toProtocol(import.meta.env.VITE_WS_PROTOCOL),
        host: toHost(import.meta.env.VITE_WS_HOST),
        candidatePorts,
    };
}

class WebSocketService {
    private ws: WebSocket | null = null;
    private url: string;
    private config: WebSocketConfig;
    private currentPortIndex = 0;
    private httpBaseUrl?: string;
    private reconnectAttempts = 0;
    private maxReconnectAttempts = 10;
    private reconnectDelay = 1000; // Start with 1 second
    private maxReconnectDelay = 30000; // Max 30 seconds
    private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
    private messageHandlers: Map<string, Set<MessageHandler>> = new Map();
    private connectionHandlers: Set<ConnectionHandler> = new Set();
    private errorHandlers: Set<ErrorHandler> = new Set();
    private isConnecting = false;
    private isConnected = false;
    private hasConnectedSuccessfully = false;

    constructor() {
        this.config = buildConfig();
        this.url = this.computeUrl();
        this.updateHttpBaseFromWsUrl();
    }

    private computeUrl(): string {
        if (this.config.explicitUrl) {
            return this.config.explicitUrl;
        }
        const port = this.config.candidatePorts[this.currentPortIndex] ?? 3000;
        return `${this.config.protocol}//${this.config.host}:${port}/ws`;
    }

    private updateHttpBaseFromWsUrl(): void {
        try {
            const parsed = new URL(this.url);
            const protocol = parsed.protocol === 'wss:' ? 'https:' : 'http:';
            this.httpBaseUrl = `${protocol}//${parsed.host}`;
        } catch {
            this.httpBaseUrl = undefined;
        }
    }

    private advancePortCandidate(): boolean {
        if (this.config.explicitUrl) {
            return false;
        }
        if (this.currentPortIndex >= this.config.candidatePorts.length - 1) {
            return false;
        }
        this.currentPortIndex += 1;
        this.url = this.computeUrl();
        this.updateHttpBaseFromWsUrl();
        console.warn(
            `🔁 Retrying WebSocket connection on alternate port ${this.config.candidatePorts[this.currentPortIndex]}`,
        );
        return true;
    }

    /**
     * Connect to WebSocket server
     */
    connect(): void {
        if (this.isConnecting || this.isConnected) {
            return;
        }

        // Don't try to connect if we're in Electron renderer (use IPC instead)
        // @ts-ignore - window.electronAPI might not exist in web version
        if (typeof window !== 'undefined' && window.electronAPI) {
            return;
        }

        this.isConnecting = true;
        console.log(`🔌 Connecting to WebSocket at ${this.url}`);

        try {
            this.ws = new WebSocket(this.url);

            this.ws.onopen = () => {
                console.log('✅ WebSocket connected');
                this.isConnecting = false;
                this.isConnected = true;
                this.hasConnectedSuccessfully = true;
                this.reconnectAttempts = 0;
                this.reconnectDelay = 1000;

                // Notify connection handlers
                this.connectionHandlers.forEach((handler) => {
                    try {
                        handler();
                    } catch (error) {
                        console.error('Error in connection handler:', error);
                    }
                });
            };

            this.ws.onmessage = (event) => {
                try {
                    const message: PlayerWebSocketMessage = JSON.parse(event.data);
                    this.handleMessage(message);
                } catch (error) {
                    console.error('Error parsing WebSocket message:', error);
                }
            };

            this.ws.onerror = (error) => {
                if (this.reconnectAttempts < this.maxReconnectAttempts) {
                    console.warn('❌ WebSocket connection error (will retry):', error);
                }
                this.errorHandlers.forEach((handler) => {
                    try {
                        handler(error);
                    } catch (err) {
                        // Silently handle errors in error handlers to prevent crashes
                    }
                });
            };

            this.ws.onclose = (event) => {
                if (event.code !== 1000 && this.reconnectAttempts < this.maxReconnectAttempts) {
                    console.log(`🔌 WebSocket disconnected (code: ${event.code})`);
                }
                this.isConnecting = false;
                this.isConnected = false;
                this.ws = null;
                const advancedPort = !this.hasConnectedSuccessfully && this.advancePortCandidate();
                if (advancedPort) {
                    this.reconnectAttempts = 0;
                    this.reconnectDelay = 1000;
                }

                if (event.code !== 1000) {
                    this.scheduleReconnect();
                }
            };
        } catch (error) {
            console.error('Error creating WebSocket connection:', error);
            this.isConnecting = false;
            if (!this.hasConnectedSuccessfully && this.advancePortCandidate()) {
                this.reconnectAttempts = 0;
                this.reconnectDelay = 1000;
            }
            if (this.reconnectAttempts < this.maxReconnectAttempts) {
                this.scheduleReconnect();
            }
        }
    }

    /**
     * Disconnect from WebSocket server
     */
    disconnect(): void {
        if (this.reconnectTimer) {
            clearTimeout(this.reconnectTimer);
            this.reconnectTimer = null;
        }

        if (this.ws) {
            this.ws.close();
            this.ws = null;
        }

        this.isConnecting = false;
        this.isConnected = false;
        this.reconnectAttempts = 0;
        console.log('🔌 WebSocket disconnected manually');
    }

    /**
     * Subscribe to a specific message type
     */
    subscribe(type: string, handler: MessageHandler): () => void {
        if (!this.messageHandlers.has(type)) {
            this.messageHandlers.set(type, new Set());
        }

        this.messageHandlers.get(type)!.add(handler);

        // Return unsubscribe function
        return () => {
            const handlers = this.messageHandlers.get(type);
            if (handlers) {
                handlers.delete(handler);
                if (handlers.size === 0) {
                    this.messageHandlers.delete(type);
                }
            }
        };
    }

    /**
     * Subscribe to connection events
     */
    onConnect(handler: ConnectionHandler): () => void {
        this.connectionHandlers.add(handler);
        return () => {
            this.connectionHandlers.delete(handler);
        };
    }

    /**
     * Subscribe to error events
     */
    onError(handler: ErrorHandler): () => void {
        this.errorHandlers.add(handler);
        return () => {
            this.errorHandlers.delete(handler);
        };
    }

    /**
     * Handle incoming message
     */
    private handleMessage(message: PlayerWebSocketMessage): void {
        const handlers = this.messageHandlers.get(message.type);
        if (handlers) {
            handlers.forEach((handler) => {
                try {
                    handler(message);
                } catch (error) {
                    console.error(`Error in handler for "${message.type}":`, error);
                }
            });
        }
    }

    /**
     * Schedule reconnection attempt
     */
    private scheduleReconnect(): void {
        if (this.reconnectAttempts >= this.maxReconnectAttempts) {
            console.warn(
                `⚠️  Max reconnection attempts (${this.maxReconnectAttempts}) reached. WebSocket will not reconnect automatically.`,
            );
            return;
        }

        if (this.reconnectTimer) {
            return; // Already scheduled
        }

        this.reconnectAttempts++;
        const delay = Math.min(this.reconnectDelay * Math.pow(2, this.reconnectAttempts - 1), this.maxReconnectDelay);

        if (this.reconnectAttempts <= 3) {
            console.log(`🔄 Scheduling reconnection attempt ${this.reconnectAttempts} in ${delay}ms`);
        }

        this.reconnectTimer = setTimeout(() => {
            this.reconnectTimer = null;
            this.connect();
        }, delay);
    }

    send(msg: PlayerClientWebSocketMessage) {
        if (!this.getConnectionStatus()) return;

        try {
            this.ws?.send(JSON.stringify(msg));
        } catch {
            // Reconnect?
        }
    }


    /**
     * Get connection status
     */
    getConnectionStatus(): boolean {
        return this.isConnected && this.ws?.readyState === WebSocket.OPEN;
    }

    getHttpBaseUrl(): string | undefined {
        return this.httpBaseUrl;
    }
}

const wsServiceInstance = new WebSocketService();

/**
 * Get or create WebSocket service instance
 */
export function getWebSocketService(): WebSocketService {
    return wsServiceInstance;
}

// Export default instance
export const wsService = wsServiceInstance;
