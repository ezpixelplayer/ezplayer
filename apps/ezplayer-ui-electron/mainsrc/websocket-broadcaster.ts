/**
 * WebSocket broadcaster utility
 * Manages WebSocket connections and broadcasts messages to all connected clients
 */

export interface WebSocketMessage {
    type: string;
    data: any;
    timestamp?: number;
}

class WebSocketBroadcaster {
    private wsServer: any = null;
    private clients: Set<any> = new Set();

    /**
     * Initialize the broadcaster with a WebSocket server
     */
    initialize(wsServer: any) {
        this.wsServer = wsServer;
        console.log('🔌 WebSocket broadcaster initialized');
    }

    /**
     * Add a client connection
     */
    addClient(client: any) {
        this.clients.add(client);
    }

    /**
     * Remove a client connection
     */
    removeClient(client: any) {
        this.clients.delete(client);
    }

    /**
     * Broadcast a message to all connected clients
     */
    broadcast(type: string, data: any) {
        if (this.clients.size === 0) {
            return; // No clients connected, skip broadcasting
        }

        const message: WebSocketMessage = {
            type,
            data,
            timestamp: Date.now(),
        };

        const messageStr = JSON.stringify(message);
        let errorCount = 0;

        this.clients.forEach((client) => {
            try {
                if (client.readyState === 1) {
                    // WebSocket.OPEN === 1
                    client.send(messageStr);
                } else {
                    // Client is not open, remove it
                    this.clients.delete(client);
                }
            } catch (error) {
                console.error(`Error broadcasting to WebSocket client:`, error);
                errorCount++;
                this.clients.delete(client);
            }
        });

        if (errorCount > 0) {
            console.warn(`⚠️  Failed to send to ${errorCount} client(s)`);
        }
    }

    /**
     * Get the number of connected clients
     */
    getClientCount(): number {
        return this.clients.size;
    }

    /**
     * Check if broadcaster is initialized
     */
    isInitialized(): boolean {
        return this.wsServer !== null;
    }
}

// Singleton instance
export const wsBroadcaster = new WebSocketBroadcaster();
