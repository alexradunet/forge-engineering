// The styleguide: one self-contained page that shows each token and each component of the UI kit, in the light and in the dark theme.
// `forge.mjs styleguide` writes it to <forge>/raw/styleguide.html. The page loads nothing from a network.
// It also shows a preview of a page, the icons, and the pixel letters.
import { COMPONENTS, UI_STYLE } from './index.mjs';
import { pageHtml, pageScript } from './page.mjs';
import { brandHtml } from './bar.mjs';
import { TOOLS_HTML } from './button.mjs';
import { bannerHtml } from './banner.mjs';
import { emptyHtml } from './empty.mjs';
import { frameHtml } from './frame.mjs';
import { gatesHtml } from './gates.mjs';
import { esc } from './kit.mjs';
import { FONT, SPRITES, iconHtml, pixelText } from './pixel.mjs';
import { chipHtml, countHtml, pillHtml, tagHtml } from './pill.mjs';
import { searchHtml } from './search.mjs';
import { BREAK, PAIRS, TOKENS, ratio, themeVars, tokenValue } from './tokens.mjs';

// The theme rules of the style text apply to :root, so each sample box has its own rules: the variables of one theme, and its color and background.
const sgStyle = String.raw`
.sg-light { ${themeVars('light')} color-scheme: light; color: var(--ink); background: var(--bg); }
.sg-dark { ${themeVars('dark')} color-scheme: dark; color: var(--ink); background: var(--bg); }
.sg { max-width: 1240px; margin: 0 auto; padding: var(--s-5) var(--s-4) var(--s-7); }
.sg h2 { margin: var(--s-6) 0 var(--s-3); font-size: var(--t-xl); }
.sg h3 { margin: var(--s-5) 0 var(--s-2); font-size: var(--t-lg); }
.sg h4 { margin: var(--s-3) 0 var(--s-1); font-size: var(--t-sm); font-weight: 600; color: var(--muted); }
.sg p.lead { color: var(--muted); margin: 0; }
.sg table { width: 100%; border-collapse: collapse; font-size: var(--t-sm); background: var(--card); }
.sg th, .sg td { padding: 4px 10px; text-align: left; vertical-align: middle; border: 1px solid var(--line); }
.sg th { font-weight: 600; color: var(--muted); }
.sg td.num { font-family: var(--mono); text-align: right; white-space: nowrap; }
.sg .swatch { display: inline-block; width: 44px; height: 22px; vertical-align: middle; border: 1px solid var(--line-2); }
.sg .below { color: var(--red); font-weight: 600; }
.sg .ok { color: var(--muted); }
.sg-pair { display: grid; grid-template-columns: 1fr 1fr; gap: var(--s-3); }
.sg-box { position: relative; min-width: 0; padding: var(--s-5) var(--s-3) var(--s-3); border: 1px solid var(--line-2); }
.sg-box::before { content: attr(data-theme); position: absolute; left: var(--s-3); top: 4px; font: var(--t-xs)/1.4 var(--mono); color: var(--muted); }
.sg-box #toast, .sg-box #foot { position: static; transform: none; }
.sg-box #toast { display: inline-block; }
.sg-box dialog#switcher, .sg-box dialog#help { position: static; margin: 0; width: auto; }
.sg-box .sg-scale { margin: 2px 0; }
.sg-space { display: block; height: 14px; margin: 3px 0; background: var(--accent); }
.sg-shadow { display: inline-block; width: 120px; height: 56px; margin: var(--s-2) var(--s-3) var(--s-3) 0; background: var(--card); }
.sg-chips { display: inline-flex; flex-wrap: wrap; align-items: center; }
.sg-gap { height: var(--s-3); }
.sg-cols { display: grid; grid-template-columns: 1fr 1fr; gap: var(--s-3); margin-top: var(--s-3); }
.sg .sg-lane { display: flex; align-items: center; gap: var(--s-2); margin: 0 0 var(--s-3); font-size: var(--t-lg); }
.sg-card-top { display: flex; justify-content: space-between; gap: var(--s-2); }
.sg-age { font-size: var(--t-xs); color: var(--muted); }
.sg-title { margin: 2px 0 6px; font-size: var(--t-lg); font-weight: 600; line-height: 1.3; }
.sg-row { margin: 6px 0; font-size: var(--t-sm); }
.sg-row .eyebrow { margin-right: 4px; }
.sg-links a { margin-right: var(--s-3); }
.sg-icons { display: grid; grid-template-columns: repeat(auto-fill, minmax(130px, 1fr)); gap: var(--s-3); }
.sg-icon { display: flex; flex-direction: column; gap: var(--s-2); align-items: flex-start; }
.sg-icon .sizes { display: flex; align-items: flex-end; gap: var(--s-3); }
.sg-letters p { margin: 0 0 var(--s-3); }
@media (max-width: ${BREAK.narrow}px) { .sg-pair, .sg-cols { grid-template-columns: 1fr; } }
`;

