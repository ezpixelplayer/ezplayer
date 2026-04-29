import { defineConfig } from 'tsup';

export default defineConfig({
    entry: ['src/index.ts'],
    format: ['esm'],
    target: 'esnext',
    dts: true,
    splitting: false,
    sourcemap: true,
    clean: true,
    outDir: 'dist',
    noExternal: ['xllayoutcalcs', /^@mui\/icons-material(\/|$)/],
    esbuildOptions(options) {
        options.alias = {
            ...(options.alias || {}),
            '@mui/icons-material': '@mui/icons-material/esm',
        };
    },
});
