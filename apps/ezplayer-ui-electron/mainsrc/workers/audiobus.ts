/**
 * Audio buses: named destinations that outside programs send sound to.
 *
 * A client opens a lease on a bus, then streams PCM into it or uploads clips
 * and plays them at given times. Everything is kept as 48 kHz stereo floats
 * placed on the player's clock, in whole frames.
 *
 * The show audio (`main`) is pulled: the playback loop asks for what belongs
 * in each chunk it is about to publish, so injected sound reaches the local
 * speakers and the listeners with the song. Every other bus is pushed: `pump`
 * cuts it into chunks of the bus's own length, its own lead ahead of time,
 * and only where something sounds.
 */

import { AUDIO_BUS_MAIN, type ResolvedAudioBus } from '@ezplayer/ezplayer-core';

export const BUS_RATE = 48000;
const FRAMES_PER_MS = BUS_RATE / 1000;
/** A stream chunk this close to the end of the previous one joins it exactly. */
const JOIN_TOLERANCE_FRAMES = 1.5 * FRAMES_PER_MS;
const DEFAULT_TTL_MS = 30_000;
const MAX_TTL_MS = 3_600_000;
const MAX_LEASES = 64;
const MAX_VOICES = 64;
const MAX_CLIPS = 256;
const MAX_CLIP_SECONDS = 120;
const MAX_LEASE_CLIP_SECONDS = 600;
/** Stream audio may be queued this far ahead. */
const MAX_STREAM_AHEAD_MS = 60_000;
const DEFAULT_STOP_FADE_MS = 10;

export type PcmEncoding = 's16le' | 'f32le';

/** The app instance that opened a lease; the server fills this in from the app token. */
export interface AudioLeaseOwner {
    instance: string;
    title: string;
}

export interface AudioLeaseRequest {
    /** Bus to play on; `main` when omitted. */
    bus?: string;
    /** Label shown in listings. */
    name?: string;
    /** Never taken from a client; see AudioLeaseOwner. */
    owner?: AudioLeaseOwner;
    ttlMs?: number;
    /** Linear gain of everything on the lease; 1 when omitted. */
    gain?: number;
    /** Format of stream chunks and of clips sent without a WAV header. */
    sampleRate?: number;
    channels?: number;
    encoding?: PcmEncoding;
}

export interface AudioClipInfo {
    name: string;
    durationMs: number;
}

export interface AudioLeaseInfo {
    id: number;
    token: number;
    bus: string;
    name: string;
    owner?: AudioLeaseOwner;
    gain: number;
    sampleRate: number;
    channels: number;
    encoding: PcmEncoding;
    ttlMs: number;
    expiresAt: number;
    /** The bus's timing, for a client deciding how far ahead to send. */
    leadMs: number;
    chunkMs: number;
    clips: AudioClipInfo[];
    voices: number;
    /** Stream audio queued beyond now, ms. */
    bufferedMs: number;
    /** Stream audio that arrived after its time had been played, ms in total. */
    lateMs: number;
}

export interface AudioBusStatus extends ResolvedAudioBus {
    leases: number;
    /** Chunks sent to the outputs since start. */
    chunks: number;
    /** Largest sample of the last second of sound, 0-1; 0 when quiet. */
    peak: number;
}

export interface AudioPlayRequest {
    clip: string;
    /** Player clock time to start at; as soon as possible when omitted. */
    at?: number;
    gain?: number;
    loop?: boolean;
}

export interface AudioPlayResult {
    voice: number;
    /** Player clock time the clip starts sounding. */
    startsAt: number;
    /** How much of the start was lost because `at` was too soon, ms. */
    lateMs: number;
}

/** One chunk of a pushed bus, ready for the outputs. */
export interface BusChunk {
    bus: string;
    /** Player clock time of the first frame. */
    playAt: number;
    /** Changes when the chunk does not follow the one before. */
    incarnation: number;
    /** Stereo, 48 kHz, interleaved. */
    samples: Float32Array;
}

interface Block {
    start: number;
    data: Float32Array;
}

interface Voice {
    id: number;
    clip: Float32Array;
    start: number;
    gain: number;
    loop: boolean;
    /** Frame the fade-out begins at. */
    stopAt?: number;
    fadeFrames: number;
}

interface Lease {
    info: AudioLeaseInfo;
    clips: Map<string, Float32Array>;
    clipFrames: number;
    voices: Voice[];
    blocks: Block[];
    /** Frame after the last stream frame. */
    streamEnd?: number;
    lastSeq?: number;
    resampler?: StereoResampler;
    /** Gain the last rendered frame was given. */
    gainNow: number;
    lateFrames: number;
    /** Closed and fading out; gone from listings, removed once quiet. */
    closing?: boolean;
}

