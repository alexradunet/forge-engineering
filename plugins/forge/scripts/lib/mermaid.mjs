// The Mermaid file that the wiki page uses to draw a diagram block: plugins/forge/vendor/mermaid/mermaid.tiny.js.
// It is the only third-party program in the plugin (vendor/mermaid/NOTICE.md). A page loads it from its own folder
// or from its own server, never from a network, and only when the page has a diagram block.
import { createHash } from 'node:crypto';
import { existsSync, lstatSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const MERMAID_FILE = 'mermaid.tiny.js';
export const MERMAID_VERSION = '12.3.0';
/** The SHA-256 of the file. tests/wiki-page.test.mjs checks it, so a change of the file is a change of this line. */
export const MERMAID_SHA256 = 'c41f5236091b83f524c4940f97a16b2b14a76f21ff84aea4fd6b66421d8a2a9a';
/** The same hash for the `integrity` attribute of a served page. */
export const MERMAID_INTEGRITY = `sha256-${Buffer.from(MERMAID_SHA256, 'hex').toString('base64')}`;
/** The route of the file on a forge server. */
export const MERMAID_ROUTE = `/vendor/${MERMAID_FILE}`;
const BLOCK = '<pre data-lang="mermaid">';

export function mermaidPath() {
  return fileURLToPath(new URL(`../../vendor/mermaid/${MERMAID_FILE}`, import.meta.url));
}

/** True when the HTML of a page has a Mermaid block (markdown() in markdown.mjs makes it from a code block with the name mermaid). */
export function needsMermaid(html) {
  return String(html).includes(BLOCK);
}

const sha256 = (bytes) => createHash('sha256').update(bytes).digest('hex');

/** The bytes of the file. A file with another hash is an error: the page must not run a changed program. */
export function readMermaid() {
  const bytes = readFileSync(mermaidPath());
  if (sha256(bytes) !== MERMAID_SHA256) throw new Error(`${MERMAID_FILE} of the plugin does not have the hash of forge ${MERMAID_VERSION}.`);
  return bytes;
}

/** Puts the file into `dir`, next to a file page, when it is not there or is not the same. Gives { file, written }. */
export function copyMermaid(dir, { dryRun = false } = {}) {
  const file = path.join(dir, MERMAID_FILE);
  const present = existsSync(file);
  if (present && (lstatSync(file).isSymbolicLink() || !lstatSync(file).isFile())) throw new Error(`${file} must be a regular file, not a link.`);
  if (present && sha256(readFileSync(file)) === MERMAID_SHA256) return { file, written: false };
  if (!dryRun) {
    mkdirSync(dir, { recursive: true });
    writeFileSync(file, readMermaid());
  }
  return { file, written: !dryRun };
}
