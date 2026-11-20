// A Mermaid drawing (.mermaid) and the script that draws the diagram blocks with the Mermaid file of forge.
import { client } from './kit.mjs';

const CSS = String.raw`
.mermaid { margin: 0 0 var(--s-3); padding: var(--s-3); overflow: auto; text-align: center; background: var(--card); border: 1px solid var(--line); }
.mermaid svg { max-width: 100%; height: auto; }
#mermaid-stage { position: fixed; left: 0; top: 0; z-index: -1; width: 960px; visibility: hidden; pointer-events: none; }
`.trim();

const script = client(function () {
  // Mermaid: a diagram block (a code block with the name mermaid) becomes a drawing. The Mermaid file of forge (data.mermaid) comes from
  // the folder or the server of the page. Mermaid draws in a stage outside of the page parts, so a hidden part and the zoom of a page
  // do not change its measures. The block keeps its text: a block that Mermaid cannot draw stays as code.
  // pick() gives the part of the page with the blocks to draw now, and after() runs when a set of drawings is in the page.
  var mermaidState = '';
  var mermaidBusy = false;
  var mermaidJob = null;
  function darkNow() {
    var name = document.documentElement.getAttribute('data-theme');
    return name === 'dark' || (!name && !!window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches);
  }
  function drawMermaid(pick, after) {
    mermaidJob = { pick: pick, after: after };
    var root = pick();
    if (!data.mermaid || !root || mermaidState === 'failed' || mermaidState === 'loading' || mermaidBusy) return;
    var theme = darkNow() ? 'dark' : 'light';
    var blocks = Array.prototype.filter.call(root.querySelectorAll('pre[data-lang="mermaid"]'), function (pre) {
      return pre.getAttribute('data-drawn') !== theme && pre.getAttribute('data-drawn') !== 'no';
    });
    if (!blocks.length) return;
    if (!mermaidState) {
      mermaidState = 'loading';
      var tag = document.createElement('script');
      tag.src = data.mermaid.src;
      if (data.mermaid.integrity) tag.integrity = data.mermaid.integrity;
      tag.onload = function () { mermaidState = window.mermaid ? 'ready' : 'failed'; drawMermaid(mermaidJob.pick, mermaidJob.after); };
      tag.onerror = function () { mermaidState = 'failed'; toast('The page cannot load the Mermaid file. Run forge.mjs board again.'); };
      document.head.appendChild(tag);
      return;
    }
    // The drawing uses the tokens of the design system, so it has the colors of the page in each theme.
    var style = getComputedStyle(document.documentElement);
    var token = function (name) { return style.getPropertyValue(name).trim(); };
    window.mermaid.initialize({
      startOnLoad: false, securityLevel: 'strict', theme: 'base',
      themeVariables: {
        darkMode: theme === 'dark', background: token('--card'), fontFamily: token('--font'), fontSize: '14px',
        primaryColor: token('--panel'), primaryTextColor: token('--ink'), primaryBorderColor: token('--line-2'),
        secondaryColor: token('--bg'), tertiaryColor: token('--card'), lineColor: token('--muted'), textColor: token('--ink'),
        edgeLabelBackground: token('--card'), noteBkgColor: token('--bg'), noteTextColor: token('--ink'), noteBorderColor: token('--line-2')
      }
    });
    var stage = byId('mermaid-stage');
    if (!stage) {
      stage = make('div');
      stage.id = 'mermaid-stage';
      stage.setAttribute('aria-hidden', 'true');
      document.body.appendChild(stage);
    }
    var outs = blocks.map(function (pre) { return stage.appendChild(make('div', 'mermaid', pre.textContent)); });
    mermaidBusy = true;
    var done = function () {
      mermaidBusy = false;
      blocks.forEach(function (pre, index) {
        var out = outs[index];
        var ok = !!out.querySelector('svg') && !out.querySelector('.error-icon');
        var old = pre.previousElementSibling;
        if (old && old.classList.contains('mermaid')) old.parentNode.removeChild(old);
        pre.setAttribute('data-drawn', ok ? theme : 'no');
        pre.hidden = ok;
        if (ok) pre.parentNode.insertBefore(out, pre);
        else { stage.removeChild(out); pre.title = 'Mermaid cannot draw this block.'; }
      });
      if (mermaidJob.after) mermaidJob.after();
      // The part in view or the theme can change while Mermaid draws.
      drawMermaid(mermaidJob.pick, mermaidJob.after);
    };
    window.mermaid.run({ nodes: outs, suppressErrors: true }).then(done, done);
  }
});

export const diagram = {
  name: 'diagram',
  css: CSS,
  html: {},
  script,
  demo: () => [{
    title: 'A drawing box (the page draws a Mermaid block into it)',
    html: '<div class="mermaid"><svg viewBox="0 0 300 70" width="300" height="70" role="img" aria-label="Scheduler calls RetryJob, which reads the Outbox table">'
      + '<rect x="2" y="15" width="90" height="38" rx="4" fill="var(--panel)" stroke="var(--line-2)"/><text x="47" y="39" text-anchor="middle" font-size="13" fill="var(--ink)">Scheduler</text>'
      + '<rect x="105" y="15" width="90" height="38" rx="4" fill="var(--panel)" stroke="var(--line-2)"/><text x="150" y="39" text-anchor="middle" font-size="13" fill="var(--ink)">RetryJob</text>'
      + '<rect x="208" y="15" width="90" height="38" rx="4" fill="var(--panel)" stroke="var(--line-2)"/><text x="253" y="39" text-anchor="middle" font-size="13" fill="var(--ink)">Outbox</text>'
      + '<path d="M92 34h13M195 34h13" stroke="var(--muted)" fill="none"/></svg></div>',
  }],
};
