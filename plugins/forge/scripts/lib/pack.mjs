// Company packs: a folder or git repository with pack.json, config/, and
// scripts/. "add" installs it into <wiki>/forge; "update" applies a new
// version with a three-way merge against the base copy in <wiki>/forge/.base.
// All outputs are computed first, then written; the lock file is written last.
import { spawnSync } from 'node:child_process';
import { existsSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, renameSync, rmSync, unlinkSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { dataDir } from './cred.mjs';
import { ForgeError } from './repo.mjs';
import { forgeDir, listFiles, sha256 } from './trust.mjs';

const DEFAULT_INCLUDE = ['config', 'scripts'];

export function readPack(dir) {
  const file = path.join(dir, 'pack.json');
  if (!existsSync(file)) throw new ForgeError(`No pack.json in ${dir}.`, 'not-a-pack');
  let pack;
  try { pack = JSON.parse(readFileSync(file, 'utf8')); } catch { throw new ForgeError(`pack.json is not valid JSON: ${file}`, 'not-a-pack'); }
  if (!/^[a-z0-9][a-z0-9-]*$/.test(pack.name ?? '')) throw new ForgeError('pack.json needs a "name" with lowercase letters, digits, and hyphens.', 'not-a-pack');
  const include = pack.include ?? DEFAULT_INCLUDE;
  for (const d of include) {
    if (!/^[a-z0-9][a-z0-9-]*$/.test(d) || ['repo.json', 'pack.lock.json'].includes(d)) throw new ForgeError(`pack.json "include" has a bad folder: ${d}`, 'not-a-pack');
  }
  return { name: pack.name, version: String(pack.version ?? '0'), include };
}

// Refuses symlinks, so that a pack cannot copy files from outside its folder.
export function packFiles(dir, include) {
  const files = include.flatMap((d) => {
    const top = path.join(dir, d);
    if (existsSync(top) && !lstatSync(top).isDirectory()) throw new ForgeError(`Pack folder "${d}" is not a regular folder.`, 'not-a-pack');
    return listFiles(top).map((r) => `${d}/${r}`);
  }).filter((r) => !/(^|\/)(node_modules|\.git)\//.test(r));
  const bad = files.filter((r) => !lstatSync(path.join(dir, r)).isFile());
  if (bad.length) throw new ForgeError(`The pack has symlinks or special files: ${bad.join(', ')}.`, 'not-a-pack');
  return files;
}

export function fetchSource(source, { env = process.env } = {}) {
  if (existsSync(source)) return path.resolve(source);
  if (!/^(https:\/\/|git@|ssh:\/\/)/.test(source)) throw new ForgeError(`Pack source not found: ${source}`, 'bad-source');
  const dest = path.join(dataDir(env), 'packs', sha256(source).slice(0, 16));
  rmSync(dest, { recursive: true, force: true });
  mkdirSync(path.dirname(dest), { recursive: true });
  const r = spawnSync('git', ['clone', '-q', '--depth', '1', source, dest], { encoding: 'utf8' });
  if (r.status !== 0) throw new ForgeError(`git clone failed for ${source}: ${(r.stderr ?? '').trim()}`, 'bad-source');
  return dest;
}

const lockPath = (where) => path.join(forgeDir(where), 'pack.lock.json');

export function readLock(where) {
  const f = lockPath(where);
  return existsSync(f) ? JSON.parse(readFileSync(f, 'utf8')) : null;
}

function mergeFile(local, base, theirs) {
  const tmp = mkdtempSync(path.join(os.tmpdir(), 'forge-merge-'));
  try {
    const [l, b, t] = ['local', 'base', 'pack'].map((n) => path.join(tmp, n));
    writeFileSync(l, local); writeFileSync(b, base); writeFileSync(t, theirs);
    const r = spawnSync('git', ['merge-file', '-p', '-L', 'local', '-L', 'base', '-L', 'pack', l, b, t], { encoding: 'buffer' });
    if (r.status < 0 || r.status === null || r.status > 127) throw new ForgeError(`git merge-file failed: ${r.stderr}`, 'merge-failed');
    return { content: r.stdout, conflicts: r.status };
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
}

function writeAtomic(file, content) {
  mkdirSync(path.dirname(file), { recursive: true });
  const tmp = `${file}.${process.pid}.tmp`;
  writeFileSync(tmp, content);
  renameSync(tmp, file);
}

function apply(where, writes, deletes, lock) {
  const dir = forgeDir(where);
  for (const [rel, content] of writes) writeAtomic(path.join(dir, rel), content);
  for (const rel of deletes) if (existsSync(path.join(dir, rel))) unlinkSync(path.join(dir, rel));
  writeAtomic(lockPath(where), JSON.stringify(lock, null, 2) + '\n');
}

export function add(where, source, { force = false, env = process.env } = {}) {
  const old = readLock(where);
  if (old) throw new ForgeError(`Pack "${old.name}" is already installed. Use "forge.mjs pack update".`, 'pack-exists');
  const src = fetchSource(source, { env });
  const pack = readPack(src);
  const dir = forgeDir(where);
  const writes = [];
  const files = {};
  const conflicts = [];
  for (const rel of packFiles(src, pack.include)) {
    const content = readFileSync(path.join(src, rel));
    const target = path.join(dir, rel);
    if (existsSync(target) && !readFileSync(target).equals(content) && !force) { conflicts.push(rel); continue; }
    writes.push([rel, content], [`.base/${rel}`, content]);
    files[rel] = sha256(content);
  }
  if (conflicts.length) throw new ForgeError(`These files exist with other content: ${conflicts.join(', ')}. Compare them, then run again with --force to replace them.`, 'pack-conflict');
  apply(where, writes, [], { name: pack.name, version: pack.version, source, files });
  return { name: pack.name, version: pack.version, written: Object.keys(files) };
}

export function update(where, source, { env = process.env } = {}) {
  const old = readLock(where);
  if (!old) throw new ForgeError('No pack is installed. Use "forge.mjs pack add <source>".', 'no-pack');
  const src = fetchSource(source ?? old.source, { env });
  const pack = readPack(src);
  if (pack.name !== old.name) throw new ForgeError(`The source holds pack "${pack.name}", not "${old.name}".`, 'pack-mismatch');
  const dir = forgeDir(where);
  const writes = [];
  const deletes = [];
  const files = {};
  const result = { name: pack.name, from: old.version, to: pack.version, updated: [], merged: [], conflicts: [], unchanged: [], removed: [], kept: [] };
  const newFiles = packFiles(src, pack.include);
  for (const rel of newFiles) {
    const theirs = readFileSync(path.join(src, rel));
    const target = path.join(dir, rel);
    const basePath = path.join(dir, '.base', rel);
    const base = existsSync(basePath) ? readFileSync(basePath) : Buffer.alloc(0);
    files[rel] = sha256(theirs);
    writes.push([`.base/${rel}`, theirs]);
    if (!existsSync(target)) { writes.push([rel, theirs]); result.updated.push(rel); continue; }
    const local = readFileSync(target);
    if (local.equals(theirs)) { result.unchanged.push(rel); continue; }
    if (local.equals(base)) { writes.push([rel, theirs]); result.updated.push(rel); continue; }
    if (base.equals(theirs)) { result.kept.push(rel); continue; }
    const m = mergeFile(local, base, theirs);
    writes.push([rel, m.content]);
    (m.conflicts ? result.conflicts : result.merged).push(rel);
  }
  for (const rel of Object.keys(old.files ?? {}).filter((r) => !newFiles.includes(r))) {
    const target = path.join(dir, rel);
    const basePath = path.join(dir, '.base', rel);
    deletes.push(`.base/${rel}`);
    if (existsSync(target) && existsSync(basePath) && readFileSync(target).equals(readFileSync(basePath))) { deletes.push(rel); result.removed.push(rel); } else if (existsSync(target)) result.kept.push(rel);
  }
  apply(where, writes, deletes, { name: pack.name, version: pack.version, source: source ?? old.source, files });
  return result;
}
