#!/usr/bin/env node
// Manifest-driven slide deck builder.
//
//   node build.mjs <deck-manifest.yaml> [options]
//
// Options:
//   --roots <file>   roots map to use      (default: ./roots.yaml next to this script)
//   --out <dir>      output directory      (default: ../build/<deck name>)
//   --pdf            also emit a PDF        (default: HTML only)
//   --no-d2          skip d2 -> svg compile (use already-compiled svgs)
//
// Pipeline: compile d2 -> stage asset namespaces -> concat fragments -> run marp.
// See roots.yaml for how logical roots map to physical (and cross-repo) paths.

import {
    readFileSync,
    writeFileSync,
    rmSync,
    cpSync,
    mkdirSync,
    existsSync,
} from 'node:fs';
import { dirname, resolve, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import { spawnSync } from 'node:child_process';
import { parse as parseYaml } from 'yaml';
import { compileDiagrams } from './compile-diagrams.mjs';

const require = createRequire(import.meta.url);
const here = dirname(fileURLToPath(import.meta.url));

// ---- args -----------------------------------------------------------------
const argv = process.argv.slice(2);
const flags = { pdf: false, d2: true };
let manifestPath = null;
let rootsPath = join(here, 'roots.yaml');
let outOverride = null;
for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--pdf') flags.pdf = true;
    else if (a === '--no-d2') flags.d2 = false;
    else if (a === '--roots') rootsPath = resolve(argv[++i]);
    else if (a === '--out') outOverride = resolve(argv[++i]);
    else if (!manifestPath) manifestPath = resolve(a);
    else die(`unexpected argument: ${a}`);
}
if (!manifestPath) die('usage: node build.mjs <deck-manifest.yaml> [--roots f] [--out d] [--pdf] [--no-d2]');

function die(msg) {
    console.error(`build-deck: ${msg}`);
    process.exit(1);
}
function readYaml(p) {
    if (!existsSync(p)) die(`file not found: ${p}`);
    return parseYaml(readFileSync(p, 'utf8'));
}

// ---- load config ----------------------------------------------------------
const roots = readYaml(rootsPath);
const rootsDir = dirname(rootsPath);
const manifest = readYaml(manifestPath);
const manifestDir = dirname(manifestPath);

if (!manifest.name) die(`manifest ${manifestPath} is missing "name"`);
if (!Array.isArray(manifest.fragments)) die(`manifest ${manifestPath} is missing "fragments" list`);

const resolveRoot = (table, label) => (ns) => {
    const rel = roots?.[table]?.[ns];
    if (rel == null) die(`unknown ${label} root "${ns}" — add it to ${relative(process.cwd(), rootsPath)}`);
    return resolve(rootsDir, rel);
};
const fragRoot = resolveRoot('fragments', 'fragment');
const assetRoot = resolveRoot('assets', 'asset');

const outDir = outOverride || resolve(here, '..', 'build', manifest.name);

// ---- 1. compile d2 (delegated to the shared compiler) ---------------------
// see compile-diagrams.mjs

// ---- 2. stage asset namespaces -------------------------------------------
function stageAssets() {
    for (const ns of Object.keys(roots.assets ?? {})) {
        const from = assetRoot(ns);
        if (!existsSync(from)) {
            console.warn(`  ! asset root "${ns}" -> ${from} does not exist; skipping`);
            continue;
        }
        const to = join(outDir, ns);
        cpSync(from, to, { recursive: true });
        console.log(`  cp  ${ns}/  <-  ${relative(process.cwd(), from)}`);
    }
}

// ---- 3. concat fragments --------------------------------------------------
function buildFrontMatter() {
    const fm = {
        marp: true,
        theme: manifest.theme ?? 'default',
        paginate: manifest.paginate ?? true,
        ...(manifest.title ? { title: manifest.title } : {}),
        ...(manifest.marp ?? {}), // escape hatch: raw extra directives
    };
    const lines = Object.entries(fm).map(([k, v]) => `${k}: ${typeof v === 'string' ? v : JSON.stringify(v)}`);
    return `---\n${lines.join('\n')}\n---\n`;
}

function concatFragments() {
    const parts = manifest.fragments.map((entry) => {
        const [ns, ...rest] = entry.split('/');
        const path = join(fragRoot(ns), rest.join('/'));
        if (!existsSync(path)) die(`fragment not found: ${entry} -> ${path}`);
        console.log(`  +   ${entry}`);
        return readFileSync(path, 'utf8').trim();
    });
    // One slide boundary between every fragment. Fragments may contain their
    // own internal `---` separators for multi-slide sections.
    return parts.join('\n\n---\n\n');
}

// ---- 4. run marp ----------------------------------------------------------
function runMarp(deckMd) {
    const marpBin = require.resolve('@marp-team/marp-cli/marp-cli.js');
    const themesDir = resolve(rootsDir, roots?.themes?.dir ?? './themes');
    const htmlOut = join(outDir, `${manifest.name}.html`);
    const args = [
        marpBin,
        deckMd,
        '-o',
        htmlOut,
        '--html',
        '--allow-local-files',
        '--theme-set',
        themesDir,
    ];
    const targets = [{ flag: null, out: htmlOut }];
    if (flags.pdf) {
        // run a second pass for pdf so both artifacts land in outDir
        const pdfOut = join(outDir, `${manifest.name}.pdf`);
        targets.push({ flag: '--pdf', out: pdfOut });
    }
    for (const t of targets) {
        const a = t.flag
            ? [marpBin, deckMd, '-o', t.out, t.flag, '--html', '--allow-local-files', '--theme-set', themesDir]
            : args;
        const r = spawnSync(process.execPath, a, { stdio: 'inherit' });
        if (r.status !== 0) die(`marp failed (exit ${r.status}) for ${relative(process.cwd(), t.out)}`);
        console.log(`  =>  ${relative(process.cwd(), t.out)}`);
    }
}

// ---- run ------------------------------------------------------------------
(async () => {
    console.log(`Building deck "${manifest.name}"  (manifest: ${relative(process.cwd(), manifestPath)})`);
    rmSync(outDir, { recursive: true, force: true });
    mkdirSync(outDir, { recursive: true });

    if (flags.d2) {
        const assetDirs = Object.keys(roots.assets ?? {}).map(assetRoot);
        await compileDiagrams(assetDirs, { log: (m) => console.log(m) });
    }
    stageAssets();

    const deckMd = join(outDir, `${manifest.name}.md`);
    writeFileSync(deckMd, buildFrontMatter() + '\n' + concatFragments() + '\n');
    console.log(`  md  ${relative(process.cwd(), deckMd)}`);

    runMarp(deckMd);
    console.log('Done.');
    // The d2 WASM runtime keeps the event loop alive; exit explicitly.
    process.exit(0);
})().catch((e) => die(e?.stack || String(e)));
