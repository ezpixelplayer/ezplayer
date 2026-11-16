/*
 * Print what a sequence file says about its own layout, the way the player
 * reads it: the inline and extended variable headers, the EZ descriptor
 * prefix and body when present, and the descriptor derived from embedded
 * XR/XN when present. With both, the two fingerprints are compared.
 *
 * Usage: node fseq-describe.js <file.fseq> [--json] [--models]
 *
 * Exit code 0 when the file carries a decodable EZ header, 2 when it does
 * not, 1 on a read error. Bundle from apps/ezplayer-ui-electron with
 *   pnpm exec esbuild ../../packages/epp/src/tools/fseq-describe.ts --bundle --platform=node --format=cjs --outfile=<out>.js
 */

import { FSEQReaderAsync, summarizeFSEQHeader } from '../formats/FSeqUtil';
import { readExtendedHeader, readExtendedText, XL_NETWORKS_HEADER, XL_RGBEFFECTS_HEADER } from '../formats/FSeqExtended';
import { decodeDescriptorHeader, descriptorFromEmbeddedXlights, EZ_DESCRIPTOR_HEADER, peekDescriptorPrefix } from '../pipeline/Descriptor';
import { ChannelDescriptor, descriptorHash } from '../pipeline/InputMap';

async function main(argv: string[]): Promise<number> {
    const args = argv.filter((a) => !a.startsWith('--'));
    const json = argv.includes('--json');
    const showModels = argv.includes('--models');
    const file = args[0];
    if (!file) {
        console.error('usage: fseq-describe <file.fseq> [--json] [--models]');
        return 1;
    }
    const header = await FSEQReaderAsync.readFSEQHeaderAsync(file);
    const out: Record<string, unknown> = {
        file,
        summary: summarizeFSEQHeader(header),
        channels: header.channels,
        frames: header.frames,
        msPerFrame: header.msperframe,
        inlineHeaders: header.headers,
        extendedHeaders: header.extendedHeaders,
    };

    let ez: ChannelDescriptor | undefined;
    const ezRef = header.extendedHeaders[EZ_DESCRIPTOR_HEADER];
    if (ezRef) {
        const bytes = await readExtendedHeader(file, ezRef);
        const prefix = peekDescriptorPrefix(bytes);
        out.ezPrefix = prefix;
        ez = decodeDescriptorHeader(bytes);
        if (ez) {
            const recomputed = descriptorHash(ez);
            out.ez = {
                totalChannels: ez.totalChannels,
                modelCount: ez.models.length,
                curvesApplied: ez.curvesApplied,
                colorOrderApplied: ez.colorOrderApplied,
                nodeOrder: ez.nodeOrder,
                fingerprint: ez.fingerprint,
                fingerprintRecomputed: recomputed,
                fingerprintMatches: recomputed === ez.fingerprint,
                modelCountMatchesPrefix: prefix?.modelCount === ez.models.length,
                totalChannelsWithinFile: ez.totalChannels <= header.channels,
                models: showModels ? ez.models : undefined,
            };
        } else {
            out.ez = { error: 'EZ header present but not decodable' };
        }
    }

    const xr = await readExtendedText(file, header, XL_RGBEFFECTS_HEADER);
    const xn = await readExtendedText(file, header, XL_NETWORKS_HEADER);
    if (xr && xn) {
        try {
            const derived = descriptorFromEmbeddedXlights(xr, xn, { logger: (m) => console.error(m) });
            out.fromXlights = {
                totalChannels: derived.totalChannels,
                modelCount: derived.models.length,
                fingerprint: derived.fingerprint,
                matchesEz: ez ? derived.fingerprint === ez.fingerprint : undefined,
                models: showModels ? derived.models : undefined,
            };
        } catch (e) {
            out.fromXlights = { error: (e as Error).message };
        }
    }

    if (json) {
        console.log(JSON.stringify(out, null, 2));
    } else {
        console.log(`${file}: ${out.summary}`);
        console.log(`inline headers: ${JSON.stringify(header.headers)}`);
        console.log(`extended headers: ${Object.keys(header.extendedHeaders).join(', ') || '(none)'}`);
        if (out.ezPrefix) console.log(`EZ prefix: ${JSON.stringify(out.ezPrefix)}`);
        if (out.ez) console.log(`EZ: ${JSON.stringify({ ...(out.ez as object), models: undefined })}`);
        if (out.fromXlights) console.log(`from XR/XN: ${JSON.stringify({ ...(out.fromXlights as object), models: undefined })}`);
        if (showModels) {
            const models = ez?.models ?? (out.fromXlights as { models?: unknown } | undefined)?.models;
            if (models) console.log(JSON.stringify(models, null, 2));
        }
    }
    return ez ? 0 : 2;
}

main(process.argv.slice(2)).then(
    (code) => process.exit(code),
    (e) => {
        console.error((e as Error).message);
        process.exit(1);
    },
);
