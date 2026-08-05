import { defineConfig } from 'vitest/config';

export default defineConfig({
    test: {
        include: ['src/tests/**/*.test.ts'],
        environment: 'node',
        // One app instance at a time: the DDP port (4048) is fixed by the
        // player's sender, and Electron boots are heavy anyway.
        fileParallelism: false,
        testTimeout: 90_000,
        hookTimeout: 90_000,
        retry: 1,
    },
});
