// The folders of one repository, from the path of its wiki. This file is the only place that knows the two layouts.
// - The Forge folder (from Forge 9): ../<repo>.forge with wiki/, raw/, and archive/ next to each other. The wiki is its own git repository.
// - The older folder: ../<repo>.wiki, with raw/ and archive/ inside the wiki and ignored by git. There the Forge folder and the wiki are one folder.
// A wiki folder that the user gives with --wiki follows the same rule: only a folder with the name wiki inside a <name>.forge folder has its raw/ next to it.
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

/** The folder of the working files: the tickets, the board, the pages, the sync notes, and the daily recaps. It stays on this machine. */
export const rawDir = (wikiPath) => path.join(homeOf(wikiPath), 'raw');
/** The folder of the closed ticket folders. It stays on this machine. */
export const archiveDir = (wikiPath) => path.join(homeOf(wikiPath), 'archive');
