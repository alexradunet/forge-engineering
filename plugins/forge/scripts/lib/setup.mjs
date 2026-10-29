// Setup helpers for the forge-setup skill: detect tools, create or bind the
// wiki, and seed the team config from templates. Read-only except initWiki,
// bind, and seed, which write only inside the wiki folder.
import { spawnSync } from 'node:child_process';
import { copyFileSync, existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { ForgeError, normalizeRemote, readBinding } from './repo.mjs';

export const TEMPLATE_KINDS = {
  tracker: ['github', 'gitlab', 'jira', 'local', 'other'],
  repo: ['github', 'gitlab', 'other'],
  ci: ['github-actions', 'gitlab-ci', 'jenkins', 'azure-pipelines', 'other'],
};

const TOOLS = {
  gh: { auth: ['auth', 'status'], install: { win32: 'winget install --id GitHub.cli', darwin: 'brew install gh', linux: 'see https://github.com/cli/cli/blob/trunk/docs/install_linux.md' } },
  glab: { auth: ['auth', 'status'], install: { win32: 'winget install --id GLab.GLab', darwin: 'brew install glab', linux: 'see https://gitlab.com/gitlab-org/cli#installation' } },
  acli: { auth: ['jira', 'auth', 'status'], install: { win32: 'see https://developer.atlassian.com/cloud/acli/guides/install-windows/', darwin: 'brew tap atlassian/homebrew-acli && brew install acli', linux: 'see https://developer.atlassian.com/cloud/acli/guides/install-linux/' } },
  az: { auth: ['account', 'show', '--output', 'none'], install: { win32: 'winget install --id Microsoft.AzureCLI', darwin: 'brew install azure-cli', linux: 'see https://learn.microsoft.com/cli/azure/install-azure-cli-linux' } },
};

function run(cmd, args, cwd) {
  // Windows .cmd shims (az, acli) need a shell. Arguments are fixed strings, so
  // pass one quoted command line instead of an args array (avoids DEP0190).
  const shell = process.platform === 'win32' && !/\.exe$/i.test(cmd) && cmd !== 'git';
  const opts = { cwd, encoding: 'utf8', timeout: 20000, windowsHide: true, shell };
  const r = shell
    ? spawnSync([cmd, ...args].map((a) => (/^[\w.\-\/:=,]+$/.test(a) ? a : `"${a.replace(/"/g, '\\"')}"`)).join(' '), opts)
    : spawnSync(cmd, args, opts);
  if (r.error) return { ok: false, missing: r.error.code === 'ENOENT', stdout: '', code: null };
  return { ok: r.status === 0, missing: r.status === 9009 || /not recognized|not found/i.test(r.stderr ?? ''), stdout: (r.stdout ?? '').trim(), code: r.status };
}

/** github, gitlab, or other, from a normalized remote URL. */
export function hostKind(remote) {
  if (!remote) return 'none';
  const host = new URL(remote).hostname;
  if (host === 'github.com' || host.endsWith('.ghe.com') || /(^|\.)github\./.test(host)) return 'github';
  if (host === 'gitlab.com' || /(^|\.)gitlab\./.test(host)) return 'gitlab';
  return 'other';
}

const CI_FILES = [
  ['github-actions', '.github/workflows', (d) => readdirSync(d).some((f) => /\.ya?ml$/i.test(f))],
  ['gitlab-ci', '.gitlab-ci.yml'],
  ['jenkins', 'Jenkinsfile'],
  ['azure-pipelines', 'azure-pipelines.yml'],
  ['azure-pipelines', 'azure-pipelines.yaml'],
];

// Upper-case words that look like keys but are standards or encodings.
const NOT_KEYS = new Set(['UTF', 'SHA', 'ISO', 'RFC', 'CVE', 'HTTP', 'TLS', 'SSL', 'PEP', 'ES', 'MD', 'AES', 'RSA', 'X', 'WIP', 'V']);
const KEY_RE = /(?<![A-Za-z0-9])([A-Z][A-Z0-9]{1,9})-(\d+)(?![A-Za-z0-9])/g;

/** CI config files in the checkout, as [{ ci, file }]. */
export function findCiFiles(dir) {
  const found = [];
  for (const [ci, rel, test] of CI_FILES) {
    const p = path.join(dir ?? '', rel);
    try {
      if (dir && existsSync(p) && (!test || test(p))) found.push({ ci, file: rel });
    } catch { /* unreadable */ }
  }
  return found;
}

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
  if (!dir) return { defaultBranch: null, branches: [], subjects: [] };
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
  return { defaultBranch, branches, subjects };
}

