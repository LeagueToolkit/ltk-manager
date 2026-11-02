# Mod library

## Changes

| Date       | Change                                                      |
| ---------- | ----------------------------------------------------------- |
| 2026-11-02 | Installing a list from one `ltk://install-list` link        |
| 2026-10-16 | Draw the title bar on the page ground, as the workshop does |
| 2026-10-09 | A library index that a newer version wrote can be rebuilt   |
| 2026-10-02 | Table load order by drag, and Move to folder                |
| 2026-10-02 | The table view, its dock, grouping and row picking          |
| 2026-10-02 | A second shift-click moves the range from the same anchor   |
| 2026-10-02 | Importing a mod the library holds                           |
| 2026-10-02 | Opening a mod file from Explorer installs it                |
| 2026-09-30 | A library edit reaches a running patcher between games      |
| 2026-09-12 | The documents panel is a drawer over the grid, not a pane   |

Each edit of this document adds a row at the top. The table keeps the last ten rows.

The mod library is the LTK Manager screen for the mods a user installed. It holds a grid of
cards, the folders and profiles that organise them, and the Play button that launches the game
with the enabled set. What the [workshop](WORKSHOP.md) describes is the authoring side, and the
two meet only where a workshop test layers its projects over this screen's active profile.

The core design idea is that **a card is a switch, and a modifier is what picks it instead.**
A user comes to the library to turn mods on and off, so a bare press is that and nothing else.
Everything a set of mods can be asked to do at once hangs off a selection, which is entered by
ctrl-click or shift-click rather than by a mode to switch into first.

## Goals

- A bare press means the one thing a user came to the library for
- Picking a set costs no mode, no button and no round trip through the toolbar
- A mouse-only reader finds the checkbox without knowing the modifier
- Every command a selection carries is on the bar, which is up whenever a selection is
- Nothing acts on a mod the reader cannot see

## Feature status

