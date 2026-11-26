// The pages of one wiki: raw/board.html (board-page.mjs) and raw/wiki.html (wiki-page.mjs).
// writeViews() writes them together, so that each link between the pages has a target.
// The pages are views: no approval manifest lists them, and no step reads a fact from them.
import { existsSync, lstatSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { buildBoard } from './board.mjs';
import { BOARD_PAGE, renderBoardPage } from './board-page.mjs';
import { rawDir } from './layout.mjs';
import { copyMermaid, needsMermaid } from './mermaid.mjs';
import { buildNav } from './ui.mjs';
import { WIKI_PAGE, renderWikiPage } from './wiki-page.mjs';
import { buildWiki } from './wiki.mjs';

export function boardPageFile(wikiPath) {
  return path.join(rawDir(wikiPath), BOARD_PAGE);
}

export function wikiPageFile(wikiPath) {
  return path.join(rawDir(wikiPath), WIKI_PAGE);
}

// Writes a page when its text changed. A page must be a regular file: a link can point outside of the wiki.
function writePage(file, text, dryRun) {
  let changed = true;
  try { changed = readFileSync(file, 'utf8') !== text; } catch { /* first page */ }
  if (!dryRun && changed) {
    mkdirSync(path.dirname(file), { recursive: true });
    if (existsSync(file) && (lstatSync(file).isSymbolicLink() || !lstatSync(file).isFile())) throw new Error(`${file} must be a regular file, not a link.`);
    writeFileSync(file, text);
  }
  return { file, changed, written: !dryRun && changed };
}

/**
 * Writes the board page and the wiki page of a wiki. `dryRun` writes no file.
 * Gives the board model, the result of each page ({ file, changed, written }), and the wiki facts (pages, closed, errors, mermaid).
 */
export function writeViews(wikiPath, { today, dryRun = false } = {}) {
  const board = buildBoard(wikiPath, { today });
  // The wiki model: the pages, the closed tickets, and the pages that each open ticket names.
  const wiki = buildWiki(wikiPath, { board });
  const { closed } = wiki;
  const page = writePage(boardPageFile(wikiPath), renderBoardPage(board, { nav: buildNav(board, { closed }) }), dryRun);
  const wikiText = renderWikiPage(wiki, { nav: buildNav(board, { from: 'wiki', closed }) });
  const wikiPage = writePage(wikiPageFile(wikiPath), wikiText, dryRun);
  // A wiki page with a diagram block gets the Mermaid file of forge in raw/, next to the board page.
  const mermaid = needsMermaid(wikiText) ? copyMermaid(path.dirname(wikiPage.file), { dryRun }) : null;
  return { board, page, wiki: { ...wikiPage, pages: wiki.pages.length, closed: closed.length, errors: wiki.errors, mermaid } };
}
