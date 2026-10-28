// Bundles server.mjs and its dependencies into one file inside the forge plugin,
// because a plugin install has no `npm install` step. Copies public\ next to it.
import { build } from 'esbuild';
import { cpSync, rmSync, mkdirSync } from 'node:fs';

const out = '../../plugins/forge/board';
rmSync(out, { recursive: true, force: true });
mkdirSync(out, { recursive: true });

await build({
  entryPoints: ['server.mjs'],
  outfile: `${out}/server.mjs`,
  bundle: true,
  platform: 'node',
  target: 'node20',
  format: 'esm',
  minify: true,
  legalComments: 'none',
  // Bundled CommonJS dependencies call require() for Node built-ins.
  banner: {
    js: "import { createRequire as __forgeCreateRequire } from 'node:module'; const require = __forgeCreateRequire(import.meta.url);",
  },
  logLevel: 'info',
});
cpSync('public', `${out}/public`, { recursive: true });
// Mermaid renders diagrams in the browser only; ship its single-file build, no network.
mkdirSync(`${out}/public/vendor`, { recursive: true });
cpSync('node_modules/mermaid/dist/mermaid.min.js', `${out}/public/vendor/mermaid.min.js`);
console.log(`Copied public -> ${out}/public`);
