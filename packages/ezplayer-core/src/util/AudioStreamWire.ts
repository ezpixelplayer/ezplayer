/**
 * Live audio stream wire format — player → browser listeners.
 *
 * One binary WebSocket message per audio chunk. Every listener path (LAN
 * jukebox / preview, cloud ezpui, public viewer page) speaks this; the cloud
 * relays messages byte-for-byte, so the player is the only encoder and the
 * browser the only decoder.
 *
 * All multi-byte fields little-endian.
 *
 *   off  size  field
 *   0    u32   magic        AUDIO_WIRE_MAGIC ("EZAU")
 *   4    u8    version      AUDIO_WIRE_VERSION (2)
 *   5    u8    codec        AudioWireCodec
 *   6    u16   flags        AUDIO_WIRE_FLAG_* bits
 *   8    f64   serverNow    player Date.now() at send time (clock-offset refinement)
 *   16   f64   playAt       player Date.now() at which the first frame should be audible
 *   24   u32   incarnation  bumps on a clean break (new song); contiguity key
 *   28   u32   seq          chunk sequence number (ring seq)
 *   32   u32   sampleRate   decoded sample rate (48000 for opus)
 *   36   u16   channels     decoded channel count
 *   38   u16   preSkip      frames to discard from the head of the decoded output (opus)
 *   40   u32   frames       valid audio frames after preSkip (hop + crossfade tail)
 *   44   u32   hopFrames    frames to advance playback by (the tail overlaps the next chunk)
 *   48   u32   payloadBytes
 *   52   ...   payload
 *
 * Payloads:
 *   PcmF32  — interleaved Float32, `frames * channels` samples.
 *   Opus    — sequence of `[u16 len][opus packet]`, each packet one 20 ms frame.
 *             With FLAG_CONTINUOUS the packets continue one encoder stream across
 *             frames: decode with one decoder, the output lags the input by
 *             `preSkip` frames, so schedule it at `playAt - preSkip/sampleRate`;
 *             on FLAG_STREAM_START the first `preSkip` decoded frames are the
 *             codec's startup transient. Without the flag each frame was encoded
 *             standalone: discard `preSkip`, keep `frames` (legacy).
 *   Silence — no payload; the chunk is all zeros. Listeners advance their schedule
 *             without rendering anything.
 *
 * Version 1 (legacy, still parsed): 36-byte header
 *   f64 serverNow | f64 playAt | u32 incarnation | u32 sampleRate | u32 channels |
 *   u32 sampleCount | u32 advanceSamples | Float32[sampleCount]
 */

export const AUDIO_WIRE_MAGIC = 0x55415a45; // "EZAU" read little-endian
export const AUDIO_WIRE_VERSION = 2;
export const AUDIO_WIRE_HEADER_BYTES = 52;
/** Opus payload continues the previous frame's encoder stream (see header doc). */
export const AUDIO_WIRE_FLAG_CONTINUOUS = 0x0001;
/** First frame after the encoder (re)started; its first `preSkip` decoded frames are transient. */
export const AUDIO_WIRE_FLAG_STREAM_START = 0x0002;
const LEGACY_HEADER_BYTES = 36;

export enum AudioWireCodec {
    PcmF32 = 0,
    Opus = 1,
    Silence = 2,
}

export interface AudioWireHeader {
    codec: AudioWireCodec;
    /** AUDIO_WIRE_FLAG_* bits; absent = 0. */
    flags?: number;
    serverNow: number;
    playAt: number;
    incarnation: number;
    seq: number;
    sampleRate: number;
    channels: number;
    preSkip: number;
    frames: number;
    hopFrames: number;
}

export interface AudioWireFrame extends AudioWireHeader {
    version: 1 | 2;
    /** View into the source buffer — copy before retaining. */
    payload: Uint8Array;
}

/** Text (JSON) control message the relay may send to the player on its
 *  audio-bridge socket. The player streams only while someone is listening
 *  (in `auto` mode), so the relay tells it how many listeners it has. */
export type AudioBridgeControlMessage = { type: 'listeners'; count: number };

export function buildAudioWireFrame(h: AudioWireHeader, payload: Uint8Array): Uint8Array {
    const out = new Uint8Array(AUDIO_WIRE_HEADER_BYTES + payload.byteLength);
    const dv = new DataView(out.buffer);
    dv.setUint32(0, AUDIO_WIRE_MAGIC, true);
    dv.setUint8(4, AUDIO_WIRE_VERSION);
    dv.setUint8(5, h.codec);
    dv.setUint16(6, (h.flags ?? 0) & 0xffff, true);
    dv.setFloat64(8, h.serverNow, true);
    dv.setFloat64(16, h.playAt, true);
    dv.setUint32(24, h.incarnation >>> 0, true);
    dv.setUint32(28, h.seq >>> 0, true);
    dv.setUint32(32, h.sampleRate, true);
    dv.setUint16(36, h.channels, true);
    dv.setUint16(38, h.preSkip, true);
    dv.setUint32(40, h.frames, true);
    dv.setUint32(44, h.hopFrames, true);
    dv.setUint32(48, payload.byteLength, true);
    out.set(payload, AUDIO_WIRE_HEADER_BYTES);
    return out;
}

