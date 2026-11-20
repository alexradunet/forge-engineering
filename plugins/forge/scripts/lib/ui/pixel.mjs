// The pixel system: sprites (icons) on a 16 by 16 grid, and the bitmap letters (5 by 7).
// Both become inline SVG: one path for each color class, with square pixels (shape-rendering crispEdges), and no image file.
// The colors come from CSS: .px-a is currentColor, .px-b is --ember, .px-c is --glow, and .px-d is --steel.
import { esc } from './kit.mjs';
import { tokenValue } from './tokens.mjs';

const E = '................';
// Rows of a sprite, with blank rows above, and below up to 16 rows.
const fit = (rows, top) => [...Array(top).fill(E), ...rows, ...Array(16 - top - rows.length).fill(E)];

// The body of the anvil: the horn at the left, the face on top, the waist, and the base.
const ANVIL_BODY = [
  '################',
  '..##############',
  '....###########.',
  '.....#########..',
  '......#######...',
  '......#######...',
  '......#######...',
  '.....#########..',
  '....###########.',
  '...#############',
  '...#############',
];
// The flame as a solid shape. The ember sprite colors it: an outline of ink, a fill of ember, and a core of amber.
const FLAME_SOLID = [
  '........#.......',
  '.......##.......',
  '......###....#..',
  '......####...##.',
  '.....#####..###.',
  '....######.####.',
  '...###########..',
  '...###########..',
  '..#############.',
  '..#############.',
  '..#############.',
  '...###########..',
  '....#########...',
  '.....#######....',
];
// A pixel is on the outline when a neighbor (left, right, up, or down) is empty. The core is the middle of the lower body.
const FLAME = FLAME_SOLID.map((row, y) => [...row].map((char, x) => {
  if (char !== '#') return '.';
  const empty = [[-1, 0], [1, 0], [0, -1], [0, 1]].some(([dx, dy]) => (FLAME_SOLID[y + dy]?.[x + dx] ?? '.') === '.');
  if (empty) return '#';
  return y >= 9 && y <= 11 && x >= 6 && x <= 9 ? '+' : 'o';
}).join(''));
// The hammer: a head with a steel face, and a diagonal handle of wood.
const HAMMER = [
  '......#########.',
  '......#sssssss##',
  '......#########.',
  '......#########.',
  '.......#+#......',
  '......#+#.......',
  '.....#+#........',
  '....#+#.........',
  '...#+#..........',
  '..#+#...........',
  '.#+#............',
  '.##.............',
];
const cold = ANVIL_BODY.map((row, at) => (at === 1 ? '..##sssss#######' : at === 9 ? '...#sss#########' : row));

/** The sprites: 16 rows of 16 characters. . is empty, # is .px-a, o is .px-b, + is .px-c, and s is .px-d. */
export const SPRITES = {
  anvil: [E, E, '........+.......', '.......oooooo...', ...ANVIL_BODY, E],
  hammer: fit(HAMMER, 2),
  ember: fit(FLAME, 1),
  ingot: fit([
    '....###########.',
    '...#ssssssssss#.',
    '..#ssssssssss#..',
    '.##############.',
    '.#ssssssssssss#.',
    '.##############.',
    '.##############.',
    '.##############.',
  ], 4),
  'anvil-cold': fit(cold, 2),
};

// The class of each sprite character.
const CLASSES = { '#': 'px-a', o: 'px-b', '+': 'px-c', s: 'px-d' };

/** The path text of all runs of one character in the rows: each horizontal run is one sub-path. */
export function spritePath(rows, char) {
  const parts = [];
  rows.forEach((row, y) => {
    for (let x = 0; x < row.length; x++) {
      if (row[x] !== char) continue;
      let n = 1;
      while (row[x + n] === char) n++;
      parts.push(`M${x} ${y}h${n}v1h-${n}z`);
      x += n - 1;
    }
  });
  return parts.join(' ');
}

/** One sprite as an inline SVG. The size is a multiple of 16, so each pixel has a whole size. */
export function iconHtml(name, { size = 16, label = '' } = {}) {
  const rows = SPRITES[name];
  if (!rows) throw new Error(`No sprite ${name}.`);
  if (!Number.isInteger(size) || size < 16 || size % 16) throw new Error(`The size of a sprite is 16, 32, 48, 64, and so on: ${size}.`);
  const paths = Object.entries(CLASSES).map(([char, className]) => ({ className, d: spritePath(rows, char) })).filter((item) => item.d)
    .map((item) => `<path class="${item.className}" d="${item.d}"/>`).join('');
  const access = label ? `role="img" aria-label="${esc(label)}"` : 'aria-hidden="true"';
  return `<svg class="px" viewBox="0 0 16 16" width="${size}" height="${size}" shape-rendering="crispEdges" focusable="false" ${access}>${paths}</svg>`;
}

