# Forge design system

The forge pages are the board page (`raw/board.html`) and the ticket canvas (`raw/tickets/<key>/canvas.html`).
They share one design system: the tokens, the components, the links between the pages, and the keys.
The source is [`scripts/lib/ui.mjs`](../plugins/forge/scripts/lib/ui.mjs).
`board-page.mjs` and `canvas-page.mjs` add only the parts of their own page.
`tests/board-page.test.mjs` keeps this page and the tokens in the code the same.

## Principles

1. Signal only. A color or an emoji shows a state. It is never decoration.
2. A state has its emoji and its words. Color alone carries no fact, so the pages also work without color.
3. The ticket that waits for the user comes first, on each page.
4. A page is one file. It loads nothing from a network: no font, no image, no script from another place.
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
| Tag | `.tag`, `.badge` | One short fact. `ok`, `bad`, and `wait` give it a state color |
| Switcher | `#switcher` | One dialog with a filter and each ticket in board order. See Navigation |
| Help | `#help` | The keys and the mouse steps of the page. The footer names the `?` key |
| Comments panel | `#tray` (canvas) | The comments of this ticket, the comment on the whole ticket, and Send or Copy |
| Toast | `#toast` | One line that tells the result of a step. It goes away after 4 seconds |
| Empty text | `.empty` | One sentence that says what is missing. It never shows an empty frame |
| Footer | `#foot` | When the page was made, and that the page is a view. The canvas has its zoom tools there |

## Layout of the pages

The board page:

```text
+--------------------------------------------------------------------------+
| Forge board  [Filter /]  (Needs me 2) (Blocked 1) ...   [Go to a ticket] |
+--------------------------------------------------------------------------+
| Needs me 2                                             full width, first |
|   [ticket card] [ticket card]                                            |
|                                                                          |
| Blocked 1        Go 1           Active 2         Waiting 1    side by    |
|   [card]           [card]         [card]           [card]     side       |
|                                   [card]                                 |
| > Done 2                                       a closed list at the end  |
| People waits (table)      Read errors (list)                             |
+--------------------------------------------------------------------------+
```

The ticket canvas:

```text
+--------------------------------------------------------------------------+
| Board / [KEY v]  Title  (state) phase              < >  [Comments 0] ?   |
| (Scoped) (Planned waits for you) (Shippable) ...  Next ...   Story Plan  |
+--------------------------------------------------------------------------+
|                                                                          |
|   Story         Code map                       Review and proof          |
|                 Plan                           Journal                   |
|                                    the board: move, zoom, read, comment  |
+--------------------------------------------------------------------------+
| Generated ... This page is a view.                        - 100% + Fit   |
+--------------------------------------------------------------------------+
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

The order of the tickets is the order of the board: the state lanes, and the key in each lane.
So `]` on a ticket that waits for the user goes to the next ticket that waits for the user.

The links have two forms:

| Page | Board | Another ticket | Made by |
|---|---|---|---|
| File page | `../../board.html` | `../<folder>/canvas.html` | `forge.mjs board` writes each page. `forge.mjs canvas <KEY>` writes its page, the board page, and each canvas that is missing |
| Served page | `/board?t=<token>` | `/ticket/<folder>/?t=<token>` | `forge.mjs canvas <KEY> --serve` reads the files again for each page |

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
| The user wants the whole ticket at a glance | The far view (zoom below 50%): each card shows its title in a large size, and a tint shows its state |
| The user wants to read one part | A part name, a number key, or a double-click on a title shows that part at a size to read. The bar marks the current part |
| The user goes to another ticket and comes back | The browser keeps the view (position and zoom) and the comments of each ticket |
| The user comments on a ticket that is not the ticket of the server | That page has no **Send to agent**. The Comments panel says to use **Copy all** and to paste the message into the session of that ticket |
| The canvas server stopped (after a Send, after an approval, or after 8 hours) | A served page asks its server before it goes to another page. Without an answer, the page stays, a toast says to ask the session for a new link, and the comments stay in the browser |
| The link is old (a new server run has a new token) | The same as a stopped server. A direct load of the old link gets "This link is old" |
| The page is old (a file page) | The footer gives the time. The next `forge.mjs board` or `forge.mjs canvas <KEY>` run writes it again, and VS Code can load it again (`workbench.browser.autoReloadOnFileChange`). A page that did not change is not written again |
| The ticket has only a README, or a document is missing | A card says which document is missing. No frame is empty |
| An older ticket (not `full-v3`) | The canvas shows its files as columns. The bar, the links, and the comments are the same |
| A narrow window | The bar wraps, the lanes go below each other, and the cards take the full width |
| A dark editor with a light system | The theme button |
| No keyboard, or no mouse | Each step has a button and a key. A dialog keeps the focus, and `Esc` closes it. The focus ring uses `--accent` |
| The system asks for less motion | The board moves without an animation (`prefers-reduced-motion`) |
| The browser has no storage | The page works. It does not keep the view, the theme, or the comments after a load |

## Rules for a change

- Put a new token, a shared component, or a shared function in `ui.mjs`, and add it to this page. A token goes into the light and the dark theme.
- A page script uses no template literal, and it requests only a relative link of its own server.
- Escape each ticket text with `esc()`. Only `linkTarget()` makes a link target from ticket text.
- Change a ticket template and the canvas together (`tests/canvas.test.mjs`).
- Look at each change in a browser, in the light and the dark theme, at a width of 620 px and of 1500 px.

## Known limits

- The canvas has no pinch zoom on a touch screen.
- The theme of the user applies after the page loaded, so a dark page can show light for a moment.
- A file page shows the tickets of its last run. Only a served page reads the files on each load.