interface Bus {
    cfg: ResolvedAudioBus;
    chunkFrames: number;
    /** First frame not yet rendered; undefined while idle. */
    next?: number;
    incarnation: number;
    chunks: number;
    peak: number;
    peakAt: number;
}

const frameOf = (ms: number) => Math.round(ms * FRAMES_PER_MS);

/** A number a client sent, or `dflt` when it sent none; anything else is refused. */
function numberOr(v: unknown, name: string, dflt: number): number {
    if (v === undefined || v === null) return dflt;
    if (typeof v !== 'number' || !Number.isFinite(v)) throw new Error(`${name} must be a number`);
    return v;
}
const msOf = (frame: number) => frame / FRAMES_PER_MS;

/** Frame after the last one a voice sounds on: the end of its fade, or of a clip that does not loop. */
function voiceEnd(v: Voice): number {
    const clipEnd = v.loop ? Infinity : v.start + v.clip.length / 2;
    return v.stopAt === undefined ? clipEnd : Math.min(v.stopAt + v.fadeFrames, clipEnd);
}

// ---------------------------------------------------------------------------
// PCM in
// ---------------------------------------------------------------------------

/** Raw PCM bytes as interleaved stereo floats at the same rate. */
export function pcmToStereo(data: Uint8Array, channels: number, encoding: PcmEncoding): Float32Array {
    const width = encoding === 'f32le' ? 4 : 2;
    const frames = Math.floor(data.byteLength / (width * channels));
    const dv = new DataView(data.buffer, data.byteOffset, data.byteLength);
    const out = new Float32Array(frames * 2);
    const read =
        encoding === 'f32le' ? (o: number) => dv.getFloat32(o, true) : (o: number) => dv.getInt16(o, true) / 32768;
    for (let i = 0; i < frames; i++) {
        const at = i * width * channels;
        const l = read(at);
        out[i * 2] = l;
        out[i * 2 + 1] = channels > 1 ? read(at + width) : l;
    }
    return out;
}

/** The samples of a WAV file as interleaved stereo floats, with its rate. Refuses one longer than `maxSeconds`. */
export function decodeWav(file: Uint8Array, maxSeconds = Infinity): { rate: number; stereo: Float32Array } {
    const dv = new DataView(file.buffer, file.byteOffset, file.byteLength);
    const tag = (o: number) => String.fromCharCode(file[o], file[o + 1], file[o + 2], file[o + 3]);
    if (file.byteLength < 12 || tag(0) !== 'RIFF' || tag(8) !== 'WAVE') throw new Error('not a WAV file');
    let fmt: { code: number; channels: number; rate: number; bits: number } | undefined;
    for (let o = 12; o + 8 <= file.byteLength;) {
        const size = dv.getUint32(o + 4, true);
        const body = o + 8;
        if (tag(o) === 'fmt ') {
            let code = dv.getUint16(body, true);
            // Extensible: the real code is the first two bytes of the subformat.
            if (code === 0xfffe && size >= 26) code = dv.getUint16(body + 24, true);
            fmt = {
                code,
                channels: dv.getUint16(body + 2, true),
                rate: dv.getUint32(body + 4, true),
                bits: dv.getUint16(body + 14, true),
            };
        } else if (tag(o) === 'data') {
            if (!fmt) throw new Error('WAV data before its format');
            const { code, channels, rate, bits } = fmt;
            const width = bits / 8;
            const float = code === 3;
            if (
                (code !== 1 && code !== 3) ||
                channels < 1 ||
                ![1, 2, 3, 4, 8].includes(width) ||
                (float && width < 4)
            ) {
                throw new Error(`unsupported WAV encoding (format ${code}, ${bits} bit)`);
            }
            const frames = Math.floor(Math.min(size, file.byteLength - body) / (width * channels));
            if (!(rate > 0) || frames > maxSeconds * rate) throw new Error(`clip is longer than ${maxSeconds} s`);
            const read = (p: number): number => {
                if (float) return width === 4 ? dv.getFloat32(p, true) : dv.getFloat64(p, true);
                if (width === 1) return (file[p] - 128) / 128;
                if (width === 2) return dv.getInt16(p, true) / 32768;
                if (width === 3) return ((dv.getInt8(p + 2) << 16) | dv.getUint16(p, true)) / 8388608;
                return dv.getInt32(p, true) / 2147483648;
            };
            const stereo = new Float32Array(frames * 2);
            for (let i = 0; i < frames; i++) {
                const at = body + i * width * channels;
                const l = read(at);
                stereo[i * 2] = l;
                stereo[i * 2 + 1] = channels > 1 ? read(at + width) : l;
            }
            return { rate, stereo };
        }
        o = body + size + (size & 1);
    }
    throw new Error('WAV file has no data');
}

