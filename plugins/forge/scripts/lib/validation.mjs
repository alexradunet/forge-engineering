import { createHash } from 'node:crypto';
import { appendFileSync, lstatSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { nowCard, parseFrontmatter, parseTicket, validDate } from './ticket.mjs';
import { homeOf, rawDir } from './layout.mjs';
import { DOC_BUDGET, SUMMARY_BUDGET, V3_DOCS, summaryCheck } from './reading.mjs';

// The gates of a full-v3 ticket. Each gate has one document, and the plan has no approved copy.
export const GATES = ['Scoped?', 'Planned?', 'Shippable?', 'Sendable?', 'Learned?'];
const GATE_DOCS = { 'Scoped?': ['story.md'], 'Planned?': ['plan.md'], 'Shippable?': ['review.md'], 'Learned?': ['close.md'] };
const PREREQUISITES = {
  start: [], investigate: ['Scoped?'], plan: ['Scoped?'],
  implement: ['Scoped?', 'Planned?'], review: ['Scoped?', 'Planned?'],
  closed: ['Scoped?', 'Planned?', 'Shippable?', 'Learned?'],
};
// GH-2: the "yes" for a write is the prompt of the host that the gate guard asks for. A write needs
// no Sendable? approval record, only its outbox draft.
const ACTION_GATES = {
  investigate: ['Scoped?'],
  plan: ['Scoped?'],
  implement: ['Scoped?', 'Planned?'],
  ship: ['Scoped?', 'Planned?', 'Shippable?'],
  write: [],
  close: ['Scoped?', 'Planned?', 'Shippable?', 'Learned?'],
};
/** The gates that a phase needs. */
export function phaseGates(phase) {
  return PREREQUISITES[phase] ?? [];
}
const SHA = /^[a-f0-9]{64}$/;
const MAX_BYTES = 1024 * 1024;
export const sha256 = (bytes) => createHash('sha256').update(bytes).digest('hex');
const finding = (file, code, message, remedy, severity = 'error', line = null) =>
  ({ file, line, code, severity, message, remedy });

function regular(file) {
  const info = lstatSync(file);
  if (!info.isFile() || info.isSymbolicLink()) throw new Error('Expected a regular file, not a link.');
  if (info.size > MAX_BYTES) throw new Error('File exceeds 1 MiB.');
  return readFileSync(file);
}

// Reject traversal and links before reading a document or applying a repair.
function within(root, relative) {
  if (typeof relative !== 'string' || !relative || relative.includes('\0')
    || path.isAbsolute(relative) || /^[a-z]:/i.test(relative)) throw new Error('Use a ticket-relative path.');
  const parts = relative.split(/[\\/]/);
  if (parts.some((part) => !part || part === '.' || part === '..')) throw new Error('Path contains an empty or traversal component.');
  let file = root;
  for (const part of parts) {
    file = path.join(file, part);
    if (lstatSync(file).isSymbolicLink()) throw new Error('Linked paths are not supported.');
  }
  return file;
}

function relativeName(value) {
  return value.replaceAll('\\', '/').toLowerCase();
}

function approval(gate, file) {
  const root = path.dirname(file);
  const findings = [];
  const references = new Set();
  const fail = (code, message, remedy) => findings.push(finding(file, code, `${gate.name}: ${message}`, remedy));
  const expected = GATE_DOCS[gate.name] ?? [];
  const checkDocument = (relative, hash) => {
    references.add(relativeName(relative));
    try {
      const doc = within(root, relative);
      if (!SHA.test(hash ?? '')) throw new Error('Missing or invalid SHA-256 revision.');
      if (sha256(regular(doc)) !== hash) {
        fail('stale-approval', `${relative} changed after review.`, 'Review the complete current revision set and record explicit approval again.');
      }
    } catch (error) {
      fail('approval-document', `${relative}: ${error.message}`, 'Restore the reviewed file or review the current revision set.');
    }
  };
  if (gate.doc) references.add(relativeName(gate.doc));
  if (gate.manifest) {
    let manifest;
    try {
      const manifestFile = within(root, gate.manifest);
      const bytes = regular(manifestFile);
      manifest = JSON.parse(bytes.toString('utf8'));
      if (!manifest || manifest.version !== 1 || manifest.gate !== gate.name
        || !Array.isArray(manifest.documents) || !manifest.documents.length) throw new Error('Invalid approval manifest schema.');
      if (gate.status === 'approved' && (!SHA.test(gate.hash ?? '') || sha256(bytes) !== gate.hash)) {
        fail('stale-manifest', 'The recorded manifest revision does not match.', 'Review the explicitly listed revisions; record the approved manifest hash.');
      }
      const seen = new Set();
      for (const doc of manifest.documents) {
        if (!doc || typeof doc.path !== 'string' || !SHA.test(doc.sha256 ?? '')) throw new Error('Each document needs a path and SHA-256.');
        const key = relativeName(doc.path);
        if (seen.has(key)) throw new Error(`Duplicate manifest document: ${doc.path}`);
        if (key === 'readme.md' || key === relativeName(gate.manifest)
          || key.endsWith('.json') || key === 'repair-log.jsonl') throw new Error('Approval records must remain outside the hashed document set.');
        seen.add(key);
        references.add(key);
        if (gate.status === 'approved') checkDocument(doc.path, doc.sha256);
      }
      for (const required of [...expected, ...(gate.doc ? [gate.doc] : [])]) {
        if (!seen.has(relativeName(required))) throw new Error(`Manifest omits ${required}.`);
      }
      if (manifest.approvedCopies != null) throw new Error('full-v3 has one plan.md and no approved copy.');
    } catch (error) {
      fail('approval-manifest', error.message, 'Supply a complete manifest outside its document set; ask for explicit approval.');
    }
  } else if (gate.status === 'approved') {
    fail('approval-evidence', 'The complete approved revision set is not recorded.', 'Show the exact documents and hashes, then request one explicit approval for that set.');
  }
  return { findings, references };
}

function inspectTicket(ticket, file) {
  const findings = [];
  const references = new Set();
  let unsafeRepair = false;
  const add = (code, message, remedy, severity) => findings.push(finding(file, code, message, remedy, severity));
  const names = new Set();
  for (const gate of ticket.gates) {
    if (names.has(gate.name)) add('duplicate-gate', `Duplicate gate ${gate.name}.`, 'Reconcile the records with the user; do not infer a state.');
    names.add(gate.name);
    const result = approval(gate, file);
    findings.push(...result.findings);
    if (gate.status === 'approved') {
      for (const reference of result.references) references.add(reference);
    }
    if (result.findings.some((item) => ['approval-evidence', 'approval-manifest'].includes(item.code))) unsafeRepair = true;
    if (['approved', 'in-review'].includes(gate.status) && gate.doc) {
      try { regular(within(path.dirname(file), gate.doc)); }
      catch (error) { add('gate-document', `${gate.name}: ${error.message}`, 'Restore the gate document or reconcile the record with the user.'); }
    }
  }
  for (const name of GATES) {
    const gate = ticket.gates.find((item) => item.name === name);
    if (!gate || gate.need !== 'required' || gate.status === 'skipped') {
      add('workflow-gate', `${name} is mandatory for ${ticket.workflow}.`, 'Restore the required gate; obtain explicit approval before its affected action.');
    }
  }
  for (const name of [...names].filter((item) => !GATES.includes(item))) {
    add('workflow-gate', `${name} does not belong to ${ticket.workflow}.`, 'Remove the foreign gate record after review with the user; do not infer approvals.');
  }
  for (const name of PREREQUISITES[ticket.phase]) {
    if (!ticket.gates.some((gate) => gate.name === name && gate.status === 'approved')) {
      add('phase-before-approval', `${ticket.phase} precedes ${name} approval.`, `Obtain ${name} approval before continuing this phase; do not change state automatically.`);
    }
  }
  if ((ticket.phase === 'closed') !== (ticket.state === 'done')) {
    add('state-conflict', 'Closed phase and done state disagree.', 'Ask the user to reconcile the recorded phase and state.');
  }
  if (ticket.phase === 'closed') {
    try { regular(within(path.dirname(file), 'proof.md')); }
    catch (error) { add('missing-evidence', error.message, 'Record Evidence Testing before closing.'); }
  }
  return { findings, references, unsafeRepair };
}

export function validateTicket(ticket, file) {
  return inspectTicket(ticket, file).findings;
}

export function checkGate(ticket, file, name) {
  const matches = ticket.gates.filter((item) => item.name === name);
  const gate = matches[0];
  if (!gate) return { allowed: false, findings: [finding(file, 'gate-missing', `${name} is not recorded.`, 'Review the original workflow and obtain the required approval.')] };
  if (matches.length !== 1) return { allowed: false, findings: [finding(file, 'duplicate-gate', `${name} has conflicting records.`, 'Reconcile the records explicitly before the affected action.')] };
  if (gate.need !== 'required') return { allowed: false, findings: [finding(file, 'workflow-gate', `${name} must be required for ${ticket.workflow}.`, 'Restore the recorded contract without inferring approval.')] };
  if (gate.status !== 'approved') return { allowed: false, findings: [finding(file, 'gate-unapproved', `${name} is not approved.`, 'Request explicit approval before the affected action.')] };
  const { findings } = approval(gate, file);
  return { allowed: findings.length === 0, findings };
}

export function checkAction(ticket, file, action, write) {
  const required = ACTION_GATES[action];
  if (!required) throw new Error(`Unknown blocked action: ${action}`);
  const findings = required.flatMap((name) => checkGate(ticket, file, name).findings);
  if (action === 'write') {
    const draft = write?.draft;
    if (typeof draft !== 'string' || !/^outbox[\\/].+\.draft\.md$/.test(draft)) {
      findings.push(finding(file, 'write-draft', 'The write names no outbox/<target>.draft.md file.', 'Write the text from the outbox.draft.md template before the write.'));
    } else {
      try { regular(within(path.dirname(file), draft)); }
      catch (error) { findings.push(finding(file, 'write-draft', `${draft}: ${error.message}`, 'Write the text from the outbox.draft.md template before the write.')); }
    }
  }
  return { allowed: findings.length === 0, findings };
}

export function classifySource(source, { wikiPath, repoPath } = {}) {
  if (typeof source !== 'string') return { kind: 'unknown', exists: null };
  if (/^https?:\/\/\S+$/i.test(source)) return { kind: 'url', exists: null };
  const clean = source.replace(/:\d+(?::\d+)?$/, '').replaceAll('\\', '/');
  if (/(^|\/)(raw|archive)\//.test(clean)) return { kind: 'local-only', exists: null };
  let base;
  let relative;
  if (clean.startsWith('repo:')) { base = repoPath; relative = clean.slice(5); }
  else if (clean.startsWith('wiki:')) { base = wikiPath; relative = clean.slice(5); }
  else if (/^(?:investigation on |command:)/.test(clean)) return { kind: 'non-path', exists: null };
  else if (/^[\w.-]+(?:\/[\w .-]+)+\.[a-z0-9]+$/i.test(clean)) { base = repoPath; relative = clean; }
  else return { kind: 'unknown', exists: null };
  if (!base) return { kind: 'unresolved', exists: null };
  try { within(base, relative); return { kind: 'path', exists: true }; }
  catch (error) {
    return error.code === 'ENOENT' ? { kind: 'moved-path', exists: false } : { kind: 'unknown', exists: null };
  }
}

function children(dir) {
  try {
    if (lstatSync(dir).isSymbolicLink()) throw new Error(`Linked directory is not supported: ${dir}`);
    return readdirSync(dir, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name));
  } catch (error) {
    if (error.code === 'ENOENT') return [];
    throw error;
  }
}

function markdownFiles(root, onError) {
  const files = [];
  for (const entry of children(root)) {
    const file = path.join(root, entry.name);
    try {
      if (entry.isSymbolicLink()) throw new Error(`Linked path is not supported: ${file}`);
      if (entry.isDirectory()) files.push(...markdownFiles(file, onError));
      else if (entry.isFile() && entry.name.endsWith('.md')) files.push(file);
    } catch (error) { onError(file, error); }
  }
  return files;
}

const sameText = (a, b) => String(a ?? '').replace(/[`*_]/g, '').replace(/\s+/g, ' ').trim().toLowerCase()
  === String(b ?? '').replace(/[`*_]/g, '').replace(/\s+/g, ' ').trim().toLowerCase();

// Warnings only, for full-v3: the summary and the whole document stay in their word budgets, and no section is empty.
function plainWarnings(dir, add, inspect) {
  for (const name of V3_DOCS) {
    const doc = path.join(dir, name);
    inspect(doc, () => {
      let text;
      try { text = regular(doc).toString('utf8'); }
      catch (error) { if (error.code === 'ENOENT') return; throw error; }
      const check = summaryCheck(text);
      if (!check.summary) {
        add(doc, 'summary-missing', 'Gate document has no summary under its title.', `Write at most ${SUMMARY_BUDGET} words under the title: the key fact, the change, and what you need from the user. The approval form shows it.`, 'warning');
      } else if (check.over) {
        add(doc, 'summary-over-budget', `The summary has ${check.words} words; the budget is ${SUMMARY_BUDGET}.`, 'Move detail to a section below the summary.', 'warning');
      }
      if (check.totalOver) {
        add(doc, 'document-over-budget', `The document has ${check.total} words; the budget is ${DOC_BUDGET}.`, 'Move detail to an evidence file and link it. Do not drop facts.', 'warning');
      }
      for (const item of check.empty) {
        add(doc, 'empty-section', `Section "${item.heading}" has no content.`, 'Remove the section. A full-v3 document has only the sections with content.', 'warning', item.line);
      }
    });
  }
}

// Warnings only: the Now card must agree with the frontmatter, and gate docs must keep their reading levels short.
function readerWarnings(dir, file, readme, ticket, add, inspect) {
  const card = nowCard(readme);
  if (!card) {
    add(file, 'now-card-missing', 'README has no "## Now" card.', 'Add the Now card from the README template under the title.', 'warning');
  } else {
    const { state, phase, next } = card.fields;
    const stale = [];
    if (!state || !new RegExp(`(^|[^a-z-])${ticket.state}([^a-z-]|$)`).test(state)) stale.push(`State should name ${ticket.state}`);
    if (!phase || !new RegExp(`(^|[^a-z-])${ticket.phase}([^a-z-]|$)`).test(phase)) stale.push(`Phase should name ${ticket.phase}`);
    if (!sameText(next, ticket.next)) stale.push('Next should match the frontmatter next');
    if (stale.length) add(file, 'now-card-stale', `Now card does not agree with the frontmatter: ${stale.join('; ')}.`, 'Update the Now card in the same edit as the frontmatter.', 'warning', card.line);
  }
  plainWarnings(dir, add, inspect);
}

export function lint({ wikiPath, repoPath, fix = false }) {
  const report = { version: 1, wikiPath: path.resolve(wikiPath), findings: [], repairs: [], summary: { errors: 0, warnings: 0, repaired: 0 } };
  const add = (file, code, message, remedy, severity = 'error', line = null) =>
    report.findings.push(finding(file, code, message, remedy, severity, line));
  const inspect = (file, operation) => {
    try { operation(); }
    catch (error) { add(file, 'invalid-input', error.message, 'Correct this file explicitly; valid files remain independently checked.'); }
  };
  inspect(report.wikiPath, () => {
    if (!lstatSync(report.wikiPath).isDirectory()) throw new Error('Wiki path must be a directory.');
    let ticketRoot = null;
    // The tickets are in the raw folder of the Forge folder: inside the wiki for an older folder, and next to the wiki from Forge 9.
    try { ticketRoot = within(homeOf(report.wikiPath), 'raw\\tickets'); }
    catch (error) {
      if (error.code !== 'ENOENT') add(path.join(rawDir(report.wikiPath), 'tickets'), 'invalid-input', error.message, 'Inspect the ticket path explicitly; lint does not follow links.');
    }
    const keys = new Set();
    for (const entry of ticketRoot ? children(ticketRoot) : []) {
      if (!entry.isDirectory() && !entry.isSymbolicLink()) continue;
      const dir = path.join(ticketRoot, entry.name);
      const file = path.join(dir, 'README.md');
      inspect(file, () => {
        if (lstatSync(dir).isSymbolicLink()) throw new Error('Ticket directory must not be a link.');
        const readme = regular(file).toString('utf8');
        const ticket = parseTicket(readme);
        if (keys.has(ticket.key)) add(file, 'duplicate-ticket', `Duplicate ticket key ${ticket.key}.`, 'Reconcile the duplicate ticket folders.');
        keys.add(ticket.key);
        const result = inspectTicket(ticket, file);
        report.findings.push(...result.findings);
        readerWarnings(dir, file, readme, ticket, add, inspect);
        const drafts = markdownFiles(dir, (file, error) => add(file, 'invalid-input', error.message, 'Inspect this draft path explicitly; no linked file is repaired.'));
        for (const draft of drafts.filter((name) => name.endsWith('.draft.md'))) {
          inspect(draft, () => {
            const bytes = regular(draft);
            if (!bytes.length || bytes.at(-1) === 10) return;
            const rel = relativeName(path.relative(dir, draft));
            const protectedDraft = result.unsafeRepair || result.references.has(rel);
            let metadata;
            try { metadata = parseFrontmatter(bytes.toString('utf8')); }
            catch (error) {
              add(draft, 'draft-metadata', error.message, 'Correct draft metadata explicitly before any repair.');
              return;
            }
            if (metadata.status === 'draft' && Object.entries(metadata).some(([key, value]) =>
              /^(approved|approval)([_-]|$)/.test(key) && value != null && value !== '')) {
              add(draft, 'draft-approval-conflict', 'Draft status conflicts with approval metadata.', 'Review the conflicting evidence explicitly; lint must not infer an approval or repair this file.', 'error', 1);
              return;
            }
            const approved = protectedDraft || metadata.status !== 'draft';
            if (!fix || approved) {
              add(draft, 'final-newline', 'Draft has no final newline.', approved
                ? 'Review this protected or non-draft file explicitly; automatic repair is prohibited.'
                : 'Run lint --fix to append only the missing final newline.', 'warning');
              return;
            }
            const text = bytes.toString('utf8');
            const newline = text.includes('\r\n') ? '\r\n' : '\n';
            const log = path.join(dir, 'repair-log.jsonl');
            try {
              const previous = regular(log);
              if (previous.length && previous.at(-1) !== 10) throw new Error('Repair log has an incomplete final record.');
              for (const row of previous.toString('utf8').split('\n').filter((row) => row.trim())) JSON.parse(row);
            } catch (error) { if (error.code !== 'ENOENT') throw error; }
            const after = Buffer.concat([bytes, Buffer.from(newline)]);
            // Write the intent first so a failed content write cannot produce an unlogged change.
            const record = { version: 1, time: new Date().toISOString(), file: path.relative(dir, draft), code: 'final-newline', before: sha256(bytes), after: sha256(after) };
            appendFileSync(log, JSON.stringify({ ...record, status: 'started' }) + '\n');
            writeFileSync(draft, after);
            appendFileSync(log, JSON.stringify({ ...record, status: 'applied' }) + '\n');
            report.repairs.push({ file: draft, code: 'final-newline', log });
          });
        }
      });
    }
    const walk = (dir) => {
      for (const entry of children(dir)) {
        if (['.git', 'raw', 'archive', 'forge'].includes(entry.name)) continue;
        const file = path.join(dir, entry.name);
        if (entry.isSymbolicLink()) { add(file, 'linked-page', 'Wiki page path is a link.', 'Inspect this path explicitly; lint does not follow links.'); continue; }
        if (entry.isDirectory()) { inspect(file, () => walk(file)); continue; }
        if (!entry.isFile() || !entry.name.endsWith('.md')) continue;
        inspect(file, () => {
          const data = parseFrontmatter(regular(file).toString('utf8'), ['sources']);
          const special = dir === report.wikiPath && ['index.md', 'log.md'].includes(entry.name);
          if (typeof data.title !== 'string' || !data.title.trim()) add(file, 'wiki-title', 'Page title is missing.', 'Add a meaningful title in frontmatter.', 'error', 1);
          if (special) {
            if (data.type !== (entry.name === 'index.md' ? 'index' : 'log')) add(file, 'wiki-type', 'Index or log type is missing or incorrect.', 'Set type to index or log, matching this file.', 'error', 1);
            return;
          }
          if (!['verified', 'needs-check', 'decided'].includes(data.status)) add(file, 'wiki-status', 'Page status is missing or invalid.', 'Set verified, needs-check, or decided from evidence.', 'error', 1);
          if (!validDate(data.updated)) add(file, 'wiki-updated', 'Page date is missing or invalid.', 'Record the actual verification date.', 'error', 1);
          else if (Date.now() - Date.parse(data.updated) > 90 * 86400000) add(file, 'wiki-age', 'Page verification is older than 90 days.', 'Check the source before relying on this page; do not delete it automatically.', 'warning');
          if (data.status === 'needs-check') add(file, 'wiki-needs-check', 'Page needs verification.', 'Verify its claims against the source before reuse.', 'warning');
          if (!Array.isArray(data.sources) || !data.sources.length) add(file, 'wiki-sources', 'Page has no source list.', 'Add evidence links; local-only material must not be the only useful context.');
          else for (const source of data.sources) {
            const classified = classifySource(source, { wikiPath: report.wikiPath, repoPath });
            if (classified.kind !== 'path' && classified.kind !== 'non-path') {
              add(file, `source-${classified.kind}`, `${String(source)} (${classified.kind}).`,
                classified.kind === 'url' ? 'Verify the linked claim manually; lint does not fetch URLs.'
                  : classified.kind === 'local-only' ? 'Keep the shared summary useful without ignored local material.'
                    : 'Verify the source format and repository base; do not infer that the claim is false.', 'warning');
            }
          }
        });
      }
    };
    walk(report.wikiPath);
  });
  report.summary = {
    errors: report.findings.filter((item) => item.severity === 'error').length,
    warnings: report.findings.filter((item) => item.severity === 'warning').length,
    repaired: report.repairs.length,
  };
  return report;
}
