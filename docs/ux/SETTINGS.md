# Settings

## Changes

| Date       | Change                                                                  |
| ---------- | ----------------------------------------------------------------------- |
| 2026-08-25 | Phase 4c shipped. The routed deep link, and the link in the gear's menu |
| 2026-08-25 | Phase 4b shipped. The index, the public id, the palette and the copy    |
| 2026-08-25 | Phase 4a shipped. The gutter gear, the modified bar and three resets    |
| 2026-08-25 | Adopt the VS Code settings editor: a gutter gear replaces the marker    |
| 2026-08-25 | Phases 1 to 3 shipped. The group, the keys and the anchor are available |
| 2026-08-25 | Accept the group, defer the collapse, and close three open questions    |
| 2026-08-24 | Decide the defaults source, the scoped reset and the setting anchor     |
| 2026-08-24 | Propose the group, the level between a section card and a row           |

Each edit of this document adds a row at the top. The table keeps the last ten rows.

Settings is the tabbed surface where a user configures LTK Manager. A tab holds cards, a card
holds rows, and a row is one setting. There is no level between a card and a row, so a card that
holds two ideas has two ways out today, and both are bad. It splits into a second card, and the
subject now lives in two panels. Or it does not split, and the reader gets a wall of unrelated
switches.

The Patching tab shows both failures at once. `Safety & Integrity` is one panel that holds mod
checks, archive scanning and incident retention, which are three separate ideas under a title that
names none of them. Beside it sits `Patching`, a panel with three rows, kept apart only because
the other panel was full. Appearance shows the same shape without the split: eleven rows in one
list, where color, type, motion and the backdrop each read as a run of rows the reader has to find
by eye.

This document specifies the **group**: a labelled band of rows inside a card, which costs one line
of chrome and no new surface.

Two more features follow from that level, and neither works well without it. A reader who can see a
facet can also see what they changed inside it, so a row that differs from a fresh install says so
and offers the way back, and each level resets its own scope. And a facet with a name can be
pointed at, so any group or row becomes something the rest of the app can link to.

## Goals

- A card holds one subject, however many facets that subject has
- A reader finds a setting by the facet that holds it, and not by reading every row
- A new setting joins a group, and never forces a new card
- The level a setting sits at is a rule, and not a reaction to a full panel
- One sub-header style in the app, and not a second one that only settings uses
- A reader sees what they changed, and puts it back at the level they are looking at
- Anything in settings can be linked to, and the link outlives every rewrite of the label

## Scope

In scope is the settings surface: how a tab lays out its cards, how a card lays out its rows, the
new level between them, what a reader can see and undo at each level, and how a link addresses one
of them.

Out of scope:

- The wording of any individual setting. `src/CLAUDE.md` owns the copy rules, and this document
  adds only the rules for a group's own title
- The cache tab's table, the hotkey capture control and the about tab. None of them is a row list
- Reordering settings across tabs
- A reset for the whole application. Every scope here is a level the reader is already looking at,
  and `Reset all settings` is not one of them
- A settings search box on the page itself. The palette carries the query, and an on-page filter
  waits for a row list something can filter

## Feature status

A status word has one meaning.

- **Available** - the feature is in the application today
- **Planned** - the team agreed on the feature, and work did not start
- **Deferred** - the team agreed on the feature, and it waits for a call site
- **Proposed** - an idea for review, and not a decision

| Feature                 | Status    | Note                                                               |
| ----------------------- | --------- | ------------------------------------------------------------------ |
| The tab rail            | Available | Eight tabs, `Tabs.List variant="pills"` in `Settings.tsx`          |
| The section card        | Available | `SectionCard`. Heading on the ground, panel under it               |
| The two-column grid     | Available | `SettingsGrid`, with `lg:col-span-2` for a wide card               |
| The setting row         | Available | `SettingRow`, inline and stacked, toggle and action                |
| The cluster separator   | Available | Survives on the Project editor card alone, between three rows      |
| The dependent row       | Available | `SettingRow` `dependent` and `hidden`. Two instances               |
| The defaults            | Available | `Settings::default()` in Rust, `APPEARANCE_DEFAULTS` in front      |
| The card reset          | Available | `ResetAppearanceButton`, over the keys its card's scope collected  |
| The group               | Available | `SettingGroup`. Five cards took groups, and General is one column  |
| Group ids               | Available | Sixteen ids across five cards. The anchor, and a future search     |
| `DS-SETTING-LEVEL`      | Available | In the `design-system` skill, cited by `SettingGroup`              |
| The setting key         | Available | `SettingKey`, on every row. Nothing reads it until the reset lands |
| The tab in the URL      | Available | `?tab=`, on a controlled rail written back with `replace`          |
| The focus anchor        | Available | `?focus=`, addressing one group or one row. Two call sites aim it  |
| `get_default_settings`  | Available | One command, one query that never goes stale, one default table    |
| The gutter gear         | Available | On every row that can be put back. Right-click the row for it too  |
| The modified bar        | Available | Dimmed accent on the edge of a row that is off its default         |
| The group reset         | Available | On a group with two or more changed rows, with `Undo`              |
| `DS-SETTING-GUTTER`     | Available | In the `design-system` skill, cited by the gutter and the group    |
| The setting index       | Available | `SETTINGS_INDEX`. Id, key and title for 45 rows, in one table      |
| The public setting id   | Available | `appearance.theme`. Group ids are namespaced beside them           |
| Copy setting ID         | Available | In the gear's menu, on every row the index carries                 |
| Settings in the palette | Available | A source of its own, so a resting box still lists the commands     |
| `ltk://settings`        | Available | A route beside `ltk://install`, with `Copy link to setting` on it  |
| The group action slot   | Available | The prop ships unused. No group needs one yet                      |
| The collapsible group   | Deferred  | No card in the migration folds. It lands with the first that does  |
| The changed dot         | Deferred  | It is drawn on a collapsed header alone                            |

