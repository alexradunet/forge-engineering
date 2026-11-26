// Setup helpers for the forge-setup skill: detect tools, create or bind the
// wiki, and seed the forge config from the profile templates. Read-only except
// initWiki, bind, and seed, which write only inside the wiki folder.
import { spawnSync } from 'node:child_process';
import { copyFileSync, existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { POINTER_FILE, writeLauncher, writePointer } from './launcher.mjs';
import { homeOf, isForgeLayout } from './layout.mjs';
import { ForgeError, normalizeRemote, readBinding } from './repo.mjs';
import { listProfiles, loadProfile, pluginRoot, profileFile } from './profile.mjs';

// The profile templates of <plugin>/templates/config: the tracker, the repository host, and the CI.
export const CONFIG_FILES = ['tracker.md', 'repo.md', 'ci.md'];

// The CLIs that a profile can name in "tools". auth: null means the tool has no login to check. login: the command that the user runs to log in.
// A tool with authOk is logged in when authOk(stdout) is true and the auth command exits 0. Without authOk, the exit status is enough.
export const TOOLS = {
  gh: { auth: ['auth', 'status'], login: 'gh auth login', install: { win32: 'winget install --id GitHub.cli', darwin: 'brew install gh', linux: 'see https://github.com/cli/cli/blob/trunk/docs/install_linux.md' } },
  az: { auth: ['account', 'show', '--output', 'none'], login: 'az login', install: { win32: 'winget install --id Microsoft.AzureCLI', darwin: 'brew install azure-cli', linux: 'see https://learn.microsoft.com/cli/azure/install-azure-cli-linux' } },
  sqlcmd: { auth: null, login: null, install: { win32: 'winget install --id Microsoft.Sqlcmd', darwin: 'brew install sqlcmd', linux: 'see https://learn.microsoft.com/sql/tools/sqlcmd/sqlcmd-utility' } },
  tea: { auth: ['logins', 'list', '--output', 'json'], authOk: isLogin, login: 'tea login add', install: { win32: 'winget install --id gitea.tea', darwin: 'brew install tea', linux: 'see https://gitea.com/gitea/tea' } },
};

// The output of "tea logins list --output json": a JSON array with at least one login.
function isLogin(stdout) {
  try { const list = JSON.parse(stdout); return Array.isArray(list) && list.length > 0; } catch { return false; }
}

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
 * The values that differ for each user: the base branch, the branch pattern, the main checkout, and the host of a remote that is not GitHub.
 * A null value means "ask the user". The profile templates give the rest.
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
  // The host of a remote that is not GitHub: a profile with a server of its own needs it for the host keys of its config.
  return kind === 'other' ? { repo, checkouts, host: new URL(remote).hostname } : { repo, checkouts };
}

/** True when the auth command exited 0 and the tool accepts its output. */
export function loggedIn(tool, result) {
  return result.ok && (!tool.authOk || tool.authOk(result.stdout));
}

// The extra profile whose "detect" rule matches: it runs the tool with the args, and the output holds the host of the remote. Else null.
function suggestProfile(remote, kind, plugin, probe) {
  if (!remote || kind === 'github') return null;
  const host = new URL(remote).hostname;
  for (const name of listProfiles(plugin)) {
    const rule = loadProfile(plugin, name).detect;
    if (!rule?.tool) continue;
    const r = probe(rule.tool, rule.args ?? []);
    if (r.ok && (!rule.remoteHost || r.stdout.toLowerCase().includes(host.toLowerCase()))) return name;
  }
  return null;
}

