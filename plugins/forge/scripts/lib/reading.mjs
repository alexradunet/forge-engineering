// Layered reading levels in gate documents, review snapshots, and the section-level diff between two revisions.
import { existsSync, lstatSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';

// Cumulative word budgets at about 230 words a minute. The 1-minute card must fit the approval form.
export const LEVELS = [
  { key: '1', heading: '⚡ 1 min', budget: 150 },
  { key: '5', heading: '☕ 5 min', budget: 1150 },
  { key: '10', heading: '📖 10 min', budget: 2300 },
  { key: '15', heading: '🔬 15 min', budget: 3450 },
];
export const APPENDIX = '📂 Appendix';
export const LAYERED_DOCS = ['scope.md', 'plan.draft.md', 'review.md', 'close.draft.md'];
export const GATE_PRIMARY = { 'Scoped?': 'scope.md', 'Planned?': 'plan.draft.md', 'Shippable?': 'review.md', 'Learned?': 'close.draft.md' };
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

/** The reading levels of a document: each level with its own and cumulative word count, plus order problems. */
export function readingLevels(text) {
  const all = sections(text);
  const position = (heading) => all.findIndex((item) => item.heading === heading || item.heading.startsWith(`${heading} `) || item.heading.startsWith(`${heading}:`));
  let cumulative = 0;
  const levels = [];
  for (const level of LEVELS) {
    const at = position(level.heading);
    if (at === -1) continue;
    const words = countWords(all[at].text);
    cumulative += words;
    levels.push({ ...level, line: all[at].line, at, words, cumulative, over: cumulative > level.budget });
  }
  const appendix = position(APPENDIX);
  const ordered = levels.every((level, index) => index === 0 || level.at > levels[index - 1].at)
    && (appendix === -1 || levels.every((level) => level.at < appendix));
  return { quick: levels.find((level) => level.key === '1') ?? null, levels, ordered };
}

/** The text of the 1-minute card, for the approval form. */
export function quickCard(text) {
  const card = sections(text).find((item) => item.heading === LEVELS[0].heading || item.heading.startsWith(`${LEVELS[0].heading} `));
  return card?.text ?? '';
}

export function gateName(value) {
  const wanted = String(value ?? '').trim().replace(/\?$/, '').toLowerCase();
  const names = [...Object.keys(GATE_PRIMARY), 'Understood?', 'Agreed?', 'Diagnosed?', 'Designed?', 'Briefed?'];
  const match = names.find((name) => name.slice(0, -1).toLowerCase() === wanted);
  if (!match) throw new Error(`Unknown gate: ${value}. Use one of: ${names.join(', ')}.`);
  return match;
}

const slug = (gate) => gate.replace(/\?$/, '').toLowerCase();

export function snapshotDir(ticketDir) {
  return path.join(ticketDir, 'approvals', 'snapshots');
}

export function listSnapshots(ticketDir, gate) {
  const dir = snapshotDir(ticketDir);
  if (!existsSync(dir)) return [];
  const pattern = new RegExp(`^${slug(gate)}-(\\d+)\\.md$`);
  return readdirSync(dir).map((name) => ({ name, n: Number(pattern.exec(name)?.[1]) }))
    .filter((item) => Number.isInteger(item.n) && item.n > 0)
    .sort((a, b) => a.n - b.n)
    .map((item) => ({ ...item, file: path.join(dir, item.name), rel: `approvals/snapshots/${item.name}` }));
}

/** The primary document of a gate: the README record's doc, else the full-v2 default. */
export function gateDocument(ticketDir, ticket, gate) {
  const doc = ticket.gates.find((item) => item.name === gate)?.doc || GATE_PRIMARY[gate];
  if (!doc || doc.endsWith('/')) throw new Error(`${gate} has no single document to snapshot.`);
  const file = path.join(ticketDir, ...doc.split('/'));
  if (!existsSync(file)) throw new Error(`${doc} does not exist yet.`);
  if (lstatSync(file).isSymbolicLink()) throw new Error(`${doc} must not be a link.`);
  return { doc, file };
}

/** Saves the document as the next review snapshot. An unchanged document reuses the latest snapshot. */
export function saveSnapshot(ticketDir, ticket, gate) {
  const { doc, file } = gateDocument(ticketDir, ticket, gate);
  const text = readFileSync(file, 'utf8');
  const all = listSnapshots(ticketDir, gate);
  const latest = all.at(-1);
  if (latest && readFileSync(latest.file, 'utf8') === text) return { gate, doc, snapshot: latest.rel, n: latest.n, written: false };
  const n = (latest?.n ?? 0) + 1;
  const target = path.join(snapshotDir(ticketDir), `${slug(gate)}-${n}.md`);
  mkdirSync(path.dirname(target), { recursive: true });
  writeFileSync(target, text, { flag: 'wx' });
  return { gate, doc, snapshot: `approvals/snapshots/${path.basename(target)}`, n, written: true };
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

/** The diff of a gate document against its latest review snapshot, with the current ⚡ card. */
export function diffGate(ticketDir, ticket, gate) {
  const { doc, file } = gateDocument(ticketDir, ticket, gate);
  const text = readFileSync(file, 'utf8');
  const card = quickCard(text);
  const latest = listSnapshots(ticketDir, gate).at(-1);
  if (!latest) return { gate, doc, card, snapshot: null, changed: null, sections: [] };
  const list = sectionDiff(readFileSync(latest.file, 'utf8'), text);
  return { gate, doc, card, snapshot: latest.rel, n: latest.n, changed: list.some((item) => item.status !== 'same'), sections: list };
}

/** The approval form text: the ⚡ card on a first review, else only "🔀 Changed since your last review". */
export function renderDiff(result) {
  if (!result.snapshot) return [`⚡ ${result.doc} (first review):`, result.card || '(no ⚡ 1 min card: add one before you ask for approval)'].join('\n');
  if (!result.changed) return `🔀 ${result.doc} has not changed since your last review (${result.snapshot}).`;
  const lines = [`🔀 Changed since your last review (${result.doc} vs ${result.snapshot}):`];
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
