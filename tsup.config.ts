import { defineConfig } from 'tsup';

export default defineConfig([
  {
    entry: { index: 'src/index.ts', core: 'src/core.ts', vanilla: 'src/vanilla.ts', media: 'src/media.ts' },
    format: ['cjs', 'esm'],
    // @zodal/media is bundled into the JS until it is on npm; its subpath types cannot be inlined
    // (tsup resolves files, not package exports), so scripts/check-dist.mjs (prepublishOnly)
    // refuses a publish until @zodal/media is a real dependency. The IIFE is unaffected.
    dts: true,
    sourcemap: true,
    clean: true,
    noExternal: [/^@zodal\/media(\/|$)/],
    onSuccess: 'cp src/styles.css dist/styles.css',
  },
  {
    // One file a page can inline, with no zod: whatever writes the page validates the data.
    entry: { player: 'src/iife.ts' },
    format: ['iife'],
    globalName: 'ZodalSpeech',
    outExtension: () => ({ js: '.iife.js' }),
    noExternal: [/.*/],
    // A page has no `process`, and the bundled immer and zustand read it.
    define: { 'process.env.NODE_ENV': '"production"' },
    minify: true,
    sourcemap: false,
    clean: false,
  },
]);
