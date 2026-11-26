// The Markdown subset of the forge pages: Markdown text as HTML, and the target of a link for a page.
// Every character of the source is escaped; only the listed shapes become tags. The wiki page uses markdown(), and the board page uses linkTarget().
import { esc } from './ui.mjs';
import { tableRow } from './reading.mjs';

const unesc = (value) => value.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&amp;/g, '&');

/** The link target for the page, or '' when the target must stay plain text. */
export function linkTarget(target) {
  const text = String(target).trim().replace(/^<|>$/g, '');
  const safe = (value) => value.replace(/[\s"<>`]/g, (c) => encodeURIComponent(c));
  if (/^https?:\/\//i.test(text)) return safe(text);
  if (/^[\\/]{2}/.test(text)) return '';
  if (/^(?:[a-z]:[\\/]|\/)/i.test(text)) {
    const match = /^(.*?)(?::(\d+)(?::\d+)?)?$/.exec(text);
    const local = match[1].replaceAll('\\', '/');
    const absolute = local.startsWith('/') ? local : `/${local}`;
    return `file://${safe(absolute)}`;
  }
  if (/^[a-z][a-z0-9+.-]*:/i.test(text) || text.startsWith('#')) return '';
  return safe(text.replaceAll('\\', '/'));
}

function inline(text, ctx) {
  // A finished piece of HTML waits behind a mark, so that a later rule does not change it.
  const kept = [];
  const keep = (html) => { kept.push(html); return `${kept.length - 1}`; };
  const wiki = ctx.wiki ?? null;
  // The source cannot hold a mark of its own.
  let out = String(text).replace(/[\uE000\uE001]/g, '').replace(/`([^`\n]+)`/g, (_, code) => {
    const html = `<code>${esc(code)}</code>`;
    const href = wiki && /\.md$/i.test(code) ? wiki.page(code) : '';
    return keep(href ? `<a href="${esc(href)}">${html}</a>` : html);
  });
  out = esc(out);
  const strong = (value) => value.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
  out = out.replace(/\[([^\]]+)\]\((&lt;.*?&gt;|[^)\s]+)\)/g, (all, label, target) => {
    // A link to a page of the wiki opens the wiki page, so that the user stays in the forge pages.
    const page = wiki ? wiki.link(unesc(target)) : '';
    const href = page || linkTarget(unesc(target));
    // On the wiki page (ctx.plain), a relative link to a file that is not a page has no target: its words stay as text.
    if (!href || (ctx.plain && !page && !/^[a-z][a-z0-9+.-]*:/i.test(href))) return label;
    return keep(`<a href="${esc(href)}"${/^https?:/i.test(href) ? ' target="_blank" rel="noopener noreferrer"' : ''}>${strong(label)}</a>`);
  });
  // The path of a wiki page in the text is a link to that page.
  if (wiki) {
    out = out.replace(/(^|[\s(])((?:[\w.-]+\/)+[\w.-]+\.md)(?![\w\/-])/g, (all, lead, relative) => {
      const href = wiki.page(relative);
      return href ? `${lead}${keep(`<a href="${esc(href)}">${relative}</a>`)}` : all;
    });
  }
  out = strong(out);
  out = out.replace(/(^|[\s(])(https?:\/\/[^\s<)]+)/g, (all, lead, url) => `${lead}<a href="${url.replace(/"/g, '%22')}" target="_blank" rel="noopener noreferrer">${url}</a>`);
  // A kept piece can hold the mark of another piece: the code in the label of a link.
  const restore = (value) => value.replace(/(\d+)/g, (_, index) => restore(kept[Number(index)] ?? ''));
  return restore(out);
}

const ITEM = /^(\s*)([-*+]|\d+[.)])\s+(.*)$/;

function list(lines, start, ctx) {
  const first = ITEM.exec(lines[start]);
  const base = first[1].length;
  const items = [];
  let i = start;
  while (i < lines.length) {
    const line = lines[i];
    const match = ITEM.exec(line);
    if (match && match[1].length === base) { items.push({ text: [match[3]], children: '' }); i++; continue; }
    if (match && match[1].length > base) { const [html, next] = list(lines, i, ctx); items.at(-1).children += html; i = next; continue; }
    if (!line.trim()) {
      const next = lines[i + 1];
      const nextItem = next === undefined ? null : ITEM.exec(next);
      if (nextItem && nextItem[1].length >= base) { i++; continue; }
      break;
    }
    if (line.match(/^\s*/)[0].length > base) { items.at(-1).text.push(line.trim()); i++; continue; }
    break;
  }
  const tag = /\d/.test(first[2]) ? 'ol' : 'ul';
  return [`<${tag}>${items.map((item) => `<li>${inline(item.text.join(' '), ctx)}${item.children}</li>`).join('')}</${tag}>`, i];
}

/** A small Markdown subset as HTML: paragraphs, lists, tables, code, quotes, links, and bold. */
export function markdown(text, ctx = {}) {
  const lines = String(text ?? '').replace(/\r\n/g, '\n').split('\n');
  const out = [];
  let paragraph = [];
  const flush = () => { if (paragraph.length) { out.push(`<p>${inline(paragraph.join(' '), ctx)}</p>`); paragraph = []; } };
  let i = 0;
  while (i < lines.length) {
    const line = lines[i];
    const fence = /^\s*(`{3,}|~{3,})\s*(\S*)/.exec(line);
    if (fence) {
      flush();
      const body = [];
      i++;
      while (i < lines.length && !lines[i].trim().startsWith(fence[1])) body.push(lines[i++]);
      i++;
      out.push(`<pre${fence[2] ? ` data-lang="${esc(fence[2])}"` : ''}><code>${esc(body.join('\n'))}</code></pre>`);
      continue;
    }
    if (!line.trim()) { flush(); i++; continue; }
    if (/^\s*\|/.test(line) && /^\s*\|?\s*:?-{2,}/.test(lines[i + 1] ?? '')) {
      flush();
      const head = tableRow(line);
      i += 2;
      const rows = [];
      while (i < lines.length && /^\s*\|/.test(lines[i])) rows.push(tableRow(lines[i++]));
      out.push(`<table><thead><tr>${head.map((cell) => `<th>${inline(cell, ctx)}</th>`).join('')}</tr></thead><tbody>${rows.map((row) => `<tr>${row.map((cell) => `<td>${inline(cell, ctx)}</td>`).join('')}</tr>`).join('')}</tbody></table>`);
      continue;
    }
    const heading = /^(#{1,6})\s+(.*)$/.exec(line);
    // The levels stay, one below the title of the page (# gives h2).
    if (heading) { flush(); const tag = `h${Math.min(6, heading[1].length + 1)}`; out.push(`<${tag}>${inline(heading[2], ctx)}</${tag}>`); i++; continue; }
    if (/^\s*>/.test(line)) {
      flush();
      const quote = [];
      while (i < lines.length && /^\s*>/.test(lines[i])) quote.push(lines[i++].replace(/^\s*>\s?/, ''));
      out.push(`<blockquote>${markdown(quote.join('\n'), ctx)}</blockquote>`);
      continue;
    }
    if (ITEM.test(line)) { flush(); const [html, next] = list(lines, i, ctx); out.push(html); i = next; continue; }
    paragraph.push(line.trim());
    i++;
  }
  flush();
  return out.join('\n');
}