/** Cubic resampler to 48 kHz that carries its place from one piece to the next. */
export class StereoResampler {
    private readonly step: number;
    /** Frames kept from earlier pieces; the next output lies between [1] and [2]. */
    private carry = new Float32Array(0);
    /** Place of the next output within `carry` followed by the new piece, in frames. */
    private pos = 1;

    constructor(rate: number) {
        this.step = rate / BUS_RATE;
    }

    /** Convert the next piece. `last` also produces the tail that waits for later frames. */
    push(input: Float32Array, last = false): Float32Array {
        if (this.step === 1) return input;
        let src: Float32Array;
        if (this.carry.length === 0 && input.length >= 2) {
            // A copy of the first frame stands in for the one before it.
            src = new Float32Array(input.length + 2);
            src.set(input.subarray(0, 2));
            src.set(input, 2);
        } else {
            src = new Float32Array(this.carry.length + input.length);
            src.set(this.carry);
            src.set(input, this.carry.length);
        }
        if (last && src.length >= 2) {
            const padded = new Float32Array(src.length + 4);
            padded.set(src);
            padded.set(src.subarray(src.length - 2), src.length);
            padded.set(src.subarray(src.length - 2), src.length + 2);
            src = padded;
        }
        const frames = src.length / 2;
        const count = Math.max(0, Math.ceil((frames - 2 - this.pos) / this.step));
        const out = new Float32Array(count * 2);
        let p = this.pos;
        for (let n = 0; n < count; n++, p += this.step) {
            const i = Math.floor(p);
            const t = p - i;
            for (let ch = 0; ch < 2; ch++) {
                const p0 = src[(i - 1) * 2 + ch];
                const p1 = src[i * 2 + ch];
                const p2 = src[(i + 1) * 2 + ch];
                const p3 = src[(i + 2) * 2 + ch];
                out[n * 2 + ch] =
                    p1 + 0.5 * t * (p2 - p0 + t * (2 * p0 - 5 * p1 + 4 * p2 - p3 + t * (3 * (p1 - p2) + p3 - p0)));
            }
        }
        const keepFrom = Math.max(0, Math.floor(p) - 1);
        this.carry = src.slice(keepFrom * 2);
        this.pos = p - keepFrom;
        return out;
    }
}

// ---------------------------------------------------------------------------
// UDP stream packets
// ---------------------------------------------------------------------------

/** 'EZA1' */
export const AUDIO_PACKET_MAGIC = 0x455a4131;
export const AUDIO_PACKET_HEADER = 24;

export interface AudioPacket {
    id: number;
    token: number;
    seq: number;
    /** Player clock time of the first frame; 0 follows the previous packet. */
    playAt: number;
    data: Uint8Array;
}

export function encodeAudioPacket(p: AudioPacket): Uint8Array {
    const out = new Uint8Array(AUDIO_PACKET_HEADER + p.data.byteLength);
    const dv = new DataView(out.buffer);
    dv.setUint32(0, AUDIO_PACKET_MAGIC);
    dv.setUint32(4, p.id >>> 0);
    dv.setUint32(8, p.token >>> 0);
    dv.setUint32(12, p.seq >>> 0);
    dv.setFloat64(16, p.playAt);
    out.set(p.data, AUDIO_PACKET_HEADER);
    return out;
}

export function decodeAudioPacket(msg: Uint8Array): AudioPacket | undefined {
    if (msg.byteLength < AUDIO_PACKET_HEADER) return undefined;
    const dv = new DataView(msg.buffer, msg.byteOffset, msg.byteLength);
    if (dv.getUint32(0) !== AUDIO_PACKET_MAGIC) return undefined;
    return {
        id: dv.getUint32(4),
        token: dv.getUint32(8),
        seq: dv.getUint32(12),
        playAt: dv.getFloat64(16),
        data: msg.subarray(AUDIO_PACKET_HEADER),
    };
}

// ---------------------------------------------------------------------------
// Engine
// ---------------------------------------------------------------------------

export class AudioBusEngine {
    private readonly buses = new Map<string, Bus>();
    private readonly leases = new Map<number, Lease>();
    private nextLeaseId = 1;
    private nextVoiceId = 1;
    /** Local speaker trim: outputs play a frame this much after its clock time. */
    private adjustMs = 0;
    /** First frame of the show audio not yet handed to the playback loop. */
    private mainRendered = 0;
    /** The crossfade tail of the last show audio chunk: where it began and how long it ran, ms. */
    private mainTail?: { at: number; ms: number };
    private scratch = new Float32Array(0);

    /** `mainLeadMs`: how far ahead of now the playback loop has published the show audio. */
    constructor(private readonly mainLeadMs: number) {}

