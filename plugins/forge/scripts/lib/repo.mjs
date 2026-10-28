// Finds the code repository and its wiki from any folder: the main checkout,
// a linked worktree (for example <repo>.worktrees\<name>), or the wiki itself.
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';

export class ForgeError extends Error {
  constructor(message, code) {
    super(message);
    this.code = code;
  }
}

function git(cwd, args) {
  try {
    return execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
  } catch (err) {
    if (err.code === 'ENOENT') throw new ForgeError('git is not on PATH. Install Git.', 'no-git');
    return null;
  }
}

function isDir(p) {
  try { return statSync(p).isDirectory(); } catch { return false; }
}

// https://host/owner/name, lower case, no .git. Returns null for an unknown form.
export function normalizeRemote(url) {
  if (!url) return null;
  let u = url.trim();
  const scp = /^[\w.-]+@([^:/]+):(.+)$/.exec(u);
  if (scp) u = `https://${scp[1]}/${scp[2]}`;
  const m = /^(?:https?|ssh|git):\/\/(?:[^@/]+@)?([^/:]+)(?::\d+)?\/(.+?)(?:\.git)?\/?$/i.exec(u);
  if (!m) return null;
  return `https://${m[1]}/${m[2]}`.toLowerCase();
}

export function samePath(a, b) {
  const norm = (p) => path.resolve(p).replace(/[\\/]+$/, '');
  return process.platform === 'win32' ? norm(a).toLowerCase() === norm(b).toLowerCase() : norm(a) === norm(b);
}

export function readBinding(wikiPath) {
  const file = path.join(wikiPath, 'forge', 'repo.json');
  if (!existsSync(file)) return null;
  try {
    return JSON.parse(readFileSync(file, 'utf8'));
  } catch (err) {
    throw new ForgeError(`${file} is not valid JSON: ${err.message}`, 'bad-binding');
  }
}

// The main checkout of the repository that contains cwd.
function mainCheckout(cwd) {
  const top = git(cwd, ['rev-parse', '--show-toplevel']);
  if (!top) return null;
  const gitDir = git(cwd, ['rev-parse', '--path-format=absolute', '--git-dir']);
  const commonDir = git(cwd, ['rev-parse', '--path-format=absolute', '--git-common-dir']);
  const linked = Boolean(gitDir && commonDir && !samePath(gitDir, commonDir));
  let main = path.resolve(top);
  if (linked) {
    if (path.basename(commonDir) !== '.git') {
      throw new ForgeError(`The worktree at ${top} belongs to a bare or unusual repository (${commonDir}). forge supports a normal checkout with linked worktrees.`, 'unsupported-layout');
    }
    main = path.dirname(path.resolve(commonDir));
  }
  return { main, top: path.resolve(top), worktree: linked ? path.resolve(top) : null };
}

/**
 * Resolves the repository and its wiki.
 * @param {object} [opts]
 * @param {string} [opts.cwd] start folder
 * @param {string} [opts.wiki] explicit wiki folder (per call override)
 * @param {object} [opts.env] environment (for tests)
 */
export function resolve({ cwd = process.cwd(), wiki, env = process.env } = {}) {
  const warnings = [];
  const here = mainCheckout(cwd);
  if (!here) throw new ForgeError(`${cwd} is not inside a Git repository. Open the code repository or its wiki.`, 'not-git');

  let repoPath = here.main;
  let worktree = here.worktree;
  let wikiPath = null;
  let source = 'convention';

  // Started inside a wiki: a bound wiki, or a legacy "<repo>.wiki" folder next to its repo.
  const ownBinding = readBinding(here.top);
  if (ownBinding?.repo?.path) {
    wikiPath = here.top;
    repoPath = path.resolve(ownBinding.repo.path);
    worktree = null;
    source = 'binding';
  } else if (here.top.toLowerCase().endsWith('.wiki')) {
    const sibling = here.top.slice(0, -'.wiki'.length);
    if (existsSync(path.join(sibling, '.git'))) {
      wikiPath = here.top;
      repoPath = sibling;
      worktree = null;
      source = 'legacy-sibling';
    }
  }

  if (wiki) {
    const explicit = path.resolve(wiki);
    if (wikiPath && !samePath(explicit, wikiPath)) {
      throw new ForgeError(`--wiki ${explicit} does not match the wiki that you are in (${wikiPath}).`, 'wiki-mismatch');
    }
    wikiPath = explicit;
    source = 'override';
  }
  if (!wikiPath) wikiPath = `${repoPath}.wiki`;

  const repoRemote = normalizeRemote(git(repoPath, ['remote', 'get-url', 'origin']));
  const exists = isDir(wikiPath);
  const binding = exists ? readBinding(wikiPath) : null;

  if (binding?.repo) {
    const boundRemote = normalizeRemote(binding.repo.remote);
    if (boundRemote && repoRemote && boundRemote !== repoRemote) {
      throw new ForgeError(`The wiki ${wikiPath} belongs to ${boundRemote}, not to ${repoRemote}. Use the wiki of this repository, or fix forge/repo.json.`, 'wiki-mismatch');
    }
    if (binding.repo.path && !samePath(binding.repo.path, repoPath)) {
      warnings.push(`forge/repo.json names ${binding.repo.path}, but the repository is at ${repoPath}. Run the forge-setup skill to update the binding.`);
    }
  } else if (exists) {
    warnings.push(`${wikiPath} has no forge/repo.json yet. Run the forge-setup skill to bind it to ${repoPath}.`);
  }

  const legacy = env.FORGE_WIKI_ROOT;
  if (legacy && source !== 'override' && !samePath(legacy, wikiPath)) {
    warnings.push(`FORGE_WIKI_ROOT is ${legacy}, but this repository uses ${wikiPath}. forge v4 ignores the variable. Pass --wiki to override one call.`);
  }

  return {
    repo: { path: repoPath, remote: repoRemote, worktree },
    wiki: { path: wikiPath, exists, bound: Boolean(binding?.repo), source },
    configDir: path.join(wikiPath, 'forge', 'config'),
    warnings,
  };
}
