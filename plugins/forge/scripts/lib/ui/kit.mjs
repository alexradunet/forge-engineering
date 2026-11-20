// The parts of the UI kit that each component uses: the escape function, the page script helper, and the check of a component.
// A component is one object: { name, css, html, script, demo }, and it can add cssParts and scriptParts (see index.mjs for the order).

export const esc = (value) => String(value ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

/**
 * The text of a function body, for the page script. The author writes real JavaScript, so the editor and the import
 * check the syntax. The page gets the text between the first { and the last }, with LF line ends: the repository files
 * have CRLF, and Function.prototype.toString keeps them. A CR in a page script breaks the content-policy hash.
 * The body can use free names such as `data`, `byId`, or `toast`: all parts land in one function of the page script.
 */
export function client(fn) {
  const text = String(fn).replace(/\r\n?/g, '\n');
  return text.slice(text.indexOf('{') + 1, text.lastIndexOf('}'));
}

/** Throws when a field of a component is missing or has the wrong type. Returns the component. */
export function checkComponent(component) {
  const name = component?.name;
  const fail = (text) => { throw new Error(`UI component ${typeof name === 'string' ? name : '(no name)'}: ${text}`); };
  if (!component || typeof component !== 'object') fail('it must be an object');
  if (typeof name !== 'string' || !/^[a-z][a-z0-9-]*$/.test(name)) fail('name must be a lowercase word');
  if (typeof component.css !== 'string') fail('css must be a string');
  if (!component.html || typeof component.html !== 'object' || Object.values(component.html).some((fn) => typeof fn !== 'function')) fail('html must be an object of functions');
  if (typeof component.script !== 'string') fail('script must be a string');
  if (typeof component.demo !== 'function') fail('demo must be a function');
  for (const key of ['cssParts', 'scriptParts']) {
    const parts = component[key];
    if (parts !== undefined && (!parts || typeof parts !== 'object' || Object.values(parts).some((text) => typeof text !== 'string'))) fail(`${key} must be an object of strings`);
  }
  return component;
}
