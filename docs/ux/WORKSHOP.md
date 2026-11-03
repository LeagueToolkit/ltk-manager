# Workshop

## Changes

| Date       | Change                                                                         |
| ---------- | ------------------------------------------------------------------------------ |
| 2026-11-01 | Test projects without profile mods by default, with an explicit profile option |
| 2026-10-27 | Add Publish to RuneForge on the card menu and the editor overflow menu         |
| 2026-10-06 | Draw the view control and the picks in a footer under the list                 |
| 2026-10-06 | Fold the title bar's navigation to icons, then drop the wordmark               |
| 2026-10-06 | Draw the title bar on the workshop's ground, and the grid in a page inset      |
| 2026-10-06 | Draw the list's Test in a dock over the list's bottom right corner             |
| 2026-10-06 | Draw the bar in the title bar and the run actions in the status row            |
| 2026-10-02 | Replace list mode with a table of arranged columns                             |
| 2026-09-10 | Take the whole thumb-button gesture off the webview                            |
| 2026-09-10 | Write an explorer's stops on its moves alone, never on its mount               |

Each edit of this document adds a row at the top. The table keeps the last ten rows.

The workshop is the LTK Manager screen for the projects a user authors. It holds two surfaces
under one chrome: the grid of every project, and the editor for the one that is open. What the
[project editor](PROJECT_EDITOR.md) describes is the second of those. This document describes
the chrome over both, and the grid under it.

The core design idea is that opening a project **refills the chrome rather than replacing it**.
The two surfaces were two screens with two chromes once - a full-bleed toolbar over a grid on the
ground, a header over a rounded fold - and navigating between them swapped every control.

The rule the whole screen follows: **the bar searches what is in front of you, and a prefix
reaches past it.**

## Goals

- Opening a project changes what the chrome says, not what the chrome is
- One box reaches every project, every file and every command
- The keyboard reaches the grid the same way it reaches the editor
- A user who never opens the palette loses no route

## Feature status