The group was accepted in review on 2026-08-25, and the work is planned at
`docs/plans/settings-groups.md`. Every phase shipped the same day, so the group, its ids, both
search params, the gear, all three resets, the index behind them and the link that carries an id
out of the app are in the application. **The collapsible group is deferred whole**, along with the
caret, the changed dot, the `settings` declaration and the collapsed-state store, because no card
in the migration below folds and a level with no call site is a level nobody has reviewed against
real rows.

## The levels

| Level         | Names                                     | Draws as                                           | Example                               |
| ------------- | ----------------------------------------- | -------------------------------------------------- | ------------------------------------- |
| Tab           | A part of the app the user owns           | A pill in the settings rail                        | Patching                              |
| Card          | A subject                                 | A heading on the page ground, and a panel under it | Overlay                               |
| Group         | A facet of that subject                   | An uppercase label over a band of rows             | Mod safety                            |
| Row           | One setting                               | A label, and its control across from it            | Patch TFT files                       |
| Dependent row | A setting only its parent's state reaches | An indented row under the row that gates it        | Start in tray unless update available |

A group is not a card without a box, and it is not a row with children. It is the level that says
_these rows answer the same question_, which the separators inside `LibrarySection` and
`AppearanceSection` already say today without saying what the question is.

## Which level a setting belongs to

Three tests, in order.

**The move test.** Read the rows under a different card's title. If they still make sense, they
carry their own subject and they are a card. The Overlay rows read the same under Patching, under
Cache or under Library, because the overlay is a thing rather than a facet, so Overlay is a card.
The mod-safety rows mean nothing except under Patching, so they are a group.

**The count test.**

| Rows in the card | Groups                                             |
| ---------------- | -------------------------------------------------- |
| Under 5          | None, unless the card already draws a rule by hand |
| 5 to 7           | Only when the cluster test passes cleanly          |
| 8 or more        | Group it, or split the card                        |

A short list is its own structure, so the count is what usually decides a small card. A card that
reached for a `Separator` has already decided otherwise, and the group is the label that separator
does not carry. `League of Legends` is four rows and takes two groups for exactly that reason.

**The cluster test.** A grouping needs at least two groups, and each group needs at least two
rows. One cluster and a remainder is not a grouping. It is a card with a separator, and it stays
that way. A group is never invented to file a leftover row.

The exception to the two-row minimum is a group whose single row is a **stacked editor** - the WAD
blocklist, the trusted providers list, a storage path. Those rows are already a block, so the
label sits over a block either way.

## Anatomy

```
  Patching                                         <- card heading, on the page ground
  +---------------------------------------------+  <- panel, surface-900, p-5
  | INJECTOR                                    |  <- group header, no rule over the first group
  | Patch TFT files                         ( ) |  <- a row at its default
  | Run injector elevated  (r)              (O) |  <- (r) reverts a row that is off its default
  | Verbose patcher logging                 ( ) |
  | ------------------------------------------- |  <- the rule belongs to the group below it
  | MOD SAFETY                              (r) |  <- resets the group, once two rows differ
  | Block Scripts.wad.client  (r)           ( ) |
  |  ! Modding allows running Lua scripts.      |  <- an alert belongs to the row that raised it
  | Warn about missing dependencies  (r)    ( ) |
  | Enforce anti-skinhack scan              (O) |
  | ------------------------------------------- |
  | INCIDENTS                                   |
  | Allow reading game logs                 (O) |
  | Keep incidents                         [50] |
  +---------------------------------------------+
```

| Part        | Required | Note                                                               |
| ----------- | -------- | ------------------------------------------------------------------ |
| Id          | Yes      | Stable and namespaced by its tab, `patching.mod-safety`            |
| Title       | Yes      | One or two words. See the copy rules below                         |
| Description | No       | Rare. One line, and only when the title cannot carry the meaning   |
| Hint        | No       | `HintIcon` after the title, for detail that would crowd the header |
| Badge       | No       | `ExperimentalChip` and its kind                                    |
| Action      | No       | One control for the whole group, at the trailing edge              |
| Reset       | Auto     | An icon at the trailing edge, once two rows differ from default    |
| Rows        | Yes      | Two, or one stacked editor                                         |

`Auto` means the component decides and no card asks for it. An id is unique inside its **tab**
rather than its card, because that is the scope an anchor addresses.

Where a header carries both, the action comes first and the reset sits outermost. The action is
this group's own control, and the reset is the one every group has.

## How a group draws

The group adds no surface and no radius. It is a label, a rule and a rhythm.

| Part        | Utilities                                                          |
| ----------- | ------------------------------------------------------------------ |
| Panel body  | `flex flex-col gap-4`                                              |
| Group root  | `border-t border-surface-700/40 pt-4 first:border-t-0 first:pt-0`  |
| Group body  | `flex flex-col gap-3`                                              |
| Header      | `flex items-center justify-between gap-2 select-none`              |
| Title       | `text-xs font-medium tracking-wide text-surface-400 uppercase`     |
| Description | `text-xs text-surface-400`                                         |
| Reset       | `Button variant="ghost" size="sm"`, icon only, `h-3.5 w-3.5` glyph |

