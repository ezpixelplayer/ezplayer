/**
 * Where error boundaries send what they catch. The host app installs a sink
 * (the Electron renderer forwards to main's crash reporter); without one,
 * errors only reach the console.
 */

type UiErrorSink = (message: string, stack?: string) => void;

let sink: UiErrorSink | undefined;

export function setUiErrorReporter(fn: UiErrorSink | undefined): void {
    sink = fn;
}

export function reportUiError(where: string, error: unknown, componentStack?: string | null): void {
    try {
        const e = error as { message?: string; stack?: string } | undefined;
        const message = `${where}: ${String(e?.message ?? error)}`;
        const stack = [e?.stack, componentStack ? `Component stack:${componentStack}` : undefined]
            .filter(Boolean)
            .join('\n');
        sink?.(message, stack || undefined);
    } catch {
        /* reporting must not throw inside a boundary */
    }
}
