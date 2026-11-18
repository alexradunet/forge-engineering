// Rewrites the README frontmatter of a ticket, and lists the documents that an approval manifest hashes.
// gate-approve uses it. Other lines of the README keep their bytes.
import { readFileSync } from 'node:fs';
import path from 'node:path';

const FIELD_ORDER = ['name', 'doc', 'need', 'status', 'date', 'manifest', 'hash'];

function yamlValue(value) {
  const text = String(value);
  return /^[\w./?@+-]+$/.test(text) && !['null', '~', 'true', 'false'].includes(text) ? text : JSON.stringify(text);
}

export function inlineGate(gate) {
  const keys = [...FIELD_ORDER.filter((key) => key in gate), ...Object.keys(gate).filter((key) => !FIELD_ORDER.includes(key))];
  return `{ ${keys.filter((key) => gate[key] != null && gate[key] !== '').map((key) => `${key}: ${yamlValue(gate[key])}`).join(', ')} }`;
}

/**
 * Replaces scalar values and the gates list in README frontmatter. Other lines keep their bytes.
 * @param {string} text README text
 * @param {{ scalars?: Record<string,string>, dropComment?: string[], gates?: object[] }} change
 */
export function rewriteFrontmatter(text, { scalars = {}, dropComment = [], gates } = {}) {
  const bom = text.startsWith('\uFEFF') ? '\uFEFF' : '';
  const eol = text.includes('\r\n') ? '\r\n' : '\n';
  const source = text.replace(/^\uFEFF/, '').replace(/\r\n/g, '\n');
  const match = /^---\n([\s\S]*?)\n---(\n|$)/.exec(source);
  if (!match) throw new Error('Ticket README needs frontmatter.');
  const lines = match[1].split('\n');
  for (const [key, value] of Object.entries(scalars)) {
    const index = lines.findIndex((line) => line.startsWith(`${key}:`));
    if (index < 0) throw new Error(`The frontmatter has no ${key} field.`);
    const comment = dropComment.includes(key) ? '' : (/\s+#.*$/.exec(lines[index].slice(key.length + 1))?.[0] ?? '');
    const padded = comment ? `${key}: ${value}`.padEnd(lines[index].length - comment.length) : `${key}: ${value}`;
    lines[index] = padded + comment;
  }
  if (gates) {
    const start = lines.findIndex((line) => /^gates:/.test(line));
    if (start < 0) throw new Error('The frontmatter has no gates field.');
    let end = start + 1;
    while (end < lines.length && (lines[end] === '' || /^\s/.test(lines[end]))) end++;
    const rest = lines[start].slice('gates:'.length);
    const comment = /^\s+#/.test(rest) ? rest : '';
    lines.splice(start, end - start, `gates:${comment}`, ...gates.map((gate) => `  - ${inlineGate(gate)}`));
  }
  const body = source.slice(match[0].length);
  return bom + `---\n${lines.join('\n')}\n---${match[2]}${body}`.replace(/\n/g, eol);
}

function readManifest(dir, relative) {
  return JSON.parse(readFileSync(path.join(dir, ...relative.split(/[\\/]/)), 'utf8'));
}

// Documents that an approval manifest hashes. A log that is hashed must not get appended text.
export function hashedDocuments(dir, gates) {
  const names = new Set();
  for (const gate of gates) {
    if (!gate.manifest) continue;
    try { for (const doc of readManifest(dir, gate.manifest).documents ?? []) names.add(String(doc.path).replaceAll('\\', '/').toLowerCase()); }
    catch { /* lint reports unreadable manifests */ }
  }
  return names;
}