The title is the same object as `FilterSection`'s header, on purpose. The app gets one sub-header
style rather than a second one that only settings uses. Uppercase at `text-xs` is what keeps it
apart from a row title, which is sentence case at `text-sm`, and what keeps it under the card
title, which is `text-sm font-semibold text-surface-100`.

Spacing:

| Between                          | Space            |
| -------------------------------- | ---------------- |
| Panel edge and the first group   | 20px, from `p-5` |
| Group header and its first row   | 12px, `gap-3`    |
| Row and row inside a group       | 12px, `gap-3`    |
| Last row and the rule under it   | 16px, `gap-4`    |
| Rule and the next group's header | 16px, `pt-4`     |

The rows keep the rhythm they have today, so a card that gains groups does not also gain a new
density. The rule sits centred in 32px of space, which is enough to band a long panel and not
enough to make four groups read as four cards.

Three design-system codes apply:

- `DS-GROUND` - a group takes no surface of its own. An inset rung inside a card is for a detail
  strip, and a group is half the card
- `DS-GAP` - the panel spaces its groups with `gap`. Only the rule's own offset is padding on the
  group, because a border needs a distance that a gap cannot give it
- `DS-INVARIANT` - `surface-700/40` for the rule and `surface-400` for the label, so both invert
  with the theme
- `DS-KIND-HUE` - the focus mark is `accent-500`. Nothing went wrong, so no status hue is right
- `DS-VEIL` - the reset is a ghost button, so it hovers to `surface-veil` and not to a rung

## Rules

| Rule                                                                                   | Why                                                                        |
| -------------------------------------------------------------------------------------- | -------------------------------------------------------------------------- |
| The rule above a group is drawn by that group, and never above the panel's first child | The first band needs no divider from the panel edge                        |
| A group header carries no icon                                                         | The icon level is the card. Two icon levels in one panel read as two cards |
| Once a card has one group, every row in it is in a group                               | An ungrouped row after a group has no readable membership                  |
| A group holds rows, and never another group                                            | Three levels inside one panel is the wall of boxes with extra steps        |
| A group holds two rows, or one stacked editor                                          | A one-row band labels the same thing twice                                 |
| A card with groups runs the full page width                                            | A group header in a half-width column has no room to live in               |
| A group title is a noun                                                                | It labels a band, and it does not instruct                                 |
| A group never starts collapsed over a setting a first-run reader needs                 | Hiding the League path is hiding the app                                   |
| A dependent row is not a group                                                         | Two meanings for one indent is one meaning too many                        |
| A reset control sits at the level it resets, and reaches nothing else                  | Otherwise a reader has to guess how far a button goes                      |
| A reset never removes a path a reader found or a list they built                       | A reset puts a choice back, and it does not delete work                    |
| An anchor addresses an id, and never a label                                           | A label is copy, and copy gets rewritten                                   |

The one exception to _every row is in a group_ is the **lede row**: a single row above the first
group, allowed only when that row gates the whole card. It draws as a normal row, and the first
group below it draws its rule as usual, because it is no longer the panel's first child.

## Collapsible groups

**Deferred.** No card in the migration below folds, so nothing here has a call site to be reviewed
against. It lands with the first group that needs to fold, and the design below is what that work
starts from rather than what the group ships with.

A group folds only when a reader who is not looking for it should not have to read past it -
diagnostics, developer options, a long blocklist. Everything else stays open.

- The toggle spans the caret, the title and the space after it, so most of the header row is the
  hit target. The trailing cluster stays outside it, because a reset button cannot nest inside the
  button that folds the group
- Open by default. `defaultOpen={false}` is allowed only on a group of diagnostics or developer
  options
- The open state persists per group id, in a `settingsLayout` store that mirrors
  `workshopLayout.openSections` - a `Record<string, boolean>` under `persist`
- The body animates its height, and `useReducedMotion()` returns that to instant
- A settings search, when one is built, indexes the settings model rather than the rendered page,
  whichever way the collapsed rows go
- Whether a collapsed group keeps its rows in the DOM is the question this work left open. The
  dependent row answers the same question with `hidden` - mounted, registered, drawing nothing - and
  a collapsed group taking that shape needs no declaration of the settings it holds

## The dependent row

`Start in tray unless update available` is one, and `Blur` under `Background image` is the second.
A row appears when its parent toggle is on, indented behind a left rail. This is a different relationship
from a group, and it keeps a different shape.

| Concept       | Shape                                     | Membership                        |
| ------------- | ----------------------------------------- | --------------------------------- |
| Group         | A label above a band, and a rule above it | Rows about the same facet         |
| Dependent row | An indent behind a left rail              | A row its parent's state controls |

Rules for a dependent row:

- One level only. A dependent row has no dependents of its own
- It appears when the parent allows it, and it is never disabled in place
- The rail is `border-l-2 border-surface-600 pl-4`. The rung today is `surface-700`, which is the
  input rung. `surface-600` is the divider rung, and a rail is a divider
- A group holds a parent row and its dependents together. They never straddle a rule
- **A hidden dependent row stays mounted and draws nothing.** The row owns the condition rather than
  the card around it, so the group it belongs to knows the setting exists even while the reader
  cannot see it. That is what lets an anchor find it and a reset skip it, from one registration

## Defaults and reset

