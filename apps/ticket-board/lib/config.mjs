import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { splitFrontmatter } from './frontmatter.mjs';

const ITEM_LABEL = { jira: 'Jira', gitlab: 'Issue', github: 'Issue', local: 'Item' };

/** Config folder: --config, else <wiki>/forge/config. */
export function resolveConfigDir(explicit, wiki) {
  if (explicit) return explicit;
  return wiki ? join(wiki, 'forge', 'config') : null;
}

function readHeader(dir, name, errors) {
  const file = dir ? join(dir, `${name}.md`) : null;
  if (!file || !existsSync(file)) return { file: null, data: {} };
  const { data, error } = splitFrontmatter(readFileSync(file, 'utf8'));
  if (error) errors.push(`${file}: ${error}`);
  return { file, data: data ?? {} };
}

/**
 * Board settings from the frontmatter of <config>/tracker.md and <config>/repo.md.
 * forge.mjs config validates the files. The board only reads them, and falls
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