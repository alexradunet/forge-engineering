// The tokens of the design system, as data. The CSS (tokensCss), the styleguide, the design document, and the contrast table read the same list.
// A token has a value for each theme (light, dark), or one value for both (value). `use` tells what the token is for.
// The corners are square: a stepped corner comes from the step() shadows of pixel.mjs, so the list has no radius token.

export const TOKENS = [
  { group: 'surface', name: '--bg', light: '#ece5d8', dark: '#131110', use: 'The page background.' },
  { group: 'surface', name: '--panel', light: '#f4eee3', dark: '#1a1715', use: 'A quiet panel on the page.' },
  { group: 'surface', name: '--card', light: '#fffcf5', dark: '#231f1c', use: 'A card, a field, or a button face.' },
  { group: 'surface', name: '--rail', light: '#f4eee3', dark: '#1a1715', use: 'The bar at the top, a dialog, and the foot.' },
  { group: 'ink', name: '--ink', light: '#1e1a16', dark: '#ede7db', use: 'Main text.' },
  { group: 'ink', name: '--muted', light: '#544c42', dark: '#aba295', use: 'Second text: labels, times, and notes.' },
  { group: 'ink', name: '--faint', light: '#6a6156', dark: '#948b7e', use: 'Third text, and the done state.' },
  { group: 'ink', name: '--line', light: '#d3cab9', dark: '#39332d', use: 'A thin border or a divider.' },
  { group: 'ink', name: '--line-2', light: '#857b6c', dark: '#746b5e', use: 'A stronger border, for example around a key cap.' },
  { group: 'accent', name: '--accent', light: '#1d5a85', dark: '#84b9e6', use: 'Links, the focus ring, the active state, and the main button.' },
  { group: 'accent', name: '--amber', light: '#855400', dark: '#f2b54a', use: 'The needs-you state and a gate that waits for the user.' },
  { group: 'accent', name: '--green', light: '#1f6a3a', dark: '#78c693', use: 'The go state and an approved gate.' },
  { group: 'accent', name: '--red', light: '#a5301f', dark: '#f28e76', use: 'The blocked state and an error.' },
  { group: 'accent', name: '--violet', light: '#63468c', dark: '#bda6e6', use: 'The waiting state (a person has the turn).' },
  { group: 'accent', name: '--ember', light: '#b23c0a', dark: '#ff8038', use: 'The brand heat: the hot spot of the logo and the ring of a gate in review.' },
  { group: 'accent', name: '--steel', light: '#5d6976', dark: '#9eabb8', use: 'A cold ingot (an approved gate). A mark only, never text.' },
  { group: 'accent', name: '--glow', light: '#f0a830', dark: '#ffc04d', use: 'The fill of a gate ingot that waits for the user. A mark inside an ember frame, never text.' },
  { group: 'accent', name: '--shade', light: '#1e1a16', dark: '#000000', use: 'The hard shadow and the heavy frame.' },
  { group: 'type', name: '--t-xs', value: '12px', use: 'Small print: key caps, times, and footers.' },
  { group: 'type', name: '--t-sm', value: '13px', use: 'Labels, pills, and table text.' },
  { group: 'type', name: '--t-md', value: '15px', use: 'Body text.' },
  { group: 'type', name: '--t-lg', value: '17px', use: 'A page title and a card title.' },
  { group: 'type', name: '--t-xl', value: '20px', use: 'A large heading.' },
  { group: 'type', name: '--t-2xl', value: '26px', use: 'The largest heading.' },
  { group: 'space', name: '--s-1', value: '4px', use: 'The smallest gap.' },
  { group: 'space', name: '--s-2', value: '8px', use: 'A gap between small parts.' },
  { group: 'space', name: '--s-3', value: '12px', use: 'A gap inside a card.' },
  { group: 'space', name: '--s-4', value: '16px', use: 'The side padding of a bar.' },
  { group: 'space', name: '--s-5', value: '24px', use: 'A gap between blocks.' },
  { group: 'space', name: '--s-6', value: '32px', use: 'A gap between sections.' },
  { group: 'space', name: '--s-7', value: '48px', use: 'The largest gap.' },
  { group: 'shadow', name: '--sh-1', value: '2px 2px 0 var(--line-2)', use: 'A card: a hard shadow of one pixel unit.' },
  { group: 'shadow', name: '--sh-2', value: '4px 4px 0 var(--shade)', use: 'A dialog and the toast.' },
  { group: 'font', name: '--font', value: 'system-ui, -apple-system, "Segoe UI", Roboto, sans-serif', use: 'The text font.' },
  { group: 'mono', name: '--mono', value: 'ui-monospace, SFMono-Regular, Consolas, "Liberation Mono", monospace', use: 'Keys, code, and paths.' },
  { group: 'unit', name: '--px', value: '2px', use: 'The pixel unit: a border, a stepped corner, and a pixel of a letter.' },
];

