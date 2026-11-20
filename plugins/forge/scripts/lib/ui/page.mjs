// The one page shell of the forge pages: the board, the wiki page, the canvas, and the styleguide.
// The head holds everything that the page needs: the meta tags, the title, the icon, the style, the data block, and the one script.
// The script is in the head, so its first part can set the theme before the first paint: a user of the dark theme on a light system sees no light flash.
// The rest of the script waits for the DOM (the page code finds its elements by id).
import { bannerHtml } from './banner.mjs';
import { esc } from './kit.mjs';
import { UI_SCRIPT, UI_STYLE } from './index.mjs';
import { faviconUri, iconHtml, pixelText } from './pixel.mjs';

// The early part: it runs at once. It reads the choice of the theme (the key of the theme part in button.mjs) and sets it on the root element.
// A choice of auto sets nothing: then the style follows the system setting.
const EARLY = `  // The theme comes first, before the first paint.
  try {
    var early = localStorage.getItem('forge-ui:theme');
    if (early === 'light' || early === 'dark') document.documentElement.setAttribute('data-theme', early);
  } catch (error) { /* The storage is off: the theme is the system setting. */ }`;

/**
 * The text of the one script of a page. `dataId` is the id of the data block, `body` is the page code (after the code of the kit), and `before`
 * is text that comes before the data (function declarations that the page also gives to a server). The page code is not indented again:
 * a test names the text of a line of the page code.
 * The exported script of a page is this text. A served page names the script by its hash, so the text must be the same on each run.
 */
export function pageScript(dataId, body, { before = '' } = {}) {
  return `\n(function () {\n  'use strict';\n${EARLY}\n  function start() {\n${before ? `${before}\n` : ''}  var data = JSON.parse(document.getElementById('${dataId}').textContent);\n${UI_SCRIPT}${body}  }\n`
    + '  if (document.readyState === \'loading\') document.addEventListener(\'DOMContentLoaded\', start); else start();\n})();\n';
}

/**
 * The text of a page. `title` is plain text. `style` is the style text, `data` is the object of the data block, and `script` is the one script (pageScript).
 * `icon` is the variant of the tab icon: calm, or needs for a page with a ticket that needs the user. `main` is the id of the main part of the page,
 * where the first link of the body goes ("Skip to the content"). `body` is the HTML of the body after that link.
 */
export function pageHtml({ title, lang = 'en', bodyClass = '', style, dataId, data = {}, script, body, icon = 'calm', main = 'main' }) {
  const json = JSON.stringify(data).replace(/</g, '\\u003c');
  return [
    '<!doctype html>', `<html lang="${esc(lang)}">`, '<head>', '<meta charset="utf-8">',
    '<meta name="viewport" content="width=device-width, initial-scale=1">',
    '<meta name="color-scheme" content="light dark">',
    `<title>${esc(title)}</title>`,
    `<link rel="icon" href="${faviconUri(icon)}">`,
    `<style>${style}</style>`,
    `<script type="application/json" id="${esc(dataId)}">${json}</script>`,
    `<script>${script}</script>`, '</head>',
    `<body${bodyClass ? ` class="${esc(bodyClass)}"` : ''}>`,
    `<a class="skip" href="#${esc(main)}">Skip to the content</a>`,
    body, NOTICE_HTML, '</body>', '</html>', '',
  ].join('\n');
}

/**
 * The one notice of a page: a banner that stays until its script (the notice part of banner.mjs) clears it. It starts hidden, and it is a polite live region.
 * It comes after the body, and its style puts it at the bottom of the window, so it moves no part of the page.
 */
export const NOTICE_HTML = bannerHtml('', { kind: 'warn', id: 'notice', hidden: true, live: false, attrs: 'aria-live="polite"' });

/**
 * The content policy of an error page: no script, no connection, and no image except the data address of the icon. The style is inline.
 * The two servers send it with each HTML error page, so a page with a wrong address can run no code.
 */
export const ERROR_POLICY = "default-src 'none'; style-src 'unsafe-inline'; img-src data:; base-uri 'none'; form-action 'none'";

// The layout of an error page: one calm column. The look of the parts (button, eyebrow, code) is in the kit.
const ERROR_STYLE = String.raw`
.err { max-width: 640px; margin: 0 auto; padding: var(--s-7) var(--s-4); display: flex; flex-direction: column; align-items: flex-start; gap: var(--s-3); }
.err h1 { margin: 0; font-size: var(--t-lg); line-height: 1.2; }
.err p { margin: 0; overflow-wrap: anywhere; }
.err-cmd { display: block; max-width: 100%; padding: var(--s-2) var(--s-3); font-size: var(--t-md); user-select: all; border: 1px solid var(--line-2); }
.err-acts { display: flex; flex-wrap: wrap; gap: var(--s-1); }
`.trim();

/**
 * One self-contained HTML page for an error of a server, in the style of the kit. It has no script.
 * `status` is the HTTP status (it shows as a small label), `title` and `text` are plain text, `command` is an optional command that the user runs,
 * and `links` is a list of { text, href } that become buttons. Each value is escaped here.
 */
export function errorPage({ status, title, text, command = '', links = [] }) {
  return [
    '<!doctype html>', '<html lang="en">', '<head>', '<meta charset="utf-8">',
    '<meta name="viewport" content="width=device-width, initial-scale=1">',
    '<meta name="color-scheme" content="light dark">',
    `<title>${esc(title)}</title>`,
    `<link rel="icon" href="${faviconUri('calm')}">`,
    `<style>${UI_STYLE}\n${ERROR_STYLE}\n</style>`, '</head>', '<body>',
    '<main id="main" class="err">', iconHtml('anvil-cold', { size: 64 }),
    `<p class="eyebrow">Error ${esc(status)}</p>`,
    `<h1>${pixelText(title, { scale: 3 })}</h1>`,
    `<p>${esc(text)}</p>`,
    ...(command ? [`<code class="err-cmd">${esc(command)}</code>`] : []),
    ...(links.length ? [`<div class="err-acts">${links.map((link) => `<a class="primary" href="${esc(link.href)}">${esc(link.text)}</a>`).join('')}</div>`] : []),
    '</main>', '</body>', '</html>', '',
  ].join('\n');
}
