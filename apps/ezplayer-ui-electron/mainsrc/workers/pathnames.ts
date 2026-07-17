/** Basename that splits on both separators — show folders authored on Windows
 *  can be served from Linux (and vice versa), so stored paths may use either. */
export function fileBaseName(p: string): string {
    return p.split('\\').pop()!.split('/').pop()!;
}
