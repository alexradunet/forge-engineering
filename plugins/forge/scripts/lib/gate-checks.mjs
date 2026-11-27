// The checks before a gate: the plan before Planned? (paths, baseline evidence, plan review) and the proof before Shippable?.
import { createHash } from 'node:crypto';
import { existsSync, lstatSync, readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { numberedItems, sections, tableRow } from './reading.mjs';
import { parseFrontmatter } from './ticket.mjs';
import { codeBinding, commitsAfter, isAncestor } from './code-bind.mjs';

const MAX_BYTES = 1024 * 1024;
const LINK = /\[[^\]]*\]\((<[^>]*>|[^)\s]*)[^)]*\)(\s*\(new\))?/gi;
const SCHEME = /^[a-z][a-z0-9+.-]+:/i;
const NOT_RUN = /^not run:\s*\S/i;

/** The bytes of a regular file, or null for a missing file, a link, a big file, or any error. */
function readRegular(file) {
  try {
    const info = lstatSync(file);
    return info.isFile() && !info.isSymbolicLink() && info.size <= MAX_BYTES ? readFileSync(file) : null;
  } catch { return null; }
}

/** The Markdown links of one line: [{ target, isNew }]. A (new) mark after the link sets isNew. */
const links = (text) => [...text.matchAll(LINK)].map((hit) => ({ target: hit[1], isNew: Boolean(hit[2]) }));

