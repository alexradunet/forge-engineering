// Screenshots of the forge pages: the styleguide, the board, and the wiki page, in 2 themes and 2 widths.
// Run: npm run shots [-- --out <folder>] [--only <page>] [--live]. `--only board` takes the board and each page that starts with "board-".
// Forge 9.2 stage 5 adds the pictures of the server states: error-403 and error-404 (the error pages of the live server, for a request that wants HTML),
// board-changed (the notice "The board changed.", after a ticket file changed), and board-stopped (the notice that the server stopped; it stops the demo server and starts it again,
// and it checks that the notice goes by itself when the server is back). The stopped picture has failed requests by design: only a request for /live that fails with a refused or
// closed connection is not a problem in that picture. Each other error counts.
// Each picture has its own browser context, so no saved view crosses from one to the next.
// The styleguide also gives preview-<width>.png (the top of a board) and icons-1500.png (the sprites and the letters, at 2 times the size).
// It needs Chromium (FORGE_CHROMIUM, or chromium, chromium-browser, or google-chrome on the PATH) and Node 22 or later (the global WebSocket).
// It uses no dependency. It seeds the demo of tests/fixtures/demo.mjs in a new temporary folder, and it starts its own live server on a free port
// with its own data folder, so a live server that runs for a real repository stays untouched.
// It exits with 1 when a page has a console error, a content-policy violation, or a wrong --bg for its theme. It is not part of npm test.
import { spawn, spawnSync } from 'node:child_process';
import { EventEmitter } from 'node:events';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { rawDir } from '../../plugins/forge/scripts/lib/layout.mjs';
import { serveLive } from '../../plugins/forge/scripts/lib/live-serve.mjs';
import { tokenValue } from '../../plugins/forge/scripts/lib/ui/tokens.mjs';
import { renderStyleguide } from '../../plugins/forge/scripts/lib/ui/styleguide.mjs';
import { writeViews } from '../../plugins/forge/scripts/lib/views.mjs';
import { FULL_TICKET, seedDemo } from '../fixtures/demo.mjs';

const THEMES = ['light', 'dark'];
const WIDTHS = [1500, 620];
const HEIGHT = 950;
const MAX_FULL = 16000;
// wiki-outbox is the wiki page with a Mermaid drawing. board-none and wiki-none are the pages after a filter that finds nothing.
// The pictures of the server states come last: board-stopped stops the demo server.
const PAGES = ['styleguide', 'board', 'wiki', 'wiki-outbox', 'board-none', 'wiki-none', 'board-skip', 'board-focus', 'error-403', 'error-404', 'board-changed', 'board-stopped'];
const NARROW_TOO = ['styleguide', 'board', 'wiki', 'wiki-outbox', 'board-none', 'wiki-none', 'error-403', 'board-changed'];
// These pictures show the window and not the whole page: a notice is fixed at the bottom of the window.
const WINDOW_ONLY = (name) => name === 'board-changed' || name === 'board-stopped';

function fail(text) {
  console.error(`shots: ${text}`);
  process.exit(2);
}

const argv = process.argv.slice(2);
const options = { out: '', only: '', serve: false };
for (let at = 0; at < argv.length; at++) {
  if (argv[at] === '--out') options.out = argv[++at] ?? '';
  else if (argv[at] === '--only') options.only = argv[++at] ?? '';
  else if (argv[at] === '--live') options.serve = true;
  else fail(`Unknown option ${argv[at]}. Use --out <folder>, --only <${PAGES.join('|')}>, or --live.`);
}
const picked = (name) => !options.only || name === options.only || name.startsWith(`${options.only}-`);
if (options.only && !PAGES.some(picked)) fail(`--only takes one of: ${PAGES.join(', ')}.`);
if (typeof WebSocket !== 'function') fail(`Node 22 or later is needed (the global WebSocket). This Node is ${process.version}.`);

function findChromium() {
  if (process.env.FORGE_CHROMIUM) return process.env.FORGE_CHROMIUM;
  for (const name of ['chromium', 'chromium-browser', 'google-chrome']) {
    const found = spawnSync(process.platform === 'win32' ? 'where' : 'which', [name], { encoding: 'utf8' });
    if (found.status === 0 && found.stdout.trim()) return found.stdout.trim().split(/\r?\n/)[0];
  }
  return fail('No Chromium found. Set FORGE_CHROMIUM, or put chromium, chromium-browser, or google-chrome on the PATH.');
}

const temp = mkdtempSync(path.join(os.tmpdir(), 'forge-shots-'));
const outDir = options.out ? path.resolve(options.out) : path.join(temp, 'png');
mkdirSync(outDir, { recursive: true });

