import { Marked } from 'marked';
import { isAbsolute, join, normalize } from 'node:path';

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

const toVsCode = (absPath) => `vscode://file/${absPath.replace(/\\/g, '/').replace(/^\/+/, '')}`;

/**
 * Rewrites a link target from a ticket document:
 * - http(s), mailto: unchanged (opens in a new tab)
 * - other .md in the same ticket: in-app route #/<KEY>/<file>
 * - other relative or absolute paths: vscode://file/<abs> (opens in VS Code)
 * - anything else (javascript:, data:, ...): dropped
 */
export function rewriteHref(href, ctx) {
  if (!href) return null;
  const h = href.trim();
  if (/^(https?:|mailto:)/i.test(h)) return { href: h, external: true };
  if (h.startsWith('#')) return { href: h, external: false };
  if (/^vscode:\/\/file\//i.test(h)) return { href: h, external: false };
  // Windows absolute path (C:/x or /C:/x), optionally with :line.
  if (/^\/?[a-z]:[\\/]/i.test(h)) return { href: toVsCode(h.replace(/^\//, '')), external: false };
  if (/^[a-z][a-z0-9+.-]*:/i.test(h)) return null;
  if (!ctx?.dir) return null;
  let decoded;
  try { decoded = decodeURIComponent(h.split('#')[0]); } catch { return null; }
  if (isAbsolute(decoded)) return null;
  const rel = normalize(join(ctx.relDir ?? '', decoded)).replace(/\\/g, '/').replace(/\/$/, '');
  if (!rel.startsWith('..') && /\.md$/i.test(rel) && ctx.key) return { href: `#/${ctx.key}/${rel}`, external: false };
  return { href: toVsCode(join(ctx.dir, rel)), external: false };
}

/** Renders Markdown to HTML. Raw HTML in the source is escaped, not rendered; HTML comments are hidden. */
export function renderMarkdown(md, ctx = {}) {
  const marked = new Marked({ gfm: true, breaks: false });
  marked.use({
    renderer: {
      html({ text }) { return esc(text.replace(/<!--[\s\S]*?-->/g, '')); },
      link({ href, title, tokens }) {
        const inner = this.parser.parseInline(tokens);
        const r = rewriteHref(href, ctx);
        if (!r) return inner;
        const t = title ? ` title="${esc(title)}"` : '';
        const ext = r.external ? ' target="_blank" rel="noopener"' : '';
        return `<a href="${esc(r.href)}"${t}${ext}>${inner}</a>`;
      },
      image({ href, text }) {
        const r = rewriteHref(href, ctx);
        return r ? `<a href="${esc(r.href)}">🖼️ ${esc(text || href)}</a>` : esc(text);
      },
      code({ text, lang }) {
        if (lang === 'mermaid') return `<pre class="mermaid-src"><code>${esc(text)}</code></pre>`;
        return `<pre><code${lang ? ` class="lang-${esc(lang)}"` : ''}>${esc(text)}</code></pre>`;
      },
    },
  });
  return marked.parse(md ?? '');
}
