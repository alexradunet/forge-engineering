# Forge design system

The forge pages are the board page (`raw/board.html`) and the ticket canvas (`raw/tickets/<key>/canvas.html`).
They share one design system: the tokens, the components, the links between the pages, and the keys.
The source is [`scripts/lib/ui.mjs`](../plugins/forge/scripts/lib/ui.mjs).
`board-page.mjs` and `canvas-page.mjs` add only the parts of their own page.
A page of the live server (`forge.mjs live`) also shows what the agent sessions do now: see Live view.
`tests/board-page.test.mjs` keeps this page and the tokens in the code the same.

## Principles

1. Signal only. A color or an emoji shows a state. It is never decoration.
2. A state has its emoji and its words. Color alone carries no fact, so the pages also work without color.
3. The ticket that waits for the user comes first, on each page.
4. A page is one file. It loads nothing from a network: no font, no image, no script from another place. The one exception is the Mermaid file of a page with a Mermaid block, which comes from the folder or the server of the page.
5. A page is a view. The Markdown files of the ticket are the source, and no approval comes from a page.
6. The keyboard can do each step of the navigation. The mouse can do the same steps.
7. The same part looks the same on each page: one bar, one switcher, one help dialog, one toast.

## Tokens

Each token is a CSS custom property on `:root`. A page never uses a color or a size that is not a token,
with two exceptions: the sizes of the canvas board (zones and cards), and the text inside a card.

| Group | Tokens | Use |
|---|---|---|
| Surface | `--bg`, `--panel`, `--card`, `--rail` | The page, a zone or a lane panel, a card or a control, and the bars |
| Text | `--ink`, `--muted`, `--faint` | The text, a label or a secondary value, and a separator |
| Line | `--line`, `--line-2` | A border, and a stronger border (a key, an empty gate dot) |
| Accent | `--accent` | A link, the focus ring, the summary card, the current part, and the primary button |
| State | `--amber`, `--green`, `--red`, `--violet` | See States. Blue is `--accent`, and grey is `--faint` |
| Type size | `--t-xs`, `--t-sm`, `--t-md`, `--t-lg`, `--t-xl`, `--t-2xl` | 12, 13, 15 (the text), 17 (a card title), 20 (a lane title), and 26 px (a zone title) |
| Type face | `--font`, `--mono` | The system font, and the monospace font for a ticket key and for code |
| Space | `--s-1`, `--s-2`, `--s-3`, `--s-4`, `--s-5`, `--s-6`, `--s-7` | 4, 8, 12, 16, 24, 32, and 48 px |
| Radius | `--r-1`, `--r-2`, `--r-3`, `--r-pill` | A control (6 px), a card (10 px), a panel or a dialog (14 px), and a pill |
| Shadow | `--sh-1`, `--sh-2` | A card on the board page, and a part that floats (dialog, comments panel, toast) |

Themes: the light values are the default. The dark values apply when the system asks for a dark page
(`prefers-color-scheme`), or when the user selects the dark theme with the theme button.
The button has 3 values (auto, light, dark), and the browser keeps the value for each forge page (`forge-ui:theme`).
Add a color token to both themes, and check that text on `--card` and on `--bg` has a contrast of 4.5 to 1 or more.

## States

One state has one emoji, one label, and one color on each page (class `st-<state>`, variable `--st`).

| State | Emoji and label | Color | Meaning of the color |
|---|---|---|---|
| `needs-me` | 🟡 Needs me | `--amber` | The user must act. Amber is also a gate in review, an open question, a planned change, and a comment |
| `blocked` | 🔴 Blocked | `--red` | The work cannot continue. Red is also a failed check and a problem |
| `go` | 🟢 Go | `--green` | The work can start. Green is also approved, done, and verified |
| `active` | ▶️ Active | `--accent` | An agent works |
| `waiting` | ⏳ Waiting | `--violet` | A person or a system outside must answer |
| `done` | ✅ Done | `--faint` | Closed |

## Live view