    configure(buses: ResolvedAudioBus[]): void {
        const names = new Set(buses.map((b) => b.name));
        for (const [name] of this.buses) if (!names.has(name)) this.buses.delete(name);
        for (const l of [...this.leases.values()]) if (!names.has(l.info.bus)) this.leases.delete(l.info.id);
        for (const cfg of buses) {
            const chunkFrames = frameOf(cfg.chunkMs);
            const have = this.buses.get(cfg.name);
            if (have) {
                if (have.chunkFrames !== chunkFrames) have.next = undefined;
                have.cfg = cfg;
                have.chunkFrames = chunkFrames;
            } else {
                this.buses.set(cfg.name, { cfg, chunkFrames, incarnation: 0, chunks: 0, peak: 0, peakAt: 0 });
            }
            for (const l of this.leases.values()) {
                if (l.info.bus !== cfg.name) continue;
                l.info.leadMs = this.leadOf(cfg);
                l.info.chunkMs = cfg.chunkMs;
            }
        }
    }

    setTimeAdjust(adjustMs: number): void {
        this.adjustMs = adjustMs;
    }

    get timeAdjust(): number {
        return this.adjustMs;
    }

    private leadOf(cfg: ResolvedAudioBus): number {
        return cfg.name === AUDIO_BUS_MAIN ? this.mainLeadMs : cfg.leadMs;
    }

    /** How far ahead of now, on the player's clock, a pushed bus is rendered. */
    private ahead(bus: Bus): number {
        return Math.max(0, bus.cfg.leadMs - this.adjustMs);
    }

    busStatus(now: number): AudioBusStatus[] {
        return [...this.buses.values()].map((b) => ({
            ...b.cfg,
            leadMs: this.leadOf(b.cfg),
            leases: [...this.leases.values()].filter((l) => l.info.bus === b.cfg.name && !l.closing).length,
            chunks: b.chunks,
            peak: now - b.peakAt < 1000 ? b.peak : 0,
        }));
    }

    list(now: number): AudioLeaseInfo[] {
        return [...this.leases.values()].filter((l) => !l.closing).map((l) => this.describe(l, now));
    }

    /** Leases still held, counting closed ones that are fading out. */
    get held(): number {
        return this.leases.size;
    }

    private describe(l: Lease, now: number): AudioLeaseInfo {
        return {
            ...l.info,
            clips: [...l.clips].map(([name, data]) => ({ name, durationMs: msOf(data.length / 2) })),
            voices: l.voices.length,
            bufferedMs: Math.max(0, Math.round(msOf((l.streamEnd ?? 0) - frameOf(now)))),
            lateMs: Math.round(msOf(l.lateFrames)),
        };
    }

    open(req: AudioLeaseRequest, now: number): AudioLeaseInfo {
        const busName = req.bus ?? AUDIO_BUS_MAIN;
        const bus = this.buses.get(busName);
        if (!bus) throw new Error(`no audio bus named ${busName}`);
        let open = 0;
        for (const l of this.leases.values()) if (!l.closing) open++;
        if (open >= MAX_LEASES) throw new Error('too many audio leases');
        const encoding = req.encoding ?? 's16le';
        if (encoding !== 's16le' && encoding !== 'f32le') throw new Error('encoding must be s16le or f32le');
        const sampleRate = numberOr(req.sampleRate, 'sampleRate', BUS_RATE);
        if (!(sampleRate >= 8000 && sampleRate <= 192000)) throw new Error('sampleRate must be 8000-192000');
        const channels = req.channels ?? 2;
        if (!Number.isInteger(channels) || channels < 1 || channels > 8) throw new Error('channels must be 1-8');
        const gain = numberOr(req.gain, 'gain', 1);
        if (!(gain >= 0 && gain <= 4)) throw new Error('gain must be 0-4');
        const ttlMs = Math.min(MAX_TTL_MS, Math.max(1000, numberOr(req.ttlMs, 'ttlMs', DEFAULT_TTL_MS)));
        const id = this.nextLeaseId++;
        const lease: Lease = {
            info: {
                id,
                token: (Math.random() * 0xffffffff) >>> 0,
                bus: busName,
                name: (req.name ?? '').slice(0, 80),
                owner: req.owner,
                gain,
                sampleRate,
                channels,
                encoding,
                ttlMs,
                expiresAt: now + ttlMs,
                leadMs: this.leadOf(bus.cfg),
                chunkMs: bus.cfg.chunkMs,
                clips: [],
                voices: 0,
                bufferedMs: 0,
                lateMs: 0,
            },
            clips: new Map(),
            clipFrames: 0,
            voices: [],
            blocks: [],
            gainNow: gain,
            lateFrames: 0,
        };
        this.leases.set(id, lease);
        return this.describe(lease, now);
    }

    /** The lease, kept alive; throws when the id or token is wrong. */
    private use(id: number, token: number | undefined, now: number): Lease {
        const l = this.leases.get(id);
        if (!l || l.closing || (token !== undefined && l.info.token !== token)) {
            throw new Error('unknown lease or wrong token');
        }
        l.info.expiresAt = now + l.info.ttlMs;
        return l;
    }

