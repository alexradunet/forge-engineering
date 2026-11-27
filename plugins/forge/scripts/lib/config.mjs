// Reads the forge config: repo.md and policy.md in <wiki>/forge/config.
// Flat frontmatter "key: value" with inline lists [a, b], plus the Checkouts table of repo.md.
// Older files (tracker.md, ci.md) are not read: Forge 14 ignores them.
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { ForgeError } from './repo.mjs';

export const KINDS = ['repo', 'policy'];
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
  const fm = /^---\n(?:([\s\S]*?)\n)?---(?:\n|$)/.exec(src);
  if (/^---(?:\n|$)/.test(src) && !fm) {
    throw new ForgeError(`${file}: frontmatter is missing its closing "---" delimiter.`, 'bad-config');
  }
  if (fm) {
    body = src.slice(fm[0].length);
    for (const line of (fm[1] ?? '').split('\n')) {
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
    repo: { changeName: 'PR', branchPattern: '{KEY}-{slug}', baseBranch: 'master', checkouts: [] },
    policy: { noMergeWeekdays: [], evidenceOnDeployedEnv: false, qaHandover: false, adversarialReviewModel: null, maxImplementers: 6, gateGuard: 'deny', planReview: 'off', styleRules: true, scopeComment: false },
  };
}

export function validate(config) {
  const problems = [];
  const { repo: r, policy: p } = config;
  if (!r.changeName) r.changeName = 'PR';
  if (!['PR', 'MR', 'none'].includes(r.changeName)) problems.push('repo.md: changeName must be PR, MR, or none');
  if (!/\{(KEY|key)\}/.test(String(r.branchPattern))) problems.push('repo.md: branchPattern must contain {KEY} or {key}');
  for (const d of [].concat(p.noMergeWeekdays ?? [])) {
    if (!DAYS.includes(d)) problems.push(`policy.md: noMergeWeekdays has "${d}", use a day name such as Thursday`);
  }
  if (!Number.isInteger(p.maxImplementers) || p.maxImplementers < 1) problems.push('policy.md: maxImplementers must be a whole number of 1 or more');
  // `ask` and `off` are read and ignored since 14.1.0 (the guard acts as `deny`, and doctor warns): the guard mode is the environment variable FORGE_GATE_GUARD.
  if (!['deny', 'ask', 'off'].includes(p.gateGuard)) problems.push('policy.md: gateGuard must be deny, ask, or off (only deny acts since 14.1.0)');
  if (!['off', 'attacker', 'panel'].includes(p.planReview)) problems.push('policy.md: planReview must be off, attacker, or panel');
  for (const k of ['evidenceOnDeployedEnv', 'qaHandover', 'styleRules', 'scopeComment']) {
    if (typeof p[k] !== 'boolean') problems.push(`policy.md: ${k} must be true or false`);
  }
  return problems;
}

/**
 * Builds and validates the config from file texts ({ repo: text, ... }).
 * A missing text gives the defaults of that file. Invalid values throw.
 */
export function buildConfig(texts, configDir = 'config') {
  const config = defaults();
  for (const kind of KINDS) {
    const text = texts[kind];
    if (text === undefined || text === null) continue;
    const file = path.join(configDir, `${kind}.md`);
    const { data, body } = parseFile(text, file);
    for (const [k, v] of Object.entries(data)) if (v !== null) config[kind][k] = v;
    if (kind === 'repo') config.repo.checkouts = parseTable(body, 'Checkouts').filter((row) => row.path);
  }
  const problems = validate(config);
  if (problems.length) throw new ForgeError(`${configDir}: ${problems.join('; ')}`, 'bad-config');
  return config;
}

/** Loads the config folder. Missing files give the defaults. Invalid values throw. */
export function loadConfig(configDir) {
  const texts = {};
  const files = [];
  for (const kind of KINDS) {
    const file = path.join(configDir, `${kind}.md`);
    if (!existsSync(file)) continue;
    files.push(file);
    texts[kind] = readFileSync(file, 'utf8');
  }
  return { configDir, config: buildConfig(texts, configDir), files };
}
