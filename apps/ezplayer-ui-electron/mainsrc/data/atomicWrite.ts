import fs from 'fs/promises';
import path from 'path';

/**
 * Crash-safe write: stage to a sibling temp file, fsync, then rename over the
 * target. Avoids the 0-byte window of a plain `writeFile` with `O_TRUNC`.
 */
export async function atomicWriteFile(
    targetPath: string,
    contents: string | Uint8Array,
    encoding: BufferEncoding = 'utf8',
): Promise<void> {
    // Tripwire: refuse to atomically write zero bytes. None of our JSON writers
    // should ever produce empty content (`JSON.stringify` of any non-undefined
    // value yields at least 2 bytes), and a 0-byte JSON file is unparseable.
    // We've observed `playbackSettings.json` ending up at 0 bytes during
    // normal, non-crashing runs; we can't yet explain how, so if we ever land
    // here, throw with a stack trace and leave the previous valid content on
    // disk. Better a loud failure than a silently-corrupted folder.
    const length = typeof contents === 'string' ? Buffer.byteLength(contents, encoding) : contents.byteLength;
    if (length === 0) {
        const err = new Error(
            `atomicWriteFile refused to write 0 bytes to ${targetPath}. ` +
                `(JSON writers never produce empty content; this is a bug — ` +
                `find the caller that passed empty data and fix it there.)`,
        );
        // Log loudly with the full stack: callers like the settings auto-saver
        // catch and swallow with a generic message, which would hide the trace
        // we need to identify the culprit.
        console.error('[atomicWriteFile]', err);
        throw err;
    }

    const dir = path.dirname(targetPath);
    const base = path.basename(targetPath);
    const tmpPath = path.join(dir, `.${base}.${process.pid}.${Math.random().toString(36).slice(2, 10)}.tmp`);

    let handle: fs.FileHandle | undefined;
    try {
        handle = await fs.open(tmpPath, 'w');
        if (typeof contents === 'string') {
            await handle.writeFile(contents, encoding);
        } else {
            await handle.writeFile(contents);
        }
        // fsync so the new bytes are on disk before the rename — otherwise a
        // power loss after rename but before flush can still leave the target
        // pointing at zero-length data on some filesystems.
        await handle.sync();
        await handle.close();
        handle = undefined;

        await fs.rename(tmpPath, targetPath);
    } catch (err) {
        // Best-effort cleanup of the temp file if anything went wrong before
        // (or during) the rename. Swallow ENOENT — the temp may not exist yet.
        if (handle) {
            try {
                await handle.close();
            } catch {
                /* ignore */
            }
        }
        try {
            await fs.unlink(tmpPath);
        } catch {
            /* ignore */
        }
        throw err;
    }
}