/** The local path of a link target, or null for a URL. It drops the fragment and the :line suffix, and decodes percent escapes. */
function cleanTarget(target) {
  let value = target.trim().replace(/^<(.*)>$/, '$1');
  if (/^file:/i.test(value)) {
    try { return fileURLToPath(value); } catch { return null; }
  }
  if (SCHEME.test(value)) return null;
  value = value.replace(/#.*$/, '').replace(/:\d+(?::\d+)?$/, '');
  try { value = decodeURIComponent(value); } catch { /* A bad escape keeps the raw text. */ }
  return value || null;
}

const isAbsolute = (value) => path.isAbsolute(value) || /^[a-z]:[\\/]/i.test(value);
const inside = (root, file) => {
  const relative = path.relative(root, file);
  return Boolean(relative) && !relative.startsWith('..') && !path.isAbsolute(relative);
};

/** The 1-based line number of the first line from index `from` that the test accepts, or null. */
const lineOf = (lines, from, test) => {
  const index = lines.findIndex((line, i) => i >= from && test(line));
  return index === -1 ? null : index + 1;
};

const section = (text, name) => sections(text).find((item) => item.heading.toLowerCase() === name.toLowerCase());
const lineValue = (body, label) => new RegExp(`^-\\s+${label}:[ \\t]*(.*)$`, 'im').exec(body)?.[1].trim();

/**
 * The checks of a ticket folder before the Planned? gate.
 * dir is the ticket folder and ticket is the parsed README. It returns
 * { findings, evidence, review }: the findings (the caller sets the severity), the evidence files that the
 * Baseline and Control lines and the Steps section link, and the newest plan review file that covers the current plan.md.
 * A link is not followed: a plan.md, map.md, or evidence file that is a link counts as missing.
 */
export function plannedChecks(dir, ticket, { policy = null, repoPath = '', checkouts = [] } = {}) {
  const out = { findings: [], evidence: new Set(), review: null };
  const planBytes = readRegular(path.join(dir, 'plan.md'));
  const planFile = path.join(dir, 'plan.md');
  const roots = [ticket?.worktree, repoPath, ...checkouts.map((item) => item?.path)].filter((item) => typeof item === 'string' && item);
  const finding = (file, line, code, message, remedy) => out.findings.push({ file, line, code, message, remedy });
  const done = () => ({ findings: out.findings, evidence: [...out.evidence], review: out.review });

  // A file exists in the worktree, in the main checkout, or in a checkout. An absolute path of a checkout also maps into the worktree.
  const found = (target) => {
    if (isAbsolute(target)) {
      if (existsSync(target)) return true;
      const worktree = ticket?.worktree;
      return Boolean(worktree) && roots.slice(1).some((root) => inside(root, target) && existsSync(path.join(worktree, path.relative(root, target))));
    }
    return roots.some((root) => existsSync(path.join(root, target)));
  };
  const checkLinks = (text, label, file, line) => {
    for (const { target, isNew } of links(text)) {
      const clean = isNew ? null : cleanTarget(target);
      if (!clean || found(clean)) continue;
      finding(file, line, 'plan-path', `${label} names a file that does not exist: ${clean}.`, 'Correct the path, or write (new) after the link when a step creates the file.');
    }
  };

  if (!planBytes) return done();
  const plan = planBytes.toString('utf8').replace(/^\uFEFF/, '');
  const planLines = plan.replace(/\r\n/g, '\n').split('\n');

  const steps = section(plan, 'Steps');
  for (const item of steps ? numberedItems(steps.text) : []) {
    for (const row of item.body.split('\n').filter((text) => /^-\s+Files:/i.test(text))) {
      checkLinks(row, `Step ${item.n}`, planFile, lineOf(planLines, steps.line - 1, (text) => text.trim() === row.trim()));
    }
  }

  const mapFile = path.join(dir, 'map.md');
  const mapBytes = readRegular(mapFile);
  const mapText = mapBytes?.toString('utf8').replace(/^\uFEFF/, '');
  const components = mapText && section(mapText, 'Components');
  if (components) {
    const mapLines = mapText.replace(/\r\n/g, '\n').split('\n');
    const rows = components.text.split('\n').filter((text) => /^\s*\|/.test(text));
    const head = rows.length ? tableRow(rows[0]).map((cell) => cell.toLowerCase()) : [];
    const column = head.indexOf('file');
    const nameColumn = Math.max(head.indexOf('component'), 0);
    if (column !== -1) {
      for (const row of rows.slice(2)) {
        const cells = tableRow(row);
        checkLinks(cells[column] ?? '', `Component ${cells[nameColumn] || '?'}`, mapFile, lineOf(mapLines, components.line - 1, (text) => text.trim() === row.trim()));
      }
    }
  }

  // Each Baseline and Control line has a link to an evidence file, or says "not run: <why>".
  const evidenceDir = path.join(dir, 'evidence');
  const evidenceLinks = (value) => links(value).map((item) => cleanTarget(item.target)).filter(Boolean)
    .map((target) => path.resolve(dir, target)).filter((file) => inside(evidenceDir, file) && readRegular(file));
  // The evidence files that a line of the Steps section links are in the list too (not the Diagnosis lines).
  for (const file of evidenceLinks(steps?.text ?? '')) out.evidence.add(path.relative(dir, file).split(path.sep).join('/'));
  const checks = section(plan, 'Checks');
  const hasFiles = (steps ? numberedItems(steps.text) : []).some((item) => item.body.split('\n').some((text) => /^-\s+Files:/i.test(text)));
  if (hasFiles && !(checks ? numberedItems(checks.text) : []).length) {
    finding(planFile, checks?.line ?? null, 'plan-no-check', 'The plan changes files but has no numbered check in Checks.', 'Write at least one check with Action, Expected, Baseline, and Control lines.');
  }
  for (const item of checks ? numberedItems(checks.text) : []) {
    for (const [label, what] of [['Baseline', 'baseline'], ['Control', 'control']]) {
      const value = lineValue(item.body, label);
      const remedy = `Run the ${what} now and link its output in evidence/, or write "not run: <why>".`;
      if (value === undefined) {
        finding(planFile, lineOf(planLines, checks.line - 1, (text) => /^\d+[.)]\s/.test(text) && text.includes(item.title)), 'plan-baseline', `Check ${item.n} has no ${label} line.`, remedy);
        continue;
      }
      const files = evidenceLinks(value);
      for (const file of files) out.evidence.add(path.relative(dir, file).split(path.sep).join('/'));
      if (!files.length && !NOT_RUN.test(value)) {
        finding(planFile, lineOf(planLines, checks.line - 1, (text) => text.trim() === `- ${label}: ${value}`.trim()), 'plan-baseline', `Check ${item.n} has no ${what} run: the ${label} line has no evidence link.`, remedy);
      }
    }
  }

  // The newest plan review file covers the plan when its plan-sha256 is the hash of plan.md.
  let names = [];
  try { names = readdirSync(evidenceDir).filter((name) => /^plan-review-\d{3}\.md$/.test(name)).sort(); } catch { /* No evidence folder. */ }
  const newest = names.at(-1);
  const hash = createHash('sha256').update(planBytes).digest('hex');
  let covers = false;
  if (newest) {
    const bytes = readRegular(path.join(evidenceDir, newest));
    try { covers = Boolean(bytes) && parseFrontmatter(bytes.toString('utf8'), [])['plan-sha256'] === hash; } catch { /* An unreadable frontmatter covers nothing. */ }
  }
  if (covers) out.review = `evidence/${newest}`;
  if (['attacker', 'panel'].includes(policy?.planReview)) {
    if (!covers) {
      finding(planFile, null, 'plan-review', `No plan review covers this revision of plan.md (sha256 ${hash.slice(0, 12)}).`, 'Run the plan review of the agents skill for this revision.');
    } else {
      const gate = ticket?.gates?.find((item) => item.name === 'Planned?');
      if (gate?.status === 'in-review' && gate.manifest && !/(^|[\\/])\.\.([\\/]|$)/.test(gate.manifest) && !isAbsolute(gate.manifest)) {
        let manifest = null;
        try { manifest = JSON.parse(readRegular(path.join(dir, ...gate.manifest.split(/[\\/]/)))?.toString('utf8')); } catch { /* The approval check reports it. */ }
        if (Array.isArray(manifest?.documents)
          && !manifest.documents.some((doc) => typeof doc?.path === 'string' && doc.path.replaceAll('\\', '/').toLowerCase() === out.review.toLowerCase())) {
          finding(path.join(dir, gate.manifest), null, 'plan-review', `The Planned? manifest does not list ${out.review}.`, 'Open the gate again with a manifest that lists the review file.');
        }
      }
    }
  }
  return done();
}

