/*
 * Print what a sequence file says about its own layout, the way the player
 * reads it: the inline and extended variable headers, the EZ descriptor
 * prefix and body when present, and the descriptor derived from embedded
 * XR/XN when present. With both, the two fingerprints are compared.
 *
 * --layout <showFolder> runs the player's own derivation on that folder's
 * xlights_rgbeffects.xml and xlights_networks.xml and prints the body and
 * fingerprint a renderer is expected to write for it; given a file as well,
 * the file's EZ header is compared with that expectation byte for byte.
 *
 * Usage: node fseq-describe.js [<file.fseq>] [--layout <showFolder>] [--json] [--models]
 *
 * Exit code 0 when the file carries a decodable EZ header (and matches the
 * layout when one is given), 2 when it does not, 1 on a read error. Bundle from apps/ezplayer-ui-electron with
 *   pnpm exec esbuild ../../packages/epp/src/tools/fseq-describe.ts --bundle --platform=node --format=cjs --outfile=<out>.js
 */

import { FSEQReaderAsync, summarizeFSEQHeader } from '../formats/FSeqUtil';
import * as fsp from 'node:fs/promises';
import * as path from 'node:path';
import { decompressExtended, readExtendedHeader, readExtendedText, XL_NETWORKS_HEADER, XL_RGBEFFECTS_HEADER } from '../formats/FSeqExtended';
import { decodeDescriptorHeader, descriptorFromEmbeddedXlights, EZ_DESCRIPTOR_HEADER, peekDescriptorPrefix } from '../pipeline/Descriptor';
import { ChannelDescriptor, descriptorHash } from '../pipeline/InputMap';

async function main(argv: string[]): Promise<number> {
    const layoutAt = argv.indexOf('--layout');
    const layoutDir = layoutAt >= 0 ? argv[layoutAt + 1] : undefined;
    const args = argv.filter((a, i) => !a.startsWith('--') && (layoutAt < 0 || i !== layoutAt + 1));
    const json = argv.includes('--json');
    const showModels = argv.includes('--models');
    const file = args[0];
    if (!file && !layoutDir) {
        console.error('usage: fseq-describe [<file.fseq>] [--layout <showFolder>] [--json] [--models]');
        return 1;
    }

    // What the player would pin for this layout, and so what a renderer must write.
    let expected: { fingerprint: number; body: string; models: ChannelDescriptor['models'] } | undefined;
    if (layoutDir) {
        const xr = await fsp.readFile(path.join(layoutDir, 'xlights_rgbeffects.xml'), 'utf8');
        const xn = await fsp.readFile(path.join(layoutDir, 'xlights_networks.xml'), 'utf8');
        const d = descriptorFromEmbeddedXlights(xr, xn, { logger: (m) => console.error(m) });
        expected = { fingerprint: d.fingerprint!, body: JSON.stringify({ totalChannels: d.totalChannels, models: d.models }), models: d.models };
    }
    if (!file) {
        if (json) console.log(JSON.stringify({ layout: layoutDir, fingerprint: expected!.fingerprint, body: expected!.body }, null, 2));
        else {
            console.log(`layout ${layoutDir}: fingerprint ${expected!.fingerprint} (0x${expected!.fingerprint.toString(16)}), ${expected!.models.length} models`);
            console.log(expected!.body);
        }
        return 0;
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
            const body = new TextDecoder().decode(decompressExtended(bytes.subarray(16)));
            if (expected) {
                out.layout = {
                    dir: layoutDir,
                    fingerprintMatches: ez.fingerprint === expected.fingerprint,
                    bodyMatches: body === expected.body,
                    expectedFingerprint: expected.fingerprint,
                    expectedBody: body === expected.body ? undefined : expected.body,
                    fileBody: body === expected.body ? undefined : body,
                };
            }
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
        if (out.layout) console.log(`vs layout: ${JSON.stringify(out.layout)}`);
        if (showModels) {
            const models = ez?.models ?? (out.fromXlights as { models?: unknown } | undefined)?.models;
            if (models) console.log(JSON.stringify(models, null, 2));
        }
    }
    if (!ez) return 2;
    const l = out.layout as { fingerprintMatches: boolean; bodyMatches: boolean } | undefined;
    return l && !(l.fingerprintMatches && l.bodyMatches) ? 2 : 0;
}

main(process.argv.slice(2)).then(
    (code) => process.exit(code),
    (e) => {
        console.error((e as Error).message);
        process.exit(1);
    },
);