const both = (html) => `<div class="sg-pair"><div class="sg-box sg-light" data-theme="light">${html}</div><div class="sg-box sg-dark" data-theme="dark">${html}</div></div>`;
const noId = (html) => html.replace(/ id="[^"]*"/g, '');
const swatch = (hex) => `<span class="swatch" style="background: ${hex}"></span>`;

function colorTable() {
  const colors = TOKENS.filter((token) => token.light !== undefined && token.group !== 'shadow');
  const rows = colors.map((token) => `<tr><td><code>${token.name}</code></td><td>${swatch(token.light)} <code>${token.light}</code></td><td>${swatch(token.dark)} <code>${token.dark}</code></td><td>${esc(token.use)}</td></tr>`);
  return `<table><thead><tr><th>Token</th><th>Light</th><th>Dark</th><th>Use</th></tr></thead><tbody>${rows.join('')}</tbody></table>`;
}

// The contrast of each pair. A pair below its minimum gets the word "below" and the minimum: the mark is not only a color.
function contrastTable() {
  const pairs = PAIRS;
  const value = (pair, theme) => ratio(tokenValue(pair.fg, theme), tokenValue(pair.on, theme));
  const cell = (pair, theme) => {
    const low = value(pair, theme) < pair.min;
    return `<td class="num ${low ? 'below' : 'ok'}">${value(pair, theme).toFixed(2)}${low ? ` below ${pair.min}` : ''}</td>`;
  };
  const sample = (pair, theme) => `<td><span style="padding: 1px 8px; color: ${tokenValue(pair.fg, theme)}; background: ${tokenValue(pair.on, theme)}; border: 1px solid ${tokenValue('--line', theme)}">Aa text</span></td>`;
  const rows = pairs.map((pair) => `<tr><td><code>${pair.fg}</code></td><td><code>${pair.on}</code></td><td class="num">${pair.min}</td>${sample(pair, 'light')}${cell(pair, 'light')}${sample(pair, 'dark')}${cell(pair, 'dark')}</tr>`);
  const low = pairs.reduce((sum, pair) => sum + ['light', 'dark'].filter((theme) => value(pair, theme) < pair.min).length, 0);
  return `<p class="lead">${low ? `${low} of ${pairs.length * 2} pairs are below their minimum.` : 'Each pair meets its minimum.'} Text needs 4.5, a mark or a strong line needs 3.</p>`
    + `<table><thead><tr><th>Color</th><th>On</th><th>Minimum</th><th>Light</th><th>Ratio</th><th>Dark</th><th>Ratio</th></tr></thead><tbody>${rows.join('')}</tbody></table>`;
}

function scales() {
  const group = (name) => TOKENS.filter((token) => token.group === name);
  const type = group('type').map((token) => `<div class="sg-scale" style="font-size: var(${token.name})"><code>${token.name}</code> ${token.value} <span style="color: var(--muted)">${esc(token.use)}</span></div>`).join('');
  const fonts = [...group('font'), ...group('mono')].map((token) => `<div class="sg-scale" style="font-family: var(${token.name})"><code>${token.name}</code> The retry job reads the new key. 0123456789</div>`).join('');
  const space = [...group('space'), ...group('unit')].map((token) => `<div><code>${token.name}</code> ${token.value}<span class="sg-space" style="width: var(${token.name})"></span></div>`).join('');
  const shadow = group('shadow').map((token) => `<span style="display: inline-block"><span class="sg-shadow" style="box-shadow: var(${token.name})"></span><br><code>${token.name}</code></span>`).join('');
  return `<h2 id="type">Type scale</h2>${type}<h3>Fonts</h3>${fonts}<h2 id="space">Space scale</h2>${space}<h2 id="shadow">Shadow</h2>${both(shadow)}`;
}

function components() {
  return COMPONENTS.map((component) => {
    const samples = component.demo().map((sample) => `<h4>${esc(sample.title)}</h4>${both(sample.html)}`).join('');
    return `<section><h3 id="c-${component.name}"><code>${component.name}</code></h3>${samples}</section>`;
  }).join('');
}

// A ticket card of the preview: a frame with the edge of its state.
function card(state, { key, age, title, gates, next, tags, links }) {
  return frameHtml(`<div class="sg-card-top"><span class="key">${key}</span><span class="sg-age">${age}</span></div>`
    + `<p class="sg-title">${esc(title)}</p><p class="sg-row">${gatesHtml(gates)}</p><p class="sg-row"><span class="eyebrow">Next</span>${esc(next)}</p>`
    + `<p class="sg-row">${tags.map(tagHtml).join(' ')}</p><p class="sg-row sg-links">${links.map((link) => `<a href="#">${link}</a>`).join('')}</p>`, { state, tag: 'article' });
}

