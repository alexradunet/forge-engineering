// The checks of the plan before the Planned? gate: paths, baseline evidence, and the plan review.
import { createHash } from 'node:crypto';
import { existsSync, lstatSync, readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { numberedItems, sections, tableRow } from './reading.mjs';
import { parseFrontmatter } from './ticket.mjs';

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
 * Baseline and Control lines link, and the newest plan review file that covers the current plan.md.
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
  const checks = section(plan, 'Checks');
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