/** Detects the host, the CLIs and their login, the repo visibility, and the wiki state. */
export function detect(where, { platform = process.platform, probe = run, git = (args, cwd) => run('git', args, cwd), plugin = pluginRoot, profile = loadProfile(plugin, where.profile ?? null) } = {}) {
  const kind = hostKind(where.repo.remote);
  const tools = {};
  for (const name of profile.tools) {
    const t = TOOLS[name];
    if (!t) throw new ForgeError(`${profile.dir ?? 'templates'}/profile.json: "tools" has "${name}". Use one of: ${Object.keys(TOOLS).join(', ')}.`, 'bad-config');
    const v = probe(name, ['--version']);
    const installed = v.ok;
    const auth = t.auth === null ? null : installed ? loggedIn(t, probe(name, t.auth)) : false;
    tools[name] = { installed, auth, install: installed ? null : t.install[platform] ?? t.install.linux };
  }

  let visibility = null;
  let wikiEnabled = null;
  const slug = where.repo.remote ? new URL(where.repo.remote).pathname.replace(/^\//, '') : null;
  if (kind === 'github' && tools.gh?.auth && slug) {
    const r = probe('gh', ['repo', 'view', slug, '--json', 'visibility,hasWikiEnabled']);
    if (r.ok) {
      try { const j = JSON.parse(r.stdout); visibility = j.visibility?.toLowerCase() ?? null; wikiEnabled = j.hasWikiEnabled ?? null; } catch { /* unknown */ }
    }
  }

  const wikiDir = where.wiki.path;
  const wikiGit = existsSync(path.join(wikiDir, '.git'));
  const wikiRemote = wikiGit ? normalizeRemote(run('git', ['remote', 'get-url', 'origin'], wikiDir).stdout) : null;
  const configDir = path.join(wikiDir, 'forge', 'config');
  const config = existsSync(configDir) ? readdirSync(configDir).filter((f) => f.endsWith('.md')) : [];

  let wikiRemoteSuggestion = wikiRemote ? { type: 'existing', url: wikiRemote } : null;
  if (!wikiRemote && where.repo.remote && kind === 'github') {
    wikiRemoteSuggestion = wikiEnabled !== false && (visibility === 'private' || visibility === 'internal')
      ? { type: 'native', url: `${where.repo.remote}.wiki.git` }
      : {
        type: 'ask',
        options: [...(wikiEnabled === false ? [] : ['native']), 'separate-private-repo', 'local-only'],
        native: `${where.repo.remote}.wiki.git`,
        separate: `${where.repo.remote}-wiki`,
      };
  }

  const g = gitInfo(where.repo.path, git);
  const hints = keyHints([...g.branches, ...g.subjects]);
  // Only local branches: origin holds the branches of all users, and each user has a personal pattern.
  const branchPattern = branchPatternHint(g.local, hints[0]?.prefix);

  const profiles = {
    bound: where.profile ?? null,
    available: listProfiles(plugin),
    suggested: where.profile ? null : suggestProfile(where.repo.remote, kind, plugin, probe),
    file: profileFile(plugin, where.profile ?? null, 'profile.md'),
  };

  return {
    profile: profiles,
    repo: { ...where.repo, host: kind, visibility, wikiEnabled, defaultBranch: g.defaultBranch, keyHints: hints, branchPattern },
    tools,
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

/** Writes <wiki>/forge/repo.json. Refuses to rebind a wiki of another remote or of another profile. No profile option keeps the recorded profile. */
export function bind(where, { profile } = {}) {
  const dir = where.wiki.path;
  if (!existsSync(dir)) throw new ForgeError(`The wiki ${dir} does not exist. Run init first.`, 'no-wiki');
  const old = readBinding(dir);
  const oldRemote = normalizeRemote(old?.repo?.remote);
  if (oldRemote && where.repo.remote && oldRemote !== where.repo.remote) {
    throw new ForgeError(`${dir} is bound to ${oldRemote}. forge does not rebind it to ${where.repo.remote}.`, 'wiki-mismatch');
  }
  if (profile && old?.profile && old.profile !== profile) {
    throw new ForgeError(`${dir} has the profile ${old.profile}. forge does not change it to ${profile}.`, 'profile-mismatch');
  }
  const next = { schemaVersion: 1, repo: { path: where.repo.path, remote: where.repo.remote } };
  const name = profile ?? old?.profile;
  if (name) next.profile = name;
  if (old && JSON.stringify(old) === JSON.stringify(next)) return { written: [] };
  mkdirSync(path.join(dir, 'forge'), { recursive: true });
  writeFileSync(path.join(dir, 'forge', 'repo.json'), `${JSON.stringify(next, null, 2)}\n`);
  return { written: ['forge/repo.json'] };
}

/**
 * Copies the profile templates to <wiki>/forge/config. Existing files stay unless force.
 * policy.md is copied only when missing. The rule pages go to <wiki>/rules only when that folder is missing.
 * The profile is the one of the wiki, or the "profile" option, which bind records. A file that the profile does not have comes from the default profile.
 */
export function seed(where, templatesDir, { force = false, profile } = {}) {
  const plugin = path.resolve(templatesDir, '..', '..');
  if (profile) { loadProfile(plugin, profile); bind(where, { profile }); }
  const name = profile ?? readBinding(where.wiki.path)?.profile ?? null;
  if (name) loadProfile(plugin, name);
  const config = (file) => (name ? profileFile(plugin, name, `config/${file}`) : path.join(templatesDir, file));
  const dir = path.join(where.wiki.path, 'forge', 'config');
  mkdirSync(dir, { recursive: true });
  const written = [];
  const kept = [];
  const plan = [...CONFIG_FILES.map((name) => [name, force]), ['policy.md', false]];
  for (const [name, overwrite] of plan) {
    const target = path.join(dir, name);
    if (existsSync(target) && !overwrite) { kept.push(name); continue; }
    copyFileSync(config(name), target);
    written.push(name);
  }
  const rulesDir = path.join(where.wiki.path, 'rules');
  const rulesWritten = [];
  if (!existsSync(rulesDir)) {
    const names = new Set(readdirSync(path.join(templatesDir, '..', 'rules')));
    if (name && existsSync(path.join(plugin, 'profiles', name, 'rules'))) readdirSync(path.join(plugin, 'profiles', name, 'rules')).forEach((n) => names.add(n));
    const today = new Date().toISOString().slice(0, 10);
    mkdirSync(rulesDir, { recursive: true });
    for (const rule of [...names].filter((n) => n.endsWith('.md')).sort()) {
      const source = name ? profileFile(plugin, name, `rules/${rule}`) : path.join(templatesDir, '..', 'rules', rule);
      writeFileSync(path.join(rulesDir, rule), readFileSync(source, 'utf8').replace(/^updated: .*$/m, `updated: ${today}`));
      rulesWritten.push(rule);
    }
  }
  return { profile: name, configDir: dir, written, kept, rules: { dir: rulesDir, written: rulesWritten } };
}
