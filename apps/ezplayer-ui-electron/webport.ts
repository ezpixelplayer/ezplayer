import Store from 'electron-store'; // TODO: Remove, maybe keep in show folder

const store = new Store<{ webPort?: number }>();

const DEFAULT_PORT = 3000;
const MIN_PORT = 1024;
const MAX_PORT = 65535;

/**
 * Parse web port from command line arguments
 * Supports format:
 * - --web-port=3000
 */
function parseCliForWebPort(argv: string[]): number | undefined {
    // Check for --web-port=<n>
    const wparg = argv.find((a) => a.startsWith('--web-port='));
    if (wparg) {
        const portStr = wparg.split('=')[1];
        const port = parseInt(portStr, 10);
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
export function getWebPort(): { port: number; source: string } {
    // 1. Check CLI arguments first
    const cliPort = parseCliForWebPort(process.argv);
    if (cliPort !== undefined && isValidPort(cliPort)) {
        store.set('webPort', cliPort);
        return { port: cliPort, source: 'CLI argument' };
    }

    // 2. Check environment variable
    if (process.env.EZPLAYER_WEB_PORT) {
        const envPort = parseInt(process.env.EZPLAYER_WEB_PORT, 10);
        if (!isNaN(envPort) && isValidPort(envPort)) {
            store.set('webPort', envPort);
            return { port: envPort, source: 'Environment variable (EZPLAYER_WEB_PORT)' };
        }
    }

    // 3. Check stored preference
    const storedPort = store.get('webPort');
    if (storedPort !== undefined && isValidPort(storedPort)) {
        return { port: storedPort, source: 'Stored preference' };
    }

    // 4. Return default
    return { port: DEFAULT_PORT, source: 'Default' };
}
