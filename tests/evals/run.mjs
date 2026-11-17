#!/usr/bin/env node
// Runs the behavioral eval cases of tests/evals/cases.mjs with a real agent session. See docs/evaluation.md.
//   node tests/evals/run.mjs [--case <name>]... [--runs <n>] [--model <model>] [--max-usd <total>] [--keep] [--list]
// Each run is a paid model run: `claude --plugin-dir plugins/forge -p <prompt>` in a new fixture folder.
// The session is not in a sandbox. It can use only the tools of its case, it has no GitHub login, and its remote is a local folder.
// Exit code: 0 when each hard check of each run passes, 1 when one fails, 2 for a wrong argument or a stop at the cost limit.
import { spawnSync } from 'node:child_process';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { CASES } from './cases.mjs';
import { buildFixture, plugin } from './fixture.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));

export function parseArgs(argv) {
  const out = { cases: [], runs: null, model: 'sonnet', maxUsd: 5, keep: false, list: false };
  for (let i = 0; i < argv.length; i++) {
    const value = () => { if (argv[i + 1] === undefined || argv[i + 1].startsWith('--')) throw new Error(`${argv[i]} needs a value.`); return argv[++i]; };
    if (argv[i] === '--case') out.cases.push(value());
    else if (argv[i] === '--runs') out.runs = Number(value());
    else if (argv[i] === '--model') out.model = value();
    else if (argv[i] === '--max-usd') out.maxUsd = Number(value());
    else if (argv[i] === '--keep') out.keep = true;
    else if (argv[i] === '--list') out.list = true;
    else throw new Error(`Unknown argument: ${argv[i]}`);
  }
  if (out.runs !== null && !(Number.isInteger(out.runs) && out.runs >= 1 && out.runs <= 10)) throw new Error('--runs is a whole number from 1 to 10.');
  if (!(out.maxUsd > 0)) throw new Error('--max-usd is a number above 0.');
  const unknown = out.cases.filter((name) => !CASES.some((c) => c.name === name));
  if (unknown.length) throw new Error(`Unknown case: ${unknown.join(', ')}. Use --list.`);
  return out;
}

/** The tool calls, the failed tool results, and the last text of a stream-json output of `claude -p`. */
export function readTrace(text) {
  const calls = [];
  const failures = [];
  let last = '';
  let result = null;
  let init = null;
  for (const line of String(text).split('\n')) {
    let event;
    try { event = JSON.parse(line); } catch { continue; }
    if (event.type === 'system' && event.subtype === 'init') init = { model: event.model, version: event.claude_code_version, plugins: (event.plugins ?? []).map((p) => p.name) };
    if (event.type === 'result') result = { cost: event.total_cost_usd ?? 0, turns: event.num_turns ?? 0, subtype: event.subtype ?? '', error: Boolean(event.is_error) };
    const content = event.message?.content;
    if (!Array.isArray(content)) continue;
    for (const block of content) {
      if (event.type === 'assistant' && block.type === 'tool_use') calls.push({ name: block.name, input: block.input ?? {}, id: block.id ?? null });
      if (event.type === 'assistant' && block.type === 'text' && block.text.trim()) last = block.text;
      if (event.type === 'user' && block.type === 'tool_result') {
        const text = typeof block.content === 'string' ? block.content : JSON.stringify(block.content);
        if (block.is_error) failures.push(text);
        // The result of a call, by the id of the call, so a check can see what stopped one command.
        const call = calls.find((item) => item.id && item.id === block.tool_use_id);
        if (call) call.result = { error: Boolean(block.is_error), text };
      }
    }
  }
  return { calls, failures, last, result, init };
}

/** The values and helpers that the checks of a case read. */
export function runView(trace, fixture, before) {
  const shells = trace.calls.filter((call) => ['Bash', 'PowerShell'].includes(call.name));
  const commands = shells.map((call) => String(call.input.command ?? ''));
  return {
    ...trace, fixture, before,
    bash: (pattern) => commands.filter((command) => pattern.test(command)),
    // The shell calls whose command matches, each as { command, result }. result is null when the trace has none.
    shell: (pattern) => shells.filter((call) => pattern.test(String(call.input.command ?? ''))).map((call) => ({ command: String(call.input.command ?? ''), result: call.result ?? null })),
    failed: (pattern) => trace.failures.filter((text) => pattern.test(text)),
    read: (pattern) => trace.calls.some((call) => call.name === 'Read' && pattern.test(String(call.input.file_path ?? ''))),
    skill: (name) => trace.calls.some((call) => call.name === 'Skill' && new RegExp(`(^|:)${name}$`).test(String(call.input.skill ?? ''))),
    said: (pattern) => pattern.test(trace.last),
  };
}

