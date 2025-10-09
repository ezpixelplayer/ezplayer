import { defineConfig } from 'tsup';

export default defineConfig({
  entry: ['src/index.ts', 'test/**/*.ts'],
  format: ['esm'],           // or ['esm', 'cjs']
  target: 'es2020',
  dts: true,                 // generates .d.ts
  //minify: false,
  splitting: false,
  clean: true,
  outDir: 'dist',
});
