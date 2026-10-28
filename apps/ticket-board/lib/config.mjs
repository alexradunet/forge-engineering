import { readFileSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { splitFrontmatter } from './frontmatter.mjs';

const ITEM_LABEL = { jira: 'Jira', gitlab: 'Issue', github: 'Issue', local: 'Item' };

/**
 * Config folder: --config, else <FORGE_HOME>\plugins\forge\config (the live fork checkout),
 * else the config folder next to the board (the plugin copy).
 */
export function resolveConfigDir(explicit, env = process.env) {
  if (explicit) return explicit;
  const home = env.FORGE_HOME && join(env.FORGE_HOME, 'plugins', 'forge', 'config');
  if (home && existsSync(home)) return home;
  return join(dirname(fileURLToPath(import.meta.url)), '..', 'config');
}

function readHeader(dir, name, errors) {
  const file = dir ? join(dir, `${name}.md`) : null;
  if (!file || !existsSync(file)) return { file: null, data: {} };
  const { data, error } = splitFrontmatter(readFileSync(file, 'utf8'));
  if (error) errors.push(`${file}: ${error}`);
  return { file, data: data ?? {} };
}

/**
 * Board settings from the frontmatter of <config>\tracker.md and <config>\repo.md.
 * Get-ForgeConfig.ps1 validates the files. The board only reads them, and falls
 * back to defaults when a file is missing or broken, so that it always starts.
 */
export function loadBoardConfig(configDir) {
  const errors = [];
  const tracker = readHeader(configDir, 'tracker', errors);
  const repo = readHeader(configDir, 'repo', errors);
  const t = tracker.data;
  const r = repo.data;
  const changeName = ['PR', 'MR'].includes(r.changeName) ? r.changeName : r.provider === 'gitlab' ? 'MR' : 'PR';
  return {
    dir: configDir ?? null,
    files: [tracker.file, repo.file].filter(Boolean),
    error: errors.length ? errors.join('; ') : null,
    itemUrl: typeof t.itemUrl === 'string' && /^https?:\/\//.test(t.itemUrl) ? t.itemUrl : null,
    itemLabel: ITEM_LABEL[t.provider] ?? 'Work item',
    changeName,
  };
}

/** Work item URL from the itemUrl template: {KEY} = APP-123, {number} = 123. */
export function itemUrlFor(key, config) {
  if (!config?.itemUrl || !key) return null;
  const number = String(key).split('-').pop();
  return config.itemUrl.replace(/\{KEY\}/g, encodeURIComponent(key)).replace(/\{number\}/g, encodeURIComponent(number));
}