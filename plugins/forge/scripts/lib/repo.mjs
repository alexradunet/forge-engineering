// Finds the code repository and its wiki from any folder: the main checkout,
// a linked worktree (for example <repo>.worktrees\<name>), the wiki itself, or another folder of the Forge folder.
// The data of a repository is in the Forge folder ../<repo>.forge, with wiki/, raw/, and archive/ (layout.mjs).
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { FORGE_SUFFIX, WIKI_NAME, archiveDir, homeOf, isForgeLayout, rawDir } from './layout.mjs';

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
// One git call gives the three paths: each git start costs about 100 ms on Windows.
function mainCheckout(cwd) {
  const out = git(cwd, ['rev-parse', '--show-toplevel', '--path-format=absolute', '--git-dir', '--git-common-dir']);
  const [top, gitDir, commonDir] = out ? out.split(/\r?\n/) : [];
  if (!top) return null;
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

// The Forge folder that holds a folder: the nearest folder above it (or the folder itself) with the name <name>.forge and a bound wiki.
// The binding is the proof: a code repository can have the name <name>.forge and a folder wiki/ of its own.
function forgeAbove(start) {
  let dir = path.resolve(start);
  for (;;) {
    if (path.basename(dir).toLowerCase().endsWith(FORGE_SUFFIX) && existsSync(path.join(dir, WIKI_NAME, 'forge', 'repo.json'))) return dir;
    const up = path.dirname(dir);
    if (up === dir) return null;
    dir = up;
  }
}

const inside = (folder, root) => samePath(folder, root) || path.resolve(folder).startsWith(path.resolve(root) + path.sep);

// The repository of a Forge folder, from the binding of its wiki.
function boundRepo(home) {
  const repo = readBinding(path.join(home, WIKI_NAME))?.repo?.path;
  if (!repo) throw new ForgeError(`The Forge folder ${home} is not bound to a repository. Run the forge-setup skill in the code repository.`, 'not-bound');
  return path.resolve(repo);
}

/**
 * Resolves the repository and its wiki.
 * @param {object} [opts]
 * @param {string} [opts.cwd] start folder
 * @param {string} [opts.wiki] explicit wiki folder (per call override)
 * @param {object} [opts.env] environment (for tests). FORGE_HOME names a Forge folder. An old launcher (before 0.1.0) or the user sets it.
 */
export function resolve({ cwd = process.cwd(), wiki, env = process.env } = {}) {
  const warnings = [];
  let here = mainCheckout(cwd);
  let repoPath = null;
  let worktree = null;
  let wikiPath = null;
  let source = 'convention';

  // FORGE_HOME (an old launcher or the user) selects a Forge folder, also from a folder of another repository.
  const launched = env.FORGE_HOME && !wiki ? path.resolve(env.FORGE_HOME) : '';
  // A folder of a Forge folder outside of its wiki (raw/, archive/) is in no git repository, or in a git repository that is not its own.
  const above = launched ? null : forgeAbove(cwd);
  const home = launched || (above && !inside(cwd, path.join(above, WIKI_NAME)) ? above : '');
  if (home) {
    repoPath = boundRepo(home);
    wikiPath = path.join(home, WIKI_NAME);
    source = launched ? 'launcher' : 'binding';
    // A launcher call from the repository keeps the worktree of the session. From each other folder, the main checkout is the place.
    if (here && samePath(here.main, repoPath)) worktree = here.worktree;
    else here = { main: repoPath, top: launched ? repoPath : wikiPath, worktree: null };
  }
  if (!here) throw new ForgeError(`${cwd} is not inside a Git repository. Open the code repository or its wiki.`, 'not-git');
  if (!home) {
    repoPath = here.main;
    worktree = here.worktree;
    // Started inside a wiki: a bound wiki, or a wiki without a binding in the Forge folder of its repository ("<repo>.forge/wiki").
    // An own forge/repo.json counts only in a Forge layout (<name>.forge/wiki), or when --wiki names this folder:
    // a file in a code folder is data that an agent can plant, so it is no binding (L-2).
    const trustedTop = isForgeLayout(here.top) || (wiki && samePath(path.resolve(wiki), here.top));
    const ownBinding = trustedTop ? readBinding(here.top) : null;
    const sibling = isForgeLayout(here.top) ? path.dirname(here.top).slice(0, -FORGE_SUFFIX.length) : '';
    if (ownBinding?.repo?.path) {
      wikiPath = here.top;
      repoPath = path.resolve(ownBinding.repo.path);
      worktree = null;
      source = 'binding';
    } else if (sibling && existsSync(path.join(sibling, '.git'))) {
      wikiPath = here.top;
      repoPath = sibling;
      worktree = null;
      source = 'sibling';
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
  if (!wikiPath) {
    wikiPath = path.join(`${repoPath}${FORGE_SUFFIX}`, WIKI_NAME);
  }

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
    top: here.top,
    repo: { path: repoPath, remote: repoRemote, worktree },
    wiki: { path: wikiPath, exists, bound: Boolean(binding?.repo), source },
    // The Forge folder: 'forge' is ../<repo>.forge with the wiki inside it, and 'wiki' is a folder from --wiki that is the wiki itself.
    forge: { path: homeOf(wikiPath), layout: isForgeLayout(wikiPath) ? 'forge' : 'wiki' },
    raw: rawDir(wikiPath),
    archive: archiveDir(wikiPath),
    configDir: path.join(wikiPath, 'forge', 'config'),
    warnings,
  };
}