// The demo, the file pages, and the live server.
const demo = seedDemo(path.join(temp, 'demo-root'));
writeViews(demo.wiki, { links: 'file' });
const styleguideFile = path.join(rawDir(demo.wiki), 'styleguide.html');
writeFileSync(styleguideFile, renderStyleguide());

const DATA = { ...process.env, FORGE_DATA_DIR: path.join(temp, 'data') };
// One run of the live server in this process. A second run has the same port and the same page token: the key file is in the data folder of this script.
// The first run takes a free port (port 0). A later run takes the port of the first run, so the address of a page stays the same.
async function launch(port = 0) {
  const signals = new EventEmitter();
  let text = '';
  const served = serveLive(demo.wiki, {
    port, repo: demo.repo, signals, env: DATA, sweepMs: 1500,
    out: { write: (chunk) => { text += chunk; } }, err: { write() {} },
  });
  served.catch((error) => { console.error(`shots: the live server stopped: ${error.message}`); });
  for (let tries = 0; tries < 300 && !text.includes('\n  wiki'); tries++) await new Promise((resolve) => { setTimeout(resolve, 20); });
  const found = /serving (http:\/\/127\.0\.0\.1:\d+)\/board\?t=([0-9a-f]{32})/.exec(text);
  if (!found) { signals.emit('SIGTERM'); fail('The live server did not start.'); }
  return { signals, served, origin: found[1], token: found[2] };
}
let server = await launch();
let { origin, token } = server;
const URLS = {
  styleguide: pathToFileURL(styleguideFile).href,
  board: `${origin}/board?t=${token}`,
  wiki: `${origin}/wiki?t=${token}`,
  'wiki-outbox': `${origin}/wiki?t=${token}#app/outbox.md`,
  'board-none': `${origin}/board?t=${token}`,
  'wiki-none': `${origin}/wiki?t=${token}`,
  'board-skip': `${origin}/board?t=${token}`,
  'board-focus': `${origin}/board?t=${token}`,
  // A request that a browser makes for a page has the header Accept with text/html: the error pages need no other help.
  'error-403': `${origin}/board?t=${'0'.repeat(32)}`,
  'error-404': `${origin}/nope?t=${token}`,
  'board-changed': `${origin}/board?t=${token}`,
  'board-stopped': `${origin}/board?t=${token}`,
};
// A page that needs a step before the picture: the filter gets words that no ticket and no page has.
const AFTER = {
  'board-none': 'var f = document.getElementById("filter"); f.value = "zzzz"; f.dispatchEvent(new Event("input"));',
  'wiki-none': 'var f = document.getElementById("filter"); f.value = "zzzz"; f.dispatchEvent(new Event("input"));',
  // The focus pictures: the skip link and a card link.
  'board-skip': 'document.querySelector(".skip").focus();',
  'board-focus': 'document.querySelector(".tcard .open").focus();',
};

async function stopServer() {
  server.signals.emit('SIGTERM');
  await server.served.catch(() => {});
}

if (options.serve) {
  console.log(`board: ${URLS.board}\nPress Ctrl+C to stop.`);
  process.once('SIGINT', async () => { await stopServer(); rmSync(temp, { recursive: true, force: true }); process.exit(0); });
  await new Promise(() => {});
}

// Chromium, started with its own profile folder and no extension (an extension can recolor a page).
const chromium = spawn(findChromium(), [
  '--headless=new', '--disable-extensions', '--no-first-run', '--disable-gpu', `--user-data-dir=${path.join(temp, 'profile')}`, '--remote-debugging-port=0', 'about:blank',
], { stdio: ['ignore', 'ignore', 'pipe'] });
const endpoint = await new Promise((resolve) => {
  let log = '';
  const timer = setTimeout(() => resolve(''), 20000);
  chromium.stderr.on('data', (chunk) => {
    log += chunk;
    const match = /DevTools listening on (ws:\/\/\S+)/.exec(log);
    if (match) { clearTimeout(timer); resolve(match[1]); }
  });
  chromium.on('exit', () => { clearTimeout(timer); resolve(''); });
});
const cleanup = async () => {
  chromium.kill();
  await stopServer();
  rmSync(temp, { recursive: true, force: true, maxRetries: 3 });
};
if (!endpoint) { await cleanup(); fail('Chromium did not report a DevTools address.'); }