The status words are the ones [Problems](PROJECT_PROBLEMS.md#feature-status) defines.

| Feature                | Status    | Note                                                          |
| ---------------------- | --------- | ------------------------------------------------------------- |
| Selection by gesture   | Available | Ctrl-click picks, shift-click ranges, no mode to enter        |
| The checkbox           | Available | On the hovered card, and on every card under a selection      |
| The floating bar       | Available | Six commands, while the selection is non-empty                |
| Select all             | Available | The toolbar button, toggling all visible against clear        |
| All visible Enable     | Available | On the button's caret, beside Disable                         |
| Enable and disable     | Available | A bare press on a card, and a switch on a table row           |
| Grid and table         | Available | A segmented control, with the view options on its action slot |
| The table view         | Available | Columns, row heights and a dock that follows the pointer      |
| Grouping               | Available | Folder by default, or any of eleven derived groupings         |
| Drag down the checkbox | Available | The table's way to pick a run of rows with one press          |
| Folders                | Available | One level, drag to fill, and a drilldown route per folder     |
| Profiles               | Available | Named enabled-sets, switched from the toolbar                 |
| Filters and sort       | Available | A popover off the search box, and chips under the toolbar     |
| Search                 | Available | `Ctrl+F`. Flattens the folders while it has a query           |
| Manual reorder         | Available | Drag within a folder. Off under a search, a filter or a pick  |
| Import                 | Available | `Ctrl+I`, the toolbar button, a drop, or a file from Explorer |
| Layers                 | Available | A popover on a multi-layer card                               |
| Storage                | Available | Project or archive, on the card's menu. ADR-0008              |
| Mod health             | Available | Its own document, [MOD_HEALTH.md](MOD_HEALTH.md)              |
| The documents panel    | Available | A drawer over the grid's right edge, closed until asked for   |
| The details tab        | Available | One mod's cover, facts, layers, WAD footprint and edit form   |
| The readme tab         | Available | One mod's readme, opened from that card's menu                |
| The licenses tab       | Available | One mod's license name, its link, and the text it ships       |
| Skinhack blocklist     | Available | Retiring into a Problems rule over the project manifest       |
| Marquee selection      | Proposed  | Competes with drag-to-reorder for the same press              |
| Folder moves on a pick | Available | Move to folder, on the bar and on a mod's menu                |
| Rebuild library        | Available | On the page for an index that a newer version wrote           |

## How a mod is picked

**A bare press is the switch.** Enabling and disabling is what the library is for, and it is the
one action a card offers without a modifier. A grid card has no switch of its own, so the card is
the control. A table row carries a real switch in its On column, and pressing anywhere else on the
row does the same thing.

**Ctrl-click adds and removes.** The card joins the selection, or leaves it, and the mod stays
switched exactly as it was. `Cmd` does the same, so a mac keyboard is not a second gesture to
learn.

**Shift-click ranges from the anchor.** The anchor is the last card picked without shift, and the
range covers every card between the two in the order the grid draws them. A second shift-click
redraws the range from the same anchor, so it moves the far end rather than adding a second range,
and the picks made before the range began stay picked. With no anchor to range from, the
shift-click picks the one card under the pointer.

**A picked mod that cannot be switched on is still picked.** A blocked mod refuses a bare press,
and uninstalling it is the reason to reach for it in the first place, so the modifier gestures
stay open where the switch is closed.

**The checkbox is the way in without the modifier.** It draws on the card under the pointer, and
on every card while the selection is non-empty. A press on it adds or removes that one card. The
grid draws it in the card's top-left corner, over the art, and the table draws it at the head of
the row. Neither reflows as a pointer crosses it - a row holds its place at all times, and a card
draws it over the corner with the marks sliding aside.

**There is no marquee.** A drag over the grid is already how a mod is reordered, and one press
cannot mean both. Ctrl-click and shift-click reach every set a rubber band would.

## What a selection carries

Six commands, and the same six wherever they are drawn:

| Command         | What it does                                                     |
| --------------- | ---------------------------------------------------------------- |
| Enable N        | Switches on every picked mod that is off and not blocked         |
| Disable N       | Switches off every picked mod that is on                         |
| Move to folder  | Files the picks into a folder, out of every folder, or a new one |
| Check health N  | Runs the [health](MOD_HEALTH.md) rules over the picks            |
| Uninstall N     | Deletes them from disk, behind a confirmation that names them    |
| Clear selection | Drops the picks and takes the bar with them                      |

**Enable, disable and Move to folder leave the selection standing.** They are reversible, and
the first two are pressed in pairs, so the set a reader assembled survives the press. Check health spends it as the press
lands, because the run reports through its own progress toast and answers over the library.
Uninstall spends it when the run comes back, which is what lets the failures stay picked.

**A blocked mod is skipped by Enable.** A card refuses that press one mod at a time, and a set is
not a way around it. Disable is always offered, and Uninstall is the reason the mod is pickable
at all.

**Every command stays on while the patcher runs.** Enable, Disable and Uninstall reach the
running session as [An edit while the patcher runs](#an-edit-while-the-patcher-runs) describes.

**The bar is over the library, not in the toolbar.** It appears while the selection is non-empty
and it names its own count, with a second count for the picks a filter or a search is currently
hiding. Escape clears the selection, unless a dialog or a menu is drawn over the library, in
which case Escape belongs to what is on top.

**A failed uninstall keeps its failures picked.** The mods that were removed are gone from the
selection with the library, and the ones that refused stay, so a second press is aimed at exactly
what is left.

## What a right click opens

**A right click opens the card's own menu, whatever is picked.** The same list the kebab draws,
because which pixel was hit never changes what opens. A reader who has picked eleven mods and
right-clicks one of them is asking about that mod, not about the eleven.

**A right click reads the card and never writes the pick.** It selects nothing, deselects nothing
and collapses nothing, so the set a reader assembled survives asking a question about one of its
members. Picking is the checkbox's and the modifiers', which are the gestures that say so.

**The selection's own commands are the bar's.** The bar is up for as long as a selection is, and it
carries all five, so nothing is out of reach once the right click stops offering them.

**A right click on the library ground offers New Folder.** The ground is not a card, so it neither
reads nor changes the selection.

## The toolbar button

`Select all` picks every visible mod. Pressed again with all of them picked, or with nothing
visible to pick, it clears instead - the same toggle the [workshop](WORKSHOP.md) grid's button
makes, and `Ctrl+A` is the same press. The button reads as active while anything is picked.

**Visible is what the grid is drawing.** A search or a filter flattens the folders, so everything
matching is visible. Without one, a folder route draws that folder alone and `Select all` reaches
no further than it - a shift-click range inside a folder stops at its edges for the same reason.

Its caret holds `All visible` `Enable` and `Disable`. Those act on what the grid is showing rather
than on the selection, which is what makes them useful with nothing picked at all.

## Reorder and a selection

Manual reorder is off while anything is picked. A drag and a pick compete for the same press, and
the drag is the one that can be reached again a moment later. Reorder is off under a search and
under a filter for the same reason it always was - the order on screen is not the order stored.

## The selection leaves with the page

Navigating away from the library clears the selection. A pick carried to another screen and back
would let `Uninstall N` act on mods the reader cannot see, and a folder drilldown is the case that
makes it concrete. The selection is session state and is never written to disk.

## An edit while the patcher runs

A library edit reaches a running patcher without a restart. Switching a mod, reordering, layers,
a folder's switch, a move into a folder, an install, an update, an uninstall, a mod's storage and a
profile switch all apply to the next game.

The overlay is rebuilt between games, never under one. A game opens the overlay's files as it
starts and holds them until it closes.

- **No game open.** The patcher rebuilds the overlay a moment after the last edit, so a burst of
  edits costs one rebuild. Play shows the build the way it does at a start.
- **A game open.** The edit is saved and waits. `Applies after this game` sits beside Play until
  the game closes, and the rebuild runs then.

A game launched during the few seconds of a rebuild runs without mods, the same as a game that was
already running when the patcher started.

A repair and a profile rename still wait for the patcher to stop. A repair rewrites the archive the
rebuild reads, and a rename moves the folder the overlay is in.

## Opening a mod file

With `Open mod files with LTK Manager` on in Settings, double-clicking a `.fantome` or `.modpkg`
file in Explorer installs it. The window comes forward on the Mods page, and the install runs
exactly as a drop onto the window does: the same progress dialog for several files, and the same
toast with the result. Nothing asks first, because the reader chose a local file.

The app may be closed, running in the tray or open on another page. A file opened before the window
is ready waits for it. A first run still opens on Settings, and the file installs once the reader
reaches the library.

Explorer starts the app once per selected file. The files that arrive within 300 ms of each other
install as one import, so a multi-select reads as one action.

## Importing a mod the library holds

An import compares each archive with what the library already holds, and does one of three things.

| The archive is                          | The import                                            |
| --------------------------------------- | ----------------------------------------------------- |
| Byte for byte one the library holds     | Installs nothing and names the mod it already is      |
| A newer version of a mod in the library | Updates that mod in place, as `Update from file` does |
| Anything else                           | Installs it as a new mod                              |

The file name does not matter, so a renamed copy of the same archive is still the same mod.

**A newer version is the same mod at a higher version.** The same mod has the same project name and
the same authors, ignoring case. A higher version is a greater semver version, and an archive whose
version does not parse is never one. The updated mod keeps its place, its folder and whether each
profile enables it. When the library holds several older copies, the one at the highest version is
updated. An older or equal version installs beside the mod, so downgrading stays a choice the reader
makes with `Update from file`.

How the result reaches the reader:

- One file: a toast names the mod that was updated or that the library already holds.
- Several files: the result dialog lists the updated mods and the ones already in the library apart
  from the mods it installed and the files that failed. A batch that carries one archive twice
  installs it once, and a batch that carries two versions of a new mod lists it once, at the newer
  version.
- A deep link: the dialog says the mod was updated or is already in the library.

A mod is matched to an archive it already holds by the archive it was installed or last updated
from. A mod installed before the check existed has no record of that archive, so its stored archive
stands in, and it matches only when the import left that archive unchanged.

## Installing a list

`ltk://install-list?url=<manifest>&source=<site>` installs a whole list - a Runeforge collection -
from one press on the site. The link names a manifest and nothing else; the manager reads the
manifest and mints each mod's download link just before that mod downloads. The reasons are
ADR-0076, and the contract is `.specify/specs/002-ltk-protocol-install-list/contracts/`.

**One dialog for the list.** It draws the list's name, author, source and count, then every mod
as a row with a checkbox, all checked. `Install N` counts the checked rows. `Select all` and
`Select none` sit over the rows. The dialog is the `install-list` claim of ADR-0022, right under
the single install's.

**A mod the library holds at the listed version is marked, not offered.** Its row says
`Installed` and has no checkbox. The mark reads the origin the manager records on every mod a
list installs: the site, the mod's id there and the version the site listed. A second Install
all of a collection offers only what changed, and a list with nothing to offer says so and has
no Install button.

**Install into the active profile, or a new one.** Two cards over the rows: the active profile,
named, and `New profile`, named after the list in a field the reader can edit. A new profile is
created and switched to before the first mod installs, so the list's mods are enabled there and
nowhere else.

**The run reports each row.** A row moves through `Preparing...`, `Downloading...` with the
bytes under it, and `Installing...`, and settles as `Installed`, `Updated`, `Already installed`
or `Failed` with the reason under it, the same cause the single install draws. A bar over the
rows counts the settled ones. A failed row does not stop the run.

**Stop ends the run after the mod it is on.** The mods installed by then stay, and the report
says the run was stopped.

**The report is the same dialog.** A line counts installed, updated, already there and failed.
`Retry failed` runs the failed rows again, into the profile that is active by then. `Done`
closes.

**The top of the list wins.** Once the run ends, the list's mods sit at the front of the load
order in the list's order, whichever order they landed in.

**A host outside the trusted providers list is asked about before the read**, as the single
install asks before its download. `Trust and continue` writes the host into the list and reads
the manifest in the same press.

## A library that a newer version wrote

`library.json` carries a schema version. When that version is higher than the app reads, the page
shows the error in place of the mods, with a `Rebuild library` button. The app does not read the
file, because a save would write it back at the lower version and drop what the newer version
added.

`Rebuild library` asks for confirmation, then:

- Moves `library.json` to `library.v<version>.json.bak` in the storage folder
- Adopts every mod under `mods/` into a new index, as ADR-0002 describes for a lost index

The rebuilt library has one default profile, no folders and no enabled mods. The reader who has a
newer app version installs it instead, and the dialog says so.

## The documents panel

The Library's right edge holds a panel with three tabs: **Details**, which answers what one
installed mod is, **Readme**, which renders that mod's own readme, and **Licenses**, which names
what that mod is licensed under. All three answer for the one mod the panel holds. It is closed
until a reader opens it, and it opens over the grid rather than pushing the cards aside.

**A card's menu aims the panel, and the toolbar only shows or hides it.** The `Details` item lands
on Details and the `Readme` item lands on Readme, so the tab follows the intent of what opened it.
The toolbar's Documents toggle names no mod of its own, so it reopens on the mod and the tab the
panel was last left on.

There is no gesture on the card itself. A bare press is the switch, so a double-press would flip
`enabled` twice on the way to a readme, and the selection is a set with no notion of one readable
pick.

**The panel names what it holds in its own header.** A reader who opened a mod, toggled six
switches and came back still knows what they are reading. The name is not on the tab, where the
strip would shift under the pointer as one mod's name gave way to another's.

**The Readme item is always offered.** Whether a mod has a readme is not known until its archive
opens, so an item that hid without one would cost either a flag persisted for every installed mod
or an archive opened per card. A mod with no readme shows the panel's own empty state.

**An absent readme and an unreadable archive are two answers.** The second says the mod's archive
is not answering, which is a mod that may not work at all, and reporting it as a mod whose author
wrote nothing is a silent lie about something the reader has installed. The same holds for a
license.

**A readme renders as GitHub Flavoured Markdown, with a stranger's file in mind.** Raw HTML and
inline scripts are not rendered, an external link opens in the system browser, and no image
resolves - a mod directory is not a project, so a relative path has nothing to point at and the
image degrades to its alt text. A readme holding one heading renders as one heading: any
threshold is wrong for somebody, and an author who wrote only a title still chose to write a
file.

**Uninstalling the open mod clears the panel rather than closing it.** The panel stays at its
width and says the mod is gone, so there is no stale content and no layout change nobody asked
for. Opening another mod is the likely next act.

### The details tab

Details is one mod's whole answer: its cover, who wrote it, what it says it does, the categories
it carries, the layers it switches, the game WADs it patches, and where it sits on disk. Three
modal dialogs answered those separately before. Each covered the library, each was dismissed
before the next could open, and none of them could be read beside the grid.

**The cover runs the panel's full width.** A mod's thumbnail is the thing a reader remembers it
by, and a column's top is the one place a jump in scale costs nothing. A mod with no art keeps
the cover and falls back to the letter plate its card draws, because a panel whose first element
comes and goes per mod reads as broken rather than as adaptive.

**Editing happens in the tab rather than over it.** The Edit press swaps the read sections for the
form in place, and Save and Cancel sit in a band pinned to the panel's foot. The cover stays,
because the thumbnail picker is part of the form and the cover is where a thumbnail is.

**Nothing autosaves, and nothing is lost silently.** The panel is not modal, so a reader can press
another card, another tab or the close button with a half-typed name still in the form. Each of
those asks first, and cancelling leaves the panel where it was.

**The WAD footprint analyses on its first expand.** The dialog took that gate from its own portal,
which drew nothing at all while closed. A section in a scrolling tab has no such gate, so the fold
is the gate and a library nobody expands runs no analysis.

**Three tabs is the ceiling.** The strip fits Details, Readme and Licenses at the width the panel
asks for. A fourth needs either truncation or a scroller, so anything else a reader wants to know
about a mod becomes a section of Details rather than a tab of its own.

### The licenses tab

The tab answers for the mod the panel holds, the way Readme does. A reader asking what they are
allowed to do with a mod is asking about the mod in front of them, and a list of every other mod's
license is not the answer to that question.

It draws the name the mod declares, the link beside it where there is one, and the text the
archive carries.

Three states are told apart, because the middle one is the common one:

- a mod that declares a name and carries the file, which shows its text
- a mod that declares a name and carries **no** file, which says exactly that
- a mod that declares neither, which reads as undeclared and opens no archive at all

The name costs nothing, because it rides in the `mod.config.json` a listing already opens. The
text is on disk for neither format, so reading it mounts that mod's archive, and the answer is
held for the session and never written to disk. That is why a mod naming no license is worth
telling apart early: there is nothing to mount for it. A license renders preformatted rather than
as Markdown, because it is a hard-wrapped plain-text file and Markdown mangles it.

### The drawer, and what its width does

**The panel is a drawer over the grid, not a pane beside it.** Opening one asks a question about a
mod rather than changing the library, so the cards underneath keep the positions they were being
read in. A pane on a seam reflowed the grid twice per visit - once on the way in and once on the
way out - and a grid that reflows is a grid a reader has to find their place in again.

It arrives from the right edge it is anchored to, and it draws over the grid alone: the toolbar
above and the session bar below stay where they are, because the drawer belongs to the library
rather than to the window.

**Its left edge drags to resize, and the width outlives a restart.** The drag is bounded twice: a
280px floor, and whatever leaves 320px of library underneath. The floor wins where the two
disagree, because a window too narrow to hold both still has to hold the drawer a reader has just
opened. Arrow keys move the edge from the keyboard, 16px at a time.

Whether the drawer was open, and which mod it held, do not survive a restart: the Library opens
closed every session. A drawer that reopened itself would be covering cards over a question the
reader had forgotten asking, and persisting the mod needs a fallback for one uninstalled between
sessions.

**The panel draws on the page ground with a hairline**, which is what the toolbar and the session
bar already do, and what lets a rendered document sit on the ground without an inset frame of its
own. The tab strip therefore has no rung to mark itself with and leans on that hairline and on
type.

Escape and `Ctrl+A` stay with the library underneath. The panel is not modal, so leaving it does
not also drop the selection.

## Table view

The table draws one row per mod, in columns the reader arranges, with the documents panel docked
beside it. It replaces the list. Search, filters, sort and the selection are the same stores the
grid reads, so switching views keeps all four.

Columns resize, reorder by dragging their header or with Move left and Move right in its menu,
hide from the header's menu or the view options, and reset from either. A press on a header that
does not travel sorts by it, so dragging and sorting share the header without a handle. Row height
is Compact, Default or Comfortable, and the art column scales with it. The name column takes the
width the others leave, so it has no edge to drag, and it stays in view beside the checkbox and
the switch when a narrow window scrolls the table sideways. The layout is per machine and survives a
restart: column order, widths and visibility, row height, grouping, which groups are collapsed,
and the dock's width and whether it is collapsed. Sort is shared with the grid and lasts the
session, like the filters.

### What a click does

**A bare press switches the mod**, as it does on a card, and the On column is the same switch
drawn where a column can show it. The dock already follows the pointer, so a press spent on
showing a mod would do nothing the hover had not. The press also makes the row the current row,
and Space switches the current row from the keyboard. Ctrl-click and shift-click pick exactly as
they do on a card, and a blocked mod refuses the bare press the way its card does.

**The current row is the dock's mod.** It is drawn tinted, and the keyboard moves from it. Arrow
keys, Page Up and Page Down, Home and End move it. Left and Right collapse and expand a group
heading, and Enter or Space on a heading does both.

### The panel follows the pointer

**The dock shows the row under the pointer.** Hovering a row makes it the current row and shows
it, with no delay, because the table is where a reader compares mods. A pointer heading right
toward the dock gets a short grace period, so a diagonal path across other rows keeps the mod it
started from.

**An accent sash lines up with the row the dock shows.** It sits in the table's left gutter,
between the frame and the row, and it follows the pointer from row to row. A reader who scrolled away finds the open mod by it, and it is gone while
that row is scrolled out of view or the dock is collapsed.

**Pin holds the dock on one mod**, and an open edit form holds it the same way, so moving the
pointer never raises the unsaved-changes prompt. A readme or a license is read only once the
pointer rests on a row, so sweeping the table opens no archives.

### Grouping

**Folder is the default grouping**, and its headings carry the folder's own switch and menu,
because a folder exists apart from the table. Champion, map, tag, author, health, on or off,
installed, format, storage and license are views of the library instead, so their headings carry
a checkbox that picks the group's mods.

**A mod files under every group it belongs to.** A skin for two champions has a row under each,
and a range or a pick counts it once. A search or a filter opens every collapsed group that holds
a match, so a match is never hidden behind a heading, and no heading folds until it clears.

**A heading reaches only the mods drawn under it.** Under a search, a folder's switch turns the
matches on or off and leaves the rest of the folder as it was. A group's checkbox opens a folded
group as it picks, so every mod it picked is on screen.

### Picking rows in the table

**The anchor is the last row picked.** A checkbox press or a Ctrl-click sets it, so ticking one
row and shift-clicking another picks the run between them. A bare press switches the mod and leaves
the anchor alone, or the first row of every range would flip on the way in. Hovering never moves
the anchor either, or every shift-click would range from the row under the pointer. The arrow keys
set the anchor, and Shift with an arrow key extends the range from it.

**A range runs over the drawn rows.** A mod filed under two groups ranges from the copy that was
pressed, and a collapsed group's mods are not in a range that crosses its heading.

**Dragging down the checkbox column picks the rows it crosses.** The first checkbox decides the
direction: pressing an unpicked row picks every row the drag reaches, and pressing a picked one
drops them. This is the table's answer to a marquee, and it competes with nothing, since the
column has no other drag.

**Ctrl+Space picks the current row**, so the keyboard reaches every pick a pointer does.

**A run of picked rows draws as one block.** Neighbouring picks join, and the run's corners are
the block's corners.

**Visible is what the table draws.** `Select all`, the header checkbox and the bar's hidden count
all stop at a collapsed heading, because a mod behind one is a mod the reader cannot see.

### Load order in the table

**Dragging a row moves it in the load order.** A press that travels a few pixels is a drag, and one
that does not is the switch, the same split the grid's cards and the table's headers make. A line
marks where the row lands, beside the row under the pointer, and the table scrolls while the pointer
is near its top or bottom edge. Escape puts the row back.

**A drop beside a mod files the row into that mod's folder.** Under folder grouping the headings
show which folder that is, so a row moves between folders as freely as within one, and dropping it
on a folder's heading files it at the end of that folder. A flat table shows no folders, so a row
there moves only among the mods of its own folder.

**The drag is offered where the order on screen is the load order.** That is the priority sort,
with no search, filter or selection standing, and grouped by folder or not at all. Any other
grouping draws a mod under several headings, which have no order of their own.

**Move to folder is on every mod's menu.** It lists the folders, takes the mod out of its folder
and names a new one, and it is the keyboard's way to file a mod.

## Decided questions

| Question                                        | Answer                                                     |
| ----------------------------------------------- | ---------------------------------------------------------- |
| Is there a mode to enter before picking?        | No. Ctrl-click and shift-click are the whole way in        |
| What does a bare click do under a selection?    | Switches that mod, as it always does                       |
| Can a blocked mod be picked?                    | Yes. Uninstalling it is the reason to                      |
| Does the checkbox draw with nothing picked?     | Yes, on the card under the pointer                         |
| Is there a marquee?                             | No. It competes with drag-to-reorder for one press         |
| What does a bare press do in the table?         | Switches the mod and makes the row current, not the anchor |
| Does hovering a row move the anchor?            | No. Only a pick or an arrow key does                       |
| Does a second shift-click add a second range?   | No. It redraws the range from the same anchor              |
| Does the table pick by dragging?                | Yes, down the checkbox column, which has no other drag     |
| Does the table reorder by dragging a row?       | Yes, under the priority sort with folders or no grouping   |
| Where does a selection get moved to a folder?   | Move to folder on the bar, the same list as a mod's menu   |
| Is a mod in a collapsed group visible?          | No. Select all and ranges stop at the heading              |
| What does the toolbar button do?                | Select all visible, or clear once they all are             |
| Where do Enable and Disable all visible live?   | The button's caret, and they ignore the selection          |
| Does a right click change the pick?             | No. It reads the card and leaves the selection alone       |
| What does a right click open over a pick?       | The card's own menu, the same one the kebab draws          |
| Where do a selection's own commands live?       | The floating bar, which is up whenever a selection is      |
| Is the kebab closed while a selection exists?   | No. It is the card's menu, and the card is still there     |
| Do Enable and Disable spend the selection?      | No. Check health and Uninstall do                          |
| Can a mod be reordered while a pick is up?      | No. The drag and the pick are the same press               |
| Does the selection survive leaving the library? | No. It would act on mods the reader cannot see             |
| Is the selection written to disk?               | No. It is session state                                    |
| Does the documents panel cover the cards?       | Yes. It is a drawer, so the grid never reflows around it   |
| What opens it, and on which tab?                | A card's menu on Details or Readme. The toolbar reopens it |
| Where does a mod's metadata get edited?         | In the Details tab, in place. No dialog is left to open    |
| Does Details replace the card's layer popover?  | No. That is a different gesture at a different scope       |
| When is a mod's WAD footprint analysed?         | On the first expand of its fold, never on drawing the tab  |
| Does the Readme item hide for a mod with none?  | No. Presence is unknown until the archive opens            |
| Is the panel's width written to disk?           | Yes, and neither the open state nor the mod it held        |
| Does the licenses tab follow the opened mod?    | Yes. Every tab in the panel answers for the one mod        |
| Is a license text cached to disk?               | No. It is read once per session and held in memory         |
| Can the library be edited while patching?       | Yes. The overlay is rebuilt between games                  |
| Does an edit reach a game already running?      | No. It applies to the next game                            |

## Open questions

1. Does the keyboard reach a range? Enter and Space carry their modifiers, so a focused card
   picks and ranges the way a click does. What has no answer is arrowing between cards, which the
   grid does not offer at all.
