// The ticket canvas: one self-contained HTML page that shows a whole ticket on one board.
// It is a view of the ticket Markdown files. It loads nothing from a network, and it is never a source:
// no approval manifest lists it, and no step reads a fact from it.
// The live server (live-serve.mjs) gives the same page with a token, and then the page can send its comments.
// buildCanvas() gives the model (also `forge.mjs canvas <key> --json`), and renderCanvas() gives the page.
// With `nav` (ui.mjs), the page has the links to the board page and to the canvas of each other ticket.
import { existsSync, lstatSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { MERMAID_FILE, MERMAID_INTEGRITY, MERMAID_ROUTE, needsMermaid } from './mermaid.mjs';
import { STATE_EMOJI, parseTicket } from './ticket.mjs';
import { STATE_LABEL } from './board.mjs';
import { listSnapshots, numberedItems, sections, summaryBlock, tableRow } from './reading.mjs';
export { numberedItems, tableRow };
import { CANVAS_SCRIPT, CANVAS_STYLE } from './canvas-page.mjs';
import { GATE_TEXT, TOOLS_HTML, emptyHtml, esc, faviconUri, footHtml, frameHtml, gatesHtml, helpHtml, iconHtml, ingotHtml, navData, pageHtml, pageLabel, pillHtml, pixelText, switcherHtml, tagHtml } from './ui.mjs';

export const CANVAS_FILE = 'canvas.html';
export const LINK_MODES = ['vscode', 'file'];
const MAX_BYTES = 1024 * 1024;
const JOURNAL_ENTRIES = 8;
const WIDE_ZONE = 1180;
const LANE_WIDTH = 210;
const LANE_GAP = 84;

/**
 * How much the user must read of each section of a full-v3 document. A view of the page opens the cards of its tiers
 * and folds the other cards to a title strip.
 * `must`: the user decides a gate with it. `good`: it helps to know. `ai`: a working note of the agent.
 * Each section of a template has one entry here (tests/canvas.test.mjs). A section without an entry is `good`.
 */
export const TIERS = {
  'story.md': { must: ['summary', 'problem', 'scope', 'done when', 'facts', 'preserve', 'open questions'], good: ['answers'], ai: ['history', 'related work', 'sources not available'] },
  'map.md': { must: ['summary', 'components', 'flow'], good: [], ai: ['data, toggles, jobs', 'tests', 'terms'] },
  'plan.md': { must: ['summary', 'risks', 'decisions'], good: ['diagnosis', 'steps', 'tests', 'checks', 'assumptions'], ai: ['details'] },
  'review.md': { must: ['summary', 'changes', 'findings', 'not checked'], good: ['before and after', 'tests run'], ai: [] },
  'proof.md': { must: ['accepted gaps'], good: ['summary', 'checks', 'regression'], ai: ['automated test'] },
  'close.md': { must: ['summary', 'what you now know'], good: ['ticket summary'], ai: ['wiki changes'] },
  'journal.md': { must: [], good: [], ai: ['*'] },
};
// The gate at which the user reads a document. The proof comes after Shippable?, so the user reads it before Learned?.
const DOC_GATE = { 'story.md': 'Scoped?', 'map.md': 'Planned?', 'plan.md': 'Planned?', 'review.md': 'Shippable?', 'proof.md': 'Learned?', 'close.md': 'Learned?' };
const ZONE_GATES = { story: ['Scoped?'], code: ['Planned?'], plan: ['Planned?'], review: ['Shippable?', 'Learned?'], close: ['Learned?'], journal: [] };
const GATE_ZONE = { 'Scoped?': 'story', 'Planned?': 'plan', 'Shippable?': 'review', 'Learned?': 'close' };

const countWords = (text) => (String(text ?? '').match(/\S+/g) ?? []).length;

function tierOf(file, name) {
  const rows = TIERS[file];
  return ['must', 'ai'].find((tier) => rows?.[tier].includes(name.toLowerCase()) || rows?.[tier].includes('*')) ?? 'good';
}

// An exception moves a card up to `must`: a failed check, an open hypothesis, and a problem in the journal.
function grade(card) {
  const alert = (card.kind === 'check' && card.state === 'failed') || (card.kind === 'hypothesis' && card.state === 'open') || (card.kind === 'entry' && card.state === 'problem');
  return {
    ...card, tier: alert ? 'must' : tierOf(card.file, card.kind === 'summary' ? 'summary' : card.section), alert,
    gate: DOC_GATE[card.file] ?? '', words: countWords(card.markdown),
  };
}

/** The gate that the user reads for now: the first gate in review, else the first gate that is not approved. '' after the last gate. */
export function focusGate(gates) {
  const own = gates.filter((gate) => Object.hasOwn(GATE_ZONE, gate.name));
  return (own.find((gate) => gate.status === 'in-review') ?? own.find((gate) => !['approved', 'skipped'].includes(gate.status)))?.name ?? '';
}

const unesc = (value) => value.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&amp;/g, '&');
const slug = (value) => String(value ?? '').toLowerCase().replace(/[^\p{L}\p{N}]+/gu, '-').replace(/^-+|-+$/g, '') || 'x';
const plain = (value) => String(value ?? '').replace(/\[([^\]]*)\]\([^)]*\)/g, '$1').replace(/[`*]/g, '').replace(/\s+/g, ' ').trim();

function readDoc(dir, name) {
  const file = path.join(dir, ...name.split('/'));
  if (!existsSync(file)) return null;
  const info = lstatSync(file);
  if (info.isSymbolicLink() || !info.isFile()) throw new Error(`${name} must be a regular file, not a link.`);
  if (info.size > MAX_BYTES) throw new Error(`${name} exceeds 1 MiB.`);
  const text = readFileSync(file, 'utf8').replace(/^﻿/, '').replace(/\r\n/g, '\n');
  const all = sections(text);
  const top = all.find((item) => !item.heading);
  const title = /^#\s+(.+)$/m.exec(top?.text ?? '')?.[1].trim() ?? name;
  return { name, title, summary: summaryBlock(text), sections: all.filter((item) => item.heading) };
}

const section = (doc, name) => doc?.sections.find((item) => item.heading.toLowerCase() === name.toLowerCase()) ?? null;

function tableRows(text) {
  const lines = text.split('\n').filter((line) => /^\s*\|/.test(line));
  if (lines.length < 2 || !/^\s*\|?\s*:?-{2,}/.test(lines[1])) return [];
  const head = tableRow(lines[0]).map((cell) => cell.toLowerCase());
  return lines.slice(2).map((line) => Object.fromEntries(tableRow(line).map((cell, index) => [head[index] ?? `col${index}`, cell])));
}

const bullets = (text) => text.split('\n').map((line) => /^\s{0,3}[-*+]\s+(.*)$/.exec(line)?.[1]).filter(Boolean);

function checkState(title) {
  if (/🟢|\bverified\b/i.test(title)) return 'verified';
  if (/🔴|\bfailed\b/i.test(title)) return 'failed';
  if (/⚪|\bnot (?:proven|possible)\b/i.test(title)) return 'gap';
  return 'open';
}

function sectionCards(doc, zone, skip = []) {
  return (doc?.sections ?? []).filter((item) => !skip.includes(item.heading.toLowerCase())).map((item) => ({
    id: `${zone}-${slug(item.heading)}`, kind: 'section', title: item.heading, file: doc.name, section: item.heading, markdown: item.text,
  }));
}

function summaryCard(doc, zone) {
  if (!doc?.summary) return [];
  return [{ id: `${zone}-summary`, kind: 'summary', title: doc.title, file: doc.name, section: 'Summary', markdown: doc.summary }];
}

function journalEntries(doc) {
  return (doc?.sections ?? []).map((item) => {
    const match = /^(\d{4}-\d{2}-\d{2})\s+(?:(step)\s+(\d+)\s+(done|verified)|([a-z]+))\s*:?\s*(.*)$/i.exec(item.heading);
    if (!match) return { date: '', kind: 'log', step: null, title: item.heading, markdown: item.text };
    return {
      date: match[1], kind: match[2] ? 'step' : match[5].toLowerCase(), step: match[2] ? { n: Number(match[3]), state: match[4].toLowerCase() } : null,
      title: match[2] ? `Step ${match[3]} ${match[4].toLowerCase()}${match[6] ? `: ${match[6]}` : ''}` : match[6] || match[5], markdown: item.text,
    };
  });
}

function codeGraph(map) {
  const rows = tableRows(section(map, 'Components')?.text ?? '');
  const nodes = rows.filter((row) => row.component).map((row) => ({
    id: `node-${slug(plain(row.component))}`, name: plain(row.component), layer: plain(row.layer) || 'Other',
    file: row.file ?? '', role: row.role ?? '', change: /^(planned|done)$/i.test(plain(row.change)) ? plain(row.change).toLowerCase() : '',
  }));
  const byName = new Map(nodes.map((node) => [node.name.toLowerCase(), node]));
  const edges = [];
  for (const line of bullets(section(map, 'Flow')?.text ?? '')) {
    const match = /^(.+?)\s*(?:->|→)\s*(.+?)(?::\s*(.*))?$/.exec(line);
    if (!match) continue;
    const ends = [match[1], match[2]].map((name) => {
      const key = plain(name).toLowerCase();
      if (!byName.has(key)) {
        const node = { id: `node-${slug(plain(name))}`, name: plain(name), layer: 'Other', file: '', role: '', change: '' };
        byName.set(key, node);
        nodes.push(node);
      }
      return byName.get(key).id;
    });
    edges.push({ from: ends[0], to: ends[1], label: plain(match[3] ?? '') });
  }
  const lanes = [...new Set(nodes.map((node) => node.layer))];
  return { nodes, edges, lanes, tier: tierOf('map.md', 'components'), gate: DOC_GATE['map.md'], words: nodes.reduce((sum, node) => sum + countWords(node.role), 0) };
}

function v3Zones(dir, ticket) {
  const docs = Object.fromEntries(['story.md', 'plan.md', 'review.md', 'proof.md', 'map.md', 'journal.md', 'close.md'].map((name) => [name, readDoc(dir, name)]));
  const missing = Object.entries(docs).filter(([name, doc]) => !doc && name !== 'close.md').map(([name]) => name);
  const entries = journalEntries(docs['journal.md']);
  const stepState = new Map();
  for (const entry of entries.filter((item) => item.step)) {
    if (entry.step.state === 'verified' || !stepState.has(entry.step.n)) stepState.set(entry.step.n, entry.step.state);
  }
  const zones = [];

  const story = docs['story.md'];
  const questions = bullets(section(story, 'Open questions')?.text ?? '').map((line, index) => ({
    id: `story-question-${index + 1}`, kind: 'question', title: plain(line.split('?')[0]) + (line.includes('?') ? '?' : ''),
    file: 'story.md', section: 'Open questions', markdown: line.includes('?') ? line.slice(line.indexOf('?') + 1).trim() : '',
  }));
  zones.push({
    id: 'story', title: 'Story', files: ['story.md'], present: Boolean(story),
    cards: [...summaryCard(story, 'story'), ...sectionCards(story, 'story', ['open questions'])],
    people: ticket.people.map((person) => ({ ...person })), questions,
  });

  const map = docs['map.md'];
  zones.push({
    id: 'code', title: 'Code map', files: ['map.md'], present: Boolean(map),
    cards: summaryCard(map, 'code'), graph: codeGraph(map), more: sectionCards(map, 'code', ['components', 'flow']),
  });

  const plan = docs['plan.md'];
  const hypotheses = bullets(section(plan, 'Diagnosis')?.text ?? '').map((line, index) => {
    const match = /^(\S+)\s+(supported|rejected|open)\s*:\s*(.*)$/i.exec(line);
    return {
      id: `plan-hypothesis-${index + 1}`, kind: 'hypothesis', state: match ? match[2].toLowerCase() : 'open',
      title: match ? `${match[1]} ${match[2].toLowerCase()}` : `H${index + 1}`, file: 'plan.md', section: 'Diagnosis', markdown: match ? match[3] : line,
    };
  });
  const steps = numberedItems(section(plan, 'Steps')?.text ?? '').map((item) => ({
    id: `plan-step-${item.n}`, kind: 'step', n: item.n, state: stepState.get(item.n) ?? 'planned',
    title: `${item.n}. ${plain(item.title)}`, file: 'plan.md', section: 'Steps', markdown: item.body,
  }));
  zones.push({
    id: 'plan', title: 'Plan', files: ['plan.md'], present: Boolean(plan),
    cards: summaryCard(plan, 'plan'), hypotheses, steps, more: sectionCards(plan, 'plan', ['diagnosis', 'steps']),
  });

  const review = docs['review.md'];
  const proof = docs['proof.md'];
  const checks = numberedItems(section(proof, 'Checks')?.text ?? '').map((item) => ({
    id: `proof-check-${item.n}`, kind: 'check', n: item.n, state: checkState(item.title),
    title: `${item.n}. ${plain(item.title)}`, file: 'proof.md', section: 'Checks', markdown: item.body,
  }));
  zones.push({
    id: 'review', title: 'Review and proof', files: ['review.md', 'proof.md'], present: Boolean(review || proof),
    cards: [...summaryCard(review, 'review'), ...sectionCards(review, 'review'), ...summaryCard(proof, 'proof')],
    checks, more: sectionCards(proof, 'proof', ['checks']),
  });

  const close = docs['close.md'];
  if (close) zones.push({ id: 'close', title: 'Close', files: ['close.md'], present: true, cards: [...summaryCard(close, 'close'), ...sectionCards(close, 'close')] });

  const recent = entries.slice(-JOURNAL_ENTRIES).reverse();
  zones.push({
    id: 'journal', title: 'Journal', files: ['journal.md'], present: Boolean(docs['journal.md']), total: entries.length,
    cards: recent.map((entry, index) => ({
      id: `journal-${index + 1}`, kind: 'entry', state: entry.kind, title: `${entry.date} ${entry.kind === 'step' ? '' : `${entry.kind}: `}${entry.title}`.trim(),
      file: 'journal.md', section: entry.title, markdown: entry.markdown,
    })),
  });
  for (const zone of zones) {
    zone.gates = ZONE_GATES[zone.id] ?? [];
    for (const list of ['cards', 'questions', 'hypotheses', 'steps', 'checks', 'more']) if (zone[list]) zone[list] = zone[list].map(grade);
    // A person card comes from the README. It helps to know who waits, at each gate.
    if (zone.people) zone.people = zone.people.map((person) => ({ ...person, tier: 'good', gate: '', words: countWords([person.role, person.ask].filter(Boolean).join(' ')) }));
  }
  return { zones, missing };
}

/** The canvas model of one ticket folder. */
export function buildCanvas(dir, { now = new Date() } = {}) {
  const file = path.join(dir, 'README.md');
  if (lstatSync(file).isSymbolicLink()) throw new Error('README.md must not be a link.');
  const ticket = parseTicket(readFileSync(file, 'utf8'));
  const layout = 'board';
  const { zones, missing } = v3Zones(dir, ticket);
  const focus = focusGate(ticket.gates);
  const focusZone = (zones.find((zone) => zone.id === GATE_ZONE[focus]) ?? zones.find((zone) => zone.gates?.includes(focus)))?.id ?? '';
  return {
    version: 1,
    generated: now.toISOString().slice(0, 16).replace('T', ' '),
    layout,
    ticket: {
      key: ticket.key, title: ticket.title, short: ticket.short, state: ticket.state, emoji: STATE_EMOJI[ticket.state], phase: ticket.phase,
      workflow: ticket.workflow, next: ticket.next, waitingOn: ticket.waitingOn, updated: ticket.updated, item: ticket.item, branch: ticket.branch,
    },
    gates: ticket.gates.map((gate) => ({ name: gate.name, status: gate.status, doc: gate.doc ?? '', date: gate.date ?? '', reviews: gate.name === 'Sendable?' ? 0 : listSnapshots(dir, gate.name).length })),
    changes: ticket.changes.map((change) => ({ url: change.url, label: change.label ?? '', state: change.state })),
    focus, focusZone, zones, missing,
  };
}

// --- Markdown to HTML. Every character of the source is escaped; only the listed shapes become tags. ---

/** The link target for the page, or '' when the target must stay plain text. */
export function linkTarget(target, links = 'vscode') {
  const text = String(target).trim().replace(/^<|>$/g, '');
  const safe = (value) => value.replace(/[\s"<>`]/g, (c) => encodeURIComponent(c));
  if (/^https?:\/\//i.test(text)) return safe(text);
  if (/^[\\/]{2}/.test(text)) return '';
  if (/^(?:[a-z]:[\\/]|\/)/i.test(text)) {
    const match = /^(.*?)(?::(\d+)(?::\d+)?)?$/.exec(text);
    const local = match[1].replaceAll('\\', '/');
    const absolute = local.startsWith('/') ? local : `/${local}`;
    return links === 'file' ? `file://${safe(absolute)}` : `vscode://file${safe(absolute)}${match[2] ? `:${match[2]}` : ''}`;
  }
  if (/^[a-z][a-z0-9+.-]*:/i.test(text) || text.startsWith('#')) return '';
  return safe(text.replaceAll('\\', '/'));
}

