# 🎨 Forge design system

The forge pages are the board page (`raw/board.html`), the wiki page (`raw/wiki.html`), and the styleguide (`raw/styleguide.html`). The live server also writes the error pages.
All of them use one UI kit: the folder [`scripts/lib/ui/`](../plugins/forge/scripts/lib/ui/). Read this document before you change a page.
[`scripts/lib/ui.mjs`](../plugins/forge/scripts/lib/ui.mjs) only re-exports the kit, so each importer keeps its path.
`board-page.mjs` and `wiki-page.mjs` add only the parts of their own page.
`tests/ui-kit.test.mjs` and `tests/board-page.test.mjs` keep this document and the code the same.

## 🧭 Principles

1. Signal only. A color or an emoji shows a state. It is never decoration.
2. A state has its words. Color alone carries no fact, so the pages also work without color.
3. The ticket that waits for the user comes first, on each page.
4. A page is one file. It loads nothing from a network: no font, no image file, no script from another place. The one exception is the Mermaid file of a page with a Mermaid block, which comes from the folder or the server of the page.
5. A page is a view. The Markdown files of the ticket are the source, and no approval comes from a page.
6. The keyboard can do each step. The mouse can do the same steps.
7. The same part looks the same on each page: one bar, one switcher, one help dialog, one toast, one notice.
8. The look is a forge: square frames, hard shadows, no blur, and no round corner.
9. Pixel art is for the frame only: the logo, the icons, the headings, the counts of a lane, and the gate ingots. Text to read keeps the system font.

## 🧱 The kit

One file for each part. The folder is `plugins/forge/scripts/lib/ui/`.

| File | Holds |
|---|---|
| `index.mjs` | `COMPONENTS`, the two order lists (`STYLE_ORDER`, `SCRIPT_ORDER`), `UI_STYLE`, `UI_SCRIPT`, and the re-exports |
| `kit.mjs` | `esc()`, `client()`, and `checkComponent()` |
| `tokens.mjs` | `TOKENS` (data), `PAIRS` (the contrast contract), `BREAK`, `tokensCss()`, `tokenTable()`, `ratio()`, `mix()` |
| `pixel.mjs` | The sprites (`SPRITES`, `iconHtml()`), the 5 by 7 letters (`FONT`, `pixelText()`), `faviconUri()`, and `step()` |
| `page.mjs` | `pageHtml()`, `pageScript()`, `NOTICE_HTML`, `errorPage()`, `policy()`, and `ERROR_POLICY` |
| `nav.mjs` | `buildNav()`, `navData()`, `GATE_TEXT`, `pageLabel()`, the links script, and the shared keys |
| `base.mjs` | The reset, the focus ring, `kbd`, `code`, `.sr`, `.skip`, `.eyebrow`, the table, the `st-*` classes, and the script helpers |
| `button.mjs` | The buttons, `TOOLS_HTML`, and the theme script |
| `pill.mjs` | `pillHtml()`, `chipHtml()`, `tagHtml()`, and `countHtml()` |
| `frame.mjs` | `frameHtml()`: the box of the pages |
| `gates.mjs` | `gatesHtml()` and the spark script |
| `search.mjs` | `searchHtml()` |
| `banner.mjs` | `bannerHtml()` and the notice script (`notice()`, `clearNotice()`, `noticeIs()`) |
| `empty.mjs` | `emptyHtml()` |
| `prose.mjs` | `proseHtml()`: the style of text from Markdown |
| `live.mjs` | The live line, the closed session row, **Resume**, **Copy command**, the live request, the tab icon swap, and the changed notice |
| `diagram.mjs` | The drawing box (`.mermaid`) and the Mermaid script |
| `bar.mjs` | `brandHtml()`, `footHtml()`, the bar (`#rail`, `.bar`), and the foot (`#foot`) |
| `dialog.mjs` | `switcherHtml()`, `helpHtml()`, and their scripts |
| `toast.mjs` | The toast (`#toast`) and `toast()` |
| `styleguide.mjs` | `renderStyleguide()`: the page of each token, sprite, letter, and component, in both themes |

### The component contract

A component is one object. `checkComponent()` throws at import when a field is wrong.

| Field | Rule |
|---|---|
| `name` | A lowercase word, unique in the kit |
| `css` | The main style, written with `String.raw`. It uses tokens, not a color or a size of its own |
| `html` | An object of pure helper functions. Each helper returns HTML text and escapes each value that it gets |
| `script` | `client(function () { ... })`, or `''`. It uses no backtick, no CR, no `innerHTML`, and no address |
| `demo` | A function that gives `[{ title, html }]` for the styleguide |
| `cssParts`, `scriptParts` | Optional. More named texts, because the order of the style and the order of the script can differ |

- `client(fn)` gives the body of a function as text with LF line ends. The author writes real JavaScript, so the editor and the import check the syntax. The page still has one classic inline script.
- A part of a script can use the names of a part before it or after it (`data`, `byId`, `toast`, `notice`). All parts land in one function.
- `index.mjs` has two order lists. `STYLE_ORDER` is a list of groups of `[component, part]`, and `SCRIPT_ORDER` is a list of `[component, part]`. The part `css` (or `script`) is the main text. Another name is a key of `cssParts` (or `scriptParts`).
- A non-empty part that no list names throws at import, and so does a part that a list names two times. The order is explicit, so the same input gives the same bytes.
- `UI_STYLE` is the tokens and then each group of the style order. `UI_SCRIPT` is each script part in order. A page style starts with `UI_STYLE`, and a page script holds `UI_SCRIPT`.

