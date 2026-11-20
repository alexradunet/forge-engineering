// The toast: a short note at the bottom of the page. toast(text) shows it for 4 seconds.
import { client } from './kit.mjs';

const CSS = String.raw`
#toast { position: fixed; left: 50%; bottom: 44px; z-index: 7; transform: translateX(-50%); max-width: calc(100% - 24px); padding: 6px 16px; color: var(--bg); background: var(--ink); border: var(--px) solid var(--shade); box-shadow: var(--sh-2); }
`.trim();

const script = client(function () {
  function toast(text) {
    var el = byId('toast');
    el.textContent = text;
    el.hidden = false;
    clearTimeout(toast.timer);
    toast.timer = setTimeout(function () { el.hidden = true; }, 4000);
  }
});

export const toast = {
  name: 'toast',
  css: CSS,
  html: {},
  script,
  demo: () => [{
    title: 'The toast (the styleguide shows it in the flow)',
    html: '<div id="toast">Theme: dark</div>',
  }],
};