/** The state word of a proof check title: verified, failed, not proven, or undefined (open). */
const checkState = (title) => /^[^\p{L}]*(verified|failed|not proven)\b/iu.exec(title)?.[1].toLowerCase();

/** The findings of the proof.md part of shippableChecks. */
function proofFindings(dir, file) {
  const bytes = readRegular(file);
  if (!bytes) {
    return [{ file, line: null, code: 'proof-missing', message: 'Shippable? needs proof.md: the proof of the changed behavior comes before this gate.', remedy: 'Do the Evidence Testing step now, and write proof.md. Set policy.evidenceOnDeployedEnv to true only when the proof needs a deployed environment.' }];
  }
  const text = bytes.toString('utf8').replace(/^﻿/, '');
  const lines = text.replace(/\r\n/g, '\n').split('\n');
  const checks = section(text, 'Checks');
  const items = checks ? numberedItems(checks.text) : [];
  if (!items.length) {
    return [{ file, line: checks?.line ?? null, code: 'proof-empty', message: 'proof.md has no numbered check in Checks.', remedy: 'Copy each check of plan.md into Checks of proof.md, then run it.' }];
  }
  const gaps = section(text, 'Accepted gaps')?.text ?? '';
  const evidenceDir = path.join(dir, 'evidence');
  const findings = [];
  for (const item of items) {
    const state = checkState(item.title);
    const line = lineOf(lines, checks.line - 1, (row) => /^\d+[.)]\s/.test(row) && row.includes(item.title));
    if (state === 'failed') {
      findings.push({ file, line, code: 'proof-failed', message: `Check ${item.n} of proof.md failed.`, remedy: 'Go back to Implement. Shippable? opens when no check failed.' });
    } else if (!state) {
      findings.push({ file, line, code: 'proof-open', message: `Check ${item.n} of proof.md is still open.`, remedy: 'Run the check, then mark it verified, failed, or not proven with the reason.' });
    } else if (state === 'verified') {
      const linked = links(`${item.title}\n${item.body}`).map((entry) => cleanTarget(entry.target)).filter(Boolean)
        .map((target) => path.resolve(dir, target)).some((target) => inside(evidenceDir, target) && readRegular(target));
      if (!linked) findings.push({ file, line, code: 'proof-no-evidence', message: `Check ${item.n} of proof.md is verified but links no file in evidence/.`, remedy: 'Save the output in evidence/ and link it in the Observed line, or mark the check not proven.' });
    } else if (!new RegExp(`^\\s*[-*]\\s+\\S*\\s*Check\\s+${item.n}\\s*:\\s*\\S`, 'im').test(gaps)) {
      findings.push({ file, line, code: 'proof-no-gap', message: `Check ${item.n} of proof.md is not proven and has no line in Accepted gaps.`, remedy: `Ask the user, then write "- ⚪ Check ${item.n}: <why>. Accepted by the user on <yyyy-mm-dd>." in Accepted gaps.` });
    }
  }
  return findings;
}

