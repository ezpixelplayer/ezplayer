/** Nominal 2 GB boards report about 1.5 GB after firmware and GPU reservations. */
export const MINIMUM_RAM_BYTES = 1.5e9;
export const MINIMUM_RAM_NOMINAL = '2 GB';

export function hasMinimumRam(totalMemBytes: number): boolean {
    return totalMemBytes >= MINIMUM_RAM_BYTES;
}

export function insufficientRamMessage(totalMemBytes: number): string {
    const gb = (totalMemBytes / 1e9).toFixed(1);
    return `EZPlayer needs at least ${MINIMUM_RAM_NOMINAL} of RAM; this system reports ${gb} GB.`;
}