/**
 * The icon of the browser tab: the anvil as a standalone SVG in a data address (a link tag needs no file and no network).
 * `calm` is the anvil with the cold steel face, and `needs` is the anvil with the hot spot (ember and glow) for a ticket that needs the user.
 * The colors are hex values of the tokens: the SVG has its own style, and the anvil follows the color scheme of the browser.
 * The whole text is percent-encoded, so no character of it can end an attribute value.
 */
export function faviconUri(variant = 'calm') {
  if (variant !== 'calm' && variant !== 'needs') throw new Error(`No icon variant ${variant}. Use calm or needs.`);
  const rows = SPRITES[variant === 'needs' ? 'anvil' : 'anvil-cold'];
  const rule = (theme) => ['a:--ink', 'b:--ember', 'c:--glow', 'd:--steel'].map((item) => { const [name, token] = item.split(':'); return `.${name}{fill:${tokenValue(token, theme)}}`; }).join('');
  const style = `${rule('light')}@media (prefers-color-scheme:dark){${rule('dark')}}`;
  const names = { '#': 'a', o: 'b', '+': 'c', s: 'd' };
  const paths = Object.entries(names).map(([char, name]) => ({ name, d: spritePath(rows, char) })).filter((item) => item.d).map((item) => `<path class="${item.name}" d="${item.d}"/>`).join('');
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16" shape-rendering="crispEdges"><style>${style}</style>${paths}</svg>`;
  return `data:image/svg+xml,${encodeURIComponent(svg)}`;
}

// The letters: 5 columns and 7 rows, with / between the rows. A letter has an advance of 6 columns, and a space has 3.
const GLYPH_TEXT = {
  A: '..#../.#.#./#...#/#...#/#####/#...#/#...#', B: '####./#...#/#...#/####./#...#/#...#/####.', C: '.###./#...#/#..../#..../#..../#...#/.###.',
  D: '####./#...#/#...#/#...#/#...#/#...#/####.', E: '#####/#..../#..../####./#..../#..../#####', F: '#####/#..../#..../####./#..../#..../#....',
  G: '.###./#...#/#..../#.###/#...#/#...#/.###.', H: '#...#/#...#/#...#/#####/#...#/#...#/#...#', I: '.###./..#../..#../..#../..#../..#../.###.',
  J: '..###/...#./...#./...#./...#./#..#./.##..', K: '#...#/#..#./#.#../##.../#.#../#..#./#...#', L: '#..../#..../#..../#..../#..../#..../#####',
  M: '#...#/##.##/#.#.#/#.#.#/#...#/#...#/#...#', N: '#...#/##..#/#.#.#/#..##/#...#/#...#/#...#', O: '.###./#...#/#...#/#...#/#...#/#...#/.###.',
  P: '####./#...#/#...#/####./#..../#..../#....', Q: '.###./#...#/#...#/#...#/#.#.#/#..#./.##.#', R: '####./#...#/#...#/####./#.#../#..#./#...#',
  S: '.####/#..../#..../.###./....#/....#/####.', T: '#####/..#../..#../..#../..#../..#../..#..', U: '#...#/#...#/#...#/#...#/#...#/#...#/.###.',
  V: '#...#/#...#/#...#/#...#/.#.#./.#.#./..#..', W: '#...#/#...#/#...#/#.#.#/#.#.#/##.##/#...#', X: '#...#/#...#/.#.#./..#../.#.#./#...#/#...#',
  Y: '#...#/#...#/.#.#./..#../..#../..#../..#..', Z: '#####/....#/...#./..#../.#.../#..../#####',
  0: '.###./#...#/#..##/#.#.#/##..#/#...#/.###.', 1: '..#../.##../..#../..#../..#../..#../.###.', 2: '.###./#...#/....#/...#./..#../.#.../#####',
  3: '#####/...#./..#../...#./....#/#...#/.###.', 4: '...#./..##./.#.#./#..#./#####/...#./...#.', 5: '#####/#..../####./....#/....#/#...#/.###.',
  6: '..##./.#.../#..../####./#...#/#...#/.###.', 7: '#####/....#/...#./..#../.#.../.#.../.#...', 8: '.###./#...#/#...#/.###./#...#/#...#/.###.',
  9: '.###./#...#/#...#/.####/....#/...#./.##..',
  '?': '.###./#...#/....#/...#./..#../...../..#..', '!': '..#../..#../..#../..#../..#../...../..#..',
  '.': '...../...../...../...../...../.##../.##..', ',': '...../...../...../...../.##../..#../.#...',
  ':': '...../.##../.##../...../.##../.##../.....', '-': '...../...../...../#####/...../...../.....',
  '+': '...../..#../..#../#####/..#../..#../.....', '/': '....#/....#/...#./..#../.#.../#..../#....',
  '(': '...#./..#../.#.../.#.../.#.../..#../...#.', ')': '.#.../..#../...#./...#./...#./..#../.#...',
  "'": '..#../..#../.#.../...../...../...../.....', '&': '.##../#..#./#.#../.#.../#.#.#/#..#./.##.#',
};