## 🎚️ Tokens

Each token is a CSS custom property on `:root`. The table is `tokenTable()` of `tokens.mjs`, and `tests/ui-kit.test.mjs` checks that this document has each row.
A page never uses a color or a size that is not a token, with one exception: the width of a command line in the notice.

| Token | Light | Dark | Use |
|---|---|---|---|
| `--bg` | #ece5d8 | #131110 | The page background. |
| `--panel` | #f4eee3 | #1a1715 | A quiet panel on the page. |
| `--card` | #fffcf5 | #231f1c | A card, a field, or a button face. |
| `--rail` | #f4eee3 | #1a1715 | The bar at the top, a dialog, and the foot. |
| `--ink` | #1e1a16 | #ede7db | Main text. |
| `--muted` | #544c42 | #aba295 | Second text: labels, times, and notes. |
| `--faint` | #6a6156 | #948b7e | Third text, and the done state. |
| `--line` | #d3cab9 | #39332d | A thin border or a divider. |
| `--line-2` | #857b6c | #746b5e | A stronger border, for example around a key cap. |
| `--accent` | #1d5a85 | #84b9e6 | Links, the focus ring, the active state, and the main button. |
| `--amber` | #855400 | #f2b54a | The needs-you state and a gate that waits for the user. |
| `--green` | #1f6a3a | #78c693 | The go state and an approved gate. |
| `--red` | #a5301f | #f28e76 | The blocked state and an error. |
| `--violet` | #63468c | #bda6e6 | The waiting state (a person has the turn). |
| `--ember` | #b23c0a | #ff8038 | The brand heat: the hot spot of the logo and the ring of a gate in review. |
| `--steel` | #5d6976 | #9eabb8 | A cold ingot (an approved gate). A mark only, never text. |
| `--glow` | #f0a830 | #ffc04d | The fill of a gate ingot that waits for the user. A mark inside an ember frame, never text. |
| `--shade` | #1e1a16 | #000000 | The hard shadow and the heavy frame. |
| `--t-xs` | 12px | 12px | Small print: key caps, times, and footers. |
| `--t-sm` | 13px | 13px | Labels, pills, and table text. |
| `--t-md` | 15px | 15px | Body text. |
| `--t-lg` | 17px | 17px | A page title and a card title. |
| `--t-xl` | 20px | 20px | A large heading. |
| `--t-2xl` | 26px | 26px | The largest heading. |
| `--s-1` | 4px | 4px | The smallest gap. |
| `--s-2` | 8px | 8px | A gap between small parts. |
| `--s-3` | 12px | 12px | A gap inside a card. |
| `--s-4` | 16px | 16px | The side padding of a bar. |
| `--s-5` | 24px | 24px | A gap between blocks. |
| `--s-6` | 32px | 32px | A gap between sections. |
| `--s-7` | 48px | 48px | The largest gap. |
| `--sh-1` | 2px 2px 0 var(--line-2) | 2px 2px 0 var(--line-2) | A card: a hard shadow of one pixel unit. |
| `--sh-2` | 4px 4px 0 var(--shade) | 4px 4px 0 var(--shade) | A dialog and the toast. |
| `--font` | system-ui, -apple-system, "Segoe UI", Roboto, sans-serif | system-ui, -apple-system, "Segoe UI", Roboto, sans-serif | The text font. |
| `--mono` | ui-monospace, SFMono-Regular, Consolas, "Liberation Mono", monospace | ui-monospace, SFMono-Regular, Consolas, "Liberation Mono", monospace | Keys, code, and paths. |
| `--px` | 2px | 2px | The pixel unit: a border, a stepped corner, and a pixel of a letter. |

Themes:

- The light values are the default. The dark values apply when the system asks for a dark page (`prefers-color-scheme`), or when the user selects the dark theme with the theme button.
- The button has 3 values (auto, light, dark). The browser keeps the value for each forge page (`forge-ui:theme`).
- The corners are square, so there is no radius token. A stepped corner comes from `step()` (see the pixel system).
- Add a color token to both themes, and add a row to `PAIRS` when text or a mark uses it.

### Contrast contract

`PAIRS` in `tokens.mjs` is the list of pairs that must pass. `tests/ui-kit.test.mjs` checks each pair in both themes. The styleguide shows the same table.

| Pair | Minimum |
|---|---|
| Each text token (`--ink`, `--muted`, `--faint`, `--accent`, `--amber`, `--green`, `--red`, `--violet`) on `--bg`, `--panel`, `--card`, and `--rail` | 4.5 to 1 |
| `--line-2`, `--steel`, and `--ember` (marks) on the same 4 surfaces | 3 to 1 |
| `--card` on `--accent` (the main button) | 4.5 to 1 |
| `--bg` on `--ink` (the toast) | 4.5 to 1 |

`--glow` is not in the list. It is only the fill of a mark inside an `--ember` frame, and the frame carries the contrast.

### Breakpoint

The pages have one breakpoint: `BREAK.narrow` (760 px). Each width in a media query is that value (`tests/ui-kit.test.mjs`).
Below it, the bar wraps, the lanes go below each other, and the cards take the full width.

