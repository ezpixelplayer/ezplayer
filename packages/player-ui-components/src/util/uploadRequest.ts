/** Browser upload with byte progress. Resolves only once the player has accepted
 *  the body, not when the last byte leaves the browser. */
export function uploadRequest(
    url: string,
    body: Blob,
    headers: Record<string, string>,
    onProgress?: (loaded: number, total: number) => void,
    method = 'POST',
): Promise<string> {
    return new Promise((resolve, reject) => {
        const request = new XMLHttpRequest();
        request.open(method, url);
        for (const [key, value] of Object.entries(headers)) request.setRequestHeader(key, value);
        request.upload.onprogress = (event) =>
            onProgress?.(event.loaded, event.lengthComputable ? event.total : body.size);
        request.onerror = () =>
            reject(new Error('Upload connection lost. Check your connection to the player and retry.'));
        request.onabort = () => reject(new Error('Upload cancelled'));
        request.onload = () => {
            if (request.status >= 200 && request.status < 300) {
                onProgress?.(body.size, body.size);
                resolve(request.responseText);
            } else {
                let message = `Upload failed (${request.status})`;
                try {
                    const result = JSON.parse(request.responseText) as { error?: string };
                    if (result.error) message = result.error;
                } catch {
                    /* Keep the HTTP status when the player did not answer with JSON. */
                }
                reject(new Error(message));
            }
        };
        onProgress?.(0, body.size);
        request.send(body);
    });
}

/** Splits files into groups whose sizes sum to at most maxBytes, keeping order.
 *  A file larger than maxBytes travels alone. */
export function groupByBytes<T extends { data: { size: number } }>(files: T[], maxBytes: number): T[][] {
    const groups: T[][] = [];
    let current: T[] = [];
    let bytes = 0;
    for (const file of files) {
        if (current.length && bytes + file.data.size > maxBytes) {
            groups.push(current);
            current = [];
            bytes = 0;
        }
        current.push(file);
        bytes += file.data.size;
    }
    if (current.length) groups.push(current);
    return groups;
}
