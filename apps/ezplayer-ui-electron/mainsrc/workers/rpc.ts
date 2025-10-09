import { RPCRequest, RPCResponse, RPCHandler } from './rpctypes';

export type MessageEndpoint = {
    postMessage(value: any): void;
};

export class RPCClient<Methods extends Record<string, (...args: any[]) => any>> {
    private requestId = 1;
    private pending = new Map<number, { resolve: (result: unknown) => void; reject: (e: Error) => void }>();

    constructor(private port: MessageEndpoint) {}

    dispatchResponse(msg: RPCResponse) {
        const { id, result, error } = msg;
        const entry = this.pending.get(id);
        if (!entry) return;
        error ? entry.reject(new Error(error)) : entry.resolve(result);
        this.pending.delete(id);
    }

    async call<K extends keyof Methods>(
        method: K,
        params: Parameters<Methods[K]>[0],
    ): Promise<Awaited<ReturnType<Methods[K]>>> {
        const id = this.requestId++;
        this.port.postMessage({ type: 'rpc', rpc: { id, method, params } as RPCRequest });
        return new Promise<Awaited<ReturnType<Methods[K]>>>((resolve, reject) => {
            this.pending.set(id, { resolve: resolve as (r: unknown) => void, reject });
        });
    }
}

export class RPCServer<Methods extends Record<string, (...args: any[]) => any>> {
    constructor(
        private port: MessageEndpoint,
        private handlers: RPCHandler<Methods>,
    ) {
        if (!port) throw new Error('Not running in a worker thread');
    }

    async dispatchRequest(msg: RPCRequest) {
        const { id, method, params } = msg;

        try {
            const handler = this.handlers[method as keyof Methods];
            if (!handler) throw new Error(`Unknown method: ${method}`);

            const result = await handler(params as any);
            this.port.postMessage({ type: 'rpc-response', response: { id, result } as RPCResponse });
        } catch (err: any) {
            this.port.postMessage({
                type: 'rpc-response',
                response: { id, error: err.message || 'Unknown error' } as RPCResponse,
            });
        }
    }
}
