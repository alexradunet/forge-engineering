// The Markdown subset of the forge pages: the link targets and the escaped HTML.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { linkTarget, markdown } from '../plugins/forge/scripts/lib/markdown.mjs';

test('link targets of a local file are file links, keep ticket links relative, and refuse other schemes', () => {
  assert.equal(linkTarget('/repo/src/RetryJob.cs:42'), 'file:///repo/src/RetryJob.cs');
  assert.equal(linkTarget('C:\\repo\\My File.cs:7:3'), 'file:///C:/repo/My%20File.cs');
  assert.equal(linkTarget('<C:/repo/a b.cs>'), 'file:///C:/repo/a%20b.cs');
  assert.equal(linkTarget('evidence/2026-11-11-config.md'), 'evidence/2026-11-11-config.md');
  assert.equal(linkTarget('https://example.com/a?b=1'), 'https://example.com/a?b=1');
  for (const target of ['javascript:alert(1)', 'data:text/html,x', 'vbscript:x', '#top', '//example.com/x']) assert.equal(linkTarget(target), '', target);
});

test('markdown becomes escaped HTML: no source text can add a tag, a handler, or a script link', () => {
  const html = markdown([
    'A <script>alert(1)</script> & "quoted" `<b>code</b>`.', '',
    '- [bad](javascript:alert) and [good](story.md#scope) and **bold**',
    '  - nested <img src=x onerror=alert(1)>', '',
    '| A | B |', '|---|---|', '| 1 | <i>2</i> |', '', '```html', '<p onclick="x()">', '```',
  ].join('\n'));
  assert.doesNotMatch(html, /<script|<img|<i>|<b>|<p onclick/);
  assert.doesNotMatch(html, /href="javascript:/);
  assert.match(html, /&lt;script&gt;alert\(1\)&lt;\/script&gt; &amp; &quot;quoted&quot; <code>&lt;b&gt;code&lt;\/b&gt;<\/code>/);
  assert.match(html, /<li>bad and <a href="story\.md#scope">good<\/a> and <strong>bold<\/strong><ul><li>nested &lt;img/);
  assert.match(html, /<table><thead><tr><th>A<\/th><th>B<\/th><\/tr><\/thead><tbody><tr><td>1<\/td><td>&lt;i&gt;2&lt;\/i&gt;<\/td><\/tr><\/tbody><\/table>/);
  assert.match(html, /<pre data-lang="html"><code>&lt;p onclick=&quot;x\(\)&quot;&gt;<\/code><\/pre>/);
});
