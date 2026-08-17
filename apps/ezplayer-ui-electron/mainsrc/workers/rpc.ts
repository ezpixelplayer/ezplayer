import { RPCRequest, RPCResponse, RPCHandler } from './rpctypes';

export type MessageEndpoint = {
    postMessage(value: unknown): void;
};

export class RPCClient<Methods extends Record<string, (...args: never[]) => unknown>> {
    private requestId = 1;
    private pending = new Map<number, { resolve: (result: unknown) => void; reject: (e: Error) => void }>();

    constructor(private port: MessageEndpoint) {}

    dispatchResponse(msg: RPCResponse) {
        const { id, result, error } = msg;
        const entry = this.pending.get(id);
        if (!entry) return;
        if (error) entry.reject(new Error(error));
        else entry.resolve(result);
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

export class RPCServer<Methods extends Record<string, (...args: never[]) => unknown>> {
    constructor(
        private port: MessageEndpoint,
        private handlers: RPCHandler<Methods>,
    ) {
        if (!port) throw new Error('Not running in a worker thread');
    }

    async dispatchRequest(msg: RPCRequest) {
        const { id, method, params } = msg;

        try {
            const handler = this.handlers[method as keyof Methods] as
                ((args: unknown) => unknown | Promise<unknown>) | undefined;
            if (!handler) throw new Error(`Unknown method: ${method}`);

            const result = await handler(params);
            this.port.postMessage({ type: 'rpc-response', response: { id, result } as RPCResponse });
        } catch (err) {
            this.port.postMessage({
                type: 'rpc-response',
                response: { id, error: (err as Error).message || 'Unknown error' } as RPCResponse,
            });
        }
    }
}