The app knows what a fresh install shows for every setting, and nothing on screen says so.
`ResetAppearanceButton` is the whole of it today: one card, one button, and its own hand-written
comparison against a default it keeps beside itself.

A reader has two questions here, and they are the same question at two moments. _What did I
change?_ and _how do I put it back?_ One affordance answers both.

### Where a default comes from

Two tables already hold them, so the source is not new work.

| Owner                                          | Holds                                                  |
| ---------------------------------------------- | ------------------------------------------------------ |
| `Settings::default()`, in Rust                 | Every setting the backend stores, `Config` included    |
| `APPEARANCE_DEFAULTS`, in `displayStore`       | Zoom, motion, corners, fonts, surface tint, scrollbars |
| `PROJECT_EDITOR_DEFAULTS`, in `workshopLayout` | Tab open mode, game search, forward-looking meta       |

The Rust table reaches the frontend through one command, `get_default_settings`, behind a query
that never goes stale. A second copy of that table written in TypeScript is the one thing this
design must not do. A default that drifts from the backend's is worse than no default at all,
because it offers to reset a value to something a fresh install never had.

The command keeps the `get_` prefix that C-GETTER rules out. `get_settings` sits beside it in the
same file, and one command out of step with its neighbour reads as a mistake rather than a rule.

### The gutter gear

Left of every row is a gutter, and every row the index carries draws a gear in it. The gear is
invisible until the pointer is over the row, so a card at rest is rows and controls and nothing
else. Its menu is where a row is put back, and where its id is taken:

```
Reset setting
Default: Off
─────────────────
Copy setting ID
Copy link to setting
```

The default reads as the reader would read it - `Off`, `Geist`, `100%`, `None` - and it is derived
from the tables above rather than written beside the row. A hand-written label is a second copy of a
value the backend already owns, and the two drift the first time a Rust default changes.

**The gear takes no tab stop.** Forty-five rows would otherwise double the settings page's tab
order, and every second stop would be an affordance rather than a control. Right-clicking anywhere
on the row opens the same menu, which is the desktop convention and the path that does not need a
pointer to find a 20px target.

`Reset setting` is disabled rather than hidden while the row is at its default. A menu whose only
item comes and goes is a menu that reads as broken, and the disabled item is also what tells a
reader the row is already where a fresh install leaves it.

**The gear is on every addressable row, and the reset is not.** An id is worth copying whether or
not the value behind it can be put back, and the paths and the lists are exactly the rows someone
links a teammate to. On those, `Copy setting ID` is the whole menu. `Reset setting` is absent
rather than disabled, because an item that can never be enabled is a promise of a way back that
would delete what a reader found or built.

`Copy setting ID` copies the public id and nothing else. There is no settings file to paste it
into, so what it is for is a person telling another person which setting they mean - a support
thread, an issue, a message. `Copy link to setting` is the same act with somewhere to click, and
it copies the `ltk://settings` link below.

### The modified bar

A row that is off its default draws a bar down its own left edge, in dimmed accent. It is the
at-a-glance half of the pair: the gear can carry actions because it hides, and the bar can carry
state because it does not.

**Dimmed, and not full accent.** A tab where most rows have been changed is a column of bars, and at
full strength that column drowns out the single row a `?focus=` link just landed on. Modified is a
state the reader chose. The mark is the app answering a question they just asked, so the mark is the
louder of the two.

The dependent row gives up the rail it carried and keeps its indent alone, because that edge now
means one thing.

### The three scopes

| Level | Control                              | Appears                          | Resets                  |
| ----- | ------------------------------------ | -------------------------------- | ----------------------- |
| Row   | A gear in the gutter                 | On row hover, or a right-click   | That row                |
| Group | A ghost icon button in the header    | Two or more rows are off default | Every row in the group  |
| Card  | A labelled `Reset to default` button | Always, disabled at default      | Every group in the card |

**Appearance is the only card with a card-level reset.** It has one today, and it is the card whose
eleven rows are one subject a reader changes as a set. Patching's four group resets already cover
its card between them, and a card button beside the League path is the widest scope on the page and
the one a reader checks least.

**A group's reset waits for the second changed row.** One changed row is already its own reset, and
a second control that does the same thing to the same row is noise. This is what keeps a single
theme change from drawing three arrows down one card.

**A card's button is disabled rather than hidden.** It is labelled and it lives in the card header,
so a button that comes and goes moves the heading under the reader's cursor. The group's reset is
an unlabelled icon inside the panel, which has no such problem, so it is hidden until it applies.

**A group or card reset shows a toast with `Undo`.** That is the answer to a control that changes
eight things at once, and it is a better one than a confirm dialog: no click for the reader who
meant it, and full recovery for the reader who did not. A row needs neither, because the way back
is the control they just used.

`Undo` puts back the keys the reset wrote, and nothing else. It is a patch applied to whatever the
settings are when it is clicked, rather than a snapshot written over them, so a change the reader
made during the toast's five seconds survives. A reset reaches its own scope, and so does its undo.

### What a reset never touches

A reset puts a choice back. It does not delete work, so these rows carry no marker, and no scope
above them reaches them:

- The League path, the mod storage path and the workshop path, which a reader found on disk
- The WAD blocklist and the trusted providers, which a reader built
- The author profiles, which are content rather than configuration

Their editors already carry their own controls, and a list editor removes one item at a time on
purpose.

