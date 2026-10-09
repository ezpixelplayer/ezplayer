import fs from 'node:fs/promises';
import path from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import type { SequenceFiles } from '@ezplayer/ezplayer-core';

/** Desktop Pi imports must survive removal of the USB/source folder. */
export async function copyPiSongFiles(folder: string, files: SequenceFiles): Promise<SequenceFiles> {
    const result = { ...files };
    const root = await fs.realpath(folder);
    for (const key of ['fseq', 'audio', 'video', 'thumb'] as const) {
        const file = files[key];
        if (!file) continue;
        const source = await fs.realpath(path.resolve(folder, file));
        const relative = path.relative(root, source);
        if (relative && !relative.startsWith('..' + path.sep) && !path.isAbsolute(relative)) continue;
        const stat = await fs.stat(source);
        if (!stat.isFile()) throw new Error('Selected song source must be a file.');
        const fingerprint = createHash('sha256')
            .update(source + ':' + stat.size + ':' + stat.mtimeMs)
            .digest('hex')
            .slice(0, 16);
        const directory = path.join(root, 'imports');
        await fs.mkdir(directory, { recursive: true });
        const destination = path.join(directory, fingerprint + '-' + path.basename(source));
        try {
            await fs.access(destination);
        } catch {
            const temporary = destination + '.' + randomUUID() + '.tmp';
            try {
                await fs.copyFile(source, temporary);
                await fs.rename(temporary, destination);
            } finally {
                await fs.rm(temporary, { force: true });
            }
        }
        result[key] = destination;
    }
    return result;
}
