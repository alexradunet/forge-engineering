// The command for a person: `forge.mjs open`. It starts the live server of one repository (live-serve.mjs) in the background
// when none runs, prints the links of the board and the wiki, and opens the board in the browser of the user.
// More than one repository can have its server at the same time: each one has its own state file and its own port.
// The links of a repository stay the same after a restart (the key file of live-serve.mjs). `--new-link` (renewLink) makes a new key.
import { spawn } from 'node:child_process';
import { homeOf } from './layout.mjs';
import { PLUGIN_VERSION, liveList, liveStatus, newKey } from './live-serve.mjs';

const START_MS = 8000;
const STOP_MS = 5000;
const STEP_MS = 100;
const sleep = (ms) => new Promise((resolve) => { setTimeout(resolve, ms); });

/** The command that opens a link in the browser of the user, for a platform. */
export function browserCommand(link, platform = process.platform) {
  if (platform === 'win32') return { command: 'cmd', args: ['/c', 'start', '', link] };
  if (platform === 'darwin') return { command: 'open', args: [link] };
  return { command: 'xdg-open', args: [link] };
}

/** Opens a link in the browser. Gives false when the platform command does not start: the link is on the screen, so this is not an error. */
export function openBrowser(link, { platform = process.platform, spawnFn = spawn } = {}) {
  const { command, args } = browserCommand(link, platform);
  return new Promise((resolve) => {
    try {
      const child = spawnFn(command, args, { detached: true, stdio: 'ignore' });
      child.once('error', () => resolve(false));
      child.once('spawn', () => { child.unref(); resolve(true); });
    } catch { resolve(false); }
  });
}

/**
 * Gives the live server of the repository of `wiki`, and starts it first when none runs.
 * `cli` is the path of forge.mjs, and `repo` is the main checkout. The server is a process of its own: it runs on after this call.
 * A server of another plugin version (or with no version), or on another port than a `port` above 0, is stopped and started again.
 */
export async function openForge({ cli, repo, wiki, port, env = process.env, browser = true, out = process.stdout, waitMs = START_MS, platform = process.platform, spawnFn = spawn, version = PLUGIN_VERSION }) {
  const home = homeOf(wiki);
  let running = liveStatus(env, home);
  let started = false;
  if (running && ((version && running.version !== version) || (port && port !== running.port))) {
    await stopForge({ wiki, env });
    running = null;
  }
  if (!running) {
    const args = [cli, 'live', '--cwd', repo, '--wiki', wiki, ...(port === undefined ? [] : ['--port', String(port)])];
    const child = spawnFn(process.execPath, args, { detached: true, stdio: 'ignore', env });
    let ended = false;
    child.once('error', () => { ended = true; });
    child.once('exit', () => { ended = true; });
    child.unref();
    for (let waited = 0; waited < waitMs && !running && !ended; waited += STEP_MS) {
      await sleep(STEP_MS);
      running = liveStatus(env, home);
    }
    if (!running) throw new Error('The live server did not start. Run "forge.mjs live" in the repository to see the reason.');
    started = true;
  }
  out.write(`forge: serving ${running.link}\n  wiki   ${running.wikiLink}\n  folder ${home}\n`
    + (started ? '  The server runs in the background. To stop it: forge.mjs open --stop\n' : ''));
  const opened = browser ? await openBrowser(running.link, { platform, spawnFn }) : false;
  // The browser command is not on each machine. The link is on the screen, so the user can open it by hand.
  if (browser && !opened) out.write('  No browser started. Open the board link above by hand.\n');
  return { ...running, started, opened };
}

/** Stops the live server of the repository of `wiki`. Gives { stopped, pid }, with stopped false when no server runs. */
export async function stopForge({ wiki, env = process.env, waitMs = STOP_MS }) {
  const home = homeOf(wiki);
  const running = liveStatus(env, home);
  if (!running) return { stopped: false, pid: 0 };
  try { process.kill(running.pid, 'SIGTERM'); } catch { /* The process ended in this moment. */ }
  for (let waited = 0; waited < waitMs && liveStatus(env, home); waited += STEP_MS) await sleep(STEP_MS);
  if (liveStatus(env, home)) throw new Error(`The live server (process ${running.pid}) did not stop.`);
  return { stopped: true, pid: running.pid };
}

/**
 * Writes a new page token for the repository of `wiki`, so each older link stops. A server that runs is stopped first and started again with the new key.
 * Gives what openForge gives, and `stopped` (true when a server ran).
 */
export async function renewLink({ wiki, env = process.env, ...options }) {
  const { stopped } = await stopForge({ wiki, env });
  newKey(env, homeOf(wiki));
  return { ...(await openForge({ wiki, env, ...options })), stopped };
}

/** The lines for `open --list`: each live server of this user that runs. */
export function listForge(env = process.env) {
  return liveList(env).map((server) => `${server.home}\n  board ${server.link}\n  wiki  ${server.wikiLink}`);
}
