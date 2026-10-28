// Secrets in the OS store. A secret travels only through stdin or captured
// stdout of a fixed child command. It never goes into argv, a message, or a log.
//   Windows: DPAPI (current user) file in <data>/secrets/<name>.dpapi
//   macOS:   Keychain item, service "forge", account <name> (security)
//   Linux:   Secret Service item, service "forge", account <name> (secret-tool)
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { ForgeError } from './repo.mjs';

const NAME = /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/;

/** The forge user data folder (outside every repo and outside the plugin). */
export function dataDir(env = process.env, platform = process.platform) {
  if (env.FORGE_DATA_DIR) return env.FORGE_DATA_DIR;
  if (platform === 'win32') return path.join(env.LOCALAPPDATA ?? path.join(os.homedir(), 'AppData', 'Local'), 'forge');
  if (platform === 'darwin') return path.join(os.homedir(), 'Library', 'Application Support', 'forge');
  return path.join(env.XDG_DATA_HOME ?? path.join(os.homedir(), '.local', 'share'), 'forge');
}

export function checkName(name) {
  if (typeof name !== 'string' || !NAME.test(name)) {
    throw new ForgeError(`Invalid secret name "${name}". Use letters, digits, ".", "_", or "-" (max 64).`, 'cred-name');
  }
  return name;
}

function run(cmd, args, input) {
  const r = spawnSync(cmd, args, { input: input ?? '', encoding: 'utf8', windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'] });
  if (r.error?.code === 'ENOENT') throw new ForgeError(`${cmd} is not available. forge needs it for the credential store.`, 'cred-tool-missing');
  if (r.error) throw new ForgeError(`${cmd} failed to start (${r.error.code}).`, 'cred-failed');
  return { code: r.status, stdout: r.stdout ?? '', stderr: r.stderr ?? '' };
}

function fail(what, res, secret) {
  let detail = (res.stderr || '').trim().split('\n')[0] ?? '';
  if (secret) detail = detail.split(secret).join('***');
  const lower = detail.toLowerCase();
  const code = /locked|unlock/.test(lower) ? 'cred-locked' : /denied|not allowed|user canceled|interaction/.test(lower) ? 'cred-denied' : 'cred-failed';
  return new ForgeError(`${what} failed (exit ${res.code})${detail ? `: ${detail}` : ''}.`, code);
}

const PS_PROTECT = "$ErrorActionPreference='Stop';Add-Type -AssemblyName System.Security;$s=[Console]::In.ReadToEnd();$b=[Security.Cryptography.ProtectedData]::Protect([Text.Encoding]::UTF8.GetBytes($s),$null,'CurrentUser');[Console]::Out.Write([Convert]::ToBase64String($b))";
const PS_UNPROTECT = "$ErrorActionPreference='Stop';Add-Type -AssemblyName System.Security;$s=[Console]::In.ReadToEnd().Trim();$b=[Security.Cryptography.ProtectedData]::Unprotect([Convert]::FromBase64String($s),$null,'CurrentUser');[Console]::Out.Write([Text.Encoding]::UTF8.GetString($b))";

export function windowsBackend(env = process.env) {
  const dir = path.join(dataDir(env, 'win32'), 'secrets');
  const file = (name) => path.join(dir, `${name}.dpapi`);
  const ps = (script, input) => run('powershell.exe', ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-Command', script], input);
  return {
    id: 'dpapi',
    set(name, secret) {
      const r = ps(PS_PROTECT, secret);
      if (r.code !== 0 || !r.stdout) throw fail('DPAPI protect', r, secret);
      mkdirSync(dir, { recursive: true });
      const tmp = `${file(name)}.tmp`;
      writeFileSync(tmp, r.stdout, { mode: 0o600 });
      renameSync(tmp, file(name));
    },
    get(name) {
      if (!existsSync(file(name))) return null;
      const r = ps(PS_UNPROTECT, readFileSync(file(name), 'utf8'));
      if (r.code !== 0) throw fail('DPAPI unprotect', r);
      return r.stdout;
    },
    delete(name) {
      if (!existsSync(file(name))) return false;
      rmSync(file(name));
      return true;
    },
  };
}

// "security -i" reads commands from stdin, so the secret stays out of argv.
function quote(s) {
  if (/[\r\n]/.test(s)) throw new ForgeError('A secret cannot contain a line break.', 'cred-name');
  return `"${s.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`;
}

export function macBackend() {
  return {
    id: 'keychain',
    set(name, secret) {
      const r = run('security', ['-i'], `add-generic-password -U -s forge -a ${quote(name)} -l ${quote(`forge ${name}`)} -w ${quote(secret)}\n`);
      if (r.code !== 0 || /error/i.test(r.stderr)) throw fail('Keychain add', r, secret);
    },
    get(name) {
      const r = run('security', ['find-generic-password', '-s', 'forge', '-a', name, '-w']);
      if (r.code === 44) return null;
      if (r.code !== 0) throw fail('Keychain read', r);
      return r.stdout.replace(/\n$/, '');
    },
    delete(name) {
      const r = run('security', ['delete-generic-password', '-s', 'forge', '-a', name]);
      if (r.code === 44) return false;
      if (r.code !== 0) throw fail('Keychain delete', r);
      return true;
    },
  };
}

export function linuxBackend() {
  return {
    id: 'secret-service',
    set(name, secret) {
      const r = run('secret-tool', ['store', '--label', `forge ${name}`, 'service', 'forge', 'account', name], secret);
      if (r.code !== 0) throw fail('secret-tool store', r, secret);
    },
    get(name) {
      const r = run('secret-tool', ['lookup', 'service', 'forge', 'account', name]);
      if (r.code !== 0) {
        if (!r.stderr.trim()) return null;
        throw fail('secret-tool lookup', r);
      }
      return r.stdout;
    },
    delete(name) {
      const had = this.get(name) !== null;
      const r = run('secret-tool', ['clear', 'service', 'forge', 'account', name]);
      if (r.code !== 0 && r.stderr.trim()) throw fail('secret-tool clear', r);
      return had;
    },
  };
}

export function defaultBackend(platform = process.platform, env = process.env) {
  if (platform === 'win32') return windowsBackend(env);
  if (platform === 'darwin') return macBackend();
  return linuxBackend();
}

/** A store over a backend. Scripts use getSecret(); nothing here prints a secret. */
export function createStore(backend = defaultBackend()) {
  return {
    backend: backend.id,
    set(name, secret) {
      checkName(name);
      if (typeof secret !== 'string' || !secret.length) throw new ForgeError('The secret is empty.', 'cred-empty');
      backend.set(name, secret);
    },
    has(name) { return backend.get(checkName(name)) !== null; },
    delete(name) { return backend.delete(checkName(name)); },
    getSecret(name) {
      const v = backend.get(checkName(name));
      if (v === null || v === '') {
        throw new ForgeError(`No secret "${name}" is stored. Ask the user to run: node "<plugin>/scripts/cred.mjs" set ${name}`, 'cred-absent');
      }
      return v;
    },
  };
}

export function getSecret(name) {
  return createStore().getSecret(name);
}
