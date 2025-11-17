import Store from 'electron-store';

const store = new Store<{ webPort?: number }>();

const DEFAULT_PORT = 3000;
const MIN_PORT = 1024;
const MAX_PORT = 65535;

/**
 * Parse web port from command line arguments
 * Supports formats:
 * - --web-port=3000
 * - --webPort=3000
 * - --web-port 3000
 * - --webPort 3000
 */
function parseCliForWebPort(argv: string[]): number | undefined {
    // Check for --web-port=3000 or --webPort=3000 format
    const eq = argv.find((a) => a.startsWith('--web-port=') || a.startsWith('--webPort='));
    if (eq) {
        const portStr = eq.split('=')[1];
        const port = parseInt(portStr, 10);
        if (!isNaN(port)) return port;
    }

    // Check for --web-port 3000 or --webPort 3000 format
    const i = argv.findIndex((a) => a === '--web-port' || a === '--webPort');
    if (i >= 0 && argv[i + 1]) {
        const port = parseInt(argv[i + 1], 10);
        if (!isNaN(port)) return port;
    }

    return undefined;
}

/**
 * Validate port number is within acceptable range
 */
function isValidPort(port: number): boolean {
    return Number.isInteger(port) && port >= MIN_PORT && port <= MAX_PORT;
}

/**
 * Get web port from various sources in priority order:
 * 1. CLI arguments (highest priority)
 * 2. Environment variable EZPLAYER_WEB_PORT
 * 3. Stored preference
 * 4. Default port (3000)
 * @returns Object with port number and source information
 */
export function getWebPort(): number;
export function getWebPort(includeSource: false): number;
export function getWebPort(includeSource: true): { port: number; source: string };
export function getWebPort(includeSource = false): number | { port: number; source: string } {
    // 1. Check CLI arguments first
    const cliPort = parseCliForWebPort(process.argv);
    if (cliPort !== undefined && isValidPort(cliPort)) {
        store.set('webPort', cliPort);
        if (includeSource) return { port: cliPort, source: 'CLI argument' };
        return cliPort;
    }

    // 2. Check environment variable
    if (process.env.EZPLAYER_WEB_PORT) {
        const envPort = parseInt(process.env.EZPLAYER_WEB_PORT, 10);
        if (!isNaN(envPort) && isValidPort(envPort)) {
            store.set('webPort', envPort);
            if (includeSource) return { port: envPort, source: 'Environment variable (EZPLAYER_WEB_PORT)' };
            return envPort;
        }
    }

    // 3. Check stored preference
    const storedPort = store.get('webPort');
    if (storedPort !== undefined && isValidPort(storedPort)) {
        if (includeSource) return { port: storedPort, source: 'Stored preference' };
        return storedPort;
    }

    // 4. Return default
    if (includeSource) return { port: DEFAULT_PORT, source: 'Default' };
    return DEFAULT_PORT;
}

/**
 * Set web port preference (for future use, e.g., settings UI)
 */
export function setWebPort(port: number): boolean {
    if (!isValidPort(port)) {
        return false;
    }
    store.set('webPort', port);
    return true;
}

/**
 * Get the default port
 */
export function getDefaultPort(): number {
    return DEFAULT_PORT;
}
