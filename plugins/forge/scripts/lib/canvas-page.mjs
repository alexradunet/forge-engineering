// The style and the browser script of the ticket canvas (see canvas.mjs). Both go inline into the page,
// so the page needs no network and no other file. The script uses no template literals: it sits in one.

export const CANVAS_STYLE = String.raw`
:root { color-scheme: light dark; --bg: #f3f2ee; --panel: #faf9f6; --card: #ffffff; --ink: #1d1d1b; --muted: #68665e; --line: #d8d5cb; --accent: #2a5d8c; --amber: #a86a12; --green: #2a7748; --red: #b03a2a; --rail: #ffffff; }
@media (prefers-color-scheme: dark) {
  :root { --bg: #16171a; --panel: #1d1f23; --card: #25282d; --ink: #e8e6e0; --muted: #9c998f; --line: #3b3e44; --accent: #8fbbe3; --amber: #e2aa4c; --green: #6fc391; --red: #e88a78; --rail: #1d1f23; }
}
* { box-sizing: border-box; }
[hidden] { display: none !important; }
html, body { height: 100%; margin: 0; }
body { display: flex; flex-direction: column; overflow: hidden; font: 15px/1.5 system-ui, -apple-system, "Segoe UI", Roboto, sans-serif; color: var(--ink); background: var(--bg); }
button { font: inherit; color: inherit; background: var(--card); border: 1px solid var(--line); border-radius: 6px; padding: 2px 9px; cursor: pointer; }
button:hover { border-color: var(--accent); }
button:focus-visible, a:focus-visible, textarea:focus-visible { outline: 2px solid var(--accent); outline-offset: 1px; }
a { color: var(--accent); text-underline-offset: 2px; }

#rail { flex: none; display: flex; flex-wrap: wrap; align-items: center; gap: 6px 18px; padding: 8px 14px; background: var(--rail); border-bottom: 1px solid var(--line); z-index: 3; }
#rail .id { font-size: 16px; white-space: nowrap; }
#rail .short { color: var(--muted); }
.gates { display: flex; flex-wrap: wrap; gap: 4px; list-style: none; margin: 0; padding: 0; }
.gates li { padding: 2px 10px; border: 1px solid var(--line); border-radius: 999px; white-space: nowrap; color: var(--muted); }
.gates small { font-size: 12px; }
.gates li.g-approved { color: var(--green); border-color: var(--green); }
.gates li.g-in-review { color: var(--ink); border-color: var(--amber); background: color-mix(in srgb, var(--amber) 20%, transparent); font-weight: 600; }
.gates li.g-blocked { color: var(--red); border-color: var(--red); }
.next { flex: 1 1 260px; min-width: 180px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.next span { color: var(--muted); }
#rail nav, .tools { display: flex; flex-wrap: wrap; gap: 4px; align-items: center; }
#zoom-level { min-width: 44px; text-align: center; color: var(--muted); font-size: 13px; }
#comment-count { font-weight: 600; }

#viewport { flex: 1; position: relative; overflow: hidden; cursor: grab; touch-action: none; }
#viewport.dragging { cursor: grabbing; user-select: none; }
#board { --s: 1; position: absolute; left: 0; top: 0; transform-origin: 0 0; display: flex; align-items: flex-start; gap: 56px; padding: 48px; width: max-content; }
@media (prefers-reduced-motion: no-preference) { #board.moving { transition: transform 0.25s ease; } }
.column { display: flex; flex-direction: column; gap: 56px; }
.zone { width: 560px; background: var(--panel); border: 1px solid var(--line); border-radius: 14px; padding: 18px 20px 22px; cursor: default; }
.z-code, .z-plan { width: 1180px; }
.zone > .card, .zone > .row, .zone > .graph { max-width: 100%; }
.zone > h2 { margin: 0 0 14px; font-size: 26px; line-height: 1.2; cursor: pointer; transform-origin: 0 100%; }
.src { margin-left: 8px; font-size: 13px; font-weight: 400; color: var(--muted); }
h4.group { margin: 18px 0 8px; font-size: 12px; font-weight: 600; text-transform: uppercase; letter-spacing: 0.07em; color: var(--muted); }
.empty { color: var(--muted); font-style: italic; margin: 0; }

.card, .node { position: relative; background: var(--card); border: 1px solid var(--line); border-radius: 10px; padding: 12px 14px; margin: 0 0 12px; }
.card > h3, .node > h3 { margin: 0 0 6px; font-size: 16px; line-height: 1.3; transform-origin: 0 0; }
.k-summary { border: 2px solid var(--accent); }
.k-summary > h3 { font-size: 18px; }
.body > :first-child { margin-top: 0; }
.body > :last-child { margin-bottom: 0; }
.body p, .body ul, .body ol, .body pre, .body table, .body blockquote, .body h4 { margin: 0 0 8px; }
.body ul, .body ol { padding-left: 20px; }
.body li { margin: 2px 0; }
.body h4 { font-size: 14px; }
code { font: 13px/1.4 ui-monospace, SFMono-Regular, Consolas, monospace; background: color-mix(in srgb, var(--muted) 16%, transparent); padding: 1px 4px; border-radius: 4px; overflow-wrap: anywhere; }
pre { overflow: auto; max-height: 320px; padding: 8px 10px; background: color-mix(in srgb, var(--muted) 12%, transparent); border-radius: 6px; }
pre code { background: none; padding: 0; overflow-wrap: normal; }
table { border-collapse: collapse; font-size: 14px; }
th, td { border: 1px solid var(--line); padding: 3px 8px; text-align: left; vertical-align: top; }
blockquote { border-left: 3px solid var(--line); padding-left: 10px; color: var(--muted); }
.badge { float: right; margin-left: 8px; padding: 1px 8px; font-size: 12px; font-weight: 600; white-space: nowrap; color: var(--muted); border: 1px solid var(--line); border-radius: 999px; }
.file { font-size: 13px; color: var(--muted); overflow-wrap: anywhere; }

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
.lane > h4 { margin: 0; padding-bottom: 6px; text-align: center; font-size: 12px; text-transform: uppercase; letter-spacing: 0.07em; color: var(--muted); border-bottom: 1px dashed var(--line); }
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
.edge-list { margin: 8px 0 0; padding-left: 20px; font-size: 13px; color: var(--muted); }
.graph.drawn + .edge-list { display: none; }

.cbtn { position: absolute; right: 8px; bottom: 6px; padding: 0 8px; font-size: 12px; opacity: 0; }
.card:hover > .cbtn, .node:hover > .cbtn, .cbtn:focus-visible { opacity: 1; }
@media (hover: none) { .cbtn { position: static; display: block; margin: 8px 0 0 auto; opacity: 0.8; } }
.has-comments { box-shadow: 0 0 0 2px var(--amber); }
.comments { list-style: none; margin: 10px 0 0; padding: 0; }
.comments li { display: flex; gap: 8px; align-items: flex-start; margin: 0 0 6px; padding: 6px 8px; border-left: 3px solid var(--amber); background: color-mix(in srgb, var(--amber) 12%, transparent); border-radius: 0 6px 6px 0; }
.comments span { flex: 1; white-space: pre-wrap; overflow-wrap: anywhere; }
.comments button { padding: 0 6px; font-size: 12px; }
.editor { margin-top: 10px; }
.editor textarea, #copy-fallback { width: 100%; font: inherit; color: inherit; background: var(--card); border: 1px solid var(--line); border-radius: 6px; padding: 6px 8px; resize: vertical; }
.editor div { display: flex; gap: 6px; margin-top: 6px; }

.far svg.labels, .far .card > .body, .far .node > .body, .far .badge, .far h4.group, .far .src, .far .lane > h4, .far .cbtn, .far .comments, .far .editor, .far .empty, .far .row.path > .card + .card::before { visibility: hidden; }
.far .card, .far .node { overflow: hidden; }
.far .card > h3, .far .node > h3 { transform: scale(var(--s)); width: calc(100% / var(--s)); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.far .zone > h2 { transform: scale(var(--s)); white-space: nowrap; }
.far .zone, .far .card, .far .node { cursor: zoom-in; }

#tray { position: fixed; right: 12px; top: 64px; z-index: 4; width: 380px; max-width: calc(100% - 24px); max-height: calc(100% - 110px); overflow: auto; padding: 14px 16px; background: var(--rail); border: 1px solid var(--line); border-radius: 12px; box-shadow: 0 10px 30px rgba(0, 0, 0, 0.2); }
#tray h2 { margin: 0 0 4px; font-size: 16px; }
.hint { margin: 0 0 8px; font-size: 13px; color: var(--muted); }
#tray-list { margin: 0 0 10px; padding-left: 22px; }
#tray-list li { margin-bottom: 8px; cursor: pointer; overflow-wrap: anywhere; }
#tray-list small { display: block; color: var(--muted); }
.tray-tools { display: flex; gap: 6px; }
#copy-fallback { margin-top: 8px; font: 13px/1.4 ui-monospace, Consolas, monospace; }
#toast { position: fixed; left: 50%; bottom: 44px; z-index: 5; transform: translateX(-50%); padding: 6px 14px; color: var(--bg); background: var(--ink); border-radius: 999px; }
#foot { flex: none; display: flex; gap: 16px; padding: 4px 14px; font-size: 12px; color: var(--muted); background: var(--rail); border-top: 1px solid var(--line); }
#foot p { margin: 0; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
#foot .note { flex: none; color: var(--ink); }
`;