export function runChecks(checks, view) {
  return checks.map((check) => {
    let found;
    try { found = check.test(view); } catch (error) { found = `The check failed: ${error.message}`; }
    return { name: check.name, hard: Boolean(check.hard), passed: found === true, found: found === true ? '' : String(found) };
  });
}

function session(c, fixture, model) {
  // The session gets no GitHub login and no user settings. The plugin under test is the only plugin folder.
  const env = { ...fixture.env, GH_CONFIG_DIR: path.join(fixture.base, 'gh'), GH_TOKEN: '', GITHUB_TOKEN: '' };
  for (const key of Object.keys(env)) if (/^CLAUDE_CODE_(PLUGIN_DIRS|MESSAGING|SESSION|CHILD)/.test(key)) delete env[key];
  const args = ['--plugin-dir', plugin, '-p', c.prompt, '--model', model, '--max-turns', String(c.maxTurns ?? 15), '--max-budget-usd', String(c.budget ?? 0.75),
    '--setting-sources', 'project', '--strict-mcp-config', '--no-session-persistence', '--output-format', 'stream-json', '--verbose', '--allowedTools', ...c.tools];
  return spawnSync('claude', args, { cwd: fixture.root, env, encoding: 'utf8', timeout: (c.timeout ?? 300) * 1000, maxBuffer: 256 * 1024 * 1024 });
}

function main(argv) {
  let options;
  try { options = parseArgs(argv); } catch (error) { console.error(`eval: ${error.message}`); return 2; }
  const cases = options.cases.length ? CASES.filter((c) => options.cases.includes(c.name)) : CASES;
  if (options.list) { for (const c of CASES) console.log(`${c.name}  (${c.scenario}, ${c.runs ?? 2} runs)  ${c.prompt}`); return 0; }
  const report = { started: new Date().toISOString(), model: options.model, cases: [] };
  let spent = 0;
  let stopped = false;
  for (const c of cases) {
    const entry = { name: c.name, prompt: c.prompt, runs: [] };
    report.cases.push(entry);
    for (let i = 0; i < (options.runs ?? c.runs ?? 2); i++) {
      if (spent >= options.maxUsd) { stopped = true; break; }
      const fixture = buildFixture(c.scenario);
      const before = { readme: readFileSync(fixture.readme, 'utf8') };
      const started = Date.now();
      const child = session(c, fixture, options.model);
      const trace = readTrace(child.stdout ?? '');
      const checks = runChecks(c.checks, runView(trace, fixture, before));
      const cost = trace.result?.cost ?? 0;
      spent += cost;
      const run = {
        passed: checks.every((check) => check.passed || !check.hard), checks, cost, turns: trace.result?.turns ?? 0, seconds: Math.round((Date.now() - started) / 1000),
        end: child.error ? child.error.message : trace.result ? trace.result.subtype : `no result, exit ${child.status}`, init: trace.init,
        tools: trace.calls.map((call) => `${call.name} ${JSON.stringify(call.input).slice(0, 200)}`), failures: trace.failures.map((text) => text.slice(0, 300)), last: trace.last,
        folder: options.keep ? fixture.base : '',
      };
      entry.runs.push(run);
      console.log(`${run.passed ? '✓' : '✗'} ${c.name} run ${i + 1}: ${run.turns} turns, ${run.seconds} s, $${cost.toFixed(2)}, ${run.end}`);
      for (const check of checks) console.log(`    ${check.passed ? '✓' : check.hard ? '✗' : '·'} ${check.name}${check.found ? `: ${check.found}` : ''}`);
      if (options.keep) console.log(`    kept ${fixture.base}`); else fixture.remove();
    }
    if (stopped) break;
  }
  report.costUsd = Number(spent.toFixed(4));
  report.stopped = stopped;
  const dir = path.join(here, 'results');
  mkdirSync(dir, { recursive: true });
  const file = path.join(dir, `${report.started.replace(/[:.]/g, '-')}.json`);
  writeFileSync(file, `${JSON.stringify(report, null, 2)}\n`);
  console.log('');
  for (const entry of report.cases) console.log(`${entry.runs.filter((run) => run.passed).length}/${entry.runs.length}  ${entry.name}`);
  console.log(`Cost: $${spent.toFixed(2)}${stopped ? ` (stopped at the limit of $${options.maxUsd})` : ''}. Result: ${file}`);
  if (stopped) return 2;
  return report.cases.every((entry) => entry.runs.every((run) => run.passed)) ? 0 : 1;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) process.exitCode = main(process.argv.slice(2));