## ⚒️ The pixel system

[`pixel.mjs`](../plugins/forge/scripts/lib/ui/pixel.mjs) draws the pixel parts as inline SVG. A path has square pixels (`shape-rendering="crispEdges"`). No image file and no network part is used.

| Part | Rule |
|---|---|
| Sprite | 16 rows of 16 characters. `.` is empty, `#` is `currentColor`, `o` is `--ember`, `+` is `--glow`, `s` is `--steel`. `iconHtml(name, { size, label })` merges each horizontal run into one path for each color. The size is 16, 32, 48, and so on |
| Sprites | `anvil` (the logo and the hot tab icon), `anvil-cold` (an empty state and the calm tab icon), `ember`, `hammer`, `ingot` |
| Letters | 5 columns and 7 rows for A to Z, 0 to 9, and `? ! . , : - + / ( ) ' &`. `pixelText(text, { scale, label })` gives an SVG and the real text in a `.sr` span. Scale 2 is for labels, 3 is for a page title and a heading, and 4 is the largest |
| Fallback | A text with a character outside of the glyph set gives plain escaped text |
| Stepped corner | `step(color)` gives 4 box-shadows that make a cross around a box, so the 4 corner pixels stay empty. It has no `clip-path`. Only buttons, pills, chips, tags, counts, and ingots have it |
| Tab icon | `faviconUri('calm' or 'needs')` gives the anvil as a standalone SVG in a `data:` address, with its own colors for the light and the dark scheme |

When to use the letters: a logo word, a page title, a lane or a zone name, and a heading. Never for a sentence, a ticket title, or a number that a user compares. A count is a number in the mono font, not a pixel digit.

The pixel text is not real text for a browser:

- The real text is in a `.sr` span, so a screen reader, a copy, and `textContent` get it.
- The page search of a browser marks a pixel heading as a small box (see Known limits).

### Gate ingots

One `gates` component serves the board card. Each status differs by shape and by color.

| Status | Words | Look |
|---|---|---|
| `approved` | approved | A steel ingot (`--steel`) |
| `in-review` | needs you | An amber ingot (`--glow`) in an ember frame (`--ember`), with its words |
| `todo` | not open | An empty frame (`--line-2`) |
| `blocked` | blocked | A red ingot (`--red`) with a notch, with its words |
| `skipped` | skipped | A dotted outline |

The words of a gate that needs attention show next to its ingot. The other gates have their words in the tooltip and for a screen reader.

The spark is one 0.6 s animation (`steps(4)`) on an ingot that is approved now and was not approved at the last visit of the page. The script keeps the statuses in `forge-ui:gates:<folder>`. A first visit gives no spark, and a browser with no storage gives none. A user who asks for less motion gets none (`prefers-reduced-motion`).

## 🧩 Components

Each component has its helpers in the kit. A page makes the HTML with the helpers. It never writes the HTML of a kit class by hand.

| Component | Helpers and classes | Rules |
|---|---|---|
| Base | `.sr`, `.skip`, `.key`, `.tools`, `.eyebrow`, `kbd`, `code`, `table`, `.st-<state>` | `.st-<state>` sets `--st`. `.key` is a ticket key in the mono font |
| Button | `button`, `.primary`, `.quiet`, `.icon`, `TOOLS_HTML` | One `.primary` for each surface (**Open** on the next strike). `a.primary` has the same look. A quiet button has no frame until the pointer is on it. `aria-pressed="true"` shows a pressed state |
| Pill | `pillHtml(label, state)`, `.pill` | The label of one state, with its color |
| Chip | `chipHtml(label, state, count, opts)`, `.chip` | A pill that filters. It is a button with `aria-pressed`, and it can show a count and a mark |
| Tag | `tagHtml(text, kind)`, `.tag`, `.tg-ok`, `.tg-bad`, `.tg-wait` | One short quiet fact |
| Count | `countHtml(value)`, `.count` | A small box with a number |
| Frame | `frameHtml(inner, opts)`, `.frame`, `.edge`, `.sunk` | A square face with a one-unit border and the shadow `--sh-1`. `.edge` adds a left edge in the state color. `.sunk` is a quiet panel with no shadow (a lane) |
| Gates | `gatesHtml(gates, opts)`, `.gates`, `.ingot`, `.ig-<status>` | See Gate ingots. `folder` gives the row its key for the spark |
| Search | `searchHtml(opts)`, `.search` | One field for the board and the wiki. A `.sr` label, the input, and the key cap of its shortcut. The focus is a ring around the whole field |
| Banner | `bannerHtml(inner, opts)`, `.banner`, `.bn-info`, `.bn-warn`, `.bn-bad` | A frame with a left edge in the color of its kind, a text, and buttons. A banner is a status region unless `live: false` |
| Empty | `emptyHtml(text, opts)`, `.empty` | An optional sprite, one sentence, and optional numbered steps. One component on each page |
| Prose | `proseHtml(inner)`, `.prose` | The style of text from Markdown: headings, lists, code, quote, and table |
| Live line | `.live`, `.lv-<state>`, `.lv-acts` | One session: the state and its time, the tool that runs now, the count of subagents, and the text of a wait. A closed row is `.live.past` with **Resume** and **Copy command** |
| Diagram | `.mermaid`, `#mermaid-stage` | The drawing of a Mermaid block. Mermaid draws in a stage outside of the page parts. A block that Mermaid cannot draw stays as code |
| Bar and foot | `brandHtml()`, `footHtml()`, `#rail`, `.bar`, `#foot` | See The page shell |
| Switcher | `switcherHtml(nav)`, `#switcher` | One dialog with a filter and each ticket in board order, and then the closed tickets |
| Help | `helpHtml(rows)`, `#help` | The keys and the mouse steps of the page. The foot of each page says "Press ? for the keys" |
| Toast | `#toast`, `toast(text)` | One line for the result of a step. It goes away after 4 seconds |
| Notice | `#notice`, `notice(kind, text, actions, more)` | See The notice and the toast |

