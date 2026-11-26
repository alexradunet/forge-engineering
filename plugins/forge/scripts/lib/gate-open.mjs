// Opens the review of one gate in one call: the document set, the checks, the manifest, the diff, the snapshot,
// and the README record. gate-approve then records the approval of exactly this set.
// On a refusal or a failure it leaves no new file and the README as it was.
import { existsSync, lstatSync, mkdirSync, readFileSync, readdirSync, rmSync, rmdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { GATES, GATE_DOCS, STATE_EMOJI, nowCard, parseFrontmatter, parseTicket, validDate } from './ticket.mjs';
import { approveGate } from './approve.mjs';
import { plannedChecks, shippableChecks } from './gate-checks.mjs';
import { barredFromManifest, checkGate, isChangeDraft, regular, sha256, within } from './validation.mjs';
import { diffGate, gateName, renderDiff, saveSnapshot, sections } from './reading.mjs';
import { rewriteFrontmatter } from './readme-write.mjs';

// The files that a review set never holds, besides the files that a manifest must not list.
// canvas.html is a stale page that an older ticket folder can still hold (Forge 11 removed the ticket canvas).
const KEPT_OUT = ['approvals/history.md', 'journal.md', 'canvas.html'];
const REVIEW_FILE = /^evidence\/plan-review-(\d{3})\.md$/;

/** The ticket-relative path (forward slashes) of a document name. An absolute path inside the ticket folder is made relative. */
function documentPath(dir, value) {
  let text = String(value ?? '').replaceAll('\\', '/');
  if (path.isAbsolute(text) || /^[a-z]:/i.test(text)) {
    const relative = path.relative(dir, path.resolve(text)).split(path.sep).join('/');
    if (!relative || relative.startsWith('..') || path.isAbsolute(relative)) throw new Error(`${value} is outside the ticket folder.`);
    text = relative;
  }
  const parts = text.split('/');
  if (parts.includes('..')) throw new Error(`${value} is outside the ticket folder.`);
  if (parts.some((part) => !part || part === '.')) throw new Error(`${value} is not a ticket-relative path.`);
  return text;
}

/** The bytes of one document of the set. It refuses a missing file, a link, and a file that a manifest must not hold. */
function readDocument(dir, relative) {
  const key = relative.toLowerCase();
  if (barredFromManifest(key) || KEPT_OUT.includes(key)) throw new Error(`${relative} cannot be in a review set: approval records, logs, and a stale canvas page stay outside it.`);
  try { return regular(within(dir, relative)); }
  catch (error) { throw new Error(error.code === 'ENOENT' ? `${relative} does not exist.` : `${relative}: ${error.message}`); }
}

/** The outbox drafts with `target: change`: their paths. */
function changeDrafts(dir) {
  const folder = path.join(dir, 'outbox');
  let names = [];
  try { names = readdirSync(folder, { withFileTypes: true }).filter((entry) => entry.isFile() && /\.draft\.md$/.test(entry.name)).map((entry) => entry.name).sort(); } catch { /* No outbox folder. */ }
  return names.filter((name) => {
    return isChangeDraft(dir, `outbox/${name}`);
  }).map((name) => `outbox/${name}`);
}

/** The review that a carry record can extend: the newest review of the recorded manifest, when it covered the plan of that manifest. */
function carrySource(dir, record, planHash) {
  if (record.status !== 'in-review' || !record.manifest) return null;
  let bytes;
  let manifest;
  try {
    bytes = regular(within(dir, record.manifest));
    manifest = JSON.parse(bytes.toString('utf8'));
  } catch { return null; }
  if (!Array.isArray(manifest?.documents) || (record.hash && sha256(bytes) !== record.hash)) return null;
  const listed = manifest.documents.map((doc) => ({ path: String(doc?.path ?? '').replaceAll('\\', '/'), sha256: doc?.sha256 }));
  const plan = listed.find((doc) => doc.path.toLowerCase() === 'plan.md');
  const review = listed.filter((doc) => REVIEW_FILE.test(doc.path)).sort((a, b) => a.path.localeCompare(b.path)).at(-1);
  if (!plan || !review || plan.sha256 === planHash) return null;
  try {
    if (parseFrontmatter(regular(within(dir, review.path)).toString('utf8'), [])['plan-sha256'] !== plan.sha256) return null;
  } catch { return null; }
  return { from: review.path, oldHash: plan.sha256 };
}

/** The text of a section of a review file, or an empty string. */
function reviewSection(text, name) {
  return sections(text).find((item) => item.heading.toLowerCase() === name)?.text ?? '';
}

/** Sets the State line of the Now card. No other line changes. */
function setCardState(text, state) {
  const card = nowCard(text);
  if (!card) return text;
  const lines = text.split('\n');
  for (let index = card.line; index < lines.length && !/^#{1,2}\s/.test(lines[index]); index++) {
    const hit = /^(\s*[-*]\s+(?:\*\*State:\*\*|State:)\s*)(.*?)(\r?)$/.exec(lines[index]);
    if (hit) { lines[index] = `${hit[1]}${STATE_EMOJI[state]} ${state}${hit[3]}`; break; }
  }
  return lines.join('\n');
}

/**
 * Checks, and unless dryRun, opens the review of one gate: it writes the manifest, saves the snapshot, and sets the gate to in-review.
 * @param {string} dir the ticket folder
 * @param {{ gate: string, extra?: string[], policy?: object|null, repoPath?: string, checkouts?: object[], today?: string, dryRun?: boolean }} options
 * @returns {{ gate: string, key: string, manifest: string, hash: string, documents: {path: string, sha256: string}[], diff: string, carried: string|null, notes: string[], review: {file: string, openBlockers: string, concerns: string}|null, dryRun: boolean }}
 */
export function openReview(dir, { gate, extra = [], policy = null, repoPath = '', checkouts = [], today = new Date().toISOString().slice(0, 10), dryRun = false }) {
  if (/^sendable\??$/i.test(String(gate).trim())) throw new Error('Sendable? has its own steps: the host prompt that the gate guard asks for is the "yes" for each write. Use the Sendable? steps of the ticket skill.');
  const name = gateName(gate);
  if (!validDate(today)) throw new Error(`Invalid date: ${today}.`);
  const file = path.join(dir, 'README.md');
  if (lstatSync(file).isSymbolicLink()) throw new Error('README.md must not be a link.');
  const original = readFileSync(file);
  const text = original.toString('utf8');
  const ticket = parseTicket(text);
  const matches = ticket.gates.filter((item) => item.name === name);
  if (matches.length !== 1) throw new Error(matches.length ? `${name} has more than one record.` : `${name} is not recorded in the README.`);
  const record = matches[0];
  if (record.status === 'skipped') throw new Error(`${name} is skipped. A skipped gate has no review.`);

  for (const before of GATES.slice(0, GATES.indexOf(name)).filter((item) => item !== 'Sendable?')) {
    const verdict = checkGate(ticket, file, before);
    if (!verdict.allowed) throw new Error(`${before} must be approved before you open ${name}: ${verdict.findings.map((item) => item.message).join(' ')}`);
  }

  // The document set, in order, with no duplicates.
  const planned = name === 'Planned?' ? plannedChecks(dir, ticket, { policy, repoPath, checkouts }) : null;
  const shippable = name === 'Shippable?' ? shippableChecks(dir, ticket, { policy }) : null;
  if (shippable?.findings.length) throw new Error(`${name} is not ready for review:\n${shippable.findings.map((item) => `- ${item.message} ${item.remedy}`).join('\n')}`);
  const notes = [];
  const drafts = name === 'Shippable?' ? changeDrafts(dir) : [];
  if (drafts.length > 1) notes.push(`${drafts.length} change drafts exist: none is in the set.`);
  const names = [];
  const add = (value) => {
    const relative = documentPath(dir, value);
    if (!names.some((item) => item.toLowerCase() === relative.toLowerCase())) names.push(relative);
  };
  for (const item of [...(GATE_DOCS[name] ?? []), ...(shippable?.proof ? [shippable.proof] : []), ...(planned?.evidence ?? []), ...(planned?.review ? [planned.review] : []), ...(drafts.length === 1 ? drafts : []), ...extra]) add(item);
  const documents = names.map((relative) => ({ path: relative, sha256: sha256(readDocument(dir, relative)) }));

  // The plan checks. A review that the recorded manifest does not list is no finding here: the new manifest lists it.
  let review = planned?.review ?? null;
  let carry = null;
  if (planned) {
    const planBytes = regular(within(dir, 'plan.md'));
    const planHash = sha256(planBytes);
    const old = record.manifest ? path.resolve(dir, record.manifest) : null;
    const findings = planned.findings.filter((item) => !(item.code === 'plan-review' && old && item.file && path.resolve(item.file) === old));
    if (findings.length && ['attacker', 'panel'].includes(policy?.planReview) && findings.every((item) => item.code === 'plan-review')) {
      const source = carrySource(dir, record, planHash);
      if (source) {
        let number = 0;
        try { number = Math.max(0, ...readdirSync(path.join(dir, 'evidence')).map((item) => Number(/^plan-review-(\d{3})\.md$/.exec(item)?.[1] ?? 0))); } catch { /* No evidence folder. */ }
        const relative = `evidence/plan-review-${String(number + 1).padStart(3, '0')}.md`;
        const content = [
          '---', 'type: evidence', `ticket: ${ticket.key}`, `date: ${today}`, `plan-sha256: ${planHash}`, `carried-from: ${source.from}`, `reviewed-sha256: ${source.oldHash}`, '---',
          `# Plan review ${ticket.key} ${relative.slice(-6, -3)}: carried`, '',
          `The reviewers read the plan revision ${source.oldHash.slice(0, 12)}. They did not read this revision (${planHash.slice(0, 12)}): the user asked for the change at the gate.`, '',
        ].join('\n');
        carry = { relative, content, sentence: content.split('\n').at(-2) };
        review = relative;
        documents.push({ path: relative, sha256: sha256(Buffer.from(content)) });
        findings.length = 0;
        notes.unshift(carry.sentence);
      }
    }
    if (findings.length) {
      throw new Error(`${name} is not ready for review:\n${findings.map((item) => `- ${item.message} ${item.remedy}${item.code === 'plan-review' ? ` (plan.md sha256 ${planHash})` : ''}`).join('\n')}`);
    }
  }

  // The manifest name: the next number for this gate.
  const stem = name.replace(/\?$/, '').toLowerCase();
  const last = Math.max(0, ...(existsSync(path.join(dir, 'approvals')) ? readdirSync(path.join(dir, 'approvals')) : []).map((item) => Number(new RegExp(`^${stem}-(\\d+)\\.json$`).exec(item)?.[1] ?? 0)));
  const manifestPath = `approvals/${stem}-${String(last + 1).padStart(3, '0')}.json`;
  const manifestBytes = Buffer.from(`${JSON.stringify({ version: 1, gate: name, documents }, null, 2)}\n`);
  const hash = sha256(manifestBytes);
  const diff = renderDiff(diffGate(dir, ticket, name));
  let reviewText = null;
  if (review) {
    const bytes = carry ? Buffer.from(carry.content) : readDocument(dir, review);
    const body = bytes.toString('utf8');
    reviewText = { file: review, openBlockers: reviewSection(body, 'open blockers'), concerns: reviewSection(body, 'concerns') };
  }
  if (carry && dryRun) notes.push(`Would write ${carry.relative}.`);
  const result = { gate: name, key: ticket.key, manifest: manifestPath, hash, documents, diff, carried: carry?.relative ?? null, notes, review: reviewText, dryRun };
  if (dryRun) return result;

  // One write for the README. Forge runs one session per ticket, so nothing is locked: on any failure the steps are undone.
  const gates = ticket.gates.map((item) => {
    if (item !== record) return item;
    const { date, ...rest } = item;
    return { ...rest, status: 'in-review', manifest: manifestPath, hash };
  });
  const scalars = { state: 'needs-me', ...(/^updated:/m.test(text) ? { updated: today } : {}) };
  const readme = setCardState(rewriteFrontmatter(text, { scalars, gates }), 'needs-me');
  const undo = [];
  const folder = (target) => {
    if (existsSync(target)) return;
    mkdirSync(target, { recursive: true });
    undo.push(() => rmdirSync(target));
  };
  const create = (target, content) => {
    writeFileSync(target, content, { flag: 'wx' });
    undo.push(() => rmSync(target, { force: true }));
  };
  try {
    if (carry) create(path.join(dir, ...carry.relative.split('/')), carry.content);
    folder(path.join(dir, 'approvals'));
    create(path.join(dir, ...manifestPath.split('/')), manifestBytes);
    folder(path.join(dir, 'approvals', 'snapshots'));
    const snapshot = saveSnapshot(dir, ticket, name);
    for (const item of snapshot.snapshots.filter((entry) => entry.written)) undo.push(() => rmSync(path.join(dir, ...item.snapshot.split('/')), { force: true }));
    writeFileSync(file, readme);
    undo.push(() => writeFileSync(file, original));
    const written = parseTicket(readFileSync(file, 'utf8'));
    const now = written.gates.find((item) => item.name === name);
    if (now?.status !== 'in-review' || now.manifest !== manifestPath || now.hash !== sha256(readFileSync(path.join(dir, ...manifestPath.split('/'))))) throw new Error(`The written ${name} record is not the planned record.`);
    approveGate(dir, { gate: name, answer: 'approve', method: 'form', today, dryRun: true });
  } catch (error) {
    for (const step of undo.reverse()) { try { step(); } catch { /* Keep undoing the other steps. */ } }
    throw new Error(`${name} did not open: ${error.message}`);
  }
  return result;
}
