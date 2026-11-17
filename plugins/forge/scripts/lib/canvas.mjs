// The ticket canvas: one self-contained HTML page that shows a whole ticket on one board.
// It is a view of the ticket Markdown files. It loads nothing from a network, and it is never a source:
// no approval manifest lists it, and no step reads a fact from it.
// buildCanvas() gives the model (also `forge.mjs canvas <key> --json`), and renderCanvas() gives the page.
import { existsSync, lstatSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { STATE_EMOJI, parseTicket } from './ticket.mjs';
import { listSnapshots, sections, summaryBlock } from './reading.mjs';
import { CANVAS_SCRIPT, CANVAS_STYLE } from './canvas-page.mjs';

export const CANVAS_FILE = 'canvas.html';
export const LINK_MODES = ['vscode', 'file'];
const MAX_BYTES = 1024 * 1024;
const JOURNAL_ENTRIES = 8;
const WIDE_ZONE = 1180;
const LANE_WIDTH = 210;
const LANE_GAP = 84;
// The documents of an older ticket, in reading order. The canvas shows them as plain columns.
const LEGACY_DOCS = ['scope.md', 'context.md', 'briefing.md', 'interview.md', 'investigation.md', 'plan.draft.md', 'map.md',
  'review.md', 'evidence-testing.md', 'close.draft.md', 'decisions.md', 'log.md'];

const esc = (value) => String(value ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
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

/** The cells of one Markdown table row. An escaped pipe stays in its cell. */
export function tableRow(line) {
  return line.trim().replace(/^\|/, '').replace(/\|$/, '').split(/(?<!\\)\|/).map((cell) => cell.trim().replace(/\\\|/g, '|'));
}

function tableRows(text) {
  const lines = text.split('\n').filter((line) => /^\s*\|/.test(line));
  if (lines.length < 2 || !/^\s*\|?\s*:?-{2,}/.test(lines[1])) return [];
  const head = tableRow(lines[0]).map((cell) => cell.toLowerCase());
  return lines.slice(2).map((line) => Object.fromEntries(tableRow(line).map((cell, index) => [head[index] ?? `col${index}`, cell])));
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
  return { nodes, edges, lanes };
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
  return { zones, missing };
}

// An older ticket has other files and section names. The canvas shows each file as one column of its sections.
function legacyZones(dir, ticket) {
  const zones = [];
  for (const name of LEGACY_DOCS) {
    const doc = readDoc(dir, name);
    if (!doc) continue;
    const id = slug(name.replace(/\.md$/, ''));
    zones.push({ id, title: doc.title.replace(/\s*\(.*$/, ''), files: [name], present: true, cards: [...summaryCard(doc, id), ...sectionCards(doc, id)] });
  }
  if (zones.length) zones[0].people = ticket.people.map((person) => ({ ...person }));
  return { zones, missing: [] };
}

/** The canvas model of one ticket folder. */
export function buildCanvas(dir, { now = new Date() } = {}) {
  const file = path.join(dir, 'README.md');
  if (lstatSync(file).isSymbolicLink()) throw new Error('README.md must not be a link.');
  const ticket = parseTicket(readFileSync(file, 'utf8'));
  const layout = ticket.workflow === 'full-v3' ? 'board' : 'columns';
  const { zones, missing } = layout === 'board' ? v3Zones(dir, ticket) : legacyZones(dir, ticket);
  return {
    version: 1,
    generated: now.toISOString().slice(0, 16).replace('T', ' '),
    layout,
    ticket: {
      key: ticket.key, title: ticket.title, short: ticket.short, state: ticket.state, emoji: STATE_EMOJI[ticket.state], phase: ticket.phase,
      workflow: ticket.workflow ?? 'legacy', next: ticket.next, waitingOn: ticket.waitingOn, updated: ticket.updated, item: ticket.item, branch: ticket.branch,
    },
    gates: ticket.gates.map((gate) => ({ name: gate.name, status: gate.status, doc: gate.doc ?? '', date: gate.date ?? '', reviews: gate.name === 'Sendable?' ? 0 : listSnapshots(dir, gate.name).length })),
    changes: ticket.changes.map((change) => ({ url: change.url, label: change.label ?? '', state: change.state })),
    zones, missing,
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

function inline(text, ctx) {
  const codes = [];
  let out = String(text).replace(/`([^`\n]+)`/g, (_, code) => { codes.push(code); return `${codes.length - 1}`; });
  out = esc(out);
  out = out.replace(/\[([^\]]+)\]\((&lt;.*?&gt;|[^)\s]+)\)/g, (all, label, target) => {
    const href = linkTarget(unesc(target), ctx.links);
    if (!href) return label;
    return `<a href="${esc(href)}"${/^https?:/i.test(href) ? ' target="_blank" rel="noopener noreferrer"' : ''}>${label}</a>`;
  });
  out = out.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
  out = out.replace(/(^|[\s(])(https?:\/\/[^\s<)]+)/g, (all, lead, url) => `${lead}<a href="${url.replace(/"/g, '%22')}" target="_blank" rel="noopener noreferrer">${url}</a>`);
  return out.replace(/(\d+)/g, (_, index) => `<code>${esc(codes[Number(index)])}</code>`);
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
    const heading = /^#{1,6}\s+(.*)$/.exec(line);
    if (heading) { flush(); out.push(`<h4>${inline(heading[1], ctx)}</h4>`); i++; continue; }
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

const GATE_TEXT = { approved: 'approved', 'in-review': 'waits for you', todo: 'not open', blocked: 'blocked', skipped: 'skipped' };
const GATE_MARK = { approved: '✔', 'in-review': '🟡', todo: '○', blocked: '🔴', skipped: '–' };
const STEP_TEXT = { planned: 'planned', done: 'done', verified: 'verified' };
const CHECK_TEXT = { verified: '🟢 verified', failed: '🔴 failed', gap: '⚪ not proven', open: 'open' };
const PERSON_TEXT = { 'to-contact': 'to contact', drafted: 'draft ready', waiting: 'waiting', 'follow-up': 'follow up', 'reply-in': 'reply in', done: 'done' };

function cardHtml(card, ctx, extra = '') {
  const state = card.state ? ` s-${esc(card.state)}` : '';
  const badge = card.kind === 'step' ? `<span class="badge">${STEP_TEXT[card.state]}</span>`
    : card.kind === 'check' ? `<span class="badge">${CHECK_TEXT[card.state]}</span>` : '';
  return `<article class="card k-${esc(card.kind)}${state}" id="${esc(card.id)}" data-file="${esc(card.file)}" data-section="${esc(card.section)}" data-title="${esc(card.title)}">`
    + `<h3>${badge}${esc(card.title)}</h3><div class="body">${markdown(card.markdown, ctx)}${extra}</div></article>`;
}

function graphHtml(graph, ctx) {
  if (!graph.nodes.length) return '';
  const lanes = graph.lanes.map((lane) => {
    const nodes = graph.nodes.filter((node) => node.layer === lane).map((node) => (
      `<div class="node${node.change ? ` c-${node.change}` : ''}" id="${esc(node.id)}" data-file="map.md" data-section="Components" data-title="${esc(node.name)}">`
      + `<h3>${node.change ? `<span class="badge">${node.change}</span>` : ''}${esc(node.name)}</h3>`
      + `<div class="body">${node.role ? `<p>${inline(node.role, ctx)}</p>` : ''}${node.file ? `<p class="file">${inline(node.file, ctx)}</p>` : ''}</div></div>`
    )).join('');
    return `<div class="lane"><h4>${esc(lane)}</h4>${nodes}</div>`;
  }).join('');
  return `<div class="graph" data-edges="${esc(JSON.stringify(graph.edges))}"><svg class="edges" aria-hidden="true"></svg><div class="lanes">${lanes}</div><svg class="labels" aria-hidden="true"></svg></div>`
    + `<ul class="edge-list">${graph.edges.map((edge) => `<li>${esc(graph.nodes.find((node) => node.id === edge.from)?.name)} → ${esc(graph.nodes.find((node) => node.id === edge.to)?.name)}${edge.label ? `: ${esc(edge.label)}` : ''}</li>`).join('')}</ul>`;
}

function peopleHtml(zone) {
  const people = (zone.people ?? []).map((person) => (
    `<article class="card k-person s-${esc(person.status)}" id="person-${esc(slug(person.name))}" data-file="README.md" data-section="people" data-title="${esc(person.name)}">`
    + `<h3><span class="badge">${PERSON_TEXT[person.status] ?? esc(person.status)}</span>${esc(person.name)}</h3>`
    + `<div class="body"><p>${esc([person.role, person.ask].filter(Boolean).join(': '))}</p>${person.since ? `<p class="file">since ${esc(person.since)}</p>` : ''}</div></article>`
  )).join('');
  return people ? `<h4 class="group">People</h4><div class="row">${people}</div>` : '';
}

function zoneHtml(zone, ctx, width = 0) {
  const files = zone.files.map((name) => `<a class="src" href="${esc(name)}">${esc(name)}</a>`).join(' ');
  const parts = [`<h2>${esc(zone.title)} ${files}</h2>`];
  if (!zone.present) parts.push(`<p class="empty">No ${esc(zone.files.join(' or '))} yet.</p>`);
  const column = (cards) => cards.map((card) => cardHtml(card, ctx)).join('');
  const row = (label, cards, cls = '') => (cards?.length ? `<h4 class="group">${label}</h4><div class="row ${cls}">${cards.map((card) => cardHtml(card, ctx)).join('')}</div>` : '');
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
  return `<section class="zone z-${esc(zone.id)}" id="zone-${esc(zone.id)}" data-zone="${esc(zone.id)}"${width ? ` style="width:${width}px"` : ''}>${parts.join('')}</section>`;
}

function railHtml(model) {
  const { ticket } = model;
  const gates = model.gates.filter((gate) => gate.name !== 'Sendable?' || gate.status === 'in-review').map((gate) => {
    const note = gate.status === 'approved' && gate.date ? `approved ${gate.date}` : GATE_TEXT[gate.status] ?? gate.status;
    return `<li class="g-${esc(gate.status)}"><span class="mark">${GATE_MARK[gate.status] ?? ''}</span> ${esc(gate.name.replace(/\?$/, ''))} <small>${esc(note)}</small></li>`;
  }).join('');
  const nav = model.zones.map((zone, index) => `<button type="button" data-goto="zone-${esc(zone.id)}" title="Key ${index + 1}">${esc(zone.title)}</button>`).join('');
  const changes = model.changes.map((change) => `<a href="${esc(linkTarget(change.url))}" target="_blank" rel="noopener noreferrer">${esc(change.label || 'change')} ${esc(change.state)}</a>`).join(' ');
  return `<header id="rail">`
    + `<div class="id"><span class="state" title="${esc(ticket.state)}">${ticket.emoji ?? ''}</span> <strong>${esc(ticket.key)}</strong> <span class="short">${esc(ticket.short || ticket.title)}</span></div>`
    + `<ol class="gates">${gates}</ol>`
    + `<div class="next"><span>Next:</span> ${esc(ticket.next)}${ticket.waitingOn ? ` <span>Waiting on:</span> ${esc(ticket.waitingOn)}` : ''} ${changes}</div>`
    + `<nav>${nav}</nav>`
    + `<div class="tools"><button type="button" id="zoom-out" title="Zoom out (-)">−</button><output id="zoom-level">100%</output><button type="button" id="zoom-in" title="Zoom in (+)">+</button>`
    + `<button type="button" id="zoom-fit" title="Show the whole board (0)">Fit</button><button type="button" id="tray-toggle">Comments <span id="comment-count">0</span></button></div>`
    + `</header>`;
}

/** The self-contained HTML page of a canvas model. */
export function renderCanvas(model, { links = 'vscode' } = {}) {
  if (!LINK_MODES.includes(links)) throw new Error(`Unknown link mode: ${links}. Use ${LINK_MODES.join(' or ')}.`);
  const ctx = { links };
  const { ticket } = model;
  const zone = (id) => model.zones.find((item) => item.id === id);
  let board;
  if (model.layout === 'board') {
    // The code map sets the width of the middle column: each lane needs room for its components and its arrows.
    const lanes = zone('code')?.graph.lanes.length ?? 0;
    const wide = Math.max(WIDE_ZONE, 42 + lanes * LANE_WIDTH + Math.max(0, lanes - 1) * LANE_GAP);
    const column = (...ids) => `<div class="column">${ids.map(zone).filter(Boolean).map((item) => zoneHtml(item, ctx, ['code', 'plan'].includes(item.id) ? wide : 0)).join('')}</div>`;
    board = column('story') + column('code', 'plan') + column('review', 'close', 'journal');
  } else {
    board = model.zones.map((item) => `<div class="column">${zoneHtml(item, ctx)}</div>`).join('');
  }
  const note = model.layout === 'columns'
    ? `<p class="note">This ticket uses the ${esc(ticket.workflow)} layout. The canvas shows its files as columns.</p>`
    : model.missing.length ? `<p class="note">Not written yet: ${esc(model.missing.join(', '))}.</p>` : '';
  const data = JSON.stringify({ key: ticket.key, generated: model.generated }).replace(/</g, '\\u003c');
  return [
    '<!doctype html>', '<html lang="en">', '<head>', '<meta charset="utf-8">',
    '<meta name="viewport" content="width=device-width, initial-scale=1">',
    `<title>${esc(ticket.key)} · ${esc(ticket.short || ticket.title)}</title>`,
    `<style>${CANVAS_STYLE}</style>`, '</head>', `<body class="layout-${model.layout}">`,
    railHtml(model),
    `<main id="viewport"><div id="board">${board}</div></main>`,
    `<footer id="foot">${note}<p>Generated ${esc(model.generated)} UTC by <code>forge.mjs canvas</code> from the ticket files. This page is a view: change the Markdown files, not this page. `
      + 'Scroll to move. Hold Ctrl and scroll to zoom. Drag the background to move. Keys: 0 shows all, 1 to 9 go to a part. Double-click a card to read it. Click a component of the code map to see its arrows.</p></footer>',
    '<aside id="tray" hidden><h2>Comments</h2><p class="hint">Write comments on the cards. Then copy them and paste them into the ticket session.</p><ol id="tray-list"></ol>'
      + '<div class="tray-tools"><button type="button" id="copy-all">Copy all</button><button type="button" id="clear-all">Delete all</button></div>'
      + '<textarea id="copy-fallback" hidden readonly rows="6" aria-label="Comments to copy"></textarea></aside>',
    '<div id="toast" role="status" hidden></div>',
    `<script type="application/json" id="canvas-data">${data}</script>`,
    `<script>${CANVAS_SCRIPT}</script>`, '</body>', '</html>', '',
  ].join('\n');
}

/** Builds the model and writes <ticket>/canvas.html. */
export function writeCanvas(dir, { links = 'vscode', now } = {}) {
  const model = buildCanvas(dir, { now });
  const file = path.join(dir, CANVAS_FILE);
  if (existsSync(file) && (lstatSync(file).isSymbolicLink() || !lstatSync(file).isFile())) throw new Error(`${CANVAS_FILE} must be a regular file, not a link.`);
  writeFileSync(file, renderCanvas(model, { links }));
  return { key: model.ticket.key, file, layout: model.layout, zones: model.zones.map((zone) => zone.id), missing: model.missing, model };
}