// A served page gets the token on each relative link, because the live server refuses a request without it.
function withToken(href, ctx) {
  if (!ctx.token || !href || /^[a-z][a-z0-9+.-]*:/i.test(href)) return href;
  const [target, hash = ''] = href.split(/(?=#)/, 2);
  return `${target}${target.includes('?') ? '&' : '?'}t=${ctx.token}${hash}`;
}

function inline(text, ctx) {
  // A finished piece of HTML waits behind a mark, so that a later rule does not change it.
  const kept = [];
  const keep = (html) => { kept.push(html); return `${kept.length - 1}`; };
  const wiki = ctx.wiki ?? null;
  const nav = wiki && !wiki.inPage ? ' data-nav' : '';
  // The source cannot hold a mark of its own.
  let out = String(text).replace(/[\uE000\uE001]/g, '').replace(/`([^`\n]+)`/g, (_, code) => {
    const html = `<code>${esc(code)}</code>`;
    const href = wiki && /\.md$/i.test(code) ? wiki.page(code) : '';
    return keep(href ? `<a href="${esc(href)}"${nav}>${html}</a>` : html);
  });
  out = esc(out);
  const strong = (value) => value.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
  out = out.replace(/\[([^\]]+)\]\((&lt;.*?&gt;|[^)\s]+)\)/g, (all, label, target) => {
    // A link to a page of the wiki opens the wiki page, so that the user stays in the forge pages.
    const page = wiki ? wiki.link(unesc(target)) : '';
    const href = page || withToken(linkTarget(unesc(target), ctx.links), ctx);
    // On the wiki page (ctx.plain), a relative link to a file that is not a page has no target: its words stay as text.
    if (!href || (ctx.plain && !page && !/^[a-z][a-z0-9+.-]*:/i.test(href))) return label;
    return keep(`<a href="${esc(href)}"${page ? nav : ''}${/^https?:/i.test(href) ? ' target="_blank" rel="noopener noreferrer"' : ''}>${strong(label)}</a>`);
  });
  // The path of a wiki page in the text is a link to that page.
  if (wiki) {
    out = out.replace(/(^|[\s(])((?:[\w.-]+\/)+[\w.-]+\.md)(?![\w\/-])/g, (all, lead, relative) => {
      const href = wiki.page(relative);
      return href ? `${lead}${keep(`<a href="${esc(href)}"${nav}>${relative}</a>`)}` : all;
    });
  }
  out = strong(out);
  out = out.replace(/(^|[\s(])(https?:\/\/[^\s<)]+)/g, (all, lead, url) => `${lead}<a href="${url.replace(/"/g, '%22')}" target="_blank" rel="noopener noreferrer">${url}</a>`);
  // A kept piece can hold the mark of another piece: the code in the label of a link.
  const restore = (value) => value.replace(/(\d+)/g, (_, index) => restore(kept[Number(index)] ?? ''));
  return restore(out);
}

