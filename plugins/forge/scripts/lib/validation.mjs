import { createHash } from 'node:crypto';
import { appendFileSync, lstatSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { parseFrontmatter, parseTicket, validDate } from './ticket.mjs';

export const FULL_GATES = ['Understood?', 'Agreed?', 'Diagnosed?', 'Designed?', 'Shippable?', 'Sendable?', 'Learned?'];
const GATE_DOCS = {
  'Understood?': ['context.md'], 'Agreed?': ['interview.md'],
  'Briefed?': ['context.md', 'interview.md'], 'Diagnosed?': ['investigation.md'],
  'Designed?': ['plan.draft.md'], 'Shippable?': ['review.md'], 'Learned?': ['close.draft.md'],
};
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

function approval(ticket, gate, file) {
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
      if (gate.name === 'Sendable?') {
        if (!gate.doc || !/^outbox[\\/].+\.draft\.md$/.test(gate.doc)) throw new Error('Sendable? needs the exact outbox draft in doc.');
        for (const key of ['command', 'target']) {
          if (typeof manifest[key] !== 'string' || !manifest[key].trim()) throw new Error(`Sendable? manifest needs the exact ${key}.`);
          if (gate[key] != null && gate[key] !== manifest[key]) throw new Error(`Sendable? ${key} differs from the approved manifest.`);
        }
      }
      if (manifest.approvedCopies != null && !Array.isArray(manifest.approvedCopies)) throw new Error('approvedCopies must be a list.');
      const copies = manifest.approvedCopies ?? [];
      if (copies.some((copy) => gate.name !== 'Designed?' || !copy
        || copy.from !== 'plan.draft.md' || copy.to !== 'plan.md') || copies.length > 1) {
        throw new Error('Only the Designed? plan.draft.md to plan.md copy is supported.');
      }
      if (gate.name === 'Designed?' && !copies.some((copy) => copy.from === 'plan.draft.md' && copy.to === 'plan.md')) {
        throw new Error('Designed? must bind plan.draft.md to its approved plan.md copy.');
      }
      for (const copy of copies) {
        if (!copy || typeof copy.from !== 'string' || typeof copy.to !== 'string'
          || !seen.has(relativeName(copy.from))) throw new Error('Invalid approved copy mapping.');
        references.add(relativeName(copy.to));
        if (gate.status === 'approved') {
          const from = regular(within(root, copy.from));
          const to = regular(within(root, copy.to));
          if (!from.equals(to)) fail('stale-approved-copy', `${copy.to} differs from ${copy.from}.`, 'Review the plan again; keep the approved draft and execution copy byte-equivalent.');
        }
      }
    } catch (error) {
      fail('approval-manifest', error.message, 'Supply a complete manifest outside its document set; ask for explicit approval.');
    }
  } else if (gate.status === 'approved') {
    if (ticket.workflow === 'full-v1' || gate.name === 'Briefed?') {
      fail('approval-evidence', 'The complete approved revision set is not recorded.', 'Show the exact documents and hashes, then request one explicit approval for that set.');
    } else if (!gate.doc || !SHA.test(gate.hash ?? '')) {
      fail('approval-evidence', 'The approved document revision cannot be established.', 'Review this gate before its affected action; retain unrelated read-only work.');
    } else {
      checkDocument(gate.doc, gate.hash);
      if (gate.name === 'Designed?') {
        try {
          if (!regular(within(root, gate.doc)).equals(regular(within(root, 'plan.md')))) {
            fail('stale-approved-copy', 'plan.md differs from the approved draft.', 'Review the current plan before implementation.');
          }
          references.add('plan.md');
        } catch (error) {
          fail('approval-document', error.message, 'Restore or review the approved execution plan before implementation.');
        }
      }
    }
  }
  return { findings, references };
}

