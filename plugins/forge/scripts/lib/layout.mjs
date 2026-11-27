// The folders of one repository, from the path of its wiki. This file is the only place that knows where they are.
// The Forge folder is ../<repo>.forge with wiki/, raw/, and archive/ next to each other. The wiki is its own git repository.
// A wiki folder that the user gives with --wiki: only a folder with the name wiki inside a <name>.forge folder has its raw/ next to it.
// Any other folder has raw/ and archive/ inside it, and the Forge folder and the wiki are one folder.
import { existsSync, readdirSync } from 'node:fs';
import path from 'node:path';

export const FORGE_SUFFIX = '.forge';
export const WIKI_NAME = 'wiki';

/** True when the wiki is the wiki/ folder of a Forge folder. */
export function isForgeLayout(wikiPath) {
  const wiki = path.resolve(wikiPath);
  return path.basename(wiki) === WIKI_NAME && path.basename(path.dirname(wiki)).toLowerCase().endsWith(FORGE_SUFFIX);
}

/** The Forge folder of a wiki: the folder that holds raw/ and archive/. */
export function homeOf(wikiPath) {
  const wiki = path.resolve(wikiPath);
  return isForgeLayout(wiki) ? path.dirname(wiki) : wiki;
}

/** The folder of the working files: the tickets, the board, and the pages. It stays on this machine. */
export const rawDir = (wikiPath) => path.join(homeOf(wikiPath), 'raw');
/** The folder of the closed ticket folders. It stays on this machine. */
export const archiveDir = (wikiPath) => path.join(homeOf(wikiPath), 'archive');

/**
 * The wikis of this repository and of the Forge folders next to its Forge folder: each <parent>/*.forge folder with wiki/forge/repo.json (the binding is the proof).
 * The wiki of this repository is first, then the others by name. A wiki from --wiki that is not in a Forge folder gives only itself.
 */
export function siblingWikis(wikiPath) {
  const wiki = path.resolve(wikiPath);
  if (!isForgeLayout(wiki)) return [wiki];
  const home = path.dirname(wiki);
  const parent = path.dirname(home);
  const sameFolder = (a, b) => (process.platform === 'win32' ? path.resolve(a).toLowerCase() === path.resolve(b).toLowerCase() : path.resolve(a) === path.resolve(b));
  let names = [];
  try { names = readdirSync(parent); } catch { /* The parent cannot be read: only this wiki. */ }
  const others = names
    .filter((name) => name.toLowerCase().endsWith(FORGE_SUFFIX) && !sameFolder(path.join(parent, name), home) && existsSync(path.join(parent, name, WIKI_NAME, 'forge', 'repo.json')))
    .sort((a, b) => a.localeCompare(b, 'en') || (a < b ? -1 : a > b ? 1 : 0));
  return [wiki, ...others.map((name) => path.join(parent, name, WIKI_NAME))];
}

/** The name of the repository of a wiki: the name of its Forge folder without .forge. */
export function repoNameOf(wikiPath) {
  const name = path.basename(homeOf(wikiPath));
  return name.toLowerCase().endsWith(FORGE_SUFFIX) ? name.slice(0, -FORGE_SUFFIX.length) : name;
}
