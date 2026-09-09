# Workshop

## Changes

| Date       | Change                                                                    |
| ---------- | ------------------------------------------------------------------------- |
| 2026-09-10 | Take the whole thumb-button gesture off the webview                       |
| 2026-09-10 | Write an explorer's stops on its moves alone, never on its mount          |
| 2026-09-10 | Climb out of a directory a tab opened inside, rather than out of the tab  |
| 2026-09-10 | Record an explorer's directory as a stop of its own                       |
| 2026-09-07 | Put one menu on the card's right click and its kebab, and add Rename      |
| 2026-08-24 | Fold the one-shell implementation plan into this document                 |
| 2026-08-24 | Give the grid a roving tab stop, and hand the keyboard to it from the bar |
| 2026-08-24 | Bring the grid's trailing group down to the size of a project's           |
| 2026-08-24 | Put one navigation stack under the shell, with the grid a stop on it      |

Each edit of this document adds a row at the top. The table keeps the last ten rows.

The workshop is the LTK Manager screen for the projects a user authors. It holds two surfaces
under one chrome: the grid of every project, and the editor for the one that is open. What the
[project editor](PROJECT_EDITOR.md) describes is the second of those. This document describes
the chrome over both, and the grid under it.

The core design idea is that opening a project **refills the row rather than replacing it**. The
two surfaces were two screens with two chromes once - a full-bleed toolbar over a grid on the
ground, a header over a rounded fold - and navigating between them swapped every control on the
row.

The rule the whole screen follows: **the bar searches what is in front of you, and a prefix
reaches past it.**

## Goals

- Opening a project changes what the row says, not what the row is
- One box reaches every project, every file and every command
- The keyboard reaches the grid the same way it reaches the editor
- A user who never opens the palette loses no route

## Feature status