    close(id: number, token: number | undefined, now: number): void {
        this.fadeOut(this.use(id, token, now), now);
    }

    /** End a lease without a click: its sound fades over a few ms, then it is removed. */
    private fadeOut(l: Lease, now: number): void {
        const bus = this.buses.get(l.info.bus);
        const from = bus ? this.rendered(bus, now) : 0;
        const fade = frameOf(DEFAULT_STOP_FADE_MS);
        for (const v of l.voices) {
            if (v.stopAt !== undefined) continue;
            v.stopAt = Math.max(from, v.start);
            v.fadeFrames = fade;
        }
        // The stream keeps a fading sliver past `from` and loses the rest.
        const kept: Block[] = [];
        for (const b of l.blocks) {
            if (b.start >= from + fade) continue;
            const data = b.data.slice(0, Math.max(0, from + fade - b.start) * 2);
            for (let f = Math.max(0, from - b.start); f < data.length / 2; f++) {
                const g = 1 - (b.start + f - from) / fade;
                data[f * 2] *= g;
                data[f * 2 + 1] *= g;
            }
            kept.push({ start: b.start, data });
        }
        l.blocks = kept;
        l.streamEnd = l.streamEnd === undefined ? undefined : Math.min(l.streamEnd, from + fade);
        l.closing = true;
        // Long enough for the fade to be rendered, on the show audio too.
        l.info.expiresAt = now + this.mainLeadMs + 1000;
    }

    keepalive(id: number, token: number, now: number): AudioLeaseInfo {
        return this.describe(this.use(id, token, now), now);
    }

    setGain(id: number, token: number, gain: number, now: number): AudioLeaseInfo {
        const l = this.use(id, token, now);
        if (!(gain >= 0 && gain <= 4)) throw new Error('gain must be 0-4');
        l.info.gain = gain;
        return this.describe(l, now);
    }

    /** Drop leases nobody has touched within their time to live. */
    sweep(now: number): number[] {
        const gone: number[] = [];
        for (const l of [...this.leases.values()]) {
            if (l.info.expiresAt >= now) continue;
            if (l.closing) this.leases.delete(l.info.id);
            else {
                this.fadeOut(l, now);
                gone.push(l.info.id);
            }
        }
        return gone;
    }

    /** First frame a sound asked for now can start on. */
    private soonest(bus: Bus, now: number): number {
        if (bus.cfg.name === AUDIO_BUS_MAIN) {
            return Math.max(this.mainRendered, frameOf(now + this.mainLeadMs));
        }
        // The next chunk boundary, so the whole sound makes the bus's lead.
        const edge = Math.ceil(frameOf(now + this.ahead(bus)) / bus.chunkFrames) * bus.chunkFrames;
        return Math.max(edge, bus.next ?? 0);
    }

    /** First frame that can still be changed. */
    private rendered(bus: Bus, now: number): number {
        if (bus.cfg.name === AUDIO_BUS_MAIN) return this.mainRendered;
        return Math.max(bus.next ?? 0, frameOf(now));
    }

    // -- stream ------------------------------------------------------------------

    /**
     * Add PCM to the lease's stream. `at` is the player clock time of its first
     * frame; without it the chunk follows the one before, or starts as soon as
     * the bus allows. A `seq` not above the last one seen is dropped.
     */
    stream(id: number, token: number, data: Uint8Array, at: number | undefined, seq: number | undefined, now: number) {
        const l = this.use(id, token, now);
        const bus = this.buses.get(l.info.bus)!;
        if (seq !== undefined) {
            if (l.lastSeq !== undefined && seq <= l.lastSeq && l.lastSeq - seq < 0x40000000)
                return this.streamState(l, now);
            l.lastSeq = seq;
        }
        const nowFrame = frameOf(now);
        const end = l.streamEnd;
        // The end of the stream so far, while it is still ahead of the clock.
        const live = end !== undefined && end > nowFrame ? end : undefined;
        let start: number;
        let joined: boolean;
        if (at === undefined || !(at > 0)) {
            joined = live !== undefined;
            // Two chunks of slack, so pieces sent as they are made still arrive in time.
            start = live ?? this.soonest(bus, now) + 2 * bus.chunkFrames;
        } else {
            const want = frameOf(at);
            joined = live !== undefined && Math.abs(want - live) <= JOIN_TOLERANCE_FRAMES;
            start = live !== undefined && joined ? live : want;
        }
        // Its length is known from its size, before any of it is converted.
        const width = l.info.encoding === 'f32le' ? 4 : 2;
        const length = (data.byteLength / (width * l.info.channels)) * (BUS_RATE / l.info.sampleRate);
        if (start + length > nowFrame + frameOf(MAX_STREAM_AHEAD_MS)) {
            throw new Error('stream chunk reaches too far ahead');
        }
        if (!joined) l.resampler = undefined;
        if (l.info.sampleRate !== BUS_RATE) l.resampler ??= new StereoResampler(l.info.sampleRate);
        let samples = pcmToStereo(data, l.info.channels, l.info.encoding);
        if (l.resampler) samples = l.resampler.push(samples);
        if (samples.length === 0) return this.streamState(l, now);
        if (!joined && end !== undefined && start < end) {
            // A jump back replaces what was queued from there on.
            l.blocks = l.blocks.filter((b) => b.start < start);
            const over = l.blocks[l.blocks.length - 1];
            if (over && over.start + over.data.length / 2 > start)
                over.data = over.data.subarray(0, (start - over.start) * 2);
        }
        const done = this.rendered(bus, now);
        if (start < done) l.lateFrames += Math.min(samples.length / 2, done - start);
        l.blocks.push({ start, data: samples });
        l.streamEnd = start + samples.length / 2;
        return this.streamState(l, now);
    }