// The DevTools protocol over one WebSocket: send() answers with the result, and each event goes to the listeners.
const socket = new WebSocket(endpoint);
await new Promise((resolve, reject) => { socket.addEventListener('open', resolve); socket.addEventListener('error', () => reject(new Error('The DevTools socket failed.'))); });
let nextId = 0;
const waiting = new Map();
const listeners = new Set();
socket.addEventListener('message', (event) => {
  const message = JSON.parse(String(event.data));
  if (message.id !== undefined) {
    const entry = waiting.get(message.id);
    waiting.delete(message.id);
    if (entry) message.error ? entry.reject(new Error(`${entry.method}: ${message.error.message}`)) : entry.resolve(message.result ?? {});
  } else for (const listener of listeners) listener(message);
});
const send = (method, params = {}, sessionId = undefined) => new Promise((resolve, reject) => {
  const id = ++nextId;
  waiting.set(id, { resolve, reject, method });
  socket.send(JSON.stringify({ id, method, params, ...(sessionId ? { sessionId } : {}) }));
});
const sleep = (ms) => new Promise((resolve) => { setTimeout(resolve, ms); });

const problems = [];
const written = [];
// A page that breaks its content policy fires this event. The Log domain reports it as an error too, and this list names the directive and the blocked address.
const VIOLATIONS = 'window.__violations = []; document.addEventListener("securitypolicyviolation", function (e) { window.__violations.push(e.violatedDirective + " " + String(e.blockedURI).slice(0, 60)); });';

// Waits until an expression is true in the page. Gives false after `ms`.
async function until(call, expression, ms = 10000) {
  for (let waited = 0; waited < ms; waited += 100) {
    const { result } = await call('Runtime.evaluate', { expression, returnByValue: true });
    if (result.value === true) return true;
    await sleep(100);
  }
  return false;
}
const NOTICE_SHOWN = 'document.getElementById("notice") && !document.getElementById("notice").hidden';
const NOTICE_TEXT = 'document.getElementById("notice").innerText';
let changes = 0;
const README = () => path.join(rawDir(demo.wiki), 'tickets', FULL_TICKET, 'README.md');

// The steps of the server-state pictures. SETUP runs after the page loaded and before the picture. AFTER_SHOT runs after it and checks what the buttons do.
const SETUP = {
  // A ticket file changes: the sweep of the server (1.5 s here) finds it, and the page shows the notice.
  async 'board-changed'({ call, mine }) {
    await until(call, 'document.getElementById("live-note").textContent.indexOf("no answer") < 0', 8000);
    changes += 1;
    writeFileSync(README(), readFileSync(README(), 'utf8').replace(/^next: .*$/m, `next: Read the new plan, round ${changes}`));
    if (!(await until(call, NOTICE_SHOWN, 15000))) mine.push('the notice "The board changed." did not show');
  },
  // The demo server stops: the page asks again, and the notice stays.
  async 'board-stopped'({ call, mine }) {
    await until(call, 'document.getElementById("live-note").textContent.indexOf("no answer") < 0', 8000);
    await stopServer();
    if (!(await until(call, NOTICE_SHOWN, 20000))) mine.push('the notice that the server stopped did not show');
  },
};
const AFTER_SHOT = {
  // Light: Reload loads the page again, with the new text and no notice. Dark: Later hides the notice, and it stays hidden.
  async 'board-changed'({ call, mine, theme, width }) {
    if (width !== 1500) return;
    const text = await call('Runtime.evaluate', { expression: NOTICE_TEXT, returnByValue: true });
    if (!/The board changed\./.test(text.result.value)) mine.push(`the changed notice says: ${text.result.value}`);
    const index = theme === 'light' ? 0 : 1;
    await call('Runtime.evaluate', { expression: `document.querySelectorAll("#notice button")[${index}].click()` });
    await sleep(theme === 'light' ? 2500 : 3500);
    const gone = await call('Runtime.evaluate', { expression: '!!document.getElementById("notice") && document.getElementById("notice").hidden', returnByValue: true });
    if (!gone.result.value) mine.push(`the notice stayed after ${theme === 'light' ? 'Reload' : 'Later'}`);
    const fresh = await call('Runtime.evaluate', { expression: `document.body.innerText.indexOf("round ${changes}") >= 0`, returnByValue: true });
    if (theme === 'light' && !fresh.result.value) mine.push('Reload did not show the new text');
    if (theme === 'dark' && fresh.result.value) mine.push('Later loaded the page again');
  },
  // The server starts again with the same key and the same port. Light: the page clears the notice by itself. Dark: Try again clears it at once.
  async 'board-stopped'({ call, mine, theme }) {
    server = await launch(Number(new URL(origin).port));
    if (server.origin !== origin || server.token !== token) mine.push('the new server has another address or another page token');
    if (theme === 'dark') await call('Runtime.evaluate', { expression: 'document.querySelectorAll("#notice button")[1].click()' });
    if (!(await until(call, '!!document.getElementById("notice") && document.getElementById("notice").hidden', theme === 'dark' ? 10000 : 60000))) mine.push('the notice stayed after the server was back');
  },
};
// A failed request that a picture shows by design.
const EXPECTED = {
  'error-403': (entry) => entry.source === 'network' && /status of 403/.test(entry.text),
  'error-404': (entry) => entry.source === 'network' && /status of 404/.test(entry.text),
  'board-stopped': (entry) => entry.source === 'network' && /\/live\?/.test(entry.url ?? '') && /ERR_(CONNECTION_REFUSED|CONNECTION_RESET|EMPTY_RESPONSE|FAILED)/.test(entry.text),
};