Parts that belong to one page:

| Page | Parts |
|---|---|
| Board | The next strike (`#strike`), the lanes (`.lane`, `.side`), the ticket card (`.tcard`), the lists of other sessions, people waits, closed tickets, and read errors |
| Wiki | The page list (`#tree`), the page text (`.wpage`, `.wmeta`), the sources, and **Used by** |

## 🧱 The page shell

`pageHtml()` in `page.mjs` writes each page. The head has a fixed order: the meta tags, the title, the one icon link, the style, the data block, and the one script. The body starts with the skip link.

- `pageScript(dataId, body, { before })` makes the one script. Its first part runs at once and sets the theme (`data-theme` from `forge-ui:theme`) before the first paint, so a user of the dark theme on a light system sees no light flash. The rest waits for `DOMContentLoaded`.
- The icon is one `<link rel="icon" href="data:image/svg+xml,...">`. A live page swaps it between `calm` and `needs` with the two addresses in the data block. The script holds no drawing.
- The title of the board is `(2) Forge board` when 2 tickets need the user, and `Forge board` when none does.
- The skip link is the first element of the body. It names the main part of the page (`main`), and it shows when it has the focus.
- `NOTICE_HTML` is the hidden notice. It comes after the body.
- A page has a bar `header#rail > div.bar`, a main part, and the foot `#foot` with the line "Press ? for the keys".
- A page has 2 `<script` tags: the data block and the one script. A served page names the script by its hash, so the text is the same on each run.

### Content policy

A served page has this policy (`policy()` in `live-serve.mjs`): `default-src 'none'`, `script-src` with the hash of the script, `style-src 'unsafe-inline'`, `img-src data:`, `connect-src 'self'`, `base-uri 'none'`, and `form-action 'none'`.

- `img-src data:` is there for the tab icon. A `data:` address in a `<link rel="icon">` needs it. No other image source is allowed, so a page cannot load an image from a network.
- The content policy of a page that runs one script is `policy(script, { self, connect })`. A served page (its data block has a `token`) gets it as a header from the live server, with `connect-src 'self'`. A file page that Forge writes (`raw/board.html`, `raw/wiki.html`) gets it as a `<meta http-equiv="Content-Security-Policy">` right after `<meta charset>`, with no `connect-src`. A served page has no meta, because a meta adds to the header and would block the fetch of the page code. A wiki file page with a diagram block adds `'self'`, so that it can load the Mermaid file from its own folder.
- An error page (`errorPage()`) has no script. It has its own `ERROR_POLICY`: `default-src 'none'; style-src 'unsafe-inline'; img-src data:; base-uri 'none'; form-action 'none'`. It follows the system theme, because it has no script to read the stored choice.

## 🔤 The words of the pages

| State | Page word | `raw/board.md` and session groups |
|---|---|---|
| `needs-me` | Needs you | Needs me |
| `blocked` | Blocked | Blocked |
| `go` | Go | Go |
| `active` | Active | Active |
| `waiting` | Waiting | Waiting |
| `done` | Done | Done |

| Gate status | Words (`GATE_TEXT`) |
|---|---|
| `approved` | approved |
| `in-review` | needs you |
| `todo` | not open |
| `blocked` | blocked |
| `skipped` | skipped |

| Live state | Words |
|---|---|
| `working` | working |
| `needs-you` | needs you |
| `idle` | idle |
| `ended` | ended |

- One state has one word on a page: the state of a ticket, the status of a gate, and the state of a session all say "needs you".
- `pageLabel()` in `nav.mjs` maps the state `needs-me` to "Needs you". `STATE_LABEL` in `board.mjs` keeps "Needs me" for `raw/board.md` and the session groups. A rename there changes a skill and needs a paid eval run.
- The gate words come from `GATE_TEXT`. Do not write a gate word in a page.

## 🏷️ Names

- A kit class has no page prefix: `.frame`, `.pill`, `.banner`, `.empty`.
- A new page class has a page prefix, and no page class has the name of a kit class or of a class of another page. `tests/ui-kit.test.mjs` finds each collision.
- The prefixes are: `t` and `b` on the board (`.tcard`, `.bhead`), and `w` on the wiki page (`.wmeta`, `.wpage`). Some older classes have none (`.lane`, `.side`, `.cards`, and `.chips` on the board). The test needs only that no name collides.
- A page rule for a kit class must start with an id or a class of the page (`#rail .bar`, `.tcard .open`). Then it styles a place of the page, not the part.
- A page rule never styles a bare tag that the kit styles (`table`, `th`, `td`, `button`, `kbd`, `code`, `a`).
- The state classes are `st-<state>` (variable `--st`). The live classes are `lv-<state>`. The name that ended a collision is gone: the wiki `.meta`.

