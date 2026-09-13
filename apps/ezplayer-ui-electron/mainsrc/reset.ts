import { session } from 'electron';
import { appVerbUsage, parseResetArgs } from '../cli/dispatch.js';
import { clearPersistedShowFolder, setWelcomeShowCloud } from '../showfolder.js';

/**
 * The `reset` verb: wipe persisted startup state so the next launch lands on
 * the Welcome screen. Needs Electron (session + electron-store), so it lives
 * here rather than under cli/; main.ts calls it after app.whenReady().
 *
 * `args` are the arguments after the verb. Returns the exit code; the caller
 * quits the app.
 */
export async function runReset(args: string[]): Promise<number> {
    const parsed = parseResetArgs(args);
    if (parsed === 'help') {
        console.log(appVerbUsage('reset'));
        return 0;
    }
    if ('error' in parsed) {
        console.error(`${parsed.error}\n\n${appVerbUsage('reset')}`);
        return 2;
    }
    try {
        clearPersistedShowFolder();
        await session.defaultSession.clearStorageData({ storages: ['localstorage'] });
        setWelcomeShowCloud(parsed.showCloud);
        console.log(`[reset] cleared show-folder + localStorage; welcomeShowCloud=${parsed.showCloud}`);
        return 0;
    } catch (e) {
        console.warn('[reset] failed:', (e as Error).message);
        return 1;
    }
}
