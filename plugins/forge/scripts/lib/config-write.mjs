// Validated edits of the team config: flat frontmatter keys and the rows of
// the Checkouts (repo.md) and Queries (tracker.md) tables. Each call parses and
// validates the edited text first, and writes nothing when a problem exists.
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { KINDS, buildConfig } from './config.mjs';
import { ForgeError } from './repo.mjs';

const KEY = /^[A-Za-z][A-Za-z0-9_-]*$/;

export const TABLES = {
  checkouts: { kind: 'repo', title: 'Checkouts', code: [0, 1, 2] },
  queries: { kind: 'tracker', title: 'Queries', code: [0, 1] },
};

function fileOf(configDir, kind) {
  if (!KINDS.includes(kind)) throw new ForgeError(`Unknown config file "${kind}". Use one of: ${KINDS.join(', ')}.`, 'bad-args');
  return path.join(configDir, `${kind}.md`);
}

// Reads a file as LF text and remembers its BOM and line ending.
function readDoc(configDir, kind) {
  const file = fileOf(configDir, kind);
  if (!existsSync(file)) throw new ForgeError(`${file} does not exist. Run "forge.mjs seed" first.`, 'no-config');
  const raw = readFileSync(file, 'utf8');
  const bom = raw.startsWith('\uFEFF') ? '\uFEFF' : '';
  const eol = raw.includes('\r\n') ? '\r\n' : '\n';
  return { kind, file, raw, bom, eol, text: raw.slice(bom.length).replace(/\r\n/g, '\n') };
}

const serialize = (doc) => doc.bom + (doc.eol === '\n' ? doc.text : doc.text.replace(/\n/g, '\r\n'));

/** Formats a frontmatter value. A value that starts with "{" gets quotes. */
export function formatValue(value) {
  const v = String(value ?? '').trim();
  if (/[\r\n]/.test(v)) throw new ForgeError('A config value cannot hold a line break.', 'bad-value');
  if (v.startsWith('{')) {
    if (v.includes('"')) throw new ForgeError(`The value ${v} starts with "{" and holds a quote. forge cannot store it.`, 'bad-value');
    return `"${v}"`;
  }
  return v;
}

function setKey(doc, key, value) {
  if (!KEY.test(key)) throw new ForgeError(`Invalid key "${key}". Use letters, digits, "_", or "-".`, 'bad-args');
  const line = `${key}:${value === '' ? '' : ` ${value}`}`;
  const lines = doc.text.split('\n');
  if (lines[0] !== '---') {
    doc.text = `---\n${line}\n---\n${doc.text}`;
    return;
  }
  const end = lines.indexOf('---', 1);
  if (end < 0) throw new ForgeError(`${doc.file}: frontmatter is missing its closing "---" delimiter.`, 'bad-config');
  const at = lines.slice(1, end).findIndex((l) => new RegExp(`^${key}:`).test(l));
  if (at >= 0) lines[at + 1] = line;
  else lines.splice(end, 0, line);
  doc.text = lines.join('\n');
}

/**
 * Sets frontmatter values. assignments: ["tracker.prefix=APP", ...].
 * Returns the changed files. Writes nothing when the result is invalid.
 */
export function setValues(configDir, assignments) {
  if (!assignments.length) throw new ForgeError('Usage: forge.mjs config set <file>.<key>=<value> ...', 'bad-args');
  const docs = {};
  for (const a of assignments) {
    const m = /^([a-z]+)\.([^=]+)=(.*)$/s.exec(a);
    if (!m) throw new ForgeError(`"${a}" is not <file>.<key>=<value>, for example tracker.prefix=APP.`, 'bad-args');
    const [, kind, key, value] = m;
    docs[kind] ??= readDoc(configDir, kind);
    setKey(docs[kind], key, formatValue(value));
  }
  return commit(configDir, docs);
}

function formatCell(text, code) {
  const v = String(text ?? '').trim();
  if (/[\r\n|]/.test(v)) throw new ForgeError(`A table cell cannot hold "|" or a line break: ${v}`, 'bad-value');
  return v && code && !v.includes('`') ? `\`${v}\`` : v;
}

const firstCell = (line) => line.trim().replace(/^\|/, '').split('|')[0].trim().replace(/^`(.*)`$/, '$1');

/**
 * Adds or replaces the row with the same first cell in the Checkouts or
 * Queries table. With remove, deletes that row. Writes nothing when invalid.
 */
export function upsertRow(configDir, table, cells, { remove = false } = {}) {
  const spec = TABLES[table];
  if (!spec) throw new ForgeError(`Unknown table "${table}". Use one of: ${Object.keys(TABLES).join(', ')}.`, 'bad-args');
  const name = String(cells[0] ?? '').trim();
  if (!name) throw new ForgeError(`Usage: forge.mjs config row ${table} <name> ${remove ? '--delete' : '<cells...>'}`, 'bad-args');
  const doc = readDoc(configDir, spec.kind);
  const lines = doc.text.split('\n');
  const heading = lines.findIndex((l) => /^#{1,6}\s/.test(l) && l.includes(spec.title));
  if (heading < 0) throw new ForgeError(`${doc.file} has no "${spec.title}" section.`, 'bad-config');
  let start = -1;
  for (let i = heading + 1; i < lines.length && !/^#{1,6}\s/.test(lines[i]); i++) {
    if (/^\s*\|/.test(lines[i])) { start = i; break; }
  }
  if (start < 0) throw new ForgeError(`The "${spec.title}" section of ${doc.file} has no table.`, 'bad-config');
  let end = start;
  while (end + 1 < lines.length && /^\s*\|/.test(lines[end + 1])) end++;
  const width = lines[start].trim().replace(/^\||\|$/g, '').split('|').length;
  if (cells.length > width) throw new ForgeError(`The "${spec.title}" table has ${width} columns, not ${cells.length}.`, 'bad-args');
  const rowAt = lines.slice(start + 2, end + 1).findIndex((l) => firstCell(l) === name);
  const at = rowAt < 0 ? -1 : start + 2 + rowAt;
  if (remove) {
    if (at < 0) return { configDir, changed: [] };
    lines.splice(at, 1);
  } else {
    const padded = [...cells, ...Array(width - cells.length).fill('')];
    const row = `| ${padded.map((c, i) => formatCell(c, spec.code.includes(i))).join(' | ')} |`.replace(/ {2}\|/g, ' |');
    if (at >= 0) lines[at] = row; else lines.splice(end + 1, 0, row);
  }
  doc.text = lines.join('\n');
  return commit(configDir, { [spec.kind]: doc });
}

function commit(configDir, docs) {
  const texts = {};
  for (const kind of KINDS) {
    const file = path.join(configDir, `${kind}.md`);
    if (docs[kind]) texts[kind] = docs[kind].text;
    else if (existsSync(file)) texts[kind] = readFileSync(file, 'utf8');
  }
  const config = buildConfig(texts, configDir);
  const changed = [];
  for (const doc of Object.values(docs)) {
    const out = serialize(doc);
    if (out === doc.raw) continue;
    writeFileSync(doc.file, out);
    changed.push(`config/${doc.kind}.md`);
  }
  return { configDir, changed, config };
}
