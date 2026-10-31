import { defineConfig } from 'tsup';

export default defineConfig([
  {
    entry: { index: 'src/index.ts', core: 'src/core.ts', vanilla: 'src/vanilla.ts' },
    format: ['cjs', 'esm'],
    dts: true,
    sourcemap: true,
    clean: true,
    onSuccess: 'cp src/styles.css dist/styles.css',
  },
  {
    // One file a page can inline, with no zod: whatever writes the page validates the data.
    entry: { player: 'src/iife.ts' },
    format: ['iife'],
    globalName: 'ZodalSpeech',
    outExtension: () => ({ js: '.iife.js' }),
    noExternal: [/.*/],
    minify: true,
    sourcemap: false,
    clean: false,
  },
]);