Only a page of the live server (`forge.mjs live`, which `forge.mjs open` starts) has the live parts. A file page and a page of the canvas server stay as they are.
The session hooks send small events to that server, and the page asks the server for the state of the sessions.
A session has one of 4 live states (class `lv-<state>`, variable `--st`). They use the colors of the ticket states, so the live view has no token of its own.

| Live state | Words | Color | Meaning |
|---|---|---|---|
| `working` | working | `--accent` | The session runs a prompt. The mark moves, unless the system asks for less motion |
| `needs-you` | needs you | `--amber` | The session waits for the user: a permission prompt or a question |
| `idle` | idle | `--faint` | The turn ended, and the session waits for the next prompt |
| `ended` | ended | `--faint` | The session ended. It goes away after 30 minutes |

The page is read-only for a session. It has no control that sends text or an answer to a session.

## Wiki page

The wiki page (`raw/wiki.html` in the Forge folder) shows each canonical page of the wiki: each Markdown file of the wiki outside `forge/` and `.git` (and outside `raw/` and `archive/` in an older folder, where they are inside the wiki). `forge.mjs lint` checks the same files.
One file holds all pages. The address of a page is the path of its Markdown file after the `#` of the link, for example `wiki.html#tooling/build.md`.

- The list at the left has one group for each folder. The pages at the top of the wiki come first, and the folder `tickets/` has the name **Closed tickets**.
- A page shows its title, its status, its date, its text, and its sources. The status (`verified`, `decided`, or `needs-check`) uses the color of a ticket state, so the page has no token of its own.
- **Used by** lists the open tickets and the other pages that name the page. The index and the log are not in that list.
- A link to another page of the wiki changes only the page in view. A web address opens a new tab. A relative link to a file that is not a page stays as text.
- A Mermaid block becomes a drawing with the colors of the theme. The page loads the Mermaid file of Forge (`mermaid.tiny.js`) only when the wiki has such a block: from its own folder for a file page, and from its own server for a served page.

A closed ticket has no folder on the board. Its summary page (`tickets/<key>.md`) is in the wiki, so the board lists the closed tickets below the lanes, and each row opens the summary page on the wiki page.
The archive folder of a ticket stays on its machine, and no page shows it.

On a canvas, a link to a wiki page opens the wiki page. The path of a wiki page in the text of a ticket document is also a link, for example `tooling/build.md`.
The **Wiki** menu of the bar lists each wiki page that the ticket names.
A Mermaid block in a card of a canvas becomes a drawing, in the same way as on the wiki page. The file page finds the Mermaid file in `raw/`, two folders above its own folder.

## Components