function asBytes(data: ArrayBuffer | ArrayBufferView): Uint8Array {
    if (data instanceof Uint8Array) return data;
    if (ArrayBuffer.isView(data)) return new Uint8Array(data.buffer, data.byteOffset, data.byteLength);
    return new Uint8Array(data);
}

/** Parse a v2 frame, or a legacy v1 frame from an older player. Returns null
 *  for anything malformed. */
export function parseAudioWireFrame(data: ArrayBuffer | ArrayBufferView): AudioWireFrame | null {
    const bytes = asBytes(data);
    const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    if (bytes.byteLength >= AUDIO_WIRE_HEADER_BYTES && dv.getUint32(0, true) === AUDIO_WIRE_MAGIC) {
        const version = dv.getUint8(4);
        if (version !== AUDIO_WIRE_VERSION) return null;
        const codec = dv.getUint8(5) as AudioWireCodec;
        if (codec !== AudioWireCodec.PcmF32 && codec !== AudioWireCodec.Opus && codec !== AudioWireCodec.Silence) {
            return null;
        }
        const sampleRate = dv.getUint32(32, true);
        const channels = dv.getUint16(36, true);
        const frames = dv.getUint32(40, true);
        const hopFrames = dv.getUint32(44, true);
        const payloadBytes = dv.getUint32(48, true);
        if (sampleRate <= 0 || channels <= 0 || bytes.byteLength < AUDIO_WIRE_HEADER_BYTES + payloadBytes) return null;
        if (codec === AudioWireCodec.PcmF32 && payloadBytes !== frames * channels * 4) return null;
        return {
            version: 2,
            codec,
            flags: dv.getUint16(6, true),
            serverNow: dv.getFloat64(8, true),
            playAt: dv.getFloat64(16, true),
            incarnation: dv.getUint32(24, true),
            seq: dv.getUint32(28, true),
            sampleRate,
            channels,
            preSkip: dv.getUint16(38, true),
            frames,
            hopFrames: hopFrames > 0 ? hopFrames : frames,
            payload: bytes.subarray(AUDIO_WIRE_HEADER_BYTES, AUDIO_WIRE_HEADER_BYTES + payloadBytes),
        };
    }
    // Legacy v1.
    if (bytes.byteLength < LEGACY_HEADER_BYTES) return null;
    const sampleRate = dv.getUint32(20, true);
    const channels = dv.getUint32(24, true);
    const sampleCount = dv.getUint32(28, true);
    const advanceSamples = dv.getUint32(32, true);
    if (sampleRate <= 0 || channels <= 0 || channels > 8) return null;
    if (bytes.byteLength < LEGACY_HEADER_BYTES + sampleCount * 4) return null;
    const frames = Math.floor(sampleCount / channels);
    const hop = advanceSamples > 0 ? Math.floor(advanceSamples / channels) : frames;
    return {
        version: 1,
        codec: AudioWireCodec.PcmF32,
        flags: 0,
        serverNow: dv.getFloat64(0, true),
        playAt: dv.getFloat64(8, true),
        incarnation: dv.getUint32(16, true),
        seq: 0,
        sampleRate,
        channels,
        preSkip: 0,
        frames,
        hopFrames: hop,
        payload: bytes.subarray(LEGACY_HEADER_BYTES, LEGACY_HEADER_BYTES + frames * channels * 4),
    };
}

/** Split an opus payload into its length-prefixed packets. */
export function splitOpusPackets(payload: Uint8Array): Uint8Array[] {
    const packets: Uint8Array[] = [];
    const dv = new DataView(payload.buffer, payload.byteOffset, payload.byteLength);
    let off = 0;
    while (off + 2 <= payload.byteLength) {
        const len = dv.getUint16(off, true);
        off += 2;
        if (off + len > payload.byteLength) break;
        packets.push(payload.subarray(off, off + len));
        off += len;
    }
    return packets;
}

/** Join opus packets into the length-prefixed payload form. */
export function joinOpusPackets(packets: Uint8Array[]): Uint8Array {
    let total = 0;
    for (const p of packets) total += 2 + p.byteLength;
    const out = new Uint8Array(total);
    const dv = new DataView(out.buffer);
    let off = 0;
    for (const p of packets) {
        dv.setUint16(off, p.byteLength, true);
        off += 2;
        out.set(p, off);
        off += p.byteLength;
    }
    return out;
}
