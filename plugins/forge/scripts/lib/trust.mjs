// Trust store: SHA-256 approvals of the files under <wiki>/forge. The approvals
// live in the user data folder, outside the wiki, so a pull or a pack update
// cannot approve itself. forge fails closed on a new or changed file.
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { dataDir } from './cred.mjs';
import { ForgeError } from './repo.mjs';

const SKIP = new Set(['.base', 'repo.json', 'pack.lock.json', '.git']);

export const sha256 = (buf) => createHash('sha256').update(buf).digest('hex');

export function forgeDir(where) {
  return path.join(where.wiki.path, 'forge');
}

export function repoId(where) {
  const key = where.repo.remote ?? (process.platform === 'win32' ? where.repo.path.toLowerCase() : where.repo.path);
  return sha256(key).slice(0, 16);
}

export function trustFile(where, env = process.env) {
  return path.join(dataDir(env), 'trust', `${repoId(where)}.json`);
}

export function listFiles(dir, rel = '') {
  if (!existsSync(dir)) return [];
  const out = [];
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    if (!rel && SKIP.has(e.name)) continue;
    const r = rel ? `${rel}/${e.name}` : e.name;
    if (e.isDirectory()) out.push(...listFiles(path.join(dir, e.name), r));
    else if (e.isFile()) out.push(r);
  }
  return out.sort();
}

function readApproved(file) {
  if (!existsSync(file)) return {};
  try { return JSON.parse(readFileSync(file, 'utf8')).files ?? {}; } catch { throw new ForgeError(`Trust file is not valid JSON: ${file}`, 'trust-corrupt'); }
}

export function status(where, { env = process.env } = {}) {
  const file = trustFile(where, env);
  const approved = readApproved(file);
  const dir = forgeDir(where);
  const files = listFiles(dir).map((rel) => {
    const sha = sha256(readFileSync(path.join(dir, rel)));
    return { rel, sha, state: !approved[rel] ? 'new' : approved[rel] === sha ? 'ok' : 'changed' };
  });
  const present = new Set(files.map((f) => f.rel));
  const removed = Object.keys(approved).filter((r) => !present.has(r));
  return { trustFile: file, files, removed, ok: files.every((f) => f.state === 'ok') };
}

// items: ["config/tracker.md=<sha prefix>", ...]. Each prefix must match the
// current content, so the user approves exactly the revision that they saw.
export function approve(where, items, { env = process.env } = {}) {
  if (!items.length) throw new ForgeError('Name each file as <path>=<sha256 prefix> from "forge.mjs trust".', 'bad-args');
  const st = status(where, { env });
  const byRel = new Map(st.files.map((f) => [f.rel, f]));
  const approved = readApproved(st.trustFile);
  for (const r of st.removed) delete approved[r];
  const done = [];
  for (const item of items) {
    const [rel, prefix = ''] = item.split('=');
    const f = byRel.get(rel);
    if (!f) throw new ForgeError(`Not a forge file: ${rel}`, 'bad-args');
    if (prefix.length < 8 || !f.sha.startsWith(prefix.toLowerCase())) throw new ForgeError(`${rel} changed since you saw it, or the hash is shorter than 8 characters. Run "forge.mjs trust" again.`, 'hash-mismatch');
    approved[rel] = f.sha;
    done.push(rel);
  }
  mkdirSync(path.dirname(st.trustFile), { recursive: true });
  const tmp = `${st.trustFile}.${process.pid}.tmp`;
  writeFileSync(tmp, JSON.stringify({ repo: where.repo.remote ?? where.repo.path, files: approved }, null, 2));
  renameSync(tmp, st.trustFile);
  return { approved: done, removed: st.removed };
}

// Throws when a file under one of the prefixes (for example "config/") is new or changed.
export function assertTrusted(where, prefixes, { env = process.env } = {}) {
  const st = status(where, { env });
  const bad = st.files.filter((f) => f.state !== 'ok' && prefixes.some((p) => f.rel.startsWith(p)));
  if (bad.length) {
    const list = bad.map((f) => `${f.rel} (${f.state})`).join(', ');
    throw new ForgeError(`Not approved: ${list}. Review the files, then run "forge.mjs trust" and approve each one.`, 'untrusted');
  }
  return st;
}
