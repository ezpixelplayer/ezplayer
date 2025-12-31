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

const nodeExternals = [
    'form-data',
    'electron',
    'electron-store',
    'proper-lockfile',
    'url',
    'follow-redirects',
    'ping',
    'proxy-from-env',
    'mpg123-decoder',
    'mpg123-decoder-moc',
    'bindings',
    'node-gyp',
    'koa',
    '@koa/bodyparser',
    '@koa/router',
    '@koa/send',
    'koa-static',
    'ws',
    'http',
    'fs/promises',
    'debug',
    'http-errors',
    'http-assert',
    'resolve-path',
    'statuses',
    'toidentifier',
    'express',
    ...builtinModules,
    ...builtinModules.map((m) => `node:${m}`),
];

const common = {
    bundle: true,
    platform: 'node',
    format: 'esm',
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
//await uirun('src/audio-window.ts', 'dist/assets/audio-window.js');
