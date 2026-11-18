// The pages of one wiki: raw/board.html (board-page.mjs), raw/wiki.html (wiki-page.mjs), and raw/tickets/<folder>/canvas.html (canvas.mjs).
// writeViews() writes them together, so that each link between the pages has a target.
// The pages are views: no approval manifest lists them, and no step reads a fact from them.
import { existsSync, lstatSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { buildBoard } from './board.mjs';
import { BOARD_PAGE, renderBoardPage } from './board-page.mjs';
import { CANVAS_FILE, buildCanvas, writeCanvas } from './canvas.mjs';
import { copyMermaid, needsMermaid } from './mermaid.mjs';
import { ticketRoot } from './tickets.mjs';
import { buildNav } from './ui.mjs';
import { WIKI_PAGE, renderWikiPage } from './wiki-page.mjs';
import { buildWiki, wikiLinks } from './wiki.mjs';

export function boardPageFile(wikiPath) {
  return path.join(wikiPath, 'raw', BOARD_PAGE);
}

export function wikiPageFile(wikiPath) {
  return path.join(wikiPath, 'raw', WIKI_PAGE);
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
 * Writes the board page, the wiki page, and the ticket canvases of a wiki.
 * - `focus` is the folder of one ticket: its canvas is always written, and a read error of that ticket is thrown.
 * - `all` writes the canvas of each ticket when its content changed. Without it, another ticket gets a canvas only when it has none.
 * A ticket that cannot give a canvas is in `failed`, and its links go to its README.
 */
export function writeViews(wikiPath, { links = 'vscode', today, now, focus = '', all = true, dryRun = false } = {}) {
  const board = buildBoard(wikiPath, { today });
  const items = board.groups.flatMap((group) => group.tickets);
  // The wiki model: the pages, the closed tickets, and the pages that each open ticket names.
  const wiki = buildWiki(wikiPath, { board });
  const { closed } = wiki;
  const models = new Map();
  const failed = [];
  for (const item of items) {
    const dir = path.join(ticketRoot(wikiPath), item.folder);
    if (item.folder === focus) { models.set(item.folder, buildCanvas(dir, { now })); continue; }
    if (!all && existsSync(path.join(dir, CANVAS_FILE))) continue;
    try { models.set(item.folder, buildCanvas(dir, { now })); }
    catch (error) { failed.push({ folder: item.folder, message: error.message }); }
  }
  const broken = failed.map((item) => item.folder);
  const written = [];
  let focused = null;
  for (const [folder, model] of models) {
    const dir = path.join(ticketRoot(wikiPath), folder);
    if (dryRun) continue;
    try {
      const result = writeCanvas(dir, { links, model, nav: buildNav(board, { from: folder, broken, closed }), wiki: wikiLinks(wiki, { from: folder, dir }), keep: folder !== focus });
      if (result.written) written.push(folder);
      if (folder === focus) focused = result;
    } catch (error) {
      if (folder === focus) throw error;
      failed.push({ folder, message: error.message });
    }
  }
  const without = failed.map((item) => item.folder);
  const page = writePage(boardPageFile(wikiPath), renderBoardPage(board, { links, wiki: wikiPath, nav: buildNav(board, { broken: without, closed }) }), dryRun);
  const wikiText = renderWikiPage(wiki, { links, nav: buildNav(board, { from: 'wiki', broken: without, closed }) });
  const wikiPage = writePage(wikiPageFile(wikiPath), wikiText, dryRun);
  // A wiki with a diagram block gets the Mermaid file of forge next to its page.
  const mermaid = needsMermaid(wikiText) ? copyMermaid(path.dirname(wikiPage.file), { dryRun }) : null;
  return { board, page, wiki: { ...wikiPage, pages: wiki.pages.length, closed: closed.length, errors: wiki.errors, mermaid }, canvases: { written, failed }, focus: focused };
}