function slugOf(remote) {
  try { return new URL(remote).pathname.replace(/^\//, '').replace(/\.git$/, '') || null; } catch { return null; }
}

/** A key prefix from the repository name, for example forge-engineering gives FORGE. */
function prefixFromName(name) {
  const word = String(name ?? '').toUpperCase().split(/[^A-Z0-9]+/).find((w) => /^[A-Z]/.test(w));
  return word ? word.slice(0, 10) : null;
}

/**
 * Frontmatter values and table rows for a choice of tracker, repo, and CI.
 * A null value means "ask the user". Templates give the rest.
 */
export function suggestValues(info, choice) {
  const { remote, path: repoPath, defaultBranch, keyHints: hints = [], branchPattern } = info;
  const kind = hostKind(remote);
  const host = remote ? new URL(remote).host : null;
  const slug = slugOf(remote);
  const hinted = hints[0]?.count >= 3 ? hints[0].prefix : null;
  const prefix = hinted ?? prefixFromName(slug?.split('/').pop() ?? path.basename(repoPath ?? ''));
  const tracker = { prefix };
  if (choice.tracker === 'github' || choice.tracker === 'gitlab') {
    const same = choice.tracker === kind;
    Object.assign(tracker, {
      host: same ? host : null,
      project: same ? slug : null,
      itemUrl: same ? `${remote}${choice.tracker === 'gitlab' ? '/-' : ''}/issues/{number}` : null,
    });
  } else if (choice.tracker === 'jira') {
    Object.assign(tracker, { prefix: hinted, project: hinted, host: null, itemUrl: null });
  } else if (choice.tracker === 'local') {
    tracker.prefix = hinted ?? 'ITEM';
  }
  const repo = {
    changeName: choice.repo === 'gitlab' ? 'MR' : 'PR',
    baseBranch: defaultBranch ?? 'main',
    branchPattern: branchPattern ?? '{KEY}-{slug}',
  };
  if (choice.repo === 'github' || choice.repo === 'gitlab') repo.host = choice.repo === kind ? host : null;
  const ci = {};
  if (choice.ci === 'jenkins') ci.host = null;
  if (choice.ci === 'azure-pipelines') {
    const m = host === 'dev.azure.com' ? /^([^/]+)\/([^/]+)/.exec(slug ?? '') : null;
    Object.assign(ci, { host: m ? `https://dev.azure.com/${m[1]}` : null, project: m ? decodeURIComponent(m[2]) : null });
  }
  const checkouts = repoPath ? [{
    name: path.basename(repoPath),
    path: repoPath,
    remote: kind === 'github' || kind === 'gitlab' ? slug : remote,
    baseBranch: '',
  }] : [];
  return { tracker, repo, ci, checkouts };
}

/** Detects the host, the CLIs and their login, the repo visibility, and the wiki state. */
export function detect(where, { platform = process.platform, probe = run, git = (args, cwd) => run('git', args, cwd), choice = {} } = {}) {
  const kind = hostKind(where.repo.remote);
  const tools = {};
  for (const [name, t] of Object.entries(TOOLS)) {
    const v = probe(name, ['--version']);
    const installed = v.ok;
    const auth = installed ? probe(name, t.auth).ok : false;
    tools[name] = { installed, auth, install: installed ? null : t.install[platform] ?? t.install.linux };
  }

  let visibility = null;
  let wikiEnabled = null;
  const slug = where.repo.remote ? new URL(where.repo.remote).pathname.replace(/^\//, '') : null;
  if (kind === 'github' && tools.gh.auth && slug) {
    const r = probe('gh', ['repo', 'view', slug, '--json', 'visibility,hasWikiEnabled']);
    if (r.ok) {
      try { const j = JSON.parse(r.stdout); visibility = j.visibility?.toLowerCase() ?? null; wikiEnabled = j.hasWikiEnabled ?? null; } catch { /* unknown */ }
    }
  } else if (kind === 'gitlab' && tools.glab.auth && slug) {
    const r = probe('glab', ['repo', 'view', slug, '--output', 'json']);
    if (r.ok) {
      try { const j = JSON.parse(r.stdout); visibility = j.visibility ?? null; wikiEnabled = j.wiki_enabled ?? null; } catch { /* unknown */ }
    }
  }

  const wikiDir = where.wiki.path;
  const wikiGit = existsSync(path.join(wikiDir, '.git'));
  const wikiRemote = wikiGit ? normalizeRemote(run('git', ['remote', 'get-url', 'origin'], wikiDir).stdout) : null;
  const configDir = path.join(wikiDir, 'forge', 'config');
  const config = existsSync(configDir) ? readdirSync(configDir).filter((f) => f.endsWith('.md')) : [];

  let wikiRemoteSuggestion = null;
  if (where.repo.remote && kind !== 'other') {
    wikiRemoteSuggestion = wikiRemote
      ? { type: 'existing', url: wikiRemote }
      : wikiEnabled !== false && (visibility === 'private' || visibility === 'internal')
      ? { type: 'native', url: `${where.repo.remote}.wiki.git` }
      : {
        type: 'ask',
        options: [...(wikiEnabled === false ? [] : ['native']), 'separate-private-repo', 'local-only'],
        native: `${where.repo.remote}.wiki.git`,
        separate: `${where.repo.remote}-wiki`,
      };
  }

  const g = gitInfo(where.repo.path, git);
  const ciFiles = findCiFiles(where.repo.path);
  const hints = keyHints([...g.branches, ...g.subjects]);
  const branchPattern = branchPatternHint(g.branches, hints[0]?.prefix);
  const suggested = {
    tracker: kind === 'github' ? 'github' : kind === 'gitlab' ? 'gitlab' : 'local',
    repo: kind === 'github' || kind === 'gitlab' ? kind : 'other',
    ci: ciFiles[0]?.ci ?? (kind === 'github' ? 'github-actions' : kind === 'gitlab' ? 'gitlab-ci' : 'other'),
  };
  const picked = { ...suggested, ...Object.fromEntries(Object.entries(choice).filter(([, v]) => v)) };

  return {
    repo: { ...where.repo, host: kind, visibility, wikiEnabled, defaultBranch: g.defaultBranch, ciFiles, keyHints: hints, branchPattern },
    tools,
    wiki: { path: wikiDir, exists: where.wiki.exists, git: wikiGit, remote: wikiRemote, bound: where.wiki.bound, config },
    suggestion: {
      ...suggested,
      wikiRemote: wikiRemoteSuggestion,
      values: suggestValues({ remote: where.repo.remote, path: where.repo.path, defaultBranch: g.defaultBranch, keyHints: hints, branchPattern }, picked),
      valuesFor: picked,
    },
  };
}

const GITIGNORE = 'raw/\narchive/\n';
const INDEX = '---\ntitle: Wiki index\ntype: index\n---\n# Wiki index\n\nOne line per page. The `wiki` skill keeps this list.\n';

/** Creates the wiki folder (git init, .gitignore, index.md) when it does not exist, and binds it. */
export function initWiki(where) {
  const dir = where.wiki.path;
  const created = [];
  if (!existsSync(dir)) { mkdirSync(dir, { recursive: true }); created.push(dir); }
  if (!existsSync(path.join(dir, '.git'))) {
    const r = spawnSync('git', ['init', '-q', '-b', 'main'], { cwd: dir, encoding: 'utf8' });
    if (r.status !== 0) throw new ForgeError(`git init failed in ${dir}: ${r.stderr}`, 'init-failed');
    created.push('.git');
  }
  const gi = path.join(dir, '.gitignore');
  const current = existsSync(gi) ? readFileSync(gi, 'utf8') : '';
  const missing = GITIGNORE.split('\n').filter((l) => l && !current.split(/\r?\n/).includes(l));
  if (missing.length) {
    writeFileSync(gi, current + (current && !current.endsWith('\n') ? '\n' : '') + missing.join('\n') + '\n');
    created.push('.gitignore');
  }
  const index = path.join(dir, 'index.md');
  if (!existsSync(index)) { writeFileSync(index, INDEX); created.push('index.md'); }
  created.push(...bind(where).written);
  return { wiki: dir, created };
}

/** Writes <wiki>/forge/repo.json. Refuses to rebind a wiki of another remote. */
export function bind(where) {
  const dir = where.wiki.path;
  if (!existsSync(dir)) throw new ForgeError(`The wiki ${dir} does not exist. Run init-wiki first.`, 'no-wiki');
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
 * Copies templates to <wiki>/forge/config. Existing files stay unless force.
 * policy.md is copied only when missing.
 */
export function seed(where, choice, templatesDir, { force = false } = {}) {
  const dir = path.join(where.wiki.path, 'forge', 'config');
  mkdirSync(dir, { recursive: true });
  const written = [];
  const kept = [];
  const plan = [];
  for (const [kind, options] of Object.entries(TEMPLATE_KINDS)) {
    const value = choice[kind];
    if (!value) continue;
    if (!options.includes(value)) throw new ForgeError(`Unknown ${kind} "${value}". Use one of: ${options.join(', ')}.`, 'bad-choice');
    plan.push([`${kind}-${value}.md`, `${kind}.md`, force]);
  }
  plan.push(['policy.md', 'policy.md', false]);
  for (const [src, dest, overwrite] of plan) {
    const target = path.join(dir, dest);
    if (existsSync(target) && !overwrite) { kept.push(dest); continue; }
    copyFileSync(path.join(templatesDir, src), target);
    written.push(dest);
  }
  return { configDir: dir, written, kept };
}
