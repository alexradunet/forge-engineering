// Migrates a full-v1 ticket to full-v2.
// Understood? + Agreed? become Scoped?. Diagnosed? + Designed? become Planned?.
// A merged gate stays approved only when both source approvals exist and are fresh.
// The carried manifest names both source manifests, so lint can verify it. Never creates an approval.
import { appendFileSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { parseTicket, PHASES } from './ticket.mjs';
import { checkGate, MIGRATION_SOURCES, phaseGates, sha256 } from './validation.mjs';

const REOPENED_DOC = { 'Scoped?': 'scope.md', 'Planned?': 'plan.draft.md' };
const CARRIED_DOC = { 'Scoped?': 'context.md', 'Planned?': 'plan.draft.md' };
const ORDER = ['Scoped?', 'Planned?', 'Sendable?', 'Shippable?', 'Learned?'];
const FIELD_ORDER = ['name', 'doc', 'need', 'status', 'date', 'manifest', 'hash'];
export const MIGRATION_RECORD = 'approvals/migration-full-v1.json';

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

function nextManifest(dir, gateName, taken) {
  const stem = gateName.replace('?', '').toLowerCase();
  for (let n = 1; n < 1000; n++) {
    const relative = `approvals/${stem}-migrated-${String(n).padStart(3, '0')}.json`;
    if (!taken.has(relative) && !existsSync(path.join(dir, relative))) return relative;
  }
  throw new Error(`No free manifest name for ${gateName}.`);
}

function mergeGate(ticket, file, dir, name, taken) {
  const sourceNames = MIGRATION_SOURCES[name];
  const sources = sourceNames.map((source) => ticket.gates.find((gate) => gate.name === source));
  const reasons = [];
  sources.forEach((gate, index) => {
    const source = sourceNames[index];
    if (!gate) reasons.push(`${source} is missing`);
    else if (gate.status !== 'approved') reasons.push(`${source} is ${gate.status}`);
    else if (!gate.manifest) reasons.push(`${source} has no approval manifest`);
    else {
      const result = checkGate(ticket, file, source);
      if (!result.allowed) reasons.push(`${source} is not fresh (${[...new Set(result.findings.map((item) => item.code))].join(', ')})`);
    }
  });
  const reopen = (extra = []) => ({
    decision: { gate: name, sources: sourceNames, result: 'reopened', reasons: [...reasons, ...extra] },
    gate: { name, doc: REOPENED_DOC[name], need: 'required', status: 'todo' },
  });
  if (reasons.length) return reopen();

  const documents = [];
  const seen = new Map();
  let copies;
  for (const gate of sources) {
    const manifest = readManifest(dir, gate.manifest);
    for (const doc of manifest.documents) {
      const key = doc.path.replaceAll('\\', '/').toLowerCase();
      if (seen.has(key)) {
        if (seen.get(key) !== doc.sha256) return reopen([`the source approvals disagree on ${doc.path}`]);
        continue;
      }
      seen.set(key, doc.sha256);
      documents.push({ path: doc.path.replaceAll('\\', '/'), sha256: doc.sha256 });
    }
    if (manifest.approvedCopies) copies = manifest.approvedCopies;
  }
  const manifest = {
    version: 1,
    gate: name,
    migratedFrom: sources.map((gate) => ({ gate: gate.name, manifest: gate.manifest.replaceAll('\\', '/'), hash: gate.hash })),
    documents,
    ...(copies ? { approvedCopies: copies } : {}),
  };
  const relative = nextManifest(dir, name, taken);
  taken.add(relative);
  const bytes = `${JSON.stringify(manifest, null, 2)}\n`;
  const date = sources.map((gate) => gate.date).sort().at(-1);
  return {
    decision: { gate: name, sources: sourceNames, result: 'carried', manifest: relative, hash: sha256(bytes), from: manifest.migratedFrom },
    gate: { name, doc: CARRIED_DOC[name], need: 'required', status: 'approved', date, manifest: relative, hash: sha256(bytes) },
    write: { relative, bytes },
  };
}

function approvedSet(gates) {
  return new Set(gates.filter((gate) => gate.status === 'approved').map((gate) => gate.name));
}

// Documents that an approval manifest hashes. A log that is hashed must not get appended text.
function hashedDocuments(dir, gates) {
  const names = new Set();
  for (const gate of gates) {
    if (!gate.manifest) continue;
    try { for (const doc of readManifest(dir, gate.manifest).documents ?? []) names.add(String(doc.path).replaceAll('\\', '/').toLowerCase()); }
    catch { /* lint reports unreadable manifests */ }
  }
  return names;
}

/**
 * Plans, and unless dryRun, applies the migration of one ticket folder.
 * @returns {{ status: 'migrated'|'planned'|'already', key, decisions, phase, state, writes: string[], notes: string[] }}
 */
export function migrateTicket(dir, { dryRun = false, today = new Date().toISOString().slice(0, 10) } = {}) {
  const file = path.join(dir, 'README.md');
  const text = readFileSync(file, 'utf8');
  const ticket = parseTicket(text);
  if (ticket.workflow === 'full-v2') return { status: 'already', key: ticket.key, decisions: [], writes: [], notes: ['The ticket already uses full-v2.'] };
  if (ticket.workflow !== 'full-v1') throw new Error(`${ticket.key} is a legacy ticket (no workflow marker). Forge migrates only full-v1 tickets.`);
  if (ticket.phase === 'closed') throw new Error(`${ticket.key} is closed. A closed ticket keeps full-v1.`);
  if (existsSync(path.join(dir, ...MIGRATION_RECORD.split('/')))) {
    throw new Error(`${MIGRATION_RECORD} exists, but the README still says full-v1. Reconcile the ticket by hand.`);
  }
  const names = ticket.gates.map((gate) => gate.name);
  const duplicate = names.find((name, index) => names.indexOf(name) !== index);
  if (duplicate) throw new Error(`${duplicate} has two records. Reconcile the gates with the user before the migration.`);

  const taken = new Set();
  const merged = Object.keys(MIGRATION_SOURCES).map((name) => mergeGate(ticket, file, dir, name, taken));
  const kept = ticket.gates.filter((gate) => !Object.values(MIGRATION_SOURCES).flat().includes(gate.name));
  const gates = [...merged.map((item) => item.gate), ...kept]
    .sort((a, b) => (ORDER.indexOf(a.name) + 1 || 99) - (ORDER.indexOf(b.name) + 1 || 99));
  const approved = approvedSet(gates);
  let phaseIndex = PHASES.indexOf(ticket.phase);
  while (phaseIndex > 0 && !phaseGates('full-v2', PHASES[phaseIndex]).every((name) => approved.has(name))) phaseIndex--;
  const phase = PHASES[phaseIndex];
  const state = phase === ticket.phase ? ticket.state : 'needs-me';
  const scalars = { workflow: 'full-v2', phase, state };
  if (/^updated:/m.test(text)) scalars.updated = today;
  const readme = rewriteFrontmatter(text, { scalars, dropComment: ['workflow'], gates });
  const parsed = parseTicket(readme);
  const canon = (list) => JSON.stringify(list.map((gate) => Object.keys(gate).filter((key) => gate[key] != null && gate[key] !== '').sort().map((key) => [key, gate[key]])));
  if (canon(parsed.gates) !== canon(gates)) {
    throw new Error('The rewritten README does not read back the planned gates. Nothing was written.');
  }

  const decisions = merged.map((item) => item.decision);
  const record = {
    version: 1,
    kind: 'workflow-migration',
    from: 'full-v1',
    to: 'full-v2',
    date: today,
    readmeBefore: sha256(Buffer.from(text, 'utf8')),
    phase: { from: ticket.phase, to: phase },
    state: { from: ticket.state, to: state },
    previousGates: ticket.gates.map((gate) => ({ ...gate })),
    decisions,
  };
  const summary = decisions.map((item) => item.result === 'carried'
    ? `${item.gate} carried from ${item.sources.join(' + ')} (${item.manifest})`
    : `${item.gate} reopened (${item.reasons.join('; ')})`);
  const phaseLine = phase === ticket.phase ? `Phase stays ${phase}.` : `Phase ${ticket.phase} → ${phase}, state needs-me.`;
  const hashed = hashedDocuments(dir, [...ticket.gates, ...gates]);
  const notes = [];
  const appends = [];
  for (const [relative, heading, entry] of [
    ['log.md', `# Log (${ticket.key})`, `## ${today} Workflow migration\n\n- Migrated full-v1 to full-v2 with \`forge.mjs migrate\`. ${summary.join('. ')}. ${phaseLine}\n- Record: ${MIGRATION_RECORD}. No new approval was created.\n`],
    ['approvals/history.md', `# Approval history (${ticket.key})`, `## ${today} Workflow migration full-v1 → full-v2\n\n${decisions.map((item) => item.result === 'carried'
      ? `- ${item.gate}: carried. Sources: ${item.from.map((source) => `${source.gate} ${source.manifest} sha256 ${source.hash}`).join('; ')}. Manifest ${item.manifest} sha256 ${item.hash}. Method: migration, no new user answer.`
      : `- ${item.gate}: reopened. ${item.reasons.join('; ')}. A new explicit approval is needed.`).join('\n')}\n`],
  ]) {
    if (hashed.has(relative.toLowerCase())) notes.push(`${relative} is in an approval manifest. Forge did not append to it.`);
    else appends.push({ relative, heading, entry });
  }

  const writes = [...merged.filter((item) => item.write).map((item) => item.write.relative), 'README.md', MIGRATION_RECORD, ...appends.map((item) => item.relative)];
  const result = { status: dryRun ? 'planned' : 'migrated', key: ticket.key, decisions, phase: record.phase, state: record.state, writes, notes };
  if (dryRun) return result;

  const created = [];
  try {
    for (const { write } of merged.filter((item) => item.write)) {
      const target = path.join(dir, ...write.relative.split('/'));
      mkdirSync(path.dirname(target), { recursive: true });
      writeFileSync(target, write.bytes, { flag: 'wx' });
      created.push(target);
    }
    for (const item of merged.filter((entry) => entry.write)) {
      const verdict = checkGate(parsed, file, item.gate.name);
      if (!verdict.allowed) throw new Error(`The carried ${item.gate.name} does not verify: ${verdict.findings.map((entry) => entry.message).join(' ')}`);
    }
  } catch (error) {
    for (const target of created) rmSync(target, { force: true });
    throw error;
  }
  writeFileSync(file, readme);
  const recordFile = path.join(dir, ...MIGRATION_RECORD.split('/'));
  mkdirSync(path.dirname(recordFile), { recursive: true });
  writeFileSync(recordFile, `${JSON.stringify(record, null, 2)}\n`, { flag: 'wx' });
  for (const { relative, heading, entry } of appends) {
    const target = path.join(dir, ...relative.split('/'));
    mkdirSync(path.dirname(target), { recursive: true });
    const previous = existsSync(target) ? readFileSync(target, 'utf8') : '';
    const lead = previous ? (previous.endsWith('\n') ? '\n' : '\n\n') : `${heading}\n\n`;
    appendFileSync(target, lead + entry);
  }
  return result;
}
