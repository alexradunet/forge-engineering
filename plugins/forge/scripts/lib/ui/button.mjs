// The buttons (square, with a stepped corner from step()), the buttons at the end of each bar (TOOLS_HTML), and the theme script: auto, light, or dark, kept for each forge page in this browser.
import { client } from './kit.mjs';
import { step } from './pixel.mjs';

const CSS = String.raw`
button { font: inherit; color: inherit; background: var(--card); margin: var(--px); padding: 2px 10px; border: 0; box-shadow: ${step('var(--line-2)')}; cursor: pointer; }
button:hover { box-shadow: ${step('var(--accent)')}; }
button:active { transform: translate(1px, 1px); }
button:disabled { opacity: 0.5; cursor: default; box-shadow: ${step('var(--line)')}; }
button.primary, a.primary { color: var(--card); background: var(--accent); font-weight: 600; box-shadow: ${step('var(--accent)')}; }
button.primary:hover, a.primary:hover { box-shadow: ${step('var(--ink)')}; }
a.primary { display: inline-block; margin: var(--px); padding: 2px 10px; text-decoration: none; }
button.quiet, a.quiet, span.quiet { color: var(--muted); background: transparent; border: 0; box-shadow: none; padding: 2px 8px; text-decoration: none; }
button.quiet:hover, a.quiet:hover { color: var(--ink); background: color-mix(in srgb, var(--muted) 14%, transparent); box-shadow: ${step('var(--accent)')}; }
button.icon, a.icon, span.icon { min-width: 30px; padding: 2px 6px; text-align: center; }
.icon.off { opacity: 0.3; }
button[aria-pressed="true"] { background: color-mix(in srgb, var(--accent) 16%, var(--card)); box-shadow: ${step('var(--accent)')}; }
`.trim();

/** The buttons that each page has at the end of its bar. */
export const TOOLS_HTML = '<button type="button" class="quiet icon" id="help-open" title="Keys and mouse (?)" aria-label="Keys and mouse">?</button>'
  + '<button type="button" class="quiet" id="theme" title="Change the theme">Theme: auto</button>';

const theme = client(function () {
  // The theme is the system setting, or the choice of the user for each forge page in this browser.
  var THEMES = ['auto', 'light', 'dark'];
  function readTheme() {
    try { var name = localStorage.getItem('forge-ui:theme'); return THEMES.indexOf(name) >= 0 ? name : 'auto'; } catch (error) { return 'auto'; }
  }
  function showTheme(name) {
    if (name === 'auto') document.documentElement.removeAttribute('data-theme');
    else document.documentElement.setAttribute('data-theme', name);
    var button = byId('theme');
    if (button) { button.textContent = 'Theme: ' + name; button.title = 'Theme: ' + name + '. Select to change it.'; }
  }
  showTheme(readTheme());
  if (byId('theme')) byId('theme').addEventListener('click', function () {
    var name = THEMES[(THEMES.indexOf(readTheme()) + 1) % THEMES.length];
    try { localStorage.setItem('forge-ui:theme', name); } catch (error) { /* The storage is off: the theme stays for this page. */ }
    showTheme(name);
    toast('Theme: ' + name);
    // A new theme gives the drawings the colors of that theme.
    if (mermaidJob) drawMermaid(mermaidJob.pick, mermaidJob.after);
  });
});

export const button = {
  name: 'button',
  css: CSS,
  html: {},
  script: theme,
  demo: () => [{
    title: 'Buttons: default, primary, quiet, icon, pressed, disabled',
    html: '<button type="button">Default</button> <button type="button" class="primary">Primary</button> <button type="button" class="quiet">Quiet</button> '
      + '<button type="button" class="quiet icon">?</button> <button type="button" aria-pressed="true">Pressed</button> <button type="button" disabled>Disabled</button>',
  }, {
    title: 'The buttons at the end of a bar',
    html: `<div class="tools" style="margin-left: 0">${TOOLS_HTML.replace(/ id="[^"]*"/g, '')}</div>`,
  }],
};