A hidden dependent row is not reset either, and it carries no marker while it is hidden. Its parent
is off, so its value is inert, and it waits there for the parent to come back on. That is what a
reader expects from a setting that disappeared rather than one that was cleared. It follows that a
group's reset never counts a hidden row toward the two changed rows that put the control on screen,
because a control that offers to put back a row nobody can see is a control nobody can check.

`Blur` is the one exception, and it is a row resetting its own parent's dependent rather than a
scope reaching past itself. Resetting `Background image` clears `backdropBlur` in the same write,
because a blur belongs to an image the reader just removed rather than being a choice that will mean
something again.

### Copy

| Where        | Text                                                                |
| ------------ | ------------------------------------------------------------------- |
| Gear label   | `Actions for Auto run`, so a card of gears is not one name repeated |
| Gear menu    | `Reset setting`, `Default: Off` under it, then the two copies       |
| Copy toast   | `Copied setting ID`, with `general.autoRun` as its description      |
| Link toast   | `Copied link to setting`, with the `ltk://` URL as its description  |
| Group button | `Reset 2 changed settings in this group`, as label and tip          |
| Card button  | `Reset to default`, which is what the Appearance card says          |
| Toast        | `Reset 2 settings`, with an `Undo` action                           |

## Anchors

A group with a name is a thing that can be pointed at. Nothing points at settings today. Five
places navigate there, and every one of them lands on the General tab and leaves the rest to the
reader - including the two that already know exactly which row they mean. The workshop's empty
state says `Set up a workshop directory in Settings`, and then opens a tab that does not hold it.

### The setting index

`SETTINGS_INDEX` is one table with one row per addressable setting, holding its public id, the
`SettingKey` it reads and its title. Everything that has to name a setting reads it there. The row
draws its own title from it, the gear copies the id, `?focus=` resolves against it, and the palette
builds a row per entry.

The id is namespaced by the tab the setting is drawn on - `general.autoRun`, `appearance.theme` -
and it is permanent. The namespace is not decoration. It is what lets a link resolve a tab before
the panel holding its target has mounted, which is the whole reason one param can carry both halves
of a link. Group ids are namespaced the same way, so `?focus=` has one id space and one rule rather
than two.

A row is addressable only if the table carries it, and `SettingRow` will not take a key the table
does not - the prop is typed as the table's own key union. The title moving into the table is the
same argument as the default's label: a name written beside the row is a second copy of a name
something else already reads, and the copy is what goes stale when the row is reworded.

A setting that moves keeps its old spelling in `aliases`, so a link minted before the move still
lands on it. Nothing has moved yet, and the column is empty.

### The URL

`/settings` takes two more search params beside the `firstRun` it validates today.

| Param   | Value                              | Effect                                                   |
| ------- | ---------------------------------- | -------------------------------------------------------- |
| `tab`   | A tab value from `TABS`            | Opens that tab. Defaults to `general`                    |
| `focus` | A public setting id, or a group id | Opens the tab its namespace names, and points at one row |

`?focus=patching.mod-safety` opens Patching and points at the group.
`?focus=patching.patchTft` opens the same tab and points at the row. Neither needs a `tab=`
beside it, because the namespace already carries one.

A search param, and not a `#` hash: this route already validates its search in one place, and what
scrolls is a container inside the page rather than the document.

The id is what the URL carries, so a link outlives every rewrite of the label above it. What it
carries is the **public id** from the index rather than the `SettingKey` the row reads: the key is
a name the frontend gives itself and would rather be free to change, and the id is the one the app
promises to anyone holding a link.

A row excluded from reset is still a valid target. The two features share the id and nothing else.

### What focus does

1. Reads the tab out of the id's namespace and selects it
2. Scrolls the target into view, near the top of the panel rather than the bottom of it
3. Marks it for two seconds with `ring-2 ring-accent-500/40`, which then fades
4. Writes that tab into the URL and clears `focus`, both in one `replace: true`

Step 4 is what stops a refresh from re-flashing a mark the reader has already read, and what keeps
Back out of a loop between two spellings of the same page. The tab is written in the same navigate,
so the page is never left reading a cleared `focus` for the tab it should be showing.

`useReducedMotion()` returns step 2 to an instant scroll, and step 3 to a mark that holds for two
seconds and then disappears.

**A `focus` naming a hidden dependent row marks the group around it.** The row is mounted, so the
group knows the key is one of its own, and the reader lands on the header above the toggle that
gates what they came for. Marking a row that draws nothing would be a link that appears to fail.

### Tab state

`Tabs.Root` moves from `defaultValue` to a controlled `value`, written back with
`navigate({ search, replace: true })`. Replace, because a tab is not a place a reader wants Back to
walk through. Back leaves settings.

### Who links

| From                              | Today       | With the anchor                      |
| --------------------------------- | ----------- | ------------------------------------ |
| The workshop's empty state        | `/settings` | `?focus=workshop.workshopPath`       |
| The game browser, with no League  | `/settings` | `?focus=general.leaguePath`          |
| A patcher failure, on an injector | `/settings` | `?focus=patching.injector`           |
| The titlebar gear, and `Ctrl+,`   | `/settings` | Unchanged. They mean the whole page  |
| First run                         | `?firstRun` | Unchanged. The banner is the pointer |

The patcher failure is the one row with no link to rewrite. Nothing on the injection failure path
navigates to settings today, so it is a link to add rather than a link to aim.

First run takes no `focus`, because it already draws a banner over the card telling the reader to
configure the path below. A banner and a mark that fades after two seconds are one signal too many,
and the banner is the half that explains auto-detection.

