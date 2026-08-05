import { defineConfig } from 'vitest/config';

// Use a separate config so vitest doesn't inherit vite.config.ts's `root: './src'`,
// which scopes scanning to the React renderer. Tests for the main-process code
// live under `mainsrc/`.
export default defineConfig({
    test: {
        include: ['mainsrc/**/*.{test,spec}.?(c|m)[jt]s?(x)', 'src/**/*.{test,spec}.?(c|m)[jt]s?(x)'],
        environment: 'node',
    },
});
