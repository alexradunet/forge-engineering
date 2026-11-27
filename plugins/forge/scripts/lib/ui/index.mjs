// The UI kit of the forge pages: the tokens, the components, and the two texts that each page puts inline (UI_STYLE and UI_SCRIPT).
// ui.mjs re-exports this file, so each page keeps its import path. docs/design-system.md gives the rules.
// The order of the texts is explicit, never the order of a folder: the same input gives the same bytes. A component can have more than one
// part of css or script (cssParts and scriptParts), because the order of the style text and the order of the script text differ.
import { checkComponent } from './kit.mjs';
import { tokensCss } from './tokens.mjs';
import { banner } from './banner.mjs';
import { bar } from './bar.mjs';
import { base } from './base.mjs';
import { button } from './button.mjs';
import { dialog } from './dialog.mjs';
import { diagram } from './diagram.mjs';
import { empty } from './empty.mjs';
import { frame } from './frame.mjs';
import { gates } from './gates.mjs';
import { live } from './live.mjs';
import { nav } from './nav.mjs';
import { pill } from './pill.mjs';
import { pixel } from './pixel.mjs';
import { prose } from './prose.mjs';
import { search } from './search.mjs';
import { toast } from './toast.mjs';

export { esc, client, checkComponent } from './kit.mjs';
export { BREAK, PAIRS, TOKENS, mix, ratio, themeVars, tokenTable, tokenValue, tokensCss } from './tokens.mjs';
export { GATE_TEXT, buildNav, navData, pageLabel } from './nav.mjs';
export { helpHtml, switcherHtml } from './dialog.mjs';
export { TOOLS_HTML } from './button.mjs';
export { brandHtml, footHtml } from './bar.mjs';
export { bannerHtml } from './banner.mjs';
export { emptyHtml } from './empty.mjs';
export { frameHtml } from './frame.mjs';
export { gatesHtml } from './gates.mjs';
export { faviconUri, iconHtml, pixelText, step } from './pixel.mjs';
export { ERROR_POLICY, NOTICE_HTML, errorPage, pageHtml, pageScript, policy } from './page.mjs';
export { chipHtml, countHtml, pillHtml, tagHtml } from './pill.mjs';
export { proseHtml } from './prose.mjs';
export { searchHtml } from './search.mjs';

/** The components, in the order of the styleguide. */
export const COMPONENTS = [base, button, pill, pixel, frame, gates, search, banner, empty, prose, nav, live, diagram, bar, dialog, toast].map(checkComponent);

// A group is a list of [component, part]. The groups of the style text are joined by a blank line, and the parts of one group by a line end.
// The part 'css' (or 'script') is the main text of the component, and any other name is a key of cssParts (or scriptParts).
const STYLE_ORDER = [
  [[base, 'css'], [button, 'css'], [base, 'rest']],
  [[base, 'state'], [pill, 'css']],
  [[pixel, 'css']],
  [[frame, 'css']],
  [[gates, 'css']],
  [[search, 'css']],
  [[banner, 'css']],
  [[empty, 'css']],
  [[prose, 'css']],
  [[live, 'css']],
  [[diagram, 'css']],
  [[bar, 'css']],
  [[dialog, 'css']],
  [[toast, 'css'], [bar, 'foot']],
];

// The script parts, one after the other, each one in its place. A part can use a name of a part after it (the theme part calls drawMermaid).
const SCRIPT_ORDER = [
  [base, 'script'], [toast, 'script'], [banner, 'script'], [button, 'script'], [diagram, 'script'], [nav, 'script'], [live, 'script'], [gates, 'script'],
  [dialog, 'script'], [dialog, 'help'], [nav, 'keys'],
];

function partOf(component, part, kind) {
  const text = part === kind ? component[kind] : component[`${kind}Parts`]?.[part];
  if (typeof text !== 'string') throw new Error(`UI component ${component.name} has no ${kind} part ${part}.`);
  return text;
}

// Each non-empty part of each component must be in an order list, and no list uses a part two times. A new part that no list names would silently be lost.
function checkOrder() {
  const name = (kind) => ([component, part]) => `${component.name}:${kind}:${part}`;
  const lists = [STYLE_ORDER.flat().map(name('css')), SCRIPT_ORDER.map(name('script'))];
  for (const list of lists) if (new Set(list).size !== list.length) throw new Error('The UI order uses a part two times.');
  const used = new Set(lists.flat());
  for (const component of COMPONENTS) {
    const names = ['css', 'script'].flatMap((kind) => [...(component[kind] ? [kind] : []), ...Object.keys(component[`${kind}Parts`] ?? {})].map((part) => `${component.name}:${kind}:${part}`));
    for (const item of names) if (!used.has(item)) throw new Error(`The UI order does not use ${item}.`);
  }
}
checkOrder();

const styleOf = (groups) => groups.map((group) => group.map(([component, part]) => partOf(component, part, 'css')).join('\n'));

/** The style of the design system: the tokens, and then the rules of each component. */
export const UI_STYLE = `\n${[tokensCss(), ...styleOf(STYLE_ORDER)].join('\n\n')}\n`;

// The page script defines `data` before this text: the JSON of the data block, with `token` on a served page and `nav`.
// Each part has the text between the braces of its function (client in kit.mjs). The parts have no outer line ends: the join gives them.
export const UI_SCRIPT = `\n${SCRIPT_ORDER.map(([component, part]) => partOf(component, part, 'script').replace(/^\n/, '').replace(/\n[ ]*$/, '')).join('\n\n')}\n`;