    private streamState(l: Lease, now: number): { bufferedMs: number; lateMs: number } {
        return {
            bufferedMs: Math.max(0, Math.round(msOf((l.streamEnd ?? 0) - frameOf(now)))),
            lateMs: Math.round(msOf(l.lateFrames)),
        };
    }

    // -- clips -------------------------------------------------------------------

    /** Store a clip: a WAV file, or raw PCM in the lease's format. */
    addClip(id: number, token: number, name: string, data: Uint8Array, now: number): AudioClipInfo {
        const l = this.use(id, token, now);
        if (!name || name.length > 80) throw new Error('clip name must be 1-80 characters');
        const isWav =
            data.byteLength >= 12 && data[0] === 0x52 && data[1] === 0x49 && data[2] === 0x46 && data[3] === 0x46;
        if (!isWav) {
            const width = l.info.encoding === 'f32le' ? 4 : 2;
            if (data.byteLength / (width * l.info.channels) > MAX_CLIP_SECONDS * l.info.sampleRate) {
                throw new Error(`clip is longer than ${MAX_CLIP_SECONDS} s`);
            }
        }
        const src = isWav
            ? decodeWav(data, MAX_CLIP_SECONDS)
            : { rate: l.info.sampleRate, stereo: pcmToStereo(data, l.info.channels, l.info.encoding) };
        if (!(src.rate >= 8000 && src.rate <= 192000)) throw new Error('clip sample rate must be 8000-192000');
        const clip = new StereoResampler(src.rate).push(src.stereo, true);
        const frames = clip.length / 2;
        if (frames === 0) throw new Error('clip is empty');
        if (frames > MAX_CLIP_SECONDS * BUS_RATE) throw new Error(`clip is longer than ${MAX_CLIP_SECONDS} s`);
        const had = l.clips.get(name);
        const total = l.clipFrames - (had ? had.length / 2 : 0) + frames;
        if (total > MAX_LEASE_CLIP_SECONDS * BUS_RATE)
            throw new Error(`clips on a lease may total ${MAX_LEASE_CLIP_SECONDS} s`);
        if (!had && l.clips.size >= MAX_CLIPS) throw new Error('too many clips');
        l.clips.set(name, clip);
        l.clipFrames = total;
        return { name, durationMs: msOf(frames) };
    }

    removeClip(id: number, token: number, name: string, now: number): void {
        const l = this.use(id, token, now);
        const had = l.clips.get(name);
        if (!had) throw new Error(`no clip named ${name}`);
        l.clips.delete(name);
        l.clipFrames -= had.length / 2;
        // Voices already sounding keep their copy and play out.
    }

    play(id: number, token: number, req: AudioPlayRequest, now: number): AudioPlayResult {
        const l = this.use(id, token, now);
        const bus = this.buses.get(l.info.bus)!;
        const clip = l.clips.get(req.clip);
        if (!clip) throw new Error(`no clip named ${req.clip}`);
        const gain = numberOr(req.gain, 'gain', 1);
        if (!(gain >= 0 && gain <= 4)) throw new Error('gain must be 0-4');
        if (l.voices.length >= MAX_VOICES) throw new Error('too many sounds playing on this lease');
        let start: number;
        let late = 0;
        if (req.at === undefined) {
            start = this.soonest(bus, now);
        } else {
            if (!(req.at > 0)) throw new Error('at must be a player clock time');
            start = frameOf(req.at);
            // Too soon to play whole: it keeps its time and loses its start.
            late = Math.max(0, this.rendered(bus, now) - start);
        }
        const voice: Voice = { id: this.nextVoiceId++, clip, start, gain, loop: !!req.loop, fadeFrames: 0 };
        l.voices.push(voice);
        return { voice: voice.id, startsAt: msOf(start + late), lateMs: Math.round(msOf(late)) };
    }

