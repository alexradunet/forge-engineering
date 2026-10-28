import { readFileSync, readdirSync, statSync, existsSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import { splitFrontmatter, validate, docTypeFor, toDay, STATES } from './frontmatter.mjs';
import { itemUrlFor } from './config.mjs';

const read = (p) => (existsSync(p) ? readFileSync(p, 'utf8') : null);

/** Ticket folder names are lower-case keys, for example app-123 or app2-45. */
export const isTicketDir = (name) => /^[a-z][a-z0-9]*-\d+$/i.test(name);

/** "#7" for a pull request URL, "!9" for a GitLab merge request URL. */
export function changeLabel(url) {
  const m = /\/(pull|pullrequest|merge_requests)\/(\d+)/.exec(url);
  if (!m) return url;
  return (m[1] === 'merge_requests' ? '!' : '#') + m[2];
}

/** UI words from the config: the tracker name and PR or MR. */
export function labelsOf(config) {
  return { item: config?.itemLabel ?? 'Work item', change: config?.changeName ?? 'PR' };
}

/** All Markdown files of a ticket folder, relative with forward slashes (legacy reviews\ skipped). */
export function listDocs(dir) {
  const out = [];
  const walk = (d) => {
    for (const e of readdirSync(d, { withFileTypes: true })) {
      const full = join(d, e.name);
      const rel = relative(dir, full).split(sep).join('/');
      if (e.isDirectory()) {
        if (rel === 'reviews') continue;
        walk(full);
      } else if (e.name.toLowerCase().endsWith('.md')) out.push(rel);
    }
  };
  walk(dir);
  return out.sort();
}

/** Last dated entries of log.md ("## yyyy-mm-dd ..."), newest first. */
export function parseLog(text, max = 6) {
  if (!text) return [];
  const { body } = splitFrontmatter(text);
  const entries = [];
  const re = /^##\s+(\d{4}-\d{2}-\d{2}[^\n]*)\n([\s\S]*?)(?=^##\s|(?![\s\S]))/gm;
  let m;
  while ((m = re.exec(body))) entries.push({ title: m[1].trim(), body: m[2].trim() });
  return entries.slice(-max).reverse();
}

function newestMtime(dir) {
  let t = 0;
  for (const f of listDocs(dir)) t = Math.max(t, statSync(join(dir, f)).mtimeMs);
  return t;
}

function waitsOnMe(fm) {
  if (fm.state === 'needs-me') return true;
  if ((fm.gates ?? []).some((g) => g?.status === 'in-review')) return true;
  return /^\s*you\b/i.test(fm.waiting_on ?? '');
}

/**
 * Loads one ticket folder. Returns null when the folder has no README.md.
 * `summary` is what the board needs; `docs` lists every document with its frontmatter.
 */
export function loadTicket(dir, folder, config = null) {
  const readme = read(join(dir, 'README.md'));
  if (readme === null) return null;
  const { data, error } = splitFrontmatter(readme);
  const fm = data ?? {};
  const key = typeof fm.key === 'string' ? fm.key : folder.toUpperCase();
  const problems = [];
  if (error) problems.push({ file: 'README.md', problem: error });
  else for (const p of validate('ticket', data, key)) problems.push({ file: 'README.md', problem: p });

  const docs = [];
  for (const rel of listDocs(dir)) {
    const type = docTypeFor(rel);
    const text = rel === 'README.md' ? readme : read(join(dir, rel));
    const split = rel === 'README.md' ? { data, error } : splitFrontmatter(text);
    const d = split.data ?? {};
    const title = (/^#\s+(.+)$/m.exec(split.body ?? '') ?? [])[1]?.trim() ?? rel;
    docs.push({
      file: rel,
      type: d.type ?? type,
      title,
      gate: d.gate ?? null,
      status: d.status ?? null,
      updated: toDay(d.updated) || null,
      hasFrontmatter: !!split.data,
    });
    if (rel === 'README.md') continue;
    if (split.error) problems.push({ file: rel, problem: split.error });
    else if (type) for (const p of validate(type, split.data, key)) problems.push({ file: rel, problem: p });
  }

  let briefing = null;
  const bj = read(join(dir, 'briefing.json'));
  if (bj !== null) {
    try { briefing = JSON.parse(bj); } catch (e) { problems.push({ file: 'briefing.json', problem: `invalid JSON: ${e.message}` }); }
  }

  const gates = (Array.isArray(fm.gates) ? fm.gates : []).filter((g) => g && typeof g === 'object').map((g) => ({
    name: String(g.name ?? ''),
    doc: g.doc ?? null,
    need: g.need ?? 'required',
    status: g.status ?? 'todo',
    date: toDay(g.date) || null,
    hash: g.hash ? String(g.hash) : null,
    note: g.note ? String(g.note) : null,
  }));

  return {
    folder,
    dir,
    key,
    title: fm.title ?? '',
    item: fm.item ?? itemUrlFor(key, config),
    labels: labelsOf(config),
    track: fm.track ?? null,
    phase: fm.phase ?? 'start',
    state: fm.state ?? null,
    stateEmoji: STATES[fm.state] ?? '',
    next: fm.next ?? '',
    waitingOn: fm.waiting_on ?? '',
    branch: fm.branch ?? '',
    worktree: fm.worktree ?? '',
    changes: (Array.isArray(fm.changes) ? fm.changes : []).filter((p) => p && p.url).map((p) => ({
      url: p.url, label: p.label ?? changeLabel(p.url), state: p.state ?? 'open',
    })),
    gates,
    waitsOnMe: waitsOnMe({ ...fm, gates }),
    updatedMs: newestMtime(dir),
    log: parseLog(read(join(dir, 'log.md'))),
    docs,
    hasBriefing: briefing !== null,
    briefing,
    problems,
  };
}

/** Closed tickets: canonical pages <wiki>\tickets\<key>.md, newest first. */
export function loadClosed(wikiRoot, max = 10) {
  const dir = join(wikiRoot, 'tickets');
  if (!existsSync(dir)) return [];
  return readdirSync(dir)
    .filter((f) => /^[a-z][a-z0-9]*-\d+\.md$/i.test(f))
    .map((f) => {
      const { data, body } = splitFrontmatter(readFileSync(join(dir, f), 'utf8'));
      const key = f.replace(/\.md$/i, '').toUpperCase();
      const heading = (/^#\s+(.+)$/m.exec(body) ?? [])[1] ?? '';
      const title = String(data?.title ?? heading).replace(new RegExp(`^${key}\\s*[—-]\\s*`), '');
      return { key, title, updated: toDay(data?.updated) || '', file: join(dir, f) };
    })
    .sort((a, b) => b.updated.localeCompare(a.updated))
    .slice(0, max);
}

/** Every active ticket in <wiki>\raw\tickets. */
export function loadAll(wikiRoot, config = null) {
  const root = join(wikiRoot, 'raw', 'tickets');
  if (!existsSync(root)) throw new Error(`Missing ${root}`);
  return readdirSync(root, { withFileTypes: true })
    .filter((e) => e.isDirectory() && isTicketDir(e.name))
    .map((e) => loadTicket(join(root, e.name), e.name, config))
    .filter(Boolean);
}

/** Board payload: compact ticket cards and closed tickets. */
export function boardSummary(wikiRoot, config = null) {
  const tickets = loadAll(wikiRoot, config).map(({ docs, briefing, log, dir, ...t }) => ({
    ...t,
    lastLog: log[0] ?? null,
    problemCount: t.problems.length,
    problems: undefined,
  }));
  const closed = loadClosed(wikiRoot, Infinity);
  return { tickets, closed: closed.slice(0, 10), closedTotal: closed.length, labels: labelsOf(config) };
}