async function shoot(name, theme, width) {
  const height = HEIGHT;
  const { browserContextId } = await send('Target.createBrowserContext');
  const { targetId } = await send('Target.createTarget', { url: 'about:blank', browserContextId });
  const { sessionId } = await send('Target.attachToTarget', { targetId, flatten: true });
  const call = (method, params) => send(method, params, sessionId);
  const label = `${name} ${theme} ${width}`;
  const mine = [];
  const loaded = new Promise((resolve) => {
    const listener = (message) => {
      if (message.sessionId !== sessionId) return;
      const { method, params } = message;
      if (method === 'Page.loadEventFired') resolve();
      else if (method === 'Runtime.exceptionThrown') mine.push(`exception: ${params.exceptionDetails.exception?.description ?? params.exceptionDetails.text}`);
      else if (method === 'Runtime.consoleAPICalled' && params.type === 'error') mine.push(`console error: ${params.args.map((arg) => arg.value ?? arg.description ?? '').join(' ')}`);
      else if (method === 'Log.entryAdded' && params.entry.level === 'error' && !/\/favicon\.ico$/.test(params.entry.url ?? '') && !EXPECTED[name]?.(params.entry)) mine.push(`${params.entry.source} error: ${params.entry.text}${params.entry.url ? ` (${params.entry.url})` : ''}`);
    };
    listeners.add(listener);
  });
  await Promise.all([call('Page.enable'), call('Runtime.enable'), call('Log.enable')]);
  await call('Page.addScriptToEvaluateOnNewDocument', { source: VIOLATIONS });
  await call('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: 1, mobile: false });
  await call('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-color-scheme', value: theme }] });
  await call('Page.navigate', { url: URLS[name] });
  await Promise.race([loaded, sleep(15000)]);
  if (AFTER[name]) await call('Runtime.evaluate', { expression: AFTER[name] });
  if (SETUP[name]) await SETUP[name]({ call, mine, theme, width });
  // Wait until each Mermaid block is a drawing, or 3 seconds at most.
  for (let tries = 0; tries < 30; tries++) {
    const { result } = await call('Runtime.evaluate', { expression: 'Array.prototype.every.call(document.querySelectorAll(\'pre[data-lang="mermaid"]\'), function (pre) { return pre.hasAttribute("data-drawn"); })', returnByValue: true });
    if (result.value) break;
    await sleep(100);
  }
  await sleep(250);
  const violations = await call('Runtime.evaluate', { expression: 'JSON.stringify(window.__violations || [])', returnByValue: true });
  for (const item of JSON.parse(violations.result.value)) mine.push(`content policy violation: ${item}`);
  // An extension or a wrong theme shows here: the computed --bg of the page must be the token of the emulated theme.
  const { result } = await call('Runtime.evaluate', { expression: 'getComputedStyle(document.documentElement).getPropertyValue("--bg").trim()', returnByValue: true });
  const want = tokenValue('--bg', theme);
  if (String(result.value).toLowerCase() !== want) mine.push(`the computed --bg is ${JSON.stringify(result.value)}, and the ${theme} token is ${want}`);
  const body = await call('Runtime.evaluate', { expression: 'document.body ? document.body.innerText.length : 0', returnByValue: true });
  if (!(body.result.value > 40)) mine.push('the page has almost no text (a blank or an error page)');
  let shot;
  if (WINDOW_ONLY(name)) shot = await call('Page.captureScreenshot', { format: 'png' });
  else {
    const metrics = await call('Page.getLayoutMetrics');
    const height = Math.min(MAX_FULL, Math.ceil(metrics.cssContentSize.height));
    shot = await call('Page.captureScreenshot', { format: 'png', captureBeyondViewport: true, clip: { x: 0, y: 0, width, height, scale: 1 } });
  }
  const file = path.join(outDir, `${name}-${theme}-${width}.png`);
  writeFileSync(file, Buffer.from(shot.data, 'base64'));
  written.push(file);
  // The sections of the styleguide to look at: one picture of each, at this width (both boxes of a theme are in them).
  if (name === 'styleguide' && theme === 'light') {
    const crops = [['preview', '#preview', 1], ...(width === 1500 ? [['icons', '#sprites', 2]] : [])];
    for (const [crop, selector, scale] of crops) {
      const box = await call('Runtime.evaluate', { expression: `(function () { var r = document.querySelector('${selector}').getBoundingClientRect(); return { x: r.left + scrollX, y: r.top + scrollY, width: r.width, height: r.height }; })()`, returnByValue: true });
      const part = await call('Page.captureScreenshot', { format: 'png', captureBeyondViewport: true, clip: { ...box.result.value, scale } });
      const cropFile = path.join(outDir, `${crop}-${width}.png`);
      writeFileSync(cropFile, Buffer.from(part.data, 'base64'));
      written.push(cropFile);
      console.log(cropFile);
    }
  }
  if (AFTER_SHOT[name]) await AFTER_SHOT[name]({ call, mine, theme, width });
  for (const item of mine) problems.push(`${label}: ${item}`);
  await send('Target.closeTarget', { targetId });
  await send('Target.disposeBrowserContext', { browserContextId });
  console.log(file);
}

