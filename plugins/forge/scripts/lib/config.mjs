// Reads the team config: tracker.md, repo.md, ci.md, and policy.md in
// <wiki>/forge/config. Flat frontmatter "key: value" with inline lists [a, b],
// plus the Queries table of tracker.md and the Checkouts table of repo.md.
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { ForgeError } from './repo.mjs';

export const KINDS = ['tracker', 'repo', 'ci', 'policy'];
const DAYS = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];

export function parseScalar(text) {
  const v = text.trim();
  if (v === '' || v === 'null' || v === '~') return null;
  let m = /^"(.*)"$/.exec(v) ?? /^'(.*)'$/.exec(v);
  if (m) return m[1];
  if (v === 'true') return true;
  if (v === 'false') return false;
  if (/^-?\d+$/.test(v)) return Number.parseInt(v, 10);
  m = /^\[(.*)\]$/.exec(v);
  if (m) {
    const inner = m[1].trim();
    return inner ? inner.split(',').map(parseScalar) : [];
  }
  return v;
}

export function parseFile(text, file = 'config') {
  const src = text.replace(/^\uFEFF/, '').replace(/\r\n/g, '\n');
  const data = {};
  let body = src;
  const fm = /^---\n([\s\S]*?)\n---(\n|$)/.exec(src);
  if (fm) {
    body = src.slice(fm[0].length);
    for (const line of fm[1].split('\n')) {
      if (/^\s*(#|$)/.test(line)) continue;
      const kv = /^([A-Za-z][A-Za-z0-9_-]*):(.*)$/.exec(line);
      if (!kv) throw new ForgeError(`${file}: the frontmatter line "${line}" is not "key: value". forge config uses flat keys only.`, 'bad-config');
      data[kv[1]] = parseScalar(kv[2]);
    }
  }
  return { data, body };
}

function splitRow(line) {
  return line.trim().replace(/^\||\|$/g, '').split(/(?<!\\)\|/).map((c) => c.trim().replace(/\\\|/g, '|').replace(/^`(.*)`$/, '$1'));
}

// Rows of the first Markdown table under the heading that contains title.
export function parseTable(body, title) {
  const rows = [];
  let inSection = false;
  let header = null;
  for (const line of body.split('\n')) {
    if (/^#{1,6}\s/.test(line)) {
      if (inSection && header) break;
      inSection = line.includes(title);
      continue;
    }
    if (!inSection || !/^\s*\|/.test(line)) {
      if (header) break;
      continue;
    }
    const cells = splitRow(line);
    if (!header) { header = cells.map((h) => h.toLowerCase().replace('basebranch', 'baseBranch')); continue; }
    if (/^:?-+:?$/.test(cells[0])) continue;
    const row = {};
    header.forEach((h, i) => { row[h] = cells[i] ? cells[i] : null; });
    rows.push(row);
  }
  return rows;
}

export function defaults() {
  return {
    tracker: { provider: 'other', queries: {} },
    repo: { provider: 'other', branchPattern: '{KEY}-{slug}', baseBranch: 'main', checkouts: [] },
    ci: { provider: 'other' },
    policy: { noMergeWeekdays: [], evidenceOnDeployedEnv: false, qaHandover: false, adversarialReviewModel: null, maxImplementers: 6 },
  };
}

export function validate(config) {
  const problems = [];
  const { tracker: t, repo: r, policy: p } = config;
  if (t.prefix && !/^[A-Z][A-Z0-9]*$/.test(String(t.prefix))) problems.push('tracker.md: prefix must be upper case, for example APP');
  if (t.itemUrl && !/^https?:\/\/.*\{(KEY|number)\}/.test(String(t.itemUrl))) problems.push('tracker.md: itemUrl must be http(s) and contain {KEY} or {number}');
  if (!r.changeName) r.changeName = r.provider === 'gitlab' ? 'MR' : 'PR';
  if (!['PR', 'MR'].includes(r.changeName)) problems.push('repo.md: changeName must be PR or MR');
  if (!/\{(KEY|key)\}/.test(String(r.branchPattern))) problems.push('repo.md: branchPattern must contain {KEY} or {key}');
  for (const d of [].concat(p.noMergeWeekdays ?? [])) {
    if (!DAYS.includes(d)) problems.push(`policy.md: noMergeWeekdays has "${d}", use a day name such as Thursday`);
  }
  if (!Number.isInteger(p.maxImplementers) || p.maxImplementers < 1) problems.push('policy.md: maxImplementers must be a whole number of 1 or more');
  for (const k of ['evidenceOnDeployedEnv', 'qaHandover']) {
    if (typeof p[k] !== 'boolean') problems.push(`policy.md: ${k} must be true or false`);
  }
  return problems;
}

/** Loads the config folder. Missing files give the defaults. Invalid values throw. */
export function loadConfig(configDir) {
  const config = defaults();
  const files = [];
  for (const kind of KINDS) {
    const file = path.join(configDir, `${kind}.md`);
    if (!existsSync(file)) continue;
    files.push(file);
    const { data, body } = parseFile(readFileSync(file, 'utf8'), file);
    for (const [k, v] of Object.entries(data)) if (v !== null) config[kind][k] = v;
    if (kind === 'tracker') {
      for (const row of parseTable(body, 'Queries')) if (row.name) config.tracker.queries[row.name] = row.query;
    }
    if (kind === 'repo') config.repo.checkouts = parseTable(body, 'Checkouts').filter((row) => row.path);
  }
  const problems = validate(config);
  if (problems.length) throw new ForgeError(`${configDir}: ${problems.join('; ')}`, 'bad-config');
  return { configDir, config, files };
}
