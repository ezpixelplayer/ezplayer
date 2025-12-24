import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
    plugins: [react()],
    base: '/', // Ensure assets are served from root
    server: {
        port: 5173, // Different port from Koa server (3000)
        open: true,
    },
    build: {
        outDir: 'dist',
        assetsDir: 'assets',
    },
});