/** The letters as rows of 5 characters. */
export const FONT = Object.fromEntries(Object.entries(GLYPH_TEXT).map(([char, text]) => [char, text.split('/')]));
const SPACE = 3;
const ADVANCE = 6;

/** True when each character of the text (in upper case) has a glyph, or is a space. */
export const canPixel = (text) => [...String(text).toUpperCase()].every((char) => char === ' ' || Object.prototype.hasOwnProperty.call(FONT, char));

/**
 * The text as bitmap letters in an inline SVG, with the real text in a .sr span (a screen reader, the search by textContent, and a copy get the text).
 * The drawing uses the upper-case form. A text with a character outside of the glyph set gives the plain escaped text.
 * `scale` is the size of a pixel in px: 2 (labels and counts, the default), 3 (the logo word and a page title), or 4.
 * `label` is the text for a screen reader, when it differs from the drawing (the logo draws FORGE, and the page is the Forge board).
 */
export function pixelText(text, { scale = 2, label = '' } = {}) {
  const value = String(text);
  if (!value || !canPixel(value)) return esc(value);
  const rows = Array.from({ length: 7 }, () => '');
  for (const char of value.toUpperCase()) {
    if (char === ' ') { for (let y = 0; y < 7; y++) rows[y] += '.'.repeat(SPACE); continue; }
    FONT[char].forEach((row, y) => { rows[y] += row + '.'; });
  }
  const width = rows[0].length - 1;
  const d = spritePath(rows.map((row) => row.slice(0, width)), '#');
  return `<span class="pxt pxt-${scale}" style="--n:${width}"><svg viewBox="0 0 ${width} 7" shape-rendering="crispEdges" aria-hidden="true" focusable="false"><path d="${d}"/></svg><span class="sr">${esc(label || value)}</span></span>`;
}

/** The box-shadow list of a stepped corner: no border, and 4 shadows that make a cross around the box, so the 4 corner pixels stay empty. */
export const step = (color) => ['0 calc(-1 * var(--px)) 0 0', '0 var(--px) 0 0', 'calc(-1 * var(--px)) 0 0 0', 'var(--px) 0 0 0'].map((offset) => `${offset} ${color}`).join(', ');

const CSS = String.raw`
.px { display: inline-block; flex: none; vertical-align: middle; }
.px-a { fill: currentColor; }
.px-b { fill: var(--ember); }
.px-c { fill: var(--glow); }
.px-d { fill: var(--steel); }
.pxt { display: inline-block; flex: none; vertical-align: middle; line-height: 0; }
.pxt svg { display: block; height: calc(7 * var(--pxs, 2px)); width: calc(var(--n) * var(--pxs, 2px)); fill: currentColor; }
.pxt-2 { --pxs: 2px; }
.pxt-3 { --pxs: 3px; }
.pxt-4 { --pxs: 4px; }
`.trim();

export const pixel = {
  name: 'pixel',
  css: CSS,
  html: { iconHtml, pixelText, spritePath, canPixel },
  script: '',
  demo: () => [{
    title: 'Sprites at 16, 32, and 64 px, and bitmap letters at 2, 3, and 4 px',
    html: `<p>${['anvil', 'ember', 'ingot', 'hammer'].map((name) => iconHtml(name, { size: 32 })).join(' ')} ${iconHtml('anvil-cold', { size: 64 })}</p>`
      + `<p>${pixelText('Needs you', { scale: 2 })}</p><p>${pixelText('Forge', { scale: 3 })}</p><p>${pixelText('Story 7', { scale: 4 })}</p>`,
  }],
};
