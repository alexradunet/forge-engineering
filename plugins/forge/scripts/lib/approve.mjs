// Records one explicit user approval of a gate. The same steps in each host: the agent gives the
// exact answer of the user, and this command checks and writes the record. It never creates an approval
// on its own, and it refuses Sendable? (each write has its own approval record in outbox/).
import { appendFileSync, existsSync, lstatSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { parseTicket, validDate } from './ticket.mjs';
import { checkGate, sha256 } from './validation.mjs';
import { hashedDocuments, rewriteFrontmatter } from './migrate.mjs';

export const HISTORY = 'approvals/history.md';
const METHODS = ['form', 'chat'];

// The approval contract of the ticket skill: the form value `approve` (or its 🟢 GO label), or
// `approve <gate>` in chat, with or without the `?` and in any case.
export function isApproval(name, answer, method) {
  const text = String(answer ?? '').trim();
  if (method === 'form') return /^approve$/i.test(text) || text.startsWith('🟢 GO');
  const base = name.replace(/\?$/, '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  // (?=(\??))\1 takes the `?` atomically, so `approve scoped?later` cannot backtrack past it.
  return new RegExp(`^approve\\s+${base}(?=(\\??))\\1(?![\\p{L}\\p{N}_])`, 'iu').test(text);
}

function regularOrMissing(target, label) {
  if (!existsSync(target) && !isLink(target)) return;
  const stat = lstatSync(target);
  if (stat.isSymbolicLink()) throw new Error(`${label} must not be a link.`);
  if (label.endsWith('/') ? !stat.isDirectory() : !stat.isFile()) throw new Error(`${label} must be a ${label.endsWith('/') ? 'folder' : 'regular file'}.`);
}

function isLink(target) {
  try { return lstatSync(target).isSymbolicLink(); } catch { return false; }
}

function relativePath(value) {
  const text = String(value ?? '').replaceAll('\\', '/');
  if (!text || path.isAbsolute(text) || /^[a-z]:/i.test(text) || text.split('/').some((part) => !part || part === '.' || part === '..')) {
    throw new Error(`${value} is not a ticket-relative path.`);
  }
  return text;
}

/**
 * Checks, and unless dryRun, records the approval of one in-review gate.
 * @param {string} dir the ticket folder
 * @param {{ gate: string, answer: string, method?: string, manifest?: string, hash?: string, today?: string, dryRun?: boolean }} options
 */
export function approveGate(dir, { gate: name, answer, method = 'form', manifest, hash, today = new Date().toISOString().slice(0, 10), dryRun = false }) {
  if (name === 'Sendable?') throw new Error('Sendable? needs a per-write approval record in outbox/. Use the Sendable? steps of the ticket skill.');
  if (typeof answer !== 'string' || !answer.trim()) throw new Error('Give the exact answer of the user with --answer.');
  if (!METHODS.includes(method)) throw new Error(`Unknown method: ${method}. Use ${METHODS.join(' or ')}.`);
  if (!isApproval(name, answer, method)) {
    throw new Error(method === 'form'
      ? 'The form answer is not `approve`. Only the `approve` value of the approval form approves a gate.'
      : `The chat answer does not start with \`approve ${name.replace(/\?$/, '').toLowerCase()}\`. Only that answer approves the gate.`);
  }
  if (!validDate(today)) throw new Error(`Invalid date: ${today}.`);
  const file = path.join(dir, 'README.md');
  if (lstatSync(file).isSymbolicLink()) throw new Error('README.md must not be a link.');
  const text = readFileSync(file, 'utf8');
  const ticket = parseTicket(text);
  const matches = ticket.gates.filter((item) => item.name === name);
  if (matches.length !== 1) throw new Error(matches.length ? `${name} has more than one record.` : `${name} is not recorded in the README.`);
  const record = matches[0];
  if (record.status !== 'in-review') throw new Error(`${name} is ${record.status}, not in-review. Show the approval form first.`);
  if (record.manifest && manifest && relativePath(record.manifest) !== relativePath(manifest)) {
    throw new Error(`--manifest ${manifest} differs from the recorded ${record.manifest}.`);
  }
  const manifestPath = relativePath(record.manifest || manifest || '');
  const bytes = readFileSync(path.join(dir, ...manifestPath.split('/')));
  const digest = sha256(bytes);
  if (!record.hash && !hash) throw new Error(`Give the manifest SHA-256 that the user reviewed with --hash. ${name} has no recorded review digest.`);
  for (const [label, expected] of [['the recorded review digest', record.hash], ['--hash', hash]]) {
    if (expected && expected !== digest) throw new Error(`${manifestPath} changed after the review: ${label} is ${expected}, the file is ${digest}. Show the revised set and ask again.`);
  }
  const approved = { ...record, status: 'approved', date: today, manifest: manifestPath, hash: digest };
  const gates = ticket.gates.map((item) => (item === record ? approved : item));
  const verdict = checkGate({ ...ticket, gates }, file, name);
  if (!verdict.allowed) throw new Error(`${name} does not verify: ${verdict.findings.map((item) => item.message).join(' ')}`);
  if (hashedDocuments(dir, gates).has(HISTORY)) throw new Error(`${HISTORY} is in an approval manifest. Keep approval records outside the hashed set.`);
  const target = path.join(dir, ...HISTORY.split('/'));
  regularOrMissing(path.dirname(target), `${path.posix.dirname(HISTORY)}/`);
  regularOrMissing(target, HISTORY);

  const documents = JSON.parse(bytes.toString('utf8')).documents;
  const quoted = answer.replace(/\r\n/g, '\n').split('\n').map((line) => `> ${line}`.trimEnd()).join('\n');
  const entry = [
    `## ${today} ${name} approved`, '',
    `- Manifest: ${manifestPath} sha256 ${digest}`,
    ...documents.map((doc) => `- Document: ${doc.path} sha256 ${doc.sha256}`),
    `- Method: ${method}`,
    '- Answer of the user:', '', quoted, '',
  ].join('\n');
  const scalars = /^updated:/m.test(text) ? { updated: today } : {};
  const readme = rewriteFrontmatter(text, { gates, scalars });
  const result = { status: dryRun ? 'planned' : 'approved', key: ticket.key, gate: name, manifest: manifestPath, hash: digest, date: today, method, writes: ['README.md', HISTORY] };
  if (dryRun) return result;

  const previous = existsSync(target) ? readFileSync(target) : null;
  // Forge runs one session per ticket, so the command does not lock the files. On any failure it
  // puts back the README and the history as they were.
  try {
    writeFileSync(file, readme);
    const check = checkGate(parseTicket(readFileSync(file, 'utf8')), file, name);
    if (!check.allowed) throw new Error(`The written ${name} record does not verify, so the README is restored: ${check.findings.map((item) => item.message).join(' ')}`);
    mkdirSync(path.dirname(target), { recursive: true });
    const old = previous ? previous.toString('utf8') : '';
    const lead = old ? (old.endsWith('\n') ? '\n' : '\n\n') : `# Approval history (${ticket.key})\n\n`;
    appendFileSync(target, lead + entry);
  } catch (error) {
    writeFileSync(file, text);
    try {
      if (previous) writeFileSync(target, previous);
      else if (existsSync(target) && !isLink(target)) rmSync(target);
    } catch { /* The README restore is the important part. */ }
    throw error;
  }
  return result;
}
