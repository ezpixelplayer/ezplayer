/**
 * Post-package dependency gate.
 *
 * The server/main code is esbuild-bundled but keeps a few packages EXTERNAL (native
 * addons, electron, WASM loaders, node builtins). Those must be present in the packaged
 * app.asar at runtime. electron-builder's pnpm dependency collector has repeatedly dropped
 * externalized transitive deps from the asar (electron-builder 25→26 / pnpm 10.29.3), which
 * crashed the app in the field with ERR_MODULE_NOT_FOUND.
 *
 * This script makes that failure loud at build time: it scans every NODE bundle in dist/
 * for the bare specifiers esbuild left external (i.e. things require()'d/imported at
 * runtime, not inlined), and fails the build if any of them is neither a node builtin nor
 * actually present in the packaged asar's node_modules.
 *
 * Runs as the last step of `pnpm build` (after electron-builder), so CI catches it.
 */
const fs = require('fs');
const path = require('path');
const { builtinModules } = require('module');
const asar = require('@electron/asar');

// Externals intentionally NOT in the asar's node_modules, and why they're safe:
//  - electron: provided by the Electron runtime, never packaged as a node_module.
//  - keygrip: `cookies`' optional dep, required only when SIGNING cookies (we don't).
//  - boom:    legacy hapi error lib, loaded only on a guarded error path.
// keygrip/boom are proven not to load at import (the worker bundle imports cleanly); if a
// future code path needs them, drop them from this allowlist and bundle/package them.
const ALLOW_MISSING = new Set(['electron', 'keygrip', 'boom']);

const builtins = new Set([...builtinModules, ...builtinModules.map((m) => `node:${m}`)]);
// Sane package-name shape — also filters out garbage matched inside minified code.
const PKG_NAME = /^(?:@[\w.-]+\/)?[\w.-]+$/;

function findAsar(dir) {
    if (!fs.existsSync(dir)) return null;
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
        const p = path.join(dir, e.name);
        if (e.isDirectory()) {
            const found = findAsar(p);
            if (found) return found;
        } else if (e.name === 'app.asar') {
            return p;
        }
    }
    return null;
}

function nodeBundles(dir, acc = []) {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
        const p = path.join(dir, e.name);
        if (e.isDirectory()) {
            // Skip the vite-built renderer — it's a browser bundle with everything inlined.
            if (e.name === 'assets') continue;
            nodeBundles(p, acc);
        } else if (e.name.endsWith('.js')) {
            acc.push(p);
        }
    }
    return acc;
}

const asarPath = findAsar(path.resolve('release'));
if (!asarPath) {
    console.error('[depaudit] No app.asar found under release/ — run this after electron-builder.');
    process.exit(1);
}

// Packages physically present in the asar's node_modules.
const asarPkgs = new Set();
for (const entry of asar.listPackage(asarPath, {})) {
    const m = entry
        .split('\\')
        .join('/')
        .match(/node_modules\/((?:@[^/]+\/)?[^/]+)/);
    if (m) asarPkgs.add(m[1]);
}

// Bare specifiers still referenced (external) by the node bundles.
const specRe = /(?:from\s*|require\(\s*|import\(\s*)["']([^"'.][^"']*)["']/g;
const refs = new Map(); // pkg -> Set(bundle basename)
for (const file of nodeBundles(path.resolve('dist'))) {
    const src = fs.readFileSync(file, 'utf8');
    let m;
    while ((m = specRe.exec(src))) {
        const spec = m[1];
        if (spec.startsWith('node:')) continue;
        const parts = spec.split('/');
        const pkg = spec.startsWith('@') ? parts.slice(0, 2).join('/') : parts[0];
        if (!PKG_NAME.test(pkg)) continue;
        if (!refs.has(pkg)) refs.set(pkg, new Set());
        refs.get(pkg).add(path.basename(file));
    }
}

const missing = [];
for (const [pkg, where] of [...refs].sort((a, b) => a[0].localeCompare(b[0]))) {
    if (builtins.has(pkg) || asarPkgs.has(pkg) || ALLOW_MISSING.has(pkg)) continue;
    missing.push(`  ${pkg}  (referenced by: ${[...where].sort().join(', ')})`);
}

if (missing.length) {
    console.error(
        `[depaudit] FAIL — ${missing.length} runtime dependency(ies) referenced by bundles but MISSING from ${path.relative('.', asarPath)}:`,
    );
    console.error(missing.join('\n'));
    console.error(
        '\n[depaudit] Fix: bundle it (remove from nodeExternals in scripts/build-main.mjs), or make electron-builder package it.',
    );
    process.exit(1);
}
console.log(
    `[depaudit] OK — every external bundle reference is a builtin or present in ${path.relative('.', asarPath)}.`,
);