function inspectTicket(ticket, file) {
  const findings = [];
  const references = new Set();
  const sentApprovals = new Set();
  let unsafeRepair = false;
  const add = (code, message, remedy, severity) => findings.push(finding(file, code, message, remedy, severity));
  const names = new Set();
  for (const gate of ticket.gates) {
    if (names.has(gate.name)) add('duplicate-gate', `Duplicate gate ${gate.name}.`, 'Reconcile the records with the user; do not infer a state.');
    names.add(gate.name);
    const result = approval(ticket, gate, file);
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
  const outbox = path.join(path.dirname(file), 'outbox');
  try {
      within(path.dirname(file), 'outbox');
      for (const entry of children(outbox).filter((entry) => entry.name.endsWith('.approval.json'))) {
        const sidecarFile = path.join(outbox, entry.name);
        try {
          const record = JSON.parse(regular(sidecarFile).toString('utf8'));
          if (!record || record.version !== 1 || !['approved', 'sent'].includes(record.status)
            || typeof record.doc !== 'string' || !/^outbox[\\/].+\.draft\.md$/.test(record.doc)
            || typeof record.target !== 'string' || !record.target.trim()
            || typeof record.command !== 'string' || !record.command.trim()
            || !validDate(record.approval_date)
            || typeof record.approval_manifest !== 'string' || !SHA.test(record.approval_hash ?? '')
            || (record.status === 'sent' && (typeof record.result !== 'string' || !record.result.trim()))) {
            throw new Error('Invalid per-write approval record.');
          }
          const result = approval({ ...ticket, workflow: 'full-v1' }, {
            name: 'Sendable?', doc: record.doc, status: 'approved', manifest: record.approval_manifest, hash: record.approval_hash,
            command: record.command, target: record.target,
          }, file);
          if (record.status === 'sent') sentApprovals.add(`${relativeName(record.approval_manifest)}:${record.approval_hash}`);
          for (const reference of result.references) references.add(reference);
          findings.push(...result.findings.map((item) => ({ ...item, file: sidecarFile })));
          if (result.findings.length) unsafeRepair = true;
        } catch (error) {
          findings.push(finding(sidecarFile, 'write-approval', error.message, 'Review the exact command, target and draft revision before this write; preserve sent outcomes separately.'));
          unsafeRepair = true;
        }
      }
  } catch (error) {
    if (error.code !== 'ENOENT') {
      add('write-approval', error.message, 'Inspect the outbox path explicitly; no automatic repair is allowed.');
      unsafeRepair = true;
    }
  }
  if (ticket.workflow === 'full-v1') {
    for (const name of FULL_GATES) {
      const gate = ticket.gates.find((item) => item.name === name);
      if (!gate || gate.need !== 'required' || gate.status === 'skipped') {
        add('workflow-gate', `${name} is mandatory for full-v1.`, 'Restore the required gate; obtain explicit approval before its affected action.');
      }
    }
    if (names.has('Briefed?')) add('workflow-gate', 'Briefed? belongs only to legacy workflows.', 'Use Understood? and Agreed? for full-v1; do not infer their approvals.');
    const prerequisites = {
      start: [], investigate: FULL_GATES.slice(0, 2), plan: FULL_GATES.slice(0, 3),
      implement: FULL_GATES.slice(0, 4), review: FULL_GATES.slice(0, 4),
      closed: [...FULL_GATES.slice(0, 5), 'Learned?'],
    };
    for (const name of prerequisites[ticket.phase]) {
      if (!ticket.gates.some((gate) => gate.name === name && gate.status === 'approved')) {
        add('phase-before-approval', `${ticket.phase} precedes ${name} approval.`, `Obtain ${name} approval before continuing this phase; do not change state automatically.`);
      }
    }
    if ((ticket.phase === 'closed') !== (ticket.state === 'done')) {
      add('state-conflict', 'Closed phase and done state disagree.', 'Ask the user to reconcile the recorded phase and state.');
    }
    if (ticket.phase === 'closed') {
      try { regular(within(path.dirname(file), 'evidence-testing.md')); }
      catch (error) { add('missing-evidence', error.message, 'Record Evidence Testing before closing.'); }
    }
  } else {
    // Legacy tickets retain recorded skips and optional diagnosis; missing workflow is not migration.
    const required = [
      'Designed?', 'Shippable?', 'Sendable?', 'Learned?',
      ...(ticket.track === 'M' ? ['Briefed?'] : ticket.track === 'L' ? ['Understood?', 'Agreed?'] : []),
    ];
    for (const gate of ticket.gates) {
      if (ticket.track !== 'Unspecified' && required.includes(gate.name) && gate.status === 'skipped') {
        add('legacy-gate-conflict', `${gate.name} is required by the original track but recorded as skipped.`, 'Review the original track and recorded skip with the user.');
      }
    }
  }
  return { findings, references, sentApprovals, unsafeRepair };
}

export function validateTicket(ticket, file) {
  return inspectTicket(ticket, file).findings;
}

export function checkGate(ticket, file, name) {
  const matches = ticket.gates.filter((item) => item.name === name);
  const gate = matches[0];
  if (!gate) return { allowed: false, findings: [finding(file, 'gate-missing', `${name} is not recorded.`, 'Review the original workflow and obtain the required approval.')] };
  if (matches.length !== 1) return { allowed: false, findings: [finding(file, 'duplicate-gate', `${name} has conflicting records.`, 'Reconcile the records explicitly before the affected action.')] };
  if (ticket.workflow === 'full-v1' && gate.need !== 'required') return { allowed: false, findings: [finding(file, 'workflow-gate', `${name} must be required for full-v1.`, 'Restore the recorded contract without inferring approval.')] };
  const legacyMandatory = ['Designed?', 'Shippable?', 'Sendable?', 'Learned?',
    ...(ticket.track === 'M' ? ['Briefed?'] : ticket.track === 'L' ? ['Understood?', 'Agreed?'] : [])];
  if (gate.status === 'skipped' && ticket.workflow !== 'full-v1' && (gate.need === 'recommended'
    || ticket.track === 'Unspecified'
    || (['S', 'M'].includes(ticket.track) && ['Understood?', 'Agreed?', 'Diagnosed?'].includes(name)))
    && (ticket.track === 'Unspecified' || !legacyMandatory.includes(name))) return { allowed: true, findings: [] };
  if (gate.status !== 'approved') return { allowed: false, findings: [finding(file, 'gate-unapproved', `${name} is not approved.`, 'Request explicit approval before the affected action.')] };
  const { findings } = approval(ticket, gate, file);
  return { allowed: findings.length === 0, findings };
}

export function checkAction(ticket, file, action, write) {
  const required = {
    investigate: ['Understood?', 'Agreed?'],
    plan: ['Understood?', 'Agreed?', 'Diagnosed?'],
    implement: ['Understood?', 'Agreed?', 'Diagnosed?', 'Designed?'],
    ship: ['Understood?', 'Agreed?', 'Diagnosed?', 'Designed?', 'Shippable?'],
    write: ['Sendable?'],
    close: ['Understood?', 'Agreed?', 'Diagnosed?', 'Designed?', 'Shippable?', 'Learned?'],
  }[action];
  if (!required) throw new Error(`Unknown blocked action: ${action}`);
  const gates = ticket.workflow === 'full-v1' ? required : required.flatMap((name) => {
    if (name === 'Diagnosed?') return ticket.gates.some((gate) => gate.name === name && gate.status === 'approved') ? [name] : [];
    if (['Understood?', 'Agreed?'].includes(name)) {
      if (ticket.track === 'S') return [];
      if (ticket.track === 'M') return name === 'Understood?' ? ['Briefed?'] : [];
      if (ticket.track === 'Unspecified') {
        return [
          ...(ticket.gates.some((gate) => gate.name === name) ? [name] : []),
          ...(name === 'Understood?' && ticket.gates.some((gate) => gate.name === 'Briefed?') ? ['Briefed?'] : []),
        ];
      }
    }
    return [name];
  });
  const findings = gates.flatMap((name) => checkGate(ticket, file, name).findings);
  if (action === 'write') {
    const gate = ticket.gates.find((item) => item.name === 'Sendable?');
    if (!write || typeof write.command !== 'string' || typeof write.target !== 'string') {
      findings.push(finding(file, 'write-target', 'The exact command and target are not supplied.', 'Show the exact command, target and revisions before requesting approval.'));
    } else if (gate?.manifest) {
      const result = approval(ticket, { ...gate, command: write.command, target: write.target }, file);
      findings.push(...result.findings);
      if (inspectTicket(ticket, file).sentApprovals.has(`${relativeName(gate.manifest)}:${gate.hash}`)) {
        findings.push(finding(file, 'write-already-sent', 'This approval already records a sent write.', 'Request a separate explicit approval before a retry or another write.'));
      }
    } else {
      findings.push(finding(file, 'write-target', 'The approved record does not bind this command and target.', 'Review this one external write explicitly; do not infer permission from a previous write.'));
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
    try { ticketRoot = within(report.wikiPath, 'raw\\tickets'); }
    catch (error) {
      if (error.code !== 'ENOENT') add(path.join(report.wikiPath, 'raw', 'tickets'), 'invalid-input', error.message, 'Inspect the ticket path explicitly; lint does not follow links.');
    }
    const keys = new Set();
    for (const entry of ticketRoot ? children(ticketRoot) : []) {
      if (!entry.isDirectory() && !entry.isSymbolicLink()) continue;
      const dir = path.join(ticketRoot, entry.name);
      const file = path.join(dir, 'README.md');
      inspect(file, () => {
        if (lstatSync(dir).isSymbolicLink()) throw new Error('Ticket directory must not be a link.');
        const ticket = parseTicket(regular(file).toString('utf8'));
        if (keys.has(ticket.key)) add(file, 'duplicate-ticket', `Duplicate ticket key ${ticket.key}.`, 'Reconcile the duplicate ticket folders.');
        keys.add(ticket.key);
        const result = inspectTicket(ticket, file);
        report.findings.push(...result.findings);
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