// The spark: a gate that is approved now and was not before gets the class spark one time, and the first visit gets none.
// The check sets the stored statuses of the first ticket row (one gate in review is stored as not approved), loads the page again, and reads the DOM.
async function sparkCheck() {
  const { browserContextId } = await send('Target.createBrowserContext');
  const { targetId } = await send('Target.createTarget', { url: 'about:blank', browserContextId });
  const { sessionId } = await send('Target.attachToTarget', { targetId, flatten: true });
  const call = (method, params) => send(method, params, sessionId);
  const evaluate = async (expression) => (await call('Runtime.evaluate', { expression, returnByValue: true })).result.value;
  const reload = async () => {
    await call('Page.navigate', { url: URLS.board });
    await sleep(1500);
  };
  await call('Page.enable');
  await call('Runtime.enable');
  await reload();
  const first = await evaluate('document.querySelectorAll(".ingot.spark").length');
  const row = await evaluate('(function () { var r = document.querySelector("[data-gates]"); return r ? r.getAttribute("data-gates") : ""; })()');
  const stored = await evaluate(`localStorage.getItem("forge-ui:gates:" + ${JSON.stringify(row)})`);
  // Store the statuses of a visit before the approval: each gate that is approved now was in review then.
  await evaluate(`(function () { var key = "forge-ui:gates:" + ${JSON.stringify(row)}; var now = JSON.parse(localStorage.getItem(key)); var old = {}; Object.keys(now).forEach(function (name) { old[name] = now[name] === "approved" ? "in-review" : now[name]; }); localStorage.setItem(key, JSON.stringify(old)); })()`);
  await reload();
  const sparked = await evaluate('document.querySelectorAll(".ingot.spark").length');
  const approved = await evaluate('document.querySelector("[data-gates]").querySelectorAll(".ingot.ig-approved").length');
  const animation = await evaluate('(function () { var i = document.querySelector(".ingot.spark"); return i ? getComputedStyle(i).animationName + " " + getComputedStyle(i).animationDuration : ""; })()');
  await reload();
  const again = await evaluate('document.querySelectorAll(".ingot.spark").length');
  console.log(`spark: first visit ${first} spark (stored ${stored ? 'yes' : 'no'} after it), after an approval ${sparked} of ${approved} approved ingots of the first row spark (animation: ${animation || 'none'}), the next load ${again}`);
  if (first !== 0) problems.push(`spark: the first visit has ${first} sparks`);
  if (!sparked || sparked !== approved) problems.push(`spark: ${sparked} sparks for ${approved} newly approved ingots`);
  if (again !== 0) problems.push(`spark: the next load has ${again} sparks`);
  await send('Target.closeTarget', { targetId });
  await send('Target.disposeBrowserContext', { browserContextId });
}

try {
  if (picked('board')) await sparkCheck();
  for (const name of PAGES.filter(picked)) {
    for (const theme of THEMES) for (const width of WIDTHS.filter((one) => one === 1500 || NARROW_TOO.includes(name))) await shoot(name, theme, width);
  }
} finally {
  socket.close();
  await cleanup();
}
if (problems.length) {
  console.error(`\n${problems.length} problem${problems.length === 1 ? '' : 's'}:`);
  for (const item of problems) console.error(`  ${item}`);
  process.exit(1);
}
console.log(`\n${written.length} screenshots in ${outDir}`);