The palette carries the search. Every entry of the index is a row of a `settings` source, matched
only once something is typed, and choosing one navigates with the id alone. A source of its own
rather than more commands, because a resting box lists its commands and forty-five settings would
bury the handful someone opened the bar to read. The id is one of the words a row matches on, so a
reader who already knows the setting can type `appearance.theme` at it.

### The deep link

`ltk://settings?focus=<id>` opens the app on one setting, and `Copy link to setting` in the gear's
menu is what mints one. It is `Copy setting ID` with somewhere to click.

`parse_deep_link_url` routes on the action rather than checking for one, so `install` and
`settings` are two arms of one enum and a third route is an arm rather than a rewrite. The rate
limiter, the scheme check and the unknown-action error were already there and are shared.

`focus` is held to the id alphabet at the boundary - letters, digits, `.`, `-` and `_`, up to 128
characters - because the value is handed to the frontend to put back into its own URL. Passing that
is not the same as naming a setting the index carries, and it does not need to be: an id nothing
resolves opens the tab its namespace names and marks nothing, which is what a link minted against a
build that has since moved on should do.

**A link followed while the app is closed is held rather than sent.** The window is created hidden,
and the URL reaches the backend before the window's script has run, so an event carrying it would
reach nobody. The frontend asks for the held link once, as its listener comes up. `ltk://install`
was losing a cold start's link the same way, and now does not.

## Copy

Card and group titles are sentence case, except for a proper noun. `System Tray & Autostart` and
`Author Profiles` are the two title-case holdouts, and they change with this work.

A group title is one or two words, and takes no description in most cases. The rows under it
enumerate themselves, so a sentence over them writes the card twice.

| Bad                      | Good          | Why                                                      |
| ------------------------ | ------------- | -------------------------------------------------------- |
| `Options for mod safety` | `Mod safety`  | A group is a label, and not a sentence                   |
| `Configure incidents`    | `Incidents`   | A noun, and not an instruction                           |
| `Advanced`               | `Diagnostics` | Name the facet, and not how hard the reader will find it |
| `Other`                  | -             | A group with no name is a card with no grouping          |

**An `and` in a title is a signal.** It says the thing holds two facets. That is a good reason to
give it groups, and then to try to name the whole again. Where no single word covers both, the
`and` stays and the groups do the work - `Startup and tray` is one of those.

Where the two halves mean the same thing, the title is hiding what the card really holds.
`Safety & Integrity` is that case. Safety and integrity are one idea here, and the panel under
that title holds four.

## Accessibility

- A group renders `<section aria-labelledby>` around an `<h4 id>`, so the outline reads card
  (`h3`) and then group (`h4`)
- `role="group"` with `aria-labelledby`, and not `fieldset` with `legend`. Every row already owns
  its own label, and a fieldset makes some screen readers repeat the legend on each control inside
  it
- A collapsible header, when one lands, is a `<button aria-expanded aria-controls>` inside the `h4`,
  wrapping the caret and the title only. It is one tab stop, the caret gets none of its own, and
  Enter and Space toggle it. The action and the reset are siblings of that button, not children
- The header is chrome the app wrote about itself, so it takes `select-none`
- Tab order inside a group is unchanged. A group adds no focus trap and no roving index
- The gear is a `<button>` in the row's gutter, which is safe inside a `<label>` because a label
  ignores clicks on interactive descendants - the note `HintIcon` already carries
- Its accessible name names the row, `Actions for Patch TFT files`, which the index is what makes
  possible. A card of identical gears otherwise reads out as `Setting actions` eleven times
- The gear takes `tabIndex={-1}` and is reached by right-clicking the row rather than by Tab. Forty-five
  rows of affordance between forty-five rows of control is a tab order nobody walks twice
- The changed dot on a collapsed header is decorative. The header's accessible name carries the
  fact instead
- A focus target takes `tabIndex={-1}` and takes focus after the scroll, so a keyboard reader lands
  where the link pointed rather than back at the top of the tab
- Focus lands on the group header, or on the row, and never on the control inside it. A reader who
  arrives on a switch and presses Space has changed the setting they came to read

## The API

`SettingGroup` sits beside `SettingRow` in `src/modules/settings/components/`, and exports through
the module barrel. It is settings-specific, so it does not belong in `@/components`.

```tsx
interface SettingGroupProps {
  /** Stable and namespaced by its tab, `patching.mod-safety`, for the `focus` anchor. */
  id: string;
  title: string;
  /** Rare. Only where the title cannot carry the meaning on its own. */
  description?: string;
  /** Detail that would crowd the header, shown on the title's hint icon. */
  hint?: ReactNode;
  badge?: ReactNode;
  /** A control for the whole group, pinned to the header's trailing edge. */
  action?: ReactNode;
  children: ReactNode;
}
```

`collapsible`, `defaultOpen` and the `settings` declaration land with the collapsible group, and
not before.

Two supporting changes come with it:

- `SectionCard` owns its panel's layout, at `flex flex-col gap-4`. Every card writes
  `<div className="flex flex-col gap-3">` by hand today, and two write `space-y-*`, which
  `DS-GAP` rules out
- `SettingRows` wraps the rows of an ungrouped card, at `flex flex-col gap-3`. A card is then
  either one `SettingRows`, or a list of `SettingGroup`