    /** Fade out one voice, or all of the lease's when `voice` is omitted. Returns how many. */
    stop(id: number, token: number, voice: number | undefined, fadeMs: number | undefined, now: number): number {
        const l = this.use(id, token, now);
        const bus = this.buses.get(l.info.bus)!;
        const from = this.rendered(bus, now);
        const fadeFrames = Math.max(1, frameOf(Math.min(10_000, Math.max(0, fadeMs ?? DEFAULT_STOP_FADE_MS))));
        let n = 0;
        for (const v of l.voices) {
            if ((voice !== undefined && v.id !== voice) || v.stopAt !== undefined) continue;
            v.stopAt = Math.max(from, v.start);
            v.fadeFrames = fadeFrames;
            n++;
        }
        return n;
    }

    // -- rendering ---------------------------------------------------------------

    /** True when the lease has sound at or after `from`. */
    private pending(l: Lease, from: number): boolean {
        return l.voices.length > 0 || (l.streamEnd ?? 0) > from;
    }

    /** Earliest frame at or after `from` where a lease on the bus has sound. */
    private firstSound(busName: string, from: number): number | undefined {
        let first: number | undefined;
        const see = (f: number) => (first = first === undefined ? f : Math.min(first, f));
        for (const l of this.leases.values()) {
            if (l.info.bus !== busName) continue;
            for (const v of l.voices) see(Math.max(from, v.start));
            for (const b of l.blocks) if (b.start + b.data.length / 2 > from) see(Math.max(from, b.start));
        }
        return first;
    }

    /**
     * Add the bus's sound for `frames` frames from `start` into stereo `out`.
     * Sound that ends before `keepFrom` is forgotten. Returns whether any was added.
     */
    private render(
        busName: string,
        out: Float32Array,
        start: number,
        frames: number,
        keepFrom = start + frames,
    ): boolean {
        const end = start + frames;
        let any = false;
        for (const l of this.leases.values()) {
            if (l.info.bus !== busName) continue;
            if (!this.pending(l, start)) {
                l.gainNow = l.info.gain;
                continue;
            }
            if (this.scratch.length < frames * 2) this.scratch = new Float32Array(frames * 2);
            const mix = this.scratch.subarray(0, frames * 2);
            mix.fill(0);
            let sounded = false;

            for (const b of l.blocks) {
                const from = Math.max(start, b.start);
                const to = Math.min(end, b.start + b.data.length / 2);
                if (to <= from) continue;
                sounded = true;
                const src = b.data.subarray((from - b.start) * 2, (to - b.start) * 2);
                const at = (from - start) * 2;
                for (let i = 0; i < src.length; i++) mix[at + i] += src[i];
            }
            l.blocks = l.blocks.filter((b) => b.start + b.data.length / 2 > keepFrom);

            for (const v of l.voices) {
                const len = v.clip.length / 2;
                const from = Math.max(start, v.start);
                const to = Math.min(end, voiceEnd(v));
                for (let f = from; f < to; f++) {
                    const p = (f - v.start) % len;
                    const g =
                        v.stopAt !== undefined && f >= v.stopAt ? v.gain * (1 - (f - v.stopAt) / v.fadeFrames) : v.gain;
                    mix[(f - start) * 2] += v.clip[p * 2] * g;
                    mix[(f - start) * 2 + 1] += v.clip[p * 2 + 1] * g;
                }
                if (to > from) sounded = true;
            }
            l.voices = l.voices.filter((v) => voiceEnd(v) > keepFrom);

            if (sounded) {
                // A gain change is spread over the piece so it does not click.
                const g0 = l.gainNow;
                const dg = (l.info.gain - g0) / frames;
                for (let f = 0; f < frames; f++) {
                    const g = g0 + dg * (f + 1);
                    out[f * 2] += mix[f * 2] * g;
                    out[f * 2 + 1] += mix[f * 2 + 1] * g;
                }
                any = true;
            }
            l.gainNow = l.info.gain;
        }
        return any;
    }