## ♿ Access rules

- Each focusable element has a visible focus ring: `outline: 2px solid var(--accent)` from the kit. A rule with `outline: none` must have a rule that shows the focus (`tests/ui-kit.test.mjs`). The search field shows its ring on the whole field.
- The skip link is the first element of the body. It shows when it has the focus, and then it covers the logo.
- A part that changes with no action of the user is a live region (`role="status"` or `aria-live="polite"`): the filter result of the board and the wiki, the live note of the foot, and the notice. A banner that starts hidden is not a live region. A separate region says its result.
- An age or a time is never a live region.
- The theme button shows its state in its text (`Theme: auto`).
- A decoration is `aria-hidden`. An ingot row is one image for a screen reader, and its label lists each gate.
- A user who asks for less motion gets no animation: the spark and the pulse of a working session.

## 🔔 The notice and the toast

| | Toast | Notice |
|---|---|---|
| Element | `#toast` | `#notice` |
| Use | A result that is over in a moment: a copy, a theme change, a refusal | A state that stays until it ends: the server stopped, the link is old, the board changed |
| Time | 4 seconds | Until the script clears it |
| Actions | None | Buttons: **Copy command**, **Try again**, **Reload**, **Later** |
| Region | `role="status"` | `aria-live="polite"`, and the banner is not a status region |
| Place | The bottom center, above the foot | The bottom left, above the foot. It moves no part of the page |

`notice(kind, text, actions, more)` takes `kind` (`info`, `warn`, or `bad`), a plain text, a list of `{ text, run }` or `{ text, copy }` (with `quiet: true` for a quiet button), and `more` (`code`: a command in a block that one click selects, and `tag`: a name for `noticeIs()`). A text goes in as text, never as HTML.

## 📐 Layout of the pages

The board page:

```text
+--------------------------------------------------------------------------+
| [anvil] FORGE  [Filter /]  (Needs you 2) (Blocked 1) ..  Wiki [Go to..] ?|
+--------------------------------------------------------------------------+
| APP-101  Shippable? needs you. Read review.md.                   [Open]  |
|                                                                          |
| NEEDS YOU 2                                            full width, first |
|   [ticket card] [ticket card]                                            |
|                                                                          |
| BLOCKED 1        GO 1            ACTIVE 2         WAITING 1   side by    |
|   [card]           [card]          [card]           [card]    side       |
|                                    [card]                                |
| > Done 2                                       a closed list at the end  |
| > Closed tickets 3              their summary pages on the wiki page     |
| People waits (table)      Read errors (list)                             |
+--------------------------------------------------------------------------+
| Generated ...                 Live view ...             Press ? for keys |
+--------------------------------------------------------------------------+
```

The strip at the top is the next strike: the one next step for the user. `nextStrike(board)` in `board.mjs` picks it, and it is not part of `board --json`. The order is: a ticket that needs the user with a gate in review (the oldest first), another ticket that needs the user, a blocked ticket, and a ticket that can start.

The wiki page:

```text
+--------------------------------------------------------------------------+
| [anvil] Board / WIKI  [Filter /]                    [Go to a ticket] ?   |
+----------------------+---------------------------------------------------+
| WIKI 2               | tooling / build.md                                |
|  Wiki index          | Build                                             |
|  Wiki log            | (verified) updated 2026-11-10  Open the file      |
| DECISIONS 2          |                                                   |
|  ...                 | The text of the page, with links to other pages   |
| CLOSED TICKETS 3     |                                                   |
|  APP-2: Old fix      | SOURCES   the sources of the page                 |
| TOOLING 2            | USED BY   APP-9 (ticket, active)                  |
|  Build               |           APP-2: Old fix (closed ticket)          |
+----------------------+---------------------------------------------------+
```

The link **Open the file** is on a file page only. A page of the live server has no `file://` link: a browser blocks it on an `http` page, and the file is on the machine of the server. There, a link to an absolute path in the text of a page stays as its words.

## 🚦 States

One state has one emoji, one word, and one color on each page (class `st-<state>`, variable `--st`).

| State | Emoji and page word | Color | Meaning of the color |
|---|---|---|---|
| `needs-me` | 🟡 Needs you | `--amber` | The user must act. Amber is also a gate in review, an open question, a planned change, and a comment |
| `blocked` | 🔴 Blocked | `--red` | The work cannot continue. Red is also a failed check and a problem |
| `go` | 🟢 Go | `--green` | The work can start. Green is also approved, done, and verified |
| `active` | ▶️ Active | `--accent` | An agent works |
| `waiting` | ⏳ Waiting | `--violet` | A person or a system outside must answer |
| `done` | ✅ Done | `--faint` | Closed |

## 📡 Live view

Only a page of the live server (`forge.mjs live`, which `forge.mjs open` starts) has the live parts. A file page stays as it is.
The session hooks send small events to that server, and the page asks the server for the state of the sessions.
A session has one of 4 live states (class `lv-<state>`, variable `--st`). They use the colors of the ticket states, so the live view has no token of its own.

| Live state | Words | Color | Meaning |
|---|---|---|---|
| `working` | working | `--accent` | The session runs a prompt. The mark moves, unless the system asks for less motion |
| `needs-you` | needs you | `--amber` | The session waits for the user: a permission prompt or a question |
| `idle` | idle | `--faint` | The turn ended, and the session waits for the next prompt |
| `ended` | ended | `--faint` | The session ended. It goes away after 30 minutes |