```tsx
<SectionCard title="Patching" icon={<PatcherIcon className="h-5 w-5" />}>
  <SettingGroup id="patching.injector" title="Injector">
    <SettingRow setting="patchTft" ... />
  </SettingGroup>

  <SettingGroup id="patching.mod-safety" title="Mod safety">
    <SettingRow setting="blockScriptsWad" ... />
    <AlertBox variant="warning">...</AlertBox>
  </SettingGroup>
</SectionCard>
```

An `AlertBox` a row raises stays inside that row's group, under the row. It is part of what the
row said.

### What a row declares

`SettingRow` reads a setting, or it names itself, and never both. That is a union rather than two
optional props, so a row cannot carry a title the index would overrule and cannot omit both.

```tsx
type SettingRowProps = SettingRowBase &
  ({ setting: IndexedSettingKey; title?: never } | { setting?: never; title: string });
```

`setting` is the row's reset scope, and the index turns it into the row's title and its anchor id.
Its type is the index's own key union, so a key the table has no entry for is a type error rather
than a row with no name.

The icon and the badge two rows carry inside a fragment today become props of their own, beside the
`badge` a group already takes. A row's anatomy belongs to the row.

```tsx
/** A setting the backend stores, or one a frontend store owns. */
type SettingKey = keyof Settings | `display.${AppearanceKey}` | `layout.${ProjectEditorKey}`;
```

Three namespaces, because the Project editor's rows read `workshopLayout`. That store mixes
preferences with geometry, so `ProjectEditorKey` names only the three rows the card shows, carved
out the way `APPEARANCE_DEFAULTS` was carved out of the display store. A key exists where a row
exists, and nowhere else.

The index answers four questions, over the `SETTINGS_INDEX` table behind them.

```tsx
/** The entry for a key a row declared, which the index carries by construction. */
function settingEntry(key: IndexedSettingKey): SettingEntry;

/** The entry a public id or a retired alias names, or undefined for neither. */
function settingById(id: string): SettingEntry | undefined;

/** The tab a `?focus=` value opens, whatever it names. */
function settingFocusTab(focus: string): SettingsTab;

/** A link that opens the app on one setting, for pasting where it is clicked. */
function settingLink(id: string): string;
```

**A row whose key has no entry in `SETTING_FORMAT` is addressable and never reset.** That is
exactly the League path, the WAD blocklist and the author profiles. They keep their anchor, their
id and their gear, and they keep their data. The rule that a reset never deletes work is then
structural rather than a flag someone can set wrong.

Two hooks and one context carry the rest.

```tsx
/** What a fresh install stores, from the Rust defaults and from the two frontend tables. */
function useSettingDefaults(): SettingDefaults;

/** What the scope above this hook holds that is off default, and how to put it back in one save. */
function useSettingReset(): { changed: readonly SettingKey[]; reset: () => void };

/** What one row's gear needs: whether it offers a reset, to what, and how. */
function useSettingDefault(key: SettingKey | undefined): SettingDefault;

/** A row registers what it reads, so the group around it knows its own scope. */
const SettingScope = createContext<{
  register: (key: SettingKey, hidden: boolean) => () => void;
} | null>(null);
```

A group needs no prop for any of this. What registered is what it resets, and how many registered
rows are visible and off default is what decides whether its reset is on screen at all.

Registration rather than a list of keys on every group, for two reasons. A second list of keys
beside the rows is a second place to forget one. And a dependent row registers whether or not the
reader can see it, so the group holds the whole truth about its own scope without anyone writing it
down twice — which is what an anchor to a hidden row needs, and what a reset skipping one needs.

A card that carries a reset renders one more `SettingScope` around its whole `SectionCard`. Scopes
nest and forward upward, so the card sees every group inside it without a second component, and
`SectionCard` itself stays a shared shell with no idea what a setting is.

### What the route declares

```tsx
interface SettingsSearch {
  firstRun?: boolean;
  tab?: TabValue;
  focus?: string;
}
```

`focus` is a string rather than a union, because the ids it addresses are spread across four
sections and a union would have to be maintained beside them. An unknown `focus` selects the tab
and does nothing else, which is the right failure for a link that outlived the setting it named.

Nothing about the group persists. The tab and the focus target live in the URL, and the two-second
mark lives in the component. `settingsLayout` arrives with the collapsible group, and only to hold
its open state.

`data-ui` values are `SettingGroup` on the root and `SettingGroup:header` on the header.

## Migration

### Patching

The tab that motivated this. `Patching` and `Safety & Integrity` merge into one full-width card,
and the two-column `SettingsGrid` leaves the tab, because both remaining cards are full width.

Card `Patching`:

| Group         | Rows                                                                                  |
| ------------- | ------------------------------------------------------------------------------------- |
| Injector      | Patch TFT files, Run injector elevated, Verbose patcher logging                       |
| Mod safety    | Block Scripts.wad.client, Warn about missing dependencies, Enforce anti-skinhack scan |
| Game archives | Scan every WAD up front, Disable crash reporting                                      |
| Incidents     | Allow reading game logs, Keep incidents                                               |

`Game archives` is a real facet and not a leftover. The two rows are coupled - archives are
verified on demand only while Riot's crash reporting is off - and the group is where that coupling
becomes visible.

Card `Overlay` keeps its own panel and takes no groups. It has three rows, it passes the move
test, and it is the example of a card the group level does not touch.

### Appearance

One card, eleven rows, five groups. The card keeps its `Reset to default` action at card level,
because it resets all of them.

| Group           | Rows                                 |
| --------------- | ------------------------------------ |
| Color           | Theme, Accent color, Surface tint    |
| Shape and scale | Corners, Zoom level                  |
| Text            | Interface font, Code font            |
| Motion          | Reduce motion, Scrolling, Scrollbars |
| Backdrop        | Background image, Blur               |