The status words are the ones [Project editor](PROJECT_EDITOR.md#feature-status) defines.

| Feature                   | Status    | Note                                                           |
| ------------------------- | --------- | -------------------------------------------------------------- |
| One header, both routes   | Available | Five slots, each reading the project context itself            |
| One fold under it         | Available | Framed under a project, the ground under the grid              |
| The bar, project-free     | Available | Names the surface, and searches what is in front of it         |
| Filter mode               | Available | `Ctrl+F` over the grid. Writes the grid's own query            |
| Palette mode              | Available | A click or `Ctrl+P`, on either surface                         |
| Projects source           | Available | `/` primary, `~` alias. Reachable from inside a project        |
| Command split             | Available | Global rows on both surfaces, a project's under a project      |
| One navigation stack      | Available | Spans the shell, and the grid is a stop on it                  |
| Grid keyboard             | Available | A roving stop, arrows that follow the wrap, `Enter` to open    |
| Sort and filter           | Available | On the bar's trailing edge, beside the count it moves          |
| Selection and bulk        | Available | Select all, then Test, Pack or Delete                          |
| Test from the grid        | Available | The same state machine a project's own Test runs               |
| Import a project          | Available | Fantome, Modpkg and a Git repository, on the split button      |
| `Ctrl+F` ownership        | Available | The bar claims it over the grid, and each box claims its own   |
| The card's one menu       | Available | The same six on the right click as on the kebab                |
| Rename a project          | Available | A dialog over the slug, on the menu and on `F2`                |
| Grid selection model      | Proposed  | One model for the grid and the project, so Test and Pack merge |
| Game rows over the grid   | Proposed  | Absent today. A game row has no editor to open into there      |
| The library as a document | Proposed  | Variant B, below. Tabs would carry their own project           |

## Scope

The workshop is the authoring side. A user makes a project here, fills its layers, tests it in
game and packs it for distribution.

The **mod library** is the other side and a different screen: the mods a user installed, the
profiles that enable them, and the patcher run over those. The two meet in one place only - a
test started from the workshop layers its projects on top of whatever the active profile has
enabled, which is why the grid names that profile on the tooltip of the button that starts the
run.

Everything under `/workshop` is one route tree:

| Route                    | Draws                                           |
| ------------------------ | ----------------------------------------------- |
| `/workshop`              | The shell: the header, the fold, and the outlet |
| `/workshop/`             | The grid, its empty states and its bulk dialogs |
| `/workshop/$projectName` | The editor, which the project editor doc covers |

### The variant this is not

Two shapes answer "one workshop". This document is **variant A**: one chrome over both routes,
with the two surfaces left apart behind it.

**Variant B** makes the grid a document. The library becomes a tab like any other, a tab carries
its own project, and two projects can sit side by side in one split. Nothing here makes that
harder, and nothing here is a step toward it. It is named in [Ideas for review](#ideas-for-review)
and is not designed.

## Layout

Both routes draw the same row over the same fold. The middle of the row is one element across
the route change, and only the crumb inside it and the trailing slots differ.

```
grid
┌──────────────────────────────────────────────────────────────────────────────────┐
│ ←  →   ⌕ Workshop                     15 projects ▽ Ctrl+P     ☑▾  ⊞≣⋮ │  ＋▾    │
└──────────────────────────────────────────────────────────────────────────────────┘

project
┌──────────────────────────────────────────────────────────────────────────────────┐
│ ←  →   ⌕ Workshop / Charizard Smolder X  v1.0.9  Ctrl+P     ⚠2  ⬓ │ Test  Pack ⋮ │
└──────────────────────────────────────────────────────────────────────────────────┘
  history   the bar, one element across both routes           badge, view, actions
```

`▽` is the sort and filter popover, `☑▾` the selection button and its bulk actions, `⊞≣⋮` the
view mode control with its view options, and `＋▾` New project with the three imports on its
caret.

| Slot         | Grid                                    | Project                    |
| ------------ | --------------------------------------- | -------------------------- |
| History      | Live, on the shell's stack              | Live, on the shell's stack |
| Crumb        | `Workshop`                              | `Workshop / <name>`        |
| Trailing tag | The project count                       | The version                |
| Badge        | Nothing                                 | `ProblemsBadge`            |
| View slot    | Selection, view mode, view options      | The panel layout popover   |
| Actions      | New project, and the imports on a caret | Test, Pack, overflow       |

Each slot reads the project context itself rather than taking it down the tree, so a route
change refills the row instead of redrawing it.

### The row balances on its two sides

The bar sits in the middle of the row rather than in the middle of what is left over beside it.
Those are not the same thing - a badge and two buttons on one side do not weigh what two arrows
weigh on the other - so both side groups take an equal share and the bar centres between them.

It has to be both halves at once. A capped bar hands its leftover space back to whichever side
can still take it, so growing only the trailing side leaves the bar where it belongs and growing
only the leading side carries the bar across the row behind the arrows. The leading side also
takes `justify-end`, or a growing slot strands the arrows against the row's edge while the bar
centres away from them. `min-w-max` keeps either side from squeezing a control, and wraps the row
instead.

The bar's own width is a claim on the free space rather than a flex basis. A row breaks its lines
on the basis, so a 720px basis wrapped the workshop's controls to a second line before the bar had
shrunk by a pixel. Claimed first, behind a grow of 1 on each side, the bar reaches its cap
wherever the row can spare it and hands width back to a side needing more than its share. It wraps
only under a floor where the box has stopped being worth typing into.

**The grid's trailing group had to come down to a project's size before any of that read as
centred.** It ran several times the width, so equal shares dropped the bar a long way left of the
middle and further left again as the window narrowed. What it cost to fix:

| Control          | Was           | Now                                                     |
| ---------------- | ------------- | ------------------------------------------------------- |
| Profile selector | 144px         | Gone. It is the mod library's, and nothing here read it |
| Import and New   | ~142px        | ~50px, folded into one split button                     |
| Sort and filter  | ~32px + a gap | On the bar's trailing edge, beside the count it moves   |
| Selection        | ~110px        | ~32px until something is selected                       |
| View mode        | ~110px        | Unchanged. A command cannot show a state                |

Roughly 600px down to roughly 310, against the 250 a project's trailing group runs.

### The fold

Below the row, both routes render into the same box. Under a project it is a frame the editor and
its side panels share, and it rounds against the ground: `rounded-t-xl`, a hairline border and
`surface-900`, DS-GROUND. Over the grid there is no frame to share - the cards are the content
and carry their own edges - so the fold is the ground itself and the row above it is the same
surface rather than a lighter panel over one. The grid scrolls inside it.

## The keys

| Key                | Where          | Does                                                       |
| ------------------ | -------------- | ---------------------------------------------------------- |
| `Ctrl+2`           | Anywhere       | Goes to the workshop                                       |
| `Ctrl+P`, `Ctrl+K` | Either surface | Opens the palette on its listing                           |
| `Ctrl+Shift+P`     | Either surface | Opens the palette scoped to Commands                       |
| `Ctrl+N`           | Either surface | New project                                                |
| `Ctrl+F`           | The grid       | Opens the filter, or asks for the box back from the cards  |
| `Ctrl+A`           | The grid       | Selects every visible project, while no session is running |
| `Tab`              | The grid       | Enters the cards at the grid's own stop                    |
| `Ctrl+Shift+F`     | A project      | Opens the game index and focuses its search                |
| `Escape`           | The bar        | Closes it, and clears the filter where there is one        |

What the bar answers to once it is open is [the keys in `filter`](#the-keys-in-filter), and what
the cards answer to is [the keyboard](#the-keyboard).

## The bar

The header's middle holds one control. Idle it names the surface, and it is the route to
everything in front of it as soon as a user types. The [project editor](PROJECT_EDITOR.md#the-project-bar)
describes what it reaches inside a project. What follows is what it means across both.

### Three modes

| Mode      | Entered by                                        | Draws                                           |
| --------- | ------------------------------------------------- | ----------------------------------------------- |
| `idle`    | Nothing typed, no focus                           | The crumb, the tag, the `Ctrl+P` hint           |
| `filter`  | `Ctrl+F`, over the grid only                      | An input in the bar. No scrim, no list under it |
| `palette` | A click or `Ctrl+P`, either route. Or on a prefix | The palette under the bar, over a scrim         |

The mode is chosen from how the bar was opened rather than from the route, because a route cannot
answer that half. It is a pure function of the intent, whether a project is open and the scope in
force, so it is tested without a router.

### A click means the palette, and `Ctrl+F` means the filter

A click over the grid used to land in `filter`, on the reasoning that the results are already on
screen as cards and a dropdown would cover the answer with a worse copy of it. What that shipped
was a bar that took focus and had nothing to say. A click now means one thing on either surface:
the palette, open on the listing an empty box answers with.

`Ctrl+F` is the one route into the filter, so narrowing what is already on screen is asked for
rather than arrived at.

### The keys in `filter`

| Key                  | Does                                                                       |
| -------------------- | -------------------------------------------------------------------------- |
| A prefix at column 0 | Escalates to `palette` in that scope                                       |
| `Tab`                | Escalates to `palette` scoped to Projects, carrying the query with it      |
| `Enter`              | Opens the project when exactly one matches, and otherwise focuses the grid |
| `↓`                  | Focuses the grid, whatever the count                                       |
| `Escape`             | Clears the query and returns to `idle`                                     |

`Enter` and `↓` have one destination and `Tab` has another. The first two walk into what is on
screen. `Tab` carries the query into the palette, where a prefix reaches past the grid entirely.

`?` stays out of `filter` for good. It lists the prefixes, and over the grid the placeholder
already names the one prefix there is.

`Ctrl+F` asks for the box back once the keyboard is down in the grid.

### One text across the modes

The grid's own query holds what the cards are filtered by, and the bar's state holds what the
palette is searching. A prefix moves the rest of the line into the palette, and dropping that
scope hands it back - the borrow only happens where the filter took it.

`Escape` clears the filter. A click away leaves it standing, because the grid behind the bar is
still showing it and the idle tag reads `3 of 15` while it is.

### What an empty box lists

The listing's order is its own rather than the source registry's, and it answers "where was I"
for the surface it was opened on.

| Surface   | Leads with    | Because                                            |
| --------- | ------------- | -------------------------------------------------- |
| The grid  | The commands  | The projects are on screen as cards behind the box |
| A project | The open tabs | That is where the user was                         |

A group in a listing is capped the way a group under a term is - five for the commands, the
shared cap for the rest - and what does not fit becomes the `and N more…` row.

## The sources

| Source    | Prefix  | Grid | Project | Rows                                       |
| --------- | ------- | ---- | ------- | ------------------------------------------ |
| Projects  | `/` `~` | yes  | yes     | Every project of the workshop              |
| Documents |         | no   | yes     | The open tabs                              |
| Files     |         | no   | yes     | Every file of every layer                  |
| Layers    |         | no   | yes     | The layers of this project                 |
| Strings   | `#`     | no   | yes     | Every string override key                  |
| Commands  | `>`     | yes  | yes     | Global, plus the project's under a project |
| Game      |         | no   | yes     | Every file of the installed game           |

Projects answers from **inside** a project as well, which is what turns the crumb into a jump
rather than a round trip through the grid. Game is deliberately absent over the grid: a game row
has no editor to open into there, and a row that cannot run is worse than no row.

A project row carries the display name, the author line as its path, the version as its trailing
field and its thumbnail as the icon, so the row reads as a shrunken card. The thumbnail is
cropped square rather than kept at the card's 16:9 - the icon slot is one column for every
source, and a row of projects reading in a different rhythm from a row of files costs more than
the crop does.

### Projects takes two prefixes

| Prefix | Why                                                                     |
| ------ | ----------------------------------------------------------------------- |
| `/`    | Primary. It mirrors the crumb, which is what most users reach for first |
| `~`    | Alias, and the escape hatch below                                       |

A prefix matches on the first character, so `/` claims every query that opens with a slash and a
pasted absolute path scopes to Projects and matches nothing. `Backspace` on the empty query pops
the scope, so that is one key from fixed, and `~` is there for anyone who hits it often. The `?`
listing shows the primary alone, so the help stays one row per source.

### The command split

| Half        | Holds                                                                   |
| ----------- | ----------------------------------------------------------------------- |
| Global      | New project, the three imports, rebuild the game index, open settings   |
| A project's | Test, pack, reveal, delete, the go-to rows, the splits, search the game |

Only the global half is mounted over the grid. A project's list folds it in where those rows
already sat.

Two rules fall out of that. **What a command opens is mounted on the shell**, because a command
run from an editor otherwise sets a flag nothing on that route reads - the three creation dialogs
and `Ctrl+N` both live there. And **the imports are not the menu's**, because the menu and the
commands are two ways into one flow, so the picker sits under the api rather than inside a
toolbar.

There is no `view.gridMode` command, and there is no "Open the workshop" command. A command can
run an action and it cannot show a state, so grid against list keeps a visible control. The route
out of a project is the crumb and the Projects scope, twice over already.

## The grid

### The card

A card is the project: its thumbnail at 16:9, the display name, the tag and champion pills, the
version and the first author. A checkbox rides the top-left corner of the thumbnail and the
overflow menu sits at the trailing edge of the text. List mode lays the same parts in a row and
adds Test and Pack inline.

The card sits at `surface-900` on the fold's ground and answers the pointer by lifting a rung
rather than by rising off the page, DS-GROUND. A grid of cards that each translate and cast a
shadow reads as tiles floating over the surface rather than as what the surface holds.

**One menu, two ways in.** The card's right click opens what its kebab opens, so nothing it
offers is reachable only by finding a button that is not drawn. The list holds Edit, Test or Stop
Test, Pack, Rename, Open Location and Delete, in grid mode and in list mode alike. A card testing
right now carries a **Testing** pill that ends the run, and in list mode its Test reads Stop Test.

**A right click over the selection reads over the selection.** Test N, Pack N, Delete N and Clear
selection, the same set the selection button's caret draws. A right click outside the selection
selects that card alone first and opens the card's own menu, the rule every file manager obeys and
the one the explorers follow in "Selection" of [Project editor](PROJECT_EDITOR.md). A selection of
one is the exception: the card and the pick are the same target there, so the card's own menu
opens, which is the only place Rename is drawn.

**Rename is the card's, and it edits the slug.** A one-field dialog over the folder name on disk,
on the menu and on `F2` from a focused card. A card shows the display name, so an edit in place
there would rewrite a slug under a different word - the project overview is where the two are
drawn together, and its own inline edit stays.

### The keyboard

The grid is **one stop in the tab order**, not one per card. The arrows walk it from there, and
the card's own controls - the checkbox, Pack, the overflow - keep their own stops after it.

| Key             | Does                                                    |
| --------------- | ------------------------------------------------------- |
| `Tab`           | Enters the grid at its stop, wherever the stop was left |
| `←` `→`         | One card, following the wrap into the next row          |
| `↑` `↓`         | One row, or one card in list mode                       |
| `Home` `End`    | The first card and the last                             |
| `Enter` `Space` | Opens the focused card, the way a click does            |
| `F2`            | Renames the focused card, over its slug                 |

**The columns are measured rather than configured.** The grid wraps on `auto-fill` against a card
width the zoom and the card scale both move, so nothing in the code knows how many columns are on
screen. The cards' own distances from the top, read at the moment of the key press, are what
answer. List mode falls out of the same reading for free: every card has a top of its own there,
which measures one column, which is what a list is.

**A down out of a full row into a short one lands on the last card it holds.** APG says the focus
does not move, and a grid of seven over three columns would then have a bottom row the down arrow
could not reach from two of the three columns above it.

The focus ring is `accent-500` against the hover border's dimmed accent, DS-HOVER.

### Selection, and a running session

The selection button selects every visible project, and clears when they are all selected
already. Its caret holds the three bulk actions.

Test stands on the button whether or not anything is selected - it is the action a user comes to
the grid for - disabled until something is, and in the same green a project's own header gives
it, so one action reads the same from either surface. Pack and Delete are what a selection is
for, so they arrive with one rather than standing disabled beside it.

**The picks are spent as Test is pressed.** The run answers over the grid and there is nothing
left to press again, and a menu that closes on the press would otherwise carry a completion
callback down with it - the caret and a selected card's right click draw the same four commands
from the same place, so neither can end up spending the picks when the other does not.

The grid runs the same test state machine a project does. Named with no project its "other" is
simply the session the grid started, and the button walks idle → Building… → Stop Test the way a
project's does. A run the mod library started leaves both disabled, each pointing at the surface
that owns it.

**A session holds the files it was started over, and that set is not the user's to rewrite until
it ends.** So select-all goes quiet while the patcher is up - the button and the `Ctrl+A` that
doubles for it, both gated on the same state - while the selection group itself stays. Hiding it
took away the one control that could end the session.

Test names the profile it runs over on its own tooltip. The overlay build prepends the workshop
paths to the enabled mods of the active profile, so a project is tested on top of that profile,
and with the profile selector gone the workshop drew it nowhere else.

### Sort, filter and the count

The sort and filter popover sits on the bar's trailing edge beside the count it moves, rather
than in a slot of its own. The count, the chips under the row and the popover are one subject,
and the row has no width to spend saying it in three places. It renders in `idle` and in `filter`
both, because a control that vanishes the moment someone types is missing when it is wanted.

Sort is name or last modified, either direction. The filters are tags, champions and maps, and
what is set draws as chips under the row while no project is open. A filter set on the grid and
then carried into a project draws its chips nowhere - a project header is not the grid's status
line.

The tag beside the query is the count: `15 projects` plain, `3 of 15` while anything is
narrowing it. That is what makes a standing filter visible from `idle`.

### View mode and card size

Grid against list is a `SegmentedControl` in the view slot, and the view options popover on its
edge carries the card scale the mod library's grid uses too. Card width is that scale times the
app zoom, so the column count follows both.

## The navigation history

One stack for the shell, not one per project. A stop is either the grid or a document in a named
project, and the two arrows walk between them.

| Event                                                 | Does                                    |
| ----------------------------------------------------- | --------------------------------------- |
| Opening, activating, focusing or revealing a document | Pushes a stop                           |
| Arriving on the grid                                  | Pushes a grid stop                      |
| Moving an explorer's location                         | Pushes a stop carrying that directory   |
| Walking with an arrow                                 | Moves the index, and hands the tab back |
| Closing a tab                                         | Drops the stops matching that tab       |

**A directory is a stop.** An explorer document is a place a reader moves around inside, so a
tab alone is too coarse a stop to be useful: descending four directories and pressing back would
leave the reader exactly where they were. A stop therefore carries the directory an explorer was
standing in, and the arrows put it back after the store has put the tab back.

The stop a tab's own open records names no directory yet. The first location its explorer reports
completes that stop rather than standing beside it, so a tab and the directory it opened at are
one stop and a back out of the tab does not first walk a stop that changes nothing on screen.

**A stop naming no directory is the tab wherever it stands.** Activating the tab a directory stop
already names records nothing, because the tab has not moved. Reading the two as different stops
put a second one over the first, and the back that followed only stepped off it.

**A tab that opens already inside a directory records the route down to it.** A location belongs
to its explorer rather than to the document drawing it, so it outlives a tab close and a tab can
open four directories deep having walked no route there. Recording the deepest alone left that
tab a single stop, and one back out of it walked past the tab to the grid behind. The root, each
directory on the way, and the location itself go down together, so back climbs out of the
directory rather than out of the editor.

**The thumb buttons and `Alt+←` walk this stack, not the webview's.** A desktop app has one
Back, and it is this one. Chromium spends the fourth and fifth mouse buttons on its own history
and navigates on the release rather than on the press, so every phase of the gesture is taken
before it reaches the webview. Preventing the press alone left both to run: the arrow reached the
directory and the webview's own pop landed on the grid a moment later, which reads as a Back that
teleported out of the project. An arrow key held with `Alt` belongs to the stack for the same
reason, so an explorer's own arrows leave it alone.

**A mount is not a navigation, and writes no stop.** That route is laid once, while the tab's own
stop still names no directory. An explorer remounts whenever its route does, and the arrows route
on every stop inside a project, so a mount that recorded again would drop whatever the arrows had
ahead of them - the file preview a back had just stepped off - and stand its own stops in its
place. Only a move writes: descending, going up, a crumb, a typed path.

Closing a tab drops its directories with it, because they were only ever stops in that tab.

A walk that lands in another project routes to it, so the store returns the stop it reached
rather than leaving a caller to re-read an index the next walk can race.

A stop is titled by the project it sits in, and one somewhere else names where it is:
`Mod details in Charizard Smolder`. The back tooltip over a grid stop reads `Back to the
workshop`.

The stack is the session's. It is never written to `.ltk/editor.json`, and it holds 50 stops
across the whole shell.

The grid records itself from the route rather than from the resolved project, which arrives a
frame later - a deep link into a project would otherwise record a grid the user never stood on.

## How it is built

The header renders above the outlet, so it cannot sit inside the provider the project route
mounts. The layout route resolves the project instead and provides it, or provides null.

`ProjectContext` therefore has two readers:

| Reader                        | Returns                | For                                   |
| ----------------------------- | ---------------------- | ------------------------------------- |
| `useProjectContext()`         | The project, or throws | Every hook that needs one, unchanged  |
| `useOptionalProjectContext()` | The project, or null   | Every slot of the header, and the bar |

**Hooks do not become conditional.** Threading a null path through every hook that resolves a
project would be a large change for no user-visible gain, so the bar splits at the component
instead: one palette mounted only under a project, one mounted only without, and the results box
they both draw through. The idle bar stays in the bar itself, so it is one DOM node across the
route change.

The bar and the grid are apart in the tree, the bar over the outlet and the grid under it, so a
hand-off from the box to the cards goes through a bump-and-answer store rather than through the
DOM.

**`Ctrl+F` is claimed twice today.** The root binds it and focuses whatever input its placeholder
matches, which is how the mod library's box gets the key, and the bar binds it for itself over
the grid. The root's handler is the half to drop: a page that wants the key should claim it the
way the bar and the game search both do, through a store of its own rather than through a
selector over the whole document.

| Piece            | Where                                                  |
| ---------------- | ------------------------------------------------------ |
| The shell        | `src/routes/workshop.tsx`                              |
| The grid route   | `src/routes/workshop/index.tsx`                        |
| The header       | `src/modules/workshop/components/WorkshopHeader.tsx`   |
| The grid's slots | `src/modules/workshop/components/WorkshopControls.tsx` |
| The bar          | `src/modules/workshop/palette/WorkshopBar.tsx`         |
| The mode         | `src/modules/workshop/palette/barMode.ts`              |
| The sources      | `src/modules/workshop/palette/sources.ts`              |
| Project rows     | `src/modules/workshop/palette/projectRows.tsx`         |
| The grid         | `src/modules/workshop/components/ProjectGrid.tsx`      |
| Its keyboard     | `src/modules/workshop/hooks/useProjectGridNav.ts`      |
| The arrow walk   | `src/modules/workshop/utils/gridNav.ts`                |
| The history      | `src/stores/workshopEditor.ts`                         |
| Its hooks        | `src/modules/workshop/state/useShellHistory.ts`        |
| The grid filter  | `src/modules/workshop/api/useFilteredProjects.ts`      |

## Ideas for review

These are proposals. None is a decision.

**The library as a document.** Variant B: the grid becomes a tab like any other, a tab carries
its own project, and two projects sit side by side in one split. It wants a tab model keyed by
something other than one project, which is the whole of the work.

**One selection model.** Bulk Test and Pack live on the grid's selection button, and a project's
Test and Pack live in its header. Merging them wants one model that answers "what is selected"
for a grid of projects and for a tree of files at once.

**A game source over the grid.** It stays off the listing because a game row has no editor to
open into there. A row that opened the project picker first is the other reading.

**A drop onto the grid.** A `.fantome` or a `.modpkg` dropped on the grid imports it. The three
imports are already one flow behind the caret, and a drop is one more route into it.

## Open questions

None. Everything this document describes is decided, and what is deferred is named in
[Ideas for review](#ideas-for-review).

### Answered

| Question                                        | Answer                                              |
| ----------------------------------------------- | --------------------------------------------------- |
| Does the bar reach a second project?            | Yes. Projects answers from either surface           |
| Do the arrows stay dead on the grid?            | No. One stack for the shell, and the grid is a stop |
| Does `Enter` on several matches reach the grid? | Yes, on the roving stop the cards now hold          |
| Is the Projects prefix `/` or `~`?              | `/` is primary, and `~` is an alias                 |
| Does the grid keep a visible view-mode control? | Yes, and it gets no command                         |
| Does a click over the grid open the filter?     | No. A click means the palette on either surface     |
| Does the grid's filter survive a click away?    | Yes. The count tag is what says so                  |