A session of the session list (`<forge>/raw/sessions.jsonl`) that is not live shows as a closed session row. It has one of 2 states: `closed` (the list has the end of the session) and `no end seen` (the list has only the start, so the session can be open in a terminal). Both use `--faint`.

A page sends no text and no answer to a session. Its one action for a session is **Resume**: the live server opens a terminal of the user with the command that continues the session.

## 📖 Wiki page

The wiki page (`raw/wiki.html` in the Forge folder) shows each canonical page of the wiki: each Markdown file of the wiki outside `forge/` and `.git`. `forge.mjs lint` checks the same files.
One file holds all pages. The address of a page is the path of its Markdown file after the `#` of the link, for example `wiki.html#tooling/build.md`.

- The list at the left has one group for each folder. The pages at the top of the wiki come first, and the folder `tickets/` has the name **Closed tickets**.
- A page shows its title, its status, its date, its text, and its sources. The status (`verified`, `decided`, or `needs-check`) uses the color of a ticket state, so the page has no token of its own.
- **Used by** lists the open tickets and the other pages that name the page. The index and the log are not in that list.
- A link to another page of the wiki changes only the page in view. A web address opens a new tab. A relative link to a file that is not a page stays as text.
- A Mermaid block becomes a drawing with the colors of the theme. The page loads the Mermaid file of Forge (`mermaid.tiny.js`) only when the wiki has such a block: from its own folder for a file page, and from its own server for a served page.

A closed ticket has no folder on the board. Its summary page (`tickets/<key>.md`) is in the wiki, so the board lists the closed tickets below the lanes, and each row opens the summary page on the wiki page.
The archive folder of a ticket stays on its machine, and no page shows it.

## 🧭 Navigation

The unit of the navigation is the ticket. One ticket has one session, and the session title starts with the ticket key.
No host gives a link that opens one session from a page, so a page cannot open a session. A page can only give the command that continues a closed session (**Resume** and **Copy command**).

| From | To | Mouse | Key |
|---|---|---|---|
| Board | The document of a ticket (the document of the gate in review, else the README) | The card | `j` and `k`, then `Enter` |
| Each page | A ticket by its key or its words | The key in the bar, or **Go to a ticket** | `t` |
| Each page | The wiki page | **Wiki** in the bar | `w` |
| Wiki | The board | **Board** in the bar | `b` |
| Board | The summary page of a closed ticket | The row in **Closed tickets** | `j` and `k`, then `Enter` |
| Wiki | Another page | The list at the left, or a link in the text | `j` and `k` |
| Wiki | A page by its words | The filter | `/`, then `Enter` |
| Wiki | A ticket that names the page | **Used by** below the text | None |

The order of the tickets is the order of the board: the state lanes, and the key in each lane. The key `j` goes to the next ticket in that order.

The links have two forms:

| Page | Board | A ticket file | Made by |
|---|---|---|---|
| File page | `board.html` | `tickets/<folder>/README.md` | `forge.mjs board` writes the board page and the wiki page |
| Page of the live server | `/board?t=<token>` | `/ticket/<folder>/README.md?t=<token>` | `forge.mjs live` reads the files again for each page. No page can send. The token is stable: it is in a key file, so a bookmark works after a restart |

The wiki page is next to the board page: `wiki.html` in a file page, and `/wiki?t=<token>` on a served page.
The switcher of each page also lists the closed tickets, after the tickets of the board.

The token of the live server is a secret of this machine. `forge.mjs open --new-link` writes a new one, and each older link stops.


