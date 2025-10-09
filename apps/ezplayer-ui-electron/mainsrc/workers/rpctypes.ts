export type RPCRequest = {
    id: number;
    method: string;
    params: unknown;
};

export type RPCResponse = {
    id: number;
    result?: unknown;
    error?: string;
};

export type RPCHandler<Methods extends Record<string, (...args: any[]) => any>> = {
    [K in keyof Methods]: (args: Parameters<Methods[K]>[0]) => ReturnType<Methods[K]> | Promise<ReturnType<Methods[K]>>;
};
