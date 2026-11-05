// Forge names for ticket worktrees and branches, and the one `git worktree add` step.
// Folder: <repo>.worktrees/<key>-<slug>. Branch: repo.branchPattern.
import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { samePath } from './repo.mjs';

const STOP_WORDS = new Set(['a', 'an', 'the', 'of', 'to', 'in', 'on', 'for', 'and', 'or', 'with', 'by', 'at', 'from', 'is', 'be', 'when', 'into', 'via']);
// The Agents window gives a New Worktree session a branch under this prefix.
export const AGENTS_BRANCH = /^agents\//;

function git(cwd, args) {
  const result = spawnSync('git', ['-C', cwd, ...args], { encoding: 'utf8', windowsHide: true });
  return { ok: result.status === 0, out: (result.stdout ?? '').trim(), err: (result.stderr ?? '').trim() || result.error?.message || '' };
}

export function parseKey(value) {
  const match = /^([A-Za-z][A-Za-z0-9]*)-(\d+)$/.exec(String(value ?? '').trim());
  if (!match) throw new Error(`Invalid key: ${value}. Use PREFIX-number, for example APP-123.`);
  return { KEY: `${match[1].toUpperCase()}-${match[2]}`, key: `${match[1].toLowerCase()}-${match[2]}`, number: match[2] };
}

/** 2 to 5 lower-case ASCII words of the goal, joined by "-", at most 40 characters. */
export function slugify(text, { maxWords = 5, maxLength = 40 } = {}) {
  const words = String(text ?? '').normalize('NFKD').replace(/[\u0300-\u036f]/g, '').toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ').trim().split(' ').filter(Boolean);
  const kept = words.filter((word) => !STOP_WORDS.has(word));
  let slug = '';
  for (const word of (kept.length >= 2 ? kept : words).slice(0, maxWords)) {
    const next = slug ? `${slug}-${word}` : word;
    if (next.length > maxLength) break;
    slug = next;
  }
  return slug || (words[0] ?? '').slice(0, maxLength);
}

export function branchName(pattern, key, slug) {
  return String(pattern).replaceAll('{KEY}', key.KEY).replaceAll('{key}', key.key)
    .replaceAll('{number}', key.number).replaceAll('{slug}', slug);
}

export function worktreeFolder(repoPath, key, slug) {
  return path.join(`${repoPath}.worktrees`, `${key.key}-${slug}`);
}

export function listWorktrees(repoPath) {
  const result = git(repoPath, ['worktree', 'list', '--porcelain']);
  if (!result.ok) throw new Error(`git worktree list failed: ${result.err}`);
  const out = [];
  let current = null;
  for (const line of result.out.split(/\r?\n/)) {
    if (line.startsWith('worktree ')) out.push(current = { path: path.resolve(line.slice(9)), head: '', branch: '', locked: false });
    else if (!current) continue;
    else if (line.startsWith('HEAD ')) current.head = line.slice(5);
    else if (line.startsWith('branch ')) current.branch = line.slice(7).replace(/^refs\/heads\//, '');
    else if (line === 'locked' || line.startsWith('locked ')) current.locked = true;
  }
  return out;
}

function belongsTo(entry, key) {
  const words = new RegExp(`(^|[^a-z0-9])${key.key}([^0-9]|$)`, 'i');
  return words.test(entry.branch) || words.test(path.basename(entry.path));
}

/**
 * The read-only plan: names, base, the current session folder, other worktrees of the ticket,
 * and the suggested action (reuse, rename-current, resume, or create).
 */
export function planWorktree({ repoPath, cwd = repoPath, config, key: rawKey, summary, base }) {
  const key = parseKey(rawKey);
  const slug = slugify(summary);
  if (!slug) throw new Error('--summary needs at least one word of the goal.');
  const branch = branchName(config.repo.branchPattern, key, slug);
  if (!git(repoPath, ['check-ref-format', '--branch', branch]).ok) throw new Error(`Not a valid branch name: ${branch}. Check repo.branchPattern.`);
  const folder = worktreeFolder(repoPath, key, slug);
  const checkout = (config.repo.checkouts ?? []).find((row) => row.path && samePath(row.path, repoPath));
  const baseRef = base ?? checkout?.baseBranch ?? config.repo.baseBranch;
  const baseSha = git(repoPath, ['rev-parse', '--verify', '--quiet', `${baseRef}^{commit}`]);
  const worktrees = listWorktrees(repoPath);
  const top = git(cwd, ['rev-parse', '--show-toplevel']);
  const here = top.ok ? worktrees.find((entry) => samePath(entry.path, top.out)) ?? null : null;
  const current = here ? { ...here, linked: !samePath(here.path, worktrees[0]?.path ?? repoPath) } : null;
  const existing = worktrees.find((entry) => entry.branch === branch || samePath(entry.path, folder)) ?? null;
  const related = worktrees.filter((entry) => entry !== existing && belongsTo(entry, key));
  const branchExists = git(repoPath, ['show-ref', '--verify', '--quiet', `refs/heads/${branch}`]).ok;
  let action = 'create';
  if (current?.linked && current.branch === branch) action = 'reuse';
  else if (current?.linked && AGENTS_BRANCH.test(current.branch) && !branchExists) action = 'rename-current';
  else if (existing) action = 'resume';
  const commands = {
    'rename-current': [`git branch -m ${branch}`],
    create: branchExists ? [`git worktree add "${folder}" ${branch}`]
      : [`git worktree add -b ${branch} "${folder}" ${baseSha.ok ? baseSha.out : baseRef}`],
  }[action] ?? [];
  return {
    key: key.KEY, slug, branch, folder, base: { ref: baseRef, sha: baseSha.ok ? baseSha.out : null },
    branchExists, folderExists: existsSync(folder), current, existing, related, action, commands,
  };
}

/** Runs `git worktree add` for a "create" plan and verifies the branch and HEAD of the new folder. */
export function createWorktree(plan, repoPath) {
  if (plan.action !== 'create') return { ...plan, status: 'skipped', reason: `The suggested action is ${plan.action}, not create.` };
  if (plan.folderExists) throw new Error(`${plan.folder} exists but is not a worktree of this repository. Choose another summary or remove the folder.`);
  if (!plan.branchExists && !plan.base.sha) throw new Error(`The base ${plan.base.ref} does not resolve to a commit. Fetch it or pass --base <ref>.`);
  const args = plan.branchExists ? ['worktree', 'add', plan.folder, plan.branch] : ['worktree', 'add', '-b', plan.branch, plan.folder, plan.base.sha];
  const result = git(repoPath, args);
  if (!result.ok) throw new Error(`git ${args.join(' ')} failed: ${result.err}`);
  const head = git(plan.folder, ['rev-parse', 'HEAD']).out;
  const branch = git(plan.folder, ['branch', '--show-current']).out;
  if (branch !== plan.branch || (!plan.branchExists && head !== plan.base.sha)) {
    throw new Error(`The new worktree has branch ${branch} at ${head}; expected ${plan.branch} at ${plan.base.sha ?? plan.branch}. Inspect it before use.`);
  }
  return { ...plan, status: 'created', head, folderExists: true };
}
