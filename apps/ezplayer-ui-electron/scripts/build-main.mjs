// scripts/build-main.js
import { build } from 'esbuild';
import { builtinModules } from 'node:module';

const nodeExternals = [
    'form-data',
    'electron',
    'electron-store',
    'proper-lockfile',
    'url',
    'follow-redirects',
    'proxy-from-env',
    'mpg123-decoder',
    ...builtinModules,
    ...builtinModules.map((m) => `node:${m}`),
];

build({
    entryPoints: ['main.ts'],
    bundle: true,
    platform: 'node',
    format: 'esm',
    outfile: 'dist/main.js',
    sourcemap: true,
    external: nodeExternals, // Hmm, prevents dynamic require issue...
}).catch(() => process.exit(1));

build({
    entryPoints: ['showfolder.ts'],
    bundle: true,
    platform: 'node',
    format: 'esm',
    outfile: 'dist/showfolder.js',
    sourcemap: true,
    external: nodeExternals, // Hmm, prevents dynamic require issue...
}).catch(() => process.exit(1));

build({
    entryPoints: ['mainsrc/workers/playbackmaster.ts'],
    bundle: true,
    platform: 'node',
    format: 'esm',
    outfile: 'dist/workers/playbackmaster.js',
    sourcemap: true,
    external: nodeExternals, // Hmm, prevents dynamic require issue...
}).catch(() => process.exit(1));

build({
    entryPoints: ['mainsrc/workers/mp3decodeworker.ts'],
    bundle: true,
    platform: 'node',
    format: 'esm',
    outfile: 'dist/workers/mp3decodeworker.js',
    sourcemap: true,
    external: nodeExternals, // Hmm, prevents dynamic require issue...
}).catch(() => process.exit(1));