The status words are the ones [Project editor](PROJECT_EDITOR.md#feature-status) defines.

| Feature                   | Status    | Note                                                           |
| ------------------------- | --------- | -------------------------------------------------------------- |
| One header, both routes   | Available | Five slots, each reading the project context itself            |
| One fold under it         | Available | The editor's islands under a project, one inset over the grid  |
| The bar, project-free     | Available | Names the surface, and searches what is in front of it         |
| Filter mode               | Available | `Ctrl+F` over the grid. Writes the grid's own query            |
| Palette mode              | Available | A click or `Ctrl+P`, on either surface                         |
| Projects source           | Available | `/` primary, `~` alias. Reachable from inside a project        |
| Command split             | Available | Global rows on both surfaces, a project's under a project      |
| One navigation stack      | Available | Spans the shell, and the grid is a stop on it                  |
| Grid keyboard             | Available | A roving stop, arrows that follow the wrap, `Enter` to open    |
| The table                 | Available | Arranged columns, grouping and ranges, in place of list mode   |
| Sort and filter           | Available | On the bar's trailing edge                                     |
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
profiles that enable them, and the patcher run over those. A workshop test excludes profile
mods by default. The workshop cannot show the profile's conflicts alongside the project, so
including those mods by default makes a test harder to diagnose. **Test over profile** explicitly
includes the active profile's enabled mods below the tested projects. Global built-in mods
remain enabled according to their settings in either mode.

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

The workshop has no row of its own. Both routes draw the same chrome into the window's frame
around the same fold: the history arrows and the bar in the middle of the title bar, and a
project's run actions at the end of the status row. The bar is one element across the route
change, and only the crumb inside it and the slots in and around it differ.

```
grid
┌──────────────────────────────────────────────────────────────────────────────────┐
│ ◆ Home Mods Workshop   ← → ⌕ Workshop                      ▽ │ ＋▾   🔔 ⚕ ⚙ ⋮ ─ □ ✕ │
├──────────────────────────────────────────────────────────────────────────────────┤
│                                    the fold                                      │
│                                                                        ┌────────┐ │
│                                                                        │ ▷ Test │ │
│                                                                        └────────┘ │
│ 15 projects  2 selected ▾                                                  ⊞≣⋮   │
├──────────────────────────────────────────────────────────────────────────────────┤
│ ○ Patcher idle                                                                   │
└──────────────────────────────────────────────────────────────────────────────────┘

project
┌──────────────────────────────────────────────────────────────────────────────────┐
│ ◆ Home Mods Workshop   ← → ⌕ Workshop / Charizard         v1.0.9 ⬓  🔔 ⚕ ⚙ ⋮ ─ □ ✕ │
├──────────────────────────────────────────────────────────────────────────────────┤
│                                    the fold                                      │
├──────────────────────────────────────────────────────────────────────────────────┤
│ ○ Patcher idle                                              ⚠2  Test  Pack ⋮     │
└──────────────────────────────────────────────────────────────────────────────────┘
```

The title bar and the status row are on screen on every page, so the chrome costs the fold no
height. The arrows travel with the bar, on its leading edge. A project's run actions follow the
session line and the ambient items the status row already holds, per "The status bar item and
the drawer" in [Mod health](MOD_HEALTH.md).

**The status row holds what runs the open project, and nothing of the list's.** Under a project
Test and Pack act on the one thing the page is about, so they stand in the frame. Over the list
everything acts on the picks, so it draws with the list: Test in a dock that floats over the
list's bottom right corner, and the picks and the view in its footer, per "The list's footer".
New project draws at the end of the bar's field, behind a divider, and the panel layout popover
stands behind the bar.

`▽` is the sort and filter popover, `＋▾` New project with Open folder, the three imports and
the Recent group on its caret, `2 selected ▾` the picks and their bulk actions, `⊞≣⋮` the view
mode control with its view options, and `⬓` the panel layout popover.

| Slot         | Grid                                    | Project                    |
| ------------ | --------------------------------------- | -------------------------- |
| History      | Live, on the shell's stack              | Live, on the shell's stack |
| Crumb        | `Workshop`                              | `Workshop / <name>`        |
| Trailing tag | Nothing                                 | The version                |
| In the field | New project, and the imports on a caret | Nothing                    |
| Behind it    | Nothing                                 | The panel layout popover   |
| Badge        | Nothing                                 | `ProblemsBadge`            |
| Run actions  | Nothing. Test floats over the list      | Test, Pack, overflow       |

Each slot reads the project context itself rather than taking it down the tree, so a route
change refills the chrome instead of redrawing it.

### The bar centres in the title bar

The arrows and the bar sit in the middle of the title bar rather than in the middle of what is
left over between its two sides. The navigation on the left and the cells on the right do not
weigh the same, so both sides take an equal share and the bar centres between them.

The bar's width is a claim on the free space rather than a flex basis. Claimed first, behind a
grow of 1 on each side, it reaches its cap wherever the title bar can spare it and hands width
back to a side needing more than its share. `min-w-max` keeps either side from squeezing a cell,
and the bar gives up its tag as it narrows.

**The title bar's left side folds to make room.** Under 72rem of title bar the navigation draws
its icons alone, each with its name as a tooltip. Under 62rem the wordmark and the version go as
well, and the app's mark stays. The steps are in rem, so they follow the zoom setting, and they
are the same on every page, so the navigation does not change shape when a tab is pressed. They
leave the bar's field about 21rem at the smallest window.

The bar is a field, 28px tall in the 40px title bar, and the one boxed element there. The title
bar is that tall on every page, so the field has 6px over it. The fold starts at the title bar's
bottom edge with no gap of its own, so the field has the same 6px under it.

**The row is one line of 28px controls.** The navigation and the cells on the right are as tall as
the field and take its radius. The page that is current fills with the accent tint, on a
navigation item and on a cell alike. The window controls stay the height of the title bar,
against the window's edge. DS-SHAPE in the `design-system` skill lists the cells.

### The run actions are 28px controls

The status row is 36px tall on every page, and the workshop's controls must not change that. They
draw at the 28px size, DS-SIZE, which leaves the row's own padding around them. The layout
popover behind the bar is the same size, the height of the bar's field. New project is inside
the field, so it draws at 24px, the size of the filter beside it.

Where the patcher cannot run and no mod is broken, the status row has nothing to say and draws
nothing on other pages. Under a project it draws for the run actions alone.

### The fold

Between the title bar and the status row, both routes render onto the same ground,
`surface-950`, DS-GROUND. Under a project the editor and its side panels are islands on it, each
with its own edge. Over the grid the fold is one island: the page inset that Home and the mod
library draw their content in, per "The inset region holds cards" in [Home](HOME.md). The grid
scrolls inside it, and the filter chips draw on the ground over it.

On both routes the title bar draws on that ground with no line under it, as the status row
already does. The seams around the islands then run into the frame on all four sides, and the
islands read as set into one surface. Home and the mod library draw the title bar on the ground in
the same way. Every other page keeps the title bar one rung up with its hairline.

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
| `idle`    | Nothing typed, no focus                           | The crumb, and the version under a project      |
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
still showing it and the footer's count reads `3 of 15` while it is.

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
run an action and it cannot show a state, so grid against table keeps a visible control. The route
out of a project is the crumb and the Projects scope, twice over already.

## The grid

### The card

A card is the project: its thumbnail at 16:9, the display name, the tag and champion pills, the
version and the first author. A checkbox rides the top-left corner of the thumbnail and the
overflow menu sits at the trailing edge of the text. The [table](#the-table) lays the same parts
out as columns and adds Test and Pack inline.

The card sits at `surface-900` on the fold's ground and answers the pointer by lifting a rung
rather than by rising off the page, DS-GROUND. A grid of cards that each translate and cast a
shadow reads as tiles floating over the surface rather than as what the surface holds.

**One menu, two ways in.** The card's right click opens what its kebab opens, so nothing it
offers is reachable only by finding a button that is not drawn. The list holds Edit, Test or Stop
Test, Pack, Rename, Open Location and Delete, on a card and on a table row alike. A project testing
right now carries a **Testing** pill that ends the run, and in the table its Test reads Stop Test.

**A right click over the selection reads over the selection.** Test N, Pack N, Delete N and Clear
selection, the same set the footer's count opens. A right click outside the selection
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
| `↑` `↓`         | One row                                                 |
| `Home` `End`    | The first card and the last                             |
| `Enter` `Space` | Opens the focused card, the way a click does            |
| `F2`            | Renames the focused card, over its slug                 |

**The columns are measured rather than configured.** The grid wraps on `auto-fill` against a card
width the zoom and the card scale both move, so nothing in the code knows how many columns are on
screen. The cards' own distances from the top, read at the moment of the key press, are what
answer.

**A down out of a full row into a short one lands on the last card it holds.** APG says the focus
does not move, and a grid of seven over three columns would then have a bottom row the down arrow
could not reach from two of the three columns above it.

The focus ring is `accent-500` against the hover border's dimmed accent, DS-HOVER.

### Selection, and a running session

A project is picked on its card or its row, and `Ctrl+A` picks every drawn project. The select-all
checkbox does the same and clears when they are all picked already. The table holds it in its
header, and the footer holds it over the grid. The footer names the picks by their count, and
pressing the count opens the bulk actions.

Test stands in its dock whether or not anything is picked - it is the action a user comes
to the grid for - disabled until something is, and in the same green a project's own header gives
it, so one action reads the same from either surface. Pack and Delete are what a selection is
for, so they arrive with one rather than standing disabled beside it.

**The picks are spent as Test or Pack is pressed.** The run answers over the grid and there is nothing
left to press again, and a menu that closes on the press would otherwise carry a completion
callback down with it - the footer's count and a selected card's right click draw the same four commands
from the same place, so neither can end up spending the picks when the other does not.

The grid runs the same test state machine a project does. Named with no project its "other" is
simply the session the grid started, and the button walks idle → Building… → Stop Test the way a
project's does. A run the mod library started leaves both disabled, each pointing at the surface
that owns it.

**A session holds the files it was started over, and that set is not the user's to rewrite until
it ends.** So select-all goes quiet while the patcher is up - the checkbox and the `Ctrl+A` that
doubles for it, both gated on the same state - while Test stays in its dock, as the one control
that ends the session. The dock draws while a session is up even where there is nothing to list.

The primary Test action excludes the active profile's mods from the overlay and the incident's
mod list. The project header and the grid dock offer **Test over <profile>** in their caret menus.
The card overflow and the command palette also offer **Test over profile**. The table row's
inline Test and selection context-menu Test remain alone. The dock's primary tooltip describes
an alone test, and its caret tooltip names the selected profile once loaded.

The header's caret retains layer selection and remains available for base-only projects. An
active session disables alternate test actions. The session origin records profile inclusion,
and hot reload retains that choice. For an included profile, the session bar displays its live
**Selected profile** name and explains that selection changes apply when the overlay rebuilds.
It marks changes deferred until the game ends. This is not a claim that a newly selected profile
has already been applied to a running game. Alone tests display no profile label.

### Sort, filter and the count

The sort and filter popover sits on the bar's trailing edge, beside the query it narrows with. It
renders in `idle` and in `filter` both, because a control that vanishes the moment someone types
is missing when it is wanted.

Sort is name or last modified, either direction. The filters are tags, champions and maps, and
what is set draws as chips over the grid while no project is open. A filter set on the grid and
then carried into a project draws its chips nowhere - a project header is not the grid's status
line.

The count is in the list's footer: `15 projects` plain, `3 of 15` while anything is narrowing
it. That is what makes a standing filter visible from `idle`. The bar draws no count and no
shortcut hint, so its field holds the crumb and the filter alone.

### View mode and card size

Grid against table is a `SegmentedControl` in the list's footer, and it outlives a restart. The view
options popover on its edge carries the card scale the mod library's grid uses too, and the
table's row height, grouping and columns while the table is up. Card width is that scale times the
app zoom, so the column count follows both.

### The list's footer

The island the list draws in ends in a footer row, 36px tall, under the grid and under the table.
It holds what belongs to the list: the count, the picks and the view.

The count reads `15 projects` plain and `3 of 15` while anything narrows the list. The picks
follow it as `2 selected` once there are any, a button that opens their bulk actions. Over the
grid the select-all checkbox leads the row. The table holds that checkbox in its header, so the
footer does not draw a second one.

The view mode control ends the row. The footer draws wherever there are projects to list, a
search with no matches included, because the control is the way to the other view.

**Test floats over the list, above the footer's trailing end.** The dock is a raised container
holding the one button, 4px in from the corner, which is the inset the footer's view control
keeps from the same edge. The list keeps room under its last row or card, so a scroll to the end
clears what the dock covers.

## The table

The table draws one row per project, in columns the reader arranges, and it replaces list mode.
It is the mod library's table with the workshop's columns, so columns resize, move and hide the
same way, and the layout is per machine, as "Table view" in [Mod library](LIBRARY.md#table-view)
describes. There is no panel beside it: a project's details are its own editor's.

**A bare press opens the project**, as a press on a card does. Ctrl-click picks a row and
shift-click picks the run from the last row picked. A drag down the checkbox column picks the
rows it crosses, and the header's checkbox picks every drawn project.

**The keyboard moves the current row.** The arrows, Page Up, Page Down, Home and End move it, and
Shift with an arrow extends a range. `Enter` opens the current project, `Space` picks it and `F2`
renames it. The bar hands the keyboard to the table the way it hands it to the grid.

**A session holds the picks here too.** While the patcher runs, the checkboxes, the modifiers and
the header's checkbox all go quiet, and the row of the project under test keeps its checkbox
ticked, the rule "Selection, and a running session" sets for the grid.

**Grouping** files projects by location, champion, map, tag or author. A project with two
champions has a row under each, and a pick counts it once. A search or a filter holds every group
open on its matches, and a group's checkbox opens a folded group as it picks.

## Open any folder

A project is a folder the workshop knows about, not only a child of the workshop folder. The
workshop folder is scanned as before and stays the default home for New project and every import.
Any other folder joins the workshop the first time it is opened, the way a folder opens in VS Code.

| Term            | What it is                                                                    |
| --------------- | ----------------------------------------------------------------------------- |
| Workshop folder | The scanned root, `workshopPath` in `settings.json`                           |
| Opened folder   | A project folder outside it, kept in `workshop-projects.json` beside settings |
| Recent          | Not a third list. Every project carries a last-opened time                    |
| Project id      | A hash of the project's path, which the route `/workshop/$projectId` takes    |

The id replaces the folder name in the route, so two opened projects with the same name coexist.

### Ways in

- **Open folder…** on the New caret, `Ctrl+O`, and the palette's command list
- A folder dropped on the grid
- A row of the Recent group on the caret, or of the palette's `/` source, which ranks by last
  opened. `Ctrl+R` opens the palette on that source with an empty query.
- The start page, when no workshop folder is set and there is nothing to list

### What the picked folder decides

| The folder holds                              | What happens                                                                                   |
| --------------------------------------------- | ---------------------------------------------------------------------------------------------- |
| `mod.config.json` or `mod.config.toml`        | The editor opens. A folder outside the workshop folder joins the list, and a toast offers Undo |
| The fantome layout (`META/info.json`, `WAD/`) | The convert dialog lists what it found                                                         |
| Subfolders that are projects or fantome mods  | The batch dialog                                                                               |
| None of these                                 | The convert dialog, offering an empty project in place                                         |
| Nothing, the path is gone                     | An error toast                                                                                 |

**Convert.** "Make it a project here" writes `mod.config.json` from `META/info.json`, moves
unpacked WAD directories into `content/base`, unpacks packed WADs there and deletes the packed
originals, and moves `RAW/` to `content/base/raw`. `META/` stays. Packed WADs unpack into
temporary directories before anything moves, so a failed unpack leaves the folder as it was.
"Copy into the workshop folder" does the same to a copy and leaves the source alone.

**Batch.** "Add all to the list" opens every project subfolder and converts every fantome one in
place, under the name its metadata suggests. A folder that fails is listed with its reason and the
rest still land. "Use as the workshop folder" sets `workshopPath` instead. There is one workshop
folder, never several.

### On the grid

Opened folders sit on the same grid as the workshop folder's projects, at the same card size. In
the grid view the card is identical, and hovering its name shows the folder's path. The list
view has the room for the path itself, after the authors, truncated from the left so the folder
name, which tells two paths apart, stays visible.

The default sort is Recently opened. A project never opened sorts by when it last changed. The
filter popover has a Location section: all, workshop folder, opened folders.

An opened folder whose config is gone keeps a dashed card below the grid, with **Locate…** to point
the entry at the folder's new place and **Remove from list** to forget it. The missing cards sit
outside the grid's roving stop, so the keyboard reaches only cards that open.

### Leaving the list

An opened project's menu adds **Remove from list**, which forgets the path and leaves the files.
Delete stays below it, and for an opened project it asks for the project name typed out before it
removes the folder from disk.

## The navigation history

One stack for the shell, not one per project. A stop is either the grid or a document in a named
project, and the two arrows walk between them.

| Event                                                 | Does                                    |
| ----------------------------------------------------- | --------------------------------------- |
| Opening, activating, focusing or revealing a document | Pushes a stop                           |
| Arriving on the grid                                  | Pushes a grid stop                      |
| Entering a project whose stop is not the current one  | Pushes a stop for its open tab          |
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
Where the drop leaves two stops of one tab adjacent, the second goes too, so no arrow press
lands on the tab it started on.

A tab whose document id changes keeps its stops under the new id. A layer rename and a sandbox
switch both change the id and leave the tab in place.

An arrow steps over a stop whose tab is gone and lands on the next stop behind it.

A walk that lands in another project routes to it, so the store returns the stop it reached
rather than leaving a caller to re-read an index the next walk can race.

A stop is titled by the project it sits in, and one somewhere else names where it is:
`Mod details in Charizard Smolder`. The back tooltip over a grid stop reads `Back to the
workshop`.

The stack is the session's. It is never written to `.ltk/editor.json`, and it holds 50 stops
across the whole shell.

The grid records itself from the route rather than from the resolved project, which arrives a
frame later - a deep link into a project would otherwise record a grid the user never stood on.

## Publishing to RuneForge

"Publish to RuneForge" is on the card menu and on the overflow menu of the editor header. It packs
the project in the format of the pack target, `.modpkg` when the target is both, uploads the
package and creates a post or a release on RuneForge. The contract is `docs/PUBLIC_API.md` in
`runeforge-io/runeforge`, and the plan is `specs/019-runeforge-publishing/spec.md`.

### The connection

The RuneForge card in Settings, on the Workshop tab, connects an account with a pasted API token.
The token is checked with `GET /api/v1/me` before Windows stores it (ADR-0070). The card then shows
the account, the token prefix and the scopes, and a warning lists the scopes that publishing uses
and the token lacks. A token that RuneForge refuses marks the card with Reconnect. Without an
account, "Publish to RuneForge" opens the Settings tab instead of the dialog.

### The dialog

| State     | What it shows                                                                                      |
| --------- | -------------------------------------------------------------------------------------------------- |
| Preparing | The stage (validating, packing, uploading, inspecting) and the bytes sent, with Cancel             |
| Review    | The target post, the tag, the notes, the game version, the fields to refresh and the findings      |
| Done      | "Open on RuneForge", the publish result or the checklist that refused it, and the scan of the file |

- A validation error of the project stops the publish before any request. A refused package shows
  its findings, and Publish stays disabled while a finding is an error.
- The target is the post that the project stamp names if the account owns it, else the post that
  RuneForge suggests, else a new post. Picking another target reads its prefill again.
- A taken tag offers the next free tag as one press.
- A release refreshes no post field unless the creator ticks it, and "Set mod status to Working"
  is on.
- "Publish now" is offered for a new post when the token has the `publish` scope. A refused
  publish lists what the post lacks. If RuneForge asks the AI content question, the dialog asks it,
  and an account that publishes through a review gets a link to the post page.
- A close while the project prepares cancels the run, and a close in the review deletes the
  upload.
- After the create, the project config gets a `distributor` stamp with the post id, so the next
  publish of the project targets the same post.

## How it is built

The header mounts above the outlet, so it cannot sit inside the provider the project route
mounts. The layout route resolves the project instead and provides it, or provides null.

The header draws through two portals. `ChromeSlot` in `src/components` is a place the frame
offers, one in the title bar and one in the status row, and `ChromePortal` draws a page's
children into it. A portal keeps the React tree, so the bar and the slots still read the project
context of the route that mounted them. The palette's scrim stays in the route's own tree, where
it is positioned against `main` and leaves the title bar uncovered.

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

| Piece             | Where                                                           |
| ----------------- | --------------------------------------------------------------- |
| The shell         | `src/routes/workshop.tsx`                                       |
| The grid route    | `src/routes/workshop/index.tsx`                                 |
| The header        | `src/modules/workshop/projects/components/WorkshopHeader.tsx`   |
| The frame slots   | `src/components/ChromeSlot.tsx`                                 |
| The list's Test   | `src/modules/workshop/projects/components/WorkshopTestDock.tsx` |
| The list's footer | `src/modules/workshop/projects/components/WorkshopControls.tsx` |
| The bar           | `src/modules/workshop/palette/components/WorkshopBar.tsx`       |
| The mode          | `src/modules/workshop/palette/utils/barMode.ts`                 |
| The sources       | `src/modules/workshop/palette/utils/sources.ts`                 |
| Project rows      | `src/modules/workshop/palette/components/projectRows.tsx`       |
| The grid          | `src/modules/workshop/projects/components/ProjectGrid.tsx`      |
| Its keyboard      | `src/modules/workshop/projects/hooks/useProjectGridNav.ts`      |
| The arrow walk    | `src/modules/workshop/shared/utils/gridNav.ts`                  |
| The history       | `src/stores/workshopEditor.ts`                                  |
| Its hooks         | `src/modules/workshop/shell/hooks/useShellHistory.ts`           |
| The grid filter   | `src/modules/workshop/projects/hooks/useFilteredProjects.ts`    |

## Ideas for review

These are proposals. None is a decision.

**The library as a document.** Variant B: the grid becomes a tab like any other, a tab carries
its own project, and two projects sit side by side in one split. It wants a tab model keyed by
something other than one project, which is the whole of the work.

**One selection model.** Bulk Test and Pack live on the list's picks, and a project's
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
| Does the grid's filter survive a click away?    | Yes. The footer's count is what says so             |