| Component | Where in the code | Rules |
|---|---|---|
| Bar | `#rail`, `.bar` | The first row of each page: where the user is, then the tools. It wraps on a narrow page |
| Button | `button`, `.primary`, `.quiet`, `.icon` | One primary button for each surface (**Send to agent**). A quiet button has no border until the pointer is on it |
| State pill | `.pill` with `st-<state>` | The emoji and the label of one state |
| Key | `.key` | A ticket key, in the monospace font |
| Filter chip | `.chip` (board) | A switch with `aria-pressed`. It shows the count of its state |
| Gate steps | `.gates` (canvas), `.dots` (board) | One step for each required gate, in order. Only a gate that needs attention shows words. The other gates show a mark, and their words are in the tooltip |
| Ticket card | `.tcard` (board) | Key and age, title, gate line, next step, who it waits on, tags, then small links. The whole card opens the canvas |
| Document card | `.card`, `.node` (canvas) | A title and the text of one section. A left border shows a state |
| View switch | `.views` (canvas) | One button for each view, with `aria-pressed`: the gate in focus (**Now**), **Must read**, **+ Good to know**, and **All**. A view button starts its view again |
| Title strip | `.folded` (canvas) | A folded card: one line with a mark, the title, the tier (`must`, `good`, `ai`), and the count of words. It keeps the place and the state border of its card. A click or `Enter` opens it, and **Fold** on the open card folds it again. A folded plan step keeps its frame on the path |
| Bundle line | `.bundle` (canvas) | One line for 2 or more folded cards of one kind, with their count and their words. A click shows their title strips |
| Tag | `.tag`, `.badge` | One short fact. `ok`, `bad`, and `wait` give it a state color |
| Switcher | `#switcher` | One dialog with a filter and each ticket in board order. See Navigation |
| Help | `#help` | The keys and the mouse steps of the page. The footer names the `?` key |
| Comments panel | `#tray` (canvas) | The comments of this ticket, the comment on the whole ticket, and Send or Copy |
| Live line | `.live` with `lv-<state>` (`liveLine()` in `ui.mjs`) | One session: the state and its time, the tool that runs now, the count of subagents that run, and the text of a wait. It is on a board card and at the top of the Live panel |
| Other sessions | `#live-other`, `.lrow` (board) | The sessions of this repository without a ticket card: the host, the title or the folder name, and the live line |
| Live panel | `#live`, `.lv-tree` (canvas) | The sessions of this ticket: the live line, the prompt, the tool calls and the subagents as a tree, and the last text. It stands at the left of the board, and the board keeps the other space. On a narrow page it floats above the board |
| Wiki menu | `.refs`, `#wiki-refs` (canvas) | The wiki pages that the ticket names, and the link to all pages. It closes at a click outside of it, and at `Esc` |
| Page list | `#tree` (wiki) | One group for each folder of the wiki, with a count. The filter hides pages, and it reads the text of each page |
| Wiki page text | `.wpage`, `.md`, `.more` (wiki) | One page: the folder and the file name, the title, the status and the date, the text, the sources, and the uses |
| Diagram | `.mermaid`, `#mermaid-stage` (wiki, canvas) | The drawing of a Mermaid block, in a frame. Mermaid draws in a stage outside of the page parts, so a folded card and the zoom of the canvas do not change its measures. The block keeps its text, and a block that Mermaid cannot draw stays as code |
| Closed tickets | `#lane-closed` (board) | A closed list at the end of the board: the key, the title, and the date of each summary page |
| Toast | `#toast` | One line that tells the result of a step. It goes away after 4 seconds |
| Empty text | `.empty` | One sentence that says what is missing. It never shows an empty frame |
| Footer | `#foot` | When the page was made, and that the page is a view. The canvas has its zoom tools there |

## Layout of the pages

The board page:

```text
+--------------------------------------------------------------------------+
| Forge board  [Filter /]  (Needs me 2) (Blocked 1)  Wiki [Go to a ticket] |
+--------------------------------------------------------------------------+
| Needs me 2                                             full width, first |
|   [ticket card] [ticket card]                                            |
|                                                                          |
| Blocked 1        Go 1           Active 2         Waiting 1    side by    |
|   [card]           [card]         [card]           [card]     side       |
|                                   [card]                                 |
| > Done 2                                       a closed list at the end  |
| > Closed tickets 3              their summary pages on the wiki page     |
| People waits (table)      Read errors (list)                             |
+--------------------------------------------------------------------------+
```

The ticket canvas:

```text
+--------------------------------------------------------------------------+
| Board / [KEY v]  Title  (state) phase     < >  [Wiki 3] [Comments 0] ?   |
| (Scoped) (Planned waits for you) (Shippable) ...  Next ...               |
| View [Now: Planned] [Must read] [+ Good to know] [All]     Story Plan .. |
+--------------------------------------------------------------------------+
|                                                                          |
|   Story         Code map                       Review and proof          |
|    [summary]     [summary] [components]         [summary]                |
|    > Scope      Plan  (waits for you)           > Changes                |
|    > 3 more      [summary] [steps] [Risks]      > 9 more                 |
|                                    the board: move, zoom, read, comment  |
+--------------------------------------------------------------------------+
| Generated ... This page is a view.                        - 100% + Fit   |
+--------------------------------------------------------------------------+
```

A canvas of the live server has the Live panel at the left:

```text
+----------------------+---------------------------------------------------+
| Live              x  |                                                   |
| KEY - title          |   Story         Code map          Review          |
| (working 4 min)      |    [summary]     [summary]         [summary]      |
|  now: Bash npm test  |                                                   |
|  1 subagent runs     |                 Plan                              |
| > the prompt         |                  [summary] [steps]                |
| o Read  a.mjs        |                                                   |
| o reviewer  running  |                                                   |
| |  o Grep check      |                                                   |
| o Bash  npm test 12s |                                                   |
+----------------------+---------------------------------------------------+
```

The wiki page:

```text
+--------------------------------------------------------------------------+
| Board / Wiki  [Filter /]                          [Go to a ticket] ?     |
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

## Navigation

The unit of the navigation is the ticket. One ticket has one session, and the session title starts with the ticket key.
The VS Code docs give no link that opens one session (read on 2026-11-17), so a page cannot open a session.
A board card has the link **Worktree**, which opens the worktree folder of the ticket in VS Code.

| From | To | Mouse | Key |
|---|---|---|---|
| Board | A ticket canvas | The card | `j` and `k`, then `Enter` |
| Each page | A ticket by its key or its words | The key in the bar, or **Go to a ticket** | `t` |
| Canvas | The board | **Board** in the bar | `b` |
| Canvas | The previous or the next ticket of the board | The arrows in the bar | `[` and `]` |
| Canvas | A part of the ticket | The part name in the bar | `1` to `9` |
| Canvas | The next view | The view buttons in the bar | `v` |
| Canvas | The text of a folded card | The title strip | `Tab` to the strip, then `Enter` |
| Canvas of the live server | The Live panel | **Live** in the bar | `l` |
| Each page | The wiki page | **Wiki** in the bar | `w` |
| Canvas | A wiki page that the ticket names | The **Wiki** menu of the bar, or a link in a card | None |
| Board | The summary page of a closed ticket | The row in **Closed tickets** | `j` and `k`, then `Enter` |
| Wiki | Another page | The list at the left, or a link in the text | `j` and `k` |
| Wiki | A page by its words | The filter | `/`, then `Enter` |
| Wiki | A ticket that names the page | **Used by** below the text | None |

The order of the tickets is the order of the board: the state lanes, and the key in each lane.
So `]` on a ticket that waits for the user goes to the next ticket that waits for the user.

The links have two forms:

| Page | Board | Another ticket | Made by |
|---|---|---|---|
| File page | `../../board.html` | `../<folder>/canvas.html` | `forge.mjs board` writes each page. `forge.mjs canvas <KEY>` writes its page, the board page, and each canvas that is missing |
| Served page | `/board?t=<token>` | `/ticket/<folder>/?t=<token>` | `forge.mjs canvas <KEY> --serve` reads the files again for each page |
| Page of the live server | `/board?t=<token>` | `/ticket/<folder>/?t=<token>` | `forge.mjs live` reads the files again for each page. Each ticket has the same route, and no page can send |

The wiki page is next to the board page: `wiki.html` in a file page, and `/wiki?t=<token>` on a served page.
The switcher of each page also lists the closed tickets, after the tickets of the board.

## UX cases

| Case | What the page does |
|---|---|
| The user opens the board to see what waits | The **Needs me** lane is first and has the full width. Without such a ticket, the lane says "No ticket waits for you." |
| A ticket waits at a gate | The card shows the gate steps and "<gate> waits for you". The card link opens the canvas at the document of that gate |
| The wiki has many tickets | The filter (`/`) hides tickets by their words. A chip or a number key shows one state. **Done** is a closed list. A banner gives the count and **Show all** |
| The filter finds nothing | The banner says "No ticket agrees with the filter." and has **Show all** |
| An open ticket has no update for 7 days or more | The age is amber and bold, and its tooltip gives the days |
| A person does not answer for more than 3 working days | A tag on the card, and the **People waits** table |
| A ticket folder cannot be read | The **Read errors** list. A ticket that cannot give a canvas has a link to its README |
| The ticket has more text than the user can read at one gate | Each card has a tier: must read, good to know, or AI artifact (a working note of the agent). The table `TIERS` in `canvas.mjs` gives the tier of each template section. A view opens the cards of its tiers, and each other card is a title strip |
| A ticket waits at a gate, and the user opens its canvas | The view **Now** is first: the cards to read of the gate in focus are open, and the border of its parts has the accent color. Each other part shows its summary, its cards to read as title strips, and one line for the other cards. Without a gate in review, the focus is the next gate. After the last gate, the page opens with **Must read** |
| A card holds an exception | A failed check, an open hypothesis, and a problem in the journal are cards to read, and each view shows them open |
| The user wants one more card, or one card less | A click on a title strip opens the card, and **Fold** on a card folds it. The browser keeps these choices for the gate in focus. A view button removes them |
| A link or a comment names a folded card | The page opens the card, and the code map of a component, before it shows it |
| The user wants the whole ticket at a glance | The far view (zoom below 50%): each card shows its title in a large size, and a tint shows its state. A title strip is a thin line without words, so the cards to read stand out |
| The user wants to read one part | A part name, a number key, or a double-click on a title shows that part at a size to read. The bar marks the current part |
| The user goes to another ticket and comes back | The browser keeps the position, the zoom, the view, the opened and the folded cards, and the comments of each ticket. A saved position that shows no part of the board gives the whole board |
| The user comments on a ticket that is not the ticket of the server | That page has no **Send to agent**. The Comments panel says to use **Copy all** and to paste the message into the session of that ticket |
| The canvas server stopped (after a Send, after an approval, or after 8 hours) | A served page asks its server before it goes to another page. Without an answer, the page stays, a toast says to ask the session for a new link, and the comments stay in the browser |
| The link is old (a new server run has a new token) | The same as a stopped server. A direct load of the old link gets "This link is old" |
| A session works on a ticket | The board card shows the live line: "working", the time, the tool that runs now, and the count of subagents that run. The canvas shows the same line and the tree of the turn in the Live panel |
| A session waits for the user | The live line is amber and says "needs you", with the text of the prompt of the host. The **Live** button of the canvas says "Live: needs you". The user answers in the session, not on the page |
| A session of the repository has no ticket on the board | The board lists it under **Other sessions**, with its title or its folder name |
| The user wants to open Forge from a terminal | `../<repo>.forge/forge open` starts the server of that repository when none runs, prints the links, and opens the board in the browser |
| Two repositories are open | Each repository has its own server, port, and pages. A session shows only on the pages of its repository, and a session in another folder shows on no page |
| No session reports for a ticket | The Live panel says so, and it names the 2 ways that give a session its ticket: the worktree of the ticket, or the ticket key at the start of the title |
| A session works for 10 minutes without an event | The live line says "working, quiet" and shows the time since the last event |
| A turn has more than 200 tool calls | The Live panel shows the newest calls, and one line gives the count of the older calls |
| The live server does not answer, or it stopped | The page keeps the last state. The footer of the board and the hint of the Live panel say that the server does not answer, and the page asks again with longer waits |
| The page is not in view (another tab) | The page stops its requests, and it asks again when the user comes back |
| The user comments on a canvas of the live server | That page has no **Send to agent**. The Comments panel says to use **Copy all** |
| The user reads a ticket and wants the background | A link to a wiki page in a card opens that page on the wiki page. The **Wiki** menu of the canvas lists each wiki page that the ticket names |
| The user reads a wiki page and wants its tickets | **Used by** names each open ticket and each closed ticket that names the page |
| The user wants an old ticket | The board lists the closed tickets at its end, and the switcher (`t`) finds one by its key or its words. Each one opens its summary page in the wiki |
| The user looks for a fact in the wiki | The filter of the wiki page reads the title, the path, and the text of each page |
| A wiki page or a card has a Mermaid block | The wiki page draws the diagram when the page shows, and the canvas draws each diagram after its load. A theme change draws them again. A block with an error stays as code |
| The Mermaid file is missing in `raw/` | A toast says to run `forge.mjs board` again, and the blocks stay as code |
| A link names a wiki page that is gone | The wiki page says that it has no such page, and it shows the first page |
| The wiki has no page yet | The wiki page says so, and the board has no list of closed tickets |
| The page is old (a file page) | The footer gives the time. The next `forge.mjs board` or `forge.mjs canvas <KEY>` run writes it again, and VS Code can load it again (`workbench.browser.autoReloadOnFileChange`). A page that did not change is not written again |
| The ticket has only a README, or a document is missing | A card says which document is missing. No frame is empty |
| An older ticket (not `full-v3`) | The canvas shows its files as columns. The bar, the links, and the comments are the same. It has no tiers and no views: each card is open |
| A narrow window | The bar wraps, the lanes go below each other, and the cards take the full width |
| A dark editor with a light system | The theme button |
| No keyboard, or no mouse | Each step has a button and a key. A dialog keeps the focus, and `Esc` closes it. The focus ring uses `--accent` |
| The system asks for less motion | The board moves without an animation (`prefers-reduced-motion`) |
| The browser has no storage | The page works. It does not keep the position, the view, the theme, or the comments after a load, and it opens in its first view |

## Rules for a change

- Put a new token, a shared component, or a shared function in `ui.mjs`, and add it to this page. A token goes into the light and the dark theme.
- A page script uses no template literal, and it requests only a link of its own server: a relative link, `data.live` on a page of the live server, or `data.mermaid` on a page with a Mermaid block.
- Escape each ticket text with `esc()`. Only `linkTarget()` makes a link target from ticket text.
- The text of a session (a title, a prompt, a command, a last message) is not trusted. Put it into the page with `make()`, which sets `textContent`. Never make HTML from it.
- Change the live event (`live-event.mjs`), the live state (`live.mjs`), and the live parts of the pages together (`tests/live.test.mjs`, `tests/live-serve.test.mjs`).
- Change the wiki model (`wiki.mjs`), the wiki page (`wiki-page.mjs`), and the wiki links of the board and the canvas together (`tests/wiki-page.test.mjs`).
- The text of a wiki page goes through `markdown()`, which escapes each character. The script of the wiki page makes no HTML.
- Mermaid makes the HTML of a drawing, with its security level `strict`. Do not change a byte of `plugins/forge/vendor/mermaid/mermaid.tiny.js`: `tests/wiki-page.test.mjs` checks its hash, and `vendor/mermaid/NOTICE.md` gives the update steps.
- Change a ticket template and the canvas together (`tests/canvas.test.mjs`). Give each new template section a tier in `TIERS`.
- Look at each change in a browser, in the light and the dark theme, at a width of 620 px and of 1500 px.

## Known limits

- The canvas has no pinch zoom on a touch screen.
- The theme of the user applies after the page loaded, so a dark page can show light for a moment.
- A file page shows the tickets of its last run. Only a served page reads the files on each load.
- A ticket document that was written before the move to a Forge folder has links with the old depth. The canvas still opens the wiki page for such a link. A link with an absolute path to the old folder does not work after the move.
- The live view shows Claude Code sessions only. The hooks of Copilot CLI and VS Code have no background option, so those hosts send no events yet.
- The Live panel shows the last text at the end of a turn or of a subagent. It does not show the text while the model writes it.
- A `claude -p` run stops its background hooks when it ends, so its last text can be missing.
- Two subagents of one type that start at the same time can show below the wrong call, until the result of each call comes.
- The live server learns of a session at its first event. A session that started before the server shows after its next prompt or tool call.
- The Markdown of the wiki page has no italic text and no images.
- The Mermaid build of Forge has no mindmap diagram, no architecture diagram, and no math.
- A wiki page or a canvas with a Mermaid block needs the file `mermaid.tiny.js` (2.7 MB) in `raw/`. `forge.mjs board` and `forge.mjs canvas <KEY>` put it there.
- A drawing on a canvas has no comment on a part of it: a comment on the card still works.
- One file holds all pages of the wiki. The model stops at 3,000 pages, and it leaves out a page with more than 512 KB.
- A link to a heading of a wiki page opens the page at its top.
- The wiki page shows no file of `raw/` and `archive/`, so the working folder of a closed ticket has no page.
