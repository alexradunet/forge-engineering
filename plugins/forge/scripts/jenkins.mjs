#!/usr/bin/env node
// Jenkins REST client for the ci-jenkins template. The token comes from the OS
// credential store (cred.mjs set jenkins, value "user:apiToken"); it is never
// printed. The host is ci.host of the team config, or --host.
//   node jenkins.mjs check
//   node jenkins.mjs status <job path> [--build <n>]
//   node jenkins.mjs tests  <job path> <build>
//   node jenkins.mjs logs   <job path> <build> [--grep <text>] [--context <n>] [--tail <n>]
//   node jenkins.mjs trigger <job path> [name=value ...]   (a write: ask first)
//   Options: --host <url>, --cred <name> (default: jenkins), --cwd <dir>
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { getSecret as storeSecret } from './lib/cred.mjs';
import { loadConfig } from './lib/config.mjs';
import { ForgeError, resolve } from './lib/repo.mjs';
import { assertTrusted } from './lib/trust.mjs';

export function parseArgs(argv) {
  const a = { _: [], params: {} };
  for (let i = 0; i < argv.length; i++) {
    const v = argv[i];
    if (['--host', '--cred', '--cwd', '--build', '--grep', '--context', '--tail'].includes(v)) a[v.slice(2)] = argv[++i];
    else if (v.startsWith('--')) throw new ForgeError(`Unknown option: ${v}`, 'bad-args');
    else if (a._[0] === 'trigger' && a._.length >= 2 && v.includes('=')) { const k = v.slice(0, v.indexOf('=')); a.params[k] = v.slice(k.length + 1); }
    else a._.push(v);
  }
  return a;
}

export function jobUrl(host, job) {
  if (!job) throw new ForgeError('Name the job path, for example job/folder/job/name.', 'bad-args');
  const clean = job.replace(/^\/+|\/+$/g, '');
  const p = clean.startsWith('job/') ? clean : clean.split('/').map((s) => `job/${encodeURIComponent(s)}`).join('/');
  return `${host.replace(/\/+$/, '')}/${p}`;
}

export function grepLines(text, needle, context = 5) {
  const lines = text.split(/\r?\n/);
  const keep = new Set();
  lines.forEach((l, i) => { if (l.includes(needle)) for (let j = Math.max(0, i - context); j <= Math.min(lines.length - 1, i + context); j++) keep.add(j); });
  const out = [];
  let last = -2;
  for (const i of [...keep].sort((x, y) => x - y)) { if (i !== last + 1) out.push('--'); out.push(`${i + 1}: ${lines[i]}`); last = i; }
  return out.join('\n');
}

export async function main(argv = process.argv.slice(2), { env = process.env, getSecret = storeSecret, out = console.log } = {}) {
  const a = parseArgs(argv);
  const [cmd, job, build] = a._;
  let host = a.host;
  if (!host) {
    const where = resolve({ cwd: a.cwd ?? process.cwd(), env });
    assertTrusted(where, ['config/'], { env });
    host = loadConfig(where.configDir).config.ci.host;
  }
  if (!/^https:\/\/|^http:\/\/(127\.0\.0\.1|localhost)[:/]/.test(host ?? '')) throw new ForgeError(`ci.host must be an https URL, not "${host}".`, 'bad-host');
  const auth = `Basic ${Buffer.from(getSecret(a.cred ?? 'jenkins')).toString('base64')}`;
  const get = async (url, init = {}) => {
    const r = await fetch(url, { ...init, headers: { Authorization: auth, ...(init.headers ?? {}) }, redirect: 'manual' });
    if (r.status >= 400) throw new ForgeError(`HTTP ${r.status} from ${url.replace(/\?.*/, '')}. See Failures in ci.md.`, `http-${r.status}`);
    return r;
  };

  if (cmd === 'check') {
    await get(`${host.replace(/\/+$/, '')}/api/json?tree=mode`);
    out('ok');
  } else if (cmd === 'status') {
    const b = a.build ?? 'lastBuild';
    out(JSON.stringify(await (await get(`${jobUrl(host, job)}/${b}/api/json?tree=number,result,building,url,timestamp,duration`)).json()));
  } else if (cmd === 'tests') {
    if (!build) throw new ForgeError('Name the build number.', 'bad-args');
    out(JSON.stringify(await (await get(`${jobUrl(host, job)}/${build}/testReport/api/json?tree=failCount,passCount,skipCount`)).json()));
  } else if (cmd === 'logs') {
    if (!build) throw new ForgeError('Name the build number.', 'bad-args');
    const text = await (await get(`${jobUrl(host, job)}/${build}/consoleText`)).text();
    if (a.grep) out(grepLines(text, a.grep, Number(a.context ?? 5)));
    else out(text.split(/\r?\n/).slice(-Number(a.tail ?? 200)).join('\n'));
  } else if (cmd === 'trigger') {
    const headers = {};
    try {
      const c = await (await get(`${host.replace(/\/+$/, '')}/crumbIssuer/api/json`)).json();
      headers[c.crumbRequestField] = c.crumb;
    } catch (err) {
      if (err.code !== 'http-404') throw err;
    }
    const qs = new URLSearchParams(a.params).toString();
    const r = await get(`${jobUrl(host, job)}/${qs ? `buildWithParameters?${qs}` : 'build'}`, { method: 'POST', headers });
    out(JSON.stringify({ status: r.status, queue: r.headers.get('location') }));
  } else {
    throw new ForgeError('Usage: jenkins.mjs <check|status|tests|logs|trigger> [<job path>] [<build>] [options]', 'bad-args');
  }
  return 0;
}

const isMain = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  main().then((code) => { process.exitCode = code; }, (err) => {
    if (err instanceof ForgeError) { console.error(`forge: ${err.message}`); process.exitCode = 1; return; }
    throw err;
  });
}
