// Fails when a built file still imports @zodal/media while it is only a build-time dependency:
// a consumer would get types it cannot resolve (`any`) or a module it cannot find.
import { readdirSync, readFileSync } from 'node:fs';
import { readFile } from 'node:fs/promises';

const pkg = JSON.parse(await readFile(new URL('../package.json', import.meta.url)));
if (!pkg.dependencies?.['@zodal/media']) {
  const bad = readdirSync('dist')
    .filter((f) => /\.(d\.c?ts|c?js)$/.test(f))
    .filter((f) => /from\s*['"]@zodal\/media|require\(['"]@zodal\/media|import\(['"]@zodal\/media/.test(readFileSync(`dist/${f}`, 'utf8')));
  if (bad.length) {
    console.error(`@zodal/media is not a dependency, yet dist imports it: ${bad.join(', ')}`);
    process.exit(1);
  }
}