/** The text colors and the surfaces, for the contrast pairs. */
const SURFACES = ['--bg', '--panel', '--card', '--rail'];
const TEXT = ['--ink', '--muted', '--faint', '--accent', '--amber', '--green', '--red', '--violet'];
/**
 * The contrast contract: each text token on each surface at 4.5, the strong line and the marks (steel, ember) at 3, the primary button (the card on the accent),
 * and the toast (the page on the ink) at 4.5. --glow is not here: it is the fill of a mark inside an --ember frame, and the --ember cross carries the contrast of that mark.
 */
export const PAIRS = [
  ...TEXT.flatMap((fg) => SURFACES.map((on) => ({ fg, on, min: 4.5 }))),
  ...['--line-2', '--steel', '--ember'].flatMap((fg) => SURFACES.map((on) => ({ fg, on, min: 3 }))),
  { fg: '--card', on: '--accent', min: 4.5 },
  { fg: '--bg', on: '--ink', min: 4.5 },
];

/** The one breakpoint (px) of the pages. */
export const BREAK = { narrow: 760 };

const hasTheme = (token) => token.light !== undefined;
const lightOf = (token) => (hasTheme(token) ? token.light : token.value);
const darkOf = (token) => (hasTheme(token) ? token.dark : token.value);

/** The value of a token in one theme ('light' or 'dark'). */
export const tokenValue = (name, theme) => {
  const token = TOKENS.find((item) => item.name === name);
  if (!token) throw new Error(`No token ${name}.`);
  return theme === 'dark' ? darkOf(token) : lightOf(token);
};

/** The CSS variables of one theme, as one text. The styleguide uses it for the boxes of each theme. */
export const themeVars = (theme) => TOKENS.map((token) => `${token.name}: ${theme === 'dark' ? darkOf(token) : lightOf(token)};`).join(' ');

/** The :root rule and the two theme rules of the design system. */
export function tokensCss() {
  const rows = [];
  for (const token of TOKENS) {
    const last = rows[rows.length - 1];
    if (last && last.group === token.group) last.items.push(`${token.name}: ${lightOf(token)};`);
    else rows.push({ group: token.group, items: [`${token.name}: ${lightOf(token)};`] });
  }
  const dark = TOKENS.filter(hasTheme).map((token) => `${token.name}: ${token.dark};`).join(' ');
  return [
    ':root {',
    '  color-scheme: light dark;',
    ...rows.map((row) => `  ${row.items.join(' ')}`),
    '}',
    `@media (prefers-color-scheme: dark) { :root:not([data-theme="light"]) { ${dark} } }`,
    `:root[data-theme="dark"] { color-scheme: dark; ${dark} }`,
    ':root[data-theme="light"] { color-scheme: light; }',
  ].join('\n');
}

/** The tokens as the Markdown table rows of the design document: | `--name` | light | dark | use |. */
export function tokenTable() {
  return TOKENS.map((token) => `| \`${token.name}\` | ${lightOf(token)} | ${darkOf(token)} | ${token.use} |`).join('\n');
}

const channels = (hex) => {
  if (!/^#[0-9a-f]{6}$/i.test(hex)) throw new Error(`A color is #rrggbb: ${hex}`);
  return [1, 3, 5].map((at) => parseInt(hex.slice(at, at + 2), 16));
};

/** The WCAG contrast ratio of two #rrggbb colors, from 1 to 21. */
export function ratio(a, b) {
  const luminance = (hex) => {
    const [r, g, bl] = channels(hex).map((value) => { const c = value / 255; return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4; });
    return 0.2126 * r + 0.7152 * g + 0.0722 * bl;
  };
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}

/** The result of color-mix(in srgb, a weight*100%, b) as #rrggbb. `weight` is the share of `a`, from 0 to 1. */
export function mix(a, weight, b) {
  const [x, y] = [channels(a), channels(b)];
  return `#${x.map((value, at) => Math.round(value * weight + y[at] * (1 - weight)).toString(16).padStart(2, '0')).join('')}`;
}
