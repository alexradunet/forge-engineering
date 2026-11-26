// The code binding of the Shippable? gate: the head of the ticket branch, the merge base, and the patch-id of the diff.
// A clean rebase keeps the patch-id; a new commit, a changed line, or a whitespace edit changes it.
// Git runs with argument lists only (never a shell string), and all calls of one binding share one deadline.
import { spawnSync } from 'node:child_process';
import { samePath } from './repo.mjs';

const MAX_BUFFER = 64 * 1024 * 1024;
const REF_PART = /^[^\s\\:?*[~^]+$/;

/** The base branch for a ticket: the baseBranch of the checkout row of the main checkout, else config.repo.baseBranch, else ''. */
export function baseBranchOf(config, repoPath) {
  const rows = config?.repo?.checkouts ?? [];
  const row = repoPath ? rows.find((item) => item?.path && samePath(item.path, repoPath)) : null;
  return String(row?.baseBranch || config?.repo?.baseBranch || '');
}

/** A runner of git calls that share one deadline. It throws when the time is over or when the call cannot run. */
function runner(worktree, deadlineMs) {
  const end = Date.now() + deadlineMs;
  return (args, { input, maxBuffer = 1024 * 1024, command = 'git', ok = [0] } = {}) => {
    const left = end - Date.now();
    if (left <= 0) throw new Error(`git did not finish within ${Math.round(deadlineMs / 1000)} s.`);
    const argv = command === 'git' ? ['-C', worktree, ...args] : args;
    const result = spawnSync(command, argv, { cwd: worktree, input, encoding: 'utf8', windowsHide: true, timeout: left, maxBuffer });
    if (result.error) {
      if (result.error.code === 'ETIMEDOUT') throw new Error(`git did not finish within ${Math.round(deadlineMs / 1000)} s.`);
      if (result.error.code === 'ENOBUFS') throw new Error('The diff is larger than 64 MiB.');
      throw new Error(`${command} ${args[0] ?? ''} could not run: ${result.error.message}`);
    }
    if (!ok.includes(result.status)) throw new Error(`git ${args.slice(0, 2).join(' ')} failed: ${(result.stderr || result.stdout || `exit ${result.status}`).trim()}`);
    return { status: result.status, out: (result.stdout ?? '').trim(), raw: result.stdout ?? '' };
  };
}

/**
 * The binding of the code of a ticket branch: { head, base, patchId, branch }. It throws an Error with a clear message and never returns an empty value.
 * base is the merge base with origin/<baseBranch> when that ref exists, else with <baseBranch>.
 */
export function codeBinding({ worktree, branch, baseBranch, deadlineMs = 15000 }) {
  if (!worktree) throw new Error('The ticket has no worktree folder to read the code from.');
  if (!branch || !REF_PART.test(branch) || branch.startsWith('-')) throw new Error(`The ticket branch name is not valid: ${JSON.stringify(branch)}.`);
  if (!baseBranch || !REF_PART.test(baseBranch) || baseBranch.startsWith('-')) throw new Error(`No valid base branch: ${JSON.stringify(baseBranch ?? '')}. Check the repo config (baseBranch).`);
  const git = runner(worktree, deadlineMs);
  const head = git(['rev-parse', '--verify', '--quiet', `refs/heads/${branch}^{commit}`], { ok: [0, 1] });
  if (head.status !== 0 || !head.out) throw new Error(`The branch ${branch} does not exist in ${worktree}.`);
  const remote = git(['rev-parse', '--verify', '--quiet', `refs/remotes/origin/${baseBranch}^{commit}`], { ok: [0, 1] });
  let baseRef = remote.status === 0 && remote.out ? `origin/${baseBranch}` : '';
  if (!baseRef) {
    const local = git(['rev-parse', '--verify', '--quiet', `${baseBranch}^{commit}`], { ok: [0, 1] });
    if (local.status !== 0 || !local.out) throw new Error(`The base branch ${baseBranch} is not known here (no origin/${baseBranch} and no ${baseBranch}).`);
    baseRef = baseBranch;
  }
  const base = git(['merge-base', head.out, baseRef]).out;
  if (!base) throw new Error(`No merge base of ${branch} and ${baseRef}.`);
  const diff = git(['diff', '--binary', '--no-ext-diff', '--no-textconv', '--src-prefix=a/', '--dst-prefix=b/', base, head.out], { maxBuffer: MAX_BUFFER });
  if (!diff.raw.length) throw new Error(`no code change: ${branch} has no diff against ${baseRef}.`);
  const id = git(['patch-id', '--verbatim'], { command: 'git', input: diff.raw, maxBuffer: 1024 * 1024 });
  const patchId = id.out.split(/\s+/)[0];
  if (!/^[0-9a-f]{40,64}$/.test(patchId)) throw new Error('git patch-id gave no value. Git 2.40 or later is needed for --verbatim.');
  return { head: head.out, base, patchId, branch };
}

const hex = (value) => typeof value === 'string' && /^[0-9a-f]{7,64}$/.test(value);

/** True when commit a is an ancestor of (or equal to) commit b. It throws only when git cannot run. */
export function isAncestor(worktree, a, b, { deadlineMs = 15000 } = {}) {
  if (!hex(a) || !hex(b)) return false;
  const run = runner(worktree, deadlineMs);
  if (run(['cat-file', '-e', `${a}^{commit}`], { ok: [0, 1, 128] }).status !== 0) return false;
  return run(['merge-base', '--is-ancestor', a, b], { ok: [0, 1] }).status === 0;
}

/** The commits after reviewHead up to head: [{ sha, subject }], newest first. */
export function commitsAfter(worktree, reviewHead, head, { deadlineMs = 15000 } = {}) {
  if (!hex(reviewHead) || !hex(head)) return [];
  const { out } = runner(worktree, deadlineMs)(['log', '--format=%h%x09%s', `${reviewHead}..${head}`]);
  return out ? out.split('\n').map((line) => { const [sha, ...rest] = line.split('\t'); return { sha, subject: rest.join('\t') }; }) : [];
}

/** True when the worktree has changes that are not committed (staged, unstaged, or untracked). */
export function dirty(worktree, { deadlineMs = 15000 } = {}) {
  return runner(worktree, deadlineMs)(['status', '--porcelain']).out.length > 0;
}
