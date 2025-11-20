/**
 * WebSocket client service for React app
 * Connects to Electron's WebSocket server and manages subscriptions
 */

export interface WebSocketMessage {
    type: string;
    data: any;
    timestamp?: number;
}

export type MessageHandler<T = any> = (data: T) => void;
type ConnectionHandler = () => void;
type ErrorHandler = (error: Event) => void;

class WebSocketService {
    private ws: WebSocket | null = null;
    private url: string;
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

    constructor(port: number = 3000) {
        const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
        const hostname = window.location.hostname || 'localhost';
        this.url = `${protocol}//${hostname}:${port}/ws`;
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
                    const message: WebSocketMessage = JSON.parse(event.data);
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

                if (event.code !== 1000) {
                    this.scheduleReconnect();
                }
            };
        } catch (error) {
            console.error('Error creating WebSocket connection:', error);
            this.isConnecting = false;
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
    private handleMessage(message: WebSocketMessage): void {
        const handlers = this.messageHandlers.get(message.type);
        if (handlers) {
            handlers.forEach((handler) => {
                try {
                    handler(message.data);
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

    /**
     * Get connection status
     */
    getConnectionStatus(): boolean {
        return this.isConnected && this.ws?.readyState === WebSocket.OPEN;
    }
}

// Singleton instance
let wsServiceInstance: WebSocketService | null = null;

/**
 * Get or create WebSocket service instance
 */
export function getWebSocketService(port?: number): WebSocketService {
    if (!wsServiceInstance) {
        wsServiceInstance = new WebSocketService(port);
    }
    return wsServiceInstance;
}

/**
 * Get WebSocket port from environment or use default
 */
function getWebSocketPort(): number {
    // Try to get port from window location if available
    const port = window.location.port;
    if (port) {
        return parseInt(port, 10);
    }

    // Try environment variable
    const envPort = import.meta.env.VITE_WS_PORT;
    if (envPort) {
        return parseInt(envPort, 10);
    }

    // Default port
    return 3000;
}

// Export default instance
export const wsService = getWebSocketService(getWebSocketPort());
