// The style and the browser script of the ticket canvas (see canvas.mjs). Both go inline into the page,
// so the page needs no network and no other file. The script uses no template literals: it sits in one.
// The tokens, the shared components, and the links between the pages come from the design system (ui.mjs).
// The three message functions below are the one source of the comment message. The page gets their text
// (Copy all), and the canvas server calls them (Send to agent). They use only ES5 and no outer name.
import { UI_SCRIPT, UI_STYLE } from './ui.mjs';

/** One line of plain text: no control character, single spaces, at most max characters. */
export function canvasClean(value, max) {
  var text = String(value === undefined || value === null ? '' : value)
    .replace(/[\u0000-\u001f\u007f-\u009f\u2028\u2029]/g, ' ').replace(/\s+/g, ' ').trim();
  return text.length > max ? text.slice(0, max).trim() + ' [...]' : text;
}

/** The parts of one comment line: { where, quote, say }, or null when the comment says nothing. */
export function canvasLine(item) {
  var labels = ['unclear', 'wrong', 'too much'];
  var section = canvasClean(item.section, 200);
  var title = canvasClean(item.title, 200);
  var where = canvasClean(item.file, 200) + ', ' + section;
  if (title && title !== section) where += ', "' + title + '"';
  var quote = canvasClean(item.quote, 20000).replace(/"/g, "'");
  if (quote.length > 240) quote = quote.slice(0, 160).trim() + ' [...] ' + quote.slice(-60).trim();
  var text = canvasClean(item.text, 2000);
  var label = labels.indexOf(item.label) >= 0 ? item.label : '';
  var say = item.kind === 'remove' ? 'remove this' + (text ? '. ' + text : '') : (label ? '[' + label + ']' + (text ? ' ' : '') : '') + text;
  return say ? { where: where, quote: quote, say: say } : null;
}

/** The message that the ticket session gets. The ticket skill names its first line. */
export function canvasMessage(key, items, general) {
  var lines = ['Canvas comments for ' + canvasClean(key, 80) + ':'];
  (items || []).forEach(function (item) {
    var line = canvasLine(item || {});
    if (line) lines.push(lines.length + '. ' + line.where + (line.quote ? ', on "' + line.quote + '"' : '') + ': ' + line.say);
  });
  var whole = canvasClean(general, 4000);
  if (whole) lines.push(lines.length + '. Whole ticket: ' + whole);
  return lines.join('\n');
}

// The page gets the source text of the functions. The line ends are LF, as in the rest of the script.
const MESSAGE_SOURCE = [canvasClean, canvasLine, canvasMessage].map((fn) => fn.toString().replace(/\r\n?/g, '\n')).join('\n');

export const CANVAS_STYLE = UI_STYLE + String.raw`
html, body { height: 100%; }
body { display: flex; flex-direction: column; overflow: hidden; }

#rail { flex: none; }
#rail .bar { padding-bottom: 2px; }
.sub { display: flex; flex-wrap: wrap; align-items: center; gap: 6px var(--s-5); padding: 4px var(--s-4) var(--s-2); }
.gates { display: flex; flex-wrap: wrap; align-items: center; gap: 4px 0; list-style: none; margin: 0; padding: 0; }
.gates li { position: relative; padding: 1px 10px; font-size: var(--t-sm); white-space: nowrap; color: var(--muted); background: var(--card); border: 1px solid var(--line); border-radius: var(--r-pill); }
.gates li + li { margin-left: 16px; }
.gates li + li::before { content: ""; position: absolute; right: calc(100% + 1px); top: 50%; width: 16px; border-top: 2px solid var(--line); }
.gates li.g-approved + li::before { border-color: color-mix(in srgb, var(--green) 60%, var(--line)); }
.gates small { font-size: var(--t-xs); }
.gates li.g-approved { color: var(--green); border-color: color-mix(in srgb, var(--green) 60%, var(--line)); }
.gates li.g-in-review { color: var(--ink); font-weight: 600; border-color: var(--amber); background: color-mix(in srgb, var(--amber) 20%, var(--card)); }
.gates li.g-blocked { color: var(--red); border-color: var(--red); }
.next { flex: 1 1 0; min-width: 200px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.next span { font-size: var(--t-sm); color: var(--muted); }
.next a { margin-left: var(--s-2); font-size: var(--t-sm); }
#rail nav { display: flex; flex-wrap: wrap; gap: 2px; align-items: center; }
#rail nav button[aria-current="true"] { color: var(--ink); font-weight: 600; background: color-mix(in srgb, var(--accent) 16%, transparent); }
.views { display: flex; flex-wrap: wrap; align-items: center; gap: 2px; }
.views span { margin-right: var(--s-1); font-size: var(--t-sm); color: var(--muted); }
.views button { padding: 0 10px; font-size: var(--t-sm); }
#comment-count { font-weight: 600; }
#tray-toggle.has { border-color: var(--amber); background: color-mix(in srgb, var(--amber) 14%, var(--card)); }

#stage { flex: 1; position: relative; min-height: 0; display: flex; }
#viewport { flex: 1; position: relative; overflow: hidden; cursor: grab; touch-action: none; }
#viewport.dragging { cursor: grabbing; user-select: none; }
#board { --s: 1; position: absolute; left: 0; top: 0; transform-origin: 0 0; display: flex; align-items: flex-start; gap: 56px; padding: 48px; width: max-content; }
@media (prefers-reduced-motion: no-preference) { #board.moving { transition: transform 0.25s ease; } }
.zoomer { flex: none; display: flex; align-items: center; gap: 2px; margin-left: auto; }
.zoomer button { padding: 0 8px; font-size: var(--t-sm); }
#zoom-level { min-width: 44px; text-align: center; }
.column { display: flex; flex-direction: column; gap: 56px; }
.zone { width: 560px; background: var(--panel); border: 1px solid var(--line); border-radius: var(--r-3); padding: 18px 20px 22px; cursor: default; }
.z-code, .z-plan { width: 1180px; }
.zone > .card, .zone > .row, .zone > .unit { max-width: 100%; }
.zgate { margin-left: 8px; font-size: var(--t-sm); font-weight: 400; color: var(--muted); white-space: nowrap; }
.zgate.g-approved { color: var(--green); }
.zgate.g-in-review { color: var(--ink); font-weight: 600; }
.zgate.g-blocked { color: var(--red); }
body.view-focus .zone.z-now { border-color: var(--accent); box-shadow: 0 0 0 1px var(--accent); }
.zone > h2 { margin: 0 0 14px; font-size: var(--t-2xl); line-height: 1.2; cursor: pointer; transform-origin: 0 100%; }
.src { margin-left: 8px; font-size: var(--t-sm); font-weight: 400; color: var(--muted); }
h4.group { margin: 18px 0 8px; font-size: var(--t-xs); font-weight: 600; text-transform: uppercase; letter-spacing: 0.07em; color: var(--muted); }
.empty { color: var(--muted); font-style: italic; margin: 0; }

.card, .node { position: relative; background: var(--card); border: 1px solid var(--line); border-radius: var(--r-2); padding: 12px 14px; margin: 0 0 12px; }
.card > h3, .node > h3 { margin: 0 0 6px; font-size: 16px; line-height: 1.3; }
.k-summary { border: 2px solid var(--accent); }
.k-summary > h3 { font-size: 18px; }
.body > :first-child { margin-top: 0; }
.body > :last-child { margin-bottom: 0; }
.body p, .body ul, .body ol, .body pre, .body table, .body blockquote, .body h4 { margin: 0 0 8px; }
.body ul, .body ol { padding-left: 20px; }
.body li { margin: 2px 0; }
.body h4 { font-size: 14px; }
pre { overflow: auto; max-height: 320px; padding: 8px 10px; background: color-mix(in srgb, var(--muted) 12%, transparent); border-radius: var(--r-1); }
pre code { background: none; padding: 0; overflow-wrap: normal; }
table { border-collapse: collapse; font-size: 14px; }
th, td { border: 1px solid var(--line); padding: 3px 8px; text-align: left; vertical-align: top; }
blockquote { border-left: 3px solid var(--line); padding-left: 10px; color: var(--muted); }
.badge { float: right; margin-left: 8px; padding: 1px 8px; font-size: var(--t-xs); font-weight: 600; white-space: nowrap; color: var(--muted); border: 1px solid var(--line); border-radius: var(--r-pill); }
.file { font-size: var(--t-sm); color: var(--muted); overflow-wrap: anywhere; }

.row { display: flex; flex-wrap: wrap; gap: 12px; align-items: flex-start; }
.row > .card { width: 272px; margin: 0; }
.zone:not(.z-code):not(.z-plan) .row > .card { width: 100%; }
.row.path { gap: 14px 36px; }
.row.path > .card { width: calc((100% - 72px) / 3); }
.row.path > .card + .card::before { content: "\2192"; position: absolute; left: -29px; top: 9px; font-size: 20px; color: var(--muted); }
.row.path > .card:nth-child(3n+1)::before { content: none; }

.k-step, .k-check, .k-hypothesis, .k-person, .k-question { border-left-width: 5px; }
.s-done, .s-verified, .s-supported { border-left-color: var(--green); }
.s-done > h3 .badge, .s-verified > h3 .badge { color: var(--green); border-color: var(--green); }
.s-failed { border-left-color: var(--red); }
.s-gap { border-left-style: dashed; border-left-color: var(--muted); }
.s-rejected > h3, .s-rejected > .body { color: var(--muted); }
.k-question, .s-to-contact, .s-drafted, .s-follow-up, .s-reply-in { border-left-color: var(--amber); }
.k-entry.s-decision { border-left: 5px solid var(--accent); }
.k-entry.s-problem { border-left: 5px solid var(--red); }

.graph { position: relative; margin: 8px 0 6px; }
.lanes { display: flex; gap: 84px; align-items: flex-start; }
.lane { flex: 1 1 210px; min-width: 210px; max-width: 330px; display: flex; flex-direction: column; gap: 24px; }
.lane > h4 { margin: 0; padding-bottom: 6px; text-align: center; font-size: var(--t-xs); text-transform: uppercase; letter-spacing: 0.07em; color: var(--muted); border-bottom: 1px dashed var(--line); }
.node { margin: 0; z-index: 1; cursor: pointer; }
.graph.focus .node { opacity: 0.45; }
.graph.focus .node.on { opacity: 1; }
.node.c-planned { border: 2px solid var(--amber); }
.node.c-planned .badge { color: var(--amber); border-color: var(--amber); }
.node.c-done { border: 2px solid var(--green); }
.node.c-done .badge { color: var(--green); border-color: var(--green); }
svg.edges { position: absolute; left: 0; top: 0; width: 100%; height: 100%; overflow: visible; pointer-events: none; z-index: 0; }
svg.labels { position: absolute; left: 0; top: 0; width: 100%; height: 100%; overflow: visible; pointer-events: none; z-index: 2; }
svg.edges path.edge { fill: none; stroke: var(--muted); stroke-width: 1.6; opacity: 0.6; }
svg.edges marker path { fill: context-stroke; }
.graph.focus path.edge { opacity: 0.12; }
.graph.focus path.edge.on { opacity: 1; stroke: var(--accent); stroke-width: 2.4; }
svg.labels text { display: none; font-size: 13px; font-weight: 600; fill: var(--ink); paint-order: stroke; stroke: var(--panel); stroke-width: 6px; stroke-linejoin: round; }
svg.labels text.on { display: block; }
.edge-list { margin: 8px 0 0; padding-left: 20px; font-size: var(--t-sm); color: var(--muted); }
.graph.drawn + .edge-list { display: none; }

.ctools { position: absolute; right: 8px; bottom: 6px; display: flex; gap: 4px; opacity: 0; }
.ctools button { padding: 0 8px; font-size: var(--t-xs); }
.card:hover > .ctools, .node:hover > .ctools, .unit:hover > .ctools, .ctools:focus-within { opacity: 1; }
.unit > .ctools { right: 0; top: 0; bottom: auto; }
@media (hover: none) { .ctools { position: static; justify-content: flex-end; margin: 8px 0 0; opacity: 0.8; } }

/* A folded card is a title strip: one line with the title, the tier, and the size. A step keeps its place on the path. */
.unit { position: relative; }
.unit > h3 { margin: 18px 0 8px; font-size: var(--t-xs); font-weight: 600; text-transform: uppercase; letter-spacing: 0.07em; color: var(--muted); }
.meta { display: none; float: right; margin-left: 8px; font-size: var(--t-xs); font-weight: 400; color: var(--muted); white-space: nowrap; }
.folded { cursor: pointer; }
.folded > .body, .folded > .comments, .folded > .editor, .folded > .ctools, .folded > .graph, .folded > .edge-list, .tucked { display: none; }
.folded:not(.k-step) { margin: 0 0 2px; padding: 3px 10px; border-radius: 3px; background: transparent; border-top-color: transparent; border-right-color: transparent; border-bottom-color: transparent; }
.folded:not(.k-step) > h3 { margin: 0; font-size: var(--t-sm); font-weight: 500; line-height: 1.5; text-transform: none; letter-spacing: 0; color: var(--muted); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.folded > h3::before, .bundle::before { content: "\25B8"; margin-right: 6px; color: var(--muted); }
.folded:not(.k-step) > h3 > .meta, .bundle > .meta { display: inline; }
.folded:not(.k-step):hover, .bundle:hover { background: color-mix(in srgb, var(--muted) 12%, transparent); }
.folded:hover > h3 { color: var(--ink); }
.folded:focus-visible { outline: 2px solid var(--accent); outline-offset: 1px; }
.k-step.folded > h3 { margin: 0; }
.row:not(.path) > .folded { order: 1; margin: 0; }
/* In a wide part, an open card of a row takes the free width, so a card to read has lines of a normal length. */
.z-code .row:not(.path) > .card:not(.folded), .z-plan .row:not(.path) > .card:not(.folded) { flex: 1 1 272px; max-width: 560px; }
.row > .bundle { order: 2; margin: 0; }
.bundle { display: block; width: 100%; margin: 0 0 2px; padding: 3px 10px; text-align: left; font-size: var(--t-sm); font-weight: 500; line-height: 1.5; color: var(--muted); background: transparent; border: 1px dashed var(--line); }
.zone > .bundle { margin-top: 10px; }
.has-comments { box-shadow: 0 0 0 2px var(--amber); }
.comments { list-style: none; margin: 10px 0 0; padding: 0; }
.comments li { display: flex; gap: 8px; align-items: flex-start; margin: 0 0 6px; padding: 6px 8px; border-left: 3px solid var(--amber); background: color-mix(in srgb, var(--amber) 12%, transparent); border-radius: 0 6px 6px 0; }
.comments span { flex: 1; white-space: pre-wrap; overflow-wrap: anywhere; }
.comments li.rm { border-left-color: var(--red); background: color-mix(in srgb, var(--red) 10%, transparent); }
.comments q, .editor q, #tray-list q { display: block; font-size: var(--t-sm); color: var(--muted); overflow-wrap: anywhere; }
.comments button { padding: 0 6px; font-size: var(--t-xs); }
.editor { margin-top: 10px; }
.editor textarea, #copy-fallback, #general { width: 100%; font: inherit; color: inherit; background: var(--card); border: 1px solid var(--line); border-radius: var(--r-1); padding: 6px 8px; resize: vertical; }
.editor div { display: flex; flex-wrap: wrap; gap: 6px; margin-top: 6px; }
.chips button, #pop button { padding: 0 8px; font-size: var(--t-sm); }
#pop { position: fixed; z-index: 6; display: flex; gap: 4px; padding: 4px; background: var(--rail); border: 1px solid var(--line); border-radius: 8px; box-shadow: var(--sh-2); }

/* The far view is a map: each card shows its title in a large size and its state as a tint. */
.far svg.labels, .far .card > h3, .far .node > h3, .far .card > .body, .far .node > .body, .far h4.group, .far .src, .far .lane > h4, .far .ctools, .far .unit > h3, .far .bundle, .far .zgate, .far .comments, .far .editor, .far .row.path > .card + .card::before { visibility: hidden; }
.far .card, .far .node { overflow: hidden; }
.far .card::after, .far .node::after { content: attr(data-title); position: absolute; left: 12px; top: 9px; width: calc((100% - 22px) / var(--s)); max-height: calc((100% - 12px) / var(--s)); overflow: hidden; transform: scale(var(--s)); transform-origin: 0 0; font-size: 15px; font-weight: 600; line-height: 1.25; overflow-wrap: break-word; }
/* Whole lines only: a line that does not fit is not shown in part. */
@supports (height: round(down, 10px, 1lh)) { .far .card::after, .far .node::after { max-height: max(1lh, round(down, calc((100% - 12px) / var(--s)), 1lh)); } }
.far .node::after { font-size: 13px; }
/* On the map, a title strip is a thin line without words: the cards to read stand out. */
.far .folded:not(.k-step)::after { content: none; }
/* A folded step has the height of one line. On the map it needs the height of one line of the large title. */
.far .k-step.folded { min-height: 76px; }
.far .folded:not(.k-step) { border-top-color: var(--line); border-right-color: var(--line); border-bottom-color: var(--line); }
.far .s-done, .far .s-verified, .far .s-supported, .far .node.c-done { background: color-mix(in srgb, var(--green) 16%, var(--card)); }
.far .s-failed, .far .k-entry.s-problem { background: color-mix(in srgb, var(--red) 16%, var(--card)); }
.far .k-question, .far .node.c-planned, .far .s-to-contact, .far .s-drafted, .far .s-follow-up, .far .s-reply-in { background: color-mix(in srgb, var(--amber) 16%, var(--card)); }
.far .s-rejected::after { color: var(--muted); text-decoration: line-through; }
.far .zone > .empty { transform: scale(var(--s)); transform-origin: 0 0; white-space: nowrap; margin-bottom: calc(1.5em * (var(--s) - 1)); }
.far #board { user-select: none; }
.far .zone > h2 { transform: scale(var(--s)); white-space: nowrap; }
.far .zone, .far .card, .far .node { cursor: zoom-in; }

#tray { position: absolute; right: var(--s-3); top: var(--s-3); z-index: 4; width: 380px; max-width: calc(100% - 24px); max-height: calc(100% - 24px); overflow: auto; padding: 14px 16px; background: var(--rail); border: 1px solid var(--line); border-radius: var(--r-3); box-shadow: var(--sh-2); }
#tray h2 { margin: 0 0 4px; font-size: 16px; }
.hint { margin: 0 0 8px; font-size: var(--t-sm); color: var(--muted); }
#tray-list { margin: 0 0 10px; padding-left: 22px; }
#tray-list li { margin-bottom: 8px; cursor: pointer; overflow-wrap: anywhere; }
#tray-list small { display: block; color: var(--muted); }
#tray label { display: block; margin: 0 0 4px; font-size: var(--t-sm); color: var(--muted); }
#general { margin: 0 0 10px; }
.tray-tools { display: flex; flex-wrap: wrap; gap: 6px; }
#send-all { color: var(--card); background: var(--accent); border-color: var(--accent); font-weight: 600; }
#copy-fallback { margin-top: 8px; font: 13px/1.4 var(--mono); }
#live-toggle { border-color: color-mix(in srgb, var(--st, var(--muted)) 60%, var(--line)); }
#live { flex: none; order: -1; width: 400px; max-width: 45%; overflow: auto; padding: 14px 16px; background: var(--rail); border-right: 1px solid var(--line); }
@media (max-width: 760px) { #live { position: absolute; left: var(--s-3); top: var(--s-3); z-index: 4; max-width: calc(100% - 24px); max-height: calc(100% - 24px); border: 1px solid var(--line); border-radius: var(--r-3); box-shadow: var(--sh-2); } }
#live h2 { display: flex; justify-content: space-between; align-items: center; margin: 0 0 4px; font-size: 16px; }
.lv-session + .lv-session { margin-top: var(--s-4); padding-top: var(--s-3); border-top: 1px solid var(--line); }
.lv-session h3 { margin: 0 0 6px; font-size: var(--t-md); font-weight: 600; overflow-wrap: anywhere; }
.lv-prompt { margin: var(--s-2) 0 0; padding-left: var(--s-2); color: var(--muted); border-left: 3px solid var(--line-2); overflow-wrap: anywhere; }
.lv-tree { list-style: none; margin: 6px 0 0; padding: 0; font-size: var(--t-sm); }
.lv-tree .lv-tree { margin: 2px 0 2px 7px; padding-left: 12px; border-left: 1px solid var(--line-2); }
.lv-item { padding: 1px 0; overflow-wrap: anywhere; }
.lv-item > .lv-name { font: 600 var(--t-sm)/1.4 var(--mono); }
.lv-item > .lv-name::before { content: ""; display: inline-block; width: 7px; height: 7px; margin-right: 7px; background: var(--line-2); border-radius: 50%; }
.lv-i-running > .lv-name::before { background: var(--accent); animation: lv-pulse 1.6s ease-in-out infinite; }
.lv-i-failed > .lv-name::before { background: var(--red); }
.lv-i-done > .lv-name { font-weight: 400; color: var(--muted); }
.lv-k-agent > .lv-name { color: var(--violet); }
.lv-label { margin: 0 6px; font-family: var(--mono); }
.lv-i-done > .lv-label { color: var(--muted); }
.lv-i-failed > .lv-age { color: var(--red); }
.lv-text { display: block; margin: var(--s-2) 0 0; overflow-wrap: anywhere; }
.lv-item > .lv-text { margin: 2px 0 2px 14px; color: var(--muted); }
.lv-text::before, .lv-text::after { content: none; }
.lv-more { margin: 4px 0 0; font-size: var(--t-xs); color: var(--muted); }
@media (prefers-reduced-motion: reduce) { .lv-i-running > .lv-name::before { animation: none; } }
#foot { flex: none; align-items: center; }
#foot p { min-width: 0; }
`;

export const CANVAS_SCRIPT = String.raw`
(function () {
  'use strict';
${MESSAGE_SOURCE}
  var data = JSON.parse(document.getElementById('canvas-data').textContent);
${UI_SCRIPT}
  var viewport = document.getElementById('viewport');
  var board = document.getElementById('board');
  var tray = document.getElementById('tray');
  var pop = document.getElementById('pop');
  var picked = null;
  var prefix = 'forge-canvas:' + data.key + ':';
  var store = {
    get: function (name, fallback) {
      try { var raw = localStorage.getItem(prefix + name); return raw ? JSON.parse(raw) : fallback; } catch (error) { return fallback; }
    },
    set: function (name, value) {
      try { localStorage.setItem(prefix + name, JSON.stringify(value)); } catch (error) { /* The storage is off: the page still works. */ }
    }
  };
  var MIN = 0.1, MAX = 2, FAR = 0.5;
  var view = { x: 0, y: 0, k: 1 };

  function offsetWithin(el, root) {
    var x = 0, y = 0, node = el;
    while (node && node !== root) { x += node.offsetLeft; y += node.offsetTop; node = node.offsetParent; }
    return { left: x, top: y, width: el.offsetWidth, height: el.offsetHeight };
  }

  function hidePop() { pop.hidden = true; picked = null; }
  function dropSelection() { var sel = window.getSelection ? window.getSelection() : null; if (sel) sel.removeAllRanges(); }
  function hasSelection() { var sel = window.getSelection ? window.getSelection() : null; return !!sel && !sel.isCollapsed; }

  function apply(animate) {
    hidePop();
    board.classList.toggle('moving', !!animate);
    board.style.transform = 'translate(' + view.x + 'px,' + view.y + 'px) scale(' + view.k + ')';
    document.body.classList.toggle('far', view.k < FAR);
    board.style.setProperty('--s', String(Math.min(3.4, Math.max(1, 0.75 / view.k))));
    document.getElementById('zoom-level').textContent = Math.round(view.k * 100) + '%';
    store.set('view', view);
    if (!zoneTimer) zoneTimer = requestAnimationFrame(markZone);
  }

  // The part name in the rail that agrees with the middle of the view. A far view shows all parts, so it marks none.
  var zoneTimer = 0;
  function markZone() {
    zoneTimer = 0;
    var cx = (viewport.clientWidth / 2 - view.x) / view.k, cy = (viewport.clientHeight / 2 - view.y) / view.k;
    var best = '', least = Infinity;
    if (view.k >= FAR) each(document.querySelectorAll('.zone'), function (zone) {
      var rect = offsetWithin(zone, board);
      var dx = Math.max(rect.left - cx, 0, cx - rect.left - rect.width), dy = Math.max(rect.top - cy, 0, cy - rect.top - rect.height);
      if (dx * dx + dy * dy < least) { least = dx * dx + dy * dy; best = zone.id; }
    });
    each(document.querySelectorAll('[data-goto]'), function (button) {
      if (button.getAttribute('data-goto') === best) button.setAttribute('aria-current', 'true'); else button.removeAttribute('aria-current');
    });
  }

  function zoomAt(cx, cy, factor, animate) {
    var k = Math.min(MAX, Math.max(MIN, view.k * factor));
    view.x = cx - (cx - view.x) * (k / view.k);
    view.y = cy - (cy - view.y) * (k / view.k);
    view.k = k;
    apply(animate);
  }

  function fitAll(animate) {
    var pad = 20;
    var k = Math.min(1, (viewport.clientWidth - pad * 2) / board.offsetWidth, (viewport.clientHeight - pad * 2) / board.offsetHeight);
    view.k = Math.max(MIN, k);
    view.x = (viewport.clientWidth - board.offsetWidth * view.k) / 2;
    view.y = Math.max(pad, (viewport.clientHeight - board.offsetHeight * view.k) / 2);
    apply(animate);
  }

  // Shows one zone or card at a size that the user can read, with its top in view.
  function goTo(el, animate) {
    var rect = offsetWithin(el, board);
    var k = Math.min(1, Math.max(0.62, (viewport.clientWidth - 48) / rect.width));
    view.k = k;
    view.x = rect.width * k <= viewport.clientWidth - 48 ? (viewport.clientWidth - rect.width * k) / 2 - rect.left * k : 24 - rect.left * k;
    view.y = 24 - rect.top * k;
    apply(animate);
  }

  viewport.addEventListener('wheel', function (event) {
    event.preventDefault();
    var box = viewport.getBoundingClientRect();
    var unit = event.deltaMode === 1 ? 32 : 1;
    if (event.ctrlKey || event.metaKey) zoomAt(event.clientX - box.left, event.clientY - box.top, Math.exp(-event.deltaY * unit * 0.0022), false);
    else { view.x -= event.deltaX * unit; view.y -= event.deltaY * unit; apply(false); }
  }, { passive: false });

  var drag = null;
  viewport.addEventListener('pointerdown', function (event) {
    var far = document.body.classList.contains('far');
    var blocked = event.target.closest(far ? 'button, a, textarea' : '.card, .node, .folded, button, a, textarea');
    if (event.button === 1 || (event.button === 0 && !blocked)) {
      drag = { x: event.clientX - view.x, y: event.clientY - view.y, moved: false };
      viewport.setPointerCapture(event.pointerId);
      event.preventDefault();
    }
  });
  viewport.addEventListener('pointermove', function (event) {
    if (!drag) return;
    drag.moved = true;
    viewport.classList.add('dragging');
    view.x = event.clientX - drag.x;
    view.y = event.clientY - drag.y;
    apply(false);
  });
  function endDrag() { drag = null; viewport.classList.remove('dragging'); }
  viewport.addEventListener('pointerup', endDrag);
  viewport.addEventListener('pointercancel', endDrag);

  viewport.addEventListener('dblclick', function (event) {
    if (event.target.closest('button, a, textarea, .comments, .editor')) return;
    // In the text of a card, a double-click selects a word for a comment. On a title, it shows the card.
    if (!document.body.classList.contains('far') && event.target.closest('.body')) return;
    var el = event.target.closest('.card, .node, .zone');
    if (el) { dropSelection(); goTo(el, true); }
  });
  board.addEventListener('click', function (event) {
    var title = event.target.closest('.zone > h2');
    if (title && !event.target.closest('a')) goTo(title.parentNode, true);
  });

  document.addEventListener('keydown', function (event) {
    if (event.defaultPrevented || typing(event) || modalOpen() || event.ctrlKey || event.metaKey || event.altKey) return;
    var zones = document.querySelectorAll('.zone');
    var cx = viewport.clientWidth / 2, cy = viewport.clientHeight / 2;
    if (event.key === '0') fitAll(true);
    else if (/^[1-9]$/.test(event.key) && zones[Number(event.key) - 1]) goTo(zones[Number(event.key) - 1], true);
    else if (event.key === '+' || event.key === '=') zoomAt(cx, cy, 1.25, true);
    else if (event.key === '-') zoomAt(cx, cy, 0.8, true);
    else if (event.key === 'ArrowLeft') { view.x += 90; apply(false); }
    else if (event.key === 'ArrowRight') { view.x -= 90; apply(false); }
    else if (event.key === 'ArrowUp') { view.y += 90; apply(false); }
    else if (event.key === 'ArrowDown') { view.y -= 90; apply(false); }
    else if (event.key === 'Escape') { if (pop.hidden) tray.hidden = true; else hidePop(); }
    else if (event.key === 'l' && livePanel) toggleLive();
    else if (event.key === 'v' && viewButtons.length) setView(viewButtons[(viewNames().indexOf(fold.view) + 1) % viewButtons.length].getAttribute('data-view'));
    else return;
    event.preventDefault();
  });

  document.getElementById('zoom-in').addEventListener('click', function () { zoomAt(viewport.clientWidth / 2, viewport.clientHeight / 2, 1.25, true); });
  document.getElementById('zoom-out').addEventListener('click', function () { zoomAt(viewport.clientWidth / 2, viewport.clientHeight / 2, 0.8, true); });
  document.getElementById('zoom-fit').addEventListener('click', function () { fitAll(true); });
  Array.prototype.forEach.call(document.querySelectorAll('[data-goto]'), function (button) {
    button.addEventListener('click', function () {
      var el = document.getElementById(button.getAttribute('data-goto'));
      if (el) goTo(el, true);
    });
  });

  // The arrows of the code map. The script measures the laid-out components, so the lanes can have any height.
  function drawEdges() {
    var ns = 'http://www.w3.org/2000/svg';
    Array.prototype.forEach.call(document.querySelectorAll('.graph'), function (graph, graphIndex) {
      // A folded graph has no size. The next call draws it, after the user opens it.
      if (!graph.offsetWidth) return;
      var svg = graph.querySelector('svg.edges');
      var labels = graph.querySelector('svg.labels');
      while (labels.firstChild) labels.removeChild(labels.firstChild);
      var edges = [];
      try { edges = JSON.parse(graph.getAttribute('data-edges')) || []; } catch (error) { edges = []; }
      while (svg.firstChild) svg.removeChild(svg.firstChild);
      var defs = document.createElementNS(ns, 'defs');
      var marker = document.createElementNS(ns, 'marker');
      var markerId = 'arrow-' + graphIndex;
      marker.setAttribute('id', markerId);
      marker.setAttribute('viewBox', '0 0 10 10');
      marker.setAttribute('refX', '10');
      marker.setAttribute('refY', '5');
      marker.setAttribute('markerWidth', '8');
      marker.setAttribute('markerHeight', '8');
      marker.setAttribute('orient', 'auto');
      var tip = document.createElementNS(ns, 'path');
      tip.setAttribute('d', 'M0,0 L10,5 L0,10 z');
      marker.appendChild(tip);
      defs.appendChild(marker);
      svg.appendChild(defs);
      var outTotal = {}, inTotal = {}, outSeen = {}, inSeen = {};
      edges.forEach(function (edge) { outTotal[edge.from] = (outTotal[edge.from] || 0) + 1; inTotal[edge.to] = (inTotal[edge.to] || 0) + 1; });
      edges.forEach(function (edge) {
        var a = document.getElementById(edge.from), b = document.getElementById(edge.to);
        if (!a || !b) return;
        var ra = offsetWithin(a, graph), rb = offsetWithin(b, graph);
        outSeen[edge.from] = (outSeen[edge.from] || 0) + 1;
        inSeen[edge.to] = (inSeen[edge.to] || 0) + 1;
        var y1 = ra.top + ra.height * outSeen[edge.from] / (outTotal[edge.from] + 1);
        var y2 = rb.top + rb.height * inSeen[edge.to] / (inTotal[edge.to] + 1);
        var x1, x2, bend, d, tx, anchor = 'middle';
        if (rb.left >= ra.left + ra.width - 1) {
          x1 = ra.left + ra.width; x2 = rb.left; bend = (x1 + x2) / 2;
          d = 'M' + x1 + ',' + y1 + ' C' + bend + ',' + y1 + ' ' + bend + ',' + y2 + ' ' + x2 + ',' + y2;
          tx = bend;
        } else if (rb.left + rb.width <= ra.left + 1) {
          x1 = ra.left; x2 = rb.left + rb.width; bend = (x1 + x2) / 2;
          d = 'M' + x1 + ',' + y1 + ' C' + bend + ',' + y1 + ' ' + bend + ',' + y2 + ' ' + x2 + ',' + y2;
          tx = bend;
        } else {
          x1 = ra.left + ra.width; x2 = rb.left + rb.width; bend = Math.max(x1, x2) + 46;
          d = 'M' + x1 + ',' + y1 + ' C' + bend + ',' + y1 + ' ' + bend + ',' + y2 + ' ' + x2 + ',' + y2;
          tx = bend - 6; anchor = 'start';
        }
        var path = document.createElementNS(ns, 'path');
        path.setAttribute('class', 'edge');
        path.setAttribute('d', d);
        path.setAttribute('marker-end', 'url(#' + markerId + ')');
        path.setAttribute('data-from', edge.from);
        path.setAttribute('data-to', edge.to);
        svg.appendChild(path);
        if (edge.label) {
          var label = document.createElementNS(ns, 'text');
          label.setAttribute('x', tx);
          label.setAttribute('y', (y1 + y2) / 2 - 5);
          label.setAttribute('text-anchor', anchor);
          label.setAttribute('data-from', edge.from);
          label.setAttribute('data-to', edge.to);
          label.textContent = edge.label;
          labels.appendChild(label);
        }
      });
      graph.classList.add('drawn');
      focusNode(graph, graph.getAttribute('data-focus') || '');
    });
  }

  // One component at a time: its arrows and their labels stand out, and the other parts fade.
  function focusNode(graph, id) {
    graph.classList.toggle('focus', !!id);
    Array.prototype.forEach.call(graph.querySelectorAll('[data-from]'), function (el) {
      el.classList.toggle('on', !!id && (el.getAttribute('data-from') === id || el.getAttribute('data-to') === id));
    });
    var linked = {};
    Array.prototype.forEach.call(graph.querySelectorAll('path.on'), function (el) { linked[el.getAttribute('data-from')] = true; linked[el.getAttribute('data-to')] = true; });
    Array.prototype.forEach.call(graph.querySelectorAll('.node'), function (el) { el.classList.toggle('on', !!id && (el.id === id || !!linked[el.id])); });
  }
  Array.prototype.forEach.call(document.querySelectorAll('.graph'), function (graph) {
    graph.addEventListener('mouseover', function (event) {
      var node = event.target.closest('.node');
      focusNode(graph, node ? node.id : graph.getAttribute('data-focus') || '');
    });
    graph.addEventListener('mouseleave', function () { focusNode(graph, graph.getAttribute('data-focus') || ''); });
    graph.addEventListener('click', function (event) {
      var node = event.target.closest('.node');
      if (!node || hasSelection() || event.target.closest('button, a, textarea, .comments, .editor')) return;
      graph.setAttribute('data-focus', graph.getAttribute('data-focus') === node.id ? '' : node.id);
      focusNode(graph, graph.getAttribute('data-focus'));
    });
  });

  // The views. A card has a tier: must read, good to know, or AI artifact (data-tier, see TIERS in canvas.mjs).
  // A view opens the cards of its tiers and folds the other cards to a title strip. The user can open or fold each card.
  // The browser keeps the view and these choices for the gate in focus: a new gate starts with its own view again.
  var viewButtons = document.querySelectorAll('[data-view]');
  function viewNames() { return Array.prototype.map.call(viewButtons, function (button) { return button.getAttribute('data-view'); }); }
  function firstFold() { return { view: data.focus ? 'focus' : 'must', gate: data.focus || '', cards: {}, bundles: {} }; }
  var fold = store.get('fold', null);
  if (!fold || fold.gate !== (data.focus || '') || viewNames().indexOf(fold.view) < 0 || !fold.cards || typeof fold.cards !== 'object' || !fold.bundles || typeof fold.bundles !== 'object') fold = firstFold();

  function openByView(el) {
    var tier = el.getAttribute('data-tier');
    if (fold.view === 'all') return true;
    if (fold.view === 'good') return tier !== 'ai';
    if (fold.view === 'must') return tier === 'must';
    // The gate in focus: its cards to read, each exception, and the summary of each part.
    return el.classList.contains('k-summary') || (tier === 'must' && (el.getAttribute('data-gate') === data.focus || el.hasAttribute('data-alert')));
  }

  function layoutFolds() {
    if (!viewButtons.length) return;
    each(document.querySelectorAll('.bundle'), function (el) { el.parentNode.removeChild(el); });
    each(document.querySelectorAll('[data-tier]'), function (el) {
      var open = Object.prototype.hasOwnProperty.call(fold.cards, el.id) ? !!fold.cards[el.id] : openByView(el);
      el.classList.toggle('folded', !open);
      el.classList.remove('tucked');
      if (open) { el.removeAttribute('tabindex'); el.removeAttribute('role'); el.removeAttribute('aria-expanded'); }
      else { el.setAttribute('tabindex', '0'); el.setAttribute('role', 'button'); el.setAttribute('aria-expanded', 'false'); }
    });
    each(document.querySelectorAll('.zone'), function (zone) {
      // A part that is not of the gate in focus shows its cards to read as strips, and the other cards as one line.
      var away = fold.view === 'focus' && !zone.classList.contains('z-now');
      var groups = {}, names = [];
      each(zone.querySelectorAll('.folded'), function (el) {
        if (el.classList.contains('k-step')) return;
        var name = away && el.getAttribute('data-tier') !== 'must' ? 'more' : el.getAttribute('data-bundle') || '';
        if (!name || fold.bundles[zone.id + ':' + name]) return;
        if (!groups[name]) { groups[name] = []; names.push(name); }
        groups[name].push(el);
      });
      names.forEach(function (name) {
        var list = groups[name], words = 0;
        if (list.length < 2) return;
        list.forEach(function (el) { el.classList.add('tucked'); words += Number(el.getAttribute('data-words')) || 0; });
        var button = make('button', 'bundle', list.length + ' ' + name);
        button.type = 'button';
        button.title = 'Show these ' + list.length + ' cards as title strips';
        button.setAttribute('data-bundle-key', zone.id + ':' + name);
        button.appendChild(make('span', 'meta', words + ' w'));
        // The line comes after the cards of its group: at the end of the row of the cards, or of the part.
        (name === 'more' ? zone : list[0].parentNode).appendChild(button);
      });
      // A group title shows only with a card.
      each(zone.querySelectorAll('.row'), function (row) {
        var shown = !!row.querySelector(':scope > :not(.tucked)');
        var title = row.previousElementSibling;
        row.hidden = !shown;
        if (title && title.classList.contains('group')) title.hidden = !shown;
      });
    });
    each(viewButtons, function (button) { button.setAttribute('aria-pressed', button.getAttribute('data-view') === fold.view ? 'true' : 'false'); });
    viewNames().forEach(function (name) { document.body.classList.toggle('view-' + name, name === fold.view); });
    drawEdges();
    if (!zoneTimer) zoneTimer = requestAnimationFrame(markZone);
  }

  function setOpen(el, open) {
    fold.cards[el.id] = open;
    store.set('fold', fold);
    layoutFolds();
  }

  // Opens a folded card, and the folded graph of a component. A link and a comment can name a card that is folded.
  function reveal(el) {
    var changed = false;
    for (var unit = el.closest('[data-tier]'); unit; unit = unit.parentNode.closest('[data-tier]')) {
      if (unit.classList.contains('folded')) { fold.cards[unit.id] = true; changed = true; }
    }
    if (changed) { store.set('fold', fold); layoutFolds(); }
  }

  // A view button starts its view again: the choices for single cards go.
  function setView(name) {
    var current = document.querySelector('[data-goto][aria-current="true"]');
    fold = firstFold();
    fold.view = name;
    store.set('fold', fold);
    layoutFolds();
    var target = name === 'focus' ? byId('zone-' + data.focusZone) : current ? byId(current.getAttribute('data-goto')) : null;
    if (target) goTo(target, true); else fitAll(true);
  }
  each(viewButtons, function (button) { button.addEventListener('click', function () { setView(button.getAttribute('data-view')); }); });

  board.addEventListener('click', function (event) {
    if (document.body.classList.contains('far')) return;
    var bundle = event.target.closest('.bundle');
    if (bundle) { fold.bundles[bundle.getAttribute('data-bundle-key')] = true; store.set('fold', fold); layoutFolds(); return; }
    if (event.target.closest('a, button')) return;
    var el = event.target.closest('.folded');
    if (el) setOpen(el, true);
  });
  board.addEventListener('keydown', function (event) {
    var el = event.target;
    if ((event.key !== 'Enter' && event.key !== ' ') || !el.classList || !el.classList.contains('folded')) return;
    event.preventDefault();
    setOpen(el, true);
    var button = el.querySelector(':scope > .ctools > .fbtn');
    if (button) button.focus();
  });

  // Comments stay in this browser until the user sends them or copies them into the ticket session.
  var LABELS = ['unclear', 'wrong', 'too much'];
  var comments = store.get('comments', []);
  if (!Array.isArray(comments)) comments = [];
  var general = store.get('general', '');
  if (typeof general !== 'string') general = '';
  var generalBox = document.getElementById('general');
  var sendButton = document.getElementById('send-all');
  generalBox.value = general;

  function total() { return comments.length + (general.trim() ? 1 : 0); }
  function showTotal() {
    document.getElementById('comment-count').textContent = String(total());
    document.getElementById('tray-toggle').classList.toggle('has', total() > 0);
  }
  function message() { return canvasMessage(data.key, comments, general); }
  function shortQuote(text) { return text.length > 90 ? text.slice(0, 87) + '...' : text; }

  function saveComments() { store.set('comments', comments); renderComments(); }

  function addComment(el, fields) {
    var comment = { id: el.id, file: el.getAttribute('data-file'), section: el.getAttribute('data-section'), title: el.getAttribute('data-title'), text: fields.text || '' };
    if (fields.quote) comment.quote = fields.quote;
    if (fields.label) comment.label = fields.label;
    if (fields.remove) comment.kind = 'remove';
    if (!canvasLine(comment)) return false;
    comments.push(comment);
    saveComments();
    return true;
  }

  function renderComments() {
    Array.prototype.forEach.call(document.querySelectorAll('[data-file]'), function (el) {
      var old = el.querySelector(':scope > .comments');
      if (old) el.removeChild(old);
      var own = comments.filter(function (comment) { return comment.id === el.id; });
      el.classList.toggle('has-comments', own.length > 0);
      if (!own.length) return;
      var list = make('ul', 'comments');
      own.forEach(function (comment) {
        var line = canvasLine(comment);
        var item = make('li', comment.kind === 'remove' ? 'rm' : '');
        var words = make('span');
        if (line && line.quote) words.appendChild(make('q', '', shortQuote(line.quote)));
        words.appendChild(document.createTextNode(line ? line.say : ''));
        item.appendChild(words);
        var remove = make('button', '', 'Delete');
        remove.type = 'button';
        remove.addEventListener('click', function () { comments.splice(comments.indexOf(comment), 1); saveComments(); });
        item.appendChild(remove);
        list.appendChild(item);
      });
      el.insertBefore(list, el.querySelector(':scope > .editor') || el.querySelector(':scope > .ctools'));
    });
    showTotal();
    var trayList = document.getElementById('tray-list');
    while (trayList.firstChild) trayList.removeChild(trayList.firstChild);
    comments.forEach(function (comment) {
      var line = canvasLine(comment);
      if (!line) return;
      var item = make('li');
      item.appendChild(make('small', '', line.where));
      if (line.quote) item.appendChild(make('q', '', shortQuote(line.quote)));
      item.appendChild(document.createTextNode(line.say));
      item.addEventListener('click', function () { var el = document.getElementById(comment.id); if (el) { reveal(el); goTo(el, true); } });
      trayList.appendChild(item);
    });
    drawEdges();
  }

  // The editor of one card. With a quote, the comment is about the selected words.
  function openEditor(el, quote) {
    var before = '';
    var old = el.querySelector(':scope > .editor');
    if (old) {
      if (!quote) { old.querySelector('textarea').focus(); return; }
      before = old.querySelector('textarea').value;
      el.removeChild(old);
    }
    var box = make('div', 'editor');
    if (quote) box.appendChild(make('q', '', shortQuote(quote)));
    var area = make('textarea');
    area.rows = 3;
    area.value = before;
    area.placeholder = quote ? 'Your comment on these words. Ctrl+Enter saves it.' : 'Your comment on this card. Ctrl+Enter saves it.';
    var chips = make('div', 'chips');
    var label = '';
    var removal = false;
    function press(button, on) { button.setAttribute('aria-pressed', on ? 'true' : 'false'); }
    var labelButtons = LABELS.map(function (name) {
      var button = make('button', '', name);
      button.type = 'button';
      press(button, false);
      button.addEventListener('click', function () {
        label = label === name ? '' : name;
        removal = false;
        press(removeButton, false);
        labelButtons.forEach(function (other) { press(other, other === button && label === name); });
      });
      chips.appendChild(button);
      return button;
    });
    var removeButton = make('button', '', 'Remove this');
    removeButton.type = 'button';
    press(removeButton, false);
    removeButton.addEventListener('click', function () {
      removal = !removal;
      label = '';
      press(removeButton, removal);
      labelButtons.forEach(function (other) { press(other, false); });
    });
    chips.appendChild(removeButton);
    var tools = make('div');
    var save = make('button', '', 'Save');
    var cancel = make('button', '', 'Cancel');
    save.type = 'button';
    cancel.type = 'button';
    function close() { el.removeChild(box); drawEdges(); }
    function keep() {
      var fields = { text: area.value.trim(), quote: quote || '', label: label, remove: removal };
      if (!fields.text && !fields.label && !fields.remove) { toast('Write a comment, or select a label.'); area.focus(); return; }
      close();
      addComment(el, fields);
    }
    save.addEventListener('click', keep);
    cancel.addEventListener('click', close);
    box.addEventListener('keydown', function (event) {
      if (event.key === 'Enter' && (event.ctrlKey || event.metaKey)) keep();
      else if (event.key === 'Escape') { event.stopPropagation(); close(); }
    });
    tools.appendChild(save);
    tools.appendChild(cancel);
    box.appendChild(area);
    box.appendChild(chips);
    box.appendChild(tools);
    el.insertBefore(box, el.querySelector(':scope > .ctools'));
    drawEdges();
    area.focus();
  }

  // The tools of a card show with the pointer on the card: Fold for a card with a tier, and Comment for a part of a ticket file.
  Array.prototype.forEach.call(document.querySelectorAll('[data-file], [data-tier]'), function (el) {
    var tools = make('div', 'ctools');
    if (el.hasAttribute('data-tier') && viewButtons.length) {
      var foldButton = make('button', 'fbtn', 'Fold');
      foldButton.type = 'button';
      foldButton.title = 'Show only the title of this card';
      foldButton.addEventListener('click', function () { setOpen(el, false); el.focus(); });
      tools.appendChild(foldButton);
    }
    if (el.hasAttribute('data-file')) {
      var button = make('button', 'cbtn', 'Comment');
      button.type = 'button';
      button.addEventListener('click', function () { openEditor(el, ''); });
      tools.appendChild(button);
    }
    el.appendChild(tools);
  });

  // Selected words in one card open a small toolbar: comment on the words, mark them for removal, or give a label.
  function selectionTarget() {
    var sel = window.getSelection ? window.getSelection() : null;
    if (!sel || sel.isCollapsed || !sel.rangeCount) return null;
    var range = sel.getRangeAt(0);
    var node = range.commonAncestorContainer;
    if (node.nodeType !== 1) node = node.parentNode;
    if (!node || !node.closest || node.closest('.comments, .editor, .ctools, .folded')) return null;
    var el = node.closest('[data-file]');
    var quote = canvasClean(sel.toString(), 20000);
    if (!el || !quote) return null;
    return { el: el, quote: quote, rect: range.getBoundingClientRect() };
  }

  function checkSelection() {
    var target = selectionTarget();
    if (!target) { hidePop(); return; }
    picked = target;
    pop.hidden = false;
    var top = target.rect.top - pop.offsetHeight - 6;
    if (top < 4) top = target.rect.bottom + 6;
    var left = Math.min(Math.max(4, target.rect.left), window.innerWidth - pop.offsetWidth - 4);
    pop.style.top = Math.round(top) + 'px';
    pop.style.left = Math.round(Math.max(4, left)) + 'px';
  }

  var pressing = false;
  var selectionTimer = 0;
  document.addEventListener('mousedown', function (event) { if (!event.target.closest('#pop')) pressing = true; });
  document.addEventListener('mouseup', function () { pressing = false; setTimeout(checkSelection, 0); });
  document.addEventListener('selectionchange', function () {
    clearTimeout(selectionTimer);
    if (!pressing) selectionTimer = setTimeout(checkSelection, 350);
  });
  // A press on the toolbar must not remove the selection.
  pop.addEventListener('mousedown', function (event) { event.preventDefault(); });
  pop.addEventListener('click', function (event) {
    var button = event.target.closest('button');
    var target = picked;
    if (!button || !target) return;
    dropSelection();
    hidePop();
    if (button.getAttribute('data-act') === 'comment') openEditor(target.el, target.quote);
    else if (button.getAttribute('data-act') === 'remove') addComment(target.el, { quote: target.quote, remove: true });
    else addComment(target.el, { quote: target.quote, label: button.getAttribute('data-label') });
  });

  generalBox.addEventListener('input', function () {
    general = generalBox.value;
    store.set('general', general);
    showTotal();
  });

  function copyFallback(text) {
    var area = document.getElementById('copy-fallback');
    area.hidden = false;
    area.value = text;
    area.focus();
    area.select();
    var done = false;
    try { done = document.execCommand('copy'); } catch (error) { done = false; }
    toast(done ? 'Copied. Paste it into the ticket session.' : 'Press Ctrl+C to copy the selected text.');
  }

  document.getElementById('copy-all').addEventListener('click', function () {
    if (!total()) { toast('There are no comments yet.'); return; }
    var text = message();
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(text).then(function () { toast('Copied. Paste it into the ticket session.'); }, function () { copyFallback(text); });
    } else copyFallback(text);
  });
  document.getElementById('clear-all').addEventListener('click', function () {
    if (total() && window.confirm('Delete all ' + total() + ' comments?')) {
      comments = [];
      general = '';
      generalBox.value = '';
      store.set('general', general);
      saveComments();
    }
  });
  document.getElementById('tray-toggle').addEventListener('click', function () { tray.hidden = !tray.hidden; });

  // The Live panel: what the sessions of this ticket do now. Only a page of the live server (forge.mjs live) has it.
  // Each text of a session goes into the page as text, never as HTML.
  var livePanel = byId('live');
  function toggleLive() {
    livePanel.hidden = !livePanel.hidden;
    byId('live-toggle').setAttribute('aria-pressed', livePanel.hidden ? 'false' : 'true');
    store.set('live', livePanel.hidden ? 'closed' : 'open');
  }
  function liveRows(items, list, depth) {
    items.forEach(function (item) {
      var state = item.state === 'running' || item.state === 'failed' ? item.state : 'done';
      var row = make('li', 'lv-item lv-i-' + state + (item.kind === 'agent' ? ' lv-k-agent' : ''));
      row.appendChild(make('span', 'lv-name', item.name));
      if (item.label) row.appendChild(make('span', 'lv-label', item.label));
      if (state === 'running') row.appendChild(liveTime(item.start));
      else if (state === 'failed') row.appendChild(make('span', 'lv-age', 'failed'));
      else if (item.ms >= 1000) row.appendChild(make('span', 'lv-age', liveSpan(item.ms)));
      if (item.kind === 'agent') {
        if (item.items && item.items.length && depth < 6) {
          var sub = make('ul', 'lv-tree');
          liveRows(item.items, sub, depth + 1);
          row.appendChild(sub);
        }
        if (item.text && state !== 'running') row.appendChild(make('q', 'lv-text', item.text));
      }
      list.appendChild(row);
    });
  }
  function showLive(state, ok) {
    var body = byId('live-body');
    var hint = byId('live-hint');
    var toggle = byId('live-toggle');
    while (body.firstChild) body.removeChild(body.firstChild);
    var details = state && state.detail ? state.detail : [];
    var worst = 'idle';
    details.forEach(function (one) {
      var session = state.sessions.filter(function (item) { return item.id === one.id; })[0];
      if (!session) return;
      var name = liveState(session.state);
      if (name === 'needs-you' || (name === 'working' && worst !== 'needs-you')) worst = name;
      var part = make('section', 'lv-session');
      part.appendChild(make('h3', '', session.title || session.dir || 'A session without a title'));
      part.appendChild(liveLine(session));
      if (one.prompt) part.appendChild(make('p', 'lv-prompt', one.prompt));
      if (one.items.length) {
        var list = make('ul', 'lv-tree');
        liveRows(one.items, list, 1);
        part.appendChild(list);
      }
      if (one.more) part.appendChild(make('p', 'lv-more', one.more + ' older calls do not show.'));
      if (one.text) part.appendChild(make('q', 'lv-text', one.text));
      body.appendChild(part);
    });
    hint.hidden = ok && body.childNodes.length > 0;
    hint.textContent = !ok ? 'The live server does not answer. The panel shows the last state that it got.'
      : 'No session reports for ' + data.key + ' now. A session shows here after its next prompt or tool call, when it runs in the worktree of the ticket or its title starts with the ticket key.';
    toggle.className = 'lv-' + (body.childNodes.length ? worst : 'idle');
    toggle.firstChild.textContent = body.childNodes.length ? 'Live: ' + LIVE_TEXT[worst] : 'Live';
  }
  if (livePanel) {
    byId('live-toggle').addEventListener('click', toggleLive);
    byId('live-close').addEventListener('click', toggleLive);
    if (store.get('live', 'open') === 'open') toggleLive();
    liveStart(showLive);
  }

  // The canvas server (forge.mjs canvas <key> --serve) puts a token into the page. Only the page of its own ticket can send.
  // A page of the live server cannot send: that server is read-only for a session.
  if (data.token && data.live) {
    document.getElementById('tray-hint').textContent = 'This page comes from the live server, so it cannot send. Use Copy all, and paste the comments into the session of ' + data.key + '.';
  }
  if (data.token && data.home) {
    document.getElementById('tray-hint').textContent = 'This page comes from the session of ' + data.home + ', so it cannot send. Use Copy all, and paste the comments into the session of ' + data.key + '.';
  }
  if (data.token && !data.home && !data.live) {
    sendButton.hidden = false;
    document.getElementById('tray-hint').textContent = 'Select words on a card, or use the Comment button of a card. Then select Send to agent.';
    sendButton.addEventListener('click', function () {
      if (!total()) { toast('There are no comments yet.'); return; }
      sendButton.disabled = true;
      fetch('send', { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Forge-Token': data.token }, body: JSON.stringify({ comments: comments, general: general }) })
        .then(function (response) { if (!response.ok) throw new Error(response.status === 403 ? 'old' : 'refused'); return response.json(); })
        .then(function () {
          comments = [];
          general = '';
          generalBox.value = '';
          store.set('general', general);
          saveComments();
          sendButton.hidden = true;
          document.getElementById('tray-hint').textContent = 'Sent. The ticket session gives you a new link for more comments.';
          setOffline();
          toast('Sent to the session. The server stopped.');
        })
        .catch(function (error) {
          sendButton.disabled = false;
          // The comments stay in the browser, so the new link of the same ticket shows them again.
          toast(error && error.message === 'old' ? 'This page is old. Open the new link from the session, or use Copy all.' : 'The session did not get the comments. Use Copy all.');
        });
    });
  }

  // A link can name one part: canvas.html#zone-plan or canvas.html#plan-step-2.
  function fromHash() {
    var id = '';
    try { id = decodeURIComponent(location.hash.slice(1)); } catch (error) { id = ''; }
    var el = id ? document.getElementById(id) : null;
    if (!el) return false;
    reveal(el);
    goTo(el, false);
    var graph = el.classList.contains('node') ? el.closest('.graph') : null;
    if (graph) { graph.setAttribute('data-focus', el.id); focusNode(graph, el.id); }
    return true;
  }

  // A saved position can be from a board with other open cards. When no part of the board is in view, show the whole board.
  function inSight() {
    var width = board.offsetWidth * view.k, height = board.offsetHeight * view.k;
    return view.x < viewport.clientWidth - 60 && view.x + width > 60 && view.y < viewport.clientHeight - 60 && view.y + height > 60;
  }

  layoutFolds();
  renderComments();
  var saved = store.get('view', null);
  if (fromHash()) { /* The link sets the view. */ }
  else if (saved && isFinite(saved.x) && isFinite(saved.y) && saved.k >= MIN && saved.k <= MAX) { view = { x: saved.x, y: saved.y, k: saved.k }; if (inSight()) apply(false); else fitAll(false); }
  else fitAll(false);
  // A Mermaid block of a card becomes a drawing (drawMermaid in ui.mjs). A drawing changes the size of its card,
  // so the arrows of the code map get their places again. A first view without a saved place shows the whole board again.
  var placed = !!location.hash || !!saved;
  drawMermaid(function () { return board; }, function () { drawEdges(); if (!placed) { placed = true; fitAll(false); } });
  window.addEventListener('hashchange', fromHash);
  if (document.fonts && document.fonts.ready) document.fonts.ready.then(drawEdges);
  window.addEventListener('load', drawEdges);
})();
`;