export const CANVAS_SCRIPT = String.raw`
(function () {
  'use strict';
  var data = JSON.parse(document.getElementById('canvas-data').textContent);
  var viewport = document.getElementById('viewport');
  var board = document.getElementById('board');
  var tray = document.getElementById('tray');
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

  function make(tag, className, text) {
    var el = document.createElement(tag);
    if (className) el.className = className;
    if (text !== undefined) el.textContent = text;
    return el;
  }

  function offsetWithin(el, root) {
    var x = 0, y = 0, node = el;
    while (node && node !== root) { x += node.offsetLeft; y += node.offsetTop; node = node.offsetParent; }
    return { left: x, top: y, width: el.offsetWidth, height: el.offsetHeight };
  }

  function apply(animate) {
    board.classList.toggle('moving', !!animate);
    board.style.transform = 'translate(' + view.x + 'px,' + view.y + 'px) scale(' + view.k + ')';
    document.body.classList.toggle('far', view.k < FAR);
    board.style.setProperty('--s', String(Math.min(3.4, Math.max(1, 0.75 / view.k))));
    document.getElementById('zoom-level').textContent = Math.round(view.k * 100) + '%';
    store.set('view', view);
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
    var blocked = event.target.closest(far ? 'button, a, textarea' : '.card, .node, button, a, textarea');
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
    if (event.target.closest('button, a, textarea')) return;
    var el = event.target.closest('.card, .node, .zone');
    if (el) goTo(el, true);
  });
  board.addEventListener('click', function (event) {
    var title = event.target.closest('.zone > h2');
    if (title && !event.target.closest('a')) goTo(title.parentNode, true);
  });

  document.addEventListener('keydown', function (event) {
    if (event.target.closest('textarea, input') || event.ctrlKey || event.metaKey || event.altKey) return;
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
    else if (event.key === 'Escape') tray.hidden = true;
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
      if (!node || event.target.closest('button, a, textarea')) return;
      graph.setAttribute('data-focus', graph.getAttribute('data-focus') === node.id ? '' : node.id);
      focusNode(graph, graph.getAttribute('data-focus'));
    });
  });

  // Comments stay in this browser until the user copies them into the ticket session.
  var comments = store.get('comments', []);
  if (!Array.isArray(comments)) comments = [];

  function toast(text) {
    var el = document.getElementById('toast');
    el.textContent = text;
    el.hidden = false;
    clearTimeout(toast.timer);
    toast.timer = setTimeout(function () { el.hidden = true; }, 3200);
  }

  function place(comment) {
    var where = comment.file + ', ' + comment.section;
    if (comment.title && comment.title !== comment.section) where += ', "' + comment.title + '"';
    return where;
  }

  function message() {
    var lines = ['Canvas comments for ' + data.key + ':'];
    comments.forEach(function (comment, index) {
      lines.push((index + 1) + '. ' + place(comment) + ': ' + comment.text.replace(/\s*\n\s*/g, ' '));
    });
    return lines.join('\n');
  }

  function saveComments() { store.set('comments', comments); renderComments(); }

  function renderComments() {
    Array.prototype.forEach.call(document.querySelectorAll('[data-file]'), function (el) {
      var old = el.querySelector(':scope > .comments');
      if (old) el.removeChild(old);
      var own = comments.filter(function (comment) { return comment.id === el.id; });
      el.classList.toggle('has-comments', own.length > 0);
      if (!own.length) return;
      var list = make('ul', 'comments');
      own.forEach(function (comment) {
        var item = make('li');
        item.appendChild(make('span', '', comment.text));
        var remove = make('button', '', 'Delete');
        remove.type = 'button';
        remove.addEventListener('click', function () { comments.splice(comments.indexOf(comment), 1); saveComments(); });
        item.appendChild(remove);
        list.appendChild(item);
      });
      el.insertBefore(list, el.querySelector(':scope > .cbtn'));
    });
    document.getElementById('comment-count').textContent = String(comments.length);
    var trayList = document.getElementById('tray-list');
    while (trayList.firstChild) trayList.removeChild(trayList.firstChild);
    comments.forEach(function (comment) {
      var item = make('li');
      item.appendChild(make('small', '', place(comment)));
      item.appendChild(document.createTextNode(comment.text));
      item.addEventListener('click', function () { var el = document.getElementById(comment.id); if (el) goTo(el, true); });
      trayList.appendChild(item);
    });
    drawEdges();
  }

  function openEditor(el) {
    var open = el.querySelector(':scope > .editor textarea');
    if (open) { open.focus(); return; }
    var box = make('div', 'editor');
    var area = make('textarea');
    area.rows = 3;
    area.placeholder = 'Your comment on this card. Ctrl+Enter saves it.';
    var tools = make('div');
    var save = make('button', '', 'Save');
    var cancel = make('button', '', 'Cancel');
    save.type = 'button';
    cancel.type = 'button';
    function close() { el.removeChild(box); drawEdges(); }
    function keep() {
      var text = area.value.trim();
      if (text) comments.push({ id: el.id, file: el.getAttribute('data-file'), section: el.getAttribute('data-section'), title: el.getAttribute('data-title'), text: text });
      close();
      saveComments();
    }
    save.addEventListener('click', keep);
    cancel.addEventListener('click', close);
    area.addEventListener('keydown', function (event) {
      if (event.key === 'Enter' && (event.ctrlKey || event.metaKey)) keep();
      else if (event.key === 'Escape') { event.stopPropagation(); close(); }
    });
    tools.appendChild(save);
    tools.appendChild(cancel);
    box.appendChild(area);
    box.appendChild(tools);
    el.insertBefore(box, el.querySelector(':scope > .cbtn'));
    drawEdges();
    area.focus();
  }

  Array.prototype.forEach.call(document.querySelectorAll('[data-file]'), function (el) {
    var button = make('button', 'cbtn', 'Comment');
    button.type = 'button';
    button.addEventListener('click', function () { openEditor(el); });
    el.appendChild(button);
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
    if (!comments.length) { toast('There are no comments yet.'); return; }
    var text = message();
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(text).then(function () { toast('Copied. Paste it into the ticket session.'); }, function () { copyFallback(text); });
    } else copyFallback(text);
  });
  document.getElementById('clear-all').addEventListener('click', function () {
    if (comments.length && window.confirm('Delete all ' + comments.length + ' comments?')) { comments = []; saveComments(); }
  });
  document.getElementById('tray-toggle').addEventListener('click', function () { tray.hidden = !tray.hidden; });

  // A link can name one part: canvas.html#zone-plan or canvas.html#plan-step-2.
  function fromHash() {
    var id = '';
    try { id = decodeURIComponent(location.hash.slice(1)); } catch (error) { id = ''; }
    var el = id ? document.getElementById(id) : null;
    if (!el) return false;
    goTo(el, false);
    var graph = el.classList.contains('node') ? el.closest('.graph') : null;
    if (graph) { graph.setAttribute('data-focus', el.id); focusNode(graph, el.id); }
    return true;
  }

  renderComments();
  var saved = store.get('view', null);
  if (fromHash()) { /* The link sets the view. */ }
  else if (saved && isFinite(saved.x) && isFinite(saved.y) && saved.k >= MIN && saved.k <= MAX) { view = { x: saved.x, y: saved.y, k: saved.k }; apply(false); }
  else fitAll(false);
  window.addEventListener('hashchange', fromHash);
  if (document.fonts && document.fonts.ready) document.fonts.ready.then(drawEdges);
  window.addEventListener('load', drawEdges);
})();
`;
