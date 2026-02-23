declare module 'zstd-codec' {
    export class ZstdCodec {
        static run(callback: (zstd: ZstdBinding) => void): void;
    }

    export interface ZstdBinding {
        Simple: new () => ZstdSimple;
    }

    export interface ZstdSimple {
        compress(content: Uint8Array, compressionLevel?: number): Uint8Array;
        decompress(compressed: Uint8Array): Uint8Array;
    }
}