| Case | What the page does |
|---|---|
| The user opens the board to see what waits | The strip at the top gives the next step. The **Needs you** lane is first and has the full width. Without such a ticket, the lane says "No ticket needs you." and shows the cold anvil |
| A ticket waits at a gate | The card shows the gate steps and "<gate> needs you". The card link opens the document of that gate |
| The wiki has many tickets | The filter (`/`) hides tickets by their words. A chip or a number key shows one state. **Done** is a closed list. A banner gives the count and **Show all** |
| The filter finds nothing | The banner says "No ticket agrees with the filter." and has **Show all** |
| An open ticket has no update for 7 days or more | The age is amber and bold, and its tooltip gives the days |
| A person does not answer for more than 3 working days | A tag on the card, and the **People waits** table |
| A ticket folder cannot be read | The **Read errors** list names the folder and the problem |
| The server stopped (the live server after a stop or 8 hours with no event and no page request) | The page stays and keeps its data. The notice says that the server stopped. On a live page it shows the command that starts the server (**Copy command**) and **Try again**. The page keeps asking, and the notice goes away when the server answers again with the same link. |
| The link is old (`open --new-link`) | A live page that is open shows the notice "This link is old" with the command for the new link. A direct load gets an error page (403) that says so. On the live server the error page names the command for the new link. Another caller gets the plain text |
| A session works on a ticket | The board card shows the live line: "working", the time, the tool that runs now, and the count of subagents that run |
| A session waits for the user | The live line is amber and says "needs you", with the text of the prompt of the host. The user answers in the session, not on the page |
| A session of the repository has no ticket on the board | The board lists it under **Other sessions**, with its title or its folder name |
| The user closed a session and wants it back | The card of its ticket or **Other sessions** shows "closed" with the time. **Resume** opens a new tab or window of the terminal of the user in the folder of the session, with the resume command of the harness. A toast says that a terminal opened |
| No terminal starts on the machine, or the live server stopped | The page puts the command on the clipboard, and a toast says to paste it into a terminal. **Copy command** does the same with no request. Without clipboard access, a dialog shows the command |
| The session list has the start of a session and no end (a closed terminal window, an end hook without time, or a Copilot CLI session that runs) | The row says "no end seen". The first click on **Resume** gives a toast: the session can be open in a terminal. The button becomes **Resume anyway** |
| The folder of a closed session is gone (a removed worktree) | The terminal opens in the main checkout, and the toast names that folder |
| The user selects **Resume** two times, or the session is live again | The server opens one terminal: a second request for the same session in 15 seconds gets a refusal, and a live session has no closed row |
| The user wants to open Forge from a terminal | `../<repo>.forge/forge open` starts the server of that repository when none runs, prints the links, and opens the board in the browser |
| The board has no ticket (first run) | The board shows the cold anvil and 3 numbered steps: start a session, give it a work item key, and see the ticket after its first step |
| A filter finds nothing | The board banner says "No ticket agrees with the filter." and the wiki banner says "No page has these words.". Each has **Show all**. A hidden status line tells a screen reader the result |
| A ticket file changed while a live page is open | The notice says "The board changed." with **Reload** and **Later**. The page never loads again by itself,. **Later** hides the notice until the next change |
| The address is wrong, or the server fails | An error page in the style of the kit (403, 404, or 500) with the cold anvil, a short text, and a link to the board. It has no script. A script or `curl` gets the plain text |
| The user has the board in another tab | The title shows `(2) Forge board` when 2 tickets need the user, and the tab icon has the hot spot. A live page updates them from the answer of the server |
| A gate is approved while the user watches the page | The new ingot shows the spark one time. A first visit shows no spark |
| Two repositories are open | Each repository has its own server, port, and pages. A session shows only on the pages of its repository, and a session in another folder shows on no page |
| A session works for 10 minutes without an event | The live line says "working, quiet" and shows the time since the last event |
| The live server does not answer, or it stopped | The page keeps the last state. The foot of the board says that the server does not answer, the notice shows the command, and the page asks again with longer waits |
| The page is not in view (another tab) | The page stops its requests, and it asks again when the user comes back |
| The user reads a wiki page and wants its tickets | **Used by** names each open ticket and each closed ticket that names the page |
| The user wants an old ticket | The board lists the closed tickets at its end, and the switcher (`t`) finds one by its key or its words. Each one opens its summary page in the wiki |
| The user looks for a fact in the wiki | The filter of the wiki page reads the title, the path, and the text of each page |
| A wiki page has a Mermaid block | The wiki page draws the diagram when the page shows. A theme change draws them again. A block with an error stays as code |
| The Mermaid file is missing in `raw/` | A toast says to run `forge.mjs board` again, and the blocks stay as code |
| A link names a wiki page that is gone | The wiki page says that it has no such page, and it shows the first page |
| The wiki has no page yet | The wiki page shows the cold anvil and says so, and the board has no list of closed tickets |
| The page is old (a file page) | The footer gives the time. The next `forge.mjs board` run writes it again, and you load the page again by hand. A page that did not change is not written again |
| A narrow window (below 760 px) | The bar wraps, the lanes go below each other, and the cards take the full width |
| A dark editor with a light system | The theme button. The early script sets the stored theme before the first paint, so the page does not flash |
| No keyboard, or no mouse | Each step has a button and a key. A dialog keeps the focus, and `Esc` closes it. The focus ring uses `--accent` |
| The system asks for less motion | The spark and the pulse of a working session have no animation (`prefers-reduced-motion`) |
| The browser has no storage | The page works. It does not keep the theme or the open lists after a load, and it opens in its first view |

## 🛠️ Change or add a component

1. Look for a kit component first. Two pages with the same part use one component.
2. Make `ui/<name>.mjs` with the contract (`name`, `css`, `html`, `script`, `demo`). Use tokens only. Use `step()` for a stepped corner.
3. Add the component to the imports of `index.mjs`, to `COMPONENTS`, and to `STYLE_ORDER` and `SCRIPT_ORDER` for each non-empty part. An unlisted part throws at import.
4. Export each helper that a page needs from `index.mjs`.
5. Add the demo, so the styleguide shows the component in both themes.
6. Add a row to the Components table of this document. A token goes into both themes, into `PAIRS` when text uses it, and into the table of this document.
7. Change the page code to use the helper. Delete the old copy in the page.
8. Run `npm test`, then look at the pages (see the next section).

| Test | What it guards |
|---|---|
| `tests/ui-kit.test.mjs` | The contract, the order lists, the script rules, the tokens, the contrast pairs, the sprites and glyphs, the class collisions, the one breakpoint, the focus rings, the live regions, the skip link, the icon and the title, the content policy, the notice, the error page, and the token table of this document |
| `tests/board-page.test.mjs` | The board page, the tokens in `:root` named in this document, the fetch counts of the scripts, and the next strike |
| `tests/wiki-page.test.mjs` | The wiki page and the hash of the vendored Mermaid file |
| `tests/live-serve.test.mjs` | The live server: the key file, the idle time, the stamp, the policy, and the error pages |

