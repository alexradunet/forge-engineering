// The prose: the style of a text that comes from Markdown (a wiki page).
// Put the class "prose" on the box of the text. The headings, the paragraphs, the lists, the code, the quote, the links, and the table are inside it.
import { esc } from './kit.mjs';

const CSS = String.raw`
.prose { overflow-wrap: anywhere; }
.prose h1 { margin: var(--s-5) 0 var(--s-2); font-size: var(--t-2xl); line-height: 1.25; }
.prose h2, .prose h3 { margin: var(--s-5) 0 var(--s-2); font-size: var(--t-xl); line-height: 1.3; }
.prose h4 { margin: var(--s-4) 0 var(--s-2); font-size: var(--t-lg); }
.prose h5, .prose h6 { margin: var(--s-4) 0 var(--s-1); font-size: var(--t-md); }
.prose p { margin: 0 0 var(--s-3); }
.prose ul, .prose ol { margin: 0 0 var(--s-3); padding-left: 22px; }
.prose li { margin: 3px 0; }
.prose li > ul, .prose li > ol { margin: 3px 0 0; }
.prose pre { margin: 0 0 var(--s-3); padding: var(--s-3); overflow: auto; background: var(--card); border: 1px solid var(--line); }
.prose pre code { padding: 0; background: transparent; overflow-wrap: normal; }
.prose blockquote { margin: 0 0 var(--s-3); padding: 2px var(--s-3); color: var(--muted); border-left: 3px solid var(--line-2); }
.prose table { display: block; max-width: 100%; overflow: auto; margin: 0 0 var(--s-3); }
.prose > :first-child { margin-top: 0; }
`.trim();

/** A box of prose. `inner` is the HTML of the text (from Markdown), already escaped. */
export const proseHtml = (inner, { tag = 'div' } = {}) => `<${tag} class="prose">${inner}</${tag}>`;

export const prose = {
  name: 'prose',
  css: CSS,
  html: { proseHtml },
  script: '',
  demo: () => [{
    title: 'Headings, text, a list, code, a quote, a link, and a table',
    html: proseHtml('<h3>Retry the outbox</h3><p>The job reads the <code>retry_after</code> field, and it waits. See <a href="#">the plan</a>.</p>'
      + '<ul><li>Read the new key.</li><li>Write the row.<ul><li>Keep the old row.</li></ul></li></ul>'
      + `<pre><code>${esc('const wait = row.retryAfter ?? 30;')}</code></pre><blockquote><p>The old grid is not used.</p></blockquote>`
      + '<table><thead><tr><th>Ticket</th><th>State</th></tr></thead><tbody><tr><td>APP-101</td><td>Needs you</td></tr></tbody></table>'),
  }],
};
