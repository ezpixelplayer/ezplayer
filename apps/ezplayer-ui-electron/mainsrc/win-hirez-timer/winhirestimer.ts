import { createRequire } from 'module';

const require = createRequire(import.meta.url);
const isWin = process.platform === 'win32';

let native: { begin(): void; end(): void } | null = null;
if (isWin) {
    try {
        const bindings = require('bindings');
        native = bindings('win_hirez_timer');
    } catch (e) {
        console.error('NO BINDING');
        console.error(e);
    }
}

export function begin() {
    return isWin && native ? native.begin() : false;
}
export function end() {
    if (isWin && native) native.end();
}