Page code rules:

- A page script uses no template literal. It asks only its own server: a relative link, `data.live` and `data.resume` on a page of the live server, or `data.mermaid` on a page with a Mermaid block.
- Escape each ticket text with `esc()`. Only `linkTarget()` makes a link target from ticket text.
- The text of a session (a title, a prompt, a command, a last message) is not trusted. Put it into the page with `make()`, which sets `textContent`. Never make HTML from it.
- A page script never creates SVG. The shell makes the pixel text and the icons.
- Change the live event (`live-event.mjs`), the live state (`live.mjs`), and the live parts of the pages together (`tests/live.test.mjs`, `tests/live-serve.test.mjs`).
- **Resume** is the only control that starts something on the machine of the user. Its request holds only the id of a session. Do not add a control that gives text, a command, or a folder to the server.
- Change the session list (`sessions.mjs`), the harness table (`harness.mjs`), the terminal table (`terminal.mjs`), and the closed session rows together (`tests/sessions.test.mjs`, `tests/terminal.test.mjs`).
- Change the wiki model (`wiki.mjs`), the wiki page (`wiki-page.mjs`), and the wiki links of the board together (`tests/wiki-page.test.mjs`).
- The text of a wiki page goes through `markdown()`, which escapes each character. The script of the wiki page makes no HTML.
- Mermaid makes the HTML of a drawing, with its security level `strict`. Do not change a byte of `plugins/forge/vendor/mermaid/mermaid.tiny.js`: `tests/wiki-page.test.mjs` checks its hash, and `vendor/mermaid/NOTICE.md` gives the update steps.

## 👀 Look at a change

Tests do not show a page. Look at each page change in a browser.

| Step | Command |
|---|---|
| The styleguide | `node plugins/forge/scripts/forge.mjs styleguide` writes `<forge>/raw/styleguide.html`. `--out <file>` writes another file. The page loads nothing from a network |
| The screenshots | `npm run shots` (not part of `npm test`) |

`npm run shots` needs Chromium (`FORGE_CHROMIUM`, or `chromium`, `chromium-browser`, or `google-chrome` on the `PATH`) and Node 22 or later (the global `WebSocket`). It has no dependency.

| Option | Meaning |
|---|---|
| `--out <folder>` | Keep the PNG files in this folder. Without it, they go to a temporary folder |
| `--only <page>` | One page, and each page that starts with its name (`board` takes `board-none`, `board-skip`, and so on) |
| `--live` | Do not take pictures. Start the demo live server, print the link of its board, and wait for Ctrl+C |

- It seeds the demo of `tests/fixtures/demo.mjs` in a temporary folder: tickets in the 6 states, one full ticket with a Mermaid block, a people wait, a read error, and wiki pages. All names are invented.
- It starts its own live server on a free port with its own data folder, so a live server of a real repository stays untouched. It sends synthetic events for the live lines.
- The pages are the styleguide, the board, the wiki page, the filter with no result, the skip link, the error pages, the changed notice, and the stopped notice.
- Each page is shot in the light and the dark theme, at 1500 px and at 620 px (some pages at 1500 px only).
- It exits with 1 on a console error, a content-policy violation, or a `--bg` that does not match the theme.
- Always look at each page in both themes at 620 px and at 1500 px, with the PNG files or in a browser. Read the picture. A pass of the script is not a look.

## ⚠️ Known limits

- At a browser zoom that is not a whole number, the pixel edges stay sharp, but two columns of one letter can differ by one device pixel.
- The page search of a browser marks a pixel heading as a small box. The real text is in a hidden span.
- An error page has no script, so it follows the system theme, not the stored choice.
- The stable link of the live server is in the browser history and in the argument of the command that starts the browser. Another program of the same user can read it. `forge.mjs open --new-link` is the answer to a leaked link.
- The key file of the link has the mode that only the user can read. Windows has no such mode, so the file is not checked there.
- The skip link covers the logo while it has the focus.
- The pages say "needs you". `raw/board.md` and the session groups keep "Needs me".
- A file page shows the tickets of its last run. Only a served page reads the files on each load, and only a page of the live server says that the data changed.
- The live activity comes from Claude Code sessions only. The hooks of Copilot CLI have no background option, so it sends no events yet. A Copilot CLI session shows as a closed session row ("no end seen" while it runs).
- **Resume** opens a terminal on Windows and Linux. On macOS the page gives the command to copy. A terminal that starts and shows no window still counts as open, so each row also has **Copy command**.
- A file page (`raw/board.html`) has no closed session rows: only the live server reads the session list.
- The live server learns of a session at its first event. A session that started before the server shows after its next prompt or tool call.
- The Markdown of the wiki page has no italic text and no images.
- The Mermaid build of Forge has no mindmap diagram, no architecture diagram, and no math.
- A wiki page with a Mermaid block needs the file `mermaid.tiny.js` (2.7 MB) in `raw/`. `forge.mjs board` puts it there.
- One file holds all pages of the wiki. The model stops at 3,000 pages, and it leaves out a page with more than 512 KB.
- A link to a heading of a wiki page opens the page at its top.
- The wiki page shows no file of `raw/` and `archive/`, so the working folder of a closed ticket has no page.