`Blur` appears only once an image is set, which makes it a dependent row of `Background image`
rather than a peer of it, and `Backdrop` a one-row group holding a stacked editor and its dependent.
It draws behind the rail like the tray card's, and resetting the image clears it.

### Library

The card already draws these three clusters with two separators. The groups are the labels those
separators do not carry.

| Group       | Rows                                                      |
| ----------- | --------------------------------------------------------- |
| Storage     | Storage location, Keep mod archives                       |
| Cataloguing | Automatically categorize mods, Watch for external changes |
| Installing  | Trusted mod providers                                     |

### General

| Card              | Rows | Verdict                                                      |
| ----------------- | ---- | ------------------------------------------------------------ |
| League of Legends | 4    | Two groups. It draws a `Separator` today, per the count test |
| Startup and tray  | 5    | Two groups. Renamed from `System Tray & Autostart`           |
| Import            | -    | An action card, and not a row list                           |

The tab goes single-column. `Startup and tray` runs the full width once it has groups, which leaves
`Import` alone in a half column under two wide cards, so `SettingsGrid` leaves this tab too and
`Import` runs wide with the rest.

Card `League of Legends`:

| Group        | Rows                                                                               |
| ------------ | ---------------------------------------------------------------------------------- |
| Installation | Installation path. One row, and a stacked editor, which is the exception           |
| Launching    | Launcher flow, Hide Riot Client on Game start, Stop the patcher when the game ends |

Card `Startup and tray`:

| Group   | Rows                                                                                              |
| ------- | ------------------------------------------------------------------------------------------------- |
| Startup | Auto run, and its dependent Start in tray unless update available. Always start patcher at launch |
| Tray    | Minimize to system tray, Start minimized to tray                                                  |

### The rest

| Tab      | Verdict                                                                               |
| -------- | ------------------------------------------------------------------------------------- |
| Workshop | No groups. Three cards, of one row, three rows and a list. Titles go to sentence case |
| Cache    | No groups. The tab is a table and two actions                                         |
| Hotkeys  | No groups. Three rows. A per-action hotkey list would group by what the hotkey does   |
| About    | No groups. Not a row list                                                             |

Every row a migration touches also gains the `setting` key it reads, and an entry in the index
under it. The rows no reset may touch take the entry all the same, so they can still be linked to
and their ids can still be copied.

After this work, five cards of the eight tabs carry groups. That is the intended outcome, because
the level earns its place twice: once on the two cards that are unreadable today, and again every
time a setting is added. The ninth row on the Appearance card joins `Motion`, instead of starting
a `More appearance options` card.

`SettingsGrid` survives on the Workshop tab alone, which is the one tab whose cards are short enough
to sit side by side and have no groups to widen them.

## Rejected alternatives

| Alternative                               | Why not                                                                                        |
| ----------------------------------------- | ---------------------------------------------------------------------------------------------- |
| A panel per group, inset `surface-950/40` | Boxes inside a box. `DS-GROUND` puts an inset under a detail strip, and a group is half a card |
| A card per group, which is today          | It splits one subject across two panels, and the page reads as a wall of boxes                 |
| An accordion for every group              | It hides what the reader opened settings to change, and turns one scan into four clicks        |
| Sentence-case bold group headers          | They tie with the row title, which is also sentence case at `text-sm`                          |
| A second tab level                        | It doubles the navigation for a facet that fits in a band of three rows                        |
| A left rail for grouping                  | That is the dependent row's shape, and one shape can only mean one thing                       |
| Sticky group headers                      | The panel does not scroll. The page does                                                       |
| Two columns of grouped cards              | Four heading levels on one line, and a group header with 330px to live in                      |
| A `Default: Off` line under every row     | It doubles the height of a card to say nothing at all about the rows already at their default  |
| A revert marker revealed on hover         | The marker is information before it is a control, and hidden it answers neither question       |
| A confirm dialog before a group reset     | A toast with `Undo` recovers the same mistake, and costs no click to the reader who meant it   |
| `Reset all settings`, somewhere global    | It belongs to no level a reader is looking at, and `everything` is the one scope nobody checks |
| A frontend copy of the defaults           | It drifts from `Settings::default()` and offers a reset to a value no fresh install ever had   |
| A `#hash` anchor                          | The route validates its search in one place, and the document is not what scrolls              |

## Open questions

- Does the patcher want a link into settings at all? The anchor gives one a target, and nothing on
  the injection failure path navigates to settings today, so the link is a decision rather than a
  rewrite

Closed on 2026-08-25:

- **`Game archives` and `Incidents` stay apart.** The archive rows are coupled to each other -
  archives are verified on demand only while Riot's crash reporting is off - and one `Diagnostics`
  group of four rows would hide that coupling behind a vaguer name than either has now
- **Appearance keeps the only card-level reset.** Patching's four group resets cover its card
  between them, and a card button beside the League path is the widest scope on the page
- **`focus` addresses a group or a row, and never a card.** Every row is addressable already, so a
  card target buys a better-aimed link and a third kind of thing an id can name
- **A collapsible group's declaration is not needed yet.** The group ships without folding, so the
  question waits with it. `SettingRow.hidden` is the answer's likely shape: a row that stays mounted
  and draws nothing is what lets a group know its own scope without a second list, and a collapsed
  group could keep its rows the same way