const ITEM = /^(\s*)([-*+]|\d+[.)])\s+(.*)$/;

function list(lines, start, ctx) {
  const first = ITEM.exec(lines[start]);
  const base = first[1].length;
  const items = [];
  let i = start;
  while (i < lines.length) {
    const line = lines[i];
    const match = ITEM.exec(line);
    if (match && match[1].length === base) { items.push({ text: [match[3]], children: '' }); i++; continue; }
    if (match && match[1].length > base) { const [html, next] = list(lines, i, ctx); items.at(-1).children += html; i = next; continue; }
    if (!line.trim()) {
      const next = lines[i + 1];
      const nextItem = next === undefined ? null : ITEM.exec(next);
      if (nextItem && nextItem[1].length >= base) { i++; continue; }
      break;
    }
    if (line.match(/^\s*/)[0].length > base) { items.at(-1).text.push(line.trim()); i++; continue; }
    break;
  }
  const tag = /\d/.test(first[2]) ? 'ol' : 'ul';
  return [`<${tag}>${items.map((item) => `<li>${inline(item.text.join(' '), ctx)}${item.children}</li>`).join('')}</${tag}>`, i];
}

/** A small Markdown subset as HTML: paragraphs, lists, tables, code, quotes, links, and bold. */
export function markdown(text, ctx = { links: 'vscode' }) {
  const lines = String(text ?? '').replace(/\r\n/g, '\n').split('\n');
  const out = [];
  let paragraph = [];
  const flush = () => { if (paragraph.length) { out.push(`<p>${inline(paragraph.join(' '), ctx)}</p>`); paragraph = []; } };
  let i = 0;
  while (i < lines.length) {
    const line = lines[i];
    const fence = /^\s*(`{3,}|~{3,})\s*(\S*)/.exec(line);
    if (fence) {
      flush();
      const body = [];
      i++;
      while (i < lines.length && !lines[i].trim().startsWith(fence[1])) body.push(lines[i++]);
      i++;
      out.push(`<pre${fence[2] ? ` data-lang="${esc(fence[2])}"` : ''}><code>${esc(body.join('\n'))}</code></pre>`);
      continue;
    }
    if (!line.trim()) { flush(); i++; continue; }
    if (/^\s*\|/.test(line) && /^\s*\|?\s*:?-{2,}/.test(lines[i + 1] ?? '')) {
      flush();
      const head = tableRow(line);
      i += 2;
      const rows = [];
      while (i < lines.length && /^\s*\|/.test(lines[i])) rows.push(tableRow(lines[i++]));
      out.push(`<table><thead><tr>${head.map((cell) => `<th>${inline(cell, ctx)}</th>`).join('')}</tr></thead><tbody>${rows.map((row) => `<tr>${row.map((cell) => `<td>${inline(cell, ctx)}</td>`).join('')}</tr>`).join('')}</tbody></table>`);
      continue;
    }
    const heading = /^(#{1,6})\s+(.*)$/.exec(line);
    // A card has one heading size. A wiki page (ctx.headings) keeps the levels, below the title of the page.
    if (heading) { flush(); const tag = ctx.headings ? `h${Math.min(6, heading[1].length + ctx.headings)}` : 'h4'; out.push(`<${tag}>${inline(heading[2], ctx)}</${tag}>`); i++; continue; }
    if (/^\s*>/.test(line)) {
      flush();
      const quote = [];
      while (i < lines.length && /^\s*>/.test(lines[i])) quote.push(lines[i++].replace(/^\s*>\s?/, ''));
      out.push(`<blockquote>${markdown(quote.join('\n'), ctx)}</blockquote>`);
      continue;
    }
    if (ITEM.test(line)) { flush(); const [html, next] = list(lines, i, ctx); out.push(html); i = next; continue; }
    paragraph.push(line.trim());
    i++;
  }
  flush();
  return out.join('\n');
}

// --- The page ---

const STEP_TEXT = { planned: 'planned', done: 'done', verified: 'verified' };
const CHECK_TEXT = { verified: 'verified', failed: 'failed', gap: 'not proven', open: 'open' };
const TIER_TEXT = { must: 'Must read', good: 'Good to know', ai: 'AI artifact: a working note of the agent' };
const PERSON_TEXT = { 'to-contact': 'to contact', drafted: 'draft ready', waiting: 'waiting', 'follow-up': 'follow up', 'reply-in': 'reply in', done: 'done' };

// The attributes that the views of the page read. A card without text has no tier: it is its title, so it never folds.
// In a view that folds them, the cards with the same `bundle` name show as one line.
function foldAttrs(item, bundle = '') {
  if (!item.tier || !item.words) return '';
  return ` data-tier="${item.tier}" data-gate="${esc(item.gate)}" data-words="${item.words}"${item.alert ? ' data-alert' : ''}${bundle ? ` data-bundle="${bundle}"` : ''}`;
}

// The end of a title strip: the tier and the size of the folded card.
function metaHtml(item, size = `${item.words} w`) {
  if (!item.tier || !item.words) return '';
  return `<span class="meta" title="${TIER_TEXT[item.tier]}">${item.tier} · ${esc(size)}</span>`;
}

function cardHtml(card, ctx, extra = '') {
  const state = card.state ? ` s-${esc(card.state)}` : '';
  // The tag has the color of the state: done and verified are green, a failed check is red.
  const badge = card.kind === 'step' ? tagHtml(STEP_TEXT[card.state], ['done', 'verified'].includes(card.state) ? 'ok' : '')
    : card.kind === 'check' ? tagHtml(CHECK_TEXT[card.state], card.state === 'verified' ? 'ok' : card.state === 'failed' ? 'bad' : '') : '';
  const bundle = card.alert ? '' : card.kind === 'check' && card.state === 'verified' ? 'verified checks' : card.kind === 'entry' ? 'journal entries' : '';
  return `<article class="card k-${esc(card.kind)}${state}" id="${esc(card.id)}" data-file="${esc(card.file)}" data-section="${esc(card.section)}" data-title="${esc(card.title)}"${foldAttrs(card, bundle)}>`
    + `<h3>${badge}${metaHtml(card)}${esc(card.title)}</h3><div class="body prose">${markdown(card.markdown, ctx)}${extra}</div></article>`;
}

function graphHtml(graph, ctx) {
  if (!graph.nodes.length) return '';
  const mlanes = graph.lanes.map((lane) => {
    const nodes = graph.nodes.filter((node) => node.layer === lane).map((node) => (
      // A component can have the focus: Enter or Space shows its arrows, as a click does.
      `<div class="node${node.change ? ` c-${node.change}` : ''}" id="${esc(node.id)}" tabindex="0" role="button" aria-label="${esc(node.name)}" data-file="map.md" data-section="Components" data-title="${esc(node.name)}">`
      + `<h3>${node.change ? tagHtml(node.change, node.change === 'done' ? 'ok' : 'wait') : ''}${esc(node.name)}</h3>`
      + `<div class="body prose">${node.role ? `<p>${inline(node.role, ctx)}</p>` : ''}${node.file ? `<p class="file">${inline(node.file, ctx)}</p>` : ''}</div></div>`
    )).join('');
    return `<div class="mlane"><h4 class="eyebrow">${esc(lane)}</h4>${nodes}</div>`;
  }).join('');
  // The graph folds as one unit. A component is a part of it, so a component has no tier.
  const unit = { ...graph, words: graph.words || graph.nodes.length };
  return `<div class="unit k-graph" id="code-graph" data-title="Components and flow"${foldAttrs(unit)}>`
    + `<h3 class="eyebrow">${metaHtml(unit, `${graph.nodes.length} ${graph.nodes.length === 1 ? 'component' : 'components'}`)}Components and flow</h3>`
    + `<div class="graph" data-edges="${esc(JSON.stringify(graph.edges))}"><svg class="edges" aria-hidden="true"></svg><div class="mlanes">${mlanes}</div><svg class="labels" aria-hidden="true"></svg></div>`
    + `<ul class="edge-list">${graph.edges.map((edge) => `<li>${esc(graph.nodes.find((node) => node.id === edge.from)?.name)} → ${esc(graph.nodes.find((node) => node.id === edge.to)?.name)}${edge.label ? `: ${esc(edge.label)}` : ''}</li>`).join('')}</ul></div>`;
}

function peopleHtml(zone) {
  const people = (zone.people ?? []).map((person) => (
    `<article class="card k-person s-${esc(person.status)}" id="person-${esc(slug(person.name))}" data-file="README.md" data-section="people" data-title="${esc(person.name)}"${foldAttrs(person)}>`
    + `<h3>${tagHtml(PERSON_TEXT[person.status] ?? person.status)}${metaHtml(person)}${esc(person.name)}</h3>`
    + `<div class="body prose"><p>${esc([person.role, person.ask].filter(Boolean).join(': '))}</p>${person.since ? `<p class="file">since ${esc(person.since)}</p>` : ''}</div></article>`
  )).join('');
  return people ? `<h4 class="eyebrow sethead">People</h4><div class="row">${people}</div>` : '';
}

function zoneHtml(zone, ctx, width = 0) {
  const files = zone.files.map((name) => `<a class="src" href="${esc(withToken(name, ctx))}">${esc(name)}</a>`).join(' ');
  // The part that holds the document of a gate shows the status of that gate.
  const gate = (ctx.gates ?? []).find((item) => GATE_ZONE[item.name] === zone.id);
  // The mark of the gate: one ingot and the words of its status.
  const chip = gate ? ` <span class="zgate g-${esc(gate.status)}" title="${esc(`${gate.name} ${GATE_TEXT[gate.status] ?? gate.status}`)}">${ingotHtml(gate.status)} ${esc(GATE_TEXT[gate.status] ?? gate.status)}</span>` : '';
  const now = ctx.focus && zone.gates?.includes(ctx.focus) ? ' z-now' : '';
  // The title is in bitmap letters. The real text is in the .sr span of pixelText. The title can have the focus: Enter or Space shows the part, as a click does.
  const parts = [`<h2 tabindex="0">${pixelText(zone.title, { scale: 3 })}${chip} ${files}</h2>`];
  if (!zone.present) parts.push(emptyHtml(`No ${zone.files.join(' or ')} yet.`));
  const column = (cards) => cards.map((card) => cardHtml(card, ctx)).join('');
  const row = (label, cards, cls = '') => (cards?.length ? `<h4 class="eyebrow sethead">${label}</h4><div class="row ${cls}">${cards.map((card) => cardHtml(card, ctx)).join('')}</div>` : '');
  if (zone.id === 'plan') {
    parts.push(column(zone.cards), row('Diagnosis', zone.hypotheses), row('Steps', zone.steps, 'path'), row('More', zone.more));
  } else if (zone.id === 'code') {
    parts.push(column(zone.cards), graphHtml(zone.graph, ctx), row('More', zone.more));
  } else if (zone.id === 'review') {
    parts.push(column(zone.cards), row('Checks', zone.checks), row('More', zone.more));
  } else {
    parts.push(column(zone.cards));
    if (zone.questions?.length) parts.push(row('Open questions', zone.questions));
    parts.push(peopleHtml(zone));
  }
  return frameHtml(parts.join(''), { sunk: true, tag: 'section', cls: `zone z-${zone.id}${now}`, attrs: `id="zone-${esc(zone.id)}" data-zone="${esc(zone.id)}"${width ? ` style="width:${width}px"` : ''}` });
}

function railHtml(model, nav, live = false, wiki = null) {
  const { ticket } = model;
  // The wiki pages that the documents of the ticket name, and the link to the wiki page.
  const refs = !wiki ? '' : `<details class="refs" id="wiki-refs"><summary title="The wiki pages that this ticket names. The key w opens the wiki">Wiki${wiki.refs.length ? ` <span>${wiki.refs.length}</span>` : ''}</summary><ul>`
    + wiki.refs.map((ref) => `<li><a href="${esc(ref.href)}" data-nav><span class="what">${esc(ref.title)}</span><small>${esc(ref.path)}</small></a></li>`).join('')
    + (wiki.refs.length ? '' : '<li class="none">This ticket names no wiki page.</li>')
    + `<li class="all"><a href="${esc(wiki.home)}" data-nav>All wiki pages</a></li></ul></details>`;
  // The kit shows each gate as an ingot with its name. Only a gate that needs attention shows its words. An approved gate has its date as the hover text.
  const gates = gatesHtml(model.gates.filter((gate) => gate.name !== 'Sendable?' || gate.status === 'in-review')
    .map((gate) => ({ name: gate.name, status: gate.status, note: gate.status === 'approved' && gate.date ? `approved ${gate.date}` : '' })), { names: true, folder: nav?.current || ticket.key });
  // The views: the first view opens the cards that the user must read for the gate in focus.
  const view = (name, label, title) => `<button type="button" data-view="${name}" aria-pressed="false" title="${esc(title)}">${esc(label)}</button>`;
  const focusGate = model.gates.find((gate) => gate.name === model.focus);
  const views = `<div class="views" role="group" aria-label="View"><span class="eyebrow">View</span>`
    + (focusGate ? view('focus', `Now: ${focusGate.name.replace(/\?$/, '')}`, `The cards that you must read for ${focusGate.name}, which ${focusGate.status === 'in-review' ? 'needs you' : 'is the next gate'}. The other parts show their summary (v)`) : '')
    + view('must', 'Must read', 'The cards that you must read and understand, of each part (v)')
    + view('good', '+ Good to know', 'Also the cards that help. The working notes of the agent stay folded (v)')
    + view('all', 'All', 'Each card (v)') + '</div>';
  const zones = model.zones.map((zone, index) => `<button type="button" class="quiet" data-goto="zone-${esc(zone.id)}" title="Key ${index + 1}">${esc(zone.title)}</button>`).join('');
  const changes = model.changes.map((change) => `<a href="${esc(linkTarget(change.url))}" target="_blank" rel="noopener noreferrer">${esc(change.label || 'change')} ${esc(change.state)}</a>`).join(' ');
  // With the links of the wiki, the key opens the ticket switcher. Without them, the page stands alone.
  const hop = (item, rel, mark, key) => (item
    ? `<a class="quiet icon" href="${esc(item.href)}" data-nav rel="${rel}" title="${rel === 'prev' ? 'Previous' : 'Next'} ticket: ${esc(item.key)} (${key})" aria-label="${rel === 'prev' ? 'Previous' : 'Next'} ticket: ${esc(item.key)}">${mark}</a>`
    : `<span class="quiet icon off" aria-hidden="true">${mark}</span>`);
  const where = nav
    ? `<a class="quiet" href="${esc(nav.board)}" data-nav title="The board of all tickets (b)">Board</a><span class="sep" aria-hidden="true">/</span>`
      + `<button type="button" class="crumb" id="switch-open" aria-haspopup="dialog" title="Go to a ticket (t)"><span class="key">${esc(ticket.key)}</span></button>`
    : `<strong class="key">${esc(ticket.key)}</strong>`;
  return `<header id="rail">`
    + `<div class="bar">${iconHtml('anvil', { size: 32 })}${where}<h1 title="${esc(ticket.title)}">${esc(ticket.short || ticket.title)}</h1>`
    + `${pillHtml(pageLabel(ticket.state, STATE_LABEL[ticket.state] ?? ticket.state), ticket.state)}<span class="phase">${esc(ticket.phase)}</span>`
    + `<div class="tools">${nav ? hop(nav.prev, 'prev', '‹', '[') + hop(nav.next, 'next', '›', ']') : ''}`
    + (live ? '<button type="button" id="live-toggle" class="lv-idle" aria-pressed="false" title="What the session of this ticket does now (l)"><span class="lv-state">Live</span></button>' : '')
    + refs
    + `<button type="button" id="tray-toggle" title="Your comments on this ticket">Comments <span id="comment-count" aria-live="polite">0</span></button>${TOOLS_HTML}</div></div>`
    + `<div class="sub">${gates}`
    + `<div class="next" title="${esc(`Next: ${ticket.next}${ticket.waitingOn ? `. Waiting on: ${ticket.waitingOn}` : ''}`)}"><span class="eyebrow">Next</span> ${esc(ticket.next)}${ticket.waitingOn ? ` <span class="eyebrow">Waiting on</span> ${esc(ticket.waitingOn)}` : ''} ${changes}</div>`
    + `${views}<nav aria-label="Parts of the ticket">${zones}</nav></div>`
    + `</header>`;
}

const HELP = [
  'Move',
  [['Scroll'], 'Move the board. Drag the background to do the same'],
  [['Ctrl', 'Scroll'], 'Zoom in or out'],
  [['0'], 'Show the whole ticket'],
  [['1', '…', '9'], 'Go to a part: the story, the code map, the plan, and so on'],
  [['+', '-'], 'Zoom in or out'],
  [['←', '↑', '↓', '→'], 'Move the board'],
  'Views',
  [['v'], 'Go to the next view: the gate in focus, must read, good to know, all'],
  [['Click'], 'On a title strip: open the card. The Fold button of a card folds it again'],
  [['Enter'], 'On a title strip that has the focus: open the card'],
  'Read and comment',
  [['Double-click'], 'On a card title: show the card at a size that you can read'],
  [['Click'], 'On a component of the code map: show its arrows'],
  [['Select'], 'Select words on a card to comment on them, or use the Comment button of the card'],
  [['Ctrl', 'Enter'], 'Save the comment'],
  'Go',
  [['t'], 'Go to a ticket by its key or its words'],
  [['b'], 'Go to the board of all tickets'],
  [['[', ']'], 'Go to the previous or the next ticket of the board'],
  [['?'], 'Show this list'],
  [['Esc'], 'Close a dialog, the toolbar of selected words, or the comments'],
];

// The zoom tools at the end of the foot.
const ZOOMER = '<div class="zoomer" role="group" aria-label="Zoom"><button type="button" class="quiet icon" id="zoom-out" title="Zoom out (-)" aria-label="Zoom out">−</button><output id="zoom-level">100%</output>'
  + '<button type="button" class="quiet icon" id="zoom-in" title="Zoom in (+)" aria-label="Zoom in">+</button><button type="button" class="quiet" id="zoom-fit" title="Show the whole ticket (0)">Fit</button></div>';

// The Live panel. Only a page of the live server has it, and the page script fills it.
const LIVE_HTML = `<aside id="live" aria-label="Live" hidden><h2>${pixelText('Live', { scale: 3 })} <button type="button" class="quiet icon" id="live-close" title="Hide the Live panel (l)" aria-label="Hide the Live panel">×</button></h2>`
  + '<p class="thint" id="live-hint" aria-live="polite">No answer from the live server yet.</p><div id="live-body"></div><div id="live-past"></div></aside>';

/**
 * The self-contained HTML page of a canvas model. With serve.token, the page can send its comments to the live server.
 * serve.live is the address of the session states on the live server (live-serve.mjs): then the page has the Live panel.
 * serve.resume is the address on that server that continues a closed session: then a closed session has the Resume button.
 * nav (buildNav in ui.mjs) adds the links to the board page and to the other tickets.
 * wiki (wikiLinks in wiki.mjs) makes each link to a wiki page open the wiki page, and adds the Wiki menu of the bar.
 * mermaid lets the page draw its Mermaid blocks with the Mermaid file of forge (mermaid.mjs): the file is in raw/ for a file page, and on the server for a served page.
 */
export function renderCanvas(model, { links = 'vscode', serve = null, nav = null, wiki = null, mermaid = false } = {}) {
  if (!LINK_MODES.includes(links)) throw new Error(`Unknown link mode: ${links}. Use ${LINK_MODES.join(' or ')}.`);
  const token = serve?.token ?? '';
  if (token && !/^[0-9a-f]{32}$/.test(token)) throw new Error('The canvas token must have 32 hexadecimal characters.');
  const ctx = { links, token, gates: model.gates, focus: model.focus ?? '', wiki };
  const { ticket } = model;
  const zone = (id) => model.zones.find((item) => item.id === id);
  // The code map sets the width of the middle column: each lane needs room for its components and its arrows.
  const lanes = zone('code')?.graph.lanes.length ?? 0;
  // 52: the padding of a zone (2 times 24) and its border (2 times 2).
  const wide = Math.max(WIDE_ZONE, 52 + lanes * LANE_WIDTH + Math.max(0, lanes - 1) * LANE_GAP);
  const column = (...ids) => `<div class="column">${ids.map(zone).filter(Boolean).map((item) => zoneHtml(item, ctx, ['code', 'plan'].includes(item.id) ? wide : 0)).join('')}</div>`;
  const board = column('story') + column('code', 'plan') + column('review', 'close', 'journal');
  const note = model.missing.length ? `<p class="note">Not written yet: ${esc(model.missing.join(', '))}.</p>` : '';
  const live = token && serve.live ? String(serve.live) : '';
  const resume = live && serve.resume ? String(serve.resume) : '';
  // serve.open is the command that starts the live server again, and serve.c is the change stamp of this ticket (live-stamp.mjs).
  const open = token && typeof serve.open === 'string' ? serve.open : null;
  const draw = !mermaid || !needsMermaid(board) ? null : token ? { src: `${MERMAID_ROUTE}?t=${token}`, integrity: MERMAID_INTEGRITY } : { src: `../../${MERMAID_FILE}` };
  const data = { key: ticket.key, generated: model.generated, ...(draw ? { mermaid: draw } : {}), ...(model.focus ? { focus: model.focus, focusZone: model.focusZone } : {}), ...(token ? { token } : {}), ...(live ? { live } : {}), ...(resume ? { resume } : {}),
    ...(open !== null ? { open } : {}), ...(live && serve.c ? { c: String(serve.c) } : {}), ...(live ? { icons: { calm: faviconUri('calm'), needs: faviconUri('needs') }, hot: ticket.state === 'needs-me' } : {}), ...(nav ? { nav: navData(nav) } : {}) };
  const body = [
    railHtml(model, nav, Boolean(live), wiki),
    `<div id="stage"><main id="viewport"><div id="board">${board}</div></main>`,
    '<div id="pop" role="toolbar" aria-label="Selected words" hidden><button type="button" data-act="comment">Comment</button><button type="button" data-act="remove">Remove</button>'
      + '<button type="button" data-label="unclear">unclear</button><button type="button" data-label="wrong">wrong</button><button type="button" data-label="too much">too much</button></div>',
    `<aside id="tray" hidden><h2>${pixelText('Comments', { scale: 3 })}</h2><p class="thint" id="tray-hint">Select words on a card, or use the Comment button of a card. Then copy the comments and paste them into the ticket session.</p><ol id="tray-list"></ol>`
      + '<label for="general">Whole ticket</label><textarea id="general" rows="3" placeholder="A comment on the whole ticket."></textarea>'
      + '<div class="tray-tools"><button type="button" class="primary" id="send-all" hidden>Send to agent</button><button type="button" id="copy-all">Copy all</button><button type="button" id="clear-all">Delete all</button></div>'
      + '<textarea id="copy-fallback" hidden readonly rows="6" aria-label="Comments to copy"></textarea></aside>'
      + (live ? LIVE_HTML : '') + '</div>',
    footHtml(`Generated ${esc(model.generated)} UTC by <code>forge.mjs canvas</code> from the ticket files. This page is a view: change the Markdown files, not this page.`, { note, end: ZOOMER }),
    switcherHtml(nav), helpHtml([...(wiki ? HELP.flatMap((row) => (row[1] === 'Go to the board of all tickets' ? [row, [['w'], 'Go to the wiki of the repository']] : [row])) : HELP),
      ...(live ? ['Live', [['l'], 'Show or hide the Live panel: what the session of this ticket does now']] : [])]),
    '<div id="toast" role="status" hidden></div>',
  ].join('\n');
  return pageHtml({
    title: `${ticket.key} · ${ticket.short || ticket.title}`, bodyClass: `layout-${model.layout}`, style: CANVAS_STYLE, dataId: 'canvas-data', data, script: CANVAS_SCRIPT,
    body, icon: ticket.state === 'needs-me' ? 'needs' : 'calm', main: 'viewport',
  });
}

/**
 * Builds the model and writes <ticket>/canvas.html. With `keep`, a page that differs only in its time is not written again,
 * so a browser with the page open does not load it again.
 */
export function writeCanvas(dir, { links = 'vscode', now, nav = null, model = null, keep = false, wiki = null, mermaid = false } = {}) {
  model ??= buildCanvas(dir, { now });
  const file = path.join(dir, CANVAS_FILE);
  const present = existsSync(file);
  if (present && (lstatSync(file).isSymbolicLink() || !lstatSync(file).isFile())) throw new Error(`${CANVAS_FILE} must be a regular file, not a link.`);
  let written = true;
  let text = '';
  if (keep && present) {
    const old = readFileSync(file, 'utf8');
    const stamp = /"generated":"([^"]*)"/.exec(old)?.[1];
    if (stamp && renderCanvas({ ...model, generated: stamp }, { links, nav, wiki, mermaid }) === old) { written = false; text = old; }
  }
  if (written) { text = renderCanvas(model, { links, nav, wiki, mermaid }); writeFileSync(file, text); }
  // `mermaid` is true when the page needs the Mermaid file next to the board page.
  return { key: model.ticket.key, file, written, mermaid: mermaid && needsMermaid(text), layout: model.layout, zones: model.zones.map((zone) => zone.id), missing: model.missing, model };
}
