// scripts/build-main.js
import { build } from 'esbuild';
import { builtinModules } from 'node:module';
import { execSync } from 'node:child_process';

const BUILD_DATE = new Date().toISOString();
const GIT_REPO = (() => {
    try {
        return execSync('git remote get-url origin').toString().trim();
    } catch (e) {
        return 'N/A';
    }
})();
const GIT_SHA = (() => {
    try {
        return execSync('git rev-parse --short HEAD').toString().trim();
    } catch (e) {
        console.error(e);
        return 'unknown';
    }
})();
const GIT_BRANCH = (() => {
    try {
        return execSync('git rev-parse --abbrev-ref HEAD').toString().trim();
    } catch (e) {
        console.error(e);
        return 'unknown';
    }
})();
const GIT_TAG = (() => {
    try {
        return execSync('git describe --tags --abbrev=0 HEAD').toString().trim();
    } catch (e) {
        return 'N/A';
    }
})();

// Keep external ONLY what genuinely can't be bundled: electron itself, native .node
// addons (loaded via bindings() relative to their own dir), WASM/asset-relative loaders,
// and node builtins. Everything else (pure-JS deps) is bundled by esbuild — the
// createRequire banner above makes their require() calls work, so we no longer depend on
// electron-builder's pnpm collector to put them in the asar. scripts/depaudit.cjs gates
// this: any external a bundle still references must be present in the packaged asar.
const nodeExternals = [
    'electron',
    'electron-store',
    'electron-updater',
    'proper-lockfile',
    'url',
    'mpg123-decoder',
    'mpg123-decoder-ezp',
    'bindings',
    'node-gyp',
    // @ezplayer/icmp-ping wraps a native addon loaded via bindings(). It
    // MUST stay external so the call site's __dirname is the package's
    // own dist/ at runtime — otherwise bindings walks up from the bundled
    // location and can't find the .node file.
    '@ezplayer/icmp-ping',
    'ws',
    'http',
    'fs/promises',
    'express',
    'zstd-codec',
    ...builtinModules,
    ...builtinModules.map((m) => `node:${m}`),
];

const common = {
    bundle: true,
    platform: 'node',
    format: 'esm',
    sourcemap: true,
    external: nodeExternals,
    // We emit ESM but bundle CJS deps (e.g. koa) that call require() for node builtins
    // like require('node:util'). In an ESM bundle esbuild's __require shim has no real
    // `require` to delegate to and throws "Dynamic require of X is not supported". Recreate
    // a real require via createRequire so those builtin requires resolve at runtime.
    banner: {
        js: "import { createRequire as __ezpCreateRequire } from 'node:module';\nconst require = __ezpCreateRequire(import.meta.url);",
    },
    // Build-time constants (string-literals inlined into code)
    define: {
        __BUILD_DATE__: JSON.stringify(BUILD_DATE),
        __GIT_SHA__: JSON.stringify(GIT_SHA),
        __GIT_BRANCH__: JSON.stringify(GIT_BRANCH),
        __GIT_TAG__: JSON.stringify(GIT_TAG),
        __GIT_REPO__: JSON.stringify(GIT_REPO),
        'import.meta.env.BUILD_DATE': JSON.stringify(BUILD_DATE),
        'import.meta.env.GIT_REPO': JSON.stringify(GIT_REPO),
        'import.meta.env.GIT_BRANCH': JSON.stringify(GIT_BRANCH),
        'import.meta.env.GIT_SHA': JSON.stringify(GIT_SHA),
        'import.meta.env.GIT_TAG': JSON.stringify(GIT_TAG),
    },
};

const _uibuild = {
    bundle: true,
    platform: 'browser',
    format: 'module',
    sourcemap: true,
    external: nodeExternals,
    // Build-time constants (string-literals inlined into code)
    define: {
        __BUILD_DATE__: JSON.stringify(BUILD_DATE),
        __GIT_SHA__: JSON.stringify(GIT_SHA),
        __GIT_BRANCH__: JSON.stringify(GIT_BRANCH),
        __GIT_TAG__: JSON.stringify(GIT_TAG),
        __GIT_REPO__: JSON.stringify(GIT_REPO),
        'import.meta.env.BUILD_DATE': JSON.stringify(BUILD_DATE),
        'import.meta.env.GIT_REPO': JSON.stringify(GIT_REPO),
        'import.meta.env.GIT_BRANCH': JSON.stringify(GIT_BRANCH),
        'import.meta.env.GIT_SHA': JSON.stringify(GIT_SHA),
        'import.meta.env.GIT_TAG': JSON.stringify(GIT_TAG),
    },
};

const run = (entryPoints, outfile) =>
    build({ ...common, entryPoints: [entryPoints], outfile }).catch(() => process.exit(1));

//const uirun = (entryPoints, outfile) =>
//  build({ ...uibuild, entryPoints: [entryPoints], outfile })
//    .catch(() => process.exit(1));

await run('main.ts', 'dist/main.js');
await run('showfolder.ts', 'dist/showfolder.js');
await run('mainsrc/workers/playbackmaster.ts', 'dist/workers/playbackmaster.js');
await run('mainsrc/workers/mp3decodeworker.ts', 'dist/workers/mp3decodeworker.js');
await run('mainsrc/workers/zstdworker.ts', 'dist/workers/zstdworker.js');
await run('mainsrc/workers/pingworker.ts', 'dist/workers/pingworker.js');
await run('mainsrc/workers/rfsync.ts', 'dist/workers/rfsync.js');
await run('mainsrc/workers/ezvcsync.ts', 'dist/workers/ezvcsync.js');
await run('mainsrc/workers/cloudpoll.ts', 'dist/workers/cloudpoll.js');
await run('mainsrc/workers/server-worker.ts', 'dist/workers/server-worker.js');
//await uirun('src/audio-window.ts', 'dist/assets/audio-window.js');
