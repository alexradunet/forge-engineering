import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { CLAUDE_PARTS, END_MARKER } from '../plugins/forge/scripts/lib/hook.mjs';

// Packaging contract: one plugin folder serves Copilot CLI and Claude Code.
// Copilot CLI reads plugin.json (Agent Plugins 1.0) and com.github.copilot/hooks/hooks.json.
// Claude Code reads .claude-plugin/marketplace.json, the folder name, and hooks/hooks.json.
const repo = fileURLToPath(new URL('..', import.meta.url));
const pluginDir = path.join(repo, 'plugins', 'forge');
const json = (...parts) => JSON.parse(readFileSync(path.join(repo, ...parts), 'utf8'));
const manifest = json('plugins', 'forge', 'plugin.json');
const copilotMarket = json('.github', 'plugin', 'marketplace.json');
const claudeMarket = json('.claude-plugin', 'marketplace.json');
const copilotHooks = json('plugins', 'forge', 'com.github.copilot', 'hooks', 'hooks.json');
const claudeHooks = json('plugins', 'forge', 'hooks', 'hooks.json');

function scratch(t) {
  const root = mkdtempSync(path.join(os.tmpdir(), 'forge-pack-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  return root;
}

const hookEnv = (root, extra) => ({ ...process.env, FORGE_WIKI_ROOT: '', FORGE_DATA_DIR: root, CLAUDECODE: '', ...extra });

test('the manifest and both marketplaces have the same name and version', () => {
  assert.equal(manifest.$schema, 'https://agent-plugins.org/schemas/1.0.0/plugin.schema.json', 'The manifest names the Agent Plugins schema.');
  assert.equal(path.basename(pluginDir), manifest.name, 'Claude Code takes the plugin name from the folder name.');
  assert.ok(!existsSync(path.join(pluginDir, '.claude-plugin')), 'Keep one manifest: Claude Code gets the version from the marketplace entry.');
  for (const market of [copilotMarket, claudeMarket]) {
    assert.equal(market.metadata.version, manifest.version);
    assert.equal(market.plugins.length, 1);
    const [entry] = market.plugins;
    assert.equal(entry.name, manifest.name);
    assert.equal(entry.version, manifest.version);
  }
  const strip = ({ plugins, ...rest }) => ({ ...rest, plugins: plugins.map(({ source, ...p }) => p) });
  assert.deepEqual(strip(claudeMarket), strip(copilotMarket), 'The two marketplaces differ only in the source format.');
});

test('each marketplace source resolves to the plugin folder', () => {
  const source = claudeMarket.plugins[0].source;
  assert.match(source, /^\.\//, 'Claude Code needs a source that starts with ./');
  assert.ok(!source.split('/').includes('..'), 'Claude Code refuses .. in a source.');
  for (const s of [source, copilotMarket.plugins[0].source]) assert.equal(path.resolve(repo, s), pluginDir);
});

test('the Copilot hook runs the CLI and gives the full context with the end marker', (t) => {
  const root = scratch(t);
  assert.equal(copilotHooks.version, 1);
  const [hook, ...more] = copilotHooks.hooks.sessionStart;
  assert.equal(more.length, 0);
  assert.equal(hook.type, 'command');
  assert.ok(hook.timeoutSec > 0);
  assert.match(hook.command, /\$\{PLUGIN_ROOT\}/);
  const command = hook.command.replaceAll('${PLUGIN_ROOT}', pluginDir.replaceAll('\\', '/'));
  const result = spawnSync(command, { shell: true, input: JSON.stringify({ cwd: root }), encoding: 'utf8', env: hookEnv(root), cwd: root });
  assert.equal(result.status, 0, result.stderr);
  const text = JSON.parse(result.stdout).additionalContext;
  assert.ok(text.includes(pluginDir.replaceAll('\\', '/')) || text.includes(pluginDir), 'The context gives the plugin path.');
  assert.ok(text.endsWith(`\n\n${END_MARKER}`));
});

test('the Claude hooks ask for each context part and give each part under the Claude limit', (t) => {
  const root = scratch(t);
  const [start, ...more] = claudeHooks.hooks.SessionStart;
  assert.equal(more.length, 0);
  assert.equal(start.matcher, 'startup|resume|clear|compact|fork');
  const parts = start.hooks.map((h) => h.args.at(h.args.indexOf('--part') + 1));
  assert.deepEqual(parts, Array.from({ length: CLAUDE_PARTS }, (_, i) => String(i + 1)), 'One hook for each part that hook.mjs makes.');
  const [prompt] = claudeHooks.hooks.UserPromptSubmit[0].hooks;
  const outputs = [];
  for (const hook of [...start.hooks, prompt]) {
    assert.equal(hook.type, 'command');
    assert.equal(hook.command, 'node');
    assert.ok(hook.timeout > 0);
    assert.equal(hook.args[0], '${CLAUDE_PLUGIN_ROOT}/scripts/forge.mjs');
    assert.deepEqual(hook.args.slice(hook.args.indexOf('--host'), hook.args.indexOf('--host') + 2), ['--host', 'claude']);
    const args = hook.args.map((a) => a.replaceAll('${CLAUDE_PLUGIN_ROOT}', pluginDir));
    const result = spawnSync(process.execPath, args, { input: JSON.stringify({ cwd: root, prompt: 'hello' }), encoding: 'utf8', env: hookEnv(root, { CLAUDECODE: '1' }), cwd: root });
    assert.equal(result.status, 0, result.stderr);
    outputs.push(JSON.parse(result.stdout));
  }
  const texts = outputs.slice(0, CLAUDE_PARTS).map((o) => o.hookSpecificOutput?.additionalContext).filter(Boolean);
  assert.ok(texts.length >= 1, 'Part 1 always has text.');
  for (const o of outputs.slice(0, texts.length)) assert.equal(o.hookSpecificOutput.hookEventName, 'SessionStart');
  for (const text of texts) assert.ok(text.length <= 10000, `A part has ${text.length} characters.`);
  assert.ok(texts.at(-1).endsWith(`\n\n${END_MARKER}`));
  assert.deepEqual(outputs.at(-1), {}, 'A prompt without a ticket key gives no prompt context.');
});

test('each host has the gate guard as a preToolUse hook for its shell tools, and the command runs', (t) => {
  const root = scratch(t);
  // A command that is not a ship action gives {}, so the normal permission flow of the host continues.
  const event = (extra) => JSON.stringify({ cwd: root, ...extra });
  const [copilot, ...moreCopilot] = copilotHooks.hooks.preToolUse;
  assert.equal(moreCopilot.length, 0);
  assert.equal(copilot.type, 'command');
  assert.equal(copilot.matcher, 'bash|powershell', 'The Copilot matcher is a regex for the full tool name. Without it, the hook runs for each tool.');
  assert.ok(copilot.timeoutSec > 0);
  assert.match(copilot.command, /^node "\$\{PLUGIN_ROOT\}\/scripts\/forge\.mjs" hook pre-tool$/);
  const command = copilot.command.replaceAll('${PLUGIN_ROOT}', pluginDir.replaceAll('\\', '/'));
  const first = spawnSync(command, { shell: true, input: event({ toolName: 'bash', toolArgs: JSON.stringify({ command: 'git status' }) }), encoding: 'utf8', env: hookEnv(root), cwd: root });
  assert.equal(first.status, 0, first.stderr);
  assert.deepEqual(JSON.parse(first.stdout), {});

  const [group, ...moreClaude] = claudeHooks.hooks.PreToolUse;
  assert.equal(moreClaude.length, 0);
  assert.equal(group.matcher, 'Bash|PowerShell');
  const [claude, ...moreHooks] = group.hooks;
  assert.equal(moreHooks.length, 0);
  assert.equal(claude.command, 'node');
  assert.ok(claude.timeout > 0);
  assert.deepEqual(claude.args, ['${CLAUDE_PLUGIN_ROOT}/scripts/forge.mjs', 'hook', 'pre-tool', '--host', 'claude']);
  const args = claude.args.map((a) => a.replaceAll('${CLAUDE_PLUGIN_ROOT}', pluginDir));
  const second = spawnSync(process.execPath, args, { input: event({ tool_name: 'Bash', tool_input: { command: 'git push' } }), encoding: 'utf8', env: hookEnv(root, { CLAUDECODE: '1' }), cwd: root });
  assert.equal(second.status, 0, second.stderr);
  assert.deepEqual(JSON.parse(second.stdout), {}, 'A push outside a ticket worktree is not a ticket step.');
});

test('the hook files hold no live reporter and no activity event', () => {
  assert.doesNotMatch(JSON.stringify(claudeHooks), /live-hook/);
  assert.doesNotMatch(JSON.stringify(copilotHooks), /live-hook/);
  assert.deepEqual(Object.keys(claudeHooks.hooks).sort(), ['PreToolUse', 'SessionEnd', 'SessionStart', 'UserPromptSubmit']);
  for (const groups of Object.values(claudeHooks.hooks)) for (const group of groups) for (const hook of group.hooks) {
    assert.equal(hook.type, 'command');
    assert.equal(hook.args[0], '${CLAUDE_PLUGIN_ROOT}/scripts/forge.mjs');
    assert.equal(hook.async, undefined);
  }
});

test('each host has a session end hook that writes the rule pages seen, prints {}, and never holds the session', (t) => {
  const root = scratch(t);
  // Copilot CLI: one entry.
  const [copilot, ...moreCopilot] = copilotHooks.hooks.sessionEnd;
  assert.equal(moreCopilot.length, 0);
  assert.equal(copilot.type, 'command');
  assert.ok(copilot.timeoutSec > 0 && copilot.timeoutSec <= 10);
  assert.match(copilot.command, /^node "\$\{PLUGIN_ROOT\}\/scripts\/forge\.mjs" hook session-end$/);
  assert.deepEqual(Object.keys(copilotHooks.hooks).sort(), ['preToolUse', 'sessionEnd', 'sessionStart']);
  const command = copilot.command.replaceAll('${PLUGIN_ROOT}', pluginDir.replaceAll('\\', '/'));
  const input = JSON.stringify({ sessionId: 'cp-1', timestamp: 1, cwd: root, reason: 'user_exit' });
  const first = spawnSync(command, { shell: true, input, encoding: 'utf8', env: hookEnv(root), cwd: root });
  assert.deepEqual([first.status, JSON.parse(first.stdout)], [0, {}], first.stderr);

  // Claude Code: one group.
  // All SessionEnd hooks share 1.5 seconds, and the timeout of a plugin hook does not raise that (hooks reference, 2026-11-19).
  const [end, ...moreClaude] = claudeHooks.hooks.SessionEnd;
  assert.equal(moreClaude.length, 0);
  assert.deepEqual(end.hooks, [{ type: 'command', command: 'node', args: ['${CLAUDE_PLUGIN_ROOT}/scripts/forge.mjs', 'hook', 'session-end', '--host', 'claude'], timeout: 2 }]);
  const args = end.hooks[0].args.map((a) => a.replaceAll('${CLAUDE_PLUGIN_ROOT}', pluginDir));
  const payload = JSON.stringify({ hook_event_name: 'SessionEnd', session_id: '11111111-2222-4333-8444-555555555555', cwd: root, reason: 'other' });
  const second = spawnSync(process.execPath, args, { input: payload, encoding: 'utf8', env: hookEnv(root, { CLAUDECODE: '1' }), cwd: root });
  assert.deepEqual([second.status, JSON.parse(second.stdout), second.stderr], [0, {}, '']);
  // A folder that is no repository with a wiki gets no file.
  assert.ok(!existsSync(path.join(root, 'raw')));
});