    /** The chunks every pushed bus owes its outputs by now. */
    pump(now: number): BusChunk[] {
        const out: BusChunk[] = [];
        const nowFrame = frameOf(now);
        for (const bus of this.buses.values()) {
            if (bus.cfg.name === AUDIO_BUS_MAIN) continue;
            const horizon = frameOf(now + this.ahead(bus));
            if (bus.next !== undefined && bus.next < nowFrame) bus.next = undefined;
            for (;;) {
                const sound = this.firstSound(bus.cfg.name, bus.next ?? nowFrame);
                if (sound === undefined) {
                    bus.next = undefined;
                    break;
                }
                if (bus.next === undefined || sound >= bus.next + bus.chunkFrames) {
                    // A new run begins at the chunk holding the sound. Until that chunk
                    // is due the bus rests, so a sound asked for now is not held behind it.
                    const start = Math.floor(sound / bus.chunkFrames) * bus.chunkFrames;
                    if (start > horizon) {
                        bus.next = undefined;
                        break;
                    }
                    bus.next = start;
                    bus.incarnation++;
                }
                if (bus.next > horizon) break;
                const samples = new Float32Array(bus.chunkFrames * 2);
                if (this.render(bus.cfg.name, samples, bus.next, bus.chunkFrames)) {
                    let peak = 0;
                    for (let i = 0; i < samples.length; i++) peak = Math.max(peak, Math.abs(samples[i]));
                    if (peak >= bus.peak || now - bus.peakAt >= 1000) {
                        bus.peak = Math.min(1, peak);
                        bus.peakAt = now;
                    }
                    bus.chunks++;
                    out.push({ bus: bus.cfg.name, playAt: msOf(bus.next), incarnation: bus.incarnation, samples });
                }
                bus.next += bus.chunkFrames;
            }
        }
        return out;
    }

    /** True when a lease on the show audio has sound at or after `ms`. */
    mainPending(ms: number): boolean {
        const from = frameOf(ms);
        for (const l of this.leases.values()) {
            if (l.info.bus === AUDIO_BUS_MAIN && this.pending(l, from)) return true;
        }
        return false;
    }

    /**
     * The playback loop has published show audio from `startMs`: `frames` frames
     * at `rate`, the ones past `hopFrames` being its crossfade tail. Sound asked
     * for from now on starts after it.
     */
    mainSent(startMs: number, rate: number, hopFrames: number, frames: number): void {
        const tailFrames = Math.max(0, frames - hopFrames);
        this.mainTail =
            tailFrames > 0 ? { at: startMs + (hopFrames * 1000) / rate, ms: (tailFrames * 1000) / rate } : undefined;
        this.mainRendered = Math.max(this.mainRendered, frameOf(startMs) + Math.ceil((frames * BUS_RATE) / rate));
    }

    /**
     * Add the show audio's injected sound to an interleaved chunk that starts
     * at player clock time `startMs`. The chunk may be at any rate and have one
     * or two channels. Frames past `hopFrames` are its crossfade tail: the sound
     * fades out over them and in over the head of the next chunk, as the song does.
     */
    mixMain(samples: Float32Array, channels: number, rate: number, startMs: number, hopFrames: number): boolean {
        const frames = samples.length / channels;
        const tailFrames = Math.max(0, frames - hopFrames);
        const first = frameOf(startMs);
        const span = Math.ceil((hopFrames * BUS_RATE) / rate);
        const all = Math.ceil((frames * BUS_RATE) / rate);
        const main = this.buses.get(AUDIO_BUS_MAIN);
        // The head fades in only under the tail of the chunk before.
        const prev = this.mainTail;
        const headFrames =
            prev && Math.abs(prev.at - startMs) < 0.5 ? Math.min(hopFrames, Math.round((prev.ms * rate) / 1000)) : 0;
        this.mainSent(startMs, rate, hopFrames, frames);
        if (!main || !this.mainPending(startMs)) return false;
        // One frame before and two after, for the rate conversion.
        const src = new Float32Array((all + 3) * 2);
        // The next chunk reads again from just before this one's hop ends.
        if (!this.render(AUDIO_BUS_MAIN, src, first - 1, all + 3, first + span - 4)) return false;
        let peak = 0;
        const step = BUS_RATE / rate;
        const base = startMs * FRAMES_PER_MS - (first - 1);
        for (let i = 0; i < frames; i++) {
            const p = base + i * step;
            const k = Math.floor(p);
            const t = p - k;
            let w = 1;
            if (i < headFrames) w = 0.5 - 0.5 * Math.cos((Math.PI * (i + 0.5)) / headFrames);
            else if (i >= hopFrames) w = 0.5 + 0.5 * Math.cos((Math.PI * (i - hopFrames + 0.5)) / tailFrames);
            const l = (src[k * 2] + (src[k * 2 + 2] - src[k * 2]) * t) * w;
            const r = (src[k * 2 + 1] + (src[k * 2 + 3] - src[k * 2 + 1]) * t) * w;
            peak = Math.max(peak, Math.abs(l), Math.abs(r));
            if (channels === 1) samples[i] += (l + r) / 2;
            else {
                samples[i * channels] += l;
                samples[i * channels + 1] += r;
            }
        }
        if (peak === 0) return false;
        const now = startMs - this.mainLeadMs;
        if (peak >= main.peak || now - main.peakAt >= 1000) {
            main.peak = Math.min(1, peak);
            main.peakAt = now;
        }
        main.chunks++;
        return true;
    }
}