/** The code review part of shippableChecks: it sets out.code, out.review, out.later, and out.codeError, and adds findings. */
function codeFindings(dir, ticket, { repoPath, baseBranch }, out) {
  const finding = (code, message, remedy) => out.findings.push({ file: path.join(dir, 'evidence'), line: null, code, message, remedy });
  const worktree = ticket.worktree || repoPath;
  try { out.code = codeBinding({ worktree, branch: ticket.branch, baseBranch }); }
  catch (error) {
    out.codeError = error.message;
    finding('code-review-git', `Forge cannot read the code of ${ticket.branch}: ${error.message}`, error.code === 'base-missing'
      ? 'Set repo.baseBranch in the Forge config to a branch that exists here (then run `forge.mjs trust`), or run `git fetch`.'
      : 'Run `git fetch` in the worktree, then try again.');
    return;
  }
  const evidenceDir = path.join(dir, 'evidence');
  let names = [];
  try { names = readdirSync(evidenceDir).filter((name) => /^code-review-\d{3}\.md$/.test(name)).sort(); } catch { /* No evidence folder. */ }
  const newest = names.at(-1);
  if (!newest) {
    finding('code-review-missing', 'Shippable? needs a code review: evidence/code-review-NNN.md from a blind reviewer.', `Run the adversarial review of the agents skill for head ${out.code.head.slice(0, 12)}, then save its report in evidence/code-review-001.md.`);
    return;
  }
  let data = {};
  try { data = parseFrontmatter(readRegular(path.join(evidenceDir, newest))?.toString('utf8') ?? '', []); } catch { /* A file with no frontmatter is stale. */ }
  out.review = `evidence/${newest}`;
  if (data['patch-id'] === out.code.patchId) return;
  try {
    // The review head must hold ticket work: a descendant of the merge base, and not the merge base itself.
    if (isAncestor(worktree, out.code.base, data.head) && !isAncestor(worktree, data.head, out.code.base) && isAncestor(worktree, data.head, out.code.head)) {
      out.later = commitsAfter(worktree, data.head, out.code.head);
      return;
    }
  } catch (error) {
    out.codeError = error.message;
    finding('code-review-git', `Forge cannot compare the code review with the branch: ${error.message}`, 'Run `git fetch` in the worktree, then try again.');
    return;
  }
  finding('code-review-stale', `${out.review} does not cover the code now: its patch-id and its head do not match the branch.`, `Run the adversarial review again for head ${out.code.head.slice(0, 12)} (patch-id ${out.code.patchId.slice(0, 12)}) and save the report in the next code-review file.`);
}

/**
 * The checks of a ticket folder before the Shippable? gate: the proof of the changed behavior, and for a ticket with a branch the code review.
 * proof.md must be a regular file with at least one check, no check open or failed, a verified check with a link to a file in evidence/,
 * and a not proven check with a line in Accepted gaps. With policy.evidenceOnDeployedEnv true only this proof part is skipped.
 * A ticket with a branch needs the newest evidence/code-review-NNN.md: its patch-id is the current one, or its head is an ancestor of the head.
 * It never throws. Returns { findings, proof, review, code, later, codeError }: the findings (the caller sets the severity),
 * 'proof.md' when the proof rule applies and the file is good, the review file, the code binding, the commits after the review head,
 * and the text of a code read error (or '').
 */
export function shippableChecks(dir, ticket, { policy = null, repoPath = '', baseBranch = '' } = {}) {
  const out = { findings: [], proof: null, review: null, code: null, later: [], codeError: '' };
  try {
    if (policy?.evidenceOnDeployedEnv !== true) {
      out.findings.push(...proofFindings(dir, path.join(dir, 'proof.md')));
      out.proof = out.findings.length ? null : 'proof.md';
    }
  } catch { /* A proof that cannot be read gives no finding here. */ }
  try {
    if (ticket?.branch) codeFindings(dir, ticket, { repoPath, baseBranch }, out);
  } catch (error) { out.codeError = error.message; }
  return out;
}
