// The summary of gate documents, review snapshots, and the section-level diff between two revisions.
import { existsSync, lstatSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { GATE_DOCS } from './ticket.mjs';

// A gate document has a summary under the title, then only the sections with content.
// The last document of a gate is its primary document: its snapshots keep the plain gate name.
export const ALL_GATE_DOCS = [...new Set(Object.values(GATE_DOCS).flat())];
export const SUMMARY_BUDGET = 150;
export const DOC_BUDGET = 1500;
const NO_CONTENT = /^(?:none|n\/a|tbd|todo|-)?\.?$/i;
const MAX_DIFF_LINES = 60;

const normalize = (text) => String(text).replace(/^\uFEFF/, '').replace(/\r\n/g, '\n');

/** The sections of a Markdown body after the frontmatter. depth 2 splits on "## ", depth 3 also on "### " (named "<h2> › <h3>"). Headings inside code fences do not split. */
export function sections(text, depth = 2) {
  const lines = normalize(text).split('\n');
  let index = 0;
  if (lines[0] === '---') {
    const end = lines.indexOf('---', 1);
    if (end !== -1) index = end + 1;
  }
  const out = [{ heading: '', line: index + 1, lines: [] }];
  let fence = '';
  let parent = '';
  for (; index < lines.length; index++) {
    const line = lines[index];
    const marker = /^\s*(`{3,}|~{3,})/.exec(line)?.[1];
    if (marker && (!fence || marker[0] === fence[0] && marker.length >= fence.length)) fence = fence ? '' : marker;
    const heading = !fence && /^(#{2,3})\s+(.+?)\s*$/.exec(line);
    if (heading && heading[1].length <= depth) {
      if (heading[1].length === 2) parent = heading[2];
      out.push({ heading: heading[1].length === 2 ? heading[2] : `${parent || '(top)'} › ${heading[2]}`, line: index + 1, lines: [] });
    } else out.at(-1).lines.push(line);
  }
  return out.map((item) => ({ heading: item.heading, line: item.line, text: item.lines.join('\n').trim() }))
    .filter((item) => item.heading || item.text);
}

/** Words that a reader reads: prose, lists, and tables. Code fences, diagrams, and link targets do not count. */
export function countWords(text) {
  const prose = normalize(text).replace(/^(\s*)(`{3,}|~{3,})[\s\S]*?^\1\2[^\n]*$/gm, ' ').replace(/\]\([^)]*\)/g, ']');
  return (prose.match(/[\p{L}\p{N}]+(?:['’.-][\p{L}\p{N}]+)*/gu) ?? []).length;
}

/** The summary of a gate document: the text between the title and the first "## " heading. */
export function summaryBlock(text) {
  const top = sections(text)[0];
  if (!top || top.heading) return '';
  return top.text.split('\n').filter((line) => !/^#\s/.test(line)).join('\n').trim();
}

/** The word counts of a gate document, and its sections that have no content. */
export function summaryCheck(text) {
  const all = sections(text);
  const summary = summaryBlock(text);
  const words = countWords(summary);
  const total = words + all.filter((item) => item.heading).reduce((sum, item) => sum + countWords(item.text), 0);
  const empty = all.filter((item) => item.heading && NO_CONTENT.test(item.text.trim())).map((item) => ({ heading: item.heading, line: item.line }));
  return { summary, words, over: words > SUMMARY_BUDGET, total, totalOver: total > DOC_BUDGET, empty };
}

export function gateName(value) {
  const wanted = String(value ?? '').trim().replace(/\?$/, '').toLowerCase();
  const names = Object.keys(GATE_DOCS);
  const match = names.find((name) => name.slice(0, -1).toLowerCase() === wanted);
  if (!match) throw new Error(`Unknown gate: ${value}. Use one of: ${names.join(', ')}.`);
  return match;
}

const slug = (gate) => gate.replace(/\?$/, '').toLowerCase();

function snapshotDir(ticketDir) {
  return path.join(ticketDir, 'approvals', 'snapshots');
}

function listSnapshots(ticketDir, stem) {
  const dir = snapshotDir(ticketDir);
  if (!existsSync(dir)) return [];
  const pattern = new RegExp(`^${stem}-(\\d+)\\.md$`);
  return readdirSync(dir).map((name) => ({ name, n: Number(pattern.exec(name)?.[1]) }))
    .filter((item) => Number.isInteger(item.n) && item.n > 0)
    .sort((a, b) => a.n - b.n)
    .map((item) => ({ ...item, file: path.join(dir, item.name), rel: `approvals/snapshots/${item.name}` }));
}

/** The documents of a gate, in the order of GATE_DOCS, with the snapshot name stem of each (the primary document keeps the gate name). The README record's doc, when set, replaces the primary document. */
function gateDocuments(ticketDir, ticket, gate) {
  const docs = [...GATE_DOCS[gate]];
  const set = ticket.gates.find((item) => item.name === gate)?.doc;
  if (set) docs[docs.length - 1] = set;
  return docs.map((doc, index) => {
    if (doc.endsWith('/')) throw new Error(`${gate} has no single document to snapshot.`);
    const file = path.join(ticketDir, ...doc.split('/'));
    if (!existsSync(file)) throw new Error(`${doc} does not exist yet.`);
    if (lstatSync(file).isSymbolicLink()) throw new Error(`${doc} must not be a link.`);
    return { doc, file, stem: index === docs.length - 1 ? slug(gate) : `${slug(gate)}-${doc.replace(/\.md$/i, '').replace(/[^a-z0-9]+/gi, '-').toLowerCase()}` };
  });
}

/** Saves each document of the gate as its next review snapshot. An unchanged document reuses its latest snapshot. On a failure it removes the snapshots that it wrote. */
export function saveSnapshot(ticketDir, ticket, gate) {
  const snapshots = [];
  try {
    for (const { doc, file, stem } of gateDocuments(ticketDir, ticket, gate)) {
      const text = readFileSync(file, 'utf8');
      const latest = listSnapshots(ticketDir, stem).at(-1);
      if (latest && readFileSync(latest.file, 'utf8') === text) { snapshots.push({ doc, snapshot: latest.rel, n: latest.n, written: false }); continue; }
      const n = (latest?.n ?? 0) + 1;
      const target = path.join(snapshotDir(ticketDir), `${stem}-${n}.md`);
      mkdirSync(path.dirname(target), { recursive: true });
      writeFileSync(target, text, { flag: 'wx' });
      snapshots.push({ doc, snapshot: `approvals/snapshots/${path.basename(target)}`, n, written: true });
    }
  } catch (error) {
    for (const item of snapshots.filter((entry) => entry.written)) rmSync(path.join(ticketDir, ...item.snapshot.split('/')), { force: true });
    throw error;
  }
  return { gate, snapshots };
}

function lineDiff(before, after) {
  const a = before ? before.split('\n') : [];
  const b = after ? after.split('\n') : [];
  const table = Array.from({ length: a.length + 1 }, () => new Uint32Array(b.length + 1));
  for (let i = a.length - 1; i >= 0; i--) {
    for (let j = b.length - 1; j >= 0; j--) table[i][j] = a[i] === b[j] ? table[i + 1][j + 1] + 1 : Math.max(table[i + 1][j], table[i][j + 1]);
  }
  const out = [];
  let i = 0;
  let j = 0;
  while (i < a.length || j < b.length) {
    if (i < a.length && j < b.length && a[i] === b[j]) { i++; j++; }
    else if (i < a.length && (j === b.length || table[i + 1][j] >= table[i][j + 1])) out.push(`- ${a[i++]}`);
    else out.push(`+ ${b[j++]}`);
  }
  return out;
}

/** Section-level changes from one revision to the next, in the order of the new document. */
export function sectionDiff(before, after) {
  const label = (list) => {
    const seen = new Map();
    return list.map((item) => {
      const name = item.heading || '(top)';
      const count = (seen.get(name) ?? 0) + 1;
      seen.set(name, count);
      return { ...item, name: count > 1 ? `${name} (${count})` : name };
    });
  };
  const old = label(sections(before, 3));
  const now = label(sections(after, 3));
  const out = [];
  for (const item of now) {
    const previous = old.find((entry) => entry.name === item.name);
    if (!previous) out.push({ section: item.name, status: 'added', lines: lineDiff('', item.text) });
    else if (previous.text === item.text) out.push({ section: item.name, status: 'same', lines: [] });
    else out.push({ section: item.name, status: 'changed', lines: lineDiff(previous.text, item.text) });
  }
  for (const item of old.filter((entry) => !now.some((other) => other.name === entry.name))) {
    out.push({ section: item.name, status: 'removed', lines: lineDiff(item.text, '') });
  }
  return out;
}

/** The diff of each document of a gate against its own latest review snapshot, with the current summary. */
export function diffGate(ticketDir, ticket, gate) {
  const documents = gateDocuments(ticketDir, ticket, gate).map(({ doc, file, stem }) => {
    const text = readFileSync(file, 'utf8');
    const card = summaryBlock(text);
    const latest = listSnapshots(ticketDir, stem).at(-1);
    if (!latest) return { doc, card, snapshot: null, changed: null, sections: [] };
    const list = sectionDiff(readFileSync(latest.file, 'utf8'), text);
    return { doc, card, snapshot: latest.rel, n: latest.n, changed: list.some((item) => item.status !== 'same'), sections: list };
  });
  return { gate, documents };
}

function renderDocument(result) {
  if (!result.snapshot) {
    return [`Summary of ${result.doc} (first review):`, result.card || `(no summary: write at most ${SUMMARY_BUDGET} words under the title before you ask for approval)`].join('\n');
  }
  const lines = [`Changed since your last review (${result.doc} vs ${result.snapshot}):`];
  let budget = MAX_DIFF_LINES;
  for (const item of result.sections.filter((entry) => entry.status !== 'same')) {
    const plus = item.lines.filter((line) => line.startsWith('+')).length;
    const minus = item.lines.length - plus;
    lines.push(`- ${item.section}: ${item.status} (+${plus} / -${minus} lines)`);
    for (const line of item.lines.filter((entry) => entry.trim().length > 1)) {
      if (budget-- <= 0) break;
      lines.push(`  ${line}`);
    }
  }
  if (budget < 0) lines.push(`  [more changes: open ${result.doc}]`);
  return lines.join('\n');
}

/** The approval form text, one block for each document that needs one: its summary on a first review, else only its changes since the last review. */
export function renderDiff(result) {
  const blocks = result.documents.filter((item) => !item.snapshot || item.changed).map(renderDocument);
  if (blocks.length) return blocks.join('\n\n');
  const names = result.documents.map((item) => item.doc);
  return `${names.join(' and ')} ${names.length > 1 ? 'have' : 'has'} not changed since your last review (${result.documents.map((item) => item.snapshot).join(', ')}).`;
}

/** The cells of one Markdown table row. An escaped pipe stays in its cell. */
export function tableRow(line) {
  return line.trim().replace(/^\|/, '').replace(/\|$/, '').split(/(?<!\\)\|/).map((cell) => cell.trim().replace(/\\\|/g, '|'));
}

/** The top-level numbered items of a section: [{ n, title, body }]. The body is the indented text under the item. */
export function numberedItems(text) {
  const items = [];
  for (const line of text.split('\n')) {
    const start = /^(\d+)[.)]\s+(.*)$/.exec(line);
    if (start) items.push({ n: Number(start[1]), title: start[2].trim(), lines: [] });
    else if (items.length && (/^\s+\S/.test(line) || !line.trim())) items.at(-1).lines.push(line);
    else if (items.length && line.trim()) items.at(-1).lines.push(line);
  }
  return items.map((item) => {
    const indent = Math.min(...item.lines.filter((line) => line.trim()).map((line) => line.match(/^\s*/)[0].length), 99);
    const body = item.lines.map((line) => line.slice(Math.min(indent, line.match(/^\s*/)[0].length))).join('\n').trim();
    return { n: item.n, title: item.title, body };
  });
}
