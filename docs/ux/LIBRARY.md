# Mod library

## Changes

| Date       | Change                                                     |
| ---------- | ---------------------------------------------------------- |
| 2026-09-07 | The library selects by gesture, and select mode is retired |
| 2026-09-07 | First draft of this document                               |

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
- Every command a selection carries is on the bar and on the right click, and they cannot drift
- Nothing acts on a mod the reader cannot see

## Feature status

The status words are the ones [Problems](PROJECT_PROBLEMS.md#feature-status) defines.

| Feature                | Status    | Note                                                          |
| ---------------------- | --------- | ------------------------------------------------------------- |
| Selection by gesture   | Available | Ctrl-click picks, shift-click ranges, no mode to enter        |
| The checkbox           | Available | On the hovered card, and on every card under a selection      |
| The floating bar       | Available | Five commands, while the selection is non-empty               |
| The selection's menu   | Available | The same five on a right click over a selected card           |
| Select all             | Available | The toolbar button, toggling all visible against clear        |
| All visible Enable     | Available | On the button's caret, beside Disable                         |
| Enable and disable     | Available | A bare press on a card, and a switch on a list row            |
| Grid and list          | Available | A segmented control, with the view options on its action slot |
| Folders                | Available | One level, drag to fill, and a drilldown route per folder     |
| Profiles               | Available | Named enabled-sets, switched from the toolbar                 |
| Filters and sort       | Available | A popover off the search box, and chips under the toolbar     |
| Search                 | Available | `Ctrl+F`. Flattens the folders while it has a query           |
| Manual reorder         | Available | Drag within a folder. Off under a search, a filter or a pick  |
| Import                 | Available | `Ctrl+I`, the toolbar button, or a drop onto the window       |
| Layers                 | Available | A popover on a multi-layer card                               |
| Storage                | Available | Project or archive, on the card's menu. ADR-0008              |
| Mod health             | Available | Its own document, [MOD_HEALTH.md](MOD_HEALTH.md)              |
| Skinhack blocklist     | Available | Retiring into a Problems rule over the project manifest       |
| Marquee selection      | Proposed  | Competes with drag-to-reorder for the same press              |
| Folder moves on a pick | Proposed  | A selection carries no destination today                      |

## How a mod is picked

**A bare press is the switch.** Enabling and disabling is what the library is for, and it is the
one action a card offers without a modifier. A grid card has no switch of its own, so the card is
the control. A list row carries a real switch on its trailing edge, and pressing anywhere else on
the row does the same thing.

**Ctrl-click adds and removes.** The card joins the selection, or leaves it, and the mod stays
switched exactly as it was. `Cmd` does the same, so a mac keyboard is not a second gesture to
learn.

**Shift-click ranges from the anchor.** The anchor is the last card picked without shift, and the
range covers every card between the two in the order the grid draws them. With no anchor to range
from, the shift-click picks the one card under the pointer.

**A picked mod that cannot be switched on is still picked.** A blocked mod refuses a bare press,
and uninstalling it is the reason to reach for it in the first place, so the modifier gestures
stay open where the switch is closed.

**The checkbox is the way in without the modifier.** It draws on the card under the pointer, and
on every card while the selection is non-empty. A press on it adds or removes that one card. The
grid draws it in the card's top-left corner, over the art, and the list draws it at the head of
the row. It is laid out at all times and only faded, so no row reflows as a pointer crosses it.

**There is no marquee.** A drag over the grid is already how a mod is reordered, and one press
cannot mean both. Ctrl-click and shift-click reach every set a rubber band would.

## What a selection carries

Five commands, and the same five wherever they are drawn:

| Command         | What it does                                                  |
| --------------- | ------------------------------------------------------------- |
| Enable N        | Switches on every picked mod that is off and not blocked      |
| Disable N       | Switches off every picked mod that is on                      |
| Check health N  | Runs the [health](MOD_HEALTH.md) rules over the picks         |
| Uninstall N     | Deletes them from disk, behind a confirmation that names them |
| Clear selection | Drops the picks and takes the bar with them                   |

**Enable and disable leave the selection standing.** They are reversible and are pressed in
pairs, so the set a reader assembled survives the press. Check health spends it as the press
lands, because the run reports through its own progress toast and answers over the library.
Uninstall spends it when the run comes back, which is what lets the failures stay picked.

**A blocked mod is skipped by Enable.** A card refuses that press one mod at a time, and a set is
not a way around it. Disable is always offered, and Uninstall is the reason the mod is pickable
at all.

**Every write is off while the patcher runs.** Enable, Disable and Uninstall all go dark, because
the backend refuses a write to a mod under a running patcher. Check health only reads, so it
stays.

**The bar is over the library, not in the toolbar.** It appears while the selection is non-empty
and it names its own count, with a second count for the picks a filter or a search is currently
hiding. Escape clears the selection, unless a dialog or a menu is drawn over the library, in
which case Escape belongs to what is on top.

**A failed uninstall keeps its failures picked.** The mods that were removed are gone from the
selection with the library, and the ones that refused stay, so a second press is aimed at exactly
what is left.

## What a right click opens

**A right click over a selected card opens what the selection carries.** The five commands, under
a label naming the count. This is the same list the bar draws, from the same place, so the two
ways into a bulk action cannot come to offer different ones.

**A right click outside the selection selects that card alone.** The pick collapses onto the card
under the pointer and the card's own menu opens, so a command always acts on what was pressed.
The menu is decided before the pick moves, which is why collapsing onto a card does not turn the
menu into the selection's.

**The kebab is always the card's own menu.** It is per-card by construction, and it draws the same
list as the card's right click does with nothing selected. Neither closes while a selection
exists.

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

## Decided questions

| Question                                        | Answer                                                    |
| ----------------------------------------------- | --------------------------------------------------------- |
| Is there a mode to enter before picking?        | No. Ctrl-click and shift-click are the whole way in       |
| What does a bare click do under a selection?    | Switches that mod, as it always does                      |
| Can a blocked mod be picked?                    | Yes. Uninstalling it is the reason to                     |
| Does the checkbox draw with nothing picked?     | Yes, on the card under the pointer                        |
| Is there a marquee?                             | No. It competes with drag-to-reorder for one press        |
| What does the toolbar button do?                | Select all visible, or clear once they all are            |
| Where do Enable and Disable all visible live?   | The button's caret, and they ignore the selection         |
| Does a right click inside the pick keep it?     | Yes, and it opens what the selection carries              |
| Does a right click outside the pick keep it?    | No. It collapses onto that card and opens the card's menu |
| Is the kebab closed while a selection exists?   | No. It is the card's menu, and the card is still there    |
| Do Enable and Disable spend the selection?      | No. Check health and Uninstall do                         |
| Can a mod be reordered while a pick is up?      | No. The drag and the pick are the same press              |
| Does the selection survive leaving the library? | No. It would act on mods the reader cannot see            |
| Is the selection written to disk?               | No. It is session state                                   |

## Open questions

1. What does a selection do about folders? Moving a picked set into a folder is the obvious sixth
   command, and it needs a destination the bar has nowhere to put. A submenu on the right click
   is the cheap half, and the bar is the half nobody has designed.
2. Does the keyboard reach a range? Enter and Space carry their modifiers, so a focused card
   picks and ranges the way a click does. What has no answer is arrowing between cards, which the
   grid does not offer at all.
