// Setup helpers for the forge-setup skill: detect tools, create or bind the
// wiki, and seed the forge config from the templates. Read-only except
// initWiki, bind, and seed, which write only inside the wiki folder.
import { spawnSync } from 'node:child_process';
import { copyFileSync, existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { POINTER_FILE, writeLauncher, writePointer } from './launcher.mjs';
import { homeOf, isForgeLayout } from './layout.mjs';
import { ForgeError, normalizeRemote, readBinding } from './repo.mjs';

// The config templates of <plugin>/templates/config. policy.md is seeded apart: only when missing.
export const CONFIG_FILES = ['repo.md'];

function run(cmd, args, cwd) {
  // Windows .cmd shims (az) need a shell. Arguments are fixed strings, so
  // pass one quoted command line instead of an args array (avoids DEP0190).
  const shell = process.platform === 'win32' && !/\.exe$/i.test(cmd) && cmd !== 'git';
  const opts = { cwd, encoding: 'utf8', timeout: 20000, windowsHide: true, shell };
  const r = shell
    ? spawnSync([cmd, ...args].map((a) => (/^[\w.\-\/:=,]+$/.test(a) ? a : `"${a.replace(/"/g, '\\"')}"`)).join(' '), opts)
    : spawnSync(cmd, args, opts);
  if (r.error) return { ok: false, missing: r.error.code === 'ENOENT', stdout: '', code: null };
  return { ok: r.status === 0, missing: r.status === 9009 || /not recognized|not found/i.test(r.stderr ?? ''), stdout: (r.stdout ?? '').trim(), code: r.status };
}

/** github or other, from a normalized remote URL. */
export function hostKind(remote) {
  if (!remote) return 'none';
  const host = new URL(remote).hostname;
  if (host === 'github.com' || host.endsWith('.ghe.com') || /(^|\.)github\./.test(host)) return 'github';
  return 'other';
}

// Upper-case words that look like keys but are standards or encodings.
const NOT_KEYS = new Set(['UTF', 'SHA', 'ISO', 'RFC', 'CVE', 'HTTP', 'TLS', 'SSL', 'PEP', 'ES', 'MD', 'AES', 'RSA', 'X', 'WIP', 'V']);
const KEY_RE = /(?<![A-Za-z0-9])([A-Z][A-Z0-9]{1,9})-(\d+)(?![A-Za-z0-9])/g;

/** Work item key prefixes in branch names and commit subjects, most frequent first. */
export function keyHints(texts) {
  const counts = new Map();
  for (const t of texts) {
    for (const m of t.matchAll(KEY_RE)) {
      if (NOT_KEYS.has(m[1])) continue;
      const c = counts.get(m[1]) ?? { prefix: m[1], count: 0, example: `${m[1]}-${m[2]}` };
      c.count++;
      counts.set(m[1], c);
    }
  }
  return [...counts.values()].sort((a, b) => b.count - a.count).slice(0, 3);
}

/** The most common branch shape for a key prefix, for example "feature/{KEY}-{slug}". */
export function branchPatternHint(branches, prefix) {
  if (!prefix) return null;
  const counts = new Map();
  const re = new RegExp(`(?<![A-Za-z0-9])(${prefix}|${prefix.toLowerCase()})-\\d+(-[a-z0-9][a-z0-9-]*)?$`);
  for (const b of branches) {
    const name = b.replace(/^origin\//, '');
    const m = re.exec(name);
    if (!m) continue;
    const pattern = name.slice(0, m.index) + (m[1] === prefix ? '{KEY}' : '{key}') + (m[2] ? '-{slug}' : '');
    counts.set(pattern, (counts.get(pattern) ?? 0) + 1);
  }
  const best = [...counts.entries()].sort((a, b) => b[1] - a[1])[0];
  return best && best[1] >= 2 ? best[0] : null;
}

function gitInfo(dir, git) {
  if (!dir) return { defaultBranch: null, branches: [], local: [], subjects: [] };
  const out = (args) => { const r = git(args, dir); return r.ok ? r.stdout : ''; };
  let defaultBranch = out(['symbolic-ref', '--short', 'refs/remotes/origin/HEAD']).replace(/^origin\//, '') || null;
  if (!defaultBranch) {
    for (const b of ['main', 'master']) {
      if (git(['show-ref', '--verify', '--quiet', `refs/remotes/origin/${b}`], dir).ok
        || git(['show-ref', '--verify', '--quiet', `refs/heads/${b}`], dir).ok) { defaultBranch = b; break; }
    }
  }
  const lines = (s) => s.split(/\r?\n/).filter(Boolean);
  const branches = lines(out(['for-each-ref', '--count=500', '--format=%(refname:short)', 'refs/heads', 'refs/remotes/origin']))
    .filter((b) => b !== 'origin' && b !== 'origin/HEAD');
  const subjects = lines(out(['log', '-n', '200', '--format=%s']));
  const local = lines(out(['for-each-ref', '--count=500', '--format=%(refname:short)', 'refs/heads']));
  return { defaultBranch, branches, local, subjects };
}

function slugOf(remote) {
  try { return new URL(remote).pathname.replace(/^\//, '').replace(/\.git$/, '') || null; } catch { return null; }
}

/**
 * The values that differ for each user: the base branch, the branch pattern, and the main checkout.
 * A null value means "ask the user". The templates give the rest.
 */
export function suggestValues(info) {
  const { remote, path: repoPath, defaultBranch, branchPattern } = info;
  const kind = hostKind(remote);
  const repo = { baseBranch: defaultBranch ?? 'master', branchPattern: branchPattern ?? null };
  const checkouts = repoPath ? [{
    name: path.basename(repoPath).toLowerCase(),
    path: repoPath,
    remote: kind === 'github' ? slugOf(remote) : remote,
    baseBranch: '',
  }] : [];
  return { repo, checkouts };
}

/** Detects the host, the branch hints, and the wiki state. Forge calls no external tool. */
export function detect(where, { git = (args, cwd) => run('git', args, cwd) } = {}) {
  const kind = hostKind(where.repo.remote);

  const wikiDir = where.wiki.path;
  const wikiGit = existsSync(path.join(wikiDir, '.git'));
  const wikiRemote = wikiGit ? normalizeRemote(run('git', ['remote', 'get-url', 'origin'], wikiDir).stdout) : null;
  const configDir = path.join(wikiDir, 'forge', 'config');
  const config = existsSync(configDir) ? readdirSync(configDir).filter((f) => f.endsWith('.md')) : [];

  let wikiRemoteSuggestion = wikiRemote ? { type: 'existing', url: wikiRemote } : null;
  if (!wikiRemote && where.repo.remote && kind === 'github') {
    // Forge does not read the visibility of the repository: the user decides.
    wikiRemoteSuggestion = {
      type: 'ask',
      options: ['native', 'separate-private-repo', 'local-only'],
      native: `${where.repo.remote}.wiki.git`,
      separate: `${where.repo.remote}-wiki`,
    };
  }

  const g = gitInfo(where.repo.path, git);
  const hints = keyHints([...g.branches, ...g.subjects]);
  // Only local branches: origin holds the branches of all users, and each user has a personal pattern.
  const branchPattern = branchPatternHint(g.local, hints[0]?.prefix);

  return {
    repo: { ...where.repo, host: kind, defaultBranch: g.defaultBranch, keyHints: hints, branchPattern },
    wiki: { path: wikiDir, exists: where.wiki.exists, git: wikiGit, remote: wikiRemote, bound: where.wiki.bound, config },
    suggestion: {
      wikiRemote: wikiRemoteSuggestion,
      values: suggestValues({ remote: where.repo.remote, path: where.repo.path, defaultBranch: g.defaultBranch, branchPattern }),
    },
  };
}

// Only a wiki folder from --wiki outside of a Forge folder has raw/ and archive/ inside the wiki repository.
const GITIGNORE = 'raw/\narchive/\n';
const INDEX = '---\ntitle: Wiki index\ntype: index\n---\n# Wiki index\n\nOne line per page. The `wiki` skill keeps this list.\n';

/**
 * Creates the Forge folder of a repository when it does not exist, and binds its wiki: the wiki (git init, index.md), raw/, archive/,
 * and the launcher. `pluginDir` is the plugin folder for the launcher. A wiki folder from --wiki outside of a Forge folder gets only its wiki parts.
 */
export function initWiki(where, { pluginDir = '' } = {}) {
  const dir = where.wiki.path;
  const created = [];
  const forgeLayout = isForgeLayout(dir);
  if (!existsSync(dir)) { mkdirSync(dir, { recursive: true }); created.push(dir); }
  if (!existsSync(path.join(dir, '.git'))) {
    const r = spawnSync('git', ['init', '-q', '-b', 'main'], { cwd: dir, encoding: 'utf8' });
    if (r.status !== 0) throw new ForgeError(`git init failed in ${dir}: ${r.stderr}`, 'init-failed');
    created.push('.git');
  }
  const gi = path.join(dir, '.gitignore');
  const current = existsSync(gi) ? readFileSync(gi, 'utf8') : '';
  const missing = forgeLayout ? [] : GITIGNORE.split('\n').filter((l) => l && !current.split(/\r?\n/).includes(l));
  if (missing.length) {
    writeFileSync(gi, current + (current && !current.endsWith('\n') ? '\n' : '') + missing.join('\n') + '\n');
    created.push('.gitignore');
  }
  if (forgeLayout) created.push(...furnish(homeOf(dir), pluginDir));
  const index = path.join(dir, 'index.md');
  if (!existsSync(index)) { writeFileSync(index, INDEX); created.push('index.md'); }
  created.push(...bind(where).written);
  return { wiki: dir, created };
}

// The parts of a Forge folder next to its wiki: raw/, archive/, the launcher, and the path of the plugin.
function furnish(home, pluginDir) {
  const created = [];
  for (const name of ['raw', 'archive']) {
    if (!existsSync(path.join(home, name))) { mkdirSync(path.join(home, name), { recursive: true }); created.push(`../${name}/`); }
  }
  created.push(...writeLauncher(home).map((name) => `../${name}`));
  if (pluginDir && writePointer(home, pluginDir)) created.push(`../${POINTER_FILE}`);
  return created;
}

/** Writes <wiki>/forge/repo.json. Refuses to rebind a wiki of another remote. A `profile` key of an older file is dropped. */
export function bind(where) {
  const dir = where.wiki.path;
  if (!existsSync(dir)) throw new ForgeError(`The wiki ${dir} does not exist. Run init first.`, 'no-wiki');
  const old = readBinding(dir);
  const oldRemote = normalizeRemote(old?.repo?.remote);
  if (oldRemote && where.repo.remote && oldRemote !== where.repo.remote) {
    throw new ForgeError(`${dir} is bound to ${oldRemote}. forge does not rebind it to ${where.repo.remote}.`, 'wiki-mismatch');
  }
  const next = { schemaVersion: 1, repo: { path: where.repo.path, remote: where.repo.remote } };
  if (old && JSON.stringify(old) === JSON.stringify(next)) return { written: [] };
  mkdirSync(path.join(dir, 'forge'), { recursive: true });
  writeFileSync(path.join(dir, 'forge', 'repo.json'), `${JSON.stringify(next, null, 2)}\n`);
  return { written: ['forge/repo.json'] };
}

/**
 * Copies the config templates to <wiki>/forge/config. Existing files stay unless force.
 * policy.md is copied only when missing. The rule pages go to <wiki>/rules only when that folder is missing.
 */
export function seed(where, templatesDir, { force = false } = {}) {
  const dir = path.join(where.wiki.path, 'forge', 'config');
  mkdirSync(dir, { recursive: true });
  const written = [];
  const kept = [];
  const plan = [...CONFIG_FILES.map((name) => [name, force]), ['policy.md', false]];
  for (const [name, overwrite] of plan) {
    const target = path.join(dir, name);
    if (existsSync(target) && !overwrite) { kept.push(name); continue; }
    copyFileSync(path.join(templatesDir, name), target);
    written.push(name);
  }
  const rulesDir = path.join(where.wiki.path, 'rules');
  const rulesWritten = [];
  if (!existsSync(rulesDir)) {
    const today = new Date().toISOString().slice(0, 10);
    mkdirSync(rulesDir, { recursive: true });
    for (const rule of readdirSync(path.join(templatesDir, '..', 'rules')).filter((n) => n.endsWith('.md')).sort()) {
      writeFileSync(path.join(rulesDir, rule), readFileSync(path.join(templatesDir, '..', 'rules', rule), 'utf8').replace(/^updated: .*$/m, `updated: ${today}`));
      rulesWritten.push(rule);
    }
  }
  return { configDir: dir, written, kept, rules: { dir: rulesDir, written: rulesWritten } };
}