// The top of a board, built only from kit components.
function preview() {
  const chips = `<span class="sg-chips">${chipHtml('Needs you', 'needs-me', 1)}${chipHtml('Go', 'go', 1)}${chipHtml('Active', 'active', 2)}</span>`;
  const bar = `<header id="rail"><div class="bar"><h1>${brandHtml('FORGE', 'Forge board')}</h1>${searchHtml({ label: 'Filter the tickets', placeholder: 'Filter the tickets' })}${chips}`
    + `<div class="tools"><a class="quiet" href="#">Wiki</a><button type="button">Go to a ticket</button>${noId(TOOLS_HTML)}</div></div></header>`;
  const strike = bannerHtml('<span class="key">APP-101</span> Shippable? needs you. Read review.md.', { kind: 'warn', actions: '<a class="primary" href="#">Open</a>' });
  const lane = (title, inner) => frameHtml(`<h3 class="sg-lane">${pixelText(title, { scale: 3 })} ${countHtml(inner.count)}</h3>${inner.html}`, { sunk: true, tag: 'section' });
  const needs = lane('NEEDS YOU', {
    count: 1,
    html: card('needs-me', {
      key: 'APP-101', age: '3 days', title: 'Fix outbox retry', next: 'Approve the review (Shippable?)', tags: ['review'], links: ['README', 'Worktree'],
      gates: [{ name: 'Planned?', status: 'approved' }, { name: 'Shippable?', status: 'in-review' }, { name: 'Sendable?', status: 'todo' }],
    }),
  });
  const go = lane('GO', {
    count: 1,
    html: card('go', {
      key: 'APP-103', age: '2 days', title: 'Invoice time zone', next: 'Start the plan', tags: ['plan'], links: ['README'],
      gates: [{ name: 'Planned?', status: 'todo' }],
    }),
  });
  const none = lane('NEEDS YOU', { count: 0, html: emptyHtml('No ticket needs you.', { icon: 'anvil-cold' }) });
  const table = '<table><thead><tr><th>Ticket</th><th>Person</th><th>Ask</th><th>Days</th></tr></thead><tbody>'
    + '<tr><td><span class="key">APP-104</span></td><td>Mara</td><td>Is the old grid still used?</td><td>13</td></tr>'
    + '<tr><td><span class="key">APP-102</span></td><td>Noor</td><td>A log of the export node</td><td>8</td></tr></tbody></table>';
  const inner = `${bar}<div class="sg-gap"></div>${strike}<div class="sg-gap"></div>${needs}<div class="sg-cols">${go}${none}</div><div class="sg-gap"></div><p class="eyebrow">People waits</p>${table}`;
  return `<section id="preview"><h2>Preview</h2><p class="lead">The top of the board, built only from kit components.</p>${both(inner)}</section>`;
}

function icons() {
  const cells = Object.keys(SPRITES).map((name) => `<div class="sg-icon"><code>${name}</code><div class="sizes">${[16, 32, 64].map((size) => iconHtml(name, { size })).join('')}</div></div>`).join('');
  return `<section id="icons"><h2>Icons</h2><p class="lead">Each sprite on a grid of 16 by 16, at 16, 32, and 64 px.</p>${both(`<div class="sg-icons">${cells}</div>`)}</section>`;
}

function letters() {
  const lines = ['ABCDEFGHIJKLM', 'NOPQRSTUVWXYZ', '0123456789', "? ! . , : - + / ( ) ' &"];
  const set = (scale) => lines.map((line) => `<p>${pixelText(line, { scale })}</p>`).join('');
  const words = `<p>${pixelText('FORGE', { scale: 3 })}</p><p>${pixelText('NEEDS YOU 2', { scale: 3 })}</p><p>${pixelText('STORY', { scale: 3 })}</p>`;
  const glyphs = Object.keys(FONT).length;
  return `<section id="letters"><h2>Pixel letters</h2><p class="lead">${glyphs} glyphs of 5 by 7 pixels. The text stays in the page for a screen reader and for the search.</p>`
    + `${both(`<h4>2 px</h4><div class="sg-letters">${set(2)}</div><h4>4 px</h4><div class="sg-letters">${set(4)}</div><h4>Words at 3 px</h4><div class="sg-letters">${words}</div>`)}</section>`;
}

/** The styleguide page, as one HTML text. The same input gives the same bytes. */
export function renderStyleguide() {
  const body = [
    `<header id="rail"><div class="bar"><h1>Forge styleguide</h1><div class="tools">${TOOLS_HTML}</div></div></header>`,
    '<main class="sg" id="sg-main">',
    '<p class="lead">The tokens and the components of the forge pages. Each sample shows in the light and in the dark theme. The page loads nothing from a network.</p>',
    preview(),
    `<h2 id="colors">Colors</h2>${colorTable()}`,
    `<h2 id="contrast">Contrast</h2>${contrastTable()}`,
    scales(),
    `<h2 id="components">Components</h2>${components()}`,
    `<div id="sprites">${icons()}${letters()}</div>`,
    '</main>', '<div id="toast" hidden></div>',
  ].join('\n');
  return pageHtml({ title: 'Forge styleguide', style: UI_STYLE + sgStyle, dataId: 'styleguide-data', script: pageScript('styleguide-data', ''), body, main: 'sg-main' });
}
