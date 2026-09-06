/** Minimal 16-bit PCM WAV writer for audio fixtures (no ffmpeg needed). */
export interface WavOptions {
    seconds: number;
    sampleRate?: number;
    frequencyHz?: number;
    /** Peak amplitude 0..1. Quiet by default so normalization has a visible effect. */
    amplitude?: number;
}

export function sineWav(opts: WavOptions): Uint8Array {
    const rate = opts.sampleRate ?? 8000;
    const freq = opts.frequencyHz ?? 440;
    const amp = opts.amplitude ?? 0.05;
    const n = Math.round(opts.seconds * rate);
    const dataBytes = n * 2;
    const buf = Buffer.alloc(44 + dataBytes);
    buf.write('RIFF', 0);
    buf.writeUInt32LE(36 + dataBytes, 4);
    buf.write('WAVE', 8);
    buf.write('fmt ', 12);
    buf.writeUInt32LE(16, 16); // PCM chunk size
    buf.writeUInt16LE(1, 20); // PCM
    buf.writeUInt16LE(1, 22); // mono
    buf.writeUInt32LE(rate, 24);
    buf.writeUInt32LE(rate * 2, 28); // byte rate
    buf.writeUInt16LE(2, 32); // block align
    buf.writeUInt16LE(16, 34); // bits per sample
    buf.write('data', 36);
    buf.writeUInt32LE(dataBytes, 40);
    for (let i = 0; i < n; i++) {
        const s = Math.round(Math.sin((2 * Math.PI * freq * i) / rate) * amp * 32767);
        buf.writeInt16LE(s, 44 + i * 2);
    }
    return new Uint8Array(buf.buffer, buf.byteOffset, buf.byteLength);
}
